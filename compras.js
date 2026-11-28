// Compras: nueva compra o modificación, historial con filtros, anulación y pagos a proveedores
const CV = {cart: [], pays: [], edit: null}, CH = {f: 'all', q: '', from: '', to: ''};
const r2 = (n) => Math.round(n * 100) / 100;

async function cData() {
  const [products, sups, accs, taxes] = await Promise.all([
    q(db.from('products').select('id,name,sku,unit,avg_cost_usd,last_cost_usd,is_combo').eq('active', true).order('name')).then(list => list.filter(p => !p.is_combo)),
    q(db.from('parties').select('id,name,phone').eq('is_supplier', true).eq('active', true).order('name')),
    loadActiveAccounts(),
    db.from('taxes').select('percent').eq('active', true).then(r => r.error ? [] : (r.data || []))
  ]);
  const defIva = Number((taxes || []).find(t => Number(t.percent) > 0)?.percent || 16);
  return {products, sups, accs, defIva};
}

async function purchaseDetail(id) {
  const [b, items, pays] = await Promise.all([
    q(db.from('purchases').select('*, parties(name,phone)').eq('id', id).single()),
    q(db.from('purchase_items').select('product_id,quantity,unit_cost_usd,products(name,unit)').eq('purchase_id', id).order('id')),
    q(db.from('payments').select('account_id,method,currency,amount,amount_usd,exchange_rate,reference,accounts(name)').eq('purchase_id', id).order('id'))
  ]);
  return {b, items, pays};
}

async function viewCompra() {
  if (CV.pre && CV.pre.length) CV.edit = null;
  const D = await cData(), pm = Object.fromEntries(D.products.map(p => [p.id, p]));
  const old = CV.edit ? await purchaseDetail(CV.edit) : null;
  if (old && old.b.status === 'anulada') {
    toast('No se puede modificar una compra anulada', true);
    CV.edit = null;
  }
  const editing = old && old.b.status !== 'anulada';
  const initCur = editing ? (old.b.currency || 'USD') : 'USD';
  const initRate = editing ? (+old.b.exchange_rate || S.rate || 1) : (S.rate || '');
  const line = (pid, qv = 1, costInCur = null) => {
    const p = pm[pid], u = +p?.last_cost_usd || +p?.avg_cost_usd || 0;
    const rt = Number($('#cRate')?.value || initRate || S.rate || 0);
    const cDef = initCur === 'USD' ? u : u * rt;
    return {pid, name: p?.name || ('Producto #' + pid), unit: p?.unit || 'und', qty: qv, cost: costInCur != null ? costInCur : r2(cDef)};
  };

  CV.cart = editing
    ? old.items.map(i => {
        const cVal = initCur === 'VES' ? r2(+i.unit_cost_usd * (+old.b.exchange_rate || 1)) : r2(+i.unit_cost_usd);
        return {pid: i.product_id, name: i.products?.name || pm[i.product_id]?.name || ('Producto #' + i.product_id), unit: i.products?.unit || pm[i.product_id]?.unit || 'und', qty: +i.quantity, cost: cVal};
      })
    : [];
  CV.pays = editing
    ? old.pays.map(p => ({acc: p.account_id, method: p.method || 'efectivo', amount: +p.amount, ref: p.reference || ''}))
    : [];
  const origPaysSnap = JSON.stringify(CV.pays);
  const openingNoItems = editing && old.items.length === 0;

  $('#view').innerHTML = `${editing ? `<div class="card title-row"><b>Corrigiendo la compra #${CV.edit}</b><button class="lnk" id="cCancel">Cancelar</button></div>` : ''}
  <div class="card stack">
    <div class="row0"><label style="flex:1">Proveedor<select id="cSup"><option value="">Sin proveedor</option>${D.sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}${editing && old.b.supplier_id && !D.sups.some(s => String(s.id) === String(old.b.supplier_id)) ? `<option value="${old.b.supplier_id}">${esc(old.b.parties?.name || ('Proveedor #' + old.b.supplier_id))}</option>` : ''}</select></label><button class="btn ghost" type="button" id="cNewS" aria-label="Nuevo proveedor">+</button></div>
    <div class="grid">
      ${editing ? `<label>Fecha de compra<input id="cDate" type="date" value="${esc(old.b.purchase_date || caracasDate())}"></label>` : ''}
      <label class="${S.bimoneda === false ? 'hidden' : ''}">Moneda de la factura<select id="cCur"><option value="USD">Moneda principal (${esc(curLabel())})</option><option value="VES">Bolívares (${esc(secSym())})</option></select></label>
      <label class="${S.bimoneda === false ? 'hidden' : ''}">Tasa (${esc(secSym())} por ${esc(curLabel())})<input id="cRate" type="number" step="0.0001" min="0.0001"></label>
    </div>
    <div class="row0" style="justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.45rem .65rem;background:var(--bg);border:1px solid var(--line);border-radius:10px">
      <label class="chk" style="margin:0"><input type="checkbox" id="cIva"> <b>Aplicar IVA a esta compra</b></label>
      <label id="cIvaPctW" class="row0 hidden" style="margin:0;gap:.35rem">
        <span class="mut" style="font-size:.82rem">% IVA:</span>
        <input id="cIvaPct" type="number" step="0.5" min="0" max="100" value="${D.defIva}" style="width:4.8rem;min-height:36px;margin:0;padding:.25rem .45rem;text-align:right">
      </label>
    </div>
  </div>
  <div class="card"><h2>Productos</h2>
    ${openingNoItems ? '<p class="mut" style="margin:0 0 .5rem">Esta compra viene de saldo inicial (sin detalle de artículos). Puedes modificar sus datos arriba o agregar productos.</p>' : ''}
    <div class="scan-row"><input id="cSearch" type="search" placeholder="Buscar producto o escanear código"><button type="button" class="icon-btn scan-btn" id="cScan" title="Escanear código de barras" aria-label="Escanear código de barras">${SCAN_ICO}</button></div><div class="list" id="cRes" style="margin:.5rem 0"></div><div id="cCart"></div>
  </div>
  <div class="card"><h2>Total</h2><div id="cTot"></div></div>
  <div class="card"><h2>Pagos</h2><div id="cPays"></div><div class="row"><button class="btn ghost" type="button" id="cAddPay">Agregar pago</button></div>
    <p id="cBal"></p><label id="cDueW" class="hidden">Fecha límite del saldo<input id="cDue" type="date"></label></div>
  <label>Nota o N.° de factura<input id="cNotes"></label>
  <div class="row"><button class="btn" id="cGo">${editing ? 'Guardar corrección' : 'Registrar compra'}</button></div>`;

  $('#cCur').value = initCur;
  $('#cRate').value = S.bimoneda === false ? 1 : initRate;
  if (editing) {
    $('#cSup').value = old.b.supplier_id || '';
    $('#cDue').value = old.b.due_date || '';
    $('#cNotes').value = old.b.notes || '';
    $('#cIva').checked = !!old.b.apply_iva || Number(old.b.tax_usd || 0) > 0;
    if (Number(old.b.iva_percent || 0) > 0) $('#cIvaPct').value = Number(old.b.iva_percent);
  }
  const syncCIva = () => { $('#cIvaPctW').classList.toggle('hidden', !$('#cIva').checked); };
  syncCIva();

  let pcur = initCur;
  const cur = () => $('#cCur').value, rate = () => +$('#cRate').value || 0;
  const inUsd = (v) => cur() === 'USD' ? v : (rate() ? v / rate() : 0);
  const payUsd = (p) => { const a = D.accs.find(x => x.id === +p.acc); return !a ? 0 : a.currency === 'USD' ? p.amount : (rate() ? p.amount / rate() : 0); };
  const newLine = (pid) => { const p = pm[pid], u = +p.last_cost_usd || +p.avg_cost_usd || 0; return {pid, name: p.name, unit: p.unit, qty: 1, cost: r2(cur() === 'USD' ? u : u * rate())}; };

  const totals = () => {
    const cartSub = CV.cart.reduce((a, c) => a + c.qty * inUsd(c.cost), 0);
    const ivaOn = $('#cIva').checked, ivaPct = ivaOn ? Math.max(0, +$('#cIvaPct').value || 0) : 0;
    const tax = (openingNoItems && !CV.cart.length) ? 0 : (ivaOn ? cartSub * ivaPct / 100 : 0);
    const tot = (openingNoItems && !CV.cart.length) ? +old.b.total_usd : (cartSub + tax);
    const paid = CV.pays.reduce((a, p) => a + payUsd(p), 0), bal = tot - paid, rt = rate();
    $('#cTot').innerHTML = `${ivaOn ? `Subtotal: ${fmtCur(cartSub)} | IVA (${qty(ivaPct)}%): ${fmtCur(tax)}<br>` : ''}<span class="big">${fmtCur(tot)}</span><br><span class="mut">${fmt(tot * rt)} Bs a la tasa indicada${ivaOn ? ' · El IVA se prorratea al costo real en inventario' : ''}</span>`;
    $('#cBal').innerHTML = `Pagado: <b>${fmtCur(paid)}</b> | ` + (bal > 0.01 ? `<span class="warn">Queda por pagar: <b>${fmtCur(bal)}</b> (${fmt(bal * rt)} Bs)</span>` : bal < -0.01 ? `<span class="warn">El pago supera el total por ${fmtCur(-bal)}</span>` : 'Pago completo');
    $('#cDueW').classList.toggle('hidden', !(bal > 0.01));
    document.querySelectorAll('#cCart .pl').forEach(l => { const c = CV.cart[+l.dataset.i]; l.querySelector('.lt').textContent = 'Total: ' + (cur() === 'USD' ? fmtCur(c.qty * c.cost) : fmtSec(c.qty * c.cost)); });
    document.querySelectorAll('#cPays .payl').forEach(l => {
      const p = CV.pays[+l.dataset.i], a = D.accs.find(x => x.id === +p.acc), u = payUsd(p);
      l.querySelector('.eq').textContent = '≈ ' + fmtCur(u) + (S.bimoneda !== false ? ' | ' + fmtSec(u * rt) : '');
      const bl = l.querySelector('.abal');
      if (bl) bl.innerHTML = accBalanceLine(a, p.amount, true);
    });
    return {sub: cartSub, tax, ivaOn, ivaPct, tot, paid, bal};
  };
  const drawCart = () => {
    $('#cCart').innerHTML = CV.cart.map((c, i) => `<div class="pl" data-i="${i}"><div><b>${esc(c.name)}</b><small class="lt"></small><button class="lnk bad" data-rm="${i}">Quitar</button></div>
      <div class="stack" style="gap:.3rem"><label>Cant. (${esc(c.unit)})<input data-f="qty" type="number" step="0.001" min="0.001" value="${c.qty}"></label>
      <label>Costo (${cur() === 'USD' ? esc(curLabel()) : esc(secSym())})<input data-f="cost" type="number" step="0.01" min="0" value="${c.cost}"></label></div></div>`).join('') || (openingNoItems ? '<p class="mut">Sin artículos detallados (mantiene el monto inicial).</p>' : '<p class="mut">Busca y agrega productos.</p>');
    totals();
  };
  const drawPays = () => {
    $('#cPays').innerHTML = CV.pays.map((p, i) => `<div class="stack payl" data-i="${i}">
      <div class="ln2"><label>Cuenta<select data-f="acc">${acctOpts(D.accs, p.acc)}</select></label><label>Método<select data-f="method">${optList(accMethods(D.accs.find(x => x.id === +p.acc)), p.method)}</select></label></div>
      <small class="abal" style="display:block;margin-top:-.3rem"></small>
      <div class="ln2"><label>Monto<input data-f="amount" type="number" step="0.01" min="0" value="${p.amount}"></label><label>Referencia<input data-f="ref" value="${esc(p.ref)}"></label></div>
      <small class="mut eq"></small><button class="lnk bad" data-rmp="${i}">Quitar pago</button></div>`).join('') || '<p class="mut">Sin pagos: la compra quedará por pagar.</p>';
    totals();
  };
  if (!editing) {
    (CV.pre || []).forEach(x => { if (pm[x.pid]) { const l = newLine(x.pid); l.qty = x.qty; CV.cart.push(l); } });
    CV.pre = null;
  }
  drawCart(); drawPays();

  if ($('#cCancel')) $('#cCancel').onclick = () => { CV.edit = null; render(); };

  $('#cSearch').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase();
    $('#cRes').innerHTML = t ? (D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).slice(0, 6).map(p => `<button class="item" data-add="${p.id}"><span><b>${esc(p.name)}</b><small>Último costo: ${fmtCur(p.last_cost_usd || p.avg_cost_usd)}</small></span><span class="mut">+</span></button>`).join('') || '<p class="mut">Sin resultados.</p>') : '';
  };
  const addCompraByCode = (code) => {
    const p = findBySku(D.products, code);
    if (!p) return {ok: false, msg: 'Código no registrado: ' + code};
    const ex = CV.cart.find(c => c.pid === p.id);
    if (ex) ex.qty = Math.round((ex.qty + 1) * 1000) / 1000;
    else CV.cart.push(newLine(p.id));
    drawCart();
    const curQ = CV.cart.find(c => c.pid === p.id)?.qty || 1;
    return {ok: true, msg: `${p.name} (x${qty(curQ)})`};
  };
  $('#cScan').onclick = () => openScanner({
    title: 'Escanear para compra',
    continuous: true,
    allowContinuous: true,
    onCode: addCompraByCode
  });
  bindEnterSku($('#cSearch'), (code) => {
    const r = addCompraByCode(code);
    if (r.ok) { scanBeep(true); toast(r.msg); $('#cSearch').value = ''; $('#cRes').innerHTML = ''; return true; }
    return false;
  });
  $('#cRes').onclick = (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const id = +b.dataset.add, ex = CV.cart.find(c => c.pid === id); if (ex) ex.qty++; else CV.cart.push(newLine(id));
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
  $('#cIvaPct').addEventListener('input', totals);
  $('#cIva').addEventListener('change', () => { syncCIva(); totals(); });
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
    if (!CV.cart.length && !openingNoItems) throw new Error('Agrega al menos un producto');
    const t = totals();
    if (t.paid > t.tot + 0.01) throw new Error('El pago supera el total de la compra. Ajusta los montos en la sección Pagos.');
    const cleanPays = CV.pays.filter(x => +x.amount > 0).map(p => ({account_id: +p.acc, method: p.method, amount: +p.amount, reference: p.ref || null}));

    if (editing) {
      const paysChanged = JSON.stringify(CV.pays) !== origPaysSnap;
      try {
        await q(db.rpc('actualizar_compra', {
          p_id: CV.edit,
          p_supplier_id: +$('#cSup').value || null,
          p_currency: cur(),
          p_rate: rate(),
          p_due_date: $('#cDue').value || null,
          p_notes: $('#cNotes').value.trim() || null,
          p_items: CV.cart.map(c => ({product_id: c.pid, quantity: c.qty, unit_cost: c.cost})),
          p_purchase_date: $('#cDate')?.value || old.b.purchase_date || null,
          p_apply_iva: t.ivaOn,
          p_iva_percent: t.ivaOn ? t.ivaPct : 0,
          p_replace_payments: paysChanged,
          p_payments: paysChanged ? cleanPays : []
        }));
      } catch (err) {
        if (err.code === 'PGRST202' || /actualizar_compra/i.test(err.message || '')) {
          throw new Error('No se pudo completar la operación en esta compra.');
        }
        throw err;
      }
      const editedId = CV.edit;
      CV.edit = null;
      toast('Compra #' + editedId + ' modificada. Stock, costos y saldos actualizados.');
      SUB.com = 'historial';
      render();
      return;
    }

    const id = await q(db.rpc('registrar_compra', {p_supplier_id: +$('#cSup').value || null, p_currency: cur(), p_rate: rate(), p_apply_iva: t.ivaOn, p_iva_percent: t.ivaOn ? t.ivaPct : 0, p_notes: $('#cNotes').value.trim() || null,
      p_items: CV.cart.map(c => ({product_id: c.pid, quantity: c.qty, unit_cost: c.cost}))}));
    let perr = null;
    try { for (const p of cleanPays) await q(db.rpc('registrar_pago_compra', {p_purchase_id: id, p_account_id: p.account_id, p_method: p.method, p_amount: p.amount, p_reference: p.reference, p_rate: rate()})); }
    catch (e) { perr = e.message || 'error desconocido'; }
    if ($('#cDue').value) await q(db.from('purchases').update({due_date: $('#cDue').value}).eq('id', id));
    if (perr) toast('Compra #' + id + ' registrada, pero un pago falló: ' + perr + '. Revísalo en el historial.', true);
    else toast('Compra #' + id + ' registrada' + (t.bal > 0.01 ? ' (queda por pagar)' : ' y pagada') + '. Stock y costos actualizados.');
    render();
  });
}

// ---------- Historial de Compras (con búsqueda, fechas, estado y totales) ----------
async function viewHistCompras() {
  const rows = await q(db.from('compras_resumen').select('*').order('id', {ascending: false}).limit(200));
  const hoy = caracasDate();
  const ST = {pagada: 'Pagada', registrada: 'Por pagar', anulada: 'Anulada'};

  $('#view').innerHTML = `
    <div class="stats" id="chStats"></div>
    <div class="card stack" style="margin-bottom:.8rem">
      <input id="chQ" type="search" placeholder="Buscar por proveedor o N.° de compra..." value="${esc(CH.q)}">
      <div class="chips" id="chF">
        <button type="button" data-f="all" class="${CH.f === 'all' ? 'on' : ''}">Todas</button>
        <button type="button" data-f="pend" class="${CH.f === 'pend' ? 'on' : ''}">Por pagar</button>
        <button type="button" data-f="pagada" class="${CH.f === 'pagada' ? 'on' : ''}">Pagadas</button>
        <button type="button" data-f="anulada" class="${CH.f === 'anulada' ? 'on' : ''}">Anuladas</button>
      </div>
      <div class="grid">
        <label>Desde<input id="chFrom" type="date" value="${esc(CH.from)}"></label>
        <label>Hasta<input id="chTo" type="date" value="${esc(CH.to)}"></label>
      </div>
      ${CH.q || CH.from || CH.to || CH.f !== 'all' ? '<div class="row" style="margin:0"><button type="button" class="lnk" id="chClr" style="padding:0">Limpiar filtros</button></div>' : ''}
    </div>
    <div class="list" id="chL"></div>`;

  const draw = () => {
    const t = CH.q.trim().toLowerCase();
    const list = rows.filter(r => {
      if (CH.f === 'pend' && r.status !== 'registrada') return false;
      if (CH.f === 'pagada' && r.status !== 'pagada') return false;
      if (CH.f === 'anulada' && r.status !== 'anulada') return false;
      if (CH.from && r.purchase_date && r.purchase_date < CH.from) return false;
      if (CH.to && r.purchase_date && r.purchase_date > CH.to) return false;
      if (!t) return true;
      const hay = `#${r.id} ${r.supplier || 'Sin proveedor'} ${r.purchase_date || ''}`.toLowerCase();
      return hay.includes(t);
    });

    const actList = list.filter(r => r.status !== 'anulada');
    const totUsd = actList.reduce((s, r) => s + Number(r.total_usd || 0), 0);
    const pendUsd = actList.filter(r => r.status === 'registrada').reduce((s, r) => s + Math.max(0, Number(r.total_usd || 0) - Number(r.paid_usd || 0)), 0);

    $('#chStats').innerHTML = `
      <div class="stat"><span>Total comprado</span><b>${fmtCur(totUsd)}</b><span>${actList.length} ${actList.length === 1 ? 'compra activa' : 'compras activas'}${S.rate ? ' · ' + fmt(totUsd * S.rate) + ' Bs' : ''}</span></div>
      <div class="stat ${pendUsd > 0.01 ? 'warn' : ''}"><span>Por pagar</span><b>${fmtCur(pendUsd)}</b><span>${S.rate ? fmt(pendUsd * S.rate) + ' Bs hoy' : ''}</span></div>`;

    $('#chL').innerHTML = list.map(r => {
      const d = Math.max(0, Number(r.total_usd || 0) - Number(r.paid_usd || 0));
      const isLoc = Number(r.id) < 0;
      const venc = r.status === 'registrada' && r.due_date && r.due_date < hoy;
      const idLbl = isLoc ? 'LOC-' + Math.abs(r.id) : '#' + r.id;
      const bCls = isLoc ? 'low' : r.status === 'pagada' ? 'ok' : venc ? 'out' : r.status === 'registrada' ? 'low' : 'out';
      const bTxt = isLoc ? 'Sin subir' : venc ? 'Vencida' : (ST[r.status] || r.status);
      return `<button class="item" data-id="${r.id}">
        <span>
          <b>${idLbl} ${esc(r.supplier || 'Sin proveedor')}</b>
          <small>${dmy(r.purchase_date)}${r.due_date ? ' | vence ' + dmy(r.due_date) : ''}</small>
          <small>${r.status === 'registrada'
            ? 'Debes ' + fmtCur(d) + (S.bimoneda !== false ? ' (' + fmtSec(d * (S.rate || r.exchange_rate)) + ' hoy)' : '')
            : fmtCur(r.total_usd) + (S.bimoneda !== false ? ' (' + fmtSec(r.total_usd * r.exchange_rate) + ')' : '')}</small>
        </span>
        <span class="badge ${bCls}">${bTxt}</span>
      </button>`;
    }).join('') || '<p class="mut">No hay compras con ese filtro.</p>';
  };
  draw();

  $('#chQ').oninput = (e) => { CH.q = e.target.value; draw(); };
  $('#chFrom').onchange = (e) => { CH.from = e.target.value; render(); };
  $('#chTo').onchange = (e) => { CH.to = e.target.value; render(); };
  $('#chF').onclick = (e) => { const b = e.target.closest('button'); if (b) { CH.f = b.dataset.f; render(); } };
  if ($('#chClr')) $('#chClr').onclick = () => { CH.f = 'all'; CH.q = ''; CH.from = ''; CH.to = ''; render(); };
  $('#chL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => purchaseSheet(+b.dataset.id)); };
}

async function purchaseSheet(id) {
  const {b, items, pays} = await purchaseDetail(id);
  const paid = pays.reduce((a, p) => a + +p.amount_usd, 0), bal = Math.max(0, b.total_usd - paid);
  const anul = b.status === 'anulada', open = !anul && bal > 0.01;
  const idLbl = Number(id) < 0 ? 'LOC-' + Math.abs(id) + ' (Sin subir)' : '#' + id;

  openSheet('Compra ' + idLbl, `
    <p>${esc(b.parties?.name || 'Sin proveedor')} | ${dmy(b.purchase_date)}${b.due_date ? ' | vence ' + dmy(b.due_date) : ''}${anul ? ' | <b class="warn">ANULADA</b>' : ''}${b.notes ? '<br><small class="mut">' + esc(b.notes) + '</small>' : ''}</p>
    ${items.length ? `<div class="scroll"><table>
      <thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Costo</th><th class="n">Total</th></tr></thead>
      <tbody>${items.map(i => `<tr><td>${esc(i.products?.name)}</td><td class="n">${qty(i.quantity)} ${esc(i.products?.unit || '')}</td><td class="n">${fmt(i.unit_cost_usd, 4)}</td><td class="n">${fmt(i.quantity * i.unit_cost_usd)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="mut">Compra de saldo inicial sin detalle de artículos.</p>'}
    <p>${Number(b.tax_usd || 0) > 0 ? `Subtotal ${fmtCur(b.subtotal_usd ?? (b.total_usd - b.tax_usd))} | IVA (${qty(b.iva_percent || 16)}%): ${fmtCur(b.tax_usd)}<br>` : ''}<b>Total ${fmtCur(b.total_usd)}</b> (${fmt(b.total_usd * b.exchange_rate)} Bs a la tasa de la compra)<br>Pagado ${fmtCur(paid)}${open ? `<br><span class="warn">Debes ${fmtCur(bal)} (${fmt(bal * (S.rate || b.exchange_rate))} Bs a la tasa de hoy)</span>` : ''}</p>
    ${pays.length ? `<p class="mut">${pays.map(p => `${METHODS[p.method] || p.method} (${esc(p.accounts?.name)}): ${money(p.amount, p.currency)} a tasa ${fmt(p.exchange_rate, 2)}`).join('<br>')}</p>` : ''}
    <div class="row">
      ${open ? '<button class="btn" id="pcPay">Registrar pago</button>' : ''}
      ${!anul ? '<button class="btn ghost" id="pcEdit">Modificar</button>' : ''}
      ${items.length ? '<button class="btn ghost" id="pcDup">Duplicar</button>' : ''}
      ${!anul ? '<button class="btn ghost" id="pcAnu" style="color:var(--bad)">Anular</button>' : ''}
    </div>`);

  if (open) $('#pcPay').onclick = () => run(() => debtForm({title: 'Registrar pago', label: 'Debes', rpc: 'registrar_pago_compra', args: {p_purchase_id: id}, bal}));
  if (!anul) {
    $('#pcEdit').onclick = () => {
      CV.edit = id;
      CV.pre = null;
      SUB.com = 'nueva';
      closeSheet();
      go('compras');
    };
  }
  if (items.length) {
    $('#pcDup').onclick = () => {
      CV.edit = null;
      CV.pre = items.map(i => ({pid: i.product_id, qty: +i.quantity}));
      SUB.com = 'nueva';
      closeSheet();
      go('compras');
      toast('Productos cargados en una nueva compra');
    };
  }
  if (!anul) {
    $('#pcAnu').onclick = () => run(async () => {
      const msg = '¿Anular esta compra? Se descontará del inventario lo recibido y se devolverán a tus cuentas los pagos registrados.';
      if (!confirm(msg)) return;
      const reason = prompt('Motivo de la anulación (opcional):') || null;
      try {
        await q(db.rpc('anular_compra', {p_id: id, p_reason: reason ? reason.trim() : null}));
      } catch (err) {
        if (err.code === 'PGRST202' || /anular_compra/i.test(err.message || '')) {
          throw new Error('No se pudo anular esta compra.');
        }
        throw err;
      }
      closeSheet();
      toast('Compra anulada: inventario y cuentas revertidos');
      render();
    });
  }
}

// ---------- Deuda general con cada proveedor (Por pagar — espejo de Por cobrar a clientes) ----------
async function viewDeudasProv() {
  const [openPurs, parties] = await Promise.all([
    q(db.from('compras_resumen').select('*').eq('status', 'registrada').order('purchase_date').order('id')),
    q(db.from('parties').select('id,name,phone').eq('is_supplier', true))
  ]);
  const hoy = caracasDate();
  const partyMap = Object.fromEntries(parties.map(p => [String(p.id), p]));
  const grouped = {};
  openPurs.forEach(c => {
    const bal = r2(Math.max(0, Number(c.total_usd || 0) - Number(c.paid_usd || 0)));
    if (bal <= 0.01) return;
    const key = c.supplier_id == null ? 'null' : String(c.supplier_id);
    const p = c.supplier_id != null ? partyMap[key] : null;
    if (!grouped[key]) {
      grouped[key] = {
        supplier_id: c.supplier_id ?? null,
        supplier: c.supplier || p?.name || 'Sin proveedor',
        phone: p?.phone || null,
        num_compras: 0,
        vencidas: 0,
        debt_usd: 0,
        desde: c.purchase_date
      };
    }
    grouped[key].num_compras++;
    if (c.due_date && c.due_date < hoy) grouped[key].vencidas++;
    grouped[key].debt_usd = r2(grouped[key].debt_usd + bal);
    if (c.purchase_date && (!grouped[key].desde || c.purchase_date < grouped[key].desde)) grouped[key].desde = c.purchase_date;
  });

  const rows = Object.values(grouped).sort((a, b) => b.debt_usd - a.debt_usd);
  const tot = rows.reduce((a, r) => a + r.debt_usd, 0);

  $('#view').innerHTML = `<div class="stat warn" style="margin-bottom:1rem">
      <span>Total por pagar</span>
      <b>${fmtCur(tot)}</b>
      <span>${S.rate ? fmt(tot * S.rate) + ' Bs a la tasa de hoy | ' : ''}${rows.length} ${rows.length === 1 ? 'proveedor' : 'proveedores'}</span>
    </div>
    <div class="list" id="dpL">${rows.map((r, i) => `<button class="item" data-i="${i}">
      <span>
        <b>${esc(r.supplier)}</b>
        <small>${r.num_compras} ${r.num_compras === 1 ? 'compra pendiente' : 'compras pendientes'}${r.vencidas ? ` · <span class="bad">${r.vencidas} ${r.vencidas === 1 ? 'vencida' : 'vencidas'}</span>` : ''} | desde hace ${diasDesde(r.desde)} días</small>
      </span>
      <span class="n"><b>${fmtCur(r.debt_usd)}</b><small>${S.rate ? fmt(r.debt_usd * S.rate) + ' Bs hoy' : ''}</small></span>
    </button>`).join('') || '<p class="mut">No le debes a ningún proveedor.</p>'}</div>`;

  $('#dpL').onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) run(() => supplierDebtSheet(rows[+b.dataset.i]));
  };
}

async function supplierDebtSheet(sup) {
  let qb = db.from('compras_resumen').select('id,purchase_date,total_usd,paid_usd,due_date').eq('status', 'registrada').order('purchase_date').order('id');
  qb = sup.supplier_id === null ? qb.is('supplier_id', null) : qb.eq('supplier_id', sup.supplier_id);
  const [pursRaw, accs] = await Promise.all([q(qb), loadActiveAccounts()]);
  const hoy = caracasDate(), bal = (p) => Math.max(0, Number(p.total_usd || 0) - Number(p.paid_usd || 0));
  const purs = pursRaw.filter(p => bal(p) > 0.01);
  if (!purs.length) { toast('Este proveedor ya no tiene saldo pendiente'); render(); return; }
  const total = purs.reduce((a, p) => a + bal(p), 0);

  openSheet(esc(sup.supplier), `<form id="dpF" class="stack">
    <p><b>Deuda total: ${fmtCur(total)}</b>${S.rate ? ' (' + fmt(total * S.rate) + ' Bs a la tasa de hoy)' : ''}</p>
    <p class="mut">Marca las compras que vas a pagar. Si el monto no alcanza para todas, se pagan completas las más antiguas y la siguiente queda con un abono y el resto abierto.</p>
    <div class="list" id="dpS">${purs.map(p => `<div class="item">
      <label class="chk" style="flex:1"><input type="checkbox" data-p="${p.id}" checked>
        <span><b>Compra #${p.id}</b>
          <small>${dmy(p.purchase_date)}${p.due_date && p.due_date < hoy ? ' | vencida' : ''} | debes ${fmtCur(bal(p))}</small>
          <small class="al" style="display:block"></small>
        </span>
      </label>
    </div>`).join('')}</div>
    <label>Pagar desde la cuenta<select name="acc">${acctOpts(accs)}</select></label>
    <small id="dpAccBal" style="display:block;margin-top:-.45rem"></small>
    <label>Tasa de cambio (${esc(secSym())} por ${esc(curLabel())})<input name="rate" type="number" step="0.0001" min="0.0001" value="${S.rate || ''}"></label>
    <label>Método<select name="method"></select></label>
    <label>Monto a pagar<input name="amount" type="number" step="0.01" min="0.01" required></label>
    <p class="mut" id="dpSum"></p>
    <label>Referencia<input name="ref" placeholder="N.° de transferencia o recibo"></label>
    <div class="row">
      <button class="btn" type="submit" id="dpGo">Registrar pago</button>
      ${sup.phone ? '<button class="btn ghost" type="button" id="dpWa">WhatsApp</button>' : ''}
    </div>
  </form>`);

  const el = $('#dpF').elements;
  const curAcc = () => accs.find(a => String(a.id) === el.acc.value);
  const cur = () => curAcc().currency;
  const factor = () => cur() === 'USD' ? 1 : (+el.rate.value || 0);
  const chosen = (p) => document.querySelector(`[data-p="${p.id}"]`).checked;
  const selDebt = () => purs.filter(chosen).reduce((a, p) => a + bal(p), 0);
  const alloc = () => {
    let rem = (num(el.amount.value) || 0) / (factor() || 1);
    return purs.map(p => {
      if (!chosen(p)) return {p, a: 0, st: ''};
      const a = Math.min(bal(p), Math.max(rem, 0));
      rem -= a;
      return {p, a, st: a >= bal(p) - 0.01 ? 'full' : a > 0.004 ? 'part' : 'none'};
    });
  };
  const paint = () => {
    const amt = num(el.amount.value) || 0;
    const al = alloc(), usd = al.reduce((x, y) => x + y.a, 0), sel = selDebt(), over = amt / (factor() || 1) - sel;
    al.forEach(x => {
      const l = document.querySelector(`[data-p="${x.p.id}"]`).closest('.item').querySelector('.al');
      l.className = 'al ' + (x.st === 'full' ? 'in' : x.st === 'part' ? 'warn' : 'mut');
      l.style.display = 'block';
      l.textContent = x.st === 'full' ? 'Se paga completa' : x.st === 'part' ? `Abono de ${fmtCur(x.a)}: queda abierta debiendo ${fmtCur(bal(x.p) - x.a)}` : x.st === 'none' ? 'No alcanza: queda pendiente' : '';
    });
    $('#dpSum').textContent = over > 0.02
      ? `El monto supera la deuda de las compras elegidas por ${fmtCur(over)}.`
      : `Pagarás ${fmtCur(usd)}. Quedan pendientes ${fmtCur(Math.max(sel - usd, 0))} de las compras elegidas.`;
    if ($('#dpAccBal')) $('#dpAccBal').innerHTML = accBalanceLine(curAcc(), amt, true);
  };
  const fillM = () => { el.method.innerHTML = optList(accMethods(curAcc())); };
  let pf = factor();
  const fill = () => { pf = factor(); el.amount.value = (selDebt() * pf).toFixed(2); paint(); };
  const conv = () => { const nf = factor(), usd = pf ? (num(el.amount.value) || 0) / pf : selDebt(); pf = nf; el.amount.value = (usd * nf).toFixed(2); paint(); };
  fillM(); fill();
  $('#dpS').addEventListener('change', fill);
  el.acc.onchange = () => { fillM(); conv(); };
  el.rate.oninput = conv;
  el.amount.oninput = paint;

  $('#dpF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const ids = purs.filter(chosen).map(p => p.id);
      if (!ids.length) throw new Error('Marca al menos una compra');
      const amt = num(el.amount.value), sel = selDebt(), over = amt / (factor() || 1) - sel;
      if (over > 0.02) throw new Error(`El monto supera la deuda seleccionada (${fmtCur(sel)})`);
      let res;
      try {
        res = await q(db.rpc('pagar_compras', {
          p_purchase_ids: ids,
          p_account_id: +el.acc.value,
          p_method: el.method.value,
          p_amount: amt,
          p_reference: el.ref.value.trim() || null,
          p_rate: +el.rate.value || null
        }));
      } catch (err) {
        if (err.code === 'PGRST202' || /pagar_compras/i.test(err.message || '')) {
          throw new Error('No se pudo completar la operación en esta compra.');
        }
        throw err;
      }
      closeSheet();
      toast(`Pago registrado: ${res.pagadas} ${res.pagadas === 1 ? 'compra pagada completa' : 'compras pagadas completas'}${res.abonadas ? ' y 1 con abono (queda abierta)' : ''}. Pendiente: ${fmtCur(res.pendiente_usd)}`);
      render();
    });
  };

  if (sup.phone && $('#dpWa')) {
    $('#dpWa').onclick = () => {
      const amt = num(el.amount.value) || 0, ref = el.ref.value.trim();
      const msg = `Hola ${sup.supplier}, te escribo respecto a nuestro saldo pendiente (${fmtCur(total)}).${amt > 0 ? ` Pago por ${money(amt, cur())}${ref ? ' · Ref: ' + ref : ''}.` : ''}`;
      window.open(`https://wa.me/${waDigits(sup.phone)}?text=${encodeURIComponent(msg)}`, '_blank');
    };
  }
}

// ---------- Cobro o pago de una deuda individual: queda en USD y se convierte con la tasa del día ----------
async function debtForm(cfg) {
  const accs = await loadActiveAccounts(), bal = cfg.bal, isOut = cfg.rpc === 'registrar_pago_compra', bi = S.bimoneda !== false;
  openSheet(cfg.title, `<form id="dF" class="stack"><p>${cfg.label}: <b>${fmtCur(bal)}</b>${bi && S.rate ? ` (${fmt(bal * S.rate)} Bs a la tasa de hoy)` : ''}<br>
    ${bi ? '<span class="mut">El precio en dólares no cambia. Lo que se paga en Bs depende de la tasa del día del pago; puedes modificarla.</span>' : ''}</p>
    <label>Cuenta<select name="acc">${acctOpts(accs)}</select></label>
    <small id="dAccBal" style="display:block;margin-top:-.45rem"></small>
    <label class="${bi ? '' : 'hidden'}">Tasa de cambio (${esc(secSym())} por ${esc(curLabel())})<input name="rate" type="number" step="0.0001" min="0.0001" value="${bi ? (S.rate || '') : 1}"></label>
    <label>Método<select name="method"></select></label>
    <label>Monto<input name="amount" type="number" step="0.01" min="0.01" required></label><p class="mut" id="dEq"></p>
    <label>Referencia<input name="ref"></label><button class="btn" type="submit">${cfg.title}</button></form>`);
  const el = $('#dF').elements, curAcc = () => accs.find(a => String(a.id) === el.acc.value), cur = () => curAcc().currency;
  const eq = () => {
    const r = bi ? (+el.rate.value || 0) : 1, a = num(el.amount.value) || 0, usd = cur() === 'USD' ? a : (r ? a / r : 0);
    $('#dEq').textContent = `Equivale a ${fmtCur(usd)} | quedaría debiendo ${fmtCur(Math.max(bal - usd, 0))}`;
    $('#dAccBal').innerHTML = accBalanceLine(curAcc(), a, isOut);
  };
  const full = () => { el.amount.value = (bal * (cur() === 'USD' ? 1 : (bi ? (+el.rate.value || 0) : 1))).toFixed(2); eq(); };
  const fillM = () => { el.method.innerHTML = optList(accMethods(curAcc())); };
  fillM(); full(); let pf = cur() === 'USD' ? 1 : (bi ? (+el.rate.value || 0) : 1);
  const conv = () => { const nf = cur() === 'USD' ? 1 : (bi ? (+el.rate.value || 0) : 1), usd = pf ? (num(el.amount.value) || 0) / pf : bal; pf = nf; el.amount.value = (usd * nf).toFixed(2); eq(); };
  el.acc.onchange = () => { fillM(); conv(); }; el.rate.oninput = conv; el.amount.oninput = eq;
  $('#dF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const a = curAcc(), amtOrig = num(el.amount.value), rt = bi ? (+el.rate.value || S.rate || 1) : 1;
      const paidUsd = a.currency === 'USD' ? amtOrig : (rt ? amtOrig / rt : 0);
      const refVal = el.ref.value.trim() || null;
      await q(db.rpc(cfg.rpc, {...cfg.args, p_account_id: +el.acc.value, p_method: el.method.value, p_amount: amtOrig, p_reference: refVal, p_rate: rt}));
      toast('Pago registrado');
      render();
      if (cfg.rpc === 'registrar_cobro' && typeof showPaymentReceipt === 'function') {
        await showPaymentReceipt({
          customer: cfg.customer || 'Cliente general',
          phone: cfg.phone || '',
          date: caracasDate(),
          created_at: new Date().toISOString(),
          concept: cfg.concept || ('Abono a Venta #' + cfg.args?.p_sale_id),
          prevBalanceUsd: bal,
          paidUsd: Math.round(paidUsd * 100) / 100,
          paidOrig: amtOrig,
          paidCur: a.currency,
          methodLabel: METHODS[el.method.value] || el.method.value,
          accountName: a.name,
          reference: refVal,
          remainingUsd: Math.max(0, Math.round((bal - paidUsd) * 100) / 100),
          rate: rt
        });
      } else {
        closeSheet();
      }
    });
  };
}
