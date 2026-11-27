// Edición Emprendedores: Asistente de bienvenida (60 segundos), perfiles de negocio y módulos activables

const DEFAULT_MODS = {
  inventory: true,
  purchases: true,
  production: false,
  planning: false,
  quotes: true,
  marketing: true,
  payroll: false,
  catalog: true
};

const MOD_CATALOG = [
  {k: 'inventory', name: 'Inventario y existencias', desc: 'Control de stock, kardex, precios masivos y ajuste físico'},
  {k: 'purchases', name: 'Compras y proveedores', desc: 'Registro de compras, reposición sugerida y cuentas por pagar'},
  {k: 'production', name: 'Producción y fórmulas', desc: 'Recetas, lotes fabricados, insumos sin inventario y hoja de lote'},
  {k: 'planning', name: 'Planificación de producción', desc: 'Calcula si te alcanza la materia prima para varios lotes a la vez'},
  {k: 'quotes', name: 'Cotizaciones / Presupuestos', desc: 'Presupuestos profesionales en foto para convertir luego en venta'},
  {k: 'catalog', name: 'Catálogo de productos', desc: 'Genera catálogos en PDF, foto o texto WhatsApp por lista de precios'},
  {k: 'marketing', name: 'Marketing y seguimiento', desc: 'Clientes VIP, reactivación de inactivos y campañas por WhatsApp'},
  {k: 'payroll', name: 'Nómina y empleados', desc: 'Sueldos, adelantos y recibos de pago de tu personal'}
];

const BIZ_PROFILES = {
  tienda: {
    name: 'Tienda, Comercio o Bodega',
    desc: 'Compras y vendes productos terminados. Incluye inventario, catálogo, compras, escáner y caja.',
    mods: {inventory: true, purchases: true, production: false, planning: false, quotes: true, marketing: true, payroll: false, catalog: true}
  },
  fabricante: {
    name: 'Fabricante, Repostería o Taller',
    desc: 'Elaboras tus propios productos con recetas o fórmulas (comida, limpieza, artesanía, textil).',
    mods: {inventory: true, purchases: true, production: true, planning: true, quotes: true, marketing: true, payroll: false, catalog: true}
  },
  servicios: {
    name: 'Servicios o Independiente',
    desc: 'Barbería, técnico, delivery, diseño, asesorías. Enfocado en cobros, cotizaciones, gastos y clientes.',
    mods: {inventory: false, purchases: false, production: false, planning: false, quotes: true, marketing: true, payroll: false, catalog: false}
  },
  personalizado: {
    name: 'Personalizado',
    desc: 'Tú eliges exactamente qué módulos activar desde el primer momento.',
    mods: {inventory: true, purchases: true, production: true, planning: false, quotes: true, marketing: true, payroll: false, catalog: true}
  }
};

function hasMod(k) {
  const m = (typeof S !== 'undefined' && S.mods) ? S.mods : DEFAULT_MODS;
  return m[k] !== false;
}

async function loadModulesConfig() {
  try {
    const s = await q(db.from('settings').select('*').eq('id', 1).single());
    const mc = (s.modules_config && typeof s.modules_config === 'object') ? s.modules_config : {};
    S.mods = {...DEFAULT_MODS, ...mc};
    // Sincronizar con flags clásicos
    if (mc.planning === undefined && s.enable_planning !== undefined) S.mods.planning = s.enable_planning !== false;
    if (mc.payroll === undefined && s.enable_payroll !== undefined) S.mods.payroll = s.enable_payroll !== false;
    S.flags = {planning: !!S.mods.planning, payroll: !!S.mods.payroll};
    S.bimoneda = s.bimoneda !== false;
    S.baseCurrency = s.base_currency || 'USD';
    S.bizName = s.business_name || (typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.brandName : 'Gestor Emprendedor');
    const hdr = document.querySelector('header strong');
    if (hdr) hdr.textContent = S.bizName;
  } catch (e) {
    S.mods = {...DEFAULT_MODS};
    S.flags = {planning: !!S.mods.planning, payroll: !!S.mods.payroll};
    S.bimoneda = true;
    S.baseCurrency = 'USD';
  }
  applyModsUI();
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

// ---------- Pantalla: Configurar módulos activables ----------
async function viewModulos() {
  const s = await q(db.from('settings').select('*').eq('id', 1).single());
  const curMods = {...DEFAULT_MODS, ...(s.modules_config || {})};
  const bimoneda = s.bimoneda !== false;

  $('#view').innerHTML = `
    <form id="modForm" class="stack">
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

      <div class="card stack">
        <h2>Modo de moneda</h2>
        <label class="chk">
          <input type="checkbox" name="bimoneda" ${bimoneda ? 'checked' : ''}>
          <span><b>Modo Bimoneda Venezuela (USD + Bs con tasa BCV / manual)</b><br><small class="mut">Desactívalo si trabajas en una sola moneda y no necesitas convertir a bolívares.</small></span>
        </label>
      </div>

      <div class="row">
        <button class="btn" type="submit">Guardar cambios</button>
      </div>
    </form>`;

  $('#modForm').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements;
    const mods = {};
    MOD_CATALOG.forEach(m => { mods[m.k] = !!el['mod_' + m.k].checked; });
    if (!mods.production) mods.planning = false;
    const isBi = !!el.bimoneda.checked;
    run(async () => {
      await q(db.from('settings').update({
        modules_config: mods,
        enable_planning: mods.planning,
        enable_payroll: mods.payroll,
        bimoneda: isBi,
        ticket_show_bs: isBi,
        ticket_show_rate: isBi,
        updated_at: new Date().toISOString()
      }).eq('id', 1));
      await loadModulesConfig();
      if (typeof loadRate === 'function') await loadRate();
      toast('Módulos actualizados');
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
    loadDemo: true
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
            <b>Una sola moneda (USD)</b>
            <small>Ideal si cobras y llevas todo únicamente en dólares sin conversión a Bs.</small>
          </button>
        </div>
        ${ST.bimoneda ? `<label>Tasa inicial (Bs por 1 USD) — opcional
          <input id="obRate" type="number" step="0.0001" min="0.0001" value="${esc(ST.rate)}" placeholder="Dejar vacío para traer tasa BCV automática">
        </label>` : ''}
        <label class="chk">
          <input type="checkbox" id="obDemo" ${ST.loadDemo ? 'checked' : ''}>
          <span><b>Cargar 3 productos y 1 cliente de ejemplo</b><br><small class="mut">Útil para probar tu primera venta y ver el ticket en 10 segundos (puedes borrarlos luego).</small></span>
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
      });
    }
  };
  drawStep();
}
