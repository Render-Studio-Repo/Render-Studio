/** NW pane: Collaborate ID · Studio viewport (real) · Office. Token oavis1 + sbvp1. */

import { mountMcpConnect, MCPCONN1_TOKEN } from "./mcp-connect.js?v=mcpconn1";
import { mountCollaborateId, COLLABID1_TOKEN } from "./collaborate-id.js?v=20260923-draw-recordings1&singlevoice1&vrrobot=20260927-2";
import { mountSandboxPrinter } from "./sandbox-printer.js?v=sandbox-printer-1";
import { mountSandboxWiring, SBWIRE1_TOKEN } from "./sandbox-wiring.js?v=20260923-draw-recordings1";
import {
  LEGACY_MUJOCO_LAB,
  SBVP1_TOKEN,
} from "./studio-viewport-replica.js?v=20260923-draw-recordings1&simrun=20260923-1&vrrobot=20260927-2";
import { adoptLive, parkLive, MUJOCO_EMBED_SRC } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";

export const OAVIS1_TOKEN = "oavis1";
export const MUJOCO_LAB = LEGACY_MUJOCO_LAB;
export { MCPCONN1_TOKEN, COLLABID1_TOKEN, SBWIRE1_TOKEN, SBVP1_TOKEN };

/**
 * Mount Collaborate ID + Studio viewport replica + Office into #sb-office host.
 * Only one NW stage is live — switching kills the others until you leave.
 * Real Studio loads in iframe (same-origin) so Super IDE keeps one local WebGL (office).
 */
export function mountOpenArmViserPane(host, { mountOffice, onDesk, speak } = {}) {
  if (!host) return null;
  host.classList.add("sb-nw-3d");
  host.innerHTML = `
    <div class="sb-nw-modes" role="tablist" aria-label="NW mode">
      <button type="button" data-nw-mode="collab" class="active" aria-selected="true">Collaborate ID</button>
      <button type="button" data-nw-mode="wiring" aria-selected="false">Wiring / Schematics</button>
      <button type="button" data-nw-mode="openarm" aria-selected="false">Studio viewport</button>
      <button type="button" data-nw-mode="viser" aria-selected="false">Viser</button>
      <button type="button" data-nw-mode="mujoco" aria-selected="false">MuJoCo</button>
      <button type="button" data-nw-mode="printer" aria-selected="false">3D Printer</button>
      <button type="button" data-nw-mode="office" aria-selected="false">Office</button>
      <div data-nw-mcp-slot class="sb-nw-mcp"></div>
    </div>
    <div class="sb-nw-stage" data-nw-stage="collab">
      <div id="sb-collab-id" class="sb-nw-collab">
        <p class="muted small">Collab IDE sits at the <a href="#sb-collab-top">top of the shop</a> and owns the viewport. This pane reuses that instance — not a second collab.</p>
      </div>
    </div>
    <div class="sb-nw-stage" data-nw-stage="wiring" hidden>
      <div id="sb-wiring-pane" class="sb-nw-wiring"></div>
    </div>
    <div class="sb-nw-stage" data-nw-stage="office" hidden>
      <div id="sb-office-canvas" class="sb-nw-office"></div>
    </div>
    <div class="sb-nw-stage" data-nw-stage="openarm" hidden>
      <div class="sb-nw-openarm sb-nw-studio-viewport">
        <div id="sb-openarm-viser" class="sb-openarm-frame sb-live-slot" data-sb-live-slot="viewport"></div>
        <aside class="sb-joint-map" aria-label="Same instance notes">
          <header>
            <strong>Same Studio viewport</strong>
            <span class="muted small">${SBVP1_TOKEN}</span>
          </header>
          <p class="muted small">Reuses the workshop instance — no second iframe. Sam lock <code>sam-y-engage-v2</code>. No extra Start/Engage configs.</p>
          <div data-sb-live-slot="dimos" data-nw-dimos></div>
        </aside>
      </div>
    </div>
    <div class="sb-nw-stage" data-nw-stage="viser" hidden>
      <div class="sb-live-slot sb-openarm-frame" data-sb-live-slot="viser"></div>
    </div>
    <div class="sb-nw-stage" data-nw-stage="mujoco" hidden>
      <div class="sb-live-slot sb-openarm-frame" data-sb-live-slot="mujoco" data-src="${MUJOCO_EMBED_SRC}"></div>
    </div>
    <div class="sb-nw-stage" data-nw-stage="printer" hidden><div id="sb-printer-panel"></div></div>
  `;

  let officeApi = null;
  let officeBooted = false;
  const bootOffice = () => {
    if (officeBooted || typeof mountOffice !== "function") return;
    const officeHost = host.querySelector("#sb-office-canvas");
    if (!officeHost) return;
    try {
      officeApi = mountOffice(officeHost, { onDesk });
      officeBooted = true;
    } catch (error) {
      officeHost.textContent = `Office renderer unavailable: ${error.message}. Agents and the other tabs remain available.`;
      officeHost.dataset.ready = "";
    }
  };

  const topCollab = globalThis.document?.getElementById?.("sb-collab-ide");
  const collabApi = topCollab?._collabApi
    || (topCollab ? null : mountCollaborateId(host.querySelector("#sb-collab-id"), { speak }));
  const printerApi = mountSandboxPrinter(host.querySelector("#sb-printer-panel"));
  let wiringApi = null;
  const ensureWiring = () => {
    if (wiringApi) return wiringApi;
    wiringApi = mountSandboxWiring(host.querySelector("#sb-wiring-pane"));
    return wiringApi;
  };

  const slot = (id) => host.querySelector(`[data-nw-stage="${id === "viewport" ? "openarm" : id}"] [data-sb-live-slot="${id}"]`)
    || host.querySelector(`[data-sb-live-slot="${id}"]`);

  const setMode = (mode) => {
    const next = mode || "collab";
    host.querySelectorAll("[data-nw-mode]").forEach((btn) => {
      const on = btn.getAttribute("data-nw-mode") === next;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    host.querySelectorAll("[data-nw-stage]").forEach((stage) => {
      stage.hidden = stage.getAttribute("data-nw-stage") !== next;
    });
    if (next === "openarm") {
      adoptLive("viewport", slot("viewport"), { live: true });
      adoptLive("dimos", host.querySelector("[data-nw-dimos]"), { live: true });
      try { officeApi?.pause?.(); } catch { /* optional */ }
    } else if (next === "viser") {
      adoptLive("viser", slot("viser"), { live: true });
      try { officeApi?.pause?.(); } catch { /* optional */ }
    } else if (next === "mujoco") {
      adoptLive("mujoco", slot("mujoco"), { live: true });
      try { officeApi?.pause?.(); } catch { /* optional */ }
    } else {
      parkLive("viewport", { keepSrc: true });
      parkLive("viser", { keepSrc: true });
      parkLive("mujoco", { keepSrc: true });
      if (next === "wiring") {
        ensureWiring();
        try { officeApi?.pause?.(); } catch { /* optional */ }
      } else if (next === "office") {
        bootOffice();
        try { officeApi?.resume?.(); } catch { /* optional */ }
      } else {
        try { officeApi?.pause?.(); } catch { /* optional */ }
      }
    }
    try {
      window.dispatchEvent(new CustomEvent("render3d-sandbox-nw-mode", {
        detail: { mode: next, token: OAVIS1_TOKEN },
      }));
    } catch { /* optional */ }
  };

  host.querySelectorAll("[data-nw-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.getAttribute("data-nw-mode") || "collab"));
  });

  window.addEventListener("render3d-sandbox-close-viewport", (event) => {
    if (String(event?.detail?.source || "").startsWith("nw-")) return;
    const activeViewport = ["openarm", "office"].some((mode) =>
      host.querySelector(`[data-nw-mode="${mode}"]`)?.getAttribute("aria-selected") === "true");
    if (activeViewport) setMode("collab");
  });
  window.addEventListener("render3d-sandbox-xr", event => {
    if (event.detail?.open) officeApi?.pause?.();
    else if (host.querySelector('[data-nw-mode="office"]')?.getAttribute("aria-selected") === "true") officeApi?.resume?.();
  });

  const mcpSlot = host.querySelector("[data-nw-mcp-slot]");
  void mountMcpConnect(mcpSlot, {
    onChange() { /* MCP listen only — no extra Start/control HUD */ },
  }).catch(() => { /* optional */ });

  setMode("collab");

  return {
    token: OAVIS1_TOKEN,
    collabToken: COLLABID1_TOKEN,
    wireToken: SBWIRE1_TOKEN,
    get office() { return officeApi; },
    collab: collabApi,
    printer: printerApi,
    get wiring() { return wiringApi; },
    setMode,
    highlight: (...args) => officeApi?.highlight?.(...args),
    get card() { return officeApi?.card; },
  };
}
