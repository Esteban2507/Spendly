"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const SOURCE = fs.readFileSync(path.join(__dirname, "../sw.js"), "utf8");
const SCOPE = "https://example.test/Spendly/";
function worker({ offline = false, quota = false } = {}) {
  const handlers = {}, stores = new Map(), removed = [], fetched = [], installed = [];
  let skipped = false;
  const key = (r) => new URL(typeof r === "string" ? r : r.url, SCOPE).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) {
          requests.forEach((request) => {
            installed.push(request);
            entries.set(key(request), new Response("shell:" + key(request)));
          });
        },
        async match(request) { const r = entries.get(key(request)); return r && r.clone(); },
        async put(request, response) { if (quota) throw new Error("quota"); entries.set(key(request), response.clone()); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { removed.push(name); return stores.delete(name); }
  };
  const context = { URL, Request, Response, caches, Set, Promise,
    self: { registration: { scope: SCOPE }, addEventListener: (name, fn) => { handlers[name] = fn; },
      clients: { claim: async () => {} }, skipWaiting: () => { skipped = true; } },
    fetch: async (request) => { fetched.push(request.url); if (offline) throw new Error("offline"); return new Response("network"); }
  };
  vm.createContext(context); vm.runInContext(SOURCE, context);
  async function dispatch(name, payload = {}) {
    const waiting = [];
    let response;
    handlers[name]({ ...payload, waitUntil: (p) => waiting.push(p), respondWith: (p) => { response = Promise.resolve(p); } });
    if (response) response = await response;
    for (let i = 0; i < waiting.length; i++) await waiting[i];
    return response;
  }
  const get = (url, mode = "cors", method = "GET") => dispatch("fetch", { request: { url, mode, method } });
  return { caches, stores, removed, fetched, installed, dispatch, get, get skipped() { return skipped; } };
}

test("install refreshes a complete shell including account.js without forcing activation", async () => {
  const sw = worker(); await sw.dispatch("install");
  assert.equal(sw.skipped, false);
  assert.ok(sw.installed.every((r) => r.cache === "reload"));
  assert.ok(sw.installed.some((r) => r.url === SCOPE + "js/account.js"));
  assert.ok(!sw.installed.some((r) => r.url.endsWith("firebase-config.js")));
});

test("activation removes only obsolete Spendly version caches", async () => {
  const sw = worker();
  for (const name of ["portfolio-v1", "spendly-v7", "spendly-shell-v7", "spendly-shell-v8", "spendly-unrelated"]) await sw.caches.open(name);
  await sw.dispatch("activate");
  assert.deepEqual(sw.removed, ["spendly-v7", "spendly-shell-v7"]);
  assert.ok(sw.stores.has("portfolio-v1"));
  assert.ok(sw.stores.has("spendly-unrelated"));
});

test("application navigation loads its coherent cached version offline", async () => {
  const sw = worker({ offline: true }); await sw.dispatch("install");
  const response = await sw.get(SCOPE + "?tab=settings", "navigate");
  assert.equal(await response.text(), "shell:" + SCOPE + "index.html");
  assert.equal(sw.fetched.length, 0);
});

test("missing JavaScript returns a network error, never cached HTML", async () => {
  const sw = worker({ offline: true });
  const response = await sw.get(SCOPE + "js/account.js");
  assert.equal(response.type, "error");
  assert.equal(response.status, 0);
});

test("unknown routes and other projects never receive Spendly HTML", async () => {
  const sw = worker({ offline: true }); await sw.dispatch("install");
  for (const url of [SCOPE + "unknown", "https://example.test/portfolio/", "https://example.test/Spendly-other/"]) {
    assert.equal(await sw.get(url, "navigate"), undefined);
  }
});

test("config, cloud APIs and external SDKs are not intercepted", async () => {
  const sw = worker();
  for (const url of [SCOPE + "firebase-config.js", SCOPE + "__/auth/handler",
    "https://firestore.googleapis.com/v1/projects/example",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"]) {
    assert.equal(await sw.get(url), undefined);
  }
  assert.equal(await sw.get(SCOPE, "navigate", "POST"), undefined);
  assert.equal(sw.fetched.length, 0);
});

test("cache recovery waits for the cache write to complete", async () => {
  const sw = worker();
  const response = await sw.get(SCOPE + "js/state.js");
  assert.equal(await response.text(), "network");
  const cache = await sw.caches.open("spendly-shell-v8");
  assert.ok(await cache.match(SCOPE + "js/state.js"));
});

test("quota errors do not break a successful online request", async () => {
  const sw = worker({ quota: true });
  assert.equal((await sw.get(SCOPE + "js/state.js")).status, 200);
});
