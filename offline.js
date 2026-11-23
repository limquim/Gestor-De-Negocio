// Modo Sin Internet (Offline-First + Cola de Sincronización + PWA)
const OFF = {
  dbPromise: null,
  syncing: false,
  forceOffline: false,
  installPrompt: null,
  queueCache: [],
  BOOT_KEY: 'gdn_boot_v22',
  FORCE_KEY: 'gdn_force_offline',
  Q_LS_KEY: 'gdn_offline_queue_v22',
  SNAP_LS_KEY: 'gdn_offline_snap_v22',

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
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '-' + Math.random().toString(36).slice(2, 6);
  },

  // ---------- IndexedDB con respaldo automático en localStorage ----------
  openDB() {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('gestor_negocio_offline_v1', 1);
        req.onupgradeneeded = (e) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('kv')) idb.createObjectStore('kv');
          if (!idb.objectStoreNames.contains('queue')) idb.createObjectStore('queue', {keyPath: 'local_id'});
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return this.dbPromise;
  },

  async kvSet(key, val) {
    const idb = await this.openDB();
    if (idb) {
      try {
        await new Promise((res, rej) => {
          const tx = idb.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(val, key);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
        return;
      } catch (e) {}
    }
    try { localStorage.setItem(this.SNAP_LS_KEY + '_' + key, JSON.stringify(val)); } catch (e) {}
  },

  async kvGet(key) {
    const idb = await this.openDB();
    if (idb) {
      try {
        const val = await new Promise((res, rej) => {
          const tx = idb.transaction('kv', 'readonly');
          const r = tx.objectStore('kv').get(key);
          r.onsuccess = () => res(r.result ?? null);
          r.onerror = () => rej(r.error);
        });
        if (val !== null) return val;
      } catch (e) {}
    }
    try {
      const raw = localStorage.getItem(this.SNAP_LS_KEY + '_' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  // ---------- Datos ligeros de arranque (sesión, tasa, rol, métodos) ----------
  saveBoot(patch) {
    try {
      const cur = this.loadBoot() || {};
      const next = {...cur, ...patch, savedAt: new Date().toISOString()};
      localStorage.setItem(this.BOOT_KEY, JSON.stringify(next));
    } catch (e) {}
  },

  loadBoot() {
    try {
      const raw = localStorage.getItem(this.BOOT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  clearSessionHint() {
    try {
      const cur = this.loadBoot();
      if (cur) { delete cur.sessionEmail; localStorage.setItem(this.BOOT_KEY, JSON.stringify(cur)); }
    } catch (e) {}
  },

  // ---------- Cola de ventas sin conexión ----------
  async getQueue() {
    const idb = await this.openDB();
    let list = null;
    if (idb) {
      try {
        list = await new Promise((res, rej) => {
          const tx = idb.transaction('queue', 'readonly');
          const r = tx.objectStore('queue').getAll();
          r.onsuccess = () => res(r.result || []);
          r.onerror = () => rej(r.error);
        });
      } catch (e) { list = null; }
    }
    if (list === null) {
      try { list = JSON.parse(localStorage.getItem(this.Q_LS_KEY) || '[]'); } catch (e) { list = []; }
    }
    list.sort((a, b) => (a.seq || 0) - (b.seq || 0) || String(a.created_at).localeCompare(String(b.created_at)));
    this.queueCache = list;
    return list;
  },

  async putQueueItem(item) {
    const idb = await this.openDB();
    if (idb) {
      try {
        await new Promise((res, rej) => {
          const tx = idb.transaction('queue', 'readwrite');
          tx.objectStore('queue').put(item);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      } catch (e) {}
    }
    // Espejo en localStorage como doble respaldo de seguridad
    try {
      const arr = JSON.parse(localStorage.getItem(this.Q_LS_KEY) || '[]').filter(x => x.local_id !== item.local_id);
      arr.push(item);
      localStorage.setItem(this.Q_LS_KEY, JSON.stringify(arr));
    } catch (e) {}
    await this.getQueue();
    this.paintBar();
  },

  async removeQueueItem(localId) {
    const idb = await this.openDB();
    if (idb) {
      try {
        await new Promise((res, rej) => {
          const tx = idb.transaction('queue', 'readwrite');
          tx.objectStore('queue').delete(localId);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      } catch (e) {}
    }
    try {
      const arr = JSON.parse(localStorage.getItem(this.Q_LS_KEY) || '[]').filter(x => x.local_id !== localId);
      localStorage.setItem(this.Q_LS_KEY, JSON.stringify(arr));
    } catch (e) {}
    await this.getQueue();
    this.paintBar();
  },

  async queueSale(record) {
    const cur = await this.getQueue();
    const seq = (cur.reduce((m, x) => Math.max(m, x.seq || 0), 0)) + 1;
    const item = {
      ...record,
      seq,
      local_id: record.local_id || ('OFF-' + seq + '-' + String(Date.now()).slice(-4)),
      client_tx_id: record.client_tx_id || this.uuid(),
      created_at: record.created_at || new Date().toISOString(),
      last_error: null
    };
    await this.putQueueItem(item);
    return item;
  },

  // ---------- Instantánea de datos para vender sin internet ----------
  async saveSnapshot(patch) {
    const cur = (await this.kvGet('snapshot')) || {};
    const next = {...cur, ...patch, updatedAt: new Date().toISOString()};
    await this.kvSet('snapshot', next);
    return next;
  },

  async getSnapshot() {
    return (await this.kvGet('snapshot')) || {};
  },

  async getAdjustedStockMap(baseSt) {
    const st = {...(baseSt || {})};
    const qList = await this.getQueue();
    qList.forEach(rec => {
      (rec.payload?.p_items || []).forEach(it => {
        if (st[it.product_id] !== undefined) {
          st[it.product_id] = Math.round((Number(st[it.product_id]) - Number(it.quantity || 0)) * 1000) / 1000;
        }
      });
    });
    return st;
  },

  async addTempCustomer(name, phone) {
    const temp = {id: 'OFFC-' + Date.now(), name: name.trim(), phone: phone || null, offline: true};
    const snap = await this.getSnapshot();
    const custs = [...(snap.custs || []), temp];
    await this.saveSnapshot({custs});
    return temp;
  },

  async refreshSnapshot(silent = true) {
    if (this.isOffline() || !db) return null;
    try {
      const [products, stockRows, custs, accs, set] = await this.withTimeout(Promise.all([
        q(db.from('products').select('id,name,sku,unit,sale_price_usd,is_service,taxes(percent)').eq('active', true).order('name')),
        q(db.from('stock_actual').select('*').order('name')),
        q(db.from('parties').select('id,name,phone').eq('is_customer', true).eq('active', true).order('name')),
        db.from('accounts').select('id,name,currency,methods,is_default').eq('active', true).order('is_default', {ascending: false}).order('id')
          .then(r => r.error ? q(db.from('accounts').select('id,name,currency,methods').eq('active', true).order('id')) : r.data),
        q(db.from('settings').select('*').eq('id', 1).single())
      ]), 15000);

      const st = Object.fromEntries(stockRows.map(s => [s.product_id, Number(s.stock)]));
      const snap = await this.saveSnapshot({products, st, stockRows, custs, accs, settings: set});
      if (typeof METHODS !== 'undefined') {
        this.saveBoot({methods: {...METHODS}, mOff: [...(typeof M_OFF !== 'undefined' ? M_OFF : [])]});
      }
      if (!silent) toast(`Datos guardados para usar sin internet (${products.length} productos)`);
      return snap;
    } catch (e) {
      if (!silent) toast('No se pudieron actualizar los datos offline: ' + (e.message || 'sin señal'), true);
      return null;
    }
  },

  // ---------- Sincronización automática / manual ----------
  async syncNow(manual = false) {
    if (this.syncing) return {synced: 0, failed: 0, remaining: this.queueCache.length};
    if (this.isOffline()) {
      if (manual) toast(this.forceOffline ? 'Desactiva "Forzar modo sin conexión" para subir las ventas' : 'Aún sin conexión a internet', true);
      return {synced: 0, failed: 0, remaining: this.queueCache.length};
    }

    const items = await this.getQueue();
    if (!items.length) {
      if (manual) toast('No hay ventas pendientes por sincronizar');
      this.paintBar();
      return {synced: 0, failed: 0, remaining: 0};
    }

    this.syncing = true;
    this.paintBar();
    let synced = 0, failed = 0, netStopped = false;

    try {
      for (const rec of items) {
        if (this.isOffline()) { netStopped = true; break; }
        try {
          let custId = rec.payload.p_customer_id;

          // Si el cliente se creó sin internet, crearlo o ubicarlo primero en Supabase
          if (!custId && rec.temp_customer && rec.temp_customer.name) {
            const cname = rec.temp_customer.name.trim();
            const found = await this.withTimeout(
              q(db.from('parties').select('id').ilike('name', cname).eq('active', true).limit(1)),
              12000
            );
            if (found && found[0]) {
              custId = found[0].id;
            } else {
              const ins = await this.withTimeout(
                q(db.from('parties').insert({name: cname, phone: rec.temp_customer.phone || null, is_customer: true, is_supplier: false}).select('id').single()),
                12000
              );
              custId = ins.id;
            }
          }

          const baseParams = {
            p_customer_id: custId || null,
            p_doc_type: rec.payload.p_doc_type,
            p_rate: rec.payload.p_rate,
            p_discount_usd: rec.payload.p_discount_usd,
            p_due_date: rec.payload.p_due_date || null,
            p_notes: rec.payload.p_notes || null,
            p_items: rec.payload.p_items,
            p_payments: rec.payload.p_payments
          };

          let saleId = null;
          try {
            saleId = await this.withTimeout(
              q(db.rpc('registrar_venta_offline', {
                ...baseParams,
                p_client_tx_id: rec.client_tx_id,
                p_sale_date: rec.sale_date || null
              })),
              15000
            );
          } catch (rpcErr) {
            // Respaldo si el paso 22 SQL aún no fue ejecutado en Supabase
            const em = String(rpcErr?.message || '');
            if (rpcErr?.code === 'PGRST202' || /registrar_venta_offline|could not find the function/i.test(em)) {
              saleId = await this.withTimeout(
                q(db.rpc('registrar_venta', {p_id: null, ...baseParams})),
                15000
              );
            } else {
              throw rpcErr;
            }
          }

          if (rec.from_quote_id && saleId) {
            try { await db.from('quotes').update({status: 'convertida', sale_id: saleId}).eq('id', rec.from_quote_id); } catch (e) {}
          }

          await this.removeQueueItem(rec.local_id);
          synced++;
        } catch (err) {
          if (this.isNetError(err)) {
            netStopped = true;
            break;
          }
          failed++;
          await this.putQueueItem({...rec, last_error: err.message || 'Error al sincronizar'});
        }
      }
    } finally {
      this.syncing = false;
      const rem = (await this.getQueue()).length;
      this.paintBar();

      if (synced > 0) {
        toast(`${synced} ${synced === 1 ? 'venta sincronizada' : 'ventas sincronizadas'} con el servidor`);
        this.refreshSnapshot(true);
        if (['ventas', 'inicio', 'configuracion', 'offline'].includes(tab)) {
          try { render(); } catch (e) {}
        }
      } else if (manual && netStopped) {
        toast('La conexión falló al subir. Se reintentará automáticamente.', true);
      } else if (manual && failed > 0) {
        toast(`${failed} ${failed === 1 ? 'venta tiene' : 'ventas tienen'} error. Revísalas en Sin conexión.`, true);
      }
    }
    return {synced, failed, remaining: this.queueCache.length};
  },

  // ---------- Barra de estado de conexión ----------
  paintBar() {
    const bar = $('#netBar');
    if (!bar) return;
    const n = this.queueCache.length;
    const off = this.isOffline();

    if (!off && n === 0 && !this.syncing) {
      bar.className = 'hidden';
      bar.innerHTML = '';
      return;
    }

    if (this.syncing) {
      bar.className = 'netbar sync';
      bar.innerHTML = `<span>Subiendo ventas pendientes (${n})...</span>`;
      return;
    }

    if (off) {
      bar.className = 'netbar off';
      bar.innerHTML = `<span><b>Sin internet${this.forceOffline ? ' (manual)' : ''}</b> · Puedes seguir vendiendo${n ? ` · ${n} pendiente${n === 1 ? '' : 's'}` : ''}</span>
        <button type="button" class="netbar-btn" id="nbOpen">${n ? 'Ver cola' : 'Opciones'}</button>`;
      $('#nbOpen').onclick = () => go('offline');
      return;
    }

    // Online con ventas pendientes
    bar.className = 'netbar pend';
    bar.innerHTML = `<span><b>${n} ${n === 1 ? 'venta pendiente' : 'ventas pendientes'}</b> por subir al servidor</span>
      <button type="button" class="netbar-btn" id="nbSync">Sincronizar</button>`;
    $('#nbSync').onclick = () => this.syncNow(true);
  },

  // ---------- Pantalla de inicio sin conexión ----------
  async renderOfflineHome() {
    const [snap, qList] = await Promise.all([this.getSnapshot(), this.getQueue()]);
    const set = snap.settings || {};
    const hoy = caracasDate();
    const todayOff = qList.filter(x => x.sale_date === hoy);
    const todayUsd = todayOff.reduce((s, x) => s + Number(x.display?.total_usd || 0), 0);

    $('#view').innerHTML = `
      <div class="card" style="border-left:5px solid var(--tag)">
        <h2>Modo sin internet activo</h2>
        <p class="mut" style="margin:.2rem 0 .8rem">Tu negocio sigue operando con normalidad. Las ventas que registres ahora se guardan en este dispositivo y se subirán automáticamente cuando vuelva la señal.</p>
        <div class="row" style="margin:0">
          <button class="btn" id="ohSync">Intentar reconectar</button>
          <button class="btn ghost" id="ohCfg">Ver cola (${qList.length})</button>
        </div>
      </div>
      <div class="tiles">
        <button class="tile main" data-go="ventas">${typeof ico === 'function' ? ico('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>') : ''}<span>Vender</span><small>Nueva venta sin internet</small></button>
        <button class="tile" data-go="inventario">${typeof ico === 'function' ? ico('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>') : ''}<span>Inventario</span><small>Precios y stock guardado</small></button>
      </div>
      <h2 class="sec">Ventas locales de hoy (${esc(set.business_name || 'Mi negocio')})</h2>
      <div class="stats">
        <div class="stat"><span>Vendido sin conexión hoy</span><b>${fmt(todayUsd)} USD</b><span>${todayOff.length} ${todayOff.length === 1 ? 'venta' : 'ventas'}${S.rate ? ' | ' + fmt(todayUsd * S.rate) + ' Bs' : ''}</span></div>
        <div class="stat ${qList.length ? 'warn' : ''}"><span>Pendientes por subir</span><b>${qList.length}</b><span>${snap.updatedAt ? 'Caché: ' + fdate(snap.updatedAt) : 'Sin caché previa'}</span></div>
      </div>`;
    $('#ohSync').onclick = () => run(async () => {
      if (this.forceOffline) {
        this.forceOffline = false;
        try { localStorage.setItem(this.FORCE_KEY, '0'); } catch (e) {}
      }
      if (!navigator.onLine) return toast('El dispositivo sigue sin señal de internet', true);
      await this.syncNow(true);
      await this.refreshSnapshot(true);
      render();
    });
    $('#ohCfg').onclick = () => go('offline');
  },

  // ---------- Inicialización global (SW, eventos de red, PWA) ----------
  init() {
    this.initState();
    this.getQueue().then(() => this.paintBar());

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                toast('Nueva versión descargada. Recarga para aplicar.');
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
        toast('Conexión recuperada');
        setTimeout(() => { this.syncNow(false); this.refreshSnapshot(true); }, 1200);
      }
    });

    window.addEventListener('offline', () => {
      this.paintBar();
      toast('Sin internet: modo ventas sin conexión activado');
    });

    // Reintento silencioso cada 35 segundos si hay conexión y ventas en cola
    setInterval(() => {
      if (!this.isOffline() && !this.syncing && this.queueCache.length > 0 && db) {
        this.syncNow(false);
      }
    }, 35000);
  }
};

// ---------- Pantalla de Configuración > Sin conexión ----------
async function viewOffline() {
  const [snap, qList] = await Promise.all([OFF.getSnapshot(), OFF.getQueue()]);
  const onlineNow = !OFF.isOffline();
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  $('#view').innerHTML = `
    <div class="card stack">
      <h2>Estado de conexión y modo offline</h2>
      <div class="rl"><span>Conexión actual</span><b class="${onlineNow ? 'pos' : 'neg'}">${onlineNow ? 'En línea' : (OFF.forceOffline ? 'Sin conexión (forzado)' : 'Sin internet')}</b></div>
      <div class="rl"><span>Ventas pendientes por subir</span><b class="${qList.length ? 'neg' : 'pos'}">${qList.length}</b></div>
      <div class="rl"><span>Productos guardados localmente</span><b>${(snap.products || []).length}</b></div>
      <div class="rl"><span>Clientes guardados</span><b>${(snap.custs || []).length}</b></div>
      <div class="rl"><span>Cuentas guardadas</span><b>${(snap.accs || []).length}</b></div>
      <div class="rl"><span>Última actualización offline</span><b>${snap.updatedAt ? fdate(snap.updatedAt) : 'Aún no descargado'}</b></div>

      <label class="chk" style="margin-top:.3rem">
        <input type="checkbox" id="offForce" ${OFF.forceOffline ? 'checked' : ''}>
        Forzar modo sin conexión (útil si la señal está muy lenta o intermitente para vender al instante)
      </label>

      <div class="row">
        <button class="btn" id="offSyncBtn" ${qList.length && onlineNow ? '' : (onlineNow ? '' : 'disabled')}>Sincronizar ahora (${qList.length})</button>
        <button class="btn ghost" id="offPrepBtn" ${onlineNow ? '' : 'disabled'}>Actualizar datos offline</button>
      </div>
    </div>

    <div class="card stack">
      <h2>Cola de ventas sin subir (${qList.length})</h2>
      ${qList.length ? `<div class="list" id="offQL">${qList.map(rec => {
        const d = rec.display || {};
        return `<div class="item" style="flex-direction:column;align-items:stretch;gap:.45rem" data-lid="${esc(rec.local_id)}">
          <div class="row0" style="justify-content:space-between">
            <span>
              <b>${esc(rec.local_id)} · ${esc(d.customer_name || 'Cliente general')}</b>
              <small>${dmy(rec.sale_date)} · ${fdate(rec.created_at)} · ${(rec.payload?.p_items || []).length} producto(s)</small>
            </span>
            <span class="n"><b>${fmt(d.total_usd)} USD</b><small class="badge low">Pendiente</small></span>
          </div>
          ${rec.last_error ? `<small class="bad">Último error: ${esc(rec.last_error)}</small>` : ''}
          <div class="row" style="margin-top:.2rem">
            <button type="button" class="btn ghost" data-otk="${esc(rec.local_id)}">Ver ticket</button>
            <button type="button" class="btn ghost" data-odel="${esc(rec.local_id)}" style="color:var(--bad)">Eliminar</button>
          </div>
        </div>`;
      }).join('')}</div>`
      : '<p class="mut" style="margin:0">Todas tus ventas están sincronizadas en Supabase.</p>'}
    </div>

    <div class="card stack">
      <h2>Instalar como aplicación (PWA)</h2>
      ${isStandalone
        ? '<p class="pos" style="margin:0"><b>Ya estás usando la app instalada en tu dispositivo.</b></p>'
        : OFF.installPrompt
          ? '<p class="mut" style="margin:0">Instala el Gestor de Negocio en la pantalla de inicio de tu teléfono o PC para abrirlo incluso sin internet.</p><button class="btn" id="offInstall">Instalar en este dispositivo</button>'
          : '<p class="mut" style="margin:0"><b>En Android (Chrome):</b> menú (⋮) → <i>Instalar aplicación</i> o <i>Agregar a pantalla principal</i>.<br><b>En iPhone (Safari):</b> botón Compartir → <i>Agregar a inicio</i>.<br>Una vez abierta con internet al menos una vez, podrás abrirla y vender aunque no tengas señal.</p>'}
    </div>`;

  $('#offForce').onchange = (e) => {
    OFF.forceOffline = e.target.checked;
    try { localStorage.setItem(OFF.FORCE_KEY, OFF.forceOffline ? '1' : '0'); } catch (err) {}
    OFF.paintBar();
    toast(OFF.forceOffline ? 'Modo sin conexión forzado activado' : 'Modo automático de conexión restaurado');
    if (!OFF.forceOffline && navigator.onLine) OFF.syncNow(false);
    render();
  };

  $('#offSyncBtn').onclick = () => run(async () => { await OFF.syncNow(true); render(); });
  $('#offPrepBtn').onclick = () => run(async () => { toast('Actualizando datos para modo sin internet...'); await OFF.refreshSnapshot(false); render(); });
  if ($('#offInstall')) {
    $('#offInstall').onclick = () => run(async () => {
      if (!OFF.installPrompt) return;
      OFF.installPrompt.prompt();
      const choice = await OFF.installPrompt.userChoice;
      OFF.installPrompt = null;
      if (choice?.outcome === 'accepted') toast('Aplicación instalada');
      render();
    });
  }

  if ($('#offQL')) {
    $('#offQL').onclick = (e) => {
      const tk = e.target.closest('[data-otk]');
      if (tk) {
        const rec = qList.find(x => x.local_id === tk.dataset.otk);
        if (rec) run(() => showOfflineTicket(rec));
        return;
      }
      const dl = e.target.closest('[data-odel]');
      if (dl) {
        run(async () => {
          if (!confirm('¿Eliminar esta venta pendiente? Nunca se subirá al servidor.')) return;
          await OFF.removeQueueItem(dl.dataset.odel);
          toast('Venta pendiente eliminada');
          render();
        });
      }
    };
  }
}

OFF.init();
