// Service Worker — Gestor Emprendedor v5 (100% Local-First)
const CACHE_NAME = 'gestor-emprendedor-v5';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './tema.css',
  './movil.css',
  './diseno.css',
  './config.js',
  './localdb.js',
  './drive_sync.js',
  './licencias.js',
  './privacidad.html',
  './onboarding.js',
  './escaner.js',
  './compras.js',
  './inventario.js',
  './directorios.js',
  './produccion.js',
  './ventas.js',
  './finanzas.js',
  './reportes.js',
  './cotizaciones.js',
  './marketing.js',
  './recibo.js',
  './catalogo.js',
  './devoluciones.js',
  './panel.js',
  './gestion.js',
  './nomina.js',
  './planificacion.js',
  './seguridad.js',
  './importar.js',
  './apertura.js',
  './configuracion.js',
  './shell.js'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_ASSETS.map(url => cache.add(new Request(url, {cache: 'reload'}))));
    await Promise.allSettled([
      'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    ].map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.hostname.includes('dolarapi.com') || url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com') || url.hostname.includes('gstatic.com/gsi')) return;

  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await net) || new Response('', {status: 503});
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      try {
        const netPromise = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
        if (cached) return await Promise.race([netPromise, new Promise(res => setTimeout(() => res(cached), 2000))]);
        return await netPromise;
      } catch (e) {
        return cached || (req.mode === 'navigate' ? await cache.match('./index.html') : null) || new Response('Sin conexión', {status: 503});
      }
    })());
  }
});
