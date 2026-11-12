// Importar datos desde Excel o CSV: productos (con stock inicial), clientes y proveedores
const IMP = {type: 'productos', head: [], data: [], name: '', res: null};
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const parseNum = (v) => {
  let s = String(v ?? '').replace(/[^\d.,-]/g, ''); if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? NaN : n;
};
const IMPF = {
  productos: {sku: ['codigo', 'sku', 'cod', 'codigo de barras'], name: ['nombre', 'producto', 'descripcion', 'articulo'], category: ['categoria', 'rubro'], unit: ['unidad', 'um', 'unidad de medida'],
    cost: ['costo', 'costo usd', 'costo manual'], price: ['precio', 'precio usd', 'precio venta', 'precio de venta'], min: ['stock minimo', 'minimo'],
    stock: ['stock', 'stock inicial', 'existencia', 'cantidad', 'inventario'], tax: ['impuesto', 'iva'], service: ['servicio']},
  terceros: {name: ['nombre', 'razon social', 'cliente', 'proveedor'], rif: ['rif', 'cedula', 'ci', 'documento'], phone: ['telefono', 'celular', 'whatsapp', 'tlf'], email: ['correo', 'email'], address: ['direccion'], kind: ['tipo']}
};
const IMPT = {productos: ['Código', 'Nombre', 'Categoría', 'Unidad', 'Costo USD', 'Precio USD', 'Stock mínimo', 'Stock inicial', 'Impuesto', 'Servicio'], terceros: ['Nombre', 'RIF', 'Teléfono', 'Correo', 'Dirección', 'Tipo']};
const IMPS = {productos: [['P-001', 'Cloro 1L', 'Producto terminado', 'L', '1,20', '2,50', '10', '50', 'IVA', 'NO'], ['P-002', 'Delivery', '', 'und', '1,5', '2', '', '', 'Exento', 'SI']],
  terceros: [['Bodega El Sol', 'J-12345678-9', '0414-0000000', '', 'Av. Principal', 'cliente'], ['Distribuidora Norte', 'J-98765432-1', '0412-0000000', '', '', 'proveedor']]};

function parseCSV(t) {
  t = t.replace(/^\uFEFF/, ''); const first = t.split('\n')[0], d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let r = [], c = '', inq = false;
  const endRow = () => { r.push(c); c = ''; if (r.some(x => x.trim() !== '')) rows.push(r); r = []; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inq) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') inq = false; else c += ch; }
    else if (ch === '"') inq = true; else if (ch === d) { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; endRow(); } else c += ch;
  }
  endRow(); return rows;
}
async function readSheet(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return parseCSV(await file.text());
  if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel. Guarda el archivo como CSV e inténtalo de nuevo.')); document.head.appendChild(s); });
  const wb = XLSX.read(await file.arrayBuffer(), {type: 'array'});
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: false, defval: ''});
}

// Convierte las filas del archivo en registros validados
function mapRows() {
  const F = IMPF[IMP.type], col = {};
  IMP.head.forEach((h, i) => { const n = norm(h); for (const [f, al] of Object.entries(F)) if (!(f in col) && al.includes(n)) col[f] = i; });
  const get = (r, f) => col[f] === undefined ? '' : String(r[col[f]] ?? '').trim(), has = Object.fromEntries(Object.keys(col).map(k => [k, true])), seen = new Set();
  const rows = IMP.data.map((r, i) => {
    const o = {line: i + 2, errs: []}, key = norm(get(r, IMP.type === 'productos' ? 'sku' : 'rif')) || norm(get(r, 'name'));
    o.name = get(r, 'name'); if (!o.name) o.errs.push('Falta el nombre');
    if (key && seen.has(key)) o.errs.push('Repetido en el archivo'); seen.add(key);
    if (IMP.type === 'productos') {
      Object.assign(o, {sku: get(r, 'sku'), category: get(r, 'category'), unit: get(r, 'unit'), tax: get(r, 'tax'), service: /^(si|s|1|true|x)$/.test(norm(get(r, 'service')))});
      [['cost', 'Costo'], ['price', 'Precio'], ['min', 'Stock mínimo'], ['stock', 'Stock inicial']].forEach(([f, l]) => { const v = parseNum(get(r, f)); if (Number.isNaN(v)) o.errs.push(l + ' no es un número'); else if (v !== null && v < 0) o.errs.push(l + ' es negativo'); o[f] = v; });
    } else {
      Object.assign(o, {rif: get(r, 'rif'), phone: get(r, 'phone'), email: get(r, 'email'), address: get(r, 'address')});
      const k = norm(get(r, 'kind')); o.cust = !/proveedor/.test(k) || /ambos|cliente/.test(k); o.sup = /proveedor|ambos/.test(k);
    }
    return o;
  });
  return {rows, has, missing: !('name' in col)};
}

async function importProducts(rows, has, opt) {
  const [cats, units, taxes, prods] = await Promise.all([q(db.from('product_categories').select('id,name')), q(db.from('units').select('symbol,name')),
    q(db.from('taxes').select('id,percent,is_default').eq('active', true)), q(db.from('products').select('id,sku,name'))]);
  const catM = new Map(cats.map(c => [norm(c.name), c.id])), unitM = new Map(); units.forEach(u => { unitM.set(norm(u.symbol), u.symbol); unitM.set(norm(u.name), u.symbol); });
  const bySku = new Map(prods.filter(p => p.sku).map(p => [norm(p.sku), p.id])), byName = new Map(prods.map(p => [norm(p.name), p.id]));
  const defTax = taxes.find(t => t.is_default)?.id || null, exTax = taxes.find(t => +t.percent === 0)?.id || null;
  const res = {nuevos: 0, actualizados: 0, omitidos: 0, errores: 0, stock: 0}, ins = [], upd = [];
  for (const r of rows) {
    if (r.errs.length) { res.errores++; continue; }
    let cid = null; if (r.category) { cid = catM.get(norm(r.category)); if (!cid && opt.create) { cid = (await q(db.from('product_categories').insert({name: r.category}).select('id').single())).id; catM.set(norm(r.category), cid); } }
    let unit = 'und'; if (r.unit) { unit = unitM.get(norm(r.unit)); if (!unit && opt.create) { try { await q(db.from('units').insert({name: r.unit, symbol: r.unit, kind: 'unidad', factor_to_base: 1})); } catch (e) { /* ya existe */ } unit = r.unit; unitM.set(norm(r.unit), unit); } unit = unit || 'und'; }
    const tax = r.tax ? (/exent/.test(norm(r.tax)) ? exTax : defTax) : defTax;
    const full = {name: r.name, sku: r.sku || null, category_id: cid, unit, manual_cost_usd: r.cost ?? 0, sale_price_usd: r.price ?? 0, min_stock: r.min ?? 0, tax_id: tax, is_service: r.service};
    const id = (r.sku && bySku.get(norm(r.sku))) || byName.get(norm(r.name));
    if (id && !opt.update) { res.omitidos++; continue; }
    if (id) {   // al actualizar solo se tocan las columnas que vienen en el archivo
      const m = {name: 'name', sku: 'sku', category: 'category_id', unit: 'unit', cost: 'manual_cost_usd', price: 'sale_price_usd', min: 'min_stock', tax: 'tax_id', service: 'is_service'}, row = {};
      Object.entries(m).forEach(([f, k]) => { if (has[f] && (f !== 'category' || cid) && (f === 'service' || f === 'name' || r[f] !== '' && r[f] !== null)) row[k] = full[k]; });
      upd.push({id, row, stock: r.stock});
    } else ins.push({row: full, stock: r.stock});
  }
  const stockItems = [];
  for (let i = 0; i < ins.length; i += 100) {
    const chunk = ins.slice(i, i + 100), out = await q(db.from('products').insert(chunk.map(x => x.row)).select('id'));
    out.forEach((o, k) => { res.nuevos++; if (opt.stock && chunk[k].stock !== null && !chunk[k].row.is_service) stockItems.push({product_id: o.id, qty: chunk[k].stock}); });
  }
  for (let i = 0; i < upd.length; i += 20) await Promise.all(upd.slice(i, i + 20).map(async (u) => { if (Object.keys(u.row).length) await q(db.from('products').update(u.row).eq('id', u.id)); res.actualizados++; if (opt.stock && u.stock !== null) stockItems.push({product_id: u.id, qty: u.stock}); }));
  for (let i = 0; i < stockItems.length; i += 150) { await q(db.rpc('ajuste_masivo2', {p_items: stockItems.slice(i, i + 150), p_mode: 'conteo', p_reason: 'otro', p_note: 'Carga inicial (importación)', p_fin: 'none', p_account_id: null, p_expense_type_id: null})); res.stock += Math.min(150, stockItems.length - i); }
  return res;
}
async function importParties(rows, opt) {
  const ex = await q(db.from('parties').select('id,name,rif,is_customer,is_supplier')), byRif = new Map(ex.filter(p => p.rif).map(p => [norm(p.rif), p])), byName = new Map(ex.map(p => [norm(p.name), p]));
  const res = {nuevos: 0, actualizados: 0, omitidos: 0, errores: 0}, ins = [];
  for (const r of rows) {
    if (r.errs.length) { res.errores++; continue; }
    const row = {name: r.name, rif: r.rif || null, phone: r.phone || null, email: r.email || null, address: r.address || null, is_customer: r.cust, is_supplier: r.sup}, old = (r.rif && byRif.get(norm(r.rif))) || byName.get(norm(r.name));
    if (old) { if (!opt.update) { res.omitidos++; continue; } await q(db.from('parties').update({...row, is_customer: row.is_customer || old.is_customer, is_supplier: row.is_supplier || old.is_supplier}).eq('id', old.id)); res.actualizados++; } else ins.push(row);
  }
  for (let i = 0; i < ins.length; i += 100) { await q(db.from('parties').insert(ins.slice(i, i + 100))); res.nuevos += Math.min(100, ins.length - i); }
  return res;
}

async function viewImportar() {
  $('#view').innerHTML = `<div class="card stack"><h2>Importar datos desde Excel o CSV</h2>
    <p class="mut">Sube un archivo .xlsx o .csv con una fila por registro. Descarga la plantilla para ver las columnas. Antes de guardar verás una vista previa y los errores.</p>
    <label>¿Qué vas a importar?<select id="imT"><option value="productos" ${IMP.type === 'productos' ? 'selected' : ''}>Productos (con stock inicial)</option><option value="terceros" ${IMP.type === 'terceros' ? 'selected' : ''}>Clientes y proveedores</option></select></label>
    <button class="btn ghost" id="imTpl" type="button">Descargar plantilla</button><label>Archivo<input id="imF" type="file" accept=".xlsx,.xls,.csv,.txt"></label></div><div id="imOut"></div>`;
  const draw = () => {
    if (!IMP.data.length) { $('#imOut').innerHTML = ''; return; }
    const {rows, has, missing} = mapRows(), ok = rows.filter(r => !r.errs.length), bad = rows.filter(r => r.errs.length), prod = IMP.type === 'productos';
    $('#imOut').innerHTML = `<div class="card stack"><h2>Vista previa: ${esc(IMP.name)}</h2>
      ${missing ? '<p class="warn">No encuentro la columna "Nombre". Usa la plantilla o revisa los encabezados de la primera fila.</p>' : `<p><b>${ok.length}</b> filas listas${bad.length ? ` | <span class="warn"><b>${bad.length}</b> con errores (no se importarán)</span>` : ''}</p>
      <div class="scroll"><table><thead><tr><th>Fila</th><th>Nombre</th>${prod ? '<th class="n">Costo</th><th class="n">Precio</th><th class="n">Stock</th>' : '<th>RIF</th><th>Tipo</th>'}<th>Estado</th></tr></thead><tbody>
      ${rows.slice(0, 8).map(r => `<tr><td>${r.line}</td><td>${esc(r.name)}</td>${prod ? `<td class="n">${r.cost ?? ''}</td><td class="n">${r.price ?? ''}</td><td class="n">${r.stock ?? ''}</td>` : `<td>${esc(r.rif)}</td><td>${r.sup && r.cust ? 'ambos' : r.sup ? 'proveedor' : 'cliente'}</td>`}<td>${r.errs.length ? `<span class="warn">${esc(r.errs.join(', '))}</span>` : 'OK'}</td></tr>`).join('')}</tbody></table></div>
      ${bad.length ? `<p class="mut">Errores: ${bad.slice(0, 6).map(r => `fila ${r.line} (${esc(r.errs.join(', '))})`).join('; ')}${bad.length > 6 ? '...' : ''}</p>` : ''}
      <label class="chk"><input type="checkbox" id="imU" checked> Actualizar los que ya existen (por ${prod ? 'código o nombre' : 'RIF o nombre'})</label>
      ${prod ? `<label class="chk"><input type="checkbox" id="imC" checked> Crear las categorías y unidades que no existan</label><label class="chk"><input type="checkbox" id="imS" ${has.stock ? 'checked' : ''} ${has.stock ? '' : 'disabled'}> Aplicar el stock inicial (deja el inventario en esa cantidad)</label>` : ''}
      <button class="btn" id="imGo" ${ok.length ? '' : 'disabled'}>Importar ${ok.length} filas</button>`}</div>${IMP.res ? `<div class="card"><h2 class="pos">Importación terminada</h2><p>Nuevos: <b>${IMP.res.nuevos}</b> | Actualizados: <b>${IMP.res.actualizados}</b> | Omitidos: ${IMP.res.omitidos} | Con error: ${IMP.res.errores}${IMP.res.stock !== undefined ? ` | Stock inicial aplicado: ${IMP.res.stock}` : ''}</p></div>` : ''}`;
    if (!missing && ok.length) $('#imGo').onclick = () => run(async () => {
      if (!confirm(`Se importarán ${ok.length} filas. ¿Continuar?`)) return;
      const opt = {update: $('#imU').checked, create: $('#imC')?.checked, stock: $('#imS')?.checked};
      toast('Importando...'); IMP.res = prod ? await importProducts(rows, has, opt) : await importParties(rows, opt);
      IMP.data = []; IMP.name = ''; toast('Importación terminada'); render();
    });
  };
  if (IMP.res && !IMP.data.length) $('#imOut').innerHTML = `<div class="card"><h2 class="pos">Importación terminada</h2><p>Nuevos: <b>${IMP.res.nuevos}</b> | Actualizados: <b>${IMP.res.actualizados}</b> | Omitidos: ${IMP.res.omitidos} | Con error: ${IMP.res.errores}${IMP.res.stock !== undefined ? ` | Stock inicial aplicado: ${IMP.res.stock}` : ''}</p></div>`;
  $('#imT').onchange = (e) => { IMP.type = e.target.value; IMP.data = []; IMP.res = null; render(); };
  $('#imTpl').onclick = () => downloadBlob(new Blob(['\ufeff' + [IMPT[IMP.type], ...IMPS[IMP.type]].map(r => r.join(';')).join('\n')], {type: 'text/csv;charset=utf-8'}), `plantilla_${IMP.type}.csv`);
  $('#imF').onchange = (e) => run(async () => {
    const f = e.target.files[0]; if (!f) return;
    const all = await readSheet(f); if (all.length < 2) throw new Error('El archivo no tiene filas de datos');
    IMP.head = all[0]; IMP.data = all.slice(1).filter(r => r.some(x => String(x).trim() !== '')); IMP.name = f.name; IMP.res = null; draw();
  });
}
