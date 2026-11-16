const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.textContent = ''; this.clientWidth = 600; }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
}
function setup(expenses, budgets = {}) {
  const api = {
    CATS: [['Comida', '#fff', 'x']], CAT_ICONS: { Comida: 'x' }, State: { expenses },
    ymOf: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    shiftMonth: (s, n) => { const [y, m] = s.split('-').map(Number); return api.ymOf(new Date(y, m - 1 + n, 1)); },
    formatCurrency: (n) => `$${n}`, LOCALE: 'es-AR',
    getBudget: (month) => ({ total: budgets[month] || 0, categories: {} })
  };
  const fixedNow = new Date('2026-11-16T12:00:00Z').valueOf();
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [fixedNow])); } }
  const context = { window: { Spendly: api }, Date: FixedDate, Intl, Map, Object, Number, document: { createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: (text) => ({ textContent: text }) } };
  for (const file of ['metrics', 'chart']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../js/${file}.js`), 'utf8'), context);
  const containers = { chartContainer: new Element('div'), statsContainer: new Element('div'), legendContainer: new Element('div'), movementContainer: new Element('div') };
  return { api, containers, render: (count, month) => api.Chart.render({ ...containers, rangeMonths: count, currentSelectedMonth: month }) };
}
const expense = (month, amount) => ({ date: `${month}-01`, amount, cat: 'Comida' });
const walk = (element) => [element, ...(element.children || []).flatMap(walk)];

test('history range is anchored to selected month, including year transition', () => {
  const { api } = setup([]);
  assert.equal(Array.from(api.Chart.getLastMonths(3, '2026-01')).join(','), '2025-11,2025-12,2026-01');
});

test('averages include closed zero-spend months after first recorded month', () => {
  const { render, containers } = setup([expense('2026-08', 90), expense('2026-10', 30)]);
  render(4, '2026-11');
  const mean = containers.statsContainer.children.find((card) => walk(card).some((e) => e.textContent === 'Media mensual'));
  assert.ok(mean);
  assert.ok(walk(mean).some((e) => e.textContent === '$40'));
});

test('trend needs six actual closed calendar months and never compares three against two', () => {
  const { render, containers } = setup([expense('2026-06', 100), expense('2026-10', 50)]);
  render(6, '2026-11');
  assert.equal(walk(containers.statsContainer).some((e) => e.textContent === 'Tendencia'), false);
});

test('each displayed month has its own historical budget marker', () => {
  const { render, containers } = setup([expense('2026-10', 50)], { '2026-10': 100, '2026-11': 200 });
  render(3, '2026-11');
  const markers = walk(containers.chartContainer).filter((e) => e.tag === 'line' && /^Presupuesto /.test(e.attrs['aria-label'] || ''));
  assert.equal(markers.length, 2);
  assert.notEqual(markers[0].attrs.y1, markers[1].attrs.y1);
  assert.match(markers[0].attrs['aria-label'], /\$100/);
  assert.match(markers[1].attrs['aria-label'], /\$200/);
});
