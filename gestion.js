// Gestión: ajuste masivo de inventario, reposición sugerida y respaldo de datos
const AJ = {vals: {}, cat: 'all', q: ''};

// ---------- Ajuste masivo de inventario (conteo físico de varios productos a la vez) ----------
async function viewAjusteMasivo() {
  const rows = await q(db.from('stock_actual').select('product_id,sku,name,category_id,category,unit,stock').order('name'));
  const cats = [...new Map(rows.filter(x => x.category_id).map(x => [String(x.category_id), x.category])).entries()];
  const pend = () => rows.filter(r => AJ.vals[r.product_id] !== undefined && AJ.vals[r.product_id] !== '' && Math.abs(num(AJ.vals[r.product_id]) - +r.stock) > 0.0004);
  $('#view').innerHTML = `<div class="card stack"><h2>Ajuste masivo de inventario</h2><p class="mut">Escribe la cantidad real que contaste. Los productos que dejes vacíos no cambian.</p>
    <div class="grid"><label>Motivo<select id="ajR"><option value="conteo">Conteo físico</option><option value="carga">Carga inicial</option><option value="merma">Merma o pérdida</option></select></label>
      <label>Nota<input id="ajN" placeholder="Ej: inventario de octubre"></label></div>
    <input id="ajQ" type="search" placeholder="Buscar producto o código" value="${esc(AJ.q)}">
    <div class="chips" id="ajC"><button data-c="all" class="${AJ.cat === 'all' ? 'on' : ''}">Todos</button>${cats.map(([id, n]) => `<button data-c="${id}" class="${AJ.cat === id ? 'on' : ''}">${esc(n)}</button>`).join('')}</div></div>
    <div class="card"><div class="list" id="ajL"></div></div>
    <div class="row"><button class="btn" id="ajGo">Aplicar ajustes</button></div>`;
  const upd = () => {
    document.querySelectorAll('#ajL .item').forEach(l => {
      const r = rows.find(x => String(x.product_id) === l.dataset.pid), v = AJ.vals[r.product_id], d = v === undefined || v === '' ? null : num(v) - +r.stock;
      l.querySelector('.df').textContent = d === null || Math.abs(d) < 0.0004 ? '' : `Diferencia: ${d > 0 ? '+' : ''}${qty(d)}`;
    });
    $('#ajGo').textContent = `Aplicar ajustes (${pend().length})`;
  };
  const draw = () => {
    const t = AJ.q.toLowerCase();
    $('#ajL').innerHTML = rows.filter(r => (AJ.cat === 'all' || String(r.category_id) === AJ.cat) && (!t || (r.name + ' ' + (r.sku || '')).toLowerCase().includes(t)))
      .map(r => `<div class="item" data-pid="${r.product_id}"><span style="flex:1"><b>${esc(r.name)}</b><small>Sistema: ${qty(r.stock)} ${esc(r.unit)}</small><small class="df"></small></span>
        <label style="width:7.5rem;margin:0">Real<input data-c="${r.product_id}" type="number" step="0.001" min="0" value="${AJ.vals[r.product_id] ?? ''}"></label></div>`).join('') || '<p class="mut">No hay productos con ese filtro.</p>';
    upd();
  };
  draw();
  $('#ajL').addEventListener('input', (e) => { const id = e.target.dataset.c; if (id) { AJ.vals[id] = e.target.value; upd(); } });
  $('#ajQ').oninput = (e) => { AJ.q = e.target.value; draw(); };
  $('#ajC').onclick = (e) => { const b = e.target.closest('button'); if (b) { AJ.cat = b.dataset.c; document.querySelectorAll('#ajC button').forEach(x => x.classList.toggle('on', x === b)); draw(); } };
  $('#ajGo').onclick = () => run(async () => {
    const it = pend().map(r => ({product_id: r.product_id, counted: num(AJ.vals[r.product_id])}));
    if (!it.length) throw new Error('No hay diferencias que ajustar');
    if (!confirm(`Se ajustarán ${it.length} productos. ¿Continuar?`)) return;
    const n = await q(db.rpc('ajuste_masivo', {p_items: it, p_reason: $('#ajR').value, p_note: $('#ajN').value.trim() || null}));
    AJ.vals = {}; toast(n + ' productos ajustados'); render();
  });
}

// ---------- Reposición sugerida (productos en su mínimo) ----------
async function viewSugerida() {
  const rows = (await q(db.from('stock_actual').select('product_id,name,unit,stock,min_stock,avg_cost_usd').order('name'))).filter(r => +r.min_stock > 0 && +r.stock <= +r.min_stock);
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

// ---------- Respaldo de datos ----------
async function viewRespaldo() {
  $('#view').innerHTML = `<div class="card stack"><h2>Respaldo de tus datos</h2><p class="mut">Descarga una copia de toda tu información (productos, ventas, compras, cuentas, clientes, producción, etc.) en un archivo. Guárdala en un lugar seguro, por ejemplo una vez por semana.</p>
    <button class="btn" id="bkGo">Descargar respaldo</button></div>`;
  $('#bkGo').onclick = () => run(async () => {
    const T = ['settings', 'products', 'product_categories', 'units', 'taxes', 'parties', 'accounts', 'account_movements', 'payments', 'sales', 'sale_items', 'sale_returns', 'sale_return_items', 'purchases', 'purchase_items',
      'inventory_movements', 'recipes', 'recipe_items', 'production_orders', 'production_items', 'expenses', 'expense_types', 'quotes', 'quote_items', 'price_lists', 'payment_methods', 'message_templates', 'exchange_rates'];
    const all = async (t) => { let r = [], f = 0; for (;;) { const d = await q(db.from(t).select('*').range(f, f + 999)); r = r.concat(d); if (d.length < 1000) return r; f += 1000; } };
    const out = {fecha: new Date().toISOString(), tablas: {}};
    toast('Preparando el respaldo...');
    for (const t of T) { try { out.tablas[t] = await all(t); } catch (e) { out.tablas[t] = 'no disponible'; } }
    downloadBlob(new Blob([JSON.stringify(out)], {type: 'application/json'}), 'respaldo_' + caracasDate() + '.json'); toast('Respaldo descargado');
  });
}
