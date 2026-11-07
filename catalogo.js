// Catálogo de productos: PDF para compartir, lista de precios por tipo de cliente y exportación a Excel
const CPW = 794, CPH = 1123, CM = 40;
const CT = {list: 'base', cur: 'usd', iva: false, stock: 'all', avail: 'status', photos: true, sku: true, group: true, cats: null, title: 'Catálogo de productos', note: 'Precios sujetos a cambio sin previo aviso.'};
const imgCache = {};
const loadImg = (u) => imgCache[u] || (imgCache[u] = new Promise(r => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => r(im); im.onerror = () => r(null); im.src = u; }));

async function catData() {
  const [rows, prods, lists, cats, set, presets] = await Promise.all([
    q(db.from('stock_actual').select('product_id,sku,name,category_id,category,unit,stock,sale_price_usd').order('name')),
    q(db.from('products').select('id,image_url,taxes(percent)').eq('active', true)),
    q(db.from('price_lists').select('id,name,adjust_percent').eq('active', true).order('name')),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name')),
    q(db.from('settings').select('*').eq('id', 1).single()),
    q(db.from('catalog_presets').select('*').order('name'))
  ]);
  const pm = Object.fromEntries(prods.map(p => [p.id, p]));
  rows.forEach(r => { const p = pm[r.product_id] || {}; r.image_url = p.image_url; r.tax = Number(p.taxes?.percent || 0); });
  return {rows, lists, cats, set, presets};
}
function catItems(D, o) {
  const adj = o.list === 'base' || o.list === 'none' ? 0 : Number(D.lists.find(l => String(l.id) === o.list)?.adjust_percent || 0);
  return D.rows.filter(r => (!o.cats || o.cats.includes(String(r.category_id))) && (o.stock === 'all' || +r.stock > 0)).map(r => {
    let pr = +r.sale_price_usd * (1 + adj / 100); if (o.iva) pr *= 1 + r.tax / 100;
    return {...r, price: Math.round(pr * 100) / 100, cat: r.category || 'Sin categoría'};
  }).filter(r => o.list === 'none' || r.price > 0).sort((a, b) => (o.group ? a.cat.localeCompare(b.cat) : 0) || a.name.localeCompare(b.name));
}
function layoutCat(rows, o) {
  const cw = 349, gap = 14, ch = o.photos ? 124 : 92, bottom = CPH - 60, pages = [[]];
  let y = 190, col = 0, lastG = null;
  const cur = () => pages[pages.length - 1], brk = (h) => { if (y + h > bottom) { pages.push([]); y = 70; col = 0; } };
  rows.forEach(r => {
    if (o.group && r.cat !== lastG) { if (col) { y += ch + gap; col = 0; } brk(44 + ch); cur().push({t: 'h', y, text: r.cat}); y += 44; lastG = r.cat; }
    brk(ch); cur().push({t: 'c', x: CM + col * (cw + gap), y, r}); col++; if (col === 2) { col = 0; y += ch + gap; }
  });
  return {pages, cw, ch};
}

async function drawCatPage(i, lay, o, X, sc = 2) {
  const set = X.set, acc = /^#[0-9a-f]{6}$/i.test(set.ticket_color || '') ? set.ticket_color : '#0b7285', ink = '#14262d', mut = '#6b7f88', line = '#e3eaed';
  const F = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif', fnt = (s, w = 400) => `${w} ${s}px ${F}`;
  const c = document.createElement('canvas'); c.width = CPW * sc; c.height = CPH * sc;
  const g = c.getContext('2d'); g.scale(sc, sc); g.fillStyle = '#fff'; g.fillRect(0, 0, CPW, CPH);
  const T = (t, x, y, s, w, col, al = 'left') => { g.font = fnt(s, w); g.fillStyle = col; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); };
  const R = (x, y, w, h, r, col) => { g.beginPath(); (g.roundRect || g.rect).call(g, x, y, w, h, r); g.fillStyle = col; g.fill(); };
  const wrap = (t, mw, s, w, max) => { g.font = fnt(s, w); const out = []; let ln = ''; String(t).split(' ').forEach(wd => { const tt = ln ? ln + ' ' + wd : wd; if (ln && g.measureText(tt).width > mw) { out.push(ln); ln = wd; } else ln = tt; }); out.push(ln); return out.slice(0, max); };
  if (i === 0) {
    R(0, 0, CPW, 160, 0, acc);
    let tx = CM;
    if (X.logo) { R(CM, 32, 96, 96, 18, '#fff'); const k = Math.min(84 / X.logo.width, 84 / X.logo.height), w = X.logo.width * k, h = X.logo.height * k; g.drawImage(X.logo, CM + 48 - w / 2, 80 - h / 2, w, h); tx = CM + 116; }
    T(set.business_name || 'Mi negocio', tx, 66, 32, 800, '#fff'); T(o.title, tx, 98, 20, 600, 'rgba(255,255,255,.92)');
    T([dmy(caracasDate()), set.business_phone, set.business_rif && 'RIF: ' + set.business_rif].filter(Boolean).join('   |   '), tx, 126, 14, 400, 'rgba(255,255,255,.85)');
  } else { R(0, 0, CPW, 44, 0, acc); T(set.business_name || 'Mi negocio', CM, 29, 17, 800, '#fff'); T(o.title, CPW - CM, 29, 14, 400, 'rgba(255,255,255,.9)', 'right'); }
  for (const e of lay.pages[i]) {
    if (e.t === 'h') { R(CM, e.y, CPW - CM * 2, 32, 8, acc + '1f'); T(e.text, CM + 14, e.y + 22, 16, 800, acc); continue; }
    const r = e.r, x = e.x, y = e.y, w = lay.cw, h = lay.ch;
    R(x, y, w, h, 14, '#fff'); g.strokeStyle = line; g.lineWidth = 1.2; g.beginPath(); (g.roundRect || g.rect).call(g, x, y, w, h, 14); g.stroke();
    let lx = x + 14;
    if (o.photos) {
      R(x + 12, y + 12, 100, 100, 12, '#f1f5f7'); const im = X.imgs[r.product_id];
      if (im) { g.save(); g.beginPath(); (g.roundRect || g.rect).call(g, x + 12, y + 12, 100, 100, 12); g.clip(); const k = Math.max(100 / im.width, 100 / im.height); g.drawImage(im, x + 62 - im.width * k / 2, y + 62 - im.height * k / 2, im.width * k, im.height * k); g.restore(); }
      lx = x + 126;
    }
    const tw = x + w - 12 - lx; let ty = y + 28;
    wrap(r.name, tw, 16, 700, 2).forEach(t => { T(t, lx, ty, 16, 700, ink); ty += 20; });
    const meta = [o.sku && r.sku, r.unit].filter(Boolean).join(' | '); if (meta) T(meta, lx, ty, 12, 400, mut);
    const rate = S.rate || 0, usd = fmt(r.price) + ' USD', bs = fmt(r.price * rate) + ' Bs', by = y + h - 16;
    if (o.list !== 'none') {
      if (o.cur === 'bs' && rate) T(bs, lx, by, 20, 800, acc);
      else { T(usd, lx, by - (o.cur === 'both' && rate ? 18 : 0), 20, 800, acc); if (o.cur === 'both' && rate) T(bs, lx, by, 14, 600, mut); }
    }
    if (o.avail !== 'none') {
      const ok = +r.stock > 0, t = !ok ? 'Agotado' : o.avail === 'qty' ? qty(r.stock) + ' ' + r.unit : 'Disponible';
      g.font = fnt(12, 700); const bw = g.measureText(t).width + 18; R(x + w - 12 - bw, y + h - 36, bw, 24, 12, ok ? '#e3f5ea' : '#fde8e3'); T(t, x + w - 12 - bw / 2, y + h - 19, 12, 700, ok ? '#1b7f4b' : '#b4381a', 'center');
    }
  }
  g.fillStyle = line; g.fillRect(CM, CPH - 44, CPW - CM * 2, 1);
  T(o.note || '', CM, CPH - 22, 12, 400, mut); T(`Página ${i + 1} de ${lay.pages.length}`, CPW - CM, CPH - 22, 12, 400, mut, 'right');
  return c;
}

async function catBuild(D, o) {
  const items = catItems(D, o), lay = layoutCat(items, o);
  const logo = D.set.ticket_show_logo && D.set.logo_data ? await new Promise(r => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = D.set.logo_data; }) : null;
  const imgs = {}; if (o.photos) await Promise.all(items.filter(r => r.image_url).map(async r => { imgs[r.product_id] = await loadImg(r.image_url); }));
  return {items, lay, X: {set: D.set, logo, imgs}};
}
async function catPdf(B, o) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = (d) => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  const N = B.lay.pages.length; push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, `<< /Type /Pages /Count ${N} /Kids [${B.lay.pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  for (let i = 0; i < N; i++) {
    const c = await drawCatPage(i, B.lay, o, B.X, 2), jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer()), b = 3 + i * 3, cont = 'q 595 0 0 842 0 0 cm /Im0 Do Q';
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
  if (!photosOn) CT.photos = false;
  const sel = (k, opts) => `<select data-k="${k}">${Object.entries(opts).map(([v, t]) => `<option value="${v}" ${String(CT[k]) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const chk = (k, t) => `<label class="chk"><input type="checkbox" data-k="${k}" ${CT[k] ? 'checked' : ''}> ${t}</label>`;
  const lists = {none: 'Sin precios', base: 'Precio de venta normal', ...Object.fromEntries(D.lists.map(l => [String(l.id), `${l.name} (${l.adjust_percent > 0 ? '+' : ''}${qty(l.adjust_percent)}%)`]))};
  $('#view').innerHTML = `<div class="card stack"><h2>Configuraciones guardadas</h2>
      <div class="row0"><select id="ctPre" style="flex:1"><option value="">Elegir una configuración...</option>${D.presets.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn ghost" id="ctSave" type="button">Guardar esta</button><button class="btn ghost" id="ctDel" type="button">Borrar</button></div></div>
    <div class="card stack" id="ctForm"><h2>Qué mostrar</h2>
      <label>Precios para<br>${sel('list', lists)}</label>
      <div class="ln2"><label>Moneda<br>${sel('cur', {usd: 'Dólares (USD)', bs: 'Bolívares (Bs)', both: 'Ambas'})}</label><label>Existencias<br>${sel('stock', {all: 'Todos los productos', instock: 'Solo los disponibles'})}</label></div>
      <label>Disponibilidad<br>${sel('avail', {none: 'No mostrar', status: 'Disponible o agotado', qty: 'Cantidad exacta'})}</label>
      ${chk('iva', 'Precio con IVA incluido')}${chk('sku', 'Mostrar el código')}${chk('group', 'Agrupar por categoría')}${photosOn ? chk('photos', 'Mostrar fotos') : '<p class="mut">Para mostrar fotos, actívalas en Más &gt; Configuración &gt; Negocio.</p>'}
      <b class="mut">Categorías</b><div class="chips" id="ctCats">${[...D.cats.map(c => [String(c.id), c.name]), ['null', 'Sin categoría']].map(([id, n]) => `<button type="button" data-c="${id}" class="${CT.cats.includes(id) ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>
      <label>Título<input data-k="title" value="${esc(CT.title)}"></label><label>Nota al pie<input data-k="note" value="${esc(CT.note)}"></label></div>
    <div class="card"><h2>Vista previa</h2><p class="mut" id="ctInfo"></p><div id="ctPrev"></div></div>
    <div class="row"><button class="btn" id="ctShare">Compartir PDF</button><button class="btn ghost" id="ctPdf">Descargar PDF</button><button class="btn ghost" id="ctCsv">Descargar Excel</button></div>`;
  let tmr;
  const paint = () => { clearTimeout(tmr); tmr = setTimeout(() => run(async () => {
    const B = await catBuild(D, CT); $('#ctInfo').textContent = `${B.items.length} productos en ${B.lay.pages.length} ${B.lay.pages.length === 1 ? 'página' : 'páginas'}`;
    $('#ctPrev').innerHTML = B.items.length ? `<img class="rimg" src="${(await drawCatPage(0, B.lay, CT, B.X, 1)).toDataURL('image/jpeg', 0.8)}" alt="Vista previa">` : '<p class="mut">No hay productos con estas opciones.</p>';
  }), 400); };
  $('#ctForm').addEventListener('input', (e) => { const k = e.target.dataset.k; if (k) { CT[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; paint(); } });
  $('#ctCats').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; const id = b.dataset.c; CT.cats = CT.cats.includes(id) ? CT.cats.filter(x => x !== id) : [...CT.cats, id]; b.classList.toggle('on'); paint(); };
  $('#ctPre').onchange = (e) => { const p = D.presets.find(x => String(x.id) === e.target.value); if (p) { Object.assign(CT, p.config); render(); } };
  $('#ctSave').onclick = () => run(async () => { const n = prompt('Nombre de esta configuración (ej: Mayoristas)'); if (!n) return; await q(db.from('catalog_presets').insert({name: n.trim(), config: CT})); toast('Configuración guardada'); render(); });
  $('#ctDel').onclick = () => run(async () => { const id = $('#ctPre').value; if (!id || !confirm('¿Borrar esta configuración?')) return; await q(db.from('catalog_presets').delete().eq('id', id)); render(); });
  const pdf = async () => { toast('Generando el PDF...'); return catPdf(await catBuild(D, CT), CT); };
  $('#ctShare').onclick = () => run(async () => {
    const b = await pdf(), f = new File([b], 'catalogo.pdf', {type: 'application/pdf'});
    if (navigator.canShare && navigator.canShare({files: [f]})) { try { await navigator.share({files: [f], title: CT.title}); return; } catch (e) { if (e.name === 'AbortError') return; } }
    downloadBlob(b, 'catalogo.pdf'); toast('Se descargó el PDF. Adjúntalo en el chat.');
  });
  $('#ctPdf').onclick = () => run(async () => downloadBlob(await pdf(), 'catalogo.pdf'));
  $('#ctCsv').onclick = () => run(async () => {
    const it = catItems(D, CT), rate = S.rate || 0, esc2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = ['Código,Producto,Categoría,Unidad' + (CT.list !== 'none' ? ',Precio USD,Precio Bs' : '') + (CT.avail !== 'none' ? ',Existencia' : ''),
      ...it.map(r => [esc2(r.sku), esc2(r.name), esc2(r.cat), esc2(r.unit), ...(CT.list !== 'none' ? [r.price, (r.price * rate).toFixed(2)] : []), ...(CT.avail !== 'none' ? [+r.stock > 0 ? (CT.avail === 'qty' ? r.stock : 'Disponible') : 'Agotado'] : [])].join(','))].join('\n');
    downloadBlob(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'}), 'catalogo.csv');
  });
  paint();
}
