/**
 * Per-headset VR control remapping. Desktop Preferences and the in-VR Settings
 * → VR tab share one store + event so changes sync instantly.
 */

export const XR_CONTROL_MAP_KEY = "render3d:xrControlMap:v1";
export const XR_CONTROL_MAP_EVENT = "render3d:xr-control-map";
export const XR_CONTROL_MAP_CACHE = "xrmap1";

export const XR_CONTROL_HEADSETS = Object.freeze([
  { id: "quest3", label: "Quest 3", family: "quest" },
  { id: "quest3s", label: "Quest 3S", family: "quest" },
  { id: "quest2", label: "Quest 2", family: "quest" },
  { id: "pico", label: "Pico", family: "pico" },
  { id: "vision", label: "Apple Vision Pro", family: "vision" },
  { id: "desktop", label: "Desktop / emulator", family: "desktop" },
  { id: "openxr", label: "Generic OpenXR", family: "openxr" },
]);

/**
 * xr-standard Quest Touch Plus (`meta-quest-touch-plus` left layout):
 * 4 X, 5 Y, 6 thumbrest, 7 ☰ Menu (indent beside X — not analog extras 8–10).
 */
export const XR_STANDARD_BUTTON_LABELS = Object.freeze({
  0: "Trigger",
  1: "Squeeze / grip",
  2: "Touchpad",
  3: "Thumbstick click",
  4: "A / X",
  5: "B / Y",
  6: "Thumbrest",
  7: "Menu",
});

/** Profile `gamepad.buttons[7] === "menu"` on the left Touch Plus pad. */
export const XR_PROFILE_MENU_BUTTON = 7;

const XR_CONTROL_STEMS = Object.freeze({
  0: "Trigger",
  1: "Squeeze",
  2: "Touchpad",
  3: "StickClick",
  4: { left: "X", right: "A", "": "AX" },
  5: { left: "Y", right: "B", "": "BY" },
  6: "Thumbrest",
  7: { left: "Menu", right: "Btn7", "": "Menu" },
});

const HUD_FACE = Object.freeze({
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  ax: "A/X",
  by: "B/Y",
});

export function xrHandSide(handedness) {
  const h = String(handedness || "").toLowerCase();
  if (h === "left" || h === "l") return "left";
  if (h === "right" || h === "r") return "right";
  return "";
}

export function xrControlStem(index, handedness = "") {
  const i = Number(index);
  const side = xrHandSide(handedness);
  const row = XR_CONTROL_STEMS[i];
  if (row && typeof row === "object") return row[side] || row[""] || `Btn${i}`;
  if (typeof row === "string") return row;
  if (Number.isInteger(i) && i >= 0) return `Btn${i}`;
  return "Unknown";
}

/** JSONL id: rightTrigger, leftSqueeze, leftMenu, rightStickClick, rightA. */
export function xrControlId(index, handedness = "") {
  const side = xrHandSide(handedness);
  const stem = xrControlStem(index, handedness);
  return side ? `${side}${stem}` : stem.charAt(0).toLowerCase() + stem.slice(1);
}

export function xrAxesControlId(handedness = "") {
  const side = xrHandSide(handedness);
  if (side === "left") return "leftAxes";
  if (side === "right") return "rightAxes";
  return "axes";
}

export function xrAxesHudLabel(handedness = "") {
  const side = xrHandSide(handedness);
  if (side === "left") return "left stick move";
  if (side === "right") return "right stick move";
  return "stick move";
}

/** HUD: "right trigger", "left menu", "right stick click", "right stick move". */
export function xrControlHudLabelFromId(id) {
  const raw = String(id || "");
  if (raw === "leftAxes") return xrAxesHudLabel("left");
  if (raw === "rightAxes" || raw === "axes") return xrAxesHudLabel(raw === "axes" ? "" : "right");
  const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
  const parts = spaced.split(/\s+/).filter(Boolean);
  const hand = parts[0] === "left" || parts[0] === "right" ? parts.shift() : "";
  const rest = parts.join(" ").toLowerCase();
  const btn = rest.match(/^btn\s*(\d+)$/i);
  const pretty = HUD_FACE[rest] || (btn ? `button ${btn[1]}` : rest);
  return hand ? `${hand} ${pretty}` : pretty;
}

export function xrControlHudLabel(index, handedness = "") {
  return xrControlHudLabelFromId(xrControlId(index, handedness));
}

export const XR_CONTROL_ACTIONS = Object.freeze([
  { id: "trigger", label: "Trigger · pick", defaultBtn: 0, icon: "aim" },
  { id: "squeeze", label: "Squeeze · grab", defaultBtn: 1, icon: "move" },
  { id: "menu", label: "Hold A · tools", defaultBtn: 4, icon: "wheel" },
  { id: "laser", label: "Hold B · laser", defaultBtn: 5, icon: "view" },
  { id: "stickClick", label: "Thumbstick click", defaultBtn: 3, icon: "place" },
  { id: "restart", label: "Hold left menu · restart", defaultBtn: 7, kind: "left-menu", icon: "restore" },
]);

const ACTION_IDS = XR_CONTROL_ACTIONS.map((a) => a.id);
const HEADSET_IDS = XR_CONTROL_HEADSETS.map((h) => h.id);
const GESTURE_KINDS = new Set(["both-sticks", "left-menu"]);

function gestureActionKind(action, row) {
  if (row?.kind === "button") return "button";
  if (GESTURE_KINDS.has(action.kind)) return action.kind;
  return action.kind || "button";
}

function gestureRemapKind(action, actionId, index) {
  if (GESTURE_KINDS.has(action?.kind) && actionId === "restart" && index !== action.defaultBtn) {
    return "button";
  }
  return action?.kind || "button";
}

let mem = null;
let liveOverlay = null;
let liveFlags = { simulate: false, listen: false, apply_scene: false, rev: 0, appliedRev: 0 };
let listen = null;
const listeningWindows = new WeakSet();

export const XR_LIVE_SAVE_EVENT = "render3d:xr-control-live-save";
export const XRCTRL2_CACHE = "xrctrl2";

export function xrLiveSessionActive() {
  return !!(liveOverlay && (liveFlags.simulate || liveFlags.listen) && liveFlags.wire !== "approved");
}

export function xrLiveControlFlags() {
  return { ...liveFlags };
}

export function setXrLiveControlOverlay(store, flags = {}) {
  liveOverlay = store ? normalizeXrControlStore(store) : null;
  liveFlags = { ...liveFlags, ...flags };
  emitXrControlMap(xrLiveSessionActive() ? liveOverlay : readPersistedStore());
  return liveOverlay ? cloneStore(liveOverlay) : null;
}

export function applyXrLiveControlDoc(doc) {
  if (!doc || typeof doc !== "object") {
    liveOverlay = null;
    liveFlags = { simulate: false, listen: false, apply_scene: false, rev: 0, appliedRev: liveFlags.appliedRev || 0, wire: "idle" };
    emitXrControlMap();
    return { overlay: false, applied: false, token: XRCTRL2_CACHE, rev: 0 };
  }
  const store = normalizeXrControlStore({
    headset: doc.headset,
    profiles: doc.profiles || { [doc.headset || "quest3"]: doc.map || doc.bindings },
  });
  const rev = Number(doc.rev) || 0;
  liveFlags = {
    simulate: !!doc.simulate,
    listen: !!doc.listen,
    apply_scene: !!doc.apply_scene,
    rev,
    appliedRev: liveFlags.appliedRev || 0,
    wire: String(doc.wire_status || ""),
  };
  const live = liveFlags.simulate || liveFlags.listen;
  liveOverlay = live ? store : null;
  let applied = false;
  if (doc.apply_scene === true && doc.wire_status === "approved" && liveFlags.appliedRev !== rev) {
    writeStore(store, { emit: true, forcePersist: true });
    liveFlags.appliedRev = rev;
    applied = true;
    liveOverlay = null;
  } else if (live) {
    emitXrControlMap(store);
  } else {
    emitXrControlMap();
  }
  return {
    overlay: xrLiveSessionActive(),
    applied,
    simulate: !!doc.simulate,
    listen: !!doc.listen,
    rev,
    token: XRCTRL2_CACHE,
  };
}

function syncControlStore() {
  const target = globalThis.window;
  if (!target?.addEventListener || listeningWindows.has(target)) return;
  listeningWindows.add(target);
  // Desktop and XR can import different cache-busted URLs of this module.
  // Synchronize their caches before either handler reads the next input frame.
  target.addEventListener(XR_CONTROL_MAP_EVENT, event => {
    const next = event.detail ? normalizeXrControlStore(event.detail) : null;
    if (liveOverlay && (liveFlags.simulate || liveFlags.listen)) {
      liveOverlay = next;
      return;
    }
    mem = next;
  });
  target.addEventListener('storage', event => {
    if (event.key === XR_CONTROL_MAP_KEY || event.key === null) mem = null;
  });
}

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function normalizeXrHeadsetId(id) {
  const raw = String(id || "").toLowerCase().replace(/\s+/g, "");
  if (HEADSET_IDS.includes(raw)) return raw;
  if (raw === "quest3s" || raw.includes("3s")) return "quest3s";
  if (raw.includes("quest2")) return "quest2";
  if (raw.includes("quest")) return "quest3";
  if (raw.includes("pico")) return "pico";
  if (raw.includes("vision")) return "vision";
  if (raw.includes("desktop") || raw.includes("emul")) return "desktop";
  if (raw.includes("openxr") || raw.includes("generic")) return "openxr";
  return "quest3";
}

export function xrControlHeadsetLabel(id) {
  const hid = normalizeXrHeadsetId(id);
  return XR_CONTROL_HEADSETS.find((h) => h.id === hid)?.label || "Quest 3";
}

export function defaultXrActionMap() {
  const map = {};
  for (const action of XR_CONTROL_ACTIONS) {
    map[action.id] = { btn: action.defaultBtn, kind: action.kind || "button" };
  }
  return map;
}

export function normalizeXrActionMap(raw) {
  const base = defaultXrActionMap();
  const src = raw && typeof raw === "object" ? raw : {};
  for (const action of XR_CONTROL_ACTIONS) {
    const row = src[action.id];
    const btn = Number(row?.btn);
    if (Number.isInteger(btn) && btn >= 0 && btn <= 15) {
      base[action.id] = {
        btn,
        kind: gestureActionKind(action, row),
      };
    }
  }
  return base;
}

function emptyStore() {
  return {
    headset: "quest3",
    profiles: { quest3: defaultXrActionMap() },
  };
}

export function normalizeXrControlStore(raw) {
  const next = emptyStore();
  const headset = normalizeXrHeadsetId(raw?.headset);
  next.headset = headset;
  const profiles = raw?.profiles && typeof raw.profiles === "object" ? raw.profiles : {};
  for (const id of HEADSET_IDS) {
    if (profiles[id] || id === headset) next.profiles[id] = normalizeXrActionMap(profiles[id]);
  }
  return next;
}

export function resetXrControlMapCache() {
  mem = null;
  liveOverlay = null;
  liveFlags = { simulate: false, listen: false, apply_scene: false, rev: 0, appliedRev: 0, wire: "idle" };
  listen = null;
}

function cloneStore(value) {
  return JSON.parse(JSON.stringify(value || emptyStore()));
}

function readPersistedStore() {
  if (mem) return cloneStore(mem);
  let parsed = null;
  try {
    parsed = JSON.parse(storage()?.getItem(XR_CONTROL_MAP_KEY) || "null");
  } catch {
    parsed = null;
  }
  mem = normalizeXrControlStore(parsed || {});
  return cloneStore(mem);
}

export function readXrControlStore() {
  syncControlStore();
  if (liveOverlay && (liveFlags.simulate || liveFlags.listen)) return cloneStore(liveOverlay);
  return readPersistedStore();
}

function writeStore(next, { emit = true, forcePersist = false } = {}) {
  const normalized = normalizeXrControlStore(next);
  if (xrLiveSessionActive() && !forcePersist) {
    liveOverlay = normalized;
    if (emit) {
      emitXrControlMap(liveOverlay);
      try {
        window.dispatchEvent(new CustomEvent(XR_LIVE_SAVE_EVENT, { detail: { ...liveOverlay, token: XRCTRL2_CACHE, simulate: liveFlags.simulate, listen: liveFlags.listen } }));
      } catch { /* ignore */ }
    }
    return cloneStore(liveOverlay);
  }
  mem = normalized;
  try {
    storage()?.setItem(XR_CONTROL_MAP_KEY, JSON.stringify(mem));
  } catch { /* private mode */ }
  if (emit) emitXrControlMap();
  return cloneStore(mem);
}

export function emitXrControlMap(store = mem) {
  const detail = normalizeXrControlStore(store || readXrControlStore());
  try {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(XR_CONTROL_MAP_EVENT, { detail }));
    }
  } catch { /* ignore */ }
  return detail;
}

export function persistXrControlStore(partial = {}) {
  const cur = readXrControlStore();
  return writeStore({
    headset: partial.headset || cur.headset,
    profiles: { ...cur.profiles, ...(partial.profiles || {}) },
  });
}

export function activeXrHeadset() {
  return readXrControlStore().headset;
}

export function setXrControlHeadset(id) {
  const headset = normalizeXrHeadsetId(id);
  const cur = readXrControlStore();
  if (!cur.profiles[headset]) cur.profiles[headset] = defaultXrActionMap();
  return writeStore({ ...cur, headset });
}

export function activeXrActionMap(headset = activeXrHeadset()) {
  const hid = normalizeXrHeadsetId(headset);
  const store = readXrControlStore();
  return normalizeXrActionMap(store.profiles[hid] || defaultXrActionMap());
}

export function mappedButtonIndex(actionId, headset = activeXrHeadset()) {
  const action = XR_CONTROL_ACTIONS.find((a) => a.id === actionId);
  const map = activeXrActionMap(headset);
  const btn = Number(map[actionId]?.btn);
  if (Number.isInteger(btn) && btn >= 0) return btn;
  return action?.defaultBtn ?? 0;
}

export function xrButtonLabel(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return "Unmapped";
  return XR_STANDARD_BUTTON_LABELS[i] || `Button ${i}`;
}

/** Digital click only. Analog extras / stick travel are never a remap press. */
export function gamepadDigitalPressed(gp, index) {
  const b = gp?.buttons?.[index];
  return b?.pressed === true;
}

export function gamepadButtonDown(gp, index, _threshold = 0.55) {
  return gamepadDigitalPressed(gp, index);
}

/**
 * Left ☰ requires the runtime's digital press. Analog-only values can rise
 * without a click; they must never arm a scene restart or its progress ring.
 */
export function gamepadMenuComponentHeld(gp, index = XR_PROFILE_MENU_BUTTON) {
  const i = Number(index);
  const b = gp?.buttons?.[i];
  if (!b || !Number.isInteger(i) || i < 0) return false;
  return b.pressed === true;
}

export function gamepadActionPressed(gp, actionId, headset = activeXrHeadset()) {
  return gamepadButtonDown(gp, mappedButtonIndex(actionId, headset));
}

/** Restart fires from a remapped button only — never the debugger both-stick hold. */
export function xrRestartIsLiveButton(headset = activeXrHeadset()) {
  return activeXrActionMap(headset).restart?.kind === "button";
}

export function remapXrControlAction(actionId, btn, headset = activeXrHeadset()) {
  if (!ACTION_IDS.includes(actionId)) return readXrControlStore();
  const hid = normalizeXrHeadsetId(headset);
  const index = Math.max(0, Math.min(15, Number(btn) | 0));
  const cur = readXrControlStore();
  const profile = normalizeXrActionMap(cur.profiles[hid] || defaultXrActionMap());
  const action = XR_CONTROL_ACTIONS.find((a) => a.id === actionId);
  profile[actionId] = {
    btn: index,
    kind: gestureRemapKind(action, actionId, index),
  };
  cur.profiles[hid] = profile;
  cur.headset = hid;
  return writeStore(cur);
}

export function resetXrControlMap(headset = activeXrHeadset()) {
  const hid = normalizeXrHeadsetId(headset);
  const cur = readXrControlStore();
  cur.profiles[hid] = defaultXrActionMap();
  cur.headset = hid;
  listen = null;
  return writeStore(cur);
}

export function vrControlsSettingsLines({
  headset = activeXrHeadset(),
  listenId = "",
  dockLeft = true,
} = {}) {
  const hid = normalizeXrHeadsetId(headset);
  const map = activeXrActionMap(hid);
  const lines = [
    {
      id: "xr_map_headset",
      label: xrControlHeadsetLabel(hid),
      kind: "action",
      icon: "view",
      color: 0x38bdf8,
    },
  ];
  for (const action of XR_CONTROL_ACTIONS) {
    const listening = listenId === action.id;
    const btn = map[action.id]?.btn;
    const kind = map[action.id]?.kind;
    const binding = action.id === "restart" && kind !== "button"
      ? "Left menu · 3s"
      : xrButtonLabel(btn);
    lines.push({
      id: `xr_map:${action.id}`,
      label: listening ? "Listening…" : (action.id === "restart" && kind !== "button"
        ? binding
        : `${action.label.split("·")[0].trim()} · ${binding}`),
      kind: "action",
      icon: action.icon,
      color: listening ? 0xf59e0b : 0x64748b,
      active: listening,
    });
  }
  lines.push(
    { id: "xr_restart_now", label: "Restart scene", kind: "action", icon: "restore", color: 0xef4444 },
    { id: "xr_map_reset", label: "Reset VR", kind: "action", icon: "undo", color: 0x94a3b8 },
    {
      id: "hand_left",
      label: "Menu L",
      kind: "toggle",
      icon: "hand_left",
      color: 0x0f766e,
      active: dockLeft,
    },
    {
      id: "hand_right",
      label: "Menu R",
      kind: "toggle",
      icon: "hand_right",
      color: 0x334155,
      active: !dockLeft,
    },
  );
  return lines;
}

export function firstNewlyPressedButton(gp, prevBits = 0) {
  const buttons = gp?.buttons || [];
  let found = -1;
  let bits = 0;
  for (let i = 0; i < buttons.length && i < 16; i += 1) {
    const down = gamepadButtonDown(gp, i, 0.65);
    if (down) bits |= (1 << i);
    if (down && !(prevBits & (1 << i)) && found < 0) found = i;
  }
  return { index: found, bits };
}

export function xrControlListenState() {
  return listen ? { ...listen } : null;
}

export function beginXrControlListen(actionId, { now = 0, timeoutMs = 8000 } = {}) {
  if (!ACTION_IDS.includes(actionId)) return null;
  listen = {
    actionId,
    startedAt: Number(now) || (typeof performance !== "undefined" ? performance.now() : Date.now()),
    timeoutMs: Number(timeoutMs) > 0 ? Number(timeoutMs) : 8000,
    bits: {},
  };
  return { ...listen };
}

export function cancelXrControlListen() {
  listen = null;
}

export function tickXrControlListen({ gamepads = [], now = 0 } = {}) {
  if (!listen) return { listening: false };
  const t = Number(now) || (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (t - listen.startedAt > listen.timeoutMs) {
    const expired = listen.actionId;
    listen = null;
    return { listening: false, expired, actionId: expired };
  }
  const pads = Array.isArray(gamepads) ? gamepads : [];
  for (let p = 0; p < pads.length; p += 1) {
    const gp = pads[p];
    if (!gp) continue;
    const prev = listen.bits[p] || 0;
    const { index, bits } = firstNewlyPressedButton(gp, prev);
    listen.bits[p] = bits;
    if (index >= 0) {
      const actionId = listen.actionId;
      listen = null;
      remapXrControlAction(actionId, index);
      return { listening: false, mapped: true, actionId, btn: index };
    }
  }
  return { listening: true, actionId: listen.actionId };
}

export function xrControlMapPrefsHtml({
  headset = activeXrHeadset(),
  listenId = "",
} = {}) {
  const hid = normalizeXrHeadsetId(headset);
  const map = activeXrActionMap(hid);
  const options = XR_CONTROL_HEADSETS.map((h) => (
    `<option value="${h.id}"${h.id === hid ? " selected" : ""}>${h.label}</option>`
  )).join("");
  const btnOptions = (selected) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
    `<option value="${i}"${Number(selected) === i ? " selected" : ""}>${xrButtonLabel(i)}</option>`
  )).join("");
  const rows = XR_CONTROL_ACTIONS.map((action) => {
    const listening = listenId === action.id;
    const btn = map[action.id]?.btn;
    return `<div class="xr-map-row${listening ? " is-listening" : ""}" data-xr-map-row="${action.id}">
      <div>
        <b>${action.label}</b>
        <small>${action.id === "restart" ? "Hold left ☰ (indented Menu, not X) 3s. Resets the scene in-session — stays in VR. Both sticks hold opens the debugger — not restart." : xrButtonLabel(btn)}</small>
      </div>
      <select data-xr-map-btn="${action.id}" aria-label="Button for ${action.label}">${btnOptions(btn)}</select>
      <button type="button" class="btn secondary btn-compact" data-xr-map-listen="${action.id}">${listening ? "Listening…" : "Remap"}</button>
    </div>`;
  }).join("");
  return `<label class="profile-preference-field">
      <span>
        <b>Headset to map</b>
        <small>Auto-saves a profile per headset. Same map as Hold A → Settings → VR.</small>
      </span>
      <select id="pref-xr-headset">${options}</select>
    </label>
    <p id="pref-xr-map-listen" class="muted small profile-preferences-note${listenId ? "" : " hidden"}">Listening for the new button… press any controller button.</p>
    <div class="xr-map-rows" id="pref-xr-map-rows">${rows}</div>`;
}

function collectDesktopGamepads() {
  try {
    return [...(navigator.getGamepads?.() || [])].filter(Boolean);
  } catch {
    return [];
  }
}

export function bindXrControlMapPrefs(root, { onChange } = {}) {
  if (!root) return () => {};
  const notify = () => {
    try { onChange?.(readXrControlStore()); } catch { /* ignore */ }
  };
  const headsetEl = root.querySelector("#pref-xr-headset");
  headsetEl?.addEventListener("change", () => {
    setXrControlHeadset(headsetEl.value);
    notify();
  });
  root.querySelectorAll("[data-xr-map-btn]").forEach((sel) => {
    sel.addEventListener("change", () => {
      remapXrControlAction(sel.getAttribute("data-xr-map-btn"), sel.value, activeXrHeadset());
      notify();
    });
  });
  root.querySelectorAll("[data-xr-map-listen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-xr-map-listen");
      beginXrControlListen(id);
      const note = root.querySelector("#pref-xr-map-listen");
      if (note) {
        note.classList.remove("hidden");
        note.textContent = "Listening for the new button… press any controller button.";
      }
      btn.textContent = "Listening…";
      const started = performance.now();
      const tick = () => {
        const result = tickXrControlListen({ gamepads: collectDesktopGamepads(), now: performance.now() });
        if (result.mapped || result.expired || performance.now() - started > 8000) {
          if (note) note.classList.toggle("hidden", !result.mapped);
          if (result.mapped && note) note.textContent = `Saved ${xrButtonLabel(result.btn)} for ${result.actionId}.`;
          notify();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  return () => cancelXrControlListen();
}
