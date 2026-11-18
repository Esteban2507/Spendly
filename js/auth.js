/**
 * ============================================================================
 * Spendly - Autenticación con Firebase (Google Sign-In)
 * Funciona 100% en cliente, compatible con GitHub Pages (sin backend)
 * ============================================================================
 *
 * IMPORTANTE: Antes de usar, reemplaza el objeto firebaseConfig con el tuyo
 * desde https://console.firebase.google.com → Configuración del proyecto → SDK
 * ============================================================================
 */

(function (window) {
  "use strict";

  // ─── Configuración Firebase ──────────────────────────────────────────────────
  // ⚠️ Reemplaza estos valores con los de TU proyecto Firebase
  const firebaseConfig = {
    apiKey:            "REEMPLAZA_CON_TU_API_KEY",
    authDomain:        "REEMPLAZA_CON_TU_AUTH_DOMAIN",
    projectId:         "REEMPLAZA_CON_TU_PROJECT_ID",
    storageBucket:     "REEMPLAZA_CON_TU_STORAGE_BUCKET",
    messagingSenderId: "REEMPLAZA_CON_TU_MESSAGING_SENDER_ID",
    appId:             "REEMPLAZA_CON_TU_APP_ID"
  };

  // ─── Estado interno ──────────────────────────────────────────────────────────
  let _auth      = null;   // firebase.auth()
  let _user      = null;   // Usuario actual (null = no logueado)
  let _listeners = [];     // Callbacks registrados con onAuthChange()
  let _ready     = false;  // true una vez que Firebase resolvió el estado inicial

  // ─── Inicialización ──────────────────────────────────────────────────────────
  function init() {
    // Verificar que Firebase SDK esté cargado
    if (typeof firebase === "undefined") {
      console.warn("[Auth] Firebase SDK no encontrado. Verifica los scripts CDN en index.html.");
      return;
    }

    // Inicializar solo una vez
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    }

    _auth = firebase.auth();

    // Persistencia: mantener sesión aunque se cierre el navegador
    _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((err) => console.warn("[Auth] Error al configurar persistencia:", err));

    // Escuchar cambios de sesión
    _auth.onAuthStateChanged((user) => {
      _user  = user;
      _ready = true;
      _notifyListeners(user);
    });
  }

  // ─── Notificar a todos los listeners registrados ─────────────────────────────
  function _notifyListeners(user) {
    _listeners.forEach((cb) => {
      try { cb(user); } catch (e) { console.error("[Auth] Error en listener:", e); }
    });
  }

  // ─── API pública ─────────────────────────────────────────────────────────────

  /** Iniciar sesión con Google (ventana emergente) */
  function signIn() {
    if (!_auth) {
      console.warn("[Auth] Firebase no inicializado.");
      return Promise.reject(new Error("Firebase no inicializado"));
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return _auth.signInWithPopup(provider);
  }

  /** Cerrar sesión */
  function signOut() {
    if (!_auth) return Promise.resolve();
    return _auth.signOut();
  }

  /**
   * Registrar un callback que se llama cuando cambia el estado de sesión.
   * Se llama de inmediato si Firebase ya resolvió el estado inicial.
   */
  function onAuthChange(callback) {
    _listeners.push(callback);
    // Si ya resolvió, llamar de inmediato con el estado actual
    if (_ready) {
      try { callback(_user); } catch (e) { console.error("[Auth] Error en listener inicial:", e); }
    }
  }

  /** Devuelve el usuario actual (o null si no está logueado) */
  function currentUser() {
    return _user;
  }

  /** Devuelve true si Firebase ya cargó y determinó el estado de sesión */
  function isReady() {
    return _ready;
  }

  // ─── Exponer en namespace Spendly ────────────────────────────────────────────
  window.Spendly        = window.Spendly || {};
  window.Spendly.Auth   = { init, signIn, signOut, onAuthChange, currentUser, isReady };

})(window);
