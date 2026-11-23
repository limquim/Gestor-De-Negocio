// Finanzas: cuentas y métodos de pago, datos bancarios, aportes/retiros, cierre de caja y gastos
const num = (v) => +String(v ?? '').replace(',', '.');
const toUsd = (amt, cur) => cur === 'USD' ? +amt : (S.rate ? amt / S.rate : 0);
const money = (n, cur) => fmt(n) + (cur === 'USD' ? ' USD' : ' Bs');
const acctOpts = (accs, sel) => accs.map(a => `<option value="${a.id}" ${String(a.id) === String(sel) ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('');
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
  return `<button class="stat" data-go="finanzas"><span>Dinero disponible</span><b>${fmt(t)} USD</b><span>${S.rate ? fmt(t * S.rate) + ' Bs' : 'Sin tasa'}</span></button>`;
}

// ---------- Cuentas ----------
async function viewCuentas() {
  const [accs, types] = await Promise.all([
    loadAccountsRich(),
    q(db.from('account_types').select('id,name').eq('active', true).order('name'))
  ]);
  const act = accs.filter(a => a.active), tot = act.reduce((s, a) => s + toUsd(+a.balance, a.currency), 0), D = {types};
  const hasDetails = act.some(a => (a.payment_details || '').trim());

  $('#view').innerHTML = `<div class="stat" style="margin-bottom:1rem"><span>Dinero disponible</span><b>${fmt(tot)} USD</b><span>${S.rate ? fmt(tot * S.rate) + ' Bs' : 'Sin tasa cargada'}</span></div>
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
      <span class="n"><b>${money(a.balance, a.currency)}</b>${a.currency === 'VES' && S.rate ? `<small>${fmt(a.balance / S.rate)} USD</small>` : ''}</span></button>`;
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
  openSheet(esc(a.name), `<p>Saldo: <b>${money(a.balance, a.currency)}</b>${a.currency === 'VES' && S.rate ? ' (' + fmt(a.balance / S.rate) + ' USD)' : ''}
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
      <label>Moneda<select name="cur" ${a ? 'disabled' : ''}><option value="USD">Dólares (USD)</option><option value="VES">Bolívares (Bs)</option></select></label>
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
    <label>Monto (en la moneda de la cuenta)<input name="amt" type="number" step="0.01" min="0.01" required></label>
    <p class="mut" id="cpEq" style="margin:0"></p>
    <label>Nota<input name="note" placeholder="Ej: inyección para mercancía / retiro semanal"></label>
    <button class="btn" type="submit">Registrar movimiento</button>
  </form>`);
  const f = $('#cpF'), el = f.elements;
  const updEq = () => {
    const a = accs.find(x => String(x.id) === el.acc.value), v = num(el.amt.value) || 0;
    if (!a || !v) { $('#cpEq').textContent = ''; return; }
    $('#cpEq').textContent = a.currency === 'USD'
      ? (S.rate ? `Equivale a ${fmt(v * S.rate)} Bs` : '')
      : (S.rate ? `Equivale a ${fmt(v / S.rate)} USD` : '');
  };
  el.acc.onchange = updEq; el.amt.oninput = updEq;
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

// ---------- Cierre / Cuadre de caja diario ----------
async function viewCierreCaja() {
  if (!CC.date) CC.date = caracasDate();
  const day = CC.date, fromTs = day + 'T00:00:00-04:00', toTs = day + 'T23:59:59-04:00';
  const [accsAll, pays, moves, closings] = await Promise.all([
    loadAccountsRich(),
    q(db.from('payments').select('method,currency,amount,amount_usd,sale_id,purchase_id,account_id,created_at').gte('created_at', fromTs).lte('created_at', toTs).order('id')),
    q(db.from('account_movements').select('account_id,kind,amount,note,created_at,accounts(name,currency)').gte('created_at', fromTs).lte('created_at', toTs).order('id')),
    db.from('cash_closings').select('*').order('closing_date', {ascending: false}).order('id', {ascending: false}).limit(15).then(r => r.error ? [] : (r.data || []))
  ]);
  const saleIds = [...new Set(pays.filter(p => p.sale_id).map(p => p.sale_id))];
  const purIds = [...new Set(pays.filter(p => p.purchase_id).map(p => p.purchase_id))];
  const [anulSales, anulPurs] = await Promise.all([
    saleIds.length ? q(db.from('sales').select('id').in('id', saleIds).eq('status', 'anulada')) : [],
    purIds.length ? q(db.from('purchases').select('id').in('id', purIds).eq('status', 'anulada')) : []
  ]);
  const badSales = new Set(anulSales.map(x => x.id));
  const badPurs = new Set(anulPurs.map(x => x.id));
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
      S.rate ? `Tasa: ${fmt(S.rate, 4)} Bs/USD` : '',
      '',
      '*Cobros por método:*',
      ...(byMethodArr.length ? byMethodArr.map(m => `- ${m.name} (${m.count}): ${fmt(m.usd)} USD${m.origVes ? ` [${fmt(m.origVes)} Bs]` : ''}`) : ['- Sin cobros registrados']),
      `Total cobrado: ${fmt(cobrosUsd)} USD`,
      '',
      '*Arqueo por cuenta:*',
      ...det.map(d => `- ${d.name}: Sistema ${money(d.system_balance, d.currency)} | Real ${money(d.counted_balance, d.currency)} (${d.diff === 0 ? 'Cuadrado' : (d.diff > 0 ? '+' : '') + money(d.diff, d.currency)})`),
      '',
      `Total sistema: ${fmt(tSys)} USD`,
      `Total contado: ${fmt(tCnt)} USD`,
      `Diferencia: ${tDiff >= 0 ? '+' : ''}${fmt(tDiff)} USD`,
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
      <div class="stat"><span>Cobros del día</span><b>${fmt(cobrosUsd)} USD</b><span>${S.rate ? fmt(cobrosUsd * S.rate) + ' Bs' : ''}</span></div>
      <div class="stat"><span>Pagos a proveedores</span><b>${fmt(pagosProvUsd)} USD</b></div>
    </div>

    <div class="card">
      <h2>Cobros del día por método de pago</h2>
      ${byMethodArr.length ? byMethodArr.map(m => `<div class="rl">
        <span><b>${esc(m.name)}</b> <small class="mut">(${m.count} ${m.count === 1 ? 'pago' : 'pagos'})</small>
        ${m.origUsd || m.origVes ? `<small class="mut" style="display:block">${[m.origUsd ? fmt(m.origUsd) + ' USD' : '', m.origVes ? fmt(m.origVes) + ' Bs' : ''].filter(Boolean).join(' + ')}</small>` : ''}</span>
        <b>${fmt(m.usd)} USD</b>
      </div>`).join('') : '<p class="mut">No se registraron cobros de ventas en esta fecha.</p>'}
    </div>

    <div class="card">
      <h2>Resumen de movimientos del día (USD aprox.)</h2>
      ${Object.keys(movByKind).length ? Object.entries(movByKind).map(([k, v]) => `<div class="rl"><span>${esc(k)}</span><b class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${fmt(v)} USD</b></div>`).join('')
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
          <span class="n"><b>${fmt(c.total_counted_usd)} USD</b><small class="${+c.diff_usd === 0 ? 'in' : +c.diff_usd > 0 ? 'in' : 'outq'}">${+c.diff_usd === 0 ? 'Cuadrado' : (+c.diff_usd > 0 ? '+' : '') + fmt(c.diff_usd) + ' USD'}</small></span>
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
      <div class="rl"><span>Total en sistema</span><b>${fmt(tSys)} USD</b></div>
      <div class="rl"><span>Total contado real</span><b>${fmt(tCnt)} USD</b></div>
      <div class="rl tot ${Math.abs(tDiff) < 0.01 ? 'pos' : tDiff > 0 ? 'pos' : 'neg'}"><span>Diferencia total</span><b>${Math.abs(tDiff) < 0.01 ? 'Cuadrado (0,00 USD)' : (tDiff > 0 ? '+' : '') + fmt(tDiff) + ' USD'}</b></div>`;
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
      <div class="rl"><span>Sistema</span><b>${fmt(c.total_system_usd)} USD</b></div>
      <div class="rl"><span>Contado</span><b>${fmt(c.total_counted_usd)} USD</b></div>
      <div class="rl tot ${+c.diff_usd >= 0 ? 'pos' : 'neg'}"><span>Diferencia</span><b>${+c.diff_usd >= 0 ? '+' : ''}${fmt(c.diff_usd)} USD</b></div>
      ${met.length ? `<h2 style="margin-top:1rem">Cobros por método</h2>${met.map(m => `<div class="rl"><span>${esc(m.name)} (${m.count})</span><b>${fmt(m.usd)} USD</b></div>`).join('')}` : ''}
      ${det.length ? `<h2 style="margin-top:1rem">Detalle por cuenta</h2><div class="scroll"><table><thead><tr><th>Cuenta</th><th class="n">Sistema</th><th class="n">Real</th><th class="n">Dif.</th></tr></thead><tbody>
        ${det.map(d => `<tr><td>${esc(d.name)}</td><td class="n">${money(d.system_balance, d.currency)}</td><td class="n">${money(d.counted_balance, d.currency)}</td><td class="n ${+d.diff < 0 ? 'outq' : 'in'}">${+d.diff > 0 ? '+' : ''}${fmt(d.diff)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    `);
  };
}

// ---------- Gastos (con búsqueda y filtros) ----------
async function viewGastos() {
  const [rows, types, accs] = await Promise.all([
    q(db.from('expenses').select('*, expense_types(name,is_fixed), accounts(name)').order('id', {ascending: false}).limit(100)),
    q(db.from('expense_types').select('id,name,is_fixed').eq('active', true).order('name')),
    loadAccountsRich().then(l => l.filter(a => a.active))
  ]);

  $('#view').innerHTML = `<div class="card stack" style="margin-bottom:.8rem">
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
    $('#gSum').innerHTML = `Mostrando <b>${list.length}</b> gastos | Total activo: <b>${fmt(tot)} USD</b>${S.rate ? ' (' + fmt(tot * S.rate) + ' Bs)' : ''}`;
    $('#gL').innerHTML = list.map(g => `<button class="item" data-id="${g.id}"><span><b>${esc(g.description || g.expense_types?.name || 'Gasto')}</b>
      <small>${g.expense_date} | ${esc(g.expense_types?.name || 'Sin tipo')} | ${g.expense_types?.is_fixed ? 'Fijo' : 'Variable'}</small><small>${esc(g.accounts?.name || 'Sin cuenta')}</small></span>
      <span class="n ${g.status === 'anulado' ? 'mut' : ''}"><b>${fmt(g.amount_usd)} USD</b>${g.status === 'anulado' ? '<small>Anulado</small>' : ''}</span></button>`).join('') || '<p class="mut">No hay gastos con ese filtro.</p>';
  };
  drawG();

  $('#gQ').oninput = (e) => { GF.q = e.target.value; drawG(); };
  $('#gFA').onchange = (e) => { GF.acc = e.target.value; drawG(); };
  $('#gFT').onchange = (e) => { GF.type = e.target.value; drawG(); };

  $('#gAdd').onclick = () => {
    openSheet('Nuevo gasto', `<form id="gF" class="stack"><label>Tipo de gasto<select name="type">${types.map(t => `<option value="${t.id}">${esc(t.name)}${t.is_fixed ? ' (fijo)' : ''}</option>`).join('')}</select></label>
      <label>Descripción<input name="desc" placeholder="Ej: pago de alquiler de octubre"></label>
      <label>Pagado desde<select name="acc">${acctOpts(accs)}</select></label>
      <label>Monto (en la moneda de la cuenta)<input name="amount" type="number" step="0.01" min="0.01" required></label>
      <label>Fecha<input name="date" type="date" value="${caracasDate()}"></label><button class="btn" type="submit">Registrar gasto</button></form>`);
    const el = $('#gF').elements; let pc = accs[0]?.currency;
    el.acc.onchange = () => {
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
    openSheet('Gasto #' + g.id, `<p><b>${esc(g.description || g.expense_types?.name)}</b><br>${g.expense_date} | ${esc(g.accounts?.name || 'Sin cuenta')}<br>${fmt(g.amount)} ${g.currency === 'USD' ? 'USD' : 'Bs'} (${fmt(g.amount_usd)} USD)</p>
      ${g.status === 'anulado' ? '<p class="warn">Gasto anulado</p>' : '<div class="row"><button class="btn ghost" id="gAnu">Anular gasto</button></div>'}`);
    if (g.status !== 'anulado') $('#gAnu').onclick = () => run(async () => {
      if (!confirm('¿Anular este gasto? El dinero vuelve a la cuenta.')) return;
      await q(db.rpc('anular_gasto', {p_id: g.id})); closeSheet(); toast('Gasto anulado'); render();
    });
  };
}

// Métodos de pago que acepta una cuenta (si no tiene configurados, se muestran todos)
const accMethods = (a) => { const l = a?.methods?.length ? a.methods : Object.keys(METHODS); return Object.fromEntries(l.filter(k => METHODS[k] && !M_OFF.has(k)).map(k => [k, METHODS[k]])); };
