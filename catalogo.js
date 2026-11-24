// Catálogo profesional personalizable: estilos, 2/3 columnas o lista, precio tachado, datos de pago, foto PNG, texto WhatsApp, PDF y Excel
const CPW = 794, CPH = 1123, CM = 38;
const CT_DEF = {
  list: 'base',
  cur: 'both',           // 'usd' | 'both' | 'bs_first' | 'bs'
  iva: false,
  stock: 'all',          // 'all' | 'instock'
  avail: 'status',       // 'none' | 'status' | 'qty'
  incSvc: false,
  photos: true,
  sku: true,
  showUnit: true,
  group: true,
  sort: 'name',          // 'name' | 'price_asc' | 'price_desc'
  style: 'moderno',      // 'moderno' | 'minimal' | 'oscuro'
  layout: 'cards2',      // 'cards2' | 'cards3' | 'list'
  color: '',
  showLogo: true,
  showDate: true,
  showRate: false,
  showContact: true,
  showCompare: true,
  showPay: false,
  cats: null,
  excluded: [],
  title: 'Catálogo de productos',
  subtitle: '',
  social: '',
  note: 'Precios sujetos a cambio sin previo aviso.'
};
const CT = {...CT_DEF, previewPage: 0};
const imgCache = {};
const loadImg = (u) => imgCache[u] || (imgCache[u] = new Promise(r => {
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => r(im); im.onerror = () => r(null); im.src = u;
}));

async function catData() {
  const [rowsRaw, prods, lists, cats, set, presets, untrSet, payTxt] = await Promise.all([
    q(db.from('stock_actual').select('product_id,sku,name,category_id,category,unit,stock,sale_price_usd').order('name')),
    db.from('products').select('id,sku,name,category_id,unit,sale_price_usd,is_service,track_inventory,image_url,product_categories(name),taxes(percent)').eq('active', true).order('name')
      .then(r => r.error ? q(db.from('products').select('id,image_url,is_service,taxes(percent)').eq('active', true)) : r.data),
    q(db.from('price_lists').select('id,name,adjust_percent').eq('active', true).order('name')),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name')),
    q(db.from('settings').select('*').eq('id', 1).single()),
    q(db.from('catalog_presets').select('*').order('name')),
    typeof getUntrackedIds === 'function' ? getUntrackedIds() : Promise.resolve(new Set()),
    typeof getPaymentDetailsText === 'function' ? getPaymentDetailsText() : Promise.resolve('')
  ]);

  const pm = Object.fromEntries(prods.map(p => [p.id, p]));
  const rows = rowsRaw.filter(r => !untrSet.has(Number(r.product_id))).map(r => {
    const p = pm[r.product_id] || {};
    return {...r, image_url: p.image_url || null, tax: Number(p.taxes?.percent || 0), is_service: false};
  });

  // Agregar servicios activos como opción aparte para quienes quieran incluir delivery / instalaciones
  const inRows = new Set(rows.map(r => Number(r.product_id)));
  const services = prods.filter(p => p.is_service && !inRows.has(Number(p.id))).map(p => ({
    product_id: p.id,
    sku: p.sku || null,
    name: p.name,
    category_id: p.category_id || null,
    category: p.product_categories?.name || 'Servicios',
    unit: p.unit || 'und',
    stock: 999999,
    sale_price_usd: Number(p.sale_price_usd || 0),
    image_url: p.image_url || null,
    tax: Number(p.taxes?.percent || 0),
    is_service: true
  }));

  return {rows, services, lists, cats, set, presets, payTxt};
}

function catItems(D, o, ignoreExcluded = false) {
  const listObj = (o.list === 'base' || o.list === 'none') ? null : D.lists.find(l => String(l.id) === String(o.list));
  const adj = Number(listObj?.adjust_percent || 0);
  const excl = new Set((o.excluded || []).map(Number));
  const pool = o.incSvc ? [...D.rows, ...(D.services || [])] : D.rows;

  return pool
    .filter(r => {
      if (!ignoreExcluded && excl.has(Number(r.product_id))) return false;
      const cid = r.category_id == null ? 'null' : String(r.category_id);
      if (o.cats && !o.cats.includes(cid)) return false;
      if (o.stock === 'instock' && !r.is_service && !(+r.stock > 0)) return false;
      return true;
    })
    .map(r => {
      let basePr = +r.sale_price_usd || 0;
      if (o.iva) basePr *= 1 + (r.tax || 0) / 100;
      const pr = basePr * (1 + adj / 100);
      return {
        ...r,
        basePrice: Math.round(basePr * 100) / 100,
        price: Math.round(pr * 100) / 100,
        adj,
        cat: r.category || (r.is_service ? 'Servicios' : 'Sin categoría')
      };
    })
    .filter(r => o.list === 'none' || r.price > 0)
    .sort((a, b) => {
      if (o.group) {
        const gc = a.cat.localeCompare(b.cat, 'es');
        if (gc !== 0) return gc;
      }
      if (o.sort === 'price_asc') return a.price - b.price || a.name.localeCompare(b.name, 'es');
      if (o.sort === 'price_desc') return b.price - a.price || a.name.localeCompare(b.name, 'es');
      return a.name.localeCompare(b.name, 'es');
    });
}

function layoutCat(rows, o, payTxt = '') {
  const mode = o.layout || 'cards2';
  const bottom = CPH - 62;
  const headerFirstH = o.subtitle || o.social ? 198 : 172;
  const pages = [[]];
  let y = headerFirstH, col = 0, lastG = null;
  const cur = () => pages[pages.length - 1];
  const brk = (h) => { if (y + h > bottom) { pages.push([]); y = 66; col = 0; } };

  let cols = 2, gap = 14, cw = Math.floor((CPW - CM * 2 - gap) / 2), ch = o.photos ? 130 : 96;
  if (mode === 'cards3') {
    cols = 3; gap = 12; cw = Math.floor((CPW - CM * 2 - gap * 2) / 3);
    ch = o.photos ? 228 : 114;
  } else if (mode === 'list') {
    cols = 1; gap = 0; cw = CPW - CM * 2;
    ch = o.photos ? 52 : 36;
  }

  const catH = 38;
  rows.forEach(r => {
    if (o.group && r.cat !== lastG) {
      if (col > 0) { y += ch + gap; col = 0; }
      brk(catH + (mode === 'list' ? 26 : 0) + ch + 8);
      cur().push({t: 'h', y, text: r.cat});
      y += catH;
      if (mode === 'list') { cur().push({t: 'th', y}); y += 26; }
      lastG = r.cat;
    } else if (mode === 'list' && cur().length === 0) {
      cur().push({t: 'th', y}); y += 26;
    }
    brk(ch);
    if (mode === 'list' && cur().length === 0) { cur().push({t: 'th', y}); y += 26; }
    cur().push({t: 'c', x: CM + col * (cw + gap), y, r});
    col++;
    if (col === cols) { col = 0; y += ch + gap; }
  });
  if (col > 0) { y += ch + gap; col = 0; }

  // Bloque final de datos de pago (si está activo y hay datos configurados)
  if (o.showPay && payTxt && payTxt.trim()) {
    const cleanPay = payTxt.replace(/\*/g, '').trim();
    const nLines = cleanPay.split('\n').length;
    const payH = Math.min(260, 44 + nLines * 18);
    brk(payH + 14);
    cur().push({t: 'pay', y: y + 8, h: payH, text: cleanPay});
    y += payH + 14;
  }

  return {pages, cw, ch, cols, mode};
}

async function drawCatPage(i, lay, o, X, sc = 2) {
  const set = X.set || {};
  const acc = /^#[0-9a-f]{6}$/i.test(o.color || '')
    ? o.color
    : (/^#[0-9a-f]{6}$/i.test(set.ticket_color || '') ? set.ticket_color : '#0b7285');
  const style = o.style || 'moderno';
  const minimal = style === 'minimal', darkHdr = style === 'oscuro';
  const ink = '#14262d', mut = '#60757e', line = '#dde6e9';
  const F = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', fnt = (s, w = 400) => `${w} ${s}px ${F}`;
  const c = document.createElement('canvas'); c.width = CPW * sc; c.height = CPH * sc;
  const g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, CPW, CPH);

  const T = (t, x, y, s, w, col, al = 'left') => { g.font = fnt(s, w); g.fillStyle = col; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(String(t ?? ''), x, y); };
  const R = (x, y, w, h, r, col) => { g.beginPath(); (g.roundRect || g.rect).call(g, x, y, w, h, r); g.fillStyle = col; g.fill(); };
  const B = (x, y, w, h, r, col, lw = 1.2) => { g.beginPath(); (g.roundRect || g.rect).call(g, x, y, w, h, r); g.strokeStyle = col; g.lineWidth = lw; g.stroke(); };
  const wrap = (t, mw, s, w, max = 99) => {
    g.font = fnt(s, w); const out = [];
    String(t || '').split('\n').forEach(par => {
      let ln = '';
      par.split(' ').forEach(wd => {
        const tt = ln ? ln + ' ' + wd : wd;
        if (ln && g.measureText(tt).width > mw) { out.push(ln); ln = wd; } else ln = tt;
      });
      out.push(ln);
    });
    return out.slice(0, max);
  };
  const tw = (t, s, w) => { g.font = fnt(s, w); return g.measureText(String(t ?? '')).width; };

  const rate = S.rate || 0;
  const listObj = (o.list === 'base' || o.list === 'none') ? null : (X.lists || []).find(l => String(l.id) === String(o.list));

  // ---------- Encabezado ----------
  if (i === 0) {
    const hdrH = o.subtitle || o.social ? 182 : 156;
    if (minimal) {
      R(0, 0, CPW, 10, 0, acc);
      g.fillStyle = line; g.fillRect(CM, hdrH, CPW - CM * 2, 1.5);
    } else if (darkHdr) {
      R(0, 0, CPW, hdrH, 0, '#14262d');
      R(0, hdrH - 6, CPW, 6, 0, acc);
    } else {
      const grad = g.createLinearGradient(0, 0, CPW, hdrH);
      grad.addColorStop(0, acc);
      grad.addColorStop(1, acc + 'dd');
      R(0, 0, CPW, hdrH, 0, grad);
    }

    let tx = CM;
    const logoBox = 94;
    if (o.showLogo && X.logo) {
      const ly = Math.round((hdrH - logoBox) / 2);
      if (!minimal) R(CM, ly, logoBox, logoBox, 18, '#fff');
      const pad = minimal ? 0 : 8, box = logoBox - pad * 2;
      const k = Math.min(box / X.logo.width, box / X.logo.height), lw = X.logo.width * k, lh = X.logo.height * k;
      g.drawImage(X.logo, CM + logoBox / 2 - lw / 2, ly + logoBox / 2 - lh / 2, lw, lh);
      tx = CM + logoBox + 18;
    }

    const colTitle = minimal ? ink : '#fff';
    const colSub = minimal ? acc : (darkHdr ? '#6fd4e8' : 'rgba(255,255,255,.94)');
    const colMeta = minimal ? mut : 'rgba(255,255,255,.82)';

    // Etiqueta de lista de precios o IVA en esquina superior derecha
    const pills = [];
    if (listObj) pills.push(listObj.name.toUpperCase());
    if (o.iva && o.list !== 'none') pills.push('IVA INCLUIDO');
    if (pills.length) {
      const pTxt = pills.join(' · ');
      const pw = tw(pTxt, 11, 800) + 22;
      R(CPW - CM - pw, 22, pw, 24, 12, minimal ? acc + '1f' : 'rgba(255,255,255,.2)');
      T(pTxt, CPW - CM - pw / 2, 38, 11, 800, minimal ? acc : '#fff', 'center');
    }

    let ty = 52;
    const maxW = CPW - tx - CM - (pills.length ? 110 : 0);
    const bizL = wrap(set.business_name || 'Mi negocio', maxW, 28, 800, 1);
    T(bizL[0], tx, ty, 28, 800, colTitle);
    ty += 30;
    T(o.title || 'Catálogo de productos', tx, ty, 19, 700, colSub);
    if (o.subtitle) { ty += 22; T(wrap(o.subtitle, CPW - tx - CM, 13, 500, 1)[0], tx, ty, 13, 500, colMeta); }

    const contactParts = [];
    if (o.showContact) {
      if (set.business_phone) contactParts.push('WhatsApp/Tlf: ' + set.business_phone);
      if (set.business_rif) contactParts.push('RIF: ' + set.business_rif);
      if (set.business_address) contactParts.push(set.business_address.slice(0, 42));
    }
    if (o.showDate) contactParts.push(dmy(caracasDate()));
    if (o.showRate && rate > 0) contactParts.push(`Tasa: ${fmt(rate, 2)} Bs/USD`);

    ty += 24;
    if (contactParts.length) T(wrap(contactParts.join('  ·  '), CPW - tx - CM, 12, 500, 1)[0], tx, ty, 12, 500, colMeta);
    if (o.social) { ty += 19; T(wrap(o.social, CPW - tx - CM, 12, 600, 1)[0], tx, ty, 12, 600, colMeta); }
  } else {
    if (minimal) {
      R(0, 0, CPW, 6, 0, acc);
      T(set.business_name || 'Mi negocio', CM, 30, 15, 800, ink);
      T(o.title || 'Catálogo', CPW - CM, 30, 13, 600, acc, 'right');
      g.fillStyle = line; g.fillRect(CM, 42, CPW - CM * 2, 1);
    } else {
      R(0, 0, CPW, 44, 0, darkHdr ? '#14262d' : acc);
      T(set.business_name || 'Mi negocio', CM, 28, 16, 800, '#fff');
      T(o.title || 'Catálogo', CPW - CM, 28, 13, 500, 'rgba(255,255,255,.9)', 'right');
    }
  }

  // Helper de precios formateados
  const formatPriceLines = (r) => {
    if (o.list === 'none') return {main: '', sub: '', strike: '', savePct: 0};
    const usd = fmt(r.price) + ' USD';
    const bs = rate ? fmt(r.price * rate) + ' Bs' : '';
    const unitTag = o.showUnit && r.unit ? ` / ${r.unit}` : '';
    let main = usd + unitTag, sub = '';
    if (o.cur === 'bs' && bs) { main = bs + unitTag; }
    else if (o.cur === 'both' && bs) { main = usd + unitTag; sub = bs; }
    else if (o.cur === 'bs_first' && bs) { main = bs + unitTag; sub = usd; }
    const hasDisc = o.showCompare && r.adj < -0.05 && r.basePrice > r.price + 0.005;
    const strike = hasDisc ? (o.cur === 'bs' && rate ? fmt(r.basePrice * rate) + ' Bs' : fmt(r.basePrice) + ' USD') : '';
    return {main, sub, strike, savePct: hasDisc ? Math.round(-r.adj) : 0};
  };

  // ---------- Elementos de la página ----------
  for (const e of lay.pages[i]) {
    if (e.t === 'h') {
      if (minimal) {
        T(e.text.toUpperCase(), CM, e.y + 20, 13, 800, acc);
        g.fillStyle = acc; g.fillRect(CM, e.y + 26, CPW - CM * 2, 2);
      } else {
        R(CM, e.y, CPW - CM * 2, 30, 8, acc + '1b');
        R(CM, e.y, 5, 30, 3, acc);
        T(e.text, CM + 16, e.y + 20, 14, 800, acc);
      }
      continue;
    }

    if (e.t === 'th') {
      R(CM, e.y, CPW - CM * 2, 24, 6, '#f1f5f7');
      T('Producto', CM + (o.photos ? 52 : 10), e.y + 16, 11, 700, mut);
      if (o.avail !== 'none') T('Estado', CPW - CM - (o.list === 'none' ? 10 : 185), e.y + 16, 11, 700, mut, 'right');
      if (o.list !== 'none') T('Precio', CPW - CM - 10, e.y + 16, 11, 700, mut, 'right');
      continue;
    }

    if (e.t === 'pay') {
      R(CM, e.y, CPW - CM * 2, e.h, 14, '#f4f7f8');
      B(CM, e.y, CPW - CM * 2, e.h, 14, acc + '55', 1.4);
      T('DATOS PARA REALIZAR TU PEDIDO / PAGO', CM + 16, e.y + 24, 12, 800, acc);
      let py = e.y + 44;
      wrap(e.text, CPW - CM * 2 - 32, 12, 500, 12).forEach(ln => { T(ln, CM + 16, py, 12, 500, ink); py += 17; });
      continue;
    }

    const r = e.r, x = e.x, y = e.y, w = lay.cw, h = lay.ch;
    const pr = formatPriceLines(r);
    const okStock = r.is_service || +r.stock > 0;
    const availTxt = r.is_service ? 'Servicio' : !okStock ? 'Agotado' : o.avail === 'qty' ? `${qty(r.stock)} ${r.unit}` : 'Disponible';

    // ----- MODO LISTA COMPACTA -----
    if (lay.mode === 'list') {
      g.fillStyle = '#fff'; g.fillRect(x, y, w, h);
      g.fillStyle = line; g.fillRect(x, y + h - 1, w, 1);
      let lx = x + 10;
      if (o.photos) {
        R(x + 6, y + 6, 40, 40, 8, '#f1f5f7');
        const im = X.imgs[r.product_id];
        if (im) {
          g.save(); g.beginPath(); (g.roundRect || g.rect).call(g, x + 6, y + 6, 40, 40, 8); g.clip();
          const k = Math.max(40 / im.width, 40 / im.height);
          g.drawImage(im, x + 26 - im.width * k / 2, y + 26 - im.height * k / 2, im.width * k, im.height * k);
          g.restore();
        }
        lx = x + 54;
      }
      const rightReserve = (o.list !== 'none' ? 190 : 0) + (o.avail !== 'none' ? 95 : 0);
      const nameMax = Math.max(160, w - (lx - x) - rightReserve);
      const nm = wrap(r.name, nameMax, 13, 700, 1)[0];
      const meta = [o.sku && r.sku, !o.showUnit && r.unit].filter(Boolean).join(' · ');
      T(nm, lx, y + (meta ? 21 : h / 2 + 5), 13, 700, ink);
      if (meta) T(meta, lx, y + 36, 11, 400, mut);

      if (o.avail !== 'none') {
        const ax = CPW - CM - (o.list === 'none' ? 10 : 185);
        T(availTxt, ax, y + h / 2 + 4, 11, 700, okStock ? '#1b7f4b' : '#b4381a', 'right');
      }
      if (o.list !== 'none') {
        const px = CPW - CM - 10;
        if (pr.sub) {
          T(pr.main, px, y + h / 2 - 1, 14, 800, acc, 'right');
          T(pr.sub, px, y + h / 2 + 13, 11, 600, mut, 'right');
        } else {
          T(pr.main, px, y + h / 2 + 5, 14, 800, acc, 'right');
        }
      }
      continue;
    }

    // ----- MODO TARJETAS (2 ó 3 COLUMNAS) -----
    R(x, y, w, h, 14, '#fff');
    B(x, y, w, h, 14, line, 1.2);

    if (lay.mode === 'cards3') {
      let cy = y + 10;
      if (o.photos) {
        const imgH = 114;
        R(x + 10, cy, w - 20, imgH, 10, '#f3f6f7');
        const im = X.imgs[r.product_id];
        if (im) {
          g.save(); g.beginPath(); (g.roundRect || g.rect).call(g, x + 10, cy, w - 20, imgH, 10); g.clip();
          const k = Math.max((w - 20) / im.width, imgH / im.height);
          g.drawImage(im, x + w / 2 - im.width * k / 2, cy + imgH / 2 - im.height * k / 2, im.width * k, im.height * k);
          g.restore();
        }
        if (pr.savePct > 0) {
          const dt = `-${pr.savePct}%`;
          const dw = tw(dt, 11, 800) + 14;
          R(x + w - 16 - dw, cy + 6, dw, 20, 10, '#b4381a');
          T(dt, x + w - 16 - dw / 2, cy + 20, 11, 800, '#fff', 'center');
        }
        cy += imgH + 16;
      } else {
        cy += 16;
      }
      wrap(r.name, w - 22, 13, 700, 2).forEach(ln => { T(ln, x + 11, cy, 13, 700, ink); cy += 16; });
      if (o.sku && r.sku) { T(r.sku, x + 11, cy, 10, 400, mut); }

      const by = y + h - 12;
      if (o.list !== 'none') {
        if (pr.strike) {
          const sy = by - (pr.sub ? 32 : 18);
          T(pr.strike, x + 11, sy, 11, 500, mut);
          const sw = tw(pr.strike, 11, 500);
          g.fillStyle = mut; g.fillRect(x + 11, sy - 4, sw, 1);
        }
        T(pr.main, x + 11, by - (pr.sub ? 15 : 0), 15, 800, acc);
        if (pr.sub) T(pr.sub, x + 11, by, 11, 600, mut);
      }
      if (o.avail !== 'none') {
        const bw = tw(availTxt, 10, 700) + 12;
        R(x + w - 10 - bw, y + h - 28, bw, 19, 9, okStock ? '#e3f5ea' : '#fde8e3');
        T(availTxt, x + w - 10 - bw / 2, y + h - 15, 10, 700, okStock ? '#1b7f4b' : '#b4381a', 'center');
      }
    } else {
      // 2 columnas (horizontal con foto izquierda)
      let lx = x + 14;
      if (o.photos) {
        const box = h - 24;
        R(x + 12, y + 12, box, box, 12, '#f3f6f7');
        const im = X.imgs[r.product_id];
        if (im) {
          g.save(); g.beginPath(); (g.roundRect || g.rect).call(g, x + 12, y + 12, box, box, 12); g.clip();
          const k = Math.max(box / im.width, box / im.height);
          g.drawImage(im, x + 12 + box / 2 - im.width * k / 2, y + 12 + box / 2 - im.height * k / 2, im.width * k, im.height * k);
          g.restore();
        }
        if (pr.savePct > 0) {
          const dt = `-${pr.savePct}%`;
          const dw = tw(dt, 11, 800) + 14;
          R(x + 16, y + 16, dw, 20, 10, '#b4381a');
          T(dt, x + 16 + dw / 2, y + 30, 11, 800, '#fff', 'center');
        }
        lx = x + box + 24;
      }
      const maxTw = x + w - 14 - lx;
      let ty = y + 26;
      wrap(r.name, maxTw, 15, 700, 2).forEach(t => { T(t, lx, ty, 15, 700, ink); ty += 19; });
      const meta = [o.sku && r.sku, !o.showUnit && r.unit].filter(Boolean).join(' · ');
      if (meta) T(meta, lx, ty, 11, 400, mut);

      const by = y + h - 14;
      if (o.list !== 'none') {
        if (pr.strike) {
          const sy = by - (pr.sub ? 36 : 21);
          T(pr.strike, lx, sy, 12, 500, mut);
          const sw = tw(pr.strike, 12, 500);
          g.fillStyle = mut; g.fillRect(lx, sy - 4, sw, 1);
        }
        T(pr.main, lx, by - (pr.sub ? 16 : 0), 17, 800, acc);
        if (pr.sub) T(pr.sub, lx, by, 12, 600, mut);
      }
      if (o.avail !== 'none') {
        const bw = tw(availTxt, 11, 700) + 16;
        R(x + w - 12 - bw, y + h - 34, bw, 22, 11, okStock ? '#e3f5ea' : '#fde8e3');
        T(availTxt, x + w - 12 - bw / 2, y + h - 19, 11, 700, okStock ? '#1b7f4b' : '#b4381a', 'center');
      }
    }
  }

  // ---------- Pie de página ----------
  g.fillStyle = line; g.fillRect(CM, CPH - 44, CPW - CM * 2, 1);
  T(wrap(o.note || '', CPW - CM * 2 - 120, 11, 400, 1)[0], CM, CPH - 22, 11, 400, mut);
  T(`Página ${i + 1} de ${lay.pages.length}`, CPW - CM, CPH - 22, 11, 600, mut, 'right');
  return c;
}

async function catBuild(D, o) {
  const items = catItems(D, o);
  const lay = layoutCat(items, o, D.payTxt || '');
  const logo = o.showLogo && D.set.logo_data
    ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = D.set.logo_data; })
    : null;
  const imgs = {};
  if (o.photos) await Promise.all(items.filter(r => r.image_url).map(async r => { imgs[r.product_id] = await loadImg(r.image_url); }));
  return {items, lay, X: {set: D.set, lists: D.lists, logo, imgs}};
}

function catWhatsappText(D, o) {
  const items = catItems(D, o), rate = S.rate || 0;
  const listObj = (o.list === 'base' || o.list === 'none') ? null : D.lists.find(l => String(l.id) === String(o.list));
  const lines = [
    `*${String(D.set?.business_name || 'MI NEGOCIO').toUpperCase()}*`,
    `*${o.title || 'CATÁLOGO DE PRODUCTOS'}*${listObj ? ` (${listObj.name})` : ''}`,
    o.subtitle || '',
    o.showDate ? `Fecha: ${dmy(caracasDate())}${o.showRate && rate ? ` | Tasa: ${fmt(rate, 2)} Bs/USD` : ''}` : '',
    o.iva && o.list !== 'none' ? '_Precios con IVA incluido_' : '',
    ''
  ].filter((x, idx) => idx === 5 || x);

  let lastCat = null;
  items.forEach(r => {
    if (o.group && r.cat !== lastCat) {
      if (lastCat !== null) lines.push('');
      lines.push(`*— ${r.cat.toUpperCase()} —*`);
      lastCat = r.cat;
    }
    const parts = [];
    if (o.list !== 'none') {
      const usd = `${fmt(r.price)} USD`, bs = rate ? `${fmt(r.price * rate)} Bs` : '';
      if (o.cur === 'bs' && bs) parts.push(bs);
      else if (o.cur === 'both' && bs) parts.push(`${usd} (${bs})`);
      else if (o.cur === 'bs_first' && bs) parts.push(`${bs} (${usd})`);
      else parts.push(usd);
    }
    if (o.avail !== 'none') {
      parts.push(r.is_service ? 'Servicio' : +r.stock > 0 ? (o.avail === 'qty' ? `Disp: ${qty(r.stock)}` : 'Disponible') : 'Agotado');
    }
    const skuTxt = o.sku && r.sku ? `[${r.sku}] ` : '';
    const unitTxt = o.showUnit && r.unit ? ` (${r.unit})` : '';
    lines.push(`• ${skuTxt}${r.name}${unitTxt}${parts.length ? ' — *' + parts.join(' | ') + '*' : ''}`);
  });

  if (o.note) lines.push('', `_${o.note}_`);
  if (o.showPay && D.payTxt) lines.push('', D.payTxt.trim());
  if (o.showContact && D.set?.business_phone) lines.push('', `Pedidos al: ${D.set.business_phone}`);
  if (o.social) lines.push(o.social);
  return lines.join('\n');
}

async function catPdf(B, o) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = (d) => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  const N = B.lay.pages.length; push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, `<< /Type /Pages /Count ${N} /Kids [${B.lay.pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  for (let i = 0; i < N; i++) {
    const c = await drawCatPage(i, B.lay, o, B.X, 2), jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86))).arrayBuffer()), b = 3 + i * 3, cont = 'q 595 0 0 842 0 0 cm /Im0 Do Q';
    obj(b, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${b + 2} 0 R >> >> /Contents ${b + 1} 0 R >>`);
    obj(b + 1, `<< /Length ${cont.length} >>\nstream\n${cont}\nendstream`);
    offs[b + 2] = len; push(`${b + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n');
  }
  const total = 3 + N * 3, xr = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n` + Array.from({length: total - 1}, (_, k) => String(offs[k + 1]).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`);
  return new Blob(parts, {type: 'application/pdf'});
}

async function viewCatalogo() {
  const D = await catData(), photosOn = !!D.set.enable_product_photos;
  if (!CT.cats) CT.cats = [...D.cats.filter(c => !/materia|empaque|sub.?producto/i.test(c.name)).map(c => String(c.id)), 'null'];
  if (!CT.color) CT.color = D.set.ticket_color || '#0b7285';
  if (!photosOn) CT.photos = false;
  if (!Array.isArray(CT.excluded)) CT.excluded = [];

  const PALETTE = ['#0b7285', '#1b7f4b', '#1e40af', '#7c3aed', '#b4381a', '#1f2937'];
  const sel = (k, opts) => `<select data-k="${k}">${Object.entries(opts).map(([v, t]) => `<option value="${v}" ${String(CT[k]) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const chk = (k, t) => `<label class="chk"><input type="checkbox" data-k="${k}" ${CT[k] ? 'checked' : ''}> ${t}</label>`;
  const lists = {none: 'Sin precios', base: 'Precio de venta normal', ...Object.fromEntries(D.lists.map(l => [String(l.id), `${l.name} (${l.adjust_percent > 0 ? '+' : ''}${qty(l.adjust_percent)}%)`]))};

  $('#view').innerHTML = `
    <div class="card stack">
      <h2>Configuraciones guardadas</h2>
      <div class="row0">
        <select id="ctPre" style="flex:1"><option value="">Elegir una configuración...</option>${D.presets.map(p => `<option value="${p.id}" ${String(CT._presetId || '') === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <button class="btn ghost" id="ctSave" type="button">Guardar</button>
        <button class="btn ghost" id="ctDel" type="button">Borrar</button>
      </div>
    </div>

    <div class="stack" id="ctForm">
      <div class="card stack">
        <h2>1. Diseño y presentación</h2>
        <div class="grid">
          <label>Estilo visual${sel('style', {moderno: 'Moderno (encabezado en color)', minimal: 'Minimalista (limpio / ahorra tinta)', oscuro: 'Elegante (encabezado oscuro)'})}</label>
          <label>Disposición${sel('layout', {cards2: 'Tarjetas (2 columnas)', cards3: 'Vitrina compacta (3 columnas)', list: 'Lista de precios (tabla compacta)'})}</label>
        </div>
        <label>Color principal del catálogo
          <div class="color-picks">
            ${PALETTE.map(c => `<button type="button" class="cswatch" data-col="${c}" style="background:${c}" title="${c}"></button>`).join('')}
            <input data-k="color" id="ctColor" type="color" value="${esc(CT.color)}" style="width:48px;height:38px;margin:0;flex:none">
          </div>
        </label>
        <div class="grid">
          <label>Título principal<input data-k="title" value="${esc(CT.title)}" placeholder="Ej: Catálogo de productos"></label>
          <label>Subtítulo / eslogan (opcional)<input data-k="subtitle" value="${esc(CT.subtitle)}" placeholder="Ej: Ventas al mayor y detal · Envíos gratis"></label>
        </div>
        <div class="grid">
          <label>Redes sociales / horario (opcional)<input data-k="social" value="${esc(CT.social)}" placeholder="Ej: Instagram: @minegocio · Lun-Sáb 8am-6pm"></label>
          <label>Nota al pie<input data-k="note" value="${esc(CT.note)}" placeholder="Ej: Precios sujetos a cambio sin previo aviso."></label>
        </div>
      </div>

      <div class="card stack">
        <h2>2. Precios, moneda y filtros</h2>
        <div class="grid">
          <label>Lista de precios${sel('list', lists)}</label>
          <label>Moneda${sel('cur', {both: 'USD arriba y Bs abajo', bs_first: 'Bs arriba y USD abajo', usd: 'Solo dólares (USD)', bs: 'Solo bolívares (Bs)'})}</label>
        </div>
        <div class="grid">
          <label>Existencias${sel('stock', {all: 'Todos los productos', instock: 'Solo disponibles (stock > 0)'})}</label>
          <label>Disponibilidad${sel('avail', {status: 'Disponible o agotado', qty: 'Cantidad exacta', none: 'No mostrar'})}</label>
          <label>Ordenar por${sel('sort', {name: 'Nombre (A-Z)', price_asc: 'Precio: menor a mayor', price_desc: 'Precio: mayor a menor'})}</label>
        </div>
        <div class="grid">
          ${chk('iva', 'Precio con IVA incluido')}
          ${chk('showCompare', 'Tachar precio normal al usar lista con descuento')}
          ${chk('sku', 'Mostrar código (SKU)')}
          ${chk('showUnit', 'Mostrar unidad (/ und, / kg, / L)')}
          ${chk('group', 'Agrupar por categoría')}
          ${chk('incSvc', 'Incluir servicios (ej: delivery)')}
          ${photosOn ? chk('photos', 'Mostrar fotos de productos') : '<small class="mut">Activa fotos en Configuración &gt; Negocio para mostrarlas.</small>'}
        </div>
      </div>

      <div class="card stack">
        <h2>3. Encabezado, datos de pago y selección</h2>
        <div class="grid">
          ${D.set.logo_data ? chk('showLogo', 'Mostrar logo del negocio') : ''}
          ${chk('showContact', 'Mostrar teléfono, RIF y dirección')}
          ${chk('showDate', 'Mostrar fecha actual')}
          ${chk('showRate', 'Mostrar tasa de cambio del día')}
          ${chk('showPay', 'Incluir mis datos de pago (Pago Móvil / Cuentas) al final')}
        </div>
        <div class="title-row" style="margin-top:.3rem">
          <b class="mut">Categorías incluidas</b>
          <button type="button" class="lnk" id="ctPickProds" style="font-size:.84rem">Elegir / excluir productos${CT.excluded.length ? ` (${CT.excluded.length} excl.)` : ''}</button>
        </div>
        <div class="chips" id="ctCats">${[...D.cats.map(c => [String(c.id), c.name]), ['null', 'Sin categoría']].map(([id, n]) => `<button type="button" data-c="${id}" class="${CT.cats.includes(id) ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>
      </div>
    </div>

    <div class="card stack">
      <div class="title-row">
        <h2>Vista previa</h2>
        <div class="row0" style="gap:.4rem" id="ctNav">
          <button type="button" class="btn ghost" id="ctPrevPg" style="min-height:36px;padding:.2rem .65rem">&lsaquo;</button>
          <small class="mut" id="ctPgLbl">1 / 1</small>
          <button type="button" class="btn ghost" id="ctNextPg" style="min-height:36px;padding:.2rem .65rem">&rsaquo;</button>
        </div>
      </div>
      <p class="mut" id="ctInfo" style="margin:0"></p>
      <div id="ctPrev"><p class="mut">Generando vista previa...</p></div>
    </div>

    <div class="card stack">
      <h2>Compartir o descargar</h2>
      <div class="row" style="margin:0">
        <button class="btn" id="ctShare">Compartir PDF</button>
        <button class="btn ghost" id="ctPdf">Descargar PDF</button>
      </div>
      <div class="row" style="margin:0">
        <button class="btn ghost" id="ctImg">Compartir esta página (Foto)</button>
        <button class="btn ghost" id="ctWaTxt">Copiar texto WhatsApp</button>
        <button class="btn ghost" id="ctCsv">Descargar Excel</button>
      </div>
    </div>`;

  let tmr, lastBuild = null;
  const paint = (immediate = false) => {
    clearTimeout(tmr);
    tmr = setTimeout(() => run(async () => {
      const B = await catBuild(D, CT);
      lastBuild = B;
      if (!$('#ctInfo')) return;
      const totalPgs = Math.max(1, B.lay.pages.length);
      if (CT.previewPage >= totalPgs) CT.previewPage = totalPgs - 1;
      if (CT.previewPage < 0) CT.previewPage = 0;

      $('#ctInfo').textContent = `${B.items.length} productos en ${totalPgs} ${totalPgs === 1 ? 'página' : 'páginas'}`;
      $('#ctPgLbl').textContent = `${CT.previewPage + 1} / ${totalPgs}`;
      $('#ctPrevPg').disabled = CT.previewPage <= 0;
      $('#ctNextPg').disabled = CT.previewPage >= totalPgs - 1;

      const pv = B.items.length
        ? `<img class="rimg" src="${(await drawCatPage(CT.previewPage, B.lay, CT, B.X, 1)).toDataURL('image/jpeg', 0.85)}" alt="Vista previa del catálogo">`
        : '<p class="mut">No hay productos con estas opciones.</p>';
      if ($('#ctPrev')) $('#ctPrev').innerHTML = pv;
    }), immediate ? 10 : 320);
  };

  $('#ctForm').addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k) { CT[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; paint(); }
  });
  $('#ctForm').addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k) { CT[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; paint(); }
  });
  $('#ctForm').querySelectorAll('.cswatch').forEach(btn => {
    btn.onclick = () => { CT.color = btn.dataset.col; $('#ctColor').value = CT.color; paint(true); };
  });
  $('#ctCats').onclick = (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const id = b.dataset.c;
    CT.cats = CT.cats.includes(id) ? CT.cats.filter(x => x !== id) : [...CT.cats, id];
    b.classList.toggle('on');
    CT.previewPage = 0;
    paint();
  };

  // Selector puntual para incluir / excluir productos del catálogo
  $('#ctPickProds').onclick = () => {
    const cand = catItems(D, CT, true);
    const excl = new Set((CT.excluded || []).map(Number));
    openSheet('Elegir productos del catálogo', `
      <div class="stack">
        <input id="cpQ" type="search" placeholder="Buscar producto...">
        <div class="row" style="margin:0">
          <button type="button" class="btn ghost" id="cpAll">Marcar todos</button>
          <button type="button" class="btn ghost" id="cpNone">Desmarcar todos</button>
        </div>
        <div class="list" id="cpL" style="max-height:52vh;overflow:auto"></div>
        <button type="button" class="btn" id="cpDone">Aplicar selección</button>
      </div>`);
    const drawPick = () => {
      const t = ($('#cpQ').value || '').trim().toLowerCase();
      const vis = cand.filter(r => !t || (r.name + ' ' + (r.sku || '') + ' ' + r.cat).toLowerCase().includes(t));
      $('#cpL').innerHTML = vis.map(r => `<label class="item chk" style="cursor:pointer">
        <input type="checkbox" data-pid="${r.product_id}" ${!excl.has(Number(r.product_id)) ? 'checked' : ''}>
        <span style="flex:1"><b>${esc(r.name)}</b><small>${esc(r.cat)} · ${fmt(r.price)} USD</small></span>
      </label>`).join('') || '<p class="mut">Sin coincidencias.</p>';
    };
    drawPick();
    $('#cpQ').oninput = drawPick;
    $('#cpL').addEventListener('change', (e) => {
      const pid = Number(e.target.dataset.pid); if (!pid) return;
      if (e.target.checked) excl.delete(pid); else excl.add(pid);
    });
    $('#cpAll').onclick = () => { cand.forEach(r => excl.delete(Number(r.product_id))); drawPick(); };
    $('#cpNone').onclick = () => { cand.forEach(r => excl.add(Number(r.product_id))); drawPick(); };
    $('#cpDone').onclick = () => {
      CT.excluded = [...excl];
      CT.previewPage = 0;
      closeSheet();
      $('#ctPickProds').textContent = `Elegir / excluir productos${CT.excluded.length ? ` (${CT.excluded.length} excl.)` : ''}`;
      paint(true);
    };
  };

  $('#ctPrevPg').onclick = () => { if (CT.previewPage > 0) { CT.previewPage--; paint(true); } };
  $('#ctNextPg').onclick = () => { if (lastBuild && CT.previewPage < lastBuild.lay.pages.length - 1) { CT.previewPage++; paint(true); } };

  $('#ctPre').onchange = (e) => {
    const p = D.presets.find(x => String(x.id) === e.target.value);
    if (p) { Object.assign(CT, CT_DEF, p.config || {}, {_presetId: p.id, previewPage: 0}); render(); }
    else { CT._presetId = null; }
  };
  $('#ctSave').onclick = () => run(async () => {
    const curId = $('#ctPre').value;
    const curPre = curId ? D.presets.find(x => String(x.id) === curId) : null;
    const cleanCfg = {...CT}; delete cleanCfg.previewPage; delete cleanCfg._presetId;
    if (curPre && confirm(`¿Actualizar la configuración "${curPre.name}"? (Pulsa Cancelar para guardarla con un nombre nuevo)`)) {
      await q(db.from('catalog_presets').update({config: cleanCfg}).eq('id', curPre.id));
      toast(`Configuración "${curPre.name}" actualizada`);
      render();
      return;
    }
    const n = prompt('Nombre de esta configuración (ej: Mayoristas, Ofertas):', curPre ? curPre.name + ' (copia)' : '');
    if (!n || !n.trim()) return;
    const ins = await q(db.from('catalog_presets').insert({name: n.trim(), config: cleanCfg}).select('id').single());
    CT._presetId = ins?.id || null;
    toast('Configuración guardada');
    render();
  });
  $('#ctDel').onclick = () => run(async () => {
    const id = $('#ctPre').value;
    if (!id || !confirm('¿Borrar esta configuración?')) return;
    await q(db.from('catalog_presets').delete().eq('id', id));
    CT._presetId = null;
    toast('Configuración borrada');
    render();
  });

  const pdf = async () => {
    const B = await catBuild(D, CT);
    if (!B.items.length) throw new Error('No hay productos para generar el catálogo');
    toast('Generando el PDF...');
    return catPdf(B, CT);
  };
  $('#ctShare').onclick = () => run(async () => {
    const b = await pdf(), f = new File([b], 'catalogo.pdf', {type: 'application/pdf'});
    if (navigator.canShare && navigator.canShare({files: [f]})) {
      try { await navigator.share({files: [f], title: CT.title}); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    downloadBlob(b, 'catalogo.pdf');
    toast('Se descargó el PDF. Adjúntalo en WhatsApp.');
  });
  $('#ctPdf').onclick = () => run(async () => downloadBlob(await pdf(), 'catalogo.pdf'));
  $('#ctImg').onclick = () => run(async () => {
    const B = await catBuild(D, CT);
    if (!B.items.length) throw new Error('No hay productos en el catálogo');
    const c = await drawCatPage(CT.previewPage, B.lay, CT, B.X, 2);
    const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear la imagen')), 'image/png'));
    await shareImage(blob, '', `catalogo-pag-${CT.previewPage + 1}`);
  });
  $('#ctWaTxt').onclick = () => run(async () => {
    const txt = catWhatsappText(D, CT);
    if (!catItems(D, CT).length) throw new Error('No hay productos en el catálogo');
    if (typeof copyText === 'function') await copyText(txt, 'Lista de precios copiada para WhatsApp');
    else window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
  });
  $('#ctCsv').onclick = () => run(async () => {
    const it = catItems(D, CT), rate = S.rate || 0, esc2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = ['Código,Producto,Categoría,Unidad' + (CT.list !== 'none' ? ',Precio USD,Precio Bs' : '') + (CT.avail !== 'none' ? ',Existencia' : ''),
      ...it.map(r => [esc2(r.sku), esc2(r.name), esc2(r.cat), esc2(r.unit), ...(CT.list !== 'none' ? [r.price, (r.price * rate).toFixed(2)] : []), ...(CT.avail !== 'none' ? [r.is_service ? 'Servicio' : +r.stock > 0 ? (CT.avail === 'qty' ? r.stock : 'Disponible') : 'Agotado'] : [])].join(','))].join('\n');
    downloadBlob(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'}), 'catalogo.csv');
  });
  paint(true);
}
