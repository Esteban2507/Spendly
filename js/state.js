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

  /**
   * Convierte lo que escribe la persona en un número, entendiendo ambos estilos:
   * "1.234,50", "1,234.50", "24,5", "24.50", "$ 1.234".
   * Regla: el ÚLTIMO separador es el decimal, salvo que haya varios iguales o que
   * queden exactamente 3 dígitos detrás ("1.234" = 1234, "0.500" = 0,5).
   * Devuelve NaN si no hay número.
   */
  function parseAmount(raw) {
    let s = String(raw == null ? "" : raw).replace(/[^\d.,]/g, "");
    if (!/\d/.test(s)) return NaN;
    const count = (ch) => s.split(ch).length - 1;
    const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    if (lastSep >= 0) {
      const sep = s[lastSep];
      const other = sep === "," ? "." : ",";
      const intPart = s.slice(0, lastSep).replace(/[.,]/g, "");
      const digitsAfter = s.length - lastSep - 1;
      const isThousands =
        count(sep) > 1 ||
        (digitsAfter === 3 && !s.includes(other) && intPart !== "" && intPart !== "0");
      s = isThousands ? s.replace(/[.,]/g, "") : (intPart || "0") + "." + s.slice(lastSep + 1);
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
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
      cat: COL[e.cat] ? e.cat : "Otros",
      date: e.date
    };
    if (e.rid) clean.rid = String(e.rid);
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
      cat: COL[r.cat] ? r.cat : "Otros",
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

  // Carga de estado desde localStorage (limpiando registros dañados). Devuelve { dropped }.
  function loadState() {
    let dropped = 0;
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const clean = sanitizeState(JSON.parse(raw));
        dropped = clean.dropped;
        applyState(clean);
        if (dropped > 0) {
          // Se conserva una copia de lo que había antes de limpiar, por si hiciera falta recuperarlo
          try { localStorage.setItem(STORAGE_KEY + "-previo", raw); } catch (e) {}
          saveState();
        }
      }
    } catch (err) {
      console.warn("No se pudo cargar el estado local:", err);
      // JSON ilegible: se guarda tal cual para no perderlo al sobrescribir
      try { if (raw) localStorage.setItem(STORAGE_KEY + "-corrupto", raw); } catch (e) {}
    }
    return { dropped };
  }

  // Guardar estado en localStorage y, si hay sesión, también en la nube
  function saveState() {
    // 1. Guardar siempre en localStorage (funciona sin cuenta)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(State));
    } catch (err) {
      console.error("Error al guardar en localStorage:", err);
    }

    // 2. Si el usuario está autenticado, programar guardado en Firestore (con debounce)
    const Auth  = window.Spendly && window.Spendly.Auth;
    const Cloud = window.Spendly && window.Spendly.Cloud;
    if (Auth && Cloud) {
      const user = Auth.currentUser();
      if (user) {
        Cloud.scheduleSave(user.uid, State);
      }
    }

    return true;
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
})(window);
