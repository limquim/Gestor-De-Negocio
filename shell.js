// Estructura móvil: navegación, pantalla de inicio y módulos activables (Edición Emprendedores)
const MAIN = ['inicio', 'ventas', 'inventario', 'produccion', 'mas'];
const SUB = {};

function go(t) {
  if (typeof closeScanner === 'function') closeScanner();
  if (!canSee(t)) { toast('Esta sección está desactivada. Puedes activarla en Configuración > Módulos.', true); t = 'inicio'; }
  tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === (MAIN.includes(t) ? t : 'mas')));
  window.scrollTo(0, 0); render();
}
document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

function openSheet(title, html) {
  let s = $('#sheet');
  if (!s) { s = document.createElement('div'); s.id = 'sheet'; document.body.appendChild(s); }
  s.innerHTML = `<div class="sheet-bg" data-close="1"></div><div class="sheet-box"><div class="title-row"><h2>${title}</h2><button class="lnk" data-close="1">Cerrar</button></div>${html}</div>`;
  s.classList.remove('hidden');
  s.onclick = (e) => { if (e.target.dataset.close) closeSheet(); };
}
function closeSheet() { $('#sheet')?.classList.add('hidden'); }

const withSubs = (key, opts, fns) => async () => {
  const cur = SUB[key] && opts[SUB[key]] ? SUB[key] : Object.keys(opts)[0];
  await fns[cur]();
  $('#view').insertAdjacentHTML('afterbegin', `<div class="chips sub" id="subChips">${Object.entries(opts).map(([k, v]) => `<button data-s="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('')}</div>`);
  $('#subChips').onclick = (e) => { const b = e.target.closest('button'); if (b) { SUB[key] = b.dataset.s; render(); } };
};
const page = (title, fn, back = true) => async () => {
  await fn();
  $('#view').insertAdjacentHTML('afterbegin', `<div class="title-row" style="margin-bottom:.8rem"><h1 class="pt">${title}</h1>${back ? '<button class="lnk" data-go="mas">Volver a Más</button>' : ''}</div>`);
};

views.inicio = () => viewInicio();
views.apertura = page('Saldos iniciales (Arranque)', viewApertura);

const MODS = [
  ['compras', 'Compras', 'Proveedores y entrada de mercancía', 'purchases'],
  ['marketing', 'Marketing', 'Clientes, ofertas y WhatsApp', 'marketing'],
  ['nomina', 'Nómina', 'Empleados, adelantos y pagos', 'payroll'],
  ['finanzas', 'Finanzas', 'Cajas, cuentas y gastos', null],
  ['contabilidad', 'Reportes', 'Rentabilidad, caja y resultados', null],
  ['directorios', 'Directorios', 'Clientes, proveedores, unidades e impuestos', null],
  ['configuracion', 'Configuración', 'Módulos, tasa, negocio, respaldo y metas', null]
];
views.mas = async () => {
  if (S.role === 'vendedor') {
    $('#view').innerHTML = `<h1 class="pt">Modo Empleado</h1>
      <div class="card stack" style="margin-top:.8rem">
        <p class="mut" style="margin:0">Estás operando en <b>Modo Empleado</b>. Para ver reportes, cuentas, compras, costos o configuración, desbloquea con el PIN del dueño.</p>
        <button type="button" class="btn" id="mStaffUnlock">Desbloquear Modo Dueño (PIN)</button>
      </div>`;
    $('#mStaffUnlock').onclick = () => promptUnlockOwner();
    return;
  }
  const items = MODS.filter(([k, , , mk]) => (!mk || hasMod(mk)) && canSee(k));
  const extraProd = !hasMod('inventory') ? `<button id="mSrvProds"><b>Productos / Servicios</b><small>Catálogo de servicios y precios</small></button>` : '';
  $('#view').innerHTML = `<h1 class="pt">Más módulos</h1>
    <div class="menu" id="masMenu" style="margin-top:.8rem">
      ${extraProd}
      ${items.map(([k, t, d]) => `<button data-go="${k}"><b>${t}</b><small>${d}</small></button>`).join('')}
    </div>
    <div class="row">
      <button class="btn ghost" id="mModBtn">Activar / desactivar módulos</button>
      <button class="btn ghost" id="mBkBtn">Respaldo de datos</button>
    </div>`;
  $('#masMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.dataset.go === 'configuracion') SUB.cfg = 'menu';
    if (b.dataset.go === 'directorios') { SUB.dir = 'menu'; if (typeof DIR_STATE !== 'undefined') DIR_STATE.hubQ = ''; }
  }, true);
  if ($('#mSrvProds')) $('#mSrvProds').onclick = () => { SUB.inv = 'productos'; go('inventario'); };
  $('#mModBtn').onclick = () => { SUB.cfg = 'modulos'; go('configuracion'); };
  $('#mBkBtn').onclick = () => { SUB.cfg = 'respaldo'; go('configuracion'); };
};

views.inventario = page('Inventario', async () => {
  if (S.role === 'vendedor') {
    await viewConsultaPrecios();
    return;
  }
  if (!hasMod('inventory')) {
    await viewProductos2();
    return;
  }
  const subs = {stock: 'Existencias', productos: 'Productos', precios: 'Precios', catalogo: 'Catálogo', ajuste: 'Ajuste masivo'};
  const fns = {stock: viewInventario2, productos: viewProductos2, precios: viewPreciosMasivo, catalogo: viewCatalogo, ajuste: viewAjusteMasivo};
  if (!hasMod('catalog')) delete subs.catalogo;
  await withSubs('inv', subs, fns)();
}, false);

views.compras = page('Compras', withSubs('com', {nueva: 'Nueva compra', sugerida: 'Reposición sugerida', historial: 'Historial', pagar: 'Por pagar'}, {nueva: viewCompra, sugerida: viewSugerida, historial: viewHistCompras, pagar: viewDeudasProv}));

views.ventas = page('Ventas', async () => {
  const subs = {nueva: 'Nueva venta', cotizaciones: 'Cotizaciones', historial: 'Historial', devoluciones: 'Devoluciones', cobrar: 'Por cobrar'};
  const fns = {nueva: viewVenta, cotizaciones: viewCotizaciones, historial: viewHistVentas, devoluciones: viewDevoluciones, cobrar: viewDeudas};
  if (!hasMod('quotes')) delete subs.cotizaciones;
  if (S.role === 'vendedor') delete subs.devoluciones;
  await withSubs('ven', subs, fns)();
}, false);

views.produccion = page('Producciones', async () => {
  const subs = {producir: 'Producir', formulas: 'Fórmulas', historial: 'Historial'};
  const fns = {producir: viewProducir, formulas: viewFormulas, historial: viewHistorialProd};
  if (hasMod('planning')) { subs.planificar = 'Planificar'; fns.planificar = viewPlanificar; }
  await withSubs('prod', subs, fns)();
}, false);

views.marketing = page('Marketing', viewMarketing);
views.nomina = page('Nómina', withSubs('nom', {pagar: 'Pagar nómina', empleados: 'Empleados', adelantos: 'Adelantos', historial: 'Historial'}, {pagar: viewNomina, empleados: () => viewDir('empleados'), adelantos: viewAdelantos, historial: viewNominaHist}));
views.finanzas = page('Finanzas', withSubs('fin', {cuentas: 'Cuentas', cierre: 'Cierre de caja', gastos: 'Gastos'}, {cuentas: viewCuentas, cierre: viewCierreCaja, gastos: viewGastos}));
views.contabilidad = page('Reportes', viewReportes);
views.directorios = viewDirectorios;
views.configuracion = viewConfiguracion;

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

document.addEventListener('click', (e) => {
  const b = e.target.closest('button.btn'); if (!b) return;
  const t = Date.now(); if (b._t && t - b._t < 2000) { e.stopImmediatePropagation(); e.preventDefault(); return; }
  b._t = t;
}, true);
