// Edición Emprendedores: Asistente de bienvenida (60 segundos), perfiles de negocio y módulos activables

const DEFAULT_MODS = {
  inventory: true,
  purchases: true,
  production: false,
  planning: false,
  quotes: true,
  orders: false,
  marketing: true,
  payroll: false,
  catalog: true,
  labels: false,
  rawbt: false
};

const MOD_CATALOG = [
  {k: 'inventory', name: 'Inventario y existencias', desc: 'Control de stock, kardex, precios masivos y ajuste físico'},
  {k: 'purchases', name: 'Compras y proveedores', desc: 'Registro de compras, reposición sugerida y cuentas por pagar'},
  {k: 'production', name: 'Producción y fórmulas', desc: 'Recetas, lotes fabricados, insumos sin inventario y hoja de lote'},
  {k: 'planning', name: 'Planificación de producción', desc: 'Calcula si te alcanza la materia prima para varios lotes a la vez'},
  {k: 'orders', name: 'Pedidos y encargos por entregar', desc: 'Opcional: encargos con fecha de entrega, abonos, estados (Pendiente → Listo) y avisos por WhatsApp'},
  {k: 'quotes', name: 'Cotizaciones / Presupuestos', desc: 'Presupuestos profesionales en foto para convertir luego en venta'},
  {k: 'catalog', name: 'Catálogo de productos', desc: 'Genera catálogos en PDF, foto o texto WhatsApp por lista de precios'},
  {k: 'labels', name: 'Etiquetas y códigos de barras', desc: 'Opcional: genera etiquetas de precio y códigos Code 128 para hoja A4 o rollo térmico'},
  {k: 'rawbt', name: 'Impresión térmica Bluetooth (RawBT)', desc: 'Opcional: botón de impresión directa en 1 toque para impresoras térmicas de 58mm/80mm en Android'},
  {k: 'marketing', name: 'Marketing y seguimiento', desc: 'Clientes VIP, reactivación de inactivos y campañas por WhatsApp'},
  {k: 'payroll', name: 'Nómina y empleados', desc: 'Sueldos, adelantos y recibos de pago de tu personal'}
];

const BIZ_PROFILES = {
  tienda: {
    name: 'Tienda, Comercio o Bodega',
    desc: 'Compras y vendes productos terminados. Incluye inventario, catálogo, compras, escáner y caja.',
    mods: {inventory: true, purchases: true, production: false, planning: false, quotes: true, orders: false, marketing: true, payroll: false, catalog: true, labels: false, rawbt: false}
  },
  fabricante: {
    name: 'Fabricante, Repostería o Taller',
    desc: 'Elaboras tus propios productos con recetas o fórmulas y gestionas pedidos por encargo.',
    mods: {inventory: true, purchases: true, production: true, planning: true, quotes: true, orders: true, marketing: true, payroll: false, catalog: true, labels: false, rawbt: false}
  },
  servicios: {
    name: 'Servicios o Independiente',
    desc: 'Barbería, técnico, delivery, diseño, asesorías. Enfocado en cobros, cotizaciones, gastos y clientes.',
    mods: {inventory: false, purchases: false, production: false, planning: false, quotes: true, orders: false, marketing: true, payroll: false, catalog: false, labels: false, rawbt: false}
  },
  personalizado: {
    name: 'Personalizado',
    desc: 'Tú eliges exactamente qué módulos activar desde el primer momento.',
    mods: {inventory: true, purchases: true, production: true, planning: false, quotes: true, orders: false, marketing: true, payroll: false, catalog: true, labels: false, rawbt: false}
  }
};

function hasMod(k) {
  const m = (typeof S !== 'undefined' && S.mods) ? S.mods : DEFAULT_MODS;
  return m[k] !== false;
}

async function loadModulesConfig() {
  try {
    const [s, currs] = await Promise.all([
      q(db.from('settings').select('*').eq('id', 1).single()),
      db.from('currencies').select('*').eq('active', true).order('id').then(r => r.error ? [] : (r.data || []))
    ]);
    const mc = (s.modules_config && typeof s.modules_config === 'object') ? s.modules_config : {};
    S.mods = {...DEFAULT_MODS, ...mc};
    // Sincronizar con flags clásicos
    if (mc.planning === undefined && s.enable_planning !== undefined) S.mods.planning = s.enable_planning !== false;
    if (mc.payroll === undefined && s.enable_payroll !== undefined) S.mods.payroll = s.enable_payroll !== false;
    S.flags = {planning: !!S.mods.planning, payroll: !!S.mods.payroll};
    S.bimoneda = s.bimoneda !== false;

    const baseC = currs.find(c => c.is_base) || currs[0] || null;
    const secC = currs.find(c => !c.is_base) || null;
    S.baseCurrency = (baseC?.code || s.base_currency || 'USD').trim();
    S.curCode = S.baseCurrency;
    S.curSym = (baseC?.symbol || s.currency_symbol || '$').trim() || '$';
    S.curPos = s.currency_display || 'prefix';
    S.secSym = (secC?.symbol || 'Bs').trim() || 'Bs';

    S.bizName = s.business_name || (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.brandName : 'Gestor Emprendedor');
    const hdr = document.querySelector('header strong');
    if (hdr) hdr.textContent = S.bizName;
  } catch (e) {
    S.mods = {...DEFAULT_MODS};
    S.flags = {planning: !!S.mods.planning, payroll: !!S.mods.payroll};
    S.bimoneda = true;
    S.baseCurrency = 'USD';
    S.curCode = 'USD';
    S.curSym = '$';
    S.curPos = 'prefix';
    S.secSym = 'Bs';
  }
  applyModsUI();
  if (typeof paintRateChip === 'function') paintRateChip();
}

function applyModsUI() {
  document.querySelectorAll('#tabs button').forEach(b => {
    const t = b.dataset.tab;
    let show = true;
    if (t === 'inventario') show = hasMod('inventory');
    if (t === 'produccion') show = hasMod('production');
    b.classList.toggle('hidden', !show);
  });
  const chip = document.querySelector('#rateChip');
  if (chip) chip.classList.toggle('hidden', S.bimoneda === false);
}

const CUR_PRESETS = [
  {code: 'USD', sym: '$', name: 'Dólar ($)'},
  {code: 'EUR', sym: '€', name: 'Euro (€)'},
  {code: 'VES', sym: 'Bs', name: 'Bolívar (Bs)'},
  {code: 'COP', sym: 'COP', name: 'Peso Col. (COP)'},
  {code: 'PEN', sym: 'S/', name: 'Sol (S/)'},
  {code: 'MXN', sym: 'MX$', name: 'Peso Mex. (MX$)'},
  {code: 'CLP', sym: 'CLP$', name: 'Peso Chil. (CLP$)'}
];

// ---------- Pantalla: Configurar módulos activables y símbolo de moneda ----------
async function viewModulos() {
  const [s, currs] = await Promise.all([
    q(db.from('settings').select('*').eq('id', 1).single()),
    db.from('currencies').select('*').order('id').then(r => r.error ? [] : (r.data || []))
  ]);
  const curMods = {...DEFAULT_MODS, ...(s.modules_config || {})};
  const bimoneda = s.bimoneda !== false;
  const baseC = currs.find(c => c.is_base) || currs[0] || {id: 1, code: 'USD', symbol: '$', name: 'Dólar estadounidense'};
  const cSym = baseC.symbol || s.currency_symbol || '$';
  const cCode = baseC.code || s.base_currency || 'USD';
  const cPos = s.currency_display || 'prefix';

  $('#view').innerHTML = `
    <form id="modForm" class="stack">
      <div class="card stack" style="border-left:5px solid var(--pri)">
        <h2>Moneda y símbolo en toda la app</h2>
        <p class="mut" style="margin:0">El símbolo elegido se aplicará automáticamente en el inicio, ventas, reportes, tickets, catálogo, compras y resúmenes de WhatsApp.</p>
        <div class="chips" id="curPreChips">
          ${CUR_PRESETS.map(p => `<button type="button" data-code="${p.code}" data-sym="${esc(p.sym)}" data-name="${esc(p.name)}" class="${p.sym === cSym && p.code === cCode ? 'on' : ''}">${esc(p.name)}</button>`).join('')}
        </div>
        <div class="grid">
          <label>Símbolo de moneda (ej: $, €, S/, Bs)<input name="cur_sym" value="${esc(cSym)}" maxlength="5" required></label>
          <label>Código (ej: USD, EUR, PEN)<input name="cur_code" value="${esc(cCode)}" maxlength="6" required></label>
        </div>
        <label>Cómo mostrar los montos en pantalla y reportes
          <select name="cur_pos">
            <option value="prefix" ${cPos === 'prefix' ? 'selected' : ''}>Símbolo adelante (ej: $15,00)</option>
            <option value="suffix" ${cPos === 'suffix' ? 'selected' : ''}>Símbolo atrás (ej: 15,00 $)</option>
            <option value="code" ${cPos === 'code' ? 'selected' : ''}>Código de moneda (ej: 15,00 USD)</option>
          </select>
        </label>
        <div class="card" style="background:var(--bg);margin:0;padding:.7rem .85rem">
          <small class="mut" style="display:block">Vista previa en reportes y precios:</small>
          <b id="curPrevTxt" style="font-size:1.08rem"></b>
        </div>
        <label class="chk" style="margin-top:.2rem">
          <input type="checkbox" name="bimoneda" ${bimoneda ? 'checked' : ''}>
          <span><b>Modo Bimoneda Venezuela (moneda principal + Bs con tasa BCV / manual)</b><br><small class="mut">Desactívalo si trabajas en una sola moneda y no necesitas convertir a bolívares.</small></span>
        </label>
      </div>

      <div class="card stack">
        <h2>Módulos activos en tu negocio</h2>
        <p class="mut" style="margin:0">Activa solo lo que usas para mantener la app limpia y rápida. Tus datos nunca se borran al ocultar un módulo.</p>
        <div class="list" style="margin-top:.3rem">
          ${MOD_CATALOG.map(m => `<label class="item chk" style="cursor:pointer;gap:.75rem">
            <input type="checkbox" name="mod_${m.k}" ${curMods[m.k] ? 'checked' : ''}>
            <span style="flex:1"><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></span>
          </label>`).join('')}
        </div>
      </div>

      <div class="row">
        <button class="btn" type="submit">Guardar cambios</button>
      </div>
    </form>`;

  const f = $('#modForm'), el = f.elements;
  const paintPrev = () => {
    const sym = el.cur_sym.value.trim() || '$';
    const code = (el.cur_code.value.trim() || 'USD').toUpperCase();
    const pos = el.cur_pos.value;
    const tag = pos === 'code' ? code : sym;
    const fmtEx = (val) => {
      const neg = val < 0, a = fmt(Math.abs(val));
      if (pos === 'prefix' && tag.length <= 3 && !/^[A-Z]{3}$/.test(tag)) return (neg ? '-' : '') + tag + a;
      return (neg ? '-' : '') + a + ' ' + tag;
    };
    $('#curPrevTxt').textContent = `Venta: ${fmtEx(1250)}  ·  Gasto: ${fmtEx(-45.5)}  ·  Precio: ${fmtEx(12.99)}`;
  };
  paintPrev();
  ['cur_sym', 'cur_code', 'cur_pos'].forEach(k => {
    el[k].addEventListener('input', paintPrev);
    el[k].addEventListener('change', paintPrev);
  });
  $('#curPreChips').onclick = (e) => {
    const b = e.target.closest('[data-sym]'); if (!b) return;
    el.cur_sym.value = b.dataset.sym;
    el.cur_code.value = b.dataset.code;
    document.querySelectorAll('#curPreChips button').forEach(x => x.classList.toggle('on', x === b));
    paintPrev();
  };

  f.onsubmit = (e) => {
    e.preventDefault();
    const mods = {};
    MOD_CATALOG.forEach(m => { mods[m.k] = !!el['mod_' + m.k].checked; });
    if (!mods.production) mods.planning = false;
    const isBi = !!el.bimoneda.checked;
    const nextSym = el.cur_sym.value.trim() || '$';
    const nextCode = (el.cur_code.value.trim() || 'USD').toUpperCase();
    const nextPos = el.cur_pos.value || 'prefix';
    run(async () => {
      await q(db.from('settings').update({
        modules_config: mods,
        enable_planning: mods.planning,
        enable_payroll: mods.payroll,
        bimoneda: isBi,
        base_currency: nextCode,
        currency_symbol: nextSym,
        currency_display: nextPos,
        ticket_show_bs: isBi,
        ticket_show_rate: isBi,
        updated_at: new Date().toISOString()
      }).eq('id', 1));
      if (baseC && baseC.id != null) {
        await q(db.from('currencies').update({code: nextCode, symbol: nextSym}).eq('id', baseC.id));
      }
      await loadModulesConfig();
      if (typeof loadRate === 'function') await loadRate();
      toast('Módulos y moneda actualizados');
      render();
    });
  };
}

// ---------- Asistente de bienvenida (primera vez) ----------
function showOnboarding() {
  const ob = $('#onboarding');
  $('#app').classList.add('hidden');
  ob.classList.remove('hidden');

  const ST = {
    step: 1,
    businessName: '',
    ownerName: '',
    phone: '',
    profile: 'tienda',
    mods: {...BIZ_PROFILES.tienda.mods},
    bimoneda: true,
    rate: '',
    loadDemo: false
  };

  const brand = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.brandName) ? APP_CONFIG.brandName : 'Gestor Emprendedor';

  const drawStep = () => {
    const progress = `<div class="ob-steps">
      <span class="${ST.step >= 1 ? 'on' : ''}">1. Negocio</span>
      <span class="${ST.step >= 2 ? 'on' : ''}">2. Tipo</span>
      <span class="${ST.step >= 3 ? 'on' : ''}">3. Moneda</span>
    </div>`;

    let body = '';
    if (ST.step === 1) {
      body = `
        <h1>Bienvenido a ${esc(brand)}</h1>
        <p class="mut" style="margin:0">Organiza tus ventas, caja, clientes y ganancias directo desde tu teléfono, incluso sin internet. Configúralo en menos de 1 minuto.</p>
        <label>Nombre de tu negocio o emprendimiento<input id="obBiz" value="${esc(ST.businessName)}" placeholder="Ej: Limpieza Express, Repostería Ana..." required></label>
        <label>Tu nombre<input id="obOwner" value="${esc(ST.ownerName)}" placeholder="Ej: Carlos Pérez"></label>
        <label>WhatsApp del negocio (opcional)<input id="obPh" type="tel" value="${esc(ST.phone)}" placeholder="Ej: 0414-0000000"></label>
        <div class="row">
          <button type="button" class="btn" id="obNext">Continuar &rsaquo;</button>
        </div>
        <div class="stack" style="gap:.35rem;text-align:center;margin-top:.2rem">
          ${typeof GDRIVE !== 'undefined' && GDRIVE.getClientId() ? '<button type="button" class="btn ghost" id="obDriveRestore">Restaurar negocio desde mi Google Drive</button>' : ''}
          <button type="button" class="lnk" id="obRestoreBtn" style="font-size:.86rem">¿Tienes un archivo de respaldo (.json)? Restaurar aquí</button>
          <input type="file" id="obRestoreFile" accept=".json,application/json" class="hidden">
          <a href="./privacidad.html" target="_blank" rel="noopener" class="mut" style="font-size:.78rem;text-decoration:underline;margin-top:.2rem">Política de Privacidad y Términos de Uso</a>
        </div>`;
    } else if (ST.step === 2) {
      body = `
        <h1>¿A qué se dedica ${esc(ST.businessName || 'tu negocio')}?</h1>
        <p class="mut" style="margin:0">Elegiremos las herramientas exactas para ti. Luego podrás activar o desactivar cualquier módulo cuando quieras.</p>
        <div class="stack" id="obProfs" style="gap:.55rem">
          ${Object.entries(BIZ_PROFILES).map(([k, p]) => `
            <button type="button" class="ob-pick ${ST.profile === k ? 'on' : ''}" data-pr="${k}">
              <b>${esc(p.name)}</b>
              <small>${esc(p.desc)}</small>
            </button>`).join('')}
        </div>
        ${ST.profile === 'personalizado' ? `<div class="card" style="background:var(--bg);margin:0;padding:.75rem">
          <small class="mut" style="display:block;margin-bottom:.4rem">Selecciona tus módulos:</small>
          <div class="stack" id="obCustomMods" style="gap:.4rem">
            ${MOD_CATALOG.map(m => `<label class="chk"><input type="checkbox" data-cm="${m.k}" ${ST.mods[m.k] ? 'checked' : ''}> ${esc(m.name)}</label>`).join('')}
          </div>
        </div>` : ''}
        <div class="row">
          <button type="button" class="btn ghost" id="obPrev">&lsaquo; Atrás</button>
          <button type="button" class="btn" id="obNext">Continuar &rsaquo;</button>
        </div>`;
    } else {
      body = `
        <h1>Moneda y arranque</h1>
        <p class="mut" style="margin:0">Tus datos se guardan de forma privada en este dispositivo y trabajan 100% sin internet.</p>
        <div class="stack" id="obCurMode" style="gap:.55rem">
          <button type="button" class="ob-pick ${ST.bimoneda ? 'on' : ''}" data-bi="1">
            <b>Venezuela · USD + Bolívares (Bimoneda)</b>
            <small>Precios en dólares, cobros en Bs o USD y tasa BCV automática o manual.</small>
          </button>
          <button type="button" class="ob-pick ${!ST.bimoneda ? 'on' : ''}" data-bi="0">
            <b>Una sola moneda ($, €, S/, etc.)</b>
            <small>Ideal si cobras y llevas todo en una sola moneda sin conversión a Bs.</small>
          </button>
        </div>
        ${ST.bimoneda ? `<label>Tasa inicial (Bs por 1 USD) — opcional
          <input id="obRate" type="number" step="0.0001" min="0.0001" value="${esc(ST.rate)}" placeholder="Dejar vacío para traer tasa BCV automática">
        </label>` : ''}
        <label class="chk">
          <input type="checkbox" id="obDemo" ${ST.loadDemo ? 'checked' : ''}>
          <span><b>Cargar 3 productos y 1 cliente de ejemplo (opcional)</b><br><small class="mut">Déjalo desmarcado si quieres arrancar completamente limpio con tus propios datos.</small></span>
        </label>
        <div class="row">
          <button type="button" class="btn ghost" id="obPrev">&lsaquo; Atrás</button>
          <button type="button" class="btn" id="obFinish">Crear mi negocio</button>
        </div>`;
    }

    ob.innerHTML = `<div class="ob-card card stack">${progress}${body}</div>`;

    if (ST.step === 1) {
      $('#obBiz').oninput = (e) => { ST.businessName = e.target.value; };
      $('#obOwner').oninput = (e) => { ST.ownerName = e.target.value; };
      $('#obPh').oninput = (e) => { ST.phone = e.target.value; };
      $('#obNext').onclick = () => {
        if (!ST.businessName.trim()) { toast('Escribe el nombre de tu negocio para continuar', true); $('#obBiz').focus(); return; }
        ST.step = 2; drawStep();
      };
      if ($('#obDriveRestore')) $('#obDriveRestore').onclick = () => run(() => GDRIVE.openRestorePicker(true));
      $('#obRestoreBtn').onclick = () => $('#obRestoreFile').click();
      $('#obRestoreFile').onchange = (e) => {
        const file = e.target.files[0]; if (!file) return;
        run(async () => {
          const text = await file.text();
          const data = JSON.parse(text);
          await LDB.importFullJson(data);
          toast('Respaldo restaurado correctamente');
          ob.classList.add('hidden');
          await enter();
        });
      };
    } else if (ST.step === 2) {
      $('#obProfs').onclick = (e) => {
        const b = e.target.closest('[data-pr]'); if (!b) return;
        ST.profile = b.dataset.pr;
        ST.mods = {...BIZ_PROFILES[ST.profile].mods};
        drawStep();
      };
      if ($('#obCustomMods')) {
        $('#obCustomMods').addEventListener('change', (e) => {
          const k = e.target.dataset.cm; if (k) ST.mods[k] = e.target.checked;
        });
      }
      $('#obPrev').onclick = () => { ST.step = 1; drawStep(); };
      $('#obNext').onclick = () => { ST.step = 3; drawStep(); };
    } else {
      $('#obCurMode').onclick = (e) => {
        const b = e.target.closest('[data-bi]'); if (!b) return;
        ST.bimoneda = b.dataset.bi === '1';
        drawStep();
      };
      if ($('#obRate')) $('#obRate').oninput = (e) => { ST.rate = e.target.value; };
      $('#obDemo').onchange = (e) => { ST.loadDemo = e.target.checked; };
      $('#obPrev').onclick = () => { ST.step = 2; drawStep(); };
      $('#obFinish').onclick = () => run(async () => {
        const manualRate = Number(ST.rate || 0);
        let initRate = ST.bimoneda ? (manualRate > 0 ? manualRate : 0) : 1;
        let rateSource = manualRate > 0 ? 'manual' : 'bcv_auto';
        let rateMode = manualRate > 0 ? 'manual' : 'auto';

        if (ST.bimoneda && !(initRate > 0) && navigator.onLine) {
          try {
            toast('Obteniendo tasa BCV del día...');
            const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
            if (res.ok) {
              const j = await res.json();
              const r = Number(j.promedio ?? j.venta);
              if (r > 0) initRate = r;
            }
          } catch (e) {}
        }
        if (ST.bimoneda && !(initRate > 0)) { initRate = 40; rateSource = 'manual'; }

        await LDB.seedDefaults({
          businessName: ST.businessName.trim(),
          ownerName: ST.ownerName.trim() || 'Dueño',
          phone: ST.phone.trim(),
          profile: ST.profile,
          modules: ST.mods,
          bimoneda: ST.bimoneda,
          rate: initRate,
          rateMode,
          rateSource,
          loadDemo: ST.loadDemo,
          showApertura: !ST.loadDemo
        });
        ob.classList.add('hidden');
        toast(`¡Listo! "${ST.businessName.trim()}" está configurado`);
        await enter();
        setTimeout(() => { if (typeof openTutorial === 'function') openTutorial(0); }, 350);
      });
    }
  };
  drawStep();
}


// ---------- Tutorial interactivo rápido (Guía de uso de la app) ----------
const TUT_SEEN_KEY = 'gdn_tut_seen_v1';
function isTutorialSeen() {
  try { return localStorage.getItem(TUT_SEEN_KEY) === '1'; } catch (e) { return false; }
}
function markTutorialSeen() {
  try { localStorage.setItem(TUT_SEEN_KEY, '1'); } catch (e) {}
}
function closeTutorial() {
  markTutorialSeen();
  const m = $('#tutModal');
  if (m) m.classList.add('hidden');
}

function openTutorial(startStep = 0) {
  markTutorialSeen();
  const steps = [
    {
      badge: 'Primeros pasos',
      title: 'Conoce tu Gestor Emprendedor',
      icon: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
      desc: 'Todo está organizado en la barra inferior para que encuentres cada módulo en un toque.',
      tips: [
        '<b>Inicio:</b> resumen de tus ventas del día, ganancias, caja y alertas importantes.',
        '<b>Ventas:</b> factura en segundos, lleva cuentas por cobrar y comparte tickets por WhatsApp.',
        '<b>Inventario:</b> crea tus productos, arma combos, ajusta existencias y genera tu catálogo.',
        '<b>Barra superior:</b> consulta la tasa del día, usa el buscador rápido (lupa) o abre esta guía (?) cuando quieras.'
      ]
    },
    {
      badge: 'Paso clave',
      title: '1. Crea tus productos y categorías',
      icon: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
      desc: 'Al entrar en Inventario verás directamente la pestaña Productos para registrar tu mercancía o servicios.',
      tips: [
        'Toca el botón <b>+ Nuevo producto</b> (arriba o abajo a la derecha).',
        '¿Te falta una categoría? Toca el botón <b>+</b> junto a Categoría para crearla al instante sin salir del formulario.',
        'Coloca tu <b>costo</b> y <b>precio de venta</b> para ver tu margen de ganancia automático.',
        'Si el producto es perecedero, marca <b>Maneja fecha de vencimiento</b>; si no vence, déjalo desmarcado.'
      ],
      action: {label: 'Ir a Productos ahora', fn: () => { SUB.inv = 'productos'; go('inventario'); }}
    },
    {
      badge: 'Control de stock',
      title: '2. Carga tus existencias iniciales',
      icon: '<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 016 0"/>',
      desc: 'Una vez creados tus productos, registra cuántas unidades tienes disponibles.',
      tips: [
        '<b>Existencias (Inventario &gt; Existencias):</b> toca <i>Ajustar</i> en cualquier producto o usa <b>Ajuste masivo</b> para actualizar varios a la vez.',
        '<b>Si ya venías operando:</b> usa <b>Saldos iniciales (Apertura)</b> para cargar tu inventario y caja de arranque.',
        '<b>Cuando compres mercancía:</b> regístrala en <b>Más &gt; Compras</b> para sumar stock y actualizar el costo promedio automáticamente.'
      ],
      action: {label: 'Ir a Existencias', fn: () => { SUB.inv = 'stock'; go('inventario'); }}
    },
    {
      badge: 'Vende más rápido',
      title: '3. Registra ventas y envía tickets',
      icon: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
      desc: 'En la pestaña Ventas puedes cobrar en pocos segundos desde el teléfono o computador.',
      tips: [
        'Toca un <b>producto rápido</b>, búscalo por nombre o usa el ícono de cámara para <b>escanear su código de barras</b>.',
        'Toca una cuenta en <b>Cobro rápido</b> para marcar el pago completo en 1 toque, o agrega pagos parciales/mixtos.',
        'Si no agregas pago, la venta queda automáticamente en <b>Por cobrar (crédito)</b>.',
        'Al guardar, envía el ticket como <b>foto o texto por WhatsApp</b> o imprímelo (si usas impresora térmica Bluetooth, activa <b>RawBT</b> en Configuración &gt; Módulos).',
        '<b>¿Trabajas por encargo?</b> Activa <b>Pedidos y encargos</b> en Configuración &gt; Módulos para llevar abonos, fechas de entrega y estados.'
      ],
      action: {label: 'Ir a Nueva venta', fn: () => { SUB.ven = 'nueva'; go('ventas'); }}
    },
    {
      badge: 'Más herramientas',
      title: '4. Combos, Precios y Catálogo',
      icon: '<path d="M12 2l3 7h7l-5.5 4.2L18.5 21 12 16.8 5.5 21l2-7.8L2 9h7z"/>',
      desc: 'Ahorra tiempo con promociones, ajustes de precios y catálogo listo para clientes.',
      tips: [
        '<b>Combos (Inventario &gt; Combos):</b> agrupa varios productos en un precio promocional; al venderse, el stock de cada producto se descuenta solo.',
        '<b>Precios (Inventario &gt; Precios):</b> sube precios por porcentaje o fija un margen objetivo para varios productos a la vez.',
        '<b>Catálogo y Etiquetas:</b> comparte catálogos profesionales por WhatsApp y, si necesitas códigos de barras propios, activa <b>Etiquetas</b> en Configuración &gt; Módulos.'
      ],
      action: {label: 'Ir a Combos', fn: () => { SUB.inv = 'combos'; go('inventario'); }}
    },
    {
      badge: 'Seguridad y orden',
      title: '5. Finanzas, PIN y Respaldo en Drive',
      icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      desc: 'Mantén tus números protegidos y tus datos seguros ante cualquier cambio de teléfono.',
      tips: [
        '<b>Más &gt; Finanzas:</b> registra gastos, controla tus cuentas y haz tu <b>Cierre de caja</b> diario.',
        '<b>Modo Empleado (candado arriba):</b> crea un PIN de dueño para ocultar costos, ganancias y ajustes cuando atienda un vendedor.',
        '<b>Respaldo en Google Drive:</b> conéctalo en <b>Configuración &gt; Respaldo y Google Drive</b> para guardar copias automáticas gratis.'
      ],
      action: (S.role !== 'vendedor') ? {label: 'Ir a Configuración', fn: () => { SUB.cfg = 'menu'; go('configuracion'); }} : null
    }
  ];

  let idx = Math.max(0, Math.min(steps.length - 1, Number(startStep) || 0));
  let m = $('#tutModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'tutModal';
    m.className = 'tut-modal hidden';
    document.body.appendChild(m);
  }

  const draw = () => {
    const st = steps[idx];
    const isLast = idx === steps.length - 1;
    m.innerHTML = `
      <div class="tut-bg" data-tclose="1"></div>
      <div class="tut-box" role="dialog" aria-modal="true" aria-label="Tutorial rápido">
        <div class="title-row">
          <span class="badge ok">${esc(st.badge)} · Paso ${idx + 1} de ${steps.length}</span>
          <button type="button" class="lnk" data-tclose="1">Cerrar</button>
        </div>
        <div class="tut-head">
          <div class="tut-icon"><svg class="ic" viewBox="0 0 24 24">${st.icon}</svg></div>
          <div>
            <h2 style="margin:0;font-size:1.18rem">${esc(st.title)}</h2>
            <p class="mut" style="margin:.2rem 0 0;font-size:.88rem">${esc(st.desc)}</p>
          </div>
        </div>
        <ul class="tut-tips">
          ${st.tips.map(t => `<li>${t}</li>`).join('')}
        </ul>
        ${st.action ? `<button type="button" class="btn ghost" id="tutAct" style="width:100%">${esc(st.action.label)} &rsaquo;</button>` : ''}
        <div class="tut-dots" id="tutDots">
          ${steps.map((_, i) => `<button type="button" data-tdot="${i}" class="${i === idx ? 'on' : ''}" aria-label="Ir al paso ${i + 1}"></button>`).join('')}
        </div>
        <div class="row" style="margin:0">
          ${idx > 0 ? '<button type="button" class="btn ghost" id="tutPrev">&lsaquo; Anterior</button>' : ''}
          <button type="button" class="btn" id="tutNext">${isLast ? '¡Listo, empezar!' : 'Siguiente &rsaquo;'}</button>
        </div>
      </div>`;

    m.onclick = (e) => { if (e.target.dataset.tclose) closeTutorial(); };
    if ($('#tutPrev')) $('#tutPrev').onclick = () => { idx--; draw(); };
    $('#tutNext').onclick = () => {
      if (isLast) { closeTutorial(); if (tab === 'inicio') render(); }
      else { idx++; draw(); }
    };
    if ($('#tutAct') && st.action) {
      $('#tutAct').onclick = () => { closeTutorial(); st.action.fn(); };
    }
    $('#tutDots').onclick = (e) => {
      const b = e.target.closest('[data-tdot]');
      if (b) { idx = Number(b.dataset.tdot); draw(); }
    };
  };

  draw();
  m.classList.remove('hidden');
}
