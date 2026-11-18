/** Spendly - detección y registro de cargos mensuales, con identidad por regla. */
(function (window) {
  "use strict";

  const { State, pad, ymOf, today, shiftMonth, normalizeText } = window.Spendly;
  const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const MANUAL_DAY_TOLERANCE = 3;

  function validMonth(month) {
    return typeof month === "string" && MONTH_RE.test(month) && Number(month.slice(0, 4)) >= 100;
  }

  function validRule(rule) {
    return rule && typeof rule.id === "string" && rule.id.length > 0 &&
      typeof rule.desc === "string" && normalizeText(rule.desc) &&
      Number.isFinite(Number(rule.amount)) && Number(rule.amount) > 0 &&
      Number.isInteger(Number(rule.day)) && Number(rule.day) >= 1 && Number(rule.day) <= 31 &&
      validMonth(rule.from);
  }

  function dateFor(rule, month) {
    const [year, number] = month.split("-").map(Number);
    const lastDay = new Date(year, number, 0).getDate();
    return `${month}-${pad(Math.min(Number(rule.day), lastDay))}`;
  }

  function validExpense(expense) {
    if (!expense || typeof expense.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expense.date)) return false;
    const [year, month, day] = expense.date.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day &&
      Number.isFinite(Number(expense.amount)) && Number(expense.amount) > 0;
  }

  // A manually entered item only matches when its meaning, value and date agree.
  // Already linked expenses belong exclusively to their original rule.
  function expenseIndex() {
    const months = new Map();
    State.expenses.forEach((expense) => {
      if (!expense || typeof expense.date !== "string") return;
      const month = expense.date.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(expense);
    });
    return months;
  }

  function matchingExpenses(rule, month, date, index) {
    const expenses = index.get(month) || [];
    const linked = expenses.filter((expense) => expense.rid === rule.id);
    if (linked.length) return { linked, manual: [] };
    const day = Number(date.slice(8));
    const manual = expenses.filter((expense) =>
      !expense.rid && validExpense(expense) && expense.date.slice(0, 7) === month &&
      normalizeText(expense.desc) === normalizeText(rule.desc) && expense.cat === rule.cat &&
      Math.abs(Math.round(Number(expense.amount) * 100) - Math.round(Number(rule.amount) * 100)) <= 1 &&
      Math.abs(Number(expense.date.slice(8)) - day) <= MANUAL_DAY_TOLERANCE
    );
    return { linked, manual };
  }

  /** Applies charges due today or earlier. Future months are never generated. */
  function applyRecurring() {
    const currentDate = today();
    const currentMonth = currentDate.slice(0, 7);
    let changed = false;
    let added = 0;
    const ambiguous = [];
    const index = expenseIndex();

    State.recurring.forEach((rule) => {
      if (!validRule(rule) || rule.from > currentMonth) return;
      const done = new Set(Array.isArray(rule.done) ? rule.done.filter(validMonth) : []);
      let ruleChanged = false;

      for (let month = rule.from; month <= currentMonth; month = shiftMonth(month, 1)) {
        if (done.has(month)) continue;
        const date = dateFor(rule, month);
        if (date > currentDate) continue;
        const matches = matchingExpenses(rule, month, date, index);

        if (!matches.linked.length && matches.manual.length > 1) {
          // Preserve the ambiguity for review instead of inventing another payment.
          ambiguous.push({ rid: rule.id, month, candidates: matches.manual.length });
          continue;
        }

        if (!matches.linked.length && matches.manual.length === 1) {
          matches.manual[0].rid = rule.id;
        } else if (!matches.linked.length) {
          const expense = {
            // Both tabs generate the same identity for the same scheduled charge.
            id: `recurring:${encodeURIComponent(rule.id)}:${month}`,
            desc: rule.desc,
            amount: Math.round(Number(rule.amount) * 100) / 100,
            cat: rule.cat,
            date,
            rid: rule.id
          };
          State.expenses.push(expense);
          if (!index.has(month)) index.set(month, []);
          index.get(month).push(expense);
          added++;
        }
        done.add(month);
        ruleChanged = true;
      }
      if (ruleChanged) {
        rule.done = Array.from(done).sort();
        changed = true;
      }
    });

    return { changed, added, ambiguous };
  }

  /** Unrecorded charges for a selected month, including upcoming and overdue items. */
  function getPending(month) {
    if (!validMonth(month)) return [];
    const pending = [];
    const index = expenseIndex();
    State.recurring.forEach((rule) => {
      if (!validRule(rule) || month < rule.from || (Array.isArray(rule.done) && rule.done.includes(month))) return;
      const date = dateFor(rule, month);
      const matches = matchingExpenses(rule, month, date, index);
      if (matches.linked.length || matches.manual.length === 1) return;
      const item = { rid: rule.id, desc: rule.desc, amount: Math.round(Number(rule.amount) * 100) / 100, cat: rule.cat, date };
      if (matches.manual.length > 1) item.ambiguous = true;
      pending.push(item);
    });
    return pending.sort((a, b) => a.date.localeCompare(b.date) || a.desc.localeCompare(b.desc));
  }

  /** Suggests one recent charge per month for at least three consecutive months. */
  function detectRecurring() {
    const existing = new Set(State.recurring.map((rule) => normalizeText(rule.desc)));
    const dismissed = new Set(State.dismissed);
    const groups = new Map();
    const currentDate = today();
    const recentLimit = shiftMonth(ymOf(new Date()), -2);

    State.expenses.forEach((expense) => {
      if (!validExpense(expense) || expense.date > currentDate) return;
      const key = normalizeText(expense.desc);
      if (!key || existing.has(key) || dismissed.has(key)) return;
      if (!groups.has(key)) groups.set(key, new Map());
      const months = groups.get(key);
      const month = expense.date.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(expense);
    });

    const suggestions = [];
    groups.forEach((byMonth, key) => {
      const months = Array.from(byMonth.keys()).sort().reverse();
      if (months.length < 3 || months[0] < recentLimit) return;
      const items = [];
      let expectedMonth = months[0];
      // Older gaps do not invalidate a new, genuinely consecutive recent pattern.
      for (const month of months) {
        if (month !== expectedMonth || byMonth.get(month).length !== 1) break;
        items.push(byMonth.get(month)[0]);
        expectedMonth = shiftMonth(month, -1);
      }
      if (items.length < 3 || items.some((item) => item.cat !== items[0].cat)) return;

      const amounts = items.map((item) => Number(item.amount)).sort((a, b) => a - b);
      const middle = Math.floor(amounts.length / 2);
      const median = amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2;
      if (amounts.some((amount) => Math.abs(amount - median) > median * 0.15)) return;
      const days = items.map((item) => Number(item.date.slice(8)));
      if (Math.max(...days) - Math.min(...days) > 7) return;

      suggestions.push({
        key,
        desc: items[0].desc,
        amount: Math.round(median * 100) / 100,
        cat: items[0].cat,
        day: Math.round(days.reduce((sum, day) => sum + day, 0) / days.length),
        months: items.length
      });
    });
    return suggestions;
  }

  window.Spendly.Recurring = { apply: applyRecurring, detect: detectRecurring, getPending };
})(window);
