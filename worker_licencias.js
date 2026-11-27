// Cloudflare Worker de Licencias ($0/mes — Plan Gratis: 100.000 peticiones/día)
// Requiere:
//   1) KV Namespace enlazado con nombre: LICENSES_KV
//   2) Variables secretas (Environment Variables -> Encrypt):
//      - ADMIN_KEY         (tu contraseña maestra para entrar al panel admin.html)
//      - PRIVATE_KEY_JWK   (llave privada ECDSA P-256 en JSON generada en admin.html)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key'
};

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', ...CORS}
  });
}

function b64uEnc(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signPayload(payload, privJwkRaw) {
  if (!privJwkRaw) return null;
  const jwk = typeof privJwkRaw === 'string' ? JSON.parse(privJwkRaw) : privJwkRaw;
  const key = await crypto.subtle.importKey('jwk', jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const pB64 = b64uEnc(new TextEncoder().encode(JSON.stringify(payload)));
  const unsigned = 'GE1.' + pB64;
  const sigBuf = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + b64uEnc(new Uint8Array(sigBuf));
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `PRO-${seg()}-${seg()}`;
}

function addDays(baseIso, days) {
  const today = new Date().toISOString().slice(0, 10);
  const start = (baseIso && baseIso > today) ? baseIso : today;
  const d = new Date(start + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (parseInt(days, 10) || 30));
  return d.toISOString().slice(0, 10);
}

async function listAllLicenses(env) {
  const keys = await env.LICENSES_KV.list({prefix: 'lic:'});
  const items = await Promise.all(keys.keys.map(k => env.LICENSES_KV.get(k.name, 'json')));
  return items.filter(Boolean).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health' || path === '/') {
      return jsonRes({ok: true, service: 'Gestor Emprendedor Licencias API', hasKV: !!env.LICENSES_KV, hasSignKey: !!env.PRIVATE_KEY_JWK});
    }

    if (!env.LICENSES_KV) return jsonRes({ok: false, error: 'Falta enlazar LICENSES_KV en Cloudflare Worker'}, 500);

    // ---------- Endpoints Públicos (App del Emprendedor) ----------
    if (path === '/api/activate' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const rawCode = String(body.code || '').trim().toUpperCase();
      const deviceId = String(body.deviceId || '').trim().toUpperCase();
      if (!rawCode) return jsonRes({ok: false, error: 'Código requerido'}, 400);

      let lic = await env.LICENSES_KV.get('lic:' + rawCode, 'json');
      // También permitir buscar por correo electrónico si el cliente escribió su email
      if (!lic && rawCode.includes('@')) {
        const all = await listAllLicenses(env);
        lic = all.find(x => String(x.email || '').toUpperCase() === rawCode) || null;
      }
      if (!lic) return jsonRes({ok: false, error: 'Código de licencia no encontrado'}, 404);
      if (lic.status === 'suspended') return jsonRes({ok: false, error: lic.suspendReason || 'Esta licencia está suspendida'}, 403);

      const today = new Date().toISOString().slice(0, 10);
      if (lic.expiresAt < today) return jsonRes({ok: false, error: `Esta licencia venció el ${lic.expiresAt}. Contáctanos para renovarla.`}, 403);

      const devices = Array.isArray(lic.devices) ? lic.devices : [];
      const maxDev = Math.max(1, Number(lic.maxDevices || 1));
      if (deviceId && !devices.includes(deviceId)) {
        if (devices.length >= maxDev) {
          return jsonRes({ok: false, error: `Esta licencia ya alcanzó el límite de ${maxDev} dispositivo(s). Si cambiaste de teléfono, solicita restablecer tu dispositivo por WhatsApp.`}, 403);
        }
        devices.push(deviceId);
        lic.devices = devices;
      }
      if (body.businessName && !lic.businessName) lic.businessName = String(body.businessName).slice(0, 80);
      lic.lastCheckAt = new Date().toISOString();
      await env.LICENSES_KV.put('lic:' + lic.code, JSON.stringify(lic));

      const payload = {
        id: lic.code,
        name: lic.businessName || lic.customerName || '',
        plan: lic.plan || 'Plan Emprendedor',
        exp: lic.expiresAt,
        dev: deviceId || '*'
      };
      const token = await signPayload(payload, env.PRIVATE_KEY_JWK);
      return jsonRes({ok: true, code: lic.code, payload, token});
    }

    if (path === '/api/check' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const rawCode = String(body.code || '').trim().toUpperCase();
      const deviceId = String(body.deviceId || '').trim().toUpperCase();
      if (!rawCode) return jsonRes({ok: false, error: 'Código requerido'}, 400);

      const lic = await env.LICENSES_KV.get('lic:' + rawCode, 'json');
      if (!lic) return jsonRes({ok: false, status: 'not_found', error: 'Licencia no encontrada'}, 404);

      lic.lastCheckAt = new Date().toISOString();
      await env.LICENSES_KV.put('lic:' + lic.code, JSON.stringify(lic));

      if (lic.status === 'suspended') {
        return jsonRes({ok: true, status: 'suspended', reason: lic.suspendReason || 'Suscripción pausada por falta de pago.'});
      }
      const payload = {
        id: lic.code,
        name: lic.businessName || lic.customerName || '',
        plan: lic.plan || 'Plan Emprendedor',
        exp: lic.expiresAt,
        dev: deviceId || '*'
      };
      const token = await signPayload(payload, env.PRIVATE_KEY_JWK);
      return jsonRes({ok: true, status: 'active', code: lic.code, payload, token});
    }

    // ---------- Endpoints Privados del Dueño SaaS (requieren X-Admin-Key) ----------
    if (path.startsWith('/api/admin')) {
      const adminKey = request.headers.get('X-Admin-Key') || '';
      if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) {
        return jsonRes({ok: false, error: 'Clave de administrador incorrecta'}, 401);
      }

      if (path === '/api/admin/licenses' && request.method === 'GET') {
        const list = await listAllLicenses(env);
        return jsonRes({ok: true, licenses: list});
      }

      if (path === '/api/admin/licenses' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const code = String(b.code || genCode()).trim().toUpperCase();
        const existing = await env.LICENSES_KV.get('lic:' + code, 'json');
        const now = new Date().toISOString();
        const lic = {
          ...(existing || {}),
          code,
          customerName: String(b.customerName || '').trim(),
          businessName: String(b.businessName || '').trim(),
          phone: String(b.phone || '').trim(),
          email: String(b.email || '').trim().toLowerCase(),
          plan: String(b.plan || 'Plan Emprendedor').trim(),
          priceUsd: Number(b.priceUsd ?? 10),
          maxDevices: Math.max(1, parseInt(b.maxDevices || 1, 10)),
          expiresAt: b.expiresAt || addDays(null, b.days || 30),
          status: b.status || 'active',
          suspendReason: b.suspendReason || '',
          notes: String(b.notes || '').trim(),
          devices: Array.isArray(existing?.devices) ? existing.devices : [],
          payments: Array.isArray(existing?.payments) ? existing.payments : [],
          createdAt: existing?.createdAt || now,
          updatedAt: now
        };
        if (!existing && Number(b.initialPaymentUsd || 0) > 0) {
          lic.payments.unshift({at: now, amountUsd: Number(b.initialPaymentUsd), note: 'Activación inicial'});
        }
        await env.LICENSES_KV.put('lic:' + code, JSON.stringify(lic));
        const payload = {id: lic.code, name: lic.businessName || lic.customerName, plan: lic.plan, exp: lic.expiresAt, dev: '*'};
        const token = await signPayload(payload, env.PRIVATE_KEY_JWK);
        return jsonRes({ok: true, license: lic, token});
      }

      if (path === '/api/admin/renew' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const code = String(b.code || '').trim().toUpperCase();
        const lic = await env.LICENSES_KV.get('lic:' + code, 'json');
        if (!lic) return jsonRes({ok: false, error: 'Licencia no encontrada'}, 404);
        const days = parseInt(b.days || 30, 10);
        const now = new Date().toISOString();
        lic.expiresAt = addDays(lic.expiresAt, days);
        lic.status = 'active';
        lic.suspendReason = '';
        lic.updatedAt = now;
        lic.payments = Array.isArray(lic.payments) ? lic.payments : [];
        lic.payments.unshift({at: now, amountUsd: Number(b.amountUsd ?? lic.priceUsd ?? 10), days, note: b.note || `Renovación +${days} días`});
        await env.LICENSES_KV.put('lic:' + code, JSON.stringify(lic));
        const payload = {id: lic.code, name: lic.businessName || lic.customerName, plan: lic.plan, exp: lic.expiresAt, dev: '*'};
        const token = await signPayload(payload, env.PRIVATE_KEY_JWK);
        return jsonRes({ok: true, license: lic, token});
      }

      if (path === '/api/admin/status' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const code = String(b.code || '').trim().toUpperCase();
        const lic = await env.LICENSES_KV.get('lic:' + code, 'json');
        if (!lic) return jsonRes({ok: false, error: 'Licencia no encontrada'}, 404);
        lic.status = b.status === 'suspended' ? 'suspended' : 'active';
        lic.suspendReason = b.reason || '';
        lic.updatedAt = new Date().toISOString();
        await env.LICENSES_KV.put('lic:' + code, JSON.stringify(lic));
        return jsonRes({ok: true, license: lic});
      }

      if (path === '/api/admin/reset-device' && request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const code = String(b.code || '').trim().toUpperCase();
        const lic = await env.LICENSES_KV.get('lic:' + code, 'json');
        if (!lic) return jsonRes({ok: false, error: 'Licencia no encontrada'}, 404);
        lic.devices = [];
        lic.updatedAt = new Date().toISOString();
        await env.LICENSES_KV.put('lic:' + code, JSON.stringify(lic));
        return jsonRes({ok: true, license: lic});
      }

      if (path.startsWith('/api/admin/licenses/') && request.method === 'DELETE') {
        const code = decodeURIComponent(path.split('/').pop() || '').toUpperCase();
        await env.LICENSES_KV.delete('lic:' + code);
        return jsonRes({ok: true});
      }
    }

    return jsonRes({ok: false, error: 'Ruta no encontrada'}, 404);
  }
};
