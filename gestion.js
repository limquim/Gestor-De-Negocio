// Gestión: ajuste masivo de inventario, reposición sugerida y respaldo de datos
const AJ = {mode: 'conteo', vals: {}, cat: 'all', q: '', fin: 'none', reason: '', note: '', acc: '', etype: ''};

// ---------- Ajuste masivo de inventario: conteo real, ingreso o salida ----------
const AJMODE = {conteo: ['Conteo real', 'Real', 'Escribe la cantidad real que contaste. Lo que dejes vacío no cambia.'], ingreso: ['Ingreso', 'Entra', 'Escribe cuánto entra de cada producto.'], salida: ['Salida', 'Sale', 'Escribe cuánto sale de cada producto.']};
const AJREASON = {conteo: ['Conteo físico', 'Carga inicial'], ingreso: ['Ingreso de mercancía', 'Donación o muestra recibida', 'Corrección de error'], salida: ['Merma o pérdida', 'Uso interno', 'Muestra o regalo', 'Corrección de error']};
async function viewAjusteMasivo() {
  const [rows, types, accs] = await Promise.all([
    q(db.from('stock_actual').select('product_id,sku,name,category_id,category,unit,stock,avg_cost_usd').order('name')),
    q(db.from('expense_types').select('id,name').eq('active', true).order('name')),
    q(db.from('accounts').select('id,name,currency').eq('active', true).order('id'))
  ]);
  const cats = [...new Map(rows.filter(x => x.category_id).map(x => [String(x.category_id), x.category])).entries()], m = AJ.mode, rs = AJREASON[m];
  if (!rs.includes(AJ.reason)) AJ.reason = rs[0];
  const finOpts = m === 'ingreso' ? {none: 'No afecta las finanzas', pago: 'Sí: lo pagué desde una cuenta'} : {none: 'No afecta las finanzas', gasto: 'Sí: registrar como pérdida (gasto) por su costo'};
  if (!finOpts[AJ.fin]) AJ.fin = 'none';
  if (!AJ.etype) AJ.etype = String(types.find(t => t.name === 'Pérdida de inventario')?.id || '');
  if (!AJ.acc && accs[0]) AJ.acc = String(accs[0].id);
  const delta = (r) => { const v = AJ.vals[r.product_id]; if (v === undefined || v === '') return 0; const n = num(v); return m === 'conteo' ? n - +r.stock : m === 'ingreso' ? n : -n; };
  const pend = () => rows.filter(r => Math.abs(delta(r)) > 0.0004);
  $('#view').innerHTML = `<div class="card stack"><h2>Ajuste masivo de inventario</h2>
    <div class="chips" id="ajM">${Object.entries(AJMODE).map(([k, v]) => `<button data-m="${k}" class="${k === m ? 'on' : ''}">${v[0]}</button>`).join('')}</div><p class="mut">${AJMODE[m][2]}</p>
    <div class="grid"><label>Motivo<select id="ajR">${rs.map(x => `<option ${x === AJ.reason ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Nota<input id="ajN" value="${esc(AJ.note)}" placeholder="Ej: inventario de octubre"></label></div>
    <label>¿Afecta financieramente?<select id="ajF">${Object.entries(finOpts).map(([k, v]) => `<option value="${k}" ${k === AJ.fin ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    ${AJ.fin === 'gasto' ? `<label>Tipo de gasto<select id="ajT">${types.map(t => `<option value="${t.id}" ${String(t.id) === AJ.etype ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : ''}
    ${AJ.fin === 'pago' ? `<label>Pagado desde<select id="ajA">${acctOpts(accs, AJ.acc)}</select></label>` : ''}
    <input id="ajQ" type="search" placeholder="Buscar producto o código" value="${esc(AJ.q)}">
    <div class="chips" id="ajC"><button data-c="all" class="${AJ.cat === 'all' ? 'on' : ''}">Todos</button>${cats.map(([id, n]) => `<button data-c="${id}" class="${AJ.cat === id ? 'on' : ''}">${esc(n)}</button>`).join('')}</div></div>
    <div class="card"><div class="list" id="ajL"></div></div><div class="card"><div id="ajS"></div></div>
    <div class="row"><button class="btn" id="ajGo">Aplicar</button></div>`;
  const upd = () => {
    document.querySelectorAll('#ajL .item').forEach(l => {
      const r = rows.find(x => String(x.product_id) === l.dataset.pid), d = delta(r), df = l.querySelector('.df');
      if (df) df.textContent = Math.abs(d) < 0.0004 ? '' : `${d > 0 ? 'Entra' : 'Sale'} ${qty(Math.abs(d))} | valor ${fmt(Math.abs(d) * +r.avg_cost_usd)} USD`;
    });
    const P = pend(), ent = P.filter(r => delta(r) > 0), sal = P.filter(r => delta(r) < 0), val = (a) => a.reduce((s, r) => s + Math.abs(delta(r)) * +r.avg_cost_usd, 0);
    $('#ajS').innerHTML = P.length ? `${ent.length ? `Entran ${ent.length} productos por ${fmt(val(ent))} USD.<br>` : ''}${sal.length ? `Salen ${sal.length} productos por ${fmt(val(sal))} USD.${AJ.fin === 'gasto' ? ' <b>Se registrará como gasto.</b>' : ''}<br>` : ''}${AJ.fin === 'pago' && ent.length ? `Se descontarán ${fmt(val(ent))} USD de la cuenta elegida.` : ''}` : '<span class="mut">Aún no hay cambios.</span>';
    $('#ajGo').textContent = `Aplicar (${P.length})`;
  };
  const draw = () => {
    const t = AJ.q.toLowerCase();
    $('#ajL').innerHTML = rows.filter(r => (AJ.cat === 'all' || String(r.category_id) === AJ.cat) && (!t || (r.name + ' ' + (r.sku || '')).toLowerCase().includes(t)))
      .map(r => `<div class="item" data-pid="${r.product_id}"><span style="flex:1"><b>${esc(r.name)}</b><small>Sistema: ${qty(r.stock)} ${esc(r.unit)} | costo ${fmt(r.avg_cost_usd)} USD</small><small class="df"></small></span>
        <label style="width:7.5rem;margin:0">${AJMODE[m][1]}<input data-c="${r.product_id}" type="number" step="0.001" min="0" value="${AJ.vals[r.product_id] ?? ''}"></label></div>`).join('') || '<p class="mut">No hay productos con ese filtro.</p>';
    upd();
  };
  draw();
  $('#ajM').onclick = (e) => { const b = e.target.closest('button'); if (b) { AJ.mode = b.dataset.m; AJ.vals = {}; AJ.fin = 'none'; render(); } };
  $('#ajR').onchange = (e) => { AJ.reason = e.target.value; };
  $('#ajN').oninput = (e) => { AJ.note = e.target.value; };
  $('#ajF').onchange = (e) => { AJ.fin = e.target.value; render(); };
  if ($('#ajT')) $('#ajT').onchange = (e) => { AJ.etype = e.target.value; };
  if ($('#ajA')) $('#ajA').onchange = (e) => { AJ.acc = e.target.value; };
  $('#ajL').addEventListener('input', (e) => { const id = e.target.dataset.c; if (id) { AJ.vals[id] = e.target.value; upd(); } });
  $('#ajQ').oninput = (e) => { AJ.q = e.target.value; draw(); };
  $('#ajC').onclick = (e) => { const b = e.target.closest('button'); if (b) { AJ.cat = b.dataset.c; document.querySelectorAll('#ajC button').forEach(x => x.classList.toggle('on', x === b)); draw(); } };
  $('#ajGo').onclick = () => run(async () => {
    const it = pend().map(r => ({product_id: r.product_id, qty: m === 'conteo' ? num(AJ.vals[r.product_id]) : Math.abs(delta(r))}));
    if (!it.length) throw new Error('No hay cambios que aplicar');
    if (!confirm(`Se aplicarán cambios a ${it.length} productos${AJ.fin !== 'none' ? ' con efecto financiero' : ''}. ¿Continuar?`)) return;
    const res = await q(db.rpc('ajuste_masivo2', {p_items: it, p_mode: m, p_reason: AJ.reason === 'Merma o pérdida' ? 'merma' : 'otro', p_note: AJ.reason + (AJ.note ? ': ' + AJ.note : ''),
      p_fin: AJ.fin, p_account_id: AJ.fin === 'pago' ? +AJ.acc : null, p_expense_type_id: AJ.fin === 'gasto' ? +AJ.etype || null : null}));
    AJ.vals = {}; toast(`${res.n} productos ajustados${+res.perdida_usd && AJ.fin === 'gasto' ? ' | pérdida registrada: ' + fmt(res.perdida_usd) + ' USD' : ''}`); render();
  });
}

// ---------- Reposición sugerida (productos en su mínimo) ----------
async function viewSugerida() {
  const rows = (await q(db.from('stock_actual').select('product_id,name,unit,stock,min_stock,avg_cost_usd').order('name'))).filter(r => +r.min_stock > 0 && +r.stock <= +r.min_stock);
  const sug = (r) => Math.max(Math.ceil(+r.min_stock * 2 - +r.stock), 1);
  $('#view').innerHTML = rows.length ? `<div class="card"><p class="mut">Productos en su mínimo o por debajo. Ajusta las cantidades y llévalos a una nueva compra.</p><div class="list">${rows.map(r => `<div class="item">
    <label class="chk" style="flex:1"><input type="checkbox" data-s="${r.product_id}" checked><span><b>${esc(r.name)}</b><small>Hay ${qty(r.stock)} ${esc(r.unit)} | mínimo ${qty(r.min_stock)} | costo ${fmt(r.avg_cost_usd)} USD</small></span></label>
    <label style="width:6.5rem;margin:0">Comprar<input data-q="${r.product_id}" type="number" step="0.001" min="0" value="${sug(r)}"></label></div>`).join('')}</div></div>
    <div class="row"><button class="btn" id="sgGo">Pasar a una nueva compra</button></div>` : '<p class="mut">Todo está por encima de su mínimo. Define el stock mínimo de tus productos para recibir sugerencias de compra.</p>';
  if (!rows.length) return;
  $('#sgGo').onclick = () => {
    const pre = rows.filter(r => document.querySelector(`[data-s="${r.product_id}"]`).checked).map(r => ({pid: r.product_id, qty: num(document.querySelector(`[data-q="${r.product_id}"]`).value) || 0})).filter(x => x.qty > 0);
    if (!pre.length) return toast('Selecciona al menos un producto', true);
    CV.pre = pre; SUB.com = 'nueva'; render();
  };
}

// ---------- Respaldo de datos ----------
async function descargarRespaldo() {
  const T = ['settings', 'products', 'product_categories', 'units', 'taxes', 'parties', 'accounts', 'account_movements', 'payments', 'sales', 'sale_items', 'sale_returns', 'sale_return_items', 'purchases', 'purchase_items',
    'inventory_movements', 'recipes', 'recipe_items', 'production_orders', 'production_items', 'expenses', 'expense_types', 'quotes', 'quote_items', 'price_lists', 'payment_methods', 'message_templates', 'exchange_rates',
    'employees', 'employee_advances', 'payroll_runs', 'payroll_items'];
  const all = async (t) => { let r = [], f = 0; for (;;) { const d = await q(db.from(t).select('*').range(f, f + 999)); r = r.concat(d); if (d.length < 1000) return r; f += 1000; } };
  const out = {fecha: new Date().toISOString(), tablas: {}};
  toast('Preparando el respaldo...');
  for (const t of T) { try { out.tablas[t] = await all(t); } catch (e) { out.tablas[t] = 'no disponible'; } }
  downloadBlob(new Blob([JSON.stringify(out)], {type: 'application/json'}), 'respaldo_' + caracasDate() + '.json'); toast('Respaldo descargado');
}
async function viewRespaldo() {
  $('#view').innerHTML = `<div class="card stack"><h2>Respaldo de tus datos</h2><p class="mut">Descarga una copia de toda tu información (productos, ventas, compras, cuentas, clientes, producción, nómina, etc.) en un archivo. Guárdala en un lugar seguro, por ejemplo una vez por semana.</p>
    <button class="btn" id="bkGo">Descargar respaldo</button></div>`;
  $('#bkGo').onclick = () => run(descargarRespaldo);
}

// ---------- Comenzar desde 0 (con varias confirmaciones de seguridad) ----------
async function viewReinicio() {
  const DESC = {movimientos: '<b>Borra:</b> ventas, cotizaciones, devoluciones, compras, producciones, gastos, nómina, adelantos y todos los movimientos de inventario y de cuentas. Los saldos iniciales de las cuentas quedan en 0 y los costos automáticos se reinician.<br><b>Conserva:</b> productos, fórmulas, clientes, proveedores, empleados, cuentas y configuración.',
    todo: '<b>Borra todo lo anterior y además:</b> productos, fórmulas, clientes, proveedores, empleados, cuentas, tasas guardadas y configuraciones del catálogo.<br><b>Conserva:</b> usuarios, datos del negocio, directorios (unidades, impuestos, categorías, métodos de pago, tipos de gasto) y plantillas. Se recrean las cuentas básicas.'};
  $('#view').innerHTML = `<div class="card stack" id="rsBox"><h2 class="warn">Comenzar desde 0</h2><p>Esta opción borra datos para empezar de nuevo. <b>No se puede deshacer.</b> Solo puede usarla un administrador.</p>
    <label>¿Qué quieres borrar?<select id="rsN"><option value="movimientos">Solo los movimientos</option><option value="todo">Todo</option></select></label><p class="mut" id="rsD">${DESC.movimientos}</p>
    <button class="btn ghost" id="rsBk" type="button">Descargar un respaldo ahora</button>
    <label class="chk"><input type="checkbox" id="rsC1"> Entiendo que se borrará de forma permanente</label>
    <label class="chk"><input type="checkbox" id="rsC2"> Ya descargué un respaldo</label>
    <label>Escribe BORRAR TODO para confirmar<input id="rsT" autocomplete="off"></label>
    <label>Tu contraseña<input id="rsP" type="password" autocomplete="current-password"></label>
    <button class="btn" id="rsGo" style="background:var(--bad);color:#fff" disabled>Borrar y comenzar desde 0</button></div>`;
  const chk = () => { $('#rsGo').disabled = !($('#rsC1').checked && $('#rsC2').checked && $('#rsT').value.trim() === 'BORRAR TODO' && $('#rsP').value.length > 0); };
  $('#rsBox').addEventListener('input', chk); $('#rsBox').addEventListener('change', chk);
  $('#rsN').onchange = (e) => { $('#rsD').innerHTML = DESC[e.target.value]; };
  $('#rsBk').onclick = () => run(descargarRespaldo);
  $('#rsGo').onclick = () => run(async () => {
    const email = (await db.auth.getUser()).data.user?.email, {error} = await db.auth.signInWithPassword({email, password: $('#rsP').value});
    if (error) throw new Error('La contraseña no es correcta');
    if (!confirm('ÚLTIMA ADVERTENCIA: se borrarán los datos seleccionados de forma permanente. ¿Continuar?')) return;
    await q(db.rpc('reiniciar_sistema', {p_nivel: $('#rsN').value, p_frase: $('#rsT').value.trim()}));
    toast('Listo: el sistema quedó en cero'); setTimeout(() => location.reload(), 1200);
  });
}

// ---------- Deuda general de cada cliente (por cobrar) ----------
async function viewDeudas() {
  const rows = await q(db.from('deudas_clientes').select('*').order('debt_usd', {ascending: false})), tot = rows.reduce((a, r) => a + +r.debt_usd, 0);
  $('#view').innerHTML = `<div class="stat warn" style="margin-bottom:1rem"><span>Total por cobrar</span><b>${fmt(tot)} USD</b><span>${S.rate ? fmt(tot * S.rate) + ' Bs a la tasa de hoy | ' : ''}${rows.length} ${rows.length === 1 ? 'cliente' : 'clientes'}</span></div>
    <div class="list" id="dcL">${rows.map((r, i) => `<button class="item" data-i="${i}"><span><b>${esc(r.customer)}</b><small>${r.num_ventas} ${r.num_ventas === 1 ? 'venta pendiente' : 'ventas pendientes'} | desde hace ${diasDesde(r.desde)} días</small></span>
      <span class="n"><b>${fmt(r.debt_usd)} USD</b><small>${S.rate ? fmt(r.debt_usd * S.rate) + ' Bs hoy' : ''}</small></span></button>`).join('') || '<p class="mut">Nadie te debe nada.</p>'}</div>`;
  $('#dcL').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) run(() => debtSheet(rows[+b.dataset.i])); };
}
async function debtSheet(c) {
  let qb = db.from('ventas_resumen').select('id,sale_date,total_usd,paid_usd,due_date').eq('status', 'pendiente').order('sale_date').order('id');
  qb = c.customer_id === null ? qb.is('customer_id', null) : qb.eq('customer_id', c.customer_id);
  const [sales, accs] = await Promise.all([q(qb), q(db.from('accounts').select('id,name,currency,methods').eq('active', true).order('id'))]);
  const hoy = caracasDate(), bal = (s) => s.total_usd - s.paid_usd, total = sales.reduce((a, s) => a + bal(s), 0);
  openSheet(esc(c.customer), `<form id="dcF" class="stack"><p><b>Deuda total: ${fmt(total)} USD</b>${S.rate ? ' (' + fmt(total * S.rate) + ' Bs a la tasa de hoy)' : ''}</p>
    <p class="mut">Marca las ventas que quieres pagar. Si el monto no alcanza para todas, se pagan completas las más antiguas y la siguiente queda con un abono y lo que falta abierto.</p>
    <div class="list" id="dcS">${sales.map(s => `<div class="item"><label class="chk" style="flex:1"><input type="checkbox" data-s="${s.id}" checked><span><b>Venta #${s.id}</b>
      <small>${s.sale_date}${s.due_date && s.due_date < hoy ? ' | vencida' : ''} | debe ${fmt(bal(s))} USD</small><small class="al" style="display:block"></small></span></label></div>`).join('')}</div>
    <label>Cuenta<select name="acc">${acctOpts(accs)}</select></label>
    <label>Tasa de cambio (Bs por USD)<input name="rate" type="number" step="0.0001" min="0.0001" value="${S.rate || ''}"></label>
    <label>Método<select name="method"></select></label>
    <label>Monto a cobrar<input name="amount" type="number" step="0.01" min="0.01" required></label><p class="mut" id="dcSum"></p>
    <label>Referencia<input name="ref"></label>
    <div class="row"><button class="btn" type="submit" id="dcGo">Registrar cobro</button>${c.phone ? '<button class="btn ghost" type="button" id="dcWa">Recordar por WhatsApp</button>' : ''}</div></form>`);
  const el = $('#dcF').elements, cur = () => accs.find(a => String(a.id) === el.acc.value).currency, factor = () => cur() === 'USD' ? 1 : (+el.rate.value || 0);
  const chosen = (s) => document.querySelector(`[data-s="${s.id}"]`).checked, selDebt = () => sales.filter(chosen).reduce((a, s) => a + bal(s), 0);
  const alloc = () => { let rem = (num(el.amount.value) || 0) / (factor() || 1); return sales.map(s => { if (!chosen(s)) return {s, a: 0, st: ''}; const a = Math.min(bal(s), Math.max(rem, 0)); rem -= a; return {s, a, st: a >= bal(s) - 0.01 ? 'full' : a > 0.004 ? 'part' : 'none'}; }); };
  const paint = () => {
    const al = alloc(), usd = al.reduce((x, y) => x + y.a, 0), sel = selDebt(), over = (num(el.amount.value) || 0) / (factor() || 1) - sel;
    al.forEach(x => { const l = document.querySelector(`[data-s="${x.s.id}"]`).closest('.item').querySelector('.al'); l.className = 'al ' + (x.st === 'full' ? 'in' : x.st === 'part' ? 'warn' : 'mut'); l.style.display = 'block';
      l.textContent = x.st === 'full' ? 'Se paga completa' : x.st === 'part' ? `Abono de ${fmt(x.a)} USD: queda abierta debiendo ${fmt(bal(x.s) - x.a)} USD` : x.st === 'none' ? 'No alcanza: queda pendiente' : ''; });
    $('#dcSum').textContent = over > 0.02 ? `El monto supera la deuda de las ventas elegidas por ${fmt(over)} USD.` : `Cobrarás ${fmt(usd)} USD. Quedan pendientes ${fmt(Math.max(sel - usd, 0))} USD de las ventas elegidas.`;
  };
  const fillM = () => { el.method.innerHTML = optList(accMethods(accs.find(a => String(a.id) === el.acc.value))); };
  let pf = factor();
  const fill = () => { pf = factor(); el.amount.value = (selDebt() * pf).toFixed(2); paint(); };
  const conv = () => { const nf = factor(), usd = pf ? (num(el.amount.value) || 0) / pf : selDebt(); pf = nf; el.amount.value = (usd * nf).toFixed(2); paint(); };   // al cambiar tasa o cuenta se conserva el valor en USD
  fillM(); fill();
  $('#dcS').addEventListener('change', fill); el.acc.onchange = () => { fillM(); conv(); }; el.rate.oninput = conv; el.amount.oninput = paint;
  $('#dcF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const ids = sales.filter(chosen).map(s => s.id); if (!ids.length) throw new Error('Marca al menos una venta');
      const res = await q(db.rpc('cobrar_ventas', {p_sale_ids: ids, p_account_id: +el.acc.value, p_method: el.method.value, p_amount: num(el.amount.value), p_reference: el.ref.value.trim() || null, p_rate: +el.rate.value || null}));
      closeSheet(); toast(`Cobro registrado: ${res.pagadas} ${res.pagadas === 1 ? 'venta pagada completa' : 'ventas pagadas completas'}${res.abonadas ? ' y 1 con abono (queda abierta)' : ''}. Pendiente: ${fmt(res.pendiente_usd)} USD`); render();
    });
  };
  if (c.phone) $('#dcWa').onclick = () => window.open(waLink(c, `Hola ${(c.customer || '').split(' ')[0]}, te recordamos que tienes un saldo pendiente de ${fmt(total)} USD${S.rate ? ' (' + fmt(total * S.rate) + ' Bs a la tasa de hoy)' : ''}. Gracias por tu atención.`), '_blank');
}

// ---------- Módulos opcionales (se activan en Configuración > Negocio) ----------
async function loadFlags() {
  try { const s = await q(db.from('settings').select('enable_planning,enable_payroll').eq('id', 1).single()); S.flags = {planning: s.enable_planning !== false, payroll: s.enable_payroll !== false}; }
  catch (e) { S.flags = {planning: true, payroll: true}; }
}
