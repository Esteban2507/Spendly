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
  const DATA_VERSION = 3;
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
  const MONTH_RE = /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/;

  function isValidDate(str) {
    if (typeof str !== "string" || !DATE_RE.test(str)) return false;
    const [y, m, d] = str.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  // Las reparaciones deben producir la misma identidad al cargar un respaldo en dos pestañas.
  function legacyId(kind, value, index, usedIds) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    const base = "legacy-" + kind + "-" + hash.toString(36) + "-" + index;
    let id = base;
    let suffix = 0;
    while (usedIds.has(id)) id = base + "-" + (++suffix);
    return id;
  }

  function sanitizeExpense(e, usedIds, index) {
    if (!e || typeof e !== "object" || !isValidDate(e.date)) return null;
    const amount = numericValue(e.amount);
    if (!Number.isFinite(amount) || amount < 0.005 || amount > Number.MAX_SAFE_INTEGER / 100) return null;
    let id = typeof e.id === "string" && e.id ? e.id : "";
    if (!id || usedIds.has(id)) id = legacyId("expense", e, index, usedIds);
    usedIds.add(id);
    const clean = {
      id,
      desc: String(e.desc == null ? "" : e.desc).trim().slice(0, 80) || "Sin descripción",
      amount: roundMoney(amount),
      cat: Object.hasOwn(COL, e.cat) ? e.cat : "Otros",
      date: e.date
    };
    if (e.rid) clean.rid = String(e.rid);
    if (typeof e.sourceHash === "string") clean.sourceHash = e.sourceHash.slice(0, 128);
    if (typeof e.receiptFingerprint === "string") clean.receiptFingerprint = e.receiptFingerprint.slice(0, 256);
    return clean;
  }

  function sanitizeRule(r, usedIds, index) {
    if (!r || typeof r !== "object" || typeof r.desc !== "string" || !r.desc.trim()) return null;
    const amount = numericValue(r.amount);
    const day = Math.round(Number(r.day));
    if (!Number.isFinite(amount) || amount < 0.005 || amount > Number.MAX_SAFE_INTEGER / 100 || !(day >= 1 && day <= 31)) return null;
    if (typeof r.from !== "string" || !MONTH_RE.test(r.from)) return null;
    let id = typeof r.id === "string" && r.id ? r.id : "";
    if (!id || usedIds.has(id)) id = legacyId("rule", r, index, usedIds);
    usedIds.add(id);
    return {
      id,
      desc: r.desc.trim().slice(0, 80),
      amount: roundMoney(amount),
      cat: Object.hasOwn(COL, r.cat) ? r.cat : "Otros",
      day,
      from: r.from,
      done: Array.isArray(r.done) ? [...new Set(r.done.filter((m) => typeof m === "string" && MONTH_RE.test(m)))] : []
    };
  }

  function numericValue(value) {
    return typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
  }

  function roundMoney(value) {
    const [mantissa, exponent = "0"] = String(value).split("e");
    return Math.round(Number(mantissa + "e" + (Number(exponent) + 2))) / 100;
  }

  function cleanMoney(value) {
    const n = numericValue(value);
    return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER / 100 ? roundMoney(n) : 0;
  }

  function cleanBudget(value) {
    const categories = {};
    const source = value && typeof value === "object" ? value : {};
    CATS.forEach(([cat]) => {
      if (source.categories && Object.hasOwn(source.categories, cat)) categories[cat] = cleanMoney(source.categories[cat]);
    });
    return { total: cleanMoney(source.total), categories };
  }

  /** Conserva respaldos anteriores y migra el presupuesto global sin cambiar su historial. */
  function sanitizeState(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    if (Number(src.version) > DATA_VERSION) throw new Error("El respaldo pertenece a una versión más reciente de Spendly.");
    const expIds = new Set();
    const ruleIds = new Set();
    const inExp = Array.isArray(src.expenses) ? src.expenses : [];
    const inRules = Array.isArray(src.recurring) ? src.recurring : [];
    const expenses = inExp.map((e, i) => sanitizeExpense(e, expIds, i)).filter(Boolean);
    const recurring = inRules.map((r, i) => sanitizeRule(r, ruleIds, i)).filter(Boolean);
    const budget = cleanMoney(src.budget);
    const budgets = {};
    if (src.budgets && typeof src.budgets === "object" && !Array.isArray(src.budgets)) {
      Object.entries(src.budgets).forEach(([month, value]) => { if (MONTH_RE.test(month)) budgets[month] = cleanBudget(value); });
    } else if (budget > 0) {
      new Set([ymOf(new Date()), ...expenses.map((e) => e.date.slice(0, 7))]).forEach((month) => {
        budgets[month] = { total: budget, categories: {} };
      });
    }
    return {
      version: DATA_VERSION,
      ...(typeof src.generation === "string" ? { generation: src.generation } : {}),
      expenses,
      recurring,
      dismissed: Array.isArray(src.dismissed) ? [...new Set(src.dismissed.filter((k) => typeof k === "string"))] : [],
      budget,
      budgets,
      currency: CURRENCIES.includes(src.currency) ? src.currency : detectDefaultCurrency(),
      dropped: inExp.length - expenses.length + (inRules.length - recurring.length)
    };
  }

  function applyState(clean) {
    State.expenses = clean.expenses;
    State.recurring = clean.recurring;
    State.dismissed = clean.dismissed;
    State.budget = cleanMoney(clean.budget);
    State.budgets = clean.budgets || {};
    State.currency = clean.currency;
    State.version = DATA_VERSION;
    if (typeof clean.generation === "string") State.generation = clean.generation; else delete State.generation;
  }

  function getBudget(month) {
    return MONTH_RE.test(month) && Object.hasOwn(State.budgets, month)
      ? cleanBudget(State.budgets[month]) : { total: 0, categories: {} };
  }

  function setBudget(month, total, categories) {
    if (!MONTH_RE.test(month)) throw new Error("Mes de presupuesto inválido");
    State.budgets[month] = cleanBudget({ total, categories });
  }

  function hasFinancialData(value = State) {
    return value.expenses.length > 0 || value.recurring.length > 0 ||
      Object.values(value.budgets).some((b) => b.total > 0 || Object.values(b.categories || {}).some((v) => v > 0));
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
    budgets: {},
    currency: detectDefaultCurrency(),
    recurring: [],
    dismissed: []
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let baseline = clone(State);
  let baselineRaw = null;
  let storageBlocked = false;
  let storageStatus = { ok: true, error: "", code: "" };

  function getStorageStatus() { return { ...storageStatus }; }
  function failStorage(code, error) {
    storageStatus = { ok: false, code, error };
    return false;
  }
  function snapshot() { return clone(State); }
  function readStored(raw) {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || !Array.isArray(value.expenses)) throw new Error("Formato local inválido");
    if (Number(value.version) > DATA_VERSION) throw new Error("Este respaldo pertenece a una versión más reciente de Spendly");
    return value;
  }

  function loadState() {
    let raw = null;
    let recoverySaved = false;
    let dropped = 0;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) applyState(sanitizeState({ expenses: [] }));
      if (raw) {
        const clean = sanitizeState(readStored(raw));
        dropped = clean.dropped;
        applyState(clean);
        if (dropped > 0) {
          try { localStorage.setItem(STORAGE_KEY + "-previo", raw); recoverySaved = true; } catch (err) { /* No sobrescribir el original. */ }
          storageBlocked = true;
          failStorage("damaged", "Se detectaron datos dañados. Descarga un respaldo de los datos recuperados antes de restaurarlo.");
        }
      }
      baselineRaw = raw;
      baseline = snapshot();
      if (!storageBlocked) storageStatus = { ok: true, error: "", code: "" };
    } catch (err) {
      storageBlocked = true;
      try { if (raw) { localStorage.setItem(STORAGE_KEY + "-corrupto", raw); recoverySaved = true; } } catch (backupError) { /* Se preserva la clave original. */ }
      baselineRaw = raw;
      failStorage("load", "No se pudieron cargar tus datos. El original se conserva; restaura una copia de seguridad para continuar.");
    }
    return { dropped, error: storageStatus.ok ? "" : storageStatus.error, recoverySaved };
  }

  function mergeValue(base, local, remote, path) {
    if (equal(local, base)) return remote;
    if (equal(remote, base) || equal(local, remote)) return local;
    if (Array.isArray(local) && Array.isArray(remote)) {
      if (path === "dismissed") return [...new Set([...remote, ...local])];
      if (path === "expenses" || path === "recurring") {
        const oldMap = new Map((base || []).map((v) => [v.id, v]));
        const localMap = new Map(local.map((v) => [v.id, v]));
        const remoteMap = new Map(remote.map((v) => [v.id, v]));
        const result = [];
        for (const id of new Set([...remoteMap.keys(), ...localMap.keys(), ...oldMap.keys()])) {
          const item = mergeValue(oldMap.get(id), localMap.get(id), remoteMap.get(id), path + "." + id);
          if (item !== undefined) result.push(item);
        }
        if (path === "expenses") {
          const automatic = new Map();
          return result.filter((e) => {
            if (!e.rid) return true;
            const key = e.rid + "|" + e.date.slice(0, 7);
            const previous = automatic.get(key);
            if (!previous) { automatic.set(key, e); return true; }
            if (!equal({ ...previous, id: "" }, { ...e, id: "" })) throw new Error("Conflicto en gasto recurrente");
            return false;
          });
        }
        return result;
      }
    }
    // Los campos de un mismo movimiento/regla se revisan juntos: editar contra borrar es conflicto.
    if (path.startsWith("expenses.") || path.startsWith("recurring.")) throw new Error("Conflicto en registro");
    if (local && remote && typeof local === "object" && typeof remote === "object" && !Array.isArray(local) && !Array.isArray(remote)) {
      const result = {};
      for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)])) {
        const value = mergeValue(base && base[key], local[key], remote[key], path ? path + "." + key : key);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    throw new Error("Conflicto entre pestañas");
  }

  function saveState() {
    if (storageBlocked) return failStorage("recovery", "Hay un problema al cargar tus datos. Restaura una copia antes de guardar nuevos cambios.");
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      let next = snapshot();
      if (next.currency !== baseline.currency && hasFinancialData(baseline)) {
        return failStorage("currency", "La moneda se fija al registrar datos. Restaura un respaldo para cambiar de conjunto de datos.");
      }
      if (raw !== baselineRaw) {
        const remote = raw ? sanitizeState(readStored(raw)) : sanitizeState({ expenses: [] });
        if (remote.dropped > 0) return failStorage("conflict", "Otra pestaña guardó datos dañados. Descarga un respaldo y recarga antes de continuar.");
        delete remote.dropped;
        if (next.currency !== remote.currency && (hasFinancialData(next) || hasFinancialData(remote))) {
          return failStorage("conflict", "La moneda cambió en otra pestaña. Recarga antes de registrar importes.");
        }
        if (raw && readStored(raw).generation !== (baseline.generation || undefined)) {
          return failStorage("conflict", "Otra pestaña restauró un respaldo. Recarga para trabajar con los datos actuales.");
        }
        next = mergeValue(baseline, next, remote, "");
      }
      next.version = DATA_VERSION;
      const serialized = JSON.stringify(next);
      localStorage.setItem(STORAGE_KEY, serialized);
      applyState(next);
      if (next.generation) State.generation = next.generation; else delete State.generation;
      baseline = snapshot();
      baselineRaw = serialized;
      storageStatus = { ok: true, error: "", code: "" };
      return true;
    } catch (err) {
      const conflict = /Conflicto/.test(err.message || "");
      return failStorage(conflict ? "conflict" : "write", conflict
        ? "Otra pestaña modificó el mismo dato. Tus cambios no se guardaron; descarga un respaldo y recarga para resolverlo."
        : "No se pudo guardar en este dispositivo. Revisa el espacio disponible o descarga un respaldo.");
    }
  }

  function persistChange(mutator) {
    const previous = snapshot();
    try {
      const result = mutator();
      if (result === false) storageStatus = { ok: true, error: "", code: "cancelled" };
      else if (saveState()) return true;
    } catch (err) {
      failStorage("validation", err.message || "No se pudo aplicar el cambio.");
    }
    applyState(previous);
    if (previous.generation) State.generation = previous.generation; else delete State.generation;
    return false;
  }

  function replaceState(clean) {
    const previous = snapshot();
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      if (currentRaw !== baselineRaw) return failStorage("conflict", "Los datos cambiaron en otra pestaña. Recarga antes de restaurar el respaldo.");
      const next = sanitizeState(clean);
      delete next.dropped;
      next.generation = uid();
      const serialized = JSON.stringify(next);
      localStorage.setItem(STORAGE_KEY, serialized);
      applyState(next);
      State.generation = next.generation;
      baseline = snapshot();
      baselineRaw = serialized;
      storageBlocked = false;
      storageStatus = { ok: true, error: "", code: "" };
      return true;
    } catch (err) {
      applyState(previous);
      if (previous.generation) State.generation = previous.generation; else delete State.generation;
      return failStorage("write", "No se pudo guardar el respaldo restaurado. Tus datos anteriores se conservan.");
    }
  }

  function syncState() {
    try {
      if (localStorage.getItem(STORAGE_KEY) === baselineRaw) return { changed: false, conflict: false, error: "" };
      if (!equal(snapshot(), baseline)) return { changed: false, conflict: true, error: "Hay cambios pendientes en esta pestaña." };
      storageBlocked = false;
      const info = loadState();
      return { changed: !info.error, conflict: false, error: info.error };
    } catch (err) {
      failStorage("read", "No se pudieron sincronizar los datos de este dispositivo.");
      return { changed: false, conflict: false, error: storageStatus.error };
    }
  }

  /**
   * Web Locks serializa la lectura, fusión y escritura entre pestañas del mismo origen.
   * La alternativa sin Web Locks conserva la detección de conflictos, pero localStorage
   * no puede garantizar atomicidad ante escrituras exactamente simultáneas en procesos distintos.
   * El callback debe ser síncrono: toda mutación ocurre dentro del bloqueo.
   */
  async function withStorageLock(operation) {
    if (navigator.locks && typeof navigator.locks.request === "function") {
      try {
        return await navigator.locks.request("spendly-state-write", operation);
      } catch (err) {
        return failStorage("lock", "No se pudo obtener acceso al guardado. Inténtalo de nuevo o descarga un respaldo.");
      }
    }
    return operation();
  }

  function persistChangeAsync(mutator, options = {}) {
    return withStorageLock(() => {
      // Para altas de comprobantes, comprobar duplicados sobre el estado más reciente.
      // Las ediciones conservan por defecto la base original para detectar conflictos.
      if (options.refresh) {
        const result = syncState();
        if (result.error || result.conflict) return failStorage("conflict", result.error || "Hay cambios pendientes en otra pestaña.");
      }
      return persistChange(mutator);
    });
  }

  function replaceStateAsync(clean) {
    return withStorageLock(() => replaceState(clean));
  }

  function syncStateAsync() {
    return withStorageLock(syncState);
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
    const escapeCsv = (str) => {
      let value = String(str);
      if (/^[\s]*[=+@\-]/.test(value) || /^[\t\r\n]/.test(value)) value = "'" + value;
      return '"' + value.replace(/"/g, '""') + '"';
    };
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
  window.Spendly.getBudget = getBudget;
  window.Spendly.setBudget = setBudget;
  window.Spendly.hasFinancialData = hasFinancialData;
  window.Spendly.persistChange = persistChange;
  window.Spendly.persistChangeAsync = persistChangeAsync;
  window.Spendly.replaceState = replaceState;
  window.Spendly.replaceStateAsync = replaceStateAsync;
  window.Spendly.syncState = syncState;
  window.Spendly.syncStateAsync = syncStateAsync;
  window.Spendly.getStorageStatus = getStorageStatus;
  window.Spendly.STORAGE_KEY = STORAGE_KEY;
  window.Spendly.roundMoney = roundMoney;
})(window);

