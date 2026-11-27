// Centro de Configuración organizado, Reglas de venta, Metas y Resumen Ejecutivo
const DEFAULT_RULES = {
  monthly_sales_goal_usd: 0,
  default_credit_days: 7,
  default_doc_type: 'nota_entrega',
  max_discount_percent: 0,
  block_negative_stock: false,
  allow_seller_price_edit: true,
  min_margin_percent: 0,
  last_backup_at: null
};
const CFG_STATE = {q: ''};

function applyRulesObj(src) {
  const s = src || {};
  S.rules = {
    monthly_sales_goal_usd: Math.max(0, Number(s.monthly_sales_goal_usd || 0)),
    default_credit_days: Math.max(0, parseInt(s.default_credit_days ?? 7, 10) || 0),
    default_doc_type: s.default_doc_type === 'factura' ? 'factura' : 'nota_entrega',
    max_discount_percent: Math.max(0, Math.min(100, Number(s.max_discount_percent || 0))),
    block_negative_stock: !!s.block_negative_stock,
    allow_seller_price_edit: s.allow_seller_price_edit !== false,
    min_margin_percent: Math.max(0, Math.min(95, Number(s.min_margin_percent || 0))),
    last_backup_at: s.last_backup_at || null
  };
  try { localStorage.setItem('gdn_rules_v25', JSON.stringify(S.rules)); } catch (e) {}
  return S.rules;
}

async function loadBusinessRules() {
  try {
    const s = await q(db.from('settings').select('*').eq('id', 1).single());
    return applyRulesObj(s);
  } catch (e) {
    try {
      const saved = JSON.parse(localStorage.getItem('gdn_rules_v25') || 'null');
      if (saved) return applyRulesObj(saved);
    } catch (err) {}
    S.rules = {...DEFAULT_RULES};
    return S.rules;
  }
}

function getLastBackupDate(set) {
  let ls = null;
  try { ls = localStorage.getItem('gdn_last_backup_at'); } catch (e) {}
  const dbTs = set?.last_backup_at || S.rules?.last_backup_at || null;
  if (ls && dbTs) return ls > dbTs ? ls : dbTs;
  return dbTs || ls || null;
}

function addDaysISO(dateStr, days) {
  const d = new Date(String(dateStr || caracasDate()) + 'T12:00:00');
  d.setDate(d.getDate() + (parseInt(days, 10) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shareExecutiveSummaryWhatsApp(info) {
  const rate = S.rate || 0;
  const U = (n) => fmtCur(n);
  const goal = Number(S.rules?.monthly_sales_goal_usd || 0);
  const pct = goal > 0 ? Math.round((info.mesIngresos / goal) * 100) : null;
  const lines = [
    `*RESUMEN DEL DÍA — ${String(info.business || 'Mi negocio').toUpperCase()}*`,
    `Fecha: ${dmy(info.hoy)}${rate ? ` | Tasa: ${fmt(rate, 4)} ${secSym()}/${curLabel()}` : ''}`,
    '',
    '*HOY*',
    `• Vendido: ${U(info.hoyIngresos)} (${info.hoyVentas} ${info.hoyVentas === 1 ? 'venta' : 'ventas'})${rate ? ' · ' + fmt(info.hoyIngresos * rate) + ' Bs' : ''}`,
    `• Ganancia bruta hoy: ${U(info.hoyBruta)}`,
    '',
    '*ESTE MES*',
    `• Ventas acumuladas: ${U(info.mesIngresos)}${pct !== null ? ` (${pct}% de la meta de ${U(goal)})` : ''}`,
    `• Gastos del mes: ${U(info.mesGastos)}`,
    `• Ganancia neta del mes: ${U(info.mesNeta)}${info.mesNetaBs != null ? ' (' + fmt(info.mesNetaBs) + ' Bs hist.)' : ''}`,
    '',
    '*DINERO E INVENTARIO*',
    `• Disponible en cuentas: ${U(info.caja)}${info.cajaUsdReal != null ? ` (${fmtCur(info.cajaUsdReal)} + ${fmt(info.cajaVesReal)} Bs)` : (rate ? ' (' + fmt(info.caja * rate) + ' Bs)' : '')}`,
    `• Por cobrar: ${U(info.porCobrar)}`,
    `• Por pagar: ${U(info.porPagar)}`,
    `• Valor de inventario: ${U(info.inv)}${info.bajos ? ` (${info.bajos} por reponer)` : ''}`,
    `• Capital del negocio: ${U(info.cap)}`
  ];
  const text = lines.join('\n');
  window.open(`https://wa.me/${waDigits(info.phone || '')}?text=${encodeURIComponent(text)}`, '_blank');
}

// ---------- Subpantalla: Reglas de venta y Metas del negocio ----------
async function viewReglasYMetas() {
  const s = await q(db.from('settings').select('*').eq('id', 1).single());
  const r = applyRulesObj(s);
  $('#view').innerHTML = `
    <form id="rmForm" class="stack">
      <div class="card stack">
        <h2>Metas y Rentabilidad</h2>
        <p class="mut" style="margin:0">Define objetivos claros para medir el avance de tu negocio desde el Panel del Dueño y calcular precios sugeridos automáticamente.</p>
        <div class="grid">
          <label>Meta mensual de ventas (${esc(curLabel())})
            <input name="monthly_sales_goal_usd" type="number" step="0.01" min="0" value="${r.monthly_sales_goal_usd}" placeholder="Ej: 3000">
          </label>
          <label>Margen mínimo objetivo (%)
            <input name="min_margin_percent" type="number" step="0.5" min="0" max="95" value="${r.min_margin_percent}" placeholder="Ej: 30">
          </label>
        </div>
        <p class="mut" style="margin:0">Si defines un margen mínimo (ej: 30%), al crear o editar un producto verás el precio de venta sugerido con un toque y un aviso si estás vendiendo por debajo.</p>
      </div>

      <div class="card stack">
        <h2>Reglas al registrar ventas</h2>
        <div class="grid">
          <label>IVA en nuevas ventas
            <select name="default_doc_type">
              <option value="nota_entrega" ${r.default_doc_type === 'nota_entrega' ? 'selected' : ''}>Sin IVA por defecto (tilde desmarcado)</option>
              <option value="factura" ${r.default_doc_type === 'factura' ? 'selected' : ''}>Con IVA por defecto (tilde marcado)</option>
            </select>
          </label>
          <label>Días de crédito por defecto
            <input name="default_credit_days" type="number" step="1" min="0" max="365" value="${r.default_credit_days}">
          </label>
          <label>Tope máximo de descuento (%) para vendedores
            <input name="max_discount_percent" type="number" step="0.5" min="0" max="100" value="${r.max_discount_percent}">
          </label>
        </div>
        <p class="mut" style="margin:0">En ventas a crédito, la fecha límite se llenará sola sumando los días indicados. Un tope de descuento en 0 significa sin límite.</p>
      </div>

      <div class="card stack">
        <h2>Controles de seguridad para caja y equipo</h2>
        <label class="chk">
          <input type="checkbox" name="block_negative_stock" ${r.block_negative_stock ? 'checked' : ''}>
          <span><b>Bloquear ventas sin stock suficiente</b><br><small class="mut">Impide facturar productos físicos si no hay existencia disponible (en lugar de solo mostrar aviso).</small></span>
        </label>
        <label class="chk">
          <input type="checkbox" name="allow_seller_price_edit" ${r.allow_seller_price_edit ? 'checked' : ''}>
          <span><b>Permitir que vendedores modifiquen precios</b><br><small class="mut">Desmarca esta opción si solo los administradores pueden cambiar el precio de un producto al vender.</small></span>
        </label>
      </div>

      <div class="row">
        <button class="btn" type="submit">Guardar reglas y metas</button>
      </div>
    </form>`;

  $('#rmForm').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements;
    const obj = {
      monthly_sales_goal_usd: Math.max(0, num(el.monthly_sales_goal_usd.value) || 0),
      min_margin_percent: Math.max(0, Math.min(95, num(el.min_margin_percent.value) || 0)),
      default_doc_type: el.default_doc_type.value,
      default_credit_days: Math.max(0, parseInt(el.default_credit_days.value, 10) || 0),
      max_discount_percent: Math.max(0, Math.min(100, num(el.max_discount_percent.value) || 0)),
      block_negative_stock: !!el.block_negative_stock.checked,
      allow_seller_price_edit: !!el.allow_seller_price_edit.checked,
      updated_at: new Date().toISOString()
    };
    run(async () => {
      try {
        await q(db.from('settings').update(obj).eq('id', 1));
        applyRulesObj(obj);
        toast('Reglas y metas guardadas');
        render();
      } catch (err) {
        if (/monthly_sales_goal_usd|block_negative_stock|default_credit_days|max_discount_percent/i.test(err.message || '')) {
          applyRulesObj(obj);
          toast('Reglas y metas guardadas');
        } else {
          throw err;
        }
      }
    });
  };
}

// ---------- Pantalla: Acerca de, almacenamiento local y Soporte ----------
async function viewAcercaDe() {
  const nProds = (LDB.mem.products || []).filter(p => p.active !== false).length;
  const nSales = (LDB.mem.sales || []).length;
  const nParties = (LDB.mem.parties || []).filter(p => p.active !== false).length;
  const rev = LDB.meta?.rev || 0;
  const supPhone = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.supportWhatsApp) ? APP_CONFIG.supportWhatsApp : '';
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  let storageTxt = 'Disponible';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const mb = ((est.usage || 0) / (1024 * 1024)).toFixed(2);
      storageTxt = `${mb} MB usados en este dispositivo`;
    }
  } catch (e) {}

  $('#view').innerHTML = `
    <div class="card stack">
      <h2>${esc(typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.brandName : 'Gestor Emprendedor')}</h2>
      <div class="rl"><span>Edición</span><b>${esc(typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.edition : 'Emprendedores (Local)')}</b></div>
      <div class="rl"><span>Modo de trabajo</span><b class="pos">100% Local (funciona sin internet)</b></div>
      <div class="rl"><span>Espacio en teléfono</span><b>${esc(storageTxt)}</b></div>
      <div class="rl"><span>Productos / Ventas / Contactos</span><b>${nProds} / ${nSales} / ${nParties}</b></div>
      <div class="rl"><span>Revisión local</span><b>#${rev}</b></div>
      <div class="row">
        ${supPhone ? '<button class="btn" id="acSup">Soporte por WhatsApp</button>' : ''}
        <a class="btn ghost" href="./privacidad.html" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Política de Privacidad</a>
      </div>
    </div>

    <div class="card stack">
      <h2>Instalar como aplicación (PWA)</h2>
      ${isStandalone
        ? '<p class="pos" style="margin:0"><b>Ya estás usando la app instalada en tu dispositivo.</b></p>'
        : LDB.installPrompt
          ? '<p class="mut" style="margin:0">Instala la app directo en tu pantalla de inicio para abrirla en 1 toque, incluso sin internet.</p><button type="button" class="btn" id="acInstBtn">Instalar aplicación ahora</button>'
          : '<p class="mut" style="margin:0"><b>En Android (Chrome):</b> menú (⋮) &rarr; <i>Instalar aplicación</i>.<br><b>En iPhone (Safari):</b> Compartir &rarr; <i>Agregar a pantalla de inicio</i>.</p>'}
    </div>`;

  if ($('#acInstBtn')) $('#acInstBtn').onclick = () => LDB.triggerInstall();
  if (supPhone && $('#acSup')) {
    $('#acSup').onclick = () => window.open(`https://wa.me/${waDigits(supPhone)}?text=${encodeURIComponent('Hola, necesito soporte con ' + (APP_CONFIG.brandName || 'la app'))}`, '_blank');
  }
}

// ---------- Hub organizado de Configuración (Edición Emprendedores) ----------
const CFG_MAP = {
  modulos: {title: 'Módulos del negocio', fn: () => viewModulos()},
  tasa: {title: 'Tasa del dólar', fn: () => viewTasa()},
  negocio: {title: 'Información del negocio', fn: () => viewSettings('negocio')},
  reglas: {title: 'Reglas de venta y Metas', fn: () => viewReglasYMetas()},
  ticket: {title: 'Diseño del ticket', fn: () => viewSettings('ticket')},
  apertura: {title: 'Saldos iniciales (Apertura)', fn: () => viewApertura()},
  importar: {title: 'Importar datos (Excel / CSV)', fn: () => viewImportar()},
  respaldo: {title: 'Respaldo y Google Drive', fn: () => viewRespaldo()},
  empleado: {title: 'Modo Empleado y PIN', fn: () => viewModoEmpleado()},
  bitacora: {title: 'Bitácora de cambios', fn: () => viewBitacora()},
  suscripcion: {title: 'Mi Suscripción y Plan', fn: () => viewSuscripcion()},
  acerca: {title: 'App, espacio y soporte', fn: () => viewAcercaDe()},
  reinicio: {title: 'Comenzar desde 0', fn: () => viewReinicio()}
};

async function viewConfiguracion() {
  const cur = SUB.cfg;
  if (cur && cur !== 'menu' && CFG_MAP[cur]) {
    await CFG_MAP[cur].fn();
    $('#view').insertAdjacentHTML('afterbegin', `
      <div class="title-row" style="margin-bottom:.8rem">
        <h1 class="pt">${esc(CFG_MAP[cur].title)}</h1>
        <button class="lnk" id="cfgBack">&lsaquo; Configuración</button>
      </div>`);
    $('#cfgBack').onclick = () => { SUB.cfg = 'menu'; render(); };
    return;
  }

  SUB.cfg = 'menu';
  let set = {};
  try { set = await q(db.from('settings').select('*').eq('id', 1).single()); } catch (e) {}
  const r = applyRulesObj(set);
  const lastBk = getLastBackupDate(set);
  const bkDays = lastBk ? Math.floor((Date.now() - new Date(lastBk).getTime()) / 864e5) : null;
  const activeModCnt = MOD_CATALOG.filter(m => hasMod(m.k)).length;

  const activeControls = [
    r.monthly_sales_goal_usd > 0 ? 'Meta: ' + fmtCur(r.monthly_sales_goal_usd, 0) : '',
    r.block_negative_stock ? 'Stock estricto' : '',
    r.max_discount_percent > 0 ? 'Desc. máx ' + qty(r.max_discount_percent) + '%' : ''
  ].filter(Boolean);

  const GROUPS = [
    {
      title: 'Mi Negocio y Operación diaria',
      items: [
        {
          k: 'modulos', name: 'Módulos del negocio y moneda',
          desc: 'Activa o desactiva inventario, compras, producción, nómina, catálogo y modo bimoneda',
          pill: `${activeModCnt} de ${MOD_CATALOG.length} activos`,
          pillCls: 'ok'
        },
        ...(S.bimoneda !== false ? [{
          k: 'tasa', name: 'Tasa del dólar',
          desc: 'BCV automática, tasa manual e historial de cambios',
          pill: S.rate ? `${fmt(S.rate, 2)} Bs · ${S.mode === 'auto' ? 'Auto' : 'Manual'}` : 'Sin tasa',
          pillCls: S.rate ? 'ok' : 'out'
        }] : []),
        {
          k: 'negocio', name: 'Información del negocio',
          desc: 'Nombre, RIF, logo, teléfono, dirección y método de costo',
          pill: set.business_name ? set.business_name.slice(0, 18) : 'Configurar',
          pillCls: ''
        },
        {
          k: 'reglas', name: 'Reglas de venta y Metas',
          desc: 'Meta mensual, margen mínimo objetivo, días de crédito y control de stock',
          pill: activeControls.length ? activeControls[0] : 'Opcional',
          pillCls: activeControls.length ? 'ok' : ''
        },
        {
          k: 'ticket', name: 'Diseño del ticket y recibo',
          desc: 'Estilo moderno, minimalista o clásico, color de marca, datos de pago y firma',
          pill: set.ticket_style === 'clasico' ? 'Clásico' : set.ticket_style === 'minimal' ? 'Minimal' : 'Moderno',
          pillCls: ''
        }
      ]
    },
    {
      title: 'Tus Datos y Respaldos',
      items: [
        {
          k: 'respaldo', name: 'Respaldo y Google Drive',
          desc: (typeof GDRIVE !== 'undefined' && GDRIVE.state.connected)
            ? `Conectado a ${GDRIVE.state.email || 'Google Drive'} · copias automáticas y restauración`
            : 'Conecta tu Google Drive para respaldo automático gratis o guarda copia local',
          pill: (typeof GDRIVE !== 'undefined' && GDRIVE.state.connected)
            ? (Number(LDB.meta?.dirtySinceBackup || 0) > 0 ? `${LDB.meta.dirtySinceBackup} pend.` : 'Drive al día')
            : (bkDays === null ? 'Sin respaldo' : (bkDays === 0 ? 'Local hoy' : `Hace ${bkDays}d`)),
          pillCls: (typeof GDRIVE !== 'undefined' && GDRIVE.state.connected)
            ? (Number(LDB.meta?.dirtySinceBackup || 0) > 0 ? 'low' : 'ok')
            : (bkDays === null || bkDays > 7 ? 'low' : 'ok')
        },
        {
          k: 'apertura', name: 'Saldos iniciales (Apertura)',
          desc: 'Caja inicial, inventario base, deudas pendientes y capital de arranque',
          pill: set.apertura_completada ? 'Completada' : 'Pendiente',
          pillCls: set.apertura_completada ? 'ok' : 'low'
        },
        {
          k: 'importar', name: 'Importar datos (Excel / CSV)',
          desc: 'Carga masiva de productos, stock inicial, clientes y proveedores',
          pill: 'Excel / CSV',
          pillCls: ''
        }
      ]
    },
    {
      title: 'Suscripción, Control y Sistema',
      items: [
        {
          k: 'suscripcion', name: 'Mi Suscripción y Plan',
          desc: 'Estado de tu plan mensual, días restantes, ID de dispositivo y activación',
          pill: (typeof LIC !== 'undefined') ? LIC.getStatus().label : 'Activo',
          pillCls: (typeof LIC !== 'undefined') ? (!LIC.getStatus().active ? 'out' : LIC.getStatus().warn ? 'low' : 'ok') : 'ok'
        },
        {
          k: 'empleado', name: 'Modo Empleado y PIN del dueño',
          desc: 'Protege ganancias, costos y caja con PIN de 4 dígitos cuando atiende un vendedor',
          pill: (typeof getOwnerPin === 'function' && getOwnerPin()) ? 'PIN activo' : 'Configurar',
          pillCls: (typeof getOwnerPin === 'function' && getOwnerPin()) ? 'ok' : ''
        },
        {
          k: 'bitacora', name: 'Bitácora de cambios',
          desc: 'Historial de modificaciones importantes en ventas, productos y cuentas',
          pill: 'Auditoría',
          pillCls: ''
        },
        {
          k: 'acerca', name: 'App, espacio y soporte',
          desc: 'Uso de memoria local, instalación como app (PWA) y contacto de soporte',
          pill: '100% Local',
          pillCls: 'ok'
        },
        {
          k: 'reinicio', name: 'Comenzar desde 0',
          desc: 'Borra movimientos o reinicia todo para configurar otro negocio',
          pill: 'Peligro',
          pillCls: 'out',
          danger: true
        }
      ]
    }
  ];

  $('#view').innerHTML = `
    <div class="title-row" style="margin-bottom:.8rem">
      <h1 class="pt">Configuración</h1>
      <button class="lnk" data-go="mas">Volver a Más</button>
    </div>
    <input id="cfgQ" type="search" placeholder="Buscar ajuste (ej: módulos, tasa, meta, ticket, respaldo...)" value="${esc(CFG_STATE.q)}" style="margin-bottom:.9rem">
    <div id="cfgHub"></div>`;

  const drawHub = () => {
    const t = CFG_STATE.q.trim().toLowerCase();
    const html = GROUPS.map(g => {
      const items = g.items.filter(it => !t || (it.name + ' ' + it.desc + ' ' + g.title).toLowerCase().includes(t));
      if (!items.length) return '';
      return `<div class="cfg-sec">
        <h2 class="sec" style="margin-top:.9rem">${esc(g.title)}</h2>
        <div class="list">${items.map(it => `
          <button class="item cfg-item ${it.danger ? 'cfg-danger' : ''}" data-cfg="${it.k}">
            <span style="flex:1">
              <b>${esc(it.name)}</b>
              <small>${esc(it.desc)}</small>
            </span>
            <span class="row0" style="gap:.45rem;flex:none">
              ${it.pill ? `<span class="badge ${it.pillCls}">${esc(it.pill)}</span>` : ''}
              <span class="mut">&rsaquo;</span>
            </span>
          </button>`).join('')}</div>
      </div>`;
    }).join('');
    $('#cfgHub').innerHTML = html || '<p class="mut">No se encontró ninguna configuración con esa búsqueda.</p>';
  };

  drawHub();
  $('#cfgQ').oninput = (e) => { CFG_STATE.q = e.target.value; drawHub(); };
  $('#cfgHub').onclick = (e) => {
    const b = e.target.closest('[data-cfg]');
    if (!b) return;
    SUB.cfg = b.dataset.cfg;
    render();
  };
}
