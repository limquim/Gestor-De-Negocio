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
  const cats = [...new Map(rows.filter(x => x.category_id).map(x => [x.category_id, x.category])).entries()];
  const chips = cats.map(([k, v]) => `<button data-t="${k}">${esc(v)}</button>`).join('');
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
  const [prods, cats, units, taxes, set] = await Promise.all([
    q(db.from('products').select('*, product_categories(name), taxes(name)').eq('active', true).order('name')),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name')),
    q(db.from('units').select('symbol,name').eq('active', true).order('name')),
    q(db.from('taxes').select('id,name,percent,is_default').eq('active', true).order('name')),
    q(db.from('settings').select('enable_product_photos').eq('id', 1).single())
  ]);
  const D = {cats, units, taxes, photos: !!set.enable_product_photos};
  $('#view').innerHTML = `<input id="prQ" type="search" placeholder="Buscar producto o código" value="${esc(PR2.q)}" style="margin-bottom:.8rem">
    <div class="list" id="prList"></div><button class="fab" id="prAdd" aria-label="Nuevo producto">+</button>`;
  const draw = () => {
    const t = PR2.q.toLowerCase();
    $('#prList').innerHTML = prods.filter(p => !t || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).map(p => `<button class="item" data-id="${p.id}">
      <span class="row0">${D.photos && p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : ''}<span><b>${esc(p.name)}</b>
      <small>${p.is_service ? 'SERVICIO | ' : ''}${esc(p.sku || 'Sin código')} | ${esc(p.product_categories?.name || 'Sin categoría')} | ${esc(p.unit)}</small>
      <small>Precio: ${fmt(p.sale_price_usd)} USD${S.rate ? ' (' + fmt(p.sale_price_usd * S.rate) + ' Bs)' : ''} | ${esc(p.taxes?.name || 'Sin impuesto')}</small></span></span>
      <span class="mut">&rsaquo;</span></button>`).join('') || '<p class="mut">No hay productos. Pulsa + para crear el primero.</p>';
  };
  draw();
  $('#prQ').oninput = (e) => { PR2.q = e.target.value; draw(); };
  $('#prAdd').onclick = () => prodForm(null, D);
  $('#prList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) prodForm(prods.find(p => String(p.id) === b.dataset.id), D); };
}

function prodForm(p, D) {
  const {cats, units, taxes, photos} = D, defTax = taxes.find(t => t.is_default)?.id;
  const v = (k, d = '') => p ? (p[k] ?? d) : d;
  const opt = (arr, val, key, label) => arr.map(o => `<option value="${o[key]}" ${String(o[key]) === String(val) ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
  openSheet(p ? 'Editar producto' : 'Nuevo producto', `<form id="pf" class="stack">
    <label>Código<input name="sku" value="${esc(v('sku'))}"></label>
    <label>Nombre<input name="pname" value="${esc(v('name'))}" required></label>
    <label>Categoría<select name="category_id">${opt(cats, v('category_id'), 'id', c => c.name)}</select></label>
    <label>Unidad de medida<select name="unit">${opt(units, v('unit', 'und'), 'symbol', u => `${u.name} (${u.symbol})`)}</select></label>
    <label>Costo manual en USD (el que tú pones, no cambia solo)<input name="cost" type="number" step="0.0001" min="0" value="${v('manual_cost_usd', 0)}"></label>
    <label>Precio de venta en USD<input name="price" type="number" step="0.0001" min="0" value="${v('sale_price_usd', 0)}"></label>
    <label>Costo automático (el real, el que usa el sistema)<input value="${p && p.auto_cost_usd != null ? fmt(p.auto_cost_usd, 4) + ' USD' : 'Aún sin compras ni fabricaciones: se usa el costo manual'}" disabled></label>
    <p class="mut">El costo automático se actualiza solo con cada compra o fabricación, según el método elegido en Configuración. Tu costo manual no cambia: solo se usa mientras no haya compras ni fabricaciones.</p>
    <label class="chk"><input type="checkbox" name="is_service" ${p?.is_service ? 'checked' : ''}> Es un servicio (no maneja inventario, ej: delivery). Tu costo es lo que pagas por él.</label>
    <label>Stock mínimo<input name="min" type="number" step="0.001" min="0" value="${v('min_stock', 0)}"></label>
    <label>Impuesto<select name="tax_id">${opt(taxes, v('tax_id', defTax), 'id', t => `${t.name} (${qty(t.percent)}%)`)}</select></label>
    ${photos ? `<label>Foto<input name="photo" type="file" accept="image/*"></label>${p?.image_url ? `<img class="thumb big" src="${esc(p.image_url)}" alt=""><label class="chk"><input type="checkbox" name="rmphoto"> Quitar la foto actual</label>` : ''}` : ''}
    <p id="pMargin" class="mut"></p>
    <div class="row"><button class="btn" type="submit">Guardar producto</button>${p ? '<button type="button" class="btn ghost" id="pfDel">Desactivar</button>' : ''}</div></form>`);
  const f = $('#pf'), el = f.elements;
  const mg = () => { const c = p && p.auto_cost_usd != null ? +p.auto_cost_usd : (+el.cost.value || 0), pr = +el.price.value || 0; $('#pMargin').textContent = pr > 0 ? `Margen sobre el costo: ${fmt((pr - c) / pr * 100, 0)}% (ganancia de ${fmt(pr - c)} USD por unidad)` : ''; };
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
          if (up.error) throw up.error;
          image_url = db.storage.from('product-images').getPublicUrl(path).data.publicUrl;
        }
      }
      const row = {sku: el.sku.value.trim() || null, name: el.pname.value.trim(), category_id: +el.category_id.value || null, unit: el.unit.value,
        manual_cost_usd: +el.cost.value || 0, sale_price_usd: +el.price.value || 0, min_stock: +el.min.value || 0, is_service: el.is_service.checked, tax_id: +el.tax_id.value || null, image_url};
      await q(p ? db.from('products').update(row).eq('id', p.id) : db.from('products').insert(row));
      closeSheet(); toast('Producto guardado'); render();
    });
  };
  if (p) $('#pfDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar este producto?')) return;
    await q(db.from('products').update({active: false}).eq('id', p.id)); closeSheet(); toast('Producto desactivado'); render();
  });
}
