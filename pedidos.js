// Pedidos y Encargos por entregar (activable en Configuración > Módulos)
const ORD = {f: 'activos', q: ''};

const ORD_ST = {
  pendiente:   {label: 'Pendiente',       short: 'Pendiente',   cls: 'low'},
  preparacion: {label: 'En preparación',  short: 'Preparando',  cls: 'prep'},
  listo:       {label: 'Listo',           short: 'Listo',       cls: 'ok'},
  entregado:   {label: 'Entregado',       short: 'Entregado',   cls: 'done'},
  cancelado:   {label: 'Cancelado',       short: 'Cancelado',   cls: 'out'}
};
const ORD_FLOW = ['pendiente', 'preparacion', 'listo', 'entregado'];

async function orderDetail(id) {
  const [o, items] = await Promise.all([
    q(db.from('orders').select('*, parties(name,phone)').eq('id', id).single()),
    q(db.from('order_items').select('*, products(name,sku,sale_price_usd)').eq('order_id', id).order('id'))
  ]);
  return {
    o,
    items: (items || []).map(i => ({
      ...i,
      name: i.name || i.products?.name || 'Artículo',
      sku: i.products?.sku || ''
    }))
  };
}

function orderWhatsAppMsg(o, items, bizName = '') {
  const cust = o.customer_name || o.parties?.name || 'cliente';
  const total = Number(o.total_usd || 0);
  const dep = Number(o.deposit_usd || 0);
  const bal = Math.max(0, total - dep);
  const rate = Number(S.rate || o.exchange_rate || 0);
  const showBs = S.bimoneda !== false && rate > 0;
  const balTxt = bal > 0.01
    ? `\nSaldo pendiente: ${fmtCur(bal)}${showBs ? ' (' + fmtSec(bal * rate) + ')' : ''}`
    : '\nEstado de pago: Pagado por completo.';
  const delTxt = o.delivery_date ? `\nEntrega: ${dmy(o.delivery_date)}${o.delivery_time ? ' a las ' + o.delivery_time : ''}` : '';
  const sumItems = (items || []).slice(0, 5).map(i => `• ${qty(i.quantity)}x ${i.name}`).join('\n');

  if (o.status === 'listo') {
    return `¡Hola ${cust}! Tu pedido #${o.id} ya está *LISTO* para entrega/retiro.${delTxt}\n${sumItems}${balTxt}${bizName ? '\n\n— ' + bizName : ''}`;
  }
  if (o.status === 'preparacion') {
    return `Hola ${cust}, te avisamos que tu pedido #${o.id} ya está *en preparación*.${delTxt}\n${sumItems}${balTxt}${bizName ? '\n\n— ' + bizName : ''}`;
  }
  if (o.status === 'entregado') {
    return `¡Hola ${cust}! Gracias por tu compra. Confirmamos la entrega de tu pedido #${o.id}.${bizName ? '\n\n— ' + bizName : ''}`;
  }
  return `Hola ${cust}, confirmamos tu pedido #${o.id}:${delTxt}\n${sumItems}\nTotal: ${fmtCur(total)}${dep > 0.005 ? ' | Abono: ' + fmtCur(dep) : ''}${balTxt}${bizName ? '\n\n— ' + bizName : ''}`;
}

async function viewPedidos() {
  const [rows, allItems] = await Promise.all([
    q(db.from('orders').select('*, parties(name,phone)').order('id', {ascending: false}).limit(200)),
    q(db.from('order_items').select('order_id,name,quantity,products(name)'))
  ]);
  const hoy = caracasDate();
  const itemsByOrder = {};
  (allItems || []).forEach(it => {
    const oid = Number(it.order_id);
    if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
    itemsByOrder[oid].push(`${qty(it.quantity)}× ${it.name || it.products?.name || 'Artículo'}`);
  });

  const active = rows.filter(r => ['pendiente', 'preparacion', 'listo'].includes(r.status));
  const dueTodayOrLate = active.filter(r => r.delivery_date && r.delivery_date <= hoy);
  const readyCnt = active.filter(r => r.status === 'listo').length;
  const pendUsd = active.reduce((s, r) => s + Math.max(0, Number(r.total_usd || 0) - Number(r.deposit_usd || 0)), 0);

  $('#view').innerHTML = `
    <div class="stats">
      <div class="stat"><span>Pedidos activos</span><b>${active.length}</b><span>por entregar</span></div>
      <div class="stat ${dueTodayOrLate.length ? 'bad' : ''}"><span>Para hoy / atrasados</span><b>${dueTodayOrLate.length}</b><span>${dueTodayOrLate.length ? 'requieren atención' : 'al día'}</span></div>
      <div class="stat"><span>Listos</span><b>${readyCnt}</b><span>para retiro / envío</span></div>
      <div class="stat warn"><span>Saldo por cobrar</span><b>${fmtCur(pendUsd)}</b><span>${S.bimoneda !== false && S.rate ? fmtSec(pendUsd * S.rate) : 'en entregas'}</span></div>
    </div>

    <div class="card stack" style="margin-bottom:.8rem">
      <div class="row0" style="gap:.5rem">
        <button type="button" class="btn" id="ordAddTop" style="flex:1">+ Nuevo pedido / encargo</button>
      </div>
      <input id="ordQ" type="search" placeholder="Buscar por cliente, #pedido o detalle..." value="${esc(ORD.q)}">
      <div class="chips" id="ordF">
        <button type="button" data-f="activos" class="${ORD.f === 'activos' ? 'on' : ''}">Activos (${active.length})</button>
        <button type="button" data-f="pendiente" class="${ORD.f === 'pendiente' ? 'on' : ''}">Pendientes</button>
        <button type="button" data-f="preparacion" class="${ORD.f === 'preparacion' ? 'on' : ''}">En preparación</button>
        <button type="button" data-f="listo" class="${ORD.f === 'listo' ? 'on' : ''}">Listos</button>
        <button type="button" data-f="entregado" class="${ORD.f === 'entregado' ? 'on' : ''}">Entregados</button>
        <button type="button" data-f="cancelado" class="${ORD.f === 'cancelado' ? 'on' : ''}">Cancelados</button>
      </div>
    </div>
    <div class="list" id="ordL"></div>
    <button class="fab" id="ordAdd" aria-label="Nuevo pedido">+</button>`;

  const draw = () => {
    const t = ORD.q.trim().toLowerCase();
    const list = rows
      .filter(r => {
        if (ORD.f === 'activos' && !['pendiente', 'preparacion', 'listo'].includes(r.status)) return false;
        if (ORD.f !== 'activos' && r.status !== ORD.f) return false;
        if (!t) return true;
        const cname = (r.customer_name || r.parties?.name || '').toLowerCase();
        const itTxt = (itemsByOrder[r.id] || []).join(' ').toLowerCase();
        return (`#${r.id} ${cname} ${r.notes || ''} ${itTxt}`).toLowerCase().includes(t);
      })
      .sort((a, b) => {
        if (ORD.f === 'activos') {
          const da = a.delivery_date || '9999-12-31', db2 = b.delivery_date || '9999-12-31';
          if (da !== db2) return da.localeCompare(db2);
        }
        return Number(b.id) - Number(a.id);
      });

    $('#ordL').innerHTML = list.map(r => {
      const st = ORD_ST[r.status] || ORD_ST.pendiente;
      const cname = r.customer_name || r.parties?.name || 'Cliente general';
      const total = Number(r.total_usd || 0);
      const dep = Number(r.deposit_usd || 0);
      const bal = Math.max(0, total - dep);
      const isAct = ['pendiente', 'preparacion', 'listo'].includes(r.status);
      const isLate = isAct && r.delivery_date && r.delivery_date < hoy;
      const isToday = isAct && r.delivery_date && r.delivery_date === hoy;
      const delLbl = r.delivery_date
        ? (isLate ? `<span class="bad"><b>Atrasado (${dmy(r.delivery_date)})</b></span>`
          : isToday ? `<span class="warn"><b>Entrega HOY${r.delivery_time ? ' · ' + esc(r.delivery_time) : ''}</b></span>`
          : `Entrega: ${dmy(r.delivery_date)}${r.delivery_time ? ' · ' + esc(r.delivery_time) : ''}`)
        : 'Sin fecha definida';
      const sum = (itemsByOrder[r.id] || []).slice(0, 3).join(', ');
      return `<button type="button" class="item ord-card ${isLate ? 'ord-late' : isToday ? 'ord-today' : ''}" data-oid="${r.id}">
        <span style="flex:1">
          <b>#${r.id} · ${esc(cname)}</b>
          <small>${delLbl}</small>
          ${sum ? `<small>${esc(sum)}</small>` : ''}
          <small>Total: <b>${fmtCur(total)}</b>${dep > 0.005 ? ` · Abono: <span class="in">${fmtCur(dep)}</span>` : ''}${bal > 0.01 ? ` · Resta: <b>${fmtCur(bal)}</b>` : ' · <span class="in">Pagado</span>'}${r.sale_id ? ` · Venta #${r.sale_id}` : ''}</small>
        </span>
        <span class="badge ${st.cls}">${esc(st.short)}</span>
      </button>`;
    }).join('') || '<p class="mut">No hay pedidos en este estado. Pulsa <b>+ Nuevo pedido / encargo</b> para registrar uno.</p>';
  };
  draw();

  $('#ordQ').oninput = (e) => { ORD.q = e.target.value; draw(); };
  $('#ordF').onclick = (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    ORD.f = b.dataset.f;
    document.querySelectorAll('#ordF button').forEach(x => x.classList.toggle('on', x === b));
    draw();
  };
  $('#ordAdd').onclick = () => run(() => orderForm(null));
  if ($('#ordAddTop')) $('#ordAddTop').onclick = () => run(() => orderForm(null));
  $('#ordL').onclick = (e) => { const b = e.target.closest('[data-oid]'); if (b) run(() => orderSheet(+b.dataset.oid)); };
}

async function orderSheet(id) {
  const [d, set, payTxt] = await Promise.all([
    orderDetail(id),
    q(db.from('settings').select('*').eq('id', 1).single()).catch(() => ({})),
    typeof getPaymentDetailsText === 'function' ? getPaymentDetailsText() : Promise.resolve('')
  ]);
  const o = d.o;
  const st = ORD_ST[o.status] || ORD_ST.pendiente;
  const cname = o.customer_name || o.parties?.name || 'Cliente general';
  const phone = o.customer_phone || o.parties?.phone || '';
  const total = Number(o.total_usd || 0);
  const dep = Number(o.deposit_usd || 0);
  const bal = Math.max(0, total - dep);
  const rate = Number(S.rate || o.exchange_rate || 0);
  const showBs = S.bimoneda !== false && rate > 0;
  const rawbtOn = typeof hasMod === 'function' && hasMod('rawbt');
  const doc = orderDoc(o, d.items, set, payTxt);
  const text = docText(doc, set);

  const flowBtns = ORD_FLOW.map(k => `
    <button type="button" class="ord-step ${o.status === k ? 'on' : ''}" data-ost="${k}">${esc(ORD_ST[k].short)}</button>
  `).join('');

  openSheet(`Pedido #${o.id} · ${esc(st.label)}`, `
    <div class="stack">
      <div class="card" style="margin:0;padding:.8rem .9rem;background:var(--bg)">
        <div class="title-row">
          <b>${esc(cname)}</b>
          <span class="badge ${st.cls}">${esc(st.label)}</span>
        </div>
        ${phone ? `<small class="mut" style="display:block">Teléfono: ${esc(phone)}</small>` : ''}
        <small class="mut" style="display:block">Pedido el ${dmy(o.order_date)}${o.delivery_date ? ` · <b>Entrega: ${dmy(o.delivery_date)}${o.delivery_time ? ' ' + esc(o.delivery_time) : ''}</b>` : ''}</small>
        ${o.notes ? `<p style="margin:.45rem 0 0;font-size:.9rem"><b>Detalles:</b> ${esc(o.notes)}</p>` : ''}
      </div>

      ${o.status !== 'cancelado' ? `<div class="stack" style="gap:.35rem">
        <small class="mut"><b>Cambiar estado en 1 toque:</b></small>
        <div class="ord-flow" id="ordFlow">${flowBtns}</div>
      </div>` : '<p class="bad" style="margin:0">Este pedido está cancelado.</p>'}

      <div class="scroll">
        <table>
          <thead><tr><th>Artículo</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Total</th></tr></thead>
          <tbody>
            ${d.items.map(i => `<tr>
              <td>${esc(i.name)}${!i.product_id ? ' <small class="mut">(personalizado)</small>' : ''}</td>
              <td class="n">${qty(i.quantity)}</td>
              <td class="n">${fmtCur(i.unit_price_usd)}</td>
              <td class="n">${fmtCur(i.quantity * i.unit_price_usd)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="card" style="margin:0;padding:.75rem .9rem;background:var(--bg)">
        <div class="rl" style="border:0;padding:.15rem 0"><span>Total del pedido</span><b>${fmtCur(total)}${showBs ? ' (' + fmtSec(total * rate) + ')' : ''}</b></div>
        <div class="rl" style="border:0;padding:.15rem 0"><span>Abono / Anticipo</span><b class="in">${fmtCur(dep)}</b></div>
        <div class="rl tot" style="padding:.25rem 0 0"><span>Saldo al entregar</span><b class="${bal > 0.01 ? 'warn' : 'pos'}">${fmtCur(bal)}${showBs && bal > 0.01 ? ' (' + fmtSec(bal * rate) + ')' : ''}</b></div>
      </div>

      ${o.sale_id ? `<p class="in" style="margin:0"><b>Ya facturado en Venta #${o.sale_id}</b></p>` : ''}

      <div class="row">
        <button type="button" class="btn" id="ordWa">Avisar por WhatsApp</button>
        ${!o.sale_id && o.status !== 'cancelado' ? '<button type="button" class="btn ghost" id="ordAb">+ Abono</button>' : ''}
      </div>
      ${!o.sale_id && o.status !== 'cancelado' ? `<div class="row">
        <button type="button" class="btn" id="ordToSale">Facturar / Convertir en venta</button>
      </div>` : ''}
      <div class="row">
        ${rawbtOn ? '<button type="button" class="btn ghost" id="ordRaw">Comanda (RawBT)</button>' : ''}
        <button type="button" class="btn ghost" id="ordPrt">Imprimir</button>
        <button type="button" class="btn ghost" id="ordImg">Foto WhatsApp</button>
      </div>
      <div class="row">
        ${!o.sale_id && o.status !== 'cancelado' ? '<button type="button" class="btn ghost" id="ordEdit">Editar</button>' : ''}
        ${o.status !== 'cancelado' && !o.sale_id ? '<button type="button" class="btn ghost bad" id="ordCan">Cancelar pedido</button>' : ''}
        ${o.status === 'cancelado' ? '<button type="button" class="btn ghost" id="ordReopen">Reactivar pedido</button>' : ''}
      </div>
    </div>`);

  if ($('#ordFlow')) {
    $('#ordFlow').onclick = (e) => {
      const b = e.target.closest('[data-ost]'); if (!b) return;
      const nextSt = b.dataset.ost;
      if (nextSt === o.status) return;
      run(async () => {
        await q(db.from('orders').update({status: nextSt}).eq('id', o.id));
        toast(`Pedido #${o.id} marcado como "${ORD_ST[nextSt].label}"`);
        render();
        await orderSheet(o.id);
      });
    };
  }

  $('#ordWa').onclick = () => {
    const msg = orderWhatsAppMsg(o, d.items, set.business_name || '');
    window.open(`https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  if ($('#ordAb')) {
    $('#ordAb').onclick = () => run(async () => {
      const raw = prompt(`Monto total abonado hasta ahora en ${curLabel()} (actual: ${fmt(dep)}, total pedido: ${fmt(total)}):`, String(dep || ''));
      if (raw === null) return;
      const val = Math.max(0, Math.min(total, Number(String(raw).replace(',', '.')) || 0));
      await q(db.from('orders').update({deposit_usd: Math.round(val * 100) / 100}).eq('id', o.id));
      toast(`Abono actualizado a ${fmtCur(val)}`);
      render();
      await orderSheet(o.id);
    });
  }

  if ($('#ordToSale')) {
    $('#ordToSale').onclick = () => {
      V.fromOrd = o.id;
      V.fromQ = null;
      V.edit = null;
      SUB.ven = 'nueva';
      closeSheet();
      go('ventas');
    };
  }

  if ($('#ordRaw')) $('#ordRaw').onclick = () => printRawBT(doc, set);
  $('#ordPrt').onclick = () => printTicket(text, set.ticket_paper);
  $('#ordImg').onclick = () => run(async () => {
    const blob = await docBlob(doc, text, set);
    await shareImage(blob, phone, 'pedido-' + o.id);
  });
  if ($('#ordEdit')) $('#ordEdit').onclick = () => run(() => orderForm(o.id));
  if ($('#ordCan')) $('#ordCan').onclick = () => run(async () => {
    if (!confirm(`¿Cancelar el pedido #${o.id}?`)) return;
    await q(db.from('orders').update({status: 'cancelado'}).eq('id', o.id));
    closeSheet(); toast('Pedido cancelado'); render();
  });
  if ($('#ordReopen')) $('#ordReopen').onclick = () => run(async () => {
    await q(db.from('orders').update({status: 'pendiente'}).eq('id', o.id));
    toast('Pedido reactivado'); render(); await orderSheet(o.id);
  });
}

async function orderForm(id) {
  const [D, old] = await Promise.all([vData(), id ? orderDetail(id) : Promise.resolve(null)]);
  const pm = Object.fromEntries(D.products.map(p => [p.id, p]));
  const cart = old
    ? old.items.map(i => ({pid: i.product_id || null, name: i.name, qty: Number(i.quantity || 1), price: Number(i.unit_price_usd || 0)}))
    : [];

  const defDel = new Date(caracasDate() + 'T12:00:00');
  defDel.setDate(defDel.getDate() + 1);

  openSheet(old ? `Editar pedido #${id}` : 'Nuevo pedido / encargo', `<form id="oF" class="stack">
    <div class="row0" style="align-items:flex-end;gap:.45rem">
      <label style="flex:1;margin:0">Cliente registrado (opcional)
        <select name="cust">
          <option value="">Escribir nombre rápido abajo...</option>
          ${D.custs.map(c => `<option value="${c.id}">${esc(c.name)}${c.phone ? ' (' + esc(c.phone) + ')' : ''}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn ghost" id="oNewC" aria-label="Nuevo cliente" style="min-width:46px">+</button>
    </div>
    <div class="grid">
      <label>Nombre del cliente<input name="cname" placeholder="Ej: María Pérez" required></label>
      <label>WhatsApp / Teléfono<input name="cphone" type="tel" placeholder="Ej: 0414-0000000"></label>
    </div>
    <div class="grid">
      <label>Fecha de entrega<input name="ddate" type="date" value="${esc(old ? (old.o.delivery_date || '') : dstr(defDel))}" required></label>
      <label>Hora (opcional)<input name="dtime" type="time" value="${esc(old?.o?.delivery_time || '')}"></label>
    </div>

    <div class="stack" style="gap:.45rem;padding:.65rem;background:var(--bg);border:1px solid var(--line);border-radius:10px">
      <div class="title-row">
        <b style="font-size:.9rem">Productos o encargos</b>
        <button type="button" class="lnk" id="oAddCustom">+ Artículo personalizado</button>
      </div>
      <div class="scan-row">
        <input id="oS" type="search" placeholder="Buscar producto/combo o escanear código">
        <button type="button" class="icon-btn scan-btn" id="oScan" title="Escanear código" aria-label="Escanear código">${SCAN_ICO}</button>
      </div>
      <div class="list" id="oR"></div>
      <div id="oC"></div>
    </div>

    <div class="grid">
      <label>Abono / Anticipo recibido (${esc(curLabel())})<input name="dep" type="number" step="0.01" min="0" value="${old ? Number(old.o.deposit_usd || 0) : 0}"></label>
      <label>Estado inicial
        <select name="status">
          ${ORD_FLOW.map(k => `<option value="${k}" ${(old?.o?.status || 'pendiente') === k ? 'selected' : ''}>${esc(ORD_ST[k].label)}</option>`).join('')}
        </select>
      </label>
    </div>

    <div id="oTot" class="card" style="margin:0;padding:.7rem .85rem;background:var(--bg)"></div>
    <label>Detalles del encargo / Nota<textarea name="notes" rows="2" placeholder="Ej: Torta chocolate 2kg, dedicatoria Feliz Cumple, entrega en domicilio..."></textarea></label>
    <button class="btn" type="submit">${old ? 'Guardar cambios' : 'Registrar pedido'}</button>
  </form>`);

  const f = $('#oF'), el = f.elements;
  if (old) {
    el.cust.value = old.o.customer_id || '';
    el.cname.value = old.o.customer_name || old.o.parties?.name || '';
    el.cphone.value = old.o.customer_phone || old.o.parties?.phone || '';
    el.notes.value = old.o.notes || '';
  }

  el.cust.onchange = () => {
    const c = D.custs.find(x => String(x.id) === el.cust.value);
    if (c) {
      el.cname.value = c.name || '';
      if (c.phone) el.cphone.value = c.phone;
    }
  };

  $('#oNewC').onclick = () => run(async () => {
    const name = prompt('Nombre del cliente'); if (!name) return;
    const phone = prompt('Teléfono / WhatsApp (opcional)') || null;
    const c = await q(db.from('parties').insert({name: name.trim(), phone, is_customer: true, is_supplier: false}).select('id,name,phone').single());
    D.custs.push(c);
    el.cust.insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(c.name)}${c.phone ? ' (' + esc(c.phone) + ')' : ''}</option>`);
    el.cust.value = String(c.id);
    el.cname.value = c.name;
    el.cphone.value = c.phone || '';
  });

  const paintTot = () => {
    const tot = cart.reduce((a, c) => a + (Number(c.qty || 0) * Number(c.price || 0)), 0);
    const dep = Math.min(tot, Math.max(0, Number(el.dep.value || 0)));
    const bal = Math.max(0, tot - dep);
    const showBs = S.bimoneda !== false && S.rate > 0;
    $('#oTot').innerHTML = `
      <div class="rl" style="border:0;padding:.15rem 0"><span>Total del pedido</span><b>${fmtCur(tot)}${showBs ? ' (' + fmtSec(tot * S.rate) + ')' : ''}</b></div>
      <div class="rl" style="border:0;padding:.15rem 0"><span>Saldo al entregar</span><b class="${bal > 0.01 ? 'warn' : 'pos'}">${fmtCur(bal)}</b></div>`;
  };

  const drawCart = () => {
    $('#oC').innerHTML = cart.map((c, i) => `<div class="pl" data-i="${i}">
      <div style="flex:1;min-width:140px">
        ${c.pid ? `<b>${esc(c.name)}</b>` : `<input data-f="name" value="${esc(c.name)}" placeholder="Nombre del encargo..." style="margin:0;min-height:38px">`}
        <button type="button" class="lnk bad" data-rm="${i}">Quitar</button>
      </div>
      <div class="stack" style="gap:.3rem">
        <label>Cant.<input data-f="qty" type="number" step="0.001" min="0.001" value="${c.qty}" style="width:5.2rem"></label>
        <label>Precio (${esc(curLabel())})<input data-f="price" type="number" step="0.01" min="0" value="${c.price}" style="width:5.8rem"></label>
      </div>
    </div>`).join('') || '<p class="mut" style="margin:.2rem 0">Agrega productos del catálogo o toca <b>+ Artículo personalizado</b>.</p>';
    paintTot();
  };
  drawCart();

  $('#oAddCustom').onclick = () => {
    cart.push({pid: null, name: '', qty: 1, price: 0});
    drawCart();
    const inputs = $('#oC').querySelectorAll('input[data-f="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };

  $('#oS').oninput = (e) => {
    const t = e.target.value.trim().toLowerCase();
    $('#oR').innerHTML = t ? (D.products.filter(p => (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t)).slice(0, 6).map(p =>
      `<button type="button" class="item" data-add="${p.id}"><span><b>${esc(p.name)}</b><small>${fmtCur(p.sale_price_usd)}</small></span><span class="mut">+</span></button>`
    ).join('') || '<p class="mut">Sin resultados.</p>') : '';
  };
  $('#oR').onclick = (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const p = pm[+b.dataset.add]; if (!p) return;
    const ex = cart.find(c => c.pid === p.id);
    if (ex) ex.qty = Math.round((ex.qty + 1) * 1000) / 1000;
    else cart.push({pid: p.id, name: p.name, qty: 1, price: Number(p.sale_price_usd || 0)});
    $('#oS').value = ''; $('#oR').innerHTML = ''; drawCart();
  };
  $('#oScan').onclick = () => openScanner({
    title: 'Agregar al pedido',
    continuous: true,
    allowContinuous: true,
    onCode: (code) => {
      const p = findBySku(D.products, code);
      if (!p) return {ok: false, msg: 'Código no registrado: ' + code};
      const ex = cart.find(c => c.pid === p.id);
      if (ex) ex.qty++; else cart.push({pid: p.id, name: p.name, qty: 1, price: Number(p.sale_price_usd || 0)});
      drawCart();
      return {ok: true, msg: p.name + ' agregado'};
    }
  });
  $('#oC').addEventListener('input', (e) => {
    const l = e.target.closest('.pl'); if (!l || !e.target.dataset.f) return;
    const fkey = e.target.dataset.f;
    cart[+l.dataset.i][fkey] = fkey === 'name' ? e.target.value : (Number(e.target.value) || 0);
    paintTot();
  });
  $('#oC').addEventListener('click', (e) => {
    if (e.target.dataset.rm !== undefined) { cart.splice(+e.target.dataset.rm, 1); drawCart(); }
  });
  el.dep.addEventListener('input', paintTot);

  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const clean = cart.map(c => ({...c, name: String(c.name || '').trim()})).filter(c => c.name && Number(c.qty) > 0);
      if (!clean.length) throw new Error('Agrega al menos un producto o artículo con nombre y cantidad');
      const total = Math.round(clean.reduce((a, c) => a + Number(c.qty) * Number(c.price || 0), 0) * 100) / 100;
      const dep = Math.min(total, Math.max(0, Math.round((Number(el.dep.value) || 0) * 100) / 100));
      const row = {
        customer_id: +el.cust.value || null,
        customer_name: el.cname.value.trim(),
        customer_phone: el.cphone.value.trim() || null,
        order_date: old?.o?.order_date || caracasDate(),
        delivery_date: el.ddate.value || caracasDate(),
        delivery_time: el.dtime.value || null,
        status: el.status.value || 'pendiente',
        total_usd: total,
        deposit_usd: dep,
        exchange_rate: S.bimoneda === false ? 1 : Number(S.rate || old?.o?.exchange_rate || 1),
        notes: el.notes.value.trim() || null,
        sale_id: old?.o?.sale_id || null
      };
      let oid = id;
      if (old) {
        await q(db.from('orders').update(row).eq('id', id));
        await q(db.from('order_items').delete().eq('order_id', id));
      } else {
        const ins = await q(db.from('orders').insert(row).select('id').single());
        oid = ins.id;
      }
      await q(db.from('order_items').insert(clean.map(c => ({
        order_id: oid,
        product_id: c.pid || null,
        name: c.name,
        quantity: Number(c.qty),
        unit_price_usd: Number(c.price || 0)
      }))));
      closeSheet();
      toast(old ? 'Pedido actualizado' : `Pedido #${oid} registrado`);
      render();
      await orderSheet(oid);
    });
  };
}
