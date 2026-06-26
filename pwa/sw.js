const CACHE = 'pretrack-v5';
const STATIC = [
  '/Diecast-Trackings/',
  '/Diecast-Trackings/index.html',
  '/Diecast-Trackings/login.html',
  '/Diecast-Trackings/assets/css/global.css',
  '/Diecast-Trackings/assets/css/dashboard.css',
  '/Diecast-Trackings/assets/css/login.css',
  '/Diecast-Trackings/pwa/manifest.json',
];

// Never cache pages with secrets or dynamic data
const NEVER_CACHE = ['config.js','firestore','firebase','supabase','googleapis','gstatic'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (NEVER_CACHE.some(nc => url.includes(nc))) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
