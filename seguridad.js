// Seguridad, Modo Empleado configurable, Recuperación de PIN (2 capas) y bitácora local
const APP_VERSION = 'E3.7';
const ROLE_NAMES = {admin: 'Dueño / Administrador', vendedor: 'Modo Empleado'};
const PIN_LS = 'gdn_owner_pin_v1';
const PIN_REC_LS = 'gdn_owner_pin_rec_v1';
const STAFF_LS = 'gdn_staff_mode_v1';
const STAFF_PERMS_LS = 'gdn_staff_perms_v1';

const DEFAULT_STAFF_PERMS = {
  ventas: true,
  inventario_full: true,
  produccion: true,
  compras: false,
  finanzas_gastos: false,
  finanzas_cuentas: false,
  marketing: false,
  directorios: true,
  reportes: false,
  ver_ganancias: false,
  anular_corregir: false
};

const STAFF_PERM_META = [
  {k: 'inventario_full', name: 'Inventario completo (Existencias, Productos, Catálogo y Ajustes)', desc: 'Si lo desmarcas, el trabajador solo verá Consulta de precios sin costos ni edición.', reqMod: 'inventory'},
  {k: 'produccion', name: 'Producción / Fabricación', desc: 'Fórmulas, crear y finalizar lotes de producción y planificación.', reqMod: 'production'},
  {k: 'compras', name: 'Compras y proveedores', desc: 'Registrar compras, reposición sugerida y cuentas por pagar.', reqMod: 'purchases'},
  {k: 'finanzas_gastos', name: 'Cierre de caja y Gastos', desc: 'Hacer cuadre diario y anotar gastos operativos del día.'},
  {k: 'finanzas_cuentas', name: 'Cuentas bancarias y saldos', desc: 'Ver cuánto dinero hay en cada cuenta, transferir y hacer aportes/retiros.'},
  {k: 'marketing', name: 'Marketing y clientes WhatsApp', desc: 'Segmentar clientes y enviar promociones o recordatorios.', reqMod: 'marketing'},
  {k: 'directorios', name: 'Directorios (Clientes, Proveedores, Categorías)', desc: 'Crear y editar clientes, proveedores, categorías, unidades y listas.'},
  {k: 'reportes', name: 'Reportes y rentabilidad', desc: 'Ver ingresos totales, utilidad neta y posición del negocio.'},
  {k: 'ver_ganancias', name: 'Ver ganancia en cada venta', desc: 'Mostrar la tarjeta de ganancia y margen al abrir una venta en el historial.'},
  {k: 'anular_corregir', name: 'Corregir, anular ventas y devoluciones', desc: 'Permitir modificar o anular ventas ya registradas y registrar devoluciones.'}
];

const SECURITY_QUESTIONS = [
  '¿Cómo se llamaba tu primera mascota?',
  '¿En qué ciudad naciste?',
  '¿Cuál es tu comida favorita?',
  '¿Nombre de tu mamá o papá?',
  '¿Año de nacimiento (4 dígitos)?',
  'custom'
];

function normSecret(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getOwnerPin() {
  try {
    const ls = localStorage.getItem(PIN_LS);
    if (ls) return ls;
  } catch (e) {}
  return (typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.owner_pin) ? String(LDB.mem.settings[0].owner_pin) : '';
}

function getPinRecovery() {
  let rec = {q: '', a: ''};
  try {
    const ls = JSON.parse(localStorage.getItem(PIN_REC_LS) || 'null');
    if (ls && ls.q && ls.a) rec = {q: String(ls.q), a: String(ls.a)};
  } catch (e) {}
  if (!rec.q && typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.owner_pin_q && LDB.mem?.settings?.[0]?.owner_pin_a) {
    rec = {q: String(LDB.mem.settings[0].owner_pin_q), a: String(LDB.mem.settings[0].owner_pin_a)};
  }
  return rec;
}

async function saveOwnerPin(pin, recQ = undefined, recA = undefined) {
  const clean = String(pin || '').replace(/\D/g, '');
  try {
    if (clean) localStorage.setItem(PIN_LS, clean);
    else localStorage.removeItem(PIN_LS);
  } catch (e) {}
  const upd = {owner_pin: clean || null, updated_at: new Date().toISOString()};
  if (recQ !== undefined && recA !== undefined) {
    const cq = String(recQ || '').trim();
    const ca = normSecret(recA);
    if (cq && ca) {
      upd.owner_pin_q = cq;
      upd.owner_pin_a = ca;
      try { localStorage.setItem(PIN_REC_LS, JSON.stringify({q: cq, a: ca})); } catch (e) {}
    } else if (!clean) {
      upd.owner_pin_q = null;
      upd.owner_pin_a = null;
      try { localStorage.removeItem(PIN_REC_LS); } catch (e) {}
    }
  } else if (!clean) {
    upd.owner_pin_q = null;
    upd.owner_pin_a = null;
    try { localStorage.removeItem(PIN_REC_LS); } catch (e) {}
  }
  try { await q(db.from('settings').update(upd).eq('id', 1)); } catch (e) {}
}

function getStaffPerms() {
  if (S.staffPerms) return S.staffPerms;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STAFF_PERMS_LS) || 'null'); } catch (e) {}
  const fromDb = (typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.staff_perms) || null;
  S.staffPerms = {...DEFAULT_STAFF_PERMS, ...(fromDb || {}), ...(saved || {})};
  return S.staffPerms;
}

async function saveStaffPerms(perms) {
  const clean = {...DEFAULT_STAFF_PERMS, ...(perms || {}), ventas: true};
  S.staffPerms = clean;
  try { localStorage.setItem(STAFF_PERMS_LS, JSON.stringify(clean)); } catch (e) {}
  try {
    await q(db.from('settings').update({staff_perms: clean, updated_at: new Date().toISOString()}).eq('id', 1));
  } catch (e) {}
  applyRoleUI();
}

function staffCan(k) {
  if (S.role !== 'vendedor') return true;
  return !!getStaffPerms()[k];
}

function setStaffModeFlag(on) {
  try { localStorage.setItem(STAFF_LS, on ? '1' : '0'); } catch (e) {}
  S.role = on ? 'vendedor' : 'admin';
  applyRoleUI();
  LDB.paintBar();
}

const canSee = (m) => {
  if (S.role === 'vendedor') {
    if (m === 'inicio' || m === 'mas') return true;
    if (m === 'ventas') return staffCan('ventas');
    if (m === 'inventario') return true;
    if (m === 'produccion') return hasMod('production') && staffCan('produccion');
    if (m === 'compras') return hasMod('purchases') && staffCan('compras');
    if (m === 'finanzas') return staffCan('finanzas_gastos') || staffCan('finanzas_cuentas');
    if (m === 'marketing') return hasMod('marketing') && staffCan('marketing');
    if (m === 'directorios') return staffCan('directorios');
    if (m === 'contabilidad') return staffCan('reportes');
    return false;
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
    const s = await q(db.from('settings').select('owner_name,owner_pin,owner_pin_q,owner_pin_a,staff_perms').eq('id', 1).single());
    S.userName = s?.owner_name || 'Dueño';
    if (s?.owner_pin && !localStorage.getItem(PIN_LS)) {
      try { localStorage.setItem(PIN_LS, String(s.owner_pin)); } catch (e) {}
    }
    if (s?.owner_pin_q && s?.owner_pin_a && !localStorage.getItem(PIN_REC_LS)) {
      try { localStorage.setItem(PIN_REC_LS, JSON.stringify({q: s.owner_pin_q, a: s.owner_pin_a})); } catch (e) {}
    }
    if (s?.staff_perms && typeof s.staff_perms === 'object') {
      S.staffPerms = {...DEFAULT_STAFF_PERMS, ...s.staff_perms};
      try { localStorage.setItem(STAFF_PERMS_LS, JSON.stringify(S.staffPerms)); } catch (e) {}
    } else {
      getStaffPerms();
    }
  } catch (e) {
    S.userName = 'Dueño';
    getStaffPerms();
  }
}

const LOCK_OPEN_ICO = '<svg class="ic" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-1.9"/></svg>';
const LOCK_CLOSED_ICO = '<svg class="ic" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';

function applyRoleUI() {
  if (typeof applyModsUI === 'function') applyModsUI();
  const isStaff = S.role === 'vendedor';
  const prodBtn = document.querySelector('#tabs button[data-tab="produccion"]');
  if (prodBtn) prodBtn.classList.toggle('hidden', !(hasMod('production') && staffCan('produccion')));
  const invBtn = document.querySelector('#tabs button[data-tab="inventario"]');
  if (invBtn) invBtn.classList.toggle('hidden', !hasMod('inventory') && !isStaff);
  const invSpan = document.querySelector('#tabs button[data-tab="inventario"] span');
  if (invSpan) invSpan.textContent = (isStaff && !staffCan('inventario_full')) ? 'Precios' : 'Inventario';

  const rb = document.querySelector('#roleBtn');
  if (rb) {
    rb.innerHTML = isStaff ? LOCK_CLOSED_ICO : LOCK_OPEN_ICO;
    rb.classList.toggle('on', isStaff);
    rb.title = isStaff ? 'Desbloquear Modo Dueño (PIN)' : 'Activar Modo Empleado';
    rb.setAttribute('aria-label', rb.title);
    rb.onclick = () => isStaff ? promptUnlockOwner() : enterStaffMode();
  }
}

function openPinSetupSheet(activateAfter = false, skipCurrentCheck = false) {
  const hasPin = !!getOwnerPin() && !skipCurrentCheck;
  const curRec = getPinRecovery();
  const presetMatch = SECURITY_QUESTIONS.includes(curRec.q) ? curRec.q : (curRec.q ? 'custom' : SECURITY_QUESTIONS[0]);

  openSheet(hasPin ? 'Cambiar PIN del dueño' : 'Configurar PIN del dueño', `
    <form id="pinSetF" class="stack">
      <p class="mut" style="margin:0">Este PIN de 4 a 6 dígitos protege el acceso de <b>Dueño</b>. Configura también una pregunta secreta para recuperarlo tú mismo si se te olvida.</p>
      ${hasPin ? '<label>PIN actual<input name="cur" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required placeholder="****"></label>' : ''}
      <div class="grid">
        <label>Nuevo PIN (4 a 6 números)<input name="pin1" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required placeholder="Ej: 1234"></label>
        <label>Confirmar PIN<input name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" required placeholder="Repite el PIN"></label>
      </div>
      <div class="card stack" style="background:var(--bg);margin:0;padding:.8rem">
        <b style="font-size:.9rem">Recuperación si olvidas el PIN (recomendado)</b>
        <label>Pregunta secreta
          <select name="rec_sel">
            ${SECURITY_QUESTIONS.map(qOpt => `<option value="${esc(qOpt)}" ${qOpt === presetMatch ? 'selected' : ''}>${qOpt === 'custom' ? 'Escribir mi propia pregunta...' : esc(qOpt)}</option>`).join('')}
          </select>
        </label>
        <label id="pinRecCustomW" class="${presetMatch === 'custom' ? '' : 'hidden'}">Tu pregunta personalizada
          <input name="rec_custom" value="${presetMatch === 'custom' ? esc(curRec.q) : ''}" placeholder="Ej: ¿Nombre de mi primer colegio?">
        </label>
        <label>Respuesta secreta (fácil de recordar para ti)
          <input name="rec_a" placeholder="${curRec.a ? 'Dejar vacío para conservar la actual' : 'Ej: Firulais, Caracas, 1995...'}" ${curRec.a ? '' : 'required'}>
        </label>
      </div>
      <button type="submit" class="btn">${activateAfter ? 'Guardar PIN y activar Modo Empleado' : 'Guardar PIN y recuperación'}</button>
    </form>`);

  const f = $('#pinSetF'), el = f.elements;
  el.rec_sel.onchange = () => { $('#pinRecCustomW').classList.toggle('hidden', el.rec_sel.value !== 'custom'); };

  f.onsubmit = (e) => {
    e.preventDefault();
    const cur = getOwnerPin();
    if (hasPin && el.cur.value.trim() !== cur) return toast('El PIN actual no coincide', true);
    const p1 = el.pin1.value.trim(), p2 = el.pin2.value.trim();
    if (!/^\d{4,6}$/.test(p1)) return toast('El PIN debe tener entre 4 y 6 números', true);
    if (p1 !== p2) return toast('Los PIN no coinciden', true);

    const chosenQ = el.rec_sel.value === 'custom' ? el.rec_custom.value.trim() : el.rec_sel.value;
    const rawA = el.rec_a.value.trim();
    const finalQ = rawA ? chosenQ : (curRec.q || chosenQ);
    const finalA = rawA || curRec.a;
    if (!finalQ || !finalA) return toast('Completa la pregunta y respuesta de recuperación', true);

    run(async () => {
      await saveOwnerPin(p1, finalQ, finalA);
      closeSheet();
      if (activateAfter) {
        setStaffModeFlag(true);
        toast('Modo Empleado activado');
        go('inicio');
      } else {
        toast('PIN y pregunta de recuperación guardados');
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
  if (!confirm('¿Cambiar a Modo Empleado? Se aplicarán los permisos configurados para el trabajador hasta ingresar tu PIN de dueño.')) return;
  setStaffModeFlag(true);
  toast('Modo Empleado activado');
  go('inicio');
}

// Verifica un código maestro de recuperación de PIN firmado (PIN1.<payload>.<firma>) con ECDSA P-256
async function verifyPinResetToken(tokenStr) {
  const clean = String(tokenStr || '').trim().replace(/\s+/g, '');
  const parts = clean.split('.');
  if (parts.length !== 3 || parts[0] !== 'PIN1') {
    throw new Error('Código de desbloqueo inválido. Debe iniciar con PIN1.');
  }
  if (typeof LIC === 'undefined') throw new Error('Módulo de verificación no disponible');
  const jwk = LIC.parsePublicKeyJwk(LIC.cfg().publicKey);
  if (!jwk) throw new Error('La app no tiene configurada la llave pública en config.js');
  if (!window.crypto?.subtle) throw new Error('Este navegador no soporta verificación criptográfica');

  const pubKey = await crypto.subtle.importKey('jwk', jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  const sig = LIC.b64uDec(parts[2]);
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const ok = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, pubKey, sig, data);
  if (!ok) throw new Error('Código de desbloqueo inválido o alterado');

  const payload = LIC.b64uToJson(parts[1]);
  if (!payload || payload.kind !== 'pin_reset' || !payload.exp) throw new Error('Código de desbloqueo incompleto');
  const expMs = new Date(payload.exp + 'T23:59:59-04:00').getTime();
  if (expMs < Date.now()) throw new Error(`Este código de desbloqueo venció el ${dmy(payload.exp)}. Solicita uno nuevo.`);

  if (payload.dev && payload.dev !== '*') {
    const myDev = LIC.deviceCode();
    const allowed = String(payload.dev).toUpperCase().split(',').map(x => x.trim());
    if (!allowed.includes(myDev)) {
      throw new Error(`Este código pertenece a otro equipo (${payload.dev}). Tu ID es ${myDev}.`);
    }
  }
  return payload;
}

function openPinRecoverySheet() {
  const rec = getPinRecovery();
  const hasRec = !!(rec.q && rec.a);
  const devId = (typeof LIC !== 'undefined') ? LIC.deviceCode() : (LDB.meta?.deviceId || 'DEV-LOCAL').toUpperCase();
  const c = (typeof LIC !== 'undefined') ? LIC.cfg() : {whatsapp: '', brand: 'Gestor Emprendedor', publicKey: ''};
  const biz = (typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.business_name) || 'Mi negocio';
  const waMsg = `Hola, olvidé mi PIN de dueño en *${c.brand}* y necesito un código de desbloqueo.\n• Negocio: ${biz}\n• ID de dispositivo: ${devId}`;
  const waUrl = `https://wa.me/${String(c.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}`;

  openSheet('Recuperar acceso (PIN olvidado)', `
    <div class="stack">
      ${hasRec ? `
        <form id="recSecF" class="card stack" style="background:var(--bg);margin:0;padding:.9rem">
          <h2 style="font-size:.98rem;margin:0">Opción 1 · Tu pregunta secreta</h2>
          <p style="margin:0"><b>${esc(rec.q)}</b></p>
          <label>Tu respuesta<input name="ans" required autocomplete="off" placeholder="Escribe tu respuesta"></label>
          <button type="submit" class="btn">Verificar y crear nuevo PIN</button>
        </form>
      ` : '<p class="mut" style="margin:0">No configuraste una pregunta secreta anteriormente. Usa la opción de código de desbloqueo de soporte abajo.</p>'}

      <form id="recSupF" class="card stack" style="background:var(--bg);margin:0;padding:.9rem">
        <h2 style="font-size:.98rem;margin:0">${hasRec ? 'Opción 2 · ' : ''}Código de desbloqueo por soporte (100% offline)</h2>
        <p class="mut" style="margin:0">Si no recuerdas tu respuesta secreta, envíanos tu ID de dispositivo por WhatsApp y te enviaremos un código único <code>PIN1...</code> para desbloquear tu cuenta sin perder ningún dato.</p>
        <div class="rl" style="border:0;padding:.2rem 0">
          <span>ID de dispositivo</span>
          <span class="row0" style="gap:.4rem"><b>${esc(devId)}</b><button type="button" class="lnk" id="recCopyDev" style="padding:0;font-size:.82rem">Copiar</button></span>
        </div>
        ${c.whatsapp ? `<a class="btn ghost" href="${waUrl}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Pedir código de desbloqueo por WhatsApp</a>` : ''}
        <label>Pega aquí el código recibido (PIN1...)
          <textarea name="code" rows="2" placeholder="PIN1.eyJ..." required></textarea>
        </label>
        <button type="submit" class="btn">Desbloquear con código</button>
      </form>
    </div>`);

  if (hasRec && $('#recSecF')) {
    $('#recSecF').onsubmit = (e) => {
      e.preventDefault();
      const ans = normSecret(e.target.elements.ans.value);
      if (ans !== rec.a) return toast('Respuesta incorrecta. Intenta de nuevo o pide ayuda por WhatsApp.', true);
      setStaffModeFlag(false);
      toast('Identidad verificada. Crea tu nuevo PIN.');
      openPinSetupSheet(false, true);
    };
  }
  $('#recCopyDev').onclick = () => copyText(devId, 'ID de dispositivo copiado');
  $('#recSupF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await verifyPinResetToken(e.target.elements.code.value);
      await saveOwnerPin('');
      setStaffModeFlag(false);
      toast('¡Acceso de Dueño recuperado! Puedes crear un nuevo PIN ahora.');
      openPinSetupSheet(false, true);
    });
  };
}

function promptUnlockOwner() {
  openSheet('Desbloquear Modo Dueño', `
    <form id="pinUnlF" class="stack">
      <p class="mut" style="margin:0">Ingresa tu PIN de dueño para acceder a toda la configuración y funciones bloqueadas.</p>
      <label>PIN del dueño<input name="pin" type="password" inputmode="numeric" maxlength="6" required autofocus placeholder="****" style="font-size:1.4rem;text-align:center;letter-spacing:.35rem"></label>
      <button type="submit" class="btn">Desbloquear</button>
      <button type="button" class="lnk" id="pinForgotBtn" style="text-align:center;font-size:.88rem">¿Olvidaste tu PIN? Recuperar acceso</button>
    </form>`);
  $('#pinForgotBtn').onclick = () => openPinRecoverySheet();
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
  const rec = getPinRecovery();
  const isStaff = S.role === 'vendedor';
  const perms = getStaffPerms();
  const r = S.rules || {};

  const visiblePerms = STAFF_PERM_META.filter(m => !m.reqMod || hasMod(m.reqMod));

  $('#view').innerHTML = `
    <div class="card stack" style="border-left:5px solid var(--pri)">
      <div class="title-row">
        <h2>Modo Empleado con PIN</h2>
        <span class="badge ${hasPin ? 'ok' : ''}">${hasPin ? 'PIN configurado' : 'Sin PIN'}</span>
      </div>
      <p class="mut" style="margin:0">Elige exactamente qué módulos puede operar tu trabajador. La sección de <b>Configuración, Licencias y Borrado</b> siempre queda protegida con tu PIN de dueño.</p>
      <div class="rl"><span>Pregunta de recuperación</span><b>${rec.q ? 'Configurada' : 'Pendiente (recomendada)'}</b></div>
      <div class="row">
        <button type="button" class="btn" id="meToggle">${isStaff ? 'Desbloquear Modo Dueño' : 'Activar Modo Empleado ahora'}</button>
        <button type="button" class="btn ghost" id="mePin">${hasPin ? 'Cambiar PIN / Pregunta' : 'Configurar PIN'}</button>
      </div>
      ${hasPin && !isStaff ? '<div class="row" style="margin-top:0"><button type="button" class="lnk bad" id="meRmPin" style="padding:0">Quitar PIN</button></div>' : ''}
    </div>

    <form id="mePermsF" class="card stack">
      <div class="title-row">
        <h2>Qué puede ver y hacer el trabajador</h2>
      </div>
      <div class="row" style="margin:0">
        <button type="button" class="btn ghost" id="mePreMgr" style="font-size:.86rem">Perfil Encargado (gestión completa)</button>
        <button type="button" class="btn ghost" id="mePreCash" style="font-size:.86rem">Perfil Cajero (solo ventas y precios)</button>
      </div>
      <div class="list" id="mePermList" style="margin-top:.3rem">
        ${visiblePerms.map(m => `<label class="item chk" style="cursor:pointer;gap:.75rem">
          <input type="checkbox" name="sp_${m.k}" ${perms[m.k] ? 'checked' : ''}>
          <span style="flex:1"><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></span>
        </label>`).join('')}
      </div>
      <button type="submit" class="btn">Guardar permisos del trabajador</button>
    </form>

    <div class="card stack">
      <h2>Reglas adicionales al vender</h2>
      <div class="rl"><span>Modificar precios al vender</span><b>${r.allow_seller_price_edit !== false ? 'Permitido' : 'Bloqueado'}</b></div>
      <div class="rl"><span>Tope de descuento</span><b>${Number(r.max_discount_percent || 0) > 0 ? qty(r.max_discount_percent) + '%' : 'Sin tope'}</b></div>
      <div class="rl"><span>Vender sin stock</span><b>${r.block_negative_stock ? 'Bloqueado' : 'Permitido con aviso'}</b></div>
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

  const applyPreset = (obj) => {
    visiblePerms.forEach(m => {
      const cb = $('#mePermsF').elements['sp_' + m.k];
      if (cb) cb.checked = !!obj[m.k];
    });
  };
  $('#mePreMgr').onclick = () => {
    applyPreset({
      inventario_full: true, produccion: true, compras: true,
      finanzas_gastos: true, finanzas_cuentas: false, marketing: true,
      directorios: true, reportes: false, ver_ganancias: false, anular_corregir: true
    });
    toast('Perfil Encargado marcado. Pulsa "Guardar permisos" para aplicarlo.');
  };
  $('#mePreCash').onclick = () => {
    applyPreset({
      inventario_full: false, produccion: false, compras: false,
      finanzas_gastos: false, finanzas_cuentas: false, marketing: false,
      directorios: false, reportes: false, ver_ganancias: false, anular_corregir: false
    });
    toast('Perfil Cajero marcado. Pulsa "Guardar permisos" para aplicarlo.');
  };

  $('#mePermsF').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements, next = {...getStaffPerms(), ventas: true};
    visiblePerms.forEach(m => { next[m.k] = !!el['sp_' + m.k].checked; });
    run(async () => {
      await saveStaffPerms(next);
      toast('Permisos del trabajador guardados');
    });
  };
  $('#meGoRules').onclick = () => { SUB.cfg = 'reglas'; render(); };
}

// Vista de solo consulta de precios y stock para Modo Empleado (cuando inventario_full está desmarcado)
async function viewConsultaPrecios() {
  const [prods, stockRows] = await Promise.all([
    q(db.from('products').select('id,sku,name,unit,sale_price_usd,is_service,is_combo,combo_items,expiry_date,track_inventory,image_url,product_categories(name)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock'))
  ]);
  const stMap = Object.fromEntries(stockRows.map(s => [s.product_id, Number(s.stock || 0)]));
  const pm = Object.fromEntries(prods.map(p => [p.id, p]));
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
      let stTxt = '', stCls = 'in';
      if (p.is_combo) {
        const av = typeof comboAvail === 'function' ? comboAvail(p, stMap, pm) : 0;
        stTxt = av === null ? 'Combo disponible' : (av > 0 ? `Combo · Armables: ${qty(av)}` : 'Combo sin stock');
        stCls = (av === null || av > 0) ? 'in' : 'bad';
      } else {
        const st = stMap[p.id] || 0;
        stTxt = p.is_service ? 'Servicio' : p.track_inventory === false ? 'Disponible' : (st > 0 ? `Disp: ${qty(st)} ${esc(p.unit)}` : 'Agotado');
        stCls = p.is_service || p.track_inventory === false || st > 0 ? 'in' : 'bad';
      }
      const eb = (!p.is_combo && !p.is_service && p.expiry_date && typeof expiryBadge === 'function') ? expiryBadge(p.expiry_date, true) : null;
      return `<div class="item">
        <span style="flex:1">
          <b>${esc(p.name)}</b>${p.is_combo ? ' <span class="badge ok" style="font-size:.7rem;padding:.05rem .35rem">Combo</span>' : ''}
          <small>${esc(p.sku || 'Sin código')} · ${esc(p.product_categories?.name || 'General')} · <span class="${stCls}">${stTxt}</span>${eb && eb.state !== 'ok' ? ` · <span class="${eb.cls}">${esc(eb.text)}</span>` : ''}</small>
        </span>
        <span class="n">
          <b>${fmtCur(p.sale_price_usd)}</b>
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
        ? {ok: true, msg: `${hit.name} — ${fmtCur(hit.sale_price_usd)}`}
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
