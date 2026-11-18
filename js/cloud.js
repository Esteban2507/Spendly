/**
 * ============================================================================
 * Spendly - Sincronización en la Nube con Firebase Firestore
 * Lee y escribe el estado completo del usuario en Firestore.
 * Funciona junto a localStorage como capa de persistencia adicional.
 * ============================================================================
 */

(function (window) {
  "use strict";

  // ─── Configuración ───────────────────────────────────────────────────────────
  const COLLECTION    = "users";      // Colección principal en Firestore
  const DOC_FIELD     = "data";       // Documento que contiene el estado
  const DEBOUNCE_MS   = 1500;         // Esperar este tiempo antes de guardar (evitar exceso de escrituras)

  let _db          = null;    // firebase.firestore()
  let _saveTimer   = null;    // Timer del debounce
  let _saving      = false;   // Indicador de guardado en progreso

  // ─── Inicialización ──────────────────────────────────────────────────────────
  function init() {
    if (typeof firebase === "undefined" || !firebase.firestore) {
      console.warn("[Cloud] Firestore SDK no disponible.");
      return;
    }
    _db = firebase.firestore();

    // Habilitar persistencia offline (IndexedDB) para acceso sin conexión
    _db.enablePersistence({ synchronizeTabs: true })
      .catch((err) => {
        if (err.code === "failed-precondition") {
          // Múltiples pestañas abiertas → solo funciona en la primera
          console.warn("[Cloud] Persistencia offline desactivada (múltiples pestañas).");
        } else if (err.code === "unimplemented") {
          // Navegador no compatible
          console.warn("[Cloud] Este navegador no soporta persistencia offline de Firestore.");
        }
      });
  }

  // ─── Ruta del documento del usuario ─────────────────────────────────────────
  function _userDocRef(uid) {
    return _db.collection(COLLECTION).doc(uid).collection("state").doc(DOC_FIELD);
  }

  // ─── Cargar datos desde Firestore ────────────────────────────────────────────
  /**
   * Lee el estado guardado en Firestore para el usuario dado.
   * Devuelve una promesa con el estado deserializado, o null si no hay datos.
   */
  function loadFromCloud(uid) {
    if (!_db) return Promise.resolve(null);

    return _userDocRef(uid)
      .get()
      .then((doc) => {
        if (!doc.exists) return null;
        const data = doc.data();
        // Firestore guarda arrays como arrays y objetos como objects → deserializar directo
        return data && data.state ? data.state : null;
      })
      .catch((err) => {
        console.error("[Cloud] Error al cargar desde Firestore:", err);
        return null;
      });
  }

  // ─── Guardar datos en Firestore (con debounce) ───────────────────────────────
  /**
   * Programa un guardado en Firestore con debounce para no escribir con cada tecla.
   * Llama a esta función después de cualquier cambio en el Estado.
   */
  function scheduleSave(uid, state) {
    if (!_db || !uid) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => _doSave(uid, state), DEBOUNCE_MS);
  }

  /** Guardado inmediato (sin debounce). Usado al cerrar sesión. */
  function saveNow(uid, state) {
    if (!_db || !uid) return Promise.resolve();
    clearTimeout(_saveTimer);
    return _doSave(uid, state);
  }

  function _doSave(uid, state) {
    if (!_db) return Promise.resolve();
    _saving = true;
    _updateSyncIndicator(true);

    // Serializar el estado (Firestore no acepta clases propias, pero State es POJO)
    const payload = {
      state:     JSON.parse(JSON.stringify(state)),  // deep clone seguro
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    return _userDocRef(uid)
      .set(payload, { merge: true })
      .then(() => {
        _saving = false;
        _updateSyncIndicator(false);
      })
      .catch((err) => {
        _saving = false;
        _updateSyncIndicator(false, true);
        console.error("[Cloud] Error al guardar en Firestore:", err);
      });
  }

  // ─── Estrategia de Merge al iniciar sesión ───────────────────────────────────
  /**
   * Al loguearse, combina los datos locales con los de Firestore.
   * Regla: se toma la UNIÓN de gastos (por ID). En conflicto, gana el más reciente por fecha.
   * Presupuesto y divisa: se usa el de Firestore si existe, si no el local.
   */
  function mergeStates(localState, cloudState) {
    if (!cloudState) return localState;  // No hay datos en la nube → usar local
    if (!localState) return cloudState;  // No hay datos locales → usar nube

    const { sanitizeState } = window.Spendly;

    // Unir gastos por id (evitar duplicados)
    const expMap = new Map();
    (cloudState.expenses  || []).forEach((e) => expMap.set(e.id, e));
    (localState.expenses  || []).forEach((e) => {
      if (!expMap.has(e.id)) expMap.set(e.id, e);
      // Si existe en ambos, el de la nube tiene prioridad (fue guardado antes del merge)
    });

    // Unir reglas recurrentes por id
    const rulMap = new Map();
    (cloudState.recurring || []).forEach((r) => rulMap.set(r.id, r));
    (localState.recurring || []).forEach((r) => {
      if (!rulMap.has(r.id)) rulMap.set(r.id, r);
    });

    // Preferir configuración de la nube (es la más reciente o del dispositivo principal)
    const merged = {
      expenses:  Array.from(expMap.values()),
      recurring: Array.from(rulMap.values()),
      dismissed: [...new Set([...(cloudState.dismissed || []), ...(localState.dismissed || [])])],
      budget:    cloudState.budget    ?? localState.budget    ?? 0,
      currency:  cloudState.currency  || localState.currency  || "EUR"
    };

    return sanitizeState ? sanitizeState(merged).state : merged;
  }

  // ─── Indicador visual de sincronización ─────────────────────────────────────
  function _updateSyncIndicator(syncing, error = false) {
    const el = document.getElementById("sync-indicator");
    if (!el) return;
    if (syncing) {
      el.textContent  = "🔄 Sincronizando...";
      el.className    = "sync-indicator syncing";
      el.style.display = "";
    } else if (error) {
      el.textContent  = "⚠️ Error al sincronizar";
      el.className    = "sync-indicator sync-error";
      setTimeout(() => { if (el) el.style.display = "none"; }, 3000);
    } else {
      el.textContent  = "☁️ Guardado";
      el.className    = "sync-indicator synced";
      setTimeout(() => { if (el) el.style.display = "none"; }, 2000);
    }
  }

  // ─── Exponer en namespace Spendly ────────────────────────────────────────────
  window.Spendly       = window.Spendly || {};
  window.Spendly.Cloud = {
    init,
    loadFromCloud,
    scheduleSave,
    saveNow,
    mergeStates
  };

})(window);
