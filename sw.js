/* Spendly: application snapshots and an explicitly prepared receipt reader. */
"use strict";

const CACHE_PREFIX = "spendly-";
const SHELL_CACHE = "spendly-shell-v7";
const SCANNER_CACHE = "spendly-scanner-v1";
const APP_SHELL = [
  "./", "./index.html", "./manifest.webmanifest", "./css/styles.css",
  "./js/state.js", "./js/recurring.js", "./js/metrics.js", "./js/chart.js",
  "./js/scanner.js", "./js/app.js", "./assets/brand/spendly-header-logo.png",
  "./assets/icons/app-icon-512.png", "./assets/icons/icon-512.png",
  "./assets/icons/icon-192.png", "./assets/icons/icon-180.png",
  "./assets/icons/apple-touch-icon.png", "./assets/icons/favicon.ico"
];

// Keep this exhaustive list in sync with Scanner.ASSETS. No user files are sent here.
const SCANNER_ASSETS = [
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.min.mjs",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.worker.min.mjs",
  "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-lstm.wasm.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-lstm.wasm",
  "https://tessdata.projectnaptha.com/4.0.0/spa.traineddata.gz"
];

const scannerUrls = new Set(SCANNER_ASSETS);
const shellUrls = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href));
const shellIndex = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  // Let the old worker serve its complete snapshot until its tabs close.
  // Forcing activation can mix old JavaScript with a new data schema.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(
    APP_SHELL.map((path) => new Request(new URL(path, self.registration.scope), { cache: "reload" }))
  )));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== SCANNER_CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

function cacheWrite(event, cacheName, request, response) {
  if (!response.ok || response.type === "opaque") return;
  const copy = response.clone();
  event.waitUntil(caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {}));
}

async function serveShell(event, isNavigation) {
  const cache = await caches.open(SHELL_CACHE);
  const key = isNavigation ? shellIndex : event.request;
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(event.request);
    cacheWrite(event, SHELL_CACHE, key, response);
    return response;
  } catch (error) {
    // A stylesheet/worker/image must never receive index.html as its response.
    return Response.error();
  }
}

async function serveScannerAsset(event) {
  const cache = await caches.open(SCANNER_CACHE);
  const cached = await cache.match(event.request.url);
  if (cached) return cached;
  try {
    const response = await fetch(event.request);
    cacheWrite(event, SCANNER_CACHE, event.request.url, response);
    return response;
  } catch (error) {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (scannerUrls.has(url.href)) {
    event.respondWith(serveScannerAsset(event));
    return;
  }
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const withoutSearch = new URL(url.href);
  withoutSearch.search = "";
  withoutSearch.hash = "";
  const isNavigation = event.request.mode === "navigate";
  if (isNavigation || shellUrls.has(withoutSearch.href)) {
    event.respondWith(serveShell(event, isNavigation));
  }
});

async function scannerStatus() {
  const cache = await caches.open(SCANNER_CACHE);
  const present = await Promise.all(SCANNER_ASSETS.map((url) => cache.match(url)));
  const cached = present.filter(Boolean).length;
  return { ready: cached === SCANNER_ASSETS.length, cached, total: SCANNER_ASSETS.length };
}

let preparingScanner = null;
async function prepareScanner(report) {
  const cache = await caches.open(SCANNER_CACHE);
  let cached = 0;
  for (const url of SCANNER_ASSETS) {
    if (!(await cache.match(url))) {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 90000);
      try {
        const response = await fetch(url, { mode: "cors", credentials: "omit", signal: abort.signal });
        if (!response.ok || response.type === "opaque") throw new Error("No se pudo descargar un componente del lector.");
        await cache.put(url, response);
      } finally {
        clearTimeout(timeout);
      }
    }
    cached++;
    report({ type: "SCANNER_OFFLINE_PROGRESS", cached, total: SCANNER_ASSETS.length });
  }
  const status = await scannerStatus();
  if (!status.ready) throw new Error("El navegador no pudo conservar todos los componentes. Revisa el espacio disponible.");
  return status;
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (!["SCANNER_OFFLINE_STATUS", "PREPARE_SCANNER_OFFLINE"].includes(data.type)) return;
  const port = event.ports && event.ports[0];
  const reply = (message) => {
    const payload = { ...message, requestId: data.requestId };
    if (port) port.postMessage(payload);
    else if (event.source) event.source.postMessage(payload);
  };
  event.waitUntil((async () => {
    try {
      if (data.type === "SCANNER_OFFLINE_STATUS") {
        reply({ type: "SCANNER_OFFLINE_STATUS", ...await scannerStatus() });
        return;
      }
      // Concurrent callers share work; each gets its own final readiness result.
      if (!preparingScanner) preparingScanner = prepareScanner(reply).finally(() => { preparingScanner = null; });
      const status = await preparingScanner;
      reply({ type: "SCANNER_OFFLINE_READY", ...status });
    } catch (error) {
      reply({
        type: "SCANNER_OFFLINE_ERROR", ready: false,
        error: "No se completó la preparación. Comprueba la conexión y el espacio disponible e inténtalo de nuevo."
      });
    }
  })());
});

