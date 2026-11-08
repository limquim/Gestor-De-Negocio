// Panel del dueño: cómo va el negocio de un vistazo
const ico = (d) => `<svg class="ic" viewBox="0 0 24 24">${d}</svg>`;
async function viewInicio() {
  const hoy = caracasDate(), t = new Date(hoy + 'T12:00:00'), y = t.getFullYear(), m = t.getMonth(), dd = t.getDate();
  const m0 = dstr(new Date(y, m, 1)), p0 = dstr(new Date(y, m - 1, 1)), p1 = dstr(new Date(y, m - 1, Math.min(dd, new Date(y, m, 0).getDate())));
  const d14 = dstr(new Date(y, m, dd - 13)), d30 = dstr(new Date(y, m, dd - 30));
  const rp = (a, b) => q(db.rpc('reporte_resumen', {p_from: a, p_to: b}));
  const [h, mes, ant, quin, accs, stock, alertHtml, vm, sold, set] = await Promise.all([
    rp(hoy, hoy), rp(m0, hoy), rp(p0, p1), rp(d14, hoy),
    q(db.from('cuentas_saldo').select('balance,currency').eq('active', true)),
    q(db.from('stock_actual').select('product_id,name,stock,bajo_minimo,valor_usd')),
    alertasHtml(),
    q(db.from('ventas_resumen').select('customer,total_usd').gte('sale_date', m0).neq('status', 'anulada')),
    q(db.from('sale_items').select('product_id,sales!inner(sale_date,status)').gte('sales.sale_date', d30).neq('sales.status', 'anulada')),
    q(db.from('settings').select('business_name').eq('id', 1).single())
  ]);
  const U = (n) => fmt(n) + ' USD', ut = (r) => r.ingresos - r.costo_ventas - r.gastos;
  const dl = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null, dtxt = (a, b, l) => { const v = dl(a, b); return v === null ? '' : `${v >= 0 ? '+' : ''}${fmt(v, 0)}% ${l}`; };
  const caja = accs.reduce((a, x) => a + toUsd(+x.balance, x.currency), 0), inv = stock.reduce((a, x) => a + +x.valor_usd, 0), cap = caja + inv + mes.por_cobrar - mes.por_pagar;
  const U1 = ut(mes), mg = mes.ingresos > 0 ? U1 / mes.ingresos * 100 : 0, gHoy = h.ingresos - h.costo_ventas, bajos = stock.filter(x => x.bajo_minimo).length;
  const bar = (lab, val, max, right) => `<div class="bl"><div class="rl" style="border:0;padding:.2rem 0"><span>${esc(lab)}</span><b>${right}</b></div><div class="bar w"><i style="width:${max > 0 ? Math.max(2, val / max * 100) : 0}%"></i></div></div>`;
  // ventas de los últimos 14 días
  const byDay = Object.fromEntries(quin.por_dia.map(x => [x.dia, +x.total])), days = Array.from({length: 14}, (_, i) => dstr(new Date(y, m, dd - 13 + i))), maxD = Math.max(0, ...days.map(x => byDay[x] || 0));
  // mejores productos y clientes del mes
  const top = [...mes.top_productos].sort((a, b) => b.utilidad - a.utilidad).slice(0, 5), maxP = Math.max(0, ...top.map(x => +x.utilidad));
  const cust = {}; vm.forEach(v => { const n = v.customer || 'Cliente general'; cust[n] = (cust[n] || 0) + +v.total_usd; });
  const topC = Object.entries(cust).sort((a, b) => b[1] - a[1]).slice(0, 5), maxC = Math.max(0, ...topC.map(x => x[1]));
  // inventario sin movimiento en 30 días (dinero detenido)
  const soldSet = new Set(sold.map(x => x.product_id)), slow = stock.filter(x => +x.stock > 0 && !soldSet.has(x.product_id)), slowV = slow.reduce((a, x) => a + +x.valor_usd, 0);
  const gastoTop = mes.gastos_por_tipo.slice(0, 4), maxG = Math.max(0, ...gastoTop.map(x => +x.total));

  $('#view').innerHTML = `<p class="mut" style="margin:0 0 .6rem">${esc(set.business_name || 'Mi negocio')} | ${dmy(hoy)}</p>
  <div class="hero"><span>Ganancia neta del mes</span><b class="${U1 < 0 ? 'neg2' : ''}">${U(U1)}</b><small>${S.rate ? fmt(U1 * S.rate) + ' Bs | ' : ''}${dtxt(U1, ut(ant), 'vs el mismo período del mes pasado') || 'después de costos y gastos'}</small>
    <div class="hero3"><div><span>Ventas</span><b>${U(mes.ingresos)}</b><small>${dtxt(mes.ingresos, ant.ingresos, 'vs mes pasado')}</small></div><div><span>Gastos</span><b>${U(mes.gastos)}</b></div><div><span>Margen neto</span><b>${fmt(mg, 0)}%</b></div></div></div>
  <div class="tiles">
    <button class="tile main" data-go="ventas">${ico('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>')}<span>Vender</span><small>Nueva venta</small></button>
    <button class="tile" data-go="compras">${ico('<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 016 0"/>')}<span>Comprar</span><small>Registrar compra</small></button>
    <button class="tile" data-go="produccion">${ico('<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2h12.4a1.5 1.5 0 001.3-2L14 9V3"/><path d="M7.5 15h9"/>')}<span>Producir</span><small>Fabricar productos</small></button>
    <button class="tile" data-go="inventario">${ico('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>')}<span>Inventario</span><small>Existencias y catálogo</small></button></div>
  ${alertHtml}
  <h2 class="sec">Hoy</h2>
  <div class="stats"><div class="stat"><span>Vendido hoy</span><b>${U(h.ingresos)}</b><span>${h.num_ventas} ${h.num_ventas === 1 ? 'venta' : 'ventas'}${S.rate ? ' | ' + fmt(h.ingresos * S.rate) + ' Bs' : ''}</span></div>
    <div class="stat ${gHoy < 0 ? 'bad' : ''}"><span>Ganancia bruta de hoy</span><b>${U(gHoy)}</b><span>ventas menos costo</span></div></div>
  <h2 class="sec">Tu dinero</h2>
  <div class="stats"><button class="stat" data-go="finanzas"><span>Disponible en cuentas</span><b>${U(caja)}</b><span>${S.rate ? fmt(caja * S.rate) + ' Bs' : ''}</span></button>
    <button class="stat warn" id="pPend"><span>Te deben (por cobrar)</span><b>${U(mes.por_cobrar)}</b><span>${S.rate ? fmt(mes.por_cobrar * S.rate) + ' Bs a la tasa de hoy' : ''}</span></button>
    <button class="stat" id="pPag"><span>Debes (por pagar)</span><b>${U(mes.por_pagar)}</b><span>${S.rate ? fmt(mes.por_pagar * S.rate) + ' Bs a la tasa de hoy' : ''}</span></button>
    <div class="stat"><span>Capital del negocio</span><b>${U(cap)}</b><span>cuentas + inventario + por cobrar - por pagar</span></div></div>
  <div class="card"><h2>Ventas de los últimos 14 días</h2><div class="dayb">${days.map(x => `<i style="height:${Math.max(3, (byDay[x] || 0) / (maxD || 1) * 100)}%" title="${dmy(x)}: ${fmt(byDay[x] || 0)} USD"></i>`).join('')}</div>
    <p class="mut">${dmy(days[0])} a ${dmy(days[13])}. Total: ${U(quin.ingresos)}</p></div>
  <div class="card"><h2>Lo que más ganancia te deja este mes</h2>${top.map(x => bar(x.name, +x.utilidad, maxP, U(+x.utilidad))).join('') || '<p class="mut">Aún no hay ventas este mes.</p>'}</div>
  <div class="card"><h2>Mejores clientes del mes</h2>${topC.map(([n, v]) => bar(n, v, maxC, U(v))).join('') || '<p class="mut">Aún no hay ventas este mes.</p>'}</div>
  <div class="card"><h2>Gastos del mes</h2>${gastoTop.map(x => bar(x.tipo + (x.fijo ? ' (fijo)' : ''), +x.total, maxG, U(+x.total))).join('') || '<p class="mut">Sin gastos registrados este mes.</p>'}</div>
  <h2 class="sec">Inventario</h2>
  <div class="stats"><button class="stat" data-go="inventario"><span>Valor del inventario</span><b>${U(inv)}</b><span>${S.rate ? fmt(inv * S.rate) + ' Bs' : ''}</span></button>
    <button class="stat bad" data-go="inventario"><span>Por reponer</span><b>${bajos}</b><span>en el mínimo o agotados</span></button>
    <button class="stat warn" data-go="inventario"><span>Sin vender en 30 días</span><b>${slow.length}</b><span>${U(slowV)} detenidos en inventario</span></button></div>`;
  $('#pPend').onclick = () => { VH.f = 'pend'; SUB.ven = 'historial'; go('ventas'); };
  $('#pPag').onclick = () => { CH.f = 'pend'; SUB.com = 'historial'; go('compras'); };
}
