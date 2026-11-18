const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

function setup() {
  const elements = new Map();
  let failWrites = false;
  let allowDuplicate = false;
  let confirms = 0;
  const stored = new Map();
  const context = { console: { log() {}, warn() {}, error() {} }, navigator: { language: 'es-AR' },
    setTimeout, clearTimeout, crypto: webcrypto, URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} },
    localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { if (failWrites) throw new Error('QuotaExceededError'); stored.set(key, value); } },
    confirm: () => { confirms++; return allowDuplicate; } };
  function element(id = '') {
    return { id, hidden: id === 'receipt-modal', value: '', checked: false, children: [], style: {}, isConnected: true,
      classList: { add() {}, remove() {} }, handlers: {}, focus() { context.document.activeElement = this; },
      hasAttribute(name) { return name === 'hidden' && this.hidden; },
      setAttribute(name) { if (name === 'hidden') this.hidden = true; },
      removeAttribute(name) { if (name === 'hidden') this.hidden = false; },
      appendChild(child) { this.children.push(child); }, prepend(child) { this.children.unshift(child); elements.set(child.id, child); },
      addEventListener(event, fn) { this.handlers[event] = fn; },
      querySelectorAll() { return []; }, contains() { return true; }, remove() {} };
  }
  for (const id of ['receipt-modal','receipt-loading','receipt-review-form','receipt-loading-text','receipt-desc','receipt-amt',
    'receipt-date','receipt-cat','receipt-rec','receipt-file-name','receipt-preview-thumb','receipt-raw-text',
    'receipt-error','receipt-warning','btn-confirm-receipt','btn-close-receipt-modal','btn-cancel-receipt','receipt-file-input']) elements.set(id, element(id));
  context.document = { readyState: 'loading', addEventListener() {}, getElementById: (id) => elements.get(id) || null,
    createElement: () => element(), activeElement: element('opener'), head: { appendChild() {} } };
  context.Option = function (label, value) { return { label, value }; };
  context.window = context;
  vm.createContext(context);
  for (const file of ['state', 'scanner']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), context);
  context.Spendly.loadState();
  const toasts = [];
  context.Spendly.showToast = (...args) => toasts.push(args);
  context.Spendly.renderAll = () => {};
  context.Spendly.Scanner.init();
  return { api: context.Spendly, elements, context, toasts, setFail: (value) => { failWrites = value; },
    setAllowDuplicate: (value) => { allowDuplicate = value; }, confirms: () => confirms };
}

test('receipt totals use locale-safe amounts and ignore cash, change and fiscal identifiers', () => {
  const { api } = setup();
  for (const [text, expected] of [
    ['Tienda\n16/11/2026\nTOTAL $ 10.000', 10000],
    ['Tienda\n16/11/2026\nTOTAL $ 1.250,50', 1250.5],
    ['TOTAL USD 1,250.50', 1250.5],
    ['Total 100,00\nPagado 200,00\nVuelto 100,00', 100],
    ['Tienda Fecha 16/11/2026 CUIT 30555555559 TOTAL 123,45 CAE 1234567', 123.45],
    ['SUBTOTAL 100,00 TOTAL 121,00 CAE 1234567 16/11/2026', 121],
    ['Importe total:\n$ 40.000\nCAE 1234567', 40000],
    ['Neto 100,00\nIVA 21,00\nTOTAL FINAL 121,00', 121]
  ]) assert.equal(api.Scanner.parseReceipt(text).amount, expected, text);
});

test('ambiguous or unlabelled amounts require manual entry', () => {
  const { api } = setup();
  for (const text of ['Comercio\nCAE 1234567', 'Subtotal 100,00\nIVA 21,00', 'TOTAL 100,00\nTOTAL 200,00', 'TOTAL 100,00 200,00', 'Total impuestos 21,00', 'Total -100,00']) {
    const parsed = api.Scanner.parseReceipt(text);
    assert.equal(parsed.amount, '', text);
    assert.equal(parsed.needsConfirmation, true);
    assert.ok(parsed.warnings.length);
  }
});

test('receipt date must be valid and unambiguous instead of silently defaulting to today', () => {
  const { api } = setup();
  assert.equal(api.Scanner.parseReceipt('TOTAL 50\n31/02/2026').date, '');
  assert.equal(api.Scanner.parseReceipt('TOTAL 50').date, '');
  assert.equal(api.Scanner.parseReceipt('TOTAL 50\n16/11/2026').date, '2026-11-16');
  assert.equal(api.Scanner.parseReceipt('TOTAL 50\n2026-11-16').date, '2026-11-16');
  assert.equal(api.Scanner.parseReceipt('TOTAL 50\n16/11/2026\nVence 20/11/2026').date, '');
});

test('PDF text preserves both explicit line breaks and line coordinates', () => {
  const { api } = setup();
  const text = api.Scanner.textItemsToLines([
    { str: 'Tienda', transform: [1,0,0,1,0,100], hasEOL: true },
    { str: 'TOTAL', transform: [1,0,0,1,0,90] },
    { str: '121,00', transform: [1,0,0,1,80,90] },
    { str: 'CAE', transform: [1,0,0,1,0,70] },
    { str: '1234567', transform: [1,0,0,1,80,70] }
  ]);
  assert.equal(text, 'Tienda\nTOTAL 121,00\nCAE 1234567');
  assert.equal(api.Scanner.parseReceipt(text).amount, 121);
});

async function imageReview(env, text = 'Tienda\n16/11/2026\nTOTAL 10.000') {
  env.context.Tesseract = { createWorker: async () => ({ recognize: async () => ({ data: { text } }), terminate: async () => {} }) };
  await env.api.Scanner.handleFile({ name: 'ticket.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1,2,3]).buffer });
}

test('failed storage leaves the review open and never confirms success', async () => {
  const env = setup();
  await imageReview(env);
  env.setFail(true);
  await env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses.length, 0);
  assert.equal(env.elements.get('receipt-modal').hidden, false);
  assert.ok(env.elements.get('receipt-error').textContent);
  assert.equal(env.toasts.length, 0);
});

test('an exact receipt duplicate needs explicit consent and stores only duplicate metadata', async () => {
  const env = setup();
  await imageReview(env);
  await env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses.length, 1);
  const first = env.api.State.expenses[0];
  assert.equal(first.amount, 10000);
  assert.match(first.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(first.rawText, undefined);
  await imageReview(env);
  await env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.confirms(), 1);
  assert.equal(env.api.State.expenses.length, 1);
  assert.equal(env.elements.get('receipt-modal').hidden, false);
  env.setAllowDuplicate(true);
  await env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses.length, 2);
});

test('manual receipt correction uses the shared money parser and rejects sub-cent or non-finite values', async () => {
  const env = setup();
  await imageReview(env);
  for (const amount of ['0.001', 'Infinity', '-10', '12 34', '1,2,3', '12 euros', '1.234.56']) {
    env.elements.get('receipt-amt').value = amount;
    await env.elements.get('btn-confirm-receipt').onclick();
    assert.equal(env.api.State.expenses.length, 0, amount);
    assert.equal(env.elements.get('receipt-modal').hidden, false);
  }
  env.elements.get('receipt-amt').value = '1.234,56';
  await env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses[0].amount, 1234.56);
});

test('rapid repeated clicks save one receipt', async () => {
  const env = setup();
  await imageReview(env);
  const first = env.elements.get('btn-confirm-receipt').onclick();
  const second = env.elements.get('btn-confirm-receipt').onclick();
  await Promise.all([first, second]);
  assert.equal(env.api.State.expenses.length, 1);
});

test('closing during OCR ignores stale results and returns focus', async () => {
  const env = setup();
  let resolveRecognition;
  let terminated = 0;
  env.context.Tesseract = { createWorker: async () => ({ recognize: () => new Promise((resolve) => { resolveRecognition = resolve; }), terminate: async () => { terminated++; } }) };
  const promise = env.api.Scanner.handleFile({ name: 'ticket.png', type: 'image/png', size: 3, arrayBuffer: async () => new Uint8Array([1,2,3]).buffer });
  while (!resolveRecognition) await new Promise((resolve) => setTimeout(resolve, 1));
  env.elements.get('btn-close-receipt-modal').onclick();
  resolveRecognition({ data: { text: 'TOTAL 100' } });
  await promise;
  assert.equal(env.elements.get('receipt-modal').hidden, true);
  assert.equal(env.context.document.activeElement.id, 'opener');
  assert.ok(terminated > 0);
});


test('a failed recurring save rolls back generated expenses and changes to existing rules', async () => {
  const env = setup();
  env.api.State.recurring.push({ id: 'old-rule', desc: 'Internet', amount: 20, cat: 'Vivienda', day: 1, from: '2026-01', done: [] });
  const before = JSON.stringify(env.api.State);
  await imageReview(env);
  env.elements.get('receipt-rec').checked = true;
  env.api.Recurring = { apply() {
    env.api.State.recurring[0].done.push('2026-11');
    env.api.State.expenses.push({ id: 'generated', desc: 'Internet', amount: 20, cat: 'Vivienda', date: '2026-11-01' });
  } };
  env.setFail(true);
  env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(JSON.stringify(env.api.State), before);
  assert.equal(env.elements.get('receipt-modal').hidden, false);
  assert.equal(env.toasts.length, 0);
});

test('a receipt from a previous profile cannot be saved in the new profile', async () => {
  const env = setup();
  await imageReview(env, 'Private store\n16/11/2026\nTOTAL 100');
  env.api.switchProfile('second-account');
  env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses.length, 0);
  assert.equal(env.elements.get('receipt-modal').hidden, true);
  assert.equal(env.elements.get('receipt-desc').value, '');
  assert.equal(env.elements.get('receipt-raw-text').textContent, '');
  assert.equal(env.toasts.length, 0);
});

test('switching profiles while OCR runs never displays the previous account receipt', async () => {
  const env = setup();
  let release;
  let started;
  const recognizing = new Promise((resolve) => { started = resolve; });
  env.context.Tesseract = { createWorker: async () => ({
    recognize: () => { started(); return new Promise((resolve) => { release = resolve; }); },
    terminate: async () => {}
  }) };
  const pending = env.api.Scanner.handleFile({ name: 'private.png', type: 'image/png', size: 3,
    arrayBuffer: async () => new Uint8Array([4,5,6]).buffer });
  await recognizing;
  env.api.switchProfile('second-account');
  env.api.Scanner.reset();
  release({ data: { text: 'Private merchant\n16/11/2026\nTOTAL 500' } });
  await pending;
  assert.equal(env.elements.get('receipt-modal').hidden, true);
  assert.equal(env.elements.get('receipt-desc').value, '');
  assert.equal(env.elements.get('receipt-raw-text').textContent, '');
  assert.equal(env.api.State.expenses.length, 0);
});

test('reset clears receipt fields and prevents saving a discarded review', async () => {
  const env = setup();
  await imageReview(env);
  env.api.Scanner.reset();
  for (const id of ['receipt-desc', 'receipt-amt', 'receipt-date', 'receipt-cat']) assert.equal(env.elements.get(id).value, '', id);
  for (const id of ['receipt-file-name', 'receipt-raw-text']) assert.equal(env.elements.get(id).textContent, '', id);
  assert.equal(env.elements.get('receipt-preview-thumb').style.backgroundImage, 'none');
  env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses.length, 0);
});

test('profile changes during duplicate confirmation cannot write into the next account', async () => {
  const env = setup();
  await imageReview(env);
  env.elements.get('btn-confirm-receipt').onclick();
  await imageReview(env);
  env.context.confirm = () => { env.api.switchProfile('second-account'); return true; };
  env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses.length, 0);
  assert.equal(env.elements.get('receipt-modal').hidden, true);
  assert.equal(env.toasts.length, 1);
});

test('OCR failures terminate the worker and keep a manual review available', async () => {
  const env = setup();
  let terminated = 0;
  env.context.Tesseract = { createWorker: async () => ({
    recognize: async () => { throw new Error('Unreadable image'); },
    terminate: async () => { terminated++; }
  }) };
  await env.api.Scanner.handleFile({ name: 'ticket.png', type: 'image/png', size: 3,
    arrayBuffer: async () => new Uint8Array([7,8,9]).buffer });
  assert.equal(terminated, 1);
  assert.equal(env.elements.get('receipt-modal').hidden, false);
  assert.equal(env.elements.get('receipt-review-form').hidden, false);
  assert.equal(env.elements.get('receipt-amt').value, '');
  assert.match(env.elements.get('receipt-warning').textContent, /Unreadable image/);
});

test('changing currency during receipt review requires a new review', async () => {
  const env = setup();
  await imageReview(env);
  env.api.State.currency = 'USD';
  env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.api.State.expenses.length, 0);
  assert.match(env.elements.get('receipt-error').textContent, /moneda/);
});

test('async OCR results are rejected when the active profile changed even before a UI reset', async () => {
  const env = setup();
  let release;
  let started;
  const recognizing = new Promise((resolve) => { started = resolve; });
  env.context.Tesseract = { createWorker: async () => ({
    recognize: () => { started(); return new Promise((resolve) => { release = resolve; }); },
    terminate: async () => {}
  }) };
  const pending = env.api.Scanner.handleFile({ name: 'private.png', type: 'image/png', size: 3,
    arrayBuffer: async () => new Uint8Array([10,11,12]).buffer });
  await recognizing;
  env.api.switchProfile('other-account');
  release({ data: { text: 'PRIVATE MERCHANT\n16/11/2026\nTOTAL 500' } });
  await pending;
  assert.equal(env.elements.get('receipt-review-form').hidden, true);
  assert.notEqual(env.elements.get('receipt-desc').value, 'PRIVATE MERCHANT');
  assert.equal(env.elements.get('receipt-raw-text').textContent || '', '');
  env.api.Scanner.reset();
});

test('duplicate receipt protection survives loading the stored profile again', async () => {
  const env = setup();
  await imageReview(env);
  env.elements.get('btn-confirm-receipt').onclick();
  const hash = env.api.State.expenses[0].sourceHash;
  env.api.loadState();
  assert.equal(env.api.State.expenses[0].sourceHash, hash);
  await imageReview(env);
  env.elements.get('btn-confirm-receipt').onclick();
  assert.equal(env.confirms(), 1);
  assert.equal(env.api.State.expenses.length, 1);
});
