// Motor de Sincronización con Google Drive del Cliente (BYOS — Costo $0 en servidores)
// Usa Google Identity Services (GIS) directamente en el navegador con el permiso mínimo drive.file:
// la app SOLO puede ver y guardar los archivos de respaldo que ella misma crea en el Drive del usuario.

const GDRIVE = {
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
  LS_KEY: 'gdn_gdrive_cfg_v2',
  SS_TOK_KEY: 'gdn_gdrive_tok_v2',
  MAX_DAILY_BACKUPS: 7,

  state: {
    connected: false,
    email: '',
    name: '',
    folderId: null,
    latestFileId: null,
    lastSyncAt: null,
    lastSyncRev: 0,
    lastDailyDate: '',
    autoSync: true,
    intervalMin: 10,     // 0 = solo manual, 1 = casi instantáneo (45s), 10, 30
    customClientId: ''   // respaldo opcional para pruebas locales si config.js aún está vacío
  },

  token: null,
  tokenExp: 0,
  tokenClient: null,
  gisPromise: null,
  syncing: false,
  debounceTimer: null,
  intervalTimer: null,

  getClientId() {
    const fromCfg = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.googleDriveClientId) ? String(APP_CONFIG.googleDriveClientId).trim() : '';
    return fromCfg || (this.state.customClientId || '').trim();
  },

  folderName() {
    const brand = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.brandName) ? APP_CONFIG.brandName.trim() : 'Gestor Emprendedor';
    return `${brand} (Respaldos)`;
  },

  loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.LS_KEY) || 'null');
      if (raw && typeof raw === 'object') this.state = {...this.state, ...raw};
    } catch (e) {}
    try {
      const tok = JSON.parse(sessionStorage.getItem(this.SS_TOK_KEY) || 'null');
      if (tok && tok.token && Number(tok.exp) > Date.now() + 30000) {
        this.token = tok.token;
        this.tokenExp = Number(tok.exp);
      }
    } catch (e) {}
  },

  saveState() {
    try { localStorage.setItem(this.LS_KEY, JSON.stringify(this.state)); } catch (e) {}
  },

  saveToken(accessToken, expiresInSec = 3500) {
    this.token = accessToken;
    this.tokenExp = Date.now() + Math.max(300, Number(expiresInSec) - 120) * 1000;
    try { sessionStorage.setItem(this.SS_TOK_KEY, JSON.stringify({token: this.token, exp: this.tokenExp})); } catch (e) {}
  },

  clearToken() {
    this.token = null;
    this.tokenExp = 0;
    try { sessionStorage.removeItem(this.SS_TOK_KEY); } catch (e) {}
  },

  hasValidToken() {
    return !!(this.token && this.tokenExp > Date.now() + 15000);
  },

  // Carga dinámica del SDK de Google Identity Services (solo cuando hay internet y se necesita)
  loadGIS() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (this.gisPromise) return this.gisPromise;
    if (!navigator.onLine) return Promise.reject(new Error('Necesitas conexión a internet para conectar Google Drive'));
    this.gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        this.gisPromise = null;
        reject(new Error('No se pudo cargar el inicio de sesión de Google. Verifica tu internet.'));
      };
      document.head.appendChild(s);
    });
    return this.gisPromise;
  },

  // Solicita un token OAuth (interactive = true abre la ventana de Google; false intenta renovar sin molestar)
  async ensureToken(interactive = true) {
    if (this.hasValidToken()) return this.token;
    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error('Google Drive aún no tiene configurado el Client ID en config.js (ver GUIA_GOOGLE_DRIVE.md).');
    }
    if (!navigator.onLine) throw new Error('Sin conexión a internet');
    await this.loadGIS();

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error(interactive ? 'Tiempo agotado esperando autorización de Google' : 'SILENT_TOKEN_EXPIRED')); }
      }, interactive ? 90000 : 12000);

      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: this.SCOPE,
        hint: this.state.email || undefined,
        callback: (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (resp.error) {
            reject(new Error(interactive ? ('Google rechazó el acceso: ' + (resp.error_description || resp.error)) : 'SILENT_TOKEN_EXPIRED'));
            return;
          }
          this.saveToken(resp.access_token, resp.expires_in);
          resolve(this.token);
        },
        error_callback: (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(interactive ? (err?.type === 'popup_closed' ? 'Cerraste la ventana de Google antes de autorizar' : 'No se pudo abrir la ventana de Google (revisa si el navegador bloqueó ventanas emergentes)') : 'SILENT_TOKEN_EXPIRED'));
        }
      });

      this.tokenClient = client;
      client.requestAccessToken({prompt: interactive ? (this.state.connected ? '' : 'consent select_account') : ''});
    });
  },

  // Llamada genérica autenticada a Google Drive API v3
  async api(url, opts = {}, retryAuth = true) {
    if (!this.hasValidToken()) throw new Error('Sesión de Google Drive expirada. Pulsa "Sincronizar con Drive" para reconectar.');
    const headers = {'Authorization': 'Bearer ' + this.token, ...(opts.headers || {})};
    const res = await fetch(url, {...opts, headers});
    if (res.status === 401 && retryAuth) {
      this.clearToken();
      throw new Error('TOKEN_EXPIRED');
    }
    if (!res.ok) {
      let msg = `Error de Google Drive (${res.status})`;
      try { const j = await res.json(); if (j?.error?.message) msg = j.error.message; } catch (e) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  },

  async fetchUserInfo() {
    try {
      const info = await this.api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)');
      if (info?.user) {
        this.state.email = info.user.emailAddress || this.state.email;
        this.state.name = info.user.displayName || this.state.name;
        this.saveState();
      }
    } catch (e) {}
  },

  // Busca o crea la carpeta de respaldos en el Google Drive del cliente
  async ensureFolder() {
    if (this.state.folderId) {
      try {
        const chk = await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(this.state.folderId)}?fields=id,trashed`);
        if (chk && !chk.trashed) return this.state.folderId;
      } catch (e) { this.state.folderId = null; }
    }
    const fname = this.folderName().replace(/'/g, "\\'");
    const qStr = encodeURIComponent(`name='${fname}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await this.api(`https://www.googleapis.com/drive/v3/files?q=${qStr}&fields=files(id,name)&spaces=drive&pageSize=5`);
    if (found?.files?.length) {
      this.state.folderId = found.files[0].id;
      this.saveState();
      return this.state.folderId;
    }
    const created = await this.api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: this.folderName(), mimeType: 'application/vnd.google-apps.folder'})
    });
    this.state.folderId = created.id;
    this.saveState();
    return this.state.folderId;
  },

  // Lista todos los archivos de respaldo en la carpeta de Drive (último + historial diario)
  async listBackups(interactive = false) {
    await this.ensureToken(interactive);
    const folderId = await this.ensureFolder();
    const qStr = encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/json'`);
    const fields = encodeURIComponent('files(id,name,modifiedTime,size,appProperties)');
    const res = await this.api(`https://www.googleapis.com/drive/v3/files?q=${qStr}&orderBy=modifiedTime desc&fields=${fields}&pageSize=30`);
    const files = res?.files || [];
    const latest = files.find(f => f.name === 'respaldo_actual.json' || f.appProperties?.kind === 'latest') || null;
    if (latest) { this.state.latestFileId = latest.id; this.saveState(); }
    return {folderId, files, latest};
  },

  // Sube (crea o actualiza) un archivo JSON con multipart/related
  async uploadJsonFile(name, jsonObj, existingId = null, folderId = null, appProperties = {}) {
    const metadata = {name, mimeType: 'application/json', appProperties};
    if (!existingId && folderId) metadata.parents = [folderId];
    const boundary = 'gdn_drive_boundary_' + Date.now();
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      JSON.stringify(jsonObj) +
      `\r\n--${boundary}--`;

    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,name,modifiedTime,size,appProperties`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size,appProperties`;

    return this.api(url, {
      method: existingId ? 'PATCH' : 'POST',
      headers: {'Content-Type': `multipart/related; boundary=${boundary}`},
      body
    });
  },

  async downloadFileJson(fileId) {
    const txt = await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`);
    return typeof txt === 'string' ? JSON.parse(txt) : txt;
  },

  // Mantiene solo los últimos 7 respaldos diarios en Drive
  async pruneOldDailies(files) {
    const dailies = (files || [])
      .filter(f => f.name !== 'respaldo_actual.json' && (f.appProperties?.kind === 'daily' || /^respaldo_\d{4}-\d{2}-\d{2}\.json$/.test(f.name)))
      .sort((a, b) => String(b.name).localeCompare(String(a.name)));
    const toDel = dailies.slice(this.MAX_DAILY_BACKUPS);
    for (const f of toDel) {
      try { await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}`, {method: 'DELETE'}); } catch (e) {}
    }
  },

  // ---------- Conectar cuenta Google por primera vez (o restaurar en teléfono nuevo) ----------
  async connect({forOnboardingRestore = false} = {}) {
    await this.ensureToken(true);
    this.state.connected = true;
    await this.fetchUserInfo();
    const {files, latest} = await this.listBackups(false);
    this.saveState();
    LDB.paintBar();

    if (forOnboardingRestore) {
      if (!files.length) {
        toast('No encontramos respaldos previos en este Google Drive', true);
        return {found: false, files: []};
      }
      return {found: true, files, latest};
    }

    // Si ya existe un respaldo en Drive de otro dispositivo, preguntar antes de pisar
    if (latest) {
      const remDev = latest.appProperties?.deviceId || '';
      const remRev = Number(latest.appProperties?.rev || 0);
      const localHasData = ((LDB.mem.sales || []).length + (LDB.mem.products || []).length) > 0;
      if (remDev && remDev !== LDB.meta?.deviceId && (remRev > 0 || !localHasData)) {
        this.openConflictSheet(latest, files);
        return {connected: true, conflict: true};
      }
    }

    // Si no hay conflicto, subir el primer respaldo automáticamente
    await this.syncNow({manual: true, forceUpload: true});
    return {connected: true, conflict: false};
  },

  // ---------- Sincronizar (sube respaldo_actual.json + copia diaria) ----------
  async syncNow({manual = false, forceUpload = false} = {}) {
    if (this.syncing) return {ok: false, reason: 'busy'};
    if (!navigator.onLine) {
      if (manual) toast('Sin conexión a internet. Se respaldará apenas recuperes señal.', true);
      return {ok: false, reason: 'offline'};
    }
    if (!this.state.connected && !manual) return {ok: false, reason: 'not_connected'};

    this.syncing = true;
    LDB.paintBar();
    try {
      await this.ensureToken(manual);
      if (!this.state.connected) {
        this.state.connected = true;
        await this.fetchUserInfo();
      }

      const {folderId, files, latest} = await this.listBackups(false);

      // Detectar si otro dispositivo subió una versión más nueva antes de sobrescribir
      if (!forceUpload && latest) {
        const remDev = latest.appProperties?.deviceId || '';
        const remAt = latest.appProperties?.updatedAt || latest.modifiedTime || '';
        const localLastSync = this.state.lastSyncAt || '';
        if (remDev && remDev !== LDB.meta?.deviceId && remAt > localLastSync) {
          this.syncing = false;
          LDB.paintBar();
          if (manual) {
            this.openConflictSheet(latest, files);
          } else {
            toast('Hay un respaldo más reciente en Google Drive. Revisa en Configuración > Respaldo.');
          }
          return {ok: false, reason: 'conflict'};
        }
      }

      const snapshot = await LDB.exportFullJson();
      const bizName = String(LDB.mem.settings?.[0]?.business_name || 'Mi negocio').slice(0, 40);
      const appProps = {
        kind: 'latest',
        rev: String(snapshot.rev || 1),
        deviceId: String(LDB.meta?.deviceId || ''),
        updatedAt: snapshot.fecha,
        businessName: bizName
      };

      const uploaded = await this.uploadJsonFile('respaldo_actual.json', snapshot, latest?.id || null, folderId, appProps);
      this.state.latestFileId = uploaded.id;
      this.state.lastSyncAt = snapshot.fecha;
      this.state.lastSyncRev = Number(snapshot.rev || 1);

      // Guardar copia diaria (1 por día, mantiene los últimos 7 días)
      const today = LDB.todayStr();
      const dailyName = `respaldo_${today}.json`;
      const existingDaily = files.find(f => f.name === dailyName);
      if (!existingDaily || this.state.lastDailyDate !== today || manual) {
        await this.uploadJsonFile(dailyName, snapshot, existingDaily?.id || null, folderId, {
          ...appProps,
          kind: 'daily',
          day: today
        });
        this.state.lastDailyDate = today;
        await this.pruneOldDailies(files);
      }

      LDB.meta.lastDriveSyncAt = snapshot.fecha;
      LDB.meta.dirtySinceBackup = 0;
      await LDB.idbPut('kv', LDB.meta, 'meta');
      this.saveState();
      if (manual) toast('Respaldo guardado en tu Google Drive');
      return {ok: true, syncedAt: snapshot.fecha};
    } catch (err) {
      if (err.message === 'SILENT_TOKEN_EXPIRED' || err.message === 'TOKEN_EXPIRED') {
        this.clearToken();
        if (manual) toast('Tu sesión de Google expiró. Toca de nuevo para reconectar.', true);
      } else if (manual) {
        toast(err.message || 'No se pudo sincronizar con Google Drive', true);
      }
      return {ok: false, error: err.message};
    } finally {
      this.syncing = false;
      LDB.paintBar();
    }
  },

  // ---------- Restaurar un archivo específico desde Drive ----------
  async restoreFromFile(fileId, fromOnboarding = false) {
    await this.ensureToken(true);
    toast('Descargando respaldo desde Google Drive...');
    const data = await this.downloadFileJson(fileId);
    await LDB.importFullJson(data);
    const nowIso = new Date().toISOString();
    this.state.lastSyncAt = data.fecha || nowIso;
    this.state.lastSyncRev = Number(LDB.meta.rev || 1);
    this.saveState();
    LDB.meta.lastDriveSyncAt = this.state.lastSyncAt;
    LDB.meta.dirtySinceBackup = 0;
    await LDB.idbPut('kv', LDB.meta, 'meta');
    toast('Negocio restaurado desde Google Drive');
    if (fromOnboarding) {
      closeSheet();
      $('#onboarding')?.classList.add('hidden');
      await enter();
    } else {
      setTimeout(() => location.reload(), 800);
    }
  },

  // ---------- Hoja de conflicto (cuando otro teléfono subió datos más recientes) ----------
  openConflictSheet(latest, files = []) {
    const remDate = latest.appProperties?.updatedAt || latest.modifiedTime;
    const remBiz = latest.appProperties?.businessName || 'Tu negocio';
    const remRev = latest.appProperties?.rev || '?';
    openSheet('Respaldo encontrado en Google Drive', `
      <div class="stack">
        <p class="mut" style="margin:0">Detectamos un respaldo guardado en tu Google Drive creado desde otro dispositivo. Elige qué datos deseas conservar:</p>
        <div class="card" style="background:var(--bg);margin:0">
          <div class="rl"><span>En Google Drive</span><b>${esc(remBiz)}</b></div>
          <div class="rl"><span>Fecha en Drive</span><b>${remDate ? fdate(remDate) : '-'}</b></div>
          <div class="rl"><span>Revisión en Drive / Local</span><b>#${esc(remRev)} / #${LDB.meta?.rev || 0}</b></div>
        </div>
        <button type="button" class="btn" id="gdUseCloud">Restaurar desde Google Drive (recomendado)</button>
        <button type="button" class="btn ghost" id="gdKeepLocal">Mantener este teléfono y subir a Drive</button>
      </div>`);
    $('#gdUseCloud').onclick = () => run(async () => {
      if (!confirm('Se reemplazarán los datos actuales de este dispositivo por el respaldo de Google Drive. ¿Continuar?')) return;
      await this.restoreFromFile(latest.id, false);
    });
    $('#gdKeepLocal').onclick = () => run(async () => {
      closeSheet();
      await this.syncNow({manual: true, forceUpload: true});
      render();
    });
  },

  // ---------- Hoja para elegir cualquiera de las copias guardadas en Drive ----------
  async openRestorePicker(fromOnboarding = false) {
    const res = await this.connect({forOnboardingRestore: true});
    if (!res.found || !res.files.length) return;
    const fmtSize = (sz) => {
      const n = Number(sz || 0);
      return n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    };
    openSheet('Respaldos en tu Google Drive', `
      <div class="stack">
        <p class="mut" style="margin:0">Cuenta: <b>${esc(this.state.email || 'Google Drive')}</b><br>Toca la copia que deseas restaurar en este dispositivo:</p>
        <div class="list" id="gdPickList">
          ${res.files.map(f => {
            const isLatest = f.name === 'respaldo_actual.json' || f.appProperties?.kind === 'latest';
            const biz = f.appProperties?.businessName || '';
            return `<button type="button" class="item" data-fid="${esc(f.id)}">
              <span style="flex:1">
                <b>${isLatest ? 'Último respaldo automático' : esc(f.name.replace('.json', '').replace('respaldo_', 'Copia del '))}</b>
                <small>${fdate(f.modifiedTime)}${biz ? ' · ' + esc(biz) : ''} · ${fmtSize(f.size)}</small>
              </span>
              <span class="badge ${isLatest ? 'ok' : ''}">${isLatest ? 'Más reciente' : 'Diaria'}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`);
    $('#gdPickList').onclick = (e) => {
      const b = e.target.closest('[data-fid]'); if (!b) return;
      run(async () => {
        if (!fromOnboarding && !confirm('¿Restaurar esta copia en este dispositivo? Reemplazará los datos actuales.')) return;
        await this.restoreFromFile(b.dataset.fid, fromOnboarding);
      });
    };
  },

  disconnect() {
    this.clearToken();
    this.state.connected = false;
    this.state.email = '';
    this.state.name = '';
    this.state.folderId = null;
    this.state.latestFileId = null;
    this.saveState();
    LDB.paintBar();
  },

  // ---------- Programador automático de respaldo ----------
  scheduleAutoSync() {
    if (!this.state.connected || !this.state.autoSync || !Number(this.state.intervalMin)) return;
    if (!navigator.onLine || !this.hasValidToken()) return;
    clearTimeout(this.debounceTimer);
    const waitMs = Number(this.state.intervalMin) === 1 ? 45000 : 90000;
    this.debounceTimer = setTimeout(() => {
      if (Number(LDB.meta?.dirtySinceBackup || 0) > 0 && this.hasValidToken() && navigator.onLine) {
        this.syncNow({manual: false});
      }
    }, waitMs);
  },

  init() {
    this.loadState();

    // Escuchar cada escritura en IndexedDB para programar respaldo automático
    if (typeof LDB !== 'undefined') {
      LDB.onDirty = () => this.scheduleAutoSync();
    }

    // Al volver el internet, intentar respaldo silencioso si hay cambios pendientes
    window.addEventListener('online', () => {
      if (this.state.connected && this.state.autoSync && Number(LDB.meta?.dirtySinceBackup || 0) > 0) {
        setTimeout(() => this.syncNow({manual: false}), 2500);
      }
    });

    // Al pasar la app a segundo plano, intentar respaldar si hay cambios y token activo
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.state.connected && this.state.autoSync && this.hasValidToken() && navigator.onLine && Number(LDB.meta?.dirtySinceBackup || 0) > 0) {
        this.syncNow({manual: false});
      }
    });

    // Intervalo periódico de seguridad
    this.intervalTimer = setInterval(() => {
      const mins = Number(this.state.intervalMin || 0);
      if (!this.state.connected || !this.state.autoSync || !mins || !navigator.onLine) return;
      if (Number(LDB.meta?.dirtySinceBackup || 0) <= 0 || !this.hasValidToken()) return;
      const lastMs = this.state.lastSyncAt ? new Date(this.state.lastSyncAt).getTime() : 0;
      if ((Date.now() - lastMs) >= mins * 60000) {
        this.syncNow({manual: false});
      }
    }, 60000);
  }
};

GDRIVE.init();
