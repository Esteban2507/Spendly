/**
 * Spendly — autenticación opcional con Google.
 * Sin configuración o conexión, las finanzas locales siguen funcionando.
 * Solo se admite la configuración pública de una Firebase Web App, nunca claves privadas.
 */
(function (window) {
  "use strict";

  // Pinned official CDN release: Firebase JS SDK 13.3.0 (2026-11-11).
  const SDK_VERSION = "13.3.0";
  const SDK_URLS = Object.freeze(["app", "auth", "firestore"].map((product) =>
    `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-${product}-compat.js`));
  const CONFIG_TIMEOUT_MS = 3000;
  const SDK_TIMEOUT_MS = 12000;
  const SESSION_TIMEOUT_MS = 8000;
  const listeners = new Set();
  const statusListeners = new Set();
  const scriptLoads = new Map();
  let auth = null;
  let app = null;
  let user = null;
  let initialized = false;
  let initPromise = null;
  let signInPromise = null;
  let signOutPromise = null;
  let unsubscribeAuth = null;
  let epoch = 0;
  let authStatus = { available: false, ready: false, loading: false, code: "idle", reason: "Comprobando configuración de la nube.", warning: "" };

  function status() { return { ...authStatus }; }

  function safelyNotify(callback, value, details) {
    try {
      Promise.resolve(callback(value, details)).catch((error) => console.error("[Auth] Error en listener:", error));
    } catch (error) { console.error("[Auth] Error en listener:", error); }
  }

  function publishStatus(changes) {
    authStatus = { ...authStatus, ...changes };
    statusListeners.forEach((callback) => safelyNotify(callback, status()));
  }

  function publishUser(nextUser, force = false) {
    const changed = user !== nextUser;
    user = nextUser || null;
    if (changed || force) listeners.forEach((callback) => safelyNotify(callback, user, status()));
  }

  function unavailable(code, reason) {
    publishStatus({ available: false, ready: true, loading: false, code, reason });
    publishUser(null, !initialized);
    initialized = true;
    return status();
  }

  function authError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function bounded(promise, milliseconds, error, cancel) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { if (cancel) cancel(); reject(error); }, milliseconds);
    })]).finally(() => clearTimeout(timer));
  }

  function validConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.private_key || value.client_email || value.type === "service_account") return null;
    const required = ["apiKey", "authDomain", "projectId", "appId"];
    if (required.some((key) => typeof value[key] !== "string" || !value[key].trim() ||
      /REEMPLAZA|YOUR[_ -]|TU[_ -]|PLACEHOLDER|CHANGE[_ -]?ME|<|>/i.test(value[key]))) return null;
    if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(value.authDomain) || value.authDomain.includes("..")) return null;
    if (!/^[a-z][a-z0-9-]{4,62}$/i.test(value.projectId)) return null;
    const result = {};
    for (const key of [...required, "storageBucket", "messagingSenderId", "measurementId"]) {
      if (typeof value[key] === "string" && value[key].trim()) result[key] = value[key].trim();
    }
    return result;
  }

  async function loadConfig() {
    if (Object.hasOwn(window, "SPENDLY_FIREBASE_CONFIG")) return validConfig(window.SPENDLY_FIREBASE_CONFIG);
    if (typeof window.fetch !== "function") return null;
    const controller = typeof window.AbortController === "function" ? new window.AbortController() : null;
    try {
      const response = await bounded(window.fetch("./firebase-config.json", {
        cache: "no-store", credentials: "same-origin", ...(controller ? { signal: controller.signal } : {})
      }), CONFIG_TIMEOUT_MS, authError("auth/config-timeout", "No se pudo comprobar la configuración de la nube."),
      () => { if (controller) controller.abort(); });
      if (response.status === 404) return null;
      if (!response.ok) throw authError("auth/config-unavailable", "La configuración de la nube no está disponible.");
      return validConfig(await bounded(response.json(), CONFIG_TIMEOUT_MS,
        authError("auth/config-invalid", "No se pudo leer la configuración de la nube.")));
    } catch (error) {
      if (error && error.code) throw error;
      throw authError("auth/config-unavailable", "No se pudo comprobar la nube. Puedes continuar usando tus datos locales.");
    }
  }

  function loadScript(url) {
    if (scriptLoads.has(url)) return scriptLoads.get(url);
    const script = document.createElement("script");
    const promise = bounded(new Promise((resolve, reject) => {
      script.src = url;
      script.async = false;
      script.referrerPolicy = "no-referrer";
      script.onload = resolve;
      script.onerror = () => reject(authError("auth/sdk-unavailable", "No se pudo descargar el servicio de Google. Revisa la conexión."));
      document.head.appendChild(script);
    }), SDK_TIMEOUT_MS, authError("auth/sdk-timeout", "El servicio de Google no respondió a tiempo."), () => script.remove())
      .catch((error) => { script.remove(); scriptLoads.delete(url); throw error; });
    scriptLoads.set(url, promise);
    return promise;
  }

  async function loadSdk() {
    const checks = [() => window.firebase && typeof window.firebase.initializeApp === "function",
      () => window.firebase && typeof window.firebase.auth === "function",
      () => window.firebase && typeof window.firebase.firestore === "function"];
    for (let i = 0; i < SDK_URLS.length; i++) {
      if (window.firebase && window.firebase.SDK_VERSION && window.firebase.SDK_VERSION !== SDK_VERSION) {
        throw authError("auth/sdk-version-mismatch", "Hay otra versión de Firebase cargada. Actualiza la página antes de iniciar sesión.");
      }
      if (!checks[i]()) await loadScript(SDK_URLS[i]);
      if (!checks[i]()) throw authError("auth/sdk-unavailable", "El servicio de Google no se cargó correctamente.");
    }
  }

  async function initialize() {
    const attempt = ++epoch;
    publishStatus({ available: false, ready: false, loading: true, code: "loading", reason: "Comprobando la conexión con Google.", warning: "" });
    try {
      const config = await loadConfig();
      if (!config) return unavailable("not-configured", "La nube todavía no está configurada. Tus datos se guardan en este navegador.");
      await loadSdk();
      if (attempt !== epoch) return status();
      const firebase = window.firebase;
      const existing = (firebase.apps || []).find((candidate) => !candidate.name || candidate.name === "[DEFAULT]");
      if (existing && existing.options && (existing.options.projectId !== config.projectId || existing.options.appId !== config.appId)) {
        return unavailable("project-mismatch", "Hay otra configuración de Firebase en esta página. Recarga antes de iniciar sesión.");
      }
      app = existing || firebase.initializeApp(config);
      auth = typeof app.auth === "function" ? app.auth() : firebase.auth();
      if (!auth || typeof auth.onAuthStateChanged !== "function") throw authError("auth/sdk-unavailable", "El inicio de sesión no está disponible.");
      const persistence = firebase.auth.Auth.Persistence;
      try {
        await bounded(auth.setPersistence(persistence.LOCAL), SESSION_TIMEOUT_MS,
          authError("auth/persistence-unavailable", "No se pudo guardar la sesión en este dispositivo."));
      } catch (error) {
        await bounded(auth.setPersistence(persistence.NONE), SESSION_TIMEOUT_MS,
          authError("auth/persistence-unavailable", "Este navegador no permite iniciar una sesión segura."));
        publishStatus({ warning: "La sesión será temporal y se cerrará al recargar esta página." });
      }
      if (attempt !== epoch) return status();
      if (unsubscribeAuth) unsubscribeAuth();
      const initial = new Promise((resolve, reject) => {
        let firstEvent = true;
        unsubscribeAuth = auth.onAuthStateChanged((nextUser) => {
          if (attempt !== epoch) return;
          initialized = true;
          publishStatus({ available: true, ready: true, loading: false, code: "ready", reason: "Inicio de sesión disponible." });
          publishUser(nextUser, firstEvent);
          firstEvent = false;
          resolve();
        }, (error) => {
          if (attempt !== epoch) return;
          unavailable(error.code || "auth/session-error", "No se pudo comprobar tu sesión de Google. Tus datos locales siguen disponibles.");
          reject(error);
        });
      });
      await bounded(initial, SESSION_TIMEOUT_MS, authError("auth/session-timeout", "No se pudo comprobar tu sesión a tiempo. Puedes continuar usando tus datos locales."));
      return status();
    } catch (error) {
      if (attempt !== epoch) return status();
      epoch++; // Ignore any already queued callback belonging to the failed startup.
      if (unsubscribeAuth) { unsubscribeAuth(); unsubscribeAuth = null; }
      return unavailable(error.code || "auth/unavailable", error.message || "El inicio de sesión no está disponible. Tus datos locales siguen disponibles.");
    }
  }

  /** La app local no depende de esta promesa. Un fallo siempre resuelve un estado explícito. */
  function init(options = {}) {
    if (initPromise) return initPromise;
    if (initialized && !options.retry) return Promise.resolve(status());
    initPromise = initialize().finally(() => { initPromise = null; });
    return initPromise;
  }

  function signIn() {
    if (signInPromise) return signInPromise;
    if (!authStatus.available || !auth) return Promise.reject(authError("auth/unavailable", authStatus.reason));
    try {
      const provider = new window.firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      // Keep this call synchronous with the click, avoiding mobile popup blockers.
      signInPromise = Promise.resolve(auth.signInWithPopup(provider)).finally(() => { signInPromise = null; });
    } catch (error) { return Promise.reject(error); }
    return signInPromise;
  }

  /** Cerrar sesión nunca espera una operación de Firestore. Los errores se propagan a la UI. */
  function signOut() {
    if (signOutPromise) return signOutPromise;
    if (!auth) return Promise.resolve();
    try {
      signOutPromise = bounded(Promise.resolve(auth.signOut()), SESSION_TIMEOUT_MS,
        authError("auth/signout-timeout", "No se pudo cerrar la sesión a tiempo. Vuelve a intentarlo.")).then(() => {
        publishUser(null);
      }).finally(() => { signOutPromise = null; });
    } catch (error) { return Promise.reject(error); }
    return signOutPromise;
  }

  function onAuthChange(callback) {
    if (typeof callback !== "function") throw new TypeError("El listener debe ser una función.");
    listeners.add(callback);
    if (authStatus.ready) safelyNotify(callback, user, status());
    return () => listeners.delete(callback);
  }

  function onStatusChange(callback) {
    if (typeof callback !== "function") throw new TypeError("El listener debe ser una función.");
    statusListeners.add(callback);
    safelyNotify(callback, status());
    return () => statusListeners.delete(callback);
  }

  window.Spendly = window.Spendly || {};
  window.Spendly.Auth = { init, signIn, signOut, onAuthChange, onStatusChange,
    currentUser: () => user, isReady: () => authStatus.ready, status, getApp: () => app,
    SDK_VERSION, SDK_URLS };
})(window);
