/**
 * ============================================================================
 * Spendly - Gestión de Estado, Almacenamiento y Utilidades
 * Paleta de colores vibrantes, iconos y persistencia
 * ============================================================================
 */

(function (window) {
  "use strict";

  // Categorías con colores vibrantes y emojis característicos
  const CATS = [
    ["Comida", "#f97316", "🍔"],
    ["Transporte", "#2563eb", "🚗"],
    ["Vivienda", "#7c3aed", "🏠"],
    ["Ocio", "#db2777", "🎮"],
    ["Salud", "#059669", "💊"],
    ["Compras", "#d97706", "🛍️"],
    ["Suscripciones", "#0891b2", "📺"],
    ["Otros", "#64748b", "📦"]
  ];

  const COL = Object.fromEntries(CATS.map(([cat, color]) => [cat, color]));
  const CAT_ICONS = Object.fromEntries(CATS.map(([cat, _, icon]) => [cat, icon]));
  const STORAGE_KEY = "gastos-v1";
  const DATA_VERSION = 2;
  const CURRENCIES = ["EUR", "USD", "MXN", "ARS", "COP", "CLP", "GBP", "UYU", "PEN"];

  // Idioma para formatear importes: el del teléfono si es español (es-AR, es-MX...), si no es-ES
  const LOCALE = /^es(-|$)/i.test(navigator.language || "") ? navigator.language : "es-ES";

  /** Lee un importe completo; nunca concatena números ni elimina signos negativos. */
  function parseAmount(raw) {
    if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 && raw <= Number.MAX_SAFE_INTEGER / 100 ? raw : NaN;
    let s = String(raw == null ? "" : raw).trim();
    const currency = "(?:ARS|USD|EUR|MXN|COP|CLP|GBP|UYU|PEN|US\\$|U\\$D|AR\\$|[$€£])";
    s = s.replace(new RegExp("^" + currency + "\\s*", "i"), "").replace(new RegExp("\\s*" + currency + "$", "i"), "").trim();
    if (/\s/.test(s)) {
      if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(s)) return NaN;
      s = s.replace(/[ \u00a0\u202f]/g, "");
    }
    if (!/^\d+(?:[.,]\d+)*$/.test(s)) return NaN;
    const hasDot = s.includes(".");
    const hasComma = s.includes(",");
    if (hasDot && hasComma) {
      const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
      const grouping = decimal === "," ? "." : ",";
      const parts = s.split(decimal);
      if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return NaN;
      const grouped = new RegExp("^\\d{1,3}(?:\\" + grouping + "\\d{3})+$");
      if (!grouped.test(parts[0])) return NaN;
      s = parts[0].split(grouping).join("") + "." + parts[1];
    } else if (hasDot || hasComma) {
      const sep = hasDot ? "." : ",";
      const parts = s.split(sep);
      if (parts.length > 2) {
        if (!/^\d{1,3}$/.test(parts[0]) || parts.slice(1).some((p) => !/^\d{3}$/.test(p))) return NaN;
        s = parts.join("");
      } else if (parts[1].length === 3 && parts[0] !== "0") {
        if (!/^\d{1,3}$/.test(parts[0])) return NaN;
        s = parts.join("");
      } else {
        if (parts[1].length > 2 && !(parts[0] === "0" && parts[1].length === 3)) return NaN;
        s = parts[0] + "." + parts[1];
      }
    }
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100 ? n : NaN;
  }

  // ---- Validación y limpieza de datos (localStorage o respaldos importados) ----
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTH_RE = /^\d{4}-\d{2}$/;

  function isValidDate(str) {
    if (typeof str !== "string" || !DATE_RE.test(str)) return false;
    const [y, m, d] = str.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function sanitizeExpense(e, usedIds) {
    if (!e || typeof e !== "object" || !isValidDate(e.date)) return null;
    const amount = Number(e.amount);
    if (!isFinite(amount) || amount <= 0) return null;
    let id = typeof e.id === "string" && e.id ? e.id : "";
    if (!id || usedIds.has(id)) id = uid(); // ids únicos: borrar uno nunca borra otros
    usedIds.add(id);
    const clean = {
      id,
      desc: String(e.desc == null ? "" : e.desc).trim().slice(0, 80) || "Sin descripción",
      amount: Math.round(amount * 100) / 100,
      cat: Object.hasOwn(COL, e.cat) ? e.cat : "Otros",
      date: e.date
    };
    if (e.rid) clean.rid = String(e.rid);
    if (typeof e.sourceHash === "string" && /^[a-f0-9]{64}$/i.test(e.sourceHash)) clean.sourceHash = e.sourceHash.toLowerCase();
    if (typeof e.receiptFingerprint === "string" && e.receiptFingerprint.length <= 256) clean.receiptFingerprint = e.receiptFingerprint;
    return clean;
  }

  function sanitizeRule(r, usedIds) {
    if (!r || typeof r !== "object" || typeof r.desc !== "string" || !r.desc.trim()) return null;
    const amount = Number(r.amount);
    const day = Math.round(Number(r.day));
    if (!isFinite(amount) || amount <= 0 || !(day >= 1 && day <= 31)) return null;
    if (typeof r.from !== "string" || !MONTH_RE.test(r.from)) return null;
    let id = typeof r.id === "string" && r.id ? r.id : "";
    if (!id || usedIds.has(id)) id = uid();
    usedIds.add(id);
    return {
      id,
      desc: r.desc.trim().slice(0, 80),
      amount: Math.round(amount * 100) / 100,
      cat: Object.hasOwn(COL, r.cat) ? r.cat : "Otros",
      day,
      from: r.from,
      done: Array.isArray(r.done) ? r.done.filter((m) => typeof m === "string" && MONTH_RE.test(m)) : []
    };
  }

  /** Devuelve una copia limpia del estado y cuántos registros dañados se descartaron. */
  function sanitizeState(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const expIds = new Set();
    const ruleIds = new Set();
    const inExp = Array.isArray(src.expenses) ? src.expenses : [];
    const inRules = Array.isArray(src.recurring) ? src.recurring : [];
    const expenses = inExp.map((e) => sanitizeExpense(e, expIds)).filter(Boolean);
    const recurring = inRules.map((r) => sanitizeRule(r, ruleIds)).filter(Boolean);
    return {
      expenses,
      recurring,
      dismissed: Array.isArray(src.dismissed) ? src.dismissed.filter((k) => typeof k === "string") : [],
      budget: Math.max(0, Number(src.budget) || 0),
      currency: CURRENCIES.includes(src.currency) ? src.currency : detectDefaultCurrency(),
      dropped: inExp.length - expenses.length + (inRules.length - recurring.length)
    };
  }

  function applyState(clean) {
    State.expenses = clean.expenses;
    State.recurring = clean.recurring;
    State.dismissed = clean.dismissed;
    State.budget = clean.budget;
    State.currency = clean.currency;
    State.version = DATA_VERSION;
  }

  // Detección automática de moneda según configuración regional
  function detectDefaultCurrency() {
    const localeRegion = ((navigator.language || "").split("-")[1] || "").toUpperCase();
    const currencyMap = {
      AR: "ARS",
      MX: "MXN",
      CO: "COP",
      CL: "CLP",
      US: "USD",
      GB: "GBP",
      UY: "UYU",
      PE: "PEN",
      ES: "EUR"
    };
    return currencyMap[localeRegion] || "EUR";
  }

  // Generador de ID único local
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Relleno a dos dígitos
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  // "YYYY-MM" para una fecha
  function ymOf(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }

  // "YYYY-MM-DD" para hoy
  function today() {
    const d = new Date();
    return ymOf(d) + "-" + pad(d.getDate());
  }

  // Normalizar cadenas para búsqueda y comparaciones
  function normalizeText(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  // Desplazar mes por k unidades
  function shiftMonth(monthStr, k) {
    const [y, mo] = monthStr.split("-").map(Number);
    return ymOf(new Date(y, mo - 1 + k, 1));
  }

  // Sumar importes de una lista de transacciones
  function sumExpenses(expensesList) {
    return expensesList.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  }

  // Formatear importe con la divisa activa
  function formatCurrency(num, currencyCode) {
    try {
      return new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency: currencyCode || State.currency
      }).format(num);
    } catch (e) {
      return (Number(num) || 0).toFixed(2) + " " + (currencyCode || State.currency);
    }
  }

  // Estado reactivo inicial
  const State = {
    version: DATA_VERSION,
    expenses: [],
    budget: 0,
    currency: detectDefaultCurrency(),
    recurring: [],
    dismissed: []
  };

  let activeProfile = null;
  let cloudBaseline;
  let cloudDirty = false;
  let storageError = "";
  let storageBlocked = false;
  let savedSnapshot = "";
  let knownLocalRaw = null;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const stateSnapshot = () => JSON.stringify(State);
  const profileKey = (profile = activeProfile) => profile === null ? STORAGE_KEY : STORAGE_KEY + ":user:" + encodeURIComponent(profile);

  function getProfile() { return activeProfile; }
  function getCloudBaseline() { return cloudBaseline; }
  function isCloudDirty() { return activeProfile !== null && cloudDirty; }
  function getStorageStatus() { return { ok: !storageError, error: storageError }; }
  function emptyState() { return sanitizeState({ expenses: [], recurring: [], dismissed: [], budget: 0, currency: detectDefaultCurrency() }); }
  function failStorage(message) { storageError = message; return false; }
  function validateState(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.expenses)) throw new Error("Formato de datos inválido.");
    if (Number(raw.version) > DATA_VERSION) throw new Error("Los datos pertenecen a una versión más reciente.");
    const clean = sanitizeState(raw);
    if (clean.dropped > 0) throw new Error("Hay registros dañados. Descarga una copia antes de restaurar los datos.");
    return clean;
  }
  function sameSnapshot(first, second) {
    return JSON.stringify(validateState(first)) === JSON.stringify(validateState(second));
  }
  function envelope(state, revision, dirty) {
    return activeProfile === null ? state : {
      format: "spendly-profile-v1", owner: activeProfile, state,
      ...(revision !== undefined ? { cloudRevision: revision } : {}), dirty: !!dirty
    };
  }
  function writeLocal(state, revision, dirty, allowRecovery = false) {
    if (storageBlocked && !allowRecovery) return failStorage("El almacenamiento contiene datos dañados. El original se conserva; restaura una copia para continuar.");
    try {
      if (localStorage.getItem(profileKey()) !== knownLocalRaw) return failStorage("Los datos cambiaron en otra pestaña. Descarga una copia y vuelve a cargar esta cuenta antes de guardar.");
      const serialized = JSON.stringify(envelope(state, revision, dirty));
      localStorage.setItem(profileKey(), serialized);
      knownLocalRaw = serialized;
      if (allowRecovery) storageBlocked = false;
      storageError = "";
      return true;
    } catch (err) {
      return failStorage("No se pudo guardar en este dispositivo. Descarga un respaldo y revisa el espacio disponible.");
    }
  }

  /** Cambia al conjunto exacto de una cuenta. Nunca importa datos del invitado o de otra cuenta. */
  function switchProfile(uid) {
    if (uid !== null && (typeof uid !== "string" || !uid)) throw new Error("Identificador de cuenta inválido.");
    activeProfile = uid;
    knownLocalRaw = null;
    cloudBaseline = undefined;
    cloudDirty = false;
    storageError = "";
    storageBlocked = false;
    applyState(emptyState());
    let raw = null;
    let recoverySaved = false;
    try {
      raw = localStorage.getItem(profileKey());
      knownLocalRaw = raw;
      if (raw) {
        const parsed = JSON.parse(raw);
        const isEnvelope = uid !== null;
        if (isEnvelope && (parsed.format !== "spendly-profile-v1" || parsed.owner !== uid || !parsed.state)) throw new Error("El respaldo local no corresponde a esta cuenta.");
        const clean = validateState(isEnvelope ? parsed.state : parsed);
        if (isEnvelope) {
          if (Object.hasOwn(parsed, "cloudRevision") && parsed.cloudRevision !== null && typeof parsed.cloudRevision !== "string") throw new Error("Referencia de sincronización inválida.");
          cloudBaseline = parsed.cloudRevision;
          cloudDirty = parsed.dirty === true;
        }
        applyState(clean);
      }
      savedSnapshot = stateSnapshot();
      return { dropped: 0, error: "", recoverySaved: false };
    } catch (err) {
      storageBlocked = true;
      try { if (raw) { localStorage.setItem(profileKey() + "-corrupto", raw); recoverySaved = true; } } catch (copyError) { /* El original nunca se sobrescribe. */ }
      storageError = err.message || "No se pudieron cargar los datos locales.";
      savedSnapshot = stateSnapshot();
      return { dropped: 0, error: storageError, recoverySaved };
    }
  }

  function loadState() { return switchProfile(activeProfile); }

  function saveState(options = {}) {
    const shouldSync = options.sync !== false;
    const snapshot = clone(State);
    const dirty = cloudDirty || (activeProfile !== null && shouldSync && stateSnapshot() !== savedSnapshot);
    if (!writeLocal(snapshot, cloudBaseline, dirty)) return false;
    cloudDirty = dirty;
    savedSnapshot = stateSnapshot();
    const Cloud = window.Spendly && window.Spendly.Cloud;
    if (shouldSync && activeProfile !== null && cloudDirty && Cloud && cloudBaseline !== undefined) {
      Cloud.scheduleSave(activeProfile, snapshot, cloudBaseline);
    }
    return true;
  }

  /** Actualiza solo la referencia conocida; conserva todos los cambios locales pendientes. */
  function saveCloudBaseline(revision, expectedUid = activeProfile) {
    if (expectedUid !== activeProfile || activeProfile === null) return false;
    if (revision !== null && typeof revision !== "string") return failStorage("Referencia de nube inválida.");
    if (!writeLocal(clone(State), revision, cloudDirty)) return false;
    cloudBaseline = revision;
    savedSnapshot = stateSnapshot();
    return true;
  }

  function acceptCloudWrite(uid, revision, sentState, priorRevision) {
    if (uid !== activeProfile || cloudBaseline !== priorRevision) return false;
    const dirty = !sameSnapshot(State, sentState);
    if (!writeLocal(clone(State), revision, dirty)) return false;
    cloudBaseline = revision;
    cloudDirty = dirty;
    savedSnapshot = stateSnapshot();
    return true;
  }

  function replaceFromCloud(raw, revision, expectedUid = activeProfile) {
    if (expectedUid !== activeProfile || activeProfile === null) return false;
    try {
      const clean = raw === null ? emptyState() : validateState(raw);
      const next = { version: DATA_VERSION, expenses: clean.expenses, budget: clean.budget,
        currency: clean.currency, recurring: clean.recurring, dismissed: clean.dismissed };
      if (!writeLocal(next, revision, false)) return false;
      applyState(clean);
      cloudBaseline = revision;
      cloudDirty = false;
      savedSnapshot = stateSnapshot();
      return true;
    } catch (err) { return failStorage(err.message || "No se pudieron aplicar los datos de la nube."); }
  }

  /** Restauración explícita: el original solo se sustituye si nadie lo cambió desde su lectura. */
  function replaceLocalState(raw) {
    try {
      const clean = validateState(raw);
      const next = { version: DATA_VERSION, expenses: clean.expenses, budget: clean.budget,
        currency: clean.currency, recurring: clean.recurring, dismissed: clean.dismissed };
      const dirty = activeProfile !== null;
      if (!writeLocal(next, cloudBaseline, dirty, true)) return false;
      applyState(clean);
      cloudDirty = dirty;
      savedSnapshot = stateSnapshot();
      const Cloud = window.Spendly && window.Spendly.Cloud;
      if (dirty && Cloud && cloudBaseline !== undefined) Cloud.scheduleSave(activeProfile, next, cloudBaseline);
      return true;
    } catch (err) { return failStorage(err.message || "No se pudo restaurar el respaldo."); }
  }

  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

  function anchorDownload(filename, data, type) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return "downloaded";
  }

  /**
   * Entrega un archivo a la persona. En iPhone/iPad (sobre todo con la app instalada) los
   * enlaces de descarga no funcionan bien, así que se usa el menú Compartir ("Guardar en Archivos").
   * Devuelve una promesa con "shared", "downloaded" o "cancelled".
   */
  function downloadFile({ filename, data, type = "text/csv;charset=utf-8" }) {
    if (isIOS() && typeof File === "function" && navigator.canShare && navigator.share) {
      try {
        const file = new File([data], filename, { type: type.split(";")[0] });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: filename }).then(
            () => "shared",
            (err) => (err && err.name === "AbortError" ? "cancelled" : anchorDownload(filename, data, type))
          );
        }
      } catch (e) {
        /* si falla, se usa la descarga normal */
      }
    }
    return Promise.resolve(anchorDownload(filename, data, type));
  }

  // Exportar mes a CSV (con BOM para acentos en Excel)
  function exportMonthCsv(monthStr) {
    const escapeCsv = (str) => '"' + String(str).replace(/"/g, '""') + '"';
    const rows = State.expenses
      .filter((e) => e.date.startsWith(monthStr))
      .sort((a, b) => a.date.localeCompare(b.date));

    const header = "Fecha,Descripción,Categoría,Importe,Moneda";
    const body = rows.map((e) =>
      [e.date, escapeCsv(e.desc), escapeCsv(e.cat), Number(e.amount).toFixed(2), State.currency].join(",")
    );

    const csvContent = "\ufeff" + [header, ...body].join("\n");
    return downloadFile({
      filename: `gastos-${monthStr}.csv`,
      data: csvContent
    });
  }

  // Exportar evolución a CSV
  function exportEvolutionCsv(monthsList) {
    const calcCatTotal = (expenses, cat) =>
      expenses
        .filter((x) => x.cat === cat)
        .reduce((acc, curr) => acc + curr.amount, 0)
        .toFixed(2);

    const calcMonthTotal = (expenses) =>
      expenses.reduce((acc, curr) => acc + curr.amount, 0).toFixed(2);

    const header = ["Mes", "Total", ...CATS.map((c) => c[0])].join(",");
    const rows = monthsList.map((m) => {
      const monthExpenses = State.expenses.filter((x) => x.date.startsWith(m));
      return [
        m,
        calcMonthTotal(monthExpenses),
        ...CATS.map(([catName]) => calcCatTotal(monthExpenses, catName))
      ].join(",");
    });

    const csvContent = "\ufeff" + [header, ...rows].join("\n");
    return downloadFile({
      filename: `evolucion-${monthsList[0]}_${monthsList[monthsList.length - 1]}.csv`,
      data: csvContent
    });
  }

  // Exportar respaldo JSON
  function exportBackup() {
    const filename = `spendly-respaldo-${today()}.json`;
    return downloadFile({
      filename,
      data: JSON.stringify(State, null, 2),
      type: "application/json"
    });
  }

  // Exponer API en namespace global Spendly
  window.Spendly = window.Spendly || {};
  window.Spendly.CATS = CATS;
  window.Spendly.COL = COL;
  window.Spendly.CAT_ICONS = CAT_ICONS;
  window.Spendly.State = State;
  window.Spendly.uid = uid;
  window.Spendly.pad = pad;
  window.Spendly.ymOf = ymOf;
  window.Spendly.today = today;
  window.Spendly.normalizeText = normalizeText;
  window.Spendly.shiftMonth = shiftMonth;
  window.Spendly.sumExpenses = sumExpenses;
  window.Spendly.formatCurrency = formatCurrency;
  window.Spendly.loadState = loadState;
  window.Spendly.saveState = saveState;
  window.Spendly.downloadFile = downloadFile;
  window.Spendly.exportMonthCsv = exportMonthCsv;
  window.Spendly.exportEvolutionCsv = exportEvolutionCsv;
  window.Spendly.exportBackup = exportBackup;
  window.Spendly.detectDefaultCurrency = detectDefaultCurrency;
  window.Spendly.LOCALE = LOCALE;
  window.Spendly.parseAmount = parseAmount;
  window.Spendly.sanitizeState = sanitizeState;
  window.Spendly.applyState = applyState;
  window.Spendly.isValidDate = isValidDate;
  window.Spendly.switchProfile = switchProfile;
  window.Spendly.getProfile = getProfile;
  window.Spendly.getCloudBaseline = getCloudBaseline;
  window.Spendly.isCloudDirty = isCloudDirty;
  window.Spendly.saveCloudBaseline = saveCloudBaseline;
  window.Spendly.setCloudBaseline = saveCloudBaseline;
  window.Spendly.acceptCloudWrite = acceptCloudWrite;
  window.Spendly.replaceFromCloud = replaceFromCloud;
  window.Spendly.getStorageStatus = getStorageStatus;
  window.Spendly.replaceLocalState = replaceLocalState;
  window.Spendly.sameSnapshot = sameSnapshot;
})(window);
