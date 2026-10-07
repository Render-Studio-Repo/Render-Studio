/**
 * Stick / menu gestures (all OpenXR headsets):
 * - Hold left ☰ (indented Menu, not X/Y) 3s → spinning Restart VR scene → auto soft-refresh
 * - Click both analog sticks in (L3+R3) ~1s → Loading debugger mode
 * - Click both sticks in (L3+R3) while debugger is open → exit + send log to PC
 * Analog tilt / Y-up is never debugger (zoom / scroll / locomotion).
 * Both-sticks is never restart. Right A is the tool wheel, never restart.
 */

import { xrThumbstickClicked } from "./xr-share-throw.js?v=20260914-vrshare1-xrstick1-xrrest1-xrrest2-20260915-xrdbg2";
import {
  gamepadActionPressed,
  gamepadDigitalPressed,
  gamepadMenuComponentHeld,
  XR_PROFILE_MENU_BUTTON,
} from "./xr-control-map.js?v=xrmap1-xrrest1-xrrest2-20260915-xrclick1-20260915-xrmenu2-20260915-xrdbg2-20260915-xrmenu3-20260915-xrdispatch4&inputfix=20260916-1";

export const XR_STICK_RESTART_HOLD_MS = 1000;
export const XR_STICK_RESTART_LABEL = "Restart VR scene";
/** xr-standard X on the left pad — never restart. */
export const XR_LEFT_X_BUTTON = 4;
/** Capacitive thumbrest on Touch Plus — ghosts on session start, never restart. */
export const XR_LEFT_THUMBREST_BUTTON = 6;
/**
 * Quest 3 / Touch Plus left ☰ (indent beside X). Profile
 * `meta-quest-touch-plus` left `gamepad.buttons[7] === "menu"`.
 * Runtime extras 8–10 (and analog ghost on 7 while moving) are not Menu.
 */
export const XR_LEFT_MENU_BUTTON = XR_PROFILE_MENU_BUTTON;
/** @deprecated alias — same as XR_LEFT_MENU_BUTTON (not thumbrest 6). */
export const XR_LEFT_MENU_EXTRA = XR_LEFT_MENU_BUTTON;
export const XR_LEFT_MENU_RESTART_CACHE_CLICK = "20260915-xrclick1";
export const XR_IN_SESSION_RESTART_CACHE = "20260915-xrmenu3";
export const XR_LEFT_MENU_RESTART_HOLD_MS = 3000;
export const XR_LEFT_RESTART_HOLD_MS = XR_LEFT_MENU_RESTART_HOLD_MS;
export const XR_DEBUGGER_HOLD_MS = 1000;
export const XR_DEBUGGER_HOLD_LABEL = "Loading debugger mode";
export const XR_STICK_RESTART_CACHE = "xrstick1";
export const XR_DEBUGGER_CACHE = "xrdbg2";
export const XR_LEFT_MENU_RESTART_CACHE = "xrrest2";
export const XR_EXIT_VR_HOLD_MS = 1500;
/** Release before this is a tap: exit VR. No ring until the hold is past it. */
export const XR_EXIT_VR_TAP_MS = 280;
export const XR_EXIT_VR_HOLD_LABEL = "Refresh VR scene";
export const XR_EXIT_VR_HOLD_EVENT = "exitvr";
export const XR_SOFT_RESUME_KEY = "render3d:xrSoftResume";
export const XR_SOFT_RESUME_MAX_MS = 20000;
export const XR_LEFT_MENU_RESTART_EVENT = "lmenu";
/** Ignore ghost menu / trigger / face `.pressed` on VR enter (~400ms). */
export const XR_ENTER_STICKY_IGNORE_MS = 400;
/** Ignore ghost menu pressed-true on session start (~32 frames @ 72Hz ≈ 440ms). */
export const XR_LEFT_MENU_RESTART_SETTLE_FRAMES = 32;
export const XR_LEFT_MENU_RESTART_SETTLE_MS = XR_ENTER_STICKY_IGNORE_MS;

export function stickClickedForRestart(gamepad, { mapped = true } = {}) {
  if (mapped && gamepadActionPressed(gamepad, "stickClick")) return true;
  return xrThumbstickClicked(gamepad);
}

export function thumbstickTiltOnly(gamepad, dead = 0.35) {
  const ax = gamepad?.axes || [];
  const tilt = Math.max(
    Math.abs(Number(ax[0]) || 0),
    Math.abs(Number(ax[1]) || 0),
    Math.abs(Number(ax[2]) || 0),
    Math.abs(Number(ax[3]) || 0),
  );
  return tilt >= dead && !stickClickedForRestart(gamepad);
}

function physicalPads(sources = []) {
  const out = [];
  for (const source of sources || []) {
    if (!source?.gamepad || source.hand) continue;
    const n = source.gamepad.buttons?.length || 0;
    if (n < 3) continue;
    out.push(source);
  }
  return out;
}

/** Both left and right (or two physical pads) have thumbstick *click* down. Tilt ignored. */
export function bothThumbsticksClicked(sources = [], { clicked = stickClickedForRestart } = {}) {
  const pads = physicalPads(sources);
  if (pads.length < 2) return false;
  const left = pads.filter((s) => s.handedness === "left");
  const right = pads.filter((s) => s.handedness === "right");
  if (left.length && right.length) {
    return left.some((s) => clicked(s.gamepad)) && right.some((s) => clicked(s.gamepad));
  }
  return pads.filter((s) => clicked(s.gamepad)).length >= 2;
}

export function stickTiltHeld(gamepad, dead = 0.55) {
  const ax = gamepad?.axes || [];
  const a = Math.hypot(Number(ax[0]) || 0, Number(ax[1]) || 0);
  const b = Math.hypot(Number(ax[2]) || 0, Number(ax[3]) || 0);
  return a >= dead || b >= dead;
}

/** Both physical pads have analog sticks held off-center. */
export function bothSticksHeld(sources = [], { dead = 0.55 } = {}) {
  const pads = physicalPads(sources);
  if (pads.length < 2) return false;
  const held = (s) => stickTiltHeld(s.gamepad, dead);
  const left = pads.filter((s) => s.handedness === "left");
  const right = pads.filter((s) => s.handedness === "right");
  if (left.length && right.length) return left.some(held) && right.some(held);
  return pads.filter(held).length >= 2;
}

/** Enter debugger: both thumbstick *buttons* (L3+R3). Tilt / Y-up never counts. One stick cancels. */
export function debuggerEnterHeld(sources = []) {
  return bothThumbsticksClicked(sources);
}

/**
 * Left-hand indented ☰ only. X [4], Y [5], thumbrest [6], touchpad [2], stick
 * tilt, stick click, and analog extras 8–10 must not restart. Right A never
 * counts. Menu requires `.pressed === true` on slot 7; analog values are ignored.
 */
export function leftMenuButtonDown(gamepad) {
  if (!gamepad?.buttons?.length) return false;
  if (gamepad.buttons.length <= XR_LEFT_MENU_BUTTON) return false;
  return gamepadMenuComponentHeld(gamepad, XR_LEFT_MENU_BUTTON);
}

/**
 * Why a left-pad "hold" would look like menu: real ☰, analog ghost, stick
 * travel, stick click, or X. Restart ring only accepts `"menu"`.
 */
export function leftMenuHoldSource(gamepad) {
  if (!gamepad) return "";
  if (leftMenuButtonDown(gamepad)) return "menu";
  if (stickTiltHeld(gamepad, 0.35) || thumbstickTiltOnly(gamepad, 0.35)) return "axes";
  if (stickClickedForRestart(gamepad)) return "stick";
  if (gamepadDigitalPressed(gamepad, XR_LEFT_X_BUTTON)) return "x";
  const analog = Number(gamepad.buttons?.[XR_LEFT_MENU_BUTTON]?.value) || 0;
  if (analog > 0.1) return "analog";
  return "";
}

export function xrIgnoreStickyPress({
  enteredAt = 0,
  now = 0,
  ignoreMs = XR_ENTER_STICKY_IGNORE_MS,
} = {}) {
  const start = Number(enteredAt) || 0;
  if (!(start > 0)) return false;
  const windowMs = Number(ignoreMs);
  const hold = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : XR_ENTER_STICKY_IGNORE_MS;
  return (Number(now) - start) < hold;
}

/** Left pad has a ray/grip space (tracking). Unposed sources often report menu down. */
export function leftMenuSourcesPosed(sources = []) {
  const pads = physicalPads(sources).filter((s) => s.handedness === "left");
  if (!pads.length) return false;
  return pads.some((s) => !!(s.targetRaySpace || s.gripSpace || s._posed === true));
}

/** Left menu held — not the right pad, not the debugger both-stick hold. */
export function leftMenuOnlyHeld(sources = []) {
  const pads = physicalPads(sources);
  const left = pads.filter((s) => s.handedness === "left");
  if (!left.length) return false;
  if (!left.some((s) => leftMenuButtonDown(s.gamepad))) return false;
  if (debuggerEnterHeld(sources)) return false;
  return true;
}

/** Left analog tilt only — not click-in, not the right stick. Not the restart gesture. */
export function leftStickOnlyHeld(sources = [], { dead = 0.55 } = {}) {
  const pads = physicalPads(sources);
  const left = pads.filter((s) => s.handedness === "left");
  if (!left.length) return false;
  const leftTilt = left.some((s) => stickTiltHeld(s.gamepad, dead) && !stickClickedForRestart(s.gamepad));
  if (!leftTilt) return false;
  if (debuggerEnterHeld(sources)) return false;
  const right = pads.filter((s) => s.handedness === "right");
  if (right.some((s) => stickTiltHeld(s.gamepad, dead) || stickClickedForRestart(s.gamepad))) return false;
  return true;
}

export function consumeXrSoftResume(raw, now = Date.now()) {
  if (raw == null || raw === "") return null;
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const t = Number(parsed.t) || 0;
  if (!t || now - t > XR_SOFT_RESUME_MAX_MS) return null;
  return parsed;
}

export function writeXrSoftResume(extra = {}) {
  const payload = { t: Date.now(), v: 1, ...extra };
  try { sessionStorage.setItem(XR_SOFT_RESUME_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
  return payload;
}

export function xrSoftReloadHref(href = "/") {
  try {
    const url = new URL(href, "https://render3d.app/");
    url.searchParams.set("xrsr", String(Date.now()));
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return `/?xrsr=${Date.now()}`;
  }
}

/** Strip ?xrsr= after a soft reload. Cache-bust only — never a restart trigger. */
export function stripXrSoftResumeQuery(href = "/") {
  try {
    const url = new URL(href, "https://render3d.app/");
    const consumed = url.searchParams.has("xrsr");
    url.searchParams.delete("xrsr");
    return { href: `${url.pathname}${url.search}${url.hash}`, consumed };
  } catch {
    return { href: "/", consumed: false };
  }
}

/** Auto-enter XR after consume is OK. Consuming the stamp must not restart again. */
export function xrSoftResumeShouldRestart() {
  return false;
}

export function offerXrSessionForSoftReload(xr = typeof navigator !== "undefined" ? navigator.xr : null) {
  if (!xr || typeof xr.offerSession !== "function") return false;
  try {
    void xr.offerSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "hit-test"],
    });
    return true;
  } catch {
    return false;
  }
}

export function emptyStickRestartState() {
  return { downAt: 0, progress: 0, fired: false, started: false };
}

export function emptyLeftMenuRestartState() {
  return {
    downAt: 0,
    progress: 0,
    fired: false,
    started: false,
    sawRelease: false,
    settle: 0,
    posedAt: 0,
  };
}

export function tickStickRestart({
  bothDown = false,
  now = 0,
  state = emptyStickRestartState(),
  holdMs = XR_STICK_RESTART_HOLD_MS,
} = {}) {
  const hold = Number(holdMs) > 0 ? Number(holdMs) : XR_STICK_RESTART_HOLD_MS;
  const t = Number(now) || 0;
  const prev = state && typeof state === "object" ? state : emptyStickRestartState();
  if (!bothDown) {
    const cancelled = (prev.started || prev.downAt > 0) && !prev.fired;
    return {
      progress: 0,
      showing: false,
      complete: false,
      cancelled,
      next: emptyStickRestartState(),
    };
  }
  if (!prev.started) {
    const start = t > 0 ? t : 0.001;
    return {
      progress: 0,
      showing: true,
      complete: false,
      cancelled: false,
      next: { downAt: start, progress: 0, fired: false, started: true },
    };
  }
  const downAt = prev.downAt > 0 ? prev.downAt : (t > 0 ? t : 0.001);
  const elapsed = Math.max(0, t - downAt);
  const progress = Math.max(0, Math.min(1, elapsed / hold));
  const complete = progress >= 1 && !prev.fired;
  return {
    progress,
    showing: true,
    complete,
    cancelled: false,
    next: { downAt, progress, fired: complete || prev.fired, started: true },
  };
}

/**
 * Left-menu restart: ignore unposed / first N frames, require a rising edge
 * after that, hold continuously holdMs, then fire once until release.
 */
export function tickLeftMenuRestart({
  held = false,
  posed = false,
  now = 0,
  state = emptyLeftMenuRestartState(),
  holdMs = XR_LEFT_MENU_RESTART_HOLD_MS,
  settleFrames = XR_LEFT_MENU_RESTART_SETTLE_FRAMES,
  settleMs = 0,
} = {}) {
  const hold = Number(holdMs) > 0 ? Number(holdMs) : XR_LEFT_MENU_RESTART_HOLD_MS;
  const t = Number(now) || 0;
  const need = Math.max(1, Number(settleFrames) || XR_LEFT_MENU_RESTART_SETTLE_FRAMES);
  const needMs = Number(settleMs) > 0 ? Number(settleMs) : 0;
  const prev = state && typeof state === "object" ? state : emptyLeftMenuRestartState();
  const idle = {
    progress: 0,
    showing: false,
    complete: false,
    cancelled: false,
  };

  if (!posed) {
    const settle = Math.min(need, (Number(prev.settle) || 0) + 1);
    if (prev.started && held && !prev.fired) {
      return { ...idle, next: { ...prev, settle, posedAt: 0 } };
    }
    return {
      ...idle,
      next: {
        ...emptyLeftMenuRestartState(),
        settle,
        sawRelease: false,
        posedAt: 0,
      },
    };
  }

  const posedAt = Number(prev.posedAt) > 0 ? Number(prev.posedAt) : (t > 0 ? t : 0.001);
  const settle = Math.min(need, (Number(prev.settle) || 0) + 1);
  const timeSettling = needMs > 0 && (t - posedAt) < needMs;
  if (settle < need || timeSettling) {
    return {
      ...idle,
      next: {
        ...emptyLeftMenuRestartState(),
        settle,
        sawRelease: prev.sawRelease || !held,
        posedAt,
      },
    };
  }

  if (!held) {
    const cancelled = (prev.started || prev.downAt > 0) && !prev.fired;
    return {
      progress: 0,
      showing: false,
      complete: false,
      cancelled,
      next: {
        ...emptyLeftMenuRestartState(),
        settle,
        sawRelease: true,
        posedAt,
      },
    };
  }

  if (!prev.sawRelease) {
    return {
      ...idle,
      next: { ...emptyLeftMenuRestartState(), settle, sawRelease: false, posedAt },
    };
  }

  if (prev.fired) {
    return {
      progress: 1,
      showing: false,
      complete: false,
      cancelled: false,
      next: { ...prev, settle, sawRelease: true, fired: true, progress: 1, posedAt },
    };
  }

  if (!prev.started) {
    const start = t > 0 ? t : 0.001;
    return {
      progress: 0,
      showing: true,
      complete: false,
      cancelled: false,
      next: {
        downAt: start,
        progress: 0,
        fired: false,
        started: true,
        sawRelease: true,
        settle,
        posedAt,
      },
    };
  }

  const downAt = prev.downAt > 0 ? prev.downAt : (t > 0 ? t : 0.001);
  const elapsed = Math.max(0, t - downAt);
  if (prev.progress === 0 && elapsed >= hold) {
    const start = t > 0 ? t : 0.001;
    return {
      progress: 0,
      showing: true,
      complete: false,
      cancelled: false,
      next: {
        downAt: start,
        progress: 0,
        fired: false,
        started: true,
        sawRelease: true,
        settle,
        posedAt,
      },
    };
  }
  const progress = Math.max(0, Math.min(1, elapsed / hold));
  const complete = progress >= 1 && !prev.fired;
  return {
    progress,
    showing: true,
    complete,
    cancelled: false,
    next: {
      downAt,
      progress,
      fired: complete || prev.fired,
      started: true,
      sawRelease: true,
      settle,
      posedAt,
    },
  };
}

export function paintStickRestartHud(ctx, {
  progress = 0,
  label = XR_STICK_RESTART_LABEL,
  spin = 0,
  size = 256,
} = {}) {
  if (!ctx) return;
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const w = Number(size) || 256;
  const cx = w / 2;
  const cy = w / 2 - 8;
  const r = w * 0.32;
  ctx.clearRect(0, 0, w, w);
  ctx.fillStyle = "rgba(15,23,42,0.82)";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(148,163,184,0.45)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2 + spin, -Math.PI / 2 + spin + p * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 18px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label || XR_STICK_RESTART_LABEL).slice(0, 22), cx, cy + r + 22);
}

/** Progress ring after the tap window. Full 2s resets in place; a tap exits. */
export function paintExitVrHoldCircle(ctx, {
  progress = 0,
  size = 128,
} = {}) {
  if (!ctx) return;
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const w = Number(size) || 128;
  const cx = w / 2;
  const cy = w / 2;
  const r = w * 0.42;
  ctx.clearRect(0, 0, w, w);
  ctx.strokeStyle = "rgba(148,163,184,0.5)";
  ctx.lineWidth = Math.max(6, w * 0.07);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = Math.max(8, w * 0.09);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
  ctx.stroke();
}

export function tickExitVrHold({
  held = false,
  now = 0,
  state = emptyStickRestartState(),
  holdMs = XR_EXIT_VR_HOLD_MS,
  tapMs = XR_EXIT_VR_TAP_MS,
} = {}) {
  const tapWindow = Number(tapMs) > 0 ? Number(tapMs) : XR_EXIT_VR_TAP_MS;
  const tick = tickStickRestart({
    bothDown: held === true,
    now,
    state,
    holdMs: Number(holdMs) > 0 ? Number(holdMs) : XR_EXIT_VR_HOLD_MS,
  });
  if (tick.cancelled) {
    const elapsed = Math.max(0, (Number(now) || 0) - (Number(state?.downAt) || 0));
    return { ...tick, tap: elapsed < tapWindow, showing: false };
  }
  const elapsed = Math.max(0, (Number(now) || 0) - (Number(tick.next?.downAt) || 0));
  return { ...tick, tap: false, showing: tick.showing && elapsed >= tapWindow };
}
