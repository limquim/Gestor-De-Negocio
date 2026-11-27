// Seguridad, Modo Empleado con PIN del dueño y bitácora local (Edición Emprendedores)
const APP_VERSION = 'E3.3';
const ROLE_NAMES = {admin: 'Dueño / Administrador', vendedor: 'Modo Empleado (Vendedor)'};
const PIN_LS = 'gdn_owner_pin_v1';
const STAFF_LS = 'gdn_staff_mode_v1';

function getOwnerPin() {
  try {
    const ls = localStorage.getItem(PIN_LS);
    if (ls) return ls;
  } catch (e) {}
  return (typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.owner_pin) ? String(LDB.mem.settings[0].owner_pin) : '';
}

async function saveOwnerPin(pin) {
  const clean = String(pin || '').replace(/\D/g, '');
  try {
    if (clean) localStorage.setItem(PIN_LS, clean);
    else localStorage.removeItem(PIN_LS);
  } catch (e) {}
  try {
    await q(db.from('settings').update({owner_pin: clean || null, updated_at: new Date().toISOString()}).eq('id', 1));
  } catch (e) {}
}

function setStaffModeFlag(on) {
  try { localStorage.setItem(STAFF_LS, on ? '1' : '0'); } catch (e) {}
  S.role = on ? 'vendedor' : 'admin';
  applyRoleUI();
  LDB.paintBar();
}

const canSee = (m) => {
  if (S.role === 'vendedor') {
    return ['inicio', 'ventas', 'inventario', 'mas'].includes(m);
  }
  if (m === 'inicio' || m === 'mas' || m === 'ventas' || m === 'finanzas' || m === 'contabilidad' || m === 'directorios' || m === 'configuracion' || m === 'apertura') return true;
  if (m === 'inventario') return true;
  if (m === 'compras') return hasMod('purchases');
  if (m === 'produccion') return hasMod('production');
  if (m === 'marketing') return hasMod('marketing');
  if (m === 'nomina') return hasMod('payroll');
  return true;
};

async function loadRole() {
  let staff = false;
  try { staff = localStorage.getItem(STAFF_LS) === '1' && !!getOwnerPin(); } catch (e) {}
  S.role = staff ? 'vendedor' : 'admin';
  try {
    const s = await q(db.from('settings').select('owner_name,owner_pin').eq('id', 1).single());
    S.userName = s?.owner_name || 'Dueño';
    if (s?.owner_pin && !localStorage.getItem(PIN_LS)) {
      try { localStorage.setItem(PIN_LS, String(s.owner_pin)); } catch (e) {}
    }
  } catch (e) {
    S.userName = 'Dueño';
  }
}

const LOCK_OPEN_ICO = '<svg class="ic" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-1.9"/></svg>';
const LOCK_CLOSED_ICO = '<svg class="ic" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';

function applyRoleUI() {
  if (typeof applyModsUI === 'function') applyModsUI();
  const isStaff = S.role === 'vendedor';
  const prodBtn = document.querySelector('#tabs button[data-tab="produccion"]');
  if (prodBtn && isStaff) prodBtn.classList.add('hidden');
  const invSpan = document.querySelector('#tabs button[data-tab="inventario"] span');
  if (invSpan) invSpan.textContent = isStaff ? 'Precios' : 'Inventario';

  const rb = document.querySelector('#roleBtn');
  if (rb) {
    rb.innerHTML = isStaff ? LOCK_CLOSED_ICO : LOCK_OPEN_ICO;
    rb.classList.toggle('on', isStaff);
    rb.title = isStaff ? 'Desbloquear Modo Dueño (PIN)' : 'Activar Modo Empleado';
    rb.setAttribute('aria-label', rb.title);
    rb.onclick = () => isStaff ? promptUnlockOwner() : enterStaffMode();
  }
}

function openPinSetupSheet(activateAfter = false) {
  const hasPin = !!getOwnerPin();
  openSheet(hasPin ? 'Cambiar PIN del dueño' : 'Crear PIN del dueño', `
    <form id="pinSetF" class="stack">
      <p class="mut" style="margin:0">Este PIN de 4 a 6 dígitos protege tus <b>ganancias, costos, cuentas bancarias, reportes y configuración</b> cuando entregas el teléfono a un empleado.</p>
      ${hasPin ? '<label>PIN actual<input name="cur" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required placeholder="****"></label>' : ''}
      <label>Nuevo PIN (4 a 6 números)<input name="pin1" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required placeholder="Ej: 1234"></label>
      <label>Confirmar nuevo PIN<input name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required placeholder="Repite el PIN"></label>
      <button type="submit" class="btn">${activateAfter ? 'Guardar PIN y activar Modo Empleado' : 'Guardar PIN'}</button>
    </form>`);
  $('#pinSetF').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements;
    const cur = getOwnerPin();
    if (cur && el.cur.value.trim() !== cur) return toast('El PIN actual no coincide', true);
    const p1 = el.pin1.value.trim(), p2 = el.pin2.value.trim();
    if (!/^\d{4,6}$/.test(p1)) return toast('El PIN debe tener entre 4 y 6 números', true);
    if (p1 !== p2) return toast('Los PIN no coinciden', true);
    run(async () => {
      await saveOwnerPin(p1);
      closeSheet();
      if (activateAfter) {
        setStaffModeFlag(true);
        toast('Modo Empleado activado. Tus reportes y costos están protegidos.');
        go('inicio');
      } else {
        toast('PIN del dueño guardado');
        render();
      }
    });
  };
}

function enterStaffMode() {
  const pin = getOwnerPin();
  if (!pin) {
    openPinSetupSheet(true);
    return;
  }
  if (!confirm('¿Cambiar a Modo Empleado? Se ocultarán ganancias, costos, caja y reportes hasta ingresar tu PIN de dueño.')) return;
  setStaffModeFlag(true);
  toast('Modo Empleado activado');
  go('inicio');
}

function promptUnlockOwner() {
  openSheet('Desbloquear Modo Dueño', `
    <form id="pinUnlF" class="stack">
      <p class="mut" style="margin:0">Ingresa tu PIN de dueño para acceder a reportes, costos, cuentas y configuración.</p>
      <label>PIN del dueño<input name="pin" type="password" inputmode="numeric" maxlength="6" required autofocus placeholder="****" style="font-size:1.4rem;text-align:center;letter-spacing:.35rem"></label>
      <button type="submit" class="btn">Desbloquear</button>
    </form>`);
  $('#pinUnlF').onsubmit = (e) => {
    e.preventDefault();
    const entered = e.target.elements.pin.value.trim();
    const expected = getOwnerPin();
    if (!expected || entered === expected) {
      closeSheet();
      setStaffModeFlag(false);
      toast('Modo Dueño desbloqueado');
      go('inicio');
    } else {
      toast('PIN incorrecto', true);
      e.target.elements.pin.value = '';
      e.target.elements.pin.focus();
    }
  };
}

async function viewModoEmpleado() {
  const hasPin = !!getOwnerPin();
  const isStaff = S.role === 'vendedor';
  const r = S.rules || {};
  $('#view').innerHTML = `
    <div class="card stack" style="border-left:5px solid var(--pri)">
      <div class="title-row">
        <h2>Modo Empleado con PIN</h2>
        <span class="badge ${hasPin ? 'ok' : ''}">${hasPin ? 'PIN configurado' : 'Sin PIN'}</span>
      </div>
      <p class="mut" style="margin:0">Ideal cuando dejas el teléfono en el mostrador con un vendedor. Al activarlo, solo podrá <b>vender, cotizar, consultar precios y registrar cobros</b>; quedan bloqueados tus costos, ganancias, cuentas bancarias, compras, reportes y configuración.</p>
      <div class="row">
        <button type="button" class="btn" id="meToggle">${isStaff ? 'Desbloquear Modo Dueño' : 'Activar Modo Empleado ahora'}</button>
        <button type="button" class="btn ghost" id="mePin">${hasPin ? 'Cambiar PIN' : 'Configurar PIN'}</button>
      </div>
      ${hasPin && !isStaff ? '<div class="row" style="margin-top:0"><button type="button" class="lnk bad" id="meRmPin" style="padding:0">Quitar PIN</button></div>' : ''}
    </div>

    <div class="card stack">
      <h2>Permisos del vendedor</h2>
      <div class="rl"><span>Modificar precios al vender</span><b>${r.allow_seller_price_edit !== false ? 'Permitido' : 'Bloqueado'}</b></div>
      <div class="rl"><span>Tope de descuento</span><b>${Number(r.max_discount_percent || 0) > 0 ? qty(r.max_discount_percent) + '%' : 'Sin tope'}</b></div>
      <div class="rl"><span>Vender sin stock</span><b>${r.block_negative_stock ? 'Bloqueado' : 'Permitido con aviso'}</b></div>
      <p class="mut" style="margin:0">Puedes ajustar estas reglas en <b>Configuración &gt; Reglas de venta y Metas</b>.</p>
      <div class="row"><button type="button" class="btn ghost" id="meGoRules">Ir a Reglas de venta</button></div>
    </div>`;

  $('#meToggle').onclick = () => isStaff ? promptUnlockOwner() : enterStaffMode();
  $('#mePin').onclick = () => openPinSetupSheet(false);
  if ($('#meRmPin')) {
    $('#meRmPin').onclick = () => run(async () => {
      const cur = prompt('Escribe tu PIN actual para eliminarlo:');
      if (cur === null) return;
      if (cur.trim() !== getOwnerPin()) throw new Error('PIN incorrecto');
      await saveOwnerPin('');
      toast('PIN eliminado');
      render();
    });
  }
  $('#meGoRules').onclick = () => { SUB.cfg = 'reglas'; render(); };
}

// Vista de solo consulta de precios y stock para Modo Empleado (sin costos ni edición)
async function viewConsultaPrecios() {
  const [prods, stockRows] = await Promise.all([
    q(db.from('products').select('id,sku,name,unit,sale_price_usd,is_service,track_inventory,image_url,product_categories(name)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock'))
  ]);
  const stMap = Object.fromEntries(stockRows.map(s => [s.product_id, Number(s.stock || 0)]));
  $('#view').innerHTML = `
    <div class="card stack" style="margin-bottom:.8rem">
      <div class="scan-row">
        <input id="cpSearch" type="search" placeholder="Buscar producto o escanear código para ver precio...">
        <button type="button" class="icon-btn scan-btn" id="cpScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button>
      </div>
    </div>
    <div class="list" id="cpList"></div>`;

  const draw = () => {
    const t = ($('#cpSearch').value || '').trim().toLowerCase();
    const list = prods.filter(p => !t || (p.name + ' ' + (p.sku || '') + ' ' + (p.product_categories?.name || '')).toLowerCase().includes(t));
    $('#cpList').innerHTML = list.map(p => {
      const st = stMap[p.id] || 0;
      const stTxt = p.is_service ? 'Servicio' : p.track_inventory === false ? 'Disponible' : (st > 0 ? `Disp: ${qty(st)} ${esc(p.unit)}` : 'Agotado');
      const stCls = p.is_service || p.track_inventory === false || st > 0 ? 'in' : 'bad';
      return `<div class="item">
        <span style="flex:1">
          <b>${esc(p.name)}</b>
          <small>${esc(p.sku || 'Sin código')} · ${esc(p.product_categories?.name || 'General')} · <span class="${stCls}">${stTxt}</span></small>
        </span>
        <span class="n">
          <b>${fmt(p.sale_price_usd)} USD</b>
          ${S.bimoneda !== false && S.rate ? `<small>${fmt(p.sale_price_usd * S.rate)} Bs</small>` : ''}
        </span>
      </div>`;
    }).join('') || '<p class="mut">No hay productos con esa búsqueda.</p>';
  };
  draw();
  $('#cpSearch').oninput = draw;
  $('#cpScan').onclick = () => openScanner({
    title: 'Consultar precio por código',
    continuous: false,
    onCode: (code) => {
      const hit = findBySku(prods, code);
      $('#cpSearch').value = hit ? (hit.sku || hit.name) : code;
      draw();
      return hit
        ? {ok: true, msg: `${hit.name} — ${fmt(hit.sale_price_usd)} USD`}
        : {ok: false, msg: 'Sin producto con código ' + code};
    }
  });
}

// ---------- Bitácora local ----------
const TBL = {sales: 'la venta', sale_returns: 'la devolución', purchases: 'la compra', expenses: 'el gasto', products: 'el producto', accounts: 'la cuenta', settings: 'la configuración', payroll_runs: 'la nómina', employees: 'el empleado', employee_advances: 'el adelanto', cash_closings: 'el cierre de caja', payment_methods: 'el método de pago', inventory_adjustments: 'el ajuste masivo', recurring_expenses: 'el gasto fijo', parties: 'el contacto'};
const FLD = {status: 'estado', sale_price_usd: 'precio', manual_cost_usd: 'costo manual', name: 'nombre', active: 'activo', total_usd: 'total', business_name: 'nombre del negocio', cost_method: 'método de costo', opening_balance: 'saldo inicial', payment_details: 'datos de pago', is_default: 'cuenta principal', monthly_sales_goal_usd: 'meta mensual', max_discount_percent: 'tope de descuento', block_negative_stock: 'bloquear sin stock', salary_usd: 'sueldo'};
const av = (v) => v === null || v === undefined ? 'vacío' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'number' ? fmt(v) : String(v).slice(0, 30);

function auditText(a) {
  const base = `${TBL[a.table_name] || a.table_name} #${a.row_id}`;
  if (a.action === 'UPDATE' && a.table_name === 'sales' && a.new_data?.status === 'anulada') return `anuló la venta #${a.row_id}`;
  if (a.action === 'UPDATE' && a.table_name === 'purchases' && a.new_data?.status === 'anulada') return `anuló la compra #${a.row_id}`;
  if (a.action === 'UPDATE') return `modificó ${base}: ` + Object.keys(a.new_data || {}).slice(0, 4).map(k => `${FLD[k] || k} de ${av(a.old_data?.[k])} a ${av(a.new_data[k])}`).join(', ');
  return `${a.action === 'INSERT' ? 'creó' : 'eliminó'} ${base}`;
}
const AUD = {t: 'all'};
async function viewBitacora() {
  const rows = await q(db.from('audit_log').select('*').order('id', {ascending: false}).limit(200));
  const tbls = [...new Set(rows.map(r => r.table_name))];
  $('#view').innerHTML = `<div class="card stack"><h2>Bitácora de cambios</h2><p class="mut">Registro local de los últimos movimientos importantes en tu negocio.</p>
    <label>Filtrar por sección<select id="auT"><option value="all">Todo</option>${tbls.map(t => `<option value="${t}" ${t === AUD.t ? 'selected' : ''}>${esc(TBL[t] || t)}</option>`).join('')}</select></label></div><div class="list" id="auL"></div>`;
  const draw = () => {
    $('#auL').innerHTML = rows.filter(r => AUD.t === 'all' || r.table_name === AUD.t)
      .map(r => `<div class="item"><span><b>${esc(r.user_name || 'Dueño')}</b> ${esc(auditText(r))}<small>${fdate(r.at)}</small></span></div>`).join('') || '<p class="mut">Aún no hay movimientos registrados.</p>';
  };
  draw();
  $('#auT').onchange = (e) => { AUD.t = e.target.value; draw(); };
}
