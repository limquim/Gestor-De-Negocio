// Reportes (rentabilidad en USD y Bs históricos, exposición cambiaria, cobros por método y alertas)
const RP = {k: 'mes', from: '', to: ''};
const RANGES = {hoy: 'Hoy', sem: '7 días', mes: 'Este mes', ant: 'Mes anterior', anio: 'Este año', rango: 'Elegir fechas'};
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rpRange() {
  const t = new Date(caracasDate() + 'T12:00:00'), y = t.getFullYear(), m = t.getMonth();
  return {hoy: [dstr(t), dstr(t)], sem: [dstr(new Date(y, m, t.getDate() - 6)), dstr(t)], mes: [dstr(new Date(y, m, 1)), dstr(t)],
    ant: [dstr(new Date(y, m - 1, 1)), dstr(new Date(y, m, 0))], anio: [dstr(new Date(y, 0, 1)), dstr(t)], rango: [RP.from || dstr(t), RP.to || dstr(t)]}[RP.k];
}

// Calcula resultados en bolívares HISTÓRICOS (a la tasa exacta de cada operación, nunca se infla al subir la tasa)
async function calcHistoricalBs(from, to) {
  try {
    const [sales, rets, exps, eTypes] = await Promise.all([
      q(db.from('sales').select('id,subtotal_usd,discount_usd,exchange_rate,status').gte('sale_date', from).lte('sale_date', to).neq('status', 'anulada')),
      q(db.from('sale_returns').select('id,sale_id,status').gte('return_date', from).lte('return_date', to).eq('status', 'activa')),
      q(db.from('expenses').select('expense_type_id,currency,amount,amount_usd,exchange_rate,status').gte('expense_date', from).lte('expense_date', to).neq('status', 'anulado')),
      q(db.from('expense_types').select('id,in_sales_cost'))
    ]);

    const saleRate = new Map();
    let ingresosBs = 0;
    sales.forEach(s => {
      const rt = Number(s.exchange_rate || S.rate || 0);
      saleRate.set(Number(s.id), rt);
      ingresosBs += (Number(s.subtotal_usd || 0) - Number(s.discount_usd || 0)) * rt;
    });

    // Consultar ítems de las ventas del período (en lotes de 150 IDs para evitar URLs largas)
    const saleIds = sales.map(s => s.id);
    let costoBs = 0;
    for (let i = 0; i < saleIds.length; i += 150) {
      const chunk = saleIds.slice(i, i + 150);
      const items = await q(db.from('sale_items').select('sale_id,quantity,unit_cost_usd').in('sale_id', chunk));
      items.forEach(it => {
        const rt = saleRate.get(Number(it.sale_id)) || Number(S.rate || 0);
        costoBs += Number(it.quantity || 0) * Number(it.unit_cost_usd || 0) * rt;
      });
    }

    // Descontar devoluciones activas del período a la tasa original de cada venta devuelta
    if (rets.length) {
      const missingSaleIds = [...new Set(rets.map(r => r.sale_id).filter(id => id != null && !saleRate.has(Number(id))))];
      if (missingSaleIds.length) {
        const extraSales = await q(db.from('sales').select('id,exchange_rate').in('id', missingSaleIds));
        extraSales.forEach(s => saleRate.set(Number(s.id), Number(s.exchange_rate || S.rate || 0)));
      }
      const retRate = new Map(rets.map(r => [Number(r.id), saleRate.get(Number(r.sale_id)) || Number(S.rate || 0)]));
      const retIds = rets.map(r => r.id);
      const rItems = await q(db.from('sale_return_items').select('return_id,quantity,unit_price_usd,unit_cost_usd,restock').in('return_id', retIds));
      rItems.forEach(ri => {
        const rt = retRate.get(Number(ri.return_id)) || Number(S.rate || 0);
        ingresosBs -= Number(ri.quantity || 0) * Number(ri.unit_price_usd || 0) * rt;
        if (ri.restock) costoBs -= Number(ri.quantity || 0) * Number(ri.unit_cost_usd || 0) * rt;
      });
    }

    // Gastos operativos en Bs históricos (si el gasto fue en Bs, usa el monto exacto en Bs pagado)
    const inCostSet = new Set(eTypes.filter(t => t.in_sales_cost).map(t => Number(t.id)));
    let gastosBs = 0;
    exps.forEach(e => {
      if (e.expense_type_id != null && inCostSet.has(Number(e.expense_type_id))) return;
      if (e.currency === 'VES') gastosBs += Number(e.amount || 0);
      else gastosBs += Number(e.amount_usd ?? e.amount ?? 0) * Number(e.exchange_rate || S.rate || 0);
    });

    const brutaBs = ingresosBs - costoBs;
    const netaBs = brutaBs - gastosBs;
    return {ok: true, ingresosBs, costoBs, brutaBs, gastosBs, netaBs};
  } catch (e) {
    return {ok: false, ingresosBs: 0, costoBs: 0, brutaBs: 0, gastosBs: 0, netaBs: 0};
  }
}

async function viewReportes() {
  const [from, to] = rpRange();
  const toCaracasDay = (v) => {
    if (!v) return '';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return isNaN(d.getTime()) ? s.slice(0, 10) : d.toLocaleDateString('en-CA', {timeZone: 'America/Caracas'});
  };

  const [r, histBs, accs, stock, mv, allPays, set] = await Promise.all([
    q(db.rpc('reporte_resumen', {p_from: from, p_to: to})),
    calcHistoricalBs(from, to),
    q(db.from('cuentas_saldo').select('name,balance,currency').eq('active', true).order('id')),
    q(db.from('stock_actual').select('valor_usd')),
    q(db.from('account_movements').select('kind,amount,accounts(name,currency)').gte('created_at', from + 'T00:00:00-04:00').lte('created_at', to + 'T23:59:59-04:00')),
    db.from('payments').select('*').order('id', {ascending: false}).limit(800).then(x => x.error ? [] : (x.data || [])),
    q(db.from('settings').select('business_name,business_phone').eq('id', 1).single()).catch(() => ({}))
  ]);

  // Agrupar cobros de ventas del período por método de pago (sin depender de created_at en payments)
  const rawSaleIds = [...new Set(allPays.filter(p => p.sale_id).map(p => p.sale_id))];
  const salesMeta = [];
  for (let i = 0; i < rawSaleIds.length; i += 150) {
    const chunk = rawSaleIds.slice(i, i + 150);
    const part = await q(db.from('sales').select('id,status,sale_date').in('id', chunk));
    salesMeta.push(...part);
  }
  const saleInfo = new Map(salesMeta.map(x => [x.id, x]));
  const byMethodMap = {};
  let cobrosPerUsd = 0;
  allPays.forEach(p => {
    if (!p.sale_id || !(+p.amount > 0)) return;
    const si = saleInfo.get(p.sale_id);
    if (si && si.status === 'anulada') return;
    const pDay = toCaracasDay(p.paid_at || p.payment_date || p.created_at || si?.sale_date);
    if (!pDay || pDay < from || pDay > to) return;
    const k = p.method || 'otro';
    const m = byMethodMap[k] || (byMethodMap[k] = {name: METHODS[k] || k, count: 0, usd: 0, origUsd: 0, origVes: 0});
    m.count++;
    m.usd += +p.amount_usd || 0;
    if (p.currency === 'USD') m.origUsd += +p.amount || 0;
    else m.origVes += +p.amount || 0;
    cobrosPerUsd += +p.amount_usd || 0;
  });
  const byMethod = Object.values(byMethodMap).sort((a, b) => b.usd - a.usd);
  const maxMet = Math.max(0, ...byMethod.map(x => x.usd));

  const bruta = r.ingresos - r.costo_ventas, neta = bruta - r.gastos, mb = r.ingresos > 0 ? bruta / r.ingresos * 100 : 0;
  const cajaUsdReal = accs.filter(a => a.currency === 'USD').reduce((s, a) => s + Number(a.balance || 0), 0);
  const cajaVesReal = accs.filter(a => a.currency !== 'USD').reduce((s, a) => s + Number(a.balance || 0), 0);
  const cajaVesInUsd = S.rate ? cajaVesReal / S.rate : 0;
  const caja = cajaUsdReal + cajaVesInUsd;
  const inv = stock.reduce((a, x) => a + +x.valor_usd, 0);
  const fijos = r.gastos_por_tipo.filter(x => x.fijo).reduce((a, x) => a + +x.total, 0), pe = mb > 0 && fijos > 0 ? fijos / (mb / 100) : 0;
  const U = (n) => fmt(n) + ' USD', sg = (n) => n >= 0 ? 'pos' : 'neg';
  const L = (a, b, c = '') => `<div class="rl ${c}"><span>${a}</span><b>${b}</b></div>`;
  const LB = (a, usdStr, bsVal, c = '') => `<div class="rl ${c}"><span>${a}</span><b>${usdStr}${histBs.ok ? `<small class="mut" style="display:block;font-weight:600">${fmt(bsVal)} Bs hist.</small>` : ''}</b></div>`;

  // Exposición cambiaria (qué porcentaje de la caja positiva está en USD vs Bs)
  const posUsd = Math.max(0, cajaUsdReal), posVesUsd = Math.max(0, cajaVesInUsd), posTot = posUsd + posVesUsd;
  const pctUsd = posTot > 0 ? Math.round(posUsd / posTot * 100) : 0;
  const pctVes = posTot > 0 ? 100 - pctUsd : 0;
  const loss5 = posVesUsd > 0 ? posVesUsd - (posVesUsd / 1.05) : 0;
  const loss10 = posVesUsd > 0 ? posVesUsd - (posVesUsd / 1.10) : 0;

  const MV = {cobro: 'Cobros', anulacion: 'Anulaciones', pago: 'Pagos de compras', gasto: 'Gastos', transferencia: 'Transferencias', ajuste: 'Ajustes', aporte: 'Aportes de capital', retiro: 'Retiros del dueño', nomina: 'Nómina', adelanto: 'Adelantos', reembolso: 'Reembolsos'}, mvA = {};
  mv.forEach(m => { const n = m.accounts?.name || '?', a = mvA[n] || (mvA[n] = {cur: m.accounts?.currency, k: {}, net: 0}), k = MV[m.kind] || m.kind; a.k[k] = (a.k[k] || 0) + +m.amount; a.net += +m.amount; });
  const cajaMov = `<div class="card"><h2>Movimiento de caja del período</h2>${Object.entries(mvA).map(([n, a]) => `<div class="mvb"><b>${esc(n)}</b>${Object.entries(a.k).map(([k, v]) => L(k, (v >= 0 ? '+' : '') + money(v, a.cur))).join('')}${L('Variación', money(a.net, a.cur), 'tot ' + sg(a.net))}</div>`).join('') || '<p class="mut">Sin movimientos de dinero en este período.</p>'}</div>`;
  const B = (lab, val, max, right) => `<div class="bl"><div class="rl" style="border:0;padding:.2rem 0"><span>${esc(lab)}</span><b>${right}</b></div><div class="bar w"><i style="width:${max > 0 ? Math.max(2, val / max * 100) : 0}%"></i></div></div>`;
  const maxG = Math.max(0, ...r.gastos_por_tipo.map(x => +x.total)), maxP = Math.max(0, ...r.top_productos.map(x => +x.ingreso)), maxD = Math.max(0, ...r.por_dia.map(x => +x.total));

  $('#view').innerHTML = `<div class="chips sub" id="rpR">${Object.entries(RANGES).map(([k, v]) => `<button data-k="${k}" class="${k === RP.k ? 'on' : ''}">${v}</button>`).join('')}</div>
  ${RP.k === 'rango' ? `<div class="card"><div class="grid"><label>Desde<input id="rpF" type="date" value="${from}"></label><label>Hasta<input id="rpT" type="date" value="${to}"></label><button class="btn" id="rpGo">Ver</button></div></div>` : ''}
  <div class="card stack" style="padding:.8rem 1rem">
    <div class="title-row">
      <span class="mut">Período: <b>${dmy(from)}</b> al <b>${dmy(to)}</b></span>
      <button class="lnk" id="rpWa">Compartir por WhatsApp</button>
    </div>
    <div class="row" style="margin:0">
      <button class="btn ghost" id="rpCsv">Ventas (CSV)</button>
      <button class="btn ghost" id="rpProdCsv">Productos y utilidad (CSV)</button>
    </div>
  </div>

  <div class="card"><h2>Resultado del período</h2>
    ${LB('Ingresos por ventas (sin IVA)', U(r.ingresos), histBs.ingresosBs)}
    ${LB('Costo de lo vendido', '-' + U(r.costo_ventas), -histBs.costoBs)}
    ${LB('Utilidad bruta', U(bruta) + ' (' + fmt(mb, 0) + '%)', histBs.brutaBs, sg(bruta))}
    ${LB('Gastos operativos', '-' + U(r.gastos), -histBs.gastosBs)}
    ${LB('Utilidad neta', U(neta), histBs.netaBs, 'tot ' + sg(neta))}
    <p class="mut" style="margin-bottom:0">${r.num_ventas} ventas | Ticket promedio ${U(r.num_ventas ? r.ingresos / r.num_ventas : 0)}<br>
      IVA cobrado (no es ganancia): ${U(r.iva)} | Compras del período: ${U(r.compras)}
      ${histBs.ok ? '<br><small>Los <b>Bs hist.</b> usan la tasa exacta del día de cada operación (no cambian si sube el dólar mañana).</small>' : ''}</p>
  </div>

  <div class="card"><h2>Cobros del período por método</h2>
    ${byMethod.length ? byMethod.map(m => B(
      `${m.name} (${m.count})`,
      m.usd, maxMet,
      U(m.usd) + (m.origVes ? ` · ${fmt(m.origVes)} Bs` : '')
    )).join('') + L('Total cobrado en el período', U(cobrosPerUsd), 'tot') : '<p class="mut">Sin cobros de ventas registrados en este período.</p>'}
  </div>

  <div class="card"><h2>Dinero disponible y exposición cambiaria</h2>
    ${L('Total consolidado hoy', U(caja), 'tot')}
    ${L('En cuentas USD (protegido)', fmt(cajaUsdReal) + ' USD')}
    ${L('En cuentas Bs (expuesto)', fmt(cajaVesReal) + ' Bs' + (S.rate ? ` (≈ ${fmt(cajaVesInUsd)} USD hoy)` : ''))}
    ${posTot > 0 ? `<div class="fx-bar" title="${pctUsd}% USD / ${pctVes}% Bs"><i style="width:${pctUsd}%"></i></div>
      <div class="title-row" style="margin:.25rem 0 .6rem"><small class="pos"><b>${pctUsd}% en USD</b></small><small class="${pctVes >= 50 ? 'warn' : 'mut'}"><b>${pctVes}% en Bs</b></small></div>` : ''}
    ${loss10 > 0.5 ? `<p class="mut" style="margin:0 0 .6rem">Si la tasa sube <b>+5%</b> tus Bs pierden <b>${U(loss5)}</b> de poder de compra; si sube <b>+10%</b> pierden <b>${U(loss10)}</b>.</p>` : ''}
    ${accs.map(a => L(esc(a.name), money(a.balance, a.currency))).join('')}
  </div>

  ${cajaMov}

  <div class="card"><h2>Posición del negocio</h2>${L('Dinero en cuentas', U(caja))}${L('Inventario (a costo)', U(inv))}${L('Por cobrar a clientes', U(r.por_cobrar))}${L('Por pagar a proveedores', '-' + U(r.por_pagar))}
    ${L('Capital del negocio', U(caja + inv + r.por_cobrar - r.por_pagar), 'tot ' + sg(caja + inv + r.por_cobrar - r.por_pagar))}</div>
  <div class="card"><h2>Gastos por tipo</h2>${r.gastos_por_tipo.map(x => B(x.tipo + (x.fijo ? ' (fijo)' : ''), +x.total, maxG, U(+x.total))).join('') || '<p class="mut">Sin gastos en este período.</p>'}
    ${pe ? `<p class="mut">Punto de equilibrio: para cubrir tus gastos fijos (${U(fijos)}) con tu margen de ${fmt(mb, 0)}% necesitas vender unos <b>${U(pe)}</b> en este período.</p>` : ''}</div>
  <div class="card"><h2>Más vendidos</h2>${r.top_productos.map(x => B(x.name, +x.ingreso, maxP, U(+x.ingreso) + ' | gana ' + fmt(x.utilidad))).join('') || '<p class="mut">Sin ventas en este período.</p>'}</div>
  <div class="card"><h2>Ventas por día</h2>${r.por_dia.length ? `<div class="dayb">${r.por_dia.map(x => `<i style="height:${Math.max(3, +x.total / maxD * 100)}%" title="${x.dia}: ${fmt(x.total)} USD"></i>`).join('')}</div>
    <p class="mut">${r.por_dia[0].dia} a ${r.por_dia[r.por_dia.length - 1].dia}. Toca una barra para ver el valor.</p>` : '<p class="mut">Sin ventas en este período.</p>'}</div>`;

  $('#rpR').onclick = (e) => { const b = e.target.closest('button'); if (b) { RP.k = b.dataset.k; render(); } };
  $('#rpWa').onclick = () => {
    const lines = [
      `*ESTADO DE RESULTADOS — ${String(set?.business_name || 'Mi negocio').toUpperCase()}*`,
      `Período: ${dmy(from)} al ${dmy(to)}${S.rate ? ' | Tasa hoy: ' + fmt(S.rate, 4) + ' Bs/USD' : ''}`,
      '',
      `• Ingresos (sin IVA): ${U(r.ingresos)}${histBs.ok ? ` (${fmt(histBs.ingresosBs)} Bs hist.)` : ''}`,
      `• Costo vendido: -${U(r.costo_ventas)}`,
      `• Utilidad bruta: ${U(bruta)} (${fmt(mb, 0)}%)`,
      `• Gastos: -${U(r.gastos)}`,
      `*• Utilidad neta: ${U(neta)}*${histBs.ok ? ` (${fmt(histBs.netaBs)} Bs hist.)` : ''}`,
      '',
      '*POSICIÓN HOY*',
      `• En USD: ${fmt(cajaUsdReal)} USD | En Bs: ${fmt(cajaVesReal)} Bs (${pctUsd}% USD / ${pctVes}% Bs)`,
      `• Inventario: ${U(inv)} | Por cobrar: ${U(r.por_cobrar)} | Por pagar: ${U(r.por_pagar)}`,
      `• Capital del negocio: ${U(caja + inv + r.por_cobrar - r.por_pagar)}`
    ];
    window.open(`https://wa.me/${waDigits(set?.business_phone || '')}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  };
  $('#rpCsv').onclick = () => run(async () => {
    const rows = await q(db.from('ventas_resumen').select('id,sale_date,doc_type,status,customer,total_usd,exchange_rate,paid_usd').gte('sale_date', from).lte('sale_date', to).order('id'));
    const csv = ['Nro,Fecha,Documento,Estado,Cliente,Total USD,Tasa,Total Bs Historico,Pagado USD', ...rows.map(x => [x.id, x.sale_date, x.doc_type, x.status, '"' + (x.customer || 'Cliente general').replace(/"/g, '""') + '"', x.total_usd, x.exchange_rate, (x.total_usd * x.exchange_rate).toFixed(2), x.paid_usd].join(','))].join('\n');
    downloadBlob(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'}), `ventas_${from}_${to}.csv`);
  });
  $('#rpProdCsv').onclick = () => {
    const rows = r.top_productos || [];
    if (!rows.length) return toast('No hay productos vendidos en este período', true);
    const csv = ['Producto,Ingreso USD,Utilidad USD,Margen %', ...rows.map(x => {
      const ing = Number(x.ingreso || 0), ut = Number(x.utilidad || 0), mg = ing > 0 ? (ut / ing * 100) : 0;
      return ['"' + String(x.name || '').replace(/"/g, '""') + '"', ing.toFixed(2), ut.toFixed(2), mg.toFixed(1)].join(',');
    })].join('\n');
    downloadBlob(new Blob(['\ufeff' + csv], {type: 'text/csv;charset=utf-8'}), `rentabilidad_productos_${from}_${to}.csv`);
  };
  if ($('#rpGo')) $('#rpGo').onclick = () => { RP.from = $('#rpF').value; RP.to = $('#rpT').value; render(); };
}

// Tarjeta "Requiere atención" para la pantalla de inicio
async function alertasHtml() {
  const hoy = caracasDate();
  const [venc, prods, stock, rate, accs, enp] = await Promise.all([
    q(db.from('ventas_resumen').select('id').eq('status', 'pendiente').lt('due_date', hoy)),
    q(db.from('products').select('sale_price_usd,avg_cost_usd').eq('active', true).eq('is_service', false)),
    q(db.from('stock_actual').select('bajo_minimo')),
    q(db.from('exchange_rates').select('rate_date').eq('currency', 'USD').order('rate_date', {ascending: false}).limit(1)),
    q(db.from('cuentas_saldo').select('name,balance').eq('active', true)),
    q(db.from('production_orders').select('id').eq('status', 'en_proceso'))
  ]);
  const A = [], bajos = stock.filter(x => x.bajo_minimo).length, sc = prods.filter(p => !+p.avg_cost_usd).length;
  const ng = prods.filter(p => +p.avg_cost_usd > 0 && +p.sale_price_usd < +p.avg_cost_usd).length, neg = accs.filter(a => +a.balance < 0);
  if (venc.length) A.push(['ventas', `${venc.length} ${venc.length === 1 ? 'venta vencida' : 'ventas vencidas'} por cobrar`]);
  if (bajos) A.push(['inventario', `${bajos} ${bajos === 1 ? 'producto' : 'productos'} por reponer`]);
  if (sc) A.push(['inventario', `${sc} ${sc === 1 ? 'producto sin costo' : 'productos sin costo'}: la utilidad saldrá incompleta`]);
  if (ng) A.push(['inventario', `${ng} ${ng === 1 ? 'producto' : 'productos'} con precio menor al costo`]);
  if (!rate[0] || rate[0].rate_date < hoy) A.push(['configuracion', 'La tasa de cambio no se ha actualizado hoy', 'tasa']);
  if (neg.length) A.push(['finanzas', 'Saldo negativo en: ' + neg.map(a => a.name).join(', ')]);
  if (enp.length) A.push(['produccion', `${enp.length} ${enp.length === 1 ? 'orden de producción en proceso' : 'órdenes de producción en proceso'}`]);
  if ((S.role || 'admin') === 'admin' && typeof getLastBackupDate === 'function') {
    const lb = getLastBackupDate();
    const dBk = lb ? Math.floor((Date.now() - new Date(lb).getTime()) / 864e5) : null;
    if (dBk !== null && dBk >= 14) A.push(['configuracion', `Llevas ${dBk} días sin descargar un respaldo de tus datos`, 'respaldo']);
  }
  return `<div class="card"><h2>${A.length ? 'Requiere atención' : 'Todo en orden'}</h2>${A.length ? A.map(([g, t, scCfg]) => `<button class="alert" data-go="${g}" ${scCfg ? `onclick="SUB.cfg='${scCfg}'"` : ''}><span>${esc(t)}</span><span>&rsaquo;</span></button>`).join('') : '<p class="mut">No hay alertas por ahora.</p>'}</div>`;
}
