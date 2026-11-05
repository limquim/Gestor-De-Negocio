// Módulo de Compras y Proveedores (usa las funciones de index.html)
async function viewCompras() {
  const [prods, sups, buys] = await Promise.all([
    q(db.from('products').select('id,name,unit').eq('active', true).order('name')),
    q(db.from('suppliers').select('id,name,phone').eq('active', true).order('name')),
    q(db.from('purchases').select('id,purchase_date,currency,exchange_rate,total_usd,status,suppliers(name)').order('id', {ascending: false}).limit(15))
  ]);
  const pOpts = prods.map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.unit)})</option>`).join('');
  const sOpts = sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const rows = buys.map(b => `<tr><td>#${b.id}</td><td>${b.purchase_date}</td><td>${esc(b.suppliers?.name || 'Sin proveedor')}</td><td>${b.currency}</td>
    <td class="n">${fmt(b.total_usd)}</td><td class="n">${fmt(b.total_usd * b.exchange_rate)}</td><td>${esc(b.status)}</td></tr>`).join('');

  $('#view').innerHTML = `
  <div class="card"><h2>Nueva compra</h2>
    ${prods.length ? `<form id="cForm">
      <div class="grid">
        <label>Proveedor<select name="supplier_id"><option value="">Sin proveedor</option>${sOpts}</select></label>
        <label>Moneda de la factura<select name="currency"><option value="USD">Dólares (USD)</option><option value="VES">Bolívares (Bs)</option></select></label>
        <label>Tasa (Bs por 1 USD)<input name="rate" type="number" step="0.0001" min="0.0001" value="${S.rate || ''}" required></label>
        <label>Nota<input name="notes" placeholder="Ej: factura 0123"></label>
      </div>
      <h2 style="margin-top:1rem">Productos comprados</h2>
      <div id="lines"></div>
      <div class="row"><button type="button" class="btn ghost" id="addLine">Agregar producto</button><strong id="cTotal"></strong></div>
      <div class="row"><button class="btn" type="submit">Registrar compra</button></div>
    </form>` : '<p class="mut">Primero crea productos en la pestaña Productos.</p>'}</div>

  <div class="card"><h2>Proveedores (${sups.length})</h2>
    <form id="sForm" class="grid">
      <label>Nombre<input name="name" required></label>
      <label>RIF<input name="rif"></label>
      <label>Teléfono<input name="phone"></label>
      <button class="btn" type="submit">Guardar proveedor</button>
    </form>
    ${sups.length ? `<p class="mut">${sups.map(s => esc(s.name)).join(', ')}</p>` : '<p class="mut">Aún no hay proveedores. Puedes registrar compras sin proveedor.</p>'}</div>

  <div class="card"><h2>Últimas compras</h2>
    ${buys.length ? `<div class="scroll"><table><thead><tr><th>N.°</th><th>Fecha</th><th>Proveedor</th><th>Moneda</th><th class="n">Total USD</th><th class="n">Total Bs</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="mut">Aún no hay compras registradas.</p>'}</div>`;

  // Proveedores
  $('#sForm').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    run(async () => {
      await q(db.from('suppliers').insert({name: f.get('name').trim(), rif: f.get('rif').trim() || null, phone: f.get('phone').trim() || null}));
      toast('Proveedor guardado'); render();
    });
  };

  const form = $('#cForm');
  if (!form) return;

  // Total en vivo
  const upd = () => {
    const cur = form.elements.currency.value, rate = +form.elements.rate.value || 0;
    let t = 0;
    document.querySelectorAll('#lines .line').forEach(l => { t += (+l.querySelector('[name=qty]').value || 0) * (+l.querySelector('[name=cost]').value || 0); });
    const usd = cur === 'USD' ? t : (rate ? t / rate : 0), bs = cur === 'USD' ? t * rate : t;
    $('#cTotal').textContent = `Total: ${fmt(usd)} USD (${fmt(bs)} Bs)`;
  };
  const addLine = () => {
    const d = document.createElement('div');
    d.className = 'grid line';
    d.innerHTML = `<label>Producto<select name="product_id">${pOpts}</select></label>
      <label>Cantidad<input name="qty" type="number" step="0.001" min="0.001" required></label>
      <label>Costo unitario (moneda de la factura)<input name="cost" type="number" step="0.0001" min="0" required></label>
      <button type="button" class="btn ghost" data-rm="1">Quitar</button>`;
    $('#lines').appendChild(d);
  };
  addLine(); upd();
  $('#addLine').onclick = addLine;
  form.addEventListener('input', upd);
  form.addEventListener('change', upd);
  $('#lines').addEventListener('click', (e) => {
    if (e.target.dataset.rm && document.querySelectorAll('#lines .line').length > 1) { e.target.closest('.line').remove(); upd(); }
  });

  // Registrar compra (la base de datos suma el stock y recalcula el costo promedio)
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const items = [...document.querySelectorAll('#lines .line')].map(l => ({
      product_id: +l.querySelector('[name=product_id]').value,
      quantity: +l.querySelector('[name=qty]').value,
      unit_cost: +l.querySelector('[name=cost]').value
    })).filter(x => x.product_id && x.quantity > 0);
    run(async () => {
      if (!items.length) throw new Error('Agrega al menos un producto con su cantidad');
      const id = await q(db.rpc('registrar_compra', {
        p_supplier_id: f.get('supplier_id') ? +f.get('supplier_id') : null,
        p_currency: f.get('currency'), p_rate: +f.get('rate'), p_notes: f.get('notes').trim() || null, p_items: items
      }));
      toast('Compra #' + id + ' registrada. Stock y costos actualizados.'); render();
    });
  };
}
views.compras = viewCompras;
