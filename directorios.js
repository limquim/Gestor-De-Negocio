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
    {k: 'name', l: 'Nombre', req: 1}, {k: 'is_fixed', l: 'Es un gasto fijo', type: 'check'}],
    title: r => r.name, sub: r => r.is_fixed ? 'Gasto fijo' : 'Gasto variable'},
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
    if (f.type === 'select') return `<label>${f.l}<select name="${f.k}">${Object.entries(f.opts).map(([k, t]) => `<option value="${k}" ${v(f) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    return `<label>${f.l}<input name="${f.k}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="0.0001"' : ''} value="${esc(v(f) ?? '')}" ${f.req ? 'required' : ''}></label>`;
  }).join('');
  openSheet(row ? 'Editar' : 'Nuevo', `<form id="dForm" class="stack">${fields}<div class="row"><button class="btn" type="submit">Guardar</button>${row && !c.noDel ? '<button type="button" class="btn ghost" id="dDel">Desactivar</button>' : ''}</div></form>`);
  $('#dForm').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements, obj = {};
    c.fields.forEach(f => { const x = el[f.k]; obj[f.k] = f.type === 'check' ? x.checked : f.type === 'number' ? +x.value : (x.value.trim() || null); });
    run(async () => { await q(row ? db.from(c.table).update(obj).eq('id', row.id) : db.from(c.table).insert(obj)); closeSheet(); toast('Guardado'); render(); });
  };
  if (row && !c.noDel) $('#dDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar este registro?')) return;
    await q(db.from(c.table).update({active: false}).eq('id', row.id)); closeSheet(); toast('Desactivado'); render();
  });
}

// Datos del negocio y diseño del ticket (tabla settings)
async function viewSettings(kind) {
  const s = await q(db.from('settings').select('*').eq('id', 1).single());
  const F = kind === 'negocio'
    ? [['business_name', 'Nombre del negocio'], ['business_rif', 'RIF'], ['business_phone', 'Teléfono'], ['business_email', 'Correo'], ['business_address', 'Dirección']]
    : [['ticket_header', 'Texto debajo del nombre'], ['ticket_footer', 'Mensaje al final']];
  const inputs = F.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(s[k] ?? '')}"></label>`).join('');
  const extra = kind === 'ticket' ? `<label>Ancho del papel<select name="ticket_paper"><option value="58mm" ${s.ticket_paper === '58mm' ? 'selected' : ''}>58 mm</option><option value="80mm" ${s.ticket_paper === '80mm' ? 'selected' : ''}>80 mm</option></select></label>
    <label class="chk"><input type="checkbox" name="ticket_show_rate" ${s.ticket_show_rate ? 'checked' : ''}> Mostrar la tasa del día en el ticket</label>` : '';
  const prev = kind === 'ticket' ? `<div class="card"><h2>Vista previa</h2><pre class="ticket">${esc([s.business_name || 'Mi negocio', s.ticket_header, '----------------------------', 'Detergente 1L    2 x 3.00', 'Cloro 1L         1 x 2.00', '----------------------------', 'TOTAL USD             8.00',
    s.ticket_show_rate && S.rate ? 'Tasa: ' + fmt(S.rate, 2) + ' Bs' : '', s.ticket_footer].filter(x => x !== '' && x != null).join('\n'))}</pre></div>` : '';
  $('#view').innerHTML = `<form id="sForm" class="card stack"><h2>${kind === 'negocio' ? 'Información del negocio' : 'Diseño del ticket de venta'}</h2>${inputs}${extra}<button class="btn" type="submit">Guardar</button></form>${prev}`;
  $('#sForm').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements, obj = {updated_at: new Date().toISOString()};
    F.forEach(([k]) => obj[k] = el[k].value.trim() || null);
    if (kind === 'ticket') { obj.ticket_paper = el.ticket_paper.value; obj.ticket_show_rate = el.ticket_show_rate.checked; }
    run(async () => { await q(db.from('settings').update(obj).eq('id', 1)); toast('Guardado'); render(); });
  };
}
