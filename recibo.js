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
    ivaPct: Number(s.iva_percent || 0),
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
    ivaPct: Number(s.iva_percent || 0),
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
  const showBs = (typeof S === 'undefined' || S.bimoneda !== false) && cfg.currency_mode !== 'usd' && set.ticket_show_bs !== false && doc.rate > 0;
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
  const cLabel = priceOnlyBs ? secSym() : curLabel();
  if (cfg.show_unit_price !== false) {
    o.push(two(`Subtotal ${cLabel}`, fmt(doc.subtotal * mult)));
    if (+doc.discount) o.push(two('Descuento', '-' + fmt(doc.discount * mult)));
    if (+doc.tax) o.push(two(doc.ivaPct ? `IVA (${qty(doc.ivaPct)}%)` : 'IVA', fmt(doc.tax * mult)));
  }

  if (cfg.currency_mode === 'bs_first' && showBs) {
    o.push(two('TOTAL ' + secSym(), fmtSec(doc.total * doc.rate)));
    if (showUsd) o.push(two('TOTAL ' + curLabel(), fmtCur(doc.total)));
  } else {
    if (showUsd) o.push(two('TOTAL ' + curLabel(), fmtCur(doc.total)));
    if (showBs) o.push(two('TOTAL ' + secSym(), fmtSec(doc.total * doc.rate)));
  }
  if (set.ticket_show_rate && doc.rate > 0) o.push('Tasa: ' + fmt(doc.rate, 4) + ' ' + secSym() + '/' + curLabel());

  if (set.ticket_show_payments !== false && (doc.pays.length || doc.balance > 0.01)) {
    if (doc.pays.length) {
      o.push(ln, 'PAGOS');
      doc.pays.forEach(p => o.push(two(p.label, p.cur === 'VES' ? fmtSec(p.amount) : fmtCur(p.amount))));
    }
    if (doc.balance > 0.01) {
      o.push(two('POR PAGAR', fmtCur(doc.balance)));
      if (showBs) o.push(two('POR PAGAR ' + secSym(), fmtSec(doc.balance * doc.rate)));
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
  const showBs = (typeof S === 'undefined' || S.bimoneda !== false) && cfg.currency_mode !== 'usd' && set.ticket_show_bs !== false && doc.rate > 0;
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
    const cLabel = priceOnlyBs ? secSym() : curLabel();
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
    const fmtLineC = (v) => priceOnlyBs ? fmtSec(v) : fmtCur(v);
    if (cfg.show_unit_price !== false) {
      y += 6;
      row('Subtotal', fmtLineC(doc.subtotal * mult));
      if (doc.discount) row('Descuento', '-' + fmtLineC(doc.discount * mult), '#b4381a');
      if (doc.tax) row(doc.ivaPct ? `IVA (${qty(doc.ivaPct)}%)` : 'IVA', fmtLineC(doc.tax * mult));
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
      ? fmtSec(doc.total * doc.rate)
      : (showUsd ? fmtCur(doc.total) : fmtSec(doc.total * doc.rate));
    const secondaryTxt = twoCur
      ? (cfg.currency_mode === 'bs_first' ? fmtCur(doc.total) : fmtSec(doc.total * doc.rate))
      : '';
    const totTitleCol = minimal ? acc : 'rgba(255,255,255,.85)';
    const totMainCol = minimal ? ink : '#fff';
    const totSubCol = minimal ? mut : 'rgba(255,255,255,.92)';
    const totRateCol = minimal ? mut : 'rgba(255,255,255,.78)';

    T(doc.quote ? 'TOTAL' : 'TOTAL A PAGAR', P + 10, y + 40, fs(15), 700, totTitleCol);
    T(primaryTxt, ct - 8, y + 48, fs(36), 800, totMainCol, 'right');
    if (secondaryTxt) T(secondaryTxt, ct - 8, y + 80, fs(20), 600, totSubCol, 'right');
    if (showRateLine) T('Tasa: ' + fmt(doc.rate, 4) + ' ' + secSym() + '/' + curLabel(), ct - 8, y + (secondaryTxt ? 104 : 80), fs(14), 400, totRateCol, 'right');
    y += bh;

    // 7. Pagos y saldo pendiente
    if (set.ticket_show_payments !== false && (doc.pays.length || doc.balance)) {
      y += 34; T('PAGOS', P, y, fs(12), 700, mut);
      doc.pays.forEach(p => {
        y += fs(28);
        T(p.label, P, y, fs(16), 400, ink);
        T(p.cur === 'VES' ? fmtSec(p.amount) : fmtCur(p.amount), ct, y, fs(16), 600, ink, 'right');
      });
      if (doc.balance) {
        y += fs(32);
        T('Pendiente por pagar', P, y, fs(17), 800, '#8a5a00');
        T(fmtCur(doc.balance) + (showBs ? ` (${fmt(doc.balance * doc.rate)} Bs)` : ''), ct, y, fs(17), 800, '#8a5a00', 'right');
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

// Hoja / Orden de producción en foto (para WhatsApp al equipo de planta o impresión)
async function prodOrderBlob(doc, set, showCosts = false) {
  const W = 720, P = 40, sc = 2, F = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const acc = /^#[0-9a-f]{6}$/i.test(set?.ticket_color || '') ? set.ticket_color : '#0b7285', ink = '#14262d', mut = '#6b7f88', line = '#e3eaed';
  const logo = set?.ticket_show_logo && set?.logo_data
    ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = set.logo_data; })
    : null;
  const m = document.createElement('canvas').getContext('2d');
  let g, dry = true, y = 0;
  const fnt = (sz, w = 400) => `${w} ${sz}px ${F}`;
  const wrap = (t, mw, sz, w) => {
    m.font = fnt(sz, w); const out = [];
    String(t || '').split('\n').forEach(par => {
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

  const paint = () => {
    // Encabezado
    const tx = logo ? P + 90 : P, tmax = W - tx - P;
    const nameL = wrap(set?.business_name || 'Mi negocio', tmax, 26, 800);
    const hh = P + Math.max(nameL.length * 32 + 24, logo ? 72 : 0) + P - 12;
    R(0, 0, W, hh, 0, acc);
    if (logo) {
      R(P, P - 4, 72, 72, 16, '#fff');
      if (!dry) {
        const k = Math.min(60 / logo.width, 60 / logo.height), lw = logo.width * k, lh = logo.height * k;
        g.drawImage(logo, P + 36 - lw / 2, P + 32 - lh / 2, lw, lh);
      }
    }
    let ty = P + 24;
    nameL.forEach(t => { T(t, tx, ty, 26, 800, '#fff'); ty += 32; });
    T('HOJA DE PRODUCCIÓN / LOTE', tx, ty - 4, 14, 700, 'rgba(255,255,255,.88)');

    // Orden, fecha y estado
    y = hh + 46;
    T('ORDEN #' + doc.id, P, y, 24, 800, acc);
    const stColors = {'EN PROCESO': ['#8a5a00', '#fff2cc'], COMPLETADA: ['#1b7f4b', '#e3f5ea'], ANULADA: ['#b4381a', '#fde8e3']};
    const sc2 = stColors[doc.status] || [mut, line];
    const bw = tw(doc.status, 14, 800) + 30;
    R(W - P - bw, y - 24, bw, 34, 17, sc2[1]);
    T(doc.status, W - P - bw / 2, y - 2, 14, 800, sc2[0], 'center');

    y += 26;
    T('Fecha: ' + doc.dateStr, P, y, 15, 400, mut);

    // Caja del producto a fabricar
    y += 22;
    const prodL = wrap(doc.productName, W - P * 2 - 220, 22, 800);
    const boxH = Math.max(76, 36 + prodL.length * 28);
    R(P - 12, y, W - P * 2 + 24, boxH, 16, acc + '16');
    B(P - 12, y, W - P * 2 + 24, boxH, 16, acc, 1.8);
    T('PRODUCTO A FABRICAR', P + 4, y + 24, 12, 800, acc);
    prodL.forEach((l, k) => T(l, P + 4, y + 52 + k * 28, 22, 800, ink));
    T('CANTIDAD', W - P - 6, y + 24, 12, 700, mut, 'right');
    T(`${qty(doc.qty)} ${doc.unit}`, W - P - 6, y + 56, 26, 800, acc, 'right');
    y += boxH;

    // Ingredientes / Materiales
    y += 30;
    R(P - 12, y, W - P * 2 + 24, 36, 10, acc + '1f');
    const cPlan = showCosts ? W - P - 220 : W - P - 140;
    const cAct = showCosts ? W - P - 115 : W - P;
    const cCost = W - P;
    const descW = showCosts ? 310 : 390;
    T('Ingrediente / Material', P + 26, y + 24, 14, 700, acc);
    T('Teórico', cPlan, y + 24, 14, 700, acc, 'right');
    T('Usado', cAct, y + 24, 14, 700, acc, 'right');
    if (showCosts) T('Costo ' + curLabel(), cCost, y + 24, 14, 700, acc, 'right');
    y += 36;

    doc.items.forEach(it => {
      const tag = it.untracked ? ' (libre)' : '';
      const L = wrap(it.name + tag, descW, 17, 600);
      y += 30;
      // Cuadrito de checklist para marcar en planta
      B(P, y - 15, 16, 16, 4, acc, 1.8);
      L.forEach((t, k) => T(t, P + 26, y + k * 22, 17, 600, ink));
      T(`${qty(it.planned)} ${it.unit}`, cPlan, y, 16, 400, mut, 'right');
      T(`${qty(it.actual)} ${it.unit}`, cAct, y, 17, 700, ink, 'right');
      if (showCosts) T(fmt(it.costUsd), cCost, y, 16, 600, ink, 'right');
      y += (L.length - 1) * 22 + 14;
      if (!dry) { g.fillStyle = line; g.fillRect(P, y, W - P * 2, 1); }
    });

    if (showCosts) {
      y += 24;
      R(P - 12, y, W - P * 2 + 24, 68, 16, acc);
      T('COSTO TOTAL DEL LOTE', P + 8, y + 32, 13, 700, 'rgba(255,255,255,.85)');
      T(`Costo por ${doc.unit}: ${fmtCur(doc.unitCostUsd)}`, P + 8, y + 54, 15, 600, '#fff');
      T(fmtCur(doc.totalCostUsd), W - P - 8, y + 46, 30, 800, '#fff', 'right');
      y += 68;
    }

    if (doc.notes) {
      y += 24;
      const nLines = wrap(doc.notes, W - P * 2 - 20, 15, 400);
      const nh = 34 + nLines.length * 22;
      R(P - 12, y, W - P * 2 + 24, nh, 12, '#f3f6f7');
      T('NOTAS DEL LOTE', P + 2, y + 22, 12, 800, mut);
      nLines.forEach((l, k) => T(l, P + 2, y + 44 + k * 22, 15, 400, ink));
      y += nh;
    }

    // Firma del responsable de producción
    y += 58;
    if (!dry) { g.fillStyle = ink; g.fillRect(P, y, 250, 1.5); g.fillRect(W - P - 250, y, 250, 1.5); }
    y += 20;
    T('Preparado por', P + 125, y, 13, 600, mut, 'center');
    T('Verificado / Control', W - P - 125, y, 13, 600, mut, 'center');
    y += P;
  };

  paint();
  const H = y, c = document.createElement('canvas'); c.width = W * sc; c.height = H * sc;
  g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); dry = false; paint();
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear la hoja de producción')), 'image/png'));
}

// ---------- Comprobante de Pago / Abono en foto y texto térmico ----------
function paymentReceiptText(doc, set) {
  const w = set?.ticket_paper === '80mm' ? 42 : 32, ln = '-'.repeat(w);
  const two = (a, b) => {
    const sa = String(a), sb = String(b);
    return sa + ' '.repeat(Math.max(1, w - sa.length - sb.length)) + sb;
  };
  const showBs = (typeof S === 'undefined' || S.bimoneda !== false) && Number(doc.rate || 0) > 0;
  const fullPaid = Number(doc.remainingUsd || 0) <= 0.01;
  const info = set?.ticket_show_info === false
    ? []
    : [set?.business_rif && 'RIF: ' + set.business_rif, set?.business_phone, set?.business_address];
  const o = [
    (set?.business_name || 'Mi negocio').toUpperCase(),
    ...info,
    ln,
    `COMPROBANTE DE PAGO [${fullPaid ? 'SALDADO' : 'ABONO'}]`,
    'Fecha: ' + (doc.created_at ? fdate(doc.created_at) : dmy(doc.date)),
    'Cliente: ' + (doc.customer || 'Cliente general'),
    doc.phone ? 'Tlf: ' + doc.phone : '',
    ln,
    doc.concept || 'Abono a cuenta pendiente',
    ln,
    two('Saldo anterior', fmtCur(doc.prevBalanceUsd)),
    two('Monto abonado', fmtCur(doc.paidUsd)),
    doc.paidCur === 'VES' ? two('Recibido en Bs', fmt(doc.paidOrig) + ' Bs') : '',
    doc.methodLabel ? two('Método', doc.methodLabel) : '',
    doc.reference ? 'Ref: ' + doc.reference : '',
    ln,
    two(fullPaid ? 'SALDO PENDIENTE' : 'RESTA POR PAGAR', fmtCur(Math.max(0, doc.remainingUsd))),
    !fullPaid && showBs ? two('Equiv. en Bs', fmt(Math.max(0, doc.remainingUsd) * doc.rate) + ' Bs') : '',
    fullPaid ? '¡Cuenta pagada en su totalidad!' : '',
    set?.ticket_footer ? ln : '',
    set?.ticket_footer || ''
  ].filter(Boolean);
  return o.join('\n');
}

async function paymentReceiptBlob(doc, set) {
  const W = 720, P = 40, sc = 2, F = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const acc = /^#[0-9a-f]{6}$/i.test(set?.ticket_color || '') ? set.ticket_color : '#0b7285';
  const ink = '#14262d', mut = '#6b7f88', line = '#e3eaed';
  const showBs = (typeof S === 'undefined' || S.bimoneda !== false) && Number(doc.rate || 0) > 0;
  const fullPaid = Number(doc.remainingUsd || 0) <= 0.01;
  const logo = set?.ticket_show_logo && set?.logo_data
    ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = set.logo_data; })
    : null;

  const m = document.createElement('canvas').getContext('2d');
  let g, dry = true, y = 0;
  const fnt = (sz, w = 400) => `${w} ${sz}px ${F}`;
  const wrap = (t, mw, sz, w) => {
    m.font = fnt(sz, w); const out = [];
    String(t || '').split('\n').forEach(par => {
      let ln = '';
      par.split(' ').forEach(wd => {
        const tt = ln ? ln + ' ' + wd : wd;
        if (ln && m.measureText(tt).width > mw) { out.push(ln); ln = wd; } else ln = tt;
      });
      out.push(ln);
    });
    return out;
  };
  const tw = (t, sz, w) => { m.font = fnt(sz, w); return m.measureText(String(t ?? '')).width; };
  const T = (t, x, yy, sz, w, col, al = 'left') => { if (dry) return; g.font = fnt(sz, w); g.fillStyle = col; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(String(t ?? ''), x, yy); };
  const R = (x, yy, w, h, r, col) => { if (dry) return; g.beginPath(); (g.roundRect || g.rect).call(g, x, yy, w, h, r); g.fillStyle = col; g.fill(); };
  const B = (x, yy, w, h, r, col, lw = 1.6) => { if (dry) return; g.beginPath(); (g.roundRect || g.rect).call(g, x, yy, w, h, r); g.strokeStyle = col; g.lineWidth = lw; g.stroke(); };

  const paint = () => {
    const tx = logo ? P + 96 : P, tmax = W - tx - P;
    const info = set?.ticket_show_info === false ? [] : [set?.business_rif && 'RIF: ' + set.business_rif, set?.business_phone].filter(Boolean);
    const nameL = wrap(set?.business_name || 'Mi negocio', tmax, 28, 800);
    const hh = P + Math.max(nameL.length * 34 + (info.length ? 22 : 0), logo ? 78 : 0) + P - 10;
    R(0, 0, W, hh, 0, acc);
    if (logo) {
      R(P, P - 4, 78, 78, 16, '#fff');
      if (!dry) {
        const k = Math.min(64 / logo.width, 64 / logo.height), lw = logo.width * k, lh = logo.height * k;
        g.drawImage(logo, P + 39 - lw / 2, P + 35 - lh / 2, lw, lh);
      }
    }
    let ty = P + 26;
    nameL.forEach(t => { T(t, tx, ty, 28, 800, '#fff'); ty += 34; });
    if (info.length) T(info.join('  ·  '), tx, ty - 6, 14, 500, 'rgba(255,255,255,.88)');

    y = hh + 48;
    T('COMPROBANTE DE PAGO', P, y, 22, 800, acc);
    const badgeTxt = fullPaid ? 'SALDADO' : 'ABONO PARCIAL';
    const badgeCol = fullPaid ? ['#1b7f4b', '#e3f5ea'] : ['#8a5a00', '#fff2cc'];
    const bw = tw(badgeTxt, 13, 800) + 28;
    R(W - P - bw, y - 24, bw, 34, 17, badgeCol[1]);
    T(badgeTxt, W - P - bw / 2, y - 2, 13, 800, badgeCol[0], 'center');

    y += 28;
    T('Fecha: ' + (doc.created_at ? fdate(doc.created_at) : dmy(doc.date)), P, y, 15, 400, mut);

    y += 38;
    T('RECIBIDO DE', P, y, 12, 700, mut);
    y += 26;
    T(doc.customer || 'Cliente general', P, y, 22, 800, ink);
    if (doc.phone) { y += 22; T(doc.phone, P, y, 15, 400, mut); }

    // Concepto
    y += 26;
    const cLines = wrap(doc.concept || 'Abono a cuenta pendiente', W - P * 2 - 28, 16, 600);
    const ch = 36 + cLines.length * 22;
    R(P - 10, y, W - P * 2 + 20, ch, 14, '#f3f6f7');
    T('CONCEPTO', P + 6, y + 22, 11, 800, mut);
    cLines.forEach((l, k) => T(l, P + 6, y + 44 + k * 22, 16, 600, ink));
    y += ch;

    // Caja destacada del monto abonado
    y += 22;
    const paidBs = showBs ? (doc.paidCur === 'VES' ? fmt(doc.paidOrig) + ' Bs' : fmt(doc.paidUsd * doc.rate) + ' Bs') : '';
    const bh = paidBs ? 104 : 76;
    R(P - 10, y, W - P * 2 + 20, bh, 18, acc);
    T('MONTO ABONADO', P + 10, y + 36, 14, 700, 'rgba(255,255,255,.86)');
    T(fmtCur(doc.paidUsd), W - P - 10, y + 48, 36, 800, '#fff', 'right');
    if (paidBs) T(paidBs + (doc.rate > 0 ? `  (Tasa: ${fmt(doc.rate, 2)})` : ''), W - P - 10, y + 82, 18, 600, 'rgba(255,255,255,.92)', 'right');
    y += bh;

    // Desglose de saldos y método
    const row = (l, v, col = ink, bold = 600) => {
      y += 32;
      T(l, P, y, 16, 500, mut);
      T(v, W - P, y, 16, bold, col, 'right');
      y += 12;
      if (!dry) { g.fillStyle = line; g.fillRect(P, y, W - P * 2, 1); }
    };
    y += 10;
    row('Saldo anterior', fmtCur(doc.prevBalanceUsd));
    row('Monto abonado', '-' + fmtCur(doc.paidUsd), '#1b7f4b', 700);
    if (doc.methodLabel) row('Método de pago', doc.methodLabel + (doc.accountName ? ' (' + doc.accountName + ')' : ''));
    if (doc.reference) row('Referencia', doc.reference);

    y += 24;
    const rem = Math.max(0, Number(doc.remainingUsd || 0));
    const remBoxH = (!fullPaid && showBs) ? 74 : 56;
    R(P - 10, y, W - P * 2 + 20, remBoxH, 14, fullPaid ? '#e3f5ea' : '#fff2cc');
    B(P - 10, y, W - P * 2 + 20, remBoxH, 14, fullPaid ? '#1b7f4b' : '#c48a00', 1.5);
    T(fullPaid ? 'CUENTA SALDADA' : 'SALDO RESTANTE', P + 8, y + 35, 15, 800, fullPaid ? '#1b7f4b' : '#8a5a00');
    T(fmtCur(rem), W - P - 8, y + 37, 24, 800, fullPaid ? '#1b7f4b' : '#8a5a00', 'right');
    if (!fullPaid && showBs) T(`≈ ${fmt(rem * doc.rate)} Bs a la tasa de hoy`, W - P - 8, y + 60, 14, 600, '#8a5a00', 'right');
    y += remBoxH;

    if (set?.ticket_footer) {
      y += 30;
      wrap(set.ticket_footer, W - P * 2, 15, 600).forEach(l => { y += 22; T(l, W / 2, y, 15, 600, mut, 'center'); });
    }
    y += P;
  };
  paint();
  const H = y, c = document.createElement('canvas'); c.width = W * sc; c.height = H * sc;
  g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); dry = false; paint();
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear el comprobante')), 'image/png'));
}

async function showPaymentReceipt(doc) {
  const set = await q(db.from('settings').select('*').eq('id', 1).single()).catch(() => ({}));
  const text = paymentReceiptText(doc, set);
  const blobP = paymentReceiptBlob(doc, set).catch(() => null);
  openSheet('Comprobante de pago', `
    <div id="tPrev"><pre class="ticket">${esc(text)}</pre></div>
    <div class="row">
      <button class="btn" id="prShare">Enviar por WhatsApp</button>
      <button class="btn ghost" id="prDown">Descargar foto</button>
    </div>
    <div class="row">
      <button class="btn ghost" id="prPrint">Imprimir</button>
      <button class="btn ghost" id="prTxt">Enviar como texto</button>
    </div>`);
  showPrev(blobP, set);
  const fname = 'comprobante-pago-' + caracasDate();
  $('#prShare').onclick = () => run(async () => shareImage(await blobP, doc.phone, fname));
  $('#prDown').onclick = () => run(async () => { const b = await blobP; if (!b) throw new Error('No se pudo crear la imagen'); downloadBlob(b, fname + '.png'); });
  $('#prPrint').onclick = () => printTicket(text, set.ticket_paper);
  $('#prTxt').onclick = () => window.open(`https://wa.me/${waDigits(doc.phone)}?text=${encodeURIComponent(text)}`, '_blank');
}


// ---------- Impresión térmica en 1 toque para Android (RawBT / Bluetooth ESC/POS) ----------
function thermalSanitize(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .replace(/[¿]/g, '?').replace(/[¡]/g, '!')
    .replace(/[×]/g, 'x').replace(/[·•]/g, '-').replace(/[—–]/g, '-')
    .replace(/[→⇒]/g, '->').replace(/[°ºª]/g, 'o').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E\n]/g, '');
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function buildEscPosTicket(doc, set) {
  const cfg = ticketCfg(set || {});
  const w = set?.ticket_paper === '80mm' ? 42 : 32;
  const ln = '-'.repeat(w);
  const out = [];
  const push = (...a) => out.push(...a);
  const txt = (str) => {
    const clean = thermalSanitize(str);
    for (let i = 0; i < clean.length; i++) out.push(clean.charCodeAt(i) & 0x7f);
  };
  const line = (str = '') => { txt(str); out.push(0x0A); };
  const wrapLine = (str) => {
    const clean = thermalSanitize(str);
    if (!clean) { out.push(0x0A); return; }
    for (let i = 0; i < clean.length; i += w) line(clean.slice(i, i + w));
  };
  const two = (a, b) => {
    const sa = thermalSanitize(a), sb = thermalSanitize(b);
    const gap = Math.max(1, w - sa.length - sb.length);
    if (sa.length + 1 + sb.length > w) {
      wrapLine(sa);
      line(' '.repeat(Math.max(0, w - sb.length)) + sb);
    } else {
      line(sa + ' '.repeat(gap) + sb);
    }
  };
  const align = (n) => push(0x1B, 0x61, n);
  const bold = (on) => push(0x1B, 0x45, on ? 1 : 0);
  const size = (dbl) => push(0x1D, 0x21, dbl ? 0x11 : 0x00);

  push(0x1B, 0x40);
  align(1);
  bold(true);
  size(true);
  line((set?.business_name || 'MI NEGOCIO').toUpperCase().slice(0, Math.floor(w / 2)));
  size(false);
  bold(false);
  if (set?.ticket_header) wrapLine(set.ticket_header);
  if (set?.ticket_show_info !== false) {
    if (set?.business_rif) wrapLine('RIF: ' + set.business_rif);
    if (set?.business_phone) wrapLine(set.business_phone);
    if (set?.business_address) wrapLine(set.business_address);
  }
  if (cfg.social) wrapLine(cfg.social);

  align(0);
  line(ln);
  bold(true);
  wrapLine(`${doc.title} #${doc.number}` + (cfg.show_status && doc.status ? ` [${doc.status}]` : ''));
  bold(false);
  const dateLine = cfg.show_time && doc.created_at ? fdate(doc.created_at) : ('Fecha: ' + dmy(doc.date));
  wrapLine(dateLine);
  if (doc.deliveryLine) wrapLine(doc.deliveryLine);
  if (doc.valid) wrapLine('Valida hasta: ' + dmy(doc.valid));
  if (set?.ticket_show_customer !== false) {
    wrapLine(`${doc.partyLabel ? doc.partyLabel + ': ' : 'Cliente: '}${doc.customer}`);
    if (doc.phone) wrapLine('Tlf: ' + doc.phone);
  }
  line(ln);

  const showUsd = cfg.currency_mode !== 'bs';
  const showBs = (typeof S === 'undefined' || S.bimoneda !== false) && cfg.currency_mode !== 'usd' && set?.ticket_show_bs !== false && doc.rate > 0;
  const priceOnlyBs = cfg.currency_mode === 'bs' && doc.rate > 0;

  (doc.items || []).forEach(i => {
    const label = (cfg.show_sku && i.sku ? `[${i.sku}] ` : '') + i.name;
    const uPrice = priceOnlyBs ? i.price * doc.rate : i.price;
    const tot = i.qty * uPrice;
    const curTag = priceOnlyBs ? ' Bs' : '';
    if (cfg.show_unit_price !== false) {
      wrapLine(label);
      two(`  ${qty(i.qty)} x ${fmt(uPrice)}${curTag}`, fmt(tot) + curTag);
    } else {
      two(`${qty(i.qty)} ${label}`.slice(0, Math.max(8, w - 11)), fmt(tot) + curTag);
    }
  });

  line(ln);
  const mult = priceOnlyBs ? doc.rate : 1;
  const cLabel = priceOnlyBs ? secSym() : curLabel();
  if (cfg.show_unit_price !== false && (doc.discount || doc.tax)) {
    two(`Subtotal ${cLabel}`, fmt(doc.subtotal * mult));
    if (+doc.discount) two('Descuento', '-' + fmt(doc.discount * mult));
    if (+doc.tax) two(doc.ivaPct ? `IVA (${qty(doc.ivaPct)}%)` : 'IVA', fmt(doc.tax * mult));
  }

  bold(true);
  if (cfg.currency_mode === 'bs_first' && showBs) {
    two('TOTAL ' + secSym(), fmtSec(doc.total * doc.rate));
    if (showUsd) two('TOTAL ' + curLabel(), fmtCur(doc.total));
  } else {
    if (showUsd) two('TOTAL ' + curLabel(), fmtCur(doc.total));
    if (showBs) two('TOTAL ' + secSym(), fmtSec(doc.total * doc.rate));
  }
  bold(false);
  if (set?.ticket_show_rate && doc.rate > 0) wrapLine('Tasa: ' + fmt(doc.rate, 4) + ' ' + secSym() + '/' + curLabel());

  if (set?.ticket_show_payments !== false && ((doc.pays && doc.pays.length) || doc.balance > 0.01)) {
    if (doc.pays && doc.pays.length) {
      line(ln);
      bold(true); line('PAGOS / ABONOS'); bold(false);
      doc.pays.forEach(p => two(p.label, p.cur === 'VES' ? fmtSec(p.amount) : fmtCur(p.amount)));
    }
    if (doc.balance > 0.01) {
      bold(true);
      two('POR PAGAR', fmtCur(doc.balance));
      if (showBs) two('POR PAGAR ' + secSym(), fmtSec(doc.balance * doc.rate));
      bold(false);
    }
  }

  if (cfg.show_notes !== false && doc.notes) {
    line(ln);
    wrapLine('Nota: ' + doc.notes);
  }
  if (shouldShowPayDetails(doc, cfg)) {
    line(ln);
    doc.payDetails.replace(/\*/g, '').trim().split('\n').forEach(l => wrapLine(l));
  }
  if (cfg.show_signature) {
    line(''); line('');
    align(1);
    line('_'.repeat(Math.min(26, w)));
    wrapLine(cfg.signature_label || 'Recibido conforme / Firma');
    align(0);
  }
  if (set?.ticket_footer) {
    line(ln);
    align(1);
    wrapLine(set.ticket_footer);
    align(0);
  }
  if (doc.quote) {
    align(1);
    wrapLine('Precios sujetos a cambio segun tasa del dia.');
    align(0);
  }
  line(''); line(''); line(''); line('');
  push(0x1D, 0x56, 0x42, 0x00);
  return new Uint8Array(out);
}

function canvasToEscPosRaster(srcCanvas, targetWidth = 384) {
  const scale = targetWidth / srcCanvas.width;
  const w = Math.ceil(targetWidth / 8) * 8;
  const h = Math.max(1, Math.round(srcCanvas.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(srcCanvas, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h).data;
  const xBytes = w / 8;
  const header = [
    0x1B, 0x40,
    0x1B, 0x61, 0x01,
    0x1D, 0x76, 0x30, 0x00,
    xBytes & 0xFF, (xBytes >> 8) & 0xFF,
    h & 0xFF, (h >> 8) & 0xFF
  ];
  const footer = [0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00];
  const out = new Uint8Array(header.length + xBytes * h + footer.length);
  out.set(header, 0);
  let pos = header.length;
  for (let y = 0; y < h; y++) {
    for (let xb = 0; xb < xBytes; xb++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xb * 8 + bit;
        const idx = (y * w + x) * 4;
        const lum = 0.299 * img[idx] + 0.587 * img[idx + 1] + 0.114 * img[idx + 2];
        if (lum < 165) byte |= (0x80 >> bit);
      }
      out[pos++] = byte;
    }
  }
  out.set(footer, pos);
  return out;
}

function printRawBT(doc, set) {
  const bytes = buildEscPosTicket(doc, set || {});
  const b64 = bytesToBase64(bytes);
  const isAndroid = /Android/i.test(navigator.userAgent || '');
  if (!isAndroid) {
    toast('Abriendo RawBT (diseñado para Android + impresora térmica Bluetooth). En PC usa "Imprimir".');
  } else {
    toast('Enviando ticket a impresora térmica (RawBT)...');
  }
  window.location.href = 'rawbt:base64,' + b64;
}

function printRawBTCanvas(canvas, paper = '58mm') {
  const targetW = paper === '80mm' ? 576 : 384;
  const bytes = canvasToEscPosRaster(canvas, targetW);
  const b64 = bytesToBase64(bytes);
  const isAndroid = /Android/i.test(navigator.userAgent || '');
  if (!isAndroid) {
    toast('Enviando etiqueta a RawBT (para Android). En PC usa "Imprimir" o "Descargar PNG".');
  } else {
    toast('Enviando etiqueta a impresora térmica (RawBT)...');
  }
  window.location.href = 'rawbt:base64,' + b64;
}

function orderDoc(order, items, set, payDetails = '') {
  const total = Number(order.total_usd || 0);
  const dep = Number(order.deposit_usd || 0);
  const bal = Math.max(0, total - dep);
  const stLabels = {pendiente: 'PENDIENTE', preparacion: 'EN PREPARACIÓN', listo: 'LISTO', entregado: 'ENTREGADO', cancelado: 'CANCELADO'};
  return {
    kind: 'nota',
    title: 'PEDIDO / ENCARGO',
    number: order.id,
    date: order.order_date,
    created_at: order.created_at,
    deliveryLine: order.delivery_date ? (`Entrega: ${dmy(order.delivery_date)}${order.delivery_time ? ' ' + order.delivery_time : ''}`) : '',
    customer: order.customer_name || order.parties?.name || 'Cliente general',
    phone: order.customer_phone || order.parties?.phone || '',
    items: (items || []).map(i => ({name: i.name || i.products?.name || 'Artículo', sku: i.products?.sku || '', qty: +i.quantity, price: +i.unit_price_usd})),
    subtotal: total,
    discount: 0,
    tax: 0,
    ivaPct: 0,
    total,
    rate: Number(order.exchange_rate || S.rate || 0),
    pays: dep > 0.005 ? [{label: 'Abono / Anticipo', amount: dep, cur: 'USD'}] : [],
    balance: bal,
    status: stLabels[order.status] || String(order.status || '').toUpperCase(),
    notes: order.notes || '',
    payDetails
  };
}
