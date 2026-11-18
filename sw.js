// Service Worker - Spendly (PWA Offline Cache)
// Estrategia: Network-first con fallback a caché y actualización en segundo plano
const CACHE_NAME = "spendly-v7";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/state.js",
  "./js/recurring.js",
  "./js/chart.js",
  "./js/scanner.js",
  "./js/auth.js",
  "./js/cloud.js",
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
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // No cachear peticiones de Firebase (autenticación, Firestore)
  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== location.origin
  ) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((cached) => cached || caches.match("./index.html") || caches.match("index.html"))
      )
  );
});
