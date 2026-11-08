// Directorios (lista y formulario genéricos) y ajustes del negocio
const ROLES = {admin: 'Administrador', vendedor: 'Vendedor', almacen: 'Almacén', contador: 'Contador'};
const DIRS = {
  terceros: {label: 'Clientes y proveedores', table: 'parties', order: 'name', fields: [
    {k: 'name', l: 'Nombre o razón social', req: 1}, {k: 'rif', l: 'RIF o cédula'}, {k: 'phone', l: 'Teléfono (WhatsApp)', type: 'tel'},
    {k: 'email', l: 'Correo', type: 'email'}, {k: 'address', l: 'Dirección'},
    {k: 'is_customer', l: 'Es cliente', type: 'check', def: true}, {k: 'is_supplier', l: 'Es proveedor', type: 'check'}],
    title: r => r.name, sub: r => [r.is_customer && 'Cliente', r.is_supplier && 'Proveedor', r.phone].filter(Boolean).join(' | ')},
  unidades: {label: 'Unidades', table: 'units', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'symbol', l: 'Símbolo (kg, L, und)', req: 1},
    {k: 'kind', l: 'Tipo', type: 'select', opts: {unidad: 'Unidad', masa: 'Masa (base: gramo)', volumen: 'Volumen (base: mililitro)'}},
    {k: 'factor_to_base', l: 'Equivale a (g, ml o und)', type: 'number', req: 1}],
    title: r => `${r.name} (${r.symbol})`, sub: r => `1 ${r.symbol} = ${qty(r.factor_to_base)} de la unidad base`},
  monedas: {label: 'Monedas', table: 'currencies', order: 'code', fields: [
    {k: 'code', l: 'Código (USD)', req: 1}, {k: 'name', l: 'Nombre', req: 1}, {k: 'symbol', l: 'Símbolo'}],
    title: r => `${r.code} - ${r.name}`, sub: r => r.is_base ? 'Moneda base' : ''},
  impuestos: {label: 'Impuestos', table: 'taxes', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'percent', l: 'Porcentaje', type: 'number', req: 1}, {k: 'is_default', l: 'Aplicar por defecto', type: 'check'}],
    title: r => r.name, sub: r => `${qty(r.percent)}%${r.is_default ? ' | por defecto' : ''}`},
  cuentas: {label: 'Tipos de cuenta', table: 'account_types', order: 'name', fields: [{k: 'name', l: 'Nombre', req: 1}], title: r => r.name, sub: () => ''},
  gastos: {label: 'Tipos de gasto', table: 'expense_types', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'is_fixed', l: 'Es un gasto fijo', type: 'check'}, {k: 'in_sales_cost', l: 'Es costo de servicios de ventas (ej: delivery). Ya está en el costo de lo vendido, no se cuenta otra vez como gasto', type: 'check'}],
    title: r => r.name, sub: r => r.is_fixed ? 'Gasto fijo' : 'Gasto variable'},
  plantillas: {label: 'Plantillas de mensajes', table: 'message_templates', order: 'name', fields: [{k: 'name', l: 'Nombre', req: 1}, {k: 'body', l: 'Mensaje (usa {nombre} {producto} {negocio} {dias} {saldo})', type: 'textarea', req: 1}], title: r => r.name, sub: r => r.body.slice(0, 60)},
  metodos: {label: 'Métodos de pago', table: 'payment_methods', order: 'name', fields: [{k: 'name', l: 'Nombre (ej: Pago móvil, Binance, Cheque)', req: 1}], title: r => r.name, sub: () => 'Se asigna a cada cuenta en Finanzas > Cuentas'},
  listas: {label: 'Listas de precios', table: 'price_lists', order: 'name', fields: [{k: 'name', l: 'Nombre (ej: Mayor)', req: 1}, {k: 'adjust_percent', l: 'Ajuste sobre el precio de venta, en % (ej: -10 para 10% menos)', type: 'number', req: 1}], title: r => r.name, sub: r => (r.adjust_percent > 0 ? '+' : '') + qty(r.adjust_percent) + '% sobre el precio de venta'},
  categorias: {label: 'Categorías de producto', table: 'product_categories', order: 'name', fields: [{k: 'name', l: 'Nombre', req: 1}, {k: 'sells_regularly', l: 'Se vende con frecuencia (si no, no cuenta en "sin vender en 30 días")', type: 'check', def: true}], title: r => r.name, sub: () => ''},
  usuarios: {label: 'Usuarios', table: 'profiles', order: 'created_at', all: 1, noAdd: 1, noDel: 1, fields: [
    {k: 'full_name', l: 'Nombre', req: 1}, {k: 'role', l: 'Rol', type: 'select', opts: ROLES}, {k: 'active', l: 'Usuario activo', type: 'check'}],
    title: r => r.full_name || 'Sin nombre', sub: r => ROLES[r.role] + (r.active ? '' : ' | inactivo')}
};
const DIR_LABELS = Object.fromEntries(Object.entries(DIRS).map(([k, c]) => [k, c.label]));

async function viewDir(key) {
  const c = DIRS[key];
  let qb = db.from(c.table).select('*');
  if (!c.all) qb = qb.eq('active', true);
  const rows = await q(qb.order(c.order));
  $('#view').innerHTML = `<div class="list" id="dList">${rows.map(r => `<button class="item" data-id="${r.id}"><span><b>${esc(c.title(r))}</b><small>${esc(c.sub(r))}</small></span><span class="mut">&rsaquo;</span></button>`).join('')
    || '<p class="mut">Aún no hay registros. Pulsa el botón + para agregar.</p>'}</div>
    ${c.noAdd ? '<p class="mut">Para crear un usuario nuevo usa Supabase (Authentication > Users). Aquí le asignas su rol.</p>' : '<button class="fab" id="dAdd" aria-label="Agregar">+</button>'}`;
  if (!c.noAdd) $('#dAdd').onclick = () => dirForm(c, null);
  $('#dList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) dirForm(c, rows.find(r => String(r.id) === b.dataset.id)); };
}

function dirForm(c, row) {
  const v = (f) => row ? row[f.k] : f.def;
  const fields = c.fields.map(f => {
    if (f.type === 'check') return `<label class="chk"><input type="checkbox" name="${f.k}" ${v(f) ? 'checked' : ''}> ${f.l}</label>`;
    if (f.type === 'textarea') return `<label>${f.l}<textarea name="${f.k}" rows="5" ${f.req ? 'required' : ''}>${esc(v(f) ?? '')}</textarea></label>`;
    if (f.type === 'select') return `<label>${f.l}<select name="${f.k}">${Object.entries(f.opts).map(([k, t]) => `<option value="${k}" ${v(f) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    return `<label>${f.l}<input name="${f.k}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="0.0001"' : ''} value="${esc(v(f) ?? '')}" ${f.req ? 'required' : ''}></label>`;
  }).join('');
  openSheet(row ? 'Editar' : 'Nuevo', `<form id="dForm" class="stack">${fields}<div class="row"><button class="btn" type="submit">Guardar</button>${row && !c.noDel ? '<button type="button" class="btn ghost" id="dDel">Desactivar</button>' : ''}</div></form>`);
  $('#dForm').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements, obj = {};
    c.fields.forEach(f => { const x = el[f.k]; obj[f.k] = f.type === 'check' ? x.checked : f.type === 'number' ? +x.value : (x.value.trim() || null); });
    run(async () => { await q(row ? db.from(c.table).update(obj).eq('id', row.id) : db.from(c.table).insert(obj)); if (c.table === 'payment_methods') await loadMethods(); closeSheet(); toast('Guardado'); render(); });
  };
  if (row && !c.noDel) $('#dDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar este registro?')) return;
    await q(db.from(c.table).update({active: false}).eq('id', row.id)); if (c.table === 'payment_methods') await loadMethods(); closeSheet(); toast('Desactivado'); render();
  });
}

// Datos del negocio y diseño del ticket (tabla settings)
async function viewSettings(kind) {
  const s = await q(db.from('settings').select('*').eq('id', 1).single());
  const F = kind === 'negocio'
    ? [['business_name', 'Nombre del negocio'], ['business_rif', 'RIF'], ['business_phone', 'Teléfono'], ['business_email', 'Correo'], ['business_address', 'Dirección']]
    : [['ticket_header', 'Texto debajo del nombre'], ['ticket_footer', 'Mensaje al final']];
  const inputs = F.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(s[k] ?? '')}"></label>`).join('');
  const extra = kind === 'negocio' ? `<label class="chk"><input type="checkbox" name="enable_product_photos" ${s.enable_product_photos ? 'checked' : ''}> Permitir fotos en los productos</label>
    <label>Logo del negocio<input name="logo" type="file" accept="image/*"></label>${s.logo_data ? `<img class="thumb big" src="${s.logo_data}" alt=""><label class="chk"><input type="checkbox" name="rmlogo"> Quitar el logo actual</label>` : ''}<label class="chk"><input type="checkbox" name="ticket_show_logo" ${s.ticket_show_logo ? 'checked' : ''}> Mostrar el logo en el ticket en foto</label>
    <label>Costo automático de los productos<select name="cost_method"><option value="avg" ${(s.cost_method || 'avg') === 'avg' ? 'selected' : ''}>Costo promedio</option><option value="last" ${s.cost_method === 'last' ? 'selected' : ''}>Costo de la última compra o fabricación</option><option value="max" ${s.cost_method === 'max' ? 'selected' : ''}>Costo más alto</option></select></label>` : kind === 'ticket' ? `<label>Ancho del papel<select name="ticket_paper"><option value="58mm" ${s.ticket_paper === '58mm' ? 'selected' : ''}>58 mm</option><option value="80mm" ${s.ticket_paper === '80mm' ? 'selected' : ''}>80 mm</option></select></label>
    <label class="chk"><input type="checkbox" name="ticket_show_rate" ${s.ticket_show_rate ? 'checked' : ''}> Mostrar la tasa del día en el ticket</label>
    <label class="chk"><input type="checkbox" name="ticket_show_bs" ${s.ticket_show_bs === false ? '' : 'checked'}> Mostrar el monto en bolívares</label>
    <label>Estilo del ticket en foto<select name="ticket_style"><option value="moderno" ${s.ticket_style === 'clasico' ? '' : 'selected'}>Moderno (tarjeta con color)</option><option value="clasico" ${s.ticket_style === 'clasico' ? 'selected' : ''}>Clásico (tipo ticket)</option></select></label>
    <label>Color principal<input name="ticket_color" type="color" value="${esc(s.ticket_color || '#0b7285')}"></label>
    <label class="chk"><input type="checkbox" name="ticket_show_logo" ${s.ticket_show_logo ? 'checked' : ''}> Mostrar el logo</label>
    <label class="chk"><input type="checkbox" name="ticket_show_info" ${s.ticket_show_info === false ? '' : 'checked'}> Mostrar RIF, teléfono y dirección</label>
    <label class="chk"><input type="checkbox" name="ticket_show_customer" ${s.ticket_show_customer === false ? '' : 'checked'}> Mostrar los datos del cliente</label>
    <label class="chk"><input type="checkbox" name="ticket_show_payments" ${s.ticket_show_payments === false ? '' : 'checked'}> Mostrar los pagos y el saldo pendiente</label>` : '';
  const prev = kind === 'ticket' ? '<div class="card"><h2>Vista previa</h2><div id="tkPrev"><p class="mut">Generando vista previa...</p></div></div>' : '';
  $('#view').innerHTML = `<form id="sForm" class="card stack"><h2>${kind === 'negocio' ? 'Información del negocio' : 'Diseño del ticket de venta'}</h2>${inputs}${extra}<button class="btn" type="submit">Guardar</button></form>${prev}`;
  if (kind === 'ticket') {   // vista previa en vivo con datos de ejemplo
    const f = $('#sForm'), e0 = f.elements, rate = S.rate || 100;
    const sample = {title: 'NOTA DE ENTREGA', number: 128, date: caracasDate(), customer: 'María Pérez', phone: '0414-0000000', items: [{name: 'Detergente líquido 1L', qty: 2, price: 3}, {name: 'Cloro 1L', qty: 1, price: 2}, {name: 'Jabón lavaplatos 500ml', qty: 3, price: 1.5}],
      subtotal: 12.5, discount: 0, tax: 0, total: 12.5, rate, pays: [{label: 'Efectivo', amount: 8, cur: 'USD'}], balance: 4.5, status: 'POR COBRAR', notes: ''};
    let tmr;
    const paint = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
      const cur = {...s, ticket_header: e0.ticket_header.value, ticket_footer: e0.ticket_footer.value, ticket_style: e0.ticket_style.value, ticket_color: e0.ticket_color.value, ticket_paper: e0.ticket_paper.value,
        ticket_show_rate: e0.ticket_show_rate.checked, ticket_show_bs: e0.ticket_show_bs.checked, ticket_show_logo: e0.ticket_show_logo.checked, ticket_show_info: e0.ticket_show_info.checked, ticket_show_customer: e0.ticket_show_customer.checked, ticket_show_payments: e0.ticket_show_payments.checked};
      try { const b = await docBlob(sample, 'DETERGENTE LIQUIDO 1L\n2 x 3.00            6.00\n--------------------------------\nTOTAL USD          12.50', cur); $('#tkPrev').innerHTML = `<img class="rimg" src="${URL.createObjectURL(b)}" alt="Vista previa">`; } catch (err) { $('#tkPrev').innerHTML = '<p class="mut">No se pudo generar la vista previa.</p>'; }
    }, 250); };
    f.addEventListener('input', paint); f.addEventListener('change', paint); paint();
  }
  $('#sForm').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements, obj = {updated_at: new Date().toISOString()};
    F.forEach(([k]) => obj[k] = el[k].value.trim() || null);
    if (kind === 'negocio') obj.enable_product_photos = el.enable_product_photos.checked;
    if (kind === 'ticket') { obj.ticket_paper = el.ticket_paper.value; obj.ticket_show_rate = el.ticket_show_rate.checked; obj.ticket_show_bs = el.ticket_show_bs.checked; obj.ticket_style = el.ticket_style.value; obj.ticket_color = el.ticket_color.value; obj.ticket_show_logo = el.ticket_show_logo.checked; obj.ticket_show_info = el.ticket_show_info.checked; obj.ticket_show_customer = el.ticket_show_customer.checked; obj.ticket_show_payments = el.ticket_show_payments.checked; }
    run(async () => {
      if (kind === 'negocio') {
        obj.ticket_show_logo = el.ticket_show_logo.checked;
        obj.cost_method = el.cost_method.value; if (el.rmlogo?.checked) obj.logo_data = null;
        const lf = el.logo.files[0]; if (lf) obj.logo_data = await logoDataUrl(lf);
      }
      await q(db.from('settings').update(obj).eq('id', 1)); if (kind === 'negocio' && obj.cost_method !== (s.cost_method || 'avg')) { await q(db.rpc('recalcular_costos')); } toast('Guardado'); render();
    });
  };
}
