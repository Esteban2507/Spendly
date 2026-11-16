"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../sw.js"), "utf8");
const SCOPE = "https://example.test/Spendly/";

test("the offline preparation covers the exact dependencies requested by the scanner", () => {
  const scanner = fs.readFileSync(require("node:path").join(__dirname, "../js/scanner.js"), "utf8");
  const urls = (text, pattern) => [...text.match(pattern)[1].matchAll(/"(https:[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(urls(source, /const SCANNER_ASSETS = \[([\s\S]*?)\];/),
    urls(scanner, /const ASSETS = Object\.freeze\(\[([\s\S]*?)\]\);/));
});

function worker(options = {}) {
  const handlers = {};
  const stores = new Map();
  const requests = [];
  const removed = [];
  let skipped = false;
  let claimed = false;
  const keyOf = (request) => new URL(typeof request === "string" ? request : request.url, SCOPE).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async addAll(paths) { paths.forEach((path) => data.set(keyOf(path), new Response("shell:" + keyOf(path)))); },
        async match(request, matchOptions) {
          let key = keyOf(request);
          if (matchOptions && matchOptions.ignoreSearch) {
            const found = [...data.keys()].find((candidate) => candidate.split("?")[0] === key.split("?")[0]);
            key = found || key;
          }
          const response = data.get(key);
          return response && response.clone();
        },
        async put(request, response) {
          if (options.failWrite) throw new Error("quota");
          data.set(keyOf(request), response.clone());
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { removed.push(name); return stores.delete(name); }
  };
  const context = {
    URL, Request, Response, AbortController, Set, Promise, setTimeout, clearTimeout, caches,
    self: {
      registration: { scope: SCOPE },
      location: { origin: new URL(SCOPE).origin },
      addEventListener(type, callback) { handlers[type] = callback; },
      async skipWaiting() { skipped = true; },
      clients: { async claim() { claimed = true; } }
    },
    async fetch(request, fetchOptions) {
      const url = typeof request === "string" ? request : request.url;
      requests.push({ url, options: fetchOptions });
      if (options.offline || options.failUrl === url) throw new Error("offline");
      return new Response("network:" + url, { status: options.status || 200 });
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  async function dispatch(type, payload = {}) {
    const pending = [];
    const event = { ...payload, waitUntil(promise) { pending.push(promise); } };
    let response;
    event.respondWith = (promise) => { response = Promise.resolve(promise); };
    handlers[type](event);
    if (response) response = await response;
    for (let index = 0; index < pending.length; index++) await pending[index];
    return response;
  }
  return {
    stores, requests, removed, caches, dispatch,
    get skipped() { return skipped; },
    get claimed() { return claimed; },
    async message(type) {
      const replies = [];
      await dispatch("message", { data: { type, requestId: "test" }, ports: [{ postMessage(message) { replies.push(message); } }] });
      return replies;
    }
  };
}

test("install keeps a complete shell without forcing a mixed-version update", async () => {
  const sw = worker();
  await sw.dispatch("install");
  assert.equal(sw.skipped, false);
  const cache = await sw.caches.open("spendly-shell-v7");
  assert.ok(await cache.match("./index.html"));
  assert.ok(await cache.match("./js/metrics.js"));
});

test("activation deletes only Spendly's obsolete caches", async () => {
  const sw = worker();
  await sw.caches.open("portfolio-offline");
  await sw.caches.open("spendly-v6");
  await sw.caches.open("spendly-shell-v7");
  await sw.caches.open("spendly-scanner-v1");
  await sw.dispatch("activate");
  assert.deepEqual(sw.removed, ["spendly-v6"]);
  assert.equal(sw.claimed, true);
  assert.ok(sw.stores.has("portfolio-offline"));
});

test("a cached navigation works offline without requesting the network", async () => {
  const sw = worker({ offline: true });
  await sw.dispatch("install");
  const response = await sw.dispatch("fetch", { request: { method: "GET", mode: "navigate", url: SCOPE + "?view=settings" } });
  assert.equal(await response.text(), "shell:" + SCOPE + "index.html");
  assert.equal(sw.requests.length, 0);
});

test("a missing script never gets the HTML fallback", async () => {
  const sw = worker({ offline: true });
  const response = await sw.dispatch("fetch", { request: { method: "GET", mode: "cors", url: SCOPE + "js/scanner.js" } });
  assert.equal(response.type, "error");
  assert.equal(response.status, 0);
});

test("foreign resources and POST requests are not intercepted", async () => {
  const sw = worker();
  assert.equal(await sw.dispatch("fetch", { request: { method: "GET", mode: "cors", url: "https://other.test/worker.js" } }), undefined);
  assert.equal(await sw.dispatch("fetch", { request: { method: "POST", mode: "cors", url: SCOPE } }), undefined);
  assert.equal(sw.requests.length, 0);
});

test("successful fetches are stored before the extended event finishes", async () => {
  const sw = worker();
  const url = SCOPE + "js/state.js";
  const response = await sw.dispatch("fetch", { request: { method: "GET", mode: "cors", url } });
  assert.match(await response.text(), /^network:/);
  const cache = await sw.caches.open("spendly-shell-v7");
  assert.ok(await cache.match(url));
});

test("scanner readiness stays false until all pinned components are cached", async () => {
  const sw = worker();
  const before = await sw.message("SCANNER_OFFLINE_STATUS");
  assert.equal(before[0].ready, false);
  assert.equal(before[0].cached, 0);
  const prepared = await sw.message("PREPARE_SCANNER_OFFLINE");
  assert.equal(prepared.at(-1).type, "SCANNER_OFFLINE_READY");
  assert.equal(prepared.at(-1).cached, 7);
  assert.equal(sw.requests.length, 7);
  assert.ok(sw.requests.every((entry) => entry.options.mode === "cors" && entry.options.credentials === "omit"));
  const after = await sw.message("SCANNER_OFFLINE_STATUS");
  assert.equal(after[0].ready, true);
  await sw.message("PREPARE_SCANNER_OFFLINE");
  assert.equal(sw.requests.length, 7);
});

test("a failed scanner preparation never reports ready and can be resumed", async () => {
  const sw = worker({ failUrl: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js" });
  const replies = await sw.message("PREPARE_SCANNER_OFFLINE");
  assert.equal(replies.at(-1).type, "SCANNER_OFFLINE_ERROR");
  assert.equal(replies.at(-1).ready, false);
  const status = await sw.message("SCANNER_OFFLINE_STATUS");
  assert.equal(status[0].cached, 2);
  assert.equal(status[0].ready, false);
});

test("a storage quota failure does not stop a successful online resource load", async () => {
  const sw = worker({ failWrite: true });
  const response = await sw.dispatch("fetch", { request: { method: "GET", mode: "cors", url: SCOPE + "js/state.js" } });
  assert.equal(response.status, 200);
});
