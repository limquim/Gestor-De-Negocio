// Recibo moderno en formato foto (ventas y cotizaciones) para compartir por WhatsApp
const dmy = (d) => d ? String(d).split('T')[0].split('-').reverse().join('/') : '';
function saleDoc(d) {
  const s = d.s, paid = d.pays.reduce((a, p) => a + +p.amount_usd, 0), bal = s.total_usd - paid;
  return {title: s.doc_type === 'factura' ? 'FACTURA' : 'NOTA DE ENTREGA', number: s.id, date: s.sale_date, customer: s.parties?.name || 'Cliente general', phone: s.parties?.phone,
    items: d.items.map(i => ({name: i.name, qty: +i.quantity, price: +i.unit_price_usd})), subtotal: +s.subtotal_usd, discount: +s.discount_usd, tax: +s.tax_usd, total: +s.total_usd, rate: +s.exchange_rate,
    pays: d.pays.map(p => ({label: METHODS[p.method] || p.method, amount: +p.amount, cur: p.currency})), balance: bal > 0.01 ? bal : 0,
    status: s.status === 'anulada' ? 'ANULADA' : bal > 0.01 ? 'POR COBRAR' : 'PAGADO', notes: s.notes};
}
function quoteDoc(d) {
  const s = d.s;
  return {title: 'COTIZACIÓN', number: s.id, date: s.quote_date, valid: s.valid_until, customer: s.parties?.name || 'Cliente general', phone: s.parties?.phone,
    items: d.items.map(i => ({name: i.name, qty: +i.quantity, price: +i.unit_price_usd})), subtotal: +s.subtotal_usd, discount: +s.discount_usd, tax: +s.tax_usd, total: +s.total_usd,
    rate: +s.exchange_rate, pays: [], balance: 0, status: '', notes: s.notes, quote: true};
}
const docBlob = (doc, text, set) => set.ticket_style === 'clasico' ? ticketBlob(text, set) : receiptBlob(doc, set);
function showPrev(blobP, set) {
  if (set.ticket_style === 'clasico') return;
  blobP.then(b => { const el = $('#tPrev'); if (b && el) el.innerHTML = `<img class="rimg" src="${URL.createObjectURL(b)}" alt="Vista previa">`; });
}

async function receiptBlob(doc, set) {
  const W = 720, P = 40, sc = 2, F = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const acc = /^#[0-9a-f]{6}$/i.test(set.ticket_color || '') ? set.ticket_color : '#0b7285', ink = '#14262d', mut = '#6b7f88', line = '#e3eaed';
  const logo = set.ticket_show_logo && set.logo_data ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = set.logo_data; }) : null;
  const m = document.createElement('canvas').getContext('2d');
  let g, dry = true, y = 0;
  const fnt = (sz, w = 400) => `${w} ${sz}px ${F}`;
  const wrap = (t, mw, sz, w) => {
    m.font = fnt(sz, w); const out = [];
    String(t).split('\n').forEach(par => { let ln = ''; par.split(' ').forEach(wd => { const tt = ln ? ln + ' ' + wd : wd; if (ln && m.measureText(tt).width > mw) { out.push(ln); ln = wd; } else ln = tt; }); out.push(ln); });
    return out;
  };
  const tw = (t, sz, w) => { m.font = fnt(sz, w); return m.measureText(t).width; };
  const T = (t, x, yy, sz, w, col, al = 'left') => { if (dry) return; g.font = fnt(sz, w); g.fillStyle = col; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(t, x, yy); };
  const R = (x, yy, w, h, r, col) => { if (dry) return; g.beginPath(); (g.roundRect || g.rect).call(g, x, yy, w, h, r); g.fillStyle = col; g.fill(); };
  const paint = () => {
    // encabezado de color con logo y datos del negocio
    const info = set.ticket_show_info === false ? [] : [set.business_rif && 'RIF: ' + set.business_rif, set.business_phone, set.business_address];
    const sub = [set.ticket_header, ...info].filter(Boolean), tx = logo ? P + 104 : P, tmax = W - tx - P;
    const nameL = wrap(set.business_name || 'Mi negocio', tmax, 30, 800), subL = sub.flatMap(t => wrap(t, tmax, 15, 400));
    const textH = nameL.length * 36 + (subL.length ? 8 + subL.length * 21 : 0), hh = P + Math.max(textH, logo ? 88 : 0) + P - 6;
    R(0, 0, W, hh, 0, acc);
    if (logo) { R(P, P - 4, 88, 88, 18, '#fff'); if (!dry) { const k = Math.min(76 / logo.width, 76 / logo.height), w = logo.width * k, h = logo.height * k; g.drawImage(logo, P + 44 - w / 2, P + 40 - h / 2, w, h); } }
    let ty = P + 26; nameL.forEach(t => { T(t, tx, ty, 30, 800, '#fff'); ty += 36; });
    ty -= 12; subL.forEach(t => { ty += 21; T(t, tx, ty, 15, 400, 'rgba(255,255,255,.88)'); });
    // título, número y estado
    y = hh + 50; T(doc.title, P, y, 24, 800, acc); T('#' + doc.number, P + tw(doc.title, 24, 800) + 12, y, 24, 800, ink);
    if (doc.status) {
      const col = {PAGADO: ['#1b7f4b', '#e3f5ea'], 'POR COBRAR': ['#8a5a00', '#fff2cc'], ANULADA: ['#b4381a', '#fde8e3']}[doc.status] || [mut, line], bw = tw(doc.status, 14, 800) + 30;
      R(W - P - bw, y - 25, bw, 36, 18, col[1]); T(doc.status, W - P - bw / 2, y - 1, 14, 800, col[0], 'center');
    }
    y += 28; T('Fecha: ' + dmy(doc.date) + (doc.valid ? '     Válida hasta: ' + dmy(doc.valid) : ''), P, y, 15, 400, mut);
    if (set.ticket_show_customer !== false) {
      y += 40; T('CLIENTE', P, y, 12, 700, mut); y += 26; T(doc.customer, P, y, 20, 700, ink);
      if (doc.phone) { y += 22; T(doc.phone, P, y, 15, 400, mut); }
    }
    // tabla de productos
    y += 28; R(P - 12, y, W - P * 2 + 24, 36, 10, acc + '1f');
    const cq = W - P - 230, cp = W - P - 110, ct = W - P;
    T('Descripción', P, y + 24, 14, 700, acc); T('Cant.', cq, y + 24, 14, 700, acc, 'right'); T('Precio', cp, y + 24, 14, 700, acc, 'right'); T('Total', ct, y + 24, 14, 700, acc, 'right');
    y += 36;
    doc.items.forEach(i => {
      const L = wrap(i.name, 380, 17, 600); y += 30;
      L.forEach((t, k) => T(t, P, y + k * 22, 17, 600, ink));
      T(fmt(i.qty, i.qty % 1 ? 3 : 0), cq, y, 17, 400, ink, 'right'); T(fmt(i.price), cp, y, 17, 400, ink, 'right'); T(fmt(i.qty * i.price), ct, y, 17, 700, ink, 'right');
      y += (L.length - 1) * 22 + 14; if (!dry) { g.fillStyle = line; g.fillRect(P, y, W - P * 2, 1); }
    });
    // subtotales
    const row = (l, v, col = mut) => { y += 28; T(l, W - P - 260, y, 16, 400, col); T(v, ct, y, 16, 600, col === mut ? ink : col, 'right'); };
    y += 6; row('Subtotal', fmt(doc.subtotal) + ' USD');
    if (doc.discount) row('Descuento', '-' + fmt(doc.discount) + ' USD', '#b4381a');
    if (doc.tax) row('IVA', fmt(doc.tax) + ' USD');
    // total
    y += 24; const bh = set.ticket_show_rate === false ? 92 : 116; R(P - 12, y, W - P * 2 + 24, bh, 20, acc);
    T(doc.quote ? 'TOTAL' : 'TOTAL A PAGAR', P + 10, y + 40, 15, 700, 'rgba(255,255,255,.85)'); T(fmt(doc.total) + ' USD', ct - 8, y + 48, 38, 800, '#fff', 'right');
    T(fmt(doc.total * doc.rate) + ' Bs', ct - 8, y + 80, 21, 600, 'rgba(255,255,255,.92)', 'right');
    if (set.ticket_show_rate !== false) T('Tasa: ' + fmt(doc.rate, 2) + ' Bs por USD', ct - 8, y + 104, 14, 400, 'rgba(255,255,255,.75)', 'right');
    y += bh;
    // pagos
    if (set.ticket_show_payments !== false && (doc.pays.length || doc.balance)) {
      y += 34; T('PAGOS', P, y, 12, 700, mut);
      doc.pays.forEach(p => { y += 28; T(p.label, P, y, 16, 400, ink); T(fmt(p.amount) + (p.cur === 'USD' ? ' USD' : ' Bs'), ct, y, 16, 600, ink, 'right'); });
      if (doc.balance) { y += 32; T('Pendiente por pagar', P, y, 17, 800, '#8a5a00'); T(fmt(doc.balance) + ' USD', ct, y, 17, 800, '#8a5a00', 'right'); }
    }
    if (doc.notes) { y += 12; wrap(doc.notes, W - P * 2, 15, 400).forEach(t => { y += 22; T(t, P, y, 15, 400, mut); }); }
    // pie
    y += 34; if (!dry) { g.fillStyle = line; g.fillRect(P, y, W - P * 2, 1); }
    const foot = [set.ticket_footer, doc.quote && 'Precios sujetos a cambio según la tasa del día.'].filter(Boolean);
    foot.forEach(t => wrap(t, W - P * 2, 16, 600).forEach(l => { y += 28; T(l, W / 2, y, 16, 600, mut, 'center'); }));
    y += P;
  };
  paint();
  const H = y, c = document.createElement('canvas'); c.width = W * sc; c.height = H * sc;
  g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); dry = false; paint();
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear la imagen')), 'image/png'));
}
