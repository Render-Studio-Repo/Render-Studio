/** Management dashboard charts: multi-view trends + collaboration network brain. */

const SERIES = [
  { key: "prompts", label: "Prompts", color: "#58a6ff" },
  { key: "projects_created", label: "Projects", color: "#3fb950" },
  { key: "users_joined", label: "Users joined", color: "#ffb300" },
];

const CHART_VIEWS = [
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "stacked", label: "Stacked" },
  { id: "combo", label: "Combo" },
];

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dayLabel(dateStr = "") {
  const parts = String(dateStr).split("-");
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  return dateStr;
}

function niceMax(value) {
  const n = Math.max(1, Number(value) || 1);
  const pow = 10 ** Math.floor(Math.log10(n));
  const scaled = n / pow;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return nice * pow;
}

function buildPath(points, { closed = false, baselineY = 0 } = {}) {
  if (!points.length) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    d += ` C ${cx.toFixed(1)} ${prev.y.toFixed(1)}, ${cx.toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  if (closed && points.length) {
    d += ` L ${points[points.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)} L ${points[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
  }
  return d;
}

function renderTrendShell(days = []) {
  return `
    <div class="admin-chart" data-admin-chart>
      <div class="admin-chart-toolbar">
        <div class="admin-chart-views" role="tablist" aria-label="Chart view">
          ${CHART_VIEWS.map((view, i) => `
            <button type="button" class="admin-chart-view-btn${i === 0 ? " active" : ""}" data-chart-view="${view.id}">${view.label}</button>
          `).join("")}
        </div>
        <div class="admin-chart-series" role="group" aria-label="Series">
          ${SERIES.map((series) => `
            <label class="admin-chart-series-toggle">
              <input type="checkbox" data-series-key="${series.key}" checked />
              <i style="background:${series.color}"></i>${series.label}
            </label>
          `).join("")}
        </div>
      </div>
      <div class="admin-chart-canvas-wrap">
        <svg class="admin-chart-svg" viewBox="0 0 720 260" preserveAspectRatio="none" role="img" aria-label="Activity trend"></svg>
        <div class="admin-chart-tooltip hidden"></div>
      </div>
      <div class="admin-chart-meta muted small">
        Last ${days.length || 30} days · hover for exact counts
      </div>
    </div>
  `;
}

function drawTrendChart(root, days = [], { view = "bars", enabled = null } = {}) {
  const svg = root.querySelector(".admin-chart-svg");
  const tip = root.querySelector(".admin-chart-tooltip");
  if (!svg || !days.length) {
    if (svg) svg.innerHTML = `<text x="24" y="130" fill="#8b949e" font-size="14">No recent activity yet.</text>`;
    return;
  }
  const activeSeries = SERIES.filter((s) => !enabled || enabled.has(s.key));
  const width = 720;
  const height = 260;
  const pad = { top: 18, right: 18, bottom: 36, left: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = days.length;
  const maxVal = niceMax(
    Math.max(
      1,
      ...days.map((day) => {
        if (view === "stacked") {
          return activeSeries.reduce((sum, s) => sum + Number(day[s.key] || 0), 0);
        }
        return Math.max(0, ...activeSeries.map((s) => Number(day[s.key] || 0)));
      }),
    ),
  );
  const xAt = (i) => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => pad.top + innerH - (Math.max(0, v) / maxVal) * innerH;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = pad.top + innerH * (1 - t);
    const val = Math.round(maxVal * t);
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="admin-chart-grid" />
      <text x="${pad.left - 8}" y="${y + 4}" class="admin-chart-axis" text-anchor="end">${val}</text>`;
  }).join("");

  const labelStep = Math.max(1, Math.ceil(n / 10));
  const labels = days.map((day, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return "";
    return `<text x="${xAt(i)}" y="${height - 12}" class="admin-chart-axis" text-anchor="middle">${esc(dayLabel(day.date))}</text>`;
  }).join("");

  let body = "";
  if (view === "bars" || view === "combo") {
    const groupW = innerW / Math.max(n, 1);
    const barW = Math.max(3, Math.min(14, (groupW * 0.7) / Math.max(activeSeries.length, 1)));
    days.forEach((day, i) => {
      const groupX = pad.left + i * groupW + groupW / 2;
      activeSeries.forEach((series, si) => {
        const value = Number(day[series.key] || 0);
        const h = Math.max(value > 0 ? 2 : 0, (value / maxVal) * innerH);
        const x = groupX - (activeSeries.length * barW) / 2 + si * barW;
        const y = pad.top + innerH - h;
        body += `<rect class="admin-chart-bar" data-day="${esc(day.date)}" data-series="${series.key}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${series.color}" rx="2" />`;
      });
    });
  }

  if (view === "stacked") {
    const groupW = innerW / Math.max(n, 1);
    const barW = Math.max(6, Math.min(22, groupW * 0.55));
    days.forEach((day, i) => {
      let stack = 0;
      const x = pad.left + i * groupW + groupW / 2 - barW / 2;
      activeSeries.forEach((series) => {
        const value = Number(day[series.key] || 0);
        const h = (value / maxVal) * innerH;
        const y = pad.top + innerH - stack - h;
        stack += h;
        if (h > 0) {
          body += `<rect class="admin-chart-bar" data-day="${esc(day.date)}" data-series="${series.key}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${series.color}" />`;
        }
      });
    });
  }

  if (view === "line" || view === "area" || view === "combo") {
    activeSeries.forEach((series) => {
      const points = days.map((day, i) => ({
        x: xAt(i),
        y: yAt(Number(day[series.key] || 0)),
        value: Number(day[series.key] || 0),
        date: day.date,
      }));
      if (view === "area") {
        body += `<path d="${buildPath(points, { closed: true, baselineY: pad.top + innerH })}" fill="${series.color}" fill-opacity="0.18" stroke="none" />`;
      }
      body += `<path d="${buildPath(points)}" fill="none" stroke="${series.color}" stroke-width="2.4" stroke-linecap="round" />`;
      points.forEach((pt) => {
        body += `<circle class="admin-chart-dot" data-day="${esc(pt.date)}" data-series="${series.key}" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.2" fill="${series.color}" />`;
      });
    });
  }

  // Invisible hover strips
  const hitW = innerW / Math.max(n, 1);
  const hits = days.map((day, i) => {
    const x = pad.left + i * hitW;
    return `<rect class="admin-chart-hit" data-day-index="${i}" x="${x.toFixed(1)}" y="${pad.top}" width="${hitW.toFixed(1)}" height="${innerH}" fill="transparent" />`;
  }).join("");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `${grid}${body}${labels}${hits}`;

  const showTip = (index, clientX, clientY) => {
    if (!tip) return;
    const day = days[index];
    if (!day) return;
    tip.innerHTML = `
      <strong>${esc(day.date)}</strong>
      ${activeSeries.map((s) => `<span><i style="background:${s.color}"></i>${s.label}: <b>${Number(day[s.key] || 0)}</b></span>`).join("")}
    `;
    tip.classList.remove("hidden");
    const wrap = root.querySelector(".admin-chart-canvas-wrap");
    const rect = wrap.getBoundingClientRect();
    const left = Math.min(rect.width - 160, Math.max(8, clientX - rect.left + 12));
    const top = Math.max(8, clientY - rect.top - 12);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  svg.querySelectorAll(".admin-chart-hit").forEach((hit) => {
    hit.addEventListener("mousemove", (event) => {
      showTip(Number(hit.dataset.dayIndex), event.clientX, event.clientY);
    });
    hit.addEventListener("mouseleave", () => tip?.classList.add("hidden"));
  });
}

export function mountActivityCharts(container, days = []) {
  if (!container) return () => {};
  container.innerHTML = renderTrendShell(days);
  const chartRoot = container.querySelector("[data-admin-chart]");
  let view = "bars";
  const enabled = new Set(SERIES.map((s) => s.key));

  const redraw = () => drawTrendChart(chartRoot, days, { view, enabled });
  redraw();

  chartRoot.querySelectorAll("[data-chart-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view = btn.getAttribute("data-chart-view") || "bars";
      chartRoot.querySelectorAll("[data-chart-view]").forEach((el) => el.classList.toggle("active", el === btn));
      redraw();
    });
  });
  chartRoot.querySelectorAll("[data-series-key]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.getAttribute("data-series-key");
      if (!key) return;
      if (input.checked) enabled.add(key);
      else enabled.delete(key);
      if (!enabled.size) {
        enabled.add(key);
        input.checked = true;
      }
      redraw();
    });
  });

  return () => {
    container.innerHTML = "";
  };
}

function nodeColor(kind) {
  if (kind === "user") return "#58a6ff";
  if (kind === "team") return "#ffb300";
  return "#3fb950";
}

function edgeColor(kind) {
  if (kind === "owns") return "rgba(88,166,255,0.55)";
  if (kind === "collab") return "rgba(210,168,255,0.55)";
  if (kind === "member") return "rgba(255,179,0,0.45)";
  return "rgba(63,185,80,0.4)";
}

export function mountNetworkBrain(container, network = {}, handlers = {}) {
  if (!container) return () => {};
  const nodesIn = Array.isArray(network.nodes) ? network.nodes : [];
  const edgesIn = Array.isArray(network.edges) ? network.edges : [];
  container.innerHTML = `
    <div class="admin-network">
      <div class="admin-network-toolbar">
        <div class="admin-legend">
          <span><i class="users"></i>Users</span>
          <span><i class="projects"></i>Projects</span>
          <span><i style="background:#ffb300"></i>Teams</span>
          <span class="muted">Drag nodes · scroll to zoom</span>
        </div>
        <button type="button" class="btn secondary btn-compact" data-network-reset>Reset</button>
      </div>
      <canvas class="admin-network-canvas"></canvas>
      <div class="admin-network-tip hidden"></div>
    </div>
  `;
  const canvas = container.querySelector(".admin-network-canvas");
  const tip = container.querySelector(".admin-network-tip");
  const ctx = canvas.getContext("2d");
  let raf = 0;
  let disposed = false;
  let width = 0;
  let height = 0;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let drag = null;
  let hover = null;

  const nodes = nodesIn.map((node, i) => {
    const angle = (i / Math.max(nodesIn.length, 1)) * Math.PI * 2;
    const radius = 90 + (i % 7) * 18;
    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      r: Math.max(7, Math.min(22, 6 + Math.sqrt(Number(node.weight || 1)) * 2.2)),
      avatarImg: null,
      avatarReady: false,
      avatarFailed: false,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = edgesIn
    .map((edge) => ({
      ...edge,
      source: byId.get(edge.source),
      target: byId.get(edge.target),
    }))
    .filter((edge) => edge.source && edge.target);

  // Prefetch user profile pictures so nodes show faces instead of color dots.
  for (const node of nodes) {
    if (node.kind !== "user") continue;
    const avatarUrl = node.avatar_url
      || (node.user_id ? `/api/users/${encodeURIComponent(node.user_id)}/avatar` : null);
    if (!avatarUrl) continue;
    node.avatar_url = avatarUrl;
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "same-origin";
    img.onload = () => {
      node.avatarReady = true;
    };
    img.onerror = () => {
      node.avatarFailed = true;
    };
    img.src = String(avatarUrl);
    node.avatarImg = img;
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    width = Math.max(320, rect.width || 640);
    height = Math.max(320, 380);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function simStep() {
    const centerPull = 0.008;
    for (const node of nodes) {
      node.vx += -node.x * centerPull;
      node.vy += -node.y * centerPull;
    }
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const minDist = a.r + b.r + 18;
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.08;
          dx *= push;
          dy *= push;
          a.vx -= dx;
          a.vy -= dy;
          b.vx += dx;
          b.vy += dy;
        } else {
          const force = 28 / (dist * dist);
          dx *= force;
          dy *= force;
          a.vx -= dx;
          a.vy -= dy;
          b.vx += dx;
          b.vy += dy;
        }
      }
    }
    for (const edge of edges) {
      const a = edge.source;
      const b = edge.target;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const ideal = edge.kind === "owns" ? 70 : edge.kind === "collab" ? 95 : 110;
      const pull = ((dist - ideal) / dist) * 0.015 * Math.min(3, Number(edge.weight || 1));
      dx *= pull;
      dy *= pull;
      a.vx += dx;
      a.vy += dy;
      b.vx -= dx;
      b.vy -= dy;
    }
    for (const node of nodes) {
      if (drag && drag.id === node.id) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  function worldFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left - width / 2 - offsetX) / scale;
    const y = (event.clientY - rect.top - height / 2 - offsetY) / scale;
    return { x, y };
  }

  function hitTest(x, y) {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const node = nodes[i];
      if (Math.hypot(node.x - x, node.y - y) <= node.r + 3) return node;
    }
    return null;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    // soft brain glow
    const grd = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, Math.max(width, height) * 0.45);
    grd.addColorStop(0, "rgba(56,139,253,0.10)");
    grd.addColorStop(0.55, "rgba(63,185,80,0.05)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
    ctx.scale(scale, scale);

    for (const edge of edges) {
      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.lineTo(edge.target.x, edge.target.y);
      ctx.strokeStyle = edgeColor(edge.kind);
      ctx.lineWidth = Math.min(4, 1 + Math.log2(1 + Number(edge.weight || 1)));
      ctx.stroke();
    }

    for (const node of nodes) {
      const color = nodeColor(node.kind);
      const radius = node.r + (hover?.id === node.id ? 3 : 0);
      const showAvatar = node.kind === "user"
        && node.avatarReady
        && node.avatarImg
        && !node.avatarFailed
        && node.avatarImg.naturalWidth > 0;

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      if (showAvatar) {
        ctx.save();
        ctx.clip();
        const size = radius * 2;
        ctx.drawImage(node.avatarImg, node.x - radius, node.y - radius, size, size);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.lineWidth = hover?.id === node.id ? 2.5 : 1.75;
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.stroke();
        // Soft ring so avatars read on the dark brain background
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 1.5, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(88,166,255,0.45)";
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.stroke();
        if (node.kind === "user") {
          const initial = String(node.label || "?").trim().charAt(0).toUpperCase() || "?";
          ctx.fillStyle = "#0d1117";
          ctx.font = `bold ${Math.max(9, Math.round(radius * 0.95))}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(initial, node.x, node.y + 0.5);
        }
      }

      if (scale > 0.75 || hover?.id === node.id) {
        ctx.fillStyle = "#e6edf3";
        ctx.font = `${hover?.id === node.id ? 12 : 10}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(String(node.label || "").slice(0, 18), node.x, node.y + node.r + 12);
      }
    }
    ctx.restore();
  }

  function frame() {
    if (disposed) return;
    for (let i = 0; i < 2; i += 1) simStep();
    draw();
    raf = requestAnimationFrame(frame);
  }

  function showTipFor(node, event) {
    if (!tip || !node) {
      tip?.classList.add("hidden");
      return;
    }
    const bits = [
      `<strong>${esc(node.label || node.id)}</strong>`,
      `<span>${esc(node.kind)}</span>`,
    ];
    if (node.prompt_count != null) bits.push(`<span>${node.prompt_count} prompts</span>`);
    if (node.project_count != null) bits.push(`<span>${node.project_count} projects</span>`);
    if (node.has_model) bits.push("<span>has model</span>");
    tip.innerHTML = bits.join("");
    tip.classList.remove("hidden");
    const rect = container.getBoundingClientRect();
    tip.style.left = `${Math.min(rect.width - 180, event.clientX - rect.left + 10)}px`;
    tip.style.top = `${Math.max(8, event.clientY - rect.top - 10)}px`;
  }

  resize();
  frame();

  canvas.addEventListener("pointerdown", (event) => {
    const pt = worldFromEvent(event);
    const node = hitTest(pt.x, pt.y);
    if (node) {
      drag = node;
      canvas.setPointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    const pt = worldFromEvent(event);
    if (drag) {
      drag.x = pt.x;
      drag.y = pt.y;
      showTipFor(drag, event);
      return;
    }
    hover = hitTest(pt.x, pt.y);
    canvas.style.cursor = hover ? "grab" : "default";
    showTipFor(hover, event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (drag && handlers.onNodeClick) {
      const pt = worldFromEvent(event);
      if (Math.hypot(pt.x - drag.x, pt.y - drag.y) < 1.5) handlers.onNodeClick(drag);
    }
    drag = null;
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const next = Math.min(2.4, Math.max(0.45, scale * (event.deltaY < 0 ? 1.08 : 0.92)));
    scale = next;
  }, { passive: false });
  container.querySelector("[data-network-reset]")?.addEventListener("click", () => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    nodes.forEach((node, i) => {
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const radius = 90 + (i % 7) * 18;
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
      node.vx = 0;
      node.vy = 0;
    });
  });

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  if (!nodes.length) {
    tip.classList.remove("hidden");
    tip.textContent = "No collaboration network data yet.";
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    container.innerHTML = "";
  };
}
