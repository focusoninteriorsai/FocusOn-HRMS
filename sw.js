const CACHE_NAME = 'focuson-shell-phase1-v1';
const SHELL_FILES = [
  './index.html', './404.html', './manifest.webmanifest',
  './assets/css/tokens.css', './assets/css/base.css', './assets/css/components.css',
  './assets/css/animations.css', './assets/css/pages.css',
  './assets/js/config.js', './assets/js/api.js', './assets/js/auth.js', './assets/js/store.js',
  './assets/js/router.js', './assets/js/i18n.js', './assets/js/theme.js', './assets/js/ui.js',
  './assets/js/app.js', './assets/js/geo.js', './assets/js/camera.js',
  './assets/js/pages/dashboard.js', './assets/js/pages/profile.js',
  './assets/js/pages/change-password.js', './assets/js/pages/error.js',
  './assets/i18n/en.json', './assets/i18n/hi.json',
  './assets/icons/icon-192.svg', './assets/icons/icon-512.svg'
];
const SHELL_URLS = new Set(SHELL_FILES.map((path) => new URL(path, self.registration.scope).href));
const INDEX_URL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(INDEX_URL))
    );
    return;
  }
  if (!SHELL_URLS.has(url.href)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
      return cached || network;
    })
  );
});
