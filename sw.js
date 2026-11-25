/* فسيفساء | FUSAYFISA — Service Worker
   يخزن ملفات الواجهة لتعمل دون إنترنت. الصور نفسها محفوظة في IndexedDB وليست هنا.
   عند تعديل أي ملف من ملفات الواجهة: ارفع رقم CACHE_VERSION ليحصل المستخدمون على التحديث. */
const CACHE_VERSION = 'v2.4.0';
const SHELL_CACHE = `fusayfisa-shell-${CACHE_VERSION}`;
const FONT_CACHE = 'fusayfisa-fonts';
const LIB_CACHE = 'fusayfisa-ai-lib';
const SHELL = [
  './', './index.html', './style.css', './app.js', './ai.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // نطلب الملفات من الشبكة مباشرة لتجنب نسخ قديمة من ذاكرة المتصفح
    await cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fusayfisa-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'SHELL_CACHED', version: CACHE_VERSION }));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // الخطوط من Google: من الذاكرة أولاً ثم تحديثها في الخلفية
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }
  // مكتبة الذكاء (jsDelivr): تُخزن لتعمل دون إنترنت. ملفات النموذج نفسها تخزنها المكتبة في ذاكرتها الخاصة.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@huggingface/transformers') || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('onnxruntime-web'))) {
    event.respondWith(staleWhileRevalidate(req, LIB_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // صفحات التنقل: الشبكة أولاً، وعند انقطاع الإنترنت نعرض الصفحة المخزنة
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./')) || offlineFallback();
      }
    })());
    return;
  }
  // ملفات الواجهة: من الذاكرة فوراً مع تحديثها في الخلفية
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: cacheName === SHELL_CACHE });
  const network = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) return cached;
  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}

function offlineFallback() {
  return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>فسيفساء</title><body style="font-family:system-ui;padding:40px;text-align:center"><h1>فسيفساء</h1><p>أنت غير متصل، ولم تُخزَّن ملفات الموقع بعد. افتح الموقع مرة واحدة وأنت متصل بالإنترنت.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
