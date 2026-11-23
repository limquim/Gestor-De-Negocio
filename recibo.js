// Recibos y tickets altamente personalizables (foto y texto térmico) para ventas, cotizaciones y nómina
const dmy = (d) => d ? String(d).split('T')[0].split('-').reverse().join('/') : '';

const TICKET_CFG_DEF = {
  title_nota: 'NOTA DE ENTREGA',
  title_factura: 'FACTURA',
  title_cotizacion: 'COTIZACIÓN',
  currency_mode: 'both',      // 'both' | 'usd' | 'bs' | 'bs_first'
  logo_pos: 'left',           // 'left' | 'center'
  logo_size: 'md',            // 'sm' | 'md' | 'lg'
  font_scale: 'normal',       // 'sm' | 'normal' | 'lg'
  show_sku: false,
  show_unit_price: true,
  show_time: true,
  show_status: true,
  show_notes: true,
  show_signature: false,
  signature_label: 'Recibido conforme / Firma',
  show_pay_details: 'none',   // 'none' | 'pending' | 'always'
  social: ''
};

function ticketCfg(set) {
  let extra = set?.ticket_config;
  if (typeof extra === 'string') {
    try { extra = JSON.parse(extra); } catch (e) { extra = {}; }
  }
  const c = {...TICKET_CFG_DEF, ...(extra && typeof extra === 'object' ? extra : {})};
  // Compatibilidad con ticket_show_bs si aún no se ha guardado currency_mode en ticket_config
  if (!(extra && extra.currency_mode) && set?.ticket_show_bs === false) {
    c.currency_mode = 'usd';
  }
  return c;
}

function saleDoc(d, set, payDetails = '') {
  const s = d.s, paid = covered(d), bal = s.total_usd - paid, cfg = ticketCfg(set);
  const title = s.doc_type === 'factura'
    ? (cfg.title_factura || 'FACTURA')
    : (cfg.title_nota || 'NOTA DE ENTREGA');
  return {
    kind: s.doc_type === 'factura' ? 'factura' : 'nota',
    title,
    number: Number(s.id) < 0 ? 'LOC-' + Math.abs(s.id) : s.id,
    date: s.sale_date,
    created_at: s.created_at,
    customer: s.parties?.name || 'Cliente general',
    phone: s.parties?.phone,
    items: d.items.map(i => ({name: i.name, sku: i.sku || i.products?.sku || '', qty: +i.quantity, price: +i.unit_price_usd})),
    subtotal: +s.subtotal_usd,
    discount: +s.discount_usd,
    tax: +s.tax_usd,
    total: +s.total_usd,
    rate: +s.exchange_rate,
    pays: d.pays.map(p => ({label: METHODS[p.method] || p.method, amount: +p.amount, cur: p.currency})),
    balance: bal > 0.01 ? bal : 0,
    status: s.status === 'anulada' ? 'ANULADA' : bal > 0.01 ? 'POR COBRAR' : 'PAGADO',
    notes: s.notes,
    payDetails
  };
}

function quoteDoc(d, set, payDetails = '') {
  const s = d.s, cfg = ticketCfg(set);
  return {
    kind: 'cotizacion',
    title: cfg.title_cotizacion || 'COTIZACIÓN',
    number: Number(s.id) < 0 ? 'LOC-' + Math.abs(s.id) : s.id,
    date: s.quote_date,
    created_at: s.created_at,
    valid: s.valid_until,
    customer: s.parties?.name || 'Cliente general',
    phone: s.parties?.phone,
    items: d.items.map(i => ({name: i.name, sku: i.sku || i.products?.sku || '', qty: +i.quantity, price: +i.unit_price_usd})),
    subtotal: +s.subtotal_usd,
    discount: +s.discount_usd,
    tax: +s.tax_usd,
    total: +s.total_usd,
    rate: +s.exchange_rate,
    pays: [],
    balance: 0,
    status: '',
    notes: s.notes,
    quote: true,
    payDetails
  };
}

function shouldShowPayDetails(doc, cfg) {
  if (!doc.payDetails || !doc.payDetails.trim()) return false;
  if (cfg.show_pay_details === 'always') return true;
  if (cfg.show_pay_details === 'pending') return !!(doc.quote || doc.balance > 0.01);
  return false;
}

// Texto térmico unificado (58mm / 80mm) respetando todas las opciones de personalización
function docText(doc, set) {
  const cfg = ticketCfg(set);
  const w = set.ticket_paper === '80mm' ? 42 : 32, ln = '-'.repeat(w);
  const two = (a, b) => {
    const sa = String(a), sb = String(b);
    return sa + ' '.repeat(Math.max(1, w - sa.length - sb.length)) + sb;
  };
  const info = set.ticket_show_info === false
    ? []
    : [set.business_rif && 'RIF: ' + set.business_rif, set.business_phone, set.business_address];
  const o = [(set.business_name || 'Mi negocio').toUpperCase(), set.ticket_header, ...info, cfg.social].filter(Boolean);

  const dateLine = cfg.show_time && doc.created_at
    ? fdate(doc.created_at)
    : ('Fecha: ' + dmy(doc.date));
  o.push(ln, `${doc.title} #${doc.number}` + (cfg.show_status && doc.status ? ` [${doc.status}]` : ''), dateLine);
  if (doc.valid) o.push('Válida hasta: ' + dmy(doc.valid));
  if (set.ticket_show_customer !== false) {
    o.push(`${doc.partyLabel ? doc.partyLabel + ': ' : 'Cliente: '}${doc.customer}`);
    if (doc.phone) o.push('Tlf: ' + doc.phone);
  }
  o.push(ln);

  const showUsd = cfg.currency_mode !== 'bs';
  const showBs = cfg.currency_mode !== 'usd' && set.ticket_show_bs !== false && doc.rate > 0;
  const priceOnlyBs = cfg.currency_mode === 'bs' && doc.rate > 0;

  doc.items.forEach(i => {
    const label = (cfg.show_sku && i.sku ? `[${i.sku}] ` : '') + i.name;
    const uPrice = priceOnlyBs ? i.price * doc.rate : i.price;
    const tot = i.qty * uPrice;
    const curTag = priceOnlyBs ? ' Bs' : '';
    if (cfg.show_unit_price !== false) {
      o.push(label, two(`${qty(i.qty)} x ${fmt(uPrice)}${curTag}`, fmt(tot) + curTag));
    } else {
      o.push(two(`${qty(i.qty)} ${label}`.slice(0, Math.max(8, w - 11)), fmt(tot) + curTag));
    }
  });

  o.push(ln);
  const mult = priceOnlyBs ? doc.rate : 1;
  const cLabel = priceOnlyBs ? 'Bs' : 'USD';
  if (cfg.show_unit_price !== false) {
    o.push(two(`Subtotal ${cLabel}`, fmt(doc.subtotal * mult)));
    if (+doc.discount) o.push(two('Descuento', '-' + fmt(doc.discount * mult)));
    if (+doc.tax) o.push(two('IVA', fmt(doc.tax * mult)));
  }

  if (cfg.currency_mode === 'bs_first' && showBs) {
    o.push(two('TOTAL Bs', fmt(doc.total * doc.rate)));
    if (showUsd) o.push(two('TOTAL USD', fmt(doc.total)));
  } else {
    if (showUsd) o.push(two('TOTAL USD', fmt(doc.total)));
    if (showBs) o.push(two('TOTAL Bs', fmt(doc.total * doc.rate)));
  }
  if (set.ticket_show_rate && doc.rate > 0) o.push('Tasa: ' + fmt(doc.rate, 4) + ' Bs/USD');

  if (set.ticket_show_payments !== false && (doc.pays.length || doc.balance > 0.01)) {
    if (doc.pays.length) {
      o.push(ln, 'PAGOS');
      doc.pays.forEach(p => o.push(two(p.label, fmt(p.amount) + ' ' + (p.cur === 'USD' ? 'USD' : 'Bs'))));
    }
    if (doc.balance > 0.01) {
      o.push(two('POR PAGAR USD', fmt(doc.balance)));
      if (showBs) o.push(two('POR PAGAR Bs', fmt(doc.balance * doc.rate)));
    }
  }

  if (cfg.show_notes !== false && doc.notes) o.push(ln, 'Nota: ' + doc.notes);
  if (shouldShowPayDetails(doc, cfg)) {
    o.push(ln, doc.payDetails.replace(/\*/g, '').trim());
  }
  if (cfg.show_signature) {
    o.push('', '', '_'.repeat(Math.min(26, w)), cfg.signature_label || 'Recibido conforme / Firma');
  }
  if (set.ticket_footer) o.push(ln, set.ticket_footer);
  if (doc.quote) o.push('Precios sujetos a cambio según la tasa del día.');
  return o.join('\n');
}

const docBlob = (doc, text, set) => set.ticket_style === 'clasico' ? ticketBlob(text, set) : receiptBlob(doc, set);

function showPrev(blobP, set) {
  blobP.then(b => {
    const el = $('#tPrev');
    if (b && el) el.innerHTML = `<img class="rimg" src="${URL.createObjectURL(b)}" alt="Vista previa">`;
  });
}

async function receiptBlob(doc, set) {
  const cfg = ticketCfg(set);
  const minimal = set.ticket_style === 'minimal';
  const kFont = cfg.font_scale === 'sm' ? 0.9 : cfg.font_scale === 'lg' ? 1.12 : 1;
  const fs = (n) => Math.round(n * kFont);
  const W = 720, P = 40, sc = 2, F = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const acc = /^#[0-9a-f]{6}$/i.test(set.ticket_color || '') ? set.ticket_color : '#0b7285', ink = '#14262d', mut = '#6b7f88', line = '#e3eaed';
  const logo = set.ticket_show_logo && set.logo_data
    ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = set.logo_data; })
    : null;
  const m = document.createElement('canvas').getContext('2d');
  let g, dry = true, y = 0;
  const fnt = (sz, w = 400) => `${w} ${sz}px ${F}`;
  const wrap = (t, mw, sz, w) => {
    m.font = fnt(sz, w); const out = [];
    String(t).split('\n').forEach(par => {
      let ln = '';
      par.split(' ').forEach(wd => {
        const tt = ln ? ln + ' ' + wd : wd;
        if (ln && m.measureText(tt).width > mw) { out.push(ln); ln = wd; } else ln = tt;
      });
      out.push(ln);
    });
    return out;
  };
  const tw = (t, sz, w) => { m.font = fnt(sz, w); return m.measureText(t).width; };
  const T = (t, x, yy, sz, w, col, al = 'left') => { if (dry) return; g.font = fnt(sz, w); g.fillStyle = col; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(t, x, yy); };
  const R = (x, yy, w, h, r, col) => { if (dry) return; g.beginPath(); (g.roundRect || g.rect).call(g, x, yy, w, h, r); g.fillStyle = col; g.fill(); };
  const B = (x, yy, w, h, r, col, lw = 2) => { if (dry) return; g.beginPath(); (g.roundRect || g.rect).call(g, x, yy, w, h, r); g.strokeStyle = col; g.lineWidth = lw; g.stroke(); };

  const logoDim = cfg.logo_size === 'sm' ? 68 : cfg.logo_size === 'lg' ? 112 : 88;
  const logoCenter = cfg.logo_pos === 'center';
  const showUsd = cfg.currency_mode !== 'bs';
  const showBs = cfg.currency_mode !== 'usd' && set.ticket_show_bs !== false && doc.rate > 0;
  const priceOnlyBs = cfg.currency_mode === 'bs' && doc.rate > 0;

  const paint = () => {
    // 1. Encabezado (Moderno con fondo de color o Minimalista limpio)
    const info = set.ticket_show_info === false ? [] : [set.business_rif && 'RIF: ' + set.business_rif, set.business_phone, set.business_address];
    const sub = [set.ticket_header, ...info, cfg.social].filter(Boolean);
    const nameCol = minimal ? ink : '#fff';
    const subCol = minimal ? mut : 'rgba(255,255,255,.88)';

    let hh = 0;
    if (logoCenter) {
      const tmax = W - P * 2;
      const nameL = wrap(set.business_name || 'Mi negocio', tmax, fs(30), 800);
      const subL = sub.flatMap(t => wrap(t, tmax, fs(15), 400));
      let ty = P;
      if (logo) ty += logoDim + 16;
      ty += nameL.length * fs(36) + (subL.length ? 6 + subL.length * fs(21) : 0);
      hh = ty + P - 10;
      if (minimal) {
        R(0, 0, W, 10, 0, acc);
        if (!dry) { g.fillStyle = line; g.fillRect(P, hh, W - P * 2, 1.5); }
      } else {
        R(0, 0, W, hh, 0, acc);
      }
      let cy = P;
      if (logo) {
        if (!minimal) R(W / 2 - logoDim / 2, cy, logoDim, logoDim, 18, '#fff');
        if (!dry) {
          const pad = minimal ? 0 : 8, box = logoDim - pad * 2;
          const k = Math.min(box / logo.width, box / logo.height), lw = logo.width * k, lh = logo.height * k;
          g.drawImage(logo, W / 2 - lw / 2, cy + logoDim / 2 - lh / 2, lw, lh);
        }
        cy += logoDim + 16;
      }
      cy += fs(26);
      nameL.forEach(t => { T(t, W / 2, cy, fs(30), 800, nameCol, 'center'); cy += fs(36); });
      cy -= fs(12);
      subL.forEach(t => { cy += fs(21); T(t, W / 2, cy, fs(15), 400, subCol, 'center'); });
    } else {
      const tx = logo ? P + logoDim + 18 : P, tmax = W - tx - P;
      const nameL = wrap(set.business_name || 'Mi negocio', tmax, fs(30), 800);
      const subL = sub.flatMap(t => wrap(t, tmax, fs(15), 400));
      const textH = nameL.length * fs(36) + (subL.length ? 8 + subL.length * fs(21) : 0);
      hh = P + Math.max(textH, logo ? logoDim : 0) + P - 6;
      if (minimal) {
        R(0, 0, W, 10, 0, acc);
        if (!dry) { g.fillStyle = line; g.fillRect(P, hh, W - P * 2, 1.5); }
      } else {
        R(0, 0, W, hh, 0, acc);
      }
      if (logo) {
        if (!minimal) R(P, P - 4, logoDim, logoDim, 18, '#fff');
        if (!dry) {
          const pad = minimal ? 0 : 8, box = logoDim - pad * 2;
          const k = Math.min(box / logo.width, box / logo.height), lw = logo.width * k, lh = logo.height * k;
          g.drawImage(logo, P + logoDim / 2 - lw / 2, P - 4 + logoDim / 2 - lh / 2, lw, lh);
        }
      }
      let ty = P + fs(26);
      nameL.forEach(t => { T(t, tx, ty, fs(30), 800, nameCol); ty += fs(36); });
      ty -= fs(12);
      subL.forEach(t => { ty += fs(21); T(t, tx, ty, fs(15), 400, subCol); });
    }

    // 2. Título, número, estado y fecha
    y = hh + 48;
    T(doc.title, P, y, fs(24), 800, acc);
    T('#' + doc.number, P + tw(doc.title, fs(24), 800) + 12, y, fs(24), 800, ink);
    if (cfg.show_status !== false && doc.status) {
      const col = {PAGADO: ['#1b7f4b', '#e3f5ea'], 'POR COBRAR': ['#8a5a00', '#fff2cc'], ANULADA: ['#b4381a', '#fde8e3']}[doc.status] || [mut, line];
      const bw = tw(doc.status, fs(14), 800) + 30;
      R(W - P - bw, y - 25, bw, 36, 18, col[1]);
      T(doc.status, W - P - bw / 2, y - 1, fs(14), 800, col[0], 'center');
    }
    const dateStr = cfg.show_time && doc.created_at ? fdate(doc.created_at) : dmy(doc.date);
    y += 28;
    T('Fecha: ' + dateStr + (doc.valid ? '     Válida hasta: ' + dmy(doc.valid) : ''), P, y, fs(15), 400, mut);

    // 3. Cliente
    if (set.ticket_show_customer !== false) {
      y += 38;
      T(doc.partyLabel || 'CLIENTE', P, y, fs(12), 700, mut);
      y += fs(26);
      T(doc.customer, P, y, fs(20), 700, ink);
      if (doc.phone) { y += fs(22); T(doc.phone, P, y, fs(15), 400, mut); }
    }

    // 4. Tabla de productos
    y += 28;
    R(P - 12, y, W - P * 2 + 24, 36, 10, acc + '1f');
    const cq = cfg.show_unit_price !== false ? W - P - 230 : W - P - 130;
    const cp = W - P - 110;
    const ct = W - P;
    const descW = cfg.show_unit_price !== false ? 375 : 465;
    T('Descripción', P, y + 24, fs(14), 700, acc);
    T('Cant.', cq, y + 24, fs(14), 700, acc, 'right');
    if (cfg.show_unit_price !== false) T(priceOnlyBs ? 'Precio Bs' : 'Precio', cp, y + 24, fs(14), 700, acc, 'right');
    T(priceOnlyBs ? 'Total Bs' : 'Total', ct, y + 24, fs(14), 700, acc, 'right');
    y += 36;

    const mult = priceOnlyBs ? doc.rate : 1;
    const cLabel = priceOnlyBs ? 'Bs' : 'USD';
    doc.items.forEach(i => {
      const nm = (cfg.show_sku && i.sku ? `[${i.sku}] ` : '') + i.name;
      const L = wrap(nm, descW, fs(17), 600);
      y += fs(30);
      L.forEach((t, k) => T(t, P, y + k * fs(22), fs(17), 600, ink));
      T(fmt(i.qty, i.qty % 1 ? 3 : 0), cq, y, fs(17), 400, ink, 'right');
      if (cfg.show_unit_price !== false) T(fmt(i.price * mult), cp, y, fs(17), 400, ink, 'right');
      T(fmt(i.qty * i.price * mult), ct, y, fs(17), 700, ink, 'right');
      y += (L.length - 1) * fs(22) + 14;
      if (!dry) { g.fillStyle = line; g.fillRect(P, y, W - P * 2, 1); }
    });

    // 5. Subtotales
    const row = (l, v, col = mut) => { y += fs(28); T(l, W - P - 270, y, fs(16), 400, col); T(v, ct, y, fs(16), 600, col === mut ? ink : col, 'right'); };
    if (cfg.show_unit_price !== false) {
      y += 6;
      row('Subtotal', fmt(doc.subtotal * mult) + ' ' + cLabel);
      if (doc.discount) row('Descuento', '-' + fmt(doc.discount * mult) + ' ' + cLabel, '#b4381a');
      if (doc.tax) row('IVA', fmt(doc.tax * mult) + ' ' + cLabel);
    }

    // 6. Total principal (respetando moneda y estilo)
    y += 24;
    const twoCur = showUsd && showBs;
    const showRateLine = set.ticket_show_rate && doc.rate > 0;
    const bh = 68 + (twoCur ? 28 : 0) + (showRateLine ? 24 : 0);
    if (minimal) {
      R(P - 12, y, W - P * 2 + 24, bh, 18, acc + '14');
      B(P - 12, y, W - P * 2 + 24, bh, 18, acc, 2);
    } else {
      R(P - 12, y, W - P * 2 + 24, bh, 20, acc);
    }
    const primaryTxt = cfg.currency_mode === 'bs_first' && showBs
      ? (fmt(doc.total * doc.rate) + ' Bs')
      : (showUsd ? fmt(doc.total) + ' USD' : fmt(doc.total * doc.rate) + ' Bs');
    const secondaryTxt = twoCur
      ? (cfg.currency_mode === 'bs_first' ? (fmt(doc.total) + ' USD') : (fmt(doc.total * doc.rate) + ' Bs'))
      : '';
    const totTitleCol = minimal ? acc : 'rgba(255,255,255,.85)';
    const totMainCol = minimal ? ink : '#fff';
    const totSubCol = minimal ? mut : 'rgba(255,255,255,.92)';
    const totRateCol = minimal ? mut : 'rgba(255,255,255,.78)';

    T(doc.quote ? 'TOTAL' : 'TOTAL A PAGAR', P + 10, y + 40, fs(15), 700, totTitleCol);
    T(primaryTxt, ct - 8, y + 48, fs(36), 800, totMainCol, 'right');
    if (secondaryTxt) T(secondaryTxt, ct - 8, y + 80, fs(20), 600, totSubCol, 'right');
    if (showRateLine) T('Tasa: ' + fmt(doc.rate, 4) + ' Bs/USD', ct - 8, y + (secondaryTxt ? 104 : 80), fs(14), 400, totRateCol, 'right');
    y += bh;

    // 7. Pagos y saldo pendiente
    if (set.ticket_show_payments !== false && (doc.pays.length || doc.balance)) {
      y += 34; T('PAGOS', P, y, fs(12), 700, mut);
      doc.pays.forEach(p => {
        y += fs(28);
        T(p.label, P, y, fs(16), 400, ink);
        T(fmt(p.amount) + (p.cur === 'USD' ? ' USD' : ' Bs'), ct, y, fs(16), 600, ink, 'right');
      });
      if (doc.balance) {
        y += fs(32);
        T('Pendiente por pagar', P, y, fs(17), 800, '#8a5a00');
        T(fmt(doc.balance) + ' USD' + (showBs ? ` (${fmt(doc.balance * doc.rate)} Bs)` : ''), ct, y, fs(17), 800, '#8a5a00', 'right');
      }
    }

    // 8. Notas
    if (cfg.show_notes !== false && doc.notes) {
      y += 14;
      wrap('Nota: ' + doc.notes, W - P * 2, fs(15), 400).forEach(t => { y += fs(22); T(t, P, y, fs(15), 400, mut); });
    }

    // 9. Datos de pago (Pago Móvil / Cuentas) si está habilitado
    if (shouldShowPayDetails(doc, cfg)) {
      const cleanDet = doc.payDetails.replace(/\*/g, '').trim();
      const dLines = wrap(cleanDet, W - P * 2 - 24, fs(14), 400);
      y += 22;
      const boxH = 38 + dLines.length * fs(20);
      R(P - 12, y, W - P * 2 + 24, boxH, 14, '#f3f6f7');
      B(P - 12, y, W - P * 2 + 24, boxH, 14, line, 1.2);
      T('DATOS PARA PAGAR', P + 2, y + 24, fs(12), 800, acc);
      let dy = y + 46;
      dLines.forEach(l => { T(l, P + 2, dy, fs(14), 400, ink); dy += fs(20); });
      y += boxH;
    }

    // 10. Espacio para firma
    if (cfg.show_signature) {
      y += 66;
      if (!dry) { g.fillStyle = ink; g.fillRect(W / 2 - 140, y, 280, 1.5); }
      y += 20;
      T(cfg.signature_label || 'Recibido conforme / Firma', W / 2, y, fs(14), 600, mut, 'center');
    }

    // 11. Pie de página
    y += 34;
    if (!dry) { g.fillStyle = line; g.fillRect(P, y, W - P * 2, 1); }
    const foot = [set.ticket_footer, doc.quote && 'Precios sujetos a cambio según la tasa del día.'].filter(Boolean);
    foot.forEach(t => wrap(t, W - P * 2, fs(16), 600).forEach(l => { y += fs(28); T(l, W / 2, y, fs(16), 600, mut, 'center'); }));
    y += P;
  };
  paint();
  const H = y, c = document.createElement('canvas'); c.width = W * sc; c.height = H * sc;
  g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); dry = false; paint();
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear la imagen')), 'image/png'));
}
