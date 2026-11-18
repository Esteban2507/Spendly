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
    saveState,
    exportMonthCsv,
    exportEvolutionCsv,
    exportBackup,
    detectDefaultCurrency,
    parseAmount,
    sanitizeState,
    applyState,
    Recurring,
    Chart
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
    const savedTheme = localStorage.getItem(THEME_KEY) || "auto";
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
        localStorage.setItem(THEME_KEY, next);
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
      btn.onclick = () => {
        const targetTab = btn.getAttribute("data-tab");

        tabButtons.forEach((b) => b.classList.remove("active"));
        tabContents.forEach((c) => c.classList.remove("active"));

        btn.classList.add("active");
        const activeContent = $(`tab-${targetTab}`);
        if (activeContent) {
          activeContent.classList.add("active");
        }

        // Si se cambia a la pestaña del gráfico de evolución, redibujar para tamaño correcto
        if (targetTab === "summary") {
          setTimeout(renderEvolutionSection, 50);
        }
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
    });
  }

  // Modo edición: reutiliza el formulario de "Registrar Nuevo Gasto"
  function setEditMode(expense) {
    editingId = expense ? expense.id : null;
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

  function persistAndNotify() {
    const success = saveState();
    const statusEl = $("status");
    if (statusEl) {
      statusEl.textContent = success
        ? "Guardado en este dispositivo"
        : "No se pudo guardar localmente";
    }
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

    // Gastos del mes seleccionado
    const currentExpenses = State.expenses.filter((e) => e.date.startsWith(currentMonth));
    const totalSpent = sumExpenses(currentExpenses);

    // Comparación con el mes anterior
    const prevMonthStr = shiftMonth(currentMonth, -1);
    const prevExpenses = State.expenses.filter((e) => e.date.startsWith(prevMonthStr));
    const prevTotal = sumExpenses(prevExpenses);

    // 1. Tarjeta Hero Resumen Dinámica
    $("hero-total").textContent = formatCurrency(totalSpent);

    const heroDelta = $("hero-delta");
    if (prevTotal > 0) {
      const p = Math.round(((totalSpent - prevTotal) / prevTotal) * 100);
      heroDelta.textContent = `${p >= 0 ? "+" : ""}${p} % frente al mes anterior`;
      heroDelta.style.background = p > 0 ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.25)";
    } else {
      heroDelta.textContent = "Sin datos de mes anterior";
      heroDelta.style.background = "rgba(255, 255, 255, 0.18)";
    }

    // Cálculo de métricas secundarias para el Hero
    const budgetVal = Number(State.budget) || 0;
    const remainingBudget = budgetVal - totalSpent;

    const heroBudgetVal = $("hero-metric-budget");
    if (heroBudgetVal) {
      if (budgetVal > 0) {
        heroBudgetVal.textContent =
          remainingBudget >= 0
            ? `${formatCurrency(remainingBudget)} libre`
            : `${formatCurrency(Math.abs(remainingBudget))} excedido ⚠️`;
      } else {
        heroBudgetVal.textContent = "Sin definir";
      }
    }

    // Promedio diario del mes actual
    const now = new Date();
    const isCurrentCalendarMonth = ymOf(now) === currentMonth;
    const daysCount = isCurrentCalendarMonth
      ? Math.max(1, now.getDate())
      : new Date(y, mo, 0).getDate();
    const dailyAverage = totalSpent / daysCount;

    const heroDailyVal = $("hero-metric-daily");
    if (heroDailyVal) {
      heroDailyVal.textContent = `${formatCurrency(dailyAverage)} / día`;
    }

    // Categoría top del mes
    const byCategory = {};
    currentExpenses.forEach((e) => {
      byCategory[e.cat] = (byCategory[e.cat] || 0) + Number(e.amount);
    });
    const sortedCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    const topCatEl = $("hero-metric-top");
    if (topCatEl) {
      if (sortedCats.length > 0) {
        const [topName, topAmt] = sortedCats[0];
        topCatEl.textContent = `${CAT_ICONS[topName] || "•"} ${topName} (${formatCurrency(topAmt)})`;
      } else {
        topCatEl.textContent = "Ninguna aún";
      }
    }

    // 2. Barra de Presupuesto en Ajustes/Resumen
    const bFill = $("bfill");
    const bSub = $("bsub");
    if (budgetVal > 0) {
      const ratio = totalSpent / budgetVal;
      bFill.style.width = Math.min(100, ratio * 100) + "%";
      bFill.style.background =
        ratio > 1
          ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
          : ratio > 0.8
          ? "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
          : "linear-gradient(135deg, #10b981 0%, #0d9488 100%)";

      if (ratio > 1) {
        bSub.textContent = `🚨 Te has excedido por ${formatCurrency(totalSpent - budgetVal)}`;
        bSub.style.color = "var(--danger)";
      } else {
        const usedPercent = Math.round(ratio * 100);
        bSub.textContent = `✅ Te quedan ${formatCurrency(remainingBudget)} (${usedPercent} % consumido)`;
        bSub.style.color = "var(--mut)";
      }
    } else {
      bFill.style.width = "0%";
      bSub.textContent = "Define un presupuesto para medir tu progreso mensual";
      bSub.style.color = "var(--mut)";
    }

    // 3. Renderizar componentes de vistas
    renderCategoryBreakdown(sortedCats, totalSpent);
    renderMovementsList(currentExpenses);
    renderRecurringSection();
    renderEvolutionSection();
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
      delBtn.onclick = () => {
        const ok = window.confirm(
          `¿Deseas eliminar "${item.desc}" (${formatCurrency(item.amount)})?`
        );
        if (ok) {
          if (editingId === item.id) setEditMode(null);
          State.expenses = State.expenses.filter((x) => x.id !== item.id);
          persistAndNotify();
          render();
          showToast(`Gasto "${item.desc}" eliminado`, "info", "🗑️");
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

      btnYes.onclick = () => {
        State.recurring.push({
          id: uid(),
          desc: sug.desc,
          amount: sug.amount,
          cat: sug.cat,
          day: sug.day,
          from: ymOf(new Date()),
          done: []
        });
        Recurring.apply();
        persistAndNotify();
        render();
        showToast(`"${sug.desc}" añadido a gastos recurrentes`, "success", "🔄");
      };

      btnNo.onclick = () => {
        State.dismissed.push(sug.key);
        persistAndNotify();
        render();
        showToast("Sugerencia descartada", "info", "👍");
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

      amountInput.onchange = () => {
        const val = parseFloat(amountInput.value);
        if (val > 0) {
          rule.amount = Math.round(val * 100) / 100;
          persistAndNotify();
          showToast(`Importe de "${rule.desc}" actualizado`, "success");
        } else {
          amountInput.value = rule.amount;
        }
      };

      const cancelBtn = createElement("button", null, "Dejar de repetir");
      cancelBtn.onclick = () => {
        State.recurring = State.recurring.filter((r) => r.id !== rule.id);
        persistAndNotify();
        render();
        showToast(`Se canceló la regla recurrente de "${rule.desc}"`, "info");
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
  function handleAddExpense() {
    const descInput = $("desc");
    const amtInput = $("amt");
    const dateInput = $("date");
    const recCheckbox = $("rec");
    const errBox = $("err");

    const desc = descInput.value.trim();
    const amountVal = parseAmount(amtInput.value);
    const dateVal = dateInput.value;
    const catVal = selectedCategoryChip || $("cat").value;

    if (!desc || !(amountVal > 0) || !dateVal) {
      errBox.textContent = "⚠️ Completa la descripción, un importe mayor a 0 y una fecha válida.";
      return;
    }

    errBox.textContent = "";
    const amount = Math.round(amountVal * 100) / 100;

    // --- Edición de un gasto existente ---
    if (editingId) {
      const target = State.expenses.find((x) => x.id === editingId);
      if (target) Object.assign(target, { desc, amount, cat: catVal, date: dateVal });
      setEditMode(null);
      currentMonth = dateVal.slice(0, 7);
      persistAndNotify();
      render();
      showToast(`Gasto «${desc}» actualizado`, "success", "✏️");
      return;
    }

    // --- Alta nueva ---
    State.expenses.push({ id: uid(), desc, amount, cat: catVal, date: dateVal });

    let recurringNote = "";
    if (recCheckbox.checked) {
      // La regla empieza este mes (o el mes del gasto si es futuro): nunca rellena meses pasados.
      const expMonth = dateVal.slice(0, 7);
      const nowMonth = ymOf(new Date());
      const startMonth = expMonth > nowMonth ? expMonth : nowMonth;
      State.recurring.push({
        id: uid(),
        desc,
        amount,
        cat: catVal,
        day: Number(dateVal.slice(8)),
        from: startMonth,
        done: expMonth === startMonth ? [expMonth] : []
      });
      recCheckbox.checked = false;
      const res = Recurring.apply();
      recurringNote =
        expMonth < nowMonth
          ? ` Se repetirá cada mes desde ${Chart.getMonthName(startMonth).toLowerCase()}.`
          : " Se repetirá cada mes.";
      if (res.added > 0) recurringNote += " Ya se añadió el de este mes.";
    }

    currentMonth = dateVal.slice(0, 7);

    descInput.value = "";
    amtInput.value = "";
    descInput.focus();

    persistAndNotify();
    render();
    showToast(`¡Gasto de ${formatCurrency(amount)} añadido!${recurringNote}`, "success", "🎉");
  }

  // --------------------------------------------------------------------------
  // Inicialización de la Aplicación
  // --------------------------------------------------------------------------
  function init() {
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

    $("date").value = today();
    $("budget").value = State.budget > 0 ? State.budget : "";
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
    filterSelect.onchange = render;

    const searchInput = $("search");
    if (searchInput) {
      searchInput.oninput = (e) => {
        searchTerm = e.target.value;
        renderMovementsList(State.expenses.filter((x) => x.date.startsWith(currentMonth)));
      };
    }

    // Presupuesto y moneda
    $("budget").onchange = () => {
      State.budget = Math.max(0, parseFloat($("budget").value) || 0);
      persistAndNotify();
      render();
      showToast("Presupuesto mensual actualizado", "success", "🎯");
    };

    $("cur").onchange = () => {
      State.currency = $("cur").value;
      persistAndNotify();
      render();
      showToast(`Divisa cambiada a ${State.currency}`, "info", "💱");
    };

    // Exportaciones CSV
    $("csv").onclick = () => {
      exportMonthCsv(currentMonth).then((r) => notifyExport(r, "CSV de movimientos"));
    };

    $("csvevo").onclick = () => {
      const months = Chart.getLastMonths(evolutionRange);
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

        setEditMode(null);
        applyState(clean);

        persistAndNotify();
        $("budget").value = State.budget > 0 ? State.budget : "";
        $("cur").value = State.currency;
        render();
        showToast("¡Respaldo restaurado con éxito!", "success", "✨");
      } catch (err) {
        alert("No se pudo leer el archivo. Asegúrate de que sea un respaldo JSON de Spendly.");
      }
    };

    const recurringResult = Recurring.apply();
    if (recurringResult.changed) saveState();

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }

    render();

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

    // ── Inicializar autenticación y sincronización en la nube ──────────────────
    initAuthFlow();
  }

  // ─── Lógica de autenticación + sync cloud ────────────────────────────────────
  function initAuthFlow() {
    const Auth  = window.Spendly && window.Spendly.Auth;
    const Cloud = window.Spendly && window.Spendly.Cloud;

    // Si Firebase no está configurado (config sin reemplazar), salir silenciosamente
    if (!Auth || !Cloud) return;

    // Inicializar Firebase
    Auth.init();
    Cloud.init();

    // Botones de login/logout en header y settings
    const btnLogin  = $("btn-auth-login");
    const btnLogout = $("btn-auth-logout");

    function doLogin() {
      Auth.signIn().catch((err) => {
        if (err.code !== "auth/popup-closed-by-user") {
          showToast("Error al iniciar sesión. Inténtalo de nuevo.", "error", "⚠️");
        }
      });
    }

    function doLogout() {
      const user = Auth.currentUser();
      const promise = user ? Cloud.saveNow(user.uid, window.Spendly.State) : Promise.resolve();
      promise.finally(() => {
        Auth.signOut().then(() => {
          showToast("Sesión cerrada correctamente.", "info", "👋");
        });
      });
    }

    if (btnLogin)  btnLogin.addEventListener("click", doLogin);
    if (btnLogout) btnLogout.addEventListener("click", doLogout);

    // Botones duplicados en la pestaña Ajustes
    const btnLoginSettings  = $("btn-auth-login-settings");
    const btnLogoutSettings = $("btn-auth-logout-settings");
    if (btnLoginSettings)  btnLoginSettings.addEventListener("click", doLogin);
    if (btnLogoutSettings) btnLogoutSettings.addEventListener("click", doLogout);

    // Escuchar cambios de sesión
    Auth.onAuthChange((user) => {
      updateAuthUI(user);

      if (user) {
        // Usuario acaba de iniciar sesión → cargar datos de la nube y hacer merge
        showToast(`Bienvenido, ${user.displayName || user.email} 👋`, "success", "☁️");

        Cloud.loadFromCloud(user.uid).then((cloudState) => {
          if (cloudState) {
            const merged = Cloud.mergeStates(window.Spendly.State, cloudState);
            if (merged) {
              window.Spendly.applyState({ state: merged, dropped: 0 });
              saveState();
              render();
              showToast("Datos sincronizados desde la nube ✓", "success", "☁️");
            }
          } else {
            // No hay datos en la nube → subir los datos locales
            Cloud.scheduleSave(user.uid, window.Spendly.State);
          }
        });
      }
    });
  }

  /** Actualiza la UI del header según el estado de sesión */
  function updateAuthUI(user) {
    // ── Header ────────────────────────────────────────────────────────────────
    const avatarEl    = $("auth-user-avatar");
    const nameEl      = $("auth-user-name");
    const loggedInEl  = $("auth-logged-in");
    const loggedOutEl = $("auth-logged-out");

    if (loggedInEl)  loggedInEl.hidden  = !user;
    if (loggedOutEl) loggedOutEl.hidden  = !!user;

    if (user) {
      if (avatarEl) {
        if (user.photoURL) {
          avatarEl.src   = user.photoURL;
          avatarEl.style.display = "";
        } else {
          avatarEl.style.display = "none";
        }
      }
      if (nameEl) nameEl.textContent = user.displayName || user.email || "Usuario";
    }

    // ── Pestaña Ajustes ───────────────────────────────────────────────────────
    const settingsIn  = $("settings-logged-in");
    const settingsOut = $("settings-logged-out");

    if (settingsIn)  settingsIn.hidden  = !user;
    if (settingsOut) settingsOut.hidden  = !!user;

    if (user) {
      const settingsAvatar = $("settings-user-avatar");
      const settingsName   = $("settings-user-name");
      const settingsEmail  = $("settings-user-email");

      if (settingsAvatar) {
        settingsAvatar.src = user.photoURL || "";
        settingsAvatar.style.display = user.photoURL ? "" : "none";
      }
      if (settingsName)  settingsName.textContent  = user.displayName || "Usuario";
      if (settingsEmail) settingsEmail.textContent  = user.email || "";
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
