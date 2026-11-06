// Reportes (rentabilidad, caja, posición del negocio) y alertas de atención
const RP = {k: 'mes', from: '', to: ''};
const RANGES = {hoy: 'Hoy', sem: '7 días', mes: 'Este mes', ant: 'Mes anterior', anio: 'Este año', rango: 'Elegir fechas'};
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rpRange() {
  const t = new Date(caracasDate() + 'T12:00:00'), y = t.getFullYear(), m = t.getMonth();
  return {hoy: [dstr(t), dstr(t)], sem: [dstr(new Date(y, m, t.getDate() - 6)), dstr(t)], mes: [dstr(new Date(y, m, 1)), dstr(t)],
    ant: [dstr(new Date(y, m - 1, 1)), dstr(new Date(y, m, 0))], anio: [dstr(new Date(y, 0, 1)), dstr(t)], rango: [RP.from || dstr(t), RP.to || dstr(t)]}[RP.k];
}

async function viewReportes() {
  const [from, to] = rpRange();
  const [r, accs, stock] = await Promise.all([
    q(db.rpc('reporte_resumen', {p_from: from, p_to: to})),
    q(db.from('cuentas_saldo').select('name,balance,currency').eq('active', true).order('id')),
    q(db.from('stock_actual').select('valor_usd'))
  ]);
  const bruta = r.ingresos - r.costo_ventas, neta = bruta - r.gastos, mb = r.ingresos > 0 ? bruta / r.ingresos * 100 : 0;
  const caja = accs.reduce((a, x) => a + toUsd(+x.balance, x.currency), 0), inv = stock.reduce((a, x) => a + +x.valor_usd, 0);
  const fijos = r.gastos_por_tipo.filter(x => x.fijo).reduce((a, x) => a + +x.total, 0), pe = mb > 0 && fijos > 0 ? fijos / (mb / 100) : 0;
  const U = (n) => fmt(n) + ' USD', sg = (n) => n >= 0 ? 'pos' : 'neg';
  const L = (a, b, c = '') => `<div class="rl ${c}"><span>${a}</span><b>${b}</b></div>`;
  const B = (lab, val, max, right) => `<div class="bl"><div class="rl" style="border:0;padding:.2rem 0"><span>${esc(lab)}</span><b>${right}</b></div><div class="bar w"><i style="width:${max > 0 ? Math.max(2, val / max * 100) : 0}%"></i></div></div>`;
  const maxG = Math.max(0, ...r.gastos_por_tipo.map(x => +x.total)), maxP = Math.max(0, ...r.top_productos.map(x => +x.ingreso)), maxD = Math.max(0, ...r.por_dia.map(x => +x.total));
  $('#view').innerHTML = `<div class="chips sub" id="rpR">${Object.entries(RANGES).map(([k, v]) => `<button data-k="${k}" class="${k === RP.k ? 'on' : ''}">${v}</button>`).join('')}</div>
  ${RP.k === 'rango' ? `<div class="card"><div class="grid"><label>Desde<input id="rpF" type="date" value="${from}"></label><label>Hasta<input id="rpT" type="date" value="${to}"></label><button class="btn" id="rpGo">Ver</button></div></div>` : ''}
  <p class="mut">Del ${from} al ${to}</p>
  <div class="card"><h2>Resultado del período</h2>
    ${L('Ingresos por ventas (sin IVA)', U(r.ingresos))}${L('Costo de lo vendido', '-' + U(r.costo_ventas))}${L('Utilidad bruta', U(bruta) + ' (' + fmt(mb, 0) + '%)', sg(bruta))}
    ${L('Gastos', '-' + U(r.gastos))}${L('Utilidad neta', U(neta), 'tot ' + sg(neta))}
    <p class="mut">${r.num_ventas} ventas | Ticket promedio ${U(r.num_ventas ? r.ingresos / r.num_ventas : 0)}<br>IVA cobrado (no es ganancia): ${U(r.iva)} | Compras del período: ${U(r.compras)}</p></div>
  <div class="card"><h2>Dinero disponible</h2>${L('Total en cuentas', U(caja) + (S.rate ? ' | ' + fmt(caja * S.rate) + ' Bs' : ''), 'tot')}
    ${accs.map(a => L(esc(a.name), money(a.balance, a.currency))).join('')}</div>
  <div class="card"><h2>Posición del negocio</h2>${L('Dinero en cuentas', U(caja))}${L('Inventario (a costo)', U(inv))}${L('Por cobrar a clientes', U(r.por_cobrar))}${L('Por pagar a proveedores', '-' + U(r.por_pagar))}
    ${L('Capital del negocio', U(caja + inv + r.por_cobrar - r.por_pagar), 'tot ' + sg(caja + inv + r.por_cobrar - r.por_pagar))}</div>
  <div class="card"><h2>Gastos por tipo</h2>${r.gastos_por_tipo.map(x => B(x.tipo + (x.fijo ? ' (fijo)' : ''), +x.total, maxG, U(+x.total))).join('') || '<p class="mut">Sin gastos en este período.</p>'}
    ${pe ? `<p class="mut">Punto de equilibrio: para cubrir tus gastos fijos (${U(fijos)}) con tu margen de ${fmt(mb, 0)}% necesitas vender unos <b>${U(pe)}</b> en este período.</p>` : ''}</div>
  <div class="card"><h2>Más vendidos</h2>${r.top_productos.map(x => B(x.name, +x.ingreso, maxP, U(+x.ingreso) + ' | gana ' + fmt(x.utilidad))).join('') || '<p class="mut">Sin ventas en este período.</p>'}</div>
  <div class="card"><h2>Ventas por día</h2>${r.por_dia.length ? `<div class="dayb">${r.por_dia.map(x => `<i style="height:${Math.max(3, +x.total / maxD * 100)}%" title="${x.dia}: ${fmt(x.total)} USD"></i>`).join('')}</div>
    <p class="mut">${r.por_dia[0].dia} a ${r.por_dia[r.por_dia.length - 1].dia}. Toca una barra para ver el valor.</p>` : '<p class="mut">Sin ventas en este período.</p>'}</div>`;
  $('#rpR').onclick = (e) => { const b = e.target.closest('button'); if (b) { RP.k = b.dataset.k; render(); } };
  if ($('#rpGo')) $('#rpGo').onclick = () => { RP.from = $('#rpF').value; RP.to = $('#rpT').value; render(); };
}

// Tarjeta "Requiere atención" para la pantalla de inicio
async function alertasHtml() {
  const hoy = caracasDate();
  const [venc, prods, stock, rate, accs] = await Promise.all([
    q(db.from('ventas_resumen').select('id').eq('status', 'pendiente').lt('due_date', hoy)),
    q(db.from('products').select('sale_price_usd,avg_cost_usd').eq('active', true)),
    q(db.from('stock_actual').select('bajo_minimo')),
    q(db.from('exchange_rates').select('rate_date').eq('currency', 'USD').order('rate_date', {ascending: false}).limit(1)),
    q(db.from('cuentas_saldo').select('name,balance').eq('active', true))
  ]);
  const A = [], bajos = stock.filter(x => x.bajo_minimo).length, sc = prods.filter(p => !+p.avg_cost_usd).length;
  const ng = prods.filter(p => +p.avg_cost_usd > 0 && +p.sale_price_usd < +p.avg_cost_usd).length, neg = accs.filter(a => +a.balance < 0);
  if (venc.length) A.push(['ventas', `${venc.length} ${venc.length === 1 ? 'venta vencida' : 'ventas vencidas'} por cobrar`]);
  if (bajos) A.push(['inventario', `${bajos} ${bajos === 1 ? 'producto' : 'productos'} por reponer`]);
  if (sc) A.push(['inventario', `${sc} ${sc === 1 ? 'producto sin costo' : 'productos sin costo'}: la utilidad saldrá incompleta`]);
  if (ng) A.push(['inventario', `${ng} ${ng === 1 ? 'producto' : 'productos'} con precio menor al costo`]);
  if (!rate[0] || rate[0].rate_date < hoy) A.push(['configuracion', 'La tasa de cambio no se ha actualizado hoy']);
  if (neg.length) A.push(['finanzas', 'Saldo negativo en: ' + neg.map(a => a.name).join(', ')]);
  return `<div class="card"><h2>${A.length ? 'Requiere atención' : 'Todo en orden'}</h2>${A.length ? A.map(([g, t]) => `<button class="alert" data-go="${g}"><span>${esc(t)}</span><span>&rsaquo;</span></button>`).join('') : '<p class="mut">No hay alertas por ahora.</p>'}</div>`;
}
