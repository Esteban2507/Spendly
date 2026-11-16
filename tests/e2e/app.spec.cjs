const { test, expect } = require('@playwright/test');

const fixedDate = new Date('2026-11-16T15:00:00-03:00');
const settings = (page) => page.getByRole('tab', { name: /Ajustes/ }).click();
const movements = (page) => page.getByRole('tab', { name: /Movimientos/ }).click();
async function open(page) {
  await page.clock.setFixedTime(fixedDate);
  await page.goto('/');
  await expect(page.locator('#mlabel')).toHaveText('Noviembre de 2026');
}
async function fillExpense(page, description, amount) {
  await movements(page);
  await page.locator('#desc').fill(description);
  await page.locator('#amt').fill(amount);
  await page.locator('#date').fill('2026-11-16');
}
async function count(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('gastos-v1') || '{"expenses":[]}').expenses.length);
}

test('monthly budgets preserve drafts, history and the single currency', async ({ page }) => {
  await open(page);
  await settings(page);
  await page.locator('#cur').selectOption('ARS');
  await page.locator('#budget').fill('100.000');
  await page.locator('#category-budget-0').fill('30.000');
  await movements(page);
  await settings(page);
  await expect(page.locator('#budget')).toHaveValue('100.000');
  await expect(page.locator('#category-budget-0')).toHaveValue('30.000');
  await page.locator('#prev').click();
  await expect(page.locator('#budget')).toHaveValue('');
  await page.locator('#budget').fill('90.000');
  await page.locator('#save-budget').click();
  await expect.poll(() => page.evaluate(() => window.Spendly.getBudget('2026-10').total)).toBe(90000);
  await page.locator('#next').click();
  await expect(page.locator('#budget')).toHaveValue('100.000');
  await page.locator('#save-budget').click();
  await expect.poll(() => page.evaluate(() => window.Spendly.getBudget('2026-11').total)).toBe(100000);
  await expect(page.locator('#cur')).toBeDisabled();
  await page.reload();
  await settings(page);
  await expect(page.locator('#budget')).toHaveValue('100000');
  await expect(page.locator('#category-budget-0')).toHaveValue('30000');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('simultaneous tabs retain both expenses and Constructor does not break rendering', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await fillExpense(page, 'Constructor', '10.000');
  await page.locator('#add').click();
  await expect.poll(() => count(page)).toBe(1);
  const second = await context.newPage();
  second.on('pageerror', (error) => errors.push(error.message));
  await open(second);
  await fillExpense(page, 'Pestaña A', '100');
  await fillExpense(second, 'Pestaña B', '200');
  await Promise.all([page.locator('#add').click(), second.locator('#add').click()]);
  await expect.poll(() => count(page)).toBe(3);
  await page.reload();
  await expect.poll(() => count(page)).toBe(3);
  await page.getByRole('tab', { name: /Resumen/ }).click();
  await expect(page.locator('#hero-total')).toContainText('10.300');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('failed storage keeps form values, rolls back and never shows success', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'gastos-v1') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await fillExpense(page, 'Gasto sin guardar', '123,45');
  await page.locator('#add').click();
  await expect(page.locator('#toast-container')).toContainText('No se pudo guardar');
  await expect(page.locator('#desc')).toHaveValue('Gasto sin guardar');
  await expect(page.locator('#amt')).toHaveValue('123,45');
  expect(await count(page)).toBe(0);
  await expect(page.locator('#toast-container')).not.toContainText('guardado.');
});

test('editing a stale form cannot overwrite another tab updated expense', async ({ page, context }) => {
  await open(page);
  await fillExpense(page, 'Cambio concurrente', '100');
  await page.locator('#add').click();
  await expect.poll(() => count(page)).toBe(1);
  const second = await context.newPage();
  await open(second);
  await movements(second);
  await page.locator('.edit-btn').first().click();
  await page.locator('#amt').fill('111');
  await second.locator('.edit-btn').first().click();
  await second.locator('#amt').fill('222');
  await second.locator('#add').click();
  await expect.poll(() => page.evaluate(() => window.Spendly.State.expenses[0].amount)).toBe(222);
  await page.locator('#add').click();
  await expect(page.locator('#toast-container')).toContainText('El gasto cambió en otra pestaña');
  await expect(page.locator('#amt')).toHaveValue('111');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gastos-v1')).expenses[0].amount)).toBe(222);
});

test('a queued budget save keeps its original month while navigating', async ({ page }) => {
  await open(page);
  await settings(page);
  await page.locator('#budget').fill('1234');
  await page.evaluate(() => {
    navigator.locks.request('spendly-state-write', () => new Promise((resolve) => { window.releaseBudgetLock = resolve; }));
  });
  await page.waitForFunction(() => typeof window.releaseBudgetLock === 'function');
  await page.locator('#save-budget').click();
  await page.locator('#next').click();
  await page.evaluate(() => window.releaseBudgetLock());
  await expect.poll(() => page.evaluate(() => window.Spendly.getBudget('2026-11').total)).toBe(1234);
  expect(await page.evaluate(() => window.Spendly.getBudget('2026-12').total)).toBe(0);
  await expect(page.locator('#budget')).toHaveValue('');
});

test('legacy backups migrate and malformed sub-cent expenses are rejected', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('gastos-v1')) localStorage.setItem('gastos-v1', JSON.stringify({
      version: 2, budget: 10000, currency: 'ARS', recurring: [], dismissed: [], expenses: [
        { id: 'old', desc: 'Anterior', amount: 500, cat: 'Comida', date: '2026-10-16' },
        { id: 'new', desc: 'Actual', amount: 600, cat: 'Comida', date: '2026-11-16' }
      ]
    }));
  });
  await open(page);
  await expect(page.locator('#hero-delta')).toContainText('+20 %');
  await settings(page);
  await expect(page.locator('#budget')).toHaveValue('10000');
  await page.locator('#prev').click();
  await expect(page.locator('#budget')).toHaveValue('10000');
  await fillExpense(page, 'Monto menor a un centavo', '0.001');
  await page.locator('#add').click();
  await expect(page.locator('#err')).toContainText('importe mayor a cero');
  expect(await count(page)).toBe(2);
});

test('startup catches up missed months before the current month due date', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('gastos-v1')) localStorage.setItem('gastos-v1', JSON.stringify({
      version: 3, currency: 'ARS', budgets: {}, expenses: [], dismissed: [], recurring: [
        { id: 'internet', desc: 'Internet', amount: 10000, cat: 'Vivienda', day: 30, from: '2026-10', done: [] }
      ]
    }));
  });
  await open(page);
  await expect.poll(() => count(page)).toBe(1);
  expect(await page.evaluate(() => window.Spendly.State.expenses[0].date)).toBe('2026-10-30');
  expect(await page.evaluate(() => window.Spendly.Recurring.getPending('2026-11')[0].date)).toBe('2026-11-30');
  await page.reload();
  expect(await count(page)).toBe(1);
});

function pdfFixture() {
  const lines = ['SUPERMERCADO COTO', 'Fecha: 16/11/2026', 'SUBTOTAL 8.264,46', 'IVA 1.735,54', 'TOTAL $ 10.000', 'Pagado 20.000,00', 'Vuelto 10.000,00', 'CAE 1234567'];
  const stream = 'BT /F1 16 Tf 30 450 Td ' + lines.map((line, i) => (i ? '0 -35 Td ' : '') + `(${line}) Tj`).join('\n') + ' ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('real PDF and OCR work offline after preparation, with duplicate confirmation', async ({ page, context }) => {
  test.setTimeout(300000);
  await open(page);
  await settings(page);
  await expect(page.locator('#offline-status')).not.toHaveText('Consultando disponibilidad…');
  await page.locator('#prepare-offline').click();
  await expect(page.locator('#offline-status')).toContainText('preparado para este dispositivo', { timeout: 180000 });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await movements(page);
  const receipt = { name: 'comprobante-ficticio.pdf', mimeType: 'application/pdf', buffer: pdfFixture() };
  await page.locator('#receipt-file-input').setInputFiles(receipt);
  await expect(page.locator('#receipt-review-form')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#receipt-amt')).toHaveValue('10000');
  await expect(page.locator('#receipt-date')).toHaveValue('2026-11-16');
  await page.locator('#btn-confirm-receipt').click();
  await expect(page.locator('#receipt-modal')).toBeHidden();
  expect(await count(page)).toBe(1);
  await page.locator('#receipt-file-input').setInputFiles(receipt);
  await expect(page.locator('#receipt-review-form')).toBeVisible();
  const dialog = page.waitForEvent('dialog').then(async (dialog) => { expect(dialog.message()).toContain('mismo archivo'); await dialog.dismiss(); });
  await page.locator('#btn-confirm-receipt').click();
  await dialog;
  expect(await count(page)).toBe(1);
  await page.locator('#btn-cancel-receipt').click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 650;
    const draw = canvas.getContext('2d'); draw.fillStyle = 'white'; draw.fillRect(0, 0, 1100, 650); draw.fillStyle = 'black'; draw.font = '40px sans-serif';
    ['SUPERMERCADO COTO', 'Fecha: 16/11/2026', 'TOTAL $ 10.000,00', 'Pagado 20.000,00', 'Vuelto 10.000,00'].forEach((line, i) => draw.fillText(line, 40, 70 + i * 100));
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#receipt-file-input').setInputFiles({ name: 'ticket-ficticio.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#receipt-review-form')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#receipt-amt')).toHaveValue('10000');
  await expect(page.locator('#receipt-date')).toHaveValue('2026-11-16');
  await page.keyboard.press('Escape');
  await expect(page.locator('#receipt-modal')).toBeHidden();
});
