// Nómina: pago por periodo, adelantos, recibos de pago e historial (los empleados se crean en la pestaña Empleados)
const NOM = {freq: 'quincenal'};
const PAYT = {semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual', todos: 'Todos'};
function periodDefaults(freq) {
  const t = new Date(caracasDate() + 'T12:00:00'), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
  if (freq === 'mensual' || freq === 'todos') return [dstr(new Date(y, m, 1)), dstr(new Date(y, m + 1, 0))];
  if (freq === 'quincenal') return d <= 15 ? [dstr(new Date(y, m, 1)), dstr(new Date(y, m, 15))] : [dstr(new Date(y, m, 16)), dstr(new Date(y, m + 1, 0))];
  const dow = (t.getDay() + 6) % 7;
  return [dstr(new Date(y, m, d - dow)), dstr(new Date(y, m, d - dow + 6))];
}

// Recibo de pago en foto (usa el mismo diseño de los tickets)
async function showPayslip(run, it, emp) {
  const set = await q(db.from('settings').select('*').eq('id', 1).single()), rate = +run.exchange_rate || S.rate || 1;
  const doc = {title: 'RECIBO DE PAGO', number: run.id, date: run.pay_date, partyLabel: 'EMPLEADO', customer: emp.name, phone: emp.phone, rate, pays: [], balance: 0, status: 'PAGADO', notes: it.note || '',
    items: [{name: `Sueldo del ${dmy(run.period_start)} al ${dmy(run.period_end)}`, qty: 1, price: +it.base_usd}, +it.bonus_usd ? {name: 'Bonos', qty: 1, price: +it.bonus_usd} : null,
      +it.deduction_usd ? {name: 'Descuentos', qty: 1, price: -it.deduction_usd} : null, +it.advance_usd ? {name: 'Adelantos descontados', qty: 1, price: -it.advance_usd} : null].filter(Boolean),
    subtotal: +it.net_usd, discount: 0, tax: 0, total: +it.net_usd};
  const blob = await receiptBlob(doc, set);
  openSheet('Recibo de ' + esc(emp.name), `<img class="rimg" src="${URL.createObjectURL(blob)}" alt="Recibo de pago"><div class="row"><button class="btn" id="rcS">Enviar como foto</button><button class="btn ghost" id="rcD">Descargar</button></div>`);
  $('#rcS').onclick = () => run(() => shareImage(blob, emp.phone, `recibo-${run.id}-${emp.id}`));
  $('#rcD').onclick = () => downloadBlob(blob, `recibo-${run.id}-${emp.id}.png`);
}

// ---------- Pagar nómina ----------
async function viewNomina() {
  const [emps, advs, accs] = await Promise.all([
    q(db.from('employees').select('*').eq('active', true).order('name')),
    q(db.from('employee_advances').select('id,employee_id,amount_usd').is('discounted_run_id', null)),
    q(db.from('accounts').select('id,name,currency,methods').eq('active', true).order('id'))
  ]);
  const list = emps.filter(e => NOM.freq === 'todos' || e.pay_type === NOM.freq), [p0, p1] = periodDefaults(NOM.freq);
  const advOf = (id) => advs.filter(a => a.employee_id === id), advSum = (id) => advOf(id).reduce((a, x) => a + +x.amount_usd, 0);
  $('#view').innerHTML = `<div class="chips sub" id="nmF">${Object.entries(PAYT).map(([k, v]) => `<button data-f="${k}" class="${k === NOM.freq ? 'on' : ''}">${v}</button>`).join('')}</div>
  ${list.length ? `<div class="card stack"><h2>Periodo y pago</h2>
    <div class="grid"><label>Desde<input id="nmS" type="date" value="${p0}"></label><label>Hasta<input id="nmE" type="date" value="${p1}"></label><label>Fecha de pago<input id="nmD" type="date" value="${caracasDate()}"></label></div>
    <div class="grid"><label>Pagar desde<select id="nmA">${acctOpts(accs)}</select></label><label>Tasa (Bs por USD)<input id="nmR" type="number" step="0.0001" min="0.0001" value="${S.rate || ''}"></label></div></div>
  <div class="card"><h2>Empleados (${list.length})</h2><div id="nmL">${list.map(e => { const adv = advSum(e.id); return `<div class="pl nrow" data-e="${e.id}"><div><b>${esc(e.name)}</b><small>${esc(e.position || 'Sin cargo')} | ${PAYT[e.pay_type]}</small><small class="nt"></small></div>
    <div class="stack" style="gap:.3rem"><label>Sueldo USD<input data-f="base" type="number" step="0.01" min="0" value="${e.salary_usd}"></label><label>Bono USD<input data-f="bonus" type="number" step="0.01" min="0" value="0"></label>
      <label>Descuento USD<input data-f="ded" type="number" step="0.01" min="0" value="0"></label>${adv ? `<label class="chk"><input type="checkbox" data-f="adv" checked> Descontar adelantos (${fmt(adv)} USD)</label>` : ''}</div></div>`; }).join('')}</div></div>
  <div class="card"><div id="nmT"></div></div><label>Nota<input id="nmN"></label><div class="row"><button class="btn" id="nmGo">Pagar nómina</button></div>`
  : '<p class="mut">No hay empleados con este tipo de pago. Agrégalos en la pestaña Empleados.</p>'}`;
  $('#nmF').onclick = (e) => { const b = e.target.closest('button'); if (b) { NOM.freq = b.dataset.f; render(); } };
  if (!list.length) return;
  const calc = () => {
    let g = 0, d = 0, a = 0, n = 0; const rt = +$('#nmR').value || 0;
    const res = [...document.querySelectorAll('#nmL .nrow')].map(r => {
      const id = +r.dataset.e, v = (f) => +r.querySelector(`[data-f=${f}]`).value || 0, ac = r.querySelector('[data-f=adv]'), adv = ac && ac.checked ? advSum(id) : 0;
      const base = v('base'), bonus = v('bonus'), ded = v('ded'), net = base + bonus - ded - adv;
      r.querySelector('.nt').textContent = 'Neto a pagar: ' + fmt(net) + ' USD' + (rt ? ' (' + fmt(net * rt) + ' Bs)' : '');
      g += base + bonus; d += ded; a += adv; n += net;
      return {id, base, bonus, ded, net, advIds: ac && ac.checked ? advOf(id).map(x => x.id) : []};
    });
    $('#nmT').innerHTML = `Sueldos y bonos: <b>${fmt(g)} USD</b> | Descuentos: ${fmt(d)} | Adelantos descontados: ${fmt(a)}<br><span class="big">${fmt(n)} USD</span> <span class="mut">${rt ? fmt(n * rt) + ' Bs a pagar ahora' : ''}</span>`;
    return {res, n};
  };
  calc();
  $('#nmL').addEventListener('input', calc); $('#nmL').addEventListener('change', calc); $('#nmR').addEventListener('input', calc);
  $('#nmGo').onclick = () => run(async () => {
    const {res, n} = calc(), items = res.filter(r => r.base + r.bonus > 0).map(r => ({employee_id: r.id, base: r.base, bonus: r.bonus, deduction: r.ded, advance_ids: r.advIds, note: ''}));
    if (!items.length) throw new Error('No hay montos para pagar');
    if (!confirm(`Se pagarán ${fmt(n)} USD a ${items.length} ${items.length === 1 ? 'empleado' : 'empleados'}. ¿Continuar?`)) return;
    const id = await q(db.rpc('registrar_nomina', {p_start: $('#nmS').value, p_end: $('#nmE').value, p_pay_date: $('#nmD').value, p_pay_type: NOM.freq, p_account_id: +$('#nmA').value, p_rate: +$('#nmR').value || null, p_notes: $('#nmN').value.trim() || null, p_items: items}));
    toast('Nómina registrada'); render(); await runSheet(id);
  });
}

// ---------- Historial ----------
async function viewNominaHist() {
  const rows = await q(db.from('payroll_runs').select('id,period_start,period_end,pay_date,pay_type,net_usd,exchange_rate,status').order('id', {ascending: false}).limit(40));
  $('#view').innerHTML = `<div class="list" id="nhL">${rows.map(r => `<button class="item" data-id="${r.id}"><span><b>Nómina #${r.id} | ${PAYT[r.pay_type] || ''}</b><small>${dmy(r.period_start)} al ${dmy(r.period_end)} | pagada el ${dmy(r.pay_date)}</small>
    <small>${fmt(r.net_usd)} USD (${fmt(r.net_usd * r.exchange_rate)} Bs)</small></span><span class="badge ${r.status === 'pagada' ? 'ok' : 'out'}">${r.status === 'pagada' ? 'Pagada' : 'Anulada'}</span></button>`).join('') || '<p class="mut">Aún no has pagado ninguna nómina.</p>'}</div>`;
  $('#nhL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => runSheet(+b.dataset.id)); };
}
async function runSheet(id) {
  const [r, items] = await Promise.all([
    q(db.from('payroll_runs').select('*, accounts(name)').eq('id', id).single()),
    q(db.from('payroll_items').select('*, employees(id,name,phone)').eq('run_id', id).order('id'))
  ]);
  openSheet('Nómina #' + id, `<p>${dmy(r.period_start)} al ${dmy(r.period_end)} | pagada desde ${esc(r.accounts?.name || '')}<br><b>Neto pagado: ${fmt(r.net_usd)} USD</b> (${fmt(r.net_usd * r.exchange_rate)} Bs a tasa ${fmt(r.exchange_rate, 2)})</p>
    <div class="list">${items.map((i, k) => `<div class="item"><span style="flex:1"><b>${esc(i.employees?.name)}</b><small>Sueldo ${fmt(i.base_usd)} | bono ${fmt(i.bonus_usd)} | desc. ${fmt(i.deduction_usd)} | adelantos ${fmt(i.advance_usd)}</small><small>Neto: ${fmt(i.net_usd)} USD</small></span><button class="btn ghost" data-k="${k}">Recibo</button></div>`).join('')}</div>
    ${r.status === 'pagada' ? '<div class="row"><button class="btn ghost" id="nhAnu">Anular nómina</button></div>' : '<p class="warn">Nómina anulada</p>'}`);
  document.querySelector('#sheet .list').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { const i = items[+b.dataset.k]; run(() => showPayslip(r, i, i.employees)); } };
  if (r.status === 'pagada') $('#nhAnu').onclick = () => run(async () => {
    if (!confirm('¿Anular esta nómina? El dinero vuelve a la cuenta y los adelantos quedan pendientes otra vez.')) return;
    await q(db.rpc('anular_nomina', {p_id: id})); closeSheet(); toast('Nómina anulada'); render();
  });
}

// ---------- Adelantos ----------
async function viewAdelantos() {
  const [rows, emps, accs] = await Promise.all([
    q(db.from('employee_advances').select('id,advance_date,amount_usd,note,discounted_run_id,employees(name)').order('id', {ascending: false}).limit(60)),
    q(db.from('employees').select('id,name').eq('active', true).order('name')),
    q(db.from('accounts').select('id,name,currency').eq('active', true).order('id'))
  ]);
  $('#view').innerHTML = `<div class="list">${rows.map(a => `<div class="item"><span style="flex:1"><b>${esc(a.employees?.name)}</b><small>${dmy(a.advance_date)}${a.note ? ' | ' + esc(a.note) : ''}</small></span>
    <span class="n"><b>${fmt(a.amount_usd)} USD</b><small>${a.discounted_run_id ? 'Descontado en nómina #' + a.discounted_run_id : 'Pendiente de descontar'}</small></span></div>`).join('') || '<p class="mut">No hay adelantos registrados. Pulsa + para dar uno.</p>'}</div>
    <button class="fab" id="adAdd" aria-label="Nuevo adelanto">+</button>`;
  $('#adAdd').onclick = () => {
    if (!emps.length) return toast('Primero agrega empleados', true);
    openSheet('Nuevo adelanto', `<form id="adF" class="stack"><label>Empleado<select name="emp">${emps.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>
      <label>Monto en USD<input name="amt" type="number" step="0.01" min="0.01" required></label><label>Entregado desde<select name="acc">${acctOpts(accs)}</select></label>
      <label>Nota<input name="note" placeholder="Ej: adelanto para medicinas"></label><p class="mut">Se descuenta en la próxima nómina. Si la cuenta es en Bs, se convierte con la tasa de hoy.</p><button class="btn" type="submit">Registrar adelanto</button></form>`);
    $('#adF').onsubmit = (e) => {
      e.preventDefault(); const el = e.target.elements;
      run(async () => { await q(db.rpc('registrar_adelanto', {p_employee_id: +el.emp.value, p_account_id: +el.acc.value, p_amount_usd: num(el.amt.value), p_note: el.note.value.trim() || null, p_rate: S.rate})); closeSheet(); toast('Adelanto registrado'); render(); });
    };
  };
}
