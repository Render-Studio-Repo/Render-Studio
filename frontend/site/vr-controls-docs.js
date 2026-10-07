/**
 * Docs → VR Controls: headset picker + custom Quest Browser instructions.
 */

import {
  XR_CONTROL_HEADSETS,
  normalizeXrHeadsetId,
  setXrControlHeadset,
  activeXrHeadset,
  XR_CONTROL_MAP_KEY,
} from "../xr/xr-control-map.js?v=xrmap1-20260915-xrclick1-20260915-xrdispatch4&inputfix=20260916-1";

export const VR_CONTROLS_DOCS_HASH = "vr-controls";
export const VR_CONTROLS_DOCS_HREF = "/getting-started.html#vr-controls-20260915-xrdispatch4";
export const VR_DOCS_HEADSET_KEY = "render3d:docsVrHeadset";

export const VR_CONTROL_DOCS_HEADSETS = Object.freeze([
  ...XR_CONTROL_HEADSETS,
]);

const SHARED = {
  browser: "This is Quest Browser WebXR at render3d.app — not a Meta Store app.",
  enter: "Open https://render3d.app in the headset Browser, then tap Enter VR.",
  menu: "Hold A for the tool wheel. Pick Settings (or Scene → Settings) for the in-headset menu.",
  laser: "Both controllers show a thin pick laser. Hold B for a brighter beam. Trigger picks menus and CAD.",
  restart: "Hold the left indented Menu button (☰ on the left Touch Plus — not X or Y) for 3 seconds — the Restart VR scene ring fills, then Studio resets the scene in this immersive-vr session (no splash, no Enter VR). Release before 3s to cancel. Right A is tools, not restart. Also remappable in Settings → VR.",
  debugger: "Click both analog sticks in (L3+R3, ~1s) for Loading debugger mode — tilt / stick-up is never debugger. A live controller layout appears. Click both sticks in again to exit: the compact XR Controls log posts immediately and pops on your PC (scroll + Download). Send log on the Developer tab still works.",
  remap: "Settings → VR lists every binding. Tap a row — Listening for the new button… — then press the new control. Desktop Preferences → Controllers is the same map and auto-saves.",
};

export const VR_HEADSET_INSTRUCTIONS = Object.freeze({
  quest3: {
    title: "Meta Quest 3",
    browser: "Open the Browser app (not Horizon or a sideloaded store build).",
    enter: "Go to https://render3d.app and tap Enter VR. Allow microphone if you want Talk.",
    sticks: "Hold B (right face) and use the left and right sticks to walk in the room. Release B to stop. Hold left ☰ (indented Menu, not X) 3s → Restart VR scene (auto) — stick tilt never restarts. L3+R3 click → debugger. Click both in again to exit and send the log to your PC.",
    buttons: "Right A = tools. Thin lasers always on; Hold B brightens and walks with the sticks. Triggers pick. Grips grab / scale.",
    extras: SHARED.remap,
  },
  quest3s: {
    title: "Meta Quest 3S",
    browser: "Use Browser, same as Quest 3. Store apps cannot load render3d.app WebXR.",
    enter: "Open https://render3d.app in Browser → Enter VR.",
    sticks: "Left ☰ (indented Menu, not X) hold 3s → Restart VR scene (auto). L3+R3 click → debugger. Click both in again to exit and send the log to your PC.",
    buttons: "A / X hold tools. Thin lasers always on; B / Y brightens. Same xr-standard map as Quest 3.",
    extras: SHARED.remap,
  },
  quest2: {
    title: "Meta Quest 2",
    browser: "Meta Quest Browser. Chrome-on-Quest is not required.",
    enter: "Visit https://render3d.app → Enter VR. Passthrough is limited vs Quest 3.",
    sticks: "Hold left ☰ (indented Menu, not X) 3s → Restart VR scene (auto). L3+R3 click → debugger. Click both in again to exit and send the log to your PC.",
    buttons: "Right A hold = tools. Thin lasers always on; B hold brightens. Left ☰ 3s = restart (X does not restart).",
    extras: SHARED.remap,
  },
  pico: {
    title: "Pico",
    browser: "Pico Browser WebXR. Open render3d.app — there is no Pico store build.",
    enter: "Enter immersive VR from the page button. Grant controller permission if asked.",
    sticks: "Hold left menu 3s → Restart VR scene (auto). L3+R3 click → debugger. Click both (usually button 3) again to exit and send the log to your PC.",
    buttons: "Face buttons map like Quest (A/X tools, B/Y laser) unless you remapped them.",
    extras: SHARED.remap,
  },
  vision: {
    title: "Apple Vision Pro",
    browser: "Safari WebXR. Pinch instead of a physical trigger when no controllers are paired.",
    enter: "Open https://render3d.app in Safari and enter immersive. Hand rays replace Hold B if no gamepad.",
    sticks: "Hold left menu 3s → Restart VR scene (auto). L3+R3 click → debugger (exit sends the log to your PC). Hands-only: Settings → VR → Restart scene.",
    buttons: "Looking / pinch picks. Remap in Preferences if you attach compatible controllers.",
    extras: SHARED.remap,
  },
  desktop: {
    title: "Desktop / emulator",
    browser: "Chrome or Edge with WebXR. Use the Immersive Web emulator or a tethered headset.",
    enter: "Click Enter VR on render3d.app. Quest Browser on-device is the supported headset path.",
    sticks: "Hold left menu 3s → Restart VR scene (auto). L3+R3 click → debugger. Click L3+R3 again to exit and send the log to your PC.",
    buttons: "Map buttons in Preferences → Controllers so the emulator pad matches Studio.",
    extras: SHARED.remap,
  },
  openxr: {
    title: "Generic OpenXR",
    browser: "Any OpenXR browser (Wolvic, Helio, vendor WebXR). Open render3d.app — not a store APK.",
    enter: "Enter immersive VR from the page. Grant controller / microphone if asked.",
    sticks: "Same on every headset: hold left menu 3s → Restart VR scene (auto). L3+R3 click → debugger. Click both in again to exit and send the log to your PC.",
    buttons: "xr-standard map: trigger 0, grip 1, stick click 3, A/X 4, B/Y 5 — remap if your runtime differs.",
    extras: SHARED.remap,
  },
});

export function vrDocsHeadsetId(raw) {
  return normalizeXrHeadsetId(raw);
}

export function readDocsVrHeadset() {
  try {
    const stored = localStorage.getItem(VR_DOCS_HEADSET_KEY);
    if (stored) return vrDocsHeadsetId(stored);
  } catch { /* ignore */ }
  try {
    return activeXrHeadset();
  } catch {
    return "quest3";
  }
}

export function persistDocsVrHeadset(id) {
  const hid = vrDocsHeadsetId(id);
  try { localStorage.setItem(VR_DOCS_HEADSET_KEY, hid); } catch { /* ignore */ }
  try { setXrControlHeadset(hid); } catch { /* ignore */ }
  return hid;
}

export function vrHeadsetInstructions(id) {
  const hid = vrDocsHeadsetId(id);
  return VR_HEADSET_INSTRUCTIONS[hid] || VR_HEADSET_INSTRUCTIONS.quest3;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function vrControlsDocsIntroHtml(headset = readDocsVrHeadset()) {
  const hid = vrDocsHeadsetId(headset);
  const info = vrHeadsetInstructions(hid);
  const options = VR_CONTROL_DOCS_HEADSETS.map((h) => (
    `<option value="${esc(h.id)}"${h.id === hid ? " selected" : ""}>${esc(h.label)}</option>`
  )).join("");
  return `<header class="gs-robotics-head gs-vr-controls-head" id="vr-controls" data-vr-controls-docs>
    <p class="gs-feature-index">Docs category</p>
    <h3>VR Controls</h3>
    <p class="gs-summary">${esc(SHARED.browser)} Select your headset for custom Browser / Enter VR / stick-click notes. Bindings also live in the headset: Hold A → Settings → <strong>VR</strong>.</p>
    <div class="gs-robotics-ip">
      <label class="gs-robotics-ip-label" for="gs-vr-headset">Your headset</label>
      <div class="gs-robotics-ip-row">
        <select id="gs-vr-headset" class="gs-robotics-ip-input" data-vr-headset-select>${options}</select>
      </div>
      <p class="gs-robotics-ip-examples muted small">Last choice is saved in this browser (${esc(XR_CONTROL_MAP_KEY)} + docs headset).</p>
    </div>
    <ol class="gs-vr-headset-steps" data-vr-headset-steps>
      <li><strong>Browser</strong> — ${esc(info.browser)}</li>
      <li><strong>Enter VR</strong> — ${esc(info.enter)}</li>
      <li><strong>Menu</strong> — ${esc(SHARED.menu)}</li>
      <li><strong>Laser</strong> — ${esc(info.buttons)}</li>
      <li><strong>Debugger</strong> — ${esc(SHARED.debugger)}</li>
      <li><strong>Restart</strong> — ${esc(SHARED.restart)}</li>
      <li><strong>Remap</strong> — ${esc(info.extras)}</li>
    </ol>
  </header>`;
}

export function bindVrControlsDocs(root = document) {
  const select = root.querySelector?.("[data-vr-headset-select]");
  if (!select) return;
  select.value = readDocsVrHeadset();
  const paint = () => {
    const hid = persistDocsVrHeadset(select.value);
    const host = root.querySelector?.("[data-vr-headset-steps]");
    if (!host) return;
    const info = vrHeadsetInstructions(hid);
    host.innerHTML = `
      <li><strong>Browser</strong> — ${esc(info.browser)}</li>
      <li><strong>Enter VR</strong> — ${esc(info.enter)}</li>
      <li><strong>Menu</strong> — ${esc(SHARED.menu)}</li>
      <li><strong>Laser</strong> — ${esc(info.buttons)}</li>
      <li><strong>Debugger</strong> — ${esc(SHARED.debugger)}</li>
      <li><strong>Restart</strong> — ${esc(SHARED.restart)}</li>
      <li><strong>Remap</strong> — ${esc(info.extras)}</li>`;
  };
  select.addEventListener("change", paint);
}

export const VR_CONTROLS_GUIDES = Object.freeze([
  {
    id: "vr-enter",
    category: "vr",
    title: "Enter VR in Browser",
    demo: "preferences",
    gif: "/docs/media/preferences.gif?v=20260724-unique",
    summary: "Render Studio is WebXR in the headset browser — not an installable store app.",
    steps: [
      "Put on the headset and open Browser (Quest) or Safari (Vision Pro).",
      "Go to https://render3d.app — not a sideloaded APK.",
      "Tap Enter VR. Stay in that one WebXR session.",
    ],
    ask: "How do I enter Render Studio VR from Quest Browser?",
    keywords: ["quest", "webxr", "enter vr", "browser", "quest 3", "pico"],
    where: "render3d.app → Enter VR",
  },
  {
    id: "vr-laser",
    category: "vr",
    title: "Laser, tools & Settings",
    demo: "preferences",
    gif: "/docs/media/preferences.gif?v=20260724-unique",
    summary: "Hold B for the laser. Hold A for the tool wheel. Settings lists every live binding.",
    steps: [
      "Hold B — laser stays on while B is down.",
      "Hold A — tool wheel. Open Settings for Controller / VR / Environment.",
      "Open the VR tab to see laser, restart, handedness, and remaps.",
    ],
    ask: "Where are VR controls inside the headset menu?",
    keywords: ["hold b", "laser", "hold a", "settings", "vr menu"],
    where: "Hold A → Settings → VR",
  },
  {
    id: "vr-debugger",
    category: "vr",
    title: "Headset debugger",
    demo: "preferences",
    gif: "/docs/media/preferences.gif?v=20260724-unique",
    summary: "Hold both analog sticks to load debugger mode. Send log from Developer. Click both sticks in to exit. The PC popup appears only after you send.",
    steps: [
      "Hold both analog sticks for about one second — Loading debugger mode.",
      "The panel shows which Quest / Pico / Vision / OpenXR buttons respond. Then Settings → Developer → Send log.",
      "Click both analog sticks in (L3+R3) to exit. The JSONL dump opens on your PC only after Send — not on VR enter.",
    ],
    ask: "How do I open the in-headset VR debugger?",
    keywords: ["debugger", "l3", "r3", "thumbstick", "both sticks", "xr-ctl"],
    where: "Hold both sticks · Settings → VR",
  },
  {
    id: "vr-restart",
    category: "vr",
    title: "Restart the VR scene",
    demo: "preferences",
    gif: "/docs/media/preferences.gif?v=20260724-unique",
    summary: "Hold the left indented Menu button (☰, not X) for 3 seconds — the Restart VR scene ring fills, then Studio resets the scene while staying in VR. Release to cancel. Also remappable in Settings → VR.",
    steps: [
      "Hold the left controller indented Menu button (☰ — not X, not right A, not both sticks) until the Restart VR scene ring completes.",
      "Keep holding through 3 seconds. The scene resets in this immersive-vr session — no splash, no Enter VR. Release before 3s to cancel. Short tap still opens the in-VR menu.",
      "Or tap Restart scene in Settings → VR / remap it in Preferences → Controllers.",
    ],
    ask: "How do I restart the VR scene without the debugger hold?",
    keywords: ["restart", "left menu", "menu button", "remap", "vr scene", "soft reload"],
    where: "Hold left menu 3s · Settings → VR · Preferences → Controllers",
  },
  {
    id: "vr-remap",
    category: "vr",
    title: "Remap VR controls",
    demo: "preferences",
    gif: "/docs/media/preferences.gif?v=20260724-unique",
    summary: "Desktop Preferences → Controllers and the in-VR remapper share one per-headset profile.",
    steps: [
      "Pick your headset (Quest 3 / 3S / 2 / Pico / Vision Pro / desktop).",
      "Click Remap or a VR row, then press the new button.",
      "Changes auto-save and sync immediately. Reset VR controls restores defaults.",
    ],
    ask: "How do I remap Quest buttons in Render Studio?",
    keywords: ["remap", "controllers", "preferences", "bindings"],
    where: "Account → Preferences → Controllers · Settings → VR",
  },
]);
