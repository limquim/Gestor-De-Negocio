// Directorios organizados (Hub con buscador, filtro interno y Ficha / Estado de cuenta de contactos)
const ROLES = {admin: 'Administrador', vendedor: 'Vendedor', almacen: 'Almacén', contador: 'Contador'};
const DIRS = {
  terceros: {label: 'Clientes y proveedores', desc: 'Agenda comercial, RIF, teléfonos y estado de cuenta', table: 'parties', order: 'name', fields: [
    {k: 'name', l: 'Nombre o razón social', req: 1}, {k: 'rif', l: 'RIF o cédula'}, {k: 'phone', l: 'Teléfono (WhatsApp)', type: 'tel'},
    {k: 'email', l: 'Correo', type: 'email'}, {k: 'address', l: 'Dirección'},
    {k: 'is_customer', l: 'Es cliente', type: 'check', def: true}, {k: 'is_supplier', l: 'Es proveedor', type: 'check'}],
    title: r => r.name, sub: r => [r.is_customer && 'Cliente', r.is_supplier && 'Proveedor', r.rif, r.phone].filter(Boolean).join(' | ')},
  empleados: {label: 'Empleados', desc: 'Personal activo, cargos, frecuencia y sueldo base', table: 'employees', order: 'name', fields: [
    {k: 'name', l: 'Nombre completo', req: 1}, {k: 'id_number', l: 'Cédula'}, {k: 'phone', l: 'Teléfono (WhatsApp)', type: 'tel'},
    {k: 'position', l: 'Cargo'}, {k: 'pay_type', l: 'Cada cuánto se le paga', type: 'select', opts: {semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual'}},
    {k: 'salary_usd', l: 'Sueldo por período', type: 'number', req: 1}, {k: 'hire_date', l: 'Fecha de ingreso', type: 'date'}],
    title: r => r.name, sub: r => [r.position, r.pay_type, fmtCur(r.salary_usd)].filter(Boolean).join(' | ')},
  usuarios: {label: 'Usuarios y roles', desc: 'Accesos y permisos de administrador, vendedor, almacén y contador', table: 'profiles', order: 'created_at', all: 1, noAdd: 1, noDel: 1, fields: [
    {k: 'full_name', l: 'Nombre', req: 1}, {k: 'role', l: 'Rol', type: 'select', opts: ROLES}, {k: 'active', l: 'Usuario activo', type: 'check'}],
    title: r => r.full_name || 'Sin nombre', sub: r => ROLES[r.role] + (r.active ? '' : ' | inactivo')},
  categorias: {label: 'Categorías de producto', desc: 'Clasificación del inventario y control de rotación', table: 'product_categories', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'sells_regularly', l: 'Se vende con frecuencia (si no, no cuenta en "sin vender en 30 días")', type: 'check', def: true}],
    title: r => r.name, sub: r => r.sells_regularly === false ? 'Insumo / no venta regular' : 'Venta regular'},
  unidades: {label: 'Unidades de medida', desc: 'Unidades, peso y volumen (und, kg, L, g, ml)', table: 'units', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'symbol', l: 'Símbolo (kg, L, und)', req: 1},
    {k: 'kind', l: 'Tipo', type: 'select', opts: {unidad: 'Unidad', masa: 'Masa (base: gramo)', volumen: 'Volumen (base: mililitro)'}},
    {k: 'factor_to_base', l: 'Equivale a (g, ml o und)', type: 'number', req: 1}],
    title: r => `${r.name} (${r.symbol})`, sub: r => `1 ${r.symbol} = ${qty(r.factor_to_base)} de la unidad base`},
  listas: {label: 'Listas de precios', desc: 'Porcentajes automáticos (ej: Mayor, Distribuidor)', table: 'price_lists', order: 'name', fields: [
    {k: 'name', l: 'Nombre (ej: Mayor)', req: 1}, {k: 'adjust_percent', l: 'Ajuste sobre el precio de venta, en % (ej: -10 para 10% menos)', type: 'number', req: 1}],
    title: r => r.name, sub: r => (r.adjust_percent > 0 ? '+' : '') + qty(r.adjust_percent) + '% sobre el precio de venta'},
  plantillas: {label: 'Plantillas de mensajes', desc: 'Textos rápidos para campañas y cobros por WhatsApp', table: 'message_templates', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'body', l: 'Mensaje (usa {nombre} {producto} {negocio} {dias} {saldo})', type: 'textarea', req: 1}],
    title: r => r.name, sub: r => (r.body || '').slice(0, 65)},
  metodos: {label: 'Métodos de pago', desc: 'Efectivo, Pago móvil, Zelle, Binance, Cashea, etc.', table: 'payment_methods', order: 'name', fields: [
    {k: 'name', l: 'Nombre (ej: Pago móvil, Binance, Cheque)', req: 1}],
    title: r => r.name, sub: () => 'Se asigna a cada cuenta en Finanzas > Cuentas'},
  cuentas: {label: 'Tipos de cuenta', desc: 'Efectivo, Banco nacional, Divisas, Billetera digital', table: 'account_types', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}], title: r => r.name, sub: () => ''},
  gastos: {label: 'Tipos de gasto', desc: 'Categorías de gastos fijos, variables o costos de venta', table: 'expense_types', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'is_fixed', l: 'Es un gasto fijo', type: 'check'}, {k: 'in_sales_cost', l: 'Es costo de servicios de ventas (ej: delivery). Ya está en el costo de lo vendido, no se cuenta otra vez como gasto', type: 'check'}],
    title: r => r.name, sub: r => [r.is_fixed ? 'Gasto fijo' : 'Gasto variable', r.in_sales_cost ? 'Costo de venta' : ''].filter(Boolean).join(' | ')},
  impuestos: {label: 'Impuestos', desc: 'Alícuotas de IVA y valor por defecto en facturas', table: 'taxes', order: 'name', fields: [
    {k: 'name', l: 'Nombre', req: 1}, {k: 'percent', l: 'Porcentaje', type: 'number', req: 1}, {k: 'is_default', l: 'Aplicar por defecto', type: 'check'}],
    title: r => r.name, sub: r => `${qty(r.percent)}%${r.is_default ? ' | por defecto' : ''}`},
  monedas: {label: 'Monedas', desc: 'Divisas configuradas en el sistema', table: 'currencies', order: 'code', fields: [
    {k: 'code', l: 'Código (USD)', req: 1}, {k: 'name', l: 'Nombre', req: 1}, {k: 'symbol', l: 'Símbolo'}],
    title: r => `${r.code} - ${r.name}`, sub: r => r.is_base ? 'Moneda base' : ''}
};
const DIR_LABELS = Object.fromEntries(Object.entries(DIRS).map(([k, c]) => [k, c.label]));
const DIR_STATE = {hubQ: '', q: '', pType: 'all'};

const DIR_GROUPS = [
  {title: 'Contactos y Equipo', keys: ['terceros', 'empleados']},
  {title: 'Catálogo, Precios y Mensajes', keys: ['categorias', 'unidades', 'listas', 'plantillas']},
  {title: 'Finanzas y Parámetros', keys: ['metodos', 'cuentas', 'gastos', 'impuestos', 'monedas']}
];

function allowedDirKeys() {
  const ok = {vendedor: ['terceros', 'categorias', 'unidades', 'listas', 'plantillas'], almacen: ['terceros', 'unidades', 'categorias'], contador: ['terceros']}[S.role];
  return Object.keys(DIRS).filter(k => !ok || ok.includes(k));
}

// ---------- Hub organizado de Directorios ----------
async function viewDirectorios() {
  const allowed = allowedDirKeys();
  const cur = SUB.dir;
  if (cur && cur !== 'menu' && DIRS[cur] && allowed.includes(cur)) {
    await viewDir(cur);
    $('#view').insertAdjacentHTML('afterbegin', `
      <div class="title-row" style="margin-bottom:.8rem">
        <h1 class="pt">${esc(DIRS[cur].label)}</h1>
        <button class="lnk" id="dirBack">&lsaquo; Directorios</button>
      </div>`);
    $('#dirBack').onclick = () => { SUB.dir = 'menu'; DIR_STATE.q = ''; render(); };
    return;
  }

  SUB.dir = 'menu';
  const counts = {};
  let custCnt = 0, supCnt = 0;
  await Promise.all(allowed.map(async (k) => {
    const c = DIRS[k];
    try {
      let qb = db.from(c.table).select(k === 'terceros' ? 'id,is_customer,is_supplier' : 'id');
      if (!c.all) qb = qb.eq('active', true);
      const r = await q(qb);
      counts[k] = r.length;
      if (k === 'terceros') {
        custCnt = r.filter(x => x.is_customer).length;
        supCnt = r.filter(x => x.is_supplier).length;
      }
    } catch (e) { counts[k] = null; }
  }));

  $('#view').innerHTML = `
    <div class="title-row" style="margin-bottom:.8rem">
      <h1 class="pt">Directorios</h1>
      <button class="lnk" data-go="mas">Volver a Más</button>
    </div>
    <input id="dirHubQ" type="search" placeholder="Buscar directorio (ej: clientes, proveedores, categorías, impuestos...)" value="${esc(DIR_STATE.hubQ)}" style="margin-bottom:.9rem">
    <div id="dirHub"></div>`;

  const drawHub = () => {
    const t = DIR_STATE.hubQ.trim().toLowerCase();
    const html = DIR_GROUPS.map(g => {
      const items = g.keys.filter(k => allowed.includes(k)).map(k => ({k, ...DIRS[k]}))
        .filter(it => !t || (it.label + ' ' + it.desc + ' ' + g.title).toLowerCase().includes(t));
      if (!items.length) return '';
      return `<div class="cfg-sec">
        <h2 class="sec" style="margin-top:.9rem">${esc(g.title)}</h2>
        <div class="list">${items.map(it => {
          const pill = it.k === 'terceros' && counts[it.k] != null
            ? `${custCnt} cli · ${supCnt} prov`
            : (counts[it.k] != null ? `${counts[it.k]}` : '');
          return `<button class="item cfg-item" data-dir="${it.k}">
            <span style="flex:1">
              <b>${esc(it.label)}</b>
              <small>${esc(it.desc)}</small>
            </span>
            <span class="row0" style="gap:.45rem;flex:none">
              ${pill ? `<span class="badge">${esc(pill)}</span>` : ''}
              <span class="mut">&rsaquo;</span>
            </span>
          </button>`;
        }).join('')}</div>
      </div>`;
    }).join('');
    $('#dirHub').innerHTML = html || '<p class="mut">No se encontró ningún directorio con esa búsqueda.</p>';
  };
  drawHub();

  $('#dirHubQ').oninput = (e) => { DIR_STATE.hubQ = e.target.value; drawHub(); };
  $('#dirHub').onclick = (e) => {
    const b = e.target.closest('[data-dir]'); if (!b) return;
    SUB.dir = b.dataset.dir;
    DIR_STATE.q = '';
    render();
  };
}

// ---------- Vista genérica de un directorio (con búsqueda interna y ficha para clientes/proveedores) ----------
async function viewDir(key) {
  const c = DIRS[key];
  let qb = db.from(c.table).select('*');
  if (!c.all) qb = qb.eq('active', true);
  const rows = await q(qb.order(c.order));
  const isParties = key === 'terceros';

  let debtMap = {};
  if (isParties) {
    try {
      const [dc, cp] = await Promise.all([
        q(db.from('deudas_clientes').select('customer_id,debt_usd')),
        q(db.from('compras_resumen').select('supplier_id,total_usd,paid_usd,status').eq('status', 'registrada'))
      ]);
      dc.forEach(x => { if (x.customer_id != null) debtMap[x.customer_id] = {...(debtMap[x.customer_id] || {}), cxc: Number(x.debt_usd || 0)}; });
      cp.forEach(x => {
        if (x.supplier_id == null) return;
        const bal = Math.max(0, Number(x.total_usd || 0) - Number(x.paid_usd || 0));
        if (bal > 0.01) debtMap[x.supplier_id] = {...(debtMap[x.supplier_id] || {}), cxp: (debtMap[x.supplier_id]?.cxp || 0) + bal};
      });
    } catch (e) {}
  }

  $('#view').innerHTML = `
    <div class="card stack" style="margin-bottom:.8rem">
      <input id="dSearch" type="search" placeholder="Buscar en ${esc(c.label)}..." value="${esc(DIR_STATE.q)}">
      ${isParties ? `<div class="chips" id="dPF">
        <button type="button" data-pt="all" class="${DIR_STATE.pType === 'all' ? 'on' : ''}">Todos (${rows.length})</button>
        <button type="button" data-pt="cli" class="${DIR_STATE.pType === 'cli' ? 'on' : ''}">Clientes (${rows.filter(r => r.is_customer).length})</button>
        <button type="button" data-pt="prov" class="${DIR_STATE.pType === 'prov' ? 'on' : ''}">Proveedores (${rows.filter(r => r.is_supplier).length})</button>
        <button type="button" data-pt="debt" class="${DIR_STATE.pType === 'debt' ? 'on' : ''}">Con saldo</button>
      </div>` : ''}
      <small class="mut" id="dCount"></small>
    </div>
    <div class="list" id="dList"></div>
    ${c.noAdd ? '<p class="mut" style="margin-top:.8rem">Para crear un usuario nuevo usa Supabase (Authentication &gt; Users). Aquí le asignas su rol.</p>' : '<button class="fab" id="dAdd" aria-label="Agregar">+</button>'}`;

  const draw = () => {
    const t = DIR_STATE.q.trim().toLowerCase();
    const list = rows.filter(r => {
      if (isParties) {
        if (DIR_STATE.pType === 'cli' && !r.is_customer) return false;
        if (DIR_STATE.pType === 'prov' && !r.is_supplier) return false;
        if (DIR_STATE.pType === 'debt' && !debtMap[r.id]?.cxc && !debtMap[r.id]?.cxp) return false;
      }
      if (!t) return true;
      return (String(c.title(r) || '') + ' ' + String(c.sub(r) || '') + ' ' + String(r.rif || '') + ' ' + String(r.phone || '') + ' ' + String(r.email || '')).toLowerCase().includes(t);
    });
    $('#dCount').textContent = `Mostrando ${list.length} de ${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
    $('#dList').innerHTML = list.map(r => {
      const dm = isParties ? debtMap[r.id] : null;
      const right = dm && (dm.cxc || dm.cxp)
        ? `<span class="n" style="flex:none">
            ${dm.cxc ? `<b class="warn">Te debe ${fmtCur(dm.cxc)}</b>` : ''}
            ${dm.cxp ? `<small class="bad" style="display:block">Debes ${fmtCur(dm.cxp)}</small>` : ''}
          </span>`
        : '<span class="mut">&rsaquo;</span>';
      return `<button class="item" data-id="${r.id}"><span><b>${esc(c.title(r))}</b><small>${esc(c.sub(r))}</small></span>${right}</button>`;
    }).join('') || '<p class="mut">No hay registros con ese filtro.</p>';
  };
  draw();

  $('#dSearch').oninput = (e) => { DIR_STATE.q = e.target.value; draw(); };
  if (isParties && $('#dPF')) {
    $('#dPF').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      DIR_STATE.pType = b.dataset.pt;
      document.querySelectorAll('#dPF button').forEach(x => x.classList.toggle('on', x === b));
      draw();
    };
  }
  if (!c.noAdd) $('#dAdd').onclick = () => run(() => dirForm(c, null));
  $('#dList').onclick = (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const row = rows.find(r => String(r.id) === b.dataset.id);
    if (!row) return;
    if (isParties) run(() => partySheet(row, c));
    else run(() => dirForm(c, row));
  };
}

// ---------- Ficha completa y Estado de cuenta de Cliente / Proveedor ----------
async function partySheet(p, dirCfg) {
  const [sales, purchases, payTxt, set] = await Promise.all([
    p.is_customer ? q(db.from('ventas_resumen').select('*').eq('customer_id', p.id).order('id', {ascending: false}).limit(50)) : Promise.resolve([]),
    p.is_supplier ? q(db.from('compras_resumen').select('*').eq('supplier_id', p.id).order('id', {ascending: false}).limit(50)) : Promise.resolve([]),
    typeof getPaymentDetailsText === 'function' ? getPaymentDetailsText() : Promise.resolve(''),
    q(db.from('settings').select('business_name').eq('id', 1).single()).catch(() => ({business_name: 'Mi negocio'}))
  ]);

  const actSales = sales.filter(s => s.status !== 'anulada');
  const pendSales = actSales.filter(s => s.status === 'pendiente' && (Number(s.total_usd) - Number(s.paid_usd)) > 0.01);
  const totSold = actSales.reduce((a, s) => a + Number(s.total_usd || 0), 0);
  const cxc = pendSales.reduce((a, s) => a + Math.max(0, Number(s.total_usd || 0) - Number(s.paid_usd || 0)), 0);

  const actPurs = purchases.filter(x => x.status !== 'anulada');
  const pendPurs = actPurs.filter(x => x.status === 'registrada' && (Number(x.total_usd) - Number(x.paid_usd)) > 0.01);
  const totBought = actPurs.reduce((a, x) => a + Number(x.total_usd || 0), 0);
  const cxp = pendPurs.reduce((a, x) => a + Math.max(0, Number(x.total_usd || 0) - Number(x.paid_usd || 0)), 0);

  const badges = [p.is_customer ? '<span class="badge ok">Cliente</span>' : '', p.is_supplier ? '<span class="badge">Proveedor</span>' : ''].filter(Boolean).join(' ');
  const contactMeta = [p.rif && 'RIF/CI: ' + p.rif, p.phone && 'Tlf: ' + p.phone, p.email, p.address].filter(Boolean).join(' · ');

  openSheet(esc(p.name), `
    <div class="stack">
      <div>${badges}${contactMeta ? `<p class="mut" style="margin:.4rem 0 0">${esc(contactMeta)}</p>` : ''}</div>
      <div class="row" style="margin:0">
        <button type="button" class="btn ghost" id="psEdit">Editar datos</button>
        ${p.phone ? '<button type="button" class="btn ghost" id="psWa">Chat WhatsApp</button>' : ''}
        ${(cxc > 0.01 || cxp > 0.01) ? '<button type="button" class="btn" id="psStmt">Enviar estado de cuenta</button>' : ''}
      </div>

      ${p.is_customer ? `<div class="card" style="background:var(--bg);margin:0">
        <h2 style="font-size:.98rem">Cuenta como cliente</h2>
        <div class="rl"><span>Ventas registradas</span><b>${actSales.length} (${fmtCur(totSold)})</b></div>
        <div class="rl tot ${cxc > 0.01 ? 'neg' : 'pos'}"><span>Por cobrar</span><b>${fmtCur(cxc)}${S.rate && cxc > 0.01 ? ' (' + fmtSec(cxc * S.rate) + ')' : ''}</b></div>
        ${actSales.length ? `<div class="list" id="psSales" style="margin-top:.6rem">${actSales.slice(0, 8).map(s => {
          const bal = Math.max(0, Number(s.total_usd) - Number(s.paid_usd));
          return `<button type="button" class="item" data-sid="${s.id}">
            <span><b>Venta #${s.id}</b><small>${dmy(s.sale_date)}${s.due_date && bal > 0.01 ? ' · vence ' + dmy(s.due_date) : ''}</small></span>
            <span class="n"><b>${bal > 0.01 ? 'Debe ' + fmtCur(bal) : fmtCur(s.total_usd)}</b><small class="${bal > 0.01 ? 'warn' : 'in'}">${bal > 0.01 ? 'Pendiente' : 'Pagada'}</small></span>
          </button>`;
        }).join('')}</div>` : '<p class="mut" style="margin:.5rem 0 0">Sin ventas registradas aún.</p>'}
      </div>` : ''}

      ${p.is_supplier ? `<div class="card" style="background:var(--bg);margin:0">
        <h2 style="font-size:.98rem">Cuenta como proveedor</h2>
        <div class="rl"><span>Compras registradas</span><b>${actPurs.length} (${fmtCur(totBought)})</b></div>
        <div class="rl tot ${cxp > 0.01 ? 'neg' : 'pos'}"><span>Por pagar</span><b>${fmtCur(cxp)}${S.rate && cxp > 0.01 ? ' (' + fmtSec(cxp * S.rate) + ')' : ''}</b></div>
        ${actPurs.length ? `<div class="list" id="psPurs" style="margin-top:.6rem">${actPurs.slice(0, 8).map(x => {
          const bal = Math.max(0, Number(x.total_usd) - Number(x.paid_usd));
          return `<button type="button" class="item" data-pid="${x.id}">
            <span><b>Compra #${x.id}</b><small>${dmy(x.purchase_date)}${x.due_date && bal > 0.01 ? ' · vence ' + dmy(x.due_date) : ''}</small></span>
            <span class="n"><b>${bal > 0.01 ? 'Debes ' + fmtCur(bal) : fmtCur(x.total_usd)}</b><small class="${bal > 0.01 ? 'warn' : 'in'}">${bal > 0.01 ? 'Por pagar' : 'Pagada'}</small></span>
          </button>`;
        }).join('')}</div>` : '<p class="mut" style="margin:.5rem 0 0">Sin compras registradas aún.</p>'}
      </div>` : ''}
    </div>`);

  $('#psEdit').onclick = () => run(() => dirForm(dirCfg, p));
  if (p.phone && $('#psWa')) $('#psWa').onclick = () => window.open('https://wa.me/' + waDigits(p.phone), '_blank');

  if ($('#psStmt')) {
    $('#psStmt').onclick = () => {
      const bName = String(set?.business_name || 'Mi negocio').toUpperCase();
      const lines = [`*ESTADO DE CUENTA — ${bName}*`, `Contacto: ${p.name}`, `Fecha: ${dmy(caracasDate())}${S.rate ? ' | Tasa: ' + fmt(S.rate, 4) + ' ' + secSym() + '/' + curLabel() : ''}`, ''];
      if (cxc > 0.01) {
        lines.push('*Ventas pendientes por pagar:*');
        pendSales.forEach(s => {
          const bal = Math.max(0, Number(s.total_usd) - Number(s.paid_usd));
          lines.push(`• Venta #${s.id} (${dmy(s.sale_date)}): ${fmtCur(bal)}${s.due_date ? ' [vence ' + dmy(s.due_date) + ']' : ''}`);
        });
        lines.push(`*Total pendiente: ${fmtCur(cxc)}*${S.rate ? ' (' + fmtSec(cxc * S.rate) + ' hoy)' : ''}`);
        if (payTxt) lines.push('', payTxt);
      } else if (cxp > 0.01) {
        lines.push('*Facturas / Compras pendientes de pago:*');
        pendPurs.forEach(x => {
          const bal = Math.max(0, Number(x.total_usd) - Number(x.paid_usd));
          lines.push(`• Compra #${x.id} (${dmy(x.purchase_date)}): ${fmtCur(bal)}${x.due_date ? ' [vence ' + dmy(x.due_date) + ']' : ''}`);
        });
        lines.push(`*Total por pagar: ${fmtCur(cxp)}*${S.rate ? ' (' + fmtSec(cxp * S.rate) + ' hoy)' : ''}`);
      }
      window.open(`https://wa.me/${waDigits(p.phone || '')}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
    };
  }

  if ($('#psSales')) {
    $('#psSales').onclick = (e) => {
      const b = e.target.closest('[data-sid]');
      if (b && typeof saleSheet === 'function') run(() => saleSheet(+b.dataset.sid));
    };
  }
  if ($('#psPurs')) {
    $('#psPurs').onclick = (e) => {
      const b = e.target.closest('[data-pid]');
      if (b && typeof purchaseSheet === 'function') run(() => purchaseSheet(+b.dataset.pid));
    };
  }
}

async function dirForm(c, row) {
  const v = (f) => row ? row[f.k] : f.def;
  let extraHtml = '';
  let plists = [];
  if (c.table === 'parties') {
    plists = await db.from('price_lists').select('id,name,adjust_percent').eq('active', true).order('name').then(r => r.error ? [] : (r.data || []));
    if (plists.length) {
      extraHtml = `<label>Lista de precios predeterminada (opcional)<select name="price_list_id"><option value="">Precio normal (0%)</option>${plists.map(l => `<option value="${l.id}" ${String(row?.price_list_id || '') === String(l.id) ? 'selected' : ''}>${esc(l.name)} (${+l.adjust_percent > 0 ? '+' : ''}${qty(l.adjust_percent)}%)</option>`).join('')}</select></label>`;
    }
  }
  const fields = c.fields.map(f => {
    if (f.type === 'check') return `<label class="chk"><input type="checkbox" name="${f.k}" ${v(f) ? 'checked' : ''}> ${f.l}</label>`;
    if (f.type === 'textarea') return `<label>${f.l}<textarea name="${f.k}" rows="5" ${f.req ? 'required' : ''}>${esc(v(f) ?? '')}</textarea></label>`;
    if (f.type === 'select') return `<label>${f.l}<select name="${f.k}">${Object.entries(f.opts).map(([k, t]) => `<option value="${k}" ${v(f) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    return `<label>${f.l}<input name="${f.k}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="0.0001"' : ''} value="${esc(v(f) ?? '')}" ${f.req ? 'required' : ''}></label>`;
  }).join('');
  openSheet(row ? 'Editar ' + c.label.toLowerCase() : 'Nuevo registro', `<form id="dForm" class="stack">${fields}${extraHtml}<div class="row"><button class="btn" type="submit">Guardar</button>${row && !c.noDel ? '<button type="button" class="btn ghost" id="dDel">Desactivar</button>' : ''}</div></form>`);
  $('#dForm').onsubmit = (e) => {
    e.preventDefault();
    const el = e.target.elements, obj = {};
    c.fields.forEach(f => { const x = el[f.k]; obj[f.k] = f.type === 'check' ? x.checked : f.type === 'number' ? +x.value : (x.value.trim() || null); });
    if (c.table === 'parties' && el.price_list_id) obj.price_list_id = +el.price_list_id.value || null;
    run(async () => {
      try {
        await q(row ? db.from(c.table).update(obj).eq('id', row.id) : db.from(c.table).insert(obj));
      } catch (err) {
        if (/price_list_id/i.test(err.message || '')) {
          delete obj.price_list_id;
          await q(row ? db.from(c.table).update(obj).eq('id', row.id) : db.from(c.table).insert(obj));
        } else {
          throw err;
        }
      }
      if (c.table === 'payment_methods') await loadMethods();
      if (c.table === 'currencies' && typeof loadModulesConfig === 'function') await loadModulesConfig();
      closeSheet(); toast('Guardado'); render();
    });
  };
  if (row && !c.noDel) $('#dDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar este registro?')) return;
    await q(db.from(c.table).update({active: false}).eq('id', row.id)); if (c.table === 'payment_methods') await loadMethods(); closeSheet(); toast('Desactivado'); render();
  });
}

// Datos del negocio y personalizador avanzado de tickets (tabla settings)
async function viewSettings(kind) {
  const s = await q(db.from('settings').select('*').eq('id', 1).single());

  if (kind === 'negocio') {
    const F = [['business_name', 'Nombre del negocio'], ['business_rif', 'RIF'], ['business_phone', 'Teléfono'], ['business_email', 'Correo'], ['business_address', 'Dirección']];
    const inputs = F.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(s[k] ?? '')}"></label>`).join('');
    const extra = `<label class="chk"><input type="checkbox" name="enable_product_photos" ${s.enable_product_photos ? 'checked' : ''}> Permitir fotos en los productos</label>
      <label>Logo del negocio<input name="logo" type="file" accept="image/*"></label>${s.logo_data ? `<img class="thumb big" src="${s.logo_data}" alt=""><label class="chk"><input type="checkbox" name="rmlogo"> Quitar el logo actual</label>` : ''}<label class="chk"><input type="checkbox" name="ticket_show_logo" ${s.ticket_show_logo ? 'checked' : ''}> Mostrar el logo en el ticket en foto</label>
      <label>Costo automático de los productos<select name="cost_method"><option value="avg" ${(s.cost_method || 'avg') === 'avg' ? 'selected' : ''}>Costo promedio</option><option value="last" ${s.cost_method === 'last' ? 'selected' : ''}>Costo de la última compra o fabricación</option><option value="max" ${s.cost_method === 'max' ? 'selected' : ''}>Costo más alto</option></select></label>
      <b class="mut">Módulos opcionales</b>
      <label class="chk"><input type="checkbox" name="enable_planning" ${s.enable_planning === false ? '' : 'checked'}> Planificación de fabricación (¿alcanza el material para todo?)</label>
      <label class="chk"><input type="checkbox" name="enable_payroll" ${s.enable_payroll === false ? '' : 'checked'}> Nómina de pagos</label>`;
    $('#view').innerHTML = `<form id="sForm" class="card stack"><h2>Información del negocio</h2>${inputs}${extra}<button class="btn" type="submit">Guardar</button></form>`;
    $('#sForm').onsubmit = (e) => {
      e.preventDefault();
      const el = e.target.elements, obj = {updated_at: new Date().toISOString()};
      F.forEach(([k]) => obj[k] = el[k].value.trim() || null);
      obj.enable_product_photos = el.enable_product_photos.checked;
      run(async () => {
        obj.ticket_show_logo = el.ticket_show_logo.checked;
        obj.cost_method = el.cost_method.value; obj.enable_planning = el.enable_planning.checked; obj.enable_payroll = el.enable_payroll.checked;
        if (el.rmlogo?.checked) obj.logo_data = null;
        const lf = el.logo.files[0]; if (lf) obj.logo_data = await logoDataUrl(lf);
        await q(db.from('settings').update(obj).eq('id', 1));
        if (obj.cost_method !== (s.cost_method || 'avg')) { await q(db.rpc('recalcular_costos')); }
        await loadFlags(); toast('Guardado'); render();
      });
    };
    return;
  }

  // ---------- Personalizador avanzado de tickets y recibos ----------
  const cfg = typeof ticketCfg === 'function' ? ticketCfg(s) : {};
  const paySample = (typeof getPaymentDetailsText === 'function' ? await getPaymentDetailsText() : '') || 'Pago Móvil: Banco Venezuela (0102)\nTlf: 0414-0000000 · CI: V-12345678';
  const PALETTE = ['#0b7285', '#1b7f4b', '#1e40af', '#7c3aed', '#b4381a', '#1f2937'];
  let prevDocKind = 'nota';

  $('#view').innerHTML = `
    <form id="sForm" class="stack">
      <div class="card stack">
        <h2>1. Estilo visual y formato</h2>
        <div class="grid">
          <label>Estilo del recibo en foto
            <select name="ticket_style">
              <option value="moderno" ${(s.ticket_style || 'moderno') === 'moderno' ? 'selected' : ''}>Moderno (tarjeta con color)</option>
              <option value="minimal" ${s.ticket_style === 'minimal' ? 'selected' : ''}>Minimalista (limpio y elegante)</option>
              <option value="clasico" ${s.ticket_style === 'clasico' ? 'selected' : ''}>Clásico (estilo impresora térmica)</option>
            </select>
          </label>
          <label>Ancho de impresión térmica
            <select name="ticket_paper">
              <option value="58mm" ${s.ticket_paper === '58mm' ? 'selected' : ''}>58 mm (portátil)</option>
              <option value="80mm" ${s.ticket_paper === '80mm' ? 'selected' : ''}>80 mm (caja estándar)</option>
            </select>
          </label>
        </div>

        <label>Color principal del recibo
          <div class="color-picks">
            ${PALETTE.map(c => `<button type="button" class="cswatch" data-col="${c}" style="background:${c}" title="${c}"></button>`).join('')}
            <input name="ticket_color" type="color" value="${esc(s.ticket_color || '#0b7285')}" style="width:48px;height:38px;margin:0;flex:none">
          </div>
        </label>

        <div class="grid">
          <label>Moneda en el ticket
            <select name="currency_mode">
              <option value="both" ${cfg.currency_mode === 'both' ? 'selected' : ''}>${esc(curLabel())} arriba y ${esc(secSym())} abajo</option>
              <option value="bs_first" ${cfg.currency_mode === 'bs_first' ? 'selected' : ''}>${esc(secSym())} arriba y ${esc(curLabel())} abajo</option>
              <option value="usd" ${cfg.currency_mode === 'usd' ? 'selected' : ''}>Solo moneda principal (${esc(curLabel())})</option>
              <option value="bs" ${cfg.currency_mode === 'bs' ? 'selected' : ''}>Solo bolívares (${esc(secSym())})</option>
            </select>
          </label>
          <label>Tamaño de texto
            <select name="font_scale">
              <option value="sm" ${cfg.font_scale === 'sm' ? 'selected' : ''}>Compacto</option>
              <option value="normal" ${(cfg.font_scale || 'normal') === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="lg" ${cfg.font_scale === 'lg' ? 'selected' : ''}>Grande (fácil lectura)</option>
            </select>
          </label>
        </div>

        <div class="grid">
          <label>Posición del logo
            <select name="logo_pos">
              <option value="left" ${cfg.logo_pos !== 'center' ? 'selected' : ''}>A la izquierda</option>
              <option value="center" ${cfg.logo_pos === 'center' ? 'selected' : ''}>Centrado arriba</option>
            </select>
          </label>
          <label>Tamaño del logo
            <select name="logo_size">
              <option value="sm" ${cfg.logo_size === 'sm' ? 'selected' : ''}>Pequeño</option>
              <option value="md" ${(cfg.logo_size || 'md') === 'md' ? 'selected' : ''}>Mediano</option>
              <option value="lg" ${cfg.logo_size === 'lg' ? 'selected' : ''}>Grande</option>
            </select>
          </label>
        </div>
      </div>

      <div class="card stack">
        <h2>2. Títulos y mensajes personalizados</h2>
        <div class="grid">
          <label>Título para Nota de entrega<input name="title_nota" value="${esc(cfg.title_nota || 'NOTA DE ENTREGA')}" placeholder="Ej: NOTA DE ENTREGA"></label>
          <label>Título para Factura<input name="title_factura" value="${esc(cfg.title_factura || 'FACTURA')}" placeholder="Ej: FACTURA"></label>
          <label>Título para Cotización<input name="title_cotizacion" value="${esc(cfg.title_cotizacion || 'COTIZACIÓN')}" placeholder="Ej: PRESUPUESTO"></label>
        </div>
        <label>Texto debajo del nombre (eslogan u horario)<input name="ticket_header" value="${esc(s.ticket_header ?? '')}" placeholder="Ej: Productos de limpieza al mayor y detal"></label>
        <label>Redes sociales / web (opcional)<input name="social" value="${esc(cfg.social || '')}" placeholder="Ej: Instagram: @minegocio · Lun-Sáb 8am-6pm"></label>
        <label>Mensaje al final del recibo<textarea name="ticket_footer" rows="2" placeholder="Ej: ¡Gracias por su compra! Cambios dentro de 48h con este recibo.">${esc(s.ticket_footer ?? '')}</textarea></label>
      </div>

      <div class="card stack">
        <h2>3. Qué bloques mostrar</h2>
        <div class="grid">
          <label class="chk"><input type="checkbox" name="ticket_show_logo" ${s.ticket_show_logo ? 'checked' : ''}> Mostrar logo</label>
          <label class="chk"><input type="checkbox" name="ticket_show_info" ${s.ticket_show_info === false ? '' : 'checked'}> RIF, teléfono y dirección</label>
          <label class="chk"><input type="checkbox" name="ticket_show_customer" ${s.ticket_show_customer === false ? '' : 'checked'}> Datos del cliente</label>
          <label class="chk"><input type="checkbox" name="show_time" ${cfg.show_time === false ? '' : 'checked'}> Mostrar hora exacta</label>
          <label class="chk"><input type="checkbox" name="show_sku" ${cfg.show_sku ? 'checked' : ''}> Código (SKU) del producto</label>
          <label class="chk"><input type="checkbox" name="show_unit_price" ${cfg.show_unit_price === false ? '' : 'checked'}> Precios unitarios y subtotal</label>
          <label class="chk"><input type="checkbox" name="ticket_show_rate" ${s.ticket_show_rate ? 'checked' : ''}> Tasa de cambio del día</label>
          <label class="chk"><input type="checkbox" name="ticket_show_payments" ${s.ticket_show_payments === false ? '' : 'checked'}> Pagos y saldo pendiente</label>
          <label class="chk"><input type="checkbox" name="show_status" ${cfg.show_status === false ? '' : 'checked'}> Etiqueta (PAGADO / POR COBRAR)</label>
          <label class="chk"><input type="checkbox" name="show_notes" ${cfg.show_notes === false ? '' : 'checked'}> Notas de la venta</label>
        </div>
      </div>

      <div class="card stack">
        <h2>4. Datos bancarios y espacio de firma</h2>
        <label>Incluir tus datos de pago (Pago Móvil / Cuentas) en el recibo
          <select name="show_pay_details">
            <option value="none" ${cfg.show_pay_details === 'none' ? 'selected' : ''}>No mostrar en el recibo</option>
            <option value="pending" ${cfg.show_pay_details === 'pending' ? 'selected' : ''}>Solo en cotizaciones y ventas por cobrar</option>
            <option value="always" ${cfg.show_pay_details === 'always' ? 'selected' : ''}>Mostrar siempre</option>
          </select>
        </label>
        <p class="mut" style="margin:0">Usa los datos configurados en cada cuenta dentro de <b>Finanzas &gt; Cuentas</b>.</p>
        <label class="chk"><input type="checkbox" name="show_signature" ${cfg.show_signature ? 'checked' : ''}> Agregar línea de firma al pie (ideal para despachos o crédito)</label>
        <label>Texto debajo de la línea de firma<input name="signature_label" value="${esc(cfg.signature_label || 'Recibido conforme / Firma')}"></label>
      </div>

      <div class="row">
        <button class="btn" type="submit">Guardar diseño del ticket</button>
        <button type="button" class="btn ghost" id="tkReset">Restaurar valores base</button>
      </div>
    </form>

    <div class="card stack" style="margin-top:1rem">
      <div class="title-row">
        <h2>Vista previa en vivo</h2>
        <div class="chips" id="tkPrevKind">
          <button type="button" data-pk="nota" class="on">Nota</button>
          <button type="button" data-pk="factura">Factura</button>
          <button type="button" data-pk="cotizacion">Cotización</button>
        </div>
      </div>
      <div id="tkPrev"><p class="mut">Generando vista previa...</p></div>
    </div>`;

  const f = $('#sForm'), e0 = f.elements, rate = S.rate || 100;

  const readConfig = () => {
    const tc = {
      title_nota: e0.title_nota.value.trim() || 'NOTA DE ENTREGA',
      title_factura: e0.title_factura.value.trim() || 'FACTURA',
      title_cotizacion: e0.title_cotizacion.value.trim() || 'COTIZACIÓN',
      currency_mode: e0.currency_mode.value,
      logo_pos: e0.logo_pos.value,
      logo_size: e0.logo_size.value,
      font_scale: e0.font_scale.value,
      show_sku: e0.show_sku.checked,
      show_unit_price: e0.show_unit_price.checked,
      show_time: e0.show_time.checked,
      show_status: e0.show_status.checked,
      show_notes: e0.show_notes.checked,
      show_signature: e0.show_signature.checked,
      signature_label: e0.signature_label.value.trim() || 'Recibido conforme / Firma',
      show_pay_details: e0.show_pay_details.value,
      social: e0.social.value.trim()
    };
    return {
      ...s,
      ticket_header: e0.ticket_header.value.trim() || null,
      ticket_footer: e0.ticket_footer.value.trim() || null,
      ticket_style: e0.ticket_style.value,
      ticket_color: e0.ticket_color.value,
      ticket_paper: e0.ticket_paper.value,
      ticket_show_rate: e0.ticket_show_rate.checked,
      ticket_show_bs: tc.currency_mode !== 'usd',
      ticket_show_logo: e0.ticket_show_logo.checked,
      ticket_show_info: e0.ticket_show_info.checked,
      ticket_show_customer: e0.ticket_show_customer.checked,
      ticket_show_payments: e0.ticket_show_payments.checked,
      ticket_config: tc
    };
  };

  let tmr;
  const paint = () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const cur = readConfig(), tc = cur.ticket_config;
      const isFact = prevDocKind === 'factura', isQuote = prevDocKind === 'cotizacion';
      const sub = 12.5, tax = isFact ? 2.0 : 0, tot = sub + tax;
      const sample = {
        kind: prevDocKind,
        title: isFact ? tc.title_factura : isQuote ? tc.title_cotizacion : tc.title_nota,
        number: 128,
        date: caracasDate(),
        created_at: new Date().toISOString(),
        valid: isQuote ? (typeof addDaysISO === 'function' ? addDaysISO(caracasDate(), 7) : caracasDate()) : null,
        customer: 'María Pérez',
        phone: '0414-0000000',
        items: [
          {name: 'Detergente líquido 1L', sku: 'DET-01', qty: 2, price: 3},
          {name: 'Cloro concentrado 1L', sku: 'CLO-01', qty: 1, price: 2},
          {name: 'Jabón lavaplatos 500ml', sku: 'JAB-05', qty: 3, price: 1.5}
        ],
        subtotal: sub,
        discount: 0,
        tax,
        total: tot,
        rate,
        pays: isQuote ? [] : [{label: 'Efectivo', amount: 8, cur: 'USD'}],
        balance: isQuote ? 0 : Math.max(0, tot - 8),
        status: isQuote ? '' : 'POR COBRAR',
        notes: 'Entregar en la tarde.',
        quote: isQuote,
        payDetails: paySample
      };
      try {
        const txt = docText(sample, cur);
        const b = await docBlob(sample, txt, cur);
        if (!$('#tkPrev')) return;
        $('#tkPrev').innerHTML = `<img class="rimg" src="${URL.createObjectURL(b)}" alt="Vista previa del ticket">`;
      } catch (err) {
        if (!$('#tkPrev')) return;
        $('#tkPrev').innerHTML = '<p class="mut">No se pudo generar la vista previa.</p>';
      }
    }, 220);
  };

  f.querySelectorAll('.cswatch').forEach(btn => {
    btn.onclick = () => { e0.ticket_color.value = btn.dataset.col; paint(); };
  });
  $('#tkPrevKind').onclick = (e) => {
    const b = e.target.closest('[data-pk]'); if (!b) return;
    prevDocKind = b.dataset.pk;
    document.querySelectorAll('#tkPrevKind button').forEach(x => x.classList.toggle('on', x === b));
    paint();
  };
  $('#tkReset').onclick = () => {
    if (!confirm('¿Restaurar los valores por defecto del diseño de ticket?')) return;
    e0.ticket_style.value = 'moderno'; e0.ticket_color.value = '#0b7285'; e0.ticket_paper.value = '58mm';
    e0.currency_mode.value = 'both'; e0.font_scale.value = 'normal'; e0.logo_pos.value = 'left'; e0.logo_size.value = 'md';
    e0.title_nota.value = 'NOTA DE ENTREGA'; e0.title_factura.value = 'FACTURA'; e0.title_cotizacion.value = 'COTIZACIÓN';
    e0.show_sku.checked = false; e0.show_unit_price.checked = true; e0.show_time.checked = true;
    e0.show_status.checked = true; e0.show_notes.checked = true; e0.show_signature.checked = false;
    e0.show_pay_details.value = 'none'; e0.signature_label.value = 'Recibido conforme / Firma';
    paint();
  };

  f.addEventListener('input', paint);
  f.addEventListener('change', paint);
  paint();

  f.onsubmit = (e) => {
    e.preventDefault();
    const cur = readConfig();
    const baseObj = {
      ticket_header: cur.ticket_header,
      ticket_footer: cur.ticket_footer,
      ticket_paper: cur.ticket_paper,
      ticket_show_rate: cur.ticket_show_rate,
      ticket_show_bs: cur.ticket_show_bs,
      ticket_style: cur.ticket_style,
      ticket_color: cur.ticket_color,
      ticket_show_logo: cur.ticket_show_logo,
      ticket_show_info: cur.ticket_show_info,
      ticket_show_customer: cur.ticket_show_customer,
      ticket_show_payments: cur.ticket_show_payments,
      updated_at: new Date().toISOString()
    };
    run(async () => {
      try {
        await q(db.from('settings').update({...baseObj, ticket_config: cur.ticket_config}).eq('id', 1));
        toast('Diseño del ticket guardado');
      } catch (err) {
        if (/ticket_config/i.test(err.message || '')) {
          await q(db.from('settings').update(baseObj).eq('id', 1));
          toast('Diseño del ticket guardado');
        } else {
          throw err;
        }
      }
      render();
    });
  };
}
