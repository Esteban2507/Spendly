// Service Worker - Spendly (PWA Offline Cache)
// Estrategia: Network-first con fallback a caché y actualización en segundo plano
const CACHE_NAME = "spendly-v9";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/state.js",
  "./js/recurring.js",
  "./js/chart.js",
  "./js/scanner.js",
  "./js/app.js",
  "./assets/brand/spendly-header-logo.png",
  "./assets/icons/app-icon-512.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-180.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((path) =>
        new Request(new URL(path, self.registration.scope), { cache: "reload" })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => /^spendly-v\d+$/.test(key) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (
    request.method !== "GET" ||
    !request.url.startsWith(self.registration.scope)
  ) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {}));
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return (await cache.match(new URL("./index.html", self.registration.scope).href)) || Response.error();
        }
        return Response.error();
      })
  );
});
