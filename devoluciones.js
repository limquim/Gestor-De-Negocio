// Devoluciones de ventas, ganancia por venta y métodos de pago administrables
const M_OFF = new Set();
async function loadMethods() {
  try {
    const rows = await q(db.from('payment_methods').select('code,name,active').order('id'));
    if (!rows.length) return;
    Object.keys(METHODS).forEach(k => delete METHODS[k]); M_OFF.clear();
    rows.forEach(r => { METHODS[r.code] = r.name; if (!r.active) M_OFF.add(r.code); });
  } catch (e) { /* si la tabla aún no existe, se usan los métodos por defecto */ }
}

// Lo ya cubierto de una venta: pagos + devoluciones - reembolsos en dinero
const covered = (d) => d.pays.reduce((a, p) => a + +p.amount_usd, 0) + (d.ret || []).reduce((a, r) => a + +r.total_usd - +r.refund_usd, 0);

// Cuánto se ganó en una venta (sin IVA), descontando lo devuelto
function profitHtml(d) {
  const s = d.s; if (s.status === 'anulada') return '';
  const cost = d.items.reduce((a, i) => a + +i.quantity * +(i.unit_cost_usd || 0), 0), rev = +s.subtotal_usd - +s.discount_usd;
  const rit = d.rit || [], rn = rit.reduce((a, r) => a + +r.quantity * +r.unit_price_usd, 0), rc = rit.filter(r => r.restock).reduce((a, r) => a + +r.quantity * +r.unit_cost_usd, 0);
  const net = rev - rn, c = cost - rc, gain = net - c, back = (d.ret || []).reduce((a, r) => a + +r.total_usd, 0);
  return `<div class="gain ${gain >= 0 ? 'pos' : 'neg'}"><span>Ganancia de esta venta</span><b>${fmt(gain)} USD</b>
    <small>${S.rate ? fmt(gain * S.rate) + ' Bs hoy | ' : ''}${net > 0 ? fmt(gain / net * 100, 0) + '% sobre lo vendido' : ''}</small>
    <small class="mut">Vendido ${fmt(net)} USD - costo ${fmt(c)} USD (sin IVA)${back ? ' | Devuelto ' + fmt(back) + ' USD' : ''}</small></div>`;
}

// ---------- Panel de devoluciones ----------
async function viewDevoluciones() {
  const rows = await q(db.from('sale_returns').select('id,sale_id,return_date,reason,total_usd,refund_usd,status,sales(parties(name))').order('id', {ascending: false}).limit(60));
  $('#view').innerHTML = `<div class="list" id="dvL">${rows.map(r => `<button class="item" data-id="${r.id}"><span><b>Devolución #${r.id} | Venta #${r.sale_id}</b>
    <small>${esc(r.sales?.parties?.name || 'Cliente general')} | ${r.return_date}${r.reason ? ' | ' + esc(r.reason) : ''}</small>
    <small>Valor ${fmt(r.total_usd)} USD${+r.refund_usd ? ' | reembolsado ' + fmt(r.refund_usd) + ' USD' : ' | descontado de la deuda'}</small></span>
    <span class="badge ${r.status === 'activa' ? 'low' : 'out'}">${r.status === 'activa' ? 'Registrada' : 'Anulada'}</span></button>`).join('') || '<p class="mut">Aún no hay devoluciones. Pulsa + y escribe el número de la venta, o ábrela desde el Historial.</p>'}</div>
    <button class="fab" id="dvAdd" aria-label="Nueva devolución">+</button>`;
  $('#dvAdd').onclick = () => { const n = prompt('Número de la venta a devolver (ej: 128)'); if (n) run(() => returnForm(+n)); };
  $('#dvL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => returnSheet(+b.dataset.id)); };
}
async function returnSheet(id) {
  const [r, items] = await Promise.all([
    q(db.from('sale_returns').select('*, sales(parties(name))').eq('id', id).single()),
    q(db.from('sale_return_items').select('quantity,unit_price_usd,restock,products(name)').eq('return_id', id))
  ]);
  openSheet('Devolución #' + id, `<p>Venta #${r.sale_id} | ${esc(r.sales?.parties?.name || 'Cliente general')} | ${r.return_date}${r.reason ? '<br>Motivo: ' + esc(r.reason) : ''}</p>
    <div class="scroll"><table><thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Valor</th><th>Destino</th></tr></thead><tbody>${items.map(i => `<tr><td>${esc(i.products?.name)}</td><td class="n">${qty(i.quantity)}</td><td class="n">${fmt(i.quantity * i.unit_price_usd)}</td><td>${i.restock ? 'Inventario' : 'Pérdida'}</td></tr>`).join('')}</tbody></table></div>
    <p><b>Valor de la devolución: ${fmt(r.total_usd)} USD</b> (con IVA)<br>${+r.refund_usd ? 'Reembolsado al cliente: ' + fmt(r.refund_usd) + ' USD' : 'Sin reembolso en dinero: se descontó de lo que el cliente debía'}</p>
    ${r.status === 'activa' ? '<div class="row"><button class="btn ghost" id="dvAnu">Anular devolución</button></div>' : '<p class="warn">Devolución anulada</p>'}`);
  if (r.status === 'activa') $('#dvAnu').onclick = () => run(async () => {
    if (!confirm('¿Anular esta devolución? El inventario y el dinero vuelven a como estaban.')) return;
    await q(db.rpc('anular_devolucion', {p_id: id})); closeSheet(); toast('Devolución anulada'); render();
  });
}

async function returnForm(saleId) {
  const [d, accs, prev] = await Promise.all([
    saleDetail(saleId),
    q(db.from('accounts').select('id,name,currency,methods').eq('active', true).order('id')),
    q(db.from('sale_return_items').select('product_id,quantity,sale_returns!inner(sale_id,status)').eq('sale_returns.sale_id', saleId).eq('sale_returns.status', 'activa'))
  ]);
  const s = d.s; if (s.status === 'anulada') throw new Error('La venta #' + saleId + ' está anulada');
  const ratio = s.subtotal_usd > 0 ? 1 - s.discount_usd / s.subtotal_usd : 1, agg = {};
  d.items.forEach(i => { const a = agg[i.product_id] || (agg[i.product_id] = {pid: i.product_id, name: i.name, sold: 0, val: 0, ret: 0, pct: +i.tax_percent || 0}); a.sold += +i.quantity; a.val += +i.quantity * +i.unit_price_usd; });
  prev.forEach(r => { if (agg[r.product_id]) agg[r.product_id].ret += +r.quantity; });
  const L = Object.values(agg).map(a => ({...a, left: a.sold - a.ret, unit: a.val / a.sold * ratio * (1 + a.pct / 100)}));
  const paid = d.pays.reduce((a, p) => a + +p.amount_usd, 0), refunded = (d.ret || []).reduce((a, r) => a + +r.refund_usd, 0), returned = (d.ret || []).reduce((a, r) => a + +r.total_usd, 0);
  const REASONS = ['Producto dañado o defectuoso', 'Error en el pedido', 'El cliente cambió de opinión', 'Otro'];
  openSheet('Devolución de la venta #' + saleId, `<form id="rF" class="stack"><p class="mut">${esc(s.parties?.name || 'Cliente general')} | total ${fmt(s.total_usd)} USD | pagado ${fmt(paid)} USD</p>
    ${L.map((l, i) => `<div class="pl" data-i="${i}"><div><b>${esc(l.name)}</b><small>Vendido ${qty(l.sold)} | ya devuelto ${qty(l.ret)} | puede devolver ${qty(l.left)}</small>
      <label class="chk"><input type="checkbox" data-r="${i}" checked> Vuelve al inventario</label></div>
      <label>Devolver<input data-q="${i}" type="number" step="0.001" min="0" max="${l.left}" value="0"></label></div>`).join('')}
    <label>Motivo<select name="reason">${REASONS.map(x => `<option>${x}</option>`).join('')}</select></label><label>Nota<input name="notes"></label>
    <div id="rTot"></div>
    <div id="rRef" class="stack hidden"><h2>Reembolso al cliente</h2>
      <label>Devolver desde<select name="acc">${acctOpts(accs)}</select></label><label>Método<select name="method"></select></label>
      <label>Monto<input name="amount" type="number" step="0.01" min="0"></label><label>Referencia<input name="ref"></label></div>
    <button class="btn" type="submit">Registrar devolución</button></form>`);
  const el = $('#rF').elements, rate = S.rate || s.exchange_rate, cur = () => accs.find(a => String(a.id) === el.acc.value).currency;
  const sel = () => L.map((l, i) => ({l, qty: Math.min(+document.querySelector(`[data-q="${i}"]`).value || 0, l.left), restock: document.querySelector(`[data-r="${i}"]`).checked})).filter(x => x.qty > 0);
  const calc = () => {
    const tot = sel().reduce((a, x) => a + x.qty * x.l.unit, 0), due = Math.max(0, paid - refunded - (s.total_usd - (returned + tot)));
    $('#rTot').innerHTML = tot > 0 ? `<p><b>Valor de la devolución: ${fmt(tot)} USD</b> (${fmt(tot * rate)} Bs hoy)<br>${due > 0.01 ? `<span class="warn">Hay que devolverle al cliente ${fmt(due)} USD en dinero.</span>` : 'No hay dinero que devolver: se descuenta de lo que el cliente debe.'}</p>` : '<p class="mut">Escribe cuántas unidades devuelve.</p>';
    $('#rRef').classList.toggle('hidden', !(due > 0.01));
    return {tot, due};
  };
  const fillM = () => { el.method.innerHTML = optList(accMethods(accs.find(a => String(a.id) === el.acc.value))); };
  const fillA = () => { const {due} = calc(); el.amount.value = due > 0.01 ? (due * (cur() === 'USD' ? 1 : rate)).toFixed(2) : ''; };
  fillM(); calc();
  $('#rF').addEventListener('input', (e) => { if (e.target.dataset.q !== undefined || e.target.dataset.r !== undefined) fillA(); });
  el.acc.onchange = () => { fillM(); fillA(); };
  $('#rF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const items = sel(), {due} = calc(); if (!items.length) throw new Error('Escribe cuántas unidades devuelve el cliente');
      const refund = due > 0.01 ? [{account_id: +el.acc.value, method: el.method.value, amount: num(el.amount.value), reference: el.ref.value.trim()}] : [];
      await q(db.rpc('registrar_devolucion', {p_sale_id: saleId, p_items: items.map(x => ({product_id: x.l.pid, quantity: x.qty, restock: x.restock})), p_refund: refund, p_reason: el.reason.value, p_notes: el.notes.value.trim() || null}));
      closeSheet(); toast('Devolución registrada'); render();
    });
  };
}
