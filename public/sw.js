/* ==========================================================================
   AuraStudy Lightweight App-Shell Service Worker (v2)
   - Caches static App Shell resources only using dynamic base path resolution.
   - STRICTLY NEVER caches Supabase API, Auth, or external AI API requests.
   ========================================================================== */

const CACHE_NAME = 'aurastudy-shell-v2';

const SCOPE_URL = new URL('./', self.location.href);
const BASE_PATH = SCOPE_URL.pathname.endsWith('/')
  ? SCOPE_URL.pathname
  : `${SCOPE_URL.pathname}/`;
const INDEX_URL = new URL('index.html', SCOPE_URL).href;

const APP_SHELL_RELATIVE_ASSETS = [
  '',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'apple-touch-icon.png',
];

const APP_SHELL_ASSETS = APP_SHELL_RELATIVE_ASSETS.map(
  (assetPath) => new URL(assetPath, SCOPE_URL).href,
);

const NEVER_CACHE_PATH_PREFIXES = [
  '/api/',
  '/auth/',
  '/rest/',
  '/storage/',
  '/realtime/',
  '/functions/',
  '/@vite/',
  '/@react-refresh',
  '/src/',
  '/node_modules/',
];

function shouldBypassCache(requestUrl, request) {
  if (request.method !== 'GET') {
    return true;
  }

  // Never cache any cross-origin requests (Supabase, Gemini, OpenAI, fonts CDN, etc.)
  if (requestUrl.origin !== self.location.origin) {
    return true;
  }

  const normalizedPath = requestUrl.pathname;
  const relativePath = normalizedPath.startsWith(BASE_PATH)
    ? `/${normalizedPath.slice(BASE_PATH.length)}`
    : normalizedPath;

  // Never cache API, Auth, or Vite dev source modules (root or subpath)
  return NEVER_CACHE_PATH_PREFIXES.some(
    (prefix) =>
      normalizedPath.startsWith(prefix) || relativePath.startsWith(prefix),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .catch(() => caches.delete(CACHE_NAME))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((staleKey) => caches.delete(staleKey)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (shouldBypassCache(url, request)) {
    return;
  }

  // Navigation requests: network-first, falling back to cached index.html offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match(INDEX_URL)) ||
            (await caches.match(SCOPE_URL.href));
          return cached || Response.error();
        }),
    );
    return;
  }

  // Static App Shell assets: cache-first with safe cache write
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.ok &&
          networkResponse.type === 'basic'
        ) {
          const copy = networkResponse.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return networkResponse;
      });
    }),
  );
});
