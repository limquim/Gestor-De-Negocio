// Planificación de fabricación: ¿alcanza el material para todo lo que quiero producir al mismo tiempo?
const PL = {rows: [{rid: '', qty: ''}]};
async function viewPlanificar() {
  const [D, comm] = await Promise.all([prData(), q(db.from('production_items').select('product_id,actual_qty,production_orders!inner(status)').eq('production_orders.status', 'en_proceso'))]);
  const {recipes, pm, st} = D, held = {};
  comm.forEach(c => { held[c.product_id] = (held[c.product_id] || 0) + +c.actual_qty; });
  const avail = (pid) => (st[pid] || 0) - (held[pid] || 0);
  const can = recipes.map(f => {
    let best = Infinity, lim = '';
    f.recipe_items.forEach(i => { const per = i.quantity / f.yield_qty, m = per > 0 ? Math.max(0, avail(i.product_id)) / per : Infinity; if (m < best) { best = m; lim = pm[i.product_id]?.name; } });
    return {f, max: best === Infinity ? 0 : best, lim};
  });
  $('#view').innerHTML = `<div class="card stack"><h2>¿Qué quieres fabricar?</h2><p class="mut">Agrega todas las fórmulas y cantidades. El cálculo suma el material de todas juntas, así que si comparten materia prima lo sabrás.</p>
    <div id="plR" class="stack"></div><div class="row"><button class="btn ghost" id="plAdd" type="button">Agregar otra fórmula</button><button class="btn" id="plGo" type="button">Calcular</button></div></div>
    <div id="plOut"></div>
    <div class="card"><h2>¿Cuánto puedo fabricar con lo que tengo?</h2><p class="mut">Cada fórmula por separado, con el inventario disponible${Object.keys(held).length ? ' (sin contar lo comprometido en órdenes en proceso)' : ''}.</p>
      ${can.map(c => `<div class="rl"><span>${esc(c.f.name)}${c.max < 1e9 && c.lim ? `<small class="mut" style="display:block">Limita: ${esc(c.lim)}</small>` : ''}</span><b>${qty(Math.floor(c.max * 100) / 100)} ${esc(pm[c.f.product_id]?.unit)}</b></div>`).join('') || '<p class="mut">Aún no tienes fórmulas guardadas.</p>'}</div>`;
  const drawRows = () => {
    $('#plR').innerHTML = PL.rows.map((r, i) => `<div class="ln" data-i="${i}"><label>Fórmula<select data-f="rid"><option value="">Elegir...</option>${recipes.map(f => `<option value="${f.id}" ${String(f.id) === String(r.rid) ? 'selected' : ''}>${esc(f.name)} (${esc(pm[f.product_id]?.unit)})</option>`).join('')}</select></label>
      <label>Cantidad<input data-f="qty" type="number" step="0.001" min="0" value="${r.qty}"></label><button class="btn ghost" type="button" data-rm="${i}">&times;</button></div>`).join('');
  };
  drawRows();
  $('#plR').addEventListener('input', (e) => { const l = e.target.closest('.ln'); if (l && e.target.dataset.f) PL.rows[+l.dataset.i][e.target.dataset.f] = e.target.value; });
  $('#plR').addEventListener('click', (e) => { if (e.target.dataset.rm !== undefined && PL.rows.length > 1) { PL.rows.splice(+e.target.dataset.rm, 1); drawRows(); } });
  $('#plAdd').onclick = () => { PL.rows.push({rid: '', qty: ''}); drawRows(); };
  const calc = () => {
    const need = {}, fs = [];
    PL.rows.forEach(x => {
      const f = recipes.find(r => String(r.id) === String(x.rid)), n = num(x.qty); if (!f || !(n > 0)) return;
      const k = n / f.yield_qty; fs.push({f, n, k});
      f.recipe_items.forEach(i => { const a = need[i.product_id] || (need[i.product_id] = {pid: i.product_id, total: 0, uses: []}); const qn = i.quantity * k; a.total += qn; a.uses.push(f.name); });
    });
    return {fs, mats: Object.values(need).map(a => ({...a, av: avail(a.pid), miss: Math.max(0, a.total - avail(a.pid))})).sort((a, b) => b.miss - a.miss)};
  };
  $('#plGo').onclick = () => {
    const {fs, mats} = calc(); if (!fs.length) return toast('Elige al menos una fórmula y una cantidad', true);
    const miss = mats.filter(m => m.miss > 0.0004), cost = miss.reduce((a, m) => a + m.miss * costOf(pm, m.pid), 0);
    $('#plOut').innerHTML = `<div class="card"><h2 class="${miss.length ? 'warn' : 'pos'}">${miss.length ? `Te ${miss.length === 1 ? 'falta 1 material' : 'faltan ' + miss.length + ' materiales'}` : 'Tienes material para todo'}</h2>
      <p class="mut">Plan: ${fs.map(x => `${qty(x.n)} ${esc(pm[x.f.product_id]?.unit)} de ${esc(x.f.name)}`).join(', ')}</p>
      <div class="scroll"><table><thead><tr><th>Material</th><th class="n">Necesitas</th><th class="n">Tienes</th><th class="n">Falta</th></tr></thead><tbody>${mats.map(m => `<tr><td>${esc(pm[m.pid]?.name)}${m.uses.length > 1 ? `<small>Compartido por: ${m.uses.map(esc).join(', ')}</small>` : ''}</td>
        <td class="n">${qty(m.total)} ${esc(pm[m.pid]?.unit)}</td><td class="n">${qty(m.av)}</td><td class="n ${m.miss > 0.0004 ? 'warn' : 'in'}"><b>${m.miss > 0.0004 ? qty(m.miss) : 'Alcanza'}</b></td></tr>`).join('')}</tbody></table></div>
      ${Object.keys(held).length ? '<p class="mut">Ya se descontó el material comprometido en órdenes en proceso.</p>' : ''}
      ${miss.length ? `<p>Costo estimado de lo que falta: <b>${fmt(cost)} USD</b>${S.rate ? ' (' + fmt(cost * S.rate) + ' Bs)' : ''}</p>` : ''}
      <div class="row">${miss.length ? '<button class="btn" id="plBuy">Pasar lo que falta a una compra</button>' : ''}<button class="btn ${miss.length ? 'ghost' : ''}" id="plOrd">Crear las órdenes en proceso</button></div></div>`;
    if (miss.length) $('#plBuy').onclick = () => { CV.pre = miss.map(m => ({pid: m.pid, qty: Math.ceil(m.miss * 100) / 100})); SUB.com = 'nueva'; go('compras'); };
    $('#plOrd').onclick = () => run(async () => {
      if (!confirm(`Se crearán ${fs.length} ${fs.length === 1 ? 'orden' : 'órdenes'} en proceso. ¿Continuar?`)) return;
      for (const x of fs) await q(db.rpc('crear_orden_produccion', {p_recipe_id: x.f.id, p_qty: x.n, p_notes: 'Creada desde la planificación', p_finish: false,
        p_items: x.f.recipe_items.map(i => ({product_id: i.product_id, planned: i.quantity * x.k, actual: i.quantity * x.k}))}));
      PL.rows = [{rid: '', qty: ''}]; SUB.prod = 'historial'; toast('Órdenes creadas en proceso'); render();
    });
  };
}
