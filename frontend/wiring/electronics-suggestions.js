/**
 * Suggest electronics needed to build / wire the current CAD project.
 *
 * Uses recognized CAD + wiring parts to propose missing companions
 * (drivers, MCU, resistors, etc.) with datasheet search queries and
 * supplier documentation links — even when the Electronics tab is closed.
 */

import { recognizePart, prettyPartLabel } from "../components/part-catalog.js?v=20260906-fritz";

const BOARD_TYPES = new Set(["arduino-uno", "arduino-mega", "raspberry-pi"]);

/** Companion parts typically required once an actuator/sensor is present. */
const COMPANIONS_BY_TYPE = {
  stepper: [
    {
      type: "motor-driver",
      label: "Stepper driver (A4988 / DRV8825)",
      reason: "Step/DIR driver required for stepper coils",
      search: "A4988 DRV8825 stepper driver datasheet pinout",
      productUrl: "https://www.ti.com/lit/ds/symlink/drv8825.pdf",
      schematicUrl: "https://www.allegromicro.com/~/media/Files/Datasheets/A4988-Datasheet.ashx",
      qtyFrom: "stepper",
    },
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Controller for step/dir and enable pins",
      search: "Arduino Uno R3 pinout datasheet",
      productUrl: "https://docs.arduino.cc/hardware/uno-rev3",
      schematicUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
      needBoard: true,
    },
    {
      type: "breadboard",
      label: "Breadboard / proto board",
      reason: "Prototype interconnect for driver + MCU",
      search: "solderless breadboard wiring guide",
      productUrl: "https://learn.sparkfun.com/tutorials/how-to-use-a-breadboard",
    },
  ],
  motor: [
    {
      type: "motor-driver",
      label: "H-bridge driver (L298N / TB6612)",
      reason: "Motor driver needed between MCU and DC motor",
      search: "L298N motor driver datasheet pinout",
      productUrl: "https://www.sparkfun.com/datasheets/Robotics/TB6612FNG.pdf",
      schematicUrl: "https://www.st.com/resource/en/datasheet/l298.pdf",
      qtyFrom: "motor",
    },
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "PWM / direction control for the motor driver",
      search: "Arduino Uno R3 pinout datasheet",
      productUrl: "https://docs.arduino.cc/hardware/uno-rev3",
      schematicUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
      needBoard: true,
    },
  ],
  "servo-motor": [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "PWM signal source for servo control",
      search: "Arduino Uno servo PWM pinout datasheet",
      productUrl: "https://docs.arduino.cc/learn/electronics/servo-motors",
      schematicUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
      needBoard: true,
    },
  ],
  led: [
    {
      type: "resistor",
      label: "Current-limiting resistor",
      reason: "Protect LEDs from overcurrent",
      search: "LED current limiting resistor calculator datasheet",
      productUrl: "https://learn.sparkfun.com/tutorials/resistors",
      qtyFrom: "led",
    },
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "GPIO source for LED drive",
      search: "Arduino Uno digital pinout datasheet",
      productUrl: "https://docs.arduino.cc/hardware/uno-rev3",
      schematicUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
      needBoard: true,
    },
  ],
  button: [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Read button input on digital pins",
      search: "Arduino Uno digital input pull-up datasheet",
      productUrl: "https://docs.arduino.cc/built-in-examples/digital/Button",
      schematicUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
      needBoard: true,
    },
  ],
  sensor: [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Read sensor analog/digital signals",
      search: "Arduino Uno sensor interface pinout datasheet",
      productUrl: "https://docs.arduino.cc/learn/electronics/sensor-basics",
      schematicUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
      needBoard: true,
    },
  ],
  "motor-driver": [
    {
      type: "arduino-uno",
      label: "Microcontroller (Arduino Uno)",
      reason: "Logic control for driver IN / STEP / DIR pins",
      search: "Arduino Uno motor driver wiring pinout",
      productUrl: "https://docs.arduino.cc/hardware/uno-rev3",
      schematicUrl: "https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf",
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

export function electronicsDocLinks(searchQuery, label = "", opts = {}) {
  const q = encodeURIComponent(String(searchQuery || label || "electronics datasheet").trim());
  const links = [];
  if (opts.productUrl) {
    links.push({ provider: "Product", kind: "product", url: String(opts.productUrl) });
  }
  if (opts.schematicUrl) {
    links.push({ provider: "Schematic", kind: "schematic", url: String(opts.schematicUrl) });
  }
  links.push(
    { provider: "Spec PDF", kind: "search", url: `https://www.google.com/search?q=${q}+datasheet+pdf` },
    { provider: "Digi-Key", kind: "search", url: `https://www.digikey.com/en/products/result?keywords=${q}` },
    { provider: "Mouser", kind: "search", url: `https://www.mouser.com/c/?q=${q}` },
    { provider: "Octopart", kind: "search", url: `https://octopart.com/search?q=${q}` },
    { provider: "Amazon", kind: "search", url: `https://www.amazon.com/s?k=${q}` },
  );
  return links;
}

/** Prefer fetchable product/schematic pages over supplier search URLs. */
export function electronicsSourcingUrls(item = {}) {
  const out = [];
  const seen = new Set();
  const push = (url, label, kind = "product") => {
    const href = String(url || "").trim();
    if (!href || seen.has(href)) return;
    if (/google\.com\/search/i.test(href)) return;
    seen.add(href);
    out.push({ url: href, label: label || item.label || "Electronics", kind });
  };
  push(item.productUrl, item.label, "product");
  push(item.schematicUrl, item.label, "schematic");
  for (const doc of item.docs || []) {
    if (doc?.kind === "product" || doc?.kind === "schematic" || doc?.provider === "Product" || doc?.provider === "Schematic") {
      push(doc.url, item.label, doc.kind || "product");
    }
  }
  return out;
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
      productUrl: item.productUrl || "",
      schematicUrl: item.schematicUrl || "",
      docs: electronicsDocLinks(item.datasheet || item.label || type, item.label, {
        productUrl: item.productUrl,
        schematicUrl: item.schematicUrl,
      }),
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
        productUrl: companion.productUrl || "",
        schematicUrl: companion.schematicUrl || "",
        docs: electronicsDocLinks(companion.search, companion.label, {
          productUrl: companion.productUrl,
          schematicUrl: companion.schematicUrl,
        }),
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
    `_Generated by Render Studio — parts to source for this build._`,
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
      const docs = electronicsDocLinks(item.datasheet || item.label, item.label, {
        productUrl: item.productUrl,
        schematicUrl: item.schematicUrl,
      });
      for (const link of docs.slice(0, 4)) {
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
      for (const link of item.docs || electronicsDocLinks(item.search || item.label, item.label, {
        productUrl: item.productUrl,
        schematicUrl: item.schematicUrl,
      })) {
        lines.push(`  - [${link.provider}](${link.url})`);
      }
      lines.push("");
    }
  }
  lines.push("---", "", "Add these to the Wiring Simulator, then generate or draw the schematic.");
  return lines.join("\n");
}
