// Marketing: seguimiento de clientes y mensajes por WhatsApp
const MK = {seg: 'd30', tpl: '', msg: '', sel: new Set()};
const MKSEG = {all: 'Todos', d15: '15+ días', d30: '30+ días', d60: '60+ días', d90: '90+ días', never: 'Nunca compró', debt: 'Con deuda'};
const diasDesde = (f) => f ? Math.floor((new Date(caracasDate()) - new Date(f)) / 864e5) : null;
const fillMsg = (t, c, set, debt) => t.replace(/\{nombre\}/g, (c.name || '').split(' ')[0]).replace(/\{producto\}/g, c.producto_favorito || 'nuestros productos')
  .replace(/\{negocio\}/g, set.business_name || 'nuestro negocio').replace(/\{dias\}/g, c.dias ?? '').replace(/\{saldo\}/g, fmt(debt || 0));
const waLink = (c, text) => `https://wa.me/${waDigits(c.phone)}?text=${encodeURIComponent(text)}`;

async function viewMarketing() {
  const [cl, tpls, set, pend] = await Promise.all([
    q(db.from('clientes_resumen').select('*').eq('active', true).order('name')),
    q(db.from('message_templates').select('*').eq('active', true).order('name')),
    q(db.from('settings').select('business_name').eq('id', 1).single()),
    q(db.from('ventas_resumen').select('customer_id,total_usd,paid_usd').eq('status', 'pendiente'))
  ]);
  const debt = {}; pend.forEach(p => { if (p.customer_id) debt[p.customer_id] = (debt[p.customer_id] || 0) + (p.total_usd - p.paid_usd); });
  cl.forEach(c => { c.dias = diasDesde(c.ultima_compra); });
  const ok = {all: () => true, d15: c => c.dias !== null && c.dias >= 15, d30: c => c.dias !== null && c.dias >= 30, d60: c => c.dias !== null && c.dias >= 60,
    d90: c => c.dias !== null && c.dias >= 90, never: c => c.dias === null, debt: c => !!debt[c.id]};
  const list = cl.filter(ok[MK.seg]);
  if (!MK.msg && tpls[0]) { MK.tpl = tpls[0].id; MK.msg = tpls[0].body; }
  const act = cl.filter(c => c.dias !== null && c.dias < 30).length, ina = cl.filter(c => c.dias !== null && c.dias >= 30).length;
  const top = [...cl].filter(c => +c.total_usd > 0).sort((a, b) => b.total_usd - a.total_usd).slice(0, 5);
  $('#view').innerHTML = `<div class="stats"><div class="stat"><span>Clientes</span><b>${cl.length}</b></div>
    <div class="stat"><span>Compraron en 30 días</span><b>${act}</b></div><div class="stat warn"><span>Sin comprar hace 30+ días</span><b>${ina}</b></div></div>
    <div class="chips sub" id="mkS">${Object.entries(MKSEG).map(([k, v]) => `<button data-k="${k}" class="${k === MK.seg ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div class="card stack"><h2>Mensaje</h2>
      <label>Plantilla<select id="mkT">${tpls.map(t => `<option value="${t.id}" ${t.id === MK.tpl ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label>Texto (puedes editarlo)<textarea id="mkM" rows="5"></textarea></label>
      <p class="mut">Variables: {nombre} {producto} {negocio} {dias} {saldo}. Las plantillas se editan en Más &gt; Directorios.</p></div>
    <div class="card"><div class="title-row"><h2>${MKSEG[MK.seg]} (${list.length})</h2><label class="chk"><input type="checkbox" id="mkAll"> Seleccionar todos</label></div>
      <div class="list" id="mkL">${list.map(c => `<div class="item"><label class="chk" style="flex:1"><input type="checkbox" data-sel="${c.id}" ${MK.sel.has(c.id) ? 'checked' : ''} ${c.phone ? '' : 'disabled'}>
        <span><b>${esc(c.name)}</b><small>${c.dias === null ? 'Nunca ha comprado' : 'Última compra hace ' + c.dias + ' días'} | ${c.num_ventas} compras | ${fmt(c.total_usd)} USD</small>
        <small>${c.producto_favorito ? 'Favorito: ' + esc(c.producto_favorito) : ''}${debt[c.id] ? ' | Debe ' + fmt(debt[c.id]) + ' USD' : ''}${c.phone ? '' : ' | sin teléfono'}</small></span></label>
        ${c.phone ? `<button class="btn ghost" data-wa="${c.id}">WhatsApp</button>` : ''}</div>`).join('') || '<p class="mut">No hay clientes en este grupo.</p>'}</div>
      <div class="row"><button class="btn" id="mkGo">Enviar a los seleccionados</button></div></div>
    <div class="card"><h2>Mejores clientes</h2>${top.map(c => `<div class="rl"><span>${esc(c.name)}<small class="mut" style="display:block">${c.num_ventas} compras</small></span><b>${fmt(c.total_usd)} USD</b></div>`).join('') || '<p class="mut">Aún no hay ventas a clientes.</p>'}</div>`;
  $('#mkM').value = MK.msg;
  $('#mkS').onclick = (e) => { const b = e.target.closest('button'); if (b) { MK.seg = b.dataset.k; MK.sel.clear(); render(); } };
  $('#mkT').onchange = (e) => { const t = tpls.find(x => String(x.id) === e.target.value); MK.tpl = t.id; MK.msg = t.body; $('#mkM').value = t.body; };
  $('#mkM').oninput = (e) => { MK.msg = e.target.value; };
  $('#mkL').addEventListener('change', (e) => { const id = +e.target.dataset.sel; if (id) { if (e.target.checked) MK.sel.add(id); else MK.sel.delete(id); } });
  $('#mkAll').onchange = (e) => {
    list.filter(c => c.phone).forEach(c => { if (e.target.checked) MK.sel.add(c.id); else MK.sel.delete(c.id); });
    document.querySelectorAll('#mkL [data-sel]:not(:disabled)').forEach(x => { x.checked = e.target.checked; });
  };
  $('#mkL').addEventListener('click', (e) => {
    const b = e.target.closest('[data-wa]'); if (!b) return;
    const c = list.find(x => String(x.id) === b.dataset.wa); window.open(waLink(c, fillMsg(MK.msg, c, set, debt[c.id])), '_blank');
  });
  $('#mkGo').onclick = () => {
    const Q = list.filter(c => MK.sel.has(c.id) && c.phone);
    if (!Q.length) return toast('Selecciona al menos un cliente con teléfono', true);
    const step = (i) => {
      if (i >= Q.length) { closeSheet(); toast('Listo: revisaste los ' + Q.length + ' mensajes'); return; }
      const c = Q[i], text = fillMsg(MK.msg, c, set, debt[c.id]);
      openSheet(`Mensaje ${i + 1} de ${Q.length}`, `<p><b>${esc(c.name)}</b><br><span class="mut">${esc(c.phone)}</span></p><pre class="ticket" style="max-width:none">${esc(text)}</pre>
        <div class="row"><button class="btn" id="qOpen">Abrir WhatsApp</button><button class="btn ghost" id="qSkip">Omitir</button></div>
        <p class="mut">Se abre WhatsApp con el mensaje listo. Envíalo y regresa aquí para pasar al siguiente cliente.</p>`);
      $('#qOpen').onclick = () => { window.open(waLink(c, text), '_blank'); setTimeout(() => step(i + 1), 400); };
      $('#qSkip').onclick = () => step(i + 1);
    };
    step(0);
  };
}
