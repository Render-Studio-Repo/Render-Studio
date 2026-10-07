/**
 * Sandbox Wiring + Schematics + 3D spatial preview for NW.
 * Schematic (2D Cirkit) and 3D wiring share one model; auto-push saves.
 * Token sbwire1.
 */

import { createWiringSimulator } from "../wiring/wiring-simulator.js?v=20260916-wiring-repair-2-harness2-harness3-webglrevert2&gpu=20260916-startup2&gpu=20260916-startup3&sbwire1=1";
import { autoPushSandboxCode } from "./sandbox-push.js?v=20260923-draw-recordings1";

export const SBWIRE1_TOKEN = "sbwire1";

const DEMO = {
  name: "Sandbox demo circuit",
  description: "Starter schematic for Collaborate ID Wiring / Schematics",
  components: [
    { id: "pi1", type: "raspberry-pi", label: "Pi 5", x: 40, y: 60, w: 180, h: 120 },
    { id: "bb1", type: "breadboard", label: "Breadboard", x: 280, y: 80, w: 220, h: 140 },
    { id: "led1", type: "led", label: "Status LED", x: 560, y: 100, w: 80, h: 60 },
    { id: "srv1", type: "servo-motor", label: "Servo", x: 560, y: 220, w: 100, h: 70 },
  ],
  wires: [
    { id: "w1", from: { componentId: "pi1", pinId: "gpio17" }, to: { componentId: "bb1", pinId: "a1" }, color: "#65bdf5" },
    { id: "w2", from: { componentId: "bb1", pinId: "a3" }, to: { componentId: "led1", pinId: "anode" }, color: "#f87171" },
    { id: "w3", from: { componentId: "pi1", pinId: "gpio18" }, to: { componentId: "srv1", pinId: "signal" }, color: "#facc15" },
  ],
};

export function mountSandboxWiring(host) {
  if (!host) return null;
  if (host.dataset.ready === "1") return host._wiringApi || null;
  host.dataset.ready = "1";
  host.dataset.token = SBWIRE1_TOKEN;
  host.classList.add("sb-wiring-pane");

  host.innerHTML = `
    <header class="sb-wiring-head">
      <div>
        <span class="sb-kicker">WIRING · SCHEMATICS · 3D · ${SBWIRE1_TOKEN}</span>
        <p class="muted small">Schematic + 3D spatial wiring in Collaborate ID. Edit 2D, flip to 3D, Save auto-pushes JSON.</p>
      </div>
      <div class="sb-wiring-actions">
        <div class="sb-wiring-view-toggle" role="tablist" aria-label="Wiring view">
          <button type="button" class="sb-agent-btn active" data-wire-view="schematic" aria-selected="true">Schematic</button>
          <button type="button" class="sb-agent-btn" data-wire-view="spatial" aria-selected="false">3D wiring</button>
        </div>
        <button type="button" class="sb-agent-btn" data-wire-save>Save schematic</button>
        <span class="muted small" data-wire-status role="status">Idle</span>
      </div>
    </header>
    <div class="sb-wiring-layout">
      <aside class="sb-wiring-palette" data-wire-palette aria-label="Parts palette"></aside>
      <div class="sb-wiring-viewport" data-wire-schematic-root id="sb-wiring-viewport"></div>
      <div class="sb-wiring-viewport sb-wiring-spatial" data-wire-spatial-root hidden></div>
    </div>
  `;

  const status = host.querySelector("[data-wire-status]");
  const setStatus = (m) => { if (status) status.textContent = m; };
  const paletteEl = host.querySelector("[data-wire-palette]");
  const schematicRoot = host.querySelector("[data-wire-schematic-root]");
  const spatialRoot = host.querySelector("[data-wire-spatial-root]");

  let view = "schematic";
  let spatialPreview = null;
  let lastSnapshot = null;

  const sim = createWiringSimulator({
    root: schematicRoot,
    paletteEl,
    api: null,
    getProjectId: () => null,
    onChange: () => {
      try {
        lastSnapshot = typeof sim?.getSchematic === "function" ? sim.getSchematic() : sim?.getState?.();
      } catch { lastSnapshot = null; }
      setStatus("Edited · unsaved");
      if (view === "spatial") syncSpatial();
    },
    onHistoryChange: () => {},
    onStatus: (_k, text) => { if (text) setStatus(text); },
  });

  try {
    sim?.applySchematic?.(DEMO, { save: false, skipHistory: true });
    lastSnapshot = sim?.getSchematic?.() || DEMO;
    setStatus("Demo circuit loaded · try 3D wiring");
  } catch {
    setStatus("Schematic ready");
  }

  async function ensureSpatial() {
    if (spatialPreview) return spatialPreview;
    setStatus("Loading 3D wiring…");
    const { createCodeWiringPreview } = await import(
      "../code/code-wiring-preview.js?v=sbwire1-spatial1"
    );
    spatialPreview = createCodeWiringPreview(spatialRoot, {
      onStatus: (text) => { if (text) setStatus(text); },
    });
    return spatialPreview;
  }

  function syncSpatial() {
    if (!spatialPreview) return;
    const schematic = (() => {
      try {
        return lastSnapshot || sim?.getSchematic?.() || sim?.getState?.() || DEMO;
      } catch {
        return DEMO;
      }
    })();
    try {
      spatialPreview.load(schematic);
      setStatus("3D wiring synced from schematic");
    } catch (err) {
      setStatus(`3D sync failed · ${err?.message || "error"}`);
    }
  }

  async function setView(next) {
    view = next === "spatial" ? "spatial" : "schematic";
    host.querySelectorAll("[data-wire-view]").forEach((btn) => {
      const on = btn.getAttribute("data-wire-view") === view;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    schematicRoot.hidden = view !== "schematic";
    spatialRoot.hidden = view !== "spatial";
    paletteEl.hidden = view === "spatial";
    if (view === "spatial") {
      await ensureSpatial();
      syncSpatial();
      spatialPreview?.setVisible?.(true);
    } else {
      spatialPreview?.setVisible?.(false);
      setStatus("Schematic");
    }
  }

  host.querySelectorAll("[data-wire-view]").forEach((btn) => {
    btn.addEventListener("click", () => { void setView(btn.getAttribute("data-wire-view")); });
  });

  host.querySelector("[data-wire-save]")?.addEventListener("click", async () => {
    setStatus("Saving…");
    let body = lastSnapshot;
    try {
      if (!body && typeof sim?.getSchematic === "function") body = sim.getSchematic();
      if (!body && typeof sim?.getState === "function") body = sim.getState();
    } catch { /* */ }
    if (!body) {
      body = { token: SBWIRE1_TOKEN, at: new Date().toISOString(), note: "schematic marker" };
    }
    const path = `live/wiring/schematic-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
    const out = await autoPushSandboxCode({
      path,
      text: JSON.stringify(body, null, 2),
      agent: "cursor-engineer",
      note: "Wiring schematic auto-push",
    });
    setStatus(out.ok ? `Saved ${path}` : `Save failed · ${out.detail || "error"}`);
  });

  const api = {
    token: SBWIRE1_TOKEN,
    sim,
    setView,
    destroy: () => {
      try { spatialPreview?.dispose?.(); } catch { /* */ }
      try { sim?.destroy?.(); } catch { /* */ }
    },
  };
  host._wiringApi = api;
  return api;
}
