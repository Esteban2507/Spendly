const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(expenses = [], budgets = {}, pending = []) {
  const api = {
    State: { expenses }, today: () => '2026-11-16',
    isValidDate: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()),
    shiftMonth: (s, n) => { const [y, m] = s.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; },
    getBudget: (m) => budgets[m] || { total: 0, categories: {} },
    Recurring: { getPending: () => pending }
  };
  const context = { window: { Spendly: api }, Date, Map, Number, Object };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/metrics.js'), 'utf8'), context);
  return api.Metrics;
}
const expense = (date, amount, cat = 'Comida') => ({ date, amount, cat });

test('month-to-date compares matching days and excludes registered future expenses from projection', () => {
  const m = setup([
    expense('2026-11-10', 600), expense('2026-11-25', 100),
    expense('2026-10-10', 500), expense('2026-10-30', 500)
  ]).summarize('2026-11');
  assert.equal(m.total, 700);
  assert.equal(m.comparableTotal, 600);
  assert.equal(m.previousTotal, 1000);
  assert.equal(m.previousComparableTotal, 500);
  assert.equal(m.comparisonPercent, 20);
  assert.equal(m.dailyAverage, 37.5);
  assert.equal(m.projectedTotal, 1125);
  assert.match(m.comparisonLabel, /día 16/);
});

test('short previous months clamp cutoff to their last valid day', () => {
  const m = setup([expense('2028-02-29', 100), expense('2028-03-31', 150)])
    .summarize('2028-03', '2028-03-31');
  assert.equal(m.comparisonPercent, 50);
  assert.match(m.comparisonLabel, /día 29 del mes anterior/);
});

test('daily allowance reserves pending rules once and includes today', () => {
  const m = setup([expense('2026-11-10', 100)], { '2026-11': { total: 1000, categories: {} } }, [{ amount: 300 }]).summarize('2026-11');
  assert.equal(m.daysRemaining, 15);
  assert.equal(m.pendingTotal, 300);
  assert.equal(m.availablePerDay, 40);
});

test('overspent allowance remains negative and no budget is represented as unavailable', () => {
  assert.equal(setup([expense('2026-11-01', 130)], { '2026-11': { total: 100, categories: {} } }).summarize('2026-11').availablePerDay, -2);
  assert.equal(setup().summarize('2026-11').availablePerDay, null);
});

test('closed months compare complete months and cannot expose a daily remaining allowance', () => {
  const m = setup([expense('2026-10-31', 200), expense('2026-09-01', 100)], { '2026-10': { total: 1000, categories: {} } }).summarize('2026-10');
  assert.equal(m.comparisonPercent, 100);
  assert.equal(m.projectedTotal, 200);
  assert.equal(m.daysRemaining, 0);
  assert.equal(m.availablePerDay, null);
  assert.match(m.comparisonLabel, /Mes completo/);
});

test('future months do not invent comparison or projection, and use full month allowance', () => {
  const m = setup([], { '2026-12': { total: 3100, categories: {} } }).summarize('2026-12');
  assert.equal(m.comparisonPercent, null);
  assert.equal(m.projectedTotal, null);
  assert.equal(m.dailyAverage, null);
  assert.equal(m.daysRemaining, 31);
  assert.equal(m.availablePerDay, 100);
});

test('zero previous-period total has no percentage baseline', () => {
  assert.equal(setup([expense('2026-11-01', 10)]).summarize('2026-11').comparisonPercent, null);
});

test('aggregation preserves category names safely and rounds cents', () => {
  const input = [expense('2026-11-01', 0.1, 'constructor'), expense('2026-11-02', 0.2, 'constructor'), expense('2026-10-02', 4)];
  const aggregate = setup().aggregateByMonth(input);
  assert.equal(aggregate.get('2026-11').total, 0.3);
  assert.equal(aggregate.get('2026-11').byCategory.constructor, 0.3);
  assert.equal(aggregate.get('2026-10').total, 4);
  assert.equal(input.length, 3);
});
