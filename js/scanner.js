/**
 * Spendly — lectura local de comprobantes. Los archivos nunca se envían a un servidor.
 * Las dependencias se descargan bajo demanda y pueden prepararse para uso sin conexión.
 */
(function (window) {
  "use strict";
  const { CATS, COL, State, uid, today, formatCurrency, parseAmount, isValidDate,
    normalizeText, persistChangeAsync } = window.Spendly;
  const $ = (id) => document.getElementById(id);
  const ASSETS = Object.freeze([
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.min.mjs",
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/legacy/build/pdf.worker.min.mjs",
    "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js",
    "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-lstm.wasm.js",
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0/tesseract-core-lstm.wasm",
    "https://tessdata.projectnaptha.com/4.0.0/spa.traineddata.gz"
  ]);
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_PDF_PAGES = 10;
  const LOAD_TIMEOUT_MS = 45000;
  let currentParsedData = null;
  let currentFilePreview = null;
  let currentSourceHash = "";
  let returnFocus = null;
  let jobSequence = 0;
  let activeCancel = null;
  let savingReceipt = false;
  let pdfModulePromise = null;
  const scriptPromises = new Map();

  function withTimeout(promise, label, onTimeout) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (onTimeout) onTimeout();
          reject(new Error(`${label} tardó demasiado. Revisa la conexión e intenta de nuevo.`));
        }, LOAD_TIMEOUT_MS);
      })
    ]).finally(() => clearTimeout(timer));
  }

  function loadScript(src) {
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const script = document.createElement("script");
    const promise = withTimeout(new Promise((resolve, reject) => {
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("No se pudo descargar el motor OCR. Conéctate y vuelve a intentar."));
      document.head.appendChild(script);
    }), "La descarga del motor OCR", () => script.remove()).catch((error) => {
      script.remove();
      scriptPromises.delete(src);
      throw error;
    });
    scriptPromises.set(src, promise);
    return promise;
  }

  function loadPdfModule() {
    if (!pdfModulePromise) {
      pdfModulePromise = withTimeout(import(ASSETS[0]), "La descarga del lector PDF").catch((error) => {
        pdfModulePromise = null;
        throw error;
      });
    }
    return pdfModulePromise;
  }

  // Preserve document structure: a whole page must never become a single total line.
  function textItemsToLines(items) {
    const lines = [];
    let parts = [];
    let lastY = null;
    for (const item of items) {
      if (typeof item.str !== "string") continue;
      const y = item.transform && Number(item.transform[5]);
      const changedLine = Number.isFinite(y) && lastY !== null && Math.abs(y - lastY) > 3;
      if (changedLine && parts.length) { lines.push(parts.join(" ")); parts = []; }
      if (item.str.trim()) parts.push(item.str.trim());
      if (Number.isFinite(y)) lastY = y;
      if (item.hasEOL && parts.length) { lines.push(parts.join(" ")); parts = []; lastY = null; }
    }
    if (parts.length) lines.push(parts.join(" "));
    return lines.join("\n");
  }

  async function extractTextFromPdf(arrayBuffer, updateStatus, isCurrent) {
    const pdfjs = await loadPdfModule();
    if (!isCurrent()) return "";
    pdfjs.GlobalWorkerOptions.workerSrc = ASSETS[1];
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer, isEvalSupported: false,
      useWasm: false, useSystemFonts: true });
    activeCancel = () => loadingTask.destroy();
    let pdf;
    try {
      pdf = await withTimeout(loadingTask.promise, "La lectura del PDF", () => loadingTask.destroy());
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new Error(`El PDF tiene ${pdf.numPages} páginas. Usa un comprobante de hasta ${MAX_PDF_PAGES} páginas.`);
      }
      const texts = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!isCurrent()) return "";
        updateStatus(`Leyendo página ${i} de ${pdf.numPages}...`);
        const page = await pdf.getPage(i);
        const text = textItemsToLines((await page.getTextContent()).items);
        if (text.replace(/\s/g, "").length >= 15) {
          texts.push(text);
        } else {
          updateStatus(`Reconociendo imagen de página ${i} de ${pdf.numPages}...`);
          const original = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 2500 / Math.max(original.width, original.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            if (isCurrent()) texts.push(await extractTextFromImage(canvas, updateStatus, isCurrent));
          } finally { canvas.width = 0; canvas.height = 0; }
          activeCancel = () => loadingTask.destroy();
        }
        page.cleanup();
      }
      return texts.join("\n");
    } finally {
      await loadingTask.destroy();
    }
  }

  async function extractTextFromImage(imageSource, updateStatus, isCurrent) {
    updateStatus("Cargando motor OCR local...");
    if (!window.Tesseract) await loadScript(ASSETS[2]);
    if (!isCurrent()) return "";
    const workerPromise = window.Tesseract.createWorker("spa", 1, {
      workerPath: ASSETS[3], corePath: ASSETS[4],
      langPath: "https://tessdata.projectnaptha.com/4.0.0", gzip: true,
      logger: (m) => {
        if (isCurrent() && m.status === "recognizing text") {
          updateStatus(`Reconociendo texto: ${Math.round((m.progress || 0) * 100)}%...`);
        }
      }
    });
    // A worker that finishes initializing after a cancellation is still terminated.
    let initializationExpired = false;
    workerPromise.then((worker) => { if (initializationExpired || !isCurrent()) worker.terminate(); }, () => {});
    const worker = await withTimeout(workerPromise, "La carga del OCR", () => { initializationExpired = true; });
    try {
      if (!isCurrent()) return "";
      activeCancel = () => worker.terminate();
      const result = await withTimeout(worker.recognize(imageSource), "El reconocimiento del comprobante", () => worker.terminate());
      return result.data.text;
    } finally {
      await worker.terminate();
    }
  }

  const KNOWN_MERCHANTS = [
    { name: "Carrefour", pattern: /\bcarrefour\b/i, cat: "Comida" },
    { name: "Coto", pattern: /\bcoto\b/i, cat: "Comida" },
    { name: "Supermercado Día", pattern: /\b(dia%|supermercados? dia|dia argentina|distribuidora internacional)\b/i, cat: "Comida" },
    { name: "Mercadona", pattern: /\bmercadona\b/i, cat: "Comida" },
    { name: "Jumbo", pattern: /\bjumbo\b/i, cat: "Comida" },
    { name: "Disco", pattern: /\bdisco\b/i, cat: "Comida" },
    { name: "Vea", pattern: /\bsupermercados? vea\b/i, cat: "Comida" },
    { name: "ChangoMás", pattern: /\b(changomas|chango mas|walmart)\b/i, cat: "Comida" },
    { name: "Lidl", pattern: /\blidl\b/i, cat: "Comida" },
    { name: "Eroski", pattern: /\beroski\b/i, cat: "Comida" },
    { name: "McDonald's", pattern: /\b(mcdonald|mc donald)\b/i, cat: "Comida" },
    { name: "Burger King", pattern: /\bburger king\b/i, cat: "Comida" },
    { name: "Starbucks", pattern: /\bstarbucks\b/i, cat: "Comida" },
    { name: "Mostaza", pattern: /\bmostaza\b/i, cat: "Comida" },
    { name: "Subway", pattern: /\bsubway\b/i, cat: "Comida" },
    { name: "PedidosYa", pattern: /\bpedidosya\b/i, cat: "Comida" },
    { name: "Rappi", pattern: /\brappi\b/i, cat: "Comida" },
    { name: "Uber Eats", pattern: /\buber eats\b/i, cat: "Comida" },
    { name: "YPF", pattern: /\bypf\b/i, cat: "Transporte" },
    { name: "Shell", pattern: /\bshell\b/i, cat: "Transporte" },
    { name: "Axion Energy", pattern: /\baxion\b/i, cat: "Transporte" },
    { name: "Repsol", pattern: /\brepsol\b/i, cat: "Transporte" },
    { name: "Puma Energy", pattern: /\bpuma energy\b/i, cat: "Transporte" },
    { name: "Uber", pattern: /\buber\b/i, cat: "Transporte" },
    { name: "Cabify", pattern: /\bcabify\b/i, cat: "Transporte" },
    { name: "SUBE", pattern: /\bsube\b/i, cat: "Transporte" },
    { name: "Farmacity", pattern: /\bfarmacity\b/i, cat: "Salud" },
    { name: "Farmacia", pattern: /\bfarmacia\b/i, cat: "Salud" },
    { name: "Doctor Ahorro", pattern: /\bdr\.? ahorro\b/i, cat: "Salud" },
    { name: "Netflix", pattern: /\bnetflix\b/i, cat: "Suscripciones" },
    { name: "Spotify", pattern: /\bspotify\b/i, cat: "Suscripciones" },
    { name: "YouTube Premium", pattern: /\byoutube\b/i, cat: "Suscripciones" },
    { name: "Disney+", pattern: /\bdisney\b/i, cat: "Suscripciones" },
    { name: "Amazon Prime", pattern: /\b(amazon prime|prime video)\b/i, cat: "Suscripciones" },
    { name: "Apple", pattern: /\b(apple|itunes|icloud)\b/i, cat: "Suscripciones" },
    { name: "Google Storage", pattern: /\bgoogle\b/i, cat: "Suscripciones" },
    { name: "Edenor", pattern: /\bedenor\b/i, cat: "Vivienda" },
    { name: "Edesur", pattern: /\bedesur\b/i, cat: "Vivienda" },
    { name: "Metrogas", pattern: /\bmetrogas\b/i, cat: "Vivienda" },
    { name: "Naturgy", pattern: /\bnaturgy\b/i, cat: "Vivienda" },
    { name: "AySA", pattern: /\baysa\b/i, cat: "Vivienda" },
    { name: "Mercado Libre", pattern: /\bmercado libre\b/i, cat: "Compras" },
    { name: "Mercado Pago", pattern: /\bmercado pago\b/i, cat: "Compras" },
    { name: "Zara", pattern: /\bzara\b/i, cat: "Compras" },
    { name: "H&M", pattern: /\bh&m\b/i, cat: "Compras" },
    { name: "Adidas", pattern: /\badidas\b/i, cat: "Compras" },
    { name: "Nike", pattern: /\bnike\b/i, cat: "Compras" }
  ];

  const NOISE_WORDS = [
    "factura", "ticket", "comprobante", "original", "duplicado", "cuit", "c.u.i.t",
    "fecha", "hora", "caja", "cajero", "pv", "punto de venta", "i.v.a", "iva",
    "responsable inscripto", "consumidor final", "monotributo", "ingresos brutos",
    "ing. brutos", "domicilio", "sucursal", "tel", "telefono", "tarjeta", "terminal",
    "pagina", "orden", "transaccion", "autorizacion", "afip", "dgi", "ticket fiscal"
  ];

  function parseReceipt(rawText) {
    rawText = String(rawText || "");
    const cleanLines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const fullNormalized = rawText.toLowerCase();
    let detectedMerchant = "";
    let detectedCategory = "Otros";
    for (const item of KNOWN_MERCHANTS) {
      if (item.pattern.test(fullNormalized)) { detectedMerchant = item.name; detectedCategory = item.cat; break; }
    }
    if (!detectedMerchant) {
      detectedMerchant = cleanLines.slice(0, 6).find((line) =>
        line.length < 50 && /[a-záéíóúñ]{3,}/i.test(line) &&
        !NOISE_WORDS.some((word) => line.toLowerCase().includes(word))) || "Gasto con comprobante";
    }
    if (detectedCategory === "Otros") {
      const categories = [
        ["Comida", /\b(super|comida|almacen|panaderia|restaurante|cafe|cena|almuerzo|vianda|kiosco)\b/i],
        ["Transporte", /\b(combustible|nafta|gnc|peaje|estacionamiento|colectivo|pasaje|taxi|remis)\b/i],
        ["Salud", /\b(farmacia|medicamento|remedio|clinica|medico|optica|consulta)\b/i],
        ["Vivienda", /\b(luz|gas|agua|expensas|alquiler|internet|servicio)\b/i],
        ["Ocio", /\b(cine|teatro|juego|recital|show|salida|bar)\b/i],
        ["Compras", /\b(ropa|calzado|tienda|indumentaria|shopping)\b/i]
      ];
      const category = categories.find(([, pattern]) => pattern.test(fullNormalized));
      if (category) detectedCategory = category[0];
    }
    const warnings = [];
    const candidates = [];
    const totalLabels = /\b(importe\s+total|monto\s+total|total\s+(?:a\s+pagar|final|general|factura)|a\s+pagar|total)\b/gi;
    // Only the amount immediately following a total label qualifies. Fiscal identifiers,
    // tendered cash, change and years elsewhere in the text are never fallbacks.
    const moneyStart = /^\s*[:=]?\s*(?:(?:ARS|USD|EUR|COP|CLP|MXN|PEN|UYU|GBP|US\$|AR\$|S\/|[$€£])\s*)?(\d+(?:[.,]\d+)*)(?![\d.,])/i;
    cleanLines.forEach((line, index) => {
      totalLabels.lastIndex = 0;
      for (const match of line.matchAll(totalLabels)) {
        const prefix = line.slice(0, match.index).trim();
        if (/(?:sub|neto|iva|impuestos|descuento|percepcion|retencion)\s*$/i.test(prefix)) continue;
        let tail = line.slice(match.index + match[0].length);
        if (/^\s*(?:de\s+)?(?:iva|impuestos|percepciones|retenciones|descuentos|articulos|items)\b/i.test(tail)) continue;
        if (!tail.replace(/[:=\s]/g, "") && cleanLines[index + 1]) tail = cleanLines[index + 1];
        const amountMatch = tail.match(moneyStart);
        if (!amountMatch) continue;
        const trailing = tail.slice(amountMatch[0].length);
        // A date or an identifier isn't a price even when it follows the word TOTAL.
        if (/^\s*[\/-]\s*\d/.test(trailing) || /^\s*(?:%|(?:unidades|articulos|items)\b)/i.test(trailing)) continue;
        if (/^\s+[\d.,]/.test(trailing)) continue;
        const amount = parseAmount(amountMatch[1]);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const rank = /importe|monto|final|general|factura|total\s+a\s+pagar/i.test(match[0]) ? 2 : 1;
        candidates.push({ amount: Math.round(amount * 100) / 100, rank });
      }
    });
    const rank = candidates.reduce((max, item) => Math.max(max, item.rank), 0);
    const totals = [...new Set(candidates.filter((item) => item.rank === rank).map((item) => item.amount))];
    const amount = totals.length === 1 ? totals[0] : "";
    if (!amount) warnings.push(totals.length > 1 ?
      "Se encontraron distintos totales. Escribe el importe final del comprobante." :
      "No se pudo identificar un total fiable. Completa el importe manualmente.");

    let date = "";
    const dateCandidates = [];
    for (const match of rawText.matchAll(/\b(20\d{2})[\/\-.](0?[1-9]|1[0-2])[\/\-.](0?[1-9]|[12]\d|3[01])\b/g)) {
      dateCandidates.push(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
    }
    for (const match of rawText.matchAll(/\b(0?[1-9]|[12]\d|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](20\d{2}|\d{2})\b/g)) {
      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      dateCandidates.push(`${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
    }
    const validDates = [...new Set(dateCandidates.filter(isValidDate))];
    if (validDates.length === 1) date = validDates[0];
    if (!date) warnings.push(validDates.length > 1 ?
      "El comprobante contiene varias fechas. Confirma la fecha del gasto." :
      "No se identificó una fecha válida. Completa la fecha del gasto.");
    return { desc: detectedMerchant.slice(0, 80), amount, date, cat: detectedCategory,
      warnings, needsConfirmation: warnings.length > 0, rawText };
  }

  function receiptFingerprint(expense) {
    return [normalizeText(expense.desc), Number(expense.amount).toFixed(2), expense.date].join("|");
  }

  function modalMessage(id, message, role) {
    let element = $(id);
    if (!element) {
      element = document.createElement("div");
      element.id = id;
      element.className = role === "alert" ? "err" : "sub";
      element.setAttribute("role", role);
      const parent = $("receipt-review-form");
      if (parent) parent.prepend(element);
    }
    if (element) { element.textContent = message; element.hidden = !message; }
  }

  function cancelJob() {
    jobSequence++;
    const cancel = activeCancel;
    activeCancel = null;
    if (cancel) Promise.resolve().then(cancel).catch(() => {});
  }

  function openScannerModal() {
    const modal = $("receipt-modal");
    if (!modal) return;
    if (modal.hasAttribute("hidden")) returnFocus = document.activeElement;
    modal.removeAttribute("hidden");
    $("receipt-loading").hidden = false;
    $("receipt-review-form").hidden = true;
    modalMessage("receipt-error", "", "alert");
    const closeButton = $("btn-close-receipt-modal");
    if (closeButton) closeButton.focus();
  }

  function closeScannerModal() {
    cancelJob();
    const modal = $("receipt-modal");
    if (modal) modal.hidden = true;
    const fileInput = $("receipt-file-input");
    if (fileInput) fileInput.value = "";
    currentParsedData = null;
    currentSourceHash = "";
    if (currentFilePreview) URL.revokeObjectURL(currentFilePreview);
    currentFilePreview = null;
    if (returnFocus && returnFocus.isConnected !== false && returnFocus.focus) returnFocus.focus();
    returnFocus = null;
  }

  function updateLoadingStatus(message) {
    const element = $("receipt-loading-text");
    if (element) element.textContent = message;
  }

  function showReviewForm(parsed, file) {
    $("receipt-loading").hidden = true;
    $("receipt-review-form").hidden = false;
    $("receipt-desc").value = parsed.desc;
    $("receipt-amt").value = parsed.amount;
    $("receipt-date").value = parsed.date;
    const categories = $("receipt-cat");
    if (!categories.children.length) CATS.forEach(([name, , icon]) => categories.appendChild(new Option(`${icon} ${name}`, name)));
    categories.value = parsed.cat;
    $("receipt-rec").checked = false;
    $("receipt-file-name").textContent = file.name || "Comprobante";
    const thumb = $("receipt-preview-thumb");
    thumb.textContent = currentFilePreview ? "" : "📄";
    thumb.style.backgroundImage = currentFilePreview ? `url("${currentFilePreview}")` : "none";
    $("receipt-raw-text").textContent = parsed.rawText.trim() || "(No se detectó texto)";
    modalMessage("receipt-warning", parsed.warnings.join(" "), "status");
    currentParsedData = parsed;
    $("receipt-amt").focus();
  }

  async function sourceHash(buffer) {
    if (!window.crypto || !window.crypto.subtle) return "";
    const digest = await window.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function handleFileSelected(file) {
    if (!file || savingReceipt) return;
    cancelJob();
    const job = jobSequence;
    const isCurrent = () => job === jobSequence;
    if (currentFilePreview) URL.revokeObjectURL(currentFilePreview);
    currentParsedData = null;
    currentSourceHash = "";
    currentFilePreview = null;
    openScannerModal();
    const updateStatus = (message) => { if (isCurrent()) updateLoadingStatus(message); };
    try {
      if (!(file.size > 0) || file.size > MAX_FILE_BYTES) throw new Error("Usa un archivo de hasta 20 MB que no esté vacío.");
      const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      const image = /^image\//.test(file.type || "");
      if (!pdf && !image) throw new Error("El formato debe ser PDF o una imagen PNG/JPG compatible.");
      if (image) currentFilePreview = URL.createObjectURL(file);
      updateStatus("Leyendo archivo en este dispositivo...");
      const buffer = await file.arrayBuffer();
      const hash = await sourceHash(buffer);
      if (!isCurrent()) return;
      currentSourceHash = hash;
      const rawText = pdf ? await extractTextFromPdf(buffer, updateStatus, isCurrent) :
        await extractTextFromImage(file, updateStatus, isCurrent);
      if (!isCurrent()) return;
      activeCancel = null;
      showReviewForm(parseReceipt(rawText), file);
    } catch (error) {
      if (!isCurrent()) return;
      activeCancel = null;
      const parsed = parseReceipt("");
      parsed.warnings.unshift(`Lectura automática no disponible: ${error.message || "error desconocido"}. Puedes completar los datos aquí.`);
      showReviewForm(parsed, file);
    }
  }

  async function handleSaveReceiptExpense() {
    if (!currentParsedData || savingReceipt) return;
    modalMessage("receipt-error", "", "alert");
    const desc = $("receipt-desc").value.trim().slice(0, 80);
    const amount = parseAmount($("receipt-amt").value);
    const date = $("receipt-date").value;
    const cat = $("receipt-cat").value;
    const isRecurring = $("receipt-rec").checked;
    if (!desc || !Number.isFinite(amount) || Math.round(amount * 100) <= 0 || !isValidDate(date) || !Object.hasOwn(COL, cat)) {
      modalMessage("receipt-error", "Completa una descripción, un importe válido mayor a cero y una fecha válida.", "alert");
      return;
    }
    const newExpense = { id: uid(), desc, amount: Math.round(amount * 100) / 100, date, cat };
    newExpense.receiptFingerprint = receiptFingerprint(newExpense);
    if (currentSourceHash) newExpense.sourceHash = currentSourceHash;
    const expenseCurrency = State.currency;
    let duplicateDeclined = false;
    savingReceipt = true;
    const saveButton = $("btn-confirm-receipt");
    if (saveButton) saveButton.disabled = true;
    let ok = false;
    try {
      ok = await persistChangeAsync(() => {
        if (State.currency !== expenseCurrency) throw new Error("La moneda cambió en otra pestaña. Revisa la moneda y vuelve a intentar.");
        const exactDuplicate = newExpense.sourceHash && State.expenses.some((expense) => expense.sourceHash === newExpense.sourceHash);
        const possibleDuplicate = State.expenses.some((expense) => receiptFingerprint(expense) === newExpense.receiptFingerprint);
        if ((exactDuplicate || possibleDuplicate) && !window.confirm(exactDuplicate ?
          "Este mismo archivo ya fue registrado. ¿Quieres registrar otro gasto de todos modos?" :
          "Ya existe un gasto del mismo comercio, fecha e importe. ¿Quieres registrarlo igualmente?")) {
          duplicateDeclined = true;
          return false;
        }
        State.expenses.push(newExpense);
        if (isRecurring) {
          const nowMonth = window.Spendly.ymOf(new Date());
          const expenseMonth = date.slice(0, 7);
          const from = expenseMonth > nowMonth ? expenseMonth : nowMonth;
          State.recurring.push({ id: uid(), desc, amount: newExpense.amount, cat,
            day: Number(date.slice(8)), from, done: expenseMonth === from ? [expenseMonth] : [] });
          if (window.Spendly.Recurring) window.Spendly.Recurring.apply();
        }
      }, { refresh: true });
    } catch (error) {
      modalMessage("receipt-error", error.message || "No se pudo guardar el comprobante.", "alert");
      return;
    } finally {
      savingReceipt = false;
      if (saveButton) saveButton.disabled = false;
    }
    if (!ok) {
      if (duplicateDeclined) return;
      const status = window.Spendly.getStorageStatus();
      modalMessage("receipt-error", status.error || "No se pudo guardar. Conserva el comprobante y vuelve a intentar.", "alert");
      return;
    }
    closeScannerModal();
    if (window.Spendly.renderAll) window.Spendly.renderAll(date.slice(0, 7));
    if (window.Spendly.showToast) window.Spendly.showToast(`Gasto de ${formatCurrency(newExpense.amount)} guardado.`, "success", "🧾");
  }

  function initScanner() {
    const input = $("receipt-file-input");
    const trigger = (event) => { if (event) event.stopPropagation(); if (input) input.click(); };
    for (const id of ["btn-scan-receipt", "btn-scan-receipt-hero"]) { const button = $(id); if (button) button.onclick = trigger; }
    if (input) input.onchange = (event) => { const file = event.target.files && event.target.files[0]; if (file) handleFileSelected(file); };
    const dropzone = $("receipt-dropzone");
    if (dropzone) {
      dropzone.onclick = trigger;
      dropzone.ondragover = (event) => { event.preventDefault(); dropzone.classList.add("dragover"); };
      dropzone.ondragleave = () => dropzone.classList.remove("dragover");
      dropzone.ondrop = (event) => { event.preventDefault(); dropzone.classList.remove("dragover"); const file = event.dataTransfer.files[0]; if (file) handleFileSelected(file); };
    }
    for (const id of ["btn-cancel-receipt", "btn-close-receipt-modal"]) { const button = $(id); if (button) button.onclick = closeScannerModal; }
    const confirm = $("btn-confirm-receipt");
    if (confirm) confirm.onclick = handleSaveReceiptExpense;
    const modal = $("receipt-modal");
    if (modal) modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeScannerModal(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(modal.querySelectorAll('button, input, select, summary, [tabindex="0"]')).filter((element) =>
        !element.disabled && !element.closest("[hidden]") && element.getClientRects().length);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    });
  }

  window.Spendly.Scanner = { init: initScanner, parseReceipt, handleFile: handleFileSelected,
    ASSETS, textItemsToLines, receiptFingerprint };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initScanner);
  else initScanner();
})(window);
