const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-16T12:00:00'])); }
  }
  const State = { expenses: [], recurring: [], dismissed: [] };
  const pad = (value) => String(value).padStart(2, '0');
  const ymOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  const context = { Date: FixedDate, window: { Spendly: {
    State, pad, ymOf, today: () => '2026-11-16',
    shiftMonth: (month, step) => { const [y, m] = month.split('-').map(Number); return ymOf(new Date(y, m - 1 + step, 1)); },
    normalizeText: (text) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/recurring.js'), 'utf8'), context);
  return { State, Recurring: context.window.Spendly.Recurring };
}
const rule = (patch = {}) => ({ id: 'internet', desc: 'Internet', amount: 10000, cat: 'Vivienda', day: 10, from: '2026-11', done: [], ...patch });
const expense = (patch = {}) => ({ id: 'manual', desc: 'Internet', amount: 10000, cat: 'Vivienda', date: '2026-11-10', ...patch });

test('description Constructor does not collide with Object.prototype', () => {
  const { State, Recurring } = setup();
  State.expenses = ['09', '10', '11'].map((month) => expense({ id: month, desc: 'Constructor', date: `2026-${month}-10` }));
  assert.equal(Recurring.detect()[0].desc, 'Constructor');
});

test('only actual consecutive recent months are described as consecutive', () => {
  const { State, Recurring } = setup();
  State.expenses = ['07', '09', '11'].map((month) => expense({ id: month, date: `2026-${month}-10` }));
  assert.equal(Recurring.detect().length, 0);
  State.expenses = ['04', '09', '10', '11'].map((month) => expense({ id: month, date: `2026-${month}-10` }));
  assert.equal(Recurring.detect()[0].months, 3);
});

test('duplicate charges in latest month do not become a monthly subscription', () => {
  const { State, Recurring } = setup();
  State.expenses = ['09', '10', '11', '11'].map((month, i) => expense({ id: String(i), date: `2026-${month}-10` }));
  assert.equal(Recurring.detect().length, 0);
});

test('different amount, category or distant date cannot suppress a scheduled charge', () => {
  for (const patch of [{ amount: 100 }, { cat: 'Otros' }, { date: '2026-11-01' }]) {
    const { State, Recurring } = setup();
    State.recurring = [rule()];
    State.expenses = [expense(patch)];
    assert.equal(Recurring.apply().added, 1);
    assert.equal(State.expenses.length, 2);
    assert.equal(State.expenses[1].rid, 'internet');
  }
});

test('one matching manual charge is linked and never generated twice', () => {
  const { State, Recurring } = setup();
  State.recurring = [rule()];
  State.expenses = [expense({ amount: 10000.01, date: '2026-11-12' })];
  assert.equal(Recurring.apply().added, 0);
  assert.equal(State.expenses[0].rid, 'internet');
  assert.equal(Recurring.apply().changed, false);
});

test('ambiguous manual matches remain pending for review without a fabricated third charge', () => {
  const { State, Recurring } = setup();
  State.recurring = [rule()];
  State.expenses = [expense(), expense({ id: 'second' })];
  const result = Recurring.apply();
  assert.equal(result.added, 0);
  assert.equal(result.changed, false);
  assert.equal(result.ambiguous[0].candidates, 2);
  assert.equal(State.expenses.length, 2);
  assert.equal(State.recurring[0].done.length, 0);
  assert.equal(Recurring.getPending('2026-11')[0].ambiguous, true);
});

test('rule identity prevents cross-rule omissions and allows deterministic merging', () => {
  const { State, Recurring } = setup();
  State.recurring = [rule(), rule({ id: 'office' })];
  assert.equal(Recurring.apply().added, 2);
  assert.equal(new Set(State.expenses.map((item) => item.id)).size, 2);
  State.recurring.forEach((item) => { item.done = []; });
  assert.equal(Recurring.apply().added, 0);
});

test('31st clamps to February and no upcoming charge is materialized', () => {
  const { State, Recurring } = setup();
  State.recurring = [rule({ from: '2026-02', day: 31, done: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'] })];
  assert.equal(Recurring.apply().added, 1);
  assert.equal(State.expenses[0].date, '2026-02-28');
  assert.equal(Recurring.getPending('2026-11')[0].date, '2026-11-30');
  assert.equal(Recurring.getPending('2026-12')[0].date, '2026-12-31');
});

test('pending is read-only and excludes done, linked and unique manual matches', () => {
  const { State, Recurring } = setup();
  State.recurring = [rule(), rule({ id: 'netflix', desc: 'Netflix', amount: 500, day: 25 }), rule({ id: 'done', done: ['2026-11'] })];
  State.expenses = [expense()];
  const before = JSON.stringify(State);
  const pending = Recurring.getPending('2026-11');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].rid, 'netflix');
  assert.equal(JSON.stringify(State), before);
  assert.equal(Recurring.getPending('2026-10').length, 0);
  assert.equal(Recurring.getPending('2026-99').length, 0);
});

test('invalid rules cannot create charges or loop on malformed months', () => {
  const { State, Recurring } = setup();
  State.recurring = [rule({ from: '2026-00' }), rule({ day: 0 }), rule({ amount: Infinity }), rule({ day: 1.5 }), rule({ from: '2026-12' })];
  assert.equal(Recurring.apply().added, 0);
  assert.equal(Recurring.getPending('2026-11').length, 0);
});
