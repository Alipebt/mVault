// sw.js —— Service Worker：离线缓存静态资源
// 缓存 PWA 的静态文件（应用壳），断网时也能打开应用。
// 文字数据本身在 IndexedDB（lightning-fs），离线可读。
//
// 策略：
// - HTML：network-first，避免旧版骨架被锁死。离线时回退到缓存。
// - 其它静态资源（css/js/svg/manifest）：cache-first，断网可启动。

const CACHE_VERSION = 'v7';
const CACHE_NAME = `memory-vault-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  './',
  './index.html?v=7',
  './style.css?v=7',
  './manifest.json?v=7',
  './app.bundle.js?v=7',
];

// 安装：预缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// 请求：HTML 用 network-first，其它用 cache-first
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isHtml = event.request.mode === 'navigate'
    || (event.request.headers.get('accept') || '').includes('text/html');

  if (isHtml) {
    // network-first：保证新版本骨架立即生效
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html?v=7', clone));
        }
        return response;
      }).catch(() => caches.match('./index.html?v=7'))
    );
    return;
  }

  // 其它静态资源：cache-first + 网络回填
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => new Response('离线', { status: 503 }));
    })
  );
});
