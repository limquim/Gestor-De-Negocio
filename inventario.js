// Inventario v2: resumen, filtros, kardex por producto, conteo físico y ajustes valorados
const INV = {rows: [], q: '', type: 'all', low: false, exp: false};
const REF = {purchase: 'Compra', sale: 'Venta', production: 'Producción', apertura: 'Apertura', ajuste_masivo: 'Ajuste masivo'};
const refLabel = (m) => m.ref_type ? (REF[m.ref_type] ? `${REF[m.ref_type]}${m.ref_id ? ' #' + m.ref_id : ''}` : `${m.ref_type}${m.ref_id ? ' #' + m.ref_id : ''}`) : '-';
const fdate = (d) => new Date(d).toLocaleString('es-VE', {dateStyle: 'short', timeStyle: 'short'});

// Evalúa fecha de vencimiento opcional (devuelve null si el producto no maneja vencimiento)
function expiryBadge(isoDate, compact = false) {
  if (!isoDate) return null;
  const hoy = typeof caracasDate === 'function' ? caracasDate() : new Date().toISOString().slice(0, 10);
  const d1 = new Date(hoy + 'T12:00:00');
  const d2 = new Date(String(isoDate).slice(0, 10) + 'T12:00:00');
  if (isNaN(d2.getTime())) return null;
  const diff = Math.round((d2 - d1) / 86400000);
  const lblDate = typeof dmy === 'function' ? dmy(String(isoDate).slice(0, 10)) : String(isoDate).slice(0, 10);
  if (diff < 0) return {cls: 'bad', state: 'expired', days: diff, text: compact ? `Vencido (${lblDate})` : `Vencido el ${lblDate}`};
  if (diff === 0) return {cls: 'bad', state: 'soon', days: 0, text: `Vence hoy (${lblDate})`};
  if (diff <= 15) return {cls: 'warn', state: 'soon', days: diff, text: `Vence en ${diff} ${diff === 1 ? 'día' : 'días'} (${lblDate})`};
  return {cls: 'mut', state: 'ok', days: diff, text: `Vence: ${lblDate}`};
}

// Calcula cuántos combos se pueden armar con el stock actual de sus componentes
function comboAvail(combo, stMap, prodMap) {
  if (!combo || !combo.is_combo || !Array.isArray(combo.combo_items) || !combo.combo_items.length) return 0;
  let minAvail = Infinity;
  for (const ci of combo.combo_items) {
    const cp = prodMap ? prodMap[ci.product_id] : null;
    if (cp && (cp.is_service || cp.track_inventory === false)) continue;
    const req = Number(ci.quantity || 0);
    if (!(req > 0)) continue;
    const st = Number(stMap?.[ci.product_id] || 0);
    minAvail = Math.min(minAvail, Math.floor((st + 1e-9) / req));
  }
  return minAvail === Infinity ? null : Math.max(0, minAvail);
}

// Calcula el costo total de un combo sumando el costo real de sus componentes
function comboCost(combo, prodMap) {
  if (!combo || !combo.is_combo || !Array.isArray(combo.combo_items) || !combo.combo_items.length) {
    return Number(combo?.auto_cost_usd ?? combo?.avg_cost_usd ?? combo?.manual_cost_usd ?? 0);
  }
  let sum = 0;
  for (const ci of combo.combo_items) {
    const cp = prodMap ? prodMap[ci.product_id] : null;
    const uc = Number(cp?.auto_cost_usd ?? cp?.avg_cost_usd ?? cp?.manual_cost_usd ?? 0);
    sum += uc * Number(ci.quantity || 0);
  }
  return Math.round(sum * 10000) / 10000;
}

// Resume los componentes de un combo (ej: "2× Harina + 1× Aceite")
function comboSummaryText(combo, prodMap) {
  if (!combo || !Array.isArray(combo.combo_items) || !combo.combo_items.length) return '';
  return combo.combo_items.map(ci => {
    const nm = prodMap?.[ci.product_id]?.name || ('#' + ci.product_id);
    return `${qty(ci.quantity)}× ${nm}`;
  }).join(' + ');
}

// Devuelve un Set con IDs de productos que NO controlan inventario (insumos libres, servicios o combos)
async function getUntrackedIds() {
  try {
    const res = await db.from('products').select('id,is_service,is_combo,track_inventory').eq('active', true);
    const list = res.error ? [] : (res.data || []);
    return new Set(list.filter(p => p.track_inventory === false || p.is_service || p.is_combo).map(p => Number(p.id)));
  } catch (e) {
    return new Set();
  }
}

async function viewInventario2() {
  const [rawRows, moves, untrSet] = await Promise.all([
    q(db.from('stock_actual').select('*').order('name')),
    q(db.from('inventory_movements').select('movement_type,quantity,unit_cost_usd,ref_type,ref_id,notes,created_at,products(name)').order('created_at', {ascending: false}).limit(10)),
    getUntrackedIds()
  ]);
  const rows = rawRows.filter(x => !untrSet.has(Number(x.product_id)));
  INV.rows = rows;
  const valor = rows.reduce((a, x) => a + Number(x.valor_usd || 0), 0);
  const agotados = rows.filter(x => Number(x.stock) <= 0).length;
  const bajos = rows.filter(x => Number(x.stock) > 0 && x.bajo_minimo).length;
  const hasAnyExpiry = rows.some(x => !!x.expiry_date);
  const expAlert = rows.filter(x => { const eb = expiryBadge(x.expiry_date); return eb && (eb.state === 'expired' || eb.state === 'soon'); }).length;
  if (!hasAnyExpiry) INV.exp = false;
  const cats = [...new Map(rows.filter(x => x.category_id).map(x => [x.category_id, x.category])).entries()];
  const chips = cats.map(([k, v]) => `<button data-t="${k}">${esc(v)}</button>`).join('');
  const opts = rows.map(s => `<option value="${s.product_id}">${esc(s.name)} (${esc(s.unit)}) — Stock: ${qty(s.stock)}</option>`).join('');
  const mrows = moves.map(m => `<tr><td>${fdate(m.created_at)}</td><td>${esc(m.products?.name)}</td><td>${MOV[m.movement_type]}</td>
    <td>${refLabel(m)}</td><td class="n ${m.quantity > 0 ? 'in' : 'outq'}">${m.quantity > 0 ? '+' : ''}${qty(m.quantity)}</td>
    <td class="n">${m.unit_cost_usd != null ? fmt(m.unit_cost_usd) : '-'}</td><td>${esc(m.notes)}</td></tr>`).join('');

  $('#view').innerHTML = `
  <div class="stats">
    <div class="stat"><span>Valor del inventario</span><b>${fmtCur(valor)}</b><span>${S.rate ? fmt(valor * S.rate) + ' Bs' : 'Sin tasa cargada'}</span></div>
    <div class="stat"><span>Productos activos</span><b>${rows.length}</b></div>
    <div class="stat warn"><span>Bajo el mínimo</span><b>${bajos}</b></div>
    <div class="stat bad"><span>Agotados</span><b>${agotados}</b></div>
    ${expAlert > 0 ? `<div class="stat bad"><span>Por vencer / vencidos</span><b>${expAlert}</b></div>` : ''}
  </div>
  ${['admin', 'contador'].includes(S.role || 'admin') ? `<div class="row" style="margin:0 0 .8rem"><button class="btn ghost" data-go="apertura">Configurar inventario y saldos iniciales</button></div>` : ''}
  <div class="card">
    <div class="toolbar">
      <div class="scan-row" style="flex:1;min-width:210px"><input id="invQ" type="search" placeholder="Buscar por nombre o código"><button type="button" class="icon-btn scan-btn" id="invScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div>
      <div class="chips" id="invT"><button data-t="all" class="on">Todos</button>${chips}</div>
      <label class="chk"><input type="checkbox" id="invLow" ${INV.low ? 'checked' : ''}> Solo bajo mínimo</label>
      ${hasAnyExpiry ? `<label class="chk"><input type="checkbox" id="invExp" ${INV.exp ? 'checked' : ''}> Por vencer / vencidos</label>` : ''}
    </div>
    <div class="scroll" id="invTable"></div>
  </div>
  <div class="card hidden" id="kardex"></div>
  <details class="card" id="movBox"><summary>Registrar movimiento o conteo físico</summary>
    ${rows.length ? `<form id="mForm"><div class="grid">
      <label>Producto<select name="product_id">${opts}</select></label>
      <label>Movimiento<select name="kind">
        <option value="in">Entrada / ajuste de ingreso</option>
        <option value="out">Salida o corrección</option>
        <option value="merma">Merma o pérdida</option>
        <option value="count">Conteo físico (cantidad real)</option>
      </select></label>
      <label>Cantidad<input name="qty" type="number" step="0.001" min="0" required></label>
      <label id="mCostLbl">Costo unitario de entrada (${esc(curLabel())})<input name="unit_cost" id="mCost" type="number" step="0.0001" min="0" required></label>
      <label>Nota<input name="notes" placeholder="Ej: derrame en bodega"></label></div>
      <p class="mut" id="mValInfo" style="margin-top:.5rem"></p>
      <p class="mut" id="mHint">En ingreso puedes indicar el costo unitario y se recalculará el costo promedio. En salida se aplica automáticamente el costo actual del producto.</p>
      <div class="row"><button class="btn" type="submit">Registrar</button></div></form>` : '<p class="mut">Primero crea productos en la pestaña Productos.</p>'}
  </details>
  <div class="card"><h2>Últimos movimientos</h2>
    ${moves.length ? `<div class="scroll"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Origen</th><th class="n">Cantidad</th><th class="n">Costo ${esc(curLabel())}</th><th>Nota</th></tr></thead><tbody>${mrows}</tbody></table></div>` : '<p class="mut">Aún no hay movimientos.</p>'}</div>`;

  drawInvTable();
  $('#invQ').oninput = (e) => { INV.q = e.target.value; drawInvTable(); };
  $('#invScan').onclick = () => openScanner({
    title: 'Buscar en existencias',
    continuous: false,
    onCode: (code) => {
      const hit = findBySku(INV.rows, code);
      INV.q = hit ? (hit.sku || hit.name) : code;
      INV.type = 'all'; INV.low = false; INV.exp = false;
      $('#invQ').value = INV.q;
      $('#invLow').checked = false;
      if ($('#invExp')) $('#invExp').checked = false;
      document.querySelectorAll('#invT button').forEach(x => x.classList.toggle('on', x.dataset.t === 'all'));
      drawInvTable();
      return hit
        ? {ok: true, msg: `${hit.name} — Stock: ${qty(hit.stock)} ${hit.unit}`}
        : {ok: false, msg: 'Sin producto con código ' + code};
    }
  });
  $('#invLow').onchange = (e) => { INV.low = e.target.checked; drawInvTable(); };
  if ($('#invExp')) $('#invExp').onchange = (e) => { INV.exp = e.target.checked; drawInvTable(); };
  $('#invT').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    INV.type = b.dataset.t;
    document.querySelectorAll('#invT button').forEach(x => x.classList.toggle('on', x === b));
    drawInvTable();
  };

  const form = $('#mForm');
  const syncMovUI = (resetCost = false) => {
    if (!form) return;
    const pid = +form.elements.product_id.value;
    const kind = form.elements.kind.value;
    const p = INV.rows.find(x => x.product_id === pid);
    if (!p) return;
    const curCost = Number(p.avg_cost_usd || 0);
    const curStock = Number(p.stock || 0);
    const costInp = $('#mCost');
    const costLbl = $('#mCostLbl');

    if (kind === 'in') {
      costLbl.firstChild.textContent = `Costo unitario de ingreso (${curLabel()})`;
      costInp.readOnly = false;
      costInp.disabled = false;
      if (resetCost || costInp.value === '') costInp.value = curCost > 0 ? curCost : 0;
    } else {
      costLbl.firstChild.textContent = kind === 'count' ? `Costo actual del producto (${curLabel()})` : `Costo de salida (fijo actual ${curLabel()})`;
      costInp.value = curCost;
      costInp.readOnly = true;
      costInp.disabled = true;
    }

    const qv = +form.elements.qty.value || 0;
    const uc = kind === 'in' ? (+costInp.value || 0) : curCost;
    if (kind === 'in') {
      const tot = qv * uc;
      const newAvg = (Math.max(curStock, 0) + qv) > 0
        ? ((Math.max(curStock, 0) * curCost) + (qv * uc)) / (Math.max(curStock, 0) + qv)
        : uc;
      $('#mValInfo').innerHTML = qv > 0
        ? `Valor de entrada: <b>${fmtCur(tot)}</b>${S.rate ? ' (' + fmt(tot * S.rate) + ' Bs)' : ''} | Nuevo costo promedio estimado: <b>${fmtCur(newAvg, 4)}</b>`
        : `Costo actual: ${fmtCur(curCost, 4)} | Stock actual: ${qty(curStock)} ${esc(p.unit)}`;
    } else if (kind === 'count') {
      const diff = Math.round((qv - curStock) * 1000) / 1000;
      $('#mValInfo').innerHTML = `Stock en sistema: <b>${qty(curStock)} ${esc(p.unit)}</b> | Diferencia: <b>${diff >= 0 ? '+' : ''}${qty(diff)}</b> (${fmtCur(Math.abs(diff) * curCost)})`;
    } else {
      const tot = qv * curCost;
      $('#mValInfo').innerHTML = qv > 0
        ? `Salida valorada al costo actual (${fmtCur(curCost, 4)}): <b>${fmtCur(tot)}</b>${S.rate ? ' (' + fmt(tot * S.rate) + ' Bs)' : ''} | Stock restante: <b>${qty(curStock - qv)} ${esc(p.unit)}</b>`
        : `Sale al costo actual: <b>${fmtCur(curCost, 4)}</b> | Disponible: ${qty(curStock)} ${esc(p.unit)}`;
    }
  };

  if (form) {
    syncMovUI(true);
    form.elements.product_id.onchange = () => syncMovUI(true);
    form.elements.kind.onchange = () => syncMovUI(true);
    form.elements.qty.oninput = () => syncMovUI(false);
    $('#mCost').oninput = () => syncMovUI(false);

    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form), kind = f.get('kind'), n = +f.get('qty'), pid = +f.get('product_id');
      const p = INV.rows.find(x => x.product_id === pid);
      run(async () => {
        if (kind !== 'count' && !(n > 0)) throw new Error('La cantidad debe ser mayor que cero');
        const delta = Math.round((kind === 'in' ? n : kind === 'count' ? n - Number(p.stock) : -n) * 1000) / 1000;
        if (!delta) throw new Error('El conteo coincide con el sistema: no hay nada que ajustar');
        const unitCost = kind === 'in'
          ? Math.max(0, Number($('#mCost').value || 0))
          : (Number(p.avg_cost_usd) || 0);
        await q(db.from('inventory_movements').insert({
          product_id: pid,
          movement_type: kind === 'merma' ? 'merma' : 'ajuste',
          quantity: delta,
          unit_cost_usd: unitCost,
          notes: f.get('notes').trim() || (kind === 'count' ? 'Conteo físico' : null)
        }));
        toast(kind === 'count' ? 'Conteo aplicado: ajuste de ' + qty(delta) : 'Movimiento registrado'); render();
      });
    };
  }

  $('#invTable').onclick = (e) => {
    const b = e.target.closest('[data-kx],[data-adj]'); if (!b) return;
    if (b.dataset.kx) run(() => showKardex(b.dataset.kx));
    if (b.dataset.adj && $('#mForm')) {
      $('#movBox').open = true;
      $('#mForm').elements.product_id.value = b.dataset.adj;
      syncMovUI(true);
      $('#movBox').scrollIntoView({behavior: 'smooth'});
    }
  };
}

function drawInvTable() {
  const t = INV.q.toLowerCase();
  const rows = INV.rows.filter(x => {
    if (INV.type !== 'all' && String(x.category_id) !== INV.type) return false;
    if (INV.low && !x.bajo_minimo) return false;
    if (INV.exp) {
      const eb = expiryBadge(x.expiry_date);
      if (!eb || (eb.state !== 'expired' && eb.state !== 'soon')) return false;
    }
    return !t || (x.name + ' ' + (x.sku || '')).toLowerCase().includes(t);
  });
  const body = rows.map(x => {
    const st = Number(x.stock), mn = Number(x.min_stock);
    const state = st <= 0 ? 'out' : x.bajo_minimo ? 'low' : 'ok';
    const pct = st <= 0 ? 0 : mn > 0 ? Math.min(100, st / (mn * 2) * 100) : 100;
    const lbl = {out: 'Agotado', low: 'Bajo mínimo', ok: 'Disponible'}[state];
    const eb = expiryBadge(x.expiry_date, true);
    return `<tr><td>${esc(x.name)}<small>${esc(x.sku)}</small>${eb ? `<small class="${eb.cls}">${esc(eb.text)}</small>` : ''}</td><td>${esc(x.category || '-')}</td>
      <td class="n">${qty(st)} ${esc(x.unit)}<div class="bar"><i class="${state}" style="width:${pct}%"></i></div></td>
      <td class="n">${qty(mn)}</td><td class="n">${fmt(x.avg_cost_usd)}</td><td class="n">${fmt(x.valor_usd)}</td>
      <td class="n">${S.rate ? fmt(x.valor_usd * S.rate) : '-'}</td><td><span class="badge ${state === 'ok' ? 'ok' : state}">${lbl}</span></td>
      <td><button class="lnk" data-kx="${x.product_id}">Kardex</button><button class="lnk" data-adj="${x.product_id}">Ajustar</button></td></tr>`;
  }).join('');
  $('#invTable').innerHTML = rows.length
    ? `<table><thead><tr><th>Producto</th><th>Tipo</th><th class="n">Stock</th><th class="n">Mínimo</th><th class="n">Costo ${esc(curLabel())}</th><th class="n">Valor ${esc(curLabel())}</th><th class="n">Valor ${esc(secSym())}</th><th>Estado</th><th></th></tr></thead><tbody>${body}</tbody></table>`
    : '<p class="mut">No hay productos con ese filtro.</p>';
}

async function showKardex(id) {
  const p = INV.rows.find(x => x.product_id == id);
  const ms = await q(db.from('inventory_movements').select('id,movement_type,quantity,unit_cost_usd,ref_type,ref_id,notes,created_at')
    .eq('product_id', id).order('created_at', {ascending: true}).order('id', {ascending: true}).limit(1000));
  let bal = 0;
  const rows = ms.map(m => { bal += Number(m.quantity); return {...m, bal}; }).reverse().map(m => `<tr><td>${fdate(m.created_at)}</td>
    <td>${MOV[m.movement_type]}</td><td>${refLabel(m)}</td><td class="n in">${m.quantity > 0 ? qty(m.quantity) : ''}</td>
    <td class="n outq">${m.quantity < 0 ? qty(-m.quantity) : ''}</td><td class="n"><b>${qty(m.bal)}</b></td>
    <td class="n">${m.unit_cost_usd != null ? fmt(m.unit_cost_usd) : '-'}</td><td>${esc(m.notes)}</td></tr>`).join('');
  const k = $('#kardex');
  k.classList.remove('hidden');
  k.innerHTML = `<div class="title-row"><h2>Kardex de ${esc(p.name)}</h2><button class="btn ghost" id="kxClose">Cerrar</button></div>
    ${ms.length ? `<div class="scroll"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Origen</th><th class="n">Entra</th><th class="n">Sale</th><th class="n">Saldo</th><th class="n">Costo ${esc(curLabel())}</th><th>Nota</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="mut">Este producto aún no tiene movimientos.</p>'}`;
  $('#kxClose').onclick = () => k.classList.add('hidden');
  k.scrollIntoView({behavior: 'smooth'});
}
views.inventario = viewInventario2;

// ---------- Productos (formulario completo con categoría, impuesto y foto opcional) ----------
const PR2 = {q: ''};
function compressImage(file, max = 800) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('No se pudo procesar la foto')), 'image/jpeg', 0.8);
    };
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}

async function viewProductos2() {
  const [prods, stockRows, cats, units, taxes, set] = await Promise.all([
    q(db.from('products').select('*, product_categories(name), taxes(name)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock')),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name')),
    q(db.from('units').select('symbol,name').eq('active', true).order('name')),
    q(db.from('taxes').select('id,name,percent,is_default').eq('active', true).order('name')),
    q(db.from('settings').select('enable_product_photos').eq('id', 1).single())
  ]);
  const stMap = Object.fromEntries(stockRows.map(s => [s.product_id, Number(s.stock || 0)]));
  const regProds = prods.filter(p => !p.is_combo);
  const D = {cats, units, taxes, photos: !!set.enable_product_photos, allProds: regProds, stMap};
  $('#view').innerHTML = `<div class="stack" style="gap:.6rem;margin-bottom:.8rem">
      <div class="row0" style="gap:.5rem">
        <button type="button" class="btn" id="prAddTop" style="flex:1">+ Nuevo producto</button>
      </div>
      <div class="scan-row"><input id="prQ" type="search" placeholder="Buscar producto o escanear código" value="${esc(PR2.q)}"><button type="button" class="icon-btn scan-btn" id="prScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div>
    </div>
    <div class="list" id="prList"></div><button class="fab" id="prAdd" aria-label="Nuevo producto">+</button>`;
  const draw = () => {
    const t = PR2.q.toLowerCase();
    $('#prList').innerHTML = regProds.filter(p => !t || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).map(p => {
      const c = Number(p.auto_cost_usd ?? p.avg_cost_usd ?? p.manual_cost_usd ?? 0), pr = Number(p.sale_price_usd || 0);
      const mg = pr > 0 && c > 0 ? Math.round((pr - c) / pr * 100) : null;
      const stTxt = p.is_service ? 'Servicio' : p.track_inventory === false ? 'Sin inv.' : `Stock: ${qty(stMap[p.id] || 0)} ${esc(p.unit)}`;
      const eb = expiryBadge(p.expiry_date, true);
      return `<button class="item" data-id="${p.id}">
      <span class="row0">${D.photos && p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}<span><b>${esc(p.name)}</b>
      <small>${esc(p.sku || 'Sin código')} | ${esc(p.product_categories?.name || 'Sin categoría')} | ${stTxt}${eb ? ` | <span class="${eb.cls}">${esc(eb.text)}</span>` : ''}</small>
      <small>Precio: <b>${fmtCur(pr)}</b>${S.bimoneda !== false && S.rate ? ' (' + fmt(pr * S.rate) + ' Bs)' : ''}${c > 0 ? ' | Costo ' + fmt(c) : ''}${mg !== null ? ` | <span class="${mg < 0 ? 'bad' : 'in'}">${mg}% margen</span>` : ''}</small></span></span>
      <span class="mut">&rsaquo;</span></button>`;
    }).join('') || '<p class="mut">No hay productos. Pulsa + para crear el primero.</p>';
  };
  draw();
  const handleProdScan = (code) => {
    const hit = findBySku(prods, code);
    if (hit) {
      if (hit.is_combo) {
        setTimeout(() => comboForm(hit, D), 260);
        return {ok: true, msg: 'Abriendo combo: ' + hit.name};
      }
      PR2.q = hit.sku || hit.name; $('#prQ').value = PR2.q; draw();
      setTimeout(() => prodForm(hit, D), 260);
      return {ok: true, msg: 'Abriendo: ' + hit.name};
    }
    PR2.q = ''; $('#prQ').value = ''; draw();
    setTimeout(() => {
      if (confirm(`El código "${code}" no existe todavía. ¿Crear un producto nuevo con este código?`)) {
        prodForm(null, D, code);
      }
    }, 280);
    return {ok: false, msg: 'Código nuevo: ' + code};
  };
  $('#prQ').oninput = (e) => { PR2.q = e.target.value; draw(); };
  bindEnterSku($('#prQ'), (code) => { handleProdScan(code); return true; });
  $('#prScan').onclick = () => openScanner({title: 'Buscar o crear producto', continuous: false, onCode: handleProdScan});
  $('#prAdd').onclick = () => prodForm(null, D);
  if ($('#prAddTop')) $('#prAddTop').onclick = () => prodForm(null, D);
  $('#prList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) prodForm(regProds.find(p => String(p.id) === b.dataset.id), D); };
}


// Crea una categoría nueva al vuelo desde el formulario de producto o combo y la selecciona automáticamente
function wireInlineCategoryCreator({btn, box, nameInp, regChk, saveBtn, cancelBtn, selectEl, catsArr}) {
  if (!btn || !box || !selectEl) return;
  const open = () => {
    box.classList.remove('hidden');
    nameInp.value = '';
    if (regChk) regChk.checked = true;
    setTimeout(() => nameInp.focus(), 40);
  };
  const close = () => {
    box.classList.add('hidden');
    nameInp.value = '';
  };
  btn.onclick = () => (box.classList.contains('hidden') ? open() : close());
  cancelBtn.onclick = close;
  const doSave = () => run(async () => {
    const raw = (nameInp.value || '').trim();
    if (!raw) throw new Error('Escribe el nombre de la categoría');
    const existing = (catsArr || []).find(c => String(c.name || '').trim().toLowerCase() === raw.toLowerCase());
    if (existing) {
      selectEl.value = String(existing.id);
      close();
      toast(`Categoría "${existing.name}" seleccionada`);
      return;
    }
    const created = await q(
      db.from('product_categories')
        .insert({name: raw, sells_regularly: regChk ? !!regChk.checked : true, active: true})
        .select('id,name')
        .single()
    );
    catsArr.push(created);
    catsArr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
    selectEl.innerHTML = `<option value="">Sin categoría</option>` + catsArr.map(c =>
      `<option value="${c.id}" ${String(c.id) === String(created.id) ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
    selectEl.value = String(created.id);
    close();
    toast(`Categoría "${created.name}" creada`);
  });
  saveBtn.onclick = doSave;
  nameInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doSave(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

function prodForm(p, D, preSku = '') {
  const {cats, units, taxes, photos} = D, defTax = taxes.find(t => t.is_default)?.id;
  const v = (k, d = '') => p ? (p[k] ?? d) : d;
  const opt = (arr, val, key, label) => arr.map(o => `<option value="${o[key]}" ${String(o[key]) === String(val) ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
  openSheet(p ? 'Editar producto' : 'Nuevo producto', `<form id="pf" class="stack">
    <label>Código (SKU / barras)<div class="scan-row" style="margin-top:.25rem"><input name="sku" value="${esc(v('sku', preSku))}" placeholder="Escanea o escribe el código"><button type="button" class="icon-btn scan-btn" id="pfScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div></label>
    <label>Nombre<input name="pname" value="${esc(v('name'))}" required></label>
    <div class="row0" style="align-items:flex-end;gap:.45rem">
      <label style="flex:1;margin:0">Categoría<select name="category_id"><option value="">Sin categoría</option>${opt(cats, v('category_id'), 'id', c => c.name)}</select></label>
      <button type="button" class="btn ghost" id="pfNewCat" title="Crear nueva categoría" aria-label="Crear nueva categoría" style="min-width:46px;padding:.55rem .75rem">+</button>
    </div>
    <div id="pfCatBox" class="cat-inline stack hidden">
      <b style="font-size:.88rem">Nueva categoría de producto</b>
      <input id="pfCatName" type="text" placeholder="Ej: Bebidas, Limpieza, Postres..." autocomplete="off">
      <label class="chk" style="margin:0"><input type="checkbox" id="pfCatReg" checked> Se vende con frecuencia</label>
      <div class="row" style="margin:0">
        <button type="button" class="btn" id="pfCatSave" style="min-height:40px;font-size:.9rem">Crear categoría</button>
        <button type="button" class="btn ghost" id="pfCatCancel" style="min-height:40px;font-size:.9rem">Cancelar</button>
      </div>
    </div>
    <label>Unidad de medida<select name="unit">${opt(units, v('unit', 'und'), 'symbol', u => `${u.name} (${u.symbol})`)}</select></label>
    <label>Costo manual (${esc(curLabel())}) — el que tú pones, no cambia solo<input name="cost" type="number" step="0.0001" min="0" value="${v('manual_cost_usd', 0)}"></label>
    <label>Precio de venta (${esc(curLabel())})<input name="price" type="number" step="0.0001" min="0" value="${v('sale_price_usd', 0)}"></label>
    <label>Costo automático (el real, el que usa el sistema)<input value="${p && p.auto_cost_usd != null ? fmtCur(p.auto_cost_usd, 4) : 'Aún sin compras ni fabricaciones: se usa el costo manual'}" disabled></label>
    <p class="mut">El costo automático se actualiza solo con cada compra, fabricación o ajuste de ingreso con costo. Tu costo manual no cambia: solo se usa mientras no haya movimientos con costo.</p>
    <label class="chk"><input type="checkbox" name="no_track" ${p && p.track_inventory === false && !p.is_service ? 'checked' : ''}> Insumo sin inventario (consumo libre en fórmulas, ej: agua, gas, hielo). Puede tener costo 0 y nunca genera stock negativo.</label>
    <label class="chk"><input type="checkbox" name="is_service" ${p?.is_service ? 'checked' : ''}> Es un servicio facturable (ej: delivery). Tu costo es lo que pagas por él.</label>
    <label>Stock mínimo<input name="min" type="number" step="0.001" min="0" value="${v('min_stock', 0)}"></label>
    <label class="chk" id="pfExpChkW"><input type="checkbox" name="has_expiry" ${p?.expiry_date ? 'checked' : ''}> Maneja fecha de vencimiento (opcional)</label>
    <label id="pfExpW" class="${p?.expiry_date ? '' : 'hidden'}">Fecha de vencimiento<input name="expiry_date" type="date" value="${esc(v('expiry_date'))}"></label>
    <label>Impuesto<select name="tax_id">${opt(taxes, v('tax_id', defTax), 'id', t => `${t.name} (${qty(t.percent)}%)`)}</select></label>
    ${photos ? `<label>Foto<input name="photo" type="file" accept="image/*"></label>${p?.image_url ? `<img class="thumb big" src="${esc(p.image_url)}" alt=""><label class="chk"><input type="checkbox" name="rmphoto"> Quitar la foto actual</label>` : ''}` : ''}
    <p id="pMargin" class="mut"></p>
    <div class="row"><button class="btn" type="submit">Guardar producto</button>${p ? '<button type="button" class="btn ghost" id="pfDel">Desactivar</button>' : ''}</div></form>`);
  const f = $('#pf'), el = f.elements;
  wireInlineCategoryCreator({
    btn: $('#pfNewCat'),
    box: $('#pfCatBox'),
    nameInp: $('#pfCatName'),
    regChk: $('#pfCatReg'),
    saveBtn: $('#pfCatSave'),
    cancelBtn: $('#pfCatCancel'),
    selectEl: el.category_id,
    catsArr: cats
  });
  $('#pfScan').onclick = () => openScanner({
    title: 'Escanear código del producto',
    continuous: false,
    onCode: (code) => { el.sku.value = code; return {ok: true, msg: 'Código asignado: ' + code}; }
  });
  const mg = () => {
    const c = p && p.auto_cost_usd != null ? +p.auto_cost_usd : (+el.cost.value || 0);
    const pr = +el.price.value || 0;
    const minM = Number(S.rules?.min_margin_percent || 0);
    const sug = (minM > 0 && minM < 95 && c > 0) ? Math.ceil((c / (1 - minM / 100)) * 100) / 100 : 0;
    const curM = pr > 0 ? ((pr - c) / pr * 100) : 0;
    const parts = [];
    if (pr > 0) {
      const low = minM > 0 && curM < minM - 0.1;
      parts.push(`<span class="${low ? 'warn' : ''}">Margen: <b>${fmt(curM, 0)}%</b> (ganancia de ${fmtCur(pr - c)}/u)${low ? ` · por debajo del objetivo (${qty(minM)}%)` : ''}</span>`);
    }
    if (sug > 0) {
      parts.push(`Precio sugerido para ${qty(minM)}%: <b>${fmtCur(sug)}</b> <button type="button" class="lnk" id="pApplySug" style="padding:0 .3rem">Aplicar</button>`);
    }
    $('#pMargin').innerHTML = parts.join('<br>');
    if ($('#pApplySug')) $('#pApplySug').onclick = () => { el.price.value = sug.toFixed(2); mg(); };
  };
  const syncExpUI = () => {
    const isSvc = el.is_service.checked;
    if (isSvc) {
      el.has_expiry.checked = false;
      el.has_expiry.disabled = true;
      $('#pfExpChkW')?.classList.add('hidden');
    } else {
      el.has_expiry.disabled = false;
      $('#pfExpChkW')?.classList.remove('hidden');
    }
    const show = !isSvc && el.has_expiry.checked;
    $('#pfExpW')?.classList.toggle('hidden', !show);
    if (!show) el.expiry_date.value = '';
  };
  const syncInvFlags = (src) => {
    if (src === 'svc' && el.is_service.checked) el.no_track.checked = false;
    if (src === 'nt' && el.no_track.checked) el.is_service.checked = false;
    const noInv = el.is_service.checked || el.no_track.checked;
    el.min.disabled = noInv;
    if (noInv) el.min.value = 0;
    syncExpUI();
  };
  el.is_service.onchange = () => syncInvFlags('svc');
  el.no_track.onchange = () => syncInvFlags('nt');
  el.has_expiry.onchange = syncExpUI;
  syncInvFlags();
  f.addEventListener('input', mg); mg();
  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      let image_url = p?.image_url || null;
      if (photos) {
        if (el.rmphoto?.checked) image_url = null;
        const file = el.photo?.files[0];
        if (file) {
          const blob = await compressImage(file), path = `p/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
          const up = await db.storage.from('product-images').upload(path, blob, {contentType: 'image/jpeg'});
          if (up.error) {
            if (String(up.error.message || '').includes('OFFLINE_STORAGE') || (typeof OFF !== 'undefined' && OFF.isNetError(up.error))) {
              toast('Sin internet: se guardará el producto sin subir la foto todavía');
            } else {
              throw up.error;
            }
          } else {
            image_url = db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
          }
        }
      }
      const isSvc = el.is_service.checked;
      const trackInv = !(isSvc || el.no_track.checked);
      const hasExp = !isSvc && el.has_expiry.checked;
      const expVal = hasExp ? (el.expiry_date.value || '') : '';
      if (hasExp && !expVal) throw new Error('Indica la fecha de vencimiento o desmarca la opción');
      const row = {sku: el.sku.value.trim() || null, name: el.pname.value.trim(), category_id: +el.category_id.value || null, unit: el.unit.value,
        manual_cost_usd: +el.cost.value || 0, sale_price_usd: +el.price.value || 0, min_stock: trackInv ? (+el.min.value || 0) : 0,
        is_service: isSvc, track_inventory: trackInv, expiry_date: expVal || null, tax_id: +el.tax_id.value || null, image_url};
      try {
        await q(p ? db.from('products').update(row).eq('id', p.id) : db.from('products').insert(row));
      } catch (err) {
        if (/track_inventory/i.test(err.message || '')) {
          delete row.track_inventory;
          await q(p ? db.from('products').update(row).eq('id', p.id) : db.from('products').insert(row));
          toast('Producto guardado');
          closeSheet(); render(); return;
        }
        throw err;
      }
      closeSheet(); toast('Producto guardado'); render();
    });
  };
  if (p) $('#pfDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar este producto?')) return;
    await q(db.from('products').update({active: false}).eq('id', p.id)); closeSheet(); toast('Producto desactivado'); render();
  });
}




// ---------- Combos / Paquetes promocionales (descuentan automáticamente el stock de cada producto) ----------
const CMB = {q: ''};

async function viewCombos() {
  const [prods, stockRows, cats, taxes, set] = await Promise.all([
    q(db.from('products').select('*, product_categories(name), taxes(name)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock')),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name')),
    q(db.from('taxes').select('id,name,percent,is_default').eq('active', true).order('name')),
    q(db.from('settings').select('enable_product_photos').eq('id', 1).single())
  ]);
  const stMap = Object.fromEntries(stockRows.map(s => [s.product_id, Number(s.stock || 0)]));
  const allProds = prods.filter(p => !p.is_combo);
  const prodMap = Object.fromEntries(allProds.map(p => [p.id, p]));
  const combos = prods.filter(p => p.is_combo);
  const D = {cats, taxes, photos: !!set.enable_product_photos, allProds, prodMap, stMap};

  $('#view').innerHTML = `
    <div class="card stack" style="margin-bottom:.8rem">
      <p class="mut" style="margin:0">Agrupa varios productos en un solo precio promocional. Al vender un combo, el sistema descuenta automáticamente el stock de cada producto que lo compone.</p>
      <div class="scan-row">
        <input id="cbQ" type="search" placeholder="Buscar combo o escanear código" value="${esc(CMB.q)}">
        <button type="button" class="icon-btn scan-btn" id="cbScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button>
      </div>
    </div>
    <div class="list" id="cbList"></div>
    <button class="fab" id="cbAdd" aria-label="Nuevo combo">+</button>`;

  const draw = () => {
    const t = CMB.q.trim().toLowerCase();
    const list = combos.filter(c => !t || (c.name + ' ' + (c.sku || '') + ' ' + comboSummaryText(c, prodMap)).toLowerCase().includes(t));
    $('#cbList').innerHTML = list.map(c => {
      const cost = comboCost(c, prodMap);
      const pr = Number(c.sale_price_usd || 0);
      const mg = pr > 0 && cost > 0 ? Math.round((pr - cost) / pr * 100) : null;
      const sumReg = (c.combo_items || []).reduce((a, ci) => a + Number(prodMap[ci.product_id]?.sale_price_usd || 0) * Number(ci.quantity || 0), 0);
      const savePct = sumReg > 0 && pr < sumReg ? Math.round((sumReg - pr) / sumReg * 100) : 0;
      const avail = comboAvail(c, stMap, prodMap);
      const availTxt = avail === null ? 'Sin control de stock' : `Armables: ${qty(avail)}`;
      const availCls = avail === 0 ? 'bad' : 'in';
      const desc = comboSummaryText(c, prodMap) || 'Sin productos asignados';
      return `<button class="item" data-id="${c.id}">
        <span class="row0">${D.photos && c.image_url ? `<img class="thumb" src="${esc(c.image_url)}" alt="">` : ''}
          <span>
            <b>${esc(c.name)}</b> <span class="badge ok" style="font-size:.7rem;padding:.05rem .35rem">Combo</span>
            <small>${esc(desc)}</small>
            <small>${esc(c.sku || 'Sin código')} | <span class="${availCls}">${availTxt}</span>${savePct > 0 ? ` | Ahorro ${savePct}% (normal ${fmtCur(sumReg)})` : ''}</small>
            <small>Precio: <b>${fmtCur(pr)}</b>${S.bimoneda !== false && S.rate ? ' (' + fmt(pr * S.rate) + ' Bs)' : ''}${cost > 0 ? ' | Costo ' + fmt(cost) : ''}${mg !== null ? ` | <span class="${mg < 0 ? 'bad' : 'in'}">${mg}% margen</span>` : ''}</small>
          </span>
        </span>
        <span class="mut">&rsaquo;</span>
      </button>`;
    }).join('') || '<p class="mut">Aún no hay combos creados. Pulsa + para armar tu primer combo.</p>';
  };
  draw();

  $('#cbQ').oninput = (e) => { CMB.q = e.target.value; draw(); };
  $('#cbScan').onclick = () => openScanner({
    title: 'Buscar o crear combo',
    continuous: false,
    onCode: (code) => {
      const hit = findBySku(combos, code);
      if (hit) {
        CMB.q = hit.sku || hit.name; $('#cbQ').value = CMB.q; draw();
        setTimeout(() => comboForm(hit, D), 260);
        return {ok: true, msg: 'Abriendo combo: ' + hit.name};
      }
      setTimeout(() => {
        if (confirm(`No existe un combo con el código "${code}". ¿Crear un combo nuevo con este código?`)) comboForm(null, D, code);
      }, 280);
      return {ok: false, msg: 'Código nuevo: ' + code};
    }
  });
  $('#cbAdd').onclick = () => comboForm(null, D);
  $('#cbList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) comboForm(combos.find(c => String(c.id) === b.dataset.id), D); };
}

function comboForm(combo, D, preSku = '') {
  const {cats, taxes, photos, allProds = [], stMap = {}} = D;
  const prodMap = D.prodMap || Object.fromEntries(allProds.map(p => [p.id, p]));
  if (!allProds.length) { toast('Primero crea los productos individuales antes de armar un combo', true); return; }
  const defTax = taxes.find(t => t.is_default)?.id;
  const v = (k, d = '') => combo ? (combo[k] ?? d) : d;
  const opt = (arr, val, key, label) => arr.map(o => `<option value="${o[key]}" ${String(o[key]) === String(val) ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
  const items = combo && Array.isArray(combo.combo_items) && combo.combo_items.length
    ? combo.combo_items.map(ci => ({product_id: Number(ci.product_id), quantity: Number(ci.quantity || 1)}))
    : [{product_id: Number(allProds[0].id), quantity: 1}];

  openSheet(combo ? 'Editar combo' : 'Nuevo combo', `<form id="cbf" class="stack">
    <label>Código (SKU / barras)<div class="scan-row" style="margin-top:.25rem"><input name="sku" value="${esc(v('sku', preSku))}" placeholder="Opcional: escanea o escribe código"><button type="button" class="icon-btn scan-btn" id="cbfScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div></label>
    <label>Nombre del combo<input name="cname" value="${esc(v('name'))}" placeholder="Ej: Combo Desayuno Familiar" required></label>
    <div class="row0" style="align-items:flex-end;gap:.45rem">
      <label style="flex:1;margin:0">Categoría<select name="category_id"><option value="">Sin categoría</option>${opt(cats, v('category_id'), 'id', c => c.name)}</select></label>
      <button type="button" class="btn ghost" id="cbfNewCat" title="Crear nueva categoría" aria-label="Crear nueva categoría" style="min-width:46px;padding:.55rem .75rem">+</button>
    </div>
    <div id="cbfCatBox" class="cat-inline stack hidden">
      <b style="font-size:.88rem">Nueva categoría</b>
      <input id="cbfCatName" type="text" placeholder="Ej: Combos, Promociones..." autocomplete="off">
      <label class="chk" style="margin:0"><input type="checkbox" id="cbfCatReg" checked> Se vende con frecuencia</label>
      <div class="row" style="margin:0">
        <button type="button" class="btn" id="cbfCatSave" style="min-height:40px;font-size:.9rem">Crear categoría</button>
        <button type="button" class="btn ghost" id="cbfCatCancel" style="min-height:40px;font-size:.9rem">Cancelar</button>
      </div>
    </div>
    <div class="stack" style="gap:.45rem;padding:.65rem;background:var(--bg);border:1px solid var(--line);border-radius:10px">
      <div class="title-row"><b style="font-size:.9rem">Productos incluidos en el combo</b><button type="button" class="lnk" id="cbAddRow">+ Agregar producto</button></div>
      <div id="cbRows" class="stack" style="gap:.5rem"></div>
    </div>
    <div id="cbSum" class="card" style="margin:0;padding:.7rem .85rem;background:var(--bg)"></div>
    <label>Precio fijo de venta del combo (${esc(curLabel())})<input name="price" type="number" step="0.01" min="0" value="${v('sale_price_usd', 0)}" required></label>
    <label>Impuesto<select name="tax_id">${opt(taxes, v('tax_id', defTax), 'id', t => `${t.name} (${qty(t.percent)}%)`)}</select></label>
    ${photos ? `<label>Foto del combo<input name="photo" type="file" accept="image/*"></label>${combo?.image_url ? `<img class="thumb big" src="${esc(combo.image_url)}" alt=""><label class="chk"><input type="checkbox" name="rmphoto"> Quitar la foto actual</label>` : ''}` : ''}
    <div class="row"><button class="btn" type="submit">Guardar combo</button>${combo ? '<button type="button" class="btn ghost" id="cbfDel">Desactivar</button>' : ''}</div>
  </form>`);

  const f = $('#cbf'), el = f.elements;
  wireInlineCategoryCreator({
    btn: $('#cbfNewCat'),
    box: $('#cbfCatBox'),
    nameInp: $('#cbfCatName'),
    regChk: $('#cbfCatReg'),
    saveBtn: $('#cbfCatSave'),
    cancelBtn: $('#cbfCatCancel'),
    selectEl: el.category_id,
    catsArr: cats
  });
  $('#cbfScan').onclick = () => openScanner({
    title: 'Escanear código del combo',
    continuous: false,
    onCode: (code) => { el.sku.value = code; return {ok: true, msg: 'Código asignado: ' + code}; }
  });

  const prodOpts = (selId) => allProds.map(p => {
    const stTxt = p.is_service ? 'Servicio' : p.track_inventory === false ? 'Sin inv.' : `Disp: ${qty(stMap[p.id] || 0)} ${p.unit}`;
    return `<option value="${p.id}" ${Number(p.id) === Number(selId) ? 'selected' : ''}>${esc(p.name)} (${fmtCur(p.sale_price_usd)} · ${esc(stTxt)})</option>`;
  }).join('');

  const paintSummary = () => {
    const fakeCombo = {is_combo: true, combo_items: items};
    const cost = comboCost(fakeCombo, prodMap);
    const sumReg = items.reduce((a, ci) => a + Number(prodMap[ci.product_id]?.sale_price_usd || 0) * Number(ci.quantity || 0), 0);
    const pr = Number(el.price.value || 0);
    const mg = pr > 0 ? ((pr - cost) / pr * 100) : 0;
    const save = sumReg > 0 ? Math.max(0, sumReg - pr) : 0;
    const avail = comboAvail(fakeCombo, stMap, prodMap);
    const minM = Number(S.rules?.min_margin_percent || 0);
    const lowM = minM > 0 && pr > 0 && mg < minM - 0.1;
    $('#cbSum').innerHTML = `
      <div class="rl" style="border:0;padding:.15rem 0"><span>Costo total de componentes</span><b>${fmtCur(cost, 4)}</b></div>
      <div class="rl" style="border:0;padding:.15rem 0"><span>Suma de precios por separado</span><b>${fmtCur(sumReg)}</b></div>
      <div class="rl" style="border:0;padding:.15rem 0"><span>Disponibilidad con stock actual</span><b class="${avail === 0 ? 'bad' : 'in'}">${avail === null ? 'Sin límite de stock' : qty(avail) + ' combos armables'}</b></div>
      ${pr > 0 ? `<div class="rl" style="border:0;padding:.15rem 0"><span>Margen del combo</span><b class="${mg < 0 ? 'bad' : lowM ? 'warn' : 'in'}">${fmt(mg, 0)}% (${fmtCur(pr - cost)}/combo)</b></div>` : ''}
      ${save > 0.005 ? `<small class="in">El cliente ahorra <b>${fmtCur(save)}</b> (${Math.round(save / sumReg * 100)}%) comprando el combo.</small>` : ''}`;
  };

  const drawRows = () => {
    $('#cbRows').innerHTML = items.map((ci, i) => `
      <div class="ln2" data-ci="${i}" style="align-items:end;gap:.45rem">
        <label style="flex:1;margin:0">Producto<select data-cf="pid">${prodOpts(ci.product_id)}</select></label>
        <div class="row0" style="gap:.35rem;align-items:end">
          <label style="width:5.2rem;margin:0">Cant.<input data-cf="qty" type="number" step="0.001" min="0.001" value="${ci.quantity}"></label>
          ${items.length > 1 ? `<button type="button" class="lnk bad" data-crm="${i}" title="Quitar" style="padding:.45rem .3rem">&times;</button>` : ''}
        </div>
      </div>`).join('');
    paintSummary();
  };
  drawRows();

  $('#cbAddRow').onclick = () => {
    const used = new Set(items.map(x => Number(x.product_id)));
    const next = allProds.find(p => !used.has(Number(p.id))) || allProds[0];
    items.push({product_id: Number(next.id), quantity: 1});
    drawRows();
  };
  $('#cbRows').addEventListener('input', (e) => {
    const row = e.target.closest('[data-ci]'); if (!row) return;
    const ci = items[+row.dataset.ci];
    if (e.target.dataset.cf === 'pid') ci.product_id = Number(e.target.value);
    if (e.target.dataset.cf === 'qty') ci.quantity = Number(e.target.value) || 0;
    paintSummary();
  });
  $('#cbRows').addEventListener('change', (e) => {
    const row = e.target.closest('[data-ci]'); if (!row) return;
    if (e.target.dataset.cf === 'pid') { items[+row.dataset.ci].product_id = Number(e.target.value); paintSummary(); }
  });
  $('#cbRows').addEventListener('click', (e) => {
    if (e.target.dataset.crm !== undefined && items.length > 1) {
      items.splice(+e.target.dataset.crm, 1);
      drawRows();
    }
  });
  el.price.addEventListener('input', paintSummary);

  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const merged = new Map();
      for (const ci of items) {
        const pid = Number(ci.product_id), qv = Number(ci.quantity || 0);
        if (!pid || !(qv > 0)) continue;
        merged.set(pid, Math.round(((merged.get(pid) || 0) + qv) * 1000) / 1000);
      }
      const cleanItems = [...merged.entries()].map(([product_id, quantity]) => ({product_id, quantity}));
      if (!cleanItems.length) throw new Error('Agrega al menos un producto válido con cantidad mayor que cero');
      let image_url = combo?.image_url || null;
      if (photos) {
        if (el.rmphoto?.checked) image_url = null;
        const file = el.photo?.files[0];
        if (file) {
          const blob = await compressImage(file), path = `p/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
          const up = await db.storage.from('product-images').upload(path, blob, {contentType: 'image/jpeg'});
          if (up.error) {
            if (String(up.error.message || '').includes('OFFLINE_STORAGE') || (typeof OFF !== 'undefined' && OFF.isNetError(up.error))) {
              toast('Sin internet: se guardará el combo sin subir la foto todavía');
            } else {
              throw up.error;
            }
          } else {
            image_url = db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
          }
        }
      }
      const cc = comboCost({is_combo: true, combo_items: cleanItems}, prodMap);
      const row = {
        sku: el.sku.value.trim() || null,
        name: el.cname.value.trim(),
        category_id: +el.category_id.value || null,
        unit: 'combo',
        manual_cost_usd: cc,
        avg_cost_usd: cc,
        sale_price_usd: +el.price.value || 0,
        min_stock: 0,
        is_service: false,
        track_inventory: false,
        is_combo: true,
        combo_items: cleanItems,
        expiry_date: null,
        tax_id: +el.tax_id.value || null,
        image_url
      };
      await q(combo ? db.from('products').update(row).eq('id', combo.id) : db.from('products').insert(row));
      closeSheet(); toast(combo ? 'Combo actualizado' : 'Combo creado'); render();
    });
  };
  if (combo) $('#cbfDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar este combo? Los productos individuales que lo integran no se verán afectados.')) return;
    await q(db.from('products').update({active: false}).eq('id', combo.id)); closeSheet(); toast('Combo desactivado'); render();
  });
}

// ---------- Actualización masiva de precios y márgenes ----------
const PM = {
  q: '',
  cat: 'all',
  flt: 'all',      // 'all' | 'low' | 'loss'
  mode: 'pct',     // 'pct' | 'margin' | 'manual'
  pct: '10',
  margin: '',
  round: 'none',   // 'none' | '0.5' | '1'
  manual: {},      // { [pid]: string }
  unchecked: {}    // { [pid]: true }
};

function roundPriceRule(val, mode) {
  const n = Math.max(0, Number(val) || 0);
  if (mode === '0.5') return Math.ceil(n * 2 - 1e-9) / 2;
  if (mode === '1') return Math.ceil(n - 1e-9);
  return Math.round(n * 100) / 100;
}

async function viewPreciosMasivo() {
  const [prods, cats] = await Promise.all([
    db.from('products').select('id,sku,name,category_id,unit,sale_price_usd,avg_cost_usd,auto_cost_usd,manual_cost_usd,is_service,is_combo,combo_items,track_inventory,product_categories(name)').eq('active', true).order('name')
      .then(r => r.error ? q(db.from('products').select('id,sku,name,category_id,unit,sale_price_usd,avg_cost_usd,auto_cost_usd,manual_cost_usd,is_service,product_categories(name)').eq('active', true).order('name')) : r.data),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name'))
  ]);

  const targetMin = Number(S.rules?.min_margin_percent || 0) || 30;
  if (PM.margin === '') PM.margin = String(targetMin);

  // Excluir insumos sin inventario con precio 0 a menos que ya tengan precio de venta (combos siempre incluidos)
  const pmAll = Object.fromEntries(prods.map(p => [p.id, p]));
  const listAll = prods.filter(p => p.is_combo || !(p.track_inventory === false && !(Number(p.sale_price_usd) > 0)));
  const costOfP = (p) => p.is_combo ? comboCost(p, pmAll) : Number(p.auto_cost_usd ?? p.avg_cost_usd ?? p.manual_cost_usd ?? 0);
  const curMarginOf = (p) => {
    const pr = Number(p.sale_price_usd || 0), c = costOfP(p);
    return pr > 0 ? ((pr - c) / pr * 100) : 0;
  };
  const nextPriceOf = (p) => {
    const oldP = Number(p.sale_price_usd || 0), c = costOfP(p);
    if (PM.mode === 'manual') {
      const raw = PM.manual[p.id];
      if (raw === undefined || raw === '') return oldP;
      return Math.max(0, num(raw) || 0);
    }
    if (PM.mode === 'pct') {
      const k = 1 + (num(PM.pct) || 0) / 100;
      return roundPriceRule(oldP * k, PM.round);
    }
    const mg = Math.min(95, Math.max(0, num(PM.margin) || 0));
    if (c <= 0) return oldP;
    return roundPriceRule(c / (1 - mg / 100), PM.round);
  };

  const visible = () => {
    const t = PM.q.trim().toLowerCase();
    return listAll.filter(p => {
      if (PM.cat !== 'all' && String(p.category_id) !== PM.cat) return false;
      const pr = Number(p.sale_price_usd || 0), c = costOfP(p), mg = curMarginOf(p);
      if (PM.flt === 'low' && !(c > 0 && (pr <= 0 || mg < targetMin - 0.1))) return false;
      if (PM.flt === 'loss' && !(c > 0 && pr < c)) return false;
      return !t || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t);
    });
  };

  const changedRows = () => visible().filter(p => {
    if (PM.unchecked[p.id]) return false;
    const oldP = Number(p.sale_price_usd || 0), newP = nextPriceOf(p);
    return Math.abs(newP - oldP) >= 0.005;
  });

  $('#view').innerHTML = `
    <div class="card stack">
      <h2>Actualización masiva de precios</h2>
      <p class="mut" style="margin:0">Ajusta precios por porcentaje, fija un margen objetivo sobre tu costo real o edita directamente en lista.</p>
      <div class="chips" id="pmMode">
        <button type="button" data-m="pct" class="${PM.mode === 'pct' ? 'on' : ''}">Ajuste %</button>
        <button type="button" data-m="margin" class="${PM.mode === 'margin' ? 'on' : ''}">Margen objetivo</button>
        <button type="button" data-m="manual" class="${PM.mode === 'manual' ? 'on' : ''}">Edición manual</button>
      </div>
      ${PM.mode !== 'manual' ? `<div class="grid">
        ${PM.mode === 'pct'
          ? `<label>Variación sobre precio actual (%)<input id="pmPct" type="number" step="0.5" value="${esc(PM.pct)}" placeholder="Ej: 10 ó -5"></label>`
          : `<label>Margen de ganancia objetivo (%)<input id="pmMg" type="number" step="0.5" min="0" max="95" value="${esc(PM.margin)}" placeholder="Ej: 30"></label>`}
        <label>Redondeo del precio (${esc(curLabel())})
          <select id="pmRnd">
            <option value="none" ${PM.round === 'none' ? 'selected' : ''}>Exacto (2 decimales)</option>
            <option value="0.5" ${PM.round === '0.5' ? 'selected' : ''}>Redondear al 0,50 arriba</option>
            <option value="1" ${PM.round === '1' ? 'selected' : ''}>Redondear a ${fmtCur(1)} arriba</option>
          </select>
        </label>
      </div>` : ''}
    </div>

    <div class="card stack">
      <input id="pmQ" type="search" placeholder="Buscar producto o código..." value="${esc(PM.q)}">
      <div class="chips" id="pmFlt">
        <button type="button" data-f="all" class="${PM.flt === 'all' ? 'on' : ''}">Todos (${listAll.length})</button>
        <button type="button" data-f="low" class="${PM.flt === 'low' ? 'on' : ''}">Bajo margen (&lt;${qty(targetMin)}%)</button>
        <button type="button" data-f="loss" class="${PM.flt === 'loss' ? 'on' : ''}">Precio &lt; costo</button>
      </div>
      <div class="chips" id="pmCat">
        <button type="button" data-c="all" class="${PM.cat === 'all' ? 'on' : ''}">Todas las categorías</button>
        ${cats.map(c => `<button type="button" data-c="${c.id}" class="${PM.cat === String(c.id) ? 'on' : ''}">${esc(c.name)}</button>`).join('')}
      </div>
      <div class="title-row">
        <small class="mut" id="pmCnt"></small>
        <div class="row0" style="gap:.5rem">
          <button type="button" class="lnk" id="pmSelAll" style="font-size:.82rem">Marcar todos</button>
          <button type="button" class="lnk" id="pmSelNone" style="font-size:.82rem">Desmarcar</button>
        </div>
      </div>
      <div class="list" id="pmList"></div>
    </div>

    <div class="card stack aj-footer">
      <div id="pmSum"></div>
      <div class="row" style="margin:0">
        <button type="button" class="btn" id="pmApply">Aplicar precios (0)</button>
      </div>
    </div>`;

  const paintSummary = () => {
    const vis = visible(), ch = changedRows();
    $('#pmCnt').textContent = `Mostrando ${vis.length} productos · ${ch.length} cambiarán de precio`;
    if (ch.length) {
      const avgOld = ch.reduce((s, p) => s + curMarginOf(p), 0) / ch.length;
      const avgNew = ch.reduce((s, p) => {
        const np = nextPriceOf(p), c = costOfP(p);
        return s + (np > 0 ? (np - c) / np * 100 : 0);
      }, 0) / ch.length;
      $('#pmSum').innerHTML = `Se actualizarán <b>${ch.length}</b> ${ch.length === 1 ? 'producto' : 'productos'} · Margen promedio: <b>${fmt(avgOld, 0)}% &rarr; ${fmt(avgNew, 0)}%</b>`;
    } else {
      $('#pmSum').innerHTML = '<span class="mut">No hay cambios de precio pendientes con la selección actual.</span>';
    }
    $('#pmApply').textContent = `Aplicar precios (${ch.length})`;
  };

  const draw = () => {
    const vis = visible();
    $('#pmList').innerHTML = vis.map(p => {
      const c = costOfP(p), oldP = Number(p.sale_price_usd || 0), newP = nextPriceOf(p);
      const changed = Math.abs(newP - oldP) >= 0.005 && !PM.unchecked[p.id];
      const oldM = oldP > 0 ? ((oldP - c) / oldP * 100) : 0;
      const newM = newP > 0 ? ((newP - c) / newP * 100) : 0;
      const cls = !changed ? '' : (newP >= oldP ? 'aj-in' : 'aj-out');
      const chk = !PM.unchecked[p.id];
      return `<div class="item aj-row ${cls}" data-pid="${p.id}">
        <label class="chk" style="flex:1;min-width:155px">
          <input type="checkbox" data-chk="${p.id}" ${chk ? 'checked' : ''}>
          <span>
            <b>${esc(p.name)}</b>
            <small>Costo: ${fmtCur(c, 4)} | Actual: <b>${fmtCur(oldP)}</b> (${fmt(oldM, 0)}%)</small>
            ${changed ? `<small class="df ${newP >= oldP ? 'in' : 'outq'}">Nuevo: ${fmtCur(newP)}${S.rate ? ' (' + fmt(newP * S.rate) + ' Bs)' : ''} · Margen ${fmt(newM, 0)}%</small>` : ''}
          </span>
        </label>
        ${PM.mode === 'manual'
          ? `<label style="width:6.8rem;margin:0">Nuevo ${esc(curLabel())}<input data-mp="${p.id}" type="number" step="0.01" min="0" value="${PM.manual[p.id] ?? oldP.toFixed(2)}"></label>`
          : `<span class="n" style="flex:none"><b>${fmtCur(newP)}</b><small class="${newM < targetMin - 0.1 && c > 0 ? 'warn' : 'mut'}">${fmt(newM, 0)}% margen</small></span>`}
      </div>`;
    }).join('') || '<p class="mut">No hay productos con ese filtro.</p>';
    paintSummary();
  };
  draw();

  $('#pmMode').onclick = (e) => { const b = e.target.closest('button'); if (b) { PM.mode = b.dataset.m; render(); } };
  if ($('#pmPct')) $('#pmPct').oninput = (e) => { PM.pct = e.target.value; draw(); };
  if ($('#pmMg')) $('#pmMg').oninput = (e) => { PM.margin = e.target.value; draw(); };
  if ($('#pmRnd')) $('#pmRnd').onchange = (e) => { PM.round = e.target.value; draw(); };
  $('#pmQ').oninput = (e) => { PM.q = e.target.value; draw(); };
  $('#pmFlt').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    PM.flt = b.dataset.f;
    document.querySelectorAll('#pmFlt button').forEach(x => x.classList.toggle('on', x === b));
    draw();
  };
  $('#pmCat').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    PM.cat = b.dataset.c;
    document.querySelectorAll('#pmCat button').forEach(x => x.classList.toggle('on', x === b));
    draw();
  };
  $('#pmSelAll').onclick = () => { visible().forEach(p => { delete PM.unchecked[p.id]; }); draw(); };
  $('#pmSelNone').onclick = () => { visible().forEach(p => { PM.unchecked[p.id] = true; }); draw(); };

  $('#pmList').addEventListener('change', (e) => {
    if (e.target.dataset.chk) {
      const id = e.target.dataset.chk;
      if (e.target.checked) delete PM.unchecked[id]; else PM.unchecked[id] = true;
      draw();
    }
  });
  $('#pmList').addEventListener('input', (e) => {
    if (e.target.dataset.mp) {
      const id = e.target.dataset.mp;
      PM.manual[id] = e.target.value;
      delete PM.unchecked[id];
      paintSummary();
    }
  });

  $('#pmApply').onclick = () => run(async () => {
    const ch = changedRows();
    if (!ch.length) throw new Error('No hay cambios de precio para aplicar');
    if (!confirm(`Se actualizará el precio de venta de ${ch.length} ${ch.length === 1 ? 'producto' : 'productos'}. ¿Continuar?`)) return;
    toast(`Actualizando ${ch.length} precios...`);
    for (const p of ch) {
      const np = nextPriceOf(p);
      await q(db.from('products').update({sale_price_usd: np}).eq('id', p.id));
    }
    PM.manual = {};
    toast(`${ch.length} ${ch.length === 1 ? 'precio actualizado' : 'precios actualizados'}`);
    render();
  });
}
