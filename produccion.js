// Producciones: fórmulas, producción con consumo real e historial
async function prData() {
  const [products, recipes, stock] = await Promise.all([
    q(db.from('products').select('id,name,unit,avg_cost_usd,sale_price_usd').eq('active', true).order('name')),
    q(db.from('recipes').select('*, recipe_items(product_id, quantity)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock'))
  ]);
  return {products, recipes, pm: Object.fromEntries(products.map(p => [p.id, p])), st: Object.fromEntries(stock.map(s => [s.product_id, Number(s.stock)]))};
}
const pOptions = (products, sel) => products.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${esc(p.unit)})</option>`).join('');
const costOf = (pm, id) => Number(pm[id]?.avg_cost_usd || 0);
const costLine = (tot, unitCost, fp, pm) => {
  const pr = Number(fp?.sale_price_usd || 0);
  return `Costo total: <b>${fmt(tot)} USD</b><br>Costo por ${esc(fp?.unit || 'unidad')}: <b>${fmt(unitCost)} USD</b>${S.rate ? ' (' + fmt(unitCost * S.rate) + ' Bs)' : ''}${pr ? ` | Margen: <b>${fmt((pr - unitCost) / pr * 100, 0)}%</b>` : ''}`;
};

// ---------- Fórmulas ----------
async function viewFormulas() {
  const D = await prData(), {recipes, pm} = D;
  $('#view').innerHTML = `<div class="list" id="fList">${recipes.map(r => {
    const tot = r.recipe_items.reduce((a, i) => a + i.quantity * costOf(pm, i.product_id), 0), u = tot / r.yield_qty, fp = pm[r.product_id], pr = Number(fp?.sale_price_usd || 0);
    return `<button class="item" data-id="${r.id}"><span><b>${esc(r.name)}</b><small>Rinde ${qty(r.yield_qty)} ${esc(fp?.unit)} de ${esc(fp?.name)}</small>
      <small>Costo: ${fmt(u)} USD${S.rate ? ' (' + fmt(u * S.rate) + ' Bs)' : ''} por ${esc(fp?.unit)}${pr ? ' | Margen ' + fmt((pr - u) / pr * 100, 0) + '%' : ''}</small></span><span class="mut">&rsaquo;</span></button>`;
  }).join('') || '<p class="mut">Aún no hay fórmulas. Pulsa el botón + para crear la primera.</p>'}</div>
  <button class="fab" id="fAdd" aria-label="Nueva fórmula">+</button>`;
  $('#fAdd').onclick = () => formulaForm(null, D);
  $('#fList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) formulaForm(recipes.find(r => String(r.id) === b.dataset.id), D); };
}

function formulaForm(r, D) {
  const {products, pm} = D;
  openSheet(r ? 'Editar fórmula' : 'Nueva fórmula', `<form id="fForm" class="stack">
    <label>Nombre de la fórmula<input name="fname" required placeholder="Ej: Cloro 1L estándar"></label>
    <label>Producto que se fabrica<select name="product_id">${pOptions(products)}</select></label>
    <label>Cantidad que rinde esta fórmula<input name="rend" type="number" step="0.001" min="0.001" value="1" required></label>
    <h2>Materiales</h2><div id="fLines" class="stack"></div>
    <button type="button" class="btn ghost" id="fAddLine">Agregar material</button>
    <p id="fCost" class="mut"></p>
    <label>Notas<input name="notes"></label>
    <div class="row"><button class="btn" type="submit">Guardar fórmula</button>${r ? '<button type="button" class="btn ghost" id="fDel">Desactivar</button>' : ''}</div></form>`);
  const f = $('#fForm').elements;
  const lines = () => [...document.querySelectorAll('#fLines .ln')].map(l => ({product_id: +l.querySelector('[name=mp]').value, quantity: +l.querySelector('[name=mq]').value}));
  const upd = () => {
    const L = lines(), tot = L.reduce((a, i) => a + i.quantity * costOf(pm, i.product_id), 0), y = +f.rend.value || 1;
    $('#fCost').innerHTML = costLine(tot, tot / y, pm[f.product_id.value], pm) + (L.some(i => !costOf(pm, i.product_id)) ? '<br><span class="warn">Algún material no tiene costo registrado.</span>' : '');
  };
  const addLine = (pid, qv) => {
    const d = document.createElement('div'); d.className = 'ln';
    d.innerHTML = `<label>Material<select name="mp">${pOptions(products, pid)}</select></label><label>Cantidad<input name="mq" type="number" step="0.0001" min="0.0001" value="${qv ?? ''}" required></label><button type="button" class="btn ghost" data-rm="1">&times;</button>`;
    $('#fLines').appendChild(d);
  };
  if (r) { f.fname.value = r.name; f.product_id.value = r.product_id; f.rend.value = r.yield_qty; f.notes.value = r.notes || ''; r.recipe_items.forEach(i => addLine(i.product_id, i.quantity)); } else addLine();
  upd();
  $('#fAddLine').onclick = () => addLine();
  $('#fLines').onclick = (e) => { if (e.target.dataset.rm && document.querySelectorAll('#fLines .ln').length > 1) { e.target.closest('.ln').remove(); upd(); } };
  $('#fForm').addEventListener('input', upd); $('#fForm').addEventListener('change', upd);
  $('#fForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await q(db.rpc('guardar_formula', {p_id: r ? r.id : null, p_product_id: +f.product_id.value, p_name: f.fname.value.trim(), p_yield: +f.rend.value, p_notes: f.notes.value.trim() || null, p_items: lines().filter(i => i.quantity > 0)}));
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
      <div class="row"><button class="btn" id="pGo">Registrar producción</button></div></div>`;
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
      const c = costOf(pm, i.product_id), sh = i.actual - (st[i.product_id] || 0);
      tot += i.actual * c; theo += i.planned * c; if (!c) miss = true;
      if (sh > 0.0005) lack.push(`${pm[i.product_id]?.name} (faltan ${qty(sh)})`);
    });
    const n = +$('#pQty').value || 1, diff = tot - theo;
    $('#pSum').innerHTML = costLine(tot, tot / n, fin(), pm)
      + (free ? '' : `<br><span class="mut">Según la fórmula: ${fmt(theo)} USD | Diferencia: ${diff >= 0 ? '+' : ''}${fmt(diff)} USD</span>`)
      + (miss ? '<br><span class="warn">Algún material no tiene costo: el costo puede estar incompleto.</span>' : '')
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
      return `<div class="pl" data-pid="${i.product_id}" data-plan="${plan}"><div><b>${esc(p?.name)}</b><small>Teórico: ${qty(plan)} ${esc(p?.unit)} | Disponible: ${qty(st[i.product_id] || 0)}</small></div>
        <label>Real usado<input type="number" step="0.0001" min="0" value="${plan}"></label></div>`;
    }).join('');
    calc();
  };
  $('#pRec').onchange = build; $('#pProd').onchange = build; $('#pQty').oninput = build;
  $('#pAdd').onclick = addLine;
  $('#pLines').addEventListener('input', calc); $('#pLines').addEventListener('change', calc);
  $('#pLines').addEventListener('click', (e) => { if (e.target.dataset.rm && document.querySelectorAll('#pLines .ln').length > 1) { e.target.closest('.ln').remove(); calc(); } });
  $('#pSave').onchange = () => $('#pNameW').classList.toggle('hidden', !$('#pSave').checked);
  $('#pGo').onclick = () => run(async () => {
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
    const id = await q(db.rpc('registrar_produccion', {p_recipe_id: rid, p_qty: n, p_notes: $('#pNotes').value.trim() || null, p_items: it}));
    toast('Producción #' + id + ' registrada. Inventario y costos actualizados.'); render();
  });
}

// ---------- Historial ----------
async function viewHistorialProd() {
  const rows = await q(db.from('production_orders').select('id,qty_produced,status,total_cost_usd,notes,produced_at,created_at,products(name,unit)').order('id', {ascending: false}).limit(30));
  $('#view').innerHTML = `<div class="list" id="hList">${rows.map(o => `<button class="item" data-id="${o.id}"><span><b>#${o.id} ${esc(o.products?.name)}</b>
    <small>${qty(o.qty_produced)} ${esc(o.products?.unit)} | ${fdate(o.produced_at || o.created_at)}</small>
    <small>Costo: ${fmt(o.total_cost_usd)} USD (${fmt(o.total_cost_usd / o.qty_produced)} por unidad)</small></span>
    <span class="badge ${o.status === 'completada' ? 'ok' : 'out'}">${o.status === 'completada' ? 'Completada' : 'Anulada'}</span></button>`).join('') || '<p class="mut">Aún no hay producciones registradas.</p>'}</div>`;
  $('#hList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => prDetail(rows.find(o => String(o.id) === b.dataset.id))); };
}
async function prDetail(o) {
  const items = await q(db.from('production_items').select('planned_qty,actual_qty,unit_cost_usd,products(name)').eq('production_id', o.id));
  const body = items.map(i => `<tr><td>${esc(i.products?.name)}</td><td class="n">${qty(i.planned_qty)}</td><td class="n">${qty(i.actual_qty)}</td><td class="n">${fmt(i.actual_qty * i.unit_cost_usd)}</td></tr>`).join('');
  openSheet('Producción #' + o.id, `<p><b>${esc(o.products?.name)}</b>: ${qty(o.qty_produced)} ${esc(o.products?.unit)}<br>Costo total: ${fmt(o.total_cost_usd)} USD${S.rate ? ' (' + fmt(o.total_cost_usd * S.rate) + ' Bs)' : ''}</p>
    <div class="scroll"><table><thead><tr><th>Material</th><th class="n">Teórico</th><th class="n">Real</th><th class="n">Costo USD</th></tr></thead><tbody>${body}</tbody></table></div>
    ${o.notes ? `<p class="mut">${esc(o.notes)}</p>` : ''}${o.status === 'completada' ? '<div class="row"><button class="btn ghost" id="pAnu">Anular producción</button></div>' : ''}`);
  const a = $('#pAnu');
  if (a) a.onclick = () => run(async () => {
    if (!confirm('¿Anular esta producción? Se devuelven los materiales y se descuenta el producto terminado.')) return;
    await q(db.rpc('anular_produccion', {p_id: o.id})); closeSheet(); toast('Producción anulada'); render();
  });
}
