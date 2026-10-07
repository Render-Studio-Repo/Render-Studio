/** Read-only SVG focus diagram for circuit debugger signal paths. */

import { partSkinHref } from "./wiring-part-skins.js?v=20260916-wiring-repair-2";

const TYPE_COLORS = {
  "raspberry-pi": "#c51a4a",
  "arduino-uno": "#00979d",
  "arduino-mega": "#008184",
  breadboard: "#3d444d",
  "motor-driver": "#21262d",
  stepper: "#6e7681",
  "servo-motor": "#3fb950",
  motor: "#2ea043",
  led: "#e3b341",
  resistor: "#d4a574",
  transistor: "#21262d",
  diode: "#484f58",
  button: "#8b949e",
  sensor: "#58a6ff",
};

/** Compact display sizes tuned for debugger readability (not full sim scale). */
const DISPLAY_SIZES = {
  "raspberry-pi": { w: 118, h: 88 },
  "arduino-uno": { w: 118, h: 78 },
  "arduino-mega": { w: 132, h: 86 },
  breadboard: { w: 64, h: 40 },
  "motor-driver": { w: 96, h: 72 },
  stepper: { w: 72, h: 72 },
  "servo-motor": { w: 72, h: 72 },
  motor: { w: 56, h: 56 },
  led: { w: 40, h: 40 },
  resistor: { w: 56, h: 22 },
  transistor: { w: 44, h: 52 },
  diode: { w: 48, h: 20 },
  button: { w: 40, h: 40 },
  sensor: { w: 56, h: 48 },
};

const LABEL_BAND = 34;
const PART_GAP = 56;

function wirePathElbow(a, b) {
  const midX = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;
}

function pinLayout(type) {
  if (type === "breadboard") {
    return [
      { id: "t+_0", x: 0.5, y: 0.12 },
      { id: "t-_0", x: 0.5, y: 0.88 },
      ..."abcdefghij".split("").flatMap((row, r) =>
        Array.from({ length: 15 }, (_, c) => ({
          id: `${row}${c + 1}`,
          x: 0.12 + (c / 14) * 0.76,
          y: 0.28 + (r / 9) * 0.56,
        })),
      ),
    ];
  }
  if (type === "resistor") {
    return [{ id: "a", x: 0.08, y: 0.5 }, { id: "b", x: 0.92, y: 0.5 }];
  }
  if (type === "led") {
    return [{ id: "anode", x: 0.5, y: 0.08 }, { id: "cathode", x: 0.5, y: 0.92 }];
  }
  if (type === "motor-driver") {
    return [
      { id: "in1", x: 0.06, y: 0.18 },
      { id: "in2", x: 0.06, y: 0.38 },
      { id: "in3", x: 0.06, y: 0.58 },
      { id: "in4", x: 0.06, y: 0.78 },
      { id: "vcc", x: 0.38, y: 0.94 },
      { id: "gnd", x: 0.62, y: 0.94 },
      { id: "out1", x: 0.94, y: 0.18 },
      { id: "out2", x: 0.94, y: 0.38 },
    ];
  }
  if (type === "stepper") {
    return [{ id: "in1", x: 0.5, y: 0.92 }];
  }
  if (type.startsWith("arduino") || type === "raspberry-pi") {
    return [
      { id: "5v", x: 0.08, y: 0.2 },
      { id: "gnd", x: 0.08, y: 0.42 },
      { id: "d13", x: 0.92, y: 0.22 },
      { id: "d12", x: 0.92, y: 0.38 },
      { id: "d11", x: 0.92, y: 0.54 },
      { id: "d10", x: 0.92, y: 0.7 },
      { id: "a0", x: 0.92, y: 0.84 },
      { id: "a1", x: 0.92, y: 0.96 },
    ];
  }
  return [{ id: "in", x: 0.2, y: 0.5 }, { id: "out", x: 0.8, y: 0.5 }];
}

function pinPoint(comp, pinId) {
  const pins = pinLayout(comp.type);
  const pin = pins.find((p) => p.id === pinId) || { x: 0.5, y: 0.5 };
  return {
    x: Number(comp.x) + pin.x * Number(comp.w),
    y: Number(comp.y) + pin.y * Number(comp.h),
  };
}


const ISSUE_STATUSES = new Set(["issue", "missing", "wrong", "error", "fix", "broken"]);

/** Wires the AI flagged as needing a fix (animated in debugger + canvas). */
export function resolveIssueWireIds(focusDiagram, issues = []) {
  const ids = new Set((focusDiagram?.issue_wire_ids || []).map(String));
  const schematic = focusDiagram?.schematic || focusDiagram;
  const wireList = schematic?.wires || [];

  for (const wire of wireList) {
    if (!wire?.id) continue;
    const status = String(wire.status || "").toLowerCase();
    if (wire.needs_fix || wire.issue === true || ISSUE_STATUSES.has(status)) {
      ids.add(String(wire.id));
    }
  }
  for (const issue of issues || []) {
    for (const wid of issue.related_wire_ids || []) {
      if (wid) ids.add(String(wid));
    }
  }
  return ids;
}

function isIssueWire(wire, issueWireIds) {
  if (!wire?.id) return false;
  if (issueWireIds.has(String(wire.id))) return true;
  const status = String(wire.status || "").toLowerCase();
  return wire.needs_fix || wire.issue === true || ISSUE_STATUSES.has(status);
}

/** Show only wires/components tied to the photo-reported fault. */
function narrowSchematicForDisplay(schematic, issueWireIds) {
  const allWires = schematic?.wires || [];
  const issueWires = allWires.filter((w) => isIssueWire(w, issueWireIds));
  const wires = issueWires.length ? issueWires : allWires;
  const compIds = new Set();
  for (const w of wires) {
    if (w.from?.componentId) compIds.add(w.from.componentId);
    if (w.to?.componentId) compIds.add(w.to.componentId);
  }
  const allComponents = schematic?.components || [];
  const components =
    compIds.size >= 2
      ? allComponents.filter((c) => compIds.has(c.id))
      : allComponents;
  return { components, wires: issueWires.length ? issueWires : wires };
}

function splitLabel(text, maxLen = 18) {
  const s = String(text || "").trim();
  if (s.length <= maxLen) return [s];
  const words = s.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxLen && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

function displayPartLabel(comp) {
  if (comp.type === "breadboard") return "Rails";
  return comp.label || comp.type || "Part";
}

function wireDescription(wire, byId) {
  if (wire.label?.trim()) return wire.label.trim();
  const fromComp = byId[wire.from?.componentId];
  const toComp = byId[wire.to?.componentId];
  const fromPin = String(wire.from?.pinId || "").toUpperCase();
  const toPin = String(wire.to?.pinId || "").toUpperCase();
  const fromName = fromComp?.type === "breadboard" ? "Rail" : (fromComp?.label || fromComp?.type || "?");
  const toName = toComp?.type === "breadboard" ? "Rail" : (toComp?.label || toComp?.type || "?");
  return `${fromName} ${fromPin} → ${toName} ${toPin}`;
}

function orderComponents(components, wires) {
  const byId = Object.fromEntries(components.map((c) => [c.id, c]));
  const controller = components.find((c) =>
    c.type?.startsWith("arduino") || c.type === "raspberry-pi",
  ) || components[0];
  const ordered = [];
  const visited = new Set();

  function visit(cid) {
    if (!cid || visited.has(cid) || !byId[cid]) return;
    visited.add(cid);
    ordered.push(byId[cid]);
    for (const w of wires) {
      for (const side of ["from", "to"]) {
        const end = w[side];
        if (end?.componentId === cid) {
          const other = side === "from" ? w.to : w.from;
          visit(other?.componentId);
        }
      }
    }
  }

  visit(controller?.id);
  for (const c of components) {
    if (!visited.has(c.id)) ordered.push(c);
  }
  return ordered;
}

function layoutForDisplay(components, wires) {
  const ordered = orderComponents(components, wires);
  let x = 20;
  const y = 36;
  return ordered.map((comp) => {
    const sz = DISPLAY_SIZES[comp.type] || { w: 80, h: 52 };
    const laid = {
      ...comp,
      w: sz.w,
      h: sz.h,
      x,
      y,
    };
    x += sz.w + PART_GAP;
    return laid;
  });
}

function assignWireEntries(wires, components, byId) {
  const entries = wires
    .map((wire) => {
      const aComp = byId[wire.from?.componentId];
      const bComp = byId[wire.to?.componentId];
      if (!aComp || !bComp) return null;
      const a = pinPoint(aComp, wire.from.pinId);
      const b = pinPoint(bComp, wire.to.pinId);
      const midX = (a.x + b.x) / 2;
      return {
        wire,
        a,
        b,
        midX,
        badgeY: (a.y + b.y) / 2,
        sortY: Math.min(a.y, b.y),
        desc: wireDescription(wire, byId),
      };
    })
    .filter(Boolean);
  entries.sort((p, q) => p.sortY - q.sortY || p.midX - q.midX);
  return entries.map((entry, index) => ({ ...entry, index: index + 1 }));
}

function sceneBounds(components, wireEntries, pad = 24) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of components) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h + LABEL_BAND);
  }
  for (const entry of wireEntries) {
    minY = Math.min(minY, entry.a.y, entry.b.y, entry.badgeY - 14);
    maxY = Math.max(maxY, entry.a.y, entry.b.y, entry.badgeY + 14);
    minX = Math.min(minX, entry.a.x, entry.b.x, entry.midX);
    maxX = Math.max(maxX, entry.a.x, entry.b.x, entry.midX);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 360, h: 200 };
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

function appendWireBadge(parent, x, y, num, isIssue) {
  const r = 11;
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", String(x));
  circle.setAttribute("cy", String(y));
  circle.setAttribute("r", String(r));
  circle.setAttribute("class", isIssue ? "wdbg-focus-wire-badge wdbg-focus-wire-badge--issue" : "wdbg-focus-wire-badge");
  parent.appendChild(circle);
  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.setAttribute("x", String(x));
  label.setAttribute("y", String(y + 4));
  label.setAttribute("class", "wdbg-focus-wire-badge-text");
  label.textContent = String(num);
  parent.appendChild(label);
}

function appendPinDot(parent, x, y, color) {
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("cx", String(x));
  dot.setAttribute("cy", String(y));
  dot.setAttribute("r", "3.5");
  dot.setAttribute("fill", color);
  dot.setAttribute("class", "wdbg-focus-pin-dot");
  parent.appendChild(dot);
}

/**
 * Render a focus-path schematic into container (clears existing content).
 */
export function mountFocusDiagram(container, focusDiagram, context = {}) {
  if (!container) return;
  container.innerHTML = "";
  const schematicRaw = focusDiagram?.schematic;
  const issues = context.issues || [];
  const issueWireIds = resolveIssueWireIds(focusDiagram, issues);
  const schematic = narrowSchematicForDisplay(schematicRaw, issueWireIds);
  const rawComponents = schematic?.components || [];
  const wires = schematic?.wires || [];
  if (rawComponents.length < 2) {
    container.classList.add("wdbg-focus-diagram--empty");
    container.textContent = "No signal path diagram available.";
    return;
  }

  const components = layoutForDisplay(rawComponents, wires);
  const byId = Object.fromEntries(components.map((c) => [c.id, c]));
  const wireEntries = assignWireEntries(wires, components, byId);
  const bounds = sceneBounds(components, wireEntries, 32);

  const wrap = document.createElement("div");
  wrap.className = "wdbg-focus-diagram-inner";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "wdbg-focus-svg");
  svg.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", focusDiagram?.title || "Signal path diagram");

  const wireLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  wireLayer.setAttribute("class", "wdbg-focus-wires");
  const displayEntries = wireEntries.filter(({ wire }) => isIssueWire(wire, issueWireIds));
  const entriesToDraw = displayEntries.length ? displayEntries : wireEntries;
  const showInlineLabels = entriesToDraw.length === 1;

  for (const { wire, a, b, midX, badgeY, desc, index } of entriesToDraw) {
    const isIssue = isIssueWire(wire, issueWireIds);
    const color = isIssue ? "#f85149" : (wire.color || "#58a6ff");
    const d = wirePathElbow(a, b);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", isIssue ? "2.75" : "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("class", isIssue ? "wdbg-focus-wire-base wdbg-focus-wire-base--issue" : "wdbg-focus-wire-base wdbg-focus-wire-base--ok");
    path.setAttribute("opacity", isIssue ? "0.55" : "0.35");
    wireLayer.appendChild(path);

    if (isIssue) {
      const flow = document.createElementNS("http://www.w3.org/2000/svg", "path");
      flow.setAttribute("d", d);
      flow.setAttribute("fill", "none");
      flow.setAttribute("stroke", color);
      flow.setAttribute("class", "wdbg-focus-wire-flow");
      flow.setAttribute("stroke-width", "3.5");
      flow.setAttribute("stroke-linecap", "round");
      flow.setAttribute("stroke-linejoin", "round");
      wireLayer.appendChild(flow);
    }

    appendPinDot(wireLayer, a.x, a.y, color);
    appendPinDot(wireLayer, b.x, b.y, color);

    if (entriesToDraw.length > 1) {
      appendWireBadge(wireLayer, midX, badgeY, index, isIssue);
    } else if (showInlineLabels) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(midX));
      label.setAttribute("y", String(badgeY - 10));
      label.setAttribute("class", "wdbg-focus-wire-label wdbg-focus-wire-label--issue");
      label.textContent = desc;
      wireLayer.appendChild(label);
    }
  }
  svg.appendChild(wireLayer);

  const partLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  partLayer.setAttribute("class", "wdbg-focus-parts");
  for (const comp of components) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", `wdbg-focus-part wdbg-focus-part--${comp.type || "sensor"}`);
    const fill = TYPE_COLORS[comp.type] || "#30363d";

    const href = partSkinHref(comp);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(comp.x));
    rect.setAttribute("y", String(comp.y));
    rect.setAttribute("width", String(comp.w));
    rect.setAttribute("height", String(comp.h));
    rect.setAttribute("rx", comp.type === "breadboard" ? "6" : "10");
    rect.setAttribute("fill", href ? "#0d1117" : fill);
    rect.setAttribute("stroke", "#aeb6c2");
    rect.setAttribute("stroke-width", "1.75");
    g.appendChild(rect);

    if (href) {
      const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
      img.setAttribute("href", href);
      img.setAttribute("x", String(comp.x + 3));
      img.setAttribute("y", String(comp.y + 3));
      img.setAttribute("width", String(Math.max(8, comp.w - 6)));
      img.setAttribute("height", String(Math.max(8, comp.h - 6)));
      img.setAttribute("preserveAspectRatio", "xMidYMid meet");
      g.appendChild(img);
    }

    const innerLabel = splitLabel(displayPartLabel(comp), comp.type === "breadboard" ? 8 : 14);
    if (!href && (comp.type === "breadboard" || innerLabel.length === 1)) {
      innerLabel.forEach((line, i) => {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", String(comp.x + comp.w / 2));
        t.setAttribute("y", String(comp.y + comp.h / 2 + (i - (innerLabel.length - 1) / 2) * 13));
        t.setAttribute("class", "wdbg-focus-part-inline");
        t.textContent = comp.type === "breadboard" ? "+/−" : line;
        g.appendChild(t);
      });
    }

    if (!href && comp.type === "breadboard") {
      const railPlus = document.createElementNS("http://www.w3.org/2000/svg", "line");
      railPlus.setAttribute("x1", String(comp.x + 6));
      railPlus.setAttribute("y1", String(comp.y + 8));
      railPlus.setAttribute("x2", String(comp.x + comp.w - 6));
      railPlus.setAttribute("y2", String(comp.y + 8));
      railPlus.setAttribute("class", "wdbg-focus-bb-rail-plus");
      g.appendChild(railPlus);
      const railMinus = document.createElementNS("http://www.w3.org/2000/svg", "line");
      railMinus.setAttribute("x1", String(comp.x + 6));
      railMinus.setAttribute("y1", String(comp.y + comp.h - 8));
      railMinus.setAttribute("x2", String(comp.x + comp.w - 6));
      railMinus.setAttribute("y2", String(comp.y + comp.h - 8));
      railMinus.setAttribute("class", "wdbg-focus-bb-rail-minus");
      g.appendChild(railMinus);
    }

    const lines = splitLabel(displayPartLabel(comp), 22);
    lines.forEach((line, i) => {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(comp.x + comp.w / 2));
      label.setAttribute("y", String(comp.y + comp.h + 16 + i * 14));
      label.setAttribute("class", "wdbg-focus-part-label");
      label.textContent = line;
      g.appendChild(label);
    });

    partLayer.appendChild(g);
  }
  svg.appendChild(partLayer);
  wrap.appendChild(svg);

  if (wireEntries.length) {
    const issueEntries = wireEntries.filter(({ wire }) => isIssueWire(wire, issueWireIds));

    if (issueEntries.length) {
      const heading = document.createElement("div");
      heading.className = "wdbg-focus-legend-heading wdbg-focus-legend-heading--issue";
      heading.textContent =
        issueEntries.length === 1 ? "Fix this connection" : "Fix these connections";
      wrap.appendChild(heading);
      const legend = document.createElement("ul");
      legend.className = "wdbg-focus-wire-legend wdbg-focus-wire-legend--issue";
      for (const { wire, desc, index } of issueEntries) {
        const li = document.createElement("li");
        if (issueEntries.length > 1) {
          const num = document.createElement("span");
          num.className = "wdbg-focus-wire-num";
          num.textContent = String(index);
          li.appendChild(num);
        }
        const swatch = document.createElement("span");
        swatch.className = "wdbg-focus-wire-swatch wdbg-focus-wire-swatch--issue";
        li.appendChild(swatch);
        const text = document.createElement("span");
        text.textContent = desc;
        li.appendChild(text);
        legend.appendChild(li);
      }
      wrap.appendChild(legend);
    } else if (focusDiagram?.caption) {
      const note = document.createElement("p");
      note.className = "wdbg-focus-caption-only";
      note.textContent = focusDiagram.caption;
      wrap.appendChild(note);
    }
  }

  container.classList.remove("wdbg-focus-diagram--empty");
  container.appendChild(wrap);
}
