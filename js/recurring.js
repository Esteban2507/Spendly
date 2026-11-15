/**
 * ============================================================================
 * Spendly - Motor de Gastos Recurrentes
 * Detección inteligente de patrones y generación automática mensual
 * ============================================================================
 */

(function (window) {
  "use strict";

  const {
    State,
    uid,
    pad,
    ymOf,
    today,
    shiftMonth,
    normalizeText
  } = window.Spendly;

  /**
   * Genera los gastos pendientes correspondientes a las reglas recurrentes activas.
   * Se ejecuta al iniciar la aplicación o al crear una nueva regla.
   * @returns {{changed: boolean, added: number}} changed: hay que guardar; added: gastos nuevos creados.
   */
  function applyRecurring() {
    const currentMonth = ymOf(new Date());
    const currentDate = today();
    let hasChanged = false;
    let added = 0;

    State.recurring.forEach((rule) => {
      rule.done = rule.done || [];

      for (let m = rule.from; m <= currentMonth; m = shiftMonth(m, 1)) {
        if (rule.done.includes(m)) continue;

        const [y, mo] = m.split("-").map(Number);
        // Calcula el último día válido del mes por si rule.day es 31 y febrero tiene 28/29
        const maxDaysInMonth = new Date(y, mo, 0).getDate();
        const validDay = Math.min(rule.day, maxDaysInMonth);
        const expenseDate = `${m}-${pad(validDay)}`;

        // No generar gastos futuros para días posteriores a hoy en el mes en curso
        if (expenseDate > currentDate) continue;

        rule.done.push(m);
        hasChanged = true;

        // Evita duplicar si ya existe un gasto idéntico creado manualmente
        const alreadyExists = State.expenses.some(
          (e) => e.date.startsWith(m) && normalizeText(e.desc) === normalizeText(rule.desc)
        );

        if (!alreadyExists) {
          State.expenses.push({
            id: uid(),
            desc: rule.desc,
            amount: Number(rule.amount),
            cat: rule.cat,
            date: expenseDate,
            rid: rule.id
          });
          added++;
        }
      }
    });

    return { changed: hasChanged, added };
  }

  /**
   * Analiza el historial de transacciones para detectar suscripciones o cargos fijos:
   * Requisitos:
   * - 1 cargo por mes durante mínimo 3 meses.
   * - Importe consistente (variación máxima de ±15% respecto a la mediana).
   * - Día del mes similar (diferencia máxima de 7 días entre cargos).
   * - Activo recientemente (al menos un cargo en los últimos 2 meses).
   * @returns {Array} Lista de sugerencias de gastos recurrentes.
   */
  function detectRecurring() {
    const existingRules = new Set(State.recurring.map((r) => normalizeText(r.desc)));
    const dismissedRules = new Set(State.dismissed);
    const groups = {};

    // Agrupar gastos por descripción normalizada
    State.expenses.forEach((expense) => {
      const key = normalizeText(expense.desc);
      if (key && !existingRules.has(key) && !dismissedRules.has(key)) {
        if (!groups[key]) groups[key] = [];
        groups[key].push(expense);
      }
    });

    const recentLimit = shiftMonth(ymOf(new Date()), -2);
    const suggestions = [];

    for (const key in groups) {
      const items = groups[key];
      const months = items.map((e) => e.date.slice(0, 7));
      const uniqueMonths = new Set(months);

      // Debe aparecer exactamente una vez al mes durante al menos 3 meses
      if (uniqueMonths.size < 3 || uniqueMonths.size !== items.length) continue;

      // Debe tener actividad reciente (últimos 2 meses)
      const latestMonth = months.reduce((max, curr) => (curr > max ? curr : max));
      if (latestMonth < recentLimit) continue;

      // Cálculo de la mediana de importes y verificación de dispersión (±15%)
      const amounts = items.map((e) => Number(e.amount)).sort((a, b) => a - b);
      const medianAmount = amounts[Math.floor(amounts.length / 2)];
      const hasLargeVariance = amounts.some(
        (val) => Math.abs(val - medianAmount) > medianAmount * 0.15
      );
      if (hasLargeVariance) continue;

      // Verificación de proximidad de días del mes (±7 días)
      const days = items.map((e) => Number(e.date.slice(8)));
      const maxDay = Math.max(...days);
      const minDay = Math.min(...days);
      if (maxDay - minDay > 7) continue;

      // Tomar los datos más recientes para la sugerencia
      const lastExpense = items.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
      const avgDay = Math.round(days.reduce((acc, curr) => acc + curr, 0) / days.length);

      suggestions.push({
        key,
        desc: lastExpense.desc,
        amount: medianAmount,
        cat: lastExpense.cat,
        day: avgDay,
        months: uniqueMonths.size
      });
    }

    return suggestions;
  }

  // Exponer API del módulo
  window.Spendly = window.Spendly || {};
  window.Spendly.Recurring = {
    apply: applyRecurring,
    detect: detectRecurring
  };
})(window);
