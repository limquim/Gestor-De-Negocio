// Motor Offline Total v23: réplica local en IndexedDB, proxy transparente de Supabase,
// simulación local de todos los módulos y cola universal de sincronización idempotente.
const OFF_MIRROR_SPEC = [
  {t: 'settings'},
  {t: 'exchange_rates', order: 'id', limit: 60},
  {t: 'profiles'},
  {t: 'payment_methods'},
  {t: 'account_types'},
  {t: 'accounts'},
  {t: 'cuentas_saldo'},
  {t: 'expense_types'},
  {t: 'product_categories'},
  {t: 'units'},
  {t: 'taxes'},
  {t: 'currencies'},
  {t: 'price_lists'},
  {t: 'message_templates'},
  {t: 'catalog_presets'},
  {t: 'products'},
  {t: 'stock_actual'},
  {t: 'parties'},
  {t: 'clientes_resumen'},
  {t: 'deudas_clientes'},
  {t: 'employees'},
  {t: 'employee_advances', order: 'id', limit: 300},
  {t: 'recipes'},
  {t: 'recipe_items'},
  {t: 'production_orders', order: 'id', limit: 200},
  {t: 'production_items', order: 'id', limit: 800},
  {t: 'quotes', order: 'id', limit: 200},
  {t: 'quote_items', order: 'id', limit: 800},
  {t: 'sales', order: 'id', limit: 400},
  {t: 'sale_items', order: 'id', limit: 1500},
  {t: 'ventas_resumen', order: 'id', limit: 400},
  {t: 'sale_returns', order: 'id', limit: 200},
  {t: 'sale_return_items', order: 'id', limit: 600},
  {t: 'purchases', order: 'id', limit: 300},
  {t: 'purchase_items', order: 'id', limit: 1200},
  {t: 'compras_resumen', order: 'id', limit: 300},
  {t: 'payments', order: 'id', limit: 1000},
  {t: 'expenses', order: 'id', limit: 400},
  {t: 'account_movements', order: 'id', limit: 800},
  {t: 'inventory_movements', order: 'id', limit: 1000},
  {t: 'cash_closings', order: 'id', limit: 100},
  {t: 'payroll_runs', order: 'id', limit: 100},
  {t: 'payroll_items', order: 'id', limit: 500},
  {t: 'audit_log', order: 'id', limit: 150}
];

// Relaciones FK para resolver joins embebidos de PostgREST en modo local
const OFF_REL = {
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

const OFF_READ_RPCS = new Set(['current_rate', 'reporte_resumen', 'estado_sistema']);
const OFF_ONLINE_ONLY_RPCS = new Set(['reiniciar_sistema']);

const OFF = {
  rawDb: null,
  dbPromise: null,
  readyPromise: null,
  mem: {},           // { [tableName]: Array<Object> }
  qcache: {},        // { [cacheKey]: any }
  ops: [],           // Cola universal ordenada de operaciones pendientes
  idmap: {},         // { [tempNegId]: realPosId }
  meta: {},          // { lastMirrorAt, tableCounts }
  syncing: false,
  mirroring: false,
  forceOffline: false,
  installPrompt: null,
  BOOT_KEY: 'gdn_boot_v23',
  FORCE_KEY: 'gdn_force_offline',
  OPS_LS_KEY: 'gdn_ops_v23',
  IDMAP_LS_KEY: 'gdn_idmap_v23',
  TID_LS_KEY: 'gdn_next_tid_v23',

  initState() {
    try { this.forceOffline = localStorage.getItem(this.FORCE_KEY) === '1'; } catch (e) {}
  },

  isOffline() {
    return this.forceOffline || (typeof navigator !== 'undefined' && navigator.onLine === false);
  },

  isNetError(err) {
    if (this.isOffline()) return true;
    const msg = String(err?.message || err || '');
    return /Failed to fetch|NetworkError|Load failed|NETWORK_TIMEOUT|ERR_INTERNET|ERR_CONNECTION|ECONN|fetch|network|offline|AbortError/i.test(msg);
  },

  withTimeout(promise, ms = 10000) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('NETWORK_TIMEOUT')), ms))
    ]);
  },

  uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  },

  nextTempId() {
    let cur = -1;
    try {
      const saved = parseInt(localStorage.getItem(this.TID_LS_KEY) || '0', 10);
      cur = saved < 0 ? saved - 1 : -1;
      localStorage.setItem(this.TID_LS_KEY, String(cur));
    } catch (e) {
      cur = -(Math.floor(Date.now() % 100000000) + Math.floor(Math.random() * 1000));
    }
    return cur;
  },

  r2(n) { return Math.round((Number(n) || 0) * 100) / 100; },
  r3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; },
  r4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; },

  toUsdLocal(amt, cur, rateOverride) {
    const r = Number(rateOverride || S?.rate || 1) || 1;
    return cur === 'USD' ? Number(amt || 0) : Number(amt || 0) / r;
  },

  // ---------- IndexedDB v2 ----------
  openDB() {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('gestor_negocio_offline_v2', 1);
        req.onupgradeneeded = (e) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('tables')) idb.createObjectStore('tables');
          if (!idb.objectStoreNames.contains('qcache')) idb.createObjectStore('qcache');
          if (!idb.objectStoreNames.contains('ops')) idb.createObjectStore('ops', {keyPath: 'op_id'});
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
        const st = tx.objectStore(store);
        if (key !== undefined) st.put(val, key); else st.put(val);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch (e) {}
  },

  async idbDel(store, key) {
    const idb = await this.openDB();
    if (!idb) return;
    try {
      await new Promise((res, rej) => {
        const tx = idb.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
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

  async idbGetAll(store) {
    const idb = await this.openDB();
    if (!idb) return null;
    try {
      return await new Promise((res, rej) => {
        const tx = idb.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { return null; }
  },

  // Cargar todo el espejo local y la cola a memoria al arrancar (instantáneo)
  ensureReady() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const [tables, qcache, opsDb, kv] = await Promise.all([
        this.idbGetAllWithKeys('tables'),
        this.idbGetAllWithKeys('qcache'),
        this.idbGetAll('ops'),
        this.idbGetAllWithKeys('kv')
      ]);
      this.mem = tables || {};
      this.qcache = qcache || {};
      this.meta = kv?.meta || {};
      this.idmap = kv?.idmap || {};
      try {
        const lsMap = JSON.parse(localStorage.getItem(this.IDMAP_LS_KEY) || '{}');
        this.idmap = {...lsMap, ...this.idmap};
      } catch (e) {}

      let ops = opsDb;
      if (!ops || !ops.length) {
        try { ops = JSON.parse(localStorage.getItem(this.OPS_LS_KEY) || '[]'); } catch (e) { ops = []; }
      }
      this.ops = (ops || []).sort((a, b) => (a.seq || 0) - (b.seq || 0));

      // Migrar posibles ventas pendientes del Paso 22 (v1) si existieran
      await this.migrateLegacyQueue();
      this.paintBar();
    })();
    return this.readyPromise;
  },

  async migrateLegacyQueue() {
    try {
      const raw = localStorage.getItem('gdn_offline_queue_v22');
      if (!raw) return;
      const old = JSON.parse(raw);
      if (!Array.isArray(old) || !old.length) return;
      for (const rec of old) {
        if (this.ops.some(o => o.op_id === rec.client_tx_id)) continue;
        await this.enqueueOp({
          op_id: rec.client_tx_id || this.uuid(),
          kind: 'rpc',
          rpc_name: 'registrar_venta_offline',
          payload: {
            ...(rec.payload || {}),
            p_client_tx_id: rec.client_tx_id || this.uuid(),
            p_sale_date: rec.sale_date || null
          },
          label: `Venta migrada (${rec.display?.customer_name || 'Cliente general'}) · ${fmt(rec.display?.total_usd || 0)} USD`
        });
      }
      localStorage.removeItem('gdn_offline_queue_v22');
    } catch (e) {}
  },

  saveBoot(patch) {
    try {
      const cur = this.loadBoot() || {};
      localStorage.setItem(this.BOOT_KEY, JSON.stringify({...cur, ...patch, savedAt: new Date().toISOString()}));
    } catch (e) {}
  },

  loadBoot() {
    try {
      const raw = localStorage.getItem(this.BOOT_KEY) || localStorage.getItem('gdn_boot_v22');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  clearSessionHint() {
    try {
      const cur = this.loadBoot();
      if (cur) { delete cur.sessionEmail; localStorage.setItem(this.BOOT_KEY, JSON.stringify(cur)); }
    } catch (e) {}
  },

  async saveTable(name, rows) {
    this.mem[name] = Array.isArray(rows) ? rows : [];
    await this.idbPut('tables', this.mem[name], name);
  },

  async saveQCache(key, data) {
    this.qcache[key] = data;
    await this.idbPut('qcache', data, key);
  },

  async saveIdMap() {
    await this.idbPut('kv', this.idmap, 'idmap');
    try { localStorage.setItem(this.IDMAP_LS_KEY, JSON.stringify(this.idmap)); } catch (e) {}
  },

  async enqueueOp(op) {
    await this.ensureReady();
    const seq = (this.ops.reduce((m, x) => Math.max(m, x.seq || 0), 0)) + 1;
    const item = {
      op_id: op.op_id || this.uuid(),
      seq,
      kind: op.kind,
      table: op.table || null,
      rpc_name: op.rpc_name || null,
      payload: op.payload !== undefined ? JSON.parse(JSON.stringify(op.payload)) : null,
      filters: op.filters ? JSON.parse(JSON.stringify(op.filters)) : [],
      temp_id: op.temp_id ?? null,
      label: op.label || this.describeOp(op),
      created_at: op.created_at || new Date().toISOString(),
      last_error: null
    };
    this.ops.push(item);
    await this.idbPut('ops', item);
    try { localStorage.setItem(this.OPS_LS_KEY, JSON.stringify(this.ops)); } catch (e) {}
    this.paintBar();
    return item;
  },

  async updateOp(item) {
    const idx = this.ops.findIndex(x => x.op_id === item.op_id);
    if (idx >= 0) this.ops[idx] = item;
    await this.idbPut('ops', item);
    try { localStorage.setItem(this.OPS_LS_KEY, JSON.stringify(this.ops)); } catch (e) {}
    this.paintBar();
  },

  async removeOp(opId) {
    this.ops = this.ops.filter(x => x.op_id !== opId);
    await this.idbDel('ops', opId);
    try { localStorage.setItem(this.OPS_LS_KEY, JSON.stringify(this.ops)); } catch (e) {}
    this.paintBar();
  },

  describeOp(op) {
    if (op.kind === 'rpc') {
      const names = {
        registrar_venta: 'Venta',
        registrar_venta_offline: 'Venta',
        anular_venta: 'Anular venta',
        registrar_cobro: 'Cobro de venta',
        cobrar_ventas: 'Cobro de deuda',
        registrar_devolucion: 'Devolución',
        anular_devolucion: 'Anular devolución',
        registrar_compra: 'Compra',
        registrar_pago_compra: 'Pago de compra',
        registrar_gasto: 'Gasto',
        anular_gasto: 'Anular gasto',
        registrar_transferencia: 'Transferencia',
        registrar_ajuste_cuenta: 'Ajuste de saldo',
        registrar_movimiento_capital: op.payload?.p_kind === 'aporte' ? 'Aporte de capital' : 'Retiro del dueño',
        registrar_cierre_caja: 'Cierre de caja',
        crear_metodo_pago: 'Nuevo método de pago',
        marcar_cuenta_predeterminada: 'Cuenta principal',
        ajuste_masivo2: 'Ajuste masivo de inventario',
        guardar_cotizacion: 'Cotización',
        guardar_formula: 'Fórmula de producción',
        crear_orden_produccion: 'Orden de producción',
        actualizar_orden_produccion: 'Editar producción',
        finalizar_produccion: 'Finalizar producción',
        anular_produccion: 'Anular producción',
        registrar_adelanto: 'Adelanto de nómina',
        registrar_nomina: 'Pago de nómina',
        anular_nomina: 'Anular nómina',
        guardar_apertura_negocio: 'Saldos iniciales (Apertura)',
        recalcular_costos: 'Recalcular costos'
      };
      return names[op.rpc_name] || op.rpc_name;
    }
    const acts = {insert: 'Crear', update: 'Actualizar', delete: 'Eliminar', upsert: 'Guardar'};
    return `${acts[op.kind] || op.kind} en ${op.table}`;
  },

  // ---------- Descarga completa del espejo local ----------
  async refreshAll(silent = true) {
    await this.ensureReady();
    if (this.isOffline() || !this.rawDb || this.mirroring) return false;
    // No sobrescribir el espejo si hay cambios locales aún sin subir
    if (this.ops.length > 0) return false;

    this.mirroring = true;
    let okCount = 0;
    try {
      const batchSize = 6;
      for (let i = 0; i < OFF_MIRROR_SPEC.length; i += batchSize) {
        if (this.isOffline() || this.ops.length > 0) break;
        const chunk = OFF_MIRROR_SPEC.slice(i, i + batchSize);
        await Promise.all(chunk.map(async (sp) => {
          try {
            let qb = this.rawDb.from(sp.t).select('*');
            if (sp.order) qb = qb.order(sp.order, {ascending: false});
            if (sp.limit) qb = qb.limit(sp.limit);
            const {data, error} = await this.withTimeout(qb, 12000);
            if (!error && Array.isArray(data)) {
              await this.saveTable(sp.t, data);
              okCount++;
            }
          } catch (e) {}
        }));
      }
      // Cachear estado_sistema también
      try {
        const {data, error} = await this.withTimeout(this.rawDb.rpc('estado_sistema'), 8000);
        if (!error && data) await this.saveQCache('rpc:estado_sistema:{}', data);
      } catch (e) {}

      if (okCount > 0) {
        this.meta = {
          lastMirrorAt: new Date().toISOString(),
          tablesCount: Object.keys(this.mem).filter(k => Array.isArray(this.mem[k])).length,
          productsCount: (this.mem.products || []).filter(p => p.active !== false).length
        };
        await this.idbPut('kv', this.meta, 'meta');
        if (typeof METHODS !== 'undefined') {
          this.saveBoot({methods: {...METHODS}, mOff: [...(typeof M_OFF !== 'undefined' ? M_OFF : [])]});
        }
        if (!silent) toast(`Toda la app está lista para usar sin internet (${okCount} tablas actualizadas)`);
      }
      return okCount > 0;
    } finally {
      this.mirroring = false;
    }
  },

  // Compatibilidad con código que llame refreshSnapshot
  async refreshSnapshot(silent = true) { return this.refreshAll(silent); },

  // ---------- Motor de Consultas PostgREST Local ----------
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
        const inner = head.includes('!inner');
        const name = head.split('!')[0].trim();
        const sub = p.slice(idx + 1, -1).trim();
        rels.push({name, inner, sub: this.parseSelect(sub)});
      } else {
        fields.push(p.trim());
      }
    }
    return {fields, rels};
  },

  attachRelations(table, row, parsed) {
    const out = {...row};
    const relDefs = OFF_REL[table] || {};
    for (const r of parsed.rels) {
      const def = relDefs[r.name];
      if (!def) { out[r.name] = null; continue; }
      const [localCol, foreignCol, isMany] = def;
      const targetRows = this.mem[r.name] || [];
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
    // Comparar timestamps ISO con zona horaria correctamente
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

  execLocalSelect(spec) {
    const base = this.mem[spec.table];
    if (!Array.isArray(base)) {
      const cached = this.qcache[spec.cacheKey];
      if (cached !== undefined) return {data: JSON.parse(JSON.stringify(cached)), error: null};
      if (spec.single) return {data: null, error: {code: 'PGRST116', message: 'Sin datos guardados localmente para ' + spec.table}};
      return {data: [], error: null};
    }

    const parsed = this.parseSelect(spec.selectCols || '*');
    let rows = [];
    for (const raw of base) {
      const hydrated = this.attachRelations(spec.table, raw, parsed);
      if (hydrated === null) continue;
      if (spec.filters.every(f => this.matchFilter(hydrated, f))) {
        rows.push(hydrated);
      }
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

    if (spec.range) {
      rows = rows.slice(spec.range[0], spec.range[1] + 1);
    } else if (spec.limit != null) {
      rows = rows.slice(0, spec.limit);
    }

    if (spec.single) {
      if (!rows.length) return {data: null, error: {code: 'PGRST116', message: 'No encontrado en caché local'}};
      return {data: rows[0], error: null};
    }
    if (spec.maybeSingle) {
      return {data: rows[0] || null, error: null};
    }
    return {data: rows, error: null};
  },

  // ---------- Utilidades de actualización incremental del espejo local ----------
  async bumpStock(productId, delta, unitCost, movementType, refType, refId, notes, updateProductCost = false, skipMoveInsert = false) {
    const pid = Number(productId);
    const d = this.r3(delta);
    const prods = this.mem.products || [];
    const prod = prods.find(p => Number(p.id) === pid);
    const stRows = this.mem.stock_actual || [];
    let st = stRows.find(s => Number(s.product_id) === pid);

    const curStock = st ? Number(st.stock || 0) : 0;
    const curCost = Number(st?.avg_cost_usd ?? prod?.avg_cost_usd ?? prod?.manual_cost_usd ?? 0);
    const uc = unitCost != null ? Number(unitCost) : curCost;

    let newCost = curCost;
    if (updateProductCost && d > 0 && unitCost != null) {
      const method = (this.mem.settings?.[0]?.cost_method) || 'avg';
      if (method === 'last') newCost = uc;
      else if (method === 'max') newCost = Math.max(curCost, uc);
      else newCost = (Math.max(curStock, 0) + d) > 0 ? ((Math.max(curStock, 0) * curCost) + (d * uc)) / (Math.max(curStock, 0) + d) : uc;
      newCost = this.r4(newCost);
      if (prod) {
        prod.auto_cost_usd = newCost;
        prod.avg_cost_usd = newCost;
        prod.last_cost_usd = this.r4(uc);
        if (!Number(prod.manual_cost_usd)) prod.manual_cost_usd = newCost;
        await this.saveTable('products', prods);
      }
    }

    const nextStock = this.r3(curStock + d);
    if (st) {
      st.stock = nextStock;
      st.avg_cost_usd = newCost;
      st.valor_usd = this.r2(Math.max(nextStock, 0) * newCost);
      st.bajo_minimo = Number(st.min_stock || 0) > 0 && nextStock <= Number(st.min_stock || 0);
      await this.saveTable('stock_actual', stRows);
    }

    if (skipMoveInsert) return;
    const moves = this.mem.inventory_movements || [];
    moves.unshift({
      id: this.nextTempId(),
      product_id: pid,
      movement_type: movementType || 'ajuste',
      quantity: d,
      unit_cost_usd: this.r4(uc),
      ref_type: refType || null,
      ref_id: refId || null,
      notes: notes || null,
      created_at: new Date().toISOString()
    });
    await this.saveTable('inventory_movements', moves);
  },

  async bumpAccount(accountId, signedAmount, kind, note) {
    const aid = Number(accountId);
    const amt = this.r2(signedAmount);
    const accs = this.mem.cuentas_saldo || [];
    const acc = accs.find(a => Number(a.id) === aid);
    if (acc) {
      acc.balance = this.r2(Number(acc.balance || 0) + amt);
      await this.saveTable('cuentas_saldo', accs);
    }
    const moves = this.mem.account_movements || [];
    moves.unshift({
      id: this.nextTempId(),
      account_id: aid,
      kind: kind || 'ajuste',
      amount: amt,
      note: note || null,
      created_at: new Date().toISOString()
    });
    await this.saveTable('account_movements', moves);
  },

  async rebuildCustomerDebts() {
    const vr = this.mem.ventas_resumen || [];
    const parties = this.mem.parties || [];
    const map = {};
    vr.filter(v => v.status === 'pendiente').forEach(v => {
      const bal = this.r2(Number(v.total_usd || 0) - Number(v.paid_usd || 0));
      if (bal <= 0.01) return;
      const key = v.customer_id == null ? 'null' : String(v.customer_id);
      const p = v.customer_id != null ? parties.find(x => Number(x.id) === Number(v.customer_id)) : null;
      if (!map[key]) {
        map[key] = {
          customer_id: v.customer_id ?? null,
          customer: v.customer || p?.name || 'Cliente general',
          phone: p?.phone || null,
          num_ventas: 0,
          debt_usd: 0,
          desde: v.sale_date
        };
      }
      map[key].num_ventas++;
      map[key].debt_usd = this.r2(map[key].debt_usd + bal);
      if (v.sale_date && (!map[key].desde || v.sale_date < map[key].desde)) map[key].desde = v.sale_date;
    });
    await this.saveTable('deudas_clientes', Object.values(map));
  },

  async syncProductToStockActual(prod) {
    if (!prod) return;
    const stRows = this.mem.stock_actual || [];
    const cats = this.mem.product_categories || [];
    const cat = cats.find(c => Number(c.id) === Number(prod.category_id));
    const idx = stRows.findIndex(s => Number(s.product_id) === Number(prod.id));
    if (prod.active === false || prod.is_service) {
      if (idx >= 0) { stRows.splice(idx, 1); await this.saveTable('stock_actual', stRows); }
      return;
    }
    const cost = Number(prod.auto_cost_usd ?? prod.avg_cost_usd ?? prod.manual_cost_usd ?? 0);
    if (idx >= 0) {
      const s = stRows[idx];
      s.sku = prod.sku ?? s.sku;
      s.name = prod.name ?? s.name;
      s.category_id = prod.category_id ?? s.category_id;
      s.category = cat?.name ?? s.category;
      s.unit = prod.unit ?? s.unit;
      s.min_stock = Number(prod.min_stock ?? s.min_stock ?? 0);
      s.sale_price_usd = Number(prod.sale_price_usd ?? s.sale_price_usd ?? 0);
      s.avg_cost_usd = cost;
      s.valor_usd = this.r2(Math.max(Number(s.stock || 0), 0) * cost);
      s.bajo_minimo = s.min_stock > 0 && Number(s.stock || 0) <= s.min_stock;
    } else {
      stRows.push({
        product_id: prod.id,
        sku: prod.sku || null,
        name: prod.name,
        category_id: prod.category_id || null,
        category: cat?.name || null,
        sells_regularly: cat ? cat.sells_regularly !== false : true,
        unit: prod.unit || 'und',
        stock: 0,
        min_stock: Number(prod.min_stock || 0),
        avg_cost_usd: cost,
        sale_price_usd: Number(prod.sale_price_usd || 0),
        valor_usd: 0,
        bajo_minimo: Number(prod.min_stock || 0) > 0
      });
    }
    await this.saveTable('stock_actual', stRows);
  },

  async syncAccountToCuentasSaldo(acc, isNew = false) {
    if (!acc) return;
    const cs = this.mem.cuentas_saldo || [];
    const types = this.mem.account_types || [];
    const tObj = types.find(x => Number(x.id) === Number(acc.type_id));
    const idx = cs.findIndex(x => Number(x.id) === Number(acc.id));
    if (idx >= 0) {
      const prevOpen = Number(cs[idx].opening_balance || 0);
      const newOpen = Number(acc.opening_balance ?? prevOpen);
      Object.assign(cs[idx], {
        name: acc.name ?? cs[idx].name,
        type_id: acc.type_id ?? cs[idx].type_id,
        type: tObj?.name ?? cs[idx].type,
        currency: acc.currency ?? cs[idx].currency,
        opening_balance: newOpen,
        balance: this.r2(Number(cs[idx].balance || 0) + (newOpen - prevOpen)),
        methods: acc.methods ?? cs[idx].methods,
        active: acc.active !== undefined ? acc.active : cs[idx].active
      });
    } else if (isNew) {
      cs.push({
        id: acc.id,
        name: acc.name,
        type_id: acc.type_id || null,
        type: tObj?.name || 'Cuenta',
        currency: acc.currency || 'USD',
        opening_balance: Number(acc.opening_balance || 0),
        balance: Number(acc.opening_balance || 0),
        methods: acc.methods || ['efectivo'],
        active: acc.active !== false
      });
    }
    await this.saveTable('cuentas_saldo', cs);
  },

  // ---------- Escrituras locales directas (INSERT / UPDATE / DELETE) ----------
  async applyLocalWrite(spec, enqueue = true) {
    const t = spec.table;
    const rows = Array.isArray(this.mem[t]) ? this.mem[t] : (this.mem[t] = []);
    const now = new Date().toISOString();

    if (spec.op === 'insert' || spec.op === 'upsert') {
      const arr = Array.isArray(spec.payload) ? spec.payload : [spec.payload];
      const inserted = [];
      for (const raw of arr) {
        const tempId = raw.id != null ? raw.id : this.nextTempId();
        const rec = {
          active: true,
          created_at: now,
          ...raw,
          id: tempId
        };
        if (t === 'products') {
          rec.avg_cost_usd = Number(rec.avg_cost_usd ?? rec.manual_cost_usd ?? 0);
          rec.manual_cost_usd = Number(rec.manual_cost_usd ?? rec.avg_cost_usd ?? 0);
          rec.auto_cost_usd = rec.auto_cost_usd ?? null;
        }
        rows.push(rec);
        inserted.push(rec);

        if (t === 'products') await this.syncProductToStockActual(rec);
        if (t === 'accounts') await this.syncAccountToCuentasSaldo(rec, true);
        if (t === 'inventory_movements') {
          const isIn = Number(rec.quantity || 0) > 0;
          await this.bumpStock(rec.product_id, rec.quantity, rec.unit_cost_usd, rec.movement_type, rec.ref_type, rec.ref_id, rec.notes, isIn && rec.unit_cost_usd != null, true);
        }
        if (t === 'exchange_rates' && rec.currency === 'USD' && Number(rec.rate) > 0) {
          S.rate = Number(rec.rate);
          this.saveBoot({rate: S.rate, mode: S.mode});
        }
        if (t === 'parties' && rec.is_customer) {
          const cr = this.mem.clientes_resumen || [];
          cr.push({id: rec.id, name: rec.name, phone: rec.phone || null, active: true, num_ventas: 0, total_usd: 0, ultima_compra: null, producto_favorito: null});
          await this.saveTable('clientes_resumen', cr);
        }
      }
      await this.saveTable(t, rows);

      if (enqueue) {
        if (Array.isArray(spec.payload)) {
          for (const rec of inserted) {
            const clean = {...rec}; delete clean.id; delete clean.created_at;
            await this.enqueueOp({kind: 'insert', table: t, payload: clean, temp_id: rec.id});
          }
        } else {
          await this.enqueueOp({kind: 'insert', table: t, payload: spec.payload, temp_id: inserted[0]?.id ?? null});
        }
      }
      const res = spec.single ? inserted[0] : spec.maybeSingle ? (inserted[0] || null) : inserted;
      return {data: res, error: null};
    }

    if (spec.op === 'update') {
      const updated = [];
      for (const r of rows) {
        if (spec.filters.every(f => this.matchFilter(r, f))) {
          Object.assign(r, spec.payload);
          updated.push(r);
          if (t === 'products') await this.syncProductToStockActual(r);
          if (t === 'accounts') await this.syncAccountToCuentasSaldo(r, false);
          if (t === 'settings' && spec.payload.rate_mode) {
            S.mode = spec.payload.rate_mode;
            this.saveBoot({mode: S.mode});
          }
        }
      }
      await this.saveTable(t, rows);
      if (enqueue) {
        await this.enqueueOp({kind: 'update', table: t, payload: spec.payload, filters: spec.filters});
      }
      const res = spec.single ? (updated[0] || null) : spec.maybeSingle ? (updated[0] || null) : updated;
      return {data: res, error: null};
    }

    if (spec.op === 'delete') {
      const kept = [], deleted = [];
      for (const r of rows) {
        if (spec.filters.every(f => this.matchFilter(r, f))) deleted.push(r);
        else kept.push(r);
      }
      await this.saveTable(t, kept);
      if (enqueue) {
        await this.enqueueOp({kind: 'delete', table: t, filters: spec.filters});
      }
      return {data: deleted, error: null};
    }

    return {data: null, error: null};
  },

  // ---------- Cálculo local en vivo de reporte_resumen (Panel del Dueño + Reportes) ----------
  computeLocalReport(p_from, p_to) {
    const from = String(p_from || '1900-01-01').slice(0, 10);
    const to = String(p_to || '2999-12-31').slice(0, 10);
    const sales = (this.mem.sales || []).filter(s => s.status !== 'anulada' && s.sale_date >= from && s.sale_date <= to);
    const saleMap = new Map(sales.map(s => [Number(s.id), s]));
    const saleItems = (this.mem.sale_items || []).filter(i => saleMap.has(Number(i.sale_id)));
    const products = this.mem.products || [];
    const prodMap = new Map(products.map(p => [Number(p.id), p]));

    const returns = (this.mem.sale_returns || []).filter(r => r.status === 'activa' && r.return_date >= from && r.return_date <= to);
    const retSet = new Set(returns.map(r => Number(r.id)));
    const retItems = (this.mem.sale_return_items || []).filter(ri => retSet.has(Number(ri.return_id)));

    let ingresos = 0, iva = 0, costo_ventas = 0;
    const byDay = {}, byProd = {};

    sales.forEach(s => {
      const net = Number(s.subtotal_usd || 0) - Number(s.discount_usd || 0);
      ingresos += net;
      iva += Number(s.tax_usd || 0);
      byDay[s.sale_date] = (byDay[s.sale_date] || 0) + Number(s.total_usd || 0);
    });

    saleItems.forEach(i => {
      const s = saleMap.get(Number(i.sale_id));
      const ratio = Number(s?.subtotal_usd || 0) > 0 ? Math.max(0, 1 - Number(s.discount_usd || 0) / Number(s.subtotal_usd || 1)) : 1;
      const qtyN = Number(i.quantity || 0);
      const rev = qtyN * Number(i.unit_price_usd || 0) * ratio;
      const p = prodMap.get(Number(i.product_id));
      const ucost = Number(i.unit_cost_usd ?? p?.avg_cost_usd ?? 0);
      const cost = qtyN * ucost;
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

    const por_cobrar = (this.mem.ventas_resumen || [])
      .filter(v => v.status === 'pendiente')
      .reduce((a, v) => a + Math.max(0, Number(v.total_usd || 0) - Number(v.paid_usd || 0)), 0);

    const por_pagar = (this.mem.compras_resumen || [])
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

  // ---------- Simulador local de RPCs ----------
  async execLocalReadRpc(fnName, params) {
    if (fnName === 'current_rate') {
      const rates = (this.mem.exchange_rates || []).filter(r => r.currency === (params?.p_currency || 'USD'));
      if (rates.length) {
        const sorted = [...rates].sort((a, b) => String(b.rate_date).localeCompare(String(a.rate_date)) || Number(b.id) - Number(a.id));
        return {data: Number(sorted[0].rate), error: null};
      }
      return {data: S?.rate || this.loadBoot()?.rate || null, error: null};
    }
    if (fnName === 'reporte_resumen') {
      return {data: this.computeLocalReport(params?.p_from, params?.p_to), error: null};
    }
    if (fnName === 'estado_sistema') {
      const cached = this.qcache['rpc:estado_sistema:{}'];
      if (cached) return {data: cached, error: null};
      return {data: [], error: null};
    }
    return {data: null, error: null};
  },

  async applyLocalWriteRpc(fnName, params, enqueue = true) {
    const P = params || {};
    const now = new Date().toISOString();
    const today = typeof caracasDate === 'function' ? caracasDate() : now.slice(0, 10);
    const rate = Number(P.p_rate || S?.rate || 1) || 1;
    const accs = this.mem.accounts || [];
    const prods = this.mem.products || [];
    const taxes = this.mem.taxes || [];
    const parties = this.mem.parties || [];

    const accById = (id) => accs.find(a => Number(a.id) === Number(id)) || (this.mem.cuentas_saldo || []).find(a => Number(a.id) === Number(id));
    const prodById = (id) => prods.find(p => Number(p.id) === Number(id));
    const partyById = (id) => parties.find(p => Number(p.id) === Number(id));

    // ---- 1. VENTAS ----
    if (fnName === 'registrar_venta' || fnName === 'registrar_venta_offline') {
      const isEdit = P.p_id != null;
      const saleId = isEdit ? Number(P.p_id) : this.nextTempId();
      const saleDate = P.p_sale_date || today;
      const items = P.p_items || [];
      const pays = P.p_payments || [];
      const docType = P.p_doc_type || 'nota_entrega';

      // Si es corrección, revertir efectos previos localmente
      if (isEdit) {
        const oldItems = (this.mem.sale_items || []).filter(i => Number(i.sale_id) === saleId);
        for (const oi of oldItems) {
          const pr = prodById(oi.product_id);
          if (pr && !pr.is_service) await this.bumpStock(oi.product_id, Number(oi.quantity), oi.unit_cost_usd, 'devolucion', 'sale', saleId, 'Corrección venta #' + saleId);
        }
        const oldPays = (this.mem.payments || []).filter(p => Number(p.sale_id) === saleId);
        for (const op of oldPays) await this.bumpAccount(op.account_id, -Number(op.amount), 'anulacion', 'Corrección venta #' + saleId);
        await this.saveTable('sale_items', (this.mem.sale_items || []).filter(i => Number(i.sale_id) !== saleId));
        await this.saveTable('payments', (this.mem.payments || []).filter(p => Number(p.sale_id) !== saleId));
      }

      let sub = 0, rawTax = 0;
      const newSaleItems = [];
      for (const it of items) {
        const pr = prodById(it.product_id);
        const tx = taxes.find(x => Number(x.id) === Number(pr?.tax_id));
        const pct = docType === 'factura' ? Number(tx?.percent || 0) : 0;
        const lineSub = Number(it.quantity) * Number(it.unit_price_usd);
        sub += lineSub;
        rawTax += lineSub * pct / 100;
        const ucost = Number(pr?.avg_cost_usd ?? pr?.manual_cost_usd ?? 0);
        newSaleItems.push({
          id: this.nextTempId(),
          sale_id: saleId,
          product_id: Number(it.product_id),
          quantity: Number(it.quantity),
          unit_price_usd: Number(it.unit_price_usd),
          unit_cost_usd: ucost,
          tax_percent: pct
        });
        if (pr && !pr.is_service) {
          await this.bumpStock(it.product_id, -Number(it.quantity), ucost, 'venta', 'sale', saleId, null);
        }
      }

      const disc = Math.min(Number(P.p_discount_usd || 0), sub);
      const tax = sub > 0 ? this.r2(rawTax * (sub - disc) / sub) : 0;
      const total = this.r2(sub - disc + tax);

      let paidUsd = 0;
      const newPays = [];
      for (const py of pays) {
        const acc = accById(py.account_id);
        const cur = acc?.currency || 'USD';
        const amt = this.r2(py.amount);
        const usd = this.r2(this.toUsdLocal(amt, cur, rate));
        paidUsd += usd;
        newPays.push({
          id: this.nextTempId(),
          sale_id: saleId,
          purchase_id: null,
          account_id: Number(py.account_id),
          method: py.method || 'efectivo',
          currency: cur,
          amount: amt,
          amount_usd: usd,
          exchange_rate: rate,
          reference: py.reference || null,
          created_at: now
        });
        await this.bumpAccount(py.account_id, amt, 'cobro', 'Venta #' + saleId);
      }

      const status = paidUsd >= total - 0.01 ? 'pagada' : 'pendiente';
      const cust = partyById(P.p_customer_id);
      const saleRow = {
        id: saleId,
        customer_id: P.p_customer_id || null,
        sale_date: saleDate,
        doc_type: docType,
        exchange_rate: rate,
        subtotal_usd: this.r2(sub),
        discount_usd: this.r2(disc),
        tax_usd: tax,
        total_usd: total,
        status,
        due_date: P.p_due_date || null,
        notes: P.p_notes || null,
        created_at: now
      };
      const vrRow = {
        id: saleId,
        customer_id: saleRow.customer_id,
        customer: cust?.name || 'Cliente general',
        sale_date: saleDate,
        doc_type: docType,
        exchange_rate: rate,
        total_usd: total,
        paid_usd: this.r2(paidUsd),
        status,
        due_date: saleRow.due_date
      };

      const salesArr = (this.mem.sales || []).filter(s => Number(s.id) !== saleId);
      salesArr.unshift(saleRow);
      await this.saveTable('sales', salesArr);

      const vrArr = (this.mem.ventas_resumen || []).filter(s => Number(s.id) !== saleId);
      vrArr.unshift(vrRow);
      await this.saveTable('ventas_resumen', vrArr);

      await this.saveTable('sale_items', [...(this.mem.sale_items || []), ...newSaleItems]);
      await this.saveTable('payments', [...(this.mem.payments || []), ...newPays]);
      await this.rebuildCustomerDebts();

      if (enqueue) {
        const txId = P.p_client_tx_id || this.uuid();
        await this.enqueueOp({
          op_id: txId,
          kind: 'rpc',
          rpc_name: isEdit ? 'registrar_venta' : 'registrar_venta_offline',
          payload: isEdit ? P : {
            p_client_tx_id: txId,
            p_customer_id: P.p_customer_id || null,
            p_doc_type: docType,
            p_rate: rate,
            p_discount_usd: this.r2(disc),
            p_due_date: P.p_due_date || null,
            p_notes: P.p_notes || null,
            p_items: items,
            p_payments: pays,
            p_sale_date: saleDate
          },
          temp_id: isEdit ? null : saleId,
          label: `${isEdit ? 'Corregir venta #' + saleId : 'Venta'} (${cust?.name || 'Cliente general'}) · ${fmt(total)} USD`
        });
      }
      return {data: saleId, error: null};
    }

    if (fnName === 'anular_venta') {
      const id = Number(P.p_id);
      const s = (this.mem.sales || []).find(x => Number(x.id) === id);
      if (s && s.status !== 'anulada') {
        s.status = 'anulada';
        await this.saveTable('sales', this.mem.sales);
        const vr = (this.mem.ventas_resumen || []).find(x => Number(x.id) === id);
        if (vr) { vr.status = 'anulada'; await this.saveTable('ventas_resumen', this.mem.ventas_resumen); }
        for (const it of (this.mem.sale_items || []).filter(x => Number(x.sale_id) === id)) {
          const pr = prodById(it.product_id);
          if (pr && !pr.is_service) await this.bumpStock(it.product_id, Number(it.quantity), it.unit_cost_usd, 'devolucion', 'sale', id, 'Anulación venta #' + id);
        }
        for (const py of (this.mem.payments || []).filter(x => Number(x.sale_id) === id)) {
          await this.bumpAccount(py.account_id, -Number(py.amount), 'anulacion', 'Anulación venta #' + id);
        }
        await this.rebuildCustomerDebts();
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Anular venta #${id}`});
      return {data: true, error: null};
    }

    if (fnName === 'registrar_cobro') {
      const sid = Number(P.p_sale_id);
      const acc = accById(P.p_account_id);
      const cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount);
      const usd = this.r2(this.toUsdLocal(amt, cur, rate));
      const pays = this.mem.payments || [];
      pays.push({id: this.nextTempId(), sale_id: sid, purchase_id: null, account_id: Number(P.p_account_id), method: P.p_method || 'efectivo', currency: cur, amount: amt, amount_usd: usd, exchange_rate: rate, reference: P.p_reference || null, created_at: now});
      await this.saveTable('payments', pays);
      await this.bumpAccount(P.p_account_id, amt, 'cobro', 'Cobro venta #' + sid);
      const vr = (this.mem.ventas_resumen || []).find(x => Number(x.id) === sid);
      if (vr) {
        vr.paid_usd = this.r2(Number(vr.paid_usd || 0) + usd);
        if (vr.paid_usd >= Number(vr.total_usd || 0) - 0.01) vr.status = 'pagada';
        await this.saveTable('ventas_resumen', this.mem.ventas_resumen);
        const s = (this.mem.sales || []).find(x => Number(x.id) === sid);
        if (s && vr.status === 'pagada') { s.status = 'pagada'; await this.saveTable('sales', this.mem.sales); }
      }
      await this.rebuildCustomerDebts();
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Cobro venta #${sid} · ${fmt(usd)} USD`});
      return {data: true, error: null};
    }

    if (fnName === 'cobrar_ventas') {
      const ids = (P.p_sale_ids || []).map(Number);
      const acc = accById(P.p_account_id);
      const cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount);
      let remUsd = this.r2(this.toUsdLocal(amt, cur, rate));
      let pagadas = 0, abonadas = 0, pendUsd = 0;
      const pays = this.mem.payments || [];
      for (const sid of ids) {
        const vr = (this.mem.ventas_resumen || []).find(x => Number(x.id) === sid);
        if (!vr) continue;
        const bal = Math.max(0, Number(vr.total_usd || 0) - Number(vr.paid_usd || 0));
        const app = Math.min(bal, Math.max(0, remUsd));
        remUsd = this.r2(remUsd - app);
        if (app > 0.004) {
          const origAmt = cur === 'USD' ? app : this.r2(app * rate);
          pays.push({id: this.nextTempId(), sale_id: sid, purchase_id: null, account_id: Number(P.p_account_id), method: P.p_method || 'efectivo', currency: cur, amount: origAmt, amount_usd: this.r2(app), exchange_rate: rate, reference: P.p_reference || null, created_at: now});
          vr.paid_usd = this.r2(Number(vr.paid_usd || 0) + app);
          if (vr.paid_usd >= Number(vr.total_usd || 0) - 0.01) {
            vr.status = 'pagada'; pagadas++;
            const s = (this.mem.sales || []).find(x => Number(x.id) === sid);
            if (s) s.status = 'pagada';
          } else { abonadas++; }
        }
        pendUsd += Math.max(0, Number(vr.total_usd || 0) - Number(vr.paid_usd || 0));
      }
      await this.saveTable('payments', pays);
      await this.saveTable('ventas_resumen', this.mem.ventas_resumen || []);
      await this.saveTable('sales', this.mem.sales || []);
      await this.bumpAccount(P.p_account_id, amt, 'cobro', 'Cobro de deudas');
      await this.rebuildCustomerDebts();
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Cobro múltiple · ${fmt(this.toUsdLocal(amt, cur, rate))} USD`});
      return {data: {pagadas, abonadas, pendiente_usd: this.r2(pendUsd)}, error: null};
    }

    // ---- 2. DEVOLUCIONES ----
    if (fnName === 'registrar_devolucion') {
      const retId = this.nextTempId();
      const sid = Number(P.p_sale_id);
      const s = (this.mem.sales || []).find(x => Number(x.id) === sid);
      const sItems = (this.mem.sale_items || []).filter(x => Number(x.sale_id) === sid);
      const ratio = Number(s?.subtotal_usd || 0) > 0 ? Math.max(0, 1 - Number(s.discount_usd || 0) / Number(s.subtotal_usd || 1)) : 1;
      let totalUsd = 0, refundUsd = 0;
      const rItems = [];
      for (const it of (P.p_items || [])) {
        const si = sItems.find(x => Number(x.product_id) === Number(it.product_id));
        const up = Number(si?.unit_price_usd || 0), uc = Number(si?.unit_cost_usd || 0), pct = Number(si?.tax_percent || 0);
        totalUsd += Number(it.quantity) * up * ratio * (1 + pct / 100);
        rItems.push({id: this.nextTempId(), return_id: retId, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_price_usd: up, unit_cost_usd: uc, restock: !!it.restock});
        if (it.restock) await this.bumpStock(it.product_id, Number(it.quantity), uc, 'devolucion', 'sale', sid, 'Devolución #' + retId);
      }
      for (const rf of (P.p_refund || [])) {
        const acc = accById(rf.account_id), cur = acc?.currency || 'USD';
        const amt = this.r2(rf.amount);
        refundUsd += this.toUsdLocal(amt, cur, rate);
        await this.bumpAccount(rf.account_id, -amt, 'reembolso', 'Reembolso devolución #' + retId);
      }
      const rets = this.mem.sale_returns || [];
      rets.unshift({id: retId, sale_id: sid, return_date: today, reason: P.p_reason || null, notes: P.p_notes || null, total_usd: this.r2(totalUsd), refund_usd: this.r2(refundUsd), status: 'activa', created_at: now});
      await this.saveTable('sale_returns', rets);
      await this.saveTable('sale_return_items', [...(this.mem.sale_return_items || []), ...rItems]);
      const vr = (this.mem.ventas_resumen || []).find(x => Number(x.id) === sid);
      if (vr) {
        const creditApplied = Math.max(0, this.r2(totalUsd - refundUsd));
        vr.paid_usd = this.r2(Number(vr.paid_usd || 0) + creditApplied);
        if (vr.paid_usd >= Number(vr.total_usd || 0) - 0.01) vr.status = 'pagada';
        await this.saveTable('ventas_resumen', this.mem.ventas_resumen);
      }
      await this.rebuildCustomerDebts();
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: retId, label: `Devolución venta #${sid} · ${fmt(totalUsd)} USD`});
      return {data: retId, error: null};
    }

    if (fnName === 'anular_devolucion') {
      const id = Number(P.p_id);
      const r = (this.mem.sale_returns || []).find(x => Number(x.id) === id);
      if (r) { r.status = 'anulada'; await this.saveTable('sale_returns', this.mem.sale_returns); }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Anular devolución #${id}`});
      return {data: true, error: null};
    }

    // ---- 3. COMPRAS ----
    if (fnName === 'registrar_compra') {
      const pid = this.nextTempId();
      const cur = P.p_currency || 'USD';
      const items = P.p_items || [];
      let totalUsd = 0;
      const pItems = [];
      for (const it of items) {
        const uUsd = this.r4(this.toUsdLocal(it.unit_cost, cur, rate));
        totalUsd += Number(it.quantity) * uUsd;
        pItems.push({id: this.nextTempId(), purchase_id: pid, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_cost_usd: uUsd});
        await this.bumpStock(it.product_id, Number(it.quantity), uUsd, 'compra', 'purchase', pid, P.p_notes || null, true);
      }
      totalUsd = this.r2(totalUsd);
      const sup = partyById(P.p_supplier_id);
      const purRow = {id: pid, supplier_id: P.p_supplier_id || null, purchase_date: today, currency: cur, exchange_rate: rate, total_usd: totalUsd, status: 'registrada', due_date: null, notes: P.p_notes || null, created_at: now};
      const crRow = {id: pid, supplier_id: purRow.supplier_id, supplier: sup?.name || 'Sin proveedor', purchase_date: today, exchange_rate: rate, total_usd: totalUsd, paid_usd: 0, status: 'registrada', due_date: null};
      const purs = this.mem.purchases || []; purs.unshift(purRow); await this.saveTable('purchases', purs);
      const crs = this.mem.compras_resumen || []; crs.unshift(crRow); await this.saveTable('compras_resumen', crs);
      await this.saveTable('purchase_items', [...(this.mem.purchase_items || []), ...pItems]);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: pid, label: `Compra (${sup?.name || 'Sin proveedor'}) · ${fmt(totalUsd)} USD`});
      return {data: pid, error: null};
    }

    if (fnName === 'registrar_pago_compra') {
      const pid = Number(P.p_purchase_id);
      const acc = accById(P.p_account_id), cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount), usd = this.r2(this.toUsdLocal(amt, cur, rate));
      const pays = this.mem.payments || [];
      pays.push({id: this.nextTempId(), sale_id: null, purchase_id: pid, account_id: Number(P.p_account_id), method: P.p_method || 'efectivo', currency: cur, amount: amt, amount_usd: usd, exchange_rate: rate, reference: P.p_reference || null, created_at: now});
      await this.saveTable('payments', pays);
      await this.bumpAccount(P.p_account_id, -amt, 'pago', 'Pago compra #' + pid);
      const cr = (this.mem.compras_resumen || []).find(x => Number(x.id) === pid);
      if (cr) {
        cr.paid_usd = this.r2(Number(cr.paid_usd || 0) + usd);
        if (cr.paid_usd >= Number(cr.total_usd || 0) - 0.01) cr.status = 'pagada';
        await this.saveTable('compras_resumen', this.mem.compras_resumen);
        const b = (this.mem.purchases || []).find(x => Number(x.id) === pid);
        if (b && cr.status === 'pagada') { b.status = 'pagada'; await this.saveTable('purchases', this.mem.purchases); }
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Pago compra #${pid} · ${fmt(usd)} USD`});
      return {data: true, error: null};
    }

    // ---- 4. FINANZAS (GASTOS, TRANSFERENCIAS, AJUSTES, CAPITAL, CIERRE, MÉTODOS) ----
    if (fnName === 'registrar_gasto') {
      const gid = this.nextTempId();
      const acc = accById(P.p_account_id), cur = acc?.currency || 'USD';
      const amt = this.r2(P.p_amount), usd = this.r2(this.toUsdLocal(amt, cur, rate));
      const exps = this.mem.expenses || [];
      exps.unshift({id: gid, expense_type_id: P.p_type_id || null, description: P.p_desc || null, account_id: Number(P.p_account_id), currency: cur, amount: amt, amount_usd: usd, exchange_rate: rate, expense_date: P.p_date || today, status: 'registrado', created_at: now});
      await this.saveTable('expenses', exps);
      await this.bumpAccount(P.p_account_id, -amt, 'gasto', P.p_desc || 'Gasto');
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: gid, label: `Gasto (${P.p_desc || 'sin descripción'}) · ${fmt(usd)} USD`});
      return {data: gid, error: null};
    }

    if (fnName === 'anular_gasto') {
      const id = Number(P.p_id);
      const g = (this.mem.expenses || []).find(x => Number(x.id) === id);
      if (g && g.status !== 'anulado') {
        g.status = 'anulado';
        await this.saveTable('expenses', this.mem.expenses);
        if (g.account_id) await this.bumpAccount(g.account_id, Number(g.amount), 'anulacion', 'Anulación gasto #' + id);
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Anular gasto #${id}`});
      return {data: true, error: null};
    }

    if (fnName === 'registrar_transferencia') {
      await this.bumpAccount(P.p_from, -Number(P.p_out), 'transferencia', P.p_note || 'Transferencia enviada');
      await this.bumpAccount(P.p_to, Number(P.p_in), 'transferencia', P.p_note || 'Transferencia recibida');
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Transferencia · ${fmt(P.p_out)}`});
      return {data: true, error: null};
    }

    if (fnName === 'registrar_ajuste_cuenta') {
      const cs = (this.mem.cuentas_saldo || []).find(a => Number(a.id) === Number(P.p_account_id));
      const diff = this.r2(Number(P.p_new_balance) - Number(cs?.balance || 0));
      await this.bumpAccount(P.p_account_id, diff, 'ajuste', P.p_note || 'Ajuste de saldo');
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Ajuste de cuenta (${cs?.name || '#' + P.p_account_id})`});
      return {data: true, error: null};
    }

    if (fnName === 'registrar_movimiento_capital') {
      const signed = P.p_kind === 'aporte' ? Math.abs(Number(P.p_amount)) : -Math.abs(Number(P.p_amount));
      await this.bumpAccount(P.p_account_id, signed, P.p_kind, P.p_note || (P.p_kind === 'aporte' ? 'Aporte de capital' : 'Retiro del dueño'));
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `${P.p_kind === 'aporte' ? 'Aporte de capital' : 'Retiro'} · ${fmt(P.p_amount)}`});
      return {data: {ok: true, kind: P.p_kind, amount: signed}, error: null};
    }

    if (fnName === 'registrar_cierre_caja') {
      const cid = this.nextTempId();
      const det = P.p_details || [];
      let tSys = 0, tCnt = 0;
      for (const d of det) {
        const cur = d.currency || 'USD';
        tSys += this.toUsdLocal(d.system_balance, cur, rate);
        tCnt += this.toUsdLocal(d.counted_balance, cur, rate);
        const diff = this.r2(Number(d.counted_balance) - Number(d.system_balance));
        if (P.p_apply_adjustments && Math.abs(diff) >= 0.01) {
          await this.bumpAccount(d.account_id, diff, 'ajuste', 'Arqueo cierre de caja (' + (P.p_date || today) + ')');
        }
      }
      const cls = this.mem.cash_closings || [];
      cls.unshift({
        id: cid, closing_date: P.p_date || today, exchange_rate: rate,
        total_system_usd: this.r2(tSys), total_counted_usd: this.r2(tCnt), diff_usd: this.r2(tCnt - tSys),
        details: det, by_method: P.p_by_method || [], adjustments_applied: !!P.p_apply_adjustments,
        note: P.p_note || null, closed_by: S?.userName || 'Usuario (local)', created_at: now
      });
      await this.saveTable('cash_closings', cls);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: cid, label: `Cierre de caja (${P.p_date || today})`});
      return {data: {id: cid, total_system_usd: this.r2(tSys), total_counted_usd: this.r2(tCnt), diff_usd: this.r2(tCnt - tSys)}, error: null};
    }

    if (fnName === 'crear_metodo_pago') {
      const name = String(P.p_name || '').trim();
      const code = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || ('metodo_' + Date.now());
      const pms = this.mem.payment_methods || [];
      let row = pms.find(m => m.code === code || String(m.name).toLowerCase() === name.toLowerCase());
      if (!row) {
        row = {id: this.nextTempId(), code, name, active: true};
        pms.push(row);
      } else {
        row.active = true;
      }
      await this.saveTable('payment_methods', pms);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: row.id, label: `Nuevo método: ${name}`});
      return {data: row, error: null};
    }

    if (fnName === 'marcar_cuenta_predeterminada') {
      for (const a of (this.mem.accounts || [])) a.is_default = Number(a.id) === Number(P.p_account_id);
      await this.saveTable('accounts', this.mem.accounts || []);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: 'Marcar cuenta principal'});
      return {data: true, error: null};
    }

    // ---- 5. AJUSTE MASIVO DE INVENTARIO ----
    if (fnName === 'ajuste_masivo2') {
      const mode = P.p_mode || 'conteo';
      let n = 0, inUsd = 0, outUsd = 0;
      for (const it of (P.p_items || [])) {
        const st = (this.mem.stock_actual || []).find(x => Number(x.product_id) === Number(it.product_id));
        const curSt = Number(st?.stock || 0), curCost = Number(st?.avg_cost_usd || 0);
        const delta = mode === 'conteo' ? this.r3(Number(it.qty) - curSt) : mode === 'ingreso' ? this.r3(Math.abs(Number(it.qty))) : this.r3(-Math.abs(Number(it.qty)));
        if (Math.abs(delta) < 0.0004) continue;
        const uc = delta > 0 ? Number(it.unit_cost_usd ?? curCost) : curCost;
        await this.bumpStock(it.product_id, delta, uc, (delta < 0 && P.p_reason === 'merma') ? 'merma' : 'ajuste', 'ajuste_masivo', null, P.p_note || null, delta > 0 && it.unit_cost_usd != null);
        if (delta > 0) inUsd += delta * uc; else outUsd += Math.abs(delta) * uc;
        n++;
      }
      if (P.p_fin === 'gasto' && outUsd > 0.004) {
        const exps = this.mem.expenses || [];
        exps.unshift({id: this.nextTempId(), expense_type_id: P.p_expense_type_id || null, description: P.p_note || 'Pérdida de inventario', account_id: null, currency: 'USD', amount: this.r2(outUsd), amount_usd: this.r2(outUsd), exchange_rate: rate, expense_date: today, status: 'registrado', created_at: now});
        await this.saveTable('expenses', exps);
      } else if (P.p_fin === 'pago' && inUsd > 0.004 && P.p_account_id) {
        const acc = accById(P.p_account_id);
        const amt = acc?.currency === 'USD' ? this.r2(inUsd) : this.r2(inUsd * rate);
        await this.bumpAccount(P.p_account_id, -amt, 'pago', P.p_note || 'Pago ajuste ingreso');
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Ajuste masivo (${n} productos)`});
      return {data: {n, ingreso_usd: this.r2(inUsd), perdida_usd: this.r2(outUsd)}, error: null};
    }

    // ---- 6. COTIZACIONES ----
    if (fnName === 'guardar_cotizacion') {
      const isEdit = P.p_id != null;
      const qid = isEdit ? Number(P.p_id) : this.nextTempId();
      const docType = P.p_doc_type || 'nota_entrega';
      let sub = 0, rawTax = 0;
      const qItems = (P.p_items || []).map(it => {
        const pr = prodById(it.product_id);
        const tx = taxes.find(x => Number(x.id) === Number(pr?.tax_id));
        const pct = docType === 'factura' ? Number(tx?.percent || 0) : 0;
        const ls = Number(it.quantity) * Number(it.unit_price_usd);
        sub += ls; rawTax += ls * pct / 100;
        return {id: this.nextTempId(), quote_id: qid, product_id: Number(it.product_id), quantity: Number(it.quantity), unit_price_usd: Number(it.unit_price_usd)};
      });
      const disc = Math.min(Number(P.p_discount_usd || 0), sub);
      const tax = sub > 0 ? this.r2(rawTax * (sub - disc) / sub) : 0;
      const total = this.r2(sub - disc + tax);
      const qRow = {id: qid, customer_id: P.p_customer_id || null, quote_date: today, valid_until: P.p_valid_until || null, doc_type: docType, exchange_rate: rate, subtotal_usd: this.r2(sub), discount_usd: this.r2(disc), tax_usd: tax, total_usd: total, status: 'abierta', notes: P.p_notes || null, created_at: now};
      const qs = (this.mem.quotes || []).filter(x => Number(x.id) !== qid);
      qs.unshift(qRow);
      await this.saveTable('quotes', qs);
      await this.saveTable('quote_items', [...(this.mem.quote_items || []).filter(x => Number(x.quote_id) !== qid), ...qItems]);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: isEdit ? null : qid, label: `Cotización · ${fmt(total)} USD`});
      return {data: qid, error: null};
    }

    // ---- 7. PRODUCCIÓN Y FÓRMULAS ----
    if (fnName === 'guardar_formula') {
      const isEdit = P.p_id != null;
      const rid = isEdit ? Number(P.p_id) : this.nextTempId();
      const recRow = {id: rid, product_id: Number(P.p_product_id), name: P.p_name, yield_qty: Number(P.p_yield || 1), notes: P.p_notes || null, active: true};
      const recs = (this.mem.recipes || []).filter(x => Number(x.id) !== rid);
      recs.push(recRow);
      await this.saveTable('recipes', recs);
      const rItems = (P.p_items || []).map(i => ({id: this.nextTempId(), recipe_id: rid, product_id: Number(i.product_id), quantity: Number(i.quantity)}));
      await this.saveTable('recipe_items', [...(this.mem.recipe_items || []).filter(x => Number(x.recipe_id) !== rid), ...rItems]);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: isEdit ? null : rid, label: `Fórmula: ${P.p_name}`});
      return {data: rid, error: null};
    }

    if (fnName === 'crear_orden_produccion') {
      const oid = this.nextTempId();
      const rec = (this.mem.recipes || []).find(r => Number(r.id) === Number(P.p_recipe_id));
      const prodId = Number(rec?.product_id || P.p_product_id || 0);
      const qtyP = Number(P.p_qty || 1);
      let totCost = 0;
      const pItems = (P.p_items || []).map(i => {
        const pr = prodById(i.product_id);
        const uc = Number(pr?.avg_cost_usd ?? pr?.manual_cost_usd ?? 0);
        totCost += Number(i.actual || 0) * uc;
        return {id: this.nextTempId(), production_id: oid, product_id: Number(i.product_id), planned_qty: Number(i.planned || 0), actual_qty: Number(i.actual || 0)};
      });
      const finish = !!P.p_finish;
      if (finish) {
        for (const it of pItems) {
          const pr = prodById(it.product_id);
          await this.bumpStock(it.product_id, -it.actual_qty, Number(pr?.avg_cost_usd || 0), 'produccion_consumo', 'production', oid, P.p_notes || null);
        }
        if (prodId) await this.bumpStock(prodId, qtyP, qtyP > 0 ? totCost / qtyP : 0, 'produccion_entrada', 'production', oid, P.p_notes || null, true);
      }
      const orders = this.mem.production_orders || [];
      orders.unshift({id: oid, recipe_id: P.p_recipe_id, product_id: prodId, qty_produced: qtyP, status: finish ? 'completada' : 'en_proceso', total_cost_usd: this.r2(totCost), notes: P.p_notes || null, produced_at: finish ? now : null, created_at: now});
      await this.saveTable('production_orders', orders);
      await this.saveTable('production_items', [...(this.mem.production_items || []), ...pItems]);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: oid, label: `Producción (${finish ? 'finalizada' : 'en proceso'})`});
      return {data: oid, error: null};
    }

    if (fnName === 'actualizar_orden_produccion') {
      const oid = Number(P.p_id);
      const o = (this.mem.production_orders || []).find(x => Number(x.id) === oid);
      let tot = 0;
      const pItems = (P.p_items || []).map(i => {
        const pr = prodById(i.product_id);
        tot += Number(i.actual || 0) * Number(pr?.avg_cost_usd || 0);
        return {id: this.nextTempId(), production_id: oid, product_id: Number(i.product_id), planned_qty: Number(i.planned || 0), actual_qty: Number(i.actual || 0)};
      });
      if (o) { o.qty_produced = Number(P.p_qty); o.notes = P.p_notes || null; o.total_cost_usd = this.r2(tot); await this.saveTable('production_orders', this.mem.production_orders); }
      await this.saveTable('production_items', [...(this.mem.production_items || []).filter(x => Number(x.production_id) !== oid), ...pItems]);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Editar producción #${oid}`});
      return {data: true, error: null};
    }

    if (fnName === 'finalizar_produccion') {
      const oid = Number(P.p_id);
      const o = (this.mem.production_orders || []).find(x => Number(x.id) === oid);
      if (o && o.status === 'en_proceso') {
        const items = (this.mem.production_items || []).filter(x => Number(x.production_id) === oid);
        let tot = 0;
        for (const it of items) {
          const pr = prodById(it.product_id), uc = Number(pr?.avg_cost_usd || 0);
          tot += Number(it.actual_qty) * uc;
          await this.bumpStock(it.product_id, -Number(it.actual_qty), uc, 'produccion_consumo', 'production', oid, o.notes);
        }
        await this.bumpStock(o.product_id, Number(o.qty_produced), o.qty_produced > 0 ? tot / o.qty_produced : 0, 'produccion_entrada', 'production', oid, o.notes, true);
        o.status = 'completada'; o.total_cost_usd = this.r2(tot); o.produced_at = now;
        await this.saveTable('production_orders', this.mem.production_orders);
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Finalizar producción #${oid}`});
      return {data: true, error: null};
    }

    if (fnName === 'anular_produccion') {
      const oid = Number(P.p_id);
      const o = (this.mem.production_orders || []).find(x => Number(x.id) === oid);
      if (o && o.status !== 'anulada') {
        if (o.status === 'completada') {
          for (const it of (this.mem.production_items || []).filter(x => Number(x.production_id) === oid)) {
            await this.bumpStock(it.product_id, Number(it.actual_qty), null, 'ajuste', 'production', oid, 'Anulación producción #' + oid);
          }
          await this.bumpStock(o.product_id, -Number(o.qty_produced), null, 'ajuste', 'production', oid, 'Anulación producción #' + oid);
        }
        o.status = 'anulada';
        await this.saveTable('production_orders', this.mem.production_orders);
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Anular producción #${oid}`});
      return {data: true, error: null};
    }

    // ---- 8. NÓMINA Y ADELANTOS ----
    if (fnName === 'registrar_adelanto') {
      const aid = this.nextTempId();
      const acc = accById(P.p_account_id);
      const usd = this.r2(P.p_amount_usd);
      const amt = acc?.currency === 'USD' ? usd : this.r2(usd * rate);
      const advs = this.mem.employee_advances || [];
      advs.unshift({id: aid, employee_id: Number(P.p_employee_id), advance_date: today, amount_usd: usd, note: P.p_note || null, discounted_run_id: null, created_at: now});
      await this.saveTable('employee_advances', advs);
      await this.bumpAccount(P.p_account_id, -amt, 'adelanto', P.p_note || 'Adelanto de nómina');
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: aid, label: `Adelanto · ${fmt(usd)} USD`});
      return {data: aid, error: null};
    }

    if (fnName === 'registrar_nomina') {
      const rid = this.nextTempId();
      const acc = accById(P.p_account_id);
      let netUsd = 0;
      const pItems = [], advIdsAll = new Set();
      for (const it of (P.p_items || [])) {
        const advIds = it.advance_ids || [];
        let advSum = 0;
        for (const adId of advIds) {
          advIdsAll.add(Number(adId));
          const a = (this.mem.employee_advances || []).find(x => Number(x.id) === Number(adId));
          if (a) { advSum += Number(a.amount_usd || 0); a.discounted_run_id = rid; }
        }
        const net = this.r2(Number(it.base || 0) + Number(it.bonus || 0) - Number(it.deduction || 0) - advSum);
        netUsd += net;
        pItems.push({id: this.nextTempId(), run_id: rid, employee_id: Number(it.employee_id), base_usd: Number(it.base || 0), bonus_usd: Number(it.bonus || 0), deduction_usd: Number(it.deduction || 0), advance_usd: this.r2(advSum), net_usd: net, note: it.note || null});
      }
      netUsd = this.r2(netUsd);
      const runs = this.mem.payroll_runs || [];
      runs.unshift({id: rid, period_start: P.p_start, period_end: P.p_end, pay_date: P.p_pay_date || today, pay_type: P.p_pay_type, account_id: Number(P.p_account_id), exchange_rate: rate, net_usd: netUsd, status: 'pagada', notes: P.p_notes || null, created_at: now});
      await this.saveTable('payroll_runs', runs);
      await this.saveTable('payroll_items', [...(this.mem.payroll_items || []), ...pItems]);
      await this.saveTable('employee_advances', this.mem.employee_advances || []);
      const amt = acc?.currency === 'USD' ? netUsd : this.r2(netUsd * rate);
      await this.bumpAccount(P.p_account_id, -amt, 'nomina', 'Nómina #' + rid);
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, temp_id: rid, label: `Nómina · ${fmt(netUsd)} USD`});
      return {data: rid, error: null};
    }

    if (fnName === 'anular_nomina') {
      const rid = Number(P.p_id);
      const r = (this.mem.payroll_runs || []).find(x => Number(x.id) === rid);
      if (r && r.status === 'pagada') {
        r.status = 'anulada';
        await this.saveTable('payroll_runs', this.mem.payroll_runs);
        for (const a of (this.mem.employee_advances || [])) if (Number(a.discounted_run_id) === rid) a.discounted_run_id = null;
        await this.saveTable('employee_advances', this.mem.employee_advances || []);
        const acc = accById(r.account_id);
        const amt = acc?.currency === 'USD' ? Number(r.net_usd) : this.r2(Number(r.net_usd) * Number(r.exchange_rate || rate));
        await this.bumpAccount(r.account_id, amt, 'anulacion', 'Anulación nómina #' + rid);
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Anular nómina #${rid}`});
      return {data: true, error: null};
    }

    // ---- 9. APERTURA DE NEGOCIO Y RECALCULO ----
    if (fnName === 'guardar_apertura_negocio') {
      for (const c of (P.p_cuentas || [])) {
        const cs = (this.mem.cuentas_saldo || []).find(a => Number(a.id) === Number(c.id));
        if (cs) cs.balance = this.r2(c.opening_balance);
      }
      await this.saveTable('cuentas_saldo', this.mem.cuentas_saldo || []);
      for (const inv of (P.p_inventario || [])) {
        const st = (this.mem.stock_actual || []).find(s => Number(s.product_id) === Number(inv.product_id));
        if (st && inv.stock != null) {
          const delta = this.r3(Number(inv.stock) - Number(st.stock || 0));
          await this.bumpStock(inv.product_id, delta, inv.unit_cost_usd, 'ajuste', 'apertura', null, 'Inventario inicial', inv.unit_cost_usd != null);
        }
      }
      const cajaUsd = (this.mem.cuentas_saldo || []).filter(a => a.active !== false).reduce((s, a) => s + this.toUsdLocal(a.balance, a.currency, rate), 0);
      const invUsd = (this.mem.stock_actual || []).reduce((s, x) => s + Number(x.valor_usd || 0), 0);
      const cap = this.r2(cajaUsd + invUsd);
      if (this.mem.settings?.[0]) {
        Object.assign(this.mem.settings[0], {apertura_completada: true, fecha_apertura: P.p_fecha || today, capital_inicial_usd: cap});
        await this.saveTable('settings', this.mem.settings);
      }
      if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P, label: `Saldos iniciales · Capital ${fmt(cap)} USD`});
      return {data: {capital_inicial_usd: cap}, error: null};
    }

    // Cualquier otra RPC (ej: recalcular_costos): encolar y devolver OK
    if (enqueue) await this.enqueueOp({kind: 'rpc', rpc_name: fnName, payload: P});
    return {data: true, error: null};
  },

  // ---------- Proxy Transparente de Supabase ----------
  wrapClient(rawDb) {
    this.rawDb = rawDb;
    const self = this;

    const buildQuery = (table) => {
      const spec = {
        table,
        op: 'select',
        selectCols: '*',
        payload: null,
        filters: [],
        orders: [],
        limit: null,
        range: null,
        single: false,
        maybeSingle: false,
        returnSelect: false
      };

      const replayOnline = () => {
        let qb = rawDb.from(spec.table);
        if (spec.op === 'select') qb = qb.select(spec.selectCols);
        else if (spec.op === 'insert') qb = qb.insert(spec.payload);
        else if (spec.op === 'update') qb = qb.update(spec.payload);
        else if (spec.op === 'delete') qb = qb.delete();
        else if (spec.op === 'upsert') qb = qb.upsert(spec.payload);
        if (spec.op !== 'select' && spec.returnSelect) qb = qb.select(spec.selectCols);
        for (const f of spec.filters) qb = qb[f.op](f.col, f.val);
        for (const o of spec.orders) qb = qb.order(o.col, {ascending: o.asc});
        if (spec.range) qb = qb.range(spec.range[0], spec.range[1]);
        else if (spec.limit != null) qb = qb.limit(spec.limit);
        if (spec.single) qb = qb.single();
        else if (spec.maybeSingle) qb = qb.maybeSingle();
        return qb;
      };

      const execute = async () => {
        await self.ensureReady();
        spec.cacheKey = `q:${spec.table}:${spec.selectCols}:${JSON.stringify(spec.filters)}:${JSON.stringify(spec.orders)}:${spec.limit}:${JSON.stringify(spec.range)}:${spec.single}:${spec.maybeSingle}`;

        // ----- LECTURAS -----
        if (spec.op === 'select') {
          if (!self.isOffline() && self.ops.length === 0) {
            try {
              const res = await self.withTimeout(replayOnline(), 9500);
              if (!res.error) {
                self.saveQCache(spec.cacheKey, res.data);
                if (spec.selectCols === '*' && !spec.filters.length && !spec.range && spec.limit == null && Array.isArray(res.data)) {
                  self.saveTable(spec.table, res.data);
                }
              }
              return res;
            } catch (err) {
              if (!self.isNetError(err)) return {data: null, error: err};
              // Caída de señal -> continuar al motor local
            }
          } else if (!self.isOffline() && self.ops.length > 0 && !self.syncing) {
            setTimeout(() => self.syncNow(false), 300);
          }
          return self.execLocalSelect(spec);
        }

        // ----- ESCRITURAS -----
        if (!self.isOffline() && self.ops.length === 0) {
          try {
            const res = await self.withTimeout(replayOnline(), 10500);
            if (!res.error) {
              // Mantener espejo local actualizado con el dato real del servidor
              if (spec.op === 'insert' && res.data) {
                const arr = Array.isArray(res.data) ? res.data : [res.data];
                const rows = Array.isArray(self.mem[spec.table]) ? self.mem[spec.table] : [];
                for (const item of arr) {
                  if (item && item.id != null && !rows.some(r => String(r.id) === String(item.id))) rows.push(item);
                  if (spec.table === 'products') await self.syncProductToStockActual(item);
                  if (spec.table === 'accounts') await self.syncAccountToCuentasSaldo(item, true);
                }
                await self.saveTable(spec.table, rows);
              } else {
                await self.applyLocalWrite(spec, false);
              }
              setTimeout(() => self.refreshAll(true), 800);
            }
            return res;
          } catch (err) {
            if (!self.isNetError(err)) return {data: null, error: err};
            // Señal caída al guardar -> guardar en local y encolar
            const localRes = await self.applyLocalWrite(spec, true);
            toast('Sin señal: guardado en este dispositivo (se sincronizará al reconectar)');
            return localRes;
          }
        }

        const localRes = await self.applyLocalWrite(spec, true);
        if (!self.isOffline() && !self.syncing) setTimeout(() => self.syncNow(false), 400);
        return localRes;
      };

      const api = {
        select(cols = '*') {
          if (spec.op !== 'select') spec.returnSelect = true;
          spec.selectCols = cols;
          return api;
        },
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

    const callRpc = async (fnName, params) => {
      await self.ensureReady();

      if (OFF_ONLINE_ONLY_RPCS.has(fnName)) {
        if (self.isOffline()) return {data: null, error: new Error('Esta acción de seguridad requiere conexión a internet')};
        return rawDb.rpc(fnName, params);
      }

      // RPCs de solo lectura
      if (OFF_READ_RPCS.has(fnName)) {
        const key = `rpc:${fnName}:${JSON.stringify(params || {})}`;
        if (!self.isOffline() && self.ops.length === 0) {
          try {
            const res = await self.withTimeout(rawDb.rpc(fnName, params), 9500);
            if (!res.error) self.saveQCache(key, res.data);
            return res;
          } catch (err) {
            if (!self.isNetError(err)) return {data: null, error: err};
          }
        }
        return self.execLocalReadRpc(fnName, params);
      }

      // RPCs de escritura
      if (!self.isOffline() && self.ops.length === 0) {
        // Para nuevas ventas, usar registrar_venta_offline con client_tx_id para proteger contra cortes a mitad del envío
        let txId = null;
        if (fnName === 'registrar_venta' && (params?.p_id == null)) {
          txId = self.uuid();
          try {
            const res = await self.withTimeout(rawDb.rpc('registrar_venta_offline', {
              p_client_tx_id: txId,
              p_customer_id: params.p_customer_id ?? null,
              p_doc_type: params.p_doc_type,
              p_rate: params.p_rate,
              p_discount_usd: params.p_discount_usd,
              p_due_date: params.p_due_date ?? null,
              p_notes: params.p_notes ?? null,
              p_items: params.p_items,
              p_payments: params.p_payments,
              p_sale_date: typeof caracasDate === 'function' ? caracasDate() : null
            }), 10500);
            if (!res.error) {
              setTimeout(() => self.refreshAll(true), 600);
              return res;
            }
            if (res.error.code !== 'PGRST202' && !/registrar_venta_offline/i.test(res.error.message || '')) {
              return res;
            }
          } catch (err) {
            if (self.isNetError(err)) {
              const localRes = await self.applyLocalWriteRpc('registrar_venta_offline', {...params, p_client_tx_id: txId}, true);
              toast('Señal inestable: venta guardada sin conexión (se subirá automáticamente)');
              return localRes;
            }
          }
        }

        try {
          const res = await self.withTimeout(rawDb.rpc(fnName, params), 11000);
          if (!res.error) {
            setTimeout(() => self.refreshAll(true), 700);
          }
          return res;
        } catch (err) {
          if (!self.isNetError(err)) return {data: null, error: err};
          const localRes = await self.applyLocalWriteRpc(fnName, txId ? {...params, p_client_tx_id: txId} : params, true);
          toast('Sin señal: operación guardada en este dispositivo (se subirá al reconectar)');
          return localRes;
        }
      }

      const localRes = await self.applyLocalWriteRpc(fnName, params, true);
      if (!self.isOffline() && !self.syncing) setTimeout(() => self.syncNow(false), 400);
      return localRes;
    };

    const storageProxy = {
      from(bucket) {
        const real = rawDb.storage.from(bucket);
        return {
          upload(path, body, opts) {
            if (self.isOffline()) return Promise.resolve({data: null, error: new Error('OFFLINE_STORAGE')});
            return self.withTimeout(real.upload(path, body, opts), 15000);
          },
          getPublicUrl(path) { return real.getPublicUrl(path); },
          remove(paths) { return real.remove(paths); }
        };
      }
    };

    return {
      auth: rawDb.auth,
      storage: storageProxy,
      from: buildQuery,
      rpc: callRpc,
      _raw: rawDb
    };
  },

  // ---------- Resolución recursiva de IDs temporales negativos -> IDs reales ----------
  resolveIds(val) {
    if (val === null || val === undefined) return val;
    if (typeof val === 'number' && val < 0 && this.idmap[String(val)] !== undefined) {
      return this.idmap[String(val)];
    }
    if (typeof val === 'string' && /^-\d+$/.test(val) && this.idmap[val] !== undefined) {
      return String(this.idmap[val]);
    }
    if (Array.isArray(val)) return val.map(x => this.resolveIds(x));
    if (typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = this.resolveIds(v);
      return out;
    }
    return val;
  },

  // ---------- Motor de Sincronización Universal ----------
  async syncNow(manual = false) {
    await this.ensureReady();
    if (this.syncing) return {synced: 0, failed: 0, remaining: this.ops.length};
    if (this.isOffline() || !this.rawDb) {
      if (manual) toast(this.forceOffline ? 'Desactiva "Forzar modo sin conexión" para subir los cambios' : 'Aún sin conexión a internet', true);
      return {synced: 0, failed: 0, remaining: this.ops.length};
    }
    if (!this.ops.length) {
      if (manual) toast('Todo está sincronizado en la nube');
      this.paintBar();
      return {synced: 0, failed: 0, remaining: 0};
    }

    this.syncing = true;
    this.paintBar();
    let synced = 0, failed = 0, netStopped = false;
    let hasOpLog = true;

    try {
      const snapshot = [...this.ops];
      for (const op of snapshot) {
        if (this.isOffline()) { netStopped = true; break; }
        try {
          const payload = this.resolveIds(op.payload);
          const filters = this.resolveIds(op.filters || []);
          let serverRes = null;

          // Verificar idempotencia en offline_ops_log si está instalado (Paso 23 SQL)
          let alreadyDone = false;
          if (hasOpLog && op.rpc_name !== 'registrar_venta_offline') {
            try {
              const chk = await this.withTimeout(this.rawDb.rpc('offline_op_check', {p_op_id: op.op_id}), 8000);
              if (chk.error) {
                if (chk.error.code === 'PGRST202' || /offline_op_check/i.test(chk.error.message || '')) hasOpLog = false;
              } else if (chk.data?.done) {
                alreadyDone = true;
                serverRes = chk.data.result;
              }
            } catch (e) {
              if (this.isNetError(e)) throw e;
              hasOpLog = false;
            }
          }

          if (!alreadyDone) {
            if (op.kind === 'insert') {
              let qb = this.rawDb.from(op.table).insert(payload);
              if (op.temp_id != null) qb = qb.select('id').single();
              const r = await this.withTimeout(qb, 14000);
              if (r.error) throw r.error;
              serverRes = r.data?.id ?? r.data;
            } else if (op.kind === 'update') {
              let qb = this.rawDb.from(op.table).update(payload);
              for (const f of filters) qb = qb[f.op](f.col, f.val);
              const r = await this.withTimeout(qb, 14000);
              if (r.error) throw r.error;
              serverRes = true;
            } else if (op.kind === 'delete') {
              let qb = this.rawDb.from(op.table).delete();
              for (const f of filters) qb = qb[f.op](f.col, f.val);
              const r = await this.withTimeout(qb, 14000);
              if (r.error) throw r.error;
              serverRes = true;
            } else if (op.kind === 'rpc') {
              let r;
              if (op.rpc_name === 'registrar_venta_offline') {
                r = await this.withTimeout(this.rawDb.rpc('registrar_venta_offline', payload), 15000);
                if (r.error && (r.error.code === 'PGRST202' || /registrar_venta_offline/i.test(r.error.message || ''))) {
                  const fallbackP = {...payload, p_id: null};
                  delete fallbackP.p_client_tx_id; delete fallbackP.p_sale_date;
                  r = await this.withTimeout(this.rawDb.rpc('registrar_venta', fallbackP), 15000);
                }
              } else {
                r = await this.withTimeout(this.rawDb.rpc(op.rpc_name, payload), 15000);
              }
              if (r.error) throw r.error;
              serverRes = r.data;
            }

            if (hasOpLog && op.rpc_name !== 'registrar_venta_offline') {
              this.rawDb.rpc('offline_op_mark', {p_op_id: op.op_id, p_action: op.rpc_name || (op.kind + ':' + op.table), p_result: serverRes ?? null}).catch(() => {});
            }
          }

          // Mapear ID temporal negativo -> ID real de Supabase
          if (op.temp_id != null && Number(op.temp_id) < 0) {
            const realId = typeof serverRes === 'number' ? serverRes : (serverRes && typeof serverRes === 'object' && serverRes.id != null ? serverRes.id : null);
            if (realId != null) {
              this.idmap[String(op.temp_id)] = realId;
              await this.saveIdMap();
            }
          }

          await this.removeOp(op.op_id);
          synced++;
        } catch (err) {
          if (this.isNetError(err)) { netStopped = true; break; }
          failed++;
          await this.updateOp({...op, last_error: err.message || 'Error al sincronizar'});
          // Si esta operación creaba un ID temporal que operaciones posteriores podrían necesitar, pausar para mantener consistencia
          if (op.temp_id != null) break;
        }
      }
    } finally {
      this.syncing = false;
      if (this.ops.length === 0) {
        this.idmap = {};
        await this.saveIdMap();
      }
      this.paintBar();

      if (synced > 0) {
        toast(`${synced} ${synced === 1 ? 'operación sincronizada' : 'operaciones sincronizadas'} con Supabase`);
        if (this.ops.length === 0) {
          await this.refreshAll(true);
        }
        try { render(); } catch (e) {}
      } else if (manual && netStopped) {
        toast('Señal interrumpida al subir. Se reintentará automáticamente.', true);
      } else if (manual && failed > 0) {
        toast(`${failed} operación(es) con error. Revísalas en Modo sin conexión.`, true);
      }
    }
    return {synced, failed, remaining: this.ops.length};
  },

  // ---------- Barra de estado ----------
  paintBar() {
    const bar = document.querySelector('#netBar');
    if (!bar) return;
    const n = this.ops.length;
    const off = this.isOffline();

    if (!off && n === 0 && !this.syncing) {
      bar.className = 'hidden';
      bar.innerHTML = '';
      return;
    }
    if (this.syncing) {
      bar.className = 'netbar sync';
      bar.innerHTML = `<span>Sincronizando cambios pendientes (${n})...</span>`;
      return;
    }
    if (off) {
      bar.className = 'netbar off';
      bar.innerHTML = `<span><b>Sin internet${this.forceOffline ? ' (manual)' : ''}</b> · Modo local activo${n ? ` · ${n} pendiente${n === 1 ? '' : 's'}` : ''}</span>
        <button type="button" class="netbar-btn" id="nbOpen">${n ? 'Ver cola' : 'Opciones'}</button>`;
      const nbO = document.querySelector('#nbOpen'); if (nbO) nbO.onclick = () => go('offline');
      return;
    }
    bar.className = 'netbar pend';
    bar.innerHTML = `<span><b>${n} ${n === 1 ? 'cambio pendiente' : 'cambios pendientes'}</b> por subir a Supabase</span>
      <button type="button" class="netbar-btn" id="nbSync">Sincronizar</button>`;
    const nbS = document.querySelector('#nbSync'); if (nbS) nbS.onclick = () => this.syncNow(true);
  },

  // Pantalla de respaldo solo si aún no existe espejo local descargado
  async renderOfflineHome() {
    await this.ensureReady();
    $('#view').innerHTML = `
      <div class="card stack" style="border-left:5px solid var(--tag)">
        <h2>Sin conexión a internet</h2>
        <p class="mut" style="margin:0">Conéctate a internet una vez y pulsa <b>Actualizar datos offline</b> para descargar tu catálogo, cuentas, clientes y reportes a este dispositivo. Luego toda la app abrirá y trabajará sin señal.</p>
        <div class="row">
          <button class="btn" id="ohTry">Reintentar conexión</button>
          <button class="btn ghost" data-go="offline">Ver estado offline (${this.ops.length})</button>
        </div>
      </div>`;
    $('#ohTry').onclick = () => run(async () => {
      if (this.forceOffline) {
        this.forceOffline = false;
        try { localStorage.setItem(this.FORCE_KEY, '0'); } catch (e) {}
      }
      if (!navigator.onLine) return toast('El dispositivo sigue sin señal', true);
      await this.syncNow(true);
      await this.refreshAll(false);
      render();
    });
  },

  init() {
    this.initState();
    this.ensureReady();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                if (typeof toast === 'function') toast('Nueva versión instalada. Recarga para actualizar.');
              }
            });
          });
        }).catch(() => {});
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.installPrompt = e;
    });

    window.addEventListener('online', () => {
      this.paintBar();
      if (!this.forceOffline) {
        if (typeof toast === 'function') toast('Señal recuperada');
        setTimeout(() => {
          if (this.ops.length > 0) this.syncNow(false);
          else this.refreshAll(true);
        }, 1200);
      }
    });

    window.addEventListener('offline', () => {
      this.paintBar();
      if (typeof toast === 'function') toast('Sin internet: toda la herramienta continúa trabajando en modo local');
    });

    setInterval(() => {
      if (!this.isOffline() && !this.syncing && this.ops.length > 0 && this.rawDb) {
        this.syncNow(false);
      }
    }, 30000);
  }
};

// ---------- Pantalla: Modo sin conexión y Cola Universal ----------
async function viewOffline() {
  await OFF.ensureReady();
  const onlineNow = !OFF.isOffline();
  const qList = OFF.ops;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const nTables = Object.keys(OFF.mem).filter(k => Array.isArray(OFF.mem[k])).length;
  const nProds = (OFF.mem.products || []).filter(p => p.active !== false).length;
  const nParties = (OFF.mem.parties || []).filter(p => p.active !== false).length;
  const nAccs = (OFF.mem.accounts || []).filter(a => a.active !== false).length;

  $('#view').innerHTML = `
    <div class="card stack">
      <h2>Modo 100% sin internet</h2>
      <div class="rl"><span>Estado de red</span><b class="${onlineNow ? 'pos' : 'neg'}">${onlineNow ? 'En línea' : (OFF.forceOffline ? 'Sin conexión (forzado)' : 'Sin internet')}</b></div>
      <div class="rl"><span>Cambios pendientes por subir</span><b class="${qList.length ? 'neg' : 'pos'}">${qList.length}</b></div>
      <div class="rl"><span>Tablas replicadas localmente</span><b>${nTables} de ${OFF_MIRROR_SPEC.length}</b></div>
      <div class="rl"><span>Productos / Contactos / Cuentas</span><b>${nProds} / ${nParties} / ${nAccs}</b></div>
      <div class="rl"><span>Última réplica completa</span><b>${OFF.meta?.lastMirrorAt ? fdate(OFF.meta.lastMirrorAt) : 'Pendiente'}</b></div>

      <label class="chk" style="margin-top:.3rem">
        <input type="checkbox" id="offForce" ${OFF.forceOffline ? 'checked' : ''}>
        Forzar modo sin conexión (trabaja 100% local al instante si tu señal está muy lenta o cayéndose)
      </label>

      <div class="row">
        <button class="btn" id="offSyncBtn" ${onlineNow ? '' : 'disabled'}>Sincronizar ahora (${qList.length})</button>
        <button class="btn ghost" id="offPrepBtn" ${onlineNow && !qList.length ? '' : 'disabled'}>Actualizar réplica offline</button>
      </div>
      ${qList.length ? '<p class="mut" style="margin:0">Cuando se sincronicen los cambios pendientes, la réplica local se actualizará automáticamente con los datos finales de Supabase.</p>' : ''}
    </div>

    <div class="card stack">
      <h2>Cola de sincronización (${qList.length})</h2>
      ${qList.length ? `<div class="list" id="offQL">${qList.map((op, i) => `
        <div class="item" style="flex-direction:column;align-items:stretch;gap:.4rem" data-op="${esc(op.op_id)}">
          <div class="row0" style="justify-content:space-between">
            <span>
              <b>#${i + 1} · ${esc(op.label)}</b>
              <small>${fdate(op.created_at)} · ${esc(op.rpc_name || (op.kind + ' ' + op.table))}</small>
            </span>
            <span class="badge ${op.last_error ? 'out' : 'low'}">${op.last_error ? 'Error' : 'Pendiente'}</span>
          </div>
          ${op.last_error ? `<small class="bad">Error del servidor: ${esc(op.last_error)}</small>` : ''}
          <div class="row" style="margin-top:.15rem">
            ${op.last_error ? `<button type="button" class="btn ghost" data-odel="${esc(op.op_id)}" style="color:var(--bad)">Descartar operación</button>` : ''}
          </div>
        </div>`).join('')}</div>
        ${qList.some(x => x.last_error) ? '' : '<p class="mut" style="margin:0">Se subirán en orden estricto apenas detecte señal.</p>'}`
      : '<p class="mut" style="margin:0">No hay cambios pendientes. Todo está guardado en Supabase.</p>'}
    </div>

    <div class="card stack">
      <h2>Instalar como aplicación (PWA)</h2>
      ${isStandalone
        ? '<p class="pos" style="margin:0"><b>Ya estás usando la app instalada en tu dispositivo.</b></p>'
        : OFF.installPrompt
          ? '<p class="mut" style="margin:0">Instala Gestor de Negocio en tu pantalla de inicio para abrirlo y usarlo en cualquier lugar sin internet.</p><button class="btn" id="offInstall">Instalar en este dispositivo</button>'
          : '<p class="mut" style="margin:0"><b>En Android (Chrome):</b> menú (⋮) → <i>Instalar aplicación</i>.<br><b>En iPhone (Safari):</b> Compartir → <i>Agregar a inicio</i>.</p>'}
    </div>`;

  $('#offForce').onchange = (e) => {
    OFF.forceOffline = e.target.checked;
    try { localStorage.setItem(OFF.FORCE_KEY, OFF.forceOffline ? '1' : '0'); } catch (err) {}
    OFF.paintBar();
    toast(OFF.forceOffline ? 'Modo local forzado activado' : 'Modo automático restaurado');
    if (!OFF.forceOffline && navigator.onLine && OFF.ops.length) OFF.syncNow(false);
    render();
  };

  $('#offSyncBtn').onclick = () => run(async () => { await OFF.syncNow(true); render(); });
  $('#offPrepBtn').onclick = () => run(async () => { toast('Descargando réplica completa...'); await OFF.refreshAll(false); render(); });

  if ($('#offInstall')) {
    $('#offInstall').onclick = () => run(async () => {
      if (!OFF.installPrompt) return;
      OFF.installPrompt.prompt();
      const ch = await OFF.installPrompt.userChoice;
      OFF.installPrompt = null;
      if (ch?.outcome === 'accepted') toast('Aplicación instalada');
      render();
    });
  }

  if ($('#offQL')) {
    $('#offQL').onclick = (e) => {
      const dl = e.target.closest('[data-odel]');
      if (!dl) return;
      run(async () => {
        if (!confirm('¿Descartar esta operación con error de la cola? No se subirá a Supabase.')) return;
        await OFF.removeOp(dl.dataset.odel);
        toast('Operación descartada');
        render();
      });
    };
  }
}

OFF.init();
