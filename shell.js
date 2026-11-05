// Estructura móvil: navegación, pantalla de inicio y organización de módulos
const MAIN = ['inicio', 'ventas', 'inventario', 'produccion', 'mas'];
const SUB = {};

function go(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (MAIN.includes(t) ? t : 'mas')));
  window.scrollTo(0, 0); render();
}
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

// Hoja deslizable inferior (formularios)
function openSheet(title, html) {
  let s = $('#sheet');
  if (!s) { s = document.createElement('div'); s.id = 'sheet'; document.body.appendChild(s); }
  s.innerHTML = `<div class="sheet-bg" data-close="1"></div><div class="sheet-box"><div class="title-row"><h2>${title}</h2><button class="lnk" data-close="1">Cerrar</button></div>${html}</div>`;
  s.classList.remove('hidden');
  s.onclick = (e) => { if (e.target.dataset.close) closeSheet(); };
}
function closeSheet() { $('#sheet')?.classList.add('hidden'); }

// Sub-secciones con chips (se mantienen al recargar)
const withSubs = (key, opts, fns) => async () => {
  const cur = SUB[key] && opts[SUB[key]] ? SUB[key] : Object.keys(opts)[0];
  await fns[cur]();
  $('#view').insertAdjacentHTML('afterbegin', `<div class="chips sub" id="subChips">${Object.entries(opts).map(([k, v]) => `<button data-s="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('')}</div>`);
  $('#subChips').onclick = (e) => { const b = e.target.closest('button'); if (b) { SUB[key] = b.dataset.s; render(); } };
};
// Título de página (con enlace de regreso a "Más" en los módulos secundarios)
const page = (title, fn, back = true) => async () => {
  await fn();
  $('#view').insertAdjacentHTML('afterbegin', `<div class="title-row" style="margin-bottom:.8rem"><h1 class="pt">${title}</h1>${back ? '<button class="lnk" data-go="mas">Volver a Más</button>' : ''}</div>`);
};
const soon = (note, items) => async () => {
  $('#view').innerHTML = `<div class="card"><h2>En construcción</h2><p class="mut">${note}</p><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></div>`;
};

views.inicio = async () => {
  const rows = await q(db.from('stock_actual').select('bajo_minimo,valor_usd'));
  const valor = rows.reduce((a, x) => a + Number(x.valor_usd || 0), 0);
  $('#view').innerHTML = `<h1 class="pt">Resumen</h1>
    <div class="stats" style="margin-top:.8rem">
      <div class="stat"><span>Tasa del día</span><b>${S.rate ? fmt(S.rate, 2) + ' Bs' : 'Sin tasa'}</b><span>por 1 USD</span></div>
      <div class="stat"><span>Valor del inventario</span><b>${fmt(valor)} USD</b><span>${S.rate ? fmt(valor * S.rate) + ' Bs' : ''}</span></div>
      <div class="stat warn"><span>Productos por reponer</span><b>${rows.filter(x => x.bajo_minimo).length}</b></div></div>
    <div class="card"><h2>Acciones rápidas</h2><div class="quick">
      <button class="btn" data-go="ventas">Vender</button><button class="btn" data-go="produccion">Producir</button><button class="btn" data-go="compras">Comprar</button></div></div>`;
};

const MODS = [['compras', 'Compras', 'Proveedores y entrada de mercancía'], ['marketing', 'Marketing', 'Clientes, ofertas y WhatsApp'],
  ['finanzas', 'Finanzas', 'Cajas, cuentas y gastos'], ['contabilidad', 'Contabilidad', 'Ventas, gastos y rentabilidad'],
  ['directorios', 'Directorios', 'Clientes, proveedores, unidades e impuestos'], ['configuracion', 'Configuración', 'Tasa, negocio y ticket']];
views.mas = async () => {
  $('#view').innerHTML = `<h1 class="pt">Más módulos</h1><div class="menu" style="margin-top:.8rem">${MODS.map(([k, t, d]) => `<button data-go="${k}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
    <div class="row"><button class="btn ghost" id="mOut">Cerrar sesión</button></div>`;
  $('#mOut').onclick = () => db.auth.signOut();
};

views.inventario = page('Inventario', withSubs('inv', {stock: 'Existencias', productos: 'Productos'}, {stock: viewInventario2, productos: viewProductos2}), false);
views.compras = page('Compras', views.compras);
views.ventas = page('Ventas', soon('Aquí irá todo el proceso de venta:', ['Factura con IVA y nota de entrega sin IVA', 'Pago de contado, a crédito y pagos combinados', 'Historial de ventas con corrección posterior', 'Ticket de venta']), false);
views.produccion = page('Producciones', withSubs('prod', {producir: 'Producir', formulas: 'Fórmulas', historial: 'Historial'}, {producir: viewProducir, formulas: viewFormulas, historial: viewHistorialProd}), false);
views.marketing = page('Marketing', soon('Seguimiento de clientes:', ['Qué compra más cada cliente', 'Clientes con tiempo sin comprar', 'Mensajes y ofertas por WhatsApp']));
views.finanzas = page('Finanzas', soon('Control del dinero:', ['Cuentas por moneda (caja, banco, billetera)', 'Cobros, pagos y transferencias', 'Registro de gastos']));
views.contabilidad = page('Contabilidad', soon('Resultados del negocio:', ['Total vendido y total gastado', 'Rentabilidad', 'Gastos fijos y variables']));
views.directorios = page('Directorios', withSubs('dir', DIR_LABELS, Object.fromEntries(Object.keys(DIRS).map(k => [k, () => viewDir(k)]))));
views.configuracion = page('Configuración', withSubs('cfg', {tasa: 'Tasa', negocio: 'Negocio', ticket: 'Ticket'},
  {tasa: viewTasa, negocio: () => viewSettings('negocio'), ticket: () => viewSettings('ticket')}));
