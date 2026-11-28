// Módulo opcional: Préstamos del negocio (créditos bancarios/terceros y dinero prestado desde caja)
// Separa abono a capital vs intereses para mantener reportes de ganancia 100% precisos.
const LN = {f: 'activos', q: ''};

const LN_FREQ = {
  mensual: 'Mensual',
  quincenal: 'Quincenal',
  semanal: 'Semanal',
  libre: 'Pagos libres (sin fecha fija)'
};

function nextLoanDate(baseDate, freq) {
  if (!baseDate || freq === 'libre') return '';
  const d = new Date(String(baseDate).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  if (freq === 'semanal') d.setDate(d.getDate() + 7);
  else if (freq === 'quincenal') d.setDate(d.getDate() + 15);
  else d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loanDueInfo(loan) {
  if (!loan || loan.status !== 'activo' || !loan.next_due_date) return null;
  const hoy = caracasDate();
  const d1 = new Date(hoy + 'T12:00:00');
  const d2 = new Date(String(loan.next_due_date).slice(0, 10) + 'T12:00:00');
  if (isNaN(d2.getTime())) return null;
  const diff = Math.round((d2 - d1) / 86400000);
  if (diff < 0) return {state: 'late', cls: 'out', txt: `Vencido (${dmy(loan.next_due_date)})`, days: diff};
  if (diff === 0) return {state: 'today', cls: 'out', txt: 'Cuota HOY', days: 0};
  if (diff <= 3) return {state: 'soon', cls: 'low', txt: `Vence en ${diff}d (${dmy(loan.next_due_date)})`, days: diff};
  return {state: 'ok', cls: '', txt: `Próx: ${dmy(loan.next_due_date)}`, days: diff};
}

async function viewPrestamos() {
  const [loans, accs] = await Promise.all([
    q(db.from('loans').select('*, accounts(name,currency)').order('id', {ascending: false})),
    loadActiveAccounts()
  ]);

  const actLoans = loans.filter(l => l.status === 'activo');
  const deudaBanco = actLoans.filter(l => l.kind === 'recibido').reduce((s, l) => s + Math.max(0, Number(l.principal_usd || 0) - Number(l.paid_principal_usd || 0)), 0);
  const meDeben = actLoans.filter(l => l.kind === 'otorgado').reduce((s, l) => s + Math.max(0, Number(l.principal_usd || 0) - Number(l.paid_principal_usd || 0)), 0);
  const dueSoon = actLoans.filter(l => { const d = loanDueInfo(l); return d && d.state !== 'ok'; }).length;
  const hasGranted = loans.some(l => l.kind === 'otorgado');

  $('#view').innerHTML = `
    <div class="stats">
      <div class="stat ${deudaBanco > 0.01 ? 'warn' : ''}">
        <span>Debo en préstamos</span>
        <b>${fmtCur(deudaBanco)}</b>
        <span>${S.bimoneda !== false && S.rate ? fmtSec(deudaBanco * S.rate) + ' hoy' : actLoans.filter(l => l.kind === 'recibido').length + ' activos'}</span>
      </div>
      ${hasGranted || meDeben > 0.01 ? `<div class="stat">
        <span>Prestado (por cobrar)</span>
        <b>${fmtCur(meDeben)}</b>
        <span>${S.bimoneda !== false && S.rate ? fmtSec(meDeben * S.rate) + ' hoy' : actLoans.filter(l => l.kind === 'otorgado').length + ' activos'}</span>
      </div>` : ''}
      <div class="stat ${dueSoon ? 'bad' : ''}">
        <span>Préstamos activos</span>
        <b>${actLoans.length}</b>
        <span>${dueSoon ? `${dueSoon} ${dueSoon === 1 ? 'cuota pronta/vencida' : 'cuotas prontas/vencidas'}` : 'Todos al día'}</span>
      </div>
    </div>

    <div class="card stack" style="margin-bottom:.8rem">
      <div class="row0" style="gap:.5rem">
        <button type="button" class="btn" id="lnAddTop" style="flex:1">+ Registrar préstamo</button>
      </div>
      <p class="mut" style="margin:0">Lleva el control de tus créditos bancarios o préstamos de caja cuota a cuota. El abono a capital reduce tu deuda y solo los intereses se contabilizan como gasto.</p>
      <input id="lnQ" type="search" placeholder="Buscar banco, entidad o persona..." value="${esc(LN.q)}">
      <div class="chips" id="lnF">
        <button type="button" data-f="activos" class="${LN.f === 'activos' ? 'on' : ''}">Activos (${actLoans.length})</button>
        <button type="button" data-f="recibido" class="${LN.f === 'recibido' ? 'on' : ''}">Recibidos (Banco/Deuda)</button>
        <button type="button" data-f="otorgado" class="${LN.f === 'otorgado' ? 'on' : ''}">Otorgados (Prestado)</button>
        <button type="button" data-f="pagado" class="${LN.f === 'pagado' ? 'on' : ''}">Pagados</button>
        <button type="button" data-f="anulado" class="${LN.f === 'anulado' ? 'on' : ''}">Anulados</button>
      </div>
    </div>

    <div class="list" id="lnL"></div>
    <button class="fab" id="lnAdd" aria-label="Nuevo préstamo">+</button>`;

  const draw = () => {
    const t = LN.q.trim().toLowerCase();
    const list = loans.filter(l => {
      if (LN.f === 'activos' && l.status !== 'activo') return false;
      if (LN.f === 'recibido' && !(l.kind === 'recibido' && l.status === 'activo')) return false;
      if (LN.f === 'otorgado' && !(l.kind === 'otorgado' && l.status === 'activo')) return false;
      if (LN.f === 'pagado' && l.status !== 'pagado') return false;
      if (LN.f === 'anulado' && l.status !== 'anulado') return false;
      if (!t) return true;
      return (`#${l.id} ${l.lender_name || ''} ${l.notes || ''}`).toLowerCase().includes(t);
    });

    $('#lnL').innerHTML = list.map(l => {
      const cap = Number(l.principal_usd || 0);
      const paid = Number(l.paid_principal_usd || 0);
      const rem = Math.max(0, cap - paid);
      const pct = cap > 0 ? Math.min(100, Math.round((paid / cap) * 100)) : 0;
      const isRec = l.kind === 'recibido';
      const due = loanDueInfo(l);
      const badgeCls = l.status === 'pagado' ? 'ok' : l.status === 'anulado' ? 'out' : (due && due.state !== 'ok' ? due.cls : 'prep');
      const badgeTxt = l.status === 'pagado' ? 'Saldado' : l.status === 'anulado' ? 'Anulado' : (due ? due.txt : (isRec ? 'Por pagar' : 'Por cobrar'));
      const cuoTxt = l.total_installments > 0 ? ` · Cuota ${l.paid_installments || 0}/${l.total_installments}` : (l.paid_installments > 0 ? ` · ${l.paid_installments} ${l.paid_installments === 1 ? 'abono' : 'abonos'}` : '');
      return `<button type="button" class="item loan-card ${due && due.state === 'late' ? 'ord-late' : due && (due.state === 'today' || due.state === 'soon') ? 'ord-today' : ''}" data-lid="${l.id}">
        <span style="flex:1;min-width:160px">
          <b>${esc(l.lender_name)}</b>
          <small>${isRec ? 'Crédito recibido' : 'Dinero prestado'} · ${LN_FREQ[l.frequency] || l.frequency}${cuoTxt}</small>
          <div class="loan-bar"><i style="width:${pct}%"></i></div>
          <small>Pagado: <b>${fmtCur(paid)}</b> de ${fmtCur(cap)} (${pct}%)${Number(l.paid_interest_usd || 0) > 0.005 ? ` · Intereses: ${fmtCur(l.paid_interest_usd)}` : ''}</small>
        </span>
        <span class="n" style="flex:none">
          <b class="${rem > 0.01 ? (isRec ? 'warn' : 'pos') : 'in'}">${rem > 0.01 ? fmtCur(rem) : 'Pagado'}</b>
          <small><span class="badge ${badgeCls}" style="font-size:.7rem">${esc(badgeTxt)}</span></small>
        </span>
      </button>`;
    }).join('') || '<p class="mut">No hay préstamos en esta vista. Pulsa <b>+ Registrar préstamo</b> para agregar un crédito bancario o préstamo de caja.</p>';
  };
  draw();

  $('#lnQ').oninput = (e) => { LN.q = e.target.value; draw(); };
  $('#lnF').onclick = (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    LN.f = b.dataset.f;
    document.querySelectorAll('#lnF button').forEach(x => x.classList.toggle('on', x === b));
    draw();
  };
  $('#lnAdd').onclick = () => loanForm(null, accs);
  if ($('#lnAddTop')) $('#lnAddTop').onclick = () => loanForm(null, accs);
  $('#lnL').onclick = (e) => { const b = e.target.closest('[data-lid]'); if (b) run(() => loanSheet(+b.dataset.lid, accs)); };
}

async function loanSheet(id, accsCache = null) {
  const [loan, pays, accs, set] = await Promise.all([
    q(db.from('loans').select('*, accounts(name,currency)').eq('id', id).single()),
    q(db.from('loan_payments').select('*, accounts(name,currency)').eq('loan_id', id).order('id', {ascending: false})),
    accsCache ? Promise.resolve(accsCache) : loadActiveAccounts(),
    q(db.from('settings').select('business_name').eq('id', 1).single()).catch(() => ({}))
  ]);

  const cap = Number(loan.principal_usd || 0);
  const paid = Number(loan.paid_principal_usd || 0);
  const intPaid = Number(loan.paid_interest_usd || 0);
  const rem = Math.max(0, cap - paid);
  const pct = cap > 0 ? Math.min(100, Math.round((paid / cap) * 100)) : 0;
  const isRec = loan.kind === 'recibido';
  const isAct = loan.status === 'activo';
  const showBs = S.bimoneda !== false && S.rate > 0;

  openSheet(`${isRec ? 'Crédito' : 'Préstamo'} #${loan.id} · ${esc(loan.lender_name)}`, `
    <div class="stack">
      <div class="card" style="margin:0;padding:.85rem .95rem;background:var(--bg)">
        <div class="title-row">
          <b>${isRec ? 'Préstamo recibido (Deuda)' : 'Préstamo otorgado (Por cobrar)'}</b>
          <span class="badge ${loan.status === 'pagado' ? 'ok' : loan.status === 'anulado' ? 'out' : 'prep'}">${loan.status === 'pagado' ? 'Saldado' : loan.status === 'anulado' ? 'Anulado' : 'Activo'}</span>
        </div>
        <div class="loan-bar" style="height:10px;margin:.55rem 0"><i style="width:${pct}%"></i></div>
        <div class="rl" style="border:0;padding:.15rem 0"><span>Capital original</span><b>${fmtCur(cap)}</b></div>
        <div class="rl" style="border:0;padding:.15rem 0"><span>Capital amortizado (${pct}%)</span><b class="in">${fmtCur(paid)}</b></div>
        ${intPaid > 0.005 ? `<div class="rl" style="border:0;padding:.15rem 0"><span>${isRec ? 'Intereses pagados (gasto)' : 'Intereses cobrados'}</span><b>${fmtCur(intPaid)}</b></div>` : ''}
        <div class="rl tot" style="padding:.3rem 0 0"><span>Saldo pendiente de capital</span><b class="${rem > 0.01 ? (isRec ? 'neg' : 'pos') : 'in'}">${fmtCur(rem)}${showBs && rem > 0.01 ? ' (' + fmtSec(rem * S.rate) + ')' : ''}</b></div>
        <small class="mut" style="display:block;margin-top:.35rem">
          Inicio: ${dmy(loan.start_date)} · Frecuencia: ${LN_FREQ[loan.frequency] || loan.frequency}
          ${loan.installment_usd > 0 ? ` · Cuota ref: ${fmtCur(loan.installment_usd)}` : ''}
          ${loan.total_installments > 0 ? ` · Cuotas: ${loan.paid_installments || 0} de ${loan.total_installments}` : ''}
          ${loan.next_due_date ? `<br><b>Próximo pago: ${dmy(loan.next_due_date)}</b>` : ''}
          ${loan.notes ? `<br>Nota: ${esc(loan.notes)}` : ''}
        </small>
      </div>

      ${isAct ? `<div class="row" style="margin:0">
        <button type="button" class="btn" id="lsPay">${isRec ? 'Registrar pago / cuota' : 'Registrar cobro / abono'}</button>
      </div>` : ''}

      <div class="row" style="margin:0">
        <button type="button" class="btn ghost" id="lsWa">Resumen WhatsApp</button>
        ${loan.status !== 'anulado' ? '<button type="button" class="btn ghost" id="lsEdit">Editar</button>' : ''}
        ${loan.status !== 'anulado' ? '<button type="button" class="btn ghost bad" id="lsAnu">Anular</button>' : ''}
      </div>

      <h2 style="margin:.4rem 0 0;font-size:1rem">Historial de cuotas / abonos (${pays.filter(p => p.status !== 'anulado').length})</h2>
      <div class="list" id="lsPays">
        ${pays.map(p => {
          const anul = p.status === 'anulado';
          return `<div class="item" style="gap:.5rem;align-items:center;${anul ? 'opacity:.6' : ''}">
            <span style="flex:1">
              <b>${dmy(p.payment_date)} · ${fmtCur(p.total_usd)}${anul ? ' <span class="badge out" style="font-size:.68rem">Anulada</span>' : ''}</b>
              <small>Capital: ${fmtCur(p.principal_usd)}${Number(p.interest_usd || 0) > 0.005 ? ' · Interés: ' + fmtCur(p.interest_usd) : ''}</small>
              <small>${esc(p.accounts?.name || 'Cuenta')} (${money(p.amount_orig, p.currency)})${p.reference ? ' · Ref: ' + esc(p.reference) : ''}${p.note ? ' · ' + esc(p.note) : ''}</small>
            </span>
            ${!anul ? `<button type="button" class="lnk bad" data-anupay="${p.id}" style="font-size:.82rem">Anular</button>` : ''}
          </div>`;
        }).join('') || '<p class="mut" style="margin:0">Aún no se han registrado cuotas en este préstamo.</p>'}
      </div>
    </div>`);

  if (isAct && $('#lsPay')) $('#lsPay').onclick = () => loanPayForm(loan, accs);
  if ($('#lsEdit')) $('#lsEdit').onclick = () => loanForm(loan, accs);
  if ($('#lsAnu')) $('#lsAnu').onclick = () => run(async () => {
    if (!confirm('¿Anular este préstamo? Se revertirán los movimientos de caja y gastos de intereses asociados.')) return;
    await q(db.rpc('anular_prestamo', {p_id: loan.id}));
    closeSheet(); toast('Préstamo anulado'); render();
  });

  $('#lsWa').onclick = () => {
    const lines = [
      `*RESUMEN DE PRÉSTAMO #${loan.id} — ${String(set?.business_name || 'MI NEGOCIO').toUpperCase()}*`,
      `${isRec ? 'Entidad / Acreedor' : 'Beneficiario'}: ${loan.lender_name}`,
      `Fecha: ${dmy(caracasDate())}`,
      '',
      `• Capital original: ${fmtCur(cap)}`,
      `• Capital pagado: ${fmtCur(paid)} (${pct}%)`,
      intPaid > 0.005 ? `• Intereses acumulados: ${fmtCur(intPaid)}` : '',
      `*• Saldo pendiente: ${fmtCur(rem)}*${showBs && rem > 0.01 ? ' (' + fmtSec(rem * S.rate) + ')' : ''}`,
      loan.next_due_date ? `• Próxima cuota: ${dmy(loan.next_due_date)}` : ''
    ].filter(Boolean);
    window.open(`https://wa.me/${waDigits(loan.phone || '')}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  };

  $('#lsPays').onclick = (e) => {
    const b = e.target.closest('[data-anupay]'); if (!b) return;
    run(async () => {
      if (!confirm('¿Anular esta cuota? El dinero volverá a la cuenta y el saldo del préstamo se restaurará.')) return;
      await q(db.rpc('anular_cuota_prestamo', {p_id: +b.dataset.anupay}));
      toast('Cuota anulada');
      render();
      await loanSheet(loan.id, accs);
    });
  };
}

function loanForm(loan, accs) {
  const isEdit = !!loan;
  const hoy = caracasDate();
  const defNext = nextLoanDate(hoy, 'mensual');
  openSheet(isEdit ? `Editar préstamo #${loan.id}` : 'Registrar préstamo', `<form id="lnF" class="stack">
    ${!isEdit ? `
      <label>Tipo de préstamo
        <select name="kind">
          <option value="recibido">Préstamo recibido (Banco, financiera, familiar — debo pagarlo)</option>
          <option value="otorgado">Préstamo otorgado (Dinero que el negocio presta — me deben pagar)</option>
        </select>
      </label>
    ` : ''}
    <div class="grid">
      <label>Banco, entidad o persona<input name="lender" value="${esc(loan?.lender_name || '')}" placeholder="Ej: Banco de Venezuela, Banesco, Juan" required></label>
      <label>Teléfono / WhatsApp (opcional)<input name="phone" type="tel" value="${esc(loan?.phone || '')}" placeholder="Ej: 0414-0000000"></label>
    </div>

    ${!isEdit ? `
      <div class="grid">
        <label>Monto del préstamo (${esc(curLabel())})<input name="principal" type="number" step="0.01" min="0.01" placeholder="Ej: 1000" required></label>
        <label>Ya pagado antes de hoy (opcional)<input name="already" type="number" step="0.01" min="0" value="0"></label>
      </div>
      <div class="card stack" style="margin:0;padding:.75rem .85rem;background:var(--bg)">
        <label style="margin:0">¿Este préstamo mueve dinero de una cuenta hoy?
          <select name="move_cash">
            <option value="0">No — Ya venía en curso (solo llevar control sin alterar saldo actual)</option>
            <option value="1">Sí — Préstamo nuevo hoy (sumar/restar en una cuenta)</option>
          </select>
        </label>
        <div id="lnAccW" class="stack hidden" style="gap:.4rem">
          <label style="margin:0">Cuenta<select name="acc">${acctOpts(accs)}</select></label>
          <small id="lnAccBal" class="mut"></small>
        </div>
      </div>
    ` : ''}

    <div class="grid">
      <label>Cuota estimada (${esc(curLabel())}, opcional)<input name="inst" type="number" step="0.01" min="0" value="${loan?.installment_usd || ''}"></label>
      <label>N.° total de cuotas (opcional)<input name="tot_inst" type="number" min="0" step="1" value="${loan?.total_installments || ''}"></label>
    </div>
    <div class="grid">
      <label>Frecuencia de pago
        <select name="freq">
          ${Object.entries(LN_FREQ).map(([k, v]) => `<option value="${k}" ${(loan?.frequency || 'mensual') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </label>
      <label>Próxima fecha de pago (opcional)<input name="next_due" type="date" value="${esc(loan ? (loan.next_due_date || '') : defNext)}"></label>
    </div>
    ${!isEdit ? `<label>Fecha de inicio<input name="start_date" type="date" value="${hoy}"></label>` : ''}
    <label>Notas (N.° de crédito, tasa de interés, detalles)<textarea name="notes" rows="2" placeholder="Ej: Crédito comercial 12 cuotas, tasa 12% anual...">${esc(loan?.notes || '')}</textarea></label>
    <button class="btn" type="submit">${isEdit ? 'Guardar cambios' : 'Guardar préstamo'}</button>
  </form>`);

  const f = $('#lnF'), el = f.elements;
  if (!isEdit) {
    const syncCash = () => {
      const mv = el.move_cash.value === '1';
      $('#lnAccW').classList.toggle('hidden', !mv);
      if (mv && el.acc) {
        const a = accs.find(x => String(x.id) === el.acc.value);
        const netCap = Math.max(0, (num(el.principal.value) || 0) - (num(el.already.value) || 0));
        const amt = a?.currency === 'VES' ? netCap * (S.rate || 0) : netCap;
        $('#lnAccBal').innerHTML = accBalanceLine(a, amt, el.kind.value === 'otorgado');
      }
    };
    el.move_cash.onchange = syncCash;
    el.kind.onchange = syncCash;
    el.principal.oninput = syncCash;
    el.already.oninput = syncCash;
    if (el.acc) el.acc.onchange = syncCash;
    el.freq.onchange = () => {
      el.next_due.value = nextLoanDate(el.start_date.value || hoy, el.freq.value);
    };
    syncCash();
  }

  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      if (isEdit) {
        await q(db.from('loans').update({
          lender_name: el.lender.value.trim(),
          phone: el.phone.value.trim() || null,
          installment_usd: Math.max(0, num(el.inst.value) || 0),
          total_installments: Math.max(0, parseInt(el.tot_inst.value || 0, 10) || 0),
          frequency: el.freq.value,
          next_due_date: el.next_due.value || null,
          notes: el.notes.value.trim() || null
        }).eq('id', loan.id));
        closeSheet(); toast('Préstamo actualizado'); render();
        return;
      }
      const lid = await q(db.rpc('registrar_prestamo', {
        p_kind: el.kind.value,
        p_lender_name: el.lender.value.trim(),
        p_phone: el.phone.value.trim() || null,
        p_principal_usd: num(el.principal.value),
        p_already_paid_usd: num(el.already.value) || 0,
        p_installment_usd: num(el.inst.value) || 0,
        p_total_installments: parseInt(el.tot_inst.value || 0, 10) || 0,
        p_frequency: el.freq.value,
        p_start_date: el.start_date.value || hoy,
        p_next_due_date: el.next_due.value || null,
        p_move_cash: el.move_cash.value === '1',
        p_account_id: el.move_cash.value === '1' ? +el.acc.value : null,
        p_rate: S.rate || 1,
        p_notes: el.notes.value.trim() || null
      }));
      closeSheet(); toast('Préstamo registrado'); render();
      await loanSheet(lid, accs);
    });
  };
}

function loanPayForm(loan, accs) {
  if (!accs.length) return toast('Primero crea al menos una cuenta en Finanzas > Cuentas', true);
  const isRec = loan.kind === 'recibido';
  const rem = Math.max(0, Number(loan.principal_usd || 0) - Number(loan.paid_principal_usd || 0));
  const defCap = loan.installment_usd > 0 ? Math.min(rem, Number(loan.installment_usd)) : rem;
  const hoy = caracasDate();
  const sugNext = nextLoanDate(loan.next_due_date || hoy, loan.frequency || 'mensual');
  const bi = S.bimoneda !== false;

  openSheet(isRec ? `Pagar cuota · ${esc(loan.lender_name)}` : `Cobrar abono · ${esc(loan.lender_name)}`, `<form id="lpF" class="stack">
    <p class="mut" style="margin:0">Saldo actual de capital: <b>${fmtCur(rem)}</b>${bi && S.rate ? ` (${fmtSec(rem * S.rate)})` : ''}</p>
    <div class="grid">
      <label>${isRec ? 'Pagar desde la cuenta' : 'Recibir en la cuenta'}<select name="acc">${acctOpts(accs, loan.account_id)}</select></label>
      <label>Fecha<input name="pdate" type="date" value="${hoy}" required></label>
    </div>
    <small id="lpAccBal" style="display:block;margin-top:-.45rem"></small>
    <label class="${bi ? '' : 'hidden'}">Tasa de cambio (${esc(secSym())} por ${esc(curLabel())})<input name="rate" type="number" step="0.0001" min="0.0001" value="${bi ? (S.rate || '') : 1}"></label>
    <div class="grid">
      <label>Abono a capital (${esc(curLabel())})
        <div class="row0" style="gap:.35rem">
          <input name="cap" type="number" step="0.01" min="0" value="${defCap.toFixed(2)}" style="margin:0;flex:1" required>
          <button type="button" class="btn ghost" id="lpFull" style="min-height:44px;padding:.35rem .65rem;font-size:.82rem;white-space:nowrap">Saldar</button>
        </div>
      </label>
      <label>Intereses / comisiones (${esc(curLabel())})<input name="int" type="number" step="0.01" min="0" value="0"></label>
    </div>
    <small class="mut" style="margin-top:-.35rem">${isRec ? 'El abono a capital baja tu deuda sin dañar tus ganancias; el monto en Intereses se registra solo como gasto financiero.' : 'El abono a capital reduce el saldo prestado.'}</small>
    <div id="lpSum" class="card" style="margin:0;padding:.7rem .85rem;background:var(--bg)"></div>
    <div class="grid">
      <label>Próxima fecha de pago (opcional)<input name="next_due" type="date" value="${esc(sugNext)}"></label>
      <label>Referencia bancaria<input name="ref" placeholder="Ej: 482910"></label>
    </div>
    <label>Nota (opcional)<input name="note" placeholder="Ej: Cuota del mes"></label>
    <button class="btn" type="submit">${isRec ? 'Registrar pago de cuota' : 'Registrar cobro'}</button>
  </form>`);

  const f = $('#lpF'), el = f.elements;
  const paint = () => {
    const a = accs.find(x => String(x.id) === el.acc.value);
    const rt = bi ? (Number(el.rate.value) || S.rate || 0) : 1;
    const cap = Math.max(0, num(el.cap.value) || 0);
    const intr = Math.max(0, num(el.int.value) || 0);
    const tot = cap + intr;
    const orig = a?.currency === 'VES' ? tot * rt : tot;
    const newRem = Math.max(0, rem - cap);
    $('#lpAccBal').innerHTML = accBalanceLine(a, orig, isRec);
    $('#lpSum').innerHTML = `
      <div class="rl" style="border:0;padding:.15rem 0"><span>Total que ${isRec ? 'sale' : 'entra'} de la cuenta</span><b>${fmtCur(tot)}${a?.currency === 'VES' && rt > 0 ? ' (' + fmtSec(orig) + ')' : ''}</b></div>
      <div class="rl" style="border:0;padding:.15rem 0"><span>Nuevo saldo de capital</span><b class="${newRem <= 0.01 ? 'in' : 'warn'}">${newRem <= 0.01 ? '¡Préstamo saldado!' : fmtCur(newRem)}</b></div>`;
  };
  paint();
  ['acc', 'rate', 'cap', 'int'].forEach(k => {
    el[k].addEventListener('input', paint);
    el[k].addEventListener('change', paint);
  });
  $('#lpFull').onclick = () => { el.cap.value = rem.toFixed(2); el.next_due.value = ''; paint(); };

  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await q(db.rpc('registrar_cuota_prestamo', {
        p_loan_id: loan.id,
        p_account_id: +el.acc.value,
        p_date: el.pdate.value || hoy,
        p_rate: bi ? (+el.rate.value || S.rate || 1) : 1,
        p_principal_usd: num(el.cap.value) || 0,
        p_interest_usd: num(el.int.value) || 0,
        p_reference: el.ref.value.trim() || null,
        p_note: el.note.value.trim() || null,
        p_next_due_date: el.next_due.value || null
      }));
      toast(res.status === 'pagado' ? '¡Préstamo saldado por completo!' : `Cuota registrada · Saldo restante: ${fmtCur(res.remaining_usd)}`);
      render();
      await loanSheet(loan.id, accs);
    });
  };
}
