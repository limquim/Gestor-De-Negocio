// Panel de Saldos Iniciales / Arranque del Negocio
const AP = {
  fecha: '',
  accs: {},      // { [id]: balance }
  inv: {},       // { [pid]: { stock: '', cost: '', price: '' } }
  cxc: [],       // [{ cid: '', name: '', amount: '', due: '', note: '' }]
  cxp: [],       // [{ sid: '', name: '', amount: '', due: '', note: '' }]
  q: '',
  onlyFilled: false
};

async function viewApertura() {
  const [set, accs, types, prods, stock, parties] = await Promise.all([
    q(db.from('settings').select('*').eq('id', 1).single()),
    q(db.from('cuentas_saldo').select('*').eq('active', true).order('id')),
    q(db.from('account_types').select('id,name').eq('active', true).order('name')),
    q(db.from('products').select('id,sku,name,unit,avg_cost_usd,manual_cost_usd,sale_price_usd,is_service,product_categories(name)').eq('active', true).eq('is_service', false).order('name')),
    q(db.from('stock_actual').select('product_id,stock,avg_cost_usd')),
    q(db.from('parties').select('id,name,is_customer,is_supplier').eq('active', true).order('name'))
  ]);

  const stMap = Object.fromEntries(stock.map(s => [s.product_id, s]));
  const cats = await q(db.from('product_categories').select('id,name').eq('active', true).order('name'));
  const units = await q(db.from('units').select('symbol,name').eq('active', true).order('name'));

  if (!AP.fecha) AP.fecha = set.fecha_apertura || caracasDate();
  accs.forEach(a => {
    if (AP.accs[a.id] === undefined) AP.accs[a.id] = Number(a.balance || 0);
  });
  prods.forEach(p => {
    if (!AP.inv[p.id]) {
      const st = stMap[p.id];
      const curSt = st ? Number(st.stock || 0) : 0;
      const curCost = Number(st?.avg_cost_usd ?? p.avg_cost_usd ?? p.manual_cost_usd ?? 0);
      AP.inv[p.id] = {
        stock: curSt > 0 ? String(curSt) : '',
        cost: curCost > 0 ? String(curCost) : '',
        price: Number(p.sale_price_usd || 0) > 0 ? String(p.sale_price_usd) : ''
      };
    }
  });

  const custs = parties.filter(p => p.is_customer);
  const sups = parties.filter(p => p.is_supplier);

  const calcTotals = () => {
    const cajaUsd = accs.reduce((sum, a) => {
      const v = Number(AP.accs[a.id] || 0);
      return sum + (a.currency === 'USD' ? v : (S.rate ? v / S.rate : 0));
    }, 0);

    let invUsd = 0;
    let invCount = 0;
    prods.forEach(p => {
      const row = AP.inv[p.id];
      if (!row) return;
      const st = row.stock !== '' ? num(row.stock) : (stMap[p.id] ? Number(stMap[p.id].stock || 0) : 0);
      const cs = row.cost !== '' ? num(row.cost) : Number(p.avg_cost_usd || 0);
      if (st > 0) {
        invUsd += st * Math.max(cs, 0);
        if (row.stock !== '') invCount++;
      }
    });

    const cxcUsd = AP.cxc.reduce((s, r) => s + Math.max(num(r.amount) || 0, 0), 0);
    const cxpUsd = AP.cxp.reduce((s, r) => s + Math.max(num(r.amount) || 0, 0), 0);
    const capUsd = cajaUsd + invUsd + cxcUsd - cxpUsd;
    return {cajaUsd, invUsd, invCount, cxcUsd, cxpUsd, capUsd};
  };

  const paintSummary = () => {
    const t = calcTotals();
    $('#apCapHero').innerHTML = `
      <span>Capital inicial estimado del negocio</span>
      <b class="${t.capUsd < 0 ? 'neg2' : ''}">${fmt(t.capUsd)} USD</b>
      <small>${S.rate ? fmt(t.capUsd * S.rate) + ' Bs a la tasa de hoy | ' : ''}Caja + Inventario + Por cobrar - Por pagar</small>
      <div class="hero3">
        <div><span>Caja y bancos</span><b>${fmt(t.cajaUsd)} USD</b></div>
        <div><span>Inventario</span><b>${fmt(t.invUsd)} USD</b></div>
        <div><span>CxC - CxP</span><b>${fmt(t.cxcUsd - t.cxpUsd)} USD</b></div>
      </div>`;
    $('#apFootSum').innerHTML = `
      <div class="rl"><span>Dinero disponible en caja/bancos</span><b>${fmt(t.cajaUsd)} USD</b></div>
      <div class="rl"><span>Inventario inicial valorado</span><b>${fmt(t.invUsd)} USD</b></div>
      <div class="rl"><span>Cuentas por cobrar iniciales</span><b>+${fmt(t.cxcUsd)} USD</b></div>
      <div class="rl"><span>Cuentas por pagar iniciales</span><b>-${fmt(t.cxpUsd)} USD</b></div>
      <div class="rl tot ${t.capUsd >= 0 ? 'pos' : 'neg'}"><span>Capital inicial total</span><b>${fmt(t.capUsd)} USD${S.rate ? ' (' + fmt(t.capUsd * S.rate) + ' Bs)' : ''}</b></div>`;
  };

  $('#view').innerHTML = `
    <div class="card stack">
      <p class="mut" style="margin:0">Si tu negocio ya estaba funcionando antes de usar este sistema, registra aquí con cuánto dinero, mercancía y cuentas pendientes arrancas. Esto no se mezcla con tus ventas ni compras del mes.</p>
      <label>Fecha de arranque en el sistema<input type="date" id="apFecha" value="${esc(AP.fecha)}"></label>
    </div>

    <div class="hero" id="apCapHero"></div>

    <div class="card stack">
      <div class="title-row"><h2>1. Dinero en caja y bancos</h2><button type="button" class="btn ghost" id="apNewAcc">+ Nueva cuenta</button></div>
      <p class="mut" style="margin:0">Indica el saldo real con el que inicias en cada caja, cuenta bancaria o billetera digital.</p>
      <div class="list" id="apAccList">
        ${accs.map(a => `
          <div class="item" style="align-items:center;gap:.8rem">
            <span style="flex:1">
              <b>${esc(a.name)}</b>
              <small>${esc(a.type || 'Cuenta')} | Moneda: <b>${a.currency}</b></small>
              ${a.currency === 'VES' && S.rate ? `<small class="mut" id="apAccEq_${a.id}">≈ ${fmt((AP.accs[a.id] || 0) / S.rate)} USD</small>` : ''}
            </span>
            <label style="width:9.5rem;margin:0">Saldo (${a.currency})
              <input data-acc="${a.id}" type="number" step="0.01" value="${AP.accs[a.id] ?? 0}">
            </label>
          </div>`).join('') || '<p class="mut">No hay cuentas activas. Crea la primera con "+ Nueva cuenta".</p>'}
      </div>
    </div>

    <div class="card stack">
      <div class="title-row"><h2>2. Inventario inicial</h2><button type="button" class="btn ghost" id="apNewProd">+ Nuevo producto</button></div>
      <p class="mut" style="margin:0">Coloca la existencia física actual y el costo unitario en USD de tus productos. También puedes <button type="button" class="lnk" id="apGoImp" style="padding:0">importarlos desde Excel/CSV</button>.</p>
      <div class="toolbar">
        <input id="apProdQ" type="search" placeholder="Buscar producto o código" value="${esc(AP.q)}">
        <label class="chk"><input type="checkbox" id="apOnly" ${AP.onlyFilled ? 'checked' : ''}> Solo con cantidad cargada</label>
      </div>
      <div class="list" id="apProdList"></div>
    </div>

    <div class="card stack">
      <div class="title-row"><h2>3. Clientes que te deben (Por cobrar)</h2><button type="button" class="btn ghost" id="apAddCxc">+ Agregar deuda</button></div>
      <p class="mut" style="margin:0">Opcional: saldos pendientes que tus clientes ya te debían antes de comenzar aquí.</p>
      <div class="stack" id="apCxcList"></div>
    </div>

    <div class="card stack">
      <div class="title-row"><h2>4. Deudas con proveedores (Por pagar)</h2><button type="button" class="btn ghost" id="apAddCxp">+ Agregar deuda</button></div>
      <p class="mut" style="margin:0">Opcional: facturas o saldos pendientes que debes a tus proveedores al iniciar.</p>
      <div class="stack" id="apCxpList"></div>
    </div>

    <div class="card stack">
      <h2>Resumen de apertura</h2>
      <div id="apFootSum"></div>
      <div class="row">
        <button class="btn" id="apSave">Guardar saldos iniciales</button>
        <button class="btn ghost" data-go="inicio">Volver al inicio</button>
      </div>
    </div>`;

  const drawProds = () => {
    const t = AP.q.toLowerCase();
    const list = prods.filter(p => {
      const r = AP.inv[p.id] || {};
      if (AP.onlyFilled && !(num(r.stock) > 0)) return false;
      return !t || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(t);
    });
    $('#apProdList').innerHTML = list.map(p => {
      const r = AP.inv[p.id] || {stock: '', cost: '', price: ''};
      const st = num(r.stock) || 0, cs = num(r.cost) || 0;
      return `<div class="item" style="flex-direction:column;align-items:stretch;gap:.5rem" data-pid="${p.id}">
        <div class="row0" style="justify-content:space-between">
          <span><b>${esc(p.name)}</b> <small class="mut">${esc(p.sku || '')} | ${esc(p.product_categories?.name || 'Sin categoría')} (${esc(p.unit)})</small></span>
          <small class="pos" id="apSub_${p.id}">${st > 0 ? 'Total: ' + fmt(st * cs) + ' USD' : ''}</small>
        </div>
        <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:.5rem">
          <label style="margin:0">Stock inicial<input data-pf="stock" data-pid="${p.id}" type="number" step="0.001" min="0" placeholder="0" value="${esc(r.stock)}"></label>
          <label style="margin:0">Costo USD<input data-pf="cost" data-pid="${p.id}" type="number" step="0.0001" min="0" placeholder="0.00" value="${esc(r.cost)}"></label>
          <label style="margin:0">Precio venta USD<input data-pf="price" data-pid="${p.id}" type="number" step="0.0001" min="0" placeholder="0.00" value="${esc(r.price)}"></label>
        </div>
      </div>`;
    }).join('') || '<p class="mut">No hay productos con ese filtro. Pulsa "+ Nuevo producto" para crear uno.</p>';
  };

  const drawCxc = () => {
    $('#apCxcList').innerHTML = AP.cxc.map((r, i) => `
      <div class="card" style="margin:0;padding:.8rem;background:var(--bg)" data-cxc="${i}">
        <div class="grid">
          <label>Cliente existente<select data-cf="cid"><option value="">-- O escribe nombre nuevo --</option>${custs.map(c => `<option value="${c.id}" ${String(c.id) === String(r.cid) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>Nombre (si es nuevo)<input data-cf="name" placeholder="Ej: Juan Pérez" value="${esc(r.name)}"></label>
          <label>Monto que debe (USD)<input data-cf="amount" type="number" step="0.01" min="0.01" value="${esc(r.amount)}"></label>
          <label>Vencimiento (opcional)<input data-cf="due" type="date" value="${esc(r.due)}"></label>
        </div>
        <div class="row" style="margin-top:.5rem">
          <input data-cf="note" placeholder="Nota o referencia (opcional)" value="${esc(r.note)}">
          <button type="button" class="lnk bad" data-rmcxc="${i}">Quitar</button>
        </div>
      </div>`).join('') || '<p class="mut">Sin cuentas por cobrar iniciales.</p>';
  };

  const drawCxp = () => {
    $('#apCxpList').innerHTML = AP.cxp.map((r, i) => `
      <div class="card" style="margin:0;padding:.8rem;background:var(--bg)" data-cxp="${i}">
        <div class="grid">
          <label>Proveedor existente<select data-pf="sid"><option value="">-- O escribe nombre nuevo --</option>${sups.map(s => `<option value="${s.id}" ${String(s.id) === String(r.sid) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          <label>Nombre (si es nuevo)<input data-pf="name" placeholder="Ej: Distribuidora Central" value="${esc(r.name)}"></label>
          <label>Monto que debes (USD)<input data-pf="amount" type="number" step="0.01" min="0.01" value="${esc(r.amount)}"></label>
          <label>Vencimiento (opcional)<input data-pf="due" type="date" value="${esc(r.due)}"></label>
        </div>
        <div class="row" style="margin-top:.5rem">
          <input data-pf="note" placeholder="Nota o factura (opcional)" value="${esc(r.note)}">
          <button type="button" class="lnk bad" data-rmcxp="${i}">Quitar</button>
        </div>
      </div>`).join('') || '<p class="mut">Sin cuentas por pagar iniciales.</p>';
  };

  drawProds();
  drawCxc();
  drawCxp();
  paintSummary();

  $('#apFecha').onchange = (e) => { AP.fecha = e.target.value; };
  $('#apGoImp').onclick = () => { SUB.cfg = 'importar'; go('configuracion'); };

  $('#apAccList').addEventListener('input', (e) => {
    const id = e.target.dataset.acc;
    if (!id) return;
    AP.accs[id] = num(e.target.value) || 0;
    const eq = $('#apAccEq_' + id);
    if (eq && S.rate) eq.textContent = `≈ ${fmt(AP.accs[id] / S.rate)} USD`;
    paintSummary();
  });

  $('#apProdQ').oninput = (e) => { AP.q = e.target.value; drawProds(); };
  $('#apOnly').onchange = (e) => { AP.onlyFilled = e.target.checked; drawProds(); };

  $('#apProdList').addEventListener('input', (e) => {
    const pid = e.target.dataset.pid, f = e.target.dataset.pf;
    if (!pid || !f) return;
    if (!AP.inv[pid]) AP.inv[pid] = {stock: '', cost: '', price: ''};
    AP.inv[pid][f] = e.target.value;
    const st = num(AP.inv[pid].stock) || 0, cs = num(AP.inv[pid].cost) || 0;
    const sub = $('#apSub_' + pid);
    if (sub) sub.textContent = st > 0 ? 'Total: ' + fmt(st * cs) + ' USD' : '';
    paintSummary();
  });

  $('#apAddCxc').onclick = () => { AP.cxc.push({cid: '', name: '', amount: '', due: '', note: ''}); drawCxc(); };
  $('#apCxcList').addEventListener('input', (e) => {
    const box = e.target.closest('[data-cxc]');
    if (!box) return;
    const idx = +box.dataset.cxc, f = e.target.dataset.cf;
    if (f) { AP.cxc[idx][f] = e.target.value; paintSummary(); }
  });
  $('#apCxcList').addEventListener('click', (e) => {
    if (e.target.dataset.rmcxc !== undefined) { AP.cxc.splice(+e.target.dataset.rmcxc, 1); drawCxc(); paintSummary(); }
  });

  $('#apAddCxp').onclick = () => { AP.cxp.push({sid: '', name: '', amount: '', due: '', note: ''}); drawCxp(); };
  $('#apCxpList').addEventListener('input', (e) => {
    const box = e.target.closest('[data-cxp]');
    if (!box) return;
    const idx = +box.dataset.cxp, f = e.target.dataset.pf;
    if (f) { AP.cxp[idx][f] = e.target.value; paintSummary(); }
  });
  $('#apCxpList').addEventListener('click', (e) => {
    if (e.target.dataset.rmcxp !== undefined) { AP.cxp.splice(+e.target.dataset.rmcxp, 1); drawCxp(); paintSummary(); }
  });

  // Crear cuenta rápida desde apertura (con métodos de pago y tipos al vuelo)
  $('#apNewAcc').onclick = () => {
    openSheet('Nueva cuenta inicial', `<form id="apAccF" class="stack">
      <label>Nombre (ej: Caja Efectivo, Banco Venezuela, Zelle)<input name="aname" required></label>
      <div class="row0" style="align-items:end">
        <label style="flex:1">Tipo<select name="type_id">${types.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
        <button type="button" class="btn ghost" data-t-add="1" aria-label="Nuevo tipo de cuenta" style="flex:none">+</button>
      </div>
      <div class="grid">
        <label>Moneda<select name="cur"><option value="USD">Dólares (USD)</option><option value="VES">Bolívares (Bs)</option></select></label>
        <label>Saldo inicial<input name="open" type="number" step="0.01" value="0" required></label>
      </div>
      ${renderMethodsField(['efectivo'])}
      <label>Datos para recibir pagos (opcional)<textarea name="pdet" rows="2" placeholder="Ej: Pago Móvil, correo Zelle, Binance ID..."></textarea></label>
      <button class="btn" type="submit">Agregar cuenta</button>
    </form>`);
    const f = $('#apAccF');
    bindQuickAccountHelpers(f);
    f.onsubmit = (e) => {
      e.preventDefault();
      const el = f.elements;
      const methods = [...f.querySelectorAll('[data-m-list] input[type="checkbox"]:checked')].map(c => c.name.slice(2));
      if (!methods.length) return toast('Elige al menos un método de pago', true);
      const baseRow = {
        name: el.aname.value.trim(),
        type_id: +el.type_id.value || null,
        currency: el.cur.value,
        opening_balance: num(el.open.value) || 0,
        methods,
        active: true
      };
      const det = el.pdet.value.trim() || null;
      run(async () => {
        let ins;
        try {
          ins = await q(db.from('accounts').insert({...baseRow, payment_details: det}).select('id,opening_balance').single());
        } catch (err) {
          if (/payment_details/i.test(err.message || '')) ins = await q(db.from('accounts').insert(baseRow).select('id,opening_balance').single());
          else throw err;
        }
        AP.accs[ins.id] = Number(ins.opening_balance || 0);
        closeSheet();
        toast('Cuenta agregada');
        render();
      });
    };
  };

  // Crear producto rápido con stock y costo inicial
  $('#apNewProd').onclick = () => {
    openSheet('Nuevo producto con stock inicial', `<form id="apProdF" class="stack">
      <label>Código (opcional)<input name="sku"></label>
      <label>Nombre del producto<input name="pname" required></label>
      <label>Categoría<select name="category_id">${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>Unidad<select name="unit">${units.map(u => `<option value="${u.symbol}" ${u.symbol === 'und' ? 'selected' : ''}>${esc(u.name)} (${u.symbol})</option>`).join('')}</select></label>
      <div class="grid">
        <label>Stock inicial<input name="stock" type="number" step="0.001" min="0" value="0" required></label>
        <label>Costo unitario (USD)<input name="cost" type="number" step="0.0001" min="0" value="0" required></label>
        <label>Precio de venta (USD)<input name="price" type="number" step="0.0001" min="0" value="0"></label>
      </div>
      <button class="btn" type="submit">Crear y agregar</button>
    </form>`);
    $('#apProdF').onsubmit = (e) => {
      e.preventDefault();
      const el = e.target.elements;
      run(async () => {
        const cost = num(el.cost.value) || 0, price = num(el.price.value) || 0, st = num(el.stock.value) || 0;
        const ins = await q(db.from('products').insert({
          sku: el.sku.value.trim() || null,
          name: el.pname.value.trim(),
          category_id: +el.category_id.value || null,
          unit: el.unit.value,
          manual_cost_usd: cost,
          sale_price_usd: price,
          is_service: false,
          active: true
        }).select('id').single());
        AP.inv[ins.id] = {stock: st > 0 ? String(st) : '', cost: cost > 0 ? String(cost) : '', price: price > 0 ? String(price) : ''};
        closeSheet();
        toast('Producto creado');
        render();
      });
    };
  };

  // Guardar todo el arranque
  $('#apSave').onclick = () => run(async () => {
    const t = calcTotals();
    if (!confirm(`Se guardarán tus saldos iniciales con un Capital Inicial estimado de ${fmt(t.capUsd)} USD. ¿Continuar?`)) return;

    const cuentasPayload = accs.map(a => ({
      id: a.id,
      currency: a.currency,
      opening_balance: Number(AP.accs[a.id] || 0)
    }));

    const invPayload = prods
      .filter(p => AP.inv[p.id] && (AP.inv[p.id].stock !== '' || AP.inv[p.id].cost !== '' || AP.inv[p.id].price !== ''))
      .map(p => ({
        product_id: p.id,
        stock: AP.inv[p.id].stock !== '' ? num(AP.inv[p.id].stock) : null,
        unit_cost_usd: AP.inv[p.id].cost !== '' ? num(AP.inv[p.id].cost) : null,
        sale_price_usd: AP.inv[p.id].price !== '' ? num(AP.inv[p.id].price) : null
      }));

    const cxcPayload = AP.cxc
      .filter(r => (num(r.amount) || 0) > 0)
      .map(r => ({
        customer_id: r.cid ? +r.cid : null,
        customer_name: r.name.trim(),
        amount_usd: num(r.amount),
        due_date: r.due || null,
        note: r.note.trim() || null
      }));

    const cxpPayload = AP.cxp
      .filter(r => (num(r.amount) || 0) > 0)
      .map(r => ({
        supplier_id: r.sid ? +r.sid : null,
        supplier_name: r.name.trim(),
        amount_usd: num(r.amount),
        due_date: r.due || null,
        note: r.note.trim() || null
      }));

    const res = await q(db.rpc('guardar_apertura_negocio', {
      p_fecha: AP.fecha || caracasDate(),
      p_cuentas: cuentasPayload,
      p_inventario: invPayload,
      p_por_cobrar: cxcPayload,
      p_por_pagar: cxpPayload
    }));

    AP.cxc = [];
    AP.cxp = [];
    toast(`Saldos iniciales guardados | Capital inicial: ${fmt(res.capital_inicial_usd)} USD`);
    go('inicio');
  });
}
