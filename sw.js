const CACHE = 'convert-desk-v6';
const FILES = [
  './', './index.html', './styles.css', './app.js', './js/util.js', './js/tools-convert.js', './js/tools-image.js', './js/tools-pdf.js', './js/tools-util.js', './libs/qrcode.js',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './libs/pdf-lib.min.js', './libs/xlsx.full.min.js', './libs/mammoth.browser.min.js',
  './libs/pdfjs/pdf.min.js', './libs/pdfjs/pdf.worker.min.js', './libs/jszip.min.js',
];
self.addEventListener('install', (e) => e.waitUntil(
  caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())
));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));
// Network first so a reload picks up new versions; the cache answers when offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
