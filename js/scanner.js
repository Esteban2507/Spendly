/**
 * ============================================================================
 * Spendly - Módulo Lector Inteligente de Comprobantes (PDF e Imágenes)
 * Extracción de texto mediante PDF.js y OCR (Tesseract.js) con parser heurístico
 * ============================================================================
 */

(function (window) {
  "use strict";

  const {
    CATS,
    COL,
    CAT_ICONS,
    State,
    uid,
    today,
    formatCurrency,
    saveState
  } = window.Spendly;

  const $ = (id) => document.getElementById(id);

  // URLs de librerías para carga bajo demanda (CDN)
  const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  // Estado del modal de escaneo
  let currentParsedData = null;
  let currentFilePreview = null;

  // --------------------------------------------------------------------------
  // 1. Carga Dinámica de Scripts
  // --------------------------------------------------------------------------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded) return resolve();
        existing.addEventListener("load", resolve);
        existing.addEventListener("error", reject);
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => {
        s.dataset.loaded = "true";
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // --------------------------------------------------------------------------
  // 2. Extracción de Texto de Archivos (PDF e Imágenes)
  // --------------------------------------------------------------------------
  async function extractTextFromPdf(arrayBuffer, updateStatus) {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js no está disponible.");
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

    updateStatus("Leyendo páginas del PDF...");
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = "";
    const numPages = Math.min(pdf.numPages, 3); // Analizar las primeras 3 páginas

    for (let i = 1; i <= numPages; i++) {
      updateStatus(`Extrayendo texto de página ${i} de ${pdf.numPages}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageStr = textContent.items.map((item) => item.str).join(" ");
      fullText += pageStr + "\n";
    }

    // Si el PDF contiene poco texto (podría ser un PDF escaneado con solo imagen)
    if (fullText.trim().length < 25 && pdf.numPages > 0) {
      updateStatus("PDF escaneado detectado. Iniciando OCR óptico...");
      const page1 = await pdf.getPage(1);
      const viewport = page1.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page1.render({ canvasContext: ctx, viewport }).promise;
      return await extractTextFromImage(canvas, updateStatus);
    }

    return fullText;
  }

  async function extractTextFromImage(imageSource, updateStatus) {
    updateStatus("Cargando motor de reconocimiento óptico (OCR)...");
    if (!window.Tesseract) {
      await loadScript(TESSERACT_CDN);
    }

    updateStatus("Procesando y leyendo comprobante...");
    const worker = await window.Tesseract.createWorker("spa", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && m.progress) {
          const pct = Math.round(m.progress * 100);
          updateStatus(`Reconociendo texto: ${pct}%...`);
        }
      }
    });

    const ret = await worker.recognize(imageSource);
    await worker.terminate();
    return ret.data.text;
  }

  // --------------------------------------------------------------------------
  // 3. Algoritmo Heurístico de Análisis de Comprobantes (Parser)
  // --------------------------------------------------------------------------
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
    if (!rawText) return getFallbackParsed();

    const cleanLines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const fullNormalized = rawText.toLowerCase();

    // 1. Detección de Comercio y Categoría
    let detectedMerchant = "";
    let detectedCategory = "Otros";

    for (const item of KNOWN_MERCHANTS) {
      if (item.pattern.test(fullNormalized)) {
        detectedMerchant = item.name;
        detectedCategory = item.cat;
        break;
      }
    }

    // Si no se encontró un comercio conocido, buscar en las primeras 5 líneas limpias
    if (!detectedMerchant) {
      for (let i = 0; i < Math.min(cleanLines.length, 6); i++) {
        const line = cleanLines[i];
        const lower = line.toLowerCase();
        const hasNoise = NOISE_WORDS.some((word) => lower.includes(word));
        const hasLetters = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/.test(line);

        if (!hasNoise && hasLetters && line.length < 50) {
          detectedMerchant = line
            .replace(/[^\w\s\.\-áéíóúÁÉÍÓÚñÑ]/g, "")
            .trim();
          break;
        }
      }
    }

    if (!detectedMerchant) {
      detectedMerchant = cleanLines[0] ? cleanLines[0].slice(0, 40) : "Gasto con comprobante";
    }

    // Auto-detección secundaria de categoría por palabras clave en todo el texto
    if (detectedCategory === "Otros") {
      if (/\b(super|comida|almacen|panaderia|restaurante|cafe|cena|almuerzo|vianda|kiosco)\b/i.test(fullNormalized)) {
        detectedCategory = "Comida";
      } else if (/\b(combustible|nafta|gnc|peaje|estacionamiento|colectivo|pasaje|taxi|remis)\b/i.test(fullNormalized)) {
        detectedCategory = "Transporte";
      } else if (/\b(farmacia|medicamento|remedio|clinica|medico|optica|consulta)\b/i.test(fullNormalized)) {
        detectedCategory = "Salud";
      } else if (/\b(luz|gas|agua|expensas|alquiler|internet|servicio)\b/i.test(fullNormalized)) {
        detectedCategory = "Vivienda";
      } else if (/\b(cine|teatro|juego|recital|show|salida|bar)\b/i.test(fullNormalized)) {
        detectedCategory = "Ocio";
      } else if (/\b(ropa|calzado|tienda|indumentaria|shopping)\b/i.test(fullNormalized)) {
        detectedCategory = "Compras";
      }
    }

    // 2. Detección de Importe (Total)
    let detectedAmount = 0;
    const amountCandidates = [];

    // Buscar en líneas que contengan palabras indicativas de total
    const totalRegex = /\b(total|importe|pagar|pagado|neto|monto|cobrado|total\s*\$|total\s*eur)\b/i;

    cleanLines.forEach((line) => {
      const isTotalLine = totalRegex.test(line) && !/\bsubtotal\b/i.test(line);
      // Extrae números con formato monetario (ej. 1.250,50 / 1,250.50 / 1250,50 / 450.00 / 1250)
      const matches = line.match(/(?:[\$€£]\s*)?([0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2}|[0-9]+[.,][0-9]{2}|[0-9]{2,})/g);

      if (matches) {
        matches.forEach((m) => {
          const cleanNumStr = m.replace(/[\$€£\s]/g, "");
          const num = normalizeNumber(cleanNumStr);
          if (num > 0 && num < 10000000) {
            amountCandidates.push({
              val: num,
              isTotalLine: isTotalLine,
              line: line
            });
          }
        });
      }
    });

    // Priorizar montos en líneas de TOTAL
    const totalMatches = amountCandidates.filter((c) => c.isTotalLine);
    if (totalMatches.length > 0) {
      // El total suele ser el número más grande entre las líneas etiquetadas como total
      detectedAmount = Math.max(...totalMatches.map((c) => c.val));
    } else if (amountCandidates.length > 0) {
      // Tomar los montos de la mitad inferior del ticket (donde suele estar el total)
      const lastHalf = amountCandidates.slice(Math.floor(amountCandidates.length / 2));
      const pool = lastHalf.length > 0 ? lastHalf : amountCandidates;
      detectedAmount = Math.max(...pool.map((c) => c.val));
    }

    // 3. Detección de Fecha
    let detectedDate = today();

    // Patrón 1: DD/MM/YYYY o DD-MM-YYYY
    const dmyMatch = rawText.match(/\b(0?[1-9]|[12][0-9]|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](20\d{2}|\d{2})\b/);
    if (dmyMatch) {
      let day = dmyMatch[1].padStart(2, "0");
      let month = dmyMatch[2].padStart(2, "0");
      let year = dmyMatch[3];
      if (year.length === 2) year = "20" + year;
      detectedDate = `${year}-${month}-${day}`;
    } else {
      // Patrón 2: YYYY-MM-DD
      const ymdMatch = rawText.match(/\b(20\d{2})[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12][0-9]|3[01])\b/);
      if (ymdMatch) {
        let year = ymdMatch[1];
        let month = ymdMatch[2].padStart(2, "0");
        let day = ymdMatch[3].padStart(2, "0");
        detectedDate = `${year}-${month}-${day}`;
      }
    }

    return {
      desc: detectedMerchant,
      amount: detectedAmount > 0 ? detectedAmount : "",
      date: detectedDate,
      cat: detectedCategory,
      rawText: rawText
    };
  }

  function normalizeNumber(str) {
    if (!str) return 0;
    // Si contiene punto y coma: "1.250,50" -> 1250.50 o "1,250.50" -> 1250.50
    if (str.includes(".") && str.includes(",")) {
      if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
        // Formato europeo/argentino: 1.250,50
        str = str.replace(/\./g, "").replace(",", ".");
      } else {
        // Formato anglosajón: 1,250.50
        str = str.replace(/,/g, "");
      }
    } else if (str.includes(",")) {
      // Solo coma: "1250,50" -> 1250.50
      str = str.replace(",", ".");
    }
    const val = parseFloat(str);
    return isNaN(val) ? 0 : Math.round(val * 100) / 100;
  }

  function getFallbackParsed() {
    return {
      desc: "Comprobante",
      amount: "",
      date: today(),
      cat: "Otros",
      rawText: ""
    };
  }

  // --------------------------------------------------------------------------
  // 4. Controlador de Interfaz de Usuario y Modal de Revisión
  // --------------------------------------------------------------------------
  function openScannerModal() {
    const modal = $("receipt-modal");
    if (!modal) return;
    modal.removeAttribute("hidden");
    $("receipt-loading").removeAttribute("hidden");
    $("receipt-review-form").setAttribute("hidden", "true");
  }

  function closeScannerModal() {
    const modal = $("receipt-modal");
    if (modal) modal.setAttribute("hidden", "true");
    const fileInput = $("receipt-file-input");
    if (fileInput) fileInput.value = "";
    currentParsedData = null;
    currentFilePreview = null;
  }

  function updateLoadingStatus(message) {
    const textEl = $("receipt-loading-text");
    if (textEl) textEl.textContent = message;
  }

  function showReviewForm(parsed, file) {
    $("receipt-loading").setAttribute("hidden", "true");
    const reviewForm = $("receipt-review-form");
    reviewForm.removeAttribute("hidden");

    // Llenar inputs
    $("receipt-desc").value = parsed.desc || "";
    $("receipt-amt").value = parsed.amount !== "" ? parsed.amount : "";
    $("receipt-date").value = parsed.date || today();

    // Rellenar selector de categorías si está vacío
    const catSelect = $("receipt-cat");
    if (catSelect.children.length === 0) {
      CATS.forEach(([name, _, icon]) => {
        catSelect.appendChild(new Option(`${icon} ${name}`, name));
      });
    }
    catSelect.value = parsed.cat || "Otros";

    // Checkbox de recurrente desmarcado por defecto
    $("receipt-rec").checked = false;

    // Nombre de archivo y preview
    $("receipt-file-name").textContent = file.name || "Comprobante";
    const thumb = $("receipt-preview-thumb");
    if (file.type === "application/pdf") {
      thumb.textContent = "📄";
      thumb.style.backgroundImage = "none";
    } else if (currentFilePreview) {
      thumb.textContent = "";
      thumb.style.backgroundImage = `url(${currentFilePreview})`;
    } else {
      thumb.textContent = "🧾";
      thumb.style.backgroundImage = "none";
    }

    // Texto extraído en detalles
    $("receipt-raw-text").textContent = parsed.rawText.trim() || "(No se detectó texto seleccionable)";

    currentParsedData = parsed;
    $("receipt-amt").focus();
  }

  async function handleFileSelected(file) {
    if (!file) return;

    openScannerModal();
    updateLoadingStatus("Cargando archivo...");

    // Generar vista previa en miniatura para imágenes
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        currentFilePreview = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    try {
      let rawText = "";

      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const buffer = await file.arrayBuffer();
        rawText = await extractTextFromPdf(buffer, updateLoadingStatus);
      } else if (file.type.startsWith("image/")) {
        rawText = await extractTextFromImage(file, updateLoadingStatus);
      } else {
        throw new Error("Formato no compatible. Por favor sube una imagen (PNG, JPG) o un PDF.");
      }

      updateLoadingStatus("Identificando datos y montos...");
      const parsed = parseReceipt(rawText);
      showReviewForm(parsed, file);
    } catch (err) {
      console.error("Error al procesar comprobante:", err);
      $("receipt-loading").setAttribute("hidden", "true");
      alert(
        "No se pudo leer el comprobante automáticamente: " +
          (err.message || "Error al procesar") +
          ". Puedes registrar el gasto manualmente."
      );
      closeScannerModal();
    }
  }

  function handleSaveReceiptExpense() {
    const desc = $("receipt-desc").value.trim();
    const amtStr = $("receipt-amt").value.replace(",", ".");
    const amountVal = parseFloat(amtStr);
    const dateVal = $("receipt-date").value;
    const catVal = $("receipt-cat").value;
    const isRecurring = $("receipt-rec").checked;

    if (!desc || isNaN(amountVal) || amountVal <= 0 || !dateVal) {
      alert("Por favor verifica que la descripción, importe mayor a 0 y fecha sean válidos.");
      return;
    }

    const newExpense = {
      id: uid(),
      desc: desc,
      amount: Math.round(amountVal * 100) / 100,
      cat: catVal,
      date: dateVal
    };

    State.expenses.push(newExpense);

    if (isRecurring) {
      State.recurring.push({
        id: uid(),
        desc: desc,
        amount: newExpense.amount,
        cat: newExpense.cat,
        day: Number(dateVal.slice(8)),
        from: dateVal.slice(0, 7),
        done: [dateVal.slice(0, 7)]
      });
      if (window.Spendly.Recurring) {
        window.Spendly.Recurring.apply();
      }
    }

    saveState();
    closeScannerModal();

    // Actualizar vista y mes actual en app.js
    if (typeof window.Spendly.renderAll === "function") {
      window.Spendly.renderAll(dateVal.slice(0, 7));
    }

    if (typeof window.Spendly.showToast === "function") {
      window.Spendly.showToast(
        `¡Gasto de ${formatCurrency(newExpense.amount)} añadido del comprobante!`,
        "success",
        "🧾"
      );
    }
  }

  // --------------------------------------------------------------------------
  // 5. Inicialización de Eventos del Escáner
  // --------------------------------------------------------------------------
  function initScanner() {
    const scanBtn = $("btn-scan-receipt");
    const scanBtnHeader = $("btn-scan-receipt-hero");
    const fileInput = $("receipt-file-input");
    const btnCancel = $("btn-cancel-receipt");
    const btnClose = $("btn-close-receipt-modal");
    const btnConfirm = $("btn-confirm-receipt");
    const dropzone = $("receipt-dropzone");

    // Disparar input file
    const triggerUpload = () => {
      if (fileInput) fileInput.click();
    };

    if (scanBtn) scanBtn.onclick = triggerUpload;
    if (scanBtnHeader) scanBtnHeader.onclick = triggerUpload;

    if (fileInput) {
      fileInput.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleFileSelected(file);
      };
    }

    // Soporte para Drag & Drop
    if (dropzone) {
      dropzone.onclick = triggerUpload;
      dropzone.ondragover = (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
      };
      dropzone.ondragleave = () => {
        dropzone.classList.remove("dragover");
      };
      dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) handleFileSelected(file);
      };
    }

    // Acciones de modal
    if (btnCancel) btnCancel.onclick = closeScannerModal;
    if (btnClose) btnClose.onclick = closeScannerModal;
    if (btnConfirm) btnConfirm.onclick = handleSaveReceiptExpense;

    // Cerrar al pulsar escape
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const modal = $("receipt-modal");
        if (modal && !modal.hasAttribute("hidden")) {
          closeScannerModal();
        }
      }
    });
  }

  // Exponer API del escáner
  window.Spendly = window.Spendly || {};
  window.Spendly.Scanner = {
    init: initScanner,
    parseReceipt: parseReceipt,
    handleFile: handleFileSelected
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScanner);
  } else {
    initScanner();
  }
})(window);
