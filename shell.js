// Estructura móvil: navegación, pantalla de inicio y módulos activables (Edición Emprendedores)
const MAIN = ['inicio', 'ventas', 'inventario', 'produccion', 'mas'];
const MAS_CHILDREN = ['compras', 'marketing', 'nomina', 'finanzas', 'contabilidad', 'directorios', 'configuracion', 'apertura'];
const SUB = {};
const NAV_HIST = [];

function go(t, opts = {}) {
  if (typeof closeScanner === 'function') closeScanner();
  if (!canSee(t)) { toast('Esta sección está desactivada. Puedes activarla en Configuración > Módulos.', true); t = 'inicio'; }
  if (!opts.fromBack && tab && tab !== t) {
    if (NAV_HIST[NAV_HIST.length - 1] !== tab) NAV_HIST.push(tab);
    if (NAV_HIST.length > 25) NAV_HIST.shift();
  }
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
    const items = MODS.filter(([k, , , mk]) => (!mk || hasMod(mk)) && canSee(k));
    $('#view').innerHTML = `<h1 class="pt">Más módulos</h1>
      ${items.length ? `<div class="menu" id="masMenu" style="margin-top:.8rem">
        ${items.map(([k, t, d]) => `<button data-go="${k}"><b>${t}</b><small>${d}</small></button>`).join('')}
      </div>` : ''}
      <div class="card stack" style="margin-top:.9rem">
        <p class="mut" style="margin:0">Estás en <b>Modo Empleado</b>. Para acceder a configuración o funciones restringidas, ingresa el PIN del dueño.</p>
        <button type="button" class="btn" id="mStaffUnlock">Desbloquear Modo Dueño (PIN)</button>
      </div>`;
    if ($('#masMenu')) {
      $('#masMenu').addEventListener('click', (e) => {
        const b = e.target.closest('[data-go]');
        if (b && b.dataset.go === 'directorios') { SUB.dir = 'menu'; if (typeof DIR_STATE !== 'undefined') DIR_STATE.hubQ = ''; }
      }, true);
    }
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
  if (S.role === 'vendedor' && !staffCan('inventario_full')) {
    await viewConsultaPrecios();
    return;
  }
  if (!hasMod('inventory')) {
    await viewProductos2();
    return;
  }
  const subs = {stock: 'Existencias', productos: 'Productos', combos: 'Combos', precios: 'Precios', catalogo: 'Catálogo', ajuste: 'Ajuste masivo'};
  const fns = {stock: viewInventario2, productos: viewProductos2, combos: viewCombos, precios: viewPreciosMasivo, catalogo: viewCatalogo, ajuste: viewAjusteMasivo};
  if (!hasMod('catalog')) delete subs.catalogo;
  await withSubs('inv', subs, fns)();
}, false);

views.compras = page('Compras', withSubs('com', {nueva: 'Nueva compra', sugerida: 'Reposición sugerida', historial: 'Historial', pagar: 'Por pagar'}, {nueva: viewCompra, sugerida: viewSugerida, historial: viewHistCompras, pagar: viewDeudasProv}));

views.ventas = page('Ventas', async () => {
  const subs = {nueva: 'Nueva venta', cotizaciones: 'Cotizaciones', historial: 'Historial', devoluciones: 'Devoluciones', cobrar: 'Por cobrar'};
  const fns = {nueva: viewVenta, cotizaciones: viewCotizaciones, historial: viewHistVentas, devoluciones: viewDevoluciones, cobrar: viewDeudas};
  if (!hasMod('quotes')) delete subs.cotizaciones;
  if (S.role === 'vendedor' && !staffCan('anular_corregir')) delete subs.devoluciones;
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
views.finanzas = page('Finanzas', async () => {
  const subs = {};
  const fns = {};
  if (staffCan('finanzas_cuentas')) { subs.cuentas = 'Cuentas'; fns.cuentas = viewCuentas; }
  if (staffCan('finanzas_gastos') || staffCan('finanzas_cuentas')) {
    subs.cierre = 'Cierre de caja'; fns.cierre = viewCierreCaja;
    subs.gastos = 'Gastos'; fns.gastos = viewGastos;
  }
  await withSubs('fin', subs, fns)();
});
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

// ---------- Botón "Atrás" del teléfono / navegador (evita cerrar la app por accidente) ----------
(function initBackNavigation() {
  if (typeof window === 'undefined' || !window.history || !history.pushState) return;
  let lastExitTap = 0;
  let allowingExit = false;

  const armGuard = () => {
    try { history.pushState({gdnGuard: 1}, ''); } catch (e) {}
  };

  try {
    history.replaceState({gdnBase: 1}, '');
    armGuard();
  } catch (e) {}

  window.addEventListener('popstate', () => {
    if (allowingExit) return;

    // 1. Si el escáner de cámara está abierto, cerrarlo primero
    const scanM = document.querySelector('#scanModal');
    if (scanM && !scanM.classList.contains('hidden')) {
      if (typeof closeScanner === 'function') closeScanner();
      armGuard();
      return;
    }

    // 2. Si hay una hoja deslizable / modal abierta, cerrarla
    const sh = document.querySelector('#sheet');
    if (sh && !sh.classList.contains('hidden')) {
      closeSheet();
      armGuard();
      return;
    }

    // 3. Si estamos en el asistente de bienvenida, volver al paso anterior
    const ob = document.querySelector('#onboarding');
    if (ob && !ob.classList.contains('hidden')) {
      const prevBtn = ob.querySelector('#obPrev');
      if (prevBtn) { prevBtn.click(); armGuard(); return; }
      armGuard();
      return;
    }

    // 4. Si estamos dentro de una subsección de Configuración o Directorios, volver a su menú
    if (tab === 'configuracion' && SUB.cfg && SUB.cfg !== 'menu') {
      SUB.cfg = 'menu';
      armGuard();
      render();
      return;
    }
    if (tab === 'directorios' && SUB.dir && SUB.dir !== 'menu') {
      SUB.dir = 'menu';
      if (typeof DIR_STATE !== 'undefined') DIR_STATE.q = '';
      armGuard();
      render();
      return;
    }

    // 5. Si estamos en un submódulo de "Más", volver a "Más"
    if (MAS_CHILDREN.includes(tab)) {
      armGuard();
      go('mas', {fromBack: true});
      return;
    }

    // 6. Si no estamos en Inicio, regresar a la pestaña anterior o a Inicio
    if (tab !== 'inicio') {
      let prev = 'inicio';
      while (NAV_HIST.length) {
        const cand = NAV_HIST.pop();
        if (cand && cand !== tab && canSee(cand)) { prev = cand; break; }
      }
      armGuard();
      go(prev, {fromBack: true});
      return;
    }

    // 7. Ya estamos en Inicio: pedir doble toque para salir de la app
    const now = Date.now();
    if (now - lastExitTap < 2200) {
      allowingExit = true;
      history.back();
      return;
    }
    lastExitTap = now;
    armGuard();
    if (typeof toast === 'function') toast('Toca Atrás nuevamente para salir');
  });
})();

// ---------- Buscador Global Instantáneo (Productos, Clientes/Proveedores y Ventas) ----------
async function openGlobalSearch() {
  const [prods, stockRows, parties, debts, sales] = await Promise.all([
    q(db.from('products').select('id,sku,name,unit,sale_price_usd,avg_cost_usd,is_service,track_inventory,product_categories(name)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock')),
    q(db.from('parties').select('*').eq('active', true).order('name')),
    q(db.from('deudas_clientes').select('customer_id,debt_usd')).catch(() => []),
    q(db.from('ventas_resumen').select('id,sale_date,customer,total_usd,paid_usd,status').order('id', {ascending: false}).limit(80))
  ]);
  const stMap = Object.fromEntries(stockRows.map(s => [s.product_id, Number(s.stock || 0)]));
  const debtMap = Object.fromEntries(debts.filter(d => d.customer_id != null).map(d => [d.customer_id, Number(d.debt_usd || 0)]));
  const canEditInv = S.role !== 'vendedor' || staffCan('inventario_full');
  const canDir = S.role !== 'vendedor' || staffCan('directorios');

  openSheet('Buscador rápido', `
    <div class="stack">
      <div class="scan-row">
        <input id="gsIn" type="search" placeholder="Busca producto, cliente o #venta..." autocomplete="off" autofocus>
        <button type="button" class="icon-btn scan-btn" id="gsScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button>
      </div>
      <div id="gsRes" class="stack" style="gap:.65rem;max-height:62vh;overflow:auto"></div>
    </div>`);

  const draw = () => {
    const raw = ($('#gsIn')?.value || '').trim();
    const t = raw.toLowerCase();
    const cleanNum = raw.replace(/^#/, '');
    if (!t) {
      $('#gsRes').innerHTML = `<p class="mut" style="margin:0">Escribe el nombre o código de un <b>producto</b>, un <b>cliente/proveedor</b> o un <b>número de venta</b> (ej: #12). También puedes escanear un código de barras.</p>`;
      return;
    }

    const hitP = prods.filter(p => (p.name + ' ' + (p.sku || '') + ' ' + (p.product_categories?.name || '')).toLowerCase().includes(t)).slice(0, 6);
    const hitC = canDir ? parties.filter(p => (p.name + ' ' + (p.phone || '') + ' ' + (p.rif || '')).toLowerCase().includes(t)).slice(0, 5) : [];
    const hitS = sales.filter(s => (String(s.id) === cleanNum) || (`#${s.id} ${s.customer || ''}`).toLowerCase().includes(t)).slice(0, 4);

    let html = '';
    if (hitP.length) {
      html += `<div class="stack" style="gap:.35rem"><small class="mut"><b>PRODUCTOS (${hitP.length})</b></small>${hitP.map(p => {
        const st = stMap[p.id] || 0;
        const stTxt = p.is_service ? 'Servicio' : p.track_inventory === false ? 'Disponible' : `Stock: ${qty(st)} ${esc(p.unit)}`;
        return `<div class="item" style="gap:.5rem">
          <button type="button" class="lnk" data-gsp="${p.id}" style="flex:1;text-align:left;padding:0;color:var(--ink);font-weight:400">
            <b>${esc(p.name)}</b>
            <small style="display:block;color:var(--mut)">${p.sku ? esc(p.sku) + ' · ' : ''}${stTxt} · <b>${fmtCur(p.sale_price_usd)}</b>${S.bimoneda !== false && S.rate ? ' (' + fmtSec(p.sale_price_usd * S.rate) + ')' : ''}</small>
          </button>
          <button type="button" class="btn ghost" data-gssell="${p.id}" style="min-height:36px;padding:.25rem .65rem;font-size:.82rem">+ Vender</button>
        </div>`;
      }).join('')}</div>`;
    }
    if (hitC.length) {
      html += `<div class="stack" style="gap:.35rem"><small class="mut"><b>CLIENTES Y PROVEEDORES (${hitC.length})</b></small>${hitC.map(c => {
        const d = debtMap[c.id] || 0;
        return `<button type="button" class="item" data-gsc="${c.id}">
          <span><b>${esc(c.name)}</b><small>${[c.is_customer && 'Cliente', c.is_supplier && 'Proveedor', c.phone].filter(Boolean).map(esc).join(' · ')}</small></span>
          ${d > 0.01 ? `<span class="n"><b class="warn">Debe ${fmtCur(d)}</b></span>` : '<span class="mut">&rsaquo;</span>'}
        </button>`;
      }).join('')}</div>`;
    }
    if (hitS.length) {
      html += `<div class="stack" style="gap:.35rem"><small class="mut"><b>VENTAS (${hitS.length})</b></small>${hitS.map(s => `<button type="button" class="item" data-gss="${s.id}">
        <span><b>Venta #${s.id} · ${esc(s.customer || 'Cliente general')}</b><small>${dmy(s.sale_date)} · ${s.status}</small></span>
        <span class="n"><b>${fmtCur(s.total_usd)}</b></span>
      </button>`).join('')}</div>`;
    }
    $('#gsRes').innerHTML = html || '<p class="mut" style="margin:0">Sin resultados para "' + esc(raw) + '".</p>';
  };
  draw();

  $('#gsIn').oninput = draw;
  $('#gsScan').onclick = () => openScanner({
    title: 'Buscar producto por código',
    continuous: false,
    onCode: (code) => {
      const hit = findBySku(prods, code);
      $('#gsIn').value = hit ? (hit.sku || hit.name) : code;
      draw();
      return hit ? {ok: true, msg: `${hit.name} — ${fmtCur(hit.sale_price_usd)}`} : {ok: false, msg: 'Sin producto con código ' + code};
    }
  });

  $('#gsRes').onclick = (e) => {
    const sellB = e.target.closest('[data-gssell]');
    if (sellB) {
      V.edit = null;
      V.prePid = +sellB.dataset.gssell;
      SUB.ven = 'nueva';
      closeSheet();
      go('ventas');
      return;
    }
    const pB = e.target.closest('[data-gsp]');
    if (pB) {
      const p = prods.find(x => String(x.id) === pB.dataset.gsp);
      if (!p) return;
      if (canEditInv) {
        PR2.q = p.name; SUB.inv = 'productos'; closeSheet(); go('inventario');
      } else {
        toast(`${p.name}: ${fmtCur(p.sale_price_usd)}${S.bimoneda !== false && S.rate ? ' (' + fmtSec(p.sale_price_usd * S.rate) + ')' : ''}`);
      }
      return;
    }
    const cB = e.target.closest('[data-gsc]');
    if (cB) {
      const c = parties.find(x => String(x.id) === cB.dataset.gsc);
      if (c && typeof partySheet === 'function') run(() => partySheet(c, DIRS.terceros));
      return;
    }
    const sB = e.target.closest('[data-gss]');
    if (sB && typeof saleSheet === 'function') run(() => saleSheet(+sB.dataset.gss));
  };
}
if ($('#globalSearchBtn')) $('#globalSearchBtn').onclick = () => run(openGlobalSearch);
