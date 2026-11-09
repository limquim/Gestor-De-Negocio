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

views.inicio = viewInicio;

const MODS = [['compras', 'Compras', 'Proveedores y entrada de mercancía'], ['marketing', 'Marketing', 'Clientes, ofertas y WhatsApp'],
  ['nomina', 'Nómina', 'Empleados, adelantos y pagos'], ['finanzas', 'Finanzas', 'Cajas, cuentas y gastos'], ['contabilidad', 'Reportes', 'Rentabilidad, caja y resultados'],
  ['directorios', 'Directorios', 'Clientes, proveedores, unidades e impuestos'], ['configuracion', 'Configuración', 'Tasa, negocio y ticket']];
views.mas = async () => {
  $('#view').innerHTML = `<h1 class="pt">Más módulos</h1><div class="menu" style="margin-top:.8rem">${MODS.filter(m => m[0] !== 'nomina' || S.flags?.payroll !== false).map(([k, t, d]) => `<button data-go="${k}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
    <div class="row"><button class="btn ghost" id="mOut">Cerrar sesión</button></div>`;
  $('#mOut').onclick = () => db.auth.signOut();
};

views.inventario = page('Inventario', withSubs('inv', {stock: 'Existencias', productos: 'Productos', catalogo: 'Catálogo', ajuste: 'Ajuste masivo'}, {stock: viewInventario2, productos: viewProductos2, catalogo: viewCatalogo, ajuste: viewAjusteMasivo}), false);
views.compras = page('Compras', withSubs('com', {nueva: 'Nueva compra', sugerida: 'Reposición sugerida', historial: 'Historial'}, {nueva: viewCompra, sugerida: viewSugerida, historial: viewHistCompras}));
views.ventas = page('Ventas', withSubs('ven', {nueva: 'Nueva venta', cotizaciones: 'Cotizaciones', historial: 'Historial', devoluciones: 'Devoluciones', cobrar: 'Por cobrar'}, {nueva: viewVenta, cotizaciones: viewCotizaciones, historial: viewHistVentas, devoluciones: viewDevoluciones, cobrar: viewDeudas}), false);
views.produccion = page('Producciones', async () => {
  const subs = {producir: 'Producir', formulas: 'Fórmulas', historial: 'Historial'}, fns = {producir: viewProducir, formulas: viewFormulas, historial: viewHistorialProd};
  if (S.flags?.planning !== false) { subs.planificar = 'Planificar'; fns.planificar = viewPlanificar; }
  await withSubs('prod', subs, fns)();
}, false);
views.marketing = page('Marketing', viewMarketing);
views.nomina = page('Nómina', withSubs('nom', {pagar: 'Pagar nómina', empleados: 'Empleados', adelantos: 'Adelantos', historial: 'Historial'}, {pagar: viewNomina, empleados: () => viewDir('empleados'), adelantos: viewAdelantos, historial: viewNominaHist}));
views.finanzas = page('Finanzas', withSubs('fin', {cuentas: 'Cuentas', gastos: 'Gastos'}, {cuentas: viewCuentas, gastos: viewGastos}));
views.contabilidad = page('Reportes', viewReportes);
views.directorios = page('Directorios', withSubs('dir', DIR_LABELS, Object.fromEntries(Object.keys(DIRS).map(k => [k, () => viewDir(k)]))));
views.configuracion = page('Configuración', withSubs('cfg', {tasa: 'Tasa', negocio: 'Negocio', ticket: 'Ticket', respaldo: 'Respaldo', reinicio: 'Comenzar desde 0'},
  {tasa: viewTasa, negocio: () => viewSettings('negocio'), ticket: () => viewSettings('ticket'), respaldo: viewRespaldo, reinicio: viewReinicio}));

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
