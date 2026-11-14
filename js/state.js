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
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: currencyCode || State.currency
      }).format(num);
    } catch (e) {
      return (Number(num) || 0).toFixed(2) + " " + (currencyCode || State.currency);
    }
  }

  // Estado reactivo inicial
  const State = {
    expenses: [],
    budget: 0,
    currency: detectDefaultCurrency(),
    recurring: [],
    dismissed: []
  };

  // Carga de estado desde localStorage
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          Object.assign(State, parsed);
          if (!Array.isArray(State.expenses)) State.expenses = [];
          if (!Array.isArray(State.recurring)) State.recurring = [];
          if (!Array.isArray(State.dismissed)) State.dismissed = [];
        }
      }
    } catch (err) {
      console.warn("No se pudo cargar el estado local:", err);
    }
  }

  // Guardar estado en localStorage
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(State));
      return true;
    } catch (err) {
      console.error("Error al guardar en localStorage:", err);
      return false;
    }
  }

  // Descargador de archivos
  function downloadFile({ filename, data, type = "text/csv;charset=utf-8" }) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return Promise.resolve();
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
})(window);
