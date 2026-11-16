/** Calculations shared by the summary and charts. Reads state without changing it. */
(function (window) {
  "use strict";

  const api = window.Spendly;
  const { State, today, shiftMonth } = api;
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const amountOf = (expense) => Number.isFinite(Number(expense.amount)) ? Number(expense.amount) : 0;

  function daysInMonth(month) {
    const [year, number] = month.split("-").map(Number);
    return new Date(year, number, 0).getDate();
  }

  /** One pass over transactions, including months with no category assumptions. */
  function aggregateByMonth(expenses) {
    const result = new Map();
    expenses.forEach((expense) => {
      if (!expense || typeof expense.date !== "string") return;
      const month = expense.date.slice(0, 7);
      if (!MONTH_RE.test(month)) return;
      if (!result.has(month)) result.set(month, { total: 0, byCategory: Object.create(null) });
      const item = result.get(month);
      const amount = amountOf(expense);
      item.total = round(item.total + amount);
      item.byCategory[expense.cat] = round((item.byCategory[expense.cat] || 0) + amount);
    });
    return result;
  }

  /**
   * total includes future-dated entries already registered in this month.
   * Comparisons and the current-month projection use entries through nowDate only.
   * Pending rules are reserved once when calculating the daily available amount.
   * A missing budget or closed month has no daily available amount (null).
   */
  function summarize(month, nowDate = today()) {
    if (!MONTH_RE.test(month) || !api.isValidDate(nowDate)) throw new Error("Fecha de resumen inválida");
    const currentMonth = nowDate.slice(0, 7);
    const currentDay = Number(nowDate.slice(8));
    const previousMonth = shiftMonth(month, -1);
    const isCurrent = month === currentMonth;
    const isPast = month < currentMonth;
    const isFuture = month > currentMonth;
    const monthDays = daysInMonth(month);
    const previousCutoff = Math.min(currentDay, daysInMonth(previousMonth));
    const expenses = [];
    const byCategory = Object.create(null);
    let total = 0;
    let comparableTotal = 0;
    let previousTotal = 0;
    let previousComparableTotal = 0;
    State.expenses.forEach((expense) => {
      const expenseMonth = expense.date.slice(0, 7);
      const amount = amountOf(expense);
      if (expenseMonth === month) {
        expenses.push(expense);
        total += amount;
        byCategory[expense.cat] = (byCategory[expense.cat] || 0) + amount;
        if (!isCurrent || expense.date <= nowDate) comparableTotal += amount;
      }
      if (expenseMonth === previousMonth) {
        previousTotal += amount;
        if (!isCurrent || Number(expense.date.slice(8)) <= previousCutoff) previousComparableTotal += amount;
      }
    });
    total = round(total);
    comparableTotal = round(comparableTotal);
    previousTotal = round(previousTotal);
    previousComparableTotal = round(previousComparableTotal);
    Object.keys(byCategory).forEach((category) => { byCategory[category] = round(byCategory[category]); });
    const comparisonPercent = !isFuture && previousComparableTotal > 0
      ? Math.round(((comparableTotal - previousComparableTotal) / previousComparableTotal) * 100)
      : null;
    const comparisonLabel = isFuture
      ? "Mes futuro: comparación no disponible"
      : isCurrent
        ? `Hasta el día ${currentDay} vs. día ${previousCutoff} del mes anterior`
        : "Mes completo vs. mes anterior completo";
    const daysElapsed = isCurrent ? currentDay : isPast ? monthDays : 0;
    const dailyAverage = daysElapsed ? round(comparableTotal / daysElapsed) : null;
    const projectedTotal = isFuture ? null : isCurrent ? round(comparableTotal / currentDay * monthDays) : total;
    const projectionLabel = isCurrent
      ? "Estimación según el gasto diario registrado hasta hoy"
      : isPast ? "Gasto registrado al cierre del mes" : "Disponible cuando comience el mes";
    const budget = api.getBudget(month);
    const pending = api.Recurring.getPending(month, nowDate);
    const pendingTotal = round(pending.reduce((sum, item) => sum + amountOf(item), 0));
    const daysRemaining = isPast ? 0 : isCurrent ? monthDays - currentDay + 1 : monthDays;
    const availablePerDay = budget.total > 0 && daysRemaining > 0
      ? round((budget.total - total - pendingTotal) / daysRemaining)
      : null;
    return {
      expenses, total, byCategory, comparableTotal, previousTotal, previousComparableTotal,
      comparisonPercent, comparisonLabel, dailyAverage, projectedTotal, projectionLabel,
      pending, pendingTotal, daysRemaining, availablePerDay, budget
    };
  }

  api.Metrics = { summarize, aggregateByMonth, daysInMonth };
})(window);
