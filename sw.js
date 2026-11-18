// Spendly: cache one complete application version; leave account APIs and config alone.
"use strict";
const CACHE_NAME = "spendly-shell-v8";
const OLD_SPENDLY_CACHE = /^spendly-(?:v\d+|shell-v\d+)$/;
const APP_SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./css/styles.css",
  "./js/state.js", "./js/recurring.js", "./js/chart.js", "./js/scanner.js",
  "./js/auth.js", "./js/cloud.js", "./js/account.js", "./js/app.js",
  "./assets/brand/spendly-header-logo.png", "./assets/icons/app-icon-512.png",
  "./assets/icons/icon-512.png", "./assets/icons/icon-192.png",
  "./assets/icons/icon-180.png", "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon.ico"
];
const scopeUrl = new URL(self.registration.scope);
const indexUrl = new URL("./index.html", scopeUrl).href;
const shellUrls = new Set(APP_SHELL.map((path) => new URL(path, scopeUrl).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    APP_SHELL.map((path) => new Request(new URL(path, scopeUrl), { cache: "reload" }))
  )));
  // Do not skipWaiting: existing tabs keep a coherent old version until closed.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => OLD_SPENDLY_CACHE.test(key) && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

async function serveShell(event, key) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(event.request);
    if (response.ok && response.type !== "opaque") {
      const copy = response.clone();
      event.waitUntil(cache.put(key, copy).catch(() => {}));
    }
    return response;
  } catch (error) {
    // Never return HTML for missing JavaScript, CSS, images or auth requests.
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin) return;
  url.search = "";
  url.hash = "";
  // Only the actual application entry points may use the cached HTML.
  const isAppNavigation = request.mode === "navigate" &&
    (url.href === scopeUrl.href || url.href === indexUrl);
  if (isAppNavigation) {
    event.respondWith(serveShell(event, indexUrl));
  } else if (request.mode !== "navigate" && shellUrls.has(url.href)) {
    event.respondWith(serveShell(event, url.href));
  }
  // No catch-all: firebase-config.js, Firebase SDK/API calls, other projects and
  // unknown routes retain their real response or network error.
});
