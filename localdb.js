// Motor Local-First v1 (Edición Emprendedores):
// Toda la base de datos vive en el dispositivo del emprendedor (IndexedDB).
// Cero dependencias de Supabase, IDs positivos limpios, vistas calculadas en vivo y respaldo JSON completo.

const LDB_BASE_TABLES = [
  'settings', 'exchange_rates', 'profiles', 'payment_methods', 'account_types',
  'accounts', 'expense_types', 'product_categories', 'units', 'taxes',
  'currencies', 'price_lists', 'message_templates', 'catalog_presets',
  'products', 'parties', 'employees', 'employee_advances',
  'recipes', 'recipe_items', 'production_orders', 'production_items',
  'quotes', 'quote_items', 'sales', 'sale_items', 'sale_returns', 'sale_return_items',
  'purchases', 'purchase_items', 'payments', 'expenses', 'recurring_expenses',
  'account_movements', 'inventory_movements', 'inventory_adjustments',
  'cash_closings', 'payroll_runs', 'payroll_items', 'audit_log'
];

const LDB_REL = {
  products: {product_categories: ['category_id', 'id'], taxes: ['tax_id', 'id']},
  payments: {accounts: ['account_id', 'id'], sales: ['sale_id', 'id'], purchases: ['purchase_id', 'id']},
  purchase_items: {products: ['product_id', 'id'], purchases: ['purchase_id', 'id']},
  purchases: {parties: ['supplier_id', 'id']},
  quote_items: {products: ['product_id', 'id'], quotes: ['quote_id', 'id']},
  quotes: {parties: ['customer_id', 'id']},
  sale_return_items: {products: ['product_id', 'id'], sale_returns: ['return_id', 'id']},
  sale_returns: {sales: ['sale_id', 'id']},
  account_movements: {accounts: ['account_id', 'id']},
  expenses: {expense_types: ['expense_type_id', 'id'], accounts: ['account_id', 'id']},
  recurring_expenses: {expense_types: ['expense_type_id', 'id'], accounts: ['account_id', 'id']},
  inventory_movements: {products: ['product_id', 'id']},
  employee_advances: {employees: ['employee_id', 'id']},
  payroll_items: {employees: ['employee_id', 'id'], payroll_runs: ['run_id', 'id']},
  payroll_runs: {accounts: ['account_id', 'id']},
  sale_items: {products: ['product_id', 'id'], sales: ['sale_id', 'id']},
  production_items: {products: ['product_id', 'id'], production_orders: ['production_id', 'id']},
  production_orders: {products: ['product_id', 'id']},
  recipes: {recipe_items: ['id', 'recipe_id', true]},
  sales: {parties: ['customer_id', 'id']}
};

const LDB = {
  dbPromise: null,
  readyPromise: null,
  mem: {},           // { [tableName]: Array<Object> }
  seqs: {},          // { [tableName]: lastPositiveId }
  meta: {rev: 0, updatedAt: null, lastBackupAt: null, lastDriveSyncAt: null, dirtySinceBackup: 0, deviceId: null},
  blobUrls: {},      // temporal map for storage.upload -> getPublicUrl
  installPrompt: null,
  DB_NAME: 'gestor_emprendedores_db_v1',

  r2(n) { return Math.round((Number(n) || 0) * 100) / 100; },
  r3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; },
  r4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; },

  todayStr() {
    if (typeof caracasDate === 'function') return caracasDate();
    return new Date().toISOString().slice(0, 10);
  },

  toUsdLocal(amt, cur, rateOverride) {
    const r = Number(rateOverride || (typeof S !== 'undefined' ? S.rate : 1) || 1) || 1;
    return cur === 'USD' ? Number(amt || 0) : Number(amt || 0) / r;
  },

  // ---------- IndexedDB ----------
  openDB() {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('tables')) idb.createObjectStore('tables');
          if (!idb.objectStoreNames.contains('kv')) idb.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return this.dbPromise;
  },

  async idbPut(store, val, key) {
    const idb = await this.openDB();
    if (!idb) return;
    try {
      await new Promise((res, rej) => {
        const tx = idb.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) {}
  },

  async idbGetAllWithKeys(store) {
    const idb = await this.openDB();
    if (!idb) return {};
    try {
      return await new Promise((res, rej) => {
        const out = {};
        const tx = idb.transaction(store, 'readonly');
        const req = tx.objectStore(store).openCursor();
        req.onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); } else res(out);
        };
        req.onerror = () => rej(req.error);
      });
    } catch (e) { return {}; }
  },

  ensureReady() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const [tables, kv] = await Promise.all([
        this.idbGetAllWithKeys('tables'),
        this.idbGetAllWithKeys('kv')
      ]);
      this.mem = {};
      LDB_BASE_TABLES.forEach(t => {
        this.mem[t] = Array.isArray(tables[t]) ? tables[t] : [];
      });
      this.seqs = kv?.seqs || {};
      this.meta = {
        rev: 0, updatedAt: null, lastBackupAt: null, lastDriveSyncAt: null, dirtySinceBackup: 0,
        deviceId: 'dev-' + Math.random().toString(36).slice(2, 10),
        ...(kv?.meta || {})
      };
      // Sincronizar secuencias con el ID máximo existente en cada tabla
      for (const t of LDB_BASE_TABLES) {
        const maxId = (this.mem[t] || []).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        if (maxId > (this.seqs[t] || 0)) this.seqs[t] = maxId;
      }
      await this.idbPut('kv', this.meta, 'meta');
    })();
    return this.readyPromise;
  },

  nextId(table) {
    const cur = Number(this.seqs[table] || 0) + 1;
    this.seqs[table] = cur;
    return cur;
  },

  async saveTable(name, rows, bumpRev = true) {
    this.mem[name] = Array.isArray(rows) ? rows : [];
    await this.idbPut('tables', this.mem[name], name);
    await this.idbPut('kv', this.seqs, 'seqs');
    if (bumpRev && name !== 'audit_log') {
      this.meta.rev = (Number(this.meta.rev) || 0) + 1;
      this.meta.updatedAt = new Date().toISOString();
      this.meta.dirtySinceBackup = (Number(this.meta.dirtySinceBackup) || 0) + 1;
      await this.idbPut('kv', this.meta, 'meta');
      if (typeof this.onDirty === 'function') this.onDirty();
    }
  },

  async addAudit(action, tableName, rowId, oldData = null, newData = null) {
    const logs = this.mem.audit_log || [];
    const user = this.mem.settings?.[0]?.owner_name || (typeof S !== 'undefined' && S.userName) || 'Dueño';
    logs.unshift({
      id: this.nextId('audit_log'),
      at: new Date().toISOString(),
      user_name: user,
      action,
      table_name: tableName,
      row_id: rowId,
      old_data: oldData,
      new_data: newData
    });
    if (logs.length > 400) logs.length = 400;
    await this.saveTable('audit_log', logs, false);
  },

  isInitialized() {
    return !!(this.mem.settings && this.mem.settings[0] && this.mem.settings[0].onboarding_done);
  },

  // ---------- Seed inicial limpio (para nuevos emprendedores o tras reiniciar todo) ----------
  async seedDefaults(opts = {}) {
    await this.ensureReady();
    const now = new Date().toISOString();
    const today = this.todayStr();
    const bimoneda = opts.bimoneda !== false;
    const baseCur = opts.baseCurrency || 'USD';
    const rate = bimoneda ? Math.max(1, Number(opts.rate || 0) || 40) : 1;
    const mods = opts.modules || {
      inventory: true, purchases: true, production: false, planning: false,
      quotes: true, marketing: true, payroll: false, catalog: true
    };
    const bizName = (opts.businessName || 'Mi negocio').trim();
    const ownerName = (opts.ownerName || 'Emprendedor').trim();
    const phone = (opts.phone || '').trim() || null;

    // Limpiar todas las tablas y secuencias
    for (const t of LDB_BASE_TABLES) { this.mem[t] = []; this.seqs[t] = 0; }

    this.mem.settings = [{
      id: 1,
      business_name: bizName,
      owner_name: ownerName,
      business_rif: null,
      business_phone: phone,
      business_email: null,
      business_address: null,
      rate_mode: bimoneda ? (opts.rateMode || 'auto') : 'manual',
      bimoneda,
      base_currency: baseCur,
      business_profile: opts.profile || 'tienda',
      modules_config: mods,
      enable_product_photos: true,
      enable_planning: !!mods.planning,
      enable_payroll: !!mods.payroll,
      cost_method: 'avg',
      ticket_style: 'moderno',
      ticket_color: '#0b7285',
      ticket_paper: '58mm',
      ticket_header: null,
      ticket_footer: '¡Gracias por tu compra!',
      ticket_show_logo: true,
      ticket_show_info: true,
      ticket_show_customer: true,
      ticket_show_payments: true,
      ticket_show_rate: bimoneda,
      ticket_show_bs: bimoneda,
      ticket_config: {currency_mode: bimoneda ? 'both' : 'usd'},
      apertura_completada: !opts.showApertura,
      fecha_apertura: today,
      capital_inicial_usd: 0,
      monthly_sales_goal_usd: 0,
      min_margin_percent: 30,
      default_credit_days: 7,
      default_doc_type: 'nota_entrega',
      max_discount_percent: 0,
      block_negative_stock: false,
      allow_seller_price_edit: true,
      onboarding_done: true,
      updated_at: now
    }];

    this.mem.profiles = [{
      id: 1, full_name: ownerName, role: 'admin', active: true, created_at: now
    }];

    this.mem.currencies = bimoneda
      ? [
          {id: 1, code: 'USD', name: 'Dólar estadounidense', symbol: '$', is_base: true, active: true},
          {id: 2, code: 'VES', name: 'Bolívar', symbol: 'Bs', is_base: false, active: true}
        ]
      : [{id: 1, code: baseCur, name: opts.baseCurrencyName || baseCur, symbol: opts.baseCurrencySymbol || '$', is_base: true, active: true}];

    this.mem.exchange_rates = [{
      id: 1, currency: 'USD', rate, rate_date: today, source: bimoneda ? (opts.rateSource || 'manual') : 'fixed', created_at: now
    }];

    this.mem.units = [
      {id: 1, name: 'Unidad', symbol: 'und', kind: 'unidad', factor_to_base: 1, active: true},
      {id: 2, name: 'Kilogramo', symbol: 'kg', kind: 'masa', factor_to_base: 1000, active: true},
      {id: 3, name: 'Gramo', symbol: 'g', kind: 'masa', factor_to_base: 1, active: true},
      {id: 4, name: 'Litro', symbol: 'L', kind: 'volumen', factor_to_base: 1000, active: true},
      {id: 5, name: 'Mililitro', symbol: 'ml', kind: 'volumen', factor_to_base: 1, active: true},
      {id: 6, name: 'Paquete', symbol: 'paq', kind: 'unidad', factor_to_base: 1, active: true}
    ];

    this.mem.taxes = [
      {id: 1, name: 'Exento', percent: 0, is_default: true, active: true},
      {id: 2, name: 'IVA 16%', percent: 16, is_default: false, active: true}
    ];

    this.mem.account_types = [
      {id: 1, name: 'Efectivo', active: true},
      {id: 2, name: 'Banco', active: true},
      {id: 3, name: 'Billetera digital', active: true}
    ];

    this.mem.payment_methods = [
      {id: 1, code: 'efectivo', name: 'Efectivo', active: true},
      {id: 2, code: 'pago_movil', name: 'Pago móvil', active: true},
      {id: 3, code: 'transferencia', name: 'Transferencia', active: true},
      {id: 4, code: 'zelle', name: 'Zelle', active: true},
      {id: 5, code: 'punto', name: 'Punto de venta', active: true},
      {id: 6, code: 'otro', name: 'Otro', active: true}
    ];

    this.mem.accounts = bimoneda
      ? [
          {id: 1, name: 'Caja USD', type_id: 1, currency: 'USD', opening_balance: 0, methods: ['efectivo'], is_default: true, payment_details: null, active: true},
          {id: 2, name: 'Banco / Pago Móvil (Bs)', type_id: 2, currency: 'VES', opening_balance: 0, methods: ['pago_movil', 'transferencia', 'punto'], is_default: false, payment_details: null, active: true},
          {id: 3, name: 'Zelle / Digital USD', type_id: 3, currency: 'USD', opening_balance: 0, methods: ['zelle', 'transferencia'], is_default: false, payment_details: null, active: true}
        ]
      : [
          {id: 1, name: 'Caja Efectivo', type_id: 1, currency: 'USD', opening_balance: 0, methods: ['efectivo'], is_default: true, payment_details: null, active: true},
          {id: 2, name: 'Cuenta Bancaria', type_id: 2, currency: 'USD', opening_balance: 0, methods: ['transferencia', 'punto'], is_default: false, payment_details: null, active: true}
        ];

    this.mem.expense_types = [
      {id: 1, name: 'Alquiler', is_fixed: true, in_sales_cost: false, active: true},
      {id: 2, name: 'Servicios (Luz / Internet / Agua)', is_fixed: true, in_sales_cost: false, active: true},
      {id: 3, name: 'Transporte y envíos', is_fixed: false, in_sales_cost: false, active: true},
      {id: 4, name: 'Publicidad y marketing', is_fixed: false, in_sales_cost: false, active: true},
      {id: 5, name: 'Insumos y papelería', is_fixed: false, in_sales_cost: false, active: true},
      {id: 6, name: 'Pérdida de inventario', is_fixed: false, in_sales_cost: false, active: true},
      {id: 7, name: 'Delivery (costo de venta)', is_fixed: false, in_sales_cost: true, active: true}
    ];

    this.mem.product_categories = opts.profile === 'servicios'
      ? [
          {id: 1, name: 'Servicios principales', sells_regularly: true, active: true},
          {id: 2, name: 'Adicionales', sells_regularly: true, active: true}
        ]
      : opts.profile === 'fabricante'
        ? [
            {id: 1, name: 'Productos terminados', sells_regularly: true, active: true},
            {id: 2, name: 'Materia prima', sells_regularly: false, active: true},
            {id: 3, name: 'Envases y empaques', sells_regularly: false, active: true}
          ]
        : [
            {id: 1, name: 'General', sells_regularly: true, active: true},
            {id: 2, name: 'Destacados', sells_regularly: true, active: true}
          ];

    this.mem.price_lists = [
      {id: 1, name: 'Mayorista', adjust_percent: -10, active: true}
    ];

    this.mem.message_templates = [
      {id: 1, name: 'Seguimiento / Reactivación', body: 'Hola {nombre}, ¡te saludamos desde {negocio}! Hace {dias} días de tu última visita. Tenemos novedades en {producto} para ti.', active: true},
      {id: 2, name: 'Recordatorio de cobro', body: 'Hola {nombre}, te saludamos de {negocio}. Te recordamos tu saldo pendiente de {saldo} USD ({saldo_bs} Bs).\n\n{datos_pago}\n\n¡Muchas gracias!', active: true},
      {id: 3, name: 'Promoción clientes VIP', body: '¡Hola {nombre}! Gracias por tu preferencia en {negocio}. Por ser cliente frecuente tienes atención especial esta semana en {producto}.', active: true}
    ];

    // Datos de ejemplo opcionales para probar la app en 10 segundos
    if (opts.loadDemo) {
      this.mem.parties = [
        {id: 1, name: 'María González (Ejemplo)', rif: 'V-18500123', phone: '04140000000', email: null, address: 'Centro', is_customer: true, is_supplier: false, price_list_id: null, active: true},
        {id: 2, name: 'Distribuidora Central (Ejemplo)', rif: 'J-40123456-0', phone: '04120000000', email: null, address: null, is_customer: false, is_supplier: true, price_list_id: null, active: true}
      ];
      if (opts.profile === 'servicios') {
        this.mem.products = [
          {id: 1, sku: 'SRV-01', name: 'Servicio estándar (Ejemplo)', category_id: 1, unit: 'und', manual_cost_usd: 2, avg_cost_usd: 2, auto_cost_usd: null, sale_price_usd: 10, min_stock: 0, is_service: true, track_inventory: false, tax_id: 1, image_url: null, active: true},
          {id: 2, sku: 'SRV-02', name: 'Servicio premium (Ejemplo)', category_id: 1, unit: 'und', manual_cost_usd: 5, avg_cost_usd: 5, auto_cost_usd: null, sale_price_usd: 20, min_stock: 0, is_service: true, track_inventory: false, tax_id: 1, image_url: null, active: true}
        ];
      } else {
        this.mem.products = [
          {id: 1, sku: 'PRD-01', name: 'Producto estrella 1 (Ejemplo)', category_id: 1, unit: 'und', manual_cost_usd: 3, avg_cost_usd: 3, auto_cost_usd: 3, last_cost_usd: 3, sale_price_usd: 5, min_stock: 5, is_service: false, track_inventory: true, tax_id: 1, image_url: null, active: true},
          {id: 2, sku: 'PRD-02', name: 'Producto estrella 2 (Ejemplo)', category_id: 1, unit: 'und', manual_cost_usd: 6, avg_cost_usd: 6, auto_cost_usd: 6, last_cost_usd: 6, sale_price_usd: 10, min_stock: 3, is_service: false, track_inventory: true, tax_id: 1, image_url: null, active: true},
          {id: 3, sku: 'PRD-03', name: 'Producto económico (Ejemplo)', category_id: 1, unit: 'und', manual_cost_usd: 1.2, avg_cost_usd: 1.2, auto_cost_usd: 1.2, last_cost_usd: 1.2, sale_price_usd: 2.5, min_stock: 10, is_service: false, track_inventory: true, tax_id: 1, image_url: null, active: true}
        ];
        this.mem.inventory_movements = [
          {id: 1, product_id: 1, movement_type: 'ajuste', quantity: 20, unit_cost_usd: 3, ref_type: 'apertura', ref_id: null, notes: 'Stock de ejemplo', created_at: now},
          {id: 2, product_id: 2, movement_type: 'ajuste', quantity: 12, unit_cost_usd: 6, ref_type: 'apertura', ref_id: null, notes: 'Stock de ejemplo', created_at: now},
          {id: 3, product_id: 3, movement_type: 'ajuste', quantity: 30, unit_cost_usd: 1.2, ref_type: 'apertura', ref_id: null, notes: 'Stock de ejemplo', created_at: now}
        ];
      }
    }

    // Actualizar secuencias y persistir todo en IndexedDB
    for (const t of LDB_BASE_TABLES) {
      const maxId = (this.mem[t] || []).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      this.seqs[t] = maxId;
      await this.idbPut('tables', this.mem[t], t);
    }
    this.meta.rev = 1;
    this.meta.updatedAt = now;
    this.meta.dirtySinceBackup = 0;
    await this.idbPut('kv', this.seqs, 'seqs');
    await this.idbPut('kv', this.meta, 'meta');
  },

  // ---------- Vistas calculadas en vivo (siempre 100% consistentes) ----------
  computeView(name) {
    if (name === 'stock_actual') {
      const prods = this.mem.products || [];
      const cats = new Map((this.mem.product_categories || []).map(c => [Number(c.id), c]));
      const stockMap = {};
      (this.mem.inventory_movements || []).forEach(m => {
        const pid = Number(m.product_id);
        stockMap[pid] = (stockMap[pid] || 0) + Number(m.quantity || 0);
      });
      return prods
        .filter(p => p.active !== false && !p.is_service && p.track_inventory !== false)
        .map(p => {
          const cat = cats.get(Number(p.category_id));
          const st = this.r3(stockMap[Number(p.id)] || 0);
          const minSt = Number(p.min_stock || 0);
          const cost = Number(p.auto_cost_usd ?? p.avg_cost_usd ?? p.manual_cost_usd ?? 0);
          return {
            product_id: p.id,
            sku: p.sku || null,
            name: p.name,
            category_id: p.category_id || null,
            category: cat?.name || null,
            sells_regularly: cat ? cat.sells_regularly !== false : true,
            unit: p.unit || 'und',
            stock: st,
            min_stock: minSt,
            avg_cost_usd: cost,
            sale_price_usd: Number(p.sale_price_usd || 0),
            valor_usd: this.r2(Math.max(st, 0) * cost),
            bajo_minimo: minSt > 0 && st <= minSt
          };
        });
    }

    if (name === 'cuentas_saldo') {
      const accs = this.mem.accounts || [];
      const types = new Map((this.mem.account_types || []).map(t => [Number(t.id), t.name]));
      const mvMap = {};
      (this.mem.account_movements || []).forEach(m => {
        const aid = Number(m.account_id);
        mvMap[aid] = (mvMap[aid] || 0) + Number(m.amount || 0);
      });
      return accs.map(a => ({
        id: a.id,
        name: a.name,
        type_id: a.type_id || null,
        type: types.get(Number(a.type_id)) || 'Cuenta',
        currency: a.currency || 'USD',
        opening_balance: Number(a.opening_balance || 0),
        balance: this.r2(Number(a.opening_balance || 0) + (mvMap[Number(a.id)] || 0)),
        methods: a.methods || ['efectivo'],
        active: a.active !== false
      }));
    }

    if (name === 'ventas_resumen') {
      const sales = this.mem.sales || [];
      const parties = new Map((this.mem.parties || []).map(p => [Number(p.id), p]));
      const payMap = {};
      (this.mem.payments || []).forEach(p => {
        if (p.sale_id != null) payMap[Number(p.sale_id)] = (payMap[Number(p.sale_id)] || 0) + Number(p.amount_usd || 0);
      });
      (this.mem.sale_returns || []).filter(r => r.status === 'activa').forEach(r => {
        const cred = Math.max(0, Number(r.total_usd || 0) - Number(r.refund_usd || 0));
        payMap[Number(r.sale_id)] = (payMap[Number(r.sale_id)] || 0) + cred;
      });
      return sales.map(s => {
        const cust = s.customer_id != null ? parties.get(Number(s.customer_id)) : null;
        return {
          id: s.id,
          customer_id: s.customer_id ?? null,
          customer: cust?.name || 'Cliente general',
          sale_date: s.sale_date,
          doc_type: s.doc_type,
          exchange_rate: Number(s.exchange_rate || 1),
          total_usd: Number(s.total_usd || 0),
          paid_usd: this.r2(payMap[Number(s.id)] || 0),
          status: s.status,
          due_date: s.due_date || null
        };
      });
    }

    if (name === 'compras_resumen') {
      const purs = this.mem.purchases || [];
      const parties = new Map((this.mem.parties || []).map(p => [Number(p.id), p]));
      const payMap = {};
      (this.mem.payments || []).forEach(p => {
        if (p.purchase_id != null) payMap[Number(p.purchase_id)] = (payMap[Number(p.purchase_id)] || 0) + Number(p.amount_usd || 0);
      });
      return purs.map(b => {
        const sup = b.supplier_id != null ? parties.get(Number(b.supplier_id)) : null;
        return {
          id: b.id,
          supplier_id: b.supplier_id ?? null,
          supplier: sup?.name || 'Sin proveedor',
          purchase_date: b.purchase_date,
          exchange_rate: Number(b.exchange_rate || 1),
          total_usd: Number(b.total_usd || 0),
          paid_usd: this.r2(payMap[Number(b.id)] || 0),
          status: b.status,
          due_date: b.due_date || null
        };
      });
    }

    if (name === 'deudas_clientes') {
      const vr = this.computeView('ventas_resumen');
      const parties = new Map((this.mem.parties || []).map(p => [Number(p.id), p]));
      const map = {};
      vr.filter(v => v.status === 'pendiente').forEach(v => {
        const bal = this.r2(Number(v.total_usd || 0) - Number(v.paid_usd || 0));
        if (bal <= 0.01) return;
        const key = v.customer_id == null ? 'null' : String(v.customer_id);
        const p = v.customer_id != null ? parties.get(Number(v.customer_id)) : null;
        if (!map[key]) {
          map[key] = {customer_id: v.customer_id ?? null, customer: v.customer || p?.name || 'Cliente general', phone: p?.phone || null, num_ventas: 0, debt_usd: 0, desde: v.sale_date};
        }
        map[key].num_ventas++;
        map[key].debt_usd = this.r2(map[key].debt_usd + bal);
        if (v.sale_date && (!map[key].desde || v.sale_date < map[key].desde)) map[key].desde = v.sale_date;
      });
      return Object.values(map);
    }

    if (name === 'deudas_proveedores') {
      const cr = this.computeView('compras_resumen');
      const parties = new Map((this.mem.parties || []).map(p => [Number(p.id), p]));
      const map = {};
      cr.filter(c => c.status === 'registrada').forEach(c => {
        const bal = this.r2(Number(c.total_usd || 0) - Number(c.paid_usd || 0));
        if (bal <= 0.01) return;
        const key = c.supplier_id == null ? 'null' : String(c.supplier_id);
        const p = c.supplier_id != null ? parties.get(Number(c.supplier_id)) : null;
        if (!map[key]) {
          map[key] = {supplier_id: c.supplier_id ?? null, supplier: c.supplier || p?.name || 'Sin proveedor', phone: p?.phone || null, num_compras: 0, debt_usd: 0, desde: c.purchase_date};
        }
        map[key].num_compras++;
        map[key].debt_usd = this.r2(map[key].debt_usd + bal);
        if (c.purchase_date && (!map[key].desde || c.purchase_date < map[key].desde)) map[key].desde = c.purchase_date;
      });
      return Object.values(map);
    }

    if (name === 'clientes_resumen') {
      const parties = (this.mem.parties || []).filter(p => p.is_customer);
      const sales = (this.mem.sales || []).filter(s => s.status !== 'anulada' && s.customer_id != null);
      const saleById = new Map(sales.map(s => [Number(s.id), s]));
      const prodMap = new Map((this.mem.products || []).map(p => [Number(p.id), p.name]));
      const stats = {};
      sales.forEach(s => {
        const cid = Number(s.customer_id);
        const st = stats[cid] || (stats[cid] = {n: 0, tot: 0, last: null, prods: {}});
        st.n++;
        st.tot += Number(s.total_usd || 0);
        if (s.sale_date && (!st.last || s.sale_date > st.last)) st.last = s.sale_date;
      });
      (this.mem.sale_items || []).forEach(it => {
        const s = saleById.get(Number(it.sale_id));
        if (!s) return;
        const cid = Number(s.customer_id);
        const st = stats[cid];
        if (!st) return;
        const pn = prodMap.get(Number(it.product_id));
        if (pn) st.prods[pn] = (st.prods[pn] || 0) + Number(it.quantity || 0);
      });
      return parties.map(p => {
        const st = stats[Number(p.id)];
        let fav = null, maxQ = 0;
        if (st) {
          for (const [pn, qv] of Object.entries(st.prods)) {
            if (qv > maxQ) { maxQ = qv; fav = pn; }
          }
        }
        return {
          id: p.id,
          name: p.name,
          phone: p.phone || null,
          active: p.active !== false,
          num_ventas: st ? st.n : 0,
          total_usd: st ? this.r2(st.tot) : 0,
          ultima_compra: st ? st.last : null,
          producto_favorito: fav
        };
      });
    }

    return null;
  },

  getRows(table) {
    const viewRows = this.computeView(table);
    if (viewRows !== null) return viewRows;
    return this.mem[table] || [];
  },

  // ---------- Motor de consultas PostgREST ----------
  parseSelect(str) {
    const s = String(str || '*').trim();
    const parts = [];
    let cur = '', depth = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { if (cur.trim()) parts.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    const fields = [], rels = [];
    for (const p of parts) {
      const idx = p.indexOf('(');
      if (idx > 0 && p.endsWith(')')) {
        const head = p.slice(0, idx).trim();
        rels.push({name: head.split('!')[0].trim(), inner: head.includes('!inner'), sub: this.parseSelect(p.slice(idx + 1, -1).trim())});
      } else fields.push(p.trim());
    }
    return {fields, rels};
  },

  attachRelations(table, row, parsed) {
    const out = {...row};
    const relDefs = LDB_REL[table] || {};
    for (const r of parsed.rels) {
      const def = relDefs[r.name];
      if (!def) { out[r.name] = null; continue; }
      const [localCol, foreignCol, isMany] = def;
      const targetRows = this.getRows(r.name);
      const val = row[localCol];
      if (isMany) {
        const matches = val == null ? [] : targetRows.filter(x => String(x[foreignCol]) === String(val));
        out[r.name] = matches.map(m => this.attachRelations(r.name, m, r.sub));
      } else {
        const match = val == null ? null : targetRows.find(x => String(x[foreignCol]) === String(val)) || null;
        if (r.inner && !match) return null;
        out[r.name] = match ? this.attachRelations(r.name, match, r.sub) : null;
      }
    }
    return out;
  },

  getPathVal(obj, col) {
    if (!col.includes('.')) return obj?.[col];
    return col.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
  },

  cmpVal(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}T/.test(b)) {
      const ta = Date.parse(a), tb = Date.parse(b);
      if (!isNaN(ta) && !isNaN(tb)) return ta - tb;
    }
    const na = Number(a), nb = Number(b);
    if (typeof a !== 'boolean' && typeof b !== 'boolean' && a !== '' && b !== '' && !isNaN(na) && !isNaN(nb) && !/^\d{4}-\d{2}-\d{2}/.test(String(a))) {
      return na - nb;
    }
    return String(a).localeCompare(String(b), 'es');
  },

  matchFilter(row, f) {
    const v = this.getPathVal(row, f.col);
    switch (f.op) {
      case 'eq': return v != null && f.val != null ? String(v) === String(f.val) : v === f.val;
      case 'neq': return v != null && f.val != null ? String(v) !== String(f.val) : v !== f.val;
      case 'gt': return v != null && this.cmpVal(v, f.val) > 0;
      case 'gte': return v != null && this.cmpVal(v, f.val) >= 0;
      case 'lt': return v != null && this.cmpVal(v, f.val) < 0;
      case 'lte': return v != null && this.cmpVal(v, f.val) <= 0;
      case 'is': return f.val === null ? (v === null || v === undefined) : v === f.val;
      case 'in': return Array.isArray(f.val) && f.val.some(x => String(x) === String(v));
      case 'ilike': {
        const rx = new RegExp('^' + String(f.val || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
        return v != null && rx.test(String(v));
      }
      case 'like': {
        const rx = new RegExp('^' + String(f.val || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
        return v != null && rx.test(String(v));
      }
      default: return true;
    }
  },

  execSelect(spec) {
    const base = this.getRows(spec.table);
    const parsed = this.parseSelect(spec.selectCols || '*');
    let rows = [];
    for (const raw of base) {
      const hydrated = this.attachRelations(spec.table, raw, parsed);
      if (hydrated === null) continue;
      if (spec.filters.every(f => this.matchFilter(hydrated, f))) rows.push(hydrated);
    }
    if (spec.orders.length) {
      rows.sort((a, b) => {
        for (const o of spec.orders) {
          const d = this.cmpVal(this.getPathVal(a, o.col), this.getPathVal(b, o.col));
          if (d !== 0) return o.asc ? d : -d;
        }
        return 0;
      });
    }
    if (spec.range) rows = rows.slice(spec.range[0], spec.range[1] + 1);
    else if (spec.limit != null) rows = rows.slice(0, spec.limit);

    if (spec.single) {
      if (!rows.length) return {data: null, error: {code: 'PGRST116', message: 'Registro no encontrado'}};
      return {data: JSON.parse(JSON.stringify(rows[0])), error: null};
    }
    if (spec.maybeSingle) return {data: rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null, error: null};
    return {data: JSON.parse(JSON.stringify(rows)), error: null};
  },

  // ---------- Utilidades de inventario, costos y caja ----------
  async recalcularCostos(onlyPid = null) {
    const method = (this.mem.settings?.[0]?.cost_method) || 'avg';
    const prods = this.mem.products || [];
    const moves = [...(this.mem.inventory_movements || [])].sort((a, b) => Number(a.id) - Number(b.id));
    for (const p of prods) {
      if (onlyPid != null && Number(p.id) !== Number(onlyPid)) continue;
      const inMoves = moves.filter(m => Number(m.product_id) === Number(p.id) && Number(m.quantity) > 0 && m.unit_cost_usd != null && Number(m.unit_cost_usd) >= 0 && ['compra', 'produccion_entrada', 'ajuste'].includes(m.movement_type));
      if (!inMoves.length) {
        p.auto_cost_usd = null;
        p.avg_cost_usd = Number(p.manual_cost_usd || 0);
        continue;
      }
      let autoC = Number(p.manual_cost_usd || 0);
      const lastC = Number(inMoves[inMoves.length - 1].unit_cost_usd || 0);
      if (method === 'last') {
        autoC = lastC;
      } else if (method === 'max') {
        autoC = Math.max(...inMoves.map(m => Number(m.unit_cost_usd || 0)));
      } else {
        let sumQ = 0, sumV = 0;
        inMoves.forEach(m => { sumQ += Number(m.quantity); sumV += Number(m.quantity) * Number(m.unit_cost_usd || 0); });
        autoC = sumQ > 0 ? sumV / sumQ : lastC;
      }
      p.auto_cost_usd = this.r4(autoC);
      p.avg_cost_usd = this.r4(autoC);
      p.last_cost_usd = this.r4(lastC);
    }
    await this.saveTable('products', prods, false);
  },

  async addInvMove(productId, delta, unitCost, movementType, refType, refId, notes, recalcCost = false) {
    const pid = Number(productId);
    const prod = (this.mem.products || []).find(p => Number(p.id) === pid);
    if (prod && (prod.track_inventory === false || prod.is_service)) return;
    const moves = this.mem.inventory_movements || [];
    moves.push({
      id: this.nextId('inventory_movements'),
      product_id: pid,
      movement_type: movementType || 'ajuste',
      quantity: this.r3(delta),
      unit_cost_usd: unitCost != null ? this.r4(unitCost) : Number(prod?.avg_cost_usd ?? prod?.manual_cost_usd ?? 0),
      ref_type: refType || null,
      ref_id: refId ?? null,
      notes: notes || null,
      created_at: new Date().toISOString()
    });
    await this.saveTable('inventory_movements', moves);
    if (recalcCost) await this.recalcularCostos(pid);
  },

  async addAccMove(accountId, signedAmount, kind, note) {
    const aid = Number(accountId);
    if (!aid) return;
    const moves = this.mem.account_movements || [];
    moves.push({
      id: this.nextId('account_movements'),
      account_id: aid,
      kind: kind || 'ajuste',
      amount: this.r2(signedAmount),
      note: note || null,
      created_at: new Date().toISOString()
    });
    await this.saveTable('account_movements', moves);
  },

  // ---------- Escrituras directas (INSERT / UPDATE / DELETE) ----------
  async execWrite(spec) {
    const t = spec.table;
    const rows = this.mem[t] || (this.mem[t] = []);
    const now = new Date().toISOString();

    if (spec.op === 'insert' || spec.op === 'upsert') {
      const arr = Array.isArray(spec.payload) ? spec.payload : [spec.payload];
      const inserted = [];
      for (const raw of arr) {
        if (t === 'inventory_movements') {
          const pr = (this.mem.products || []).find(p => Number(p.id) === Number(raw.product_id));
          if (pr && (pr.track_inventory === false || pr.is_service)) continue;
        }
        const id = raw.id != null ? Number(raw.id) : this.nextId(t);
        if (id > (this.seqs[t] || 0)) this.seqs[t] = id;
        const rec = {active: true, created_at: now, ...raw, id};
        if (t === 'products') {
          rec.track_inventory = rec.is_service ? false : (rec.track_inventory !== false);
          rec.manual_cost_usd = Number(rec.manual_cost_usd ?? rec.avg_cost_usd ?? 0);
          rec.avg_cost_usd = Number(rec.avg_cost_usd ?? rec.manual_cost_usd ?? 0);
          rec.auto_cost_usd = rec.auto_cost_usd ?? null;
        }
        rows.push(rec);
        inserted.push(rec);
        if (t === 'inventory_movements' && Number(rec.quantity) > 0 && rec.unit_cost_usd != null) {
          await this.recalcularCostos(rec.product_id);
        }
      }
      await this.saveTable(t, rows);
      if (['products', 'accounts', 'employees', 'parties'].includes(t) && inserted[0]) {
        await this.addAudit('INSERT', t, inserted[0].id, null, inserted[0]);
      }
      const res = spec.single ? inserted[0] : spec.maybeSingle ? (inserted[0] || null) : inserted;
      return {data: res ? JSON.parse(JSON.stringify(res)) : res, error: null};
    }

    if (spec.op === 'update') {
      const updated = [];
      for (const r of rows) {
        if (spec.filters.every(f => this.matchFilter(r, f))) {
          const oldSnap = {...r};
          Object.assign(r, spec.payload);
          if (t === 'products' && r.auto_cost_usd == null && spec.payload.manual_cost_usd !== undefined) {
            r.avg_cost_usd = Number(r.manual_cost_usd || 0);
          }
          updated.push(r);
          if (['products', 'accounts', 'settings', 'employees'].includes(t)) {
            await this.addAudit('UPDATE', t, r.id, oldSnap, spec.payload);
          }
        }
      }
      await this.saveTable(t, rows);
      const res = spec.single ? (updated[0] || null) : spec.maybeSingle ? (updated[0] || null) : updated;
      return {data: res ? JSON.parse(JSON.stringify(res)) : res, error: null};
    }

    if (spec.op === 'delete') {
      const kept = [], deleted = [];
      for (const r of rows) {
        if (spec.filters.every(f => this.matchFilter(r, f))) deleted.push(r);
        else kept.push(r);
      }
      await this.saveTable(t, kept);
      return {data: deleted, error: null};
    }
    return {data: null, error: null};
  },

  // ---------- Reporte Resumen en vivo ----------
  computeReport(p_from, p_to) {
    const from = String(p_from || '1900-01-01').slice(0, 10);
    const to = String(p_to || '2999-12-31').slice(0, 10);
    const sales = (this.mem.sales || []).filter(s => s.status !== 'anulada' && s.sale_date >= from && s.sale_date <= to);
    const saleMap = new Map(sales.map(s => [Number(s.id), s]));
    const saleItems = (this.mem.sale_items || []).filter(i => saleMap.has(Number(i.sale_id)));
    const prodMap = new Map((this.mem.products || []).map(p => [Number(p.id), p]));

    const returns = (this.mem.sale_returns || []).filter(r => r.status === 'activa' && r.return_date >= from && r.return_date <= to);
    const retSet = new Set(returns.map(r => Number(r.id)));
    const retItems = (this.mem.sale_return_items || []).filter(ri => retSet.has(Number(ri.return_id)));

    let ingresos = 0, iva = 0, costo_ventas = 0;
    const byDay = {}, byProd = {};

    sales.forEach(s => {
      ingresos += Number(s.subtotal_usd || 0) - Number(s.discount_usd || 0);
      iva += Number(s.tax_usd || 0);
      byDay[s.sale_date] = (byDay[s.sale_date] || 0) + Number(s.total_usd || 0);
    });

    saleItems.forEach(i => {
      const s = saleMap.get(Number(i.sale_id));
      const ratio = Number(s?.subtotal_usd || 0) > 0 ? Math.max(0, 1 - Number(s.discount_usd || 0) / Number(s.subtotal_usd || 1)) : 1;
      const qn = Number(i.quantity || 0);
      const rev = qn * Number(i.unit_price_usd || 0) * ratio;
      const p = prodMap.get(Number(i.product_id));
      const ucost = Number(i.unit_cost_usd ?? p?.avg_cost_usd ?? 0);
      const cost = qn * ucost;
      costo_ventas += cost;
      const pname = p?.name || ('Producto #' + i.product_id);
      if (!byProd[pname]) byProd[pname] = {name: pname, ingreso: 0, utilidad: 0};
      byProd[pname].ingreso += rev;
      byProd[pname].utilidad += (rev - cost);
    });

    retItems.forEach(ri => {
      const qn = Number(ri.quantity || 0);
      ingresos -= qn * Number(ri.unit_price_usd || 0);
      if (ri.restock) costo_ventas -= qn * Number(ri.unit_cost_usd || 0);
    });

    const expTypes = new Map((this.mem.expense_types || []).map(t => [Number(t.id), t]));
    const expenses = (this.mem.expenses || []).filter(e => e.status !== 'anulado' && e.expense_date >= from && e.expense_date <= to);
    let gastos = 0;
    const gByType = {};
    expenses.forEach(e => {
      const et = expTypes.get(Number(e.expense_type_id));
      if (et?.in_sales_cost) return;
      const amt = Number(e.amount_usd || 0);
      gastos += amt;
      const label = et?.name || 'Otros gastos';
      if (!gByType[label]) gByType[label] = {tipo: label, fijo: !!et?.is_fixed, total: 0};
      gByType[label].total += amt;
    });

    const compras = (this.mem.purchases || [])
      .filter(p => p.status !== 'anulada' && p.purchase_date >= from && p.purchase_date <= to)
      .reduce((a, p) => a + Number(p.total_usd || 0), 0);

    const por_cobrar = this.computeView('ventas_resumen')
      .filter(v => v.status === 'pendiente')
      .reduce((a, v) => a + Math.max(0, Number(v.total_usd || 0) - Number(v.paid_usd || 0)), 0);

    const por_pagar = this.computeView('compras_resumen')
      .filter(c => c.status === 'registrada')
      .reduce((a, c) => a + Math.max(0, Number(c.total_usd || 0) - Number(c.paid_usd || 0)), 0);

    return {
      ingresos: this.r2(ingresos),
      costo_ventas: this.r2(costo_ventas),
      gastos: this.r2(gastos),
      iva: this.r2(iva),
      compras: this.r2(compras),
      num_ventas: sales.length,
      por_cobrar: this.r2(por_cobrar),
      por_pagar: this.r2(por_pagar),
      gastos_por_tipo: Object.values(gByType).map(x => ({...x, total: this.r2(x.total)})).sort((a, b) => b.total - a.total),
      top_productos: Object.values(byProd).map(x => ({...x, ingreso: this.r2(x.ingreso), utilidad: this.r2(x.utilidad)})).sort((a, b) => b.ingreso - a.ingreso).slice(0, 10),
      por_dia: Object.entries(byDay).map(([dia, total]) => ({dia, total: this.r2(total)})).sort((a, b) => a.dia.localeCompare(b.dia))
    };
  },

  // ---------- Ejecución completa de todas las RPCs ----------
  async execRpc(fnName, params) {
    const P = params || {};
    const now = new Date().toISOString();
    const today = this.todayStr();
    const rate = Number(P.p_rate || (typeof S !== 'undefined' ? S.rate : 1) || 1) || 1;
    const accById = (id) => (this.mem.accounts || []).find(a => Number(a.id) === Number(id));
    const prodById = (id) => (this.mem.products || []).find(p => Number(p.id) === Number(id));
    const taxes = this.mem.taxes || [];

    if (fnName === 'current_rate') {
      const rates = (this.mem.exchange_rates || []).filter(r => r.currency === (P.p_currency || 'USD'));
      if (!rates.length) return {data: 1, error: null};
      const sorted = [...rates].sort((a, b) => String(b.rate_date).localeCompare(String(a.rate_date)) || Number(b.id) - Number(a.id));
      return {data: Number(sorted[0].rate), error: null};
    }

    if (fnName === 'reporte_resumen') return {data: this.computeReport(P.p_from, P.p_to), error: null};
    if (fnName === 'recalcular_costos') { await this.recalcularCostos(); return {data: true, error: null}; }
    if (fnName === 'estado_sistema') return {data: [{paso: 'Local', item: 'Base de datos local IndexedDB', ok: true}], error: null};

    // ---- VENTAS ----
    if (fnName === 'registrar_venta') {
      const isEdit = P.p_id != null;
      const saleId = isEdit ? Number(P.p_id) : this.nextId('sales');
      const items = P.p_items || [], pays = P.p_payments || [], docType = P.p_doc_type || 'nota_entrega';

      if (isEdit) {
        await this.saveTable('inventory_movements', (this.mem.inventory_movements || []).filter(m => !(m.ref_type === 'sale' && Number(m.ref_id) === saleId)), false);
        const oldPays = (this.mem.payments || []).filter(p => Number(p.sale_id) === saleId);
        for (const op of oldPays) await this.addAccMove(op.account_id, -Number(op.amount), 'anulacion', 'Corrección venta #' + saleId);
        await this.saveTable('sale_items', (this.mem.sale_items || []).filter(i => Number(i.sale_id) !== saleId), false);
        await this.saveTable('payments', (this.mem.payments || []).filter(p => Number(p.sale_id) !== saleId), false);
      }

      let sub = 0, rawTax = 0;
      const newItems = [];
      for (const it of items) {
        const pr = prodById(it.product_id);
        const tx = taxes.find(x => Number(x.id) === Number(pr?.tax_id));
        const pct = docType === 'factura' ? Number(tx?.percent || 0) : 0;
        const ls = Number(it.quantity) * Number(it.unit_price_usd);
        sub += ls; rawTax += ls * pct / 100;
        const ucost = Number(pr?.avg_cost_usd ?? pr?.manual_cost_usd ?? 0);
        newItems.push({id: this.nextId('sale_items'), sale_id: saleId, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_price_usd: Number(it.unit_price_usd), unit_cost_usd: ucost, tax_percent: pct});
        await this.addInvMove(it.product_id, -Number(it.quantity), ucost, 'venta', 'sale', saleId, null);
      }
      const disc = Math.min(Number(P.p_discount_usd || 0), sub);
      const tax = sub > 0 ? this.r2(rawTax * (sub - disc) / sub) : 0;
      const total = this.r2(sub - disc + tax);

      let paidUsd = 0;
      const newPays = [];
      for (const py of pays) {
        const acc = accById(py.account_id), cur = acc?.currency || 'USD';
        const amt = this.r2(py.amount), usd = this.r2(this.toUsdLocal(amt, cur, rate));
        if (amt <= 0) continue;
        paidUsd += usd;
        newPays.push({id: this.nextId('payments'), sale_id: saleId, purchase_id: null, account_id: Number(py.account_id), method: py.method || 'efectivo', currency: cur, amount: amt, amount_usd: usd, exchange_rate: rate, reference: py.reference || null, paid_at: now, created_at: now});
        await this.addAccMove(py.account_id, amt, 'cobro', 'Venta #' + saleId);
      }
      const status = paidUsd >= total - 0.01 ? 'pagada' : 'pendiente';
      const oldSale = isEdit ? (this.mem.sales || []).find(s => Number(s.id) === saleId) : null;
      const saleRow = {
        id: saleId, customer_id: P.p_customer_id || null, sale_date: oldSale?.sale_date || today, doc_type: docType,
        exchange_rate: rate, subtotal_usd: this.r2(sub), discount_usd: this.r2(disc), tax_usd: tax, total_usd: total,
        status, due_date: P.p_due_date || null, notes: P.p_notes || null, created_at: oldSale?.created_at || now
      };
      const salesArr = (this.mem.sales || []).filter(s => Number(s.id) !== saleId);
      salesArr.unshift(saleRow);
      await this.saveTable('sales', salesArr);
      await this.saveTable('sale_items', [...(this.mem.sale_items || []), ...newItems], false);
      await this.saveTable('payments', [...(this.mem.payments || []), ...newPays], false);
      await this.addAudit(isEdit ? 'UPDATE' : 'INSERT', 'sales', saleId, oldSale, saleRow);
      return {data: saleId, error: null};
    }

    if (fnName === 'anular_venta') {
      const id = Number(P.p_id);
      const s = (this.mem.sales || []).find(x => Number(x.id) === id);
      if (s && s.status !== 'anulada') {
        s.status = 'anulada';
        await this.saveTable('sales', this.mem.sales);
        for (const it of (this.mem.sale_items || []).filter(x => Number(x.sale_id) === id)) {
          await this.addInvMove(it.product_id, Number(it.quantity), it.unit_cost_usd, 'devolucion', 'sale', id, 'Anulación venta #' + id);
        }
        for (const py of (this.mem.payments || []).filter(x => Number(x.sale_id) === id)) {
          await this.addAccMove(py.account_id, -Number(py.amount), 'anulacion', 'Anulación venta #' + id);
        }
        await this.addAudit('UPDATE', 'sales', id, {status: 'activa'}, {status: 'anulada'});
      }
      return {data: true, error: null};
    }

    if (fnName === 'registrar_cobro') {
      const sid = Number(P.p_sale_id), acc = accById(P.p_account_id), cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount), usd = this.r2(this.toUsdLocal(amt, cur, rate));
      const pays = this.mem.payments || [];
      pays.push({id: this.nextId('payments'), sale_id: sid, purchase_id: null, account_id: Number(P.p_account_id), method: P.p_method || 'efectivo', currency: cur, amount: amt, amount_usd: usd, exchange_rate: rate, reference: P.p_reference || null, paid_at: now, created_at: now});
      await this.saveTable('payments', pays);
      await this.addAccMove(P.p_account_id, amt, 'cobro', 'Cobro venta #' + sid);
      const vr = this.computeView('ventas_resumen').find(x => Number(x.id) === sid);
      const s = (this.mem.sales || []).find(x => Number(x.id) === sid);
      if (s && vr && vr.paid_usd >= vr.total_usd - 0.01) { s.status = 'pagada'; await this.saveTable('sales', this.mem.sales, false); }
      return {data: true, error: null};
    }

    if (fnName === 'cobrar_ventas') {
      const ids = (P.p_sale_ids || []).map(Number), acc = accById(P.p_account_id), cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount);
      let remUsd = this.r2(this.toUsdLocal(amt, cur, rate)), pagadas = 0, abonadas = 0, pendUsd = 0;
      const pays = this.mem.payments || [], vrList = this.computeView('ventas_resumen');
      for (const sid of ids) {
        const vr = vrList.find(x => Number(x.id) === sid);
        if (!vr || vr.status !== 'pendiente') continue;
        const bal = Math.max(0, Number(vr.total_usd) - Number(vr.paid_usd));
        const app = Math.min(bal, Math.max(0, remUsd));
        remUsd = this.r2(remUsd - app);
        if (app > 0.004) {
          const origAmt = cur === 'USD' ? this.r2(app) : this.r2(app * rate);
          pays.push({id: this.nextId('payments'), sale_id: sid, purchase_id: null, account_id: Number(P.p_account_id), method: P.p_method || 'efectivo', currency: cur, amount: origAmt, amount_usd: this.r2(app), exchange_rate: rate, reference: P.p_reference || null, paid_at: now, created_at: now});
          if (app >= bal - 0.01) {
            pagadas++;
            const s = (this.mem.sales || []).find(x => Number(x.id) === sid);
            if (s) s.status = 'pagada';
          } else abonadas++;
        }
        pendUsd += Math.max(0, bal - app);
      }
      await this.saveTable('payments', pays);
      await this.saveTable('sales', this.mem.sales || [], false);
      await this.addAccMove(P.p_account_id, amt, 'cobro', 'Cobro múltiple de deudas');
      return {data: {pagadas, abonadas, pendiente_usd: this.r2(pendUsd)}, error: null};
    }

    // ---- DEVOLUCIONES ----
    if (fnName === 'registrar_devolucion') {
      const retId = this.nextId('sale_returns'), sid = Number(P.p_sale_id);
      const s = (this.mem.sales || []).find(x => Number(x.id) === sid);
      const sItems = (this.mem.sale_items || []).filter(x => Number(x.sale_id) === sid);
      const ratio = Number(s?.subtotal_usd || 0) > 0 ? Math.max(0, 1 - Number(s.discount_usd || 0) / Number(s.subtotal_usd || 1)) : 1;
      let totalUsd = 0, refundUsd = 0;
      const rItems = [];
      for (const it of (P.p_items || [])) {
        const si = sItems.find(x => Number(x.product_id) === Number(it.product_id));
        const up = Number(si?.unit_price_usd || 0), uc = Number(si?.unit_cost_usd || 0), pct = Number(si?.tax_percent || 0);
        totalUsd += Number(it.quantity) * up * ratio * (1 + pct / 100);
        rItems.push({id: this.nextId('sale_return_items'), return_id: retId, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_price_usd: up, unit_cost_usd: uc, restock: !!it.restock});
        if (it.restock) await this.addInvMove(it.product_id, Number(it.quantity), uc, 'devolucion', 'sale', sid, 'Devolución #' + retId);
      }
      for (const rf of (P.p_refund || [])) {
        const acc = accById(rf.account_id), cur = acc?.currency || 'USD', amt = this.r2(rf.amount);
        refundUsd += this.toUsdLocal(amt, cur, rate);
        await this.addAccMove(rf.account_id, -amt, 'reembolso', 'Reembolso devolución #' + retId);
      }
      const rets = this.mem.sale_returns || [];
      rets.unshift({id: retId, sale_id: sid, return_date: today, reason: P.p_reason || null, notes: P.p_notes || null, total_usd: this.r2(totalUsd), refund_usd: this.r2(refundUsd), status: 'activa', created_at: now});
      await this.saveTable('sale_returns', rets);
      await this.saveTable('sale_return_items', [...(this.mem.sale_return_items || []), ...rItems], false);
      const vr = this.computeView('ventas_resumen').find(x => Number(x.id) === sid);
      if (s && vr && vr.paid_usd >= vr.total_usd - 0.01) { s.status = 'pagada'; await this.saveTable('sales', this.mem.sales, false); }
      return {data: retId, error: null};
    }

    if (fnName === 'anular_devolucion') {
      const id = Number(P.p_id), r = (this.mem.sale_returns || []).find(x => Number(x.id) === id);
      if (r && r.status === 'activa') {
        r.status = 'anulada';
        await this.saveTable('sale_returns', this.mem.sale_returns);
        for (const it of (this.mem.sale_return_items || []).filter(x => Number(x.return_id) === id && x.restock)) {
          await this.addInvMove(it.product_id, -Number(it.quantity), it.unit_cost_usd, 'ajuste', 'sale', r.sale_id, 'Anulación devolución #' + id);
        }
      }
      return {data: true, error: null};
    }

    // ---- COMPRAS ----
    if (fnName === 'registrar_compra') {
      const pid = this.nextId('purchases'), cur = P.p_currency || 'USD', items = P.p_items || [];
      let totalUsd = 0;
      const pItems = [];
      for (const it of items) {
        const uUsd = this.r4(this.toUsdLocal(it.unit_cost, cur, rate));
        totalUsd += Number(it.quantity) * uUsd;
        pItems.push({id: this.nextId('purchase_items'), purchase_id: pid, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_cost_usd: uUsd});
        await this.addInvMove(it.product_id, Number(it.quantity), uUsd, 'compra', 'purchase', pid, P.p_notes || null, true);
      }
      totalUsd = this.r2(totalUsd);
      const purs = this.mem.purchases || [];
      purs.unshift({id: pid, supplier_id: P.p_supplier_id || null, purchase_date: today, currency: cur, exchange_rate: rate, total_usd: totalUsd, status: 'registrada', due_date: null, notes: P.p_notes || null, created_at: now});
      await this.saveTable('purchases', purs);
      await this.saveTable('purchase_items', [...(this.mem.purchase_items || []), ...pItems], false);
      return {data: pid, error: null};
    }

    if (fnName === 'registrar_pago_compra') {
      const pid = Number(P.p_purchase_id), acc = accById(P.p_account_id), cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount), usd = this.r2(this.toUsdLocal(amt, cur, rate));
      const pays = this.mem.payments || [];
      pays.push({id: this.nextId('payments'), sale_id: null, purchase_id: pid, account_id: Number(P.p_account_id), method: P.p_method || 'efectivo', currency: cur, amount: amt, amount_usd: usd, exchange_rate: rate, reference: P.p_reference || null, paid_at: now, created_at: now});
      await this.saveTable('payments', pays);
      await this.addAccMove(P.p_account_id, -amt, 'pago', 'Pago compra #' + pid);
      const cr = this.computeView('compras_resumen').find(x => Number(x.id) === pid);
      const b = (this.mem.purchases || []).find(x => Number(x.id) === pid);
      if (b && cr && cr.paid_usd >= cr.total_usd - 0.01) { b.status = 'pagada'; await this.saveTable('purchases', this.mem.purchases, false); }
      return {data: true, error: null};
    }

    if (fnName === 'anular_compra') {
      const id = Number(P.p_id), b = (this.mem.purchases || []).find(x => Number(x.id) === id);
      if (b && b.status !== 'anulada') {
        b.status = 'anulada';
        if (P.p_reason) b.notes = b.notes ? `${b.notes} | Anulación: ${P.p_reason}` : `Anulación: ${P.p_reason}`;
        await this.saveTable('purchases', this.mem.purchases);
        for (const it of (this.mem.purchase_items || []).filter(x => Number(x.purchase_id) === id)) {
          await this.addInvMove(it.product_id, -Math.abs(Number(it.quantity)), it.unit_cost_usd, 'ajuste', 'purchase', id, 'Anulación compra #' + id);
        }
        for (const py of (this.mem.payments || []).filter(x => Number(x.purchase_id) === id)) {
          await this.addAccMove(py.account_id, Math.abs(Number(py.amount)), 'anulacion', 'Anulación compra #' + id);
        }
        await this.recalcularCostos();
        await this.addAudit('UPDATE', 'purchases', id, {status: 'activa'}, {status: 'anulada'});
      }
      return {data: {ok: true, id}, error: null};
    }

    if (fnName === 'pagar_compras') {
      const ids = (P.p_purchase_ids || []).map(Number), acc = accById(P.p_account_id), cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount);
      let remUsd = this.r2(this.toUsdLocal(amt, cur, rate)), pagadas = 0, abonadas = 0, pendUsd = 0;
      const pays = this.mem.payments || [], crList = this.computeView('compras_resumen');
      for (const pid of ids) {
        const cr = crList.find(x => Number(x.id) === pid);
        if (!cr || cr.status !== 'registrada') continue;
        const bal = Math.max(0, Number(cr.total_usd) - Number(cr.paid_usd));
        const app = Math.min(bal, Math.max(0, remUsd));
        remUsd = this.r2(remUsd - app);
        if (app > 0.004) {
          const origAmt = cur === 'USD' ? this.r2(app) : this.r2(app * rate);
          pays.push({id: this.nextId('payments'), sale_id: null, purchase_id: pid, account_id: Number(P.p_account_id), method: P.p_method || 'efectivo', currency: cur, amount: origAmt, amount_usd: this.r2(app), exchange_rate: rate, reference: P.p_reference || null, paid_at: now, created_at: now});
          if (app >= bal - 0.01) {
            pagadas++;
            const b = (this.mem.purchases || []).find(x => Number(x.id) === pid);
            if (b) b.status = 'pagada';
          } else abonadas++;
        }
        pendUsd += Math.max(0, bal - app);
      }
      await this.saveTable('payments', pays);
      await this.saveTable('purchases', this.mem.purchases || [], false);
      await this.addAccMove(P.p_account_id, -amt, 'pago', 'Pago múltiple a proveedor');
      return {data: {pagadas, abonadas, pendiente_usd: this.r2(pendUsd)}, error: null};
    }

    if (fnName === 'actualizar_compra') {
      const pid = Number(P.p_id), cur = P.p_currency || 'USD', items = P.p_items || [];
      const b = (this.mem.purchases || []).find(x => Number(x.id) === pid);
      if (!b) return {data: null, error: new Error('Compra no encontrada')};
      let totalUsd = Number(b.total_usd || 0);
      if (items.length > 0) {
        await this.saveTable('inventory_movements', (this.mem.inventory_movements || []).filter(m => !(m.ref_type === 'purchase' && Number(m.ref_id) === pid)), false);
        totalUsd = 0;
        const newItems = [];
        for (const it of items) {
          const uUsd = this.r4(this.toUsdLocal(it.unit_cost, cur, rate));
          totalUsd += Number(it.quantity) * uUsd;
          newItems.push({id: this.nextId('purchase_items'), purchase_id: pid, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_cost_usd: uUsd});
          await this.addInvMove(it.product_id, Number(it.quantity), uUsd, 'compra', 'purchase', pid, P.p_notes || null, false);
        }
        totalUsd = this.r2(totalUsd);
        await this.saveTable('purchase_items', [...(this.mem.purchase_items || []).filter(x => Number(x.purchase_id) !== pid), ...newItems], false);
      }
      if (P.p_replace_payments) {
        for (const op of (this.mem.payments || []).filter(p => Number(p.purchase_id) === pid)) {
          await this.addAccMove(op.account_id, Math.abs(Number(op.amount)), 'anulacion', 'Corrección compra #' + pid);
        }
        const kept = (this.mem.payments || []).filter(p => Number(p.purchase_id) !== pid);
        for (const py of (P.p_payments || [])) {
          const acc = accById(py.account_id), pcur = acc?.currency || 'USD', amt = this.r2(py.amount), usd = this.r2(this.toUsdLocal(amt, pcur, rate));
          if (amt <= 0) continue;
          kept.push({id: this.nextId('payments'), sale_id: null, purchase_id: pid, account_id: Number(py.account_id), method: py.method || 'efectivo', currency: pcur, amount: amt, amount_usd: usd, exchange_rate: rate, reference: py.reference || null, paid_at: now, created_at: now});
          await this.addAccMove(py.account_id, -amt, 'pago', 'Pago compra #' + pid);
        }
        await this.saveTable('payments', kept, false);
      }
      const paidUsd = this.r2((this.mem.payments || []).filter(p => Number(p.purchase_id) === pid).reduce((s, p) => s + Number(p.amount_usd || 0), 0));
      if (paidUsd > totalUsd + 0.02) return {data: null, error: new Error(`Los pagos (${paidUsd} USD) superan el nuevo total (${totalUsd} USD).`)};
      Object.assign(b, {
        supplier_id: P.p_supplier_id || null, purchase_date: P.p_purchase_date || b.purchase_date,
        currency: cur, exchange_rate: rate, total_usd: totalUsd, due_date: P.p_due_date || null, notes: P.p_notes || null,
        status: paidUsd >= totalUsd - 0.01 ? 'pagada' : 'registrada'
      });
      await this.saveTable('purchases', this.mem.purchases);
      await this.recalcularCostos();
      return {data: pid, error: null};
    }

    // ---- FINANZAS ----
    if (fnName === 'registrar_gasto') {
      const gid = this.nextId('expenses'), acc = accById(P.p_account_id), cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount), usd = this.r2(this.toUsdLocal(amt, cur, rate));
      const exps = this.mem.expenses || [];
      exps.unshift({id: gid, expense_type_id: P.p_type_id || null, description: P.p_desc || null, account_id: Number(P.p_account_id), currency: cur, amount: amt, amount_usd: usd, exchange_rate: rate, expense_date: P.p_date || today, status: 'registrado', created_at: now});
      await this.saveTable('expenses', exps);
      await this.addAccMove(P.p_account_id, -amt, 'gasto', P.p_desc || 'Gasto');
      return {data: gid, error: null};
    }

    if (fnName === 'anular_gasto') {
      const id = Number(P.p_id), g = (this.mem.expenses || []).find(x => Number(x.id) === id);
      if (g && g.status !== 'anulado') {
        g.status = 'anulado';
        await this.saveTable('expenses', this.mem.expenses);
        if (g.account_id) await this.addAccMove(g.account_id, Number(g.amount), 'anulacion', 'Anulación gasto #' + id);
      }
      return {data: true, error: null};
    }

    if (fnName === 'registrar_transferencia') {
      await this.addAccMove(P.p_from, -Number(P.p_out), 'transferencia', P.p_note || 'Transferencia enviada');
      await this.addAccMove(P.p_to, Number(P.p_in), 'transferencia', P.p_note || 'Transferencia recibida');
      return {data: true, error: null};
    }

    if (fnName === 'registrar_ajuste_cuenta') {
      const cs = this.computeView('cuentas_saldo').find(a => Number(a.id) === Number(P.p_account_id));
      const diff = this.r2(Number(P.p_new_balance) - Number(cs?.balance || 0));
      await this.addAccMove(P.p_account_id, diff, 'ajuste', P.p_note || 'Ajuste de saldo');
      return {data: true, error: null};
    }

    if (fnName === 'registrar_movimiento_capital') {
      const signed = P.p_kind === 'aporte' ? Math.abs(Number(P.p_amount)) : -Math.abs(Number(P.p_amount));
      await this.addAccMove(P.p_account_id, signed, P.p_kind, P.p_note || (P.p_kind === 'aporte' ? 'Aporte de capital' : 'Retiro del dueño'));
      return {data: {ok: true, kind: P.p_kind, amount: signed}, error: null};
    }

    if (fnName === 'registrar_cierre_caja') {
      const cid = this.nextId('cash_closings'), det = P.p_details || [];
      let tSys = 0, tCnt = 0;
      for (const d of det) {
        tSys += this.toUsdLocal(d.system_balance, d.currency || 'USD', rate);
        tCnt += this.toUsdLocal(d.counted_balance, d.currency || 'USD', rate);
        const diff = this.r2(Number(d.counted_balance) - Number(d.system_balance));
        if (P.p_apply_adjustments && Math.abs(diff) >= 0.01) {
          await this.addAccMove(d.account_id, diff, 'ajuste', 'Arqueo cierre de caja (' + (P.p_date || today) + ')');
        }
      }
      const cls = this.mem.cash_closings || [];
      cls.unshift({
        id: cid, closing_date: P.p_date || today, exchange_rate: rate,
        total_system_usd: this.r2(tSys), total_counted_usd: this.r2(tCnt), diff_usd: this.r2(tCnt - tSys),
        details: det, by_method: P.p_by_method || [], adjustments_applied: !!P.p_apply_adjustments,
        note: P.p_note || null, closed_by: this.mem.settings?.[0]?.owner_name || 'Dueño', created_at: now
      });
      await this.saveTable('cash_closings', cls);
      return {data: {id: cid, total_system_usd: this.r2(tSys), total_counted_usd: this.r2(tCnt), diff_usd: this.r2(tCnt - tSys)}, error: null};
    }

    if (fnName === 'crear_metodo_pago') {
      const name = String(P.p_name || '').trim();
      const code = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('metodo_' + Date.now());
      const pms = this.mem.payment_methods || [];
      let row = pms.find(m => m.code === code || String(m.name).toLowerCase() === name.toLowerCase());
      if (!row) { row = {id: this.nextId('payment_methods'), code, name, active: true}; pms.push(row); }
      else row.active = true;
      await this.saveTable('payment_methods', pms);
      return {data: row, error: null};
    }

    if (fnName === 'marcar_cuenta_predeterminada') {
      for (const a of (this.mem.accounts || [])) a.is_default = Number(a.id) === Number(P.p_account_id);
      await this.saveTable('accounts', this.mem.accounts || []);
      return {data: true, error: null};
    }

    // ---- AJUSTE MASIVO ----
    if (fnName === 'ajuste_masivo2') {
      const mode = P.p_mode || 'conteo', adjId = this.nextId('inventory_adjustments');
      const stList = this.computeView('stock_actual');
      let n = 0, inUsd = 0, outUsd = 0;
      const logItems = [];
      for (const it of (P.p_items || [])) {
        const st = stList.find(x => Number(x.product_id) === Number(it.product_id));
        const pr = prodById(it.product_id);
        const curSt = Number(st?.stock || 0), curCost = Number(st?.avg_cost_usd || pr?.avg_cost_usd || 0);
        const delta = mode === 'conteo' ? this.r3(Number(it.qty) - curSt) : mode === 'ingreso' ? this.r3(Math.abs(Number(it.qty))) : this.r3(-Math.abs(Number(it.qty)));
        if (Math.abs(delta) < 0.0004) continue;
        const uc = delta > 0 ? Number(it.unit_cost_usd ?? curCost) : curCost;
        await this.addInvMove(it.product_id, delta, uc, (delta < 0 && P.p_reason === 'merma') ? 'merma' : 'ajuste', 'ajuste_masivo', adjId, P.p_note || null, delta > 0 && it.unit_cost_usd != null);
        if (delta > 0) inUsd += delta * uc; else outUsd += Math.abs(delta) * uc;
        logItems.push({product_id: Number(it.product_id), name: pr?.name || st?.name || ('Producto #' + it.product_id), sku: pr?.sku || null, unit: pr?.unit || 'und', prev_stock: curSt, new_stock: this.r3(curSt + delta), delta, unit_cost_usd: this.r4(uc), total_usd: this.r2(Math.abs(delta) * uc)});
        n++;
      }
      if (n > 0) {
        const adjs = this.mem.inventory_adjustments || [];
        adjs.unshift({id: adjId, mode, reason: P.p_reason || 'otro', note: P.p_note || null, fin_effect: P.p_fin || 'none', account_id: P.p_account_id || null, expense_type_id: P.p_expense_type_id || null, items_count: n, in_usd: this.r2(inUsd), out_usd: this.r2(outUsd), items: logItems, created_by: this.mem.settings?.[0]?.owner_name || 'Dueño', created_at: now});
        await this.saveTable('inventory_adjustments', adjs);
      }
      if (P.p_fin === 'gasto' && outUsd > 0.004) {
        const exps = this.mem.expenses || [];
        exps.unshift({id: this.nextId('expenses'), expense_type_id: P.p_expense_type_id || null, description: P.p_note || 'Pérdida de inventario', account_id: null, currency: 'USD', amount: this.r2(outUsd), amount_usd: this.r2(outUsd), exchange_rate: rate, expense_date: today, status: 'registrado', created_at: now});
        await this.saveTable('expenses', exps);
      } else if (P.p_fin === 'pago' && inUsd > 0.004 && P.p_account_id) {
        const acc = accById(P.p_account_id);
        const amt = acc?.currency === 'USD' ? this.r2(inUsd) : this.r2(inUsd * rate);
        await this.addAccMove(P.p_account_id, -amt, 'pago', P.p_note || 'Pago ajuste ingreso');
      }
      return {data: {n, ingreso_usd: this.r2(inUsd), perdida_usd: this.r2(outUsd), adjustment_id: n > 0 ? adjId : null}, error: null};
    }

    // ---- COTIZACIONES ----
    if (fnName === 'guardar_cotizacion') {
      const isEdit = P.p_id != null, qid = isEdit ? Number(P.p_id) : this.nextId('quotes'), docType = P.p_doc_type || 'nota_entrega';
      let sub = 0, rawTax = 0;
      const qItems = (P.p_items || []).map(it => {
        const pr = prodById(it.product_id), tx = taxes.find(x => Number(x.id) === Number(pr?.tax_id));
        const pct = docType === 'factura' ? Number(tx?.percent || 0) : 0;
        const ls = Number(it.quantity) * Number(it.unit_price_usd);
        sub += ls; rawTax += ls * pct / 100;
        return {id: this.nextId('quote_items'), quote_id: qid, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_price_usd: Number(it.unit_price_usd)};
      });
      const disc = Math.min(Number(P.p_discount_usd || 0), sub), tax = sub > 0 ? this.r2(rawTax * (sub - disc) / sub) : 0, total = this.r2(sub - disc + tax);
      const qRow = {id: qid, customer_id: P.p_customer_id || null, quote_date: today, valid_until: P.p_valid_until || null, doc_type: docType, exchange_rate: rate, subtotal_usd: this.r2(sub), discount_usd: this.r2(disc), tax_usd: tax, total_usd: total, status: 'abierta', notes: P.p_notes || null, created_at: now};
      const qs = (this.mem.quotes || []).filter(x => Number(x.id) !== qid); qs.unshift(qRow);
      await this.saveTable('quotes', qs);
      await this.saveTable('quote_items', [...(this.mem.quote_items || []).filter(x => Number(x.quote_id) !== qid), ...qItems], false);
      return {data: qid, error: null};
    }

    // ---- PRODUCCIÓN ----
    if (fnName === 'guardar_formula') {
      const isEdit = P.p_id != null, rid = isEdit ? Number(P.p_id) : this.nextId('recipes');
      const recRow = {id: rid, product_id: Number(P.p_product_id), name: P.p_name, yield_qty: Number(P.p_yield || 1), notes: P.p_notes || null, active: true};
      const recs = (this.mem.recipes || []).filter(x => Number(x.id) !== rid); recs.push(recRow);
      await this.saveTable('recipes', recs);
      const rItems = (P.p_items || []).map(i => ({id: this.nextId('recipe_items'), recipe_id: rid, product_id: Number(i.product_id), quantity: Number(i.quantity)}));
      await this.saveTable('recipe_items', [...(this.mem.recipe_items || []).filter(x => Number(x.recipe_id) !== rid), ...rItems], false);
      return {data: rid, error: null};
    }

    if (fnName === 'crear_orden_produccion') {
      const oid = this.nextId('production_orders');
      const rec = (this.mem.recipes || []).find(r => Number(r.id) === Number(P.p_recipe_id));
      const prodId = Number(rec?.product_id || P.p_product_id || 0), qtyP = Number(P.p_qty || 1);
      let totCost = 0;
      const pItems = (P.p_items || []).map(i => {
        const pr = prodById(i.product_id), uc = Number(pr?.avg_cost_usd ?? pr?.manual_cost_usd ?? 0);
        totCost += Number(i.actual || 0) * uc;
        return {id: this.nextId('production_items'), production_id: oid, product_id: Number(i.product_id), planned_qty: Number(i.planned || 0), actual_qty: Number(i.actual || 0)};
      });
      const finish = !!P.p_finish;
      if (finish) {
        for (const it of pItems) {
          const pr = prodById(it.product_id);
          await this.addInvMove(it.product_id, -it.actual_qty, Number(pr?.avg_cost_usd || 0), 'produccion_consumo', 'production', oid, P.p_notes || null);
        }
        if (prodId) await this.addInvMove(prodId, qtyP, qtyP > 0 ? totCost / qtyP : 0, 'produccion_entrada', 'production', oid, P.p_notes || null, true);
      }
      const orders = this.mem.production_orders || [];
      orders.unshift({id: oid, recipe_id: P.p_recipe_id, product_id: prodId, qty_produced: qtyP, status: finish ? 'completada' : 'en_proceso', total_cost_usd: this.r2(totCost), notes: P.p_notes || null, produced_at: finish ? now : null, created_at: now});
      await this.saveTable('production_orders', orders);
      await this.saveTable('production_items', [...(this.mem.production_items || []), ...pItems], false);
      return {data: oid, error: null};
    }

    if (fnName === 'actualizar_orden_produccion') {
      const oid = Number(P.p_id), o = (this.mem.production_orders || []).find(x => Number(x.id) === oid);
      let tot = 0;
      const pItems = (P.p_items || []).map(i => {
        const pr = prodById(i.product_id);
        tot += Number(i.actual || 0) * Number(pr?.avg_cost_usd || 0);
        return {id: this.nextId('production_items'), production_id: oid, product_id: Number(i.product_id), planned_qty: Number(i.planned || 0), actual_qty: Number(i.actual || 0)};
      });
      if (o) {
        o.qty_produced = Number(P.p_qty); o.notes = P.p_notes || null; o.total_cost_usd = this.r2(tot);
        if (o.status === 'completada') {
          await this.saveTable('inventory_movements', (this.mem.inventory_movements || []).filter(m => !(m.ref_type === 'production' && Number(m.ref_id) === oid)), false);
          for (const it of pItems) await this.addInvMove(it.product_id, -it.actual_qty, Number(prodById(it.product_id)?.avg_cost_usd || 0), 'produccion_consumo', 'production', oid, o.notes);
          await this.addInvMove(o.product_id, o.qty_produced, o.qty_produced > 0 ? tot / o.qty_produced : 0, 'produccion_entrada', 'production', oid, o.notes, true);
        }
        await this.saveTable('production_orders', this.mem.production_orders);
      }
      await this.saveTable('production_items', [...(this.mem.production_items || []).filter(x => Number(x.production_id) !== oid), ...pItems], false);
      return {data: true, error: null};
    }

    if (fnName === 'finalizar_produccion') {
      const oid = Number(P.p_id), o = (this.mem.production_orders || []).find(x => Number(x.id) === oid);
      if (o && o.status === 'en_proceso') {
        const items = (this.mem.production_items || []).filter(x => Number(x.production_id) === oid);
        let tot = 0;
        for (const it of items) {
          const uc = Number(prodById(it.product_id)?.avg_cost_usd || 0);
          tot += Number(it.actual_qty) * uc;
          await this.addInvMove(it.product_id, -Number(it.actual_qty), uc, 'produccion_consumo', 'production', oid, o.notes);
        }
        await this.addInvMove(o.product_id, Number(o.qty_produced), o.qty_produced > 0 ? tot / o.qty_produced : 0, 'produccion_entrada', 'production', oid, o.notes, true);
        o.status = 'completada'; o.total_cost_usd = this.r2(tot); o.produced_at = now;
        await this.saveTable('production_orders', this.mem.production_orders);
      }
      return {data: true, error: null};
    }

    if (fnName === 'anular_produccion') {
      const oid = Number(P.p_id), o = (this.mem.production_orders || []).find(x => Number(x.id) === oid);
      if (o && o.status !== 'anulada') {
        if (o.status === 'completada') {
          for (const it of (this.mem.production_items || []).filter(x => Number(x.production_id) === oid)) {
            await this.addInvMove(it.product_id, Number(it.actual_qty), null, 'ajuste', 'production', oid, 'Anulación producción #' + oid);
          }
          await this.addInvMove(o.product_id, -Number(o.qty_produced), null, 'ajuste', 'production', oid, 'Anulación producción #' + oid);
        }
        o.status = 'anulada';
        await this.saveTable('production_orders', this.mem.production_orders);
      }
      return {data: true, error: null};
    }

    // ---- NÓMINA ----
    if (fnName === 'registrar_adelanto') {
      const aid = this.nextId('employee_advances'), acc = accById(P.p_account_id), usd = this.r2(P.p_amount_usd);
      const amt = acc?.currency === 'USD' ? usd : this.r2(usd * rate);
      const advs = this.mem.employee_advances || [];
      advs.unshift({id: aid, employee_id: Number(P.p_employee_id), advance_date: today, amount_usd: usd, note: P.p_note || null, discounted_run_id: null, created_at: now});
      await this.saveTable('employee_advances', advs);
      await this.addAccMove(P.p_account_id, -amt, 'adelanto', P.p_note || 'Adelanto de nómina');
      return {data: aid, error: null};
    }

    if (fnName === 'registrar_nomina') {
      const rid = this.nextId('payroll_runs'), acc = accById(P.p_account_id);
      let netUsd = 0;
      const pItems = [];
      for (const it of (P.p_items || [])) {
        let advSum = 0;
        for (const adId of (it.advance_ids || [])) {
          const a = (this.mem.employee_advances || []).find(x => Number(x.id) === Number(adId));
          if (a) { advSum += Number(a.amount_usd || 0); a.discounted_run_id = rid; }
        }
        const net = this.r2(Number(it.base || 0) + Number(it.bonus || 0) - Number(it.deduction || 0) - advSum);
        netUsd += net;
        pItems.push({id: this.nextId('payroll_items'), run_id: rid, employee_id: Number(it.employee_id), base_usd: Number(it.base || 0), bonus_usd: Number(it.bonus || 0), deduction_usd: Number(it.deduction || 0), advance_usd: this.r2(advSum), net_usd: net, note: it.note || null});
      }
      netUsd = this.r2(netUsd);
      const runs = this.mem.payroll_runs || [];
      runs.unshift({id: rid, period_start: P.p_start, period_end: P.p_end, pay_date: P.p_pay_date || today, pay_type: P.p_pay_type, account_id: Number(P.p_account_id), exchange_rate: rate, net_usd: netUsd, status: 'pagada', notes: P.p_notes || null, created_at: now});
      await this.saveTable('payroll_runs', runs);
      await this.saveTable('payroll_items', [...(this.mem.payroll_items || []), ...pItems], false);
      await this.saveTable('employee_advances', this.mem.employee_advances || [], false);
      const amt = acc?.currency === 'USD' ? netUsd : this.r2(netUsd * rate);
      await this.addAccMove(P.p_account_id, -amt, 'nomina', 'Nómina #' + rid);
      return {data: rid, error: null};
    }

    if (fnName === 'anular_nomina') {
      const rid = Number(P.p_id), r = (this.mem.payroll_runs || []).find(x => Number(x.id) === rid);
      if (r && r.status === 'pagada') {
        r.status = 'anulada';
        await this.saveTable('payroll_runs', this.mem.payroll_runs);
        for (const a of (this.mem.employee_advances || [])) if (Number(a.discounted_run_id) === rid) a.discounted_run_id = null;
        await this.saveTable('employee_advances', this.mem.employee_advances || [], false);
        const acc = accById(r.account_id);
        const amt = acc?.currency === 'USD' ? Number(r.net_usd) : this.r2(Number(r.net_usd) * Number(r.exchange_rate || rate));
        await this.addAccMove(r.account_id, amt, 'anulacion', 'Anulación nómina #' + rid);
      }
      return {data: true, error: null};
    }

    // ---- APERTURA DE NEGOCIO ----
    if (fnName === 'guardar_apertura_negocio') {
      const fecha = P.p_fecha || today;
      for (const c of (P.p_cuentas || [])) {
        const a = accById(c.id);
        if (a) a.opening_balance = this.r2(c.opening_balance);
      }
      await this.saveTable('accounts', this.mem.accounts || []);

      const curStock = this.computeView('stock_actual');
      for (const inv of (P.p_inventario || [])) {
        const st = curStock.find(s => Number(s.product_id) === Number(inv.product_id));
        if (inv.stock != null) {
          const delta = this.r3(Number(inv.stock) - Number(st?.stock || 0));
          if (Math.abs(delta) >= 0.0004) {
            await this.addInvMove(inv.product_id, delta, inv.unit_cost_usd, 'ajuste', 'apertura', null, 'Inventario inicial', inv.unit_cost_usd != null);
          }
        }
      }

      const findOrCreateParty = async (name, isCust, isSup) => {
        const nm = String(name || '').trim();
        if (!nm) return null;
        let p = (this.mem.parties || []).find(x => x.name.toLowerCase() === nm.toLowerCase());
        if (!p) {
          p = {id: this.nextId('parties'), name: nm, is_customer: isCust, is_supplier: isSup, active: true, created_at: now};
          this.mem.parties.push(p);
          await this.saveTable('parties', this.mem.parties, false);
        } else {
          if (isCust) p.is_customer = true;
          if (isSup) p.is_supplier = true;
        }
        return p.id;
      };

      for (const cxc of (P.p_cxc || [])) {
        const amt = this.r2(cxc.amount_usd); if (!(amt > 0)) continue;
        const cid = cxc.party_id || await findOrCreateParty(cxc.party_name, true, false);
        this.mem.sales.unshift({id: this.nextId('sales'), customer_id: cid, sale_date: fecha, doc_type: 'nota_entrega', exchange_rate: rate, subtotal_usd: amt, discount_usd: 0, tax_usd: 0, total_usd: amt, status: 'pendiente', due_date: cxc.due_date || null, notes: 'Saldo inicial por cobrar' + (cxc.note ? ': ' + cxc.note : ''), created_at: now});
      }
      for (const cxp of (P.p_cxp || [])) {
        const amt = this.r2(cxp.amount_usd); if (!(amt > 0)) continue;
        const sid = cxp.party_id || await findOrCreateParty(cxp.party_name, false, true);
        this.mem.purchases.unshift({id: this.nextId('purchases'), supplier_id: sid, purchase_date: fecha, currency: 'USD', exchange_rate: rate, total_usd: amt, status: 'registrada', due_date: cxp.due_date || null, notes: 'Saldo inicial por pagar' + (cxp.note ? ': ' + cxp.note : ''), created_at: now});
      }
      await this.saveTable('sales', this.mem.sales || [], false);
      await this.saveTable('purchases', this.mem.purchases || [], false);

      const cajaUsd = this.computeView('cuentas_saldo').filter(a => a.active).reduce((s, a) => s + this.toUsdLocal(a.balance, a.currency, rate), 0);
      const invUsd = this.computeView('stock_actual').reduce((s, x) => s + Number(x.valor_usd || 0), 0);
      const cxcUsd = this.computeView('ventas_resumen').filter(v => v.status === 'pendiente').reduce((s, v) => s + Math.max(0, v.total_usd - v.paid_usd), 0);
      const cxpUsd = this.computeView('compras_resumen').filter(c => c.status === 'registrada').reduce((s, c) => s + Math.max(0, c.total_usd - c.paid_usd), 0);
      const cap = this.r2(cajaUsd + invUsd + cxcUsd - cxpUsd);
      if (this.mem.settings?.[0]) {
        Object.assign(this.mem.settings[0], {apertura_completada: true, fecha_apertura: fecha, capital_inicial_usd: cap, updated_at: now});
        await this.saveTable('settings', this.mem.settings);
      }
      return {data: {capital_inicial_usd: cap, caja_usd: this.r2(cajaUsd), inv_usd: this.r2(invUsd), cxc_usd: this.r2(cxcUsd), cxp_usd: this.r2(cxpUsd)}, error: null};
    }

    // ---- REINICIAR SISTEMA ----
    if (fnName === 'reiniciar_sistema') {
      if (String(P.p_frase || '').trim() !== 'BORRAR TODO') return {data: null, error: new Error('Frase de confirmación incorrecta')};
      const movTables = ['sales', 'sale_items', 'sale_returns', 'sale_return_items', 'purchases', 'purchase_items', 'payments', 'expenses', 'account_movements', 'inventory_movements', 'inventory_adjustments', 'production_orders', 'production_items', 'quotes', 'quote_items', 'employee_advances', 'payroll_runs', 'payroll_items', 'cash_closings', 'audit_log'];
      for (const t of movTables) { this.mem[t] = []; this.seqs[t] = 0; await this.idbPut('tables', [], t); }
      (this.mem.accounts || []).forEach(a => { a.opening_balance = 0; });
      (this.mem.products || []).forEach(p => { p.auto_cost_usd = null; p.avg_cost_usd = Number(p.manual_cost_usd || 0); });
      (this.mem.recurring_expenses || []).forEach(r => { r.last_paid_ym = null; r.last_paid_at = null; });

      if (P.p_nivel === 'todo') {
        for (const t of ['products', 'recipes', 'recipe_items', 'parties', 'employees', 'catalog_presets', 'recurring_expenses']) {
          this.mem[t] = []; this.seqs[t] = 0; await this.idbPut('tables', [], t);
        }
        if (this.mem.settings?.[0]) {
          this.mem.settings[0].onboarding_done = false;
          this.mem.settings[0].apertura_completada = false;
          this.mem.settings[0].capital_inicial_usd = 0;
        }
      } else if (this.mem.settings?.[0]) {
        this.mem.settings[0].apertura_completada = false;
        this.mem.settings[0].capital_inicial_usd = 0;
      }
      await this.saveTable('accounts', this.mem.accounts || [], false);
      await this.saveTable('products', this.mem.products || [], false);
      await this.saveTable('recurring_expenses', this.mem.recurring_expenses || [], false);
      await this.saveTable('settings', this.mem.settings || []);
      return {data: true, error: null};
    }

    return {data: true, error: null};
  },

  // ---------- Exportación y Restauración completa (JSON / base para Google Drive) ----------
  async exportFullJson() {
    await this.ensureReady();
    const tablas = {};
    LDB_BASE_TABLES.forEach(t => { tablas[t] = this.mem[t] || []; });
    const nowIso = new Date().toISOString();
    this.meta.lastBackupAt = nowIso;
    this.meta.dirtySinceBackup = 0;
    await this.idbPut('kv', this.meta, 'meta');
    try { localStorage.setItem('gdn_last_backup_at', nowIso); } catch (e) {}
    return {
      format: 'gestor_emprendedor_v1',
      fecha: nowIso,
      rev: this.meta.rev || 1,
      deviceId: this.meta.deviceId,
      tablas
    };
  },

  async importFullJson(data) {
    await this.ensureReady();
    if (!data || typeof data !== 'object' || !data.tablas || typeof data.tablas !== 'object') {
      throw new Error('El archivo no es un respaldo válido de Gestor de Negocio');
    }
    if (!Array.isArray(data.tablas.settings) || !data.tablas.settings.length) {
      throw new Error('El respaldo no contiene la configuración del negocio');
    }
    for (const t of LDB_BASE_TABLES) {
      const arr = Array.isArray(data.tablas[t]) ? data.tablas[t] : [];
      this.mem[t] = arr;
      this.seqs[t] = arr.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      await this.idbPut('tables', arr, t);
    }
    if (this.mem.settings[0]) this.mem.settings[0].onboarding_done = true;
    await this.idbPut('tables', this.mem.settings, 'settings');
    this.meta.rev = Math.max(Number(this.meta.rev || 0) + 1, Number(data.rev || 1));
    this.meta.updatedAt = new Date().toISOString();
    this.meta.lastBackupAt = data.fecha || new Date().toISOString();
    this.meta.dirtySinceBackup = 0;
    await this.idbPut('kv', this.seqs, 'seqs');
    await this.idbPut('kv', this.meta, 'meta');
    return true;
  },

  // ---------- Cliente compatible con db.from() / db.rpc() / db.storage / db.auth ----------
  createClient() {
    const self = this;
    const buildQuery = (table) => {
      const spec = {table, op: 'select', selectCols: '*', payload: null, filters: [], orders: [], limit: null, range: null, single: false, maybeSingle: false};
      const execute = async () => {
        await self.ensureReady();
        if (spec.op === 'select') return self.execSelect(spec);
        return self.execWrite(spec);
      };
      const api = {
        select(cols = '*') { spec.selectCols = cols; return api; },
        insert(payload) { spec.op = 'insert'; spec.payload = payload; return api; },
        update(payload) { spec.op = 'update'; spec.payload = payload; return api; },
        delete() { spec.op = 'delete'; return api; },
        upsert(payload) { spec.op = 'upsert'; spec.payload = payload; return api; },
        order(col, opts = {}) { spec.orders.push({col, asc: opts.ascending !== false}); return api; },
        limit(n) { spec.limit = n; return api; },
        range(a, b) { spec.range = [a, b]; return api; },
        single() { spec.single = true; return api; },
        maybeSingle() { spec.maybeSingle = true; return api; },
        then(onFulfilled, onRejected) { return execute().then(onFulfilled, onRejected); },
        catch(onRejected) { return execute().catch(onRejected); },
        finally(onFinally) { return execute().finally(onFinally); }
      };
      ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'ilike', 'like'].forEach(op => {
        api[op] = (col, val) => { spec.filters.push({op, col, val}); return api; };
      });
      return api;
    };

    const storage = {
      from() {
        return {
          upload(path, blob) {
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => { self.blobUrls[path] = reader.result; resolve({data: {path}, error: null}); };
              reader.onerror = () => resolve({data: null, error: new Error('No se pudo guardar la imagen localmente')});
              reader.readAsDataURL(blob);
            });
          },
          getPublicUrl(path) { return {data: {publicUrl: self.blobUrls[path] || ''}}; },
          remove() { return Promise.resolve({data: true, error: null}); }
        };
      }
    };

    const auth = {
      async getUser() {
        await self.ensureReady();
        const owner = self.mem.settings?.[0]?.owner_name || 'Dueño';
        return {data: {user: {id: 1, email: owner}}, error: null};
      },
      async getSession() { return {data: {session: {user: {id: 1}}}, error: null}; },
      async signInWithPassword() { return {data: {user: {id: 1}}, error: null}; },
      async signOut() { return {error: null}; },
      onAuthStateChange() { return {data: {subscription: {unsubscribe() {}}}}; }
    };

    return {from: buildQuery, rpc: (fn, p) => self.ensureReady().then(() => self.execRpc(fn, p)), storage, auth};
  },

  paintBar() {
    const bar = document.querySelector('#netBar');
    if (!bar) return;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    const dirty = Number(this.meta?.dirtySinceBackup || 0);
    const gd = typeof GDRIVE !== 'undefined' ? GDRIVE : null;

    if (gd?.syncing) {
      bar.className = 'netbar sync';
      bar.innerHTML = '<span>Guardando respaldo en tu Google Drive...</span>';
      return;
    }
    if (!online) {
      bar.className = 'netbar off';
      bar.innerHTML = `<span><b>Sin internet</b> · Trabajando 100% local${gd?.state?.connected && dirty ? ` · ${dirty} por respaldar en Drive` : ''}</span>`;
      return;
    }
    if (gd?.state?.connected && dirty > 0 && !gd.hasValidToken()) {
      bar.className = 'netbar pend';
      bar.innerHTML = `<span><b>${dirty} ${dirty === 1 ? 'cambio' : 'cambios'}</b> pendientes por subir a tu Google Drive</span><button type="button" class="netbar-btn" id="nbGdSync">Respaldar ahora</button>`;
      const b = document.querySelector('#nbGdSync');
      if (b) b.onclick = () => run(async () => { await gd.syncNow({manual: true}); render(); });
      return;
    }
    const licSt = typeof LIC !== 'undefined' ? LIC.getStatus() : null;
    if (licSt && licSt.active && licSt.warn && licSt.mode !== 'free') {
      bar.className = 'netbar off';
      bar.innerHTML = `<span><b>${licSt.mode === 'trial' ? 'Prueba gratis' : 'Tu plan'}:</b> quedan ${licSt.daysLeft} ${licSt.daysLeft === 1 ? 'día' : 'días'}</span><button type="button" class="netbar-btn" id="nbLic">Activar / Renovar</button>`;
      const b = document.querySelector('#nbLic');
      if (b) b.onclick = () => { SUB.cfg = 'suscripcion'; go('configuracion'); };
      return;
    }
    if (!gd?.state?.connected && dirty >= 25) {
      bar.className = 'netbar pend';
      bar.innerHTML = `<span><b>${dirty} cambios</b> desde tu último respaldo</span><button type="button" class="netbar-btn" id="nbBk">Respaldar</button>`;
      const b = document.querySelector('#nbBk');
      if (b) b.onclick = () => { SUB.cfg = 'respaldo'; go('configuracion'); };
      return;
    }
    bar.className = 'hidden';
    bar.innerHTML = '';
  },

  initSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
    window.addEventListener('online', () => this.paintBar());
    window.addEventListener('offline', () => {
      this.paintBar();
      if (typeof toast === 'function') toast('Sin internet: sigues trabajando normalmente en tu teléfono');
    });
  }
};

// Fachada compatible OFF para módulos que consulten OFF.*
const OFF = {
  ops: [],
  mem: LDB.mem,
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
  isNetError: () => false,
  withTimeout: (p) => p,
  ensureReady: () => LDB.ensureReady(),
  loadBoot: () => null,
  saveBoot: () => {},
  clearSessionHint: () => {},
  paintBar: () => LDB.paintBar(),
  refreshAll: async () => true,
  syncNow: async () => ({synced: 0, failed: 0, remaining: 0}),
  renderOfflineHome: async () => {}
};

LDB.initSW();
