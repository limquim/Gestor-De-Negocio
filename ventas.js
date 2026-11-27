// Ventas: nueva venta o corrección, historial, cobros y ticket
const METHODS = {efectivo: 'Efectivo', pago_movil: 'Pago móvil', transferencia: 'Transferencia', zelle: 'Zelle', punto: 'Punto de venta', otro: 'Otro'};
const DOCS = {nota_entrega: 'Nota de entrega (sin IVA)', factura: 'Factura (con IVA)'};
const V = {cart: [], pays: [], edit: null, dup: null}, VH = {f: 'all', q: '', from: '', to: ''};
const waDigits = (t) => String(t || '').replace(/\D/g, '').replace(/^0/, '58');
const optList = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

function priceWithList(basePrice, listObj) {
  const b = Number(basePrice || 0);
  if (!listObj || !b) return b;
  const pct = Number(listObj.adjust_percent || 0);
  return Math.max(0, Math.round(b * (1 + pct / 100) * 100) / 100);
}

async function vData() {
  const [products, stock, custs, accs, lists, taxes, recentItems] = await Promise.all([
    db.from('products').select('id,name,sku,unit,sale_price_usd,is_service,track_inventory,taxes(percent)').eq('active', true).order('name')
      .then(r => r.error ? q(db.from('products').select('id,name,sku,unit,sale_price_usd,is_service,taxes(percent)').eq('active', true).order('name')) : r.data),
    q(db.from('stock_actual').select('product_id,stock')),
    db.from('parties').select('id,name,phone,price_list_id').eq('is_customer', true).eq('active', true).order('name')
      .then(r => r.error ? q(db.from('parties').select('id,name,phone').eq('is_customer', true).eq('active', true).order('name')) : r.data),
    db.from('accounts').select('id,name,currency,methods,is_default').eq('active', true).order('is_default', {ascending: false}).order('id').then(r => r.error ? q(db.from('accounts').select('id,name,currency,methods').eq('active', true).order('id')) : r.data),
    db.from('price_lists').select('id,name,adjust_percent').eq('active', true).order('name').then(r => r.error ? [] : (r.data || [])),
    db.from('taxes').select('percent').eq('active', true).then(r => r.error ? [] : (r.data || [])),
    db.from('sale_items').select('product_id,quantity').order('id', {ascending: false}).limit(300).then(r => r.error ? [] : (r.data || []))
  ]);
  const defIva = Number((taxes || []).find(t => Number(t.percent) > 0)?.percent || 16);
  const freq = {};
  (recentItems || []).forEach(i => { freq[i.product_id] = (freq[i.product_id] || 0) + Number(i.quantity || 1); });
  const sellable = products.filter(p => Number(p.sale_price_usd || 0) > 0 || p.is_service);
  const topProds = [...sellable]
    .sort((a, b) => (freq[b.id] || 0) - (freq[a.id] || 0) || a.name.localeCompare(b.name, 'es'))
    .slice(0, 8);
  return {products, st: Object.fromEntries(stock.map(s => [s.product_id, Number(s.stock)])), custs, accs, lists, defIva, topProds};
}
async function saleDetail(id) {
  const [s, items, pays, ret, rit] = await Promise.all([
    q(db.from('sales').select('*, parties(name,phone)').eq('id', id).single()),
    q(db.from('sale_items').select('product_id,quantity,unit_price_usd,unit_cost_usd,tax_percent,products(name,sku)').eq('sale_id', id).order('id')),
    q(db.from('payments').select('method,currency,amount,amount_usd,reference,account_id,accounts(name)').eq('sale_id', id).order('id')),
    q(db.from('sale_returns').select('total_usd,refund_usd').eq('sale_id', id).eq('status', 'activa')),
    q(db.from('sale_return_items').select('quantity,unit_price_usd,unit_cost_usd,restock,sale_returns!inner(sale_id,status)').eq('sale_returns.sale_id', id).eq('sale_returns.status', 'activa'))
  ]);
  return {s, items: items.map(i => ({...i, name: i.products?.name, sku: i.products?.sku || ''})), pays, ret, rit};
}

// ---------- Ticket ----------
function ticketText(d, set, payDetails = '') {
  return docText(saleDoc(d, set, payDetails), set);
}
function printTicket(text, paper) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(f);
  f.contentDocument.write(`<pre style="font:12px/1.3 monospace;margin:0;width:${paper === '80mm' ? '80mm' : '58mm'}">${esc(text)}</pre>`); f.contentDocument.close();
  f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000);
}
async function showTicket(id) {
  const [d, set, payTxt] = await Promise.all([
    saleDetail(id),
    q(db.from('settings').select('*').eq('id', 1).single()),
    typeof getPaymentDetailsText === 'function' ? getPaymentDetailsText() : Promise.resolve('')
  ]);
  const doc = saleDoc(d, set, payTxt);
  const text = docText(doc, set);
  const blobP = docBlob(doc, text, set).catch(() => null);
  const dispId = Number(id) < 0 ? 'LOC-' + Math.abs(id) + ' (Sin conexión)' : '#' + id;
  openSheet('Ticket de venta ' + dispId, `<div id="tPrev"><pre class="ticket">${esc(text)}</pre></div><div class="row"><button class="btn" id="tI">Enviar como foto</button><button class="btn ghost" id="tD">Descargar foto</button></div>
    <div class="row"><button class="btn ghost" id="tP">Imprimir</button><button class="btn ghost" id="tW">Enviar como texto</button></div>`);
  showPrev(blobP, set);
  $('#tI').onclick = () => run(async () => shareImage(await blobP, d.s.parties?.phone, 'ticket-' + id));
  $('#tD').onclick = () => run(async () => { const b = await blobP; if (!b) throw new Error('No se pudo crear la imagen'); downloadBlob(b, 'ticket-' + id + '.png'); });
  $('#tP').onclick = () => printTicket(text, set.ticket_paper);
  $('#tW').onclick = () => window.open(`https://wa.me/${waDigits(d.s.parties?.phone)}?text=${encodeURIComponent(text)}`, '_blank');
}

// ---------- Nueva venta / corrección ----------
async function viewVenta() {
  const fq = V.fromQ; V.fromQ = null;
  const dup = V.dup; V.dup = null;
  const D = await vData(), old = V.edit ? await saleDetail(V.edit) : null, qd = fq ? await quoteDetail(fq) : null;
  if (old) old.items.forEach(i => { D.st[i.product_id] = (D.st[i.product_id] || 0) + +i.quantity; });   // el stock vuelve a contar lo ya vendido
  const pm = Object.fromEntries(D.products.map(p => [p.id, p]));
  const curPriceList = () => D.lists.find(l => String(l.id) === String($('#vList')?.value || '')) || null;
  const line = (pid, qv, pr) => {
    const p = pm[pid], base = +p?.sale_price_usd || 0, adj = priceWithList(base, curPriceList());
    return {pid, name: p?.name, unit: p?.unit, qty: qv, price: pr ?? adj, price0: base, svc: !!p?.is_service, untr: p?.track_inventory === false, pct: Number(p?.taxes?.percent || 0)};
  };
  const srcOrder = old || qd || dup;
  V.cart = srcOrder ? srcOrder.items.filter(i => pm[i.product_id]).map(i => line(i.product_id, +i.quantity, dup ? null : +i.unit_price_usd)) : [];
  V.pays = old ? old.pays.map(p => ({acc: p.account_id, method: p.method, amount: +p.amount, ref: p.reference || ''})) : [];

  $('#view').innerHTML = `${V.edit ? `<div class="card title-row"><b>Corrigiendo la venta #${V.edit}</b><button class="lnk" id="vCancel">Cancelar</button></div>` : ''}
  <div class="card stack">
    <div class="row0"><label style="flex:1">Cliente<select id="vCust"><option value="">Cliente general</option>${D.custs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><button class="btn ghost" type="button" id="vNewC" aria-label="Nuevo cliente">+</button></div>
    ${D.lists.length ? `<label>Lista de precios<select id="vList"><option value="">Precio normal (0%)</option>${D.lists.map(l => `<option value="${l.id}">${esc(l.name)} (${+l.adjust_percent > 0 ? '+' : ''}${qty(l.adjust_percent)}%)</option>`).join('')}</select></label>` : ''}
    <div class="row0" style="justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.45rem .65rem;background:var(--bg);border:1px solid var(--line);border-radius:10px">
      <label class="chk" style="margin:0"><input type="checkbox" id="vIva"> <b>Aplicar IVA</b></label>
      <label id="vIvaPctW" class="row0 hidden" style="margin:0;gap:.35rem">
        <span class="mut" style="font-size:.82rem">% IVA:</span>
        <input id="vIvaPct" type="number" step="0.5" min="0" max="100" value="${D.defIva}" style="width:4.8rem;min-height:36px;margin:0;padding:.25rem .45rem;text-align:right">
      </label>
    </div>
    <div class="grid">
      <label>Fecha de la venta<input id="vDate" type="date" value="${esc(old ? old.s.sale_date : caracasDate())}"></label>
      <label class="${S.bimoneda === false ? 'hidden' : ''}">Tasa (Bs por USD)<input id="vRate" type="number" step="0.0001" min="0.0001"></label>
      <label>Descuento (USD)<input id="vDisc" type="number" step="0.01" min="0" value="0"></label>
    </div></div>
  <div class="card"><h2>Productos</h2>
    ${D.topProds.length ? `<div class="stack" style="gap:.35rem;margin-bottom:.65rem"><small class="mut">Productos rápidos (toca para agregar):</small><div class="chips" id="vFastProds">${D.topProds.map(p => `<button type="button" data-fadd="${p.id}">${esc(p.name)} · <b>$${fmt(p.sale_price_usd)}</b></button>`).join('')}</div></div>` : ''}
    <div class="scan-row"><input id="vSearch" type="search" placeholder="Buscar producto o escanear código"><button type="button" class="icon-btn scan-btn" id="vScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div><div class="list" id="vRes" style="margin:.5rem 0"></div><div id="vCart"></div></div>
  <div class="card"><h2>Total</h2><div id="vTot"></div></div>
  <div class="card"><h2>Pagos</h2>
    ${D.accs.length ? `<div class="stack" style="gap:.35rem;margin-bottom:.65rem"><small class="mut">Cobro rápido (pago completo en 1 toque):</small><div class="chips" id="vQuickPay">${D.accs.slice(0, 5).map(a => `<button type="button" data-qacc="${a.id}">${esc(a.name)} (${a.currency})</button>`).join('')}</div></div>` : ''}
    <div id="vPays"></div><div class="row"><button class="btn ghost" type="button" id="vAddPay">+ Agregar pago parcial / mixto</button></div>
    <p id="vBal"></p><label id="vDueW" class="hidden">Fecha límite del saldo<input id="vDue" type="date"></label></div>
  <label>Nota<input id="vNotes"></label>
  <div class="row"><button class="btn" id="vGo">${V.edit ? 'Guardar corrección' : 'Registrar venta'}</button></div>`;
  const rules = S.rules || {};
  const lockSellerPrice = (S.role === 'vendedor') && rules.allow_seller_price_edit === false;
  $('#vRate').value = S.bimoneda === false ? 1 : (old ? old.s.exchange_rate : (S.rate || ''));
  const inferIvaPct = (rec) => {
    if (rec?.iva_percent != null && Number(rec.iva_percent) > 0) return Number(rec.iva_percent);
    const base = Math.max(0, Number(rec?.subtotal_usd || 0) - Number(rec?.discount_usd || 0));
    if (base > 0 && Number(rec?.tax_usd || 0) > 0) return Math.round((Number(rec.tax_usd) / base) * 1000) / 10;
    return D.defIva;
  };
  if (!old && !qd && !dup) { $('#vIva').checked = rules.default_doc_type === 'factura'; }
  if (old) {
    $('#vCust').value = old.s.customer_id || '';
    $('#vIva').checked = old.s.doc_type === 'factura' || Number(old.s.tax_usd || 0) > 0;
    $('#vIvaPct').value = inferIvaPct(old.s);
    $('#vDisc').value = old.s.discount_usd;
    $('#vDue').value = old.s.due_date || '';
    $('#vNotes').value = old.s.notes || '';
  }
  if (qd || dup) {
    const src = qd || dup;
    $('#vCust').value = src.s.customer_id || '';
    $('#vIva').checked = src.s.doc_type === 'factura' || Number(src.s.tax_usd || 0) > 0;
    $('#vIvaPct').value = inferIvaPct(src.s);
    $('#vDisc').value = src.s.discount_usd || 0;
    if (dup && src.s.notes) $('#vNotes').value = src.s.notes;
  }
  const syncIvaUI = () => { $('#vIvaPctW').classList.toggle('hidden', !$('#vIva').checked); };
  syncIvaUI();
  let dueTouched = !!(old && old.s.due_date);
  $('#vDue').addEventListener('input', () => { dueTouched = true; });
  const calc = () => {
    const rate = S.bimoneda === false ? 1 : (+$('#vRate').value || 0), sub = V.cart.reduce((a, c) => a + c.qty * c.price, 0), disc = Math.min(+$('#vDisc').value || 0, sub);
    const ivaOn = $('#vIva').checked, ivaPct = ivaOn ? Math.max(0, +$('#vIvaPct').value || 0) : 0;
    const tax = ivaOn ? (sub - disc) * ivaPct / 100 : 0;
    return {sub, disc, tax, ivaOn, ivaPct, total: sub - disc + tax, rate};
  };
  const payUsd = (p, rate) => { const a = D.accs.find(x => x.id === +p.acc); return !a ? 0 : a.currency === 'USD' ? p.amount : (rate ? p.amount / rate : 0); };
  const totals = () => {
    const t = calc(), paid = V.pays.reduce((a, p) => a + payUsd(p, t.rate), 0), bal = t.total - paid;
    const discPct = t.sub > 0 ? (t.disc / t.sub * 100) : 0;
    const maxDisc = Number(rules.max_discount_percent || 0);
    const overDisc = maxDisc > 0 && discPct > maxDisc + 0.05 && (S.role || 'admin') !== 'admin';
    const showBs = S.bimoneda !== false && t.rate > 0;
    $('#vTot').innerHTML = `Subtotal: ${fmt(t.sub)} USD${t.disc ? ' | Descuento: -' + fmt(t.disc) + ' (' + fmt(discPct, 1) + '%)' : ''}${t.ivaOn ? ' | IVA (' + qty(t.ivaPct) + '%): ' + fmt(t.tax) : ''}${overDisc ? `<br><span class="warn">Supera el tope máximo permitido de descuento (${qty(maxDisc)}%)</span>` : ''}<br><span class="big">${fmt(t.total)} USD</span>${showBs ? `<br><span class="mut">${fmt(t.total * t.rate)} Bs</span>` : ''}`;
    $('#vBal').innerHTML = `Pagado: <b>${fmt(paid)} USD</b> | ` + (bal > 0.01 ? `<span class="warn">Queda a crédito: <b>${fmt(bal)} USD</b>${showBs ? ' (' + fmt(bal * t.rate) + ' Bs)' : ''}</span>` : bal < -0.01 ? `Vuelto: <b>${fmt(-bal)} USD</b>${showBs ? ' (' + fmt(-bal * t.rate) + ' Bs)' : ''}` : '<span class="in"><b>Pago completo</b></span>');
    $('#vDueW').classList.toggle('hidden', !(bal > 0.01));
    if (bal > 0.01 && !dueTouched && !$('#vDue').value && Number(rules.default_credit_days || 0) > 0 && typeof addDaysISO === 'function') {
      $('#vDue').value = addDaysISO(caracasDate(), rules.default_credit_days);
    }
    document.querySelectorAll('#vPays .payl').forEach(l => { const u = payUsd(V.pays[+l.dataset.i], t.rate); l.querySelector('.eq').textContent = '≈ ' + fmt(u) + ' USD' + (showBs ? ' | ' + fmt(u * t.rate) + ' Bs' : ''); });
    document.querySelectorAll('#vCart .pl').forEach(l => { const c = V.cart[+l.dataset.i]; l.querySelector('.lt').textContent = 'Total: ' + fmt(c.qty * c.price) + ' USD'; });
    if ($('#vGo') && !V.edit) {
      $('#vGo').textContent = (V.cart.length && bal > 0.01) ? (paid > 0.01 ? 'Registrar venta (con saldo a crédito)' : 'Registrar venta a crédito') : 'Registrar venta';
    }
    return {...t, paid, bal};
  };
  const drawCart = () => {
    $('#vCart').innerHTML = V.cart.map((c, i) => `<div class="pl" data-i="${i}"><div><b>${esc(c.name)}</b><small>${c.svc ? 'Servicio (sin inventario)' : c.untr ? 'Insumo sin inventario' : 'Disponible: ' + qty(D.st[c.pid] || 0) + ' ' + esc(c.unit)}</small><small class="lt"></small>${c.svc ? `<button class="lnk" data-free="${i}">${c.price > 0 ? 'Asumirlo yo (no cobrar)' : 'Cobrarlo al cliente'}</button>` : ''}<button class="lnk bad" data-rm="${i}">Quitar</button></div>
      <div class="stack" style="gap:.3rem"><label>Cant.<div class="aj-step"><button type="button" class="aj-sb" data-qdec="${i}" aria-label="Restar 1">&minus;</button><input data-f="qty" type="number" step="0.001" min="0.001" value="${c.qty}" style="width:4rem"><button type="button" class="aj-sb" data-qinc="${i}" aria-label="Sumar 1">+</button></div></label><label>Precio USD<input data-f="price" type="number" step="0.01" min="0" value="${c.price}" ${lockSellerPrice ? 'disabled' : ''}></label></div></div>`).join('') || '<p class="mut">Busca y agrega productos.</p>';
    totals();
  };
  const drawPays = () => {
    $('#vPays').innerHTML = V.pays.map((p, i) => `<div class="stack payl" data-i="${i}">
      <div class="ln2"><label>Cuenta<select data-f="acc">${D.accs.map(a => `<option value="${a.id}" ${a.id === +p.acc ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('')}</select></label>
        <label>Método<select data-f="method">${optList(accMethods(D.accs.find(x => x.id === +p.acc)), p.method)}</select></label></div>
      <div class="ln2"><label>Monto<input data-f="amount" type="number" step="0.01" min="0" value="${p.amount}"></label><label>Referencia<input data-f="ref" value="${esc(p.ref)}"></label></div>
      <small class="mut eq"></small><button class="lnk bad" data-rmp="${i}">Quitar pago</button></div>`).join('') || '<p class="mut">Sin pagos: la venta quedará a crédito.</p>';
    totals();
  };
  drawCart(); drawPays();

  const applyPriceListToCart = () => {
    const pl = curPriceList();
    V.cart.forEach(c => {
      if (c.svc && c.price === 0) return;
      c.price = priceWithList(c.price0, pl);
    });
    drawCart();
  };
  if ($('#vList')) $('#vList').onchange = () => { applyPriceListToCart(); const pl = curPriceList(); toast(pl ? `Lista "${pl.name}" aplicada` : 'Precios normales restaurados'); };
  $('#vCust').onchange = () => {
    if (!$('#vList')) return;
    const c = D.custs.find(x => String(x.id) === $('#vCust').value);
    const nextLid = c?.price_list_id ? String(c.price_list_id) : '';
    if ($('#vList').value !== nextLid) {
      $('#vList').value = nextLid;
      applyPriceListToCart();
      const pl = curPriceList();
      if (pl) toast(`Lista "${pl.name}" aplicada para ${c.name}`);
    }
  };
  $('#vSearch').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase(), pl = curPriceList();
    $('#vRes').innerHTML = t ? (D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).slice(0, 6).map(p => {
      const pr = priceWithList(p.sale_price_usd, pl);
      return `<button class="item" data-add="${p.id}"><span><b>${esc(p.name)}</b><small>${fmt(pr)} USD${pl ? ' (' + esc(pl.name) + ')' : ''} | ${p.is_service ? 'Servicio' : p.track_inventory === false ? 'Sin inventario' : 'Disponible: ' + qty(D.st[p.id] || 0) + ' ' + esc(p.unit)}</small></span><span class="mut">+</span></button>`;
    }).join('') || '<p class="mut">Sin resultados.</p>') : '';
  };
  const addProdByCode = (code) => {
    const p = findBySku(D.products, code);
    if (!p) return {ok: false, msg: 'Código no registrado: ' + code};
    const ex = V.cart.find(c => c.pid === p.id);
    if (ex) ex.qty = Math.round((ex.qty + 1) * 1000) / 1000;
    else V.cart.push(line(p.id, 1));
    drawCart();
    const curQ = V.cart.find(c => c.pid === p.id)?.qty || 1;
    return {ok: true, msg: `${p.name} (x${qty(curQ)}) — ${fmt(priceWithList(p.sale_price_usd, curPriceList()))} USD`};
  };
  $('#vScan').onclick = () => openScanner({
    title: 'Escanear para vender',
    continuous: true,
    allowContinuous: true,
    onCode: addProdByCode
  });
  bindEnterSku($('#vSearch'), (code) => {
    const r = addProdByCode(code);
    if (r.ok) { scanBeep(true); toast(r.msg); $('#vSearch').value = ''; $('#vRes').innerHTML = ''; return true; }
    const hits = D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(code.toLowerCase()));
    if (hits.length === 1) {
      const p = hits[0], ex = V.cart.find(c => c.pid === p.id);
      if (ex) ex.qty++; else V.cart.push(line(p.id, 1));
      drawCart(); toast(p.name + ' agregado'); $('#vSearch').value = ''; $('#vRes').innerHTML = ''; return true;
    }
    return false;
  });
  if ($('#vFastProds')) {
    $('#vFastProds').onclick = (e) => {
      const b = e.target.closest('[data-fadd]'); if (!b) return;
      const id = +b.dataset.fadd, ex = V.cart.find(c => c.pid === id);
      if (ex) ex.qty = Math.round((ex.qty + 1) * 1000) / 1000;
      else V.cart.push(line(id, 1));
      drawCart();
      if (navigator.vibrate) try { navigator.vibrate(25); } catch (err) {}
    };
  }
  $('#vRes').onclick = (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const id = +b.dataset.add, ex = V.cart.find(c => c.pid === id); ex ? ex.qty++ : V.cart.push(line(id, 1));
    $('#vSearch').value = ''; $('#vRes').innerHTML = ''; drawCart();
  };
  $('#vCart').addEventListener('input', (e) => { const l = e.target.closest('.pl'); if (l && e.target.dataset.f) { V.cart[+l.dataset.i][e.target.dataset.f] = +e.target.value || 0; totals(); } });
  $('#vCart').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-qinc]'), dec = e.target.closest('[data-qdec]');
    if (inc) { const i = +inc.dataset.qinc; V.cart[i].qty = Math.round((V.cart[i].qty + 1) * 1000) / 1000; drawCart(); return; }
    if (dec) { const i = +dec.dataset.qdec; if (V.cart[i].qty > 1) { V.cart[i].qty = Math.round((V.cart[i].qty - 1) * 1000) / 1000; drawCart(); } return; }
    if (e.target.dataset.rm !== undefined) { V.cart.splice(+e.target.dataset.rm, 1); drawCart(); }
    if (e.target.dataset.free !== undefined) { const c = V.cart[+e.target.dataset.free]; c.price = c.price > 0 ? 0 : (c.price0 || 0); drawCart(); }
  });
  $('#vPays').addEventListener('input', (e) => {
    const l = e.target.closest('.payl'), f = e.target.dataset.f; if (!l || !f) return;
    const p = V.pays[+l.dataset.i];
    if (f === 'acc') {   // al cambiar de cuenta, el monto se convierte con la tasa (USD <-> Bs)
      const t = calc(), usd = payUsd(p, t.rate), a = D.accs.find(x => x.id === +e.target.value);
      p.acc = a.id; p.amount = Math.round(usd * (a.currency === 'USD' ? 1 : t.rate) * 100) / 100; const al = accMethods(a); if (!al[p.method]) p.method = Object.keys(al)[0]; drawPays(); return;
    }
    p[f] = f === 'amount' ? +e.target.value || 0 : e.target.value; totals();
  });
  $('#vPays').addEventListener('click', (e) => { if (e.target.dataset.rmp !== undefined) { V.pays.splice(+e.target.dataset.rmp, 1); drawPays(); } });
  ['vRate', 'vDisc', 'vIvaPct'].forEach(id => $('#' + id).addEventListener('input', totals));
  $('#vIva').addEventListener('change', () => { syncIvaUI(); totals(); });
  if ($('#vQuickPay')) {
    $('#vQuickPay').onclick = (e) => {
      const b = e.target.closest('[data-qacc]'); if (!b) return;
      if (!V.cart.length) return toast('Agrega productos primero', true);
      const t = calc(), a = D.accs.find(x => String(x.id) === b.dataset.qacc);
      if (!a) return;
      const amt = Math.round(t.total * (a.currency === 'USD' ? 1 : (t.rate || 1)) * 100) / 100;
      V.pays = [{acc: a.id, method: Object.keys(accMethods(a))[0] || 'efectivo', amount: amt, ref: ''}];
      drawPays();
      toast(`Pago completo cargado en ${a.name}`);
    };
  }
  $('#vAddPay').onclick = () => {
    const t = totals(), a = D.accs[0]; if (!a) return toast('No hay cuentas de pago configuradas', true);
    V.pays.push({acc: a.id, method: Object.keys(accMethods(a))[0], amount: t.bal > 0 ? Math.round(t.bal * (a.currency === 'USD' ? 1 : t.rate) * 100) / 100 : 0, ref: ''}); drawPays();
  };
  if ($('#vCancel')) $('#vCancel').onclick = () => { V.edit = null; render(); };
  $('#vNewC').onclick = () => run(async () => {
    const name = prompt('Nombre del cliente'); if (!name) return;
    const c = await q(db.from('parties').insert({name: name.trim(), phone: prompt('Teléfono (opcional)') || null, is_customer: true, is_supplier: false}).select('id').single());
    $('#vCust').insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(name)}</option>`); $('#vCust').value = c.id;
  });
  $('#vGo').onclick = () => run(async () => {
    if (!V.cart.length) throw new Error('Agrega al menos un producto');
    const t = totals(), pays = V.pays.filter(p => +p.amount > 0).map(p => ({...p, amount: +p.amount}));
    if (t.paid > t.total + 0.01) {   // vuelto: se descuenta del último pago en efectivo
      const cash = [...pays].reverse().find(p => p.method === 'efectivo');
      if (!cash) throw new Error('El pago supera el total. Ajusta los montos.');
      const ch = (t.paid - t.total) * (D.accs.find(x => x.id === +cash.acc).currency === 'USD' ? 1 : t.rate);
      if (ch > cash.amount + 0.005) throw new Error('El pago supera el total. Ajusta los montos.');
      cash.amount = Math.round((cash.amount - ch) * 100) / 100;
    }
    const discPctGo = t.sub > 0 ? (t.disc / t.sub * 100) : 0;
    if (Number(rules.max_discount_percent || 0) > 0 && discPctGo > Number(rules.max_discount_percent) + 0.05 && (S.role || 'admin') !== 'admin') {
      throw new Error(`El descuento (${fmt(discPctGo, 1)}%) supera el máximo permitido (${qty(rules.max_discount_percent)}%).`);
    }
    const lacking = V.cart.filter(c => !c.svc && !c.untr && c.qty > (D.st[c.pid] || 0));
    if (lacking.length) {
      if (rules.block_negative_stock) {
        throw new Error('Stock insuficiente para: ' + lacking.map(c => `${c.name} (disp: ${qty(D.st[c.pid] || 0)})`).join(', ') + '. Regla activa en Configuración.');
      }
      if (!confirm('Hay productos con inventario insuficiente. ¿Registrar la venta de todos modos?')) return;
    }
    const id = await q(db.rpc('registrar_venta', {p_id: V.edit, p_sale_date: $('#vDate').value || caracasDate(), p_customer_id: +$('#vCust').value || null, p_doc_type: t.ivaOn ? 'factura' : 'nota_entrega', p_iva_percent: t.ivaOn ? t.ivaPct : 0, p_rate: t.rate, p_discount_usd: t.disc,
      p_due_date: $('#vDue').value || null, p_notes: $('#vNotes').value.trim() || null,
      p_items: V.cart.map(c => ({product_id: c.pid, quantity: c.qty, unit_price_usd: c.price})),
      p_payments: pays.map(p => ({account_id: +p.acc, method: p.method, amount: p.amount, reference: p.ref}))}));
    if (fq) await q(db.from('quotes').update({status: 'convertida', sale_id: id}).eq('id', fq));
    toast(V.edit ? 'Venta corregida' : 'Venta registrada'); V.edit = null; await showTicket(id); render();
  });
}

// ---------- Historial de Ventas (con búsqueda, fechas, estado y totales) ----------
async function viewHistVentas() {
  const rows = await q(db.from('ventas_resumen').select('*').order('id', {ascending: false}).limit(200));
  const hoy = caracasDate();
  const ST = {pagada: 'Pagada', pendiente: 'Por cobrar', anulada: 'Anulada'};

  $('#view').innerHTML = `
    <div class="stats" id="vhStats"></div>
    <div class="card stack" style="margin-bottom:.8rem">
      <input id="hQ" type="search" placeholder="Buscar por cliente o N.° de venta..." value="${esc(VH.q)}">
      <div class="chips" id="hF">
        <button type="button" data-f="all" class="${VH.f === 'all' ? 'on' : ''}">Todas</button>
        <button type="button" data-f="pend" class="${VH.f === 'pend' ? 'on' : ''}">Por cobrar</button>
        <button type="button" data-f="pagada" class="${VH.f === 'pagada' ? 'on' : ''}">Pagadas</button>
        <button type="button" data-f="anulada" class="${VH.f === 'anulada' ? 'on' : ''}">Anuladas</button>
      </div>
      <div class="grid">
        <label>Desde<input id="hFrom" type="date" value="${esc(VH.from)}"></label>
        <label>Hasta<input id="hTo" type="date" value="${esc(VH.to)}"></label>
      </div>
      ${VH.q || VH.from || VH.to || VH.f !== 'all' ? '<div class="row" style="margin:0"><button type="button" class="lnk" id="hClr" style="padding:0">Limpiar filtros</button></div>' : ''}
    </div>
    <div class="list" id="hL"></div>`;

  const draw = () => {
    const t = VH.q.trim().toLowerCase();
    const list = rows.filter(r => {
      if (VH.f === 'pend' && r.status !== 'pendiente') return false;
      if (VH.f === 'pagada' && r.status !== 'pagada') return false;
      if (VH.f === 'anulada' && r.status !== 'anulada') return false;
      if (VH.from && r.sale_date && r.sale_date < VH.from) return false;
      if (VH.to && r.sale_date && r.sale_date > VH.to) return false;
      if (!t) return true;
      const hay = `#${r.id} ${r.customer || 'Cliente general'} ${r.sale_date || ''}`.toLowerCase();
      return hay.includes(t);
    });

    const actList = list.filter(r => r.status !== 'anulada');
    const totUsd = actList.reduce((s, r) => s + Number(r.total_usd || 0), 0);
    const totBsHist = actList.reduce((s, r) => s + Number(r.total_usd || 0) * Number(r.exchange_rate || S.rate || 0), 0);
    const pendUsd = actList.filter(r => r.status === 'pendiente').reduce((s, r) => s + Math.max(0, Number(r.total_usd || 0) - Number(r.paid_usd || 0)), 0);

    $('#vhStats').innerHTML = `
      <div class="stat"><span>Total vendido</span><b>${fmt(totUsd)} USD</b><span>${actList.length} ${actList.length === 1 ? 'venta activa' : 'ventas activas'} · ${fmt(totBsHist)} Bs hist.</span></div>
      <div class="stat ${pendUsd > 0.01 ? 'warn' : ''}"><span>Por cobrar</span><b>${fmt(pendUsd)} USD</b><span>${S.rate ? fmt(pendUsd * S.rate) + ' Bs a tasa hoy' : ''}</span></div>`;

    $('#hL').innerHTML = list.map(r => {
      const d = Math.max(0, Number(r.total_usd || 0) - Number(r.paid_usd || 0));
      const isLoc = Number(r.id) < 0;
      const venc = r.status === 'pendiente' && r.due_date && r.due_date < hoy;
      const idLbl = isLoc ? 'LOC-' + Math.abs(r.id) : '#' + r.id;
      const bCls = isLoc ? 'low' : r.status === 'pagada' ? 'ok' : venc ? 'out' : r.status === 'pendiente' ? 'low' : 'out';
      const bTxt = isLoc ? 'Sin subir' : venc ? 'Vencida' : (ST[r.status] || r.status);
      return `<button class="item" data-id="${r.id}">
        <span>
          <b>${idLbl} ${esc(r.customer || 'Cliente general')}</b>
          <small>${dmy(r.sale_date)} | ${r.doc_type === 'factura' ? 'Con IVA' : 'Sin IVA'}${r.due_date && r.status === 'pendiente' ? ' | vence ' + dmy(r.due_date) : ''}</small>
          <small>${r.status === 'pendiente'
            ? 'Debe ' + fmt(d) + ' USD (' + fmt(d * (S.rate || r.exchange_rate)) + ' Bs hoy)'
            : fmt(r.total_usd) + ' USD (' + fmt(r.total_usd * r.exchange_rate) + ' Bs)'}</small>
        </span>
        <span class="badge ${bCls}">${bTxt}</span>
      </button>`;
    }).join('') || '<p class="mut">No hay ventas con ese filtro.</p>';
  };
  draw();

  $('#hQ').oninput = (e) => { VH.q = e.target.value; draw(); };
  $('#hFrom').onchange = (e) => { VH.from = e.target.value; render(); };
  $('#hTo').onchange = (e) => { VH.to = e.target.value; render(); };
  $('#hF').onclick = (e) => { const b = e.target.closest('button'); if (b) { VH.f = b.dataset.f; render(); } };
  if ($('#hClr')) $('#hClr').onclick = () => { VH.f = 'all'; VH.q = ''; VH.from = ''; VH.to = ''; render(); };
  $('#hL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => saleSheet(+b.dataset.id)); };
}

async function saleSheet(id) {
  const d = await saleDetail(id), s = d.s, paid = covered(d), bal = s.total_usd - paid, anul = s.status === 'anulada';
  const canProfit = typeof staffCan === 'function' ? staffCan('ver_ganancias') : S.role !== 'vendedor';
  const canEdit = typeof staffCan === 'function' ? staffCan('anular_corregir') : S.role !== 'vendedor';
  const showBs = S.bimoneda !== false && Number(s.exchange_rate || S.rate || 0) > 0;
  openSheet('Venta ' + (Number(id) < 0 ? 'LOC-' + Math.abs(id) + ' (Sin subir)' : '#' + id), `<p>${esc(s.parties?.name || 'Cliente general')} | ${dmy(s.sale_date)} | ${(s.doc_type === 'factura' || Number(s.tax_usd || 0) > 0) ? 'Con IVA' : 'Sin IVA'}${anul ? ' | <b class="warn">ANULADA</b>' : ''}</p>
    <div class="scroll"><table><thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Total</th></tr></thead><tbody>${d.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${qty(i.quantity)}</td><td class="n">${fmt(i.unit_price_usd)}</td><td class="n">${fmt(i.quantity * i.unit_price_usd)}</td></tr>`).join('')}</tbody></table></div>
    <p>Subtotal ${fmt(s.subtotal_usd)} | Desc. ${fmt(s.discount_usd)} | IVA ${fmt(s.tax_usd)}<br><b>Total ${fmt(s.total_usd)} USD</b>${showBs ? ` (${fmt(s.total_usd * s.exchange_rate)} Bs)` : ''}<br>Pagado ${fmt(paid)} USD${!anul && bal > 0.01 ? ` | <span class="warn">Debe ${fmt(bal)} USD${showBs ? ' (' + fmt(bal * (S.rate || s.exchange_rate)) + ' Bs a la tasa de hoy)' : ''}</span>` : ''}</p>
    ${d.pays.length ? `<p class="mut">${d.pays.map(p => `${METHODS[p.method] || p.method} (${esc(p.accounts?.name || '')}): ${fmt(p.amount)} ${p.currency}`).join('<br>')}</p>` : ''}
    ${canProfit ? profitHtml(d) : ''}
    <div class="row">
      <button class="btn" id="sT">Ticket</button>
      ${!anul && bal > 0.01 ? '<button class="btn" id="sC">Registrar cobro</button>' : ''}
      ${d.items.length ? '<button class="btn ghost" id="sDup">Duplicar</button>' : ''}
      ${!anul && canEdit ? '<button class="btn ghost" id="sE">Corregir</button><button class="btn ghost" id="sR">Devolución</button><button class="btn ghost" id="sA" style="color:var(--bad)">Anular</button>' : ''}
    </div>`);
  $('#sT').onclick = () => run(() => showTicket(id));
  if ($('#sDup')) {
    $('#sDup').onclick = () => {
      V.edit = null;
      V.dup = d;
      SUB.ven = 'nueva';
      closeSheet();
      go('ventas');
      toast('Pedido cargado en una nueva venta');
    };
  }
  if (anul) return;
  if ($('#sR')) $('#sR').onclick = () => run(() => returnForm(id));
  if ($('#sE')) $('#sE').onclick = () => { V.edit = id; SUB.ven = 'nueva'; closeSheet(); go('ventas'); };
  if ($('#sA')) $('#sA').onclick = () => run(async () => {
    if (!confirm('¿Anular esta venta? Se devuelve el inventario y se revierten los cobros.')) return;
    await q(db.rpc('anular_venta', {p_id: id})); closeSheet(); toast('Venta anulada'); render();
  });
  if (bal > 0.01 && $('#sC')) $('#sC').onclick = () => run(() => cobroForm(id, bal, s.parties?.name || 'Cliente general', s.parties?.phone || ''));
}

async function cobroForm(id, bal, customer = 'Cliente general', phone = '') {
  return debtForm({
    title: 'Registrar cobro',
    label: 'Debe el cliente',
    rpc: 'registrar_cobro',
    args: {p_sale_id: id},
    bal,
    customer,
    phone,
    concept: 'Abono a Venta #' + id
  });
}


// ---------- Ticket como foto (se comparte por WhatsApp) y logo ----------
async function ticketBlob(text, set) {
  const wide = set.ticket_paper === '80mm', W = wide ? 576 : 384, ch = wide ? 42 : 32, sc = 2, pad = 16;
  const lines = text.split('\n').flatMap(l => l.length > ch ? l.match(new RegExp('.{1,' + ch + '}', 'g')) : [l]);
  const m = document.createElement('canvas').getContext('2d'); m.font = '20px "Courier New", monospace';
  const fs = Math.floor(20 * (W - pad * 2) / (ch * m.measureText('M').width)), lh = Math.round(fs * 1.4);
  const logo = set.ticket_show_logo && set.logo_data ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = set.logo_data; }) : null;
  const lw = logo ? Math.min(W * 0.6, logo.width) : 0, lg = logo ? lw * logo.height / logo.width : 0, H = pad * 2 + (logo ? lg + 12 : 0) + lines.length * lh;
  const c = document.createElement('canvas'); c.width = W * sc; c.height = H * sc;
  const g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.font = fs + 'px "Courier New", monospace'; g.textBaseline = 'top';
  let y = pad; if (logo) { g.drawImage(logo, (W - lw) / 2, y, lw, lg); y += lg + 12; }
  lines.forEach(t => { g.fillText(t, pad, y); y += lh; });
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear la imagen')), 'image/png'));
}
function downloadBlob(b, n) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = n; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
async function shareImage(blob, phone, name) {
  if (!blob) throw new Error('No se pudo crear la imagen');
  const file = new File([blob], name + '.png', {type: 'image/png'});
  if (navigator.canShare && navigator.canShare({files: [file]})) { try { await navigator.share({files: [file]}); return; } catch (e) { if (e.name === 'AbortError') return; } }
  downloadBlob(blob, name + '.png'); toast('Se descargó la foto. Adjúntala en el chat de WhatsApp.'); window.open('https://wa.me/' + waDigits(phone), '_blank');
}
function logoDataUrl(file, max = 360) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => rej(new Error('No se pudo leer el logo')); img.src = url;
  });
}
