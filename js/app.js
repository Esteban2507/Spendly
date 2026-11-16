/**
 * ============================================================================
 * Spendly - Controlador Principal de la Aplicación (UI y Eventos)
 * Entorno dinámico, pestañas interactivas, notificaciones toast y chips de categorías
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
    ymOf,
    today,
    shiftMonth,
    sumExpenses,
    formatCurrency,
    loadState,
    persistChangeAsync,
    replaceStateAsync,
    getStorageStatus,
    syncState,
    getBudget,
    setBudget,
    hasFinancialData,
    isValidDate,
    exportMonthCsv,
    exportEvolutionCsv,
    exportBackup,
    detectDefaultCurrency,
    parseAmount,
    sanitizeState,
    Recurring,
    Chart,
    Metrics
  } = window.Spendly;

  const $ = (id) => document.getElementById(id);

  function createElement(tag, className, textContent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (textContent !== undefined && textContent !== null) el.textContent = textContent;
    return el;
  }

  // Estado local de la vista
  let currentMonth = ymOf(new Date());
  let evolutionRange = 6;
  let searchTerm = "";
  let selectedCategoryChip = "Comida";
  let editingId = null; // id del gasto que se está editando (null = alta nueva)
  let editingSnapshot = null;
  const budgetDrafts = new Map();

  // --------------------------------------------------------------------------
  // Sistema de Notificaciones Toast
  // --------------------------------------------------------------------------
  function showToast(message, type = "info", icon = "✨") {
    const container = $("toast-container");
    if (!container) return;

    const toast = createElement("div", `toast toast-${type}`);
    const iconSpan = createElement("span", null, icon);
    const textSpan = createElement("span", null, message);

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px) scale(0.95)";
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // --------------------------------------------------------------------------
  // Gestión de Temas (Claro / Oscuro / Sistema)
  // --------------------------------------------------------------------------
  const THEME_KEY = "spendly-theme";

  function initTheme() {
    let savedTheme = "auto";
    try { savedTheme = localStorage.getItem(THEME_KEY) || "auto"; } catch (_) {}
    applyTheme(savedTheme);

    const themeBtn = $("theme-btn");
    if (themeBtn) {
      themeBtn.onclick = () => {
        const current = document.documentElement.getAttribute("data-theme") || "auto";
        let next = "auto";
        if (current === "auto") next = "dark";
        else if (current === "dark") next = "light";
        else next = "auto";

        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
        showToast(
          next === "dark" ? "Modo oscuro activado 🌙" : next === "light" ? "Modo claro activado ☀️" : "Tema del sistema 💻",
          "info"
        );
      };
    }
  }

  function applyTheme(theme) {
    const themeBtn = $("theme-btn");
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      if (themeBtn) themeBtn.textContent = "🌙";
    } else if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      if (themeBtn) themeBtn.textContent = "☀️";
    } else {
      document.documentElement.removeAttribute("data-theme");
      if (themeBtn) themeBtn.textContent = "💻";
    }
  }

  // --------------------------------------------------------------------------
  // Pestañas Dinámicas (Tabs)
  // --------------------------------------------------------------------------
  function initTabs() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach((btn) => {
      const name = btn.dataset.tab;
      btn.id = `nav-${name}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", `tab-${name}`);
      btn.setAttribute("aria-selected", String(btn.classList.contains("active")));
      btn.tabIndex = btn.classList.contains("active") ? 0 : -1;
      const panel = $(`tab-${name}`);
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", btn.id);
      btn.onclick = () => {
        const targetTab = btn.getAttribute("data-tab");

        tabButtons.forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
          b.tabIndex = -1;
        });
        tabContents.forEach((c) => c.classList.remove("active"));

        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        btn.tabIndex = 0;
        const activeContent = $(`tab-${targetTab}`);
        if (activeContent) {
          activeContent.classList.add("active");
        }

        render();
      };
      btn.onkeydown = (event) => {
        const buttons = Array.from(tabButtons);
        const index = buttons.indexOf(btn);
        let target;
        if (event.key === "ArrowRight") target = buttons[(index + 1) % buttons.length];
        if (event.key === "ArrowLeft") target = buttons[(index + buttons.length - 1) % buttons.length];
        if (event.key === "Home") target = buttons[0];
        if (event.key === "End") target = buttons[buttons.length - 1];
        if (target) { event.preventDefault(); target.click(); target.focus(); }
      };
    });
  }

  function switchTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }

  // --------------------------------------------------------------------------
  // Chips Visuales de Selección de Categoría
  // --------------------------------------------------------------------------
  function initCategoryChips() {
    const container = $("cat-chips");
    const catSelect = $("cat");
    if (!container) return;

    container.replaceChildren();

    CATS.forEach(([name, color, icon]) => {
      const chip = createElement("button", "chip-btn");
      chip.type = "button";
      chip.style.setProperty("--chip-color", color);
      chip.style.setProperty("--chip-bg", color + "1a");

      const iconSpan = createElement("span", "chip-icon", icon);
      const nameSpan = createElement("span", "chip-name", name);

      chip.appendChild(iconSpan);
      chip.appendChild(nameSpan);

      if (name === selectedCategoryChip) {
        chip.classList.add("active");
      }
      chip.setAttribute("aria-pressed", String(name === selectedCategoryChip));

      chip.dataset.cat = name;
      chip.onclick = () => selectCategory(name);

      container.appendChild(chip);
    });
  }

  function selectCategory(name) {
    selectedCategoryChip = name;
    const catSelect = $("cat");
    if (catSelect) catSelect.value = name;
    document.querySelectorAll("#cat-chips .chip-btn").forEach((c) => {
      c.classList.toggle("active", c.dataset.cat === name);
      c.setAttribute("aria-pressed", String(c.dataset.cat === name));
    });
  }

  // Modo edición: reutiliza el formulario de "Registrar Nuevo Gasto"
  function setEditMode(expense) {
    editingId = expense ? expense.id : null;
    editingSnapshot = expense ? JSON.stringify(expense) : null;
    $("edit-banner").hidden = !expense;
    $("edit-banner-text").textContent = expense ? `✏️ Editando «${expense.desc}»` : "";
    $("add").textContent = expense ? "💾 Guardar cambios" : "＋ Añadir Gasto";
    const recLabel = $("rec").closest("label");
    if (recLabel) recLabel.hidden = !!expense;
    $("rec").checked = false;
    $("err").textContent = "";
    if (expense) {
      $("desc").value = expense.desc;
      $("amt").value = String(expense.amount).replace(".", ",");
      $("date").value = expense.date;
      selectCategory(expense.cat);
    } else {
      $("desc").value = "";
      $("amt").value = "";
      $("date").value = today();
    }
  }

  function startEdit(expense) {
    switchTab("movements");
    setEditMode(expense);
    const formCard = $("desc").closest(".card");
    if (formCard && formCard.scrollIntoView) formCard.scrollIntoView({ block: "start" });
    $("desc").focus();
  }

  function notifyExport(result, label, feminine) {
    if (result === "cancelled") return;
    const end = feminine ? "a" : "o";
    showToast(result === "shared" ? `${label} compartid${end}` : `${label} descargad${end}`, "success", "📥");
  }

  function updateStorageStatus() {
    const status = getStorageStatus();
    $("status").textContent = status.ok ? "Guardado en este dispositivo" : "El último cambio no se guardó";
    $("storage-error").hidden = status.ok;
    $("storage-error").textContent = status.error || "";
  }

  async function persistAndNotify(mutator, options) {
    const success = await persistChangeAsync(mutator || (() => {}), options);
    updateStorageStatus();
    if (!success) showToast(getStorageStatus().error || "No se pudo guardar. Conservá los datos del formulario e intentá nuevamente.", "error", "⚠️");
    return success;
  }

  function isVisible(tab) {
    return $(`tab-${tab}`).classList.contains("active");
  }

  // --------------------------------------------------------------------------
  // Renderizado Principal
  // --------------------------------------------------------------------------
  function render() {
    const [y, mo] = currentMonth.split("-").map(Number);
    const monthDate = new Date(y, mo - 1, 1);
    const monthLabel = monthDate.toLocaleDateString("es-ES", {
      month: "long",
      year: "numeric"
    });
    $("mlabel").textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    const summary = Metrics.summarize(currentMonth);
    const { expenses: currentExpenses, total: totalSpent, budget, byCategory } = summary;
    $("hero-total").textContent = formatCurrency(totalSpent);
    const delta = $("hero-delta");
    delta.textContent = summary.comparisonPercent === null
      ? `Sin base comparable · ${summary.comparisonLabel}`
      : `${summary.comparisonPercent >= 0 ? "+" : ""}${summary.comparisonPercent} % · ${summary.comparisonLabel}`;
    delta.style.background = summary.comparisonPercent > 0 ? "rgba(239,68,68,.25)" : "rgba(255,255,255,.18)";
    const remaining = budget.total - totalSpent;
    $("hero-metric-budget").textContent = budget.total > 0
      ? `${formatCurrency(Math.abs(remaining))} ${remaining >= 0 ? "libre" : "excedido"}` : "Sin definir";
    $("hero-metric-daily").textContent = summary.dailyAverage === null ? "—" : `${formatCurrency(summary.dailyAverage)} / día`;
    const sortedCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    $("hero-metric-top").textContent = sortedCats.length
      ? `${CAT_ICONS[sortedCats[0][0]]} ${sortedCats[0][0]} (${formatCurrency(sortedCats[0][1])})` : "Ninguna aún";
    $("hero-projection").textContent = summary.projectedTotal === null ? "—" : formatCurrency(summary.projectedTotal);
    $("projection-note").textContent = summary.projectionLabel;
    $("hero-pending").textContent = formatCurrency(summary.pendingTotal);
    $("hero-available").textContent = summary.availablePerDay === null ? "—" : formatCurrency(summary.availablePerDay);
    $("available-note").textContent = !budget.total ? "Definí un presupuesto mensual" : summary.daysRemaining
      ? `${summary.daysRemaining} días; descuenta los recurrentes pendientes` : "Mes cerrado";
    const ratio = budget.total > 0 ? totalSpent / budget.total : 0;
    $("bfill").style.width = `${Math.min(100, ratio * 100)}%`;
    $("bfill").style.background = ratio > 1 ? "var(--danger)" : ratio > .8 ? "var(--warn)" : "var(--ac)";
    $("bsub").textContent = budget.total > 0
      ? `${Math.round(ratio * 100)} % consumido · ${formatCurrency(Math.abs(remaining))} ${remaining >= 0 ? "disponible" : "excedido"}`
      : "Definí un presupuesto para este mes";
    refreshBudgetFields();
    if (isVisible("summary")) {
      renderCategoryBreakdown(sortedCats, totalSpent);
      renderCategoryBudgets(byCategory, budget);
      renderPending(summary.pending);
      renderEvolutionSection();
    }
    if (isVisible("movements")) renderMovementsList(currentExpenses);
    if (isVisible("recurring")) renderRecurringSection();
    updateStorageStatus();
  }

  function renderPending(pending) {
    $("pending-card").hidden = pending.length === 0;
    $("pending-list").replaceChildren();
    pending.forEach((item) => {
      const row = createElement("div", "pending-item");
      row.append(createElement("span", null, `${item.date.slice(8)}/${item.date.slice(5, 7)} · ${item.desc}${item.ambiguous ? " · Revisar coincidencias" : ""}`), createElement("b", null, formatCurrency(item.amount)));
      $("pending-list").appendChild(row);
    });
  }

  function renderCategoryBudgets(byCategory, budget) {
    const container = $("category-budgets-summary");
    container.replaceChildren();
    Object.entries(budget.categories).forEach(([cat, limit]) => {
      if (!(limit > 0)) return;
      const spent = byCategory[cat] || 0;
      const row = createElement("div", "category-budget-row");
      row.appendChild(createElement("span", null, `${CAT_ICONS[cat]} ${cat}: ${formatCurrency(spent)} de ${formatCurrency(limit)}`));
      const progress = document.createElement("progress");
      progress.max = limit;
      progress.value = Math.min(spent, limit);
      progress.setAttribute("aria-label", `Presupuesto de ${cat}`);
      row.appendChild(progress);
      if (spent > limit) row.appendChild(createElement("span", "err", `Excedido por ${formatCurrency(spent - limit)}`));
      container.appendChild(row);
    });
  }

  function initBudgetFields() {
    CATS.forEach(([cat, , icon], index) => {
      const label = createElement("label", "budget-field", `${icon} ${cat}`);
      const input = document.createElement("input");
      input.id = `category-budget-${index}`;
      input.inputMode = "decimal";
      input.placeholder = "Sin límite";
      input.dataset.category = cat;
      input.oninput = rememberBudgetDraft;
      label.appendChild(input);
      $("category-budget-fields").appendChild(label);
    });
  }

  function refreshBudgetFields() {
    const budget = getBudget(currentMonth);
    const draft = budgetDrafts.get(currentMonth);
    $("budget-month-label").textContent = Chart.getMonthName(currentMonth);
    $("budget").value = draft ? draft.total : budget.total || "";
    document.querySelectorAll("#category-budget-fields input").forEach((input) => {
      input.value = draft ? draft.categories[input.dataset.category] || "" : budget.categories[input.dataset.category] || "";
    });
    $("cur").value = State.currency;
    $("cur").disabled = hasFinancialData();
    $("currency-note").textContent = hasFinancialData()
      ? `Todos los importes están expresados en ${State.currency}. La moneda queda fija mientras existan movimientos, reglas o presupuestos; no se realizan conversiones.`
      : "Elegí la moneda antes de registrar importes. Spendly utiliza una sola moneda y no realiza conversiones.";
  }

  function rememberBudgetDraft() {
    const previous = budgetDrafts.get(currentMonth);
    const categories = {};
    document.querySelectorAll("#category-budget-fields input").forEach((input) => { categories[input.dataset.category] = input.value; });
    budgetDrafts.set(currentMonth, { total: $("budget").value, categories,
      base: previous ? previous.base : JSON.stringify(getBudget(currentMonth)) });
  }

  async function saveBudgetForm() {
    const budgetMonth = currentMonth;
    const initialBudget = budgetDrafts.get(budgetMonth)?.base || JSON.stringify(getBudget(budgetMonth));
    const total = $("budget").value.trim() ? parseAmount($("budget").value) : 0;
    const categories = {};
    let valid = Number.isFinite(total) && total >= 0;
    document.querySelectorAll("#category-budget-fields input").forEach((input) => {
      const value = input.value.trim() ? parseAmount(input.value) : 0;
      if (!Number.isFinite(value) || value < 0) valid = false;
      if (value > 0) categories[input.dataset.category] = Math.round(value * 100) / 100;
    });
    if (!valid) { showToast("Ingresá importes válidos y mayores o iguales a cero.", "error", "⚠️"); return; }
    if (await persistAndNotify(() => {
      if (JSON.stringify(getBudget(budgetMonth)) !== initialBudget) throw new Error("El presupuesto cambió en otra pestaña. Copiá tu borrador y recargá para revisar los valores actuales.");
      setBudget(budgetMonth, Math.round(total * 100) / 100, categories);
    })) {
      budgetDrafts.delete(budgetMonth);
      render();
      showToast(`Presupuesto de ${Chart.getMonthName(budgetMonth)} guardado`, "success", "🎯");
    }
  }

  // Desglose de categorías con barras y avatares con emoji
  function renderCategoryBreakdown(sortedEntries, total) {
    const box = $("cats");
    box.replaceChildren();

    if (sortedEntries.length === 0) {
      const emptyDiv = createElement("div", "empty", "✨ No hay gastos registrados en este mes.");
      box.appendChild(emptyDiv);
      return;
    }

    sortedEntries.forEach(([catName, amount]) => {
      const row = createElement("div", "cat-item");
      const color = COL[catName] || "#888";
      const icon = CAT_ICONS[catName] || "•";

      // Icono y nombre
      const nameCol = createElement("div", "cat-name-box");
      const avatar = createElement("div", "cat-avatar", icon);
      avatar.style.backgroundColor = color + "20";
      avatar.style.color = color;
      nameCol.appendChild(avatar);
      nameCol.appendChild(document.createTextNode(catName));

      // Barra de porcentaje
      const barCol = createElement("div", "cat-progress-bar");
      const barFill = document.createElement("i");
      const pct = total > 0 ? (amount / total) * 100 : 0;
      barFill.style.width = `${pct}%`;
      barFill.style.backgroundColor = color;
      barCol.appendChild(barFill);

      // Importe y porcentaje
      const amtCol = createElement("div", "amt", formatCurrency(amount));

      row.appendChild(nameCol);
      row.appendChild(barCol);
      row.appendChild(amtCol);
      box.appendChild(row);
    });
  }

  // Lista de movimientos estilizada con tarjetas de transacciones
  function renderMovementsList(expenses) {
    const selectedCat = $("filter").value;
    const filterTerm = searchTerm.toLowerCase().trim();

    let filtered = expenses.filter((e) => {
      const matchCat = !selectedCat || e.cat === selectedCat;
      const matchSearch =
        !filterTerm ||
        (e.desc && e.desc.toLowerCase().includes(filterTerm)) ||
        (e.cat && e.cat.toLowerCase().includes(filterTerm));
      return matchCat && matchSearch;
    });

    filtered.sort((a, b) => b.date.localeCompare(a.date));

    const listContainer = $("list");
    listContainer.replaceChildren();

    if (filtered.length === 0) {
      const emptyMsg = expenses.length === 0
        ? "Aún no hay gastos registrados este mes. ¡Añade uno arriba!"
        : "No encontramos movimientos con ese criterio de búsqueda.";
      listContainer.appendChild(createElement("div", "empty", emptyMsg));
      return;
    }

    filtered.forEach((item) => {
      const row = createElement("div", "movement-item");
      const color = COL[item.cat] || "#888";
      const icon = CAT_ICONS[item.cat] || "•";

      // Izquierda: icono de categoría y texto descriptivo
      const leftDiv = createElement("div", "movement-left");

      const iconDiv = createElement("div", "movement-icon", icon);
      iconDiv.style.backgroundColor = color + "1a";

      const infoDiv = createElement("div", "movement-info");
      const descEl = createElement("div", "movement-desc", item.desc);

      const metaDiv = createElement("div", "movement-meta");
      const dateFormatted = `${item.date.slice(8)}/${item.date.slice(5, 7)}`;
      metaDiv.appendChild(document.createTextNode(dateFormatted));

      const catBadge = createElement("span", "badge-pill");
      catBadge.style.backgroundColor = color + "18";
      catBadge.style.color = "var(--tx)";
      catBadge.style.borderColor = color + "40";
      catBadge.textContent = `${icon} ${item.cat}`;
      metaDiv.appendChild(catBadge);

      if (item.rid) {
        const recBadge = createElement("span", "badge-pill", "↻ Recurrente");
        recBadge.style.backgroundColor = "var(--ac-light)";
        recBadge.style.color = "var(--ac)";
        metaDiv.appendChild(recBadge);
      }

      infoDiv.appendChild(descEl);
      infoDiv.appendChild(metaDiv);
      leftDiv.appendChild(iconDiv);
      leftDiv.appendChild(infoDiv);

      // Derecha: importe y botón de eliminar
      const rightDiv = createElement("div", "movement-right");
      const amtEl = createElement("div", "movement-amount", formatCurrency(item.amount));

      const delBtn = createElement("button", "del-btn", "🗑️");
      delBtn.title = "Eliminar este gasto";
      delBtn.setAttribute("aria-label", `Eliminar gasto ${item.desc}`);
      delBtn.onclick = async () => {
        const ok = window.confirm(
          `¿Deseas eliminar "${item.desc}" (${formatCurrency(item.amount)})?`
        );
        if (ok) {
          if (await persistAndNotify(() => {
            const target = State.expenses.find((x) => x.id === item.id);
            if (target && JSON.stringify(target) !== JSON.stringify(item)) throw new Error("El gasto cambió en otra pestaña. Revisalo antes de eliminarlo.");
            State.expenses = State.expenses.filter((x) => x.id !== item.id);
          })) {
            if (editingId === item.id) setEditMode(null);
            render();
            showToast(`Gasto "${item.desc}" eliminado`, "info", "🗑️");
          }
        }
      };

      const editBtn = createElement("button", "edit-btn", "✏️");
      editBtn.type = "button";
      editBtn.title = "Editar este gasto";
      editBtn.setAttribute("aria-label", `Editar gasto ${item.desc}`);
      editBtn.onclick = () => startEdit(item);

      rightDiv.appendChild(amtEl);
      rightDiv.appendChild(editBtn);
      rightDiv.appendChild(delBtn);

      row.appendChild(leftDiv);
      row.appendChild(rightDiv);
      listContainer.appendChild(row);
    });
  }

  // Gastos recurrentes y sugerencias
  function renderRecurringSection() {
    const sugBox = $("sug");
    const listBox = $("rlist");
    sugBox.replaceChildren();
    listBox.replaceChildren();

    const suggestions = Recurring.detect();

    suggestions.forEach((sug) => {
      const row = createElement("div", "sg");
      const icon = CAT_ICONS[sug.cat] || "•";
      const msg = createElement(
        "div",
        null,
        `💡 ¿"${sug.desc}" (${icon} ${sug.cat}) es un gasto mensual fijo? Ha ocurrido ${sug.months} meses seguidos, aprox. ${formatCurrency(
          sug.amount
        )} hacia el día ${sug.day}.`
      );

      const actions = createElement("div", "row");
      const btnYes = createElement("button", "pri", "Sí, repetir cada mes");
      const btnNo = createElement("button", null, "Descartar");

      btnYes.onclick = async () => {
        if (btnYes.disabled) return;
        btnYes.disabled = true;
        let recurringResult;
        try { if (await persistAndNotify(() => {
          const key = window.Spendly.normalizeText(sug.desc);
          if (State.recurring.some((rule) => window.Spendly.normalizeText(rule.desc) === key)) throw new Error("Este gasto ya tiene una regla recurrente. Revisá la lista actualizada.");
          State.recurring.push({ id: uid(), desc: sug.desc, amount: sug.amount, cat: sug.cat,
            day: sug.day, from: ymOf(new Date()), done: [] });
          recurringResult = Recurring.apply();
        }, { refresh: true })) {
          render();
          showToast(`"${sug.desc}" añadido a gastos recurrentes`, "success", "🔄");
          notifyRecurringAmbiguity(recurringResult);
        } } finally { btnYes.disabled = false; }
      };

      btnNo.onclick = async () => {
        if (await persistAndNotify(() => State.dismissed.push(sug.key))) {
          render();
          showToast("Sugerencia descartada", "info", "👍");
        }
      };

      actions.appendChild(btnYes);
      actions.appendChild(btnNo);
      row.appendChild(msg);
      row.appendChild(actions);
      sugBox.appendChild(row);
    });

    State.recurring.forEach((rule) => {
      const row = createElement("div", "rr");
      const icon = CAT_ICONS[rule.cat] || "•";
      const info = createElement("div", "g");
      info.appendChild(createElement("div", "t", `${icon} ${rule.desc}`));
      info.appendChild(
        createElement("div", "sub", `Día ${rule.day} de cada mes · ${rule.cat}`)
      );

      const amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.min = "0";
      amountInput.step = "0.01";
      amountInput.value = rule.amount;
      amountInput.style.width = "105px";
      amountInput.setAttribute("aria-label", `Importe mensual de ${rule.desc}`);

      amountInput.onchange = async () => {
        const val = parseAmount(amountInput.value);
        if (Number.isFinite(val) && Math.round(val * 100) > 0) {
          if (await persistAndNotify(() => {
            const current = State.recurring.find((r) => r.id === rule.id);
            if (current) current.amount = Math.round(val * 100) / 100;
          })) {
            render();
            showToast(`Importe de "${rule.desc}" actualizado`, "success");
          } else amountInput.value = rule.amount;
        } else {
          amountInput.value = rule.amount;
        }
      };

      const cancelBtn = createElement("button", null, "Dejar de repetir");
      cancelBtn.onclick = async () => {
        if (await persistAndNotify(() => { State.recurring = State.recurring.filter((r) => r.id !== rule.id); })) {
          render();
          showToast(`Se canceló la regla recurrente de "${rule.desc}"`, "info");
        }
      };

      row.appendChild(info);
      row.appendChild(amountInput);
      row.appendChild(cancelBtn);
      listBox.appendChild(row);
    });

    if (suggestions.length === 0 && State.recurring.length === 0) {
      listBox.appendChild(
        createElement(
          "div",
          "empty",
          "🌟 No tienes gastos recurrentes activos. Marca «Repetir cada mes» al registrar un gasto (como alquiler o internet) para automatizarlo."
        )
      );
    }
  }

  // Gráfico de evolución
  function renderEvolutionSection() {
    if (!isVisible("summary")) return;
    Chart.render({
      chartContainer: $("evo"),
      statsContainer: $("evostats"),
      legendContainer: $("evoleg"),
      movementContainer: $("evomove"),
      rangeMonths: evolutionRange,
      currentSelectedMonth: currentMonth,
      onSelectMonth: (selectedMonth) => {
        currentMonth = selectedMonth;
        render();
        showToast(`Viendo datos de ${Chart.getMonthName(selectedMonth)}`, "info", "📅");
      }
    });
  }

  // --------------------------------------------------------------------------
  // Agregar Nuevo Gasto
  // --------------------------------------------------------------------------
  async function handleAddExpense() {
    const button = $("add");
    if (button.disabled) return;
    const desc = $("desc").value.trim();
    const amountVal = parseAmount($("amt").value);
    const dateVal = $("date").value;
    const catVal = selectedCategoryChip;
    if (!desc || !Number.isFinite(amountVal) || Math.round(amountVal * 100) <= 0 || !isValidDate(dateVal)) {
      $("err").textContent = "Completá la descripción, un importe mayor a cero y una fecha válida.";
      return;
    }
    const amount = Math.round(amountVal * 100) / 100;
    const editing = editingId;
    const originalExpense = editingSnapshot;
    const repeat = $("rec").checked && !editing;
    let result = { added: 0 };
    button.disabled = true;
    try {
      const success = await persistAndNotify(() => {
        if (editing) {
          const target = State.expenses.find((item) => item.id === editing);
          if (!target) throw new Error("El gasto ya no existe. Revisá los movimientos antes de editar.");
          if (JSON.stringify(target) !== originalExpense) throw new Error("El gasto cambió en otra pestaña. Tus datos siguen en el formulario; revisá el movimiento antes de guardar.");
          Object.assign(target, { desc, amount, cat: catVal, date: dateVal });
          // Cambiar comercio, fecha o importe requiere volver a verificar un posible duplicado.
          delete target.receiptFingerprint;
        } else {
          const id = uid();
          const expense = { id, desc, amount, cat: catVal, date: dateVal };
          State.expenses.push(expense);
          if (repeat) {
            const month = dateVal.slice(0, 7);
            const nowMonth = ymOf(new Date());
            const start = month > nowMonth ? month : nowMonth;
            const rid = uid();
            if (month === start) expense.rid = rid;
            State.recurring.push({ id: rid, desc, amount, cat: catVal, day: Number(dateVal.slice(8)), from: start, done: month === start ? [month] : [] });
            result = Recurring.apply();
          }
        }
      });
      if (!success) return;
      setEditMode(null);
      currentMonth = dateVal.slice(0, 7);
      render();
      $("desc").focus();
      showToast(editing ? `Gasto «${desc}» actualizado` : `Gasto de ${formatCurrency(amount)} guardado${repeat ? "; repetición mensual activada" : ""}`, "success", editing ? "✏️" : "🎉");
      notifyRecurringAmbiguity(result);
    } finally { button.disabled = false; }
  }

  function notifyRecurringAmbiguity(result) {
    if (result.ambiguous && result.ambiguous.length) showToast("Hay recurrentes con varias coincidencias manuales. Revisá los pendientes antes de registrarlos.", "info", "⚠️");
  }

  async function initOfflineReader() {
    const button = $("prepare-offline");
    const status = $("offline-status");
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
      button.disabled = true;
      status.textContent = "Abrí Spendly mediante HTTPS o localhost para preparar el lector.";
      return;
    }
    let registration;
    function request(type) {
      return new Promise((resolve, reject) => {
        const worker = registration.active || navigator.serviceWorker.controller;
        if (!worker) { reject(new Error("El lector todavía se está preparando. Recargá la aplicación e intentá nuevamente.")); return; }
        const channel = new MessageChannel();
        let timer;
        function finish(error, result) {
          clearTimeout(timer);
          channel.port1.close();
          if (error) reject(error); else resolve(result);
        }
        const resetTimeout = () => {
          clearTimeout(timer);
          timer = setTimeout(() => finish(new Error("No hubo respuesta. Cerrá las otras pestañas de Spendly y volvé a abrir la aplicación.")), type === "SCANNER_OFFLINE_STATUS" ? 7000 : 90000);
        };
        channel.port1.onmessage = ({ data }) => {
          if (data.type === "SCANNER_OFFLINE_PROGRESS") {
            status.textContent = `Descargando lector: ${data.cached} de ${data.total} componentes…`;
            resetTimeout();
          } else if (data.type === "SCANNER_OFFLINE_ERROR") finish(new Error(data.error || "No se pudo descargar el lector."));
          else finish(null, data);
        };
        resetTimeout();
        worker.postMessage({ type }, [channel.port2]);
      });
    }
    try {
      registration = await navigator.serviceWorker.register("./sw.js");
      if (!registration.active) await navigator.serviceWorker.ready;
      const result = await request("SCANNER_OFFLINE_STATUS");
      status.textContent = result.ready ? "Lector preparado para este dispositivo, incluso sin conexión." : "El lector requiere descargar sus componentes (aprox. 15 MB).";
      button.disabled = !!result.ready;
      if (registration.waiting) status.textContent += " Hay una actualización: cerrá todas las pestañas de Spendly y abrila nuevamente.";
    } catch (error) { status.textContent = error.message || "No se pudo preparar el funcionamiento sin conexión."; }
    button.onclick = async () => {
      if (!registration) { status.textContent = "Recargá Spendly con conexión e intentá nuevamente."; return; }
      button.disabled = true;
      status.textContent = "Descargando componentes del lector…";
      try {
        const result = await request("PREPARE_SCANNER_OFFLINE");
        if (!result.ready) throw new Error("La descarga no se completó. Intentá nuevamente con conexión.");
        status.textContent = "Lector preparado para este dispositivo, incluso sin conexión.";
        showToast("Lector preparado sin conexión", "success", "📴");
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    };
  }

  // --------------------------------------------------------------------------
  // Inicialización de la Aplicación
  // --------------------------------------------------------------------------
  async function init() {
    initTheme();
    initTabs();
    const loadInfo = loadState();

    // Rellenar selectores de categoría
    const catSelect = $("cat");
    const filterSelect = $("filter");

    catSelect.replaceChildren();
    CATS.forEach(([catName, _, icon]) => {
      catSelect.appendChild(new Option(`${icon} ${catName}`, catName));
    });

    filterSelect.replaceChildren();
    filterSelect.appendChild(new Option("Todas las categorías", ""));
    CATS.forEach(([catName, _, icon]) => {
      filterSelect.appendChild(new Option(`${icon} ${catName}`, catName));
    });

    initCategoryChips();
    initBudgetFields();
    $("cat").onchange = () => selectCategory($("cat").value);

    $("date").value = today();
    refreshBudgetFields();
    $("cur").value = State.currency || detectDefaultCurrency();

    // Navegación de mes
    $("prev").onclick = () => {
      currentMonth = shiftMonth(currentMonth, -1);
      render();
    };

    $("next").onclick = () => {
      currentMonth = shiftMonth(currentMonth, 1);
      render();
    };

    // Añadir gasto
    $("add").onclick = handleAddExpense;
    $("cancel-edit").onclick = () => setEditMode(null);
    ["desc", "amt", "date"].forEach((id) => {
      $(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAddExpense();
      });
    });

    // Filtros
    filterSelect.onchange = () => renderMovementsList(State.expenses.filter((item) => item.date.startsWith(currentMonth)));

    const searchInput = $("search");
    if (searchInput) {
      searchInput.oninput = (e) => {
        searchTerm = e.target.value;
        renderMovementsList(State.expenses.filter((x) => x.date.startsWith(currentMonth)));
      };
    }

    // Presupuesto independiente por mes y moneda única de registro.
    $("save-budget").onclick = saveBudgetForm;
    $("budget").oninput = rememberBudgetDraft;
    $("copy-budget").onclick = () => {
      const previous = getBudget(shiftMonth(currentMonth, -1));
      $("budget").value = previous.total || "";
      document.querySelectorAll("#category-budget-fields input").forEach((input) => {
        input.value = previous.categories[input.dataset.category] || "";
      });
      rememberBudgetDraft();
      showToast("Presupuesto anterior copiado al formulario. Guardalo para aplicarlo a este mes.", "info", "📋");
    };
    $("cur").onchange = async () => {
      const currency = $("cur").value;
      if (hasFinancialData()) { refreshBudgetFields(); return; }
      if (await persistAndNotify(() => { State.currency = currency; })) {
        render();
        showToast(`Moneda de registro: ${State.currency}`, "info", "💱");
      }
    };

    // Exportaciones CSV
    $("csv").onclick = () => {
      exportMonthCsv(currentMonth).then((r) => notifyExport(r, "CSV de movimientos"));
    };

    $("csvevo").onclick = () => {
      const months = Chart.getLastMonths(evolutionRange, currentMonth);
      exportEvolutionCsv(months).then((r) => notifyExport(r, "CSV de evolución"));
    };

    // Rango de gráfico
    $("range").onchange = () => {
      evolutionRange = Number($("range").value) || 6;
      renderEvolutionSection();
    };

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderEvolutionSection, 150);
    });

    // Respaldos
    $("bk").onclick = () => {
      exportBackup().then((r) => notifyExport(r, "Copia de seguridad", true));
    };

    $("rs").onclick = () => $("rsfile").click();

    $("rsfile").onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;

      try {
        const text = await file.text();
        const imported = JSON.parse(text);

        if (!imported || !Array.isArray(imported.expenses)) {
          throw new Error("Formato inválido");
        }

        const clean = sanitizeState(imported);
        const skipped = clean.dropped > 0 ? `; se omitirán ${clean.dropped} registros dañados` : "";
        const ok = window.confirm(
          `Esto reemplazará los datos actuales por los del archivo (${clean.expenses.length} movimientos${skipped}). ¿Continuar?`
        );
        if (!ok) return;

        const restored = await replaceStateAsync(clean);
        updateStorageStatus();
        if (!restored) { showToast(getStorageStatus().error, "error", "⚠️"); return; }
        budgetDrafts.clear();
        setEditMode(null);
        refreshBudgetFields();
        $("cur").value = State.currency;
        render();
        showToast("¡Respaldo restaurado con éxito!", "success", "✨");
      } catch (err) {
        alert("No se pudo leer el archivo. Asegúrate de que sea un respaldo JSON de Spendly.");
      }
    };

    let recurringResult = { added: 0 };
    if (!loadInfo.error) {
      const due = Recurring.getPending(ymOf(new Date())).some((item) => item.date <= today());
      if (due) await persistAndNotify(() => { recurringResult = Recurring.apply(); });
    }

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    initOfflineReader();
    window.addEventListener("storage", (event) => {
      if (event.key !== window.Spendly.STORAGE_KEY && event.key !== null) return;
      const result = syncState();
      updateStorageStatus();
      if (result.changed) { render(); showToast("Datos actualizados desde otra pestaña", "info", "🔄"); }
      if (result.conflict) showToast(getStorageStatus().error, "error", "⚠️");
    });
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible") return;
      const synced = syncState();
      if (!synced.error && !synced.conflict && Recurring.getPending(ymOf(new Date())).some((item) => item.date <= today())) {
        let result;
        if (await persistAndNotify(() => { result = Recurring.apply(); })) notifyRecurringAmbiguity(result);
      }
      render();
    });

    render();

    notifyRecurringAmbiguity(recurringResult);
    if (loadInfo.error) showToast(loadInfo.error, "error", "⚠️");
    if (loadInfo.dropped > 0) {
      const n = loadInfo.dropped;
      showToast(
        n === 1 ? "Se omitió 1 registro dañado al cargar tus datos" : `Se omitieron ${n} registros dañados al cargar tus datos`,
        "info",
        "⚠️"
      );
    }
    if (recurringResult.added > 0) {
      const n = recurringResult.added;
      showToast(
        n === 1 ? "Se añadió 1 gasto recurrente de este mes" : `Se añadieron ${n} gastos recurrentes de este mes`,
        "info",
        "🔄"
      );
    }
  }

  // Exponer utilidades para otros módulos (como el escáner)
  window.Spendly = window.Spendly || {};
  window.Spendly.showToast = showToast;
  window.Spendly.renderAll = (targetMonth) => {
    if (targetMonth) currentMonth = targetMonth;
    render();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);

