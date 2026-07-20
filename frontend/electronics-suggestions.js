/**
 * Suggest electronics needed to build / wire the current CAD project.
 *
 * Uses recognized CAD + wiring parts to propose missing companions
 * (drivers, MCU, resistors, etc.) with datasheet search queries and
 * supplier documentation links — even when the Electronics tab is closed.
 */

import { recognizePart, prettyPartLabel } from "./part-catalog.js?v=20260720-electronics-tab";

const BOARD_TYPES = new Set(["arduino-uno", "arduino-mega", "raspberry-pi"]);

/** Companion parts typically required once an actuator/sensor is present. */
const COMPANIONS_BY_TYPE = {
  stepper: [
    {
      type: "motor-driver",
      label: "Stepper driver (A4988 / DRV8825)",
      reason: "Step/DIR driver required for stepper coils",
      search: "A4988 DRV8825 stepper driver datasheet pinout",
      qtyFrom: "stepper",
    },
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Controller for step/dir and enable pins",
      search: "Arduino Uno R3 pinout datasheet",
      needBoard: true,
    },
    {
      type: "breadboard",
      label: "Breadboard / proto board",
      reason: "Prototype interconnect for driver + MCU",
      search: "solderless breadboard wiring guide",
    },
  ],
  motor: [
    {
      type: "motor-driver",
      label: "H-bridge driver (L298N / TB6612)",
      reason: "Motor driver needed between MCU and DC motor",
      search: "L298N motor driver datasheet pinout",
      qtyFrom: "motor",
    },
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "PWM / direction control for the motor driver",
      search: "Arduino Uno R3 pinout datasheet",
      needBoard: true,
    },
  ],
  "servo-motor": [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "PWM signal source for servo control",
      search: "Arduino Uno servo PWM pinout datasheet",
      needBoard: true,
    },
  ],
  led: [
    {
      type: "resistor",
      label: "Current-limiting resistor",
      reason: "Protect LEDs from overcurrent",
      search: "LED current limiting resistor calculator datasheet",
      qtyFrom: "led",
    },
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "GPIO source for LED drive",
      search: "Arduino Uno digital pinout datasheet",
      needBoard: true,
    },
  ],
  button: [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Read button input on digital pins",
      search: "Arduino Uno digital input pull-up datasheet",
      needBoard: true,
    },
  ],
  sensor: [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Read sensor analog/digital signals",
      search: "Arduino Uno sensor interface pinout datasheet",
      needBoard: true,
    },
  ],
  "motor-driver": [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Logic control for driver IN / STEP / DIR pins",
      search: "Arduino Uno motor driver wiring pinout",
      needBoard: true,
    },
  ],
};

const TYPE_COLORS = {
  "raspberry-pi": "#c51a4a",
  "arduino-uno": "#00979d",
  "arduino-mega": "#008184",
  "servo-motor": "#3fb950",
  stepper: "#6e7681",
  "motor-driver": "#58a6ff",
  motor: "#2ea043",
  led: "#e3b341",
  resistor: "#d4a574",
  transistor: "#8b949e",
  diode: "#484f58",
  button: "#8b949e",
  sensor: "#58a6ff",
  breadboard: "#c9d1d9",
};

export function electronicsDocLinks(searchQuery, label = "") {
  const q = encodeURIComponent(String(searchQuery || label || "electronics datasheet").trim());
  return [
    { provider: "Spec PDF", url: `https://www.google.com/search?q=${q}+datasheet+pdf` },
    { provider: "Digi-Key", url: `https://www.digikey.com/en/products/result?keywords=${q}` },
    { provider: "Mouser", url: `https://www.mouser.com/c/?q=${q}` },
    { provider: "Octopart", url: `https://octopart.com/search?q=${q}` },
    { provider: "Amazon", url: `https://www.amazon.com/s?k=${q}` },
  ];
}

function countTypes(items = []) {
  const counts = new Map();
  for (const item of items) {
    const type = String(item?.type || "").toLowerCase();
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + (Number(item.count) || 1));
  }
  return counts;
}

function hasBoard(counts) {
  for (const type of BOARD_TYPES) {
    if ((counts.get(type) || 0) > 0) return true;
  }
  return false;
}

/**
 * Build suggestion list from used CAD + wiring electronics.
 * @param {{ wiring?: object[], cad?: object[] }} used
 */
export function suggestElectronicsForBuild(used = {}) {
  const present = [...(used.wiring || []), ...(used.cad || [])];
  const counts = countTypes(present);
  const suggestions = [];
  const seen = new Set();

  // CAD electronics not yet on the wiring schematic → suggest attaching them.
  const wiringTypes = new Set((used.wiring || []).map((i) => String(i.type || "").toLowerCase()));
  for (const item of used.cad || []) {
    const type = String(item.type || "").toLowerCase();
    if (!type || wiringTypes.has(type)) continue;
    const id = `attach-cad:${item.filename || item.label}`;
    if (seen.has(id)) continue;
    seen.add(id);
    suggestions.push({
      id,
      kind: "attach-cad",
      type,
      label: item.label || prettyPartLabel(item.filename) || type,
      reason: "In your CAD build — add to Wiring Simulator to source the circuit",
      search: item.datasheet || `${item.label || type} datasheet pinout`,
      qty: 1,
      color: TYPE_COLORS[type] || "#58a6ff",
      filename: item.filename || null,
      datasheet: item.datasheet || "",
      docs: electronicsDocLinks(item.datasheet || item.label || type, item.label),
    });
  }

  // Companion parts missing from both CAD and wiring.
  for (const [sourceType, companions] of Object.entries(COMPANIONS_BY_TYPE)) {
    const sourceCount = counts.get(sourceType) || 0;
    if (sourceCount <= 0) continue;
    for (const companion of companions) {
      if (companion.needBoard && hasBoard(counts)) continue;
      const already = counts.get(companion.type) || 0;
      if (already > 0 && !companion.qtyFrom) continue;
      let qty = 1;
      if (companion.qtyFrom) {
        const need = counts.get(companion.qtyFrom) || sourceCount;
        qty = Math.max(1, need - already);
        if (qty <= 0) continue;
      } else if (already > 0) {
        continue;
      }
      const id = `need:${companion.type}:${companion.label}`;
      if (seen.has(`need:${companion.type}`)) continue;
      seen.add(`need:${companion.type}`);
      suggestions.push({
        id,
        kind: "companion",
        type: companion.type,
        label: companion.label,
        reason: companion.reason,
        search: companion.search,
        qty,
        color: TYPE_COLORS[companion.type] || "#58a6ff",
        filename: null,
        datasheet: companion.search,
        docs: electronicsDocLinks(companion.search, companion.label),
        because: sourceType,
      });
    }
  }

  // If CAD recognized electronics exist but wiring is empty, nudge a full send.
  if ((used.cad || []).length && !(used.wiring || []).length) {
    suggestions.unshift({
      id: "send-all-cad",
      kind: "send-all-cad",
      type: "bundle",
      label: "Send CAD electronics to Wiring Simulator",
      reason: `${used.cad.length} recognized part${used.cad.length === 1 ? "" : "s"} ready to wire`,
      search: "electronics wiring schematic",
      qty: used.cad.length,
      color: "#3fb950",
      filename: null,
      datasheet: "",
      docs: [],
    });
  }

  return suggestions;
}

/** Collect recognized CAD electronics from a browser components list. */
export function recognizeCadElectronics(components = []) {
  const items = [];
  const seen = new Set();
  for (const entry of components) {
    const name = entry?.name || entry?.filename || entry?.viewer_filename || "";
    if (!name || seen.has(name)) continue;
    const recognized = recognizePart(name);
    if (!recognized) continue;
    seen.add(name);
    items.push({
      id: `cad:${name}`,
      source: "cad",
      type: recognized.wiringType,
      label: recognized.label || prettyPartLabel(name),
      kind: recognized.kind,
      color: TYPE_COLORS[recognized.wiringType] || "#58a6ff",
      count: 1,
      filename: name,
      datasheet: recognized.datasheet || "",
    });
  }
  return items;
}

/** Markdown reference doc for suggested / used electronics. */
export function buildElectronicsReferenceMarkdown({ projectName = "Project", used = {}, suggestions = [] } = {}) {
  const lines = [
    `# Electronics for ${projectName}`,
    "",
    `_Generated by Render3D — parts to source for this build._`,
    "",
  ];
  const cad = used.cad || [];
  const wiring = used.wiring || [];
  if (cad.length) {
    lines.push("## CAD electronics", "");
    for (const item of cad) {
      lines.push(`- **${item.label}** (${item.kind || item.type})`);
      if (item.filename) lines.push(`  - File: \`${item.filename}\``);
      if (item.datasheet) lines.push(`  - Docs: ${item.datasheet}`);
      const docs = electronicsDocLinks(item.datasheet || item.label, item.label);
      for (const link of docs.slice(0, 3)) {
        lines.push(`  - [${link.provider}](${link.url})`);
      }
      lines.push("");
    }
  }
  if (wiring.length) {
    lines.push("## Already on wiring schematic", "");
    for (const item of wiring) {
      lines.push(`- **${item.label}** ×${item.count || 1} (${item.kind || item.type})`);
    }
    lines.push("");
  }
  if (suggestions.length) {
    lines.push("## Suggested to complete the build", "");
    for (const item of suggestions) {
      if (item.kind === "send-all-cad") continue;
      lines.push(`- **${item.label}** ×${item.qty || 1}`);
      if (item.reason) lines.push(`  - Why: ${item.reason}`);
      for (const link of item.docs || electronicsDocLinks(item.search || item.label, item.label)) {
        lines.push(`  - [${link.provider}](${link.url})`);
      }
      lines.push("");
    }
  }
  lines.push("---", "", "Add these to the Wiring Simulator, then generate or draw the schematic.");
  return lines.join("\n");
}
