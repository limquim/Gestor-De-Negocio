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

const ico = (d) => `<svg class="ic" viewBox="0 0 24 24">${d}</svg>`;
views.inicio = async () => {
  const hoy = caracasDate();
  const [stock, hoyV, pend] = await Promise.all([
    q(db.from('stock_actual').select('bajo_minimo,valor_usd')),
    q(db.from('ventas_resumen').select('total_usd,exchange_rate').eq('sale_date', hoy).neq('status', 'anulada')),
    q(db.from('ventas_resumen').select('total_usd,paid_usd').eq('status', 'pendiente'))
  ]);
  const vendido = hoyV.reduce((a, r) => a + +r.total_usd, 0), vendidoBs = hoyV.reduce((a, r) => a + r.total_usd * r.exchange_rate, 0);
  const cobrar = pend.reduce((a, r) => a + (r.total_usd - r.paid_usd), 0), valor = stock.reduce((a, x) => a + Number(x.valor_usd || 0), 0);
  const [alertHtml, cajaHtml] = await Promise.all([alertasHtml(), cajaStat()]);
  $('#view').innerHTML = `<div class="tiles">
    <button class="tile main" data-go="ventas">${ico('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>')}<span>Vender</span><small>Nueva venta</small></button>
    <button class="tile" data-go="compras">${ico('<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 016 0"/>')}<span>Comprar</span><small>Registrar compra</small></button>
    <button class="tile" data-go="produccion">${ico('<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2h12.4a1.5 1.5 0 001.3-2L14 9V3"/><path d="M7.5 15h9"/>')}<span>Producir</span><small>Fabricar productos</small></button>
    <button class="tile" data-go="inventario">${ico('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>')}<span>Inventario</span><small>Existencias</small></button></div>
    ${alertHtml}<h2 class="sec">Resumen de hoy</h2>
    <div class="stats">
      <div class="stat"><span>Vendido hoy</span><b>${fmt(vendido)} USD</b><span>${fmt(vendidoBs)} Bs | ${hoyV.length} ${hoyV.length === 1 ? 'venta' : 'ventas'}</span></div>
      <button class="stat warn" id="stPend"><span>Por cobrar</span><b>${fmt(cobrar)} USD</b><span>${pend.length} ${pend.length === 1 ? 'venta pendiente' : 'ventas pendientes'}</span></button>
      ${cajaHtml}<div class="stat"><span>Valor del inventario</span><b>${fmt(valor)} USD</b><span>${S.rate ? fmt(valor * S.rate) + ' Bs' : ''}</span></div>
      <button class="stat bad" data-go="inventario"><span>Por reponer</span><b>${stock.filter(x => x.bajo_minimo).length}</b><span>en el mínimo o agotados</span></button></div>
    <p class="mut">Tasa del día: ${S.rate ? fmt(S.rate, 2) + ' Bs por USD' : 'sin tasa, configúrala en Más > Configuración'}</p>`;
  $('#stPend').onclick = () => { VH.f = 'pend'; SUB.ven = 'historial'; go('ventas'); };
};

const MODS = [['compras', 'Compras', 'Proveedores y entrada de mercancía'], ['marketing', 'Marketing', 'Clientes, ofertas y WhatsApp'],
  ['finanzas', 'Finanzas', 'Cajas, cuentas y gastos'], ['contabilidad', 'Reportes', 'Rentabilidad, caja y resultados'],
  ['directorios', 'Directorios', 'Clientes, proveedores, unidades e impuestos'], ['configuracion', 'Configuración', 'Tasa, negocio y ticket']];
views.mas = async () => {
  $('#view').innerHTML = `<h1 class="pt">Más módulos</h1><div class="menu" style="margin-top:.8rem">${MODS.map(([k, t, d]) => `<button data-go="${k}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
    <div class="row"><button class="btn ghost" id="mOut">Cerrar sesión</button></div>`;
  $('#mOut').onclick = () => db.auth.signOut();
};

views.inventario = page('Inventario', withSubs('inv', {stock: 'Existencias', productos: 'Productos'}, {stock: viewInventario2, productos: viewProductos2}), false);
views.compras = page('Compras', views.compras);
views.ventas = page('Ventas', withSubs('ven', {nueva: 'Nueva venta', cotizaciones: 'Cotizaciones', historial: 'Historial'}, {nueva: viewVenta, cotizaciones: viewCotizaciones, historial: viewHistVentas}), false);
views.produccion = page('Producciones', withSubs('prod', {producir: 'Producir', formulas: 'Fórmulas', historial: 'Historial'}, {producir: viewProducir, formulas: viewFormulas, historial: viewHistorialProd}), false);
views.marketing = page('Marketing', viewMarketing);
views.finanzas = page('Finanzas', withSubs('fin', {cuentas: 'Cuentas', gastos: 'Gastos'}, {cuentas: viewCuentas, gastos: viewGastos}));
views.contabilidad = page('Reportes', viewReportes);
views.directorios = page('Directorios', withSubs('dir', DIR_LABELS, Object.fromEntries(Object.keys(DIRS).map(k => [k, () => viewDir(k)]))));
views.configuracion = page('Configuración', withSubs('cfg', {tasa: 'Tasa', negocio: 'Negocio', ticket: 'Ticket'},
  {tasa: viewTasa, negocio: () => viewSettings('negocio'), ticket: () => viewSettings('ticket')}));

// Fondo claro / oscuro (se recuerda la elección)
const SUN = '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg class="ic" viewBox="0 0 24 24"><path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/></svg>';
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const paintTheme = () => { $('#themeBtn').innerHTML = isDark() ? SUN : MOON; $('#themeBtn').title = isDark() ? 'Cambiar a fondo claro' : 'Cambiar a fondo oscuro'; };
$('#themeBtn').onclick = () => {
  const n = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = n;
  try { localStorage.setItem('tema', n); } catch (e) {}
  paintTheme();
};
paintTheme();
