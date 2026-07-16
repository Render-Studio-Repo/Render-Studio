/** Cirkit-style drag-and-drop wiring canvas (boards, breadboard, wires). */

import { resolveIssueWireIds } from "./wiring-focus-diagram.js?v=20260619-readable";

import { recognizePart, prettyPartLabel } from "./part-catalog.js?v=20260715-elec-none";

const PALETTE = [
  { type: "raspberry-pi", label: "Raspberry Pi", w: 148, h: 188, color: "#c51a4a" },
  { type: "arduino-uno", label: "Arduino Uno", w: 140, h: 90, color: "#00979d" },
  { type: "arduino-mega", label: "Arduino Mega", w: 180, h: 100, color: "#008184" },
  { type: "servo-motor", label: "Servo motor", w: 80, h: 80, color: "#3fb950" },
  { type: "stepper", label: "Stepper motor", w: 78, h: 78, color: "#6e7681" },
  { type: "motor-driver", label: "Motor / stepper driver", w: 104, h: 92, color: "#21262d" },
  { type: "motor", label: "DC Motor", w: 56, h: 56, color: "#2ea043" },
  { type: "led", label: "LED", w: 36, h: 36, color: "#e3b341" },
  { type: "resistor", label: "Resistor", w: 64, h: 20, color: "#d4a574" },
  { type: "transistor", label: "NPN transistor", w: 48, h: 56, color: "#21262d" },
  { type: "diode", label: "Diode", w: 52, h: 20, color: "#484f58" },
  { type: "button", label: "Push button", w: 44, h: 44, color: "#8b949e" },
  { type: "sensor", label: "Sensor", w: 56, h: 48, color: "#58a6ff" },
  { type: "breadboard", label: "Breadboard", w: 200, h: 120, color: "#f0f0f0" },
];

function componentType(componentOrType) {
  return typeof componentOrType === "string" ? componentOrType : componentOrType?.type;
}

function driverFlavor(componentOrType) {
  if (typeof componentOrType === "string") return "";
  const label = String(componentOrType?.label || "");
  if (/drv8825/i.test(label)) return "drv8825";
  if (/a4988/i.test(label)) return "a4988";
  if (/tb6600/i.test(label)) return "tb6600";
  if (/uln2003/i.test(label)) return "uln2003";
  if (/l298/i.test(label)) return "l298n";
  return "";
}

function isStepDirShield(componentOrType) {
  const flavor = driverFlavor(componentOrType);
  return flavor === "drv8825" || flavor === "a4988";
}

function readableComponentSize(component) {
  const w = Number(component.w) || 80;
  const h = Number(component.h) || 48;
  if (isStepDirShield(component)) {
    return { w: Math.max(w, 340), h: Math.max(h, 230) };
  }
  return { w, h };
}

const DRIVER_LAYOUT_SANITY_CASES = [
  {
    name: "DRV8825 shield",
    component: {
      type: "motor-driver",
      label: "DRV8825 Shield",
      pin_labels: { in1: "S", in2: "DIR", in3: "EN", in4: "MS", vcc: "V", gnd: "G" },
    },
    required: ["in1", "in2", "in3", "in4", "vcc", "gnd", "out1", "out2", "out3", "out4"],
    headerRows: [["in1", "vcc", "gnd"], ["in2", "dir_v", "dir_g"], ["in3", "en_v", "en_g"]],
    maxPowerY: 0.35,
  },
  {
    name: "A4988 carrier",
    component: { type: "motor-driver", label: "A4988" },
    required: ["in1", "in2", "vcc", "gnd", "out1", "out2", "out3", "out4"],
    headerRows: [["in1", "vcc", "gnd"], ["in2", "dir_v", "dir_g"], ["in3", "en_v", "en_g"]],
    maxPowerY: 0.35,
  },
  {
    name: "ULN2003 board",
    component: { type: "motor-driver", label: "ULN2003" },
    required: ["in1", "in2", "in3", "in4", "vcc", "gnd"],
  },
  {
    name: "L298N module",
    component: { type: "motor-driver", label: "L298N" },
    required: ["in1", "in2", "in3", "in4", "vcc", "gnd", "out1", "out2", "out3", "out4"],
  },
  {
    name: "TB6600 driver",
    component: { type: "motor-driver", label: "TB6600" },
    required: ["in1", "in2", "in3", "gnd", "out1", "out2", "out3", "out4"],
  },
];

function pinLayout(componentOrType) {
  const type = componentType(componentOrType);
  if (type === "breadboard") {
    const pins = [];
    const cols = 15;
    for (let i = 0; i < cols; i++) {
      const x = 0.06 + (i / (cols - 1)) * 0.88;
      pins.push({ id: `t+_${i}`, x, y: 0.06, label: "+", rail: "plus" });
      pins.push({ id: `t-_${i}`, x, y: 0.94, label: "−", rail: "minus" });
    }
    const rows = "abcdefghij";
    for (let r = 0; r < rows.length; r++) {
      for (let c = 1; c <= cols; c++) {
        const id = `${rows[r]}${c}`;
        pins.push({
          id,
          x: 0.06 + ((c - 1) / (cols - 1)) * 0.88,
          y: 0.22 + (r / (rows.length - 1)) * 0.68,
          hole: true,
        });
      }
    }
    return pins;
  }
  if (type === "resistor") {
    return [
      { id: "a", x: 0.08, y: 0.5, label: "a" },
      { id: "b", x: 0.92, y: 0.5, label: "b" },
    ];
  }
  if (type === "transistor") {
    return [
      { id: "base", x: 0.5, y: 0.92, label: "B" },
      { id: "collector", x: 0.15, y: 0.35, label: "C" },
      { id: "emitter", x: 0.85, y: 0.35, label: "E" },
    ];
  }
  if (type === "diode") {
    return [
      { id: "anode", x: 0.1, y: 0.5, label: "A" },
      { id: "cathode", x: 0.9, y: 0.5, label: "K" },
    ];
  }
  if (type === "motor") {
    return [
      { id: "plus", x: 0.15, y: 0.5, label: "+" },
      { id: "minus", x: 0.85, y: 0.5, label: "−" },
      { id: "a", x: 0.15, y: 0.5, label: "A" },
      { id: "b", x: 0.85, y: 0.5, label: "B" },
    ];
  }
  if (type === "stepper") {
    return [
      { id: "in1", x: 0.2, y: 0.96, label: "1" },
      { id: "in2", x: 0.4, y: 0.96, label: "2" },
      { id: "in3", x: 0.6, y: 0.96, label: "3" },
      { id: "in4", x: 0.8, y: 0.96, label: "4" },
    ];
  }
  if (type === "motor-driver") {
    const explicitLabels = typeof componentOrType === "string" ? null : componentOrType?.pin_labels;
    const flavor = driverFlavor(componentOrType);
    if (isStepDirShield(componentOrType)) {
      // Keep the generic ids for saved-schema compatibility, but label them as
      // the real STEP/DIR shield pins shown on DRV8825/A4988 expansion boards.
      const sigX = 0.18;
      const vX = 0.34;
      const gX = 0.5;
      const stepY = 0.3;
      const dirY = 0.48;
      const enY = 0.66;
      const headerPin = { compactLabel: true };
      return [
        { id: "in1", x: sigX, y: stepY, label: explicitLabels?.in1 || "S", title: "STEP signal", ...headerPin },
        { id: "vcc", x: vX, y: stepY, label: explicitLabels?.vcc || "V", title: "5V logic", ...headerPin },
        { id: "gnd", x: gX, y: stepY, label: explicitLabels?.gnd || "G", title: "Common ground", ...headerPin },
        { id: "in2", x: sigX, y: dirY, label: explicitLabels?.in2 || "DIR", displayLabel: "S", title: "DIR signal", ...headerPin },
        { id: "dir_v", x: vX, y: dirY, label: explicitLabels?.vcc || "V", title: "5V logic for DIR header", ...headerPin },
        { id: "dir_g", x: gX, y: dirY, label: explicitLabels?.gnd || "G", title: "GND for DIR header", ...headerPin },
        { id: "in3", x: sigX, y: enY, label: explicitLabels?.in3 || "EN", displayLabel: "S", title: "Enable signal", ...headerPin },
        { id: "en_v", x: vX, y: enY, label: explicitLabels?.vcc || "V", title: "5V logic for EN header", ...headerPin },
        { id: "en_g", x: gX, y: enY, label: explicitLabels?.gnd || "G", title: "GND for EN header", ...headerPin },
        { id: "in4", x: sigX, y: 0.84, label: explicitLabels?.in4 || "MS", title: "Microstep select" },
        { id: "out1", x: 0.86, y: 0.24, label: explicitLabels?.out1 || "A1" },
        { id: "out2", x: 0.86, y: 0.4, label: explicitLabels?.out2 || "A2" },
        { id: "out3", x: 0.86, y: 0.56, label: explicitLabels?.out3 || "B1" },
        { id: "out4", x: 0.86, y: 0.72, label: explicitLabels?.out4 || "B2" },
        { id: "in", x: sigX, y: stepY, label: "", alias: true },
        { id: "mot_a", x: 0.86, y: 0.24, label: "", alias: true },
        { id: "mot_b", x: 0.86, y: 0.4, label: "", alias: true },
      ];
    }
    // Controller-side inputs on the left, motor-side outputs on the right,
    // power along the bottom. Legacy ids (in / mot_a / mot_b) overlap channel 1
    // for backward compatibility with older saved schematics.
    return [
      { id: "in1", x: 0.06, y: 0.16, label: "IN1" },
      { id: "in2", x: 0.06, y: 0.34, label: "IN2" },
      { id: "in3", x: 0.06, y: 0.52, label: "IN3" },
      { id: "in4", x: 0.06, y: 0.7, label: "IN4" },
      { id: "vcc", x: 0.34, y: 0.95, label: "VCC" },
      { id: "gnd", x: 0.66, y: 0.95, label: "GND" },
      { id: "out1", x: 0.94, y: 0.16, label: "O1" },
      { id: "out2", x: 0.94, y: 0.34, label: "O2" },
      { id: "out3", x: 0.94, y: 0.52, label: "O3" },
      { id: "out4", x: 0.94, y: 0.7, label: "O4" },
      { id: "in", x: 0.06, y: 0.16, label: "", alias: true },
      { id: "mot_a", x: 0.94, y: 0.16, label: "", alias: true },
      { id: "mot_b", x: 0.94, y: 0.34, label: "", alias: true },
    ];
  }
  if (type === "raspberry-pi") {
    return [
      { id: "5v", x: 0.06, y: 0.18, label: "5V" },
      { id: "3v3", x: 0.06, y: 0.32, label: "3V3" },
      { id: "gnd", x: 0.06, y: 0.46, label: "GND" },
      { id: "gpio18", x: 0.94, y: 0.22, label: "GPIO18" },
      { id: "gpio17", x: 0.94, y: 0.36, label: "GPIO17" },
      { id: "gpio27", x: 0.94, y: 0.5, label: "GPIO27" },
    ];
  }
  if (type === "servo-motor") {
    return [
      { id: "signal", x: 0.2, y: 0.92, label: "SIG" },
      { id: "vcc", x: 0.5, y: 0.92, label: "5V" },
      { id: "gnd", x: 0.8, y: 0.92, label: "GND" },
    ];
  }
  if (type.startsWith("arduino")) {
    // Two header rows along the long edges, like a real Nano/Uno breakout.
    return [
      // top digital header
      { id: "d13", x: 0.16, y: 0.085, label: "13" },
      { id: "d12", x: 0.3, y: 0.085, label: "12" },
      { id: "d11", x: 0.44, y: 0.085, label: "11" },
      { id: "d10", x: 0.58, y: 0.085, label: "10" },
      { id: "d9", x: 0.72, y: 0.085, label: "9" },
      { id: "d8", x: 0.86, y: 0.085, label: "8" },
      // bottom power / analog header
      { id: "5v", x: 0.16, y: 0.915, label: "5V" },
      { id: "gnd", x: 0.3, y: 0.915, label: "GND" },
      { id: "a0", x: 0.86, y: 0.915, label: "A0" },
    ];
  }
  if (type === "led") {
    return [
      { id: "anode", x: 0.2, y: 0.9, label: "+" },
      { id: "cathode", x: 0.8, y: 0.9, label: "−" },
    ];
  }
  if (type === "button") {
    return [
      { id: "1", x: 0.25, y: 0.9, label: "1" },
      { id: "2", x: 0.75, y: 0.9, label: "2" },
    ];
  }
  return [
    { id: "in", x: 0.1, y: 0.5, label: "in" },
    { id: "out", x: 0.9, y: 0.5, label: "out" },
  ];
}

function validateDriverPinLayout({ name, component, required = [], headerRows = [], maxPowerY = null }) {
  const pins = pinLayout(component);
  const errors = [];
  const byId = new Map();
  for (const pin of pins) {
    if (byId.has(pin.id)) errors.push(`duplicate pin id "${pin.id}"`);
    byId.set(pin.id, pin);
    if (pin.x < 0 || pin.x > 1 || pin.y < 0 || pin.y > 1) {
      errors.push(`${pin.id} coordinate out of bounds (${pin.x}, ${pin.y})`);
    }
    if (!pin.alias && !pin.hole && !String(pin.label || "").trim()) {
      errors.push(`${pin.id} has no visible label`);
    }
  }
  for (const id of required) {
    if (!byId.has(id)) errors.push(`missing required pin "${id}"`);
  }

  const visible = pins.filter((pin) => !pin.alias && !pin.hole);
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i];
      const b = visible[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < 0.055) errors.push(`${a.id} overlaps ${b.id}`);
    }
  }

  for (const row of headerRows) {
    const rowPins = row.map((id) => byId.get(id));
    if (rowPins.some((pin) => !pin)) {
      errors.push(`header row missing pin(s): ${row.join(", ")}`);
      continue;
    }
    const y = rowPins[0].y;
    if (rowPins.some((pin) => Math.abs(pin.y - y) > 0.001)) {
      errors.push(`header row is not aligned: ${row.join(", ")}`);
    }
    for (let i = 1; i < rowPins.length; i += 1) {
      if (rowPins[i].x <= rowPins[i - 1].x) {
        errors.push(`header row x-order is invalid: ${row.join(", ")}`);
        break;
      }
    }
  }
  if (maxPowerY != null) {
    for (const id of ["vcc", "gnd"]) {
      const pin = byId.get(id);
      if (pin && pin.y > maxPowerY) errors.push(`${id} is too low for header-style driver layout`);
    }
  }
  return errors.map((error) => `${name}: ${error}`);
}

function validateDriverPinLayouts() {
  const errors = DRIVER_LAYOUT_SANITY_CASES.flatMap(validateDriverPinLayout);
  if (errors.length) {
    console.warn("Wiring driver layout sanity check failed:", errors);
  }
}

validateDriverPinLayouts();

function uid() {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultControl(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function wirePathQuadratic(a, b, control) {
  const c = control || defaultControl(a, b);
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

function wirePathOrthogonal(a, b, liftY) {
  return `M ${a.x} ${a.y} L ${a.x} ${liftY} L ${b.x} ${liftY} L ${b.x} ${b.y}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function findBreadboard() {
  return componentsRef?.find((c) => c.type === "breadboard") || null;
}

let componentsRef = [];

export function createWiringSimulator(options = {}) {
  const { root, paletteEl, api, getProjectId, getWiringPrefetch, onChange, onHistoryChange } = options;

  let components = [];
  componentsRef = components;
  let wires = [];
  let schematicProjectId = null;
  let loadInFlight = null;
  const pinLayoutByComponentId = new Map();
  const pinPositionMap = new Map();
  let wiresRenderScheduled = false;
  let wireStart = null;
  let wireCreateDrag = null;
  let dragState = null;
  let wireDrag = null;
  let selectedWireId = null;
  let selectedPartIds = new Set();
  let selectedWireIds = new Set();
  let selectionDrag = null;
  let panDrag = null;
  let suppressNextCanvasClick = false;
  let suppressNextWireClick = false;
  let saveTimer = null;
  let focusWireIds = new Set();
  let localEditVersion = 0;
  let savedVersion = 0;
  let saveInFlight = null;
  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO = 80;
  let dragHistoryPushed = false;
  const world = { w: 2400, h: 1600 };
  const view = { scale: 1, x: 0, y: 0 };

  function wiringWorkspaceVisible() {
    const ws = document.getElementById("wiring-workspace");
    return !!(ws && !ws.classList.contains("hidden"));
  }

  const canvas = document.createElement("div");
  canvas.className = "wiring-canvas";
  canvas.tabIndex = 0;
  canvas.innerHTML = `
    <div class="wiring-drop-hint">
      <strong>Wiring Simulator</strong>
      <span>Drag components from the palette, or generate a schematic with Wiring AI (toolbelt or right panel).</span>
      <span class="wiring-drop-hint-sub">Wheel to zoom · drag pins to wire · drag empty space to select · Shift-drag to pan.</span>
    </div>
    <div class="wiring-parts-layer"></div>
    <svg class="wiring-wires" aria-hidden="true"></svg>
    <svg class="wiring-wire-preview" aria-hidden="true"></svg>
    <div class="wiring-pins-layer"></div>
    <div class="wiring-selection-box hidden"></div>
    <div class="wiring-notes hidden"></div>
    <div class="wiring-wire-editor hidden" role="dialog" aria-label="Wire label editor"></div>
  `;
  root?.appendChild(canvas);

  const partsLayer = canvas.querySelector(".wiring-parts-layer");
  const pinsLayer = canvas.querySelector(".wiring-pins-layer");
  const wiresSvg = canvas.querySelector(".wiring-wires");
  const previewSvg = canvas.querySelector(".wiring-wire-preview");
  const selectionBox = canvas.querySelector(".wiring-selection-box");
  const hint = canvas.querySelector(".wiring-drop-hint");
  const notesEl = canvas.querySelector(".wiring-notes");
  const wireEditorEl = canvas.querySelector(".wiring-wire-editor");
  const pinTooltipEl = document.createElement("div");
  pinTooltipEl.className = "wiring-pin-tooltip hidden";
  pinTooltipEl.setAttribute("role", "tooltip");
  document.body.appendChild(pinTooltipEl);
  let schematicMeta = { name: "", description: "", notes: [] };
  let notesCollapsed = true;
  notesEl?.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  notesEl?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.closest(".wiring-notes-toggle")) {
      notesCollapsed = !notesCollapsed;
      renderNotes();
    }
  });

  function syncComponentsRef() {
    componentsRef = components;
  }

  /* ── simulation animation ─────────────────────────────────────────────── */
  const actuatorStates = new Map();
  let animating = false;
  let animRAF = null;
  let lastFrame = 0;
  let runtimeLogger = null;

  function componentLabel(id) {
    const c = components.find((part) => part.id === id);
    return c?.label || c?.type || "actuator";
  }

  function emitRuntimeLog(message, kind = "info") {
    runtimeLogger?.(message, kind);
  }

  function setActuatorState(id, patch) {
    const prev = actuatorStates.get(id) || {};
    const next = { ...prev, ...patch };
    if (patch?.targetAngle !== undefined && prev.targetAngle !== patch.targetAngle) {
      next._loggedTurns = Math.trunc(Math.abs(prev._angle || 0) / 360);
    }
    if (patch?.active !== undefined && patch.active !== prev.active && !patch.active) {
      next._loggedTurns = Math.trunc(Math.abs(prev._angle || 0) / 360);
    }
    actuatorStates.set(id, next);
    if (!animating) beginSimulation();
  }

  function beginSimulation() {
    animating = true;
    lastFrame = 0;
    canvas.classList.add("wiring-simulating");
    if (!animRAF) animRAF = requestAnimationFrame(animationFrame);
  }

  function endSimulation() {
    animating = false;
    if (animRAF) {
      cancelAnimationFrame(animRAF);
      animRAF = null;
    }
    canvas.classList.remove("wiring-simulating");
    actuatorStates.clear();
    partsLayer.querySelectorAll(".wiring-rotor, .wiring-servo-horn").forEach((el) => {
      el.style.transform = "";
    });
    partsLayer.querySelectorAll(".wiring-part").forEach((el) => {
      el.classList.remove("wiring-part--active", "wiring-part--lit");
    });
    partsLayer.querySelectorAll(".wiring-vis-led-dome").forEach((el) => {
      el.classList.remove("lit");
      el.style.opacity = "";
    });
  }

  function animationFrame(ts) {
    const dt = lastFrame ? Math.min((ts - lastFrame) / 1000, 0.1) : 0;
    lastFrame = ts;
    for (const [id, st] of actuatorStates) {
      const partEl = partsLayer.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (!partEl) continue;
      if (st.type === "motor") {
        const rotor = partEl.querySelector(".wiring-rotor");
        const rpm = st.active ? Math.max(0, (st.duty ?? 1)) * 320 : 0;
        if (rpm > 0.1) st._angle = (st._angle || 0) + rpm * 6 * dt;
        const turns = Math.trunc(Math.abs(st._angle || 0) / 360);
        if (rpm > 0.1 && turns > (st._loggedTurns || 0)) {
          st._loggedTurns = turns;
          emitRuntimeLog(`${componentLabel(id)}: completed turn ${turns} (${Math.round(rpm)} RPM simulated).`, "ok");
        }
        if (rotor) rotor.style.transform = `rotate(${st._angle || 0}deg)`;
        partEl.classList.toggle("wiring-part--active", rpm > 0.1);
      } else if (st.type === "stepper") {
        const rotor = partEl.querySelector(".wiring-rotor");
        const target = st.targetAngle || 0;
        const cur = st._angle || 0;
        const diff = target - cur;
        if (Math.abs(diff) > 0.05) st._angle = cur + diff * Math.min(1, dt * 10);
        else st._angle = target;
        const turns = Math.trunc(Math.abs(st._angle || 0) / 360);
        if (turns > (st._loggedTurns || 0)) {
          st._loggedTurns = turns;
          const dir = (st.targetAngle || 0) >= 0 ? "forward" : "reverse";
          emitRuntimeLog(`${componentLabel(id)}: completed ${dir} turn ${turns} (2048 steps/rev).`, "ok");
        }
        if (rotor) rotor.style.transform = `rotate(${st._angle || 0}deg)`;
        partEl.classList.toggle("wiring-part--active", Math.abs(diff) > 0.5);
      } else if (st.type === "servo") {
        const horn = partEl.querySelector(".wiring-servo-horn");
        const target = clamp(st.angle || 0, 0, 180);
        const cur = st._angle ?? target;
        const diff = target - cur;
        if (Math.abs(diff) > 0.1) st._angle = cur + diff * Math.min(1, dt * 7);
        else st._angle = target;
        const bucket = Math.round((st._angle || 0) / 15) * 15;
        if (Math.abs(diff) > 0.5 && bucket !== st._loggedBucket) {
          st._loggedBucket = bucket;
          emitRuntimeLog(`${componentLabel(id)}: servo at ${Math.round(st._angle || 0)}°.`, "info");
        }
        if (horn) horn.style.transform = `translate(-50%, -100%) rotate(${(st._angle || 0) - 90}deg)`;
        partEl.classList.toggle("wiring-part--active", Math.abs(diff) > 0.5);
      } else if (st.type === "led") {
        const dome = partEl.querySelector(".wiring-vis-led-dome");
        if (dome) {
          dome.classList.toggle("lit", !!st.lit);
          dome.style.opacity = st.lit ? "1" : "0.4";
        }
        if (!!st.lit !== !!st._loggedLit) {
          st._loggedLit = !!st.lit;
          emitRuntimeLog(`${componentLabel(id)}: LED ${st.lit ? "HIGH / on" : "LOW / off"}.`, "info");
        }
        partEl.classList.toggle("wiring-part--lit", !!st.lit);
      }
    }
    if (animating) animRAF = requestAnimationFrame(animationFrame);
    else animRAF = null;
  }

  function applyViewTransform() {
    const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    for (const layer of [partsLayer, pinsLayer, wiresSvg, previewSvg]) {
      if (!layer) continue;
      layer.style.transform = transform;
      layer.style.transformOrigin = "0 0";
      layer.style.width = `${world.w}px`;
      layer.style.height = `${world.h}px`;
    }
    canvas.style.setProperty("--wiring-grid-size", `${20 * view.scale}px`);
    canvas.style.setProperty("--wiring-grid-x", `${view.x}px`);
    canvas.style.setProperty("--wiring-grid-y", `${view.y}px`);
  }

  function clientToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }

  function clientToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function worldToCanvas(x, y) {
    return {
      x: x * view.scale + view.x,
      y: y * view.scale + view.y,
    };
  }

  function fitView() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (!components.length) {
      view.scale = 1;
      view.x = 0;
      view.y = 0;
      applyViewTransform();
      renderWires();
      return;
    }
    const pad = 100;
    const minX = Math.min(...components.map((c) => c.x)) - pad;
    const minY = Math.min(...components.map((c) => c.y)) - pad;
    const maxX = Math.max(...components.map((c) => c.x + c.w)) + pad;
    const maxY = Math.max(...components.map((c) => c.y + c.h)) + pad;
    const scale = clamp(Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)), 0.35, 1.6);
    view.scale = scale;
    view.x = (rect.width - (maxX - minX) * scale) / 2 - minX * scale;
    view.y = (rect.height - (maxY - minY) * scale) / 2 - minY * scale;
    applyViewTransform();
    renderWires();
  }

  function clearSelection() {
    selectedPartIds = new Set();
    selectedWireIds = new Set();
    selectedWireId = null;
  }

  function selectWire(wireId, additive = false) {
    if (!additive) {
      selectedPartIds = new Set();
      selectedWireIds = new Set();
    }
    selectedWireIds.add(wireId);
    selectedWireId = wireId;
  }

  function pinInfo(ref) {
    const comp = components.find((c) => c.id === ref?.componentId);
    const pin = comp ? pinLayout(comp).find((p) => p.id === ref?.pinId) : null;
    return {
      component: comp,
      pin,
      componentLabel: comp?.label || comp?.type || "Unknown component",
      pinLabel: pin?.label || ref?.pinId || "pin",
    };
  }

  function closeWireEditor() {
    if (!wireEditorEl) return;
    wireEditorEl.classList.add("hidden");
    wireEditorEl.innerHTML = "";
  }

  function openWireEditor(wireId, anchor = null) {
    const wire = wires.find((w) => w.id === wireId);
    if (!wire || !wireEditorEl) return;
    selectWire(wire.id);
    const from = pinInfo(wire.from);
    const to = pinInfo(wire.to);
    const wireIndex = wires.findIndex((w) => w.id === wire.id);
    const a = pinPosition(wire.from.componentId, wire.from.pinId);
    const b = pinPosition(wire.to.componentId, wire.to.pinId);
    const handle = anchor || (a && b ? wireGeometry(wire, wireIndex, a, b).handle : { x: 240, y: 140 });
    const screen = worldToCanvas(handle.x, handle.y);
    wireEditorEl.style.left = `${clamp(screen.x + 12, 12, Math.max(12, canvas.clientWidth - 336))}px`;
    wireEditorEl.style.top = `${clamp(screen.y - 34, 12, Math.max(12, canvas.clientHeight - 260))}px`;
    const WIRE_COLOR_PRESETS = [
      { color: "#f85149", label: "5V power" },
      { color: "#6e7681", label: "GND" },
      { color: "#58a6ff", label: "Signal / PWM" },
      { color: "#3fb950", label: "Data" },
      { color: "#d29922", label: "Auxiliary" },
      { color: "#f0883e", label: "3.3V" },
      { color: "#bc8cff", label: "I²C / SPI" },
      { color: "#ffffff", label: "White" },
    ];
    const curColor = wire.color || "#58a6ff";
    wireEditorEl.innerHTML = `
      <div class="wire-editor-head">
        <div>
          <strong>Edit wire</strong>
          <span>${escapeHtml(from.pinLabel)} → ${escapeHtml(to.pinLabel)}</span>
        </div>
        <button type="button" class="wire-editor-close" aria-label="Close">×</button>
      </div>
      <label class="wire-editor-field">
        <span>Label</span>
        <input class="wire-label-input" type="text" value="${escapeHtml(wire.label || "")}" placeholder="e.g. IN2, coil 2, common GND" />
      </label>
      <div class="wire-editor-field">
        <span>Color</span>
        <div class="wire-color-presets">
          ${WIRE_COLOR_PRESETS.map(({ color, label }) =>
            `<button type="button" class="wire-color-swatch${color === curColor ? " active" : ""}" data-color="${escapeHtml(color)}" style="background:${escapeHtml(color)}" title="${escapeHtml(label)}"></button>`
          ).join("")}
          <input type="color" class="wire-color-custom" value="${escapeHtml(curColor)}" title="Custom color" />
        </div>
      </div>
      <div class="wire-editor-connections">
        <div><span>From</span><strong>${escapeHtml(from.componentLabel)}</strong><em>${escapeHtml(from.pinLabel)} · ${escapeHtml(wire.from.pinId)}</em></div>
        <div><span>To</span><strong>${escapeHtml(to.componentLabel)}</strong><em>${escapeHtml(to.pinLabel)} · ${escapeHtml(wire.to.pinId)}</em></div>
      </div>
      <div class="wire-editor-actions">
        <button type="button" class="btn secondary wire-editor-cancel">Cancel</button>
        <button type="button" class="btn accent wire-editor-save">Save</button>
      </div>
    `;
    wireEditorEl.classList.remove("hidden");
    const labelInput = wireEditorEl.querySelector(".wire-label-input");
    const colorCustom = wireEditorEl.querySelector(".wire-color-custom");
    let pendingColor = curColor;

    // Preset swatch click
    wireEditorEl.querySelectorAll(".wire-color-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingColor = btn.dataset.color;
        colorCustom.value = pendingColor;
        wireEditorEl.querySelectorAll(".wire-color-swatch").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        // Live preview
        wire.color = pendingColor;
        renderWires();
      });
    });

    // Custom color input – live preview
    colorCustom.addEventListener("input", () => {
      pendingColor = colorCustom.value;
      wireEditorEl.querySelectorAll(".wire-color-swatch").forEach((b) => b.classList.remove("active"));
      wire.color = pendingColor;
      renderWires();
    });

    const save = () => {
      pushHistory();
      wire.label = labelInput?.value?.trim() ?? "";
      wire.color = pendingColor;
      closeWireEditor();
      renderWires();
      scheduleSave();
    };
    const cancel = () => {
      // Revert live preview
      wire.color = curColor;
      renderWires();
      closeWireEditor();
    };
    wireEditorEl.querySelector(".wire-editor-close")?.addEventListener("click", cancel);
    wireEditorEl.querySelector(".wire-editor-cancel")?.addEventListener("click", cancel);
    wireEditorEl.querySelector(".wire-editor-save")?.addEventListener("click", save);
    labelInput?.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") save();
      if (e.key === "Escape") cancel();
    });
    labelInput?.focus();
    labelInput?.select();
    renderWires();
    renderSelectedParts();
  }

  function selectPart(partId, additive = false) {
    if (!additive) {
      selectedPartIds = new Set();
      selectedWireIds = new Set();
      selectedWireId = null;
    }
    if (additive && selectedPartIds.has(partId)) selectedPartIds.delete(partId);
    else selectedPartIds.add(partId);
  }

  function captureSnapshot() {
    return {
      schematicMeta: {
        name: schematicMeta.name,
        description: schematicMeta.description,
        notes: [...(schematicMeta.notes || [])],
      },
      components: components.map((c) => ({ ...c })),
      wires: wires.map((w) => ({
        ...w,
        from: { ...w.from },
        to: { ...w.to },
        control: w.control ? { ...w.control } : null,
      })),
    };
  }

  function notifyHistoryChange() {
    onHistoryChange?.(getHistoryState());
  }

  function pushHistory() {
    focusWireIds = new Set();
    undoStack.push(captureSnapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    notifyHistoryChange();
  }

  function restoreSnapshot(snap) {
    if (!snap) return;
    applySchematic(
      {
        name: snap.schematicMeta.name,
        description: snap.schematicMeta.description,
        notes: snap.schematicMeta.notes,
        components: snap.components,
        wires: snap.wires,
      },
      { save: false, skipHistory: true },
    );
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(captureSnapshot());
    restoreSnapshot(undoStack.pop());
    scheduleSave();
    notifyHistoryChange();
    onChange?.({ components, wires });
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(captureSnapshot());
    restoreSnapshot(redoStack.pop());
    scheduleSave();
    notifyHistoryChange();
    onChange?.({ components, wires });
    return true;
  }

  function clearHistory() {
    undoStack = [];
    redoStack = [];
    notifyHistoryChange();
  }

  function summarizeSnapshot(snap, index, side) {
    const name = snap?.schematicMeta?.name || (side === "undo" ? `Edit checkpoint ${index + 1}` : `Redo checkpoint ${index + 1}`);
    return {
      id: `${side}-${index}`,
      side,
      label: name,
      componentCount: snap?.components?.length || 0,
      wireCount: snap?.wires?.length || 0,
    };
  }

  function getHistoryState() {
    return {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoCount: undoStack.length,
      redoCount: redoStack.length,
      current: {
        label: schematicMeta.name || "Current wiring",
        description: schematicMeta.description || "",
        componentCount: components.length,
        wireCount: wires.length,
      },
      undo: undoStack.map((snap, i) => summarizeSnapshot(snap, i, "undo")),
      redo: redoStack.map((snap, i) => summarizeSnapshot(snap, i, "redo")),
    };
  }

  function renderPalette() {
    if (!paletteEl) return;
    paletteEl.innerHTML = "<h3>Components</h3>";
    for (const item of PALETTE) {
      const chip = document.createElement("div");
      chip.className = "wiring-palette-item";
      chip.draggable = true;
      chip.dataset.componentType = item.type;
      chip.innerHTML = `<span class="wiring-palette-swatch" style="background:${item.color}"></span>${item.label}`;
      chip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-wiring-part", item.type);
        e.dataTransfer.effectAllowed = "copy";
      });
      paletteEl.appendChild(chip);
    }
  }

  function markDirty() {
    localEditVersion += 1;
    return localEditVersion;
  }

  function scheduleSave(delayMs = 600) {
    markDirty();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, delayMs);
  }

  async function save() {
    const projectId = getProjectId?.();
    if (!projectId || !api) return false;
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saveInFlight) {
      const ok = await saveInFlight;
      if (!ok || localEditVersion <= savedVersion) return ok;
      return save();
    }
    const version = localEditVersion;
    const payload = {
      name: schematicMeta.name,
      description: schematicMeta.description,
      notes: schematicMeta.notes,
      components: components.map((c) => ({ ...c })),
      wires: wires.map((w) => ({
        ...w,
        from: { ...w.from },
        to: { ...w.to },
        control: w.control ? { ...w.control } : null,
      })),
    };
    saveInFlight = (async () => {
      await api(`/api/projects/${projectId}/wiring`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      savedVersion = Math.max(savedVersion, version);
      onChange?.({ components, wires });
      return true;
    })();
    try {
      return await saveInFlight;
    } catch (err) {
      console.warn("wiring autosave failed", err);
      return false;
    } finally {
      saveInFlight = null;
    }
  }

  function clearPinCaches() {
    pinLayoutByComponentId.clear();
    pinPositionMap.clear();
  }

  function getPinLayout(c) {
    if (!c?.id) return pinLayout(c);
    const sig = `${c.type}|${c.w}|${c.h}|${c.label}|${JSON.stringify(c.pin_labels || {})}`;
    const cached = pinLayoutByComponentId.get(c.id);
    if (cached?.sig === sig) return cached.layout;
    const layout = pinLayout(c);
    pinLayoutByComponentId.set(c.id, { sig, layout });
    return layout;
  }

  function rebuildPinPositionMap() {
    pinPositionMap.clear();
    for (const c of components) {
      for (const pin of getPinLayout(c)) {
        pinPositionMap.set(`${c.id}|${pin.id}`, {
          x: c.x + c.w * pin.x,
          y: c.y + c.h * pin.y,
        });
      }
    }
  }

  function scheduleRenderWires() {
    if (wiresRenderScheduled) return;
    wiresRenderScheduled = true;
    requestAnimationFrame(() => {
      wiresRenderScheduled = false;
      renderWires();
    });
  }

  async function fetchWiringData(projectId) {
    const prefetch = getWiringPrefetch?.();
    if (prefetch?.projectId === projectId && prefetch.data) {
      return prefetch.data;
    }
    if (prefetch?.projectId === projectId && prefetch.promise) {
      try {
        return await prefetch.promise;
      } catch {
        return { components: [], wires: [], notes: [] };
      }
    }
    try {
      return await api(`/api/projects/${projectId}/wiring`);
    } catch {
      return { components: [], wires: [], notes: [] };
    }
  }

  async function load() {
    const projectId = getProjectId?.();
    if (!projectId || !api) return;
    if (loadInFlight?.projectId === projectId) return loadInFlight.promise;

    const run = async () => {
      const needsSave = schematicProjectId === projectId
        && (localEditVersion > savedVersion || saveInFlight);
      const prefetch = getWiringPrefetch?.();
      const cached = prefetch?.projectId === projectId ? prefetch.data : null;

      if (!needsSave && cached) {
        clearHistory();
        applySchematic(cached, { save: false, skipHistory: true, deferWires: true });
        schematicProjectId = projectId;
        savedVersion = localEditVersion;
        requestAnimationFrame(fitView);
        notifyHistoryChange();
        return;
      }

      if (needsSave) {
        const saved = await save();
        if (!saved) return;
      }
      clearHistory();
      const data = cached || await fetchWiringData(projectId);
      applySchematic(data, { save: false, skipHistory: true, deferWires: true });
      schematicProjectId = projectId;
      savedVersion = localEditVersion;
      requestAnimationFrame(fitView);
      notifyHistoryChange();
    };

    const promise = run();
    loadInFlight = { projectId, promise };
    try {
      await promise;
    } finally {
      if (loadInFlight?.projectId === projectId) loadInFlight = null;
    }
  }

  function renderNotes() {
    if (!notesEl) return;
    const notes = schematicMeta.notes || [];
    if (!notes.length && !schematicMeta.name) {
      notesEl.classList.add("hidden");
      notesEl.innerHTML = "";
      return;
    }
    notesEl.classList.remove("hidden");
    notesEl.classList.toggle("collapsed", notesCollapsed);
    const titleText = schematicMeta.name || "Wiring notes";
    const title = `<strong>${escapeHtml(titleText)}</strong>`;
    const desc = schematicMeta.description ? `<p class="wiring-notes-desc">${escapeHtml(schematicMeta.description)}</p>` : "";
    const list = notes.length
      ? `<ul>${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
      : "";
    notesEl.innerHTML = `
      <button type="button" class="wiring-notes-toggle" aria-expanded="${notesCollapsed ? "false" : "true"}" aria-label="${notesCollapsed ? "Expand" : "Collapse"} schematic notes">
        <span aria-hidden="true">${notesCollapsed ? "▾" : "▴"}</span>
        ${title}
      </button>
      <div class="wiring-notes-body">${desc}${list}</div>`;
  }

  function normalizeEndpointLabel(label) {
    return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function wireEndpointKey(comps, end, { loose = false } = {}) {
    const comp = comps.find((c) => c.id === end?.componentId);
    if (!comp || !end?.pinId) return "";
    const pin = String(end.pinId).toLowerCase();
    if (loose) return `${comp.type}|${pin}`;
    return `${comp.type}|${normalizeEndpointLabel(comp.label)}|${pin}`;
  }

  function wirePairKey(comps, wire, opts) {
    const a = wireEndpointKey(comps, wire.from, opts);
    const b = wireEndpointKey(comps, wire.to, opts);
    if (!a || !b) return "";
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  function matchFocusIssueWireIds(focusSchematic, meta = {}) {
    const issueIds = resolveIssueWireIds(
      { schematic: focusSchematic, issue_wire_ids: meta.issue_wire_ids },
      meta.issues || [],
    );
    const focusWires = (focusSchematic?.wires || []).filter((w) => issueIds.has(String(w.id)));
    const focusComponents = focusSchematic?.components || [];
    if (!focusWires.length || !wires.length) return new Set();

    const tryMatch = (loose) => {
      const pairs = new Set(
        focusWires.map((w) => wirePairKey(focusComponents, w, { loose })).filter(Boolean),
      );
      const ids = new Set();
      for (const w of wires) {
        const key = wirePairKey(components, w, { loose });
        if (key && pairs.has(key)) ids.add(w.id);
      }
      return ids;
    };

    const strict = tryMatch(false);
    if (strict.size) return strict;
    return tryMatch(true);
  }

  function clearFocusWireHighlight() {
    if (!focusWireIds.size) return;
    focusWireIds = new Set();
    renderWires();
  }

  function setFocusWireHighlight(ids) {
    focusWireIds = new Set(Array.isArray(ids) ? ids : [...ids]);
    renderWires();
  }

  function applyFocusPath(focusSchematic, meta = {}) {
    if (!focusSchematic) return { matched: 0, mode: "none" };

    const issueIds = resolveIssueWireIds(
      { schematic: focusSchematic, issue_wire_ids: meta.issue_wire_ids },
      meta.issues || [],
    );

    const matched = matchFocusIssueWireIds(focusSchematic, meta);
    if (matched.size > 0) {
      focusWireIds = matched;
      if (meta.title || meta.caption) {
        schematicMeta = {
          ...schematicMeta,
          name: meta.title || schematicMeta.name,
          description: meta.caption || schematicMeta.description,
        };
        const note = `Debugger: ${matched.size} problem wire${matched.size === 1 ? "" : "s"} marked with animated dashes — fix these first.`;
        const notes = Array.isArray(schematicMeta.notes) ? [...schematicMeta.notes] : [];
        if (!notes.includes(note)) notes.unshift(note);
        schematicMeta.notes = notes;
        notesCollapsed = true;
        renderNotes();
      }
      renderWires();
      requestAnimationFrame(fitView);
      return { matched: matched.size, mode: "highlight" };
    }

    const merged = {
      ...focusSchematic,
      name: meta.title || focusSchematic.name || "Debug focus path",
      description: meta.caption || focusSchematic.description || "",
      notes: [
        ...(Array.isArray(focusSchematic.notes) ? focusSchematic.notes : []),
        "Loaded from Circuit Debugger — animated red dashes show wires that need fixing.",
      ],
    };
    applySchematic(merged, {
      save: false,
      skipHistory: false,
      highlightFocusPath: true,
      issueWireIds: issueIds,
    });
    return { matched: focusWireIds.size, mode: "replace" };
  }

  function applySchematic(data, {
    save = true,
    skipHistory = false,
    highlightFocusPath = false,
    issueWireIds = null,
    deferWires = false,
  } = {}) {
    if (!data) return;
    if (!skipHistory) pushHistory();
    notesCollapsed = true;
    clearPinCaches();
    schematicMeta = {
      name: data.name || "",
      description: data.description || "",
      notes: Array.isArray(data.notes) ? data.notes : [],
    };
    components = (data.components || []).map((c) => {
      const base = {
        id: c.id || uid(),
        type: c.type,
        label: c.label || c.type,
        x: Number(c.x) || 40,
        y: Number(c.y) || 40,
        w: Number(c.w) || 80,
        h: Number(c.h) || 48,
        color: c.color || PALETTE.find((p) => p.type === c.type)?.color,
        ...(c.pin_labels ? { pin_labels: c.pin_labels } : {}),
        ...(c.part ? { part: c.part } : {}),
        ...(c.sourceFile ? { sourceFile: c.sourceFile } : {}),
        ...(c.preview ? { preview: c.preview } : {}),
        ...(c.modelUrl ? { modelUrl: c.modelUrl } : {}),
        ...(c.stats ? { stats: c.stats } : {}),
      };
      return { ...base, ...readableComponentSize(base) };
    });
    syncComponentsRef();
    wires = (data.wires || []).map((w) => ({
      id: w.id || uid(),
      from: w.from,
      to: w.to,
      color: w.color || "#58a6ff",
      label: w.label,
      control: w.control || w.waypoint || null,
      manual: Boolean(w.manual || w.control || w.waypoint),
      status: w.status,
      needs_fix: Boolean(w.needs_fix),
    }));
    wireStart = null;
    wireCreateDrag = null;
    selectedWireId = null;
    clearSelection();
    if (highlightFocusPath) {
      const idSet = issueWireIds instanceof Set
        ? issueWireIds
        : new Set([...(issueWireIds || resolveIssueWireIds({ schematic: data }, []))].map(String));
      focusWireIds = new Set(wires.filter((w) => idSet.has(String(w.id))).map((w) => w.id));
      if (!focusWireIds.size) {
        focusWireIds = new Set(wires.map((w) => w.id));
      }
    } else {
      focusWireIds = new Set();
    }
    schematicProjectId = getProjectId?.() || schematicProjectId;
    renderParts();
    renderNotes();
    const paintWires = () => {
      renderWires();
      if (highlightFocusPath) requestAnimationFrame(fitView);
    };
    if (deferWires) {
      requestAnimationFrame(paintWires);
    } else {
      paintWires();
    }
    if (save) scheduleSave();
    notifyHistoryChange();
  }

  async function loadDemo(example = "pi-button-motor") {
    const projectId = getProjectId?.();
    if (!projectId || !api) return null;
    pushHistory();
    const data = await api(
      `/api/projects/${projectId}/wiring/demo?example=${encodeURIComponent(example)}`,
      { method: "POST" },
    );
    applySchematic(data.schematic, { save: false, skipHistory: true });
    onChange?.({ components, wires });
    return data;
  }

  function addComponent(type, x, y, opts = {}) {
    pushHistory();
    const def = PALETTE.find((p) => p.type === type) || PALETTE[0];
    const comp = {
      id: uid(),
      type,
      label: opts.label || def.label,
      x,
      y,
      w: def.w,
      h: def.h,
      color: def.color,
    };
    if (opts.part) comp.part = opts.part;
    if (opts.sourceFile) comp.sourceFile = opts.sourceFile;
    if (opts.preview) comp.preview = opts.preview;
    if (opts.modelUrl) comp.modelUrl = opts.modelUrl;
    if (opts.stats) comp.stats = opts.stats;
    components.push(comp);
    syncComponentsRef();
    hint?.classList.add("hidden");
    renderAll();
    scheduleSave();
  }

  function routingLiftY(wireIndex, a, b) {
    const bb = findBreadboard();
    const base = bb ? bb.y - 18 : Math.min(a.y, b.y) - 28;
    return base - (wireIndex % 7) * 11;
  }

  function wireGeometry(wire, wireIndex, a, b) {
    if (wire.manual && wire.control) {
      return {
        d: wirePathQuadratic(a, b, wire.control),
        handle: wire.control,
      };
    }
    if (wire.from?.componentId && wire.from.componentId === wire.to?.componentId) {
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      const lift = clamp(span * 0.45, 16, 42);
      const control = {
        x: (a.x + b.x) / 2,
        y: Math.min(a.y, b.y) - lift,
      };
      return {
        d: wirePathQuadratic(a, b, control),
        handle: control,
        internal: true,
      };
    }
    const liftY = routingLiftY(wireIndex, a, b);
    return {
      d: wirePathOrthogonal(a, b, liftY),
      handle: { x: (a.x + b.x) / 2, y: liftY },
      liftY,
    };
  }

  function renderParts() {
    partsLayer.innerHTML = "";
    pinsLayer.innerHTML = "";
    applyViewTransform();
    const partsFrag = document.createDocumentFragment();
    const pinsFrag = document.createDocumentFragment();
    for (const c of components) {
      partsFrag.appendChild(renderPartBody(c));
      for (const pin of getPinLayout(c)) {
        const pinEl = renderPin(c, pin);
        if (pinEl) pinsFrag.appendChild(pinEl);
      }
    }
    partsLayer.appendChild(partsFrag);
    pinsLayer.appendChild(pinsFrag);
    rebuildPinPositionMap();
    hint?.classList.toggle("hidden", components.length > 0);
  }

  function renderAll() {
    renderParts();
    renderWires();
  }

  function breadboardMarkup() {
    return `<div class="wiring-vis-breadboard">
      <span class="wiring-bb-rail wiring-bb-rail-plus"></span>
      <span class="wiring-bb-rail wiring-bb-rail-minus"></span>
      <span class="wiring-bb-divider"></span>
      <span class="wiring-bb-holes" aria-hidden="true"></span>
    </div>`;
  }

  // A pseudo-3D microcontroller board: PCB body with header strips whose gold
  // pads line up under the real connection pins, so you draw wires straight
  // from the header where you would on the actual board.
  function boardMarkup(c, chipLabel) {
    const pins = pinLayout(c);
    const pad = (p) =>
      `<span class="wiring-board-pad" style="left:${(p.x * 100).toFixed(1)}%"></span>`;
    const top = pins.filter((p) => p.y < 0.5).map(pad).join("");
    const bottom = pins.filter((p) => p.y >= 0.5).map(pad).join("");
    return `<div class="wiring-vis-board">
      <span class="wiring-board-usb"></span>
      <span class="wiring-board-header wiring-board-header--top">${top}</span>
      <span class="wiring-board-pcb">
        <span class="wiring-board-chip">${chipLabel}</span>
        <span class="wiring-board-leds"></span>
      </span>
      <span class="wiring-board-header wiring-board-header--bottom">${bottom}</span>
    </div>`;
  }

  function stepDirDriverMarkup(c, tag) {
    const colLabels = [
      { text: "S", x: 18 },
      { text: "V", x: 34 },
      { text: "G", x: 50 },
    ];
    const rowLabels = [
      { text: "STEP", y: 30 },
      { text: "DIR", y: 48 },
      { text: "EN", y: 66 },
    ];
    return `<div class="wiring-vis-driver wiring-vis-driver--stepdir">
      <span class="wiring-driver-header-grid" aria-hidden="true">
        ${colLabels.map((col) => `<span class="wiring-driver-col-label" style="left:${col.x}%">${col.text}</span>`).join("")}
        ${rowLabels.map((row) => `<span class="wiring-driver-row-label" style="top:${row.y}%">${row.text}</span>`).join("")}
        <span class="wiring-driver-grid-box"></span>
        <span class="wiring-driver-grid-line wiring-driver-grid-line--v1"></span>
        <span class="wiring-driver-grid-line wiring-driver-grid-line--v2"></span>
        <span class="wiring-driver-grid-line wiring-driver-grid-line--h1"></span>
        <span class="wiring-driver-grid-line wiring-driver-grid-line--h2"></span>
        <span class="wiring-driver-ms-label">MS</span>
      </span>
      <span class="wiring-driver-motor-label wiring-driver-motor-label--top">MOTOR COILS</span>
      <span class="wiring-driver-chip wiring-driver-chip--stepdir">${tag}</span>
    </div>`;
  }

  function partVisualMarkup(c) {
    if (c.type === "breadboard") return breadboardMarkup();
    if (c.type === "resistor") {
      return `<div class="wiring-part-visual"><span class="wiring-vis-resistor"></span></div>`;
    }
    if (c.type === "led") {
      return `<div class="wiring-part-visual"><span class="wiring-vis-led-dome"></span></div>`;
    }
    if (c.type === "transistor") {
      return `<div class="wiring-part-visual wiring-vis-transistor"><span class="wiring-vis-transistor-body"></span></div>`;
    }
    if (c.type === "diode") {
      return `<div class="wiring-part-visual"><span class="wiring-vis-diode"></span></div>`;
    }
    if (c.type.startsWith("arduino")) {
      return boardMarkup(c, c.type === "arduino-mega" ? "MEGA" : "UNO");
    }
    if (c.type === "motor-driver") {
      const tag = /uln2003/i.test(c.label || "") ? "ULN2003"
        : /l298/i.test(c.label || "") ? "L298N"
        : /drv8825/i.test(c.label || "") ? "DRV8825"
        : /a4988/i.test(c.label || "") ? "A4988"
        : "DRIVER";
      if (isStepDirShield(c)) return stepDirDriverMarkup(c, tag);
      return `<div class="wiring-vis-driver"><span class="wiring-vis-driver-chip">${tag}</span></div>`;
    }
    if (c.type === "motor") {
      return `<div class="wiring-part-visual wiring-vis-motor">
        <span class="wiring-motor-can"></span>
        <span class="wiring-rotor"><span class="wiring-rotor-flap"></span></span>
        <span class="wiring-motor-hub"></span>
      </div>`;
    }
    if (c.type === "stepper") {
      return `<div class="wiring-part-visual wiring-vis-stepper">
        <span class="wiring-stepper-can"></span>
        <span class="wiring-rotor wiring-rotor--stepper"><span class="wiring-rotor-mark"></span></span>
        <span class="wiring-motor-hub"></span>
      </div>`;
    }
    if (c.type === "servo-motor") {
      return `<div class="wiring-part-visual wiring-vis-servo">
        <span class="wiring-servo-body"></span>
        <span class="wiring-servo-horn"></span>
        <span class="wiring-servo-hub"></span>
      </div>`;
    }
    return "";
  }

  function renderPartBody(c) {
    const el = document.createElement("div");
    el.className = `wiring-part wiring-part--${c.type}`;
    if (selectedPartIds.has(c.id)) el.classList.add("selected");
    el.dataset.id = c.id;
    el.style.left = `${c.x}px`;
    el.style.top = `${c.y}px`;
    el.style.width = `${c.w}px`;
    el.style.height = `${c.h}px`;
    el.style.background = c.color || "#30363d";
    if (c.part || c.sourceFile) {
      const bits = [];
      if (c.part?.kind) bits.push(c.part.kind);
      if (c.sourceFile || c.part?.sourceFile) bits.push(`from ${c.sourceFile || c.part.sourceFile}`);
      if (c.part?.datasheet) bits.push(`pinout: ${c.part.datasheet}`);
      el.title = bits.join(" · ");
      el.classList.add("wiring-part--sourced");
    }

    const label = document.createElement("span");
    label.className = "wiring-part-label";
    label.textContent = c.label || c.type;
    label.title = "Double-click to edit label";
    el.appendChild(label);
    el.insertAdjacentHTML("beforeend", partVisualMarkup(c));

    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = prompt("Component label", c.label || c.type);
      if (next == null) return;
      pushHistory();
      c.label = next.trim() || c.type;
      renderAll();
      scheduleSave();
    });

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      canvas.focus();
      selectPart(c.id, e.shiftKey || e.metaKey || e.ctrlKey);
      renderSelectedParts();
      renderWires();
      dragHistoryPushed = false;
      dragState = {
        id: c.id,
        startX: e.clientX,
        startY: e.clientY,
        originals: components
          .filter((x) => selectedPartIds.has(x.id))
          .map((x) => ({ id: x.id, x: x.x, y: x.y })),
      };
      el.setPointerCapture(e.pointerId);
    });
    const finishDrag = () => {
      if (dragState?.id !== c.id) return;
      dragState = null;
      void save();
    };

    el.addEventListener("pointermove", (e) => {
      if (!dragState || dragState.id !== c.id) return;
      if (!dragHistoryPushed) {
        pushHistory();
        dragHistoryPushed = true;
      }
      const dx = (e.clientX - dragState.startX) / view.scale;
      const dy = (e.clientY - dragState.startY) / view.scale;
      for (const original of dragState.originals) {
        const comp = components.find((x) => x.id === original.id);
        if (!comp) continue;
        comp.x = original.x + dx;
        comp.y = original.y + dy;
        const compEl = partsLayer.querySelector(`[data-id="${CSS.escape(comp.id)}"]`);
        if (compEl) {
          compEl.style.left = `${comp.x}px`;
          compEl.style.top = `${comp.y}px`;
        }
        updatePinPositions(comp.id);
      }
      scheduleRenderWires();
      scheduleSave(1200);
    });
    el.addEventListener("pointerup", finishDrag);
    el.addEventListener("pointercancel", finishDrag);
    el.addEventListener("lostpointercapture", finishDrag);

    return el;
  }

  function pinLabelText(pin) {
    if (pin.alias || pin.hole) return "";
    return String(pin.displayLabel || pin.label || pin.id || "").trim();
  }

  function pinHoverText(component, pin) {
    const partLabel = component?.label || component?.type || "Component";
    const pinName = String(pin?.title || pin?.label || pin?.id || "pin").trim();
    const id = String(pin?.id || "").trim();
    const idSuffix = id && id !== pinName ? ` · ${id}` : "";
    return `${partLabel}: ${pinName || "pin"}${idSuffix}`;
  }

  function placePinTooltip(clientX, clientY) {
    if (!pinTooltipEl || pinTooltipEl.classList.contains("hidden")) return;
    const pad = 10;
    const gap = 14;
    const rect = pinTooltipEl.getBoundingClientRect();
    let left = clientX + gap;
    let top = clientY - rect.height - gap;
    if (left + rect.width + pad > window.innerWidth) left = clientX - rect.width - gap;
    if (top < pad) top = clientY + gap;
    left = clamp(left, pad, Math.max(pad, window.innerWidth - rect.width - pad));
    top = clamp(top, pad, Math.max(pad, window.innerHeight - rect.height - pad));
    pinTooltipEl.style.left = `${Math.round(left)}px`;
    pinTooltipEl.style.top = `${Math.round(top)}px`;
  }

  function showPinTooltip(text, eventOrElement) {
    if (!pinTooltipEl || !text) return;
    pinTooltipEl.textContent = text;
    pinTooltipEl.classList.remove("hidden");
    if (eventOrElement?.clientX != null) {
      placePinTooltip(eventOrElement.clientX, eventOrElement.clientY);
      return;
    }
    const rect = eventOrElement?.getBoundingClientRect?.();
    if (rect) placePinTooltip(rect.right, rect.top);
  }

  function hidePinTooltip() {
    pinTooltipEl?.classList.add("hidden");
  }

  function applyPinLabelClasses(el, pin) {
    const text = pinLabelText(pin);
    if (!text) return;
    el.dataset.pinLabel = text;
    el.classList.add("wiring-pin--labeled");
    if (pin.compactLabel) {
      el.classList.add("wiring-pin--label-inside");
      return;
    }
    if (pin.x < 0.25) el.classList.add("wiring-pin--label-right");
    else if (pin.x > 0.75) el.classList.add("wiring-pin--label-left");
    else el.classList.add(pin.y > 0.5 ? "wiring-pin--label-top" : "wiring-pin--label-bottom");
  }

  function renderPin(c, pin) {
    if (pin.alias) return null;
    const p = document.createElement("button");
    p.type = "button";
    p.className = "wiring-pin";
    applyPinLabelClasses(p, pin);
    if (pin.hole) p.classList.add("wiring-pin-hole");
    if (pin.rail === "plus") p.classList.add("wiring-pin-rail", "wiring-pin-power");
    if (pin.rail === "minus") p.classList.add("wiring-pin-rail", "wiring-pin-ground");
    p.dataset.componentId = c.id;
    p.dataset.pinId = pin.id;
    p.dataset.pinTooltip = pinHoverText(c, pin);
    p.setAttribute("aria-label", p.dataset.pinTooltip);
    p.style.left = `${c.x + c.w * pin.x}px`;
    p.style.top = `${c.y + c.h * pin.y}px`;
    p.addEventListener("pointerenter", (e) => showPinTooltip(p.dataset.pinTooltip, e));
    p.addEventListener("pointermove", (e) => placePinTooltip(e.clientX, e.clientY));
    p.addEventListener("pointerleave", hidePinTooltip);
    p.addEventListener("focus", () => showPinTooltip(p.dataset.pinTooltip, p));
    p.addEventListener("blur", hidePinTooltip);
    p.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      canvas.focus();
      const start = pinPosition(c.id, pin.id);
      wireCreateDrag = {
        from: { componentId: c.id, pinId: pin.id },
        pointerId: e.pointerId,
        start,
        current: start,
        moved: false,
      };
      wireStart = { componentId: c.id, pinId: pin.id };
      pinsLayer.querySelectorAll(".wiring-pin-active").forEach((el) => el.classList.remove("wiring-pin-active"));
      p.classList.add("wiring-pin-active");
      p.setPointerCapture(e.pointerId);
      renderWirePreview(start, start);
    });
    p.addEventListener("pointermove", (e) => {
      if (!wireCreateDrag || wireCreateDrag.pointerId !== e.pointerId) return;
      const current = clientToWorld(e.clientX, e.clientY);
      wireCreateDrag.current = current;
      if (Math.hypot(current.x - wireCreateDrag.start.x, current.y - wireCreateDrag.start.y) > 4) {
        wireCreateDrag.moved = true;
      }
      highlightPinUnderPointer(e.clientX, e.clientY, wireCreateDrag.from);
      renderWirePreview(wireCreateDrag.start, current);
    });
    p.addEventListener("pointerup", (e) => {
      if (!wireCreateDrag || wireCreateDrag.pointerId !== e.pointerId) return;
      const target = pinFromPoint(e.clientX, e.clientY);
      const start = wireCreateDrag.from;
      const moved = wireCreateDrag.moved;
      const draggedControl = wireCreateDrag.current ? { ...wireCreateDrag.current } : null;
      clearWirePreview();
      wireCreateDrag = null;
      pinsLayer.querySelectorAll(".wiring-pin-hover").forEach((el) => el.classList.remove("wiring-pin-hover"));
      if (moved && target && !(target.componentId === start.componentId && target.pinId === start.pinId)) {
        pushHistory();
        const a = pinPosition(start.componentId, start.pinId);
        const b = pinPosition(target.componentId, target.pinId);
        wires.push({
          id: uid(),
          from: start,
          to: target,
          color: "#58a6ff",
          label: "",
          manual: true,
          control: draggedControl || (a && b ? defaultControl(a, b) : null),
        });
        wireStart = null;
        pinsLayer.querySelectorAll(".wiring-pin-active").forEach((el) => el.classList.remove("wiring-pin-active"));
        renderWires();
        scheduleSave();
        return;
      }
    });
    p.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    return p;
  }

  function pinFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY)?.closest?.(".wiring-pin");
    if (!el || !pinsLayer.contains(el)) return null;
    return { componentId: el.dataset.componentId, pinId: el.dataset.pinId };
  }

  function highlightPinUnderPointer(clientX, clientY, from) {
    pinsLayer.querySelectorAll(".wiring-pin-hover").forEach((el) => el.classList.remove("wiring-pin-hover"));
    const target = pinFromPoint(clientX, clientY);
    if (!target || (target.componentId === from.componentId && target.pinId === from.pinId)) return;
    pinsLayer
      .querySelector(`[data-component-id="${CSS.escape(target.componentId)}"][data-pin-id="${CSS.escape(target.pinId)}"]`)
      ?.classList.add("wiring-pin-hover");
  }

  function renderWirePreview(a, b) {
    if (!previewSvg || !a || !b) return;
    previewSvg.setAttribute("viewBox", `0 0 ${world.w} ${world.h}`);
    previewSvg.setAttribute("width", world.w);
    previewSvg.setAttribute("height", world.h);
    previewSvg.innerHTML = `<path class="wiring-wire-preview-path" d="${wirePathQuadratic(a, b, defaultControl(a, b))}" stroke="#58a6ff"></path>`;
  }

  function clearWirePreview() {
    if (previewSvg) previewSvg.innerHTML = "";
  }

  function updatePinPositions(compId) {
    const c = components.find((x) => x.id === compId);
    if (!c) return;
    for (const pin of getPinLayout(c)) {
      const pos = {
        x: c.x + c.w * pin.x,
        y: c.y + c.h * pin.y,
      };
      pinPositionMap.set(`${compId}|${pin.id}`, pos);
      const el = pinsLayer.querySelector(
        `[data-component-id="${compId}"][data-pin-id="${pin.id}"]`,
      );
      if (el) {
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y}px`;
      }
    }
  }

  function pinPosition(compId, pinId) {
    return pinPositionMap.get(`${compId}|${pinId}`) || null;
  }

  function addConnector(parent, x, y, color) {
    const outer = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    outer.setAttribute("class", "wiring-connector-outer");
    outer.setAttribute("cx", x);
    outer.setAttribute("cy", y);
    outer.setAttribute("r", 7);
    outer.setAttribute("fill", "#0d1117");
    outer.setAttribute("stroke", color);
    outer.setAttribute("stroke-width", 2);
    parent.appendChild(outer);

    const inner = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    inner.setAttribute("class", "wiring-connector-inner");
    inner.setAttribute("cx", x);
    inner.setAttribute("cy", y);
    inner.setAttribute("r", 4);
    inner.setAttribute("fill", color);
    parent.appendChild(inner);
  }

  function wireById(wireId) {
    return wires.find((w) => w.id === wireId) || null;
  }

  function wireHandleFor(wire) {
    const wireIndex = wires.indexOf(wire);
    if (wireIndex < 0) return null;
    const a = pinPosition(wire.from.componentId, wire.from.pinId);
    const b = pinPosition(wire.to.componentId, wire.to.pinId);
    if (!a || !b) return null;
    return wireGeometry(wire, wireIndex, a, b).handle;
  }

  function wireGroupFromEvent(event) {
    const target = event.target instanceof Element ? event.target : null;
    return target?.closest("[data-wire-id]") || null;
  }

  function bindWireEvents() {
    if (wiresSvg.dataset.eventsBound === "1") return;
    wiresSvg.dataset.eventsBound = "1";

    wiresSvg.addEventListener("pointerdown", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.classList.contains("wiring-wire-handle")) return;
      const g = wireGroupFromEvent(e);
      const wire = g ? wireById(g.dataset.wireId) : null;
      const handle = wire ? wireHandleFor(wire) : null;
      if (wire && handle) startWireControlDrag(wire, handle, e);
    });

    wiresSvg.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const g = wireGroupFromEvent(e);
      if (!g || !target) return;
      const wire = wireById(g.dataset.wireId);
      if (!wire) return;
      e.stopPropagation();
      if (suppressNextWireClick) {
        suppressNextWireClick = false;
        return;
      }
      if (target.classList.contains("wiring-wire-label-bg")
        || target.classList.contains("wiring-wire-label")) {
        e.preventDefault();
        openWireEditor(wire.id, wireHandleFor(wire));
        return;
      }
      if (target.classList.contains("wiring-wire-handle")) {
        selectWire(wire.id);
        renderWires();
        renderSelectedParts();
        return;
      }
      if (target.classList.contains("wiring-wire-path")) {
        selectWire(wire.id, e.shiftKey || e.metaKey || e.ctrlKey);
        renderWires();
        renderSelectedParts();
      }
    });

    wiresSvg.addEventListener("dblclick", (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const g = wireGroupFromEvent(e);
      if (!g || !target) return;
      const wire = wireById(g.dataset.wireId);
      if (!wire) return;
      if (!target.classList.contains("wiring-wire-path")
        && !target.classList.contains("wiring-wire-label")
        && !target.classList.contains("wiring-wire-label-bg")) return;
      e.stopPropagation();
      e.preventDefault();
      openWireEditor(wire.id, wireHandleFor(wire));
    });
  }
  bindWireEvents();

  function startWireControlDrag(wire, handle, event) {
    event.stopPropagation();
    event.preventDefault();
    pushHistory();
    selectWire(wire.id);
    wire.manual = true;
    if (!wire.control) wire.control = { ...handle };
    wireDrag = {
      wireId: wire.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    renderWires();
  }

  function renderWires() {
    wiresSvg.innerHTML = "";
    wiresSvg.setAttribute("viewBox", `0 0 ${world.w} ${world.h}`);
    wiresSvg.setAttribute("width", world.w);
    wiresSvg.setAttribute("height", world.h);

    const frag = document.createDocumentFragment();
    wires.forEach((wire, wireIndex) => {
      const a = pinPosition(wire.from.componentId, wire.from.pinId);
      const b = pinPosition(wire.to.componentId, wire.to.pinId);
      if (!a || !b) return;

      const { d, handle } = wireGeometry(wire, wireIndex, a, b);
      const color = wire.color || "#58a6ff";
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.dataset.wireId = wire.id;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "wiring-wire-path");
      if (wire.id === selectedWireId || selectedWireIds.has(wire.id)) path.classList.add("selected");
      if (focusWireIds.has(wire.id)) path.classList.add("wiring-wire-path--focus");
      path.setAttribute("stroke", color);
      if (wire.label) {
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = wire.label;
        path.appendChild(title);
      }
      g.appendChild(path);

      if (focusWireIds.has(wire.id)) {
        const flow = document.createElementNS("http://www.w3.org/2000/svg", "path");
        flow.setAttribute("d", d);
        flow.setAttribute("class", "wiring-wire-focus-flow wiring-wire-focus-flow--issue");
        flow.setAttribute("stroke", "#f85149");
        flow.setAttribute("aria-hidden", "true");
        g.appendChild(flow);
      }

      addConnector(g, a.x, a.y, color);
      addConnector(g, b.x, b.y, color);

      const showLabel = wire.label && (
        wire.id === selectedWireId
        || selectedWireIds.has(wire.id)
        || focusWireIds.has(wire.id)
        || wire.label.length <= 8
      );
      if (showLabel) {
        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const textW = Math.max(48, Math.min(180, wire.label.length * 6 + 14));
        bg.setAttribute("class", "wiring-wire-label-bg");
        bg.setAttribute("x", handle.x - textW / 2);
        bg.setAttribute("y", handle.y - 27);
        bg.setAttribute("width", textW);
        bg.setAttribute("height", 18);
        bg.setAttribute("rx", 5);
        g.appendChild(bg);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "wiring-wire-label");
        label.setAttribute("x", handle.x);
        label.setAttribute("y", handle.y - 14);
        label.textContent = wire.label;
        g.appendChild(label);
      }

      const handleEl = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      handleEl.setAttribute("class", "wiring-wire-handle");
      handleEl.setAttribute("cx", handle.x);
      handleEl.setAttribute("cy", handle.y);
      handleEl.setAttribute("r", wire.id === selectedWireId || selectedWireIds.has(wire.id) ? 7 : 5);
      g.appendChild(handleEl);

      frag.appendChild(g);
    });
    wiresSvg.appendChild(frag);
  }

  function onPinClick(componentId, pinId) {
    if (!wireStart) {
      wireStart = { componentId, pinId };
      const el = pinsLayer.querySelector(
        `[data-component-id="${componentId}"][data-pin-id="${pinId}"]`,
      );
      el?.classList.add("wiring-pin-active");
      return;
    }
    pinsLayer.querySelectorAll(".wiring-pin-active").forEach((el) => {
      el.classList.remove("wiring-pin-active");
    });
    if (wireStart.componentId === componentId && wireStart.pinId === pinId) {
      wireStart = null;
      return;
    }
    pushHistory();
    wires.push({
      id: uid(),
      from: wireStart,
      to: { componentId, pinId },
      color: "#58a6ff",
      manual: false,
    });
    wireStart = null;
    renderWires();
    scheduleSave();
  }

  function renderSelectedParts() {
    partsLayer.querySelectorAll(".wiring-part").forEach((el) => {
      el.classList.toggle("selected", selectedPartIds.has(el.dataset.id));
    });
  }

  function editWireLabel(wireId) {
    openWireEditor(wireId);
  }

  function deleteSelection() {
    if (!selectedPartIds.size && !selectedWireIds.size && !selectedWireId) return false;
    pushHistory();
    const selectedWires = new Set(selectedWireIds);
    if (selectedWireId) selectedWires.add(selectedWireId);
    if (selectedPartIds.size) {
      wires = wires.filter(
        (w) => !selectedPartIds.has(w.from.componentId) && !selectedPartIds.has(w.to.componentId),
      );
      components = components.filter((c) => !selectedPartIds.has(c.id));
      syncComponentsRef();
    }
    if (selectedWires.size) {
      wires = wires.filter((w) => !selectedWires.has(w.id));
    }
    clearSelection();
    wireStart = null;
    pinsLayer.querySelectorAll(".wiring-pin-active").forEach((el) => el.classList.remove("wiring-pin-active"));
    renderAll();
    scheduleSave();
    return true;
  }

  function wireBounds(wire, index) {
    const a = pinPosition(wire.from.componentId, wire.from.pinId);
    const b = pinPosition(wire.to.componentId, wire.to.pinId);
    if (!a || !b) return null;
    const { handle } = wireGeometry(wire, index, a, b);
    return {
      minX: Math.min(a.x, b.x, handle.x) - 8,
      maxX: Math.max(a.x, b.x, handle.x) + 8,
      minY: Math.min(a.y, b.y, handle.y) - 8,
      maxY: Math.max(a.y, b.y, handle.y) + 8,
    };
  }

  function rectsIntersect(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function applySelectionRect(rect) {
    const box = {
      minX: Math.min(rect.x0, rect.x1),
      maxX: Math.max(rect.x0, rect.x1),
      minY: Math.min(rect.y0, rect.y1),
      maxY: Math.max(rect.y0, rect.y1),
    };
    selectedPartIds = new Set(
      components
        .filter((c) => rectsIntersect(box, { minX: c.x, minY: c.y, maxX: c.x + c.w, maxY: c.y + c.h }))
        .map((c) => c.id),
    );
    selectedWireIds = new Set(
      wires
        .map((w, i) => ({ wire: w, bounds: wireBounds(w, i) }))
        .filter((item) => item.bounds && rectsIntersect(box, item.bounds))
        .map((item) => item.wire.id),
    );
    selectedWireId = selectedWireIds.values().next().value || null;
    renderSelectedParts();
    renderWires();
  }

  function dropAt(clientX, clientY, type) {
    const pt = clientToWorld(clientX, clientY);
    const x = pt.x - 40;
    const y = pt.y - 20;
    addComponent(type, Math.max(8, x), Math.max(8, y));
  }

  /** Drop a CAD component (dragged from the project browser) as a wiring part. */
  function dropComponentRef(payload, clientX, clientY) {
    const stem = payload.stem || payload.filename || payload.name || "component";
    // A saved/sourced profile is authoritative — it tells us for sure which
    // electrical part this is, its stats, and a realistic preview/3D model.
    const profile = payload.profile || null;
    const src = profile?.source || null;
    const recognized = profile?.wiring_type
      ? { wiringType: profile.wiring_type, kind: profile.kind, label: profile.label, datasheet: profile.datasheet }
      : payload.part && payload.wiringType
      ? { wiringType: payload.wiringType, ...payload.part }
      : null;
    const pt = clientToWorld(clientX, clientY);
    const x = Math.max(8, pt.x - 40);
    const y = Math.max(8, pt.y - 20);

    if (recognized?.wiringType) {
      addComponent(recognized.wiringType, x, y, {
        label: recognized.label || payload.label || prettyPartLabel(stem),
        sourceFile: payload.filename || payload.name,
        preview: src?.png_url || null,
        modelUrl: src?.glb_url || null,
        stats: profile?.stats || null,
        part: {
          kind: recognized.kind,
          partNumber: recognized.partNumber,
          datasheet: recognized.datasheet,
          sourceFile: payload.filename || payload.name,
          sourced: !!src,
          pageUrl: src?.page_url || null,
        },
      });
      onChange?.({ components, wires });
      return { recognized: true, kind: recognized.kind, sourced: !!src };
    }

    // Unknown part — drop a generic module so it still appears with pins.
    addComponent("sensor", x, y, {
      label: payload.label || prettyPartLabel(stem) || "Component",
      sourceFile: payload.filename || payload.name,
      part: { kind: "Unrecognized module", sourceFile: payload.filename || payload.name },
    });
    onChange?.({ components, wires });
    return { recognized: false };
  }

  canvas.addEventListener("click", (e) => {
    if (suppressNextCanvasClick) {
      suppressNextCanvasClick = false;
      return;
    }
    if (e.target.closest(".wiring-part, .wiring-pin, .wiring-wire-path, .wiring-wire-handle, .wiring-wire-editor")) return;
    closeWireEditor();
    clearSelection();
    wireStart = null;
    pinsLayer.querySelectorAll(".wiring-pin-active").forEach((el) => {
      el.classList.remove("wiring-pin-active");
    });
    renderSelectedParts();
    renderWires();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const before = clientToWorld(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0012);
    view.scale = clamp(view.scale * factor, 0.28, 2.5);
    const rect = canvas.getBoundingClientRect();
    view.x = e.clientX - rect.left - before.x * view.scale;
    view.y = e.clientY - rect.top - before.y * view.scale;
    applyViewTransform();
    renderWires();
  }, { passive: false });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".wiring-part, .wiring-pin, .wiring-wire-path, .wiring-wire-handle")) return;
    canvas.focus();
    const pt = clientToWorld(e.clientX, e.clientY);
    const screen = clientToCanvas(e.clientX, e.clientY);
    if (e.shiftKey || e.button === 1 || e.button === 2 || e.getModifierState?.("Space")) {
      panDrag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: view.x, origY: view.y };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    selectionDrag = {
      pointerId: e.pointerId,
      x0: pt.x,
      y0: pt.y,
      x1: pt.x,
      y1: pt.y,
      sx0: screen.x,
      sy0: screen.y,
      sx1: screen.x,
      sy1: screen.y,
    };
    selectionBox?.classList.remove("hidden");
    updateSelectionBox();
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (panDrag?.pointerId === e.pointerId) {
      view.x = panDrag.origX + (e.clientX - panDrag.startX);
      view.y = panDrag.origY + (e.clientY - panDrag.startY);
      applyViewTransform();
      return;
    }
    if (selectionDrag?.pointerId === e.pointerId) {
      const pt = clientToWorld(e.clientX, e.clientY);
      const screen = clientToCanvas(e.clientX, e.clientY);
      selectionDrag.x1 = pt.x;
      selectionDrag.y1 = pt.y;
      selectionDrag.sx1 = screen.x;
      selectionDrag.sy1 = screen.y;
      updateSelectionBox();
      applySelectionRect(selectionDrag);
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (panDrag?.pointerId === e.pointerId) panDrag = null;
    if (selectionDrag?.pointerId === e.pointerId) {
      const moved = Math.hypot(selectionDrag.sx1 - selectionDrag.sx0, selectionDrag.sy1 - selectionDrag.sy0) > 4;
      if (!moved) {
        clearSelection();
        renderSelectedParts();
        renderWires();
      } else {
        suppressNextCanvasClick = true;
      }
      selectionDrag = null;
      selectionBox?.classList.add("hidden");
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("pointermove", (e) => {
    if (!wireDrag || !wiringWorkspaceVisible()) return;
    const wire = wires.find((w) => w.id === wireDrag.wireId);
    if (!wire) return;
    if (Math.hypot(e.clientX - wireDrag.startX, e.clientY - wireDrag.startY) > 4) {
      wireDrag.moved = true;
    }
    const pt = clientToWorld(e.clientX, e.clientY);
    wire.control = { x: pt.x, y: pt.y };
    wire.manual = true;
    renderWires();
  });

  document.addEventListener("pointerup", () => {
    if (!wireDrag) return;
    const dragged = wireDrag;
    wireDrag = null;
    if (dragged.moved) {
      suppressNextWireClick = true;
      scheduleSave();
      return;
    }
  });

  function updateSelectionBox() {
    if (!selectionBox || !selectionDrag) return;
    const left = Math.min(selectionDrag.sx0, selectionDrag.sx1);
    const top = Math.min(selectionDrag.sy0, selectionDrag.sy1);
    const width = Math.abs(selectionDrag.sx1 - selectionDrag.sx0);
    const height = Math.abs(selectionDrag.sy1 - selectionDrag.sy0);
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
  }

  canvas.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && key === "z" && !e.shiftKey) {
      if (undo()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (mod && key === "z" && e.shiftKey) {
      if (redo()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (key === "delete" || key === "backspace" || key === "x") {
      if (deleteSelection()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    if (key === "0") {
      fitView();
      e.preventDefault();
    }
  });

  canvas.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    canvas.classList.add("wiring-drag-over");
  });
  canvas.addEventListener("dragleave", () => canvas.classList.remove("wiring-drag-over"));
  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    canvas.classList.remove("wiring-drag-over");
    const type = e.dataTransfer.getData("application/x-wiring-part");
    if (type) {
      dropAt(e.clientX, e.clientY, type);
      return;
    }
    const componentRaw = e.dataTransfer.getData("application/render3d-component");
    if (componentRaw) {
      try {
        const payload = JSON.parse(componentRaw);
        const item =
          payload?.type === "multi" && Array.isArray(payload.items) && payload.items.length
            ? payload.items[0]
            : payload;
        dropComponentRef(item, e.clientX, e.clientY);
      } catch {
        /* ignore malformed component payload */
      }
    }
  });

  window.addEventListener("resize", () => {
    applyViewTransform();
    renderWires();
  });

  document.addEventListener("keydown", (e) => {
    if (!wiringWorkspaceVisible()) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && key === "z" && !e.shiftKey) {
      if (undo()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (mod && key === "z" && e.shiftKey) {
      if (redo()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if ((key === "delete" || key === "backspace" || key === "x") && deleteSelection()) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  renderPalette();

  function addWireObj(from, to, color, label) {
    const a = pinPosition(from.componentId, from.pinId);
    const b = pinPosition(to.componentId, to.pinId);
    wires.push({
      id: uid(),
      from,
      to,
      color,
      label: label || "",
      manual: false,
      control: a && b ? defaultControl(a, b) : null,
    });
  }

  /**
   * Insert a motor/stepper driver between the controller and an actuator and
   * auto-wire it: controller → driver inputs, driver outputs → actuator coils,
   * plus driver power from the controller. Returns the new driver component.
   */
  function insertDriverForActuator(actuatorId, opts = {}) {
    const act = components.find((c) => c.id === actuatorId);
    if (!act) return null;
    pushHistory();

    const def = PALETTE.find((p) => p.type === "motor-driver") || { w: 104, h: 92, color: "#21262d" };
    const channels = opts.channels || (act.type === "stepper" ? 4 : 2);
    const coilIds = act.type === "stepper" ? ["in1", "in2", "in3", "in4"].slice(0, channels) : ["plus", "minus"];
    const inIds = ["in1", "in2", "in3", "in4"];
    const outIds = ["out1", "out2", "out3", "out4"];

    const driver = {
      id: uid(),
      type: "motor-driver",
      label: opts.label || "ULN2003 driver",
      x: Math.max(8, act.x - (def.w + 60)),
      y: act.y,
      w: def.w,
      h: def.h,
      color: def.color,
    };
    if (opts.part) driver.part = opts.part;
    if (opts.sourceFile) driver.sourceFile = opts.sourceFile;
    if (opts.preview) driver.preview = opts.preview;
    if (opts.modelUrl) driver.modelUrl = opts.modelUrl;
    components.push(driver);

    const isUlnBoard = /uln\s*2003/i.test(opts.label || "ULN2003");
    coilIds.forEach((coilId, i) => {
      const inId = inIds[Math.min(i, inIds.length - 1)];
      const outId = outIds[Math.min(i, outIds.length - 1)];
      for (const w of wires) {
        if (w.from.componentId === actuatorId && w.from.pinId === coilId) {
          w.from = { componentId: driver.id, pinId: inId };
          w.manual = false;
          w.control = null;
        } else if (w.to.componentId === actuatorId && w.to.pinId === coilId) {
          w.to = { componentId: driver.id, pinId: inId };
          w.manual = false;
          w.control = null;
        }
      }
      // 28BYJ-48 plugs into the ULN2003 white socket — no external OUT→coil wires.
      if (!isUlnBoard) {
        addWireObj({ componentId: driver.id, pinId: outId }, { componentId: actuatorId, pinId: coilId }, "#58a6ff", `OUT${i + 1}`);
      }
    });

    const controller = components.find((c) => ["arduino-uno", "arduino-mega", "raspberry-pi"].includes(c.type));
    if (controller) {
      addWireObj({ componentId: controller.id, pinId: "5v" }, { componentId: driver.id, pinId: "vcc" }, "#f85149", "5V");
      addWireObj({ componentId: controller.id, pinId: "gnd" }, { componentId: driver.id, pinId: "gnd" }, "#6e7681", "GND");
    }

    syncComponentsRef();
    renderAll();
    scheduleSave();
    onChange?.({ components, wires });
    return driver;
  }

  return {
    load,
    save,
    insertDriverForActuator,
    attachComponentRef(payload, position = {}) {
      const rect = canvas.getBoundingClientRect();
      const clientX = Number.isFinite(position.clientX) ? position.clientX : rect.left + rect.width / 2;
      const clientY = Number.isFinite(position.clientY) ? position.clientY : rect.top + rect.height / 2;
      const result = dropComponentRef(payload || {}, clientX, clientY);
      requestAnimationFrame(fitView);
      return result;
    },
    show() {
      root?.classList.remove("hidden");
      load();
      requestAnimationFrame(() => {
        fitView();
        window.dispatchEvent(new Event("resize"));
      });
    },
    hide() {
      root?.classList.remove("hidden");
    },
    getState() {
      return { components, wires };
    },
    getSchematic() {
      return {
        name: schematicMeta.name,
        description: schematicMeta.description,
        notes: schematicMeta.notes,
        components: components.map((c) => ({ ...c })),
        wires: wires.map((w) => ({ ...w, from: { ...w.from }, to: { ...w.to } })),
      };
    },
    setActuatorState,
    setRuntimeLogger(fn) {
      runtimeLogger = typeof fn === "function" ? fn : null;
    },
    beginSimulation,
    endSimulation,
    isSimulating() {
      return animating;
    },
    clear() {
      components = [];
      syncComponentsRef();
      wires = [];
      wireStart = null;
      selectedWireId = null;
      focusWireIds = new Set();
      schematicMeta = { name: "", description: "", notes: [] };
      schematicProjectId = null;
      notesCollapsed = true;
      clearPinCaches();
      clearHistory();
      renderAll();
      renderNotes();
    },
    applySchematic,
    applyFocusPath,
    clearFocusWireHighlight,
    setFocusWireHighlight,
    loadDemo,
    undo,
    redo,
    clearHistory,
    getHistoryState,
  };
}
