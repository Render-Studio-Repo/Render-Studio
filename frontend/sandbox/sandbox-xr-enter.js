/**
 * Sandbox VR enter — mirrors the single Studio viewport. Token sbxr1.
 * Does not start a second WebXR session (Quest OpenArm teleop owns XR).
 * Desktop bots room is 2D status seats — no extra GPU renderer.
 */

export const SBXR1_TOKEN = "sbxr1";
import { OFFICE_AGENTS } from "./office-agents.js?v=office2-printer1";
import { adoptLive } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import { crewSeatInventory, deriveSeatStatus, avatarChipHtml } from "./crew-desk-status.js?v=20260923-draw-recordings1";

export const VR_BOT_SEATS = Object.freeze(OFFICE_AGENTS.map((a) => ({ ...a, label: a.name })));

let desktopOverlay = null;
let entering = false;
let endCallback = null;
let mirrored = false;

export function sandboxControlObservation() {
  return { session: mirrored, trigger: "unknown", hands: [], mode: "mirror", token: SBXR1_TOKEN };
}

export function isXrSupported() {
  return !!(navigator.xr && typeof navigator.xr.isSessionSupported === "function");
}

export async function canEnterImmersiveVr() {
  return false;
}

function ensureDesktopOverlay() {
  if (desktopOverlay) return desktopOverlay;
  const wrap = document.createElement("div");
  wrap.id = "sb-xr-desktop";
  wrap.className = "sb-xr-desktop";
  wrap.innerHTML = `
    <header class="sb-xr-desktop-bar">
      <strong>Desktop bots room</strong>
      <span class="muted small" data-sb-xr-desk-status>Mirror · no second XR</span>
      <button type="button" class="sb-agent-btn" data-sb-xr-exit>Exit</button>
    </header>
    <div class="sb-xr-bots" data-sb-xr-bots></div>
  `;
  document.body.appendChild(wrap);
  wrap.querySelector("[data-sb-xr-exit]")?.addEventListener("click", () => {
    void exitSandboxVr();
  });
  desktopOverlay = wrap;
  return wrap;
}

function paintBots() {
  const list = desktopOverlay?.querySelector("[data-sb-xr-bots]");
  if (!list) return;
  const seats = crewSeatInventory();
  list.innerHTML = seats.map((s) => {
    const st = deriveSeatStatus(s.id, []);
    return `<div class="sb-xr-bot" data-agent="${s.id}">${avatarChipHtml(s)}<b>${s.name}</b><small>${st.status} · ${st.line}</small></div>`;
  }).join("");
}

function hideDesktopOverlay() {
  if (desktopOverlay) desktopOverlay.hidden = true;
  mirrored = false;
}

function viewportSlot() {
  return globalThis.document?.querySelector?.("#sb-collab-viewport")
    || globalThis.document?.querySelector?.("[data-sb-live-slot='viewport']");
}

export async function enterSandboxVr({ onStatus, onEnd, withBots = true } = {}) {
  const set = (m) => onStatus?.(m);
  if (entering) return { ok: false, reason: "entering" };
  if (mirrored && desktopOverlay && !desktopOverlay.hidden) {
    set(withBots ? "Already in bots room" : "Already mirroring viewport");
    return { ok: true, already: true, desktop: true, mirrored: true, mode: "mirror" };
  }
  entering = true;
  endCallback = onEnd;
  try {
    adoptLive("viewport", viewportSlot(), { live: true });
    const wrap = ensureDesktopOverlay();
    wrap.hidden = false;
    paintBots();
    mirrored = true;
    const statusEl = wrap.querySelector("[data-sb-xr-desk-status]");
    if (statusEl) statusEl.textContent = `Desktop bots room · ${VR_BOT_SEATS.length} seated · viewport mirror`;
    set(withBots
      ? `Desktop bots room · ${VR_BOT_SEATS.length} seated`
      : "Viewport mirror · no second XR session");
    try {
      window.dispatchEvent(new CustomEvent("render3d-sandbox-xr", {
        detail: { open: true, token: SBXR1_TOKEN, withBots: !!withBots, mode: "mirror" },
      }));
    } catch { /* optional */ }
    return {
      ok: true,
      desktop: true,
      mirrored: true,
      withBots: !!withBots,
      mode: "mirror",
      bots: withBots ? VR_BOT_SEATS.map((b) => b.id) : [],
    };
  } catch (err) {
    hideDesktopOverlay();
    set(`Enter failed · ${String(err?.message || err).slice(0, 80)}`);
    return { ok: false, reason: "request_failed", error: err };
  } finally {
    entering = false;
  }
}

export async function exitSandboxVr() {
  hideDesktopOverlay();
  try {
    window.dispatchEvent(new CustomEvent("render3d-sandbox-xr", {
      detail: { open: false, token: SBXR1_TOKEN },
    }));
  } catch { /* optional */ }
  const callback = endCallback;
  endCallback = null;
  callback?.();
}
