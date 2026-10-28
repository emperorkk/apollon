// Apollon service worker: push notifications + offline support.
//
// Offline strategy
//  - App shell (HTML, CSS, JS, icons) is precached at install, so the
//    dashboard opens without a connection.
//  - API reads, report pages and map tiles are network-first: always fresh
//    when online, and the last copy seen is served when offline.
//  - Version-pinned CDN libraries (unpkg, esm.sh) are cache-first — their
//    URLs never change content.
//  - Writes, auth and admin calls are never cached.
//
// Bump SW_VERSION with each release that changes precached files, so
// clients pick up the new shell (old caches are deleted on activate).
const SW_VERSION = 'v1.6.0';
const SHELL_CACHE = `apollon-shell-${SW_VERSION}`;
const RUNTIME_CACHE = 'apollon-runtime';
const TILE_CACHE = 'apollon-tiles';
const CDN_CACHE = 'apollon-cdn';
const MAX_RUNTIME_ENTRIES = 150;
const MAX_TILE_ENTRIES = 300;
const NETWORK_TIMEOUT_MS = 8000;

// Canonical URLs only: static assets redirect /x.html -> /x, and a cached
// redirect can't be used to answer a navigation.
const SHELL = [
  '/',
  '/offline',
  '/site.webmanifest',
  '/css/main.css',
  '/css/map.css',
  '/css/report.css',
  '/js/app.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/card.js',
  '/js/config.js',
  '/js/feed.js',
  '/js/graph.js',
  '/js/keywords.js',
  '/js/map.js',
  '/js/push.js',
  '/js/share.js',
  '/js/state.js',
  '/js/utils.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('apollon-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

function fetchWithTimeout(request) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
  ]);
}

async function networkFirst(request, cacheName, maxEntries, fallback) {
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
      trimCache(cacheName, maxEntries);
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallback) return fallback();
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Never cache auth, admin, push or health.
    if (/^\/api\/(auth|admin|push|health)/.test(url.pathname) || url.pathname.startsWith('/admin')) return;

    if (url.pathname.startsWith('/api/')) {
      event.respondWith(networkFirst(request, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
      return;
    }

    if (request.mode === 'navigate') {
      // Report pages and the dashboard: fresh when online; offline, the last
      // copy of this page, else the dashboard shell (for SPA paths), else
      // the offline page.
      event.respondWith(
        networkFirst(request, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES, async () => {
          const isReport = /^\/(el\/)?reports/.test(url.pathname);
          return (!isReport && (await caches.match('/'))) || caches.match('/offline');
        })
      );
      return;
    }

    if (/\.(css|js|png|webmanifest)$/.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(request));
    }
    return;
  }

  if (url.hostname === 'unpkg.com' || url.hostname === 'esm.sh') {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    // Network-first per OSM's tile policy (no prefetching); viewed tiles
    // stay available offline.
    event.respondWith(networkFirst(request, TILE_CACHE, MAX_TILE_ENTRIES, () => new Response('', { status: 504 })));
  }
});

// --- Push notifications ---------------------------------------------------

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Apollon';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
