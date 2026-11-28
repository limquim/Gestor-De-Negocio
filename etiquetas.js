// Generador de Etiquetas de Precio y Códigos de Barras (Code 128B 100% offline, activable en Configuración > Módulos)
const ETQ = {
  q: '',
  cat: 'all',
  layout: 'sheetA4',     // 'sheetA4' | 'thermal58' | 'card'
  priceMode: 'both',     // 'both' | 'usd' | 'bs' | 'none'
  showBarcode: true,
  showBiz: true,
  copies: {}             // { [productId]: number }
};

const C128_PAT = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'
];

function sanitizeBarcodeText(raw) {
  return String(raw || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function encodeCode128B(raw) {
  const text = sanitizeBarcodeText(raw);
  if (!text) return '';
  const codes = [104];
  let checksum = 104;
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32;
    if (v < 0 || v > 94) continue;
    codes.push(v);
    checksum += v * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106);

  let bits = '';
  for (const code of codes) {
    const pat = C128_PAT[code];
    for (let j = 0; j < pat.length; j++) {
      bits += (j % 2 === 0 ? '1' : '0').repeat(Number(pat[j]));
    }
  }
  return bits;
}

function drawCode128(ctx, text, x, y, maxW, height) {
  const bits = encodeCode128B(text);
  if (!bits) return false;
  const quiet = 10;
  const totalMods = bits.length + quiet * 2;
  const modW = Math.max(1, Math.floor(maxW / totalMods));
  const actualW = totalMods * modW;
  const startX = Math.round(x + (maxW - actualW) / 2 + quiet * modW);
  ctx.fillStyle = '#000000';
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') {
      ctx.fillRect(startX + i * modW, Math.round(y), modW, Math.round(height));
    }
  }
  return true;
}

function generateAutoSku(prodId, usedSet) {
  let n = Number(prodId || 1);
  let cand = 'GE' + String(n).padStart(5, '0');
  let guard = 0;
  while (usedSet && usedSet.has(cand.toLowerCase()) && guard < 9999) {
    n++;
    cand = 'GE' + String(n).padStart(5, '0');
    guard++;
  }
  return cand;
}

async function ensureProductSku(prod, allProds = null) {
  if (prod?.sku && String(prod.sku).trim()) return String(prod.sku).trim();
  const list = allProds || await q(db.from('products').select('id,sku'));
  const used = new Set((list || []).map(p => String(p.sku || '').trim().toLowerCase()).filter(Boolean));
  const sku = generateAutoSku(prod.id, used);
  await q(db.from('products').update({sku}).eq('id', prod.id));
  prod.sku = sku;
  return sku;
}

function wrapCanvasLines(ctx, text, maxW, maxLines = 2) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const last = lines.length - 1;
  if (last >= 0 && ctx.measureText(lines[last]).width > maxW) {
    let s = lines[last];
    while (s.length > 3 && ctx.measureText(s + '...').width > maxW) s = s.slice(0, -1);
    lines[last] = s + '...';
  }
  return lines;
}

function drawSingleLabel(ctx, prod, opts, x, y, w, h) {
  const {bizName = '', rate = 0, priceMode = 'both', showBarcode = true, showBiz = true, border = true} = opts;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  if (border) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = Math.max(1, Math.round(w / 240));
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  const pad = Math.round(w * 0.055);
  const innerW = w - pad * 2;
  let cy = y + pad;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const cx = x + w / 2;

  if (showBiz && bizName) {
    const fBiz = Math.max(11, Math.round(h * 0.062));
    ctx.font = `700 ${fBiz}px Manrope,system-ui,sans-serif`;
    ctx.fillStyle = '#475569';
    ctx.fillText(bizName.toUpperCase().slice(0, 34), cx, cy, innerW);
    cy += fBiz + Math.round(h * 0.025);
  }

  const fName = Math.max(14, Math.round(h * 0.095));
  ctx.font = `800 ${fName}px Manrope,system-ui,sans-serif`;
  ctx.fillStyle = '#0f172a';
  const nameLines = wrapCanvasLines(ctx, prod.name || 'Producto', innerW, 2);
  for (const ln of nameLines) {
    ctx.fillText(ln, cx, cy, innerW);
    cy += Math.round(fName * 1.15);
  }
  cy += Math.round(h * 0.02);

  const pr = Number(prod.sale_price_usd || 0);
  const showBs = (typeof S === 'undefined' || S.bimoneda !== false) && rate > 0;
  if (priceMode !== 'none') {
    const fPri = Math.max(20, Math.round(h * 0.19));
    const fSec = Math.max(12, Math.round(h * 0.082));
    let mainTxt = '', subTxt = '';
    if (priceMode === 'usd' || (priceMode === 'both' && !showBs)) {
      mainTxt = fmtCur(pr);
    } else if (priceMode === 'bs' && showBs) {
      mainTxt = fmtSec(pr * rate);
    } else if (priceMode === 'both' && showBs) {
      mainTxt = fmtCur(pr);
      subTxt = fmtSec(pr * rate);
    }
    if (mainTxt) {
      ctx.font = `800 ${fPri}px Manrope,system-ui,sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.fillText(mainTxt, cx, cy, innerW);
      cy += Math.round(fPri * 1.08);
    }
    if (subTxt) {
      ctx.font = `700 ${fSec}px Manrope,system-ui,sans-serif`;
      ctx.fillStyle = '#334155';
      ctx.fillText(subTxt, cx, cy, innerW);
      cy += Math.round(fSec * 1.25);
    }
  }

  const skuText = sanitizeBarcodeText(prod.sku || '');
  const fSku = Math.max(11, Math.round(h * 0.072));
  const bottomY = y + h - pad;
  if (showBarcode && skuText) {
    const skuY = bottomY - fSku;
    const barTop = Math.max(cy + Math.round(h * 0.02), skuY - Math.round(h * 0.30));
    const barH = Math.max(24, skuY - barTop - Math.round(h * 0.025));
    drawCode128(ctx, skuText, x + pad, barTop, innerW, barH);
    ctx.font = `700 ${fSku}px ui-monospace,Menlo,monospace`;
    ctx.fillStyle = '#0f172a';
    ctx.fillText(skuText, cx, skuY, innerW);
  } else if (skuText) {
    ctx.font = `700 ${fSku}px ui-monospace,Menlo,monospace`;
    ctx.fillStyle = '#475569';
    ctx.fillText('SKU: ' + skuText, cx, bottomY - fSku, innerW);
  }
  ctx.restore();
}

function renderLabelsCanvas(expandedItems, opts) {
  const {layout = 'sheetA4', paper = '58mm'} = opts;
  const list = expandedItems.length ? expandedItems : [];
  if (!list.length) return null;

  if (layout === 'sheetA4') {
    const pageW = 1240, pageH = 1754;
    const cols = 3, rows = 8, margin = 44, gapX = 18, gapY = 16;
    const cellW = Math.floor((pageW - margin * 2 - gapX * (cols - 1)) / cols);
    const cellH = Math.floor((pageH - margin * 2 - gapY * (rows - 1)) / rows);
    const perPage = cols * rows;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    const canvases = [];
    for (let pg = 0; pg < pages; pg++) {
      const c = document.createElement('canvas');
      c.width = pageW;
      c.height = pageH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageW, pageH);
      const slice = list.slice(pg * perPage, (pg + 1) * perPage);
      slice.forEach((prod, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const lx = margin + col * (cellW + gapX);
        const ly = margin + row * (cellH + gapY);
        drawSingleLabel(ctx, prod, {...opts, border: true}, lx, ly, cellW, cellH);
      });
      canvases.push(c);
    }
    return canvases;
  }

  const w = layout === 'card' ? 540 : (paper === '80mm' ? 576 : 384);
  const labelH = layout === 'card' ? 340 : (paper === '80mm' ? 300 : 230);
  const gap = 16;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = list.length * labelH + Math.max(0, list.length - 1) * gap;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  list.forEach((prod, i) => {
    const ly = i * (labelH + gap);
    drawSingleLabel(ctx, prod, {...opts, border: layout === 'card'}, 0, ly, w, labelH);
    if (i < list.length - 1 && layout === 'thermal58') {
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(12, ly + labelH + Math.floor(gap / 2));
      ctx.lineTo(w - 12, ly + labelH + Math.floor(gap / 2));
      ctx.stroke();
      ctx.restore();
    }
  });
  return [c];
}

function printCanvases(canvases, isThermal = false) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(f);
  const imgs = canvases.map(c => `<img src="${c.toDataURL('image/png')}">`).join('');
  f.contentDocument.write(`<!doctype html><html><head><style>
    @page{margin:${isThermal ? '0' : '6mm'}}
    body{margin:0;padding:0;background:#fff;text-align:center}
    img{display:block;margin:0 auto;max-width:100%;height:auto;page-break-after:always}
    img:last-child{page-break-after:auto}
  </style></head><body>${imgs}</body></html>`);
  f.contentDocument.close();
  let printed = false;
  const goPrint = () => {
    if (printed) return;
    printed = true;
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {}
    setTimeout(() => f.remove(), 4000);
  };
  f.onload = goPrint;
  setTimeout(goPrint, 450);
}

async function openQuickLabelSheet(prod) {
  const [set, allProds] = await Promise.all([
    q(db.from('settings').select('business_name,ticket_paper').eq('id', 1).single()).catch(() => ({})),
    q(db.from('products').select('id,sku'))
  ]);
  const localProd = {...prod};
  const rawbtOn = typeof hasMod === 'function' && hasMod('rawbt');
  let priceMode = S.bimoneda !== false && S.rate ? 'both' : 'usd';
  let showBarcode = true;
  let copies = 1;

  const paint = () => {
    const hasSku = !!sanitizeBarcodeText(localProd.sku || '');
    const opts = {
      bizName: set.business_name || '',
      rate: Number(S.rate || 0),
      priceMode,
      showBarcode: showBarcode && hasSku,
      showBiz: true,
      layout: 'card',
      paper: set.ticket_paper || '58mm'
    };
    const [canvas] = renderLabelsCanvas([localProd], opts);
    const holder = $('#qlPrev');
    if (holder && canvas) {
      holder.innerHTML = '';
      canvas.className = 'rimg etq-prev';
      holder.appendChild(canvas);
    }
    if ($('#qlSkuInfo')) {
      $('#qlSkuInfo').innerHTML = hasSku
        ? `Código de barras: <b>${esc(localProd.sku)}</b> (escaneable con la cámara de la app)`
        : `<span class="warn">Este producto aún no tiene código (SKU).</span> <button type="button" class="lnk" id="qlGenSku" style="padding:0 .25rem">Generar código automático</button>`;
      if ($('#qlGenSku')) {
        $('#qlGenSku').onclick = () => run(async () => {
          const sku = await ensureProductSku(localProd, allProds);
          prod.sku = sku;
          toast(`Código ${sku} guardado en el producto`);
          paint();
        });
      }
    }
    return opts;
  };

  openSheet('Etiqueta y código de barras', `
    <div class="stack">
      <div id="qlPrev" style="text-align:center"></div>
      <small id="qlSkuInfo" class="mut"></small>
      <div class="grid">
        <label>Mostrar precio
          <select id="qlPrice">
            <option value="both" ${priceMode === 'both' ? 'selected' : ''}>${esc(curLabel())} y ${esc(secSym())}</option>
            <option value="usd" ${priceMode === 'usd' ? 'selected' : ''}>Solo ${esc(curLabel())}</option>
            ${S.bimoneda !== false ? `<option value="bs" ${priceMode === 'bs' ? 'selected' : ''}>Solo ${esc(secSym())}</option>` : ''}
            <option value="none">Sin precio (solo código)</option>
          </select>
        </label>
        <label>Copias al imprimir
          <input id="qlCop" type="number" min="1" max="48" value="${copies}">
        </label>
      </div>
      <label class="chk"><input type="checkbox" id="qlBar" checked> Incluir código de barras (Code 128)</label>
      <div class="row">
        ${rawbtOn ? '<button type="button" class="btn" id="qlRaw">Térmica (RawBT)</button>' : ''}
        <button type="button" class="btn ${rawbtOn ? 'ghost' : ''}" id="qlPrint">Imprimir</button>
        <button type="button" class="btn ghost" id="qlPng">Descargar PNG</button>
      </div>
    </div>`);

  let curOpts = paint();
  $('#qlPrice').onchange = (e) => { priceMode = e.target.value; curOpts = paint(); };
  $('#qlBar').onchange = (e) => { showBarcode = e.target.checked; curOpts = paint(); };
  $('#qlCop').oninput = (e) => { copies = Math.max(1, Math.min(48, Number(e.target.value) || 1)); };

  const buildBatch = (layout) => {
    const items = Array.from({length: copies}, () => localProd);
    return renderLabelsCanvas(items, {...curOpts, layout});
  };
  if ($('#qlRaw')) {
    $('#qlRaw').onclick = () => run(async () => {
      if (showBarcode && !sanitizeBarcodeText(localProd.sku || '')) {
        await ensureProductSku(localProd, allProds);
        prod.sku = localProd.sku;
        curOpts = paint();
      }
      const [canvas] = buildBatch('thermal58');
      if (typeof printRawBTCanvas === 'function') printRawBTCanvas(canvas, set.ticket_paper || '58mm');
    });
  }
  $('#qlPrint').onclick = () => {
    const canvases = buildBatch(copies > 1 ? 'sheetA4' : 'card');
    printCanvases(canvases, false);
  };
  $('#qlPng').onclick = () => {
    const [canvas] = buildBatch('card');
    canvas.toBlob(b => {
      if (!b) return toast('No se pudo crear la imagen', true);
      downloadBlob(b, `etiqueta-${(localProd.sku || localProd.id)}.png`);
    }, 'image/png');
  };
}

async function viewEtiquetas() {
  const [prods, cats, set] = await Promise.all([
    q(db.from('products').select('id,sku,name,category_id,sale_price_usd,is_service,is_combo,product_categories(name)').eq('active', true).order('name')),
    q(db.from('product_categories').select('id,name').eq('active', true).order('name')),
    q(db.from('settings').select('business_name,ticket_paper').eq('id', 1).single()).catch(() => ({}))
  ]);

  const rawbtOn = typeof hasMod === 'function' && hasMod('rawbt');
  const sellable = prods.filter(p => !p.is_service);
  const noSkuCnt = sellable.filter(p => !sanitizeBarcodeText(p.sku || '')).length;
  const bizName = set.business_name || '';
  const paper = set.ticket_paper || '58mm';

  const visible = () => {
    const t = ETQ.q.trim().toLowerCase();
    return sellable.filter(p => {
      if (ETQ.cat !== 'all' && String(p.category_id) !== ETQ.cat) return false;
      return !t || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t);
    });
  };

  const selectedEntries = () => sellable
    .map(p => ({p, n: Math.max(0, Number(ETQ.copies[p.id] || 0))}))
    .filter(x => x.n > 0);

  const expandedList = () => {
    const arr = [];
    selectedEntries().forEach(({p, n}) => { for (let i = 0; i < n; i++) arr.push(p); });
    return arr;
  };

  $('#view').innerHTML = `
    <div class="card stack">
      <div class="title-row">
        <div>
          <h2 style="margin:0">Etiquetas de precio y código de barras</h2>
          <small class="mut">Crea códigos escaneables para tus productos artesanales o de reventa e imprímelos en hoja A4/Carta o rollo térmico.</small>
        </div>
      </div>
      <div class="grid">
        <label>Formato de salida
          <select id="etLayout">
            <option value="sheetA4" ${ETQ.layout === 'sheetA4' ? 'selected' : ''}>Hoja A4 / Carta (3×8 = 24 por hoja)</option>
            <option value="thermal58" ${ETQ.layout === 'thermal58' ? 'selected' : ''}>Rollo térmico (${esc(paper)})</option>
            <option value="card" ${ETQ.layout === 'card' ? 'selected' : ''}>Hablador / Etiqueta grande (PNG)</option>
          </select>
        </label>
        <label>Precio en la etiqueta
          <select id="etPrice">
            <option value="both" ${ETQ.priceMode === 'both' ? 'selected' : ''}>${esc(curLabel())} y ${esc(secSym())}</option>
            <option value="usd" ${ETQ.priceMode === 'usd' ? 'selected' : ''}>Solo ${esc(curLabel())}</option>
            ${S.bimoneda !== false ? `<option value="bs" ${ETQ.priceMode === 'bs' ? 'selected' : ''}>Solo ${esc(secSym())}</option>` : ''}
            <option value="none">Sin precio (solo código)</option>
          </select>
        </label>
      </div>
      <div class="row0" style="flex-wrap:wrap;gap:1rem">
        <label class="chk" style="margin:0"><input type="checkbox" id="etBar" ${ETQ.showBarcode ? 'checked' : ''}> Código de barras (Code 128)</label>
        <label class="chk" style="margin:0"><input type="checkbox" id="etBiz" ${ETQ.showBiz ? 'checked' : ''}> Nombre del negocio</label>
      </div>
      ${noSkuCnt > 0 ? `<div class="row0" style="justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.55rem .75rem;background:var(--bg);border:1px dashed var(--line);border-radius:10px">
        <small class="mut">Hay <b>${noSkuCnt}</b> ${noSkuCnt === 1 ? 'producto sin código' : 'productos sin código'} (SKU).</small>
        <button type="button" class="lnk" id="etAutoSku">Auto-generar códigos faltantes</button>
      </div>` : ''}
    </div>

    <div class="card stack">
      <div class="title-row">
        <h2 style="margin:0">Selecciona productos y copias</h2>
        <div class="row0" style="gap:.5rem">
          <button type="button" class="lnk" id="etSelAll" style="font-size:.82rem">+1 a visibles</button>
          <button type="button" class="lnk bad" id="etClear" style="font-size:.82rem">Limpiar</button>
        </div>
      </div>
      <input id="etQ" type="search" placeholder="Buscar producto o código..." value="${esc(ETQ.q)}">
      ${cats.length ? `<div class="chips" id="etCat">
        <button type="button" data-c="all" class="${ETQ.cat === 'all' ? 'on' : ''}">Todas</button>
        ${cats.map(c => `<button type="button" data-c="${c.id}" class="${ETQ.cat === String(c.id) ? 'on' : ''}">${esc(c.name)}</button>`).join('')}
      </div>` : ''}
      <div class="list" id="etList"></div>
    </div>

    <div class="card stack">
      <div class="title-row">
        <h2 style="margin:0">Vista previa</h2>
        <small class="mut" id="etStat"></small>
      </div>
      <div id="etPrev" style="text-align:center"></div>
      <div class="row">
        ${rawbtOn ? '<button type="button" class="btn" id="etRawBT">Imprimir térmica (RawBT)</button>' : ''}
        <button type="button" class="btn ${rawbtOn ? 'ghost' : ''}" id="etPrint">Imprimir hoja / PDF</button>
        <button type="button" class="btn ghost" id="etPng">Descargar PNG</button>
      </div>
    </div>`;

  const paintPreview = () => {
    const exp = expandedList();
    const selProds = selectedEntries().length;
    $('#etStat').textContent = exp.length
      ? `${exp.length} ${exp.length === 1 ? 'etiqueta' : 'etiquetas'} (${selProds} ${selProds === 1 ? 'producto' : 'productos'})`
      : 'Selecciona al menos 1 producto arriba';
    const holder = $('#etPrev');
    if (!exp.length) {
      holder.innerHTML = '<p class="mut" style="margin:.4rem 0">Toca <b>+</b> en los productos que deseas etiquetar para ver la vista previa en vivo.</p>';
      return;
    }
    const sample = ETQ.layout === 'sheetA4' ? exp.slice(0, 24) : exp.slice(0, 4);
    const canvases = renderLabelsCanvas(sample, {
      bizName, rate: Number(S.rate || 0),
      priceMode: ETQ.priceMode, showBarcode: ETQ.showBarcode,
      showBiz: ETQ.showBiz, layout: ETQ.layout, paper
    });
    holder.innerHTML = '';
    if (canvases && canvases[0]) {
      canvases[0].className = 'rimg etq-prev';
      holder.appendChild(canvases[0]);
      if (exp.length > sample.length) {
        const note = document.createElement('small');
        note.className = 'mut';
        note.style.display = 'block';
        note.style.marginTop = '.4rem';
        note.textContent = `Mostrando primeras ${sample.length} de ${exp.length} etiquetas (al imprimir o descargar se incluyen todas).`;
        holder.appendChild(note);
      }
    }
  };

  const drawList = () => {
    const vis = visible();
    $('#etList').innerHTML = vis.map(p => {
      const n = Math.max(0, Number(ETQ.copies[p.id] || 0));
      const hasSku = !!sanitizeBarcodeText(p.sku || '');
      return `<div class="item aj-row ${n > 0 ? 'aj-in' : ''}" data-pid="${p.id}">
        <span style="flex:1;min-width:150px">
          <b>${esc(p.name)}${p.is_combo ? ' <span class="badge ok" style="font-size:.68rem;padding:.05rem .3rem">Combo</span>' : ''}</b>
          <small>${hasSku ? 'Código: <b>' + esc(p.sku) + '</b>' : '<span class="warn">Sin código</span>'} · <b>${fmtCur(p.sale_price_usd)}</b>${S.bimoneda !== false && S.rate ? ' (' + fmt(p.sale_price_usd * S.rate) + ' Bs)' : ''}</small>
        </span>
        <div class="aj-step" style="margin:0">
          <button type="button" class="aj-sb" data-edec="${p.id}" aria-label="Quitar copia">&minus;</button>
          <input data-eqty="${p.id}" type="number" min="0" max="99" value="${n}" style="width:3.6rem">
          <button type="button" class="aj-sb" data-einc="${p.id}" aria-label="Sumar copia">+</button>
        </div>
      </div>`;
    }).join('') || '<p class="mut">No hay productos con ese filtro.</p>';
    paintPreview();
  };
  drawList();

  $('#etLayout').onchange = (e) => { ETQ.layout = e.target.value; paintPreview(); };
  $('#etPrice').onchange = (e) => { ETQ.priceMode = e.target.value; paintPreview(); };
  $('#etBar').onchange = (e) => { ETQ.showBarcode = e.target.checked; paintPreview(); };
  $('#etBiz').onchange = (e) => { ETQ.showBiz = e.target.checked; paintPreview(); };
  $('#etQ').oninput = (e) => { ETQ.q = e.target.value; drawList(); };
  if ($('#etCat')) {
    $('#etCat').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      ETQ.cat = b.dataset.c;
      document.querySelectorAll('#etCat button').forEach(x => x.classList.toggle('on', x === b));
      drawList();
    };
  }
  $('#etSelAll').onclick = () => {
    visible().forEach(p => { ETQ.copies[p.id] = Math.min(99, Number(ETQ.copies[p.id] || 0) + 1); });
    drawList();
  };
  $('#etClear').onclick = () => { ETQ.copies = {}; drawList(); };
  if ($('#etAutoSku')) {
    $('#etAutoSku').onclick = () => run(async () => {
      const missing = sellable.filter(p => !sanitizeBarcodeText(p.sku || ''));
      if (!missing.length) return;
      if (!confirm(`Se generará y guardará un código de barras único (ej: GE00001) para ${missing.length} ${missing.length === 1 ? 'producto' : 'productos'}. ¿Continuar?`)) return;
      const used = new Set(prods.map(p => String(p.sku || '').trim().toLowerCase()).filter(Boolean));
      for (const p of missing) {
        const sku = generateAutoSku(p.id, used);
        used.add(sku.toLowerCase());
        await q(db.from('products').update({sku}).eq('id', p.id));
        p.sku = sku;
      }
      toast(`${missing.length} ${missing.length === 1 ? 'código generado' : 'códigos generados'}`);
      render();
    });
  }
  $('#etList').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-einc]'), dec = e.target.closest('[data-edec]');
    if (inc) { const id = inc.dataset.einc; ETQ.copies[id] = Math.min(99, Number(ETQ.copies[id] || 0) + 1); drawList(); }
    if (dec) { const id = dec.dataset.edec; ETQ.copies[id] = Math.max(0, Number(ETQ.copies[id] || 0) - 1); drawList(); }
  });
  $('#etList').addEventListener('input', (e) => {
    if (e.target.dataset.eqty !== undefined) {
      const id = e.target.dataset.eqty;
      ETQ.copies[id] = Math.max(0, Math.min(99, Number(e.target.value) || 0));
      paintPreview();
    }
  });

  const ensureSelectedSkus = async (entries) => {
    if (!ETQ.showBarcode) return;
    const missing = entries.map(x => x.p).filter(p => !sanitizeBarcodeText(p.sku || ''));
    if (!missing.length) return;
    const used = new Set(prods.map(p => String(p.sku || '').trim().toLowerCase()).filter(Boolean));
    for (const p of missing) {
      const sku = generateAutoSku(p.id, used);
      used.add(sku.toLowerCase());
      await q(db.from('products').update({sku}).eq('id', p.id));
      p.sku = sku;
    }
    toast(`Se asignó código automático a ${missing.length} ${missing.length === 1 ? 'producto' : 'productos'}`);
  };

  if ($('#etRawBT')) {
    $('#etRawBT').onclick = () => run(async () => {
      const entries = selectedEntries();
      if (!entries.length) throw new Error('Selecciona al menos un producto primero');
      await ensureSelectedSkus(entries);
      const exp = expandedList();
      if (exp.length > 20 && !confirm(`Se enviarán ${exp.length} etiquetas seguidas a la impresora térmica. ¿Continuar?`)) return;
      const [canvas] = renderLabelsCanvas(exp, {
        bizName, rate: Number(S.rate || 0),
        priceMode: ETQ.priceMode, showBarcode: ETQ.showBarcode,
        showBiz: ETQ.showBiz, layout: 'thermal58', paper
      });
      if (typeof printRawBTCanvas === 'function') printRawBTCanvas(canvas, paper);
    });
  }

  $('#etPrint').onclick = () => run(async () => {
    const entries = selectedEntries();
    if (!entries.length) throw new Error('Selecciona al menos un producto primero');
    await ensureSelectedSkus(entries);
    const exp = expandedList();
    const canvases = renderLabelsCanvas(exp, {
      bizName, rate: Number(S.rate || 0),
      priceMode: ETQ.priceMode, showBarcode: ETQ.showBarcode,
      showBiz: ETQ.showBiz, layout: ETQ.layout, paper
    });
    printCanvases(canvases, ETQ.layout === 'thermal58');
  });

  $('#etPng').onclick = () => run(async () => {
    const entries = selectedEntries();
    if (!entries.length) throw new Error('Selecciona al menos un producto primero');
    await ensureSelectedSkus(entries);
    const exp = expandedList();
    const canvases = renderLabelsCanvas(exp, {
      bizName, rate: Number(S.rate || 0),
      priceMode: ETQ.priceMode, showBarcode: ETQ.showBarcode,
      showBiz: ETQ.showBiz, layout: ETQ.layout, paper
    });
    canvases.forEach((c, i) => {
      c.toBlob(b => {
        if (b) downloadBlob(b, `etiquetas-${caracasDate()}${canvases.length > 1 ? '-p' + (i + 1) : ''}.png`);
      }, 'image/png');
    });
    toast(canvases.length > 1 ? `Descargando ${canvases.length} hojas PNG` : 'Etiquetas descargadas en PNG');
  });
}
