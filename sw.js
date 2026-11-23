// Service Worker v27: caché completa para que toda la herramienta funcione sin internet
const CACHE_NAME = 'gestor-negocio-v27';
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
  './offline.js',
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
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
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

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('.supabase.co') || url.hostname.includes('dolarapi.com')) {
    return;
  }

  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const netFetch = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await netFetch) || new Response('', {status: 503});
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const netPromise = fetch(req).then(res => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        });
        const cached = await cache.match(req);
        if (cached) {
          return await Promise.race([
            netPromise,
            new Promise((resolve) => setTimeout(() => resolve(cached), 3000))
          ]);
        }
        return await netPromise;
      } catch (err) {
        const cached = await cache.match(req) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
        if (cached) return cached;
        return new Response('Sin conexión y recurso no almacenado en caché.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
      }
    })());
  }
});
