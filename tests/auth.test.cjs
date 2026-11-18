const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
const config = { apiKey: 'public-web-api-key', authDomain: 'demo-project.firebaseapp.com', projectId: 'demo-project', appId: '1:123456:web:abcdef' };

function setup(options = {}) {
  const requests = [], scripts = [], errors = [], persistence = [];
  let observer = null, errorObserver = null, initCount = 0, unsubscribeCount = 0, popupCount = 0, logoutCount = 0;
  let resolvePopup;
  const instance = {
    setPersistence(value) { persistence.push(value); return options.persistence ? options.persistence(value) : Promise.resolve(); },
    onAuthStateChanged(success, failure) {
      observer = success; errorObserver = failure;
      if (!options.noInitialEvent) queueMicrotask(() => success(options.user || null));
      return () => { unsubscribeCount++; };
    },
    signInWithPopup(provider) {
      popupCount++;
      assert.equal(provider.params.prompt, 'select_account');
      if (options.signInThrows) throw new Error('popup error');
      return options.waitPopup ? new Promise((resolve) => { resolvePopup = resolve; }) : Promise.resolve({ user: { uid: 'signed-in' } });
    },
    signOut() { logoutCount++; return options.signOut ? options.signOut() : Promise.resolve(); }
  };
  function authFactory() { return instance; }
  authFactory.Auth = { Persistence: { LOCAL: 'local', NONE: 'none' } };
  authFactory.GoogleAuthProvider = class { setCustomParameters(params) { this.params = params; } };
  const app = { name: '[DEFAULT]', options: { ...config }, auth: authFactory };
  const firebase = {
    SDK_VERSION: '13.3.0', apps: options.existingApp ? [{ ...app, options: options.existingApp }] : [],
    initializeApp(received) {
      initCount++;
      assert.equal(received.projectId, config.projectId);
      if (options.initializeThrows) throw new Error('invalid API key');
      this.apps.push(app); return app;
    }, auth: authFactory, firestore() {}
  };
  const context = { console: { warn() {}, log() {}, error: (...args) => errors.push(args) },
    setTimeout: options.fastTimeout ? (callback, delay) => setTimeout(callback, Math.min(delay, 8)) : setTimeout,
    clearTimeout, AbortController, queueMicrotask,
    fetch: async (url, request) => {
      requests.push({ url, request });
      if (options.fetch) return options.fetch(url, request);
      return { status: 200, ok: true, json: async () => options.fetchedConfig ?? {} };
    },
    document: { createElement: () => ({ remove() {} }), head: { appendChild(script) {
      scripts.push(script.src);
      if (options.onScript) options.onScript(script, context, firebase);
      else queueMicrotask(() => script.onerror());
    } } }
  };
  if (!options.noSdk) context.firebase = firebase;
  if (Object.hasOwn(options, 'config')) context.SPENDLY_FIREBASE_CONFIG = options.config;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { Auth: context.Spendly.Auth, context, firebase, requests, scripts, errors, persistence,
    fireUser: (value) => observer(value), fireError: (value) => errorObserver(value),
    initCount: () => initCount, unsubscribeCount: () => unsubscribeCount, popupCount: () => popupCount,
    logoutCount: () => logoutCount, finishPopup: (value) => resolvePopup(value) };
}

test('missing public config leaves local mode ready and downloads no Firebase scripts', async () => {
  const env = setup({ noSdk: true });
  const result = await env.Auth.init();
  assert.equal(result.available, false);
  assert.equal(result.ready, true);
  assert.equal(result.code, 'not-configured');
  assert.equal(env.Auth.currentUser(), null);
  assert.equal(env.requests[0].url, './firebase-config.json');
  assert.equal(env.scripts.length, 0);
});

test('placeholder and private credential configs never initialize Firebase', async () => {
  for (const invalid of [{}, { ...config, apiKey: 'REEMPLAZA_CON_TU_API_KEY' }, { ...config, private_key: 'private' }, { ...config, authDomain: 'https://demo.test/path' }]) {
    const env = setup({ config: invalid });
    const result = await env.Auth.init();
    assert.equal(result.available, false);
    assert.equal(env.initCount(), 0);
    assert.equal(env.requests.length, 0);
    assert.equal(env.scripts.length, 0);
  }
});

test('valid config initializes once and publishes resolved user/session state', async () => {
  const env = setup({ config, user: { uid: 'user-a' } });
  const observed = [];
  env.Auth.onAuthChange((user) => observed.push(user && user.uid));
  const first = env.Auth.init(), second = env.Auth.init();
  assert.equal(first, second);
  const result = await first;
  await env.Auth.init();
  assert.equal(result.available, true);
  assert.equal(env.Auth.isReady(), true);
  assert.equal(env.Auth.currentUser().uid, 'user-a');
  assert.equal(env.initCount(), 1);
  assert.deepEqual(env.persistence, ['local']);
  assert.deepEqual(observed, ['user-a']);
});

test('SDK scripts load sequentially from pinned official CDN only after config validation', async () => {
  let count = 0;
  const env = setup({ config, noSdk: true, onScript(script, context, firebase) {
    count++;
    if (count === 1) context.firebase = { apps: firebase.apps, initializeApp: firebase.initializeApp };
    if (count === 2) context.firebase.auth = firebase.auth;
    if (count === 3) context.firebase.firestore = firebase.firestore;
    queueMicrotask(() => script.onload());
  } });
  const result = await env.Auth.init();
  assert.equal(result.available, true);
  assert.deepEqual(env.scripts, Array.from(env.Auth.SDK_URLS));
  assert.ok(env.scripts.every((url) => url.startsWith('https://www.gstatic.com/firebasejs/13.3.0/')));
});

test('bad SDK/config/session startup resolves an explicit unavailable result instead of throwing', async () => {
  for (const options of [
    { config, initializeThrows: true },
    { config, noSdk: true },
    { config, noInitialEvent: true, fastTimeout: true },
    { config, existingApp: { ...config, projectId: 'other-project' } },
    { config, noSdk: true, fastTimeout: true, onScript() {} }
  ]) {
    const env = setup(options);
    const result = await env.Auth.init();
    assert.equal(result.available, false);
    assert.equal(result.ready, true);
    assert.equal(result.loading, false);
    assert.ok(result.reason);
    assert.equal(env.Auth.currentUser(), null);
  }
});

test('optional config network failures are bounded and do not load external SDKs', async () => {
  const env = setup({ noSdk: true, fastTimeout: true, fetch: () => new Promise(() => {}) });
  const result = await env.Auth.init();
  assert.equal(result.code, 'auth/config-timeout');
  assert.equal(result.ready, true);
  assert.equal(env.scripts.length, 0);
});

test('blocked persistent storage falls back to a clearly marked temporary session', async () => {
  const env = setup({ config, persistence: (value) => value === 'local' ? Promise.reject(new Error('blocked')) : Promise.resolve() });
  const result = await env.Auth.init();
  assert.equal(result.available, true);
  assert.match(result.warning, /temporal/);
  assert.deepEqual(env.persistence, ['local', 'none']);
});

test('rejected async listeners are contained and subscriptions can be removed', async () => {
  const env = setup({ config });
  let calls = 0;
  const off = env.Auth.onAuthChange(async () => { calls++; throw new Error('listener rejected'); });
  await env.Auth.init();
  await new Promise((resolve) => setImmediate(resolve));
  off();
  env.fireUser({ uid: 'another-user' });
  assert.equal(calls, 1);
  assert.ok(env.errors.length > 0);
});

test('sign-in preserves popup click activation, avoids duplicate popup requests and propagates cancel/errors', async () => {
  const env = setup({ config, waitPopup: true });
  await env.Auth.init();
  const first = env.Auth.signIn(), second = env.Auth.signIn();
  assert.equal(env.popupCount(), 1);
  assert.equal(first, second);
  env.finishPopup({ user: { uid: 'signed-in' } });
  await first;
  const unavailable = setup({ config: {} });
  await unavailable.Auth.init();
  await assert.rejects(unavailable.Auth.signIn(), /configurada/);
});

test('sign-out never waits for cloud and only clears user on success', async () => {
  const env = setup({ config, user: { uid: 'user-a' } });
  env.context.Spendly.Cloud = { saveNow() { throw new Error('must not be called'); } };
  await env.Auth.init();
  await env.Auth.signOut();
  assert.equal(env.logoutCount(), 1);
  assert.equal(env.Auth.currentUser(), null);
  const failing = setup({ config, user: { uid: 'user-a' }, signOut: () => Promise.reject(new Error('signout blocked')) });
  await failing.Auth.init();
  await assert.rejects(failing.Auth.signOut(), /signout blocked/);
  assert.equal(failing.Auth.currentUser().uid, 'user-a');
});

test('an unresponsive sign-out reports failure and keeps session identity visible', async () => {
  const env = setup({ config, user: { uid: 'user-a' }, fastTimeout: true, signOut: () => new Promise(() => {}) });
  await env.Auth.init();
  await assert.rejects(env.Auth.signOut(), /cerrar la sesión a tiempo/);
  assert.equal(env.Auth.currentUser().uid, 'user-a');
});

test('late session callbacks after startup timeout cannot reactivate an unavailable session', async () => {
  const env = setup({ config, noInitialEvent: true, fastTimeout: true });
  const result = await env.Auth.init();
  assert.equal(result.code, 'auth/session-timeout');
  env.fireUser({ uid: 'late-user' });
  assert.equal(env.Auth.currentUser(), null);
  assert.equal(env.Auth.status().available, false);
});

test('incompatible already-loaded SDK versions are never mixed with the pinned release', async () => {
  const env = setup({ config });
  env.firebase.SDK_VERSION = '10.14.1';
  const result = await env.Auth.init();
  assert.equal(result.code, 'auth/sdk-version-mismatch');
  assert.equal(env.initCount(), 0);
  assert.equal(env.scripts.length, 0);
});
