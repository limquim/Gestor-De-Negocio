// Inventario v2: resumen, filtros, kardex por producto y conteo físico
const INV = {rows: [], q: '', type: 'all', low: false};
const REF = {purchase: 'Compra', sale: 'Venta', production: 'Producción'};
const refLabel = (m) => m.ref_type ? `${REF[m.ref_type] || m.ref_type} #${m.ref_id}` : '-';
const fdate = (d) => new Date(d).toLocaleString('es-VE', {dateStyle: 'short', timeStyle: 'short'});

async function viewInventario2() {
  const [rows, moves] = await Promise.all([
    q(db.from('stock_actual').select('*').order('name')),
    q(db.from('inventory_movements').select('movement_type,quantity,ref_type,ref_id,notes,created_at,products(name)').order('created_at', {ascending: false}).limit(10))
  ]);
  INV.rows = rows;
  const valor = rows.reduce((a, x) => a + Number(x.valor_usd || 0), 0);
  const agotados = rows.filter(x => Number(x.stock) <= 0).length;
  const bajos = rows.filter(x => Number(x.stock) > 0 && x.bajo_minimo).length;
  const chips = Object.entries(TIPOS).map(([k, v]) => `<button data-t="${k}">${v}</button>`).join('');
  const opts = rows.map(s => `<option value="${s.product_id}">${esc(s.name)} (${esc(s.unit)})</option>`).join('');
  const mrows = moves.map(m => `<tr><td>${fdate(m.created_at)}</td><td>${esc(m.products?.name)}</td><td>${MOV[m.movement_type]}</td>
    <td>${refLabel(m)}</td><td class="n ${m.quantity > 0 ? 'in' : 'outq'}">${m.quantity > 0 ? '+' : ''}${qty(m.quantity)}</td><td>${esc(m.notes)}</td></tr>`).join('');

  $('#view').innerHTML = `
  <div class="stats">
    <div class="stat"><span>Valor del inventario</span><b>${fmt(valor)} USD</b><span>${S.rate ? fmt(valor * S.rate) + ' Bs' : 'Sin tasa cargada'}</span></div>
    <div class="stat"><span>Productos activos</span><b>${rows.length}</b></div>
    <div class="stat warn"><span>Bajo el mínimo</span><b>${bajos}</b></div>
    <div class="stat bad"><span>Agotados</span><b>${agotados}</b></div>
  </div>
  <div class="card">
    <div class="toolbar">
      <input id="invQ" type="search" placeholder="Buscar por nombre o código">
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
        <option value="in">Entrada o carga inicial</option><option value="out">Salida o corrección</option>
        <option value="merma">Merma o pérdida</option><option value="count">Conteo físico (cantidad real)</option></select></label>
      <label>Cantidad<input name="qty" type="number" step="0.001" min="0" required></label>
      <label>Nota<input name="notes" placeholder="Ej: derrame en bodega"></label></div>
      <p class="mut">En conteo físico escribe lo que realmente hay: el sistema calcula la diferencia y la ajusta.</p>
      <div class="row"><button class="btn" type="submit">Registrar</button></div></form>` : '<p class="mut">Primero crea productos en la pestaña Productos.</p>'}
  </details>
  <div class="card"><h2>Últimos movimientos</h2>
    ${moves.length ? `<div class="scroll"><table><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th>Origen</th><th class="n">Cantidad</th><th>Nota</th></tr></thead><tbody>${mrows}</tbody></table></div>` : '<p class="mut">Aún no hay movimientos.</p>'}</div>`;

  drawInvTable();
  $('#invQ').oninput = (e) => { INV.q = e.target.value; drawInvTable(); };
  $('#invLow').onchange = (e) => { INV.low = e.target.checked; drawInvTable(); };
  $('#invT').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    INV.type = b.dataset.t;
    document.querySelectorAll('#invT button').forEach(x => x.classList.toggle('on', x === b));
    drawInvTable();
  };
  $('#invTable').onclick = (e) => {
    const b = e.target.closest('[data-kx],[data-adj]'); if (!b) return;
    if (b.dataset.kx) run(() => showKardex(b.dataset.kx));
    if (b.dataset.adj && $('#mForm')) {
      $('#movBox').open = true; $('#mForm').elements.product_id.value = b.dataset.adj;
      $('#movBox').scrollIntoView({behavior: 'smooth'});
    }
  };
  const form = $('#mForm');
  if (form) form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form), kind = f.get('kind'), n = +f.get('qty'), pid = +f.get('product_id');
    const p = INV.rows.find(x => x.product_id === pid);
    run(async () => {
      if (kind !== 'count' && !(n > 0)) throw new Error('La cantidad debe ser mayor que cero');
      const delta = Math.round((kind === 'in' ? n : kind === 'count' ? n - Number(p.stock) : -n) * 1000) / 1000;
      if (!delta) throw new Error('El conteo coincide con el sistema: no hay nada que ajustar');
      await q(db.from('inventory_movements').insert({
        product_id: pid, movement_type: kind === 'merma' ? 'merma' : 'ajuste', quantity: delta,
        unit_cost_usd: Number(p.avg_cost_usd) || null, notes: f.get('notes').trim() || (kind === 'count' ? 'Conteo físico' : null)
      }));
      toast(kind === 'count' ? 'Conteo aplicado: ajuste de ' + qty(delta) : 'Movimiento registrado'); render();
    });
  };
}

function drawInvTable() {
  const t = INV.q.toLowerCase();
  const rows = INV.rows.filter(x => (INV.type === 'all' || x.type === INV.type) && (!INV.low || x.bajo_minimo)
    && (!t || (x.name + ' ' + (x.sku || '')).toLowerCase().includes(t)));
  const body = rows.map(x => {
    const st = Number(x.stock), mn = Number(x.min_stock);
    const state = st <= 0 ? 'out' : x.bajo_minimo ? 'low' : 'ok';
    const pct = st <= 0 ? 0 : mn > 0 ? Math.min(100, st / (mn * 2) * 100) : 100;
    const lbl = {out: 'Agotado', low: 'Bajo mínimo', ok: 'Disponible'}[state];
    return `<tr><td>${esc(x.name)}<small>${esc(x.sku)}</small></td><td>${TIPOS[x.type]}</td>
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
