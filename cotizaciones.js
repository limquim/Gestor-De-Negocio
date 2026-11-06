// Cotizaciones: crear, enviar como foto, convertir en venta
async function quoteDetail(id) {
  const [s, items] = await Promise.all([
    q(db.from('quotes').select('*, parties(name,phone)').eq('id', id).single()),
    q(db.from('quote_items').select('product_id,quantity,unit_price_usd,products(name)').eq('quote_id', id).order('id'))
  ]);
  return {s, items: items.map(i => ({...i, name: i.products?.name}))};
}
function quoteText(d, set) {
  const s = d.s, w = set.ticket_paper === '80mm' ? 42 : 32, ln = '-'.repeat(w);
  const two = (a, b) => a + ' '.repeat(Math.max(1, w - a.length - b.length)) + b;
  const o = [(set.business_name || 'Mi negocio').toUpperCase(), set.business_rif && 'RIF: ' + set.business_rif, set.business_phone, set.business_address,
    ln, 'COTIZACIÓN #' + s.id, 'Fecha: ' + s.quote_date, s.valid_until && 'Válida hasta: ' + s.valid_until, 'Cliente: ' + (s.parties?.name || 'Cliente general'), ln];
  d.items.forEach(i => o.push(i.name, two(`${qty(i.quantity)} x ${fmt(i.unit_price_usd)}`, fmt(i.quantity * i.unit_price_usd))));
  o.push(ln, two('Subtotal USD', fmt(s.subtotal_usd)));
  if (+s.discount_usd) o.push(two('Descuento', '-' + fmt(s.discount_usd)));
  if (+s.tax_usd) o.push(two('IVA', fmt(s.tax_usd)));
  o.push(two('TOTAL USD', fmt(s.total_usd)), two('TOTAL Bs', fmt(s.total_usd * s.exchange_rate)), 'Tasa: ' + fmt(s.exchange_rate, 4) + ' Bs/USD');
  if (s.notes) o.push(ln, s.notes);
  o.push(ln, 'Precios sujetos a cambio según la tasa del día.');
  return o.filter(Boolean).join('\n');
}

async function viewCotizaciones() {
  const rows = await q(db.from('quotes').select('id,quote_date,valid_until,status,total_usd,exchange_rate,parties(name)').order('id', {ascending: false}).limit(60));
  const hoy = caracasDate(), ST = {abierta: 'Abierta', convertida: 'Vendida', anulada: 'Anulada'};
  $('#view').innerHTML = `<div class="list" id="qL">${rows.map(r => {
    const venc = r.status === 'abierta' && r.valid_until && r.valid_until < hoy;
    return `<button class="item" data-id="${r.id}"><span><b>#${r.id} ${esc(r.parties?.name || 'Cliente general')}</b>
      <small>${r.quote_date}${r.valid_until ? ' | válida hasta ' + r.valid_until : ''}</small><small>${fmt(r.total_usd)} USD (${fmt(r.total_usd * r.exchange_rate)} Bs)</small></span>
      <span class="badge ${r.status === 'convertida' ? 'ok' : r.status === 'abierta' && !venc ? 'low' : 'out'}">${venc ? 'Vencida' : ST[r.status]}</span></button>`;
  }).join('') || '<p class="mut">Aún no hay cotizaciones. Pulsa + para crear la primera.</p>'}</div>
  <button class="fab" id="qAdd" aria-label="Nueva cotización">+</button>`;
  $('#qAdd').onclick = () => run(() => quoteForm(null));
  $('#qL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => quoteSheet(+b.dataset.id)); };
}

async function quoteSheet(id) {
  const [d, set] = await Promise.all([quoteDetail(id), q(db.from('settings').select('*').eq('id', 1).single())]);
  const s = d.s, text = quoteText(d, set), blobP = ticketBlob(text, set).catch(() => null), open = s.status === 'abierta';
  openSheet('Cotización #' + id, `<pre class="ticket">${esc(text)}</pre>
    <div class="row"><button class="btn" id="qI">Enviar como foto</button><button class="btn ghost" id="qD">Descargar foto</button></div>
    ${open ? '<div class="row"><button class="btn" id="qV">Convertir en venta</button><button class="btn ghost" id="qE">Editar</button><button class="btn ghost" id="qA">Anular</button></div>'
      : `<p class="mut">Estado: ${s.status === 'convertida' ? 'convertida en la venta #' + s.sale_id : 'anulada'}</p>`}`);
  $('#qI').onclick = () => run(async () => shareImage(await blobP, s.parties?.phone, 'cotizacion-' + id));
  $('#qD').onclick = () => run(async () => { const b = await blobP; if (!b) throw new Error('No se pudo crear la imagen'); downloadBlob(b, 'cotizacion-' + id + '.png'); });
  if (!open) return;
  $('#qV').onclick = () => { V.fromQ = id; V.edit = null; SUB.ven = 'nueva'; closeSheet(); go('ventas'); };
  $('#qE').onclick = () => run(() => quoteForm(id));
  $('#qA').onclick = () => run(async () => {
    if (!confirm('¿Anular esta cotización?')) return;
    await q(db.from('quotes').update({status: 'anulada'}).eq('id', id)); closeSheet(); toast('Cotización anulada'); render();
  });
}

async function quoteForm(id) {
  const D = await vData(), old = id ? await quoteDetail(id) : null, pm = Object.fromEntries(D.products.map(p => [p.id, p]));
  const line = (pid, qv, pr) => { const p = pm[pid]; return {pid, name: p?.name, qty: qv, price: pr ?? +p?.sale_price_usd}; };
  const cart = old ? old.items.map(i => line(i.product_id, +i.quantity, +i.unit_price_usd)) : [];
  const v7 = new Date(caracasDate() + 'T12:00:00'); v7.setDate(v7.getDate() + 7);
  openSheet(old ? 'Editar cotización #' + id : 'Nueva cotización', `<form id="qF" class="stack">
    <label>Cliente<select name="cust"><option value="">Cliente general</option>${D.custs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    <label>Documento<select name="doc">${optList(DOCS)}</select></label>
    <div class="grid"><label>Tasa (Bs por USD)<input name="rate" type="number" step="0.0001" min="0.0001" required></label>
      <label>Descuento (USD)<input name="disc" type="number" step="0.01" min="0" value="0"></label><label>Válida hasta<input name="valid" type="date"></label></div>
    <input id="qS" type="search" placeholder="Buscar producto o código"><div class="list" id="qR"></div><div id="qC"></div><p id="qT" class="big"></p>
    <label>Nota<input name="notes" placeholder="Ej: entrega en 2 días"></label><button class="btn" type="submit">Guardar cotización</button></form>`);
  const el = $('#qF').elements;
  el.rate.value = old ? old.s.exchange_rate : (S.rate || ''); el.valid.value = old ? (old.s.valid_until || '') : dstr(v7);
  if (old) { el.cust.value = old.s.customer_id || ''; el.doc.value = old.s.doc_type; el.disc.value = old.s.discount_usd; el.notes.value = old.s.notes || ''; }
  const tot = () => {
    const sub = cart.reduce((a, c) => a + c.qty * c.price, 0), disc = Math.min(+el.disc.value || 0, sub);
    let tax = el.doc.value === 'factura' ? cart.reduce((a, c) => a + c.qty * c.price * Number(pm[c.pid]?.taxes?.percent || 0) / 100, 0) : 0;
    if (sub > 0) tax *= (sub - disc) / sub;
    const t = sub - disc + tax; $('#qT').innerHTML = `${fmt(t)} USD <span class="mut">(${fmt(t * (+el.rate.value || 0))} Bs)</span>`;
  };
  const draw = () => {
    $('#qC').innerHTML = cart.map((c, i) => `<div class="pl" data-i="${i}"><div><b>${esc(c.name)}</b><button type="button" class="lnk bad" data-rm="${i}">Quitar</button></div>
      <div class="stack" style="gap:.3rem"><label>Cant.<input data-f="qty" type="number" step="0.001" min="0.001" value="${c.qty}"></label><label>Precio USD<input data-f="price" type="number" step="0.01" min="0" value="${c.price}"></label></div></div>`).join('') || '<p class="mut">Busca y agrega productos.</p>';
    tot();
  };
  draw();
  $('#qS').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase();
    $('#qR').innerHTML = t ? (D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).slice(0, 6).map(p => `<button type="button" class="item" data-add="${p.id}"><span><b>${esc(p.name)}</b><small>${fmt(p.sale_price_usd)} USD</small></span><span class="mut">+</span></button>`).join('') || '<p class="mut">Sin resultados.</p>') : '';
  };
  $('#qR').onclick = (e) => { const b = e.target.closest('[data-add]'); if (!b) return; const pid = +b.dataset.add, ex = cart.find(c => c.pid === pid); ex ? ex.qty++ : cart.push(line(pid, 1)); $('#qS').value = ''; $('#qR').innerHTML = ''; draw(); };
  $('#qC').addEventListener('input', (e) => { const l = e.target.closest('.pl'); if (l && e.target.dataset.f) { cart[+l.dataset.i][e.target.dataset.f] = +e.target.value || 0; tot(); } });
  $('#qC').addEventListener('click', (e) => { if (e.target.dataset.rm !== undefined) { cart.splice(+e.target.dataset.rm, 1); draw(); } });
  ['rate', 'doc', 'disc'].forEach(k => el[k].addEventListener('input', tot));
  $('#qF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!cart.length) throw new Error('Agrega al menos un producto');
      const qid = await q(db.rpc('guardar_cotizacion', {p_id: id, p_customer_id: +el.cust.value || null, p_doc_type: el.doc.value, p_rate: +el.rate.value, p_discount_usd: +el.disc.value || 0,
        p_valid_until: el.valid.value || null, p_notes: el.notes.value.trim() || null, p_items: cart.map(c => ({product_id: c.pid, quantity: c.qty, unit_price_usd: c.price}))}));
      toast('Cotización guardada'); closeSheet(); render(); await quoteSheet(qid);
    });
  };
}
