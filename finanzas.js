// Finanzas: cuentas y saldos, gastos, transferencias, arqueo y pago de compras
const num = (v) => +String(v).replace(',', '.');
const toUsd = (amt, cur) => cur === 'USD' ? +amt : (S.rate ? amt / S.rate : 0);
const money = (n, cur) => fmt(n) + (cur === 'USD' ? ' USD' : ' Bs');
const acctOpts = (accs, sel) => accs.map(a => `<option value="${a.id}" ${String(a.id) === String(sel) ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('');
const MOVK = {cobro: 'Cobro', anulacion: 'Anulación', pago: 'Pago', gasto: 'Gasto', transferencia: 'Transferencia', ajuste: 'Ajuste'};

async function cajaStat() {
  const a = await q(db.from('cuentas_saldo').select('balance,currency').eq('active', true));
  const t = a.reduce((s, x) => s + toUsd(+x.balance, x.currency), 0);
  return `<button class="stat" data-go="finanzas"><span>Dinero disponible</span><b>${fmt(t)} USD</b><span>${S.rate ? fmt(t * S.rate) + ' Bs' : 'Sin tasa'}</span></button>`;
}

// ---------- Cuentas ----------
async function viewCuentas() {
  const [accs, types] = await Promise.all([q(db.from('cuentas_saldo').select('*').order('id')), q(db.from('account_types').select('id,name').eq('active', true).order('name'))]);
  const act = accs.filter(a => a.active), tot = act.reduce((s, a) => s + toUsd(+a.balance, a.currency), 0), D = {types};
  $('#view').innerHTML = `<div class="stat" style="margin-bottom:1rem"><span>Dinero disponible</span><b>${fmt(tot)} USD</b><span>${S.rate ? fmt(tot * S.rate) + ' Bs' : 'Sin tasa cargada'}</span></div>
    <div class="row" style="margin:0 0 .8rem"><button class="btn ghost" id="acTr">Transferir entre cuentas</button></div>
    <div class="list" id="acL">${act.map(a => `<button class="item" data-id="${a.id}"><span><b>${esc(a.name)}</b><small>${esc(a.type || 'Cuenta')} | ${a.currency}</small></span>
      <span class="n"><b>${money(a.balance, a.currency)}</b>${a.currency === 'VES' && S.rate ? `<small>${fmt(a.balance / S.rate)} USD</small>` : ''}</span></button>`).join('') || '<p class="mut">No hay cuentas. Pulsa + para crear una.</p>'}</div>
    <button class="fab" id="acAdd" aria-label="Nueva cuenta">+</button>`;
  $('#acAdd').onclick = () => accForm(null, D);
  $('#acTr').onclick = () => transferForm(act);
  $('#acL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => accSheet(act.find(a => String(a.id) === b.dataset.id), D)); };
}
async function accSheet(a, D) {
  const ms = await q(db.from('account_movements').select('amount,kind,note,created_at').eq('account_id', a.id).order('id', {ascending: false}).limit(30));
  openSheet(esc(a.name), `<p>Saldo: <b>${money(a.balance, a.currency)}</b>${a.currency === 'VES' && S.rate ? ' (' + fmt(a.balance / S.rate) + ' USD)' : ''}</p>
    <div class="row"><button class="btn" id="aAdj">Ajustar saldo</button><button class="btn ghost" id="aEdit">Editar</button></div>
    <h2 style="margin-top:1rem">Últimos movimientos</h2>
    ${ms.length ? `<div class="scroll"><table><tbody>${ms.map(m => `<tr><td>${fdate(m.created_at)}</td><td>${MOVK[m.kind] || m.kind}<small>${esc(m.note)}</small></td><td class="n ${m.amount > 0 ? 'in' : 'outq'}">${m.amount > 0 ? '+' : ''}${fmt(m.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Aún no hay movimientos.</p>'}`);
  $('#aEdit').onclick = () => accForm(a, D);
  $('#aAdj').onclick = () => {
    const v = prompt(`Saldo real que hay hoy en ${a.name} (${a.currency}):`, a.balance); if (v === null || v === '') return;
    run(async () => { await q(db.rpc('registrar_ajuste_cuenta', {p_account_id: a.id, p_new_balance: num(v), p_note: null})); closeSheet(); toast('Saldo ajustado'); render(); });
  };
}
function accForm(a, D) {
  openSheet(a ? 'Editar cuenta' : 'Nueva cuenta', `<form id="aF" class="stack"><label>Nombre<input name="aname" required value="${esc(a?.name)}"></label>
    <label>Tipo<select name="type_id">${D.types.map(t => `<option value="${t.id}" ${t.id === a?.type_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <label>Moneda<select name="cur" ${a ? 'disabled' : ''}><option value="USD">Dólares (USD)</option><option value="VES">Bolívares (Bs)</option></select></label>
    <label>Saldo inicial<input name="open" type="number" step="0.01" value="${a ? a.opening_balance : 0}"></label>
    <div class="stack"><b class="mut">Métodos de pago que acepta esta cuenta</b>${Object.entries(METHODS).map(([k, v]) => `<label class="chk"><input type="checkbox" name="m_${k}" ${(a?.methods?.length ? a.methods.includes(k) : k === 'efectivo') ? 'checked' : ''}> ${v}</label>`).join('')}</div>
    <div class="row"><button class="btn" type="submit">Guardar</button>${a ? '<button type="button" class="btn ghost" id="aDel">Desactivar</button>' : ''}</div></form>`);
  const el = $('#aF').elements; if (a) el.cur.value = a.currency;
  $('#aF').onsubmit = (e) => {
    e.preventDefault();
    const row = {name: el.aname.value.trim(), type_id: +el.type_id.value || null, opening_balance: +el.open.value || 0};
    row.methods = Object.keys(METHODS).filter(k => el['m_' + k].checked);
    if (!row.methods.length) return toast('Elige al menos un método de pago', true);
    if (!a) row.currency = el.cur.value;
    run(async () => { await q(a ? db.from('accounts').update(row).eq('id', a.id) : db.from('accounts').insert(row)); closeSheet(); toast('Cuenta guardada'); render(); });
  };
  if (a) $('#aDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar esta cuenta? Deja de aparecer en ventas y pagos.')) return;
    await q(db.from('accounts').update({active: false}).eq('id', a.id)); closeSheet(); render();
  });
}
function transferForm(accs) {
  if (accs.length < 2) return toast('Necesitas al menos dos cuentas', true);
  openSheet('Transferir entre cuentas', `<form id="tF" class="stack"><label>Desde<select name="from">${acctOpts(accs)}</select></label>
    <label>Hacia<select name="to">${acctOpts(accs, accs[1].id)}</select></label>
    <label>Monto que sale<input name="out" type="number" step="0.01" min="0.01" required></label>
    <label>Monto que entra<input name="inn" type="number" step="0.01" min="0.01" required></label>
    <p class="mut">Si cambias de moneda, el monto que entra se calcula con la tasa del día y puedes corregirlo.</p>
    <label>Nota<input name="note" placeholder="Ej: cambio de dólares a bolívares"></label><button class="btn" type="submit">Transferir</button></form>`);
  const el = $('#tF').elements, cur = (id) => accs.find(a => String(a.id) === id)?.currency;
  const conv = () => { const o = num(el.out.value), f = cur(el.from.value), t = cur(el.to.value); if (o) el.inn.value = (f === t ? o : f === 'USD' ? o * (S.rate || 0) : o / (S.rate || 1)).toFixed(2); };
  ['out', 'from', 'to'].forEach(k => el[k].addEventListener('input', conv));
  $('#tF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await q(db.rpc('registrar_transferencia', {p_from: +el.from.value, p_to: +el.to.value, p_out: num(el.out.value), p_in: num(el.inn.value), p_note: el.note.value.trim() || null}));
      closeSheet(); toast('Transferencia registrada'); render();
    });
  };
}

// ---------- Gastos ----------
async function viewGastos() {
  const [rows, types, accs] = await Promise.all([
    q(db.from('expenses').select('*, expense_types(name,is_fixed), accounts(name)').order('id', {ascending: false}).limit(40)),
    q(db.from('expense_types').select('id,name,is_fixed').eq('active', true).order('name')),
    q(db.from('accounts').select('id,name,currency').eq('active', true).order('id'))
  ]);
  $('#view').innerHTML = `<div class="list" id="gL">${rows.map(g => `<button class="item" data-id="${g.id}"><span><b>${esc(g.description || g.expense_types?.name || 'Gasto')}</b>
    <small>${g.expense_date} | ${esc(g.expense_types?.name || 'Sin tipo')} | ${g.expense_types?.is_fixed ? 'Fijo' : 'Variable'}</small><small>${esc(g.accounts?.name)}</small></span>
    <span class="n ${g.status === 'anulado' ? 'mut' : ''}"><b>${fmt(g.amount_usd)} USD</b>${g.status === 'anulado' ? '<small>Anulado</small>' : ''}</span></button>`).join('') || '<p class="mut">Aún no hay gastos. Pulsa + para registrar el primero.</p>'}</div>
    <button class="fab" id="gAdd" aria-label="Nuevo gasto">+</button>`;
  $('#gAdd').onclick = () => {
    openSheet('Nuevo gasto', `<form id="gF" class="stack"><label>Tipo de gasto<select name="type">${types.map(t => `<option value="${t.id}">${esc(t.name)}${t.is_fixed ? ' (fijo)' : ''}</option>`).join('')}</select></label>
      <label>Descripción<input name="desc" placeholder="Ej: pago de alquiler de octubre"></label>
      <label>Pagado desde<select name="acc">${acctOpts(accs)}</select></label>
      <label>Monto (en la moneda de la cuenta)<input name="amount" type="number" step="0.01" min="0.01" required></label>
      <label>Fecha<input name="date" type="date" value="${caracasDate()}"></label><button class="btn" type="submit">Registrar gasto</button></form>`);
    const el = $('#gF').elements; let pc = accs[0]?.currency;
    el.acc.onchange = () => {   // al cambiar de cuenta, el monto escrito se convierte con la tasa
      const nc = accs.find(a => String(a.id) === el.acc.value)?.currency, v = num(el.amount.value);
      if (v && nc !== pc) el.amount.value = (nc === 'VES' ? v * (S.rate || 0) : v / (S.rate || 1)).toFixed(2);
      pc = nc;
    };
    $('#gF').onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await q(db.rpc('registrar_gasto', {p_type_id: +el.type.value || null, p_desc: el.desc.value.trim() || null, p_account_id: +el.acc.value, p_amount: num(el.amount.value), p_date: el.date.value || null, p_rate: S.rate}));
        closeSheet(); toast('Gasto registrado'); render();
      });
    };
  };
  $('#gL').onclick = (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const g = rows.find(x => String(x.id) === b.dataset.id);
    openSheet('Gasto #' + g.id, `<p><b>${esc(g.description || g.expense_types?.name)}</b><br>${g.expense_date} | ${esc(g.accounts?.name)}<br>${fmt(g.amount)} ${g.currency === 'USD' ? 'USD' : 'Bs'} (${fmt(g.amount_usd)} USD)</p>
      ${g.status === 'anulado' ? '<p class="warn">Gasto anulado</p>' : '<div class="row"><button class="btn ghost" id="gAnu">Anular gasto</button></div>'}`);
    if (g.status !== 'anulado') $('#gAnu').onclick = () => run(async () => {
      if (!confirm('¿Anular este gasto? El dinero vuelve a la cuenta.')) return;
      await q(db.rpc('anular_gasto', {p_id: g.id})); closeSheet(); toast('Gasto anulado'); render();
    });
  };
}


// Métodos de pago que acepta una cuenta (si no tiene configurados, se muestran todos)
const accMethods = (a) => { const l = a?.methods?.length ? a.methods : Object.keys(METHODS); return Object.fromEntries(l.filter(k => METHODS[k]).map(k => [k, METHODS[k]])); };
