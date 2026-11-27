// Panel del dueño: cómo va el negocio de un vistazo + asistente de apertura
const ico = (d) => `<svg class="ic" viewBox="0 0 24 24">${d}</svg>`;
async function viewInicio() {
  if (typeof OFF !== 'undefined' && OFF.isOffline() && !(OFF.mem.settings && OFF.mem.settings.length)) return OFF.renderOfflineHome();
  if (S.role === 'vendedor') {
    const hoy = caracasDate();
    const [set, todaySales] = await Promise.all([
      q(db.from('settings').select('business_name').eq('id', 1).single()).catch(() => ({})),
      q(db.from('sales').select('id').eq('sale_date', hoy).neq('status', 'anulada'))
    ]);
    const invFull = staffCan('inventario_full');
    $('#view').innerHTML = `
      <div class="card stack" style="border-left:5px solid var(--pri)">
        <div class="title-row">
          <div>
            <h1 class="pt">${esc(set.business_name || 'Mi negocio')}</h1>
            <small class="mut">Modo Empleado · ${dmy(hoy)}</small>
          </div>
          <span class="badge low">Operación</span>
        </div>
        <div class="rl" style="border:0;padding:.2rem 0"><span>Ventas registradas hoy</span><b>${todaySales.length}</b></div>
      </div>
      <div class="tiles">
        <button class="tile main" id="stSell">${ico('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>')}<span>Nueva venta</span><small>Facturar al cliente</small></button>
        <button class="tile" id="stPrices">${ico('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>')}<span>${invFull ? 'Inventario' : 'Consultar precios'}</span><small>${invFull ? 'Stock, productos y catálogo' : 'Stock y precios en USD/Bs'}</small></button>
        ${hasMod('production') && staffCan('produccion') ? `<button class="tile" data-go="produccion">${ico('<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2h12.4a1.5 1.5 0 001.3-2L14 9V3"/><path d="M7.5 15h9"/>')}<span>Producción</span><small>Fabricar y fórmulas</small></button>` : ''}
        ${hasMod('purchases') && staffCan('compras') ? `<button class="tile" data-go="compras">${ico('<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 016 0"/>')}<span>Compras</span><small>Proveedores y mercancía</small></button>` : ''}
        ${hasMod('quotes') ? `<button class="tile" id="stQuote">${ico('<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h6"/>')}<span>Cotizaciones</span><small>Presupuestos rápidos</small></button>` : ''}
        <button class="tile" id="stCobrar">${ico('<path d="M2 7h20v12H2z"/><path d="M2 11h20"/>')}<span>Por cobrar</span><small>Registrar abonos</small></button>
        ${(staffCan('finanzas_gastos') || staffCan('finanzas_cuentas')) ? `<button class="tile" data-go="finanzas">${ico('<path d="M3 6h18v12H3z"/><path d="M3 10h18"/>')}<span>${staffCan('finanzas_cuentas') ? 'Finanzas' : 'Caja y Gastos'}</span><small>${staffCan('finanzas_cuentas') ? 'Cuentas, cierre y gastos' : 'Cierre diario y gastos'}</small></button>` : ''}
        ${hasMod('marketing') && staffCan('marketing') ? `<button class="tile" data-go="marketing">${ico('<path d="M4 4h16v12H5.17L4 17.17z"/>')}<span>Marketing</span><small>Clientes y WhatsApp</small></button>` : ''}
        ${staffCan('reportes') ? `<button class="tile" data-go="contabilidad">${ico('<path d="M4 19V5M4 19h16M8 15v-4M13 15V8M18 15v-6"/>')}<span>Reportes</span><small>Resultados y ventas</small></button>` : ''}
      </div>
      <div class="card stack" style="margin-top:1rem">
        <p class="mut" style="margin:0">Configuración y funciones de administrador están protegidas con el PIN del dueño.</p>
        <button type="button" class="btn ghost" id="stUnlock">Desbloquear Modo Dueño (PIN)</button>
      </div>`;
    $('#stSell').onclick = () => { SUB.ven = 'nueva'; go('ventas'); };
    $('#stPrices').onclick = () => go('inventario');
    if ($('#stQuote')) $('#stQuote').onclick = () => { SUB.ven = 'cotizaciones'; go('ventas'); };
    $('#stCobrar').onclick = () => { SUB.ven = 'cobrar'; go('ventas'); };
    $('#stUnlock').onclick = () => promptUnlockOwner();
    return;
  }
  try {
  const hoy = caracasDate(), t = new Date(hoy + 'T12:00:00'), y = t.getFullYear(), m = t.getMonth(), dd = t.getDate();
  const m0 = dstr(new Date(y, m, 1)), p0 = dstr(new Date(y, m - 1, 1)), p1 = dstr(new Date(y, m - 1, Math.min(dd, new Date(y, m, 0).getDate())));
  const d14 = dstr(new Date(y, m, dd - 13)), d30 = dstr(new Date(y, m, dd - 30));
  const rp = (a, b) => q(db.rpc('reporte_resumen', {p_from: a, p_to: b}));
  const [h, mes, ant, quin, mesBs, accs, stockRaw, untrSet, alertHtml, vm, sold, set] = await Promise.all([
    rp(hoy, hoy), rp(m0, hoy), rp(p0, p1), rp(d14, hoy),
    typeof calcHistoricalBs === 'function' ? calcHistoricalBs(m0, hoy) : Promise.resolve({ok: false, netaBs: 0}),
    q(db.from('cuentas_saldo').select('balance,currency').eq('active', true)),
    q(db.from('stock_actual').select('product_id,name,stock,bajo_minimo,valor_usd,sells_regularly')),
    typeof getUntrackedIds === 'function' ? getUntrackedIds() : Promise.resolve(new Set()),
    alertasHtml(),
    q(db.from('ventas_resumen').select('customer,total_usd').gte('sale_date', m0).neq('status', 'anulada')),
    q(db.from('sale_items').select('product_id,sales!inner(sale_date,status)').gte('sales.sale_date', d30).neq('sales.status', 'anulada')),
    q(db.from('settings').select('*').eq('id', 1).single())
  ]);
  const stock = stockRaw.filter(x => !untrSet.has(Number(x.product_id)));
  const U = (n) => fmt(n) + ' USD', ut = (r) => r.ingresos - r.costo_ventas - r.gastos;
  const dl = (a, b) => b ? (a - b) / Math.abs(b) * 100 : null, dtxt = (a, b, l) => { const v = dl(a, b); return v === null ? '' : `${v >= 0 ? '+' : ''}${fmt(v, 0)}% ${l}`; };
  const cajaUsdReal = accs.filter(x => x.currency === 'USD').reduce((a, x) => a + Number(x.balance || 0), 0);
  const cajaVesReal = accs.filter(x => x.currency !== 'USD').reduce((a, x) => a + Number(x.balance || 0), 0);
  const caja = cajaUsdReal + (S.rate ? cajaVesReal / S.rate : 0), inv = stock.reduce((a, x) => a + +x.valor_usd, 0), cap = caja + inv + mes.por_cobrar - mes.por_pagar;
  const U1 = ut(mes), mg = mes.ingresos > 0 ? U1 / mes.ingresos * 100 : 0, gHoy = h.ingresos - h.costo_ventas, bajos = stock.filter(x => x.bajo_minimo).length;
  const bar = (lab, val, max, right) => `<div class="bl"><div class="rl" style="border:0;padding:.2rem 0"><span>${esc(lab)}</span><b>${right}</b></div><div class="bar w"><i style="width:${max > 0 ? Math.max(2, val / max * 100) : 0}%"></i></div></div>`;
  const byDay = Object.fromEntries(quin.por_dia.map(x => [x.dia, +x.total])), days = Array.from({length: 14}, (_, i) => dstr(new Date(y, m, dd - 13 + i))), maxD = Math.max(0, ...days.map(x => byDay[x] || 0));
  const top = [...mes.top_productos].sort((a, b) => b.utilidad - a.utilidad).slice(0, 5), maxP = Math.max(0, ...top.map(x => +x.utilidad));
  const cust = {}; vm.forEach(v => { const n = v.customer || 'Cliente general'; cust[n] = (cust[n] || 0) + +v.total_usd; });
  const topC = Object.entries(cust).sort((a, b) => b[1] - a[1]).slice(0, 5), maxC = Math.max(0, ...topC.map(x => x[1]));
  const soldSet = new Set(sold.map(x => x.product_id)), slow = stock.filter(x => +x.stock > 0 && x.sells_regularly && !soldSet.has(x.product_id)), slowV = slow.reduce((a, x) => a + +x.valor_usd, 0);
  const gastoTop = mes.gastos_por_tipo.slice(0, 4), maxG = Math.max(0, ...gastoTop.map(x => +x.total));

  if (typeof applyRulesObj === 'function') applyRulesObj(set);
  const showWelcome = set.apertura_completada === false;
  const welcomeCard = showWelcome ? `<div class="card" style="border-left:5px solid var(--pri)">
    <h2>¿Tu negocio ya estaba en marcha?</h2>
    <p class="mut" style="margin:.2rem 0 .8rem">Configura tus <b>saldos iniciales</b> para registrar el dinero que ya tienes en caja/bancos, tu inventario actual con sus costos, deudas pendientes y tu capital inicial sin alterar tus reportes de ventas.</p>
    <div class="row" style="margin:0">
      <button class="btn" data-go="apertura">Configurar saldos iniciales</button>
      <button class="btn ghost" id="pSkipAp">Empecé desde 0 (ocultar)</button>
    </div>
  </div>` : '';

  const goal = Number(set.monthly_sales_goal_usd || S.rules?.monthly_sales_goal_usd || 0);
  let goalCard = '';
  if (goal > 0) {
    const pct = Math.min(999, Math.round((mes.ingresos / goal) * 100));
    const rem = Math.max(0, goal - mes.ingresos);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysLeft = Math.max(1, daysInMonth - dd + 1);
    const perDay = rem / daysLeft;
    goalCard = `<div class="card goal-card">
      <div class="title-row">
        <span style="font-weight:800">Meta mensual de ventas</span>
        <span class="badge ${pct >= 100 ? 'ok' : pct >= 60 ? 'low' : ''}">${pct}%</span>
      </div>
      <div class="goal-bar"><i style="width:${Math.min(100, pct)}%" class="${pct >= 100 ? 'done' : ''}"></i></div>
      <div class="title-row" style="margin-top:.35rem">
        <small class="mut"><b>${U(mes.ingresos)}</b> de ${U(goal)}</small>
        <small class="mut">${rem > 0 ? `Faltan ${U(rem)} (≈ ${U(perDay)}/día)` : 'Meta alcanzada'}</small>
      </div>
    </div>`;
  }

  $('#view').innerHTML = `<div class="title-row" style="margin:0 0 .6rem">
    <p class="mut" style="margin:0">${esc(set.business_name || 'Mi negocio')} | ${dmy(hoy)}${set.fecha_apertura ? ' | Inicio: ' + dmy(set.fecha_apertura) : ''}</p>
    <button class="lnk" id="pWaSum" style="font-size:.85rem">Enviar resumen</button>
  </div>
  ${welcomeCard}
  <div class="hero"><span>Ganancia neta del mes</span><b class="${U1 < 0 ? 'neg2' : ''}">${U(U1)}</b>
    ${S.bimoneda !== false ? `<small>${mesBs.ok ? `Bs históricos: <b>${fmt(mesBs.netaBs)} Bs</b>` : (S.rate ? fmt(U1 * S.rate) + ' Bs hoy' : '')}${mesBs.ok && S.rate ? ` · Equiv. hoy: ${fmt(U1 * S.rate)} Bs` : ''}</small>` : ''}
    <small>${dtxt(U1, ut(ant), 'vs el mismo período del mes pasado') || 'después de costos y gastos'}</small>
    <div class="hero3"><div><span>Ventas</span><b>${U(mes.ingresos)}</b><small>${dtxt(mes.ingresos, ant.ingresos, 'vs mes pasado')}</small></div><div><span>Gastos</span><b>${U(mes.gastos)}</b></div><div><span>Margen neto</span><b>${fmt(mg, 0)}%</b></div></div></div>
  ${goalCard}
  <div class="tiles">
    <button class="tile main" data-go="ventas">${ico('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>')}<span>Vender</span><small>Nueva venta</small></button>
    ${hasMod('purchases') ? `<button class="tile" data-go="compras">${ico('<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 016 0"/>')}<span>Comprar</span><small>Registrar compra</small></button>` : ''}
    ${hasMod('production') ? `<button class="tile" data-go="produccion">${ico('<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 001.3 2h12.4a1.5 1.5 0 001.3-2L14 9V3"/><path d="M7.5 15h9"/>')}<span>Producir</span><small>Fabricar productos</small></button>` : ''}
    ${hasMod('inventory') ? `<button class="tile" data-go="inventario">${ico('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>')}<span>Inventario</span><small>Existencias y precios</small></button>` : ''}
    ${!hasMod('inventory') ? `<button class="tile" data-go="finanzas">${ico('<path d="M2 7h20v12H2z"/><path d="M2 11h20"/>')}<span>Finanzas</span><small>Cuentas y gastos</small></button>` : ''}
    ${!hasMod('purchases') && hasMod('marketing') ? `<button class="tile" data-go="marketing">${ico('<path d="M4 4h16v12H5.17L4 17.17z"/>')}<span>Marketing</span><small>Clientes y WhatsApp</small></button>` : ''}
  </div>
  ${alertHtml}
  <h2 class="sec">Hoy</h2>
  <div class="stats"><div class="stat"><span>Vendido hoy</span><b>${U(h.ingresos)}</b><span>${h.num_ventas} ${h.num_ventas === 1 ? 'venta' : 'ventas'}${S.rate ? ' | ' + fmt(h.ingresos * S.rate) + ' Bs' : ''}</span></div>
    <div class="stat ${gHoy < 0 ? 'bad' : ''}"><span>Ganancia bruta de hoy</span><b>${U(gHoy)}</b><span>ventas menos costo</span></div></div>
  <h2 class="sec">Tu dinero</h2>
  <div class="stats"><button class="stat" data-go="finanzas"><span>Disponible en cuentas</span><b>${U(caja)}</b><span>${S.bimoneda !== false ? `${fmt(cajaUsdReal)} USD + ${fmt(cajaVesReal)} Bs` : 'En cuentas activas'}</span></button>
    <button class="stat warn" id="pPend"><span>Te deben (por cobrar)</span><b>${U(mes.por_cobrar)}</b><span>${S.rate ? fmt(mes.por_cobrar * S.rate) + ' Bs a la tasa de hoy' : ''}</span></button>
    ${hasMod('purchases') ? `<button class="stat" id="pPag"><span>Debes (por pagar)</span><b>${U(mes.por_pagar)}</b><span>${S.rate ? fmt(mes.por_pagar * S.rate) + ' Bs a la tasa de hoy' : ''}</span></button>` : ''}
    <button class="stat" data-go="apertura"><span>Capital del negocio</span><b>${U(cap)}</b><span>${Number(set.capital_inicial_usd || 0) > 0 ? 'Inicial: ' + U(set.capital_inicial_usd) + ' | ' : ''}Toca para editar saldos iniciales</span></button></div>
  <div class="card"><h2>Ventas de los últimos 14 días</h2><div class="dayb">${days.map(x => `<i style="height:${Math.max(3, (byDay[x] || 0) / (maxD || 1) * 100)}%" title="${dmy(x)}: ${fmt(byDay[x] || 0)} USD"></i>`).join('')}</div>
    <p class="mut">${dmy(days[0])} a ${dmy(days[13])}. Total: ${U(quin.ingresos)}</p></div>
  <div class="card"><h2>Lo que más ganancia te deja este mes</h2>${top.map(x => bar(x.name, +x.utilidad, maxP, U(+x.utilidad))).join('') || '<p class="mut">Aún no hay ventas este mes.</p>'}</div>
  <div class="card"><h2>Mejores clientes del mes</h2>${topC.map(([n, v]) => bar(n, v, maxC, U(v))).join('') || '<p class="mut">Aún no hay ventas este mes.</p>'}</div>
  <div class="card"><h2>Gastos del mes</h2>${gastoTop.map(x => bar(x.tipo + (x.fijo ? ' (fijo)' : ''), +x.total, maxG, U(+x.total))).join('') || '<p class="mut">Sin gastos registrados este mes.</p>'}</div>
  ${hasMod('inventory') ? `<h2 class="sec">Inventario</h2>
  <div class="stats"><button class="stat" data-go="inventario"><span>Valor del inventario</span><b>${U(inv)}</b><span>${S.rate ? fmt(inv * S.rate) + ' Bs' : ''}</span></button>
    <button class="stat bad" data-go="inventario"><span>Por reponer</span><b>${bajos}</b><span>en el mínimo o agotados</span></button>
    <button class="stat warn" data-go="inventario"><span>Sin vender en 30 días</span><b>${slow.length}</b><span>${U(slowV)} detenidos (sin contar materia prima)</span></button></div>` : ''}`;
  if ($('#pWaSum') && typeof shareExecutiveSummaryWhatsApp === 'function') {
    $('#pWaSum').onclick = () => shareExecutiveSummaryWhatsApp({
      business: set.business_name || 'Mi negocio',
      phone: set.business_phone || '',
      hoy,
      hoyIngresos: h.ingresos,
      hoyVentas: h.num_ventas,
      hoyBruta: gHoy,
      mesIngresos: mes.ingresos,
      mesGastos: mes.gastos,
      mesNeta: U1,
      mesNetaBs: mesBs.ok ? mesBs.netaBs : null,
      caja,
      cajaUsdReal,
      cajaVesReal,
      porCobrar: mes.por_cobrar,
      porPagar: mes.por_pagar,
      inv,
      bajos,
      cap
    });
  }
  $('#pPend').onclick = () => { SUB.ven = 'cobrar'; go('ventas'); };
  if ($('#pPag')) $('#pPag').onclick = () => { SUB.com = 'pagar'; go('compras'); };
  if ($('#pSkipAp')) $('#pSkipAp').onclick = () => run(async () => {
    await q(db.from('settings').update({apertura_completada: true, fecha_apertura: hoy, updated_at: new Date().toISOString()}).eq('id', 1));
    toast('Configuración inicial omitida. Puedes abrirla cuando quieras desde Configuración > Saldos iniciales.');
    render();
  });

  } catch (e) {
    if (typeof OFF !== 'undefined' && OFF.isNetError(e)) return OFF.renderOfflineHome();
    throw e;
  }
}
