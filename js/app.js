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

      chip.onclick = () => {
        selectedCategoryChip = name;
        if (catSelect) catSelect.value = name;
        container.querySelectorAll(".chip-btn").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
      };

      container.appendChild(chip);
    });
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
          State.expenses = State.expenses.filter((x) => x.id !== item.id);
          persistAndNotify();
          render();
          showToast(`Gasto "${item.desc}" eliminado`, "info", "🗑️");
        }
      };

      rightDiv.appendChild(amtEl);
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
    const catInput = $("cat");
    const recCheckbox = $("rec");
    const errBox = $("err");

    const desc = descInput.value.trim();
    const amountVal = parseFloat(amtInput.value.replace(",", "."));
    const dateVal = dateInput.value;
    const catVal = selectedCategoryChip || catInput.value;

    if (!desc || isNaN(amountVal) || amountVal <= 0 || !dateVal) {
      errBox.textContent = "⚠️ Completa la descripción, un importe mayor a 0 y una fecha válida.";
      return;
    }

    errBox.textContent = "";

    const newExpense = {
      id: uid(),
      desc: desc,
      amount: Math.round(amountVal * 100) / 100,
      cat: catVal,
      date: dateVal
    };

    State.expenses.push(newExpense);

    if (recCheckbox.checked) {
      State.recurring.push({
        id: uid(),
        desc: desc,
        amount: newExpense.amount,
        cat: newExpense.cat,
        day: Number(dateVal.slice(8)),
        from: dateVal.slice(0, 7),
        done: [dateVal.slice(0, 7)]
      });
      recCheckbox.checked = false;
      Recurring.apply();
    }

    currentMonth = dateVal.slice(0, 7);

    descInput.value = "";
    amtInput.value = "";
    descInput.focus();

    persistAndNotify();
    render();
    showToast(`¡Gasto de ${formatCurrency(newExpense.amount)} añadido!`, "success", "🎉");
  }

  // --------------------------------------------------------------------------
  // Inicialización de la Aplicación
  // --------------------------------------------------------------------------
  function init() {
    initTheme();
    initTabs();
    loadState();

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
      exportMonthCsv(currentMonth);
      showToast("Descargando CSV de movimientos...", "info", "📥");
    };

    $("csvevo").onclick = () => {
      const months = Chart.getLastMonths(evolutionRange);
      exportEvolutionCsv(months);
      showToast("Descargando CSV de evolución...", "info", "📥");
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
      exportBackup();
      showToast("Copia de seguridad descargada", "success", "💾");
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

        const validExpenses = imported.expenses.filter(
          (x) =>
            x &&
            typeof x.date === "string" &&
            typeof x.desc === "string" &&
            !isNaN(Number(x.amount))
        );

        const ok = window.confirm(
          `Esto reemplazará los datos actuales por los del archivo (${validExpenses.length} movimientos). ¿Continuar?`
        );
        if (!ok) return;

        State.expenses = validExpenses;
        State.budget = Number(imported.budget) || 0;
        State.currency = imported.currency || detectDefaultCurrency();
        State.recurring = Array.isArray(imported.recurring) ? imported.recurring : [];
        State.dismissed = Array.isArray(imported.dismissed) ? imported.dismissed : [];

        persistAndNotify();
        $("budget").value = State.budget > 0 ? State.budget : "";
        $("cur").value = State.currency;
        render();
        showToast("¡Respaldo restaurado con éxito!", "success", "✨");
      } catch (err) {
        alert("No se pudo leer el archivo. Asegúrate de que sea un respaldo JSON de Spendly.");
      }
    };

    if (Recurring.apply()) {
      saveState();
    }

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }

    const statusEl = $("status");
    if (statusEl) statusEl.textContent = "Tus datos se guardan en este dispositivo";

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
