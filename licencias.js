// Motor de Licencias y Suscripciones ($10/mes) — Edición Emprendedores v3
// Soporta:
//  1) Códigos firmados offline con ECDSA P-256 (GE1.<payload>.<firma>) — 0 servidores, imposibles de falsificar.
//  2) Validación en la nube con Cloudflare Workers + KV (renovación automática y suspensión remota a costo $0).
//  3) Prueba gratis automática configurable (ej: 14 días) + protección contra retroceso de reloj.
//  4) Nunca bloquea la exportación ni el respaldo en Google Drive si vence la suscripción.

const LIC = {
  LS_KEY: 'gdn_license_v3',
  state: {
    trialStart: null,
    maxSeenTime: 0,
    token: null,          // Código firmado GE1...
    payload: null,        // Payload decodificado del token
    shortCode: '',        // Clave corta opcional (ej: PRO-XXXX-XXXX) si se activó vía Worker
    suspended: false,
    suspendReason: '',
    lastOnlineCheck: 0
  },

  cfg() {
    const c = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG : {};
    return {
      enabled: !!c.licenseEnabled,
      trialDays: Math.max(0, Number(c.trialDays ?? 14)),
      priceUsd: Number(c.monthlyPriceUsd ?? 10),
      publicKey: String(c.licensePublicKey || '').trim(),
      apiUrl: String(c.licenseApiUrl || '').trim().replace(/\/+$/, ''),
      brand: c.brandName || 'Gestor Emprendedor',
      whatsapp: String(c.supportWhatsApp || '').trim(),
      email: String(c.supportEmail || '').trim()
    };
  },

  // Helpers Base64URL seguros con UTF-8 (acentos, ñ, etc.)
  b64uDec(str) {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },

  b64uToJson(str) {
    const bytes = this.b64uDec(str);
    return JSON.parse(new TextDecoder().decode(bytes));
  },

  deviceCode() {
    const raw = (typeof LDB !== 'undefined' && LDB.meta?.deviceId) ? String(LDB.meta.deviceId) : 'dev-local';
    return raw.toUpperCase();
  },

  nowTs() {
    const sys = Date.now();
    // Protección básica contra retroceso manual del reloj del teléfono
    const max = Math.max(sys, Number(this.state.maxSeenTime || 0));
    if (sys > Number(this.state.maxSeenTime || 0)) {
      this.state.maxSeenTime = sys;
    }
    return max;
  },

  async loadState() {
    let ls = null, idb = null;
    try { ls = JSON.parse(localStorage.getItem(this.LS_KEY) || 'null'); } catch (e) {}
    try {
      if (typeof LDB !== 'undefined') {
        await LDB.ensureReady();
        const kv = await LDB.idbGetAllWithKeys('kv');
        idb = kv?.license || null;
      }
    } catch (e) {}

    // Combinar preservando el trialStart más antiguo y el maxSeenTime más alto
    const merged = {...this.state, ...(ls || {}), ...(idb || {})};
    const starts = [ls?.trialStart, idb?.trialStart].filter(Boolean).map(Number).filter(n => n > 0);
    merged.trialStart = starts.length ? Math.min(...starts) : Date.now();
    merged.maxSeenTime = Math.max(Number(ls?.maxSeenTime || 0), Number(idb?.maxSeenTime || 0), Date.now());

    // Mantener el token más reciente entre ls e idb
    if (ls?.token && (!idb?.token || Number(ls.payload?.exp || 0) > Number(idb.payload?.exp || 0))) {
      merged.token = ls.token;
      merged.payload = ls.payload;
      merged.shortCode = ls.shortCode || merged.shortCode;
    }

    this.state = merged;
    await this.saveState();
  },

  async saveState() {
    try { localStorage.setItem(this.LS_KEY, JSON.stringify(this.state)); } catch (e) {}
    try {
      if (typeof LDB !== 'undefined') await LDB.idbPut('kv', this.state, 'license');
    } catch (e) {}
  },

  parsePublicKeyJwk(raw) {
    if (!raw) return null;
    try {
      if (typeof raw === 'object') return raw;
      const s = String(raw).trim();
      if (s.startsWith('{')) return JSON.parse(s);
      return this.b64uToJson(s);
    } catch (e) {
      return null;
    }
  },

  // Verifica criptográficamente un código firmado GE1.<payload>.<firma> usando la llave pública ECDSA P-256
  async verifySignedToken(tokenStr) {
    const clean = String(tokenStr || '').trim().replace(/\s+/g, '');
    const parts = clean.split('.');
    if (parts.length !== 3 || parts[0] !== 'GE1') {
      throw new Error('Formato de código inválido. Debe comenzar con GE1.');
    }
    const jwk = this.parsePublicKeyJwk(this.cfg().publicKey);
    if (!jwk) {
      throw new Error('La app no tiene configurada la llave pública (licensePublicKey en config.js).');
    }
    if (!window.crypto?.subtle) {
      throw new Error('Tu navegador no soporta verificación criptográfica (requiere HTTPS).');
    }

    const pubKey = await crypto.subtle.importKey(
      'jwk', jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']
    );
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const sig = this.b64uDec(parts[2]);
    const ok = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, pubKey, sig, data);
    if (!ok) throw new Error('Código de licencia inválido o alterado.');

    const payload = this.b64uToJson(parts[1]);
    if (!payload || !payload.exp) throw new Error('Licencia incompleta (sin fecha de vencimiento).');

    // Validar vinculación de dispositivo si la licencia es exclusiva para un equipo
    if (payload.dev && payload.dev !== '*') {
      const myDev = this.deviceCode();
      const allowed = String(payload.dev).toUpperCase().split(',').map(x => x.trim());
      if (!allowed.includes(myDev)) {
        throw new Error(`Esta licencia pertenece a otro dispositivo (${payload.dev}). Tu ID es ${myDev}.`);
      }
    }
    return {clean, payload};
  },

  // Activa un código (acepta código firmado offline GE1... O clave corta vía Cloudflare Worker)
  async activate(inputCode) {
    const code = String(inputCode || '').trim();
    if (!code) throw new Error('Escribe o pega tu código de licencia');
    const c = this.cfg();

    // Caso 1: Código firmado offline directo (GE1.xxx.yyy)
    if (code.replace(/\s+/g, '').startsWith('GE1.')) {
      const {clean, payload} = await this.verifySignedToken(code);
      const expMs = new Date(payload.exp + 'T23:59:59-04:00').getTime();
      if (expMs < this.nowTs()) {
        throw new Error(`Esta licencia venció el ${dmy(payload.exp)}. Solicita tu renovación.`);
      }
      this.state.token = clean;
      this.state.payload = payload;
      this.state.suspended = false;
      this.state.suspendReason = '';
      this.state.lastOnlineCheck = Date.now();
      await this.saveState();
      this.applyGateUI();
      return {ok: true, payload};
    }

    // Caso 2: Clave corta o correo validado contra tu Cloudflare Worker ($0/mes)
    if (!c.apiUrl) {
      throw new Error('Código no reconocido. Si recibiste un código largo que inicia con GE1., pégalo completo.');
    }
    if (!navigator.onLine) {
      throw new Error('Necesitas internet una sola vez para activar esta clave.');
    }
    const bizName = (typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.business_name) || '';
    const res = await fetch(c.apiUrl + '/api/activate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code, deviceId: this.deviceCode(), businessName: bizName})
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'No se pudo activar la licencia');

    if (j.token) {
      // Si hay publicKey configurada, verificar también localmente
      const payload = c.publicKey ? (await this.verifySignedToken(j.token)).payload : j.payload;
      this.state.token = j.token;
      this.state.payload = payload;
    } else if (j.payload) {
      this.state.payload = j.payload;
    }
    this.state.shortCode = j.code || code.toUpperCase();
    this.state.suspended = false;
    this.state.suspendReason = '';
    this.state.lastOnlineCheck = Date.now();
    await this.saveState();
    this.applyGateUI();
    return {ok: true, payload: this.state.payload};
  },

  // Consulta silenciosa en segundo plano al Worker (actualiza renovaciones o suspensiones)
  async checkOnline(manual = false) {
    const c = this.cfg();
    if (!c.apiUrl || !navigator.onLine) {
      if (manual && !c.apiUrl) toast('Esta app valida licencias mediante códigos firmados offline.');
      else if (manual) toast('Sin conexión a internet para verificar en línea', true);
      return null;
    }
    if (!this.state.shortCode && !this.state.payload?.id) {
      if (manual) toast('Aún no tienes una licencia activada en este dispositivo', true);
      return null;
    }
    try {
      const res = await fetch(c.apiUrl + '/api/check', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          code: this.state.shortCode || this.state.payload?.id || '',
          deviceId: this.deviceCode()
        })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (manual) toast(j.error || 'No se pudo verificar la suscripción', true);
        return null;
      }
      this.state.lastOnlineCheck = Date.now();
      if (j.status === 'suspended') {
        this.state.suspended = true;
        this.state.suspendReason = j.reason || 'Suscripción pausada por administración.';
      } else {
        this.state.suspended = false;
        this.state.suspendReason = '';
        if (j.token) {
          const payload = c.publicKey ? (await this.verifySignedToken(j.token)).payload : j.payload;
          this.state.token = j.token;
          this.state.payload = payload;
        } else if (j.payload) {
          this.state.payload = j.payload;
        }
      }
      await this.saveState();
      this.applyGateUI();
      if (manual) {
        const st = this.getStatus();
        toast(st.active ? `Suscripción verificada · Vigente hasta ${dmy(st.expiresDate)}` : 'Tu suscripción requiere renovación', !st.active);
      }
      return j;
    } catch (e) {
      if (manual) toast('Error de red al verificar en línea', true);
      return null;
    }
  },

  // Calcula el estado actual de forma 100% offline
  getStatus() {
    const c = this.cfg();
    if (!c.enabled) {
      return {mode: 'free', active: true, daysLeft: 999, label: 'Modo libre', expiresDate: null, warn: false};
    }

    const now = this.nowTs();
    if (this.state.suspended) {
      return {
        mode: 'suspended', active: false, daysLeft: 0,
        label: 'Suspendida',
        reason: this.state.suspendReason || 'Tu suscripción se encuentra pausada.',
        expiresDate: this.state.payload?.exp || null, warn: true
      };
    }

    // 1. Verificar licencia paga guardada
    if (this.state.payload && this.state.payload.exp) {
      const expMs = new Date(this.state.payload.exp + 'T23:59:59-04:00').getTime();
      const daysLeft = Math.ceil((expMs - now) / 86400000);
      if (daysLeft > 0) {
        return {
          mode: 'paid', active: true, daysLeft,
          plan: this.state.payload.plan || 'Plan Emprendedor',
          holder: this.state.payload.name || '',
          expiresDate: this.state.payload.exp,
          label: `Activo (${daysLeft}d)`,
          warn: daysLeft <= 3
        };
      }
      return {
        mode: 'expired', active: false, daysLeft: 0,
        plan: this.state.payload.plan || 'Plan Emprendedor',
        holder: this.state.payload.name || '',
        expiresDate: this.state.payload.exp,
        label: 'Vencido',
        reason: `Tu suscripción venció el ${dmy(this.state.payload.exp)}.`,
        warn: true
      };
    }

    // 2. Verificar prueba gratis automática
    const start = Number(this.state.trialStart || now);
    const trialEndMs = start + c.trialDays * 86400000;
    const daysLeft = Math.ceil((trialEndMs - now) / 86400000);
    const expIso = new Date(trialEndMs).toISOString().slice(0, 10);
    if (daysLeft > 0) {
      return {
        mode: 'trial', active: true, daysLeft,
        plan: `Prueba gratis (${c.trialDays} días)`,
        expiresDate: expIso,
        label: `Prueba (${daysLeft}d)`,
        warn: daysLeft <= 3
      };
    }
    return {
      mode: 'trial_expired', active: false, daysLeft: 0,
      plan: 'Prueba finalizada',
      expiresDate: expIso,
      label: 'Prueba vencida',
      reason: `Tu período de prueba gratis de ${c.trialDays} días ha finalizado.`,
      warn: true
    };
  },

  renewWhatsAppUrl() {
    const c = this.cfg();
    const biz = (typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.business_name) || 'Mi negocio';
    const owner = (typeof LDB !== 'undefined' && LDB.mem?.settings?.[0]?.owner_name) || '';
    const msg = [
      `Hola, quiero activar/renovar mi plan mensual ($${c.priceUsd}/mes) en *${c.brand}*.`,
      `• Negocio: ${biz}${owner ? ' (' + owner + ')' : ''}`,
      `• ID de dispositivo: ${this.deviceCode()}`,
      this.state.shortCode ? `• Clave actual: ${this.state.shortCode}` : ''
    ].filter(Boolean).join('\n');
    const digits = c.whatsapp ? c.whatsapp.replace(/\D/g, '') : '';
    return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
  },

  // Muestra u oculta la pantalla de renovación si la suscripción venció (siempre permite respaldar datos)
  applyGateUI() {
    const gate = document.querySelector('#licenseGate');
    if (!gate) return;
    const st = this.getStatus();
    if (st.active) {
      gate.classList.add('hidden');
      gate.innerHTML = '';
      return;
    }

    const c = this.cfg();
    const gd = typeof GDRIVE !== 'undefined' ? GDRIVE : null;
    gate.classList.remove('hidden');
    gate.innerHTML = `
      <div class="card stack lic-card">
        <div class="title-row">
          <span class="badge out">${esc(st.label)}</span>
          <small class="mut">${esc(c.brand)}</small>
        </div>
        <h1 style="margin:0">${st.mode === 'suspended' ? 'Suscripción pausada' : 'Activa tu Plan Emprendedor'}</h1>
        <p class="mut" style="margin:0">${esc(st.reason)}<br>Tus datos locales están <b>100% seguros</b> en tu dispositivo y puedes respaldarlos cuando quieras.</p>

        <div class="card" style="background:var(--bg);margin:0;padding:.85rem">
          <div class="rl"><span>Plan Emprendedor</span><b>$${c.priceUsd} USD / mes</b></div>
          <div class="rl" style="border:0"><span>Tu ID de dispositivo</span>
            <span class="row0" style="gap:.4rem"><b>${esc(this.deviceCode())}</b><button type="button" class="lnk" id="lgCopyDev" style="padding:0;font-size:.82rem">Copiar</button></span>
          </div>
        </div>

        <form id="lgActForm" class="stack">
          <label>¿Ya tienes tu código de activación?
            <textarea id="lgCode" rows="2" placeholder="Pega aquí tu código (ej: GE1... o PRO-XXXX-XXXX)" required></textarea>
          </label>
          <button type="submit" class="btn">Activar licencia</button>
        </form>

        <div class="row" style="margin:0">
          ${c.whatsapp ? `<a class="btn ghost" href="${this.renewWhatsAppUrl()}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Pagar / Renovar por WhatsApp</a>` : ''}
          ${c.apiUrl ? `<button type="button" class="btn ghost" id="lgCheckOnline">Ya pagué (verificar)</button>` : ''}
        </div>

        <div class="card stack" style="background:var(--bg);margin:0;padding:.85rem">
          <b style="font-size:.88rem">Tus datos siempre son tuyos</b>
          <div class="row" style="margin:0">
            <button type="button" class="btn ghost" id="lgBackup" style="font-size:.86rem">Descargar respaldo (.json)</button>
            ${gd?.state?.connected ? `<button type="button" class="btn ghost" id="lgDrive" style="font-size:.86rem">Subir a Google Drive</button>` : ''}
          </div>
        </div>
      </div>`;

    $('#lgCopyDev').onclick = () => copyText(this.deviceCode(), 'ID de dispositivo copiado');
    $('#lgActForm').onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const res = await this.activate($('#lgCode').value);
        toast(`¡Licencia activada! Vigente hasta ${dmy(res.payload.exp)}`);
        render();
      });
    };
    if ($('#lgCheckOnline')) {
      $('#lgCheckOnline').onclick = () => run(() => this.checkOnline(true));
    }
    $('#lgBackup').onclick = () => run(descargarRespaldo);
    if ($('#lgDrive')) $('#lgDrive').onclick = () => run(() => GDRIVE.syncNow({manual: true}));
  },

  async checkOnBoot() {
    await this.loadState();
    // Si tiene token firmado guardado y hay llave pública, revalidar firma
    if (this.state.token && this.cfg().publicKey) {
      try {
        const {payload} = await this.verifySignedToken(this.state.token);
        this.state.payload = payload;
      } catch (e) {
        this.state.token = null;
        this.state.payload = null;
        await this.saveState();
      }
    }
    this.applyGateUI();
    // Chequeo silencioso online máximo cada 6 horas
    if (this.cfg().enabled && this.cfg().apiUrl && navigator.onLine && (Date.now() - Number(this.state.lastOnlineCheck || 0)) > 6 * 3600 * 1000) {
      setTimeout(() => this.checkOnline(false), 2500);
    }
  }
};

// ---------- Vista: Configuración > Mi Suscripción y Plan ----------
async function viewSuscripcion() {
  await LIC.loadState();
  const c = LIC.cfg();
  const st = LIC.getStatus();
  const pillCls = !c.enabled ? 'ok' : st.active ? (st.warn ? 'low' : 'ok') : 'out';

  $('#view').innerHTML = `
    <div class="card stack" style="border-left:5px solid var(--pri)">
      <div class="title-row">
        <h2>Estado de tu plan</h2>
        <span class="badge ${pillCls}">${esc(st.label)}</span>
      </div>
      ${!c.enabled ? `
        <p class="mut" style="margin:0">El control de licencias está desactivado en <code>config.js</code> (<code>licenseEnabled: false</code>). Cuando quieras comenzar a cobrar $${c.priceUsd}/mes a tus clientes, actívalo siguiendo <b>GUIA_FASE3_LICENCIAS_Y_PRIVACIDAD.md</b>.</p>
      ` : `
        <div class="rl"><span>Plan actual</span><b>${esc(st.plan || 'Plan Emprendedor')}</b></div>
        ${st.holder ? `<div class="rl"><span>Titular</span><b>${esc(st.holder)}</b></div>` : ''}
        ${st.expiresDate ? `<div class="rl"><span>Vigente hasta</span><b>${dmy(st.expiresDate)} (${st.daysLeft} ${st.daysLeft === 1 ? 'día' : 'días'})</b></div>` : ''}
        <div class="rl"><span>Precio mensual</span><b>$${c.priceUsd} USD / mes</b></div>
      `}
      <div class="rl">
        <span>ID de este dispositivo</span>
        <span class="row0" style="gap:.45rem"><b>${esc(LIC.deviceCode())}</b><button type="button" class="lnk" id="suCopyDev" style="padding:0;font-size:.82rem">Copiar</button></span>
      </div>
      <div class="row">
        ${c.whatsapp ? `<a class="btn" href="${LIC.renewWhatsAppUrl()}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Renovar / Pagar por WhatsApp</a>` : ''}
        ${c.apiUrl ? `<button type="button" class="btn ghost" id="suCheck">Verificar renovación en línea</button>` : ''}
      </div>
    </div>

    <div class="card stack">
      <h2>Activar o renovar con código</h2>
      <p class="mut" style="margin:0">Pega el código que recibiste al confirmar tu pago mensual. Una vez activado, funciona <b>100% sin internet</b> hasta la fecha de vencimiento.</p>
      <form id="suForm" class="stack">
        <label>Código de licencia<textarea id="suCode" rows="2" placeholder="Pega tu código aquí (GE1... o PRO-XXXX-XXXX)" required></textarea></label>
        <button type="submit" class="btn">Activar código</button>
      </form>
    </div>

    <div class="card stack">
      <h2>Privacidad y respaldo</h2>
      <p class="mut" style="margin:0">Tus datos siempre permanecen en tu dispositivo y tu Google Drive personal. Nunca se borran aunque tu suscripción venza.</p>
      <div class="row">
        <a class="btn ghost" href="${esc(c.privacyUrl || './privacidad.html')}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Ver Política de Privacidad</a>
      </div>
    </div>`;

  $('#suCopyDev').onclick = () => copyText(LIC.deviceCode(), 'ID de dispositivo copiado');
  if ($('#suCheck')) $('#suCheck').onclick = () => run(async () => { await LIC.checkOnline(true); render(); });
  $('#suForm').onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await LIC.activate($('#suCode').value);
      toast(`¡Licencia activada! Vigente hasta ${dmy(res.payload.exp)}`);
      render();
    });
  };
}
