// Gestión: ajuste masivo de inventario valorado + historial propio, reposición sugerida y respaldo
const AJ = {
  sub: 'nuevo',    // 'nuevo' | 'historial'
  mode: 'conteo',
  vals: {},
  costs: {},
  cat: 'all',
  q: '',
  onlyMod: false,
  fin: 'none',
  reason: '',
  note: '',
  acc: '',
  etype: '',
  hMode: 'all',
  hQ: ''
};

// ---------- Ajuste masivo de inventario: panel práctico + historial propio ----------
const AJMODE = {
  conteo: ['Conteo real', 'Real', 'Escribe la cantidad real que contaste. Las diferencias salen o entran al costo actual del producto.'],
  ingreso: ['Ingreso', 'Entra', 'Escribe cuánto entra de cada producto y coloca su costo unitario en USD (se recalculará el costo promedio).'],
  salida: ['Salida', 'Sale', 'Escribe cuánto sale de cada producto. La salida se registra automáticamente con el costo actual que tiene cada producto.']
};
const AJREASON = {
  conteo: ['Conteo físico', 'Carga inicial', 'Auditoría de bodega'],
  ingreso: ['Ingreso de mercancía', 'Donación o muestra recibida', 'Corrección de error', 'Devolución interna'],
  salida: ['Merma o pérdida', 'Vencido o dañado', 'Uso interno', 'Muestra o regalo', 'Corrección de error']
};

async function viewAjusteMasivo() {
  const isHist = AJ.sub === 'historial';
  const [rawRows, types, accs, histBatches, legacyMoves, untrSet] = await Promise.all([
    q(db.from('stock_actual').select('product_id,sku,name,category_id,category,unit,stock,avg_cost_usd').order('name')),
    q(db.from('expense_types').select('id,name').eq('active', true).order('name')),
    loadActiveAccounts(),
    db.from('inventory_adjustments').select('*').order('id', {ascending: false}).limit(80).then(r => r.error ? [] : (r.data || [])),
    isHist
      ? q(db.from('inventory_movements').select('id,movement_type,quantity,unit_cost_usd,ref_type,ref_id,notes,created_at,products(name,unit)').in('movement_type', ['ajuste', 'merma']).order('id', {ascending: false}).limit(60))
      : Promise.resolve([]),
    typeof getUntrackedIds === 'function' ? getUntrackedIds() : Promise.resolve(new Set())
  ]);
  const rows = rawRows.filter(x => !untrSet.has(Number(x.product_id)));

  const tabBar = `<div class="row" style="margin:0 0 .8rem">
    <button type="button" class="btn ${!isHist ? '' : 'ghost'}" data-ajsub="nuevo">Nuevo ajuste</button>
    <button type="button" class="btn ${isHist ? '' : 'ghost'}" data-ajsub="historial">Historial de ajustes (${histBatches.length})</button>
  </div>`;

  if (isHist) {
    renderAjusteHistorial(tabBar, histBatches, legacyMoves, accs, types);
    return;
  }

  const cats = [...new Map(rows.filter(x => x.category_id).map(x => [String(x.category_id), x.category])).entries()], m = AJ.mode, rs = AJREASON[m];
  if (!rs.includes(AJ.reason)) AJ.reason = rs[0];
  const finOpts = m === 'ingreso'
    ? {none: 'No afecta las finanzas', pago: 'Sí: lo pagué desde una cuenta'}
    : {none: 'No afecta las finanzas', gasto: 'Sí: registrar como pérdida (gasto) por su costo'};
  if (!finOpts[AJ.fin]) AJ.fin = 'none';
  if (!AJ.etype) AJ.etype = String(types.find(t => t.name === 'Pérdida de inventario')?.id || '');
  if (!AJ.acc && accs[0]) AJ.acc = String(accs[0].id);

  const delta = (r) => {
    const v = AJ.vals[r.product_id];
    if (v === undefined || v === '') return 0;
    const n = num(v);
    return m === 'conteo' ? n - +r.stock : m === 'ingreso' ? n : -n;
  };
  const unitCostOf = (r) => {
    if (m !== 'ingreso') return +r.avg_cost_usd || 0;
    const c = AJ.costs[r.product_id];
    return c !== undefined && c !== '' ? Math.max(0, num(c)) : (+r.avg_cost_usd || 0);
  };
  const pend = () => rows.filter(r => Math.abs(delta(r)) > 0.0004);
  const visibleRows = () => {
    const t = AJ.q.toLowerCase();
    return rows.filter(r => {
      if (AJ.onlyMod && Math.abs(delta(r)) < 0.0004) return false;
      if (AJ.cat !== 'all' && String(r.category_id) !== AJ.cat) return false;
      return !t || (r.name + ' ' + (r.sku || '')).toLowerCase().includes(t);
    });
  };

  $('#view').innerHTML = `${tabBar}
    <div class="card stack">
      <div class="title-row">
        <h2>Ajuste masivo</h2>
        <div class="chips" id="ajM">${Object.entries(AJMODE).map(([k, v]) => `<button type="button" data-m="${k}" class="${k === m ? 'on' : ''}">${v[0]}</button>`).join('')}</div>
      </div>
      <p class="mut" style="margin:0">${AJMODE[m][2]}</p>
      <div class="grid">
        <label>Motivo<select id="ajR">${rs.map(x => `<option ${x === AJ.reason ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Nota / referencia<input id="ajN" value="${esc(AJ.note)}" placeholder="Ej: conteo de bodega, cierre semanal"></label>
      </div>
      <div class="grid">
        <label>¿Afecta financieramente?<select id="ajF">${Object.entries(finOpts).map(([k, v]) => `<option value="${k}" ${k === AJ.fin ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${AJ.fin === 'gasto' ? `<label>Tipo de gasto<select id="ajT">${types.map(t => `<option value="${t.id}" ${String(t.id) === AJ.etype ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : ''}
        ${AJ.fin === 'pago' ? `<label>Pagado desde<select id="ajA">${acctOpts(accs, AJ.acc)}</select></label>` : ''}
      </div>
      ${AJ.fin === 'pago' ? '<small id="ajAccBal" style="display:block;margin-top:-.45rem"></small>' : ''}
    </div>

    <div class="stats" id="ajStats"></div>

    <div class="card stack">
      <div class="scan-row">
        <input id="ajQ" type="search" placeholder="Buscar producto o escanear para sumar +1" value="${esc(AJ.q)}">
        <button type="button" class="icon-btn scan-btn" id="ajScan" title="Escanear código de barras (suma +1)" aria-label="Escanear código de barras">${SCAN_ICO}</button>
      </div>
      <div class="chips" id="ajC"><button type="button" data-c="all" class="${AJ.cat === 'all' ? 'on' : ''}">Todos</button>${cats.map(([id, n]) => `<button type="button" data-c="${id}" class="${AJ.cat === id ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>
      <div class="title-row" style="gap:.5rem">
        <label class="chk"><input type="checkbox" id="ajOnly" ${AJ.onlyMod ? 'checked' : ''}> <span id="ajOnlyLbl">Solo modificados</span></label>
        <div class="row0" style="gap:.4rem">
          ${m === 'conteo' ? '<button type="button" class="lnk" id="ajFillSys" style="font-size:.82rem">Copiar stock actual</button>' : ''}
          <button type="button" class="lnk bad" id="ajClear" style="font-size:.82rem">Limpiar cambios</button>
        </div>
      </div>
      <div class="list" id="ajL"></div>
    </div>

    <div class="card stack aj-footer">
      <div id="ajS"></div>
      <div class="row" style="margin:0">
        <button type="button" class="btn" id="ajGo">Aplicar</button>
        <button type="button" class="btn ghost" id="ajClear2">Limpiar</button>
      </div>
    </div>`;

  const upd = () => {
    document.querySelectorAll('#ajL .item').forEach(l => {
      const r = rows.find(x => String(x.product_id) === l.dataset.pid);
      if (!r) return;
      const d = delta(r), df = l.querySelector('.df');
      l.classList.toggle('aj-in', d > 0.0004);
      l.classList.toggle('aj-out', d < -0.0004);
      if (!df) return;
      if (Math.abs(d) < 0.0004) { df.textContent = ''; df.className = 'df'; return; }
      const uc = unitCostOf(r), valUsd = Math.abs(d) * uc;
      df.className = 'df ' + (d > 0 ? 'in' : 'outq');
      if (d > 0 && m === 'ingreso') {
        const st0 = Math.max(+r.stock, 0), c0 = +r.avg_cost_usd || 0;
        const newAvg = (st0 + d) > 0 ? ((st0 * c0) + (d * uc)) / (st0 + d) : uc;
        df.textContent = `+${qty(d)} a ${fmt(uc, 4)} USD = ${fmt(valUsd)} USD (nuevo prom: ${fmt(newAvg, 4)})`;
      } else {
        df.textContent = `${d > 0 ? '+' : '-'}${qty(Math.abs(d))} ${r.unit} · costo ${fmt(uc, 4)} USD · valor ${fmt(valUsd)} USD`;
      }
    });

    const P = pend(), ent = P.filter(r => delta(r) > 0), sal = P.filter(r => delta(r) < 0);
    const val = (a) => a.reduce((s, r) => s + Math.abs(delta(r)) * unitCostOf(r), 0);
    const inUsd = val(ent), outUsd = val(sal);

    $('#ajStats').innerHTML = `
      <div class="stat"><span>Modificados</span><b>${P.length}</b><span>de ${rows.length} productos</span></div>
      ${ent.length || m === 'ingreso' ? `<div class="stat"><span>Entradas</span><b class="pos">+${fmt(inUsd)} USD</b><span>${ent.length} prod.${S.rate ? ' · ' + fmt(inUsd * S.rate) + ' Bs' : ''}</span></div>` : ''}
      ${sal.length || m === 'salida' ? `<div class="stat bad"><span>Salidas</span><b>-${fmt(outUsd)} USD</b><span>${sal.length} prod.${S.rate ? ' · ' + fmt(outUsd * S.rate) + ' Bs' : ''}</span></div>` : ''}`;

    if ($('#ajOnlyLbl')) $('#ajOnlyLbl').textContent = `Solo modificados (${P.length})`;

    $('#ajS').innerHTML = P.length
      ? `${ent.length ? `Entran <b>${ent.length}</b> productos por <b class="pos">${fmt(inUsd)} USD</b>.<br>` : ''}${sal.length ? `Salen <b>${sal.length}</b> productos por <b class="neg">${fmt(outUsd)} USD</b> (al costo actual).${AJ.fin === 'gasto' ? ' <b>Se registrará como gasto.</b>' : ''}<br>` : ''}${AJ.fin === 'pago' && ent.length ? `Se descontarán <b>${fmt(inUsd)} USD</b> de la cuenta elegida.` : ''}`
      : '<span class="mut">Aún no hay cambios. Escribe cantidades o usa los botones - / + o el escáner.</span>';

    if ($('#ajAccBal') && AJ.fin === 'pago') {
      const a = accs.find(x => String(x.id) === AJ.acc);
      $('#ajAccBal').innerHTML = accBalanceLine(a, a?.currency === 'VES' ? inUsd * (S.rate || 0) : inUsd, true);
    }
    $('#ajGo').textContent = `Aplicar ajuste (${P.length})`;
  };

  const draw = () => {
    const list = visibleRows();
    $('#ajL').innerHTML = list.map(r => {
      const curCost = +r.avg_cost_usd || 0;
      const costVal = AJ.costs[r.product_id] !== undefined ? AJ.costs[r.product_id] : (curCost > 0 ? curCost : '');
      const valStr = AJ.vals[r.product_id] ?? '';
      const quickBtn = m === 'salida' && +r.stock > 0
        ? `<button type="button" class="aj-qbtn" data-all="${r.product_id}" title="Sacar todo el stock">Todo</button>`
        : m === 'conteo'
          ? `<button type="button" class="aj-qbtn" data-zero="${r.product_id}" title="Marcar en 0">0</button>`
          : '';
      return `<div class="item aj-row" data-pid="${r.product_id}">
        <span style="flex:1;min-width:140px">
          <b>${esc(r.name)}</b>
          <small>${r.sku ? esc(r.sku) + ' | ' : ''}Sistema: <b>${qty(r.stock)} ${esc(r.unit)}</b> | costo ${fmt(curCost, 4)} USD</small>
          <small class="df"></small>
        </span>
        <div class="aj-ctrls">
          ${m === 'ingreso' ? `<label style="width:6.2rem;margin:0">Costo USD<input data-cost="${r.product_id}" type="number" step="0.0001" min="0" value="${costVal}"></label>` : ''}
          <div class="aj-step-wrap">
            <label style="margin:0">${AJMODE[m][1]}
              <div class="aj-step">
                <button type="button" class="aj-sb" data-dec="${r.product_id}" aria-label="Restar 1">&minus;</button>
                <input data-c="${r.product_id}" type="number" step="0.001" min="0" value="${valStr}" placeholder="${m === 'conteo' ? qty(r.stock) : '0'}">
                <button type="button" class="aj-sb" data-inc="${r.product_id}" aria-label="Sumar 1">+</button>
              </div>
            </label>
            ${quickBtn}
          </div>
        </div>
      </div>`;
    }).join('') || `<p class="mut">${AJ.onlyMod ? 'Aún no has modificado ningún producto.' : 'No hay productos con ese filtro.'}</p>`;
    upd();
  };
  draw();

  document.querySelectorAll('[data-ajsub]').forEach(b => {
    b.onclick = () => { AJ.sub = b.dataset.ajsub; render(); };
  });
  $('#ajM').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { AJ.mode = b.dataset.m; AJ.vals = {}; AJ.costs = {}; AJ.fin = 'none'; AJ.onlyMod = false; render(); }
  };
  $('#ajR').onchange = (e) => { AJ.reason = e.target.value; };
  $('#ajN').oninput = (e) => { AJ.note = e.target.value; };
  $('#ajF').onchange = (e) => { AJ.fin = e.target.value; render(); };
  if ($('#ajT')) $('#ajT').onchange = (e) => { AJ.etype = e.target.value; };
  if ($('#ajA')) $('#ajA').onchange = (e) => { AJ.acc = e.target.value; upd(); };
  $('#ajOnly').onchange = (e) => { AJ.onlyMod = e.target.checked; draw(); };

  const clearAll = () => {
    if (!Object.keys(AJ.vals).length) return;
    if (!confirm('¿Borrar todas las cantidades escritas?')) return;
    AJ.vals = {}; AJ.costs = {}; AJ.onlyMod = false;
    $('#ajOnly').checked = false;
    draw();
  };
  $('#ajClear').onclick = clearAll;
  $('#ajClear2').onclick = clearAll;
  if ($('#ajFillSys')) {
    $('#ajFillSys').onclick = () => {
      visibleRows().forEach(r => { if (AJ.vals[r.product_id] === undefined || AJ.vals[r.product_id] === '') AJ.vals[r.product_id] = String(Math.max(0, +r.stock)); });
      draw();
      toast('Cantidades rellenadas con el stock del sistema');
    };
  }

  $('#ajL').addEventListener('input', (e) => {
    const id = e.target.dataset.c, cid = e.target.dataset.cost;
    if (id) { AJ.vals[id] = e.target.value; upd(); }
    if (cid) { AJ.costs[cid] = e.target.value; upd(); }
  });
  $('#ajL').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), all = e.target.closest('[data-all]'), zr = e.target.closest('[data-zero]');
    const pid = inc?.dataset.inc || dec?.dataset.dec || all?.dataset.all || zr?.dataset.zero;
    if (!pid) return;
    const r = rows.find(x => String(x.product_id) === String(pid));
    if (!r) return;
    const base = AJ.vals[pid] !== undefined && AJ.vals[pid] !== '' ? num(AJ.vals[pid]) : (m === 'conteo' ? Math.max(0, +r.stock) : 0);
    let next = base;
    if (inc) next = Math.round((base + 1) * 1000) / 1000;
    else if (dec) next = Math.max(0, Math.round((base - 1) * 1000) / 1000);
    else if (all) next = Math.max(0, +r.stock);
    else if (zr) next = 0;
    AJ.vals[pid] = String(next);
    const inp = document.querySelector(`#ajL input[data-c="${pid}"]`);
    if (inp) inp.value = String(next);
    upd();
  });

  $('#ajQ').oninput = (e) => { AJ.q = e.target.value; draw(); };
  const bumpAdjByCode = (code) => {
    const r = findBySku(rows, code);
    if (!r) return {ok: false, msg: 'Código no encontrado: ' + code};
    const curVal = AJ.vals[r.product_id] !== undefined && AJ.vals[r.product_id] !== '' ? num(AJ.vals[r.product_id]) : 0;
    const nextVal = Math.round((curVal + 1) * 1000) / 1000;
    AJ.vals[r.product_id] = String(nextVal);
    draw();
    return {ok: true, msg: `${r.name}: ${AJMODE[m][1]} = ${qty(nextVal)} ${r.unit}`};
  };
  $('#ajScan').onclick = () => openScanner({
    title: `Escanear (${AJMODE[m][0]} +1)`,
    continuous: true,
    allowContinuous: true,
    onCode: bumpAdjByCode
  });
  bindEnterSku($('#ajQ'), (code) => {
    const res = bumpAdjByCode(code);
    if (res.ok) { scanBeep(true); toast(res.msg); AJ.q = ''; $('#ajQ').value = ''; draw(); return true; }
    return false;
  });
  $('#ajC').onclick = (e) => { const b = e.target.closest('button'); if (b) { AJ.cat = b.dataset.c; document.querySelectorAll('#ajC button').forEach(x => x.classList.toggle('on', x === b)); draw(); } };

  $('#ajGo').onclick = () => run(async () => {
    const it = pend().map(r => ({
      product_id: r.product_id,
      qty: m === 'conteo' ? num(AJ.vals[r.product_id]) : Math.abs(delta(r)),
      unit_cost_usd: m === 'ingreso' ? unitCostOf(r) : (+r.avg_cost_usd || 0)
    }));
    if (!it.length) throw new Error('No hay cambios que aplicar');
    if (!confirm(`Se aplicarán cambios a ${it.length} productos${AJ.fin !== 'none' ? ' con efecto financiero' : ''}. ¿Continuar?`)) return;
    const res = await q(db.rpc('ajuste_masivo2', {
      p_items: it, p_mode: m,
      p_reason: AJ.reason === 'Merma o pérdida' || AJ.reason === 'Vencido o dañado' ? 'merma' : 'otro',
      p_note: AJ.reason + (AJ.note ? ': ' + AJ.note : ''),
      p_fin: AJ.fin,
      p_account_id: AJ.fin === 'pago' ? +AJ.acc : null,
      p_expense_type_id: AJ.fin === 'gasto' ? +AJ.etype || null : null
    }));
    AJ.vals = {}; AJ.costs = {}; AJ.note = ''; AJ.onlyMod = false;
    toast(`${res.n} productos ajustados${+res.perdida_usd && AJ.fin === 'gasto' ? ' | pérdida registrada: ' + fmt(res.perdida_usd) + ' USD' : ''}`);
    AJ.sub = 'historial';
    render();
  });
}

function renderAjusteHistorial(tabBar, batches, legacyMoves, accs, types) {
  const MLAB = {conteo: 'Conteo real', ingreso: 'Ingreso', salida: 'Salida'};
  const accName = (id) => accs.find(a => String(a.id) === String(id))?.name || '';
  const typeName = (id) => types.find(t => String(t.id) === String(id))?.name || '';

  const totIn = batches.reduce((s, b) => s + Number(b.in_usd || 0), 0);
  const totOut = batches.reduce((s, b) => s + Number(b.out_usd || 0), 0);

  $('#view').innerHTML = `${tabBar}
    <div class="stats">
      <div class="stat"><span>Ajustes registrados</span><b>${batches.length}</b></div>
      <div class="stat"><span>Total entradas</span><b class="pos">+${fmt(totIn)} USD</b></div>
      <div class="stat bad"><span>Total salidas</span><b>-${fmt(totOut)} USD</b></div>
    </div>
    <div class="card stack">
      <input id="ajHQ" type="search" placeholder="Buscar por motivo, nota, usuario o producto..." value="${esc(AJ.hQ)}">
      <div class="chips" id="ajHM">
        <button type="button" data-m="all" class="${AJ.hMode === 'all' ? 'on' : ''}">Todos</button>
        <button type="button" data-m="conteo" class="${AJ.hMode === 'conteo' ? 'on' : ''}">Conteo</button>
        <button type="button" data-m="ingreso" class="${AJ.hMode === 'ingreso' ? 'on' : ''}">Ingresos</button>
        <button type="button" data-m="salida" class="${AJ.hMode === 'salida' ? 'on' : ''}">Salidas</button>
      </div>
      <div class="list" id="ajHL"></div>
    </div>
    ${legacyMoves.length ? `<details class="card"><summary>Movimientos individuales de ajuste y merma (${legacyMoves.length} recientes)</summary>
      <div class="scroll"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="n">Cant.</th><th class="n">Costo USD</th><th>Nota</th></tr></thead><tbody>
        ${legacyMoves.map(m => `<tr><td>${fdate(m.created_at)}</td><td>${esc(m.products?.name)}</td><td>${MOV[m.movement_type] || m.movement_type}</td>
          <td class="n ${m.quantity > 0 ? 'in' : 'outq'}">${m.quantity > 0 ? '+' : ''}${qty(m.quantity)} ${esc(m.products?.unit || '')}</td>
          <td class="n">${m.unit_cost_usd != null ? fmt(m.unit_cost_usd, 4) : '-'}</td><td>${esc(m.notes)}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}`;

  const drawH = () => {
    const t = AJ.hQ.trim().toLowerCase();
    const list = batches.filter(b => {
      if (AJ.hMode !== 'all' && b.mode !== AJ.hMode) return false;
      if (!t) return true;
      const itemNames = Array.isArray(b.items) ? b.items.map(i => (i.name || '') + ' ' + (i.sku || '')).join(' ') : '';
      return ((b.note || '') + ' ' + (b.reason || '') + ' ' + (b.created_by || '') + ' ' + itemNames).toLowerCase().includes(t);
    });
    $('#ajHL').innerHTML = list.map(b => {
      const idLbl = Number(b.id) < 0 ? 'LOC-' + Math.abs(b.id) : '#' + b.id;
      const finTxt = b.fin_effect === 'gasto' ? ' · Gasto' : b.fin_effect === 'pago' ? ' · Pagado' : '';
      return `<button class="item" data-bid="${b.id}">
        <span style="flex:1">
          <b>${idLbl} · ${esc(MLAB[b.mode] || b.mode)} (${b.items_count} ${b.items_count === 1 ? 'producto' : 'productos'})</b>
          <small>${fdate(b.created_at)} · ${esc(b.created_by || 'Usuario')}${finTxt}</small>
          ${b.note ? `<small style="display:block">${esc(b.note)}</small>` : ''}
        </span>
        <span class="n">
          ${+b.in_usd > 0 ? `<b class="pos">+${fmt(b.in_usd)} USD</b>` : ''}
          ${+b.out_usd > 0 ? `<b class="neg">-${fmt(b.out_usd)} USD</b>` : ''}
          ${!(+b.in_usd > 0) && !(+b.out_usd > 0) ? '<small class="mut">0,00 USD</small>' : ''}
        </span>
      </button>`;
    }).join('') || '<p class="mut">Aún no hay ajustes masivos en el historial. Al aplicar un ajuste aparecerá aquí con todo su detalle.</p>';
  };
  drawH();

  document.querySelectorAll('[data-ajsub]').forEach(b => {
    b.onclick = () => { AJ.sub = b.dataset.ajsub; render(); };
  });
  $('#ajHQ').oninput = (e) => { AJ.hQ = e.target.value; drawH(); };
  $('#ajHM').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    AJ.hMode = b.dataset.m;
    document.querySelectorAll('#ajHM button').forEach(x => x.classList.toggle('on', x === b));
    drawH();
  };
  $('#ajHL').onclick = (e) => {
    const btn = e.target.closest('[data-bid]'); if (!btn) return;
    const b = batches.find(x => String(x.id) === btn.dataset.bid);
    if (!b) return;
    const items = Array.isArray(b.items) ? b.items : [];
    const idLbl = Number(b.id) < 0 ? 'LOC-' + Math.abs(b.id) : '#' + b.id;
    const finDesc = b.fin_effect === 'gasto'
      ? `Registrado como gasto (${typeName(b.expense_type_id) || 'Pérdida de inventario'})`
      : b.fin_effect === 'pago'
        ? `Pagado desde ${accName(b.account_id) || 'cuenta'}`
        : 'Sin efecto financiero';

    openSheet(`Ajuste ${idLbl} · ${MLAB[b.mode] || b.mode}`, `
      <p class="mut" style="margin:0 0 .6rem">${fdate(b.created_at)} · Responsable: <b>${esc(b.created_by || 'Usuario')}</b><br>${esc(finDesc)}${b.note ? '<br>Nota: ' + esc(b.note) : ''}</p>
      <div class="rl"><span>Productos ajustados</span><b>${b.items_count}</b></div>
      ${+b.in_usd > 0 ? `<div class="rl"><span>Valor entradas</span><b class="pos">+${fmt(b.in_usd)} USD</b></div>` : ''}
      ${+b.out_usd > 0 ? `<div class="rl"><span>Valor salidas</span><b class="neg">-${fmt(b.out_usd)} USD</b></div>` : ''}
      <div class="scroll" style="margin-top:.8rem"><table>
        <thead><tr><th>Producto</th><th class="n">Antes &rarr; Después</th><th class="n">Cambio</th><th class="n">Costo</th><th class="n">Total USD</th></tr></thead>
        <tbody>${items.map(i => `<tr>
          <td>${esc(i.name)}${i.sku ? `<small>${esc(i.sku)}</small>` : ''}</td>
          <td class="n">${qty(i.prev_stock)} &rarr; <b>${qty(i.new_stock)}</b> ${esc(i.unit || '')}</td>
          <td class="n ${+i.delta > 0 ? 'in' : 'outq'}">${+i.delta > 0 ? '+' : ''}${qty(i.delta)}</td>
          <td class="n">${fmt(i.unit_cost_usd, 4)}</td>
          <td class="n">${fmt(i.total_usd)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="row">
        <button type="button" class="btn ghost" id="ajCsv">Descargar CSV</button>
        <button type="button" class="btn" id="ajWa">Compartir resumen</button>
      </div>`);

    $('#ajCsv').onclick = () => {
      const esc2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const csv = ['Producto,SKU,Unidad,Stock Anterior,Stock Nuevo,Cambio,Costo USD,Total USD',
        ...items.map(i => [esc2(i.name), esc2(i.sku), esc2(i.unit), i.prev_stock, i.new_stock, i.delta, i.unit_cost_usd, i.total_usd].join(','))].join('\n');
      downloadBlob(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'}), `ajuste_${b.id}_${caracasDate()}.csv`);
    };
    $('#ajWa').onclick = () => {
      const lines = [
        `*AJUSTE DE INVENTARIO ${idLbl} (${MLAB[b.mode] || b.mode})*`,
        `Fecha: ${fdate(b.created_at)} · Por: ${b.created_by || 'Usuario'}`,
        b.note ? `Nota: ${b.note}` : '',
        '',
        ...items.slice(0, 25).map(i => `• ${i.name}: ${+i.delta > 0 ? '+' : ''}${qty(i.delta)} ${i.unit || ''} (${qty(i.prev_stock)} -> ${qty(i.new_stock)}) · ${fmt(i.total_usd)} USD`),
        items.length > 25 ? `... y ${items.length - 25} productos más.` : '',
        '',
        +b.in_usd > 0 ? `Entradas: +${fmt(b.in_usd)} USD` : '',
        +b.out_usd > 0 ? `Salidas: -${fmt(b.out_usd)} USD` : ''
      ].filter(Boolean);
      window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
    };
  };
}

// ---------- Reposición sugerida (productos en su mínimo) ----------
async function viewSugerida() {
  const [rawSug, untrSet] = await Promise.all([
    q(db.from('stock_actual').select('product_id,name,unit,stock,min_stock,avg_cost_usd').order('name')),
    typeof getUntrackedIds === 'function' ? getUntrackedIds() : Promise.resolve(new Set())
  ]);
  const rows = rawSug.filter(r => !untrSet.has(Number(r.product_id)) && +r.min_stock > 0 && +r.stock <= +r.min_stock);
  const sug = (r) => Math.max(Math.ceil(+r.min_stock * 2 - +r.stock), 1);
  $('#view').innerHTML = rows.length ? `<div class="card"><p class="mut">Productos en su mínimo o por debajo. Ajusta las cantidades y llévalos a una nueva compra.</p><div class="list">${rows.map(r => `<div class="item">
    <label class="chk" style="flex:1"><input type="checkbox" data-s="${r.product_id}" checked><span><b>${esc(r.name)}</b><small>Hay ${qty(r.stock)} ${esc(r.unit)} | mínimo ${qty(r.min_stock)} | costo ${fmt(r.avg_cost_usd)} USD</small></span></label>
    <label style="width:6.5rem;margin:0">Comprar<input data-q="${r.product_id}" type="number" step="0.001" min="0" value="${sug(r)}"></label></div>`).join('')}</div></div>
    <div class="row"><button class="btn" id="sgGo">Pasar a una nueva compra</button></div>` : '<p class="mut">Todo está por encima de su mínimo. Define el stock mínimo de tus productos para recibir sugerencias de compra.</p>';
  if (!rows.length) return;
  $('#sgGo').onclick = () => {
    const pre = rows.filter(r => document.querySelector(`[data-s="${r.product_id}"]`).checked).map(r => ({pid: r.product_id, qty: num(document.querySelector(`[data-q="${r.product_id}"]`).value) || 0})).filter(x => x.qty > 0);
    if (!pre.length) return toast('Selecciona al menos un producto', true);
    CV.pre = pre; SUB.com = 'nueva'; render();
  };
}

// ---------- Respaldo y Restauración local (preparado para Google Drive en Fase 2) ----------
async function descargarRespaldo() {
  toast('Preparando el respaldo completo...');
  const out = await LDB.exportFullJson();
  const bizSlug = String(LDB.mem.settings?.[0]?.business_name || 'negocio').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24);
  downloadBlob(new Blob([JSON.stringify(out)], {type: 'application/json'}), `respaldo_${bizSlug}_${caracasDate()}.json`);
  toast('Respaldo descargado');
  LDB.paintBar();
  if (tab === 'configuracion' && SUB.cfg === 'respaldo') render();
}

async function viewRespaldo() {
  const last = LDB.meta?.lastBackupAt || (typeof getLastBackupDate === 'function' ? getLastBackupDate() : null);
  const dirty = Number(LDB.meta?.dirtySinceBackup || 0);
  $('#view').innerHTML = `
    <div class="card stack">
      <h2>Respaldo de tu negocio</h2>
      <p class="mut" style="margin:0">Como tus datos viven en tu propio teléfono (100% privados y sin servidores externos), descarga un respaldo periódicamente o guárdalo en tu Google Drive / WhatsApp.</p>
      <div class="rl"><span>Último respaldo</span><b>${last ? fdate(last) : 'Aún sin respaldo'}</b></div>
      <div class="rl"><span>Cambios desde el último respaldo</span><b class="${dirty > 10 ? 'neg' : 'pos'}">${dirty}</b></div>
      <div class="row">
        <button class="btn" id="bkGo">Descargar respaldo (.json)</button>
        <button class="btn ghost" id="bkShare">Compartir archivo</button>
      </div>
    </div>

    <div class="card stack">
      <h2>Restaurar desde un respaldo</h2>
      <p class="mut" style="margin:0">Si cambiaste de teléfono o quieres recuperar una copia anterior, selecciona tu archivo <b>.json</b>. Esto reemplazará los datos actuales de este dispositivo.</p>
      <input type="file" id="bkFile" accept=".json,application/json" class="hidden">
      <div class="row"><button class="btn ghost" id="bkRest">Seleccionar archivo de respaldo</button></div>
    </div>

    <div class="card stack" style="border-left:4px solid var(--pri)">
      <h2>Sincronización automática con tu Google Drive</h2>
      <p class="mut" style="margin:0">Próxima fase: vincula tu cuenta de Google para que la app guarde automáticamente tu respaldo diario en tu propio Google Drive sin pagar servidores.</p>
    </div>`;

  $('#bkGo').onclick = () => run(descargarRespaldo);
  $('#bkShare').onclick = () => run(async () => {
    const out = await LDB.exportFullJson();
    const fname = `respaldo_${caracasDate()}.json`;
    const blob = new Blob([JSON.stringify(out)], {type: 'application/json'});
    const file = new File([blob], fname, {type: 'application/json'});
    if (navigator.canShare && navigator.canShare({files: [file]})) {
      try { await navigator.share({files: [file], title: 'Respaldo de mi negocio'}); render(); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    downloadBlob(blob, fname);
    toast('Archivo descargado. Puedes enviarlo a tu correo o subirlo a Drive.');
    render();
  });
  $('#bkRest').onclick = () => $('#bkFile').click();
  $('#bkFile').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    run(async () => {
      if (!confirm('Esto reemplazará TODOS los datos actuales de este dispositivo por los del archivo seleccionado. ¿Continuar?')) { e.target.value = ''; return; }
      const data = JSON.parse(await f.text());
      await LDB.importFullJson(data);
      toast('Respaldo restaurado correctamente');
      setTimeout(() => location.reload(), 900);
    });
  };
}

// ---------- Comenzar desde 0 (100% local con confirmaciones de seguridad) ----------
async function viewReinicio() {
  const DESC = {
    movimientos: '<b>Borra:</b> ventas, cotizaciones, devoluciones, compras, producciones, gastos, nómina, adelantos y movimientos de inventario/cuentas. Los saldos quedan en 0.<br><b>Conserva:</b> productos, fórmulas, clientes, proveedores, empleados, cuentas y configuración.',
    todo: '<b>Borra todo lo anterior y además:</b> productos, fórmulas, clientes, proveedores, empleados y plantillas de catálogo. Al finalizar volverás al asistente de bienvenida.'
  };
  $('#view').innerHTML = `<div class="card stack" id="rsBox"><h2 class="warn">Comenzar desde 0</h2><p>Esta opción borra datos locales para empezar de nuevo. <b>No se puede deshacer.</b></p>
    <label>¿Qué quieres borrar?<select id="rsN"><option value="movimientos">Solo los movimientos</option><option value="todo">Todo (volver al asistente inicial)</option></select></label><p class="mut" id="rsD">${DESC.movimientos}</p>
    <button class="btn ghost" id="rsBk" type="button">Descargar un respaldo primero</button>
    <label class="chk"><input type="checkbox" id="rsC1"> Entiendo que se borrará de forma permanente</label>
    <label class="chk"><input type="checkbox" id="rsC2"> Ya descargué un respaldo</label>
    <label>Escribe BORRAR TODO para confirmar<input id="rsT" autocomplete="off"></label>
    <button class="btn" id="rsGo" style="background:var(--bad);color:#fff" disabled>Borrar y comenzar desde 0</button></div>`;
  const chk = () => { $('#rsGo').disabled = !($('#rsC1').checked && $('#rsC2').checked && $('#rsT').value.trim() === 'BORRAR TODO'); };
  $('#rsBox').addEventListener('input', chk); $('#rsBox').addEventListener('change', chk);
  $('#rsN').onchange = (e) => { $('#rsD').innerHTML = DESC[e.target.value]; };
  $('#rsBk').onclick = () => run(descargarRespaldo);
  $('#rsGo').onclick = () => run(async () => {
    if (!confirm('ÚLTIMA ADVERTENCIA: se borrarán los datos seleccionados de forma permanente. ¿Continuar?')) return;
    await q(db.rpc('reiniciar_sistema', {p_nivel: $('#rsN').value, p_frase: $('#rsT').value.trim()}));
    toast('Listo: el sistema quedó en cero');
    setTimeout(() => location.reload(), 900);
  });
}

// ---------- Deuda general de cada cliente (por cobrar) ----------
async function viewDeudas() {
  const rows = await q(db.from('deudas_clientes').select('*').order('debt_usd', {ascending: false})), tot = rows.reduce((a, r) => a + +r.debt_usd, 0);
  $('#view').innerHTML = `<div class="stat warn" style="margin-bottom:1rem"><span>Total por cobrar</span><b>${fmt(tot)} USD</b><span>${S.rate ? fmt(tot * S.rate) + ' Bs a la tasa de hoy | ' : ''}${rows.length} ${rows.length === 1 ? 'cliente' : 'clientes'}</span></div>
    <div class="list" id="dcL">${rows.map((r, i) => `<button class="item" data-i="${i}"><span><b>${esc(r.customer)}</b><small>${r.num_ventas} ${r.num_ventas === 1 ? 'venta pendiente' : 'ventas pendientes'} | desde hace ${diasDesde(r.desde)} días</small></span>
      <span class="n"><b>${fmt(r.debt_usd)} USD</b><small>${S.rate ? fmt(r.debt_usd * S.rate) + ' Bs hoy' : ''}</small></span></button>`).join('') || '<p class="mut">Nadie te debe nada.</p>'}</div>`;
  $('#dcL').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) run(() => debtSheet(rows[+b.dataset.i])); };
}
async function debtSheet(c) {
  let qb = db.from('ventas_resumen').select('id,sale_date,total_usd,paid_usd,due_date').eq('status', 'pendiente').order('sale_date').order('id');
  qb = c.customer_id === null ? qb.is('customer_id', null) : qb.eq('customer_id', c.customer_id);
  const [sales, accs, payTxt] = await Promise.all([q(qb), loadActiveAccounts(), getPaymentDetailsText()]);
  const hoy = caracasDate(), bal = (s) => s.total_usd - s.paid_usd, total = sales.reduce((a, s) => a + bal(s), 0);
  openSheet(esc(c.customer), `<form id="dcF" class="stack"><p><b>Deuda total: ${fmt(total)} USD</b>${S.rate ? ' (' + fmt(total * S.rate) + ' Bs a la tasa de hoy)' : ''}</p>
    <p class="mut">Marca las ventas que quieres pagar. Si el monto no alcanza para todas, se pagan completas las más antiguas y la siguiente queda con un abono y lo que falta abierto.</p>
    <div class="list" id="dcS">${sales.map(s => `<div class="item"><label class="chk" style="flex:1"><input type="checkbox" data-s="${s.id}" checked><span><b>Venta #${s.id}</b>
      <small>${s.sale_date}${s.due_date && s.due_date < hoy ? ' | vencida' : ''} | debe ${fmt(bal(s))} USD</small><small class="al" style="display:block"></small></span></label></div>`).join('')}</div>
    <label>Cuenta<select name="acc">${acctOpts(accs)}</select></label>
    <small id="dcAccBal" style="display:block;margin-top:-.45rem"></small>
    <label>Tasa de cambio (Bs por USD)<input name="rate" type="number" step="0.0001" min="0.0001" value="${S.rate || ''}"></label>
    <label>Método<select name="method"></select></label>
    <label>Monto a cobrar<input name="amount" type="number" step="0.01" min="0.01" required></label><p class="mut" id="dcSum"></p>
    <label>Referencia<input name="ref"></label>
    <div class="row"><button class="btn" type="submit" id="dcGo">Registrar cobro</button>${c.phone ? '<button class="btn ghost" type="button" id="dcWa">Recordar por WhatsApp</button>' : ''}</div></form>`);
  const el = $('#dcF').elements, cur = () => accs.find(a => String(a.id) === el.acc.value).currency, factor = () => cur() === 'USD' ? 1 : (+el.rate.value || 0);
  const chosen = (s) => document.querySelector(`[data-s="${s.id}"]`).checked, selDebt = () => sales.filter(chosen).reduce((a, s) => a + bal(s), 0);
  const alloc = () => { let rem = (num(el.amount.value) || 0) / (factor() || 1); return sales.map(s => { if (!chosen(s)) return {s, a: 0, st: ''}; const a = Math.min(bal(s), Math.max(rem, 0)); rem -= a; return {s, a, st: a >= bal(s) - 0.01 ? 'full' : a > 0.004 ? 'part' : 'none'}; }); };
  const paint = () => {
    const al = alloc(), usd = al.reduce((x, y) => x + y.a, 0), sel = selDebt(), over = (num(el.amount.value) || 0) / (factor() || 1) - sel;
    al.forEach(x => { const l = document.querySelector(`[data-s="${x.s.id}"]`).closest('.item').querySelector('.al'); l.className = 'al ' + (x.st === 'full' ? 'in' : x.st === 'part' ? 'warn' : 'mut'); l.style.display = 'block';
      l.textContent = x.st === 'full' ? 'Se paga completa' : x.st === 'part' ? `Abono de ${fmt(x.a)} USD: queda abierta debiendo ${fmt(bal(x.s) - x.a)} USD` : x.st === 'none' ? 'No alcanza: queda pendiente' : ''; });
    $('#dcSum').textContent = over > 0.02 ? `El monto supera la deuda de las ventas elegidas por ${fmt(over)} USD.` : `Cobrarás ${fmt(usd)} USD. Quedan pendientes ${fmt(Math.max(sel - usd, 0))} USD de las ventas elegidas.`;
    if ($('#dcAccBal')) $('#dcAccBal').innerHTML = accBalanceLine(accs.find(a => String(a.id) === el.acc.value), 0, false);
  };
  const fillM = () => { el.method.innerHTML = optList(accMethods(accs.find(a => String(a.id) === el.acc.value))); };
  let pf = factor();
  const fill = () => { pf = factor(); el.amount.value = (selDebt() * pf).toFixed(2); paint(); };
  const conv = () => { const nf = factor(), usd = pf ? (num(el.amount.value) || 0) / pf : selDebt(); pf = nf; el.amount.value = (usd * nf).toFixed(2); paint(); };
  fillM(); fill();
  $('#dcS').addEventListener('change', fill); el.acc.onchange = () => { fillM(); conv(); }; el.rate.oninput = conv; el.amount.oninput = paint;
  $('#dcF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const ids = sales.filter(chosen).map(s => s.id); if (!ids.length) throw new Error('Marca al menos una venta');
      const res = await q(db.rpc('cobrar_ventas', {p_sale_ids: ids, p_account_id: +el.acc.value, p_method: el.method.value, p_amount: num(el.amount.value), p_reference: el.ref.value.trim() || null, p_rate: +el.rate.value || null}));
      closeSheet(); toast(`Cobro registrado: ${res.pagadas} ${res.pagadas === 1 ? 'venta pagada completa' : 'ventas pagadas completas'}${res.abonadas ? ' y 1 con abono (queda abierta)' : ''}. Pendiente: ${fmt(res.pendiente_usd)} USD`); render();
    });
  };
  if (c.phone) $('#dcWa').onclick = () => window.open(waLink(c, `Hola ${(c.customer || '').split(' ')[0]}, te recordamos que tienes un saldo pendiente de ${fmt(total)} USD${S.rate ? ' (' + fmt(total * S.rate) + ' Bs a la tasa de hoy)' : ''}.${payTxt ? '\n\n' + payTxt : ''}\n\nGracias por tu atención.`), '_blank');
}

// ---------- Módulos opcionales (se activan en Configuración > Negocio) ----------
async function loadFlags() {
  try { const s = await q(db.from('settings').select('enable_planning,enable_payroll').eq('id', 1).single()); S.flags = {planning: s.enable_planning !== false, payroll: s.enable_payroll !== false}; }
  catch (e) { S.flags = {planning: true, payroll: true}; }
}
