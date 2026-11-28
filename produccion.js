// Producciones: fórmulas con conversión de unidades, insumos sin inventario, consumo real, historial y Hoja de lote
const isUntracked = (p) => !!(p && (p.track_inventory === false || p.is_service));

async function prData() {
  const [products, recipes, stock, units] = await Promise.all([
    db.from('products').select('id,name,unit,avg_cost_usd,sale_price_usd,is_service,is_combo,track_inventory').eq('active', true).order('name')
      .then(r => r.error ? q(db.from('products').select('id,name,unit,avg_cost_usd,sale_price_usd,is_service').eq('active', true).order('name')) : r.data)
      .then(list => list.filter(p => !p.is_combo)),
    q(db.from('recipes').select('*, recipe_items(product_id, quantity)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock')),
    db.from('units').select('symbol,name,kind,factor_to_base').eq('active', true).order('factor_to_base', {ascending: false}).then(r => r.error ? [] : (r.data || []))
  ]);
  return {
    products,
    recipes,
    units,
    pm: Object.fromEntries(products.map(p => [p.id, p])),
    um: Object.fromEntries(units.map(u => [u.symbol, u])),
    st: Object.fromEntries(stock.map(s => [s.product_id, Number(s.stock)]))
  };
}

const pOptions = (products, sel) => products.map(p =>
  `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${esc(p.unit)})${isUntracked(p) ? ' · sin inv.' : ''}</option>`
).join('');

function compatibleUnits(units, um, baseSym) {
  const base = um?.[baseSym];
  if (!base || !base.kind || !(Number(base.factor_to_base) > 0)) return [{symbol: baseSym || 'und', factor_to_base: 1}];
  const list = (units || []).filter(u => u.kind === base.kind && Number(u.factor_to_base) > 0);
  return list.length ? list : [base];
}

function convertQtyUnit(val, fromSym, toSym, um) {
  const n = Number(val) || 0;
  if (!fromSym || !toSym || fromSym === toSym) return n;
  const uFrom = um?.[fromSym], uTo = um?.[toSym];
  if (!uFrom || !uTo || uFrom.kind !== uTo.kind || !(Number(uTo.factor_to_base) > 0)) return n;
  return n * (Number(uFrom.factor_to_base) / Number(uTo.factor_to_base));
}

const costOf = (pm, id) => Number(pm[id]?.avg_cost_usd || 0);
const costLine = (tot, unitCost, fp, pm) => {
  const pr = Number(fp?.sale_price_usd || 0);
  return `Costo total: <b>${fmtCur(tot)}</b><br>Costo por ${esc(fp?.unit || 'unidad')}: <b>${fmtCur(unitCost)}</b>${S.rate ? ' (' + fmt(unitCost * S.rate) + ' Bs)' : ''}${pr ? ` | Margen: <b>${fmt((pr - unitCost) / pr * 100, 0)}%</b>` : ''}`;
};

// ---------- Fórmulas (con conversión de unidades ej: g -> kg, ml -> L) ----------
async function viewFormulas() {
  const D = await prData(), {recipes, pm} = D;
  $('#view').innerHTML = `<div class="list" id="fList">${recipes.map(r => {
    const tot = r.recipe_items.reduce((a, i) => a + i.quantity * costOf(pm, i.product_id), 0), u = tot / r.yield_qty, fp = pm[r.product_id], pr = Number(fp?.sale_price_usd || 0);
    return `<button class="item" data-id="${r.id}"><span><b>${esc(r.name)}</b><small>Rinde ${qty(r.yield_qty)} ${esc(fp?.unit)} de ${esc(fp?.name)} · ${r.recipe_items.length} materiales</small>
      <small>Costo: ${fmtCur(u)}${S.rate ? ' (' + fmt(u * S.rate) + ' Bs)' : ''} por ${esc(fp?.unit)}${pr ? ' | Margen ' + fmt((pr - u) / pr * 100, 0) + '%' : ''}</small></span><span class="mut">&rsaquo;</span></button>`;
  }).join('') || '<p class="mut">Aún no hay fórmulas. Pulsa el botón + para crear la primera.</p>'}</div>
  <button class="fab" id="fAdd" aria-label="Nueva fórmula">+</button>`;
  $('#fAdd').onclick = () => formulaForm(null, D);
  $('#fList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) formulaForm(recipes.find(r => String(r.id) === b.dataset.id), D); };
}

function formulaForm(r, D) {
  const {products, units, pm, um} = D;
  openSheet(r ? 'Editar fórmula' : 'Nueva fórmula', `<form id="fForm" class="stack">
    <label>Nombre de la fórmula<input name="fname" required placeholder="Ej: Cloro 1L estándar"></label>
    <label>Producto que se fabrica<select name="product_id">${pOptions(products)}</select></label>
    <label>Cantidad que rinde esta fórmula<input name="rend" type="number" step="0.001" min="0.001" value="1" required></label>
    <h2>Materiales</h2>
    <p class="mut" style="margin:-.3rem 0 .2rem">Puedes escribir cantidades en subunidades compatibles (ej: <b>g</b> para un insumo en <b>kg</b>, o <b>ml</b> para <b>L</b>); se convierten automáticamente.</p>
    <div id="fLines" class="stack"></div>
    <button type="button" class="btn ghost" id="fAddLine">Agregar material</button>
    <p id="fCost" class="mut"></p>
    <label>Notas<input name="notes"></label>
    <div class="row"><button class="btn" type="submit">Guardar fórmula</button>${r ? '<button type="button" class="btn ghost" id="fDel">Desactivar</button>' : ''}</div></form>`);
  const f = $('#fForm').elements;

  const lines = () => [...document.querySelectorAll('#fLines .fln')].map(l => {
    const pid = +l.querySelector('[name=mp]').value;
    const rawQty = +l.querySelector('[name=mq]').value || 0;
    const fromU = l.querySelector('[name=mu]')?.value || pm[pid]?.unit;
    const baseU = pm[pid]?.unit || fromU;
    const conv = Math.round(convertQtyUnit(rawQty, fromU, baseU, um) * 1000000) / 1000000;
    return {product_id: pid, quantity: conv, rawQty, fromU, baseU, el: l};
  });

  const fillUnitSel = (rowEl, keepUnit = null) => {
    const pid = +rowEl.querySelector('[name=mp]').value;
    const baseU = pm[pid]?.unit || 'und';
    const opts = compatibleUnits(units, um, baseU);
    const uSel = rowEl.querySelector('[name=mu]');
    const chosen = keepUnit && opts.some(u => u.symbol === keepUnit) ? keepUnit : baseU;
    uSel.innerHTML = opts.map(u => `<option value="${esc(u.symbol)}" ${u.symbol === chosen ? 'selected' : ''}>${esc(u.symbol)}</option>`).join('');
    uSel.disabled = opts.length <= 1;
  };

  const upd = () => {
    const L = lines();
    L.forEach(i => {
      const hint = i.el.querySelector('.fconv');
      if (!hint) return;
      const p = pm[i.product_id];
      const parts = [];
      if (i.fromU !== i.baseU && i.rawQty > 0) parts.push(`= ${qty(i.quantity)} ${i.baseU}`);
      if (isUntracked(p)) parts.push('Insumo sin inventario');
      hint.textContent = parts.join(' · ');
    });
    const tot = L.reduce((a, i) => a + i.quantity * costOf(pm, i.product_id), 0), y = +f.rend.value || 1;
    const missCost = L.some(i => i.quantity > 0 && !costOf(pm, i.product_id) && !isUntracked(pm[i.product_id]));
    $('#fCost').innerHTML = costLine(tot, tot / y, pm[f.product_id.value], pm)
      + (missCost ? '<br><span class="warn">Algún material con inventario no tiene costo registrado.</span>' : '');
  };

  const addLine = (pid, qv) => {
    const d = document.createElement('div'); d.className = 'fln stack'; d.style.gap = '.25rem';
    d.innerHTML = `<div class="ln" style="grid-template-columns:1fr 5.5rem 4.3rem auto">
      <label>Material<select name="mp">${pOptions(products, pid)}</select></label>
      <label>Cant.<input name="mq" type="number" step="0.0001" min="0.0001" value="${qv ?? ''}" required></label>
      <label>Und.<select name="mu"></select></label>
      <button type="button" class="btn ghost" data-rm="1">&times;</button>
    </div><small class="mut fconv"></small>`;
    $('#fLines').appendChild(d);
    fillUnitSel(d);
  };

  if (r) {
    f.fname.value = r.name; f.product_id.value = r.product_id; f.rend.value = r.yield_qty; f.notes.value = r.notes || '';
    r.recipe_items.forEach(i => addLine(i.product_id, i.quantity));
  } else {
    addLine();
  }
  upd();

  $('#fAddLine').onclick = () => { addLine(); upd(); };
  $('#fLines').addEventListener('change', (e) => {
    if (e.target.name === 'mp') fillUnitSel(e.target.closest('.fln'));
    upd();
  });
  $('#fLines').onclick = (e) => {
    if (e.target.dataset.rm && document.querySelectorAll('#fLines .fln').length > 1) {
      e.target.closest('.fln').remove();
      upd();
    }
  };
  $('#fForm').addEventListener('input', upd);
  $('#fForm').addEventListener('change', upd);
  $('#fForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const clean = lines().filter(i => i.quantity > 0).map(i => ({product_id: i.product_id, quantity: i.quantity}));
      if (!clean.length) throw new Error('Agrega al menos un material con cantidad');
      await q(db.rpc('guardar_formula', {p_id: r ? r.id : null, p_product_id: +f.product_id.value, p_name: f.fname.value.trim(), p_yield: +f.rend.value, p_notes: f.notes.value.trim() || null, p_items: clean}));
      closeSheet(); toast('Fórmula guardada'); render();
    });
  };
  if (r) $('#fDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar esta fórmula?')) return;
    await q(db.from('recipes').update({active: false}).eq('id', r.id)); closeSheet(); toast('Fórmula desactivada'); render();
  });
}

// ---------- Producir ----------
async function viewProducir() {
  const {products, recipes, pm, st} = await prData();
  $('#view').innerHTML = `<div class="card stack">
    <label>Tipo de producción<select id="pRec"><option value="">Selecciona una opción</option><option value="free">Fórmula de una sola vez</option>${recipes.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
    <label id="pProdW" class="hidden">Producto que se fabrica<select id="pProd">${pOptions(products)}</select></label>
    <label>Cantidad a producir <span id="pUnit" class="mut"></span><input id="pQty" type="number" step="0.001" min="0.001"></label></div>
    <div class="card hidden" id="pBox"><h2>Materiales</h2><p class="mut" id="pHint"></p><div id="pLines"></div>
      <button type="button" class="btn ghost hidden" id="pAdd">Agregar material</button><p id="pSum"></p>
      <div id="pSaveW" class="stack hidden"><label class="chk"><input type="checkbox" id="pSave"> Guardar como fórmula para usarla otra vez</label>
        <label id="pNameW" class="hidden">Nombre de la fórmula<input id="pName"></label></div>
      <label>Nota<input id="pNotes" placeholder="Ej: lote 12"></label>
      <div class="row"><button class="btn" id="pDraft">Crear orden (en proceso)</button><button class="btn ghost" id="pGo">Producir y finalizar</button></div></div>`;
  let cur = null, free = false;
  const fin = () => pm[free ? +$('#pProd').value : cur?.product_id];
  const items = () => [...document.querySelectorAll('#pLines > div')].map(l => free
    ? {product_id: +l.querySelector('[name=mp]').value, planned: +l.querySelector('[name=mq]').value || 0, actual: +l.querySelector('[name=mq]').value || 0}
    : {product_id: +l.dataset.pid, planned: +l.dataset.plan, actual: +l.querySelector('input').value || 0}).filter(i => i.actual > 0 || !free);
  const addLine = () => {
    const d = document.createElement('div'); d.className = 'ln';
    d.innerHTML = `<label>Material<select name="mp">${pOptions(products)}</select></label><label>Cantidad usada<input name="mq" type="number" step="0.0001" min="0"></label><button type="button" class="btn ghost" data-rm="1">&times;</button>`;
    $('#pLines').appendChild(d);
  };
  const calc = () => {
    if (!fin()) return 0;
    let tot = 0, theo = 0, miss = false; const lack = [];
    items().forEach(i => {
      const p = pm[i.product_id], untracked = isUntracked(p), c = costOf(pm, i.product_id);
      tot += i.actual * c; theo += i.planned * c;
      if (!c && !untracked && i.actual > 0) miss = true;
      if (!untracked) {
        const sh = i.actual - (st[i.product_id] || 0);
        if (sh > 0.0005) lack.push(`${p?.name} (faltan ${qty(sh)})`);
      }
    });
    const n = +$('#pQty').value || 1, diff = tot - theo;
    $('#pSum').innerHTML = costLine(tot, tot / n, fin(), pm)
      + (free ? '' : `<br><span class="mut">Según la fórmula: ${fmtCur(theo)} | Diferencia: ${diff >= 0 ? '+' : ''}${fmtCur(diff)}</span>`)
      + (miss ? '<br><span class="warn">Algún material con inventario no tiene costo: el costo puede estar incompleto.</span>' : '')
      + (lack.length ? `<br><span class="warn">Inventario insuficiente: ${esc(lack.join(', '))}</span>` : '');
    return lack.length;
  };
  const build = () => {
    const v = $('#pRec').value, n = +$('#pQty').value;
    free = v === 'free'; cur = free ? null : recipes.find(x => String(x.id) === v) || null;
    $('#pProdW').classList.toggle('hidden', !free); $('#pSaveW').classList.toggle('hidden', !free); $('#pAdd').classList.toggle('hidden', !free);
    $('#pUnit').textContent = fin() ? '(' + fin().unit + ')' : '';
    const ok = (cur || free) && n > 0;
    $('#pBox').classList.toggle('hidden', !ok);
    if (!ok) return;
    $('#pHint').textContent = free ? 'Agrega los materiales y la cantidad que usas de cada uno.' : 'Si usaste más o menos que lo teórico, corrige la cantidad real.';
    if (free) { if (!document.querySelector('#pLines .ln')) { $('#pLines').innerHTML = ''; addLine(); } }
    else $('#pLines').innerHTML = cur.recipe_items.map(i => {
      const p = pm[i.product_id], plan = Math.round(i.quantity * (n / cur.yield_qty) * 10000) / 10000;
      const dispTxt = isUntracked(p) ? 'Insumo sin inventario' : `Disponible: ${qty(st[i.product_id] || 0)}`;
      return `<div class="pl" data-pid="${i.product_id}" data-plan="${plan}"><div><b>${esc(p?.name)}</b><small>Teórico: ${qty(plan)} ${esc(p?.unit)} | ${dispTxt}</small></div>
        <label>Real usado<input type="number" step="0.0001" min="0" value="${plan}"></label></div>`;
    }).join('');
    calc();
  };
  $('#pRec').onchange = build; $('#pProd').onchange = build; $('#pQty').oninput = build;
  $('#pAdd').onclick = addLine;
  $('#pLines').addEventListener('input', calc); $('#pLines').addEventListener('change', calc);
  $('#pLines').addEventListener('click', (e) => { if (e.target.dataset.rm && document.querySelectorAll('#pLines .ln').length > 1) { e.target.closest('.ln').remove(); calc(); } });
  $('#pSave').onchange = () => $('#pNameW').classList.toggle('hidden', !$('#pSave').checked);
  const goProd = (finish) => run(async () => {
    const it = items(), n = +$('#pQty').value, saveF = free && $('#pSave').checked;
    if (!it.length) throw new Error('Agrega al menos un material con su cantidad');
    if (saveF && !$('#pName').value.trim()) throw new Error('Escribe un nombre para la fórmula');
    if (calc() && !confirm('Hay materiales con inventario insuficiente. ¿Registrar la producción de todos modos?')) return;
    let rid = cur?.id;
    if (free) {   // la fórmula de una sola vez se guarda oculta, solo para el historial
      rid = await q(db.rpc('guardar_formula', {p_id: null, p_product_id: +$('#pProd').value, p_name: saveF ? $('#pName').value.trim() : 'Una sola vez ' + new Date().toLocaleDateString('es-VE'),
        p_yield: n, p_notes: null, p_items: it.map(i => ({product_id: i.product_id, quantity: i.actual}))}));
      if (!saveF) await q(db.from('recipes').update({active: false}).eq('id', rid));
    }
    const id = await q(db.rpc('crear_orden_produccion', {p_recipe_id: rid, p_qty: n, p_notes: $('#pNotes').value.trim() || null, p_items: it, p_finish: finish}));
    toast(finish ? 'Producción #' + id + ' finalizada. Inventario y costos actualizados.' : 'Orden #' + id + ' creada en proceso. Puedes modificarla en Historial.'); render();
  });
  $('#pGo').onclick = () => goProd(true); $('#pDraft').onclick = () => goProd(false);
}

// ---------- Hoja de lote en foto (WhatsApp / Descargar / Imprimir) ----------
async function showProdSheet(o, L, pm) {
  const set = await q(db.from('settings').select('*').eq('id', 1).single()).catch(() => ({}));
  const stLabel = (PST[o.status]?.[0] || o.status || '').toUpperCase();
  const buildDoc = () => {
    const qProd = Number($('#oQty')?.value || o.qty_produced || 1);
    const items = L.map(l => {
      const p = pm[l.pid];
      return {
        name: p?.name || ('Material #' + l.pid),
        unit: p?.unit || 'und',
        untracked: isUntracked(p),
        planned: l.plan,
        actual: l.act,
        costUsd: l.act * costOf(pm, l.pid)
      };
    });
    const tot = items.reduce((a, x) => a + x.costUsd, 0);
    return {
      id: Number(o.id) < 0 ? 'LOC-' + Math.abs(o.id) : o.id,
      status: stLabel,
      dateStr: fdate(o.produced_at || o.created_at),
      productName: o.products?.name || pm[o.product_id]?.name || ('Producto #' + o.product_id),
      unit: o.products?.unit || pm[o.product_id]?.unit || 'und',
      qty: qProd,
      items,
      totalCostUsd: tot,
      unitCostUsd: qProd > 0 ? tot / qProd : 0,
      notes: ($('#oNotes')?.value ?? o.notes ?? '').trim()
    };
  };

  let curBlob = null;
  const doc = buildDoc();
  openSheet('Hoja de lote #' + doc.id, `
    <label class="chk" style="margin-bottom:.6rem"><input type="checkbox" id="psShowCost"> Incluir costos en la hoja (solo administración)</label>
    <div id="psPrev"><p class="mut">Generando hoja de producción...</p></div>
    <div class="row">
      <button type="button" class="btn" id="psShare">Enviar por WhatsApp</button>
      <button type="button" class="btn ghost" id="psDown">Descargar foto</button>
    </div>
    <div class="row"><button type="button" class="btn ghost" id="psPrint">Imprimir</button></div>`);

  const paint = async () => {
    const withCosts = !!$('#psShowCost')?.checked;
    try {
      curBlob = await prodOrderBlob(doc, set, withCosts);
      if ($('#psPrev')) $('#psPrev').innerHTML = `<img class="rimg" src="${URL.createObjectURL(curBlob)}" alt="Hoja de producción">`;
    } catch (e) {
      if ($('#psPrev')) $('#psPrev').innerHTML = '<p class="mut">No se pudo generar la hoja de producción.</p>';
    }
  };
  paint();
  $('#psShowCost').onchange = paint;
  $('#psShare').onclick = () => run(async () => shareImage(curBlob, '', 'produccion-' + doc.id));
  $('#psDown').onclick = () => run(async () => { if (!curBlob) throw new Error('Generando imagen...'); downloadBlob(curBlob, 'produccion-' + doc.id + '.png'); });
  $('#psPrint').onclick = () => {
    const withCosts = !!$('#psShowCost')?.checked;
    const lines = [
      `${(set.business_name || 'MI NEGOCIO').toUpperCase()}`,
      `HOJA DE PRODUCCIÓN #${doc.id} [${doc.status}]`,
      `Fecha: ${doc.dateStr}`,
      `Fabricar: ${qty(doc.qty)} ${doc.unit} de ${doc.productName}`,
      '----------------------------------------',
      ...doc.items.map(i => `[ ] ${i.name}${i.untracked ? ' (libre)' : ''}: ${qty(i.actual)} ${i.unit}${withCosts ? ' · ' + fmtCur(i.costUsd) : ''}`),
      ...(withCosts ? ['----------------------------------------', `Costo total: ${fmtCur(doc.totalCostUsd)} (${fmtCur(doc.unitCostUsd)}/${doc.unit})`] : []),
      ...(doc.notes ? ['----------------------------------------', 'Nota: ' + doc.notes] : [])
    ].join('\n');
    printTicket(lines, '80mm');
  };
}

// ---------- Historial y edición de órdenes ----------
const PST = {en_proceso: ['En proceso', 'low'], completada: ['Completada', 'ok'], anulada: ['Anulada', 'out'], borrador: ['Borrador', 'low']};
async function viewHistorialProd() {
  const rows = await q(db.from('production_orders').select('id,product_id,qty_produced,status,total_cost_usd,notes,produced_at,created_at,products(name,unit)').order('id', {ascending: false}).limit(40));
  rows.sort((a, b) => (b.status === 'en_proceso') - (a.status === 'en_proceso'));
  $('#view').innerHTML = `<div class="list" id="hList">${rows.map(o => { const st = PST[o.status] || [o.status, 'low']; return `<button class="item" data-id="${o.id}"><span><b>${Number(o.id) < 0 ? 'LOC-' + Math.abs(o.id) : '#' + o.id} ${esc(o.products?.name)}</b>
    <small>${qty(o.qty_produced)} ${esc(o.products?.unit)} | ${fdate(o.produced_at || o.created_at)}</small>
    <small>${o.status === 'en_proceso' ? 'Orden abierta: puedes seguir modificando el consumo' : 'Costo: ' + fmtCur(o.total_cost_usd) + ' (' + fmtCur(o.total_cost_usd / o.qty_produced) + ' por unidad)'}</small></span>
    <span class="badge ${st[1]}">${st[0]}</span></button>`; }).join('') || '<p class="mut">Aún no hay producciones registradas.</p>'}</div>`;
  $('#hList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => prDetail(rows.find(o => String(o.id) === b.dataset.id))); };
}
async function prDetail(o) {
  const [items, D] = await Promise.all([q(db.from('production_items').select('product_id,planned_qty,actual_qty').eq('production_id', o.id).order('id')), prData()]);
  const {products, pm, st} = D, off = o.status === 'anulada', L = items.map(i => ({pid: i.product_id, plan: +i.planned_qty, act: +i.actual_qty})), ps = PST[o.status] || [o.status, 'low'];
  openSheet('Producción #' + (Number(o.id) < 0 ? 'LOC-' + Math.abs(o.id) : o.id), `<p><b>${esc(o.products?.name)}</b> | <span class="badge ${ps[1]}">${ps[0]}</span></p><div class="stack">
    <label>Cantidad producida (${esc(o.products?.unit)})<input id="oQty" type="number" step="0.001" min="0.001" value="${o.qty_produced}" ${off ? 'disabled' : ''}></label>
    <h2>Materiales usados</h2><div id="oL"></div>
    ${off ? '' : `<div class="ln"><label>Agregar material<select id="oAddS">${pOptions(products)}</select></label><label>Cant.<input id="oAddQ" type="number" step="0.0001" min="0"></label><button class="btn ghost" type="button" id="oAdd">+</button></div>`}
    <p id="oSum"></p><label>Nota<input id="oNotes" value="${esc(o.notes || '')}" ${off ? 'disabled' : ''}></label>
    <div class="row">
      <button type="button" class="btn ghost" id="oSheet">Hoja de lote</button>
      ${off ? '' : `<button class="btn" id="oSave">Guardar cambios</button>${o.status === 'en_proceso' ? '<button class="btn ghost" id="oFin">Finalizar</button>' : ''}<button class="btn ghost" id="oAnu" style="color:var(--bad)">Anular</button>`}
    </div>
    ${off ? '' : `<p class="mut">${o.status === 'completada' ? 'Al guardar, se rehace el consumo en el inventario y se recalcula el costo.' : 'Mientras esté en proceso no se mueve el inventario. Al finalizar se descuentan los materiales con stock y entra el producto terminado.'}</p>`}</div>`);
  const sum = () => { const tot = L.reduce((a, l) => a + l.act * costOf(pm, l.pid), 0), n = +$('#oQty').value || 1; $('#oSum').innerHTML = costLine(tot, tot / n, pm[o.product_id], pm) + '<br><span class="mut">Calculado con los costos actuales.</span>'; };
  const draw = () => {
    $('#oL').innerHTML = L.map((l, i) => {
      const p = pm[l.pid];
      const dispTxt = isUntracked(p) ? 'Insumo sin inventario' : `Disponible: ${qty(st[l.pid] || 0)}`;
      return `<div class="pl" data-i="${i}"><div><b>${esc(p?.name)}</b><small>Teórico: ${qty(l.plan)} ${esc(p?.unit)} | ${dispTxt}</small>${off ? '' : `<button class="lnk bad" data-rm="${i}">Quitar</button>`}</div>
        <label>Real usado<input data-a="${i}" type="number" step="0.0001" min="0" value="${l.act}" ${off ? 'disabled' : ''}></label></div>`;
    }).join('') || '<p class="mut">Sin materiales.</p>';
    sum();
  };
  draw();
  $('#oSheet').onclick = () => run(() => showProdSheet(o, L, pm));
  if (off) return;
  $('#oL').addEventListener('input', (e) => { if (e.target.dataset.a !== undefined) { L[+e.target.dataset.a].act = +e.target.value || 0; sum(); } });
  $('#oL').addEventListener('click', (e) => { if (e.target.dataset.rm !== undefined && L.length > 1) { L.splice(+e.target.dataset.rm, 1); draw(); } });
  $('#oQty').oninput = sum;
  $('#oAdd').onclick = () => { const pid = +$('#oAddS').value, a = +$('#oAddQ').value || 0, ex = L.find(l => l.pid === pid); if (ex) ex.act += a; else L.push({pid, plan: 0, act: a}); $('#oAddQ').value = ''; draw(); };
  const save = () => q(db.rpc('actualizar_orden_produccion', {p_id: o.id, p_qty: +$('#oQty').value, p_notes: $('#oNotes').value.trim() || null, p_items: L.map(l => ({product_id: l.pid, planned: l.plan, actual: l.act}))}));
  $('#oSave').onclick = () => run(async () => { await save(); closeSheet(); toast('Producción actualizada'); render(); });
  if (o.status === 'en_proceso') $('#oFin').onclick = () => run(async () => {
    if (L.some(l => !isUntracked(pm[l.pid]) && l.act > (st[l.pid] || 0)) && !confirm('Hay materiales con inventario insuficiente. ¿Finalizar de todos modos?')) return;
    await save(); await q(db.rpc('finalizar_produccion', {p_id: o.id})); closeSheet(); toast('Producción finalizada. Inventario y costos actualizados.'); render();
  });
  $('#oAnu').onclick = () => run(async () => {
    if (!confirm('¿Anular esta producción?' + (o.status === 'completada' ? ' Se devuelven los materiales y se descuenta el producto terminado.' : ''))) return;
    await q(db.rpc('anular_produccion', {p_id: o.id})); closeSheet(); toast('Producción anulada'); render();
  });
}
