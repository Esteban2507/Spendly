/** Coordinate the authenticated profile and its independently stored cloud revision. */
(function (window) {
  "use strict";

  const api = window.Spendly;
  const { Cloud } = api;
  let session = 0;
  let request = 0;
  let reconciling = false;

  function open(uid) {
    session++;
    reconciling = false;
    Cloud.setActiveUser(uid);
    return api.switchProfile(uid);
  }

  async function reconcile({ useCloud = false } = {}) {
    const uid = api.getProfile();
    if (!uid || reconciling) return false;
    const currentSession = session;
    const currentRequest = ++request;
    const stillActive = () => session === currentSession && request === currentRequest && api.getProfile() === uid;
    const original = useCloud ? JSON.stringify(api.State) : null;
    reconciling = true;
    try {
      await Cloud.pause();
      if (!stillActive()) return false;
      Cloud.reportStatus("loading", "Consultando los datos de tu cuenta…");
      const remote = await Cloud.loadFromCloud(uid);
      if (!stillActive()) return false;
      const base = api.getCloudBaseline();
      const dirty = api.isCloudDirty();
      const alreadySaved = dirty && remote.state && api.sameSnapshot(api.State, remote.state);

      const newCloudProfile = base === undefined && remote.revision === null;
      if ((useCloud && original !== JSON.stringify(api.State)) ||
          (!useCloud && !newCloudProfile && !alreadySaved && base !== remote.revision && (dirty || (base && !remote.state)))) {
        Cloud.reportStatus("conflict", "Los datos de este dispositivo y los de la nube son distintos. Descargá un respaldo antes de elegir qué versión usar.");
        return false;
      }

      if (useCloud || alreadySaved || (base !== remote.revision && !dirty)) {
        if (!api.replaceFromCloud(remote.state, remote.revision, uid)) {
          Cloud.reportStatus("error", "No se pudo guardar la versión de la nube en este dispositivo.");
          return false;
        }
        Cloud.resume();
        Cloud.reportStatus("synced", "Datos de la cuenta actualizados.");
        return true;
      }

      // A server-confirmed missing document can receive the account's offline changes.
      if (base === undefined && !api.saveCloudBaseline(remote.revision, uid)) {
        Cloud.reportStatus("error", "No se pudo guardar el estado de sincronización en este dispositivo.");
        return false;
      }
      Cloud.resume();
      if (dirty) {
        Cloud.scheduleSave(uid, api.State, remote.revision);
      } else {
        Cloud.reportStatus("synced", "Datos de la cuenta actualizados.");
      }
      return true;
    } catch (error) {
      if (stillActive()) {
        Cloud.reportStatus("error", error.code === "permission-denied"
          ? "Firestore rechazó el acceso a los datos de esta cuenta. Revisá los permisos del proyecto."
          : "No se pudo consultar la nube. Tus datos guardados en este dispositivo siguen disponibles.");
      }
      return false;
    } finally {
      if (stillActive()) reconciling = false;
    }
  }

  api.Account = { open, reconcile };
})(window);
