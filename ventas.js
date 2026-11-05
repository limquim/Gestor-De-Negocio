// Ventas: nueva venta o corrección, historial, cobros y ticket
const METHODS = {efectivo: 'Efectivo', pago_movil: 'Pago móvil', transferencia: 'Transferencia', zelle: 'Zelle', punto: 'Punto de venta', otro: 'Otro'};
const DOCS = {nota_entrega: 'Nota de entrega (sin IVA)', factura: 'Factura (con IVA)'};
const V = {cart: [], pays: [], edit: null}, VH = {f: 'all'};
const waDigits = (t) => String(t || '').replace(/\D/g, '').replace(/^0/, '58');
const optList = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

async function vData() {
  const [products, stock, custs, accs] = await Promise.all([
    q(db.from('products').select('id,name,sku,unit,sale_price_usd,taxes(percent)').eq('active', true).order('name')),
    q(db.from('stock_actual').select('product_id,stock')),
    q(db.from('parties').select('id,name,phone').eq('is_customer', true).eq('active', true).order('name')),
    q(db.from('accounts').select('id,name,currency').eq('active', true).order('id'))
  ]);
  return {products, st: Object.fromEntries(stock.map(s => [s.product_id, Number(s.stock)])), custs, accs};
}
async function saleDetail(id) {
  const [s, items, pays] = await Promise.all([
    q(db.from('sales').select('*, parties(name,phone)').eq('id', id).single()),
    q(db.from('sale_items').select('product_id,quantity,unit_price_usd,products(name)').eq('sale_id', id).order('id')),
    q(db.from('payments').select('method,currency,amount,amount_usd,reference,account_id,accounts(name)').eq('sale_id', id).order('id'))
  ]);
  return {s, items: items.map(i => ({...i, name: i.products?.name})), pays};
}

// ---------- Ticket ----------
function ticketText(d, set) {
  const s = d.s, w = set.ticket_paper === '80mm' ? 42 : 32, ln = '-'.repeat(w);
  const two = (a, b) => a + ' '.repeat(Math.max(1, w - a.length - b.length)) + b;
  const paid = d.pays.reduce((a, p) => a + +p.amount_usd, 0), bal = s.total_usd - paid;
  const o = [(set.business_name || 'Mi negocio').toUpperCase(), set.business_rif && 'RIF: ' + set.business_rif, set.business_phone, set.business_address, set.ticket_header].filter(Boolean);
  o.push(ln, (s.doc_type === 'factura' ? 'FACTURA' : 'NOTA DE ENTREGA') + ' #' + s.id, fdate(s.created_at), 'Cliente: ' + (s.parties?.name || 'Cliente general'), ln);
  d.items.forEach(i => o.push(i.name, two(`${qty(i.quantity)} x ${fmt(i.unit_price_usd)}`, fmt(i.quantity * i.unit_price_usd))));
  o.push(ln, two('Subtotal USD', fmt(s.subtotal_usd)));
  if (+s.discount_usd) o.push(two('Descuento', '-' + fmt(s.discount_usd)));
  if (+s.tax_usd) o.push(two('IVA', fmt(s.tax_usd)));
  o.push(two('TOTAL USD', fmt(s.total_usd)), two('TOTAL Bs', fmt(s.total_usd * s.exchange_rate)));
  if (set.ticket_show_rate) o.push('Tasa: ' + fmt(s.exchange_rate, 4) + ' Bs/USD');
  if (d.pays.length) { o.push(ln, 'PAGOS'); d.pays.forEach(p => o.push(two(METHODS[p.method] || p.method, fmt(p.amount) + ' ' + p.currency))); }
  if (bal > 0.01) o.push(two('POR PAGAR USD', fmt(bal)));
  if (set.ticket_footer) o.push(ln, set.ticket_footer);
  return o.join('\n');
}
function printTicket(text, paper) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0'; document.body.appendChild(f);
  f.contentDocument.write(`<pre style="font:12px/1.3 monospace;margin:0;width:${paper === '80mm' ? '80mm' : '58mm'}">${esc(text)}</pre>`); f.contentDocument.close();
  f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000);
}
async function showTicket(id) {
  const [d, set] = await Promise.all([saleDetail(id), q(db.from('settings').select('*').eq('id', 1).single())]);
  const text = ticketText(d, set);
  openSheet('Ticket de venta #' + id, `<pre class="ticket">${esc(text)}</pre><div class="row"><button class="btn" id="tP">Imprimir</button><button class="btn ghost" id="tW">Enviar por WhatsApp</button></div>`);
  $('#tP').onclick = () => printTicket(text, set.ticket_paper);
  $('#tW').onclick = () => window.open(`https://wa.me/${waDigits(d.s.parties?.phone)}?text=${encodeURIComponent(text)}`, '_blank');
}

// ---------- Nueva venta / corrección ----------
async function viewVenta() {
  const D = await vData(), old = V.edit ? await saleDetail(V.edit) : null;
  if (old) old.items.forEach(i => { D.st[i.product_id] = (D.st[i.product_id] || 0) + +i.quantity; });   // el stock vuelve a contar lo ya vendido
  const pm = Object.fromEntries(D.products.map(p => [p.id, p]));
  const line = (pid, qv, pr) => { const p = pm[pid]; return {pid, name: p?.name, unit: p?.unit, qty: qv, price: pr ?? +p?.sale_price_usd, pct: Number(p?.taxes?.percent || 0)}; };
  V.cart = old ? old.items.map(i => line(i.product_id, +i.quantity, +i.unit_price_usd)) : [];
  V.pays = old ? old.pays.map(p => ({acc: p.account_id, method: p.method, amount: +p.amount, ref: p.reference || ''})) : [];

  $('#view').innerHTML = `${V.edit ? `<div class="card title-row"><b>Corrigiendo la venta #${V.edit}</b><button class="lnk" id="vCancel">Cancelar</button></div>` : ''}
  <div class="card stack">
    <div class="row0"><label style="flex:1">Cliente<select id="vCust"><option value="">Cliente general</option>${D.custs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><button class="btn ghost" type="button" id="vNewC" aria-label="Nuevo cliente">+</button></div>
    <label>Documento<select id="vDoc">${optList(DOCS)}</select></label>
    <div class="grid"><label>Tasa (Bs por USD)<input id="vRate" type="number" step="0.0001" min="0.0001"></label><label>Descuento (USD)<input id="vDisc" type="number" step="0.01" min="0" value="0"></label></div></div>
  <div class="card"><h2>Productos</h2><input id="vSearch" type="search" placeholder="Buscar producto o código"><div class="list" id="vRes" style="margin:.5rem 0"></div><div id="vCart"></div></div>
  <div class="card"><h2>Total</h2><div id="vTot"></div></div>
  <div class="card"><h2>Pagos</h2><div id="vPays"></div><div class="row"><button class="btn ghost" type="button" id="vAddPay">Agregar pago</button></div>
    <p id="vBal"></p><label id="vDueW" class="hidden">Fecha límite del saldo<input id="vDue" type="date"></label></div>
  <label>Nota<input id="vNotes"></label>
  <div class="row"><button class="btn" id="vGo">${V.edit ? 'Guardar corrección' : 'Registrar venta'}</button></div>`;
  $('#vRate').value = old ? old.s.exchange_rate : (S.rate || '');
  if (old) { $('#vCust').value = old.s.customer_id || ''; $('#vDoc').value = old.s.doc_type; $('#vDisc').value = old.s.discount_usd; $('#vDue').value = old.s.due_date || ''; $('#vNotes').value = old.s.notes || ''; }

  const calc = () => {
    const rate = +$('#vRate').value || 0, sub = V.cart.reduce((a, c) => a + c.qty * c.price, 0), disc = Math.min(+$('#vDisc').value || 0, sub);
    let tax = $('#vDoc').value === 'factura' ? V.cart.reduce((a, c) => a + c.qty * c.price * c.pct / 100, 0) : 0;
    if (sub > 0) tax *= (sub - disc) / sub;
    return {sub, disc, tax, total: sub - disc + tax, rate};
  };
  const payUsd = (p, rate) => { const a = D.accs.find(x => x.id === +p.acc); return !a ? 0 : a.currency === 'USD' ? p.amount : (rate ? p.amount / rate : 0); };
  const totals = () => {
    const t = calc(), paid = V.pays.reduce((a, p) => a + payUsd(p, t.rate), 0), bal = t.total - paid;
    $('#vTot').innerHTML = `Subtotal: ${fmt(t.sub)} USD${t.disc ? ' | Descuento: -' + fmt(t.disc) : ''}${t.tax ? ' | IVA: ' + fmt(t.tax) : ''}<br><span class="big">${fmt(t.total)} USD</span><br><span class="mut">${fmt(t.total * t.rate)} Bs</span>`;
    $('#vBal').innerHTML = `Pagado: <b>${fmt(paid)} USD</b> | ` + (bal > 0.01 ? `<span class="warn">Queda a crédito: <b>${fmt(bal)} USD</b> (${fmt(bal * t.rate)} Bs)</span>` : bal < -0.01 ? `Vuelto: <b>${fmt(-bal)} USD</b> (${fmt(-bal * t.rate)} Bs)` : 'Pago completo');
    $('#vDueW').classList.toggle('hidden', !(bal > 0.01));
    document.querySelectorAll('#vCart .pl').forEach(l => { const c = V.cart[+l.dataset.i]; l.querySelector('.lt').textContent = 'Total: ' + fmt(c.qty * c.price) + ' USD'; });
    return {...t, paid, bal};
  };
  const drawCart = () => {
    $('#vCart').innerHTML = V.cart.map((c, i) => `<div class="pl" data-i="${i}"><div><b>${esc(c.name)}</b><small>Disponible: ${qty(D.st[c.pid] || 0)} ${esc(c.unit)}</small><small class="lt"></small><button class="lnk bad" data-rm="${i}">Quitar</button></div>
      <div class="stack" style="gap:.3rem"><label>Cant.<input data-f="qty" type="number" step="0.001" min="0.001" value="${c.qty}"></label><label>Precio USD<input data-f="price" type="number" step="0.01" min="0" value="${c.price}"></label></div></div>`).join('') || '<p class="mut">Busca y agrega productos.</p>';
    totals();
  };
  const drawPays = () => {
    $('#vPays').innerHTML = V.pays.map((p, i) => `<div class="stack payl" data-i="${i}">
      <div class="ln2"><label>Cuenta<select data-f="acc">${D.accs.map(a => `<option value="${a.id}" ${a.id === +p.acc ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('')}</select></label>
        <label>Método<select data-f="method">${optList(METHODS, p.method)}</select></label></div>
      <div class="ln2"><label>Monto<input data-f="amount" type="number" step="0.01" min="0" value="${p.amount}"></label><label>Referencia<input data-f="ref" value="${esc(p.ref)}"></label></div>
      <button class="lnk bad" data-rmp="${i}">Quitar pago</button></div>`).join('') || '<p class="mut">Sin pagos: la venta quedará a crédito.</p>';
    totals();
  };
  drawCart(); drawPays();

  $('#vSearch').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase();
    $('#vRes').innerHTML = t ? (D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).slice(0, 6).map(p => `<button class="item" data-add="${p.id}"><span><b>${esc(p.name)}</b><small>${fmt(p.sale_price_usd)} USD | Disponible: ${qty(D.st[p.id] || 0)} ${esc(p.unit)}</small></span><span class="mut">+</span></button>`).join('') || '<p class="mut">Sin resultados.</p>') : '';
  };
  $('#vRes').onclick = (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const id = +b.dataset.add, ex = V.cart.find(c => c.pid === id); ex ? ex.qty++ : V.cart.push(line(id, 1));
    $('#vSearch').value = ''; $('#vRes').innerHTML = ''; drawCart();
  };
  $('#vCart').addEventListener('input', (e) => { const l = e.target.closest('.pl'); if (l && e.target.dataset.f) { V.cart[+l.dataset.i][e.target.dataset.f] = +e.target.value || 0; totals(); } });
  $('#vCart').addEventListener('click', (e) => { if (e.target.dataset.rm !== undefined) { V.cart.splice(+e.target.dataset.rm, 1); drawCart(); } });
  $('#vPays').addEventListener('input', (e) => { const l = e.target.closest('.payl'), f = e.target.dataset.f; if (l && f) { V.pays[+l.dataset.i][f] = f === 'amount' ? +e.target.value || 0 : e.target.value; totals(); } });
  $('#vPays').addEventListener('click', (e) => { if (e.target.dataset.rmp !== undefined) { V.pays.splice(+e.target.dataset.rmp, 1); drawPays(); } });
  ['vRate', 'vDoc', 'vDisc'].forEach(id => $('#' + id).addEventListener('input', totals));
  $('#vAddPay').onclick = () => {
    const t = totals(), a = D.accs[0]; if (!a) return toast('No hay cuentas de pago configuradas', true);
    V.pays.push({acc: a.id, method: 'efectivo', amount: t.bal > 0 ? Math.round(t.bal * (a.currency === 'USD' ? 1 : t.rate) * 100) / 100 : 0, ref: ''}); drawPays();
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
    if (V.cart.some(c => c.qty > (D.st[c.pid] || 0)) && !confirm('Hay productos con inventario insuficiente. ¿Registrar la venta de todos modos?')) return;
    const id = await q(db.rpc('registrar_venta', {p_id: V.edit, p_customer_id: +$('#vCust').value || null, p_doc_type: $('#vDoc').value, p_rate: t.rate, p_discount_usd: t.disc,
      p_due_date: $('#vDue').value || null, p_notes: $('#vNotes').value.trim() || null,
      p_items: V.cart.map(c => ({product_id: c.pid, quantity: c.qty, unit_price_usd: c.price})),
      p_payments: pays.map(p => ({account_id: +p.acc, method: p.method, amount: p.amount, reference: p.ref}))}));
    toast(V.edit ? 'Venta corregida' : 'Venta registrada'); V.edit = null; await showTicket(id); render();
  });
}

// ---------- Historial ----------
async function viewHistVentas() {
  const rows = await q(db.from('ventas_resumen').select('*').order('id', {ascending: false}).limit(80));
  const list = rows.filter(r => VH.f === 'all' || r.status === 'pendiente'), ST = {pagada: 'Pagada', pendiente: 'Por cobrar', anulada: 'Anulada'};
  $('#view').innerHTML = `<div class="chips sub" id="hF"><button data-f="all" class="${VH.f === 'all' ? 'on' : ''}">Todas</button><button data-f="pend" class="${VH.f === 'pend' ? 'on' : ''}">Por cobrar</button></div>
    <div class="list" id="hL">${list.map(r => `<button class="item" data-id="${r.id}"><span><b>#${r.id} ${esc(r.customer || 'Cliente general')}</b>
      <small>${r.sale_date} | ${r.doc_type === 'factura' ? 'Factura' : 'Nota de entrega'}</small>
      <small>${fmt(r.total_usd)} USD (${fmt(r.total_usd * r.exchange_rate)} Bs)${r.status === 'pendiente' ? ' | Debe ' + fmt(r.total_usd - r.paid_usd) + ' USD' : ''}</small></span>
      <span class="badge ${r.status === 'pagada' ? 'ok' : r.status === 'pendiente' ? 'low' : 'out'}">${ST[r.status] || r.status}</span></button>`).join('') || '<p class="mut">No hay ventas en esta lista.</p>'}</div>`;
  $('#hF').onclick = (e) => { const b = e.target.closest('button'); if (b) { VH.f = b.dataset.f; render(); } };
  $('#hL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => saleSheet(+b.dataset.id)); };
}

async function saleSheet(id) {
  const d = await saleDetail(id), s = d.s, paid = d.pays.reduce((a, p) => a + +p.amount_usd, 0), bal = s.total_usd - paid, anul = s.status === 'anulada';
  openSheet('Venta #' + id, `<p>${esc(s.parties?.name || 'Cliente general')} | ${s.sale_date} | ${s.doc_type === 'factura' ? 'Factura' : 'Nota de entrega'}${anul ? ' | <b class="warn">ANULADA</b>' : ''}</p>
    <div class="scroll"><table><thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Total</th></tr></thead><tbody>${d.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${qty(i.quantity)}</td><td class="n">${fmt(i.unit_price_usd)}</td><td class="n">${fmt(i.quantity * i.unit_price_usd)}</td></tr>`).join('')}</tbody></table></div>
    <p>Subtotal ${fmt(s.subtotal_usd)} | Desc. ${fmt(s.discount_usd)} | IVA ${fmt(s.tax_usd)}<br><b>Total ${fmt(s.total_usd)} USD</b> (${fmt(s.total_usd * s.exchange_rate)} Bs)<br>Pagado ${fmt(paid)} USD${!anul && bal > 0.01 ? ` | <span class="warn">Debe ${fmt(bal)} USD</span>` : ''}</p>
    ${d.pays.length ? `<p class="mut">${d.pays.map(p => `${METHODS[p.method] || p.method} (${esc(p.accounts?.name || '')}): ${fmt(p.amount)} ${p.currency}`).join('<br>')}</p>` : ''}
    <div class="row"><button class="btn" id="sT">Ticket</button>${anul ? '' : '<button class="btn ghost" id="sE">Corregir</button><button class="btn ghost" id="sA">Anular</button>'}${!anul && bal > 0.01 ? '<button class="btn" id="sC">Registrar cobro</button>' : ''}</div>`);
  $('#sT').onclick = () => run(() => showTicket(id));
  if (anul) return;
  $('#sE').onclick = () => { V.edit = id; SUB.ven = 'nueva'; closeSheet(); go('ventas'); };
  $('#sA').onclick = () => run(async () => {
    if (!confirm('¿Anular esta venta? Se devuelve el inventario y se revierten los cobros.')) return;
    await q(db.rpc('anular_venta', {p_id: id})); closeSheet(); toast('Venta anulada'); render();
  });
  if (bal > 0.01) $('#sC').onclick = () => run(() => cobroForm(id, bal));
}

async function cobroForm(id, bal) {
  const accs = await q(db.from('accounts').select('id,name,currency').eq('active', true).order('id')), rate = S.rate || 0;
  const amt = (a) => Math.round(bal * (a.currency === 'USD' ? 1 : rate) * 100) / 100;
  openSheet('Registrar cobro', `<form id="cF" class="stack"><p class="mut">Pendiente: ${fmt(bal)} USD. Si cobras en Bs se convierte con la tasa de hoy.</p>
    <label>Cuenta<select name="acc">${accs.map(a => `<option value="${a.id}">${esc(a.name)} (${a.currency})</option>`).join('')}</select></label>
    <label>Método<select name="method">${optList(METHODS)}</select></label>
    <label>Monto<input name="amount" type="number" step="0.01" min="0.01" value="${amt(accs[0])}" required></label>
    <label>Referencia<input name="ref"></label><button class="btn" type="submit">Registrar cobro</button></form>`);
  const el = $('#cF').elements;
  el.acc.onchange = () => { el.amount.value = amt(accs.find(a => String(a.id) === el.acc.value)); };
  $('#cF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await q(db.rpc('registrar_cobro', {p_sale_id: id, p_account_id: +el.acc.value, p_method: el.method.value, p_amount: +el.amount.value, p_reference: el.ref.value.trim() || null}));
      closeSheet(); toast('Cobro registrado'); render();
    });
  };
}
