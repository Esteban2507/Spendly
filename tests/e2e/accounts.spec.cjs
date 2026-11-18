const { test, expect } = require('@playwright/test');

async function addExpense(page, description, amount) {
  await page.getByRole('button', { name: /Movimientos/ }).click();
  await page.locator('#desc').fill(description);
  await page.locator('#amt').fill(amount);
  await page.locator('#add').click();
}

function descriptions(page) {
  return page.evaluate(() => window.Spendly.State.expenses.map(({ desc }) => desc));
}

async function settings(page) {
  await page.getByRole('button', { name: /Ajustes/ }).click();
}

test('sin configuración los gastos se guardan y la interfaz abre sin conexión', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await settings(page);
  await expect(page.locator('#btn-auth-login-settings')).toBeDisabled();
  await expect(page.locator('#cloud-status')).not.toHaveText('Verificando la disponibilidad de la sincronización…');
  await addExpense(page, 'Constructor', '10.000');
  await expect.poll(() => descriptions(page)).toEqual(['Constructor']);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect.poll(() => descriptions(page)).toEqual(['Constructor']);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);
});

async function installFirebaseDouble(page) {
  await page.addInitScript(() => {
    window.SPENDLY_FIREBASE_CONFIG = {
      apiKey: 'test-web-key', authDomain: 'test.firebaseapp.com', projectId: 'test-spendly', appId: '1:000:web:001'
    };
    const documents = new Map();
    const observers = new Set();
    const server = { documents, nextUid: 'a', failReads: false, writes: 0 };
    const auth = {
      currentUser: null,
      setPersistence: async () => {},
      onAuthStateChanged(callback) {
        observers.add(callback);
        queueMicrotask(() => callback(auth.currentUser));
        return () => observers.delete(callback);
      },
      signInWithPopup: async () => {
        auth.currentUser = { uid: server.nextUid, displayName: 'Cuenta ' + server.nextUid };
        observers.forEach((callback) => callback(auth.currentUser));
      },
      signOut: async () => {
        auth.currentUser = null;
        observers.forEach((callback) => callback(null));
      }
    };
    const snapshot = (key) => ({ exists: documents.has(key), data: () => structuredClone(documents.get(key)) });
    const firestore = {
      collection(name) { return path([name]); },
      async runTransaction(callback) {
        let write;
        const result = await callback({
          get: (ref) => ref.get({ source: 'server' }),
          set: (ref, data) => { write = { key: ref.key, data }; }
        });
        if (write) {
          server.writes++;
          documents.set(write.key, structuredClone(write.data));
        }
        return result;
      }
    };
    function path(parts) {
      const key = parts.join('/');
      return {
        key,
        collection: (value) => path([...parts, value]),
        doc: (value) => path([...parts, value]),
        async get() {
          if (server.failReads) throw Object.assign(new Error('Simulated missing permission'), { code: 'permission-denied' });
          return snapshot(key);
        }
      };
    }
    const sdk = { apps: [], initializeApp(config) { const app = { options: config }; sdk.apps.push(app); return app; } };
    sdk.auth = Object.assign(() => auth, {
      Auth: { Persistence: { LOCAL: 'local' } },
      GoogleAuthProvider: class { setCustomParameters() {} }
    });
    sdk.firestore = Object.assign(() => firestore, { FieldValue: { serverTimestamp: () => 'test-stamp' } });
    window.firebase = sdk;
    window.spendlyTestServer = server;
  });
  await page.route('https://www.gstatic.com/firebasejs/**', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
}

test('cambio de cuenta separa los gastos y solo sincroniza la cuenta activa', async ({ page }) => {
  await installFirebaseDouble(page);
  await page.goto('/');
  await addExpense(page, 'Invitado', '100');
  await page.locator('#btn-auth-login').click();
  await expect.poll(() => page.evaluate(() => window.Spendly.getProfile())).toBe('a');
  await expect.poll(() => descriptions(page)).toEqual([]);
  await addExpense(page, 'Cuenta A', '200');
  await expect.poll(() => page.evaluate(() => window.spendlyTestServer.documents.get('users/a/state/data')?.state.expenses[0].desc)).toBe('Cuenta A');
  await page.locator('#btn-auth-logout').click();
  await expect.poll(() => descriptions(page)).toEqual(['Invitado']);
  await page.evaluate(() => { window.spendlyTestServer.nextUid = 'b'; });
  await page.locator('#btn-auth-login').click();
  await expect.poll(() => page.evaluate(() => window.Spendly.getProfile())).toBe('b');
  await expect.poll(() => descriptions(page)).toEqual([]);
  await addExpense(page, 'Cuenta B local', '300');
  await page.locator('#btn-auth-logout').click();
  await expect.poll(() => descriptions(page)).toEqual(['Invitado']);
  await page.locator('#btn-auth-login').click();
  await expect.poll(() => descriptions(page)).toEqual(['Cuenta B local']);
});

test('un error de lectura no habilita sobrescrituras de la nube', async ({ page }) => {
  await installFirebaseDouble(page);
  await page.goto('/');
  await page.evaluate(() => { window.spendlyTestServer.failReads = true; });
  await page.locator('#btn-auth-login').click();
  await expect(page.locator('#cloud-status')).toContainText('rechazó', { useInnerText: false });
  await addExpense(page, 'Gasto local pendiente', '50');
  await expect.poll(() => descriptions(page)).toEqual(['Gasto local pendiente']);
  expect(await page.evaluate(() => window.spendlyTestServer.writes)).toBe(0);
  await settings(page);
  await page.evaluate(() => { window.spendlyTestServer.failReads = false; });
  await page.locator('#retry-cloud').click();
  await expect.poll(() => page.evaluate(() => window.spendlyTestServer.writes)).toBe(1);
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

test('lector actualizado toma el total del PDF y guarda el gasto localmente', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Movimientos/ }).click();
  await page.locator('#receipt-file-input').setInputFiles({
    name: 'comprobante-de-prueba.pdf', mimeType: 'application/pdf', buffer: pdfFixture()
  });
  await expect(page.locator('#receipt-review-form')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#receipt-amt')).toHaveValue('10000');
  await expect(page.locator('#receipt-date')).toHaveValue('2026-11-16');
  await page.locator('#btn-confirm-receipt').click();
  await expect(page.locator('#receipt-modal')).toBeHidden();
  await expect.poll(() => descriptions(page)).toEqual(['Coto']);
});
