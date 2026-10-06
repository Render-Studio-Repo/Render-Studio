/**
 * Popup code editor + simulator for the Wiring Simulator.
 *
 * Opens a modal with editable Arduino (C++) or MicroPython code generated from
 * the current schematic, a Run/Stop control, a live console, and a wiring
 * validation panel. Running the code animates the actuators on the canvas
 * (motor flap spins, servo horn sweeps, stepper rotor turns, LED glows).
 */

import { analyzeCircuit, generateCode, createExecutor } from "./wiring-sim-engine.js?v=20260916-wiring-repair-2";
import { highlightCodeLine, highlightJsonLine } from "./code-highlight.js?v=refcode1";

const STEP_DEG = 360 / 2048; // degrees per stepper micro-step (28BYJ-48-ish)
const PHASE_DEG = 360 / 512; // degrees per coil-phase advance

export function createWiringCodeUI({ getSchematic, sim, onLog, onLogsClear, onAddDriver } = {}) {
  let lang = "arduino";
  let analysis = { actuators: [] };
  let codeByLang = { arduino: "", python: "", javascript: "", py: "", cpp: "" };
  let dirty = { arduino: false, python: false, javascript: false, py: false, cpp: false };
  let activeFile = "main";

  const overlay = document.createElement("div");
  overlay.className = "wiring-code-overlay hidden";
  overlay.innerHTML = `
    <div class="wiring-code-modal" role="dialog" aria-label="Wiring code editor and simulator">
      <div class="wiring-code-head">
        <strong>Code &amp; Simulate</strong>
        <div class="wiring-code-langs" role="tablist">
          <button type="button" class="wiring-code-lang active" data-lang="arduino">Arduino (C++)</button>
          <button type="button" class="wiring-code-lang" data-lang="python">MicroPython</button>
          <button type="button" class="wiring-code-lang" data-lang="javascript">JavaScript</button>
          <button type="button" class="wiring-code-lang" data-lang="py">Python</button>
          <button type="button" class="wiring-code-lang" data-lang="cpp">C++</button>
        </div>
        <button type="button" class="wiring-code-close" aria-label="Close">✕</button>
      </div>
      <div class="wiring-code-body">
        <aside class="wiring-code-explorer" aria-label="Code files">
          <h4>Explorer</h4>
          <button type="button" class="wiring-code-file active" data-file="main"><span class="file-dot file-dot--code"></span><span class="wiring-code-file-name">main.ino</span></button>
          <button type="button" class="wiring-code-file" data-file="schematic"><span class="file-dot file-dot--json"></span><span class="wiring-code-file-name">schematic.json</span></button>
          <button type="button" class="wiring-code-file" data-file="readme"><span class="file-dot file-dot--doc"></span><span class="wiring-code-file-name">README.md</span></button>
        </aside>
        <div class="wiring-code-editor-col">
          <div class="wiring-code-toolbar">
            <button type="button" class="btn secondary wiring-code-regen" title="Regenerate code from the current wiring">↻ Regenerate from wiring</button>
            <button type="button" class="btn accent wiring-code-run">▶ Run simulation</button>
            <button type="button" class="btn danger wiring-code-stop hidden">■ Stop</button>
            <label class="wiring-code-btnpress hidden"><input type="checkbox" class="wiring-code-button-input" /> Button pressed</label>
          </div>
          <div class="wiring-code-editor-shell">
            <div class="wiring-code-gutter" aria-hidden="true"></div>
            <div class="wiring-code-editor-stack">
              <div class="wiring-code-editor-inner">
                <pre class="wiring-code-highlight" aria-hidden="true"></pre>
                <textarea class="wiring-code-text" spellcheck="false" wrap="off"></textarea>
              </div>
            </div>
          </div>
          <div class="wiring-code-statusline">
            <span class="wiring-code-status-file">main.ino</span>
            <span class="wiring-code-cursor">Ln 1, Col 1</span>
          </div>
        </div>
        <div class="wiring-code-side">
          <div class="wiring-code-validate">
            <h4>Wiring check</h4>
            <ul class="wiring-code-validate-list"></ul>
          </div>
          <div class="wiring-code-console-wrap">
            <h4>Console</h4>
            <div class="wiring-code-console" aria-live="polite"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const modal = overlay.querySelector(".wiring-code-modal");
  const textarea = overlay.querySelector(".wiring-code-text");
  const stackEl = overlay.querySelector(".wiring-code-editor-stack");
  const innerEl = overlay.querySelector(".wiring-code-editor-inner");
  const gutterEl = overlay.querySelector(".wiring-code-gutter");
  const highlightEl = overlay.querySelector(".wiring-code-highlight");
  const cursorEl = overlay.querySelector(".wiring-code-cursor");
  const statusFileEl = overlay.querySelector(".wiring-code-status-file");
  const fileButtons = overlay.querySelectorAll(".wiring-code-file");
  const consoleEl = overlay.querySelector(".wiring-code-console");
  const validateList = overlay.querySelector(".wiring-code-validate-list");
  const runBtn = overlay.querySelector(".wiring-code-run");
  const stopBtn = overlay.querySelector(".wiring-code-stop");
  const regenBtn = overlay.querySelector(".wiring-code-regen");
  const btnPressWrap = overlay.querySelector(".wiring-code-btnpress");
  const btnPressInput = overlay.querySelector(".wiring-code-button-input");
  const langButtons = overlay.querySelectorAll(".wiring-code-lang");

  function log(message, kind = "info") {
    const line = document.createElement("div");
    line.className = `wiring-code-log wiring-code-log--${kind}`;
    const t = new Date().toLocaleTimeString();
    line.textContent = `[${t}] ${message}`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    onLog?.({ message, kind, time: t, createdAt: Date.now() });
  }

  function activeFilename() {
    if (activeFile === "schematic") return "schematic.json";
    if (activeFile === "readme") return "README.md";
    if (lang === "python" || lang === "py") return "main.py";
    if (lang === "javascript") return "main.js";
    if (lang === "cpp") return "main.cpp";
    return "main.ino";
  }

  function fileText(file = activeFile) {
    if (file === "schematic") return JSON.stringify(getSchematic?.() || { components: [], wires: [] }, null, 2);
    if (file === "readme") {
      const schematic = getSchematic?.() || {};
      const parts = schematic.components?.length || 0;
      const wires = schematic.wires?.length || 0;
      return `# Code & Simulate\n\nGenerated from the current wiring schematic.\n\n- Components: ${parts}\n- Wires: ${wires}\n- Language: ${languageLabel(lang)}\n\nArduino and MicroPython tabs can run against the wiring simulator.\nGeneral IDE tabs are editable scratch files for JS, Python, and C++.`;
    }
    return codeByLang[lang] || defaultGeneralCode(lang);
  }

  function isSimulationLang(value = lang) {
    return value === "arduino" || value === "python";
  }

  function languageLabel(value = lang) {
    if (value === "arduino") return "Arduino C++";
    if (value === "python") return "MicroPython";
    if (value === "javascript") return "JavaScript";
    if (value === "py") return "Python";
    if (value === "cpp") return "C++";
    return value;
  }

  function defaultGeneralCode(value = lang) {
    if (value === "javascript") {
      return `// JavaScript scratch file\n// Use this for helper logic, notes, or generated control code.\n\nfunction setup() {\n  console.log("Ready");\n}\n\nsetup();\n`;
    }
    if (value === "py") {
      return `# Python scratch file\n# Use this for helper scripts, calculations, or notes.\n\ndef main():\n    print("Ready")\n\nif __name__ == "__main__":\n    main()\n`;
    }
    if (value === "cpp") {
      return `// C++ scratch file\n// Use this for firmware snippets or helper code.\n\n#include <iostream>\n\nint main() {\n  std::cout << "Ready" << std::endl;\n  return 0;\n}\n`;
    }
    return "";
  }

  function setEditorValue(text, { editable = true } = {}) {
    textarea.value = text || "";
    textarea.readOnly = !editable;
    textarea.classList.toggle("is-readonly", !editable);
    syncEditorChrome();
  }

  function highlightCode(src) {
    if (activeFile === "schematic") {
      return src.split("\n").map(highlightJsonLine).join("\n");
    }
    return src.split("\n").map(highlightCodeLine).join("\n");
  }

  let cachedCharWidth = 0;
  function measureCharWidth() {
    if (cachedCharWidth) return cachedCharWidth;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    probe.style.font = getComputedStyle(textarea).font;
    probe.textContent = "MMMMMMMMMM";
    document.body.appendChild(probe);
    cachedCharWidth = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return cachedCharWidth;
  }

  function ensureCursorVisible() {
    if (!stackEl || !textarea) return;
    const pos = textarea.selectionStart || 0;
    const line = textarea.value.slice(0, pos).split("\n").pop() || "";
    const padX = 14;
    const x = line.length * measureCharWidth() + padX;
    const margin = 48;
    if (x < stackEl.scrollLeft + margin) {
      stackEl.scrollLeft = Math.max(0, x - margin);
    } else if (x > stackEl.scrollLeft + stackEl.clientWidth - margin) {
      stackEl.scrollLeft = x - stackEl.clientWidth + margin;
    }
  }

  function cursorPosition() {
    const pos = textarea.selectionStart || 0;
    const before = textarea.value.slice(0, pos);
    const lines = before.split("\n");
    return { line: lines.length, col: lines[lines.length - 1].length + 1 };
  }

  function syncEditorChrome() {
    const text = textarea.value || "";
    const lines = text.split("\n");
    const lineCount = Math.max(1, lines.length);
    const maxLineLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const padX = 28;
    const padY = 24;
    const lineHeightPx = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const chW = measureCharWidth();
    const contentW = Math.max(stackEl?.clientWidth || 0, maxLineLen * chW + padX);
    const contentH = Math.max(stackEl?.clientHeight || 0, lineCount * lineHeightPx + padY);
    if (innerEl) {
      innerEl.style.width = `${contentW}px`;
      innerEl.style.height = `${contentH}px`;
    }

    gutterEl.innerHTML = Array.from({ length: lineCount }, (_, i) => `<span>${i + 1}</span>`).join("");
    const cur = cursorPosition();
    gutterEl.querySelectorAll("span").forEach((el, i) => el.classList.toggle("active", i + 1 === cur.line));
    highlightEl.innerHTML = `${highlightCode(text)}\n`;
    gutterEl.scrollTop = stackEl?.scrollTop || 0;
    if (cursorEl) cursorEl.textContent = `Ln ${cur.line}, Col ${cur.col}`;
    if (statusFileEl) statusFileEl.textContent = activeFilename();
    fileButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.file === activeFile);
      const name = btn.querySelector(".wiring-code-file-name");
      if (name && btn.dataset.file === "main") name.textContent = activeFilename();
    });
    syncLanguageUi();
  }

  function syncLanguageUi() {
    const simulation = isSimulationLang();
    regenBtn.disabled = !simulation;
    runBtn.disabled = false;
    runBtn.textContent = simulation ? "▶ Run simulation" : "▶ Check code";
    regenBtn.title = simulation ? "Regenerate code from the current wiring" : "Regenerate is only available for wiring simulator languages";
  }

  function setActiveFile(file) {
    if (activeFile === "main" && !textarea.readOnly) {
      codeByLang[lang] = textarea.value;
    }
    activeFile = file || "main";
    setEditorValue(fileText(activeFile), { editable: activeFile === "main" });
  }

  const executor = createExecutor({
    onEvent: handlePinEvent,
    onLog: (msg, kind) => log(msg, kind),
    onStateChange: (running) => setRunningUI(running),
  });

  /* ── pin event → actuator animation ─────────────────────────────────── */
  const stepperAngle = new Map(); // actuatorId -> accumulated target angle

  function actuatorsForPin(pin) {
    return analysis.actuators.filter((a) => a.control && a.control.number === pin);
  }

  function handlePinEvent(ev) {
    if (ev.kind === "digital") {
      for (const a of actuatorsForPin(ev.pin)) applyLevel(a, ev.value, ev.value);
    } else if (ev.kind === "pwm") {
      const duty = Math.max(0, Math.min(1, ev.duty / 255));
      for (const a of actuatorsForPin(ev.pin)) {
        if (a.type === "servo") {
          sim?.setActuatorState(a.id, { type: "servo", angle: duty * 180 });
        } else {
          applyLevel(a, duty > 0 ? 1 : 0, duty);
        }
      }
    } else if (ev.kind === "servo") {
      for (const a of actuatorsForPin(ev.pin)) {
        if (a.type === "servo") sim?.setActuatorState(a.id, { type: "servo", angle: ev.angle });
      }
    } else if (ev.kind === "step") {
      advanceStepper(ev.steps * STEP_DEG);
    } else if (ev.kind === "stepphase") {
      advanceStepper(PHASE_DEG);
    }
  }

  function applyLevel(a, high, duty) {
    if (a.type === "led") sim?.setActuatorState(a.id, { type: "led", lit: high >= 1 });
    else if (a.type === "motor") sim?.setActuatorState(a.id, { type: "motor", active: duty > 0, duty });
  }

  function advanceStepper(deltaDeg) {
    const stepper = analysis.actuators.find((a) => a.type === "stepper" && a.wired);
    if (!stepper) return;
    const cur = (stepperAngle.get(stepper.id) || 0) + deltaDeg;
    stepperAngle.set(stepper.id, cur);
    sim?.setActuatorState(stepper.id, { type: "stepper", targetAngle: cur });
  }

  /* ── validation panel ───────────────────────────────────────────────── */
  function renderValidation() {
    validateList.innerHTML = "";
    if (!analysis.actuators.length) {
      validateList.innerHTML = `<li class="wiring-check warn">No actuators (LED, motor, servo, stepper) found. Add one and wire it to a controller.</li>`;
      return;
    }
    for (const a of analysis.actuators) {
      const li = document.createElement("li");
      const healthy = a.wired && !a.issues?.length;
      li.className = `wiring-check ${healthy ? "ok" : "warn"}`;
      const pin = a.control ? ` · pin ${a.control.number}` : a.coilPins?.length ? ` · pins ${a.coilPins.join(",")}` : "";
      const detail = healthy ? "ready to simulate" : a.issues?.[0] || "not fully wired";
      li.innerHTML = `<span class="wiring-check-dot"></span><span><strong>${escapeHtml(a.label)}</strong>${pin} — ${escapeHtml(detail)}</span>`;
      if (a.needsDriver && onAddDriver) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn accent wiring-check-fix";
        btn.textContent = `+ Add ${a.recommendedDriver?.name || "driver"}`;
        btn.addEventListener("click", () => onAddDriver(a));
        li.appendChild(btn);
      }
      validateList.appendChild(li);
    }
  }

  function refreshAnalysis() {
    const schematic = getSchematic?.() || { components: [], wires: [] };
    analysis = analyzeCircuit(schematic);
    renderValidation();
    const hasButton = analysis.hasButton;
    btnPressWrap.classList.toggle("hidden", !hasButton);
    return schematic;
  }

  function regenerate(force = false) {
    const schematic = refreshAnalysis();
    if (!isSimulationLang()) {
      if (!codeByLang[lang]) codeByLang[lang] = defaultGeneralCode(lang);
      if (activeFile === "main") setEditorValue(codeByLang[lang], { editable: true });
      else syncEditorChrome();
      return;
    }
    if (force || !codeByLang[lang] || !dirty[lang]) {
      codeByLang[lang] = generateCode(schematic, lang);
      dirty[lang] = false;
      if (activeFile === "main") setEditorValue(codeByLang[lang], { editable: true });
      else syncEditorChrome();
    }
  }

  /* ── run / stop ─────────────────────────────────────────────────────── */
  function setRunningUI(running) {
    runBtn.classList.toggle("hidden", running);
    stopBtn.classList.toggle("hidden", !running);
  }

  function run() {
    if (activeFile !== "main") setActiveFile("main");
    if (!isSimulationLang()) {
      if (activeFile === "main" && !textarea.readOnly) codeByLang[lang] = textarea.value;
      consoleEl.innerHTML = "";
      onLogsClear?.();
      log(`${languageLabel(lang)} is open in general IDE mode. Simulation is available for Arduino and MicroPython wiring tabs.`, "info");
      return;
    }
    refreshAnalysis();
    if (!dirty[lang]) regenerate(true);
    const wiredCount = analysis.actuators.filter((a) => a.wired).length;
    stepperAngle.clear();
    sim?.setRuntimeLogger?.((message, kind) => log(message, kind));
    sim?.beginSimulation();
    consoleEl.innerHTML = "";
    onLogsClear?.();
    if (!wiredCount) {
      log("No correctly-wired actuators detected — nothing will move. Check the wiring panel.", "warn");
    } else {
      log(`Compiling ${lang === "python" ? "MicroPython" : "Arduino"} code…`, "info");
    }
    executor.setButton(btnPressInput.checked);
    executor.run(textarea.value, lang, { buttonState: btnPressInput.checked });
  }

  function stop() {
    executor.stop();
    sim?.endSimulation();
    sim?.setRuntimeLogger?.(null);
    log("Simulation stopped.", "info");
  }

  /* ── events ─────────────────────────────────────────────────────────── */
  langButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (executor.isRunning()) stop();
      if (activeFile === "main" && !textarea.readOnly) codeByLang[lang] = textarea.value;
      lang = btn.dataset.lang;
      langButtons.forEach((b) => b.classList.toggle("active", b === btn));
      activeFile = "main";
      regenerate(false);
      syncEditorChrome();
    });
  });

  textarea.addEventListener("input", () => {
    if (textarea.readOnly) return;
    codeByLang[lang] = textarea.value;
    dirty[lang] = true;
    syncEditorChrome();
    ensureCursorVisible();
  });
  stackEl?.addEventListener("scroll", () => {
    gutterEl.scrollTop = stackEl.scrollTop;
  });
  textarea.addEventListener("click", () => {
    syncEditorChrome();
    ensureCursorVisible();
  });
  textarea.addEventListener("keyup", () => {
    syncEditorChrome();
    ensureCursorVisible();
  });
  textarea.addEventListener("select", () => {
    syncEditorChrome();
    ensureCursorVisible();
  });
  // Shift + mouse wheel → horizontal scroll (when trackpad doesn't send deltaX)
  stackEl?.addEventListener("wheel", (e) => {
    if (!e.shiftKey || e.deltaX) return;
    e.preventDefault();
    stackEl.scrollLeft += e.deltaY;
  }, { passive: false });
  fileButtons.forEach((btn) => btn.addEventListener("click", () => setActiveFile(btn.dataset.file)));

  regenBtn.addEventListener("click", () => {
    if (executor.isRunning()) stop();
    regenerate(true);
    log("Regenerated code from current wiring.", "info");
  });
  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", stop);
  btnPressInput.addEventListener("change", () => executor.setButton(btnPressInput.checked));

  overlay.querySelector(".wiring-code-close").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });

  function open() {
    overlay.classList.remove("hidden");
    regenerate(false);
    setActiveFile(activeFile || "main");
    if (executor.isRunning()) {
      log("Simulation still running — showing live background results.", "info");
    }
    textarea.focus();
  }

  function close() {
    if (executor.isRunning()) {
      log("Code window closed — simulation continues in the background.", "info");
    } else {
      sim?.endSimulation();
    }
    overlay.classList.add("hidden");
  }

  function runSchematic({ show = false } = {}) {
    if (show) overlay.classList.remove("hidden");
    activeFile = "main";
    regenerate(true);
    run();
  }

  return {
    open,
    close,
    runSchematic,
    refresh: () => regenerate(true),
    isOpen: () => !overlay.classList.contains("hidden"),
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
