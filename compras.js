// Compras: nueva compra (igual que ventas), historial, detalle y pagos a proveedores
const CV = {cart: [], pays: []}, CH = {f: 'all'};
const r2 = (n) => Math.round(n * 100) / 100;

async function cData() {
  const [products, sups, accs] = await Promise.all([
    q(db.from('products').select('id,name,sku,unit,avg_cost_usd,last_cost_usd').eq('active', true).order('name')),
    q(db.from('parties').select('id,name,phone').eq('is_supplier', true).eq('active', true).order('name')),
    q(db.from('accounts').select('id,name,currency,methods').eq('active', true).order('id'))
  ]);
  return {products, sups, accs};
}

async function viewCompra() {
  const D = await cData(), pm = Object.fromEntries(D.products.map(p => [p.id, p]));
  CV.cart = []; CV.pays = [];
  $('#view').innerHTML = `<div class="card stack">
    <div class="row0"><label style="flex:1">Proveedor<select id="cSup"><option value="">Sin proveedor</option>${D.sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><button class="btn ghost" type="button" id="cNewS" aria-label="Nuevo proveedor">+</button></div>
    <div class="grid"><label>Moneda de la factura<select id="cCur"><option value="USD">Dólares (USD)</option><option value="VES">Bolívares (Bs)</option></select></label>
      <label>Tasa (Bs por USD)<input id="cRate" type="number" step="0.0001" min="0.0001"></label></div></div>
  <div class="card"><h2>Productos</h2><input id="cSearch" type="search" placeholder="Buscar producto o código"><div class="list" id="cRes" style="margin:.5rem 0"></div><div id="cCart"></div></div>
  <div class="card"><h2>Total</h2><div id="cTot"></div></div>
  <div class="card"><h2>Pagos</h2><div id="cPays"></div><div class="row"><button class="btn ghost" type="button" id="cAddPay">Agregar pago</button></div>
    <p id="cBal"></p><label id="cDueW" class="hidden">Fecha límite del saldo<input id="cDue" type="date"></label></div>
  <label>Nota o N.° de factura<input id="cNotes"></label>
  <div class="row"><button class="btn" id="cGo">Registrar compra</button></div>`;
  $('#cRate').value = S.rate || '';
  let pcur = 'USD';
  const cur = () => $('#cCur').value, rate = () => +$('#cRate').value || 0;
  const inUsd = (v) => cur() === 'USD' ? v : (rate() ? v / rate() : 0);
  const payUsd = (p) => { const a = D.accs.find(x => x.id === +p.acc); return !a ? 0 : a.currency === 'USD' ? p.amount : (rate() ? p.amount / rate() : 0); };
  const line = (pid) => { const p = pm[pid], u = +p.last_cost_usd || +p.avg_cost_usd || 0; return {pid, name: p.name, unit: p.unit, qty: 1, cost: r2(cur() === 'USD' ? u : u * rate())}; };
  const totals = () => {
    const tot = CV.cart.reduce((a, c) => a + c.qty * inUsd(c.cost), 0), paid = CV.pays.reduce((a, p) => a + payUsd(p), 0), bal = tot - paid, rt = rate();
    $('#cTot').innerHTML = `<span class="big">${fmt(tot)} USD</span><br><span class="mut">${fmt(tot * rt)} Bs a la tasa indicada</span>`;
    $('#cBal').innerHTML = `Pagado: <b>${fmt(paid)} USD</b> | ` + (bal > 0.01 ? `<span class="warn">Queda por pagar: <b>${fmt(bal)} USD</b> (${fmt(bal * rt)} Bs)</span>` : bal < -0.01 ? `<span class="warn">El pago supera el total por ${fmt(-bal)} USD</span>` : 'Pago completo');
    $('#cDueW').classList.toggle('hidden', !(bal > 0.01));
    document.querySelectorAll('#cCart .pl').forEach(l => { const c = CV.cart[+l.dataset.i]; l.querySelector('.lt').textContent = 'Total: ' + fmt(c.qty * c.cost) + (cur() === 'USD' ? ' USD' : ' Bs'); });
    document.querySelectorAll('#cPays .payl').forEach(l => { const u = payUsd(CV.pays[+l.dataset.i]); l.querySelector('.eq').textContent = '≈ ' + fmt(u) + ' USD | ' + fmt(u * rt) + ' Bs'; });
    return {tot, paid, bal};
  };
  const drawCart = () => {
    $('#cCart').innerHTML = CV.cart.map((c, i) => `<div class="pl" data-i="${i}"><div><b>${esc(c.name)}</b><small class="lt"></small><button class="lnk bad" data-rm="${i}">Quitar</button></div>
      <div class="stack" style="gap:.3rem"><label>Cant. (${esc(c.unit)})<input data-f="qty" type="number" step="0.001" min="0.001" value="${c.qty}"></label>
      <label>Costo (${cur() === 'USD' ? 'USD' : 'Bs'})<input data-f="cost" type="number" step="0.01" min="0" value="${c.cost}"></label></div></div>`).join('') || '<p class="mut">Busca y agrega productos.</p>';
    totals();
  };
  const drawPays = () => {
    $('#cPays').innerHTML = CV.pays.map((p, i) => `<div class="stack payl" data-i="${i}">
      <div class="ln2"><label>Cuenta<select data-f="acc">${acctOpts(D.accs, p.acc)}</select></label><label>Método<select data-f="method">${optList(accMethods(D.accs.find(x => x.id === +p.acc)), p.method)}</select></label></div>
      <div class="ln2"><label>Monto<input data-f="amount" type="number" step="0.01" min="0" value="${p.amount}"></label><label>Referencia<input data-f="ref" value="${esc(p.ref)}"></label></div>
      <small class="mut eq"></small><button class="lnk bad" data-rmp="${i}">Quitar pago</button></div>`).join('') || '<p class="mut">Sin pagos: la compra quedará por pagar.</p>';
    totals();
  };
  (CV.pre || []).forEach(x => { if (pm[x.pid]) { const l = line(x.pid); l.qty = x.qty; CV.cart.push(l); } }); CV.pre = null;
  drawCart(); drawPays();

  $('#cSearch').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase();
    $('#cRes').innerHTML = t ? (D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).slice(0, 6).map(p => `<button class="item" data-add="${p.id}"><span><b>${esc(p.name)}</b><small>Último costo: ${fmt(p.last_cost_usd || p.avg_cost_usd)} USD</small></span><span class="mut">+</span></button>`).join('') || '<p class="mut">Sin resultados.</p>') : '';
  };
  $('#cRes').onclick = (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const id = +b.dataset.add, ex = CV.cart.find(c => c.pid === id); if (ex) ex.qty++; else CV.cart.push(line(id));
    $('#cSearch').value = ''; $('#cRes').innerHTML = ''; drawCart();
  };
  $('#cCart').addEventListener('input', (e) => { const l = e.target.closest('.pl'); if (l && e.target.dataset.f) { CV.cart[+l.dataset.i][e.target.dataset.f] = +e.target.value || 0; totals(); } });
  $('#cCart').addEventListener('click', (e) => { if (e.target.dataset.rm !== undefined) { CV.cart.splice(+e.target.dataset.rm, 1); drawCart(); } });
  $('#cPays').addEventListener('input', (e) => {
    const l = e.target.closest('.payl'), f = e.target.dataset.f; if (!l || !f) return;
    const p = CV.pays[+l.dataset.i];
    if (f === 'acc') {   // al cambiar de cuenta, el monto se convierte con la tasa (USD <-> Bs)
      const usd = payUsd(p), a = D.accs.find(x => x.id === +e.target.value);
      p.acc = a.id; p.amount = r2(usd * (a.currency === 'USD' ? 1 : rate())); const al = accMethods(a); if (!al[p.method]) p.method = Object.keys(al)[0]; drawPays(); return;
    }
    p[f] = f === 'amount' ? +e.target.value || 0 : e.target.value; totals();
  });
  $('#cPays').addEventListener('click', (e) => { if (e.target.dataset.rmp !== undefined) { CV.pays.splice(+e.target.dataset.rmp, 1); drawPays(); } });
  $('#cCur').onchange = () => {   // al cambiar la moneda de la factura, los costos se convierten con la tasa
    const nc = cur(); if (nc !== pcur) { CV.cart.forEach(c => { c.cost = r2(nc === 'VES' ? c.cost * rate() : (rate() ? c.cost / rate() : c.cost)); }); pcur = nc; }
    drawCart();
  };
  $('#cRate').addEventListener('input', totals);
  $('#cAddPay').onclick = () => {
    const t = totals(), a = D.accs[0]; if (!a) return toast('No hay cuentas de pago configuradas', true);
    CV.pays.push({acc: a.id, method: Object.keys(accMethods(a))[0], amount: t.bal > 0 ? r2(t.bal * (a.currency === 'USD' ? 1 : rate())) : 0, ref: ''}); drawPays();
  };
  $('#cNewS').onclick = () => run(async () => {
    const name = prompt('Nombre del proveedor'); if (!name) return;
    const s = await q(db.from('parties').insert({name: name.trim(), phone: prompt('Teléfono (opcional)') || null, is_supplier: true, is_customer: false}).select('id').single());
    $('#cSup').insertAdjacentHTML('beforeend', `<option value="${s.id}">${esc(name)}</option>`); $('#cSup').value = s.id;
  });
  $('#cGo').onclick = () => run(async () => {
    if (!CV.cart.length) throw new Error('Agrega al menos un producto');
    const t = totals(); if (t.paid > t.tot + 0.01) throw new Error('El pago supera el total de la compra. Ajusta los montos.');
    const id = await q(db.rpc('registrar_compra', {p_supplier_id: +$('#cSup').value || null, p_currency: cur(), p_rate: rate(), p_notes: $('#cNotes').value.trim() || null,
      p_items: CV.cart.map(c => ({product_id: c.pid, quantity: c.qty, unit_cost: c.cost}))}));
    let perr = null;
    try { for (const p of CV.pays.filter(x => +x.amount > 0)) await q(db.rpc('registrar_pago_compra', {p_purchase_id: id, p_account_id: +p.acc, p_method: p.method, p_amount: +p.amount, p_reference: p.ref || null, p_rate: rate()})); }
    catch (e) { perr = e.message || 'error desconocido'; }
    if ($('#cDue').value) await q(db.from('purchases').update({due_date: $('#cDue').value}).eq('id', id));
    if (perr) toast('Compra #' + id + ' registrada, pero un pago falló: ' + perr + '. Revísalo en el historial.', true);
    else toast('Compra #' + id + ' registrada' + (t.bal > 0.01 ? ' (queda por pagar)' : ' y pagada') + '. Stock y costos actualizados.');
    render();
  });
}

// ---------- Historial ----------
async function viewHistCompras() {
  const rows = await q(db.from('compras_resumen').select('*').order('id', {ascending: false}).limit(80));
  const list = rows.filter(r => CH.f === 'all' || r.status === 'registrada'), ST = {pagada: 'Pagada', registrada: 'Por pagar', anulada: 'Anulada'};
  $('#view').innerHTML = `<div class="chips sub" id="chF"><button data-f="all" class="${CH.f === 'all' ? 'on' : ''}">Todas</button><button data-f="pend" class="${CH.f === 'pend' ? 'on' : ''}">Por pagar</button></div>
    <div class="list" id="chL">${list.map(r => { const d = r.total_usd - r.paid_usd; return `<button class="item" data-id="${r.id}"><span><b>#${r.id} ${esc(r.supplier || 'Sin proveedor')}</b><small>${r.purchase_date}${r.due_date ? ' | vence ' + r.due_date : ''}</small>
      <small>${r.status === 'registrada' ? 'Debes ' + fmt(d) + ' USD (' + fmt(d * (S.rate || r.exchange_rate)) + ' Bs hoy)' : fmt(r.total_usd) + ' USD (' + fmt(r.total_usd * r.exchange_rate) + ' Bs)'}</small></span>
      <span class="badge ${r.status === 'pagada' ? 'ok' : r.status === 'registrada' ? 'low' : 'out'}">${ST[r.status] || r.status}</span></button>`; }).join('') || '<p class="mut">No hay compras en esta lista.</p>'}</div>`;
  $('#chF').onclick = (e) => { const b = e.target.closest('button'); if (b) { CH.f = b.dataset.f; render(); } };
  $('#chL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => purchaseSheet(+b.dataset.id)); };
}

async function purchaseSheet(id) {
  const [b, items, pays] = await Promise.all([
    q(db.from('purchases').select('*, parties(name)').eq('id', id).single()),
    q(db.from('purchase_items').select('quantity,unit_cost_usd,products(name)').eq('purchase_id', id)),
    q(db.from('payments').select('method,currency,amount,amount_usd,exchange_rate,accounts(name)').eq('purchase_id', id).order('id'))
  ]);
  const paid = pays.reduce((a, p) => a + +p.amount_usd, 0), bal = b.total_usd - paid, open = b.status !== 'anulada' && bal > 0.01;
  openSheet('Compra #' + id, `<p>${esc(b.parties?.name || 'Sin proveedor')} | ${b.purchase_date}${b.due_date ? ' | vence ' + b.due_date : ''}</p>
    <div class="scroll"><table><thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Costo USD</th></tr></thead><tbody>${items.map(i => `<tr><td>${esc(i.products?.name)}</td><td class="n">${qty(i.quantity)}</td><td class="n">${fmt(i.unit_cost_usd)}</td></tr>`).join('')}</tbody></table></div>
    <p><b>Total ${fmt(b.total_usd)} USD</b> (${fmt(b.total_usd * b.exchange_rate)} Bs a la tasa de la compra)<br>Pagado ${fmt(paid)} USD${open ? `<br><span class="warn">Debes ${fmt(bal)} USD (${fmt(bal * (S.rate || b.exchange_rate))} Bs a la tasa de hoy)</span>` : ''}</p>
    ${pays.length ? `<p class="mut">${pays.map(p => `${METHODS[p.method] || p.method} (${esc(p.accounts?.name)}): ${fmt(p.amount)} ${p.currency === 'USD' ? 'USD' : 'Bs'} a tasa ${fmt(p.exchange_rate, 2)}`).join('<br>')}</p>` : ''}
    ${open ? '<div class="row"><button class="btn" id="pcPay">Registrar pago</button></div>' : ''}`);
  if (open) $('#pcPay').onclick = () => run(() => debtForm({title: 'Registrar pago', label: 'Debes', rpc: 'registrar_pago_compra', args: {p_purchase_id: id}, bal}));
}

// ---------- Cobro o pago de una deuda: queda en USD y se convierte con la tasa del día de pago ----------
async function debtForm(cfg) {
  const accs = await q(db.from('accounts').select('id,name,currency,methods').eq('active', true).order('id')), bal = cfg.bal;
  openSheet(cfg.title, `<form id="dF" class="stack"><p>${cfg.label}: <b>${fmt(bal)} USD</b> (${fmt(bal * (S.rate || 0))} Bs a la tasa de hoy)<br>
    <span class="mut">El precio en dólares no cambia. Lo que se paga en Bs depende de la tasa del día del pago; puedes modificarla.</span></p>
    <label>Cuenta<select name="acc">${acctOpts(accs)}</select></label>
    <label>Tasa de cambio (Bs por USD)<input name="rate" type="number" step="0.0001" min="0.0001" value="${S.rate || ''}"></label>
    <label>Método<select name="method"></select></label>
    <label>Monto<input name="amount" type="number" step="0.01" min="0.01" required></label><p class="mut" id="dEq"></p>
    <label>Referencia<input name="ref"></label><button class="btn" type="submit">${cfg.title}</button></form>`);
  const el = $('#dF').elements, cur = () => accs.find(a => String(a.id) === el.acc.value).currency;
  const eq = () => { const r = +el.rate.value || 0, a = num(el.amount.value) || 0, usd = cur() === 'USD' ? a : (r ? a / r : 0); $('#dEq').textContent = `Equivale a ${fmt(usd)} USD | quedaría debiendo ${fmt(Math.max(bal - usd, 0))} USD`; };
  const full = () => { el.amount.value = (bal * (cur() === 'USD' ? 1 : (+el.rate.value || 0))).toFixed(2); eq(); };
  const fillM = () => { el.method.innerHTML = optList(accMethods(accs.find(a => String(a.id) === el.acc.value))); };
  fillM(); full(); let pf = cur() === 'USD' ? 1 : (+el.rate.value || 0);
  const conv = () => { const nf = cur() === 'USD' ? 1 : (+el.rate.value || 0), usd = pf ? (num(el.amount.value) || 0) / pf : bal; pf = nf; el.amount.value = (usd * nf).toFixed(2); eq(); };
  el.acc.onchange = () => { fillM(); conv(); }; el.rate.oninput = conv; el.amount.oninput = eq;
  $('#dF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await q(db.rpc(cfg.rpc, {...cfg.args, p_account_id: +el.acc.value, p_method: el.method.value, p_amount: num(el.amount.value), p_reference: el.ref.value.trim() || null, p_rate: +el.rate.value || null}));
      closeSheet(); toast('Registrado'); render();
    });
  };
}

