// Inventario v2: resumen, filtros, kardex por producto, conteo físico y ajustes valorados
const INV = {rows: [], q: '', type: 'all', low: false};
const REF = {purchase: 'Compra', sale: 'Venta', production: 'Producción', apertura: 'Apertura', ajuste_masivo: 'Ajuste masivo'};
const refLabel = (m) => m.ref_type ? (REF[m.ref_type] ? `${REF[m.ref_type]}${m.ref_id ? ' #' + m.ref_id : ''}` : `${m.ref_type}${m.ref_id ? ' #' + m.ref_id : ''}`) : '-';
const fdate = (d) => new Date(d).toLocaleString('es-VE', {dateStyle: 'short', timeStyle: 'short'});


// Devuelve un Set con IDs de productos que NO controlan inventario (insumos libres como agua o servicios)
async function getUntrackedIds() {
  try {
    const res = await db.from('products').select('id,is_service,track_inventory').eq('active', true);
    const list = res.error ? [] : (res.data || []);
    return new Set(list.filter(p => p.track_inventory === false || p.is_service).map(p => Number(p.id)));
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
  const cats = [...new Map(rows.filter(x => x.category_id).map(x => [x.category_id, x.category])).entries()];
  const chips = cats.map(([k, v]) => `<button data-t="${k}">${esc(v)}</button>`).join('');
  const opts = rows.map(s => `<option value="${s.product_id}">${esc(s.name)} (${esc(s.unit)}) — Stock: ${qty(s.stock)}</option>`).join('');
  const mrows = moves.map(m => `<tr><td>${fdate(m.created_at)}</td><td>${esc(m.products?.name)}</td><td>${MOV[m.movement_type]}</td>
    <td>${refLabel(m)}</td><td class="n ${m.quantity > 0 ? 'in' : 'outq'}">${m.quantity > 0 ? '+' : ''}${qty(m.quantity)}</td>
    <td class="n">${m.unit_cost_usd != null ? fmt(m.unit_cost_usd) : '-'}</td><td>${esc(m.notes)}</td></tr>`).join('');

  $('#view').innerHTML = `
  <div class="stats">
    <div class="stat"><span>Valor del inventario</span><b>${fmt(valor)} USD</b><span>${S.rate ? fmt(valor * S.rate) + ' Bs' : 'Sin tasa cargada'}</span></div>
    <div class="stat"><span>Productos activos</span><b>${rows.length}</b></div>
    <div class="stat warn"><span>Bajo el mínimo</span><b>${bajos}</b></div>
    <div class="stat bad"><span>Agotados</span><b>${agotados}</b></div>
  </div>
  ${['admin', 'contador'].includes(S.role || 'admin') ? `<div class="row" style="margin:0 0 .8rem"><button class="btn ghost" data-go="apertura">Configurar inventario y saldos iniciales</button></div>` : ''}
  <div class="card">
    <div class="toolbar">
      <div class="scan-row" style="flex:1;min-width:210px"><input id="invQ" type="search" placeholder="Buscar por nombre o código"><button type="button" class="icon-btn scan-btn" id="invScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div>
      <div class="chips" id="invT"><button data-t="all" class="on">Todos</button>${chips}</div>
      <label class="chk"><input type="checkbox" id="invLow"> Solo bajo mínimo</label>
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
      <label id="mCostLbl">Costo unitario de entrada (USD)<input name="unit_cost" id="mCost" type="number" step="0.0001" min="0" required></label>
      <label>Nota<input name="notes" placeholder="Ej: derrame en bodega"></label></div>
      <p class="mut" id="mValInfo" style="margin-top:.5rem"></p>
      <p class="mut" id="mHint">En ingreso puedes indicar el costo unitario y se recalculará el costo promedio. En salida se aplica automáticamente el costo actual del producto.</p>
      <div class="row"><button class="btn" type="submit">Registrar</button></div></form>` : '<p class="mut">Primero crea productos en la pestaña Productos.</p>'}
  </details>
  <div class="card"><h2>Últimos movimientos</h2>
    ${moves.length ? `<div class="scroll"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Origen</th><th class="n">Cantidad</th><th class="n">Costo USD</th><th>Nota</th></tr></thead><tbody>${mrows}</tbody></table></div>` : '<p class="mut">Aún no hay movimientos.</p>'}</div>`;

  drawInvTable();
  $('#invQ').oninput = (e) => { INV.q = e.target.value; drawInvTable(); };
  $('#invScan').onclick = () => openScanner({
    title: 'Buscar en existencias',
    continuous: false,
    onCode: (code) => {
      const hit = findBySku(INV.rows, code);
      INV.q = hit ? (hit.sku || hit.name) : code;
      INV.type = 'all'; INV.low = false;
      $('#invQ').value = INV.q;
      $('#invLow').checked = false;
      document.querySelectorAll('#invT button').forEach(x => x.classList.toggle('on', x.dataset.t === 'all'));
      drawInvTable();
      return hit
        ? {ok: true, msg: `${hit.name} — Stock: ${qty(hit.stock)} ${hit.unit}`}
        : {ok: false, msg: 'Sin producto con código ' + code};
    }
  });
  $('#invLow').onchange = (e) => { INV.low = e.target.checked; drawInvTable(); };
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
      costLbl.firstChild.textContent = 'Costo unitario de ingreso (USD)';
      costInp.readOnly = false;
      costInp.disabled = false;
      if (resetCost || costInp.value === '') costInp.value = curCost > 0 ? curCost : 0;
    } else {
      costLbl.firstChild.textContent = kind === 'count' ? 'Costo actual del producto (USD)' : 'Costo de salida (fijo actual USD)';
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
        ? `Valor de entrada: <b>${fmt(tot)} USD</b>${S.rate ? ' (' + fmt(tot * S.rate) + ' Bs)' : ''} | Nuevo costo promedio estimado: <b>${fmt(newAvg, 4)} USD</b>`
        : `Costo actual: ${fmt(curCost, 4)} USD | Stock actual: ${qty(curStock)} ${esc(p.unit)}`;
    } else if (kind === 'count') {
      const diff = Math.round((qv - curStock) * 1000) / 1000;
      $('#mValInfo').innerHTML = `Stock en sistema: <b>${qty(curStock)} ${esc(p.unit)}</b> | Diferencia: <b>${diff >= 0 ? '+' : ''}${qty(diff)}</b> (${fmt(Math.abs(diff) * curCost)} USD)`;
    } else {
      const tot = qv * curCost;
      $('#mValInfo').innerHTML = qv > 0
        ? `Salida valorada al costo actual (${fmt(curCost, 4)} USD): <b>${fmt(tot)} USD</b>${S.rate ? ' (' + fmt(tot * S.rate) + ' Bs)' : ''} | Stock restante: <b>${qty(curStock - qv)} ${esc(p.unit)}</b>`
        : `Sale al costo actual: <b>${fmt(curCost, 4)} USD</b> | Disponible: ${qty(curStock)} ${esc(p.unit)}`;
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
  const rows = INV.rows.filter(x => (INV.type === 'all' || String(x.category_id) === INV.type) && (!INV.low || x.bajo_minimo)
    && (!t || (x.name + ' ' + (x.sku || '')).toLowerCase().includes(t)));
  const body = rows.map(x => {
    const st = Number(x.stock), mn = Number(x.min_stock);
    const state = st <= 0 ? 'out' : x.bajo_minimo ? 'low' : 'ok';
    const pct = st <= 0 ? 0 : mn > 0 ? Math.min(100, st / (mn * 2) * 100) : 100;
    const lbl = {out: 'Agotado', low: 'Bajo mínimo', ok: 'Disponible'}[state];
    return `<tr><td>${esc(x.name)}<small>${esc(x.sku)}</small></td><td>${esc(x.category || '-')}</td>
      <td class="n">${qty(st)} ${esc(x.unit)}<div class="bar"><i class="${state}" style="width:${pct}%"></i></div></td>
      <td class="n">${qty(mn)}</td><td class="n">${fmt(x.avg_cost_usd)}</td><td class="n">${fmt(x.valor_usd)}</td>
      <td class="n">${S.rate ? fmt(x.valor_usd * S.rate) : '-'}</td><td><span class="badge ${state === 'ok' ? 'ok' : state}">${lbl}</span></td>
      <td><button class="lnk" data-kx="${x.product_id}">Kardex</button><button class="lnk" data-adj="${x.product_id}">Ajustar</button></td></tr>`;
  }).join('');
  $('#invTable').innerHTML = rows.length
    ? `<table><thead><tr><th>Producto</th><th>Tipo</th><th class="n">Stock</th><th class="n">Mínimo</th><th class="n">Costo USD</th><th class="n">Valor USD</th><th class="n">Valor Bs</th><th>Estado</th><th></th></tr></thead><tbody>${body}</tbody></table>`
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
    ${ms.length ? `<div class="scroll"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Origen</th><th class="n">Entra</th><th class="n">Sale</th><th class="n">Saldo</th><th class="n">Costo USD</th><th>Nota</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="mut">Este producto aún no tiene movimientos.</p>'}`;
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
  const D = {cats, units, taxes, photos: !!set.enable_product_photos};
  $('#view').innerHTML = `<div class="scan-row" style="margin-bottom:.8rem"><input id="prQ" type="search" placeholder="Buscar producto o escanear código" value="${esc(PR2.q)}"><button type="button" class="icon-btn scan-btn" id="prScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div>
    <div class="list" id="prList"></div><button class="fab" id="prAdd" aria-label="Nuevo producto">+</button>`;
  const draw = () => {
    const t = PR2.q.toLowerCase();
    $('#prList').innerHTML = prods.filter(p => !t || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).map(p => {
      const c = Number(p.auto_cost_usd ?? p.avg_cost_usd ?? p.manual_cost_usd ?? 0), pr = Number(p.sale_price_usd || 0);
      const mg = pr > 0 && c > 0 ? Math.round((pr - c) / pr * 100) : null;
      const stTxt = p.is_service ? 'Servicio' : p.track_inventory === false ? 'Sin inv.' : `Stock: ${qty(stMap[p.id] || 0)} ${esc(p.unit)}`;
      return `<button class="item" data-id="${p.id}">
      <span class="row0">${D.photos && p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}<span><b>${esc(p.name)}</b>
      <small>${esc(p.sku || 'Sin código')} | ${esc(p.product_categories?.name || 'Sin categoría')} | ${stTxt}</small>
      <small>Precio: <b>${fmt(pr)} USD</b>${S.bimoneda !== false && S.rate ? ' (' + fmt(pr * S.rate) + ' Bs)' : ''}${c > 0 ? ' | Costo ' + fmt(c) : ''}${mg !== null ? ` | <span class="${mg < 0 ? 'bad' : 'in'}">${mg}% margen</span>` : ''}</small></span></span>
      <span class="mut">&rsaquo;</span></button>`;
    }).join('') || '<p class="mut">No hay productos. Pulsa + para crear el primero.</p>';
  };
  draw();
  const handleProdScan = (code) => {
    const hit = findBySku(prods, code);
    if (hit) {
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
  $('#prList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) prodForm(prods.find(p => String(p.id) === b.dataset.id), D); };
}

function prodForm(p, D, preSku = '') {
  const {cats, units, taxes, photos} = D, defTax = taxes.find(t => t.is_default)?.id;
  const v = (k, d = '') => p ? (p[k] ?? d) : d;
  const opt = (arr, val, key, label) => arr.map(o => `<option value="${o[key]}" ${String(o[key]) === String(val) ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
  openSheet(p ? 'Editar producto' : 'Nuevo producto', `<form id="pf" class="stack">
    <label>Código (SKU / barras)<div class="scan-row" style="margin-top:.25rem"><input name="sku" value="${esc(v('sku', preSku))}" placeholder="Escanea o escribe el código"><button type="button" class="icon-btn scan-btn" id="pfScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div></label>
    <label>Nombre<input name="pname" value="${esc(v('name'))}" required></label>
    <label>Categoría<select name="category_id">${opt(cats, v('category_id'), 'id', c => c.name)}</select></label>
    <label>Unidad de medida<select name="unit">${opt(units, v('unit', 'und'), 'symbol', u => `${u.name} (${u.symbol})`)}</select></label>
    <label>Costo manual en USD (el que tú pones, no cambia solo)<input name="cost" type="number" step="0.0001" min="0" value="${v('manual_cost_usd', 0)}"></label>
    <label>Precio de venta en USD<input name="price" type="number" step="0.0001" min="0" value="${v('sale_price_usd', 0)}"></label>
    <label>Costo automático (el real, el que usa el sistema)<input value="${p && p.auto_cost_usd != null ? fmt(p.auto_cost_usd, 4) + ' USD' : 'Aún sin compras ni fabricaciones: se usa el costo manual'}" disabled></label>
    <p class="mut">El costo automático se actualiza solo con cada compra, fabricación o ajuste de ingreso con costo. Tu costo manual no cambia: solo se usa mientras no haya movimientos con costo.</p>
    <label class="chk"><input type="checkbox" name="no_track" ${p && p.track_inventory === false && !p.is_service ? 'checked' : ''}> Insumo sin inventario (consumo libre en fórmulas, ej: agua, gas, hielo). Puede tener costo 0 y nunca genera stock negativo.</label>
    <label class="chk"><input type="checkbox" name="is_service" ${p?.is_service ? 'checked' : ''}> Es un servicio facturable (ej: delivery). Tu costo es lo que pagas por él.</label>
    <label>Stock mínimo<input name="min" type="number" step="0.001" min="0" value="${v('min_stock', 0)}"></label>
    <label>Impuesto<select name="tax_id">${opt(taxes, v('tax_id', defTax), 'id', t => `${t.name} (${qty(t.percent)}%)`)}</select></label>
    ${photos ? `<label>Foto<input name="photo" type="file" accept="image/*"></label>${p?.image_url ? `<img class="thumb big" src="${esc(p.image_url)}" alt=""><label class="chk"><input type="checkbox" name="rmphoto"> Quitar la foto actual</label>` : ''}` : ''}
    <p id="pMargin" class="mut"></p>
    <div class="row"><button class="btn" type="submit">Guardar producto</button>${p ? '<button type="button" class="btn ghost" id="pfDel">Desactivar</button>' : ''}</div></form>`);
  const f = $('#pf'), el = f.elements;
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
      parts.push(`<span class="${low ? 'warn' : ''}">Margen: <b>${fmt(curM, 0)}%</b> (ganancia de ${fmt(pr - c)} USD/u)${low ? ` · por debajo del objetivo (${qty(minM)}%)` : ''}</span>`);
    }
    if (sug > 0) {
      parts.push(`Precio sugerido para ${qty(minM)}%: <b>${fmt(sug)} USD</b> <button type="button" class="lnk" id="pApplySug" style="padding:0 .3rem">Aplicar</button>`);
    }
    $('#pMargin').innerHTML = parts.join('<br>');
    if ($('#pApplySug')) $('#pApplySug').onclick = () => { el.price.value = sug.toFixed(2); mg(); };
  };
  const syncInvFlags = (src) => {
    if (src === 'svc' && el.is_service.checked) el.no_track.checked = false;
    if (src === 'nt' && el.no_track.checked) el.is_service.checked = false;
    const noInv = el.is_service.checked || el.no_track.checked;
    el.min.disabled = noInv;
    if (noInv) el.min.value = 0;
  };
  el.is_service.onchange = () => syncInvFlags('svc');
  el.no_track.onchange = () => syncInvFlags('nt');
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
      const row = {sku: el.sku.value.trim() || null, name: el.pname.value.trim(), category_id: +el.category_id.value || null, unit: el.unit.value,
        manual_cost_usd: +el.cost.value || 0, sale_price_usd: +el.price.value || 0, min_stock: trackInv ? (+el.min.value || 0) : 0,
        is_service: isSvc, track_inventory: trackInv, tax_id: +el.tax_id.value || null, image_url};
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
    db.from('products').select('id,sku,name,category_id,unit,sale_price_usd,avg_cost_usd,auto_cost_usd,manual_cost_usd,is_service,track_inventory,product_categories(name)').eq('active', true).order('name')
      .then(r => r.error ? q(db.from('products').select('id,sku,name,category_id,unit,sale_price_usd,avg_cost_usd,auto_cost_usd,manual_cost_usd,is_service,product_categories(name)').eq('active', true).order('name')) : r.data),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name'))
  ]);

  const targetMin = Number(S.rules?.min_margin_percent || 0) || 30;
  if (PM.margin === '') PM.margin = String(targetMin);

  // Excluir insumos sin inventario con precio 0 a menos que ya tengan precio de venta
  const listAll = prods.filter(p => !(p.track_inventory === false && !(Number(p.sale_price_usd) > 0)));
  const costOfP = (p) => Number(p.auto_cost_usd ?? p.avg_cost_usd ?? p.manual_cost_usd ?? 0);
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
        <label>Redondeo del precio USD
          <select id="pmRnd">
            <option value="none" ${PM.round === 'none' ? 'selected' : ''}>Exacto (2 decimales)</option>
            <option value="0.5" ${PM.round === '0.5' ? 'selected' : ''}>Redondear al 0,50 arriba</option>
            <option value="1" ${PM.round === '1' ? 'selected' : ''}>Redondear al 1,00 USD arriba</option>
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
            <small>Costo: ${fmt(c, 4)} USD | Actual: <b>${fmt(oldP)} USD</b> (${fmt(oldM, 0)}%)</small>
            ${changed ? `<small class="df ${newP >= oldP ? 'in' : 'outq'}">Nuevo: ${fmt(newP)} USD${S.rate ? ' (' + fmt(newP * S.rate) + ' Bs)' : ''} · Margen ${fmt(newM, 0)}%</small>` : ''}
          </span>
        </label>
        ${PM.mode === 'manual'
          ? `<label style="width:6.8rem;margin:0">Nuevo USD<input data-mp="${p.id}" type="number" step="0.01" min="0" value="${PM.manual[p.id] ?? oldP.toFixed(2)}"></label>`
          : `<span class="n" style="flex:none"><b>${fmt(newP)} USD</b><small class="${newM < targetMin - 0.1 && c > 0 ? 'warn' : 'mut'}">${fmt(newM, 0)}% margen</small></span>`}
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
