/**
 * ============================================================================
 * Spendly - Motor de Visualización y Gráfico de Evolución (SVG)
 * Gráficos con colores vivos, iconos en leyendas y animaciones
 * ============================================================================
 */

(function (window) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const {
    CATS,
    CAT_ICONS,
    State,
    ymOf,
    shiftMonth,
    formatCurrency,
    getBudget,
    Metrics,
    LOCALE
  } = window.Spendly;

  function createSvgElement(tag, attrs = {}, parent = null, textContent = null) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    if (textContent !== null) {
      el.textContent = textContent;
    }
    if (parent) {
      parent.appendChild(el);
    }
    return el;
  }

  function getMonthName(monthStr) {
    const [y, mo] = monthStr.split("-").map(Number);
    const date = new Date(y, mo - 1, 1);
    const name = date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function getLastMonths(count, endMonth = ymOf(new Date())) {
    const current = endMonth;
    const list = [];
    for (let i = count - 1; i >= 0; i--) {
      list.push(shiftMonth(current, -i));
    }
    return list;
  }

  /**
   * Renderiza el gráfico de barras apiladas SVG con estética moderna
   */
  function renderEvolution(options) {
    const {
      chartContainer,
      statsContainer,
      legendContainer,
      movementContainer,
      rangeMonths = 6,
      currentSelectedMonth,
      onSelectMonth
    } = options;

    if (!chartContainer || !statsContainer || !legendContainer || !movementContainer) return;

    chartContainer.replaceChildren();
    statsContainer.replaceChildren();
    legendContainer.replaceChildren();
    movementContainer.textContent = "";

    const months = getLastMonths(rangeMonths, currentSelectedMonth || ymOf(new Date()));
    const aggregate = Metrics.aggregateByMonth(State.expenses);
    const monthlyByCategory = months.map((month) => aggregate.get(month)?.byCategory || Object.create(null));
    const monthlyTotals = months.map((month) => aggregate.get(month)?.total || 0);
    const monthlyBudgets = months.map((month) => Number(getBudget(month).total) || 0);

    if (!monthlyTotals.some((t) => t > 0)) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty";
      emptyDiv.textContent = "📈 Aún no hay suficientes datos registrados para comparar evolución.";
      chartContainer.appendChild(emptyDiv);
      return;
    }

    const containerWidth = chartContainer.clientWidth || 600;
    const height = 250;
    const marginLeft = 50;
    const marginBottom = 32;
    const marginTop = 20;
    const plotWidth = containerWidth - marginLeft - 10;
    const plotHeight = height - marginBottom - marginTop;

    const maxVal = Math.max(1, ...monthlyTotals, ...monthlyBudgets) * 1.12;
    const getY = (val) => marginTop + plotHeight - (val / maxVal) * plotHeight;

    const compactFmt = new Intl.NumberFormat(LOCALE, {
      notation: "compact",
      maximumFractionDigits: 1
    });

    const svg = createSvgElement(
      "svg",
      {
        viewBox: `0 0 ${containerWidth} ${height}`,
        width: "100%",
        height: height,
        role: "img",
        "aria-label": "Gráfico de evolución de gastos mensuales",
        style: "overflow: visible; font-family: inherit;"
      },
      chartContainer
    );

    // Líneas guía horizontales
    [0, 0.5, 1].forEach((factor) => {
      const val = (maxVal / 1.12) * factor;
      const yPos = getY(val);
      createSvgElement(
        "line",
        {
          x1: marginLeft,
          x2: containerWidth - 4,
          y1: yPos,
          y2: yPos,
          stroke: "var(--bd)",
          "stroke-dasharray": factor === 0 ? "none" : "3 3",
          "stroke-width": "1"
        },
        svg
      );
      createSvgElement(
        "text",
        {
          x: marginLeft - 8,
          y: yPos + 4,
          "text-anchor": "end",
          "font-size": "11",
          style: "fill: var(--mut); font-weight: 500; font-variant-numeric: tabular-nums;"
        },
        svg,
        compactFmt.format(val)
      );
    });

    const stepWidth = plotWidth / months.length;
    const barWidth = Math.min(48, stepWidth * 0.65);

    // Barras mensuales
    months.forEach((m, idx) => {
      const isCurrent = m === currentSelectedMonth;
      const group = createSvgElement(
        "g",
        {
          style: "cursor: pointer; transition: transform 0.2s;",
          role: "button",
          tabindex: "0",
          "aria-label": `Ver mes ${getMonthName(m)}`
        },
        svg
      );

      const x0 = marginLeft + stepWidth * idx;
      const barX = x0 + (stepWidth - barWidth) / 2;

      // Tarjeta translúcida para mes seleccionado
      createSvgElement(
        "rect",
        {
          x: x0,
          y: marginTop - 4,
          width: stepWidth,
          height: plotHeight + marginBottom,
          rx: 6,
          style: isCurrent
            ? "fill: var(--ac); fill-opacity: 0.15; stroke: var(--ac); stroke-width: 1px; stroke-dasharray: 4 2;"
            : "fill: transparent;"
        },
        group
      );

      // Segmentos apilados
      let accHeight = 0;
      CATS.forEach(([catName, color]) => {
        const catAmount = monthlyByCategory[idx][catName];
        if (!catAmount) return;

        const segmentHeight = (catAmount / maxVal) * plotHeight;
        createSvgElement(
          "rect",
          {
            x: barX,
            y: getY(accHeight + catAmount),
            width: barWidth,
            height: segmentHeight,
            fill: color,
            rx: 3,
            style: "transition: opacity 0.2s;"
          },
          group
        );
        accHeight += catAmount;
      });

      // Valor total encima de la barra
      if (stepWidth >= 52 && monthlyTotals[idx] > 0) {
        createSvgElement(
          "text",
          {
            x: barX + barWidth / 2,
            y: getY(monthlyTotals[idx]) - 6,
            "text-anchor": "middle",
            "font-size": "10",
            "font-weight": "600",
            style: "fill: var(--tx);"
          },
          group,
          compactFmt.format(monthlyTotals[idx])
        );
      }

      // Nombre del mes abajo
      const shortName = getMonthName(m).split(" ")[0].slice(0, 3);
      createSvgElement(
        "text",
        {
          x: barX + barWidth / 2,
          y: height - 10,
          "text-anchor": "middle",
          "font-size": "12",
          "font-weight": isCurrent ? "700" : "500",
          style: isCurrent ? "fill: var(--ac);" : "fill: var(--mut);"
        },
        group,
        shortName
      );

      // Tooltip informativo
      const breakdownText = Object.entries(monthlyByCategory[idx])
        .sort((a, b) => b[1] - a[1])
        .map(([c, v]) => `\n${CAT_ICONS[c] || "•"} ${c}: ${formatCurrency(v)}`)
        .join("");

      createSvgElement(
        "title",
        {},
        group,
        `${getMonthName(m)}: ${formatCurrency(monthlyTotals[idx])}${breakdownText}`
      );

      group.onclick = () => {
        if (typeof onSelectMonth === "function") onSelectMonth(m);
      };

      group.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (typeof onSelectMonth === "function") onSelectMonth(m);
        }
      };
    });

    // Each month keeps its own budget; missing budgets do not invent a target.
    months.forEach((month, index) => {
      const budget = monthlyBudgets[index];
      if (!(budget > 0)) return;
      const center = marginLeft + stepWidth * index + stepWidth / 2;
      const y = getY(budget);
      const marker = createSvgElement("line", {
        x1: center - stepWidth * 0.35,
        x2: center + stepWidth * 0.35,
        y1: y, y2: y,
        stroke: "var(--warn)",
        "stroke-dasharray": "5 3",
        "stroke-width": "2",
        "aria-label": `Presupuesto ${getMonthName(month)}: ${formatCurrency(budget)}`
      }, svg);
      createSvgElement("title", {}, marker, `Presupuesto ${getMonthName(month)}: ${formatCurrency(budget)}`);
    });
    if (monthlyBudgets.some((budget) => budget > 0)) {
      createSvgElement("text", {
        x: containerWidth - 6, y: 11,
        "text-anchor": "end", "font-size": "11",
        style: "fill: var(--warn); font-weight: 600;"
      }, svg, "🎯 Presupuesto de cada mes");
    }

    // Leyenda de categorías con iconos
    CATS.forEach(([catName, color, icon]) => {
      const hasData = monthlyByCategory.some((monthCats) => monthCats[catName] > 0);
      if (hasData) {
        const item = document.createElement("span");
        item.className = "badge-pill";
        item.style.borderColor = color + "44";
        item.style.backgroundColor = color + "18";
        item.style.color = "var(--tx)";

        const dot = document.createElement("span");
        dot.textContent = icon || "•";
        dot.style.fontSize = "13px";

        item.appendChild(dot);
        item.appendChild(document.createTextNode(catName));
        legendContainer.appendChild(item);
      }
    });

    // Tarjetas de Estadísticas visuales
    const addStatCard = (label, value, subtext, icon) => {
      const card = document.createElement("div");
      card.className = "st";

      const headerRow = document.createElement("div");
      headerRow.style.display = "flex";
      headerRow.style.justifyContent = "space-between";
      headerRow.style.alignItems = "center";

      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.textContent = label;

      const iconSpan = document.createElement("span");
      iconSpan.textContent = icon || "📊";
      iconSpan.style.fontSize = "14px";

      headerRow.appendChild(lbl);
      headerRow.appendChild(iconSpan);

      const val = document.createElement("b");
      val.textContent = value;

      card.appendChild(headerRow);
      card.appendChild(val);

      if (subtext) {
        const sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = subtext;
        card.appendChild(sub);
      }
      statsContainer.appendChild(card);
    };

    const calendarMonth = ymOf(new Date());
    const firstRecordedMonth = Array.from(aggregate.keys()).sort()[0];
    const completedMonths = months
      .filter((month) => month < calendarMonth && firstRecordedMonth && month >= firstRecordedMonth)
      .map((month) => ({ month, total: aggregate.get(month)?.total || 0 }));

    if (completedMonths.length > 0) {
      const totalSum = completedMonths.reduce((acc, curr) => acc + curr.total, 0);
      const average = totalSum / completedMonths.length;
      const highest = completedMonths.reduce((a, b) => (b.total > a.total ? b : a));
      const lowest = completedMonths.reduce((a, b) => (b.total < a.total ? b : a));

      addStatCard("Media mensual", formatCurrency(average), `${completedMonths.length} meses cerrados desde el primer registro`, "⚖️");
      addStatCard("Mes más alto", formatCurrency(highest.total), getMonthName(highest.month), "🔥");
      addStatCard("Mes más bajo", formatCurrency(lowest.total), getMonthName(lowest.month), "✨");

      const last3 = completedMonths.slice(-3);
      const prev3 = completedMonths.slice(-6, -3);

      if (last3.length === 3 && prev3.length === 3) {
        const avgLast3 = last3.reduce((s, x) => s + x.total, 0) / last3.length;
        const avgPrev3 = prev3.reduce((s, x) => s + x.total, 0) / prev3.length;
        const diffPercent = avgPrev3 > 0 ? Math.round(((avgLast3 - avgPrev3) / avgPrev3) * 100) : null;
        addStatCard(
          "Tendencia",
          diffPercent === null ? "Sin base" : (diffPercent >= 0 ? "+" : "") + diffPercent + " %",
          "3 meses cerrados vs. 3 anteriores",
          diffPercent > 0 ? "📈" : "📉"
        );
      }
    } else {
      addStatCard("Meses completos", "—", "Aún no hay ningún mes cerrado con datos", "ℹ️");
    }

    // Compare the latest two closed calendar months in the selected range.
    if (completedMonths.length >= 2) {
      const latest = completedMonths[completedMonths.length - 1].month;
      const previous = completedMonths[completedMonths.length - 2].month;
      const lastClosed = aggregate.get(latest)?.byCategory || Object.create(null);
      const prevClosed = aggregate.get(previous)?.byCategory || Object.create(null);
      const categoryDiffs = CATS.map(([catName, _, icon]) => ({
        cat: catName, icon,
        diff: (lastClosed[catName] || 0) - (prevClosed[catName] || 0)
      })).sort((a, b) => b.diff - a.diff);
      const topIncrease = categoryDiffs[0];
      const topDecrease = categoryDiffs[categoryDiffs.length - 1];
      const insights = [];
      if (topIncrease?.diff > 0) insights.push(`subió sobre todo ${topIncrease.icon} ${topIncrease.cat} (+${formatCurrency(topIncrease.diff)})`);
      if (topDecrease?.diff < 0) insights.push(`bajó sobre todo ${topDecrease.icon} ${topDecrease.cat} (${formatCurrency(topDecrease.diff)})`);
      if (insights.length) movementContainer.textContent = `💡 En ${getMonthName(latest)} frente a ${getMonthName(previous)}: ${insights.join(" y ")}.`;
    }

  }

  window.Spendly = window.Spendly || {};
  window.Spendly.Chart = {
    render: renderEvolution,
    getLastMonths: getLastMonths,
    getMonthName: getMonthName
  };
})(window);

