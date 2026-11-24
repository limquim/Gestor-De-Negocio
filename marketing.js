// Marketing: seguimiento inteligente de clientes, plantillas, vista previa real y campañas por WhatsApp
const MK = {seg: 'd30', q: '', tpl: '', msg: '', sel: new Set(), hideSent: false};
const MKSEG = {
  all: 'Todos',
  vip: 'VIP (3+ compras)',
  d15: '15+ días',
  d30: '30+ días',
  d60: '60+ días',
  d90: '90+ días',
  never: 'Nunca compró',
  debt: 'Con deuda',
  nophone: 'Sin teléfono'
};
const diasDesde = (f) => f ? Math.floor((new Date(caracasDate()) - new Date(f)) / 864e5) : null;
const fillMsg = (t, c, set, debt, payTxt = '') => {
  const dUsd = Number(debt || 0);
  const dBs = S.rate ? fmt(dUsd * S.rate) : '0,00';
  return String(t || '')
    .replace(/\{nombre\}/g, (c.name || '').split(' ')[0])
    .replace(/\{producto\}/g, c.producto_favorito || 'nuestros productos')
    .replace(/\{negocio\}/g, set?.business_name || 'nuestro negocio')
    .replace(/\{dias\}/g, c.dias ?? '')
    .replace(/\{saldo\}/g, fmt(dUsd))
    .replace(/\{saldo_bs\}/g, dBs)
    .replace(/\{total\}/g, fmt(c.total_usd || 0))
    .replace(/\{datos_pago\}/g, payTxt ? payTxt.trim() : '');
};
const waLink = (c, text) => `https://wa.me/${waDigits(c.phone)}?text=${encodeURIComponent(text)}`;

function mkSentKey() { return 'gdn_mk_sent_' + caracasDate(); }
function mkGetSent() {
  try { return new Set(JSON.parse(localStorage.getItem(mkSentKey()) || '[]').map(String)); } catch (e) { return new Set(); }
}
function mkMarkSent(cid) {
  const s = mkGetSent(); s.add(String(cid));
  try { localStorage.setItem(mkSentKey(), JSON.stringify([...s])); } catch (e) {}
}

async function viewMarketing() {
  const [cl, tpls, set, pend, payTxt] = await Promise.all([
    q(db.from('clientes_resumen').select('*').eq('active', true).order('name')),
    q(db.from('message_templates').select('*').eq('active', true).order('name')),
    q(db.from('settings').select('business_name').eq('id', 1).single()),
    q(db.from('ventas_resumen').select('customer_id,total_usd,paid_usd').eq('status', 'pendiente')),
    typeof getPaymentDetailsText === 'function' ? getPaymentDetailsText() : Promise.resolve('')
  ]);

  const debt = {};
  pend.forEach(p => { if (p.customer_id) debt[p.customer_id] = (debt[p.customer_id] || 0) + Math.max(0, Number(p.total_usd || 0) - Number(p.paid_usd || 0)); });
  cl.forEach(c => { c.dias = diasDesde(c.ultima_compra); });
  const sentToday = mkGetSent();

  const segFn = {
    all: () => true,
    vip: c => Number(c.num_ventas || 0) >= 3,
    d15: c => c.dias !== null && c.dias >= 15,
    d30: c => c.dias !== null && c.dias >= 30,
    d60: c => c.dias !== null && c.dias >= 60,
    d90: c => c.dias !== null && c.dias >= 90,
    never: c => c.dias === null,
    debt: c => (debt[c.id] || 0) > 0.01,
    nophone: c => !c.phone || !String(c.phone).trim()
  };

  const getFiltered = () => {
    const t = MK.q.trim().toLowerCase();
    return cl.filter(c => {
      if (!segFn[MK.seg](c)) return false;
      if (MK.hideSent && sentToday.has(String(c.id))) return false;
      if (!t) return true;
      return ((c.name || '') + ' ' + (c.phone || '') + ' ' + (c.producto_favorito || '')).toLowerCase().includes(t);
    });
  };

  if (!MK.msg && tpls[0]) { MK.tpl = String(tpls[0].id); MK.msg = tpls[0].body; }
  const act = cl.filter(c => c.dias !== null && c.dias < 30).length;
  const ina = cl.filter(c => c.dias !== null && c.dias >= 30).length;
  const withDebt = cl.filter(c => (debt[c.id] || 0) > 0.01).length;
  const top = [...cl].filter(c => +c.total_usd > 0).sort((a, b) => b.total_usd - a.total_usd).slice(0, 5);

  const VARS = [
    ['{nombre}', 'Nombre'],
    ['{producto}', 'Favorito'],
    ['{negocio}', 'Negocio'],
    ['{dias}', 'Días'],
    ['{saldo}', 'Deuda USD'],
    ['{saldo_bs}', 'Deuda Bs'],
    ['{total}', 'Total comprado'],
    ['{datos_pago}', 'Datos de pago']
  ];

  $('#view').innerHTML = `
    <div class="stats">
      <div class="stat"><span>Clientes activos</span><b>${act}</b><span>de ${cl.length} totales</span></div>
      <div class="stat warn"><span>Por reactivar (30+d)</span><b>${ina}</b><span>${sentToday.size ? sentToday.size + ' contactados hoy' : 'oportunidad de venta'}</span></div>
      <div class="stat ${withDebt ? 'bad' : ''}"><span>Con deuda</span><b>${withDebt}</b></div>
    </div>

    <div class="chips sub" id="mkS">${Object.entries(MKSEG).map(([k, v]) => `<button type="button" data-k="${k}" class="${k === MK.seg ? 'on' : ''}">${v}</button>`).join('')}</div>

    <div class="card stack">
      <div class="title-row">
        <h2>Mensaje de campaña</h2>
        <button type="button" class="lnk" id="mkSaveTpl" style="font-size:.84rem">+ Guardar plantilla</button>
      </div>
      <label>Plantilla<select id="mkT"><option value="">Mensaje libre</option>${tpls.map(t => `<option value="${t.id}" ${String(t.id) === String(MK.tpl) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label>Texto (puedes editarlo)<textarea id="mkM" rows="5"></textarea></label>
      <div>
        <small class="mut" style="display:block;margin-bottom:.3rem">Toca una variable para insertarla:</small>
        <div class="chips" id="mkVars">${VARS.map(([tok, lbl]) => `<button type="button" data-var="${tok}" title="${tok}">${lbl}</button>`).join('')}</div>
      </div>
      <div class="row" style="margin:0">
        <button type="button" class="btn ghost" id="mkOpenCat">Ir al Catálogo (PDF/Foto)</button>
        <button type="button" class="btn ghost" id="mkCopyPrev">Copiar ejemplo</button>
      </div>
      <details style="margin-top:.2rem"><summary>Vista previa con datos reales</summary><pre class="ticket" id="mkPrev" style="max-width:none;margin-top:.5rem"></pre></details>
    </div>

    <div class="card stack">
      <div class="title-row">
        <h2 id="mkListTitle">${MKSEG[MK.seg]}</h2>
        <label class="chk"><input type="checkbox" id="mkAll"> Todos</label>
      </div>
      <input id="mkQ" type="search" placeholder="Buscar cliente por nombre, teléfono o producto favorito..." value="${esc(MK.q)}">
      ${sentToday.size ? `<label class="chk"><input type="checkbox" id="mkHideSent" ${MK.hideSent ? 'checked' : ''}> Ocultar ya contactados hoy (${sentToday.size})</label>` : ''}
      <div class="list" id="mkL"></div>
      <div class="row" style="margin:0"><button class="btn" id="mkGo">Enviar a los seleccionados</button></div>
    </div>

    <div class="card">
      <h2>Mejores clientes</h2>
      ${top.map(c => `<div class="rl"><span>${esc(c.name)}<small class="mut" style="display:block">${c.num_ventas} ${c.num_ventas === 1 ? 'compra' : 'compras'}${c.producto_favorito ? ' · ' + esc(c.producto_favorito) : ''}</small></span><b>${fmt(c.total_usd)} USD</b></div>`).join('') || '<p class="mut">Aún no hay ventas a clientes.</p>'}
    </div>`;

  $('#mkM').value = MK.msg;

  const paintPreview = () => {
    const sample = getFiltered()[0] || cl[0] || {name: 'María Pérez', producto_favorito: 'Detergente 1L', dias: 35, total_usd: 120};
    const txt = fillMsg(MK.msg, sample, set, debt[sample.id] || 0, payTxt);
    if ($('#mkPrev')) $('#mkPrev').textContent = txt || '(Escribe un mensaje arriba)';
    return txt;
  };

  const drawList = () => {
    const list = getFiltered();
    $('#mkListTitle').textContent = `${MKSEG[MK.seg]} (${list.length})`;
    const selCount = list.filter(c => MK.sel.has(c.id) && c.phone).length;
    $('#mkGo').textContent = selCount ? `Enviar a seleccionados (${selCount})` : 'Enviar a los seleccionados';
    $('#mkL').innerHTML = list.map(c => {
      const sent = sentToday.has(String(c.id));
      const dAmt = debt[c.id] || 0;
      return `<div class="item" style="gap:.5rem">
        <label class="chk" style="flex:1">
          <input type="checkbox" data-sel="${c.id}" ${MK.sel.has(c.id) ? 'checked' : ''} ${c.phone ? '' : 'disabled'}>
          <span>
            <b>${esc(c.name)}${sent ? ' <span class="badge ok" style="font-size:.68rem">Enviado hoy</span>' : ''}</b>
            <small>${c.dias === null ? 'Nunca ha comprado' : 'Última compra hace ' + c.dias + ' días'} | ${c.num_ventas} compras | ${fmt(c.total_usd)} USD</small>
            <small>${[c.producto_favorito && 'Favorito: ' + c.producto_favorito, dAmt > 0.01 && 'Debe ' + fmt(dAmt) + ' USD', !c.phone && 'Sin teléfono'].filter(Boolean).map(esc).join(' | ')}</small>
          </span>
        </label>
        ${c.phone
          ? `<button type="button" class="btn ghost" data-wa="${c.id}" style="min-height:38px;padding:.3rem .7rem;font-size:.84rem">WhatsApp</button>`
          : `<button type="button" class="btn ghost" data-addph="${c.id}" style="min-height:38px;padding:.3rem .7rem;font-size:.82rem">+ Teléfono</button>`}
      </div>`;
    }).join('') || '<p class="mut">No hay clientes con este filtro.</p>';
    paintPreview();
  };
  drawList();

  $('#mkS').onclick = (e) => { const b = e.target.closest('button'); if (b) { MK.seg = b.dataset.k; MK.sel.clear(); render(); } };
  $('#mkQ').oninput = (e) => { MK.q = e.target.value; drawList(); };
  if ($('#mkHideSent')) $('#mkHideSent').onchange = (e) => { MK.hideSent = e.target.checked; drawList(); };
  $('#mkT').onchange = (e) => {
    const t = tpls.find(x => String(x.id) === e.target.value);
    MK.tpl = e.target.value;
    if (t) { MK.msg = t.body; $('#mkM').value = t.body; paintPreview(); }
  };
  $('#mkM').oninput = (e) => { MK.msg = e.target.value; paintPreview(); };

  $('#mkVars').onclick = (e) => {
    const b = e.target.closest('[data-var]'); if (!b) return;
    const ta = $('#mkM'), tok = b.dataset.var;
    const s0 = ta.selectionStart ?? ta.value.length, s1 = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s0) + tok + ta.value.slice(s1);
    MK.msg = ta.value;
    ta.focus();
    ta.setSelectionRange(s0 + tok.length, s0 + tok.length);
    paintPreview();
  };

  $('#mkSaveTpl').onclick = () => run(async () => {
    const body = MK.msg.trim();
    if (!body) throw new Error('Escribe primero el mensaje que quieres guardar como plantilla');
    const name = prompt('Nombre de la nueva plantilla (ej: Promo fin de semana):');
    if (!name || !name.trim()) return;
    const ins = await q(db.from('message_templates').insert({name: name.trim(), body, active: true}).select('id').single());
    MK.tpl = String(ins?.id || '');
    toast('Plantilla guardada');
    render();
  });

  $('#mkOpenCat').onclick = () => { SUB.inv = 'catalogo'; go('inventario'); };
  $('#mkCopyPrev').onclick = () => {
    const txt = paintPreview();
    if (typeof copyText === 'function') copyText(txt, 'Mensaje copiado');
  };

  $('#mkL').addEventListener('change', (e) => {
    const id = +e.target.dataset.sel;
    if (!id) return;
    if (e.target.checked) MK.sel.add(id); else MK.sel.delete(id);
    const list = getFiltered();
    const selCount = list.filter(c => MK.sel.has(c.id) && c.phone).length;
    $('#mkGo').textContent = selCount ? `Enviar a seleccionados (${selCount})` : 'Enviar a los seleccionados';
  });

  $('#mkAll').onchange = (e) => {
    const list = getFiltered();
    list.filter(c => c.phone).forEach(c => { if (e.target.checked) MK.sel.add(c.id); else MK.sel.delete(c.id); });
    document.querySelectorAll('#mkL [data-sel]:not(:disabled)').forEach(x => { x.checked = e.target.checked; });
    const selCount = list.filter(c => MK.sel.has(c.id) && c.phone).length;
    $('#mkGo').textContent = selCount ? `Enviar a seleccionados (${selCount})` : 'Enviar a los seleccionados';
  };

  $('#mkL').addEventListener('click', (e) => {
    const waB = e.target.closest('[data-wa]');
    if (waB) {
      const c = cl.find(x => String(x.id) === waB.dataset.wa);
      if (!c) return;
      mkMarkSent(c.id);
      sentToday.add(String(c.id));
      window.open(waLink(c, fillMsg(MK.msg, c, set, debt[c.id], payTxt)), '_blank');
      drawList();
      return;
    }
    const phB = e.target.closest('[data-addph]');
    if (phB) {
      const c = cl.find(x => String(x.id) === phB.dataset.addph);
      if (!c) return;
      run(async () => {
        const ph = prompt(`Teléfono (WhatsApp) para ${c.name}:`, '');
        if (!ph || !ph.trim()) return;
        await q(db.from('parties').update({phone: ph.trim()}).eq('id', c.id));
        toast('Teléfono guardado');
        render();
      });
    }
  });

  $('#mkGo').onclick = () => {
    const Q = getFiltered().filter(c => MK.sel.has(c.id) && c.phone);
    if (!Q.length) return toast('Selecciona al menos un cliente con teléfono', true);
    const step = (i) => {
      if (i >= Q.length) { closeSheet(); toast('Listo: completaste los ' + Q.length + ' mensajes'); render(); return; }
      const c = Q[i], text = fillMsg(MK.msg, c, set, debt[c.id], payTxt);
      openSheet(`Mensaje ${i + 1} de ${Q.length}`, `
        <p><b>${esc(c.name)}</b><br><span class="mut">${esc(c.phone)}</span></p>
        <pre class="ticket" style="max-width:none">${esc(text)}</pre>
        <div class="row">
          <button class="btn" id="qOpen">Abrir WhatsApp</button>
          <button class="btn ghost" id="qCopy">Copiar</button>
          <button class="btn ghost" id="qSkip">Omitir</button>
        </div>
        <p class="mut">Al abrir WhatsApp se marca como enviado hoy y avanzas al siguiente cliente.</p>`);
      $('#qOpen').onclick = () => {
        mkMarkSent(c.id);
        sentToday.add(String(c.id));
        window.open(waLink(c, text), '_blank');
        setTimeout(() => step(i + 1), 350);
      };
      $('#qCopy').onclick = () => { if (typeof copyText === 'function') copyText(text, 'Mensaje copiado'); };
      $('#qSkip').onclick = () => step(i + 1);
    };
    step(0);
  };
}
