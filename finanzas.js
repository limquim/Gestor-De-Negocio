// Finanzas: cuentas y métodos de pago, datos bancarios, aportes/retiros, cierre de caja y gastos
const num = (v) => +String(v ?? '').replace(',', '.');
const toUsd = (amt, cur) => cur === 'USD' ? +amt : (S.rate ? amt / S.rate : 0);
const money = (n, cur) => (cur === 'VES' ? fmtSec(n) : fmtCur(n));
const acctOpts = (accs, sel) => accs.map(a => {
  const bTxt = a.balance !== undefined && a.balance !== null ? ` · Disp: ${money(a.balance, a.currency)}` : '';
  return `<option value="${a.id}" ${String(a.id) === String(sel) ? 'selected' : ''}>${esc(a.name)} (${a.currency})${bTxt}</option>`;
}).join('');

function accBalanceLine(acc, payAmt = 0, isOutgoing = true) {
  if (!acc || acc.balance === undefined || acc.balance === null) return '';
  const bal = Number(acc.balance || 0);
  const amt = Math.max(0, Number(payAmt || 0));
  const cur = acc.currency || 'USD';
  const eq = cur === 'VES' && S.rate ? ` (≈ ${fmtCur(bal / S.rate)})` : '';
  if (!isOutgoing) {
    return `<span class="mut">Saldo actual en cuenta: <b>${money(bal, cur)}</b>${eq}</span>`;
  }
  if (bal <= 0 || (amt > 0 && amt > bal + 0.009)) {
    const falta = Math.max(0, amt - Math.max(bal, 0));
    return `<span class="bad">Saldo en cuenta: <b>${money(bal, cur)}</b>${eq} · ${amt > 0 ? `Saldo insuficiente (faltan ${money(falta, cur)})` : 'Sin saldo disponible'}</span>`;
  }
  const rest = bal - amt;
  return `<span class="in">Saldo disponible: <b>${money(bal, cur)}</b>${eq}${amt > 0 ? ` · Quedará: ${money(rest, cur)}` : ''}</span>`;
}

async function loadActiveAccounts() {
  const list = await loadAccountsRich();
  return list.filter(a => a.active !== false);
}
const MOVK = {
  cobro: 'Cobro', anulacion: 'Anulación', pago: 'Pago', gasto: 'Gasto',
  transferencia: 'Transferencia', ajuste: 'Ajuste', aporte: 'Aporte de capital',
  retiro: 'Retiro del dueño', nomina: 'Nómina', adelanto: 'Adelanto', reembolso: 'Reembolso'
};
const CC = {date: '', counts: {}, note: '', apply: false};
const GF = {q: '', acc: 'all', type: 'all'};

async function copyText(text, msg = 'Copiado al portapapeles') {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(msg);
  } catch (e) {
    toast('No se pudo copiar automáticamente', true);
  }
}

async function loadAccountsRich() {
  const [bal, raw] = await Promise.all([
    q(db.from('cuentas_saldo').select('*').order('id')),
    db.from('accounts').select('id,payment_details,is_default').then(r => r.error ? [] : (r.data || []))
  ]);
  const extra = Object.fromEntries(raw.map(x => [x.id, x]));
  return bal.map(a => ({
    ...a,
    payment_details: extra[a.id]?.payment_details || '',
    is_default: !!extra[a.id]?.is_default
  })).sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || a.id - b.id);
}

function paymentDetailsText(accs) {
  const list = (accs || []).filter(a => a.active !== false && (a.payment_details || '').trim());
  if (!list.length) return '';
  return 'Datos para realizar tu pago:\n\n' + list.map(a => `*${a.name} (${a.currency}):*\n${a.payment_details.trim()}`).join('\n\n');
}

async function getPaymentDetailsText() {
  try {
    const rows = await q(db.from('accounts').select('name,currency,payment_details,is_default').eq('active', true).order('is_default', {ascending: false}).order('id'));
    return paymentDetailsText(rows);
  } catch (e) { return ''; }
}

function methodNames(a) {
  const list = a?.methods?.length ? a.methods : [];
  return list.filter(k => METHODS[k] && !M_OFF.has(k)).map(k => METHODS[k]);
}

// Helper reutilizable para agregar métodos de pago y tipos de cuenta al vuelo
function renderMethodsField(selectedArr) {
  const sel = new Set(selectedArr && selectedArr.length ? selectedArr : ['efectivo']);
  const checks = Object.entries(METHODS).filter(([k]) => !M_OFF.has(k))
    .map(([k, v]) => `<label class="chk"><input type="checkbox" name="m_${esc(k)}" ${sel.has(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('');
  return `<div class="stack" style="gap:.45rem">
    <div class="title-row"><b class="mut">Métodos de pago que acepta esta cuenta</b><button type="button" class="lnk" data-m-all="1" style="font-size:.82rem">Marcar todos</button></div>
    <div class="stack" data-m-list="1" style="gap:.35rem">${checks}</div>
    <div class="row0" style="margin-top:.2rem">
      <input type="text" data-m-new="1" placeholder="Nuevo método (ej: Cashea, Binance, Zinli)" style="margin:0;flex:1">
      <button type="button" class="btn ghost" data-m-add="1" style="flex:none;white-space:nowrap">+ Agregar</button>
    </div>
  </div>`;
}

function bindQuickAccountHelpers(formEl) {
  const allBtn = formEl.querySelector('[data-m-all]');
  const listEl = formEl.querySelector('[data-m-list]');
  const newInp = formEl.querySelector('[data-m-new]');
  const addBtn = formEl.querySelector('[data-m-add]');
  const addTypeBtn = formEl.querySelector('[data-t-add]');
  const typeSel = formEl.elements.type_id;

  if (allBtn && listEl) {
    allBtn.onclick = () => {
      const cbs = [...listEl.querySelectorAll('input[type="checkbox"]')];
      const allChecked = cbs.every(c => c.checked);
      cbs.forEach(c => { c.checked = !allChecked; });
      allBtn.textContent = allChecked ? 'Marcar todos' : 'Desmarcar todos';
    };
  }

  const doAddMethod = () => run(async () => {
    const name = (newInp?.value || '').trim();
    if (!name) return toast('Escribe el nombre del nuevo método de pago', true);
    let created = null;
    try {
      created = await q(db.rpc('crear_metodo_pago', {p_name: name}));
    } catch (err) {
      // Respaldo si aún no se ejecutó el paso 20
      const code = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('metodo_' + Date.now());
      await q(db.from('payment_methods').insert({code, name, active: true}));
      created = {code, name};
    }
    await loadMethods();
    if (!METHODS[created.code]) METHODS[created.code] = created.name;
    M_OFF.delete(created.code);
    let existing = listEl.querySelector(`input[name="m_${CSS.escape(created.code)}"]`);
    if (existing) {
      existing.checked = true;
    } else {
      listEl.insertAdjacentHTML('beforeend', `<label class="chk"><input type="checkbox" name="m_${esc(created.code)}" checked> ${esc(created.name)}</label>`);
    }
    newInp.value = '';
    toast(`Método "${created.name}" agregado y marcado`);
  });

  if (addBtn) addBtn.onclick = doAddMethod;
  if (newInp) newInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddMethod(); } });

  if (addTypeBtn && typeSel) {
    addTypeBtn.onclick = () => run(async () => {
      const name = prompt('Nombre del nuevo tipo de cuenta (ej: Billetera digital, Cripto, Caja chica):');
      if (!name || !name.trim()) return;
      const ins = await q(db.from('account_types').insert({name: name.trim(), active: true}).select('id,name').single());
      typeSel.insertAdjacentHTML('beforeend', `<option value="${ins.id}">${esc(ins.name)}</option>`);
      typeSel.value = String(ins.id);
      toast(`Tipo "${ins.name}" creado`);
    });
  }
}

async function cajaStat() {
  const a = await q(db.from('cuentas_saldo').select('balance,currency').eq('active', true));
  const t = a.reduce((s, x) => s + toUsd(+x.balance, x.currency), 0);
  return `<button class="stat" data-go="finanzas"><span>Dinero disponible</span><b>${fmtCur(t)}</b><span>${S.rate ? fmt(t * S.rate) + ' Bs' : 'Sin tasa'}</span></button>`;
}

// ---------- Cuentas ----------
async function viewCuentas() {
  const [accs, types] = await Promise.all([
    loadAccountsRich(),
    q(db.from('account_types').select('id,name').eq('active', true).order('name'))
  ]);
  const act = accs.filter(a => a.active), tot = act.reduce((s, a) => s + toUsd(+a.balance, a.currency), 0), D = {types};
  const hasDetails = act.some(a => (a.payment_details || '').trim());

  $('#view').innerHTML = `<div class="stat" style="margin-bottom:1rem"><span>Dinero disponible</span><b>${fmtCur(tot)}</b><span>${S.rate ? fmt(tot * S.rate) + ' Bs' : 'Sin tasa cargada'}</span></div>
    <div class="row" style="margin:0 0 .8rem">
      <button class="btn ghost" id="acTr">Transferir</button>
      <button class="btn ghost" id="acCap">Aporte / Retiro</button>
      ${hasDetails ? '<button class="btn ghost" id="acCopyAll">Datos de pago</button>' : ''}
    </div>
    <div class="list" id="acL">${act.map(a => {
      const mList = methodNames(a);
      return `<button class="item" data-id="${a.id}"><span>
        <b>${esc(a.name)}${a.is_default ? ' <span class="badge ok" style="font-size:.7rem;vertical-align:middle">Principal</span>' : ''}</b>
        <small>${esc(a.type || 'Cuenta')} | ${a.currency}${a.payment_details ? ' | Con datos de pago' : ''}</small>
        ${mList.length ? `<small style="display:block;color:var(--pri)">Acepta: ${esc(mList.join(' · '))}</small>` : ''}
      </span>
      <span class="n"><b>${money(a.balance, a.currency)}</b>${a.currency === 'VES' && S.rate ? `<small>${fmtCur(a.balance / S.rate)}</small>` : ''}</span></button>`;
    }).join('') || '<p class="mut">No hay cuentas. Pulsa + para crear una.</p>'}</div>
    <button class="fab" id="acAdd" aria-label="Nueva cuenta">+</button>`;

  $('#acAdd').onclick = () => accForm(null, D);
  $('#acTr').onclick = () => transferForm(act);
  $('#acCap').onclick = () => capitalForm(act);
  if ($('#acCopyAll')) $('#acCopyAll').onclick = () => copyText(paymentDetailsText(act), 'Datos de pago copiados');
  $('#acL').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) run(() => accSheet(act.find(a => String(a.id) === b.dataset.id), D, act)); };
}

async function accSheet(a, D, allAccs) {
  const ms = await q(db.from('account_movements').select('amount,kind,note,created_at').eq('account_id', a.id).order('id', {ascending: false}).limit(60));
  const mList = methodNames(a);
  const det = (a.payment_details || '').trim();
  openSheet(esc(a.name), `<p>Saldo: <b>${money(a.balance, a.currency)}</b>${a.currency === 'VES' && S.rate ? ' (' + fmtCur(a.balance / S.rate) + ')' : ''}
    ${a.is_default ? '<br><span class="badge ok">Cuenta principal</span>' : ''}
    ${mList.length ? `<br><small class="mut">Métodos: ${esc(mList.join(', '))}</small>` : ''}</p>
    ${det ? `<div class="card" style="background:var(--bg);padding:.75rem;margin:.6rem 0">
      <small class="mut" style="display:block;margin-bottom:.3rem">Datos para recibir pagos</small>
      <pre class="ticket" style="max-width:none;padding:0;background:transparent">${esc(det)}</pre>
      <div class="row" style="margin-top:.5rem"><button class="btn ghost" id="aCopyDet">Copiar datos</button><button class="btn ghost" id="aWaDet">Enviar por WhatsApp</button></div>
    </div>` : ''}
    <div class="row"><button class="btn" id="aCap">Aporte / Retiro</button><button class="btn ghost" id="aAdj">Ajustar saldo</button><button class="btn ghost" id="aEdit">Editar</button></div>
    <h2 style="margin-top:1rem">Últimos movimientos</h2>
    <div class="chips sub" id="amF">
      <button data-k="all" class="on">Todos</button>
      <button data-k="cobro">Cobros</button>
      <button data-k="pago">Pagos</button>
      <button data-k="gasto">Gastos</button>
      <button data-k="capital">Aportes/Retiros</button>
      <button data-k="transferencia">Transf.</button>
      <button data-k="ajuste">Ajustes</button>
    </div>
    <div id="amTbl"></div>`);

  const drawMs = (k = 'all') => {
    const list = ms.filter(m => k === 'all' || (k === 'capital' ? ['aporte', 'retiro'].includes(m.kind) : m.kind === k));
    $('#amTbl').innerHTML = list.length
      ? `<div class="scroll"><table><tbody>${list.map(m => `<tr><td>${fdate(m.created_at)}</td><td>${MOVK[m.kind] || m.kind}<small>${esc(m.note)}</small></td><td class="n ${m.amount > 0 ? 'in' : 'outq'}">${m.amount > 0 ? '+' : ''}${fmt(m.amount)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="mut">Sin movimientos en este filtro.</p>';
  };
  drawMs('all');
  $('#amF').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#amF button').forEach(x => x.classList.toggle('on', x === b));
    drawMs(b.dataset.k);
  };
  if (det) {
    const txt = `*${a.name} (${a.currency}):*\n${det}`;
    $('#aCopyDet').onclick = () => copyText(txt, 'Datos de pago copiados');
    $('#aWaDet').onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
  }
  $('#aEdit').onclick = () => accForm(a, D);
  $('#aCap').onclick = () => capitalForm(allAccs || [a], a.id);
  $('#aAdj').onclick = () => {
    const v = prompt(`Saldo real que hay hoy en ${a.name} (${a.currency}):`, a.balance); if (v === null || v === '') return;
    run(async () => { await q(db.rpc('registrar_ajuste_cuenta', {p_account_id: a.id, p_new_balance: num(v), p_note: null})); closeSheet(); toast('Saldo ajustado'); render(); });
  };
}

function accForm(a, D) {
  openSheet(a ? 'Editar cuenta' : 'Nueva cuenta', `<form id="aF" class="stack">
    <label>Nombre<input name="aname" required value="${esc(a?.name)}" placeholder="Ej: Banco Venezuela, Caja USD, Binance"></label>
    <div class="row0" style="align-items:end">
      <label style="flex:1">Tipo<select name="type_id">${D.types.map(t => `<option value="${t.id}" ${t.id === a?.type_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <button type="button" class="btn ghost" data-t-add="1" aria-label="Nuevo tipo de cuenta" style="flex:none">+</button>
    </div>
    <div class="grid">
      <label>Moneda<select name="cur" ${a ? 'disabled' : ''}><option value="USD">Moneda principal (${esc(curLabel())})</option><option value="VES">Bolívares (${esc(secSym())})</option></select></label>
      <label>Saldo inicial<input name="open" type="number" step="0.01" value="${a ? a.opening_balance : 0}"></label>
    </div>
    ${renderMethodsField(a?.methods)}
    <label>Datos para recibir pagos (opcional, para copiar/enviar por WhatsApp)
      <textarea name="pdet" rows="3" placeholder="Ej: Pago Móvil: Banco Venezuela (0102)&#10;Tlf: 0414-0000000 | CI: V-12345678">${esc(a?.payment_details || '')}</textarea>
    </label>
    <label class="chk"><input type="checkbox" name="is_def" ${a?.is_default ? 'checked' : ''}> Usar como cuenta principal (aparece primero al cobrar o pagar)</label>
    <div class="row"><button class="btn" type="submit">Guardar</button>${a ? '<button type="button" class="btn ghost" id="aDel">Desactivar</button>' : ''}</div>
  </form>`);
  const f = $('#aF'), el = f.elements;
  if (a) el.cur.value = a.currency;
  bindQuickAccountHelpers(f);

  f.onsubmit = (e) => {
    e.preventDefault();
    const methods = [...f.querySelectorAll('[data-m-list] input[type="checkbox"]:checked')].map(c => c.name.slice(2));
    if (!methods.length) return toast('Elige al menos un método de pago', true);
    const baseRow = {
      name: el.aname.value.trim(),
      type_id: +el.type_id.value || null,
      opening_balance: num(el.open.value) || 0,
      methods
    };
    if (!a) baseRow.currency = el.cur.value;
    const extraRow = {
      payment_details: el.pdet.value.trim() || null,
      is_default: !!el.is_def.checked
    };
    run(async () => {
      let accId = a?.id;
      try {
        const res = await q(a
          ? db.from('accounts').update({...baseRow, ...extraRow}).eq('id', a.id).select('id').single()
          : db.from('accounts').insert({...baseRow, ...extraRow}).select('id').single());
        accId = res.id;
        if (extraRow.is_default && accId) {
          await db.rpc('marcar_cuenta_predeterminada', {p_account_id: accId});
        }
      } catch (err) {
        // Respaldo si aún no se ejecutó el paso 20 en Supabase
        if (/payment_details|is_default/i.test(err.message || '')) {
          await q(a ? db.from('accounts').update(baseRow).eq('id', a.id) : db.from('accounts').insert(baseRow));
        } else {
          throw err;
        }
      }
      closeSheet(); toast('Cuenta guardada'); render();
    });
  };
  if (a) $('#aDel').onclick = () => run(async () => {
    if (!confirm('¿Desactivar esta cuenta? Deja de aparecer en ventas y pagos.')) return;
    await q(db.from('accounts').update({active: false}).eq('id', a.id)); closeSheet(); render();
  });
}

function capitalForm(accs, preId) {
  if (!accs.length) return toast('Primero crea al menos una cuenta', true);
  openSheet('Aporte de capital o Retiro del dueño', `<form id="cpF" class="stack">
    <p class="mut" style="margin:0">Registra dinero que entra por aporte propio o que el dueño retira. Esto actualiza tu saldo en caja sin dañar tus reportes de ventas ni gastos.</p>
    <label>Tipo de movimiento<select name="kind">
      <option value="aporte">Aporte de capital (entra dinero a la cuenta)</option>
      <option value="retiro">Retiro del dueño / socio (sale dinero de la cuenta)</option>
    </select></label>
    <label>Cuenta<select name="acc">${acctOpts(accs, preId)}</select></label>
    <small id="cpBal" style="display:block;margin-top:-.45rem"></small>
    <label>Monto (en la moneda de la cuenta)<input name="amt" type="number" step="0.01" min="0.01" required></label>
    <p class="mut" id="cpEq" style="margin:0"></p>
    <label>Nota<input name="note" placeholder="Ej: inyección para mercancía / retiro semanal"></label>
    <button class="btn" type="submit">Registrar movimiento</button>
  </form>`);
  const f = $('#cpF'), el = f.elements;
  const updEq = () => {
    const a = accs.find(x => String(x.id) === el.acc.value), v = num(el.amt.value) || 0;
    $('#cpBal').innerHTML = accBalanceLine(a, v, el.kind.value === 'retiro');
    if (!a || !v) { $('#cpEq').textContent = ''; return; }
    $('#cpEq').textContent = a.currency === 'USD'
      ? (S.rate ? `Equivale a ${fmt(v * S.rate)} Bs` : '')
      : (S.rate ? `Equivale a ${fmtCur(v / S.rate)}` : '');
  };
  updEq();
  el.kind.onchange = updEq; el.acc.onchange = updEq; el.amt.oninput = updEq;
  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await q(db.rpc('registrar_movimiento_capital', {
        p_account_id: +el.acc.value,
        p_kind: el.kind.value,
        p_amount: num(el.amt.value),
        p_note: el.note.value.trim() || null
      }));
      closeSheet();
      toast(el.kind.value === 'aporte' ? 'Aporte de capital registrado' : 'Retiro registrado');
      render();
    });
  };
}

function transferForm(accs) {
  if (accs.length < 2) return toast('Necesitas al menos dos cuentas', true);
  openSheet('Transferir entre cuentas', `<form id="tF" class="stack"><label>Desde<select name="from">${acctOpts(accs)}</select></label>
    <small id="tFromBal" style="display:block;margin-top:-.45rem"></small>
    <label>Hacia<select name="to">${acctOpts(accs, accs[1].id)}</select></label>
    <label>Monto que sale<input name="out" type="number" step="0.01" min="0.01" required></label>
    <label>Monto que entra<input name="inn" type="number" step="0.01" min="0.01" required></label>
    <p class="mut">Si cambias de moneda, el monto que entra se calcula con la tasa del día y puedes corregirlo.</p>
    <label>Nota<input name="note" placeholder="Ej: cambio de dólares a bolívares"></label><button class="btn" type="submit">Transferir</button></form>`);
  const el = $('#tF').elements, cur = (id) => accs.find(a => String(a.id) === id)?.currency;
  const conv = () => {
    const o = num(el.out.value) || 0, fa = accs.find(a => String(a.id) === el.from.value), f = fa?.currency, t = cur(el.to.value);
    $('#tFromBal').innerHTML = accBalanceLine(fa, o, true);
    if (o) el.inn.value = (f === t ? o : f === 'USD' ? o * (S.rate || 0) : o / (S.rate || 1)).toFixed(2);
  };
  conv();
  ['out', 'from', 'to'].forEach(k => { el[k].addEventListener('input', conv); el[k].addEventListener('change', conv); });
  $('#tF').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await q(db.rpc('registrar_transferencia', {p_from: +el.from.value, p_to: +el.to.value, p_out: num(el.out.value), p_in: num(el.inn.value), p_note: el.note.value.trim() || null}));
      closeSheet(); toast('Transferencia registrada'); render();
    });
  };
}

// ---------- Cierre / Cuadre de caja diario ----------
async function viewCierreCaja() {
  if (!CC.date) CC.date = caracasDate();
  const day = CC.date, fromTs = day + 'T00:00:00-04:00', toTs = day + 'T23:59:59-04:00';
  const toCaracasDay = (v) => {
    if (!v) return '';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d.getTime()) ? s.slice(0, 10) : d.toLocaleDateString('en-CA', {timeZone: 'America/Caracas'});
  };
  const [accsAll, allPays, moves, closings] = await Promise.all([
    loadAccountsRich(),
    db.from('payments').select('*').order('id', {ascending: false}).limit(500).then(r => r.error ? [] : (r.data || [])),
    q(db.from('account_movements').select('account_id,kind,amount,note,created_at,accounts(name,currency)').gte('created_at', fromTs).lte('created_at', toTs).order('id')),
    db.from('cash_closings').select('*').order('closing_date', {ascending: false}).order('id', {ascending: false}).limit(15).then(r => r.error ? [] : (r.data || []))
  ]);
  const rawSaleIds = [...new Set(allPays.filter(p => p.sale_id).map(p => p.sale_id))];
  const rawPurIds = [...new Set(allPays.filter(p => p.purchase_id).map(p => p.purchase_id))];
  const [salesMeta, pursMeta] = await Promise.all([
    rawSaleIds.length ? q(db.from('sales').select('id,status,sale_date').in('id', rawSaleIds)) : [],
    rawPurIds.length ? q(db.from('purchases').select('id,status,purchase_date').in('id', rawPurIds)) : []
  ]);
  const saleInfo = new Map(salesMeta.map(x => [x.id, x]));
  const purInfo = new Map(pursMeta.map(x => [x.id, x]));
  const badSales = new Set(salesMeta.filter(x => x.status === 'anulada').map(x => x.id));
  const badPurs = new Set(pursMeta.filter(x => x.status === 'anulada').map(x => x.id));
  const pays = allPays.filter(p => {
    const rawDt = p.paid_at || p.payment_date || p.created_at || p.date || p.fecha
      || (p.sale_id ? saleInfo.get(p.sale_id)?.sale_date : null)
      || (p.purchase_id ? purInfo.get(p.purchase_id)?.purchase_date : null);
    return toCaracasDay(rawDt) === day;
  });
  const accs = accsAll.filter(a => a.active);
  accs.forEach(a => {
    if (CC.counts[a.id] === undefined) CC.counts[a.id] = Number(a.balance || 0).toFixed(2);
  });

  // Agrupar cobros de ventas del día por método de pago (excluyendo ventas/compras anuladas)
  const byMethodMap = {};
  let cobrosUsd = 0, pagosProvUsd = 0;
  pays.forEach(p => {
    if (p.sale_id && badSales.has(p.sale_id)) return;
    if (p.purchase_id && badPurs.has(p.purchase_id)) return;
    if (p.sale_id && +p.amount > 0) {
      const k = p.method || 'otro';
      const m = byMethodMap[k] || (byMethodMap[k] = {code: k, name: METHODS[k] || k, count: 0, usd: 0, origUsd: 0, origVes: 0});
      m.count++;
      m.usd += +p.amount_usd || 0;
      if (p.currency === 'USD') m.origUsd += +p.amount || 0;
      else m.origVes += +p.amount || 0;
      cobrosUsd += +p.amount_usd || 0;
    } else if (p.purchase_id) {
      pagosProvUsd += Math.abs(+p.amount_usd || 0);
    }
  });
  const byMethodArr = Object.values(byMethodMap).sort((a, b) => b.usd - a.usd);

  // Resumen de movimientos del día por tipo
  const movByKind = {};
  moves.forEach(m => {
    const k = MOVK[m.kind] || m.kind;
    const usd = toUsd(+m.amount, m.accounts?.currency || 'USD');
    movByKind[k] = (movByKind[k] || 0) + usd;
  });

  const buildDetails = () => accs.map(a => {
    const sys = Number(a.balance || 0);
    const raw = CC.counts[a.id];
    const cnt = raw === '' || raw === undefined ? sys : num(raw);
    const diff = Math.round((cnt - sys) * 100) / 100;
    return {
      account_id: a.id, name: a.name, currency: a.currency,
      system_balance: sys, counted_balance: cnt, diff,
      system_usd: toUsd(sys, a.currency), counted_usd: toUsd(cnt, a.currency), diff_usd: toUsd(diff, a.currency)
    };
  });

  const summaryText = () => {
    const det = buildDetails();
    const tSys = det.reduce((s, x) => s + x.system_usd, 0), tCnt = det.reduce((s, x) => s + x.counted_usd, 0), tDiff = tCnt - tSys;
    const lines = [
      `*CIERRE DE CAJA - ${dmy(day)}*`,
      S.rate ? `Tasa: ${fmt(S.rate, 4)} ${secSym()}/${curLabel()}` : '',
      '',
      '*Cobros por método:*',
      ...(byMethodArr.length ? byMethodArr.map(m => `- ${m.name} (${m.count}): ${fmtCur(m.usd)}${m.origVes ? ` [${fmt(m.origVes)} Bs]` : ''}`) : ['- Sin cobros registrados']),
      `Total cobrado: ${fmtCur(cobrosUsd)}`,
      '',
      '*Arqueo por cuenta:*',
      ...det.map(d => `- ${d.name}: Sistema ${money(d.system_balance, d.currency)} | Real ${money(d.counted_balance, d.currency)} (${d.diff === 0 ? 'Cuadrado' : (d.diff > 0 ? '+' : '') + money(d.diff, d.currency)})`),
      '',
      `Total sistema: ${fmtCur(tSys)}`,
      `Total contado: ${fmtCur(tCnt)}`,
      `Diferencia: ${tDiff >= 0 ? '+' : ''}${fmtCur(tDiff)}`,
      CC.note ? `Nota: ${CC.note}` : ''
    ].filter(x => x !== '');
    return lines.join('\n');
  };

  $('#view').innerHTML = `
    <div class="card stack">
      <div class="title-row"><h2>Cierre y cuadre de caja</h2><input id="ccDate" type="date" value="${esc(day)}" style="width:auto;margin:0"></div>
      <p class="mut" style="margin:0">Revisa cuánto entró por cada método de pago y compara el saldo del sistema contra el dinero físico / bancario real.</p>
    </div>

    <div class="stats">
      <div class="stat"><span>Cobros del día</span><b>${fmtCur(cobrosUsd)}</b><span>${S.rate ? fmt(cobrosUsd * S.rate) + ' Bs' : ''}</span></div>
      <div class="stat"><span>Pagos a proveedores</span><b>${fmtCur(pagosProvUsd)}</b></div>
    </div>

    <div class="card">
      <h2>Cobros del día por método de pago</h2>
      ${byMethodArr.length ? byMethodArr.map(m => `<div class="rl">
        <span><b>${esc(m.name)}</b> <small class="mut">(${m.count} ${m.count === 1 ? 'pago' : 'pagos'})</small>
        ${m.origUsd || m.origVes ? `<small class="mut" style="display:block">${[m.origUsd ? fmtCur(m.origUsd) : '', m.origVes ? fmt(m.origVes) + ' Bs' : ''].filter(Boolean).join(' + ')}</small>` : ''}</span>
        <b>${fmtCur(m.usd)}</b>
      </div>`).join('') : '<p class="mut">No se registraron cobros de ventas en esta fecha.</p>'}
    </div>

    <div class="card">
      <h2>Resumen de movimientos del día (${esc(curLabel())} aprox.)</h2>
      ${Object.keys(movByKind).length ? Object.entries(movByKind).map(([k, v]) => `<div class="rl"><span>${esc(k)}</span><b class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${fmtCur(v)}</b></div>`).join('')
        : '<p class="mut">Sin movimientos de cuentas en esta fecha.</p>'}
    </div>

    <div class="card stack">
      <h2>Arqueo por cuenta (hoy)</h2>
      <p class="mut" style="margin:0">Escribe cuánto dinero real hay en cada cuenta. El sistema calcula automáticamente sobrantes o faltantes.</p>
      <div class="list" id="ccAccs">
        ${accs.map(a => `<div class="item" data-aid="${a.id}" style="gap:.6rem;align-items:center">
          <span style="flex:1">
            <b>${esc(a.name)} (${a.currency})</b>
            <small>Sistema: ${money(a.balance, a.currency)}</small>
            <small class="ccDiff" style="display:block"></small>
          </span>
          <label style="width:8.5rem;margin:0">Conteo real<input data-cnt="${a.id}" type="number" step="0.01" value="${esc(CC.counts[a.id])}"></label>
        </div>`).join('') || '<p class="mut">No hay cuentas activas.</p>'}
      </div>
      <div id="ccTot"></div>
      <label class="chk"><input type="checkbox" id="ccApply" ${CC.apply ? 'checked' : ''}> Aplicar diferencias como ajuste de arqueo en las cuentas</label>
      <label>Nota del cierre<input id="ccNote" value="${esc(CC.note)}" placeholder="Ej: cierre turno tarde sin novedad"></label>
      <div class="row">
        <button class="btn" id="ccSave">Guardar cierre de caja</button>
        <button class="btn ghost" id="ccWa">Compartir por WhatsApp</button>
      </div>
    </div>

    <div class="card">
      <h2>Historial de cierres recientes</h2>
      <div class="list" id="ccHist">
        ${closings.map((c, i) => `<button class="item" data-ci="${i}">
          <span><b>Cierre ${dmy(c.closing_date)}</b><small>${esc(c.closed_by || 'Usuario')}${c.adjustments_applied ? ' | Con ajuste' : ''}${c.note ? ' | ' + esc(c.note) : ''}</small></span>
          <span class="n"><b>${fmtCur(c.total_counted_usd)}</b><small class="${+c.diff_usd === 0 ? 'in' : +c.diff_usd > 0 ? 'in' : 'outq'}">${+c.diff_usd === 0 ? 'Cuadrado' : (+c.diff_usd > 0 ? '+' : '') + fmtCur(c.diff_usd)}</small></span>
        </button>`).join('') || '<p class="mut">Aún no hay cierres de caja guardados.</p>'}
      </div>
    </div>`;

  const paintArqueo = () => {
    const det = buildDetails();
    det.forEach(d => {
      const el = document.querySelector(`#ccAccs [data-aid="${d.account_id}"] .ccDiff`);
      if (!el) return;
      if (Math.abs(d.diff) < 0.01) {
        el.className = 'ccDiff in'; el.textContent = 'Cuadrado';
      } else if (d.diff > 0) {
        el.className = 'ccDiff in'; el.textContent = `Sobrante: +${money(d.diff, d.currency)}`;
      } else {
        el.className = 'ccDiff outq'; el.textContent = `Faltante: ${money(d.diff, d.currency)}`;
      }
    });
    const tSys = det.reduce((s, x) => s + x.system_usd, 0), tCnt = det.reduce((s, x) => s + x.counted_usd, 0), tDiff = tCnt - tSys;
    $('#ccTot').innerHTML = `
      <div class="rl"><span>Total en sistema</span><b>${fmtCur(tSys)}</b></div>
      <div class="rl"><span>Total contado real</span><b>${fmtCur(tCnt)}</b></div>
      <div class="rl tot ${Math.abs(tDiff) < 0.01 ? 'pos' : tDiff > 0 ? 'pos' : 'neg'}"><span>Diferencia total</span><b>${Math.abs(tDiff) < 0.01 ? 'Cuadrado (' + fmtCur(0) + ')' : fmtCurSigned(tDiff)}</b></div>`;
  };
  paintArqueo();

  $('#ccDate').onchange = (e) => { CC.date = e.target.value || caracasDate(); render(); };
  $('#ccAccs').addEventListener('input', (e) => { if (e.target.dataset.cnt) { CC.counts[e.target.dataset.cnt] = e.target.value; paintArqueo(); } });
  $('#ccApply').onchange = (e) => { CC.apply = e.target.checked; };
  $('#ccNote').oninput = (e) => { CC.note = e.target.value; };
  $('#ccWa').onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(summaryText())}`, '_blank');

  $('#ccSave').onclick = () => run(async () => {
    const det = buildDetails();
    const hasDiff = det.some(d => Math.abs(d.diff) >= 0.01);
    const msg = CC.apply && hasDiff
      ? 'Se guardará el cierre de caja y se ajustarán los saldos de las cuentas con diferencia. ¿Continuar?'
      : '¿Guardar este cierre de caja en el historial?';
    if (!confirm(msg)) return;
    await q(db.rpc('registrar_cierre_caja', {
      p_date: day,
      p_rate: S.rate || 1,
      p_details: det,
      p_by_method: byMethodArr,
      p_apply_adjustments: !!CC.apply,
      p_note: CC.note.trim() || null
    }));
    CC.counts = {}; CC.note = ''; CC.apply = false;
    toast('Cierre de caja guardado');
    render();
  });

  $('#ccHist').onclick = (e) => {
    const b = e.target.closest('[data-ci]'); if (!b) return;
    const c = closings[+b.dataset.ci];
    const det = Array.isArray(c.details) ? c.details : [];
    const met = Array.isArray(c.by_method) ? c.by_method : [];
    openSheet(`Cierre del ${dmy(c.closing_date)}`, `
      <p class="mut">Realizado por: <b>${esc(c.closed_by || 'Usuario')}</b> | ${fdate(c.created_at)}${c.note ? '<br>Nota: ' + esc(c.note) : ''}</p>
      <div class="rl"><span>Sistema</span><b>${fmtCur(c.total_system_usd)}</b></div>
      <div class="rl"><span>Contado</span><b>${fmtCur(c.total_counted_usd)}</b></div>
      <div class="rl tot ${+c.diff_usd >= 0 ? 'pos' : 'neg'}"><span>Diferencia</span><b>${+c.diff_usd >= 0 ? '+' : ''}${fmtCur(c.diff_usd)}</b></div>
      ${met.length ? `<h2 style="margin-top:1rem">Cobros por método</h2>${met.map(m => `<div class="rl"><span>${esc(m.name)} (${m.count})</span><b>${fmtCur(m.usd)}</b></div>`).join('')}` : ''}
      ${det.length ? `<h2 style="margin-top:1rem">Detalle por cuenta</h2><div class="scroll"><table><thead><tr><th>Cuenta</th><th class="n">Sistema</th><th class="n">Real</th><th class="n">Dif.</th></tr></thead><tbody>
        ${det.map(d => `<tr><td>${esc(d.name)}</td><td class="n">${money(d.system_balance, d.currency)}</td><td class="n">${money(d.counted_balance, d.currency)}</td><td class="n ${+d.diff < 0 ? 'outq' : 'in'}">${+d.diff > 0 ? '+' : ''}${fmt(d.diff)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    `);
  };
}

// ---------- Gastos (con gastos fijos recurrentes del mes, búsqueda y filtros) ----------
async function viewGastos() {
  const hoy = caracasDate(), curYm = hoy.slice(0, 7), curDay = parseInt(hoy.slice(8, 10), 10) || 1;
  const [rows, types, accs, recRes] = await Promise.all([
    q(db.from('expenses').select('*, expense_types(name,is_fixed), accounts(name)').order('id', {ascending: false}).limit(100)),
    q(db.from('expense_types').select('id,name,is_fixed').eq('active', true).order('name')),
    loadAccountsRich().then(l => l.filter(a => a.active)),
    db.from('recurring_expenses').select('*').eq('active', true).order('due_day').order('name').then(r => ({rows: r.error ? [] : (r.data || []), missing: !!r.error}))
  ]);
  const recs = recRes.rows;

  // Abre el formulario de gasto (nuevo o precargado desde un gasto fijo recurrente)
  const openExpenseSheet = (preRec = null) => {
    const defAcc = preRec?.account_id ? accs.find(a => String(a.id) === String(preRec.account_id)) : accs[0];
    const defCur = defAcc?.currency || 'USD';
    let defAmt = '';
    if (preRec && Number(preRec.amount) > 0) {
      if (preRec.currency === defCur) defAmt = Number(preRec.amount).toFixed(2);
      else if (defCur === 'VES' && S.rate) defAmt = (Number(preRec.amount) * S.rate).toFixed(2);
      else if (defCur === 'USD' && S.rate) defAmt = (Number(preRec.amount) / S.rate).toFixed(2);
    }
    const defDesc = preRec ? `${preRec.name} (${curYm})` : '';
    openSheet(preRec ? 'Pagar gasto fijo: ' + esc(preRec.name) : 'Nuevo gasto', `<form id="gF" class="stack">
      <label>Tipo de gasto<select name="type">${types.map(t => `<option value="${t.id}" ${preRec && String(t.id) === String(preRec.expense_type_id) ? 'selected' : ''}>${esc(t.name)}${t.is_fixed ? ' (fijo)' : ''}</option>`).join('')}</select></label>
      <label>Descripción<input name="desc" value="${esc(defDesc)}" placeholder="Ej: pago de alquiler de octubre"></label>
      <label>Pagado desde<select name="acc">${acctOpts(accs, defAcc?.id)}</select></label>
      <small id="gAccBal" style="display:block;margin-top:-.45rem"></small>
      <label>Monto (en la moneda de la cuenta)<input name="amount" type="number" step="0.01" min="0.01" value="${esc(defAmt)}" required></label>
      <label>Fecha<input name="date" type="date" value="${hoy}"></label>
      <button class="btn" type="submit">${preRec ? 'Registrar pago del mes' : 'Registrar gasto'}</button></form>`);
    const el = $('#gF').elements; let pc = defCur;
    const paintGBal = () => {
      const a = accs.find(x => String(x.id) === el.acc.value);
      $('#gAccBal').innerHTML = accBalanceLine(a, num(el.amount.value) || 0, true);
    };
    paintGBal();
    el.amount.oninput = paintGBal;
    el.acc.onchange = () => {
      const nc = accs.find(a => String(a.id) === el.acc.value)?.currency, v = num(el.amount.value);
      if (v && nc !== pc) el.amount.value = (nc === 'VES' ? v * (S.rate || 0) : v / (S.rate || 1)).toFixed(2);
      pc = nc;
      paintGBal();
    };
    $('#gF').onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const payDate = el.date.value || hoy;
        await q(db.rpc('registrar_gasto', {p_type_id: +el.type.value || null, p_desc: el.desc.value.trim() || null, p_account_id: +el.acc.value, p_amount: num(el.amount.value), p_date: payDate, p_rate: S.rate}));
        if (preRec) {
          try { await q(db.from('recurring_expenses').update({last_paid_ym: payDate.slice(0, 7), last_paid_at: payDate}).eq('id', preRec.id)); } catch (err) {}
        }
        closeSheet(); toast(preRec ? `Gasto fijo "${preRec.name}" pagado` : 'Gasto registrado'); render();
      });
    };
  };

  // Formulario para crear o editar un gasto fijo recurrente
  const openRecForm = (rec = null) => {
    const fixedFirst = [...types].sort((a, b) => (b.is_fixed ? 1 : 0) - (a.is_fixed ? 1 : 0));
    openSheet(rec ? 'Editar gasto fijo' : 'Nuevo gasto fijo mensual', `<form id="rcF" class="stack">
      <p class="mut" style="margin:0">Configura gastos mensuales (alquiler, internet, luz, etc.) para recibir recordatorios y pagarlos en 1 toque.</p>
      <label>Nombre del gasto fijo<input name="rname" value="${esc(rec?.name || '')}" placeholder="Ej: Alquiler del local, Internet" required></label>
      <label>Tipo de gasto<select name="etype">${fixedFirst.map(t => `<option value="${t.id}" ${rec && String(t.id) === String(rec.expense_type_id) ? 'selected' : ''}>${esc(t.name)}${t.is_fixed ? ' (fijo)' : ''}</option>`).join('')}</select></label>
      <div class="grid">
        <label>Moneda<select name="cur"><option value="USD" ${(rec?.currency || 'USD') === 'USD' ? 'selected' : ''}>Moneda principal (${esc(curLabel())})</option><option value="VES" ${rec?.currency === 'VES' ? 'selected' : ''}>Bolívares (${esc(secSym())})</option></select></label>
        <label>Monto estimado<input name="amt" type="number" step="0.01" min="0" value="${rec ? Number(rec.amount || 0) : ''}" required></label>
      </div>
      <div class="grid">
        <label>Día de pago al mes (1-31)<input name="day" type="number" min="1" max="31" value="${rec?.due_day || 1}" required></label>
        <label>Cuenta habitual<select name="acc"><option value="">Cualquiera</option>${acctOpts(accs, rec?.account_id)}</select></label>
      </div>
      <label>Nota (opcional)<input name="note" value="${esc(rec?.note || '')}" placeholder="Ej: transferir a propietario"></label>
      <div class="row"><button class="btn" type="submit">Guardar</button>${rec ? '<button type="button" class="btn ghost" id="rcDel" style="color:var(--bad)">Eliminar</button>' : ''}</div>
    </form>`);
    const el = $('#rcF').elements;
    $('#rcF').onsubmit = (e) => {
      e.preventDefault();
      const obj = {
        name: el.rname.value.trim(),
        expense_type_id: +el.etype.value || null,
        account_id: +el.acc.value || null,
        currency: el.cur.value,
        amount: Math.max(0, num(el.amt.value) || 0),
        due_day: Math.min(31, Math.max(1, parseInt(el.day.value, 10) || 1)),
        note: el.note.value.trim() || null
      };
      run(async () => {
        try {
          await q(rec ? db.from('recurring_expenses').update(obj).eq('id', rec.id) : db.from('recurring_expenses').insert(obj));
        } catch (err) {
          if (/recurring_expenses/i.test(err.message || '')) {
            throw new Error('No se pudo guardar el gasto fijo.');
          }
          throw err;
        }
        closeSheet(); toast('Gasto fijo guardado'); render();
      });
    };
    if (rec) $('#rcDel').onclick = () => run(async () => {
      if (!confirm('¿Quitar este gasto fijo de los recordatorios mensuales?')) return;
      await q(db.from('recurring_expenses').update({active: false}).eq('id', rec.id));
      closeSheet(); toast('Gasto fijo eliminado'); render();
    });
  };

  const paidRecCnt = recs.filter(r => r.last_paid_ym === curYm).length;
  const pendRecUsd = recs.filter(r => r.last_paid_ym !== curYm).reduce((s, r) => s + toUsd(r.amount, r.currency), 0);
  const recCard = `<div class="card stack" style="margin-bottom:.8rem">
    <div class="title-row">
      <h2>Gastos fijos del mes (${curYm})</h2>
      <button type="button" class="lnk" id="rcAdd">+ Nuevo fijo</button>
    </div>
    ${recs.length ? `<small class="mut">Pagados <b>${paidRecCnt} de ${recs.length}</b>${pendRecUsd > 0.01 ? ` · Pendiente del mes: <b>${fmtCur(pendRecUsd)}</b>` : ' · Todo al día este mes'}</small>
      <div class="list" id="rcL">${recs.map(r => {
        const isPaid = r.last_paid_ym === curYm;
        const overdue = !isPaid && r.due_day < curDay;
        const soon = !isPaid && !overdue && r.due_day <= curDay + 3;
        const bCls = isPaid ? 'ok' : overdue ? 'out' : soon ? 'low' : '';
        const bTxt = isPaid ? 'Pagado' : overdue ? `Vencido (día ${r.due_day})` : soon ? `Vence día ${r.due_day}` : `Día ${r.due_day}`;
        return `<div class="item" style="gap:.5rem;align-items:center">
          <button type="button" class="lnk" data-redit="${r.id}" style="flex:1;text-align:left;padding:0;color:var(--ink);font-weight:400">
            <b>${esc(r.name)}</b>
            <small style="display:block;color:var(--mut)">${money(r.amount, r.currency)} · <span class="badge ${bCls}" style="font-size:.72rem">${bTxt}</span></small>
          </button>
          ${isPaid ? '<span class="pos" style="font-weight:700;font-size:.82rem">Listo</span>' : `<button type="button" class="btn" data-rpay="${r.id}" style="min-height:38px;padding:.35rem .75rem;font-size:.85rem">Pagar</button>`}
        </div>`;
      }).join('')}</div>`
      : '<p class="mut" style="margin:0">Registra tus gastos fijos mensuales (alquiler, internet, luz, etc.) para recibir recordatorios y pagarlos en 1 toque.</p>'}
  </div>`;

  $('#view').innerHTML = `${recCard}
    <div class="card stack" style="margin-bottom:.8rem">
      <input id="gQ" type="search" placeholder="Buscar gasto por descripción..." value="${esc(GF.q)}">
      <div class="grid">
        <label>Cuenta<select id="gFA"><option value="all">Todas las cuentas</option>${accs.map(a => `<option value="${a.id}" ${String(a.id) === GF.acc ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label>Tipo<select id="gFT"><option value="all">Todos los tipos</option>${types.map(t => `<option value="${t.id}" ${String(t.id) === GF.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      </div>
      <p class="mut" id="gSum" style="margin:0"></p>
    </div>
    <div class="list" id="gL"></div>
    <button class="fab" id="gAdd" aria-label="Nuevo gasto">+</button>`;

  const drawG = () => {
    const t = GF.q.toLowerCase();
    const list = rows.filter(g =>
      (GF.acc === 'all' || String(g.account_id) === GF.acc) &&
      (GF.type === 'all' || String(g.expense_type_id) === GF.type) &&
      (!t || ((g.description || '') + ' ' + (g.expense_types?.name || '') + ' ' + (g.accounts?.name || '')).toLowerCase().includes(t))
    );
    const tot = list.filter(g => g.status !== 'anulado').reduce((s, g) => s + +g.amount_usd, 0);
    $('#gSum').innerHTML = `Mostrando <b>${list.length}</b> gastos | Total activo: <b>${fmtCur(tot)}</b>${S.rate ? ' (' + fmt(tot * S.rate) + ' Bs)' : ''}`;
    $('#gL').innerHTML = list.map(g => `<button class="item" data-id="${g.id}"><span><b>${esc(g.description || g.expense_types?.name || 'Gasto')}</b>
      <small>${g.expense_date} | ${esc(g.expense_types?.name || 'Sin tipo')} | ${g.expense_types?.is_fixed ? 'Fijo' : 'Variable'}</small><small>${esc(g.accounts?.name || 'Sin cuenta')}</small></span>
      <span class="n ${g.status === 'anulado' ? 'mut' : ''}"><b>${fmtCur(g.amount_usd)}</b>${g.status === 'anulado' ? '<small>Anulado</small>' : ''}</span></button>`).join('') || '<p class="mut">No hay gastos con ese filtro.</p>';
  };
  drawG();

  $('#rcAdd').onclick = () => openRecForm(null);
  if ($('#rcL')) {
    $('#rcL').onclick = (e) => {
      const payB = e.target.closest('[data-rpay]');
      if (payB) { const r = recs.find(x => String(x.id) === payB.dataset.rpay); if (r) openExpenseSheet(r); return; }
      const edB = e.target.closest('[data-redit]');
      if (edB) { const r = recs.find(x => String(x.id) === edB.dataset.redit); if (r) openRecForm(r); }
    };
  }
  $('#gQ').oninput = (e) => { GF.q = e.target.value; drawG(); };
  $('#gFA').onchange = (e) => { GF.acc = e.target.value; drawG(); };
  $('#gFT').onchange = (e) => { GF.type = e.target.value; drawG(); };
  $('#gAdd').onclick = () => openExpenseSheet(null);

  $('#gL').onclick = (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const g = rows.find(x => String(x.id) === b.dataset.id);
    openSheet('Gasto #' + g.id, `<p><b>${esc(g.description || g.expense_types?.name)}</b><br>${g.expense_date} | ${esc(g.accounts?.name || 'Sin cuenta')}<br>${money(g.amount, g.currency)} (${fmtCur(g.amount_usd)})</p>
      ${g.status === 'anulado' ? '<p class="warn">Gasto anulado</p>' : '<div class="row"><button class="btn ghost" id="gAnu">Anular gasto</button></div>'}`);
    if (g.status !== 'anulado') $('#gAnu').onclick = () => run(async () => {
      if (!confirm('¿Anular este gasto? El dinero vuelve a la cuenta.')) return;
      await q(db.rpc('anular_gasto', {p_id: g.id})); closeSheet(); toast('Gasto anulado'); render();
    });
  };
}

// Métodos de pago que acepta una cuenta (si no tiene configurados, se muestran todos)
const accMethods = (a) => { const l = a?.methods?.length ? a.methods : Object.keys(METHODS); return Object.fromEntries(l.filter(k => METHODS[k] && !M_OFF.has(k)).map(k => [k, METHODS[k]])); };
