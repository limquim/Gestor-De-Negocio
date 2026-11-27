// Cotizaciones: crear, enviar como foto, convertir en venta
async function quoteDetail(id) {
  const [s, items] = await Promise.all([
    q(db.from('quotes').select('*, parties(name,phone)').eq('id', id).single()),
    q(db.from('quote_items').select('product_id,quantity,unit_price_usd,products(name,sku)').eq('quote_id', id).order('id'))
  ]);
  return {s, items: items.map(i => ({...i, name: i.products?.name, sku: i.products?.sku || ''}))};
}
function quoteText(d, set, payDetails = '') {
  return docText(quoteDoc(d, set, payDetails), set);
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
  const [d, set, payTxt] = await Promise.all([quoteDetail(id), q(db.from('settings').select('*').eq('id', 1).single()), getPaymentDetailsText()]);
  const s = d.s, doc = quoteDoc(d, set, payTxt), text = docText(doc, set), blobP = docBlob(doc, text, set).catch(() => null), open = s.status === 'abierta';
  openSheet('Cotización #' + id, `<div id="tPrev"><pre class="ticket">${esc(text)}</pre></div>
    <div class="row"><button class="btn" id="qI">Enviar como foto</button><button class="btn ghost" id="qD">Descargar foto</button></div>
    ${payTxt ? '<div class="row"><button class="btn ghost" id="qPay">Enviar datos de pago (WhatsApp)</button></div>' : ''}
    ${open ? '<div class="row"><button class="btn" id="qV">Convertir en venta</button><button class="btn ghost" id="qE">Editar</button><button class="btn ghost" id="qA">Anular</button></div>'
      : `<p class="mut">Estado: ${s.status === 'convertida' ? 'convertida en la venta #' + s.sale_id : 'anulada'}</p>`}`);
  showPrev(blobP, set);
  $('#qI').onclick = () => run(async () => shareImage(await blobP, s.parties?.phone, 'cotizacion-' + id));
  $('#qD').onclick = () => run(async () => { const b = await blobP; if (!b) throw new Error('No se pudo crear la imagen'); downloadBlob(b, 'cotizacion-' + id + '.png'); });
  if (payTxt) $('#qPay').onclick = () => window.open(`https://wa.me/${waDigits(s.parties?.phone)}?text=${encodeURIComponent(`Hola, te comparto nuestros datos para concretar la cotización #${id}:\n\n${payTxt}`)}`, '_blank');
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
  const curQList = () => D.lists.find(l => String(l.id) === String($('#qF')?.elements?.plist?.value || '')) || null;
  const line = (pid, qv, pr) => {
    const p = pm[pid], base = +p?.sale_price_usd || 0;
    return {pid, name: p?.name, qty: qv, price: pr ?? priceWithList(base, curQList()), price0: base};
  };
  const cart = old ? old.items.map(i => line(i.product_id, +i.quantity, +i.unit_price_usd)) : [];
  const v7 = new Date(caracasDate() + 'T12:00:00'); v7.setDate(v7.getDate() + 7);
  openSheet(old ? 'Editar cotización #' + id : 'Nueva cotización', `<form id="qF" class="stack">
    <label>Cliente<select name="cust"><option value="">Cliente general</option>${D.custs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    ${D.lists.length ? `<label>Lista de precios<select name="plist"><option value="">Precio normal (0%)</option>${D.lists.map(l => `<option value="${l.id}">${esc(l.name)} (${+l.adjust_percent > 0 ? '+' : ''}${qty(l.adjust_percent)}%)</option>`).join('')}</select></label>` : ''}
    <div class="row0" style="justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.45rem .65rem;background:var(--bg);border:1px solid var(--line);border-radius:10px">
      <label class="chk" style="margin:0"><input type="checkbox" name="iva"> <b>Aplicar IVA</b></label>
      <label id="qIvaPctW" class="row0 hidden" style="margin:0;gap:.35rem">
        <span class="mut" style="font-size:.82rem">% IVA:</span>
        <input name="iva_pct" type="number" step="0.5" min="0" max="100" value="${D.defIva}" style="width:4.8rem;min-height:36px;margin:0;padding:.25rem .45rem;text-align:right">
      </label>
    </div>
    <div class="grid"><label>Tasa (Bs por USD)<input name="rate" type="number" step="0.0001" min="0.0001" required></label>
      <label>Descuento (USD)<input name="disc" type="number" step="0.01" min="0" value="0"></label><label>Válida hasta<input name="valid" type="date"></label></div>
    <div class="scan-row"><input id="qS" type="search" placeholder="Buscar producto o escanear código"><button type="button" class="icon-btn scan-btn" id="qScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div><div class="list" id="qR"></div><div id="qC"></div><p id="qT" class="big"></p>
    <label>Nota<input name="notes" placeholder="Ej: entrega en 2 días"></label><button class="btn" type="submit">Guardar cotización</button></form>`);
  const el = $('#qF').elements;
  el.rate.value = old ? old.s.exchange_rate : (S.rate || ''); el.valid.value = old ? (old.s.valid_until || '') : dstr(v7);
  if (old) {
    el.cust.value = old.s.customer_id || '';
    el.iva.checked = old.s.doc_type === 'factura' || Number(old.s.tax_usd || 0) > 0;
    const baseOld = Math.max(0, Number(old.s.subtotal_usd || 0) - Number(old.s.discount_usd || 0));
    el.iva_pct.value = old.s.iva_percent > 0 ? old.s.iva_percent : (baseOld > 0 && old.s.tax_usd > 0 ? Math.round((old.s.tax_usd / baseOld) * 1000) / 10 : D.defIva);
    el.disc.value = old.s.discount_usd;
    el.notes.value = old.s.notes || '';
  } else if (S.rules?.default_doc_type === 'factura') {
    el.iva.checked = true;
  }
  const syncQIva = () => { $('#qIvaPctW').classList.toggle('hidden', !el.iva.checked); };
  syncQIva();
  const tot = () => {
    const sub = cart.reduce((a, c) => a + c.qty * c.price, 0), disc = Math.min(+el.disc.value || 0, sub);
    const ivaPct = el.iva.checked ? Math.max(0, +el.iva_pct.value || 0) : 0;
    const tax = el.iva.checked ? (sub - disc) * ivaPct / 100 : 0;
    const t = sub - disc + tax;
    $('#qT').innerHTML = `${fmt(t)} USD <span class="mut">(${fmt(t * (+el.rate.value || 0))} Bs)${el.iva.checked ? ` · IVA ${qty(ivaPct)}%: ${fmt(tax)}` : ''}</span>`;
  };
  const draw = () => {
    $('#qC').innerHTML = cart.map((c, i) => `<div class="pl" data-i="${i}"><div><b>${esc(c.name)}</b><button type="button" class="lnk bad" data-rm="${i}">Quitar</button></div>
      <div class="stack" style="gap:.3rem"><label>Cant.<input data-f="qty" type="number" step="0.001" min="0.001" value="${c.qty}"></label><label>Precio USD<input data-f="price" type="number" step="0.01" min="0" value="${c.price}"></label></div></div>`).join('') || '<p class="mut">Busca y agrega productos.</p>';
    tot();
  };
  draw();
  const applyQList = () => {
    const pl = curQList();
    cart.forEach(c => { c.price = priceWithList(c.price0, pl); });
    draw();
  };
  if (el.plist) el.plist.onchange = applyQList;
  el.cust.onchange = () => {
    if (!el.plist) return;
    const c = D.custs.find(x => String(x.id) === el.cust.value);
    const nextLid = c?.price_list_id ? String(c.price_list_id) : '';
    if (el.plist.value !== nextLid) { el.plist.value = nextLid; applyQList(); }
  };
  $('#qS').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase(), pl = curQList();
    $('#qR').innerHTML = t ? (D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).slice(0, 6).map(p => `<button type="button" class="item" data-add="${p.id}"><span><b>${esc(p.name)}</b><small>${fmt(priceWithList(p.sale_price_usd, pl))} USD${pl ? ' (' + esc(pl.name) + ')' : ''}</small></span><span class="mut">+</span></button>`).join('') || '<p class="mut">Sin resultados.</p>') : '';
  };
  const addQuoteByCode = (code) => {
    const p = findBySku(D.products, code);
    if (!p) return {ok: false, msg: 'Código no registrado: ' + code};
    const ex = cart.find(c => c.pid === p.id);
    if (ex) ex.qty = Math.round((ex.qty + 1) * 1000) / 1000;
    else cart.push(line(p.id, 1));
    draw();
    const curQ = cart.find(c => c.pid === p.id)?.qty || 1;
    return {ok: true, msg: `${p.name} (x${qty(curQ)})`};
  };
  $('#qScan').onclick = () => openScanner({
    title: 'Escanear para cotizar',
    continuous: true,
    allowContinuous: true,
    onCode: addQuoteByCode
  });
  bindEnterSku($('#qS'), (code) => {
    const res = addQuoteByCode(code);
    if (res.ok) { scanBeep(true); toast(res.msg); $('#qS').value = ''; $('#qR').innerHTML = ''; return true; }
    return false;
  });
  $('#qR').onclick = (e) => { const b = e.target.closest('[data-add]'); if (!b) return; const pid = +b.dataset.add, ex = cart.find(c => c.pid === pid); ex ? ex.qty++ : cart.push(line(pid, 1)); $('#qS').value = ''; $('#qR').innerHTML = ''; draw(); };
  $('#qC').addEventListener('input', (e) => { const l = e.target.closest('.pl'); if (l && e.target.dataset.f) { cart[+l.dataset.i][e.target.dataset.f] = +e.target.value || 0; tot(); } });
  $('#qC').addEventListener('click', (e) => { if (e.target.dataset.rm !== undefined) { cart.splice(+e.target.dataset.rm, 1); draw(); } });
  ['rate', 'disc', 'iva_pct'].forEach(k => el[k].addEventListener('input', tot));
  el.iva.addEventListener('change', () => { syncQIva(); tot(); });
  $('#qF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!cart.length) throw new Error('Agrega al menos un producto');
      const qid = await q(db.rpc('guardar_cotizacion', {p_id: id, p_customer_id: +el.cust.value || null, p_doc_type: el.iva.checked ? 'factura' : 'nota_entrega', p_iva_percent: el.iva.checked ? Math.max(0, +el.iva_pct.value || 0) : 0, p_rate: +el.rate.value, p_discount_usd: +el.disc.value || 0,
        p_valid_until: el.valid.value || null, p_notes: el.notes.value.trim() || null, p_items: cart.map(c => ({product_id: c.pid, quantity: c.qty, unit_price_usd: c.price}))}));
      toast('Cotización guardada'); closeSheet(); render(); await quoteSheet(qid);
    });
  };
}
