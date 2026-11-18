/** Spendly: sincronización por cuenta con revisión y comparación transaccional. */
(function (window) {
  "use strict";
  const DEBOUNCE_MS = 1500;
  let db = null;
  let activeUid = null;
  let epoch = 0;
  let timer = null;
  let pending = null;
  let flight = null;
  let flightToken = null;
  let paused = true;
  let status = { phase: "local", message: "Datos guardados en este dispositivo." };
  const listeners = new Set();
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function reportStatus(phase, message) {
    status = { phase, message };
    for (const id of ["sync-indicator", "cloud-status"]) {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = message;
        if (id === "sync-indicator") {
          element.className = "sync-indicator " + (phase === "error" || phase === "conflict" ? "sync-error" : phase === "saving" || phase === "loading" ? "syncing" : "synced");
          element.style.display = "";
        }
      }
    }
    listeners.forEach((listener) => { try { listener({ ...status }); } catch (err) { /* Un indicador no debe interrumpir el guardado. */ } });
  }
  function onStatus(callback) { listeners.add(callback); callback({ ...status }); return () => listeners.delete(callback); }
  function getStatus() { return { ...status }; }
  function init() {
    if (db) return true;
    if (!window.firebase || !window.firebase.firestore) { reportStatus("local", "La nube no está disponible. Tus datos permanecen locales."); return false; }
    try { db = window.firebase.firestore(); return true; }
    catch (err) { reportStatus("error", "No se pudo iniciar la sincronización. Tus datos locales se conservan."); return false; }
  }
  function docRef(uid) { return db.collection("users").doc(uid).collection("state").doc("data"); }
  function cancelPending() { clearTimeout(timer); timer = null; pending = null; }
  function setActiveUser(uid) {
    if (uid === activeUid) return;
    cancelPending(); activeUid = uid || null; epoch++; paused = true;
    reportStatus(activeUid ? "loading" : "local", activeUid ? "Comprobando los datos de esta cuenta…" : "Modo local. Los datos de tus cuentas permanecen separados.");
  }
  function pause() { paused = true; cancelPending(); return flight && flightToken === epoch ? flight : Promise.resolve(); }
  function resume() { paused = false; }
  function canonical(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  function revisionOf(doc) {
    if (!doc.exists) return null;
    const value = doc.data();
    if (typeof value.revision === "string" && value.revision) return value.revision;
    // Identidad exacta para documentos anteriores: no usa la fecha del gasto como versión.
    return "legacy:" + canonical({ state: value.state, updatedAt: value.updatedAt || null });
  }
  function validCloudState(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.expenses)) throw new Error("Los datos de la nube tienen un formato inválido.");
    if (Number(value.version) > 2) throw new Error("Los datos de la nube pertenecen a una versión más reciente.");
    const clean = window.Spendly.sanitizeState(value);
    if (clean.dropped > 0) throw new Error("Hay registros dañados en la nube. No se reemplazarán tus datos locales.");
    return { version: 2, expenses: clean.expenses, budget: clean.budget, currency: clean.currency, recurring: clean.recurring, dismissed: clean.dismissed };
  }
  function ensureSession(uid, token) {
    if (uid !== activeUid || token !== epoch) { const error = new Error("La cuenta cambió durante la operación."); error.code = "session-changed"; throw error; }
  }
  async function loadFromCloud(uid) {
    if (!db) throw new Error("La nube no está disponible.");
    const token = epoch;
    ensureSession(uid, token);
    const doc = await docRef(uid).get({ source: "server" });
    ensureSession(uid, token);
    if (!doc.exists) return { state: null, revision: null };
    return { state: validCloudState(doc.data().state), revision: revisionOf(doc) };
  }
  function makeItem(uid, state, baseline) {
    if (!db || !uid || uid !== activeUid || paused || baseline === undefined) return null;
    try { return { uid, state: validCloudState(clone(state)), baseline, token: epoch }; }
    catch (err) { reportStatus("error", err.message); return null; }
  }
  function scheduleSave(uid, state, baseline = window.Spendly.getCloudBaseline()) {
    const item = makeItem(uid, state, baseline);
    if (!item) return false;
    clearTimeout(timer); pending = item;
    reportStatus("pending", "Cambios locales pendientes de sincronizar.");
    timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, DEBOUNCE_MS);
    return true;
  }
  async function writeItem(item) {
    ensureSession(item.uid, item.token);
    reportStatus("saving", "Sincronizando los cambios de esta cuenta…");
    const ref = docRef(item.uid);
    const revision = "rev:" + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    await db.runTransaction(async (transaction) => {
      ensureSession(item.uid, item.token);
      const remote = await transaction.get(ref);
      ensureSession(item.uid, item.token);
      if (revisionOf(remote) !== item.baseline) { const error = new Error("La nube cambió en otro dispositivo. Tus datos locales se conservan; revisa el conflicto antes de continuar."); error.code = "sync-conflict"; throw error; }
      transaction.set(ref, { state: item.state, revision, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() });
    });
    ensureSession(item.uid, item.token);
    const acknowledged = window.Spendly.acceptCloudWrite(item.uid, revision, item.state, item.baseline);
    if (!acknowledged) throw new Error("La nube recibió el cambio, pero no se pudo actualizar el respaldo local. Descarga una copia antes de continuar.");
    if (pending && pending.uid === item.uid && pending.token === item.token && pending.baseline === item.baseline) pending.baseline = revision;
    reportStatus(window.Spendly.isCloudDirty() ? "pending" : "synced", window.Spendly.isCloudDirty() ? "Quedan cambios locales pendientes de sincronizar." : "Guardado en la nube y en este dispositivo.");
    return true;
  }
  async function flush() {
    if (flight && flightToken === epoch) { await flight; if (pending && !paused) return flush(); return false; }
    if (!pending || paused) return false;
    const item = pending; pending = null;
    const currentFlight = writeItem(item).catch((err) => {
      if (item.token === epoch && item.uid === activeUid) {
        paused = true; cancelPending();
        reportStatus(err.code === "sync-conflict" ? "conflict" : "error", err.message || "No se pudo sincronizar. Tus datos locales se conservan.");
      }
      return false;
    });
    flight = currentFlight; flightToken = item.token;
    const result = await currentFlight;
    if (flight === currentFlight) { flight = null; flightToken = null; }
    if (result && item.token === epoch && pending && !paused) return flush();
    return result;
  }
  function saveNow(uid, state, baseline = window.Spendly.getCloudBaseline()) {
    const item = makeItem(uid, state, baseline);
    if (!item) return Promise.resolve(false);
    clearTimeout(timer); timer = null; pending = item; return flush();
  }
  window.Spendly.Cloud = { init, setActiveUser, loadFromCloud, scheduleSave, saveNow, cancelPending,
    pause, resume, onStatus, getStatus, reportStatus };
})(window);
