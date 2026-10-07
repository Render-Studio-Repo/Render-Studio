/**
 * DIMOS teleop headset profile + button bindings.
 * SoR: Sam's robotics Y map. Tap Y captures a fresh controller frame, then
 * engages. Hold Y resets; the next tap must capture again.
 * Grip arm-binding removed. X+A deadman is do_not_use (locked out).
 * Never auto-connects.
 */

export const DIMOS_CONTROL_STORAGE_KEY = "render3d:dimosControls";
export const DIMOS_CONTROL_SCHEMA = "sam-y-record-v3";
export const DIMOS_CONTROL_LOCK_OWNER = "sam";

export const DIMOS_CONTROL_PROFILES = Object.freeze([
  { id: "quest3", label: "Quest 3", family: "quest" },
  { id: "quest3s", label: "Quest 3S", family: "quest" },
  { id: "quest2", label: "Quest 2", family: "quest" },
  { id: "questpro", label: "Quest Pro", family: "quest" },
  { id: "vision", label: "Vision Pro", family: "vision" },
  { id: "vive", label: "Vive / Index", family: "vive" },
]);

/** Locked defaults — robotics-profile Y map wins; legacy X+A / grip cannot stick. */
export const DIMOS_CONTROL_DEFAULTS = Object.freeze({
  schema: DIMOS_CONTROL_SCHEMA,
  lock: DIMOS_CONTROL_LOCK_OWNER,
  headset: "quest3",
  engage: "y_map",
  gripper: "none",
  record: "A",
  discard: "B",
});

let memPrefs = null;
let memUserKey = null;
const listeningWindows = new WeakSet();
export const DIMOS_CONTROL_EVENT = "render3d:dimos-controls";

function syncControlPrefs() {
  const target = globalThis.window;
  if (!target?.addEventListener || listeningWindows.has(target)) return;
  listeningWindows.add(target);
  target.addEventListener(DIMOS_CONTROL_EVENT, (event) => {
    if (event.detail?.key === memUserKey) memPrefs = normalizePrefs(event.detail.prefs);
  });
  target.addEventListener("storage", (event) => {
    if (event.key === memUserKey || event.key === null) memPrefs = null;
  });
}
let controlsPopover = null;
let controlsBackdrop = null;

function userKey(user) {
  return String(user?.id || user?.user_id || user?.email || "anon");
}

export function dimosControlPrefsKey(user = null) {
  return `${DIMOS_CONTROL_STORAGE_KEY}:${userKey(user)}`;
}

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Stale X+A / grip / Start-Pause prefs fight the robotics profile — migrate them away. */
export function migrateStaleDimosControlPrefs(raw) {
  const staleEngage = raw?.engage === "primary" || raw?.engage === "secondary";
  const staleGrip = raw?.gripper === "squeeze" || raw?.gripper === "trigger";
  const staleSchema = raw?.schema !== DIMOS_CONTROL_SCHEMA;
  const staleButtons = raw?.record !== "A" || raw?.discard !== "B" || "start" in (raw || {}) || "pause" in (raw || {});
  if (!raw || (!staleEngage && !staleGrip && !staleSchema && !staleButtons && raw?.lock === DIMOS_CONTROL_LOCK_OWNER)) {
    return raw || null;
  }
  return {
    ...raw,
    schema: DIMOS_CONTROL_SCHEMA,
    lock: DIMOS_CONTROL_LOCK_OWNER,
    engage: "y_map",
    gripper: "none",
    record: "A",
    discard: "B",
  };
}

function normalizePrefs(raw) {
  const migrated = migrateStaleDimosControlPrefs(raw) || {};
  const ids = DIMOS_CONTROL_PROFILES.map((p) => p.id);
  const headset = ids.includes(migrated?.headset) ? migrated.headset : DIMOS_CONTROL_DEFAULTS.headset;
  // Locked SoR: Y owns motion state; A/B own record/save and discard.
  return {
    schema: DIMOS_CONTROL_SCHEMA,
    lock: DIMOS_CONTROL_LOCK_OWNER,
    headset,
    engage: "y_map",
    gripper: "none",
    record: "A",
    discard: "B",
  };
}

export function resetDimosControlPrefsCache() {
  memPrefs = null;
  memUserKey = null;
}

export function readDimosControlPrefs(user = null) {
  syncControlPrefs();
  const key = dimosControlPrefsKey(user);
  if (memPrefs && memUserKey === key) return { ...memPrefs };
  const store = storage();
  let parsed = null;
  try {
    parsed = JSON.parse(store?.getItem(key) || "null");
  } catch {
    parsed = null;
  }
  const next = normalizePrefs(parsed || {});
  // Persist migration so localStorage cannot keep overlapping the locked profile.
  if (parsed && JSON.stringify(parsed) !== JSON.stringify(next)) {
    try {
      store?.setItem(key, JSON.stringify(next));
    } catch { /* ignore */ }
  }
  memPrefs = next;
  memUserKey = key;
  return { ...memPrefs };
}

export function getDimosControlPrefs(user = null) {
  return readDimosControlPrefs(user);
}

export function persistDimosControlPrefs(partial = {}, user = null) {
  // Lock: reject overrides that would overlap Sam's Y + recording profile.
  const safe = { ...partial };
  if ("engage" in safe && safe.engage !== "y_map") delete safe.engage;
  if ("gripper" in safe && safe.gripper !== "none") delete safe.gripper;
  delete safe.start;
  delete safe.pause;
  if ("start_pause" in safe) delete safe.start_pause;
  if ("record" in safe && safe.record !== "A") delete safe.record;
  if ("discard" in safe && safe.discard !== "B") delete safe.discard;
  if ("lock" in safe && safe.lock !== DIMOS_CONTROL_LOCK_OWNER) delete safe.lock;
  if ("schema" in safe && safe.schema !== DIMOS_CONTROL_SCHEMA) delete safe.schema;
  const next = normalizePrefs({ ...readDimosControlPrefs(user), ...safe });
  memPrefs = next;
  try {
    storage()?.setItem(dimosControlPrefsKey(user), JSON.stringify(next));
  } catch { /* ignore */ }
  try {
    globalThis.window?.dispatchEvent(new CustomEvent(DIMOS_CONTROL_EVENT, {
      detail: { key: dimosControlPrefsKey(user), prefs: next },
    }));
  } catch { /* non-browser */ }
  return { ...next };
}

export function dimosControlProfile(prefs = null) {
  const p = prefs || DIMOS_CONTROL_DEFAULTS;
  return DIMOS_CONTROL_PROFILES.find((row) => row.id === p.headset) || DIMOS_CONTROL_PROFILES[0];
}

/**
 * Live binding snapshot for smoke / Gauge — never hardcoded "unknown".
 * Edges come from gamepad when present; labels always from locked profile.
 */
export function dimosControlBindingsSnapshot(user = null, input = null) {
  const prefs = readDimosControlPrefs(user);
  const gp = input?.gamepads || (typeof navigator !== "undefined" ? [...(navigator.getGamepads?.() || [])].filter(Boolean) : []);
  const pad = gp.find((p) => p?.buttons?.length) || null;
  const btn = (i) => {
    const b = pad?.buttons?.[i];
    if (!b) return false;
    return !!(b.pressed || (typeof b.value === "number" && b.value > 0.5));
  };
  const yDown = btn(5); // left secondary = Y on Quest xr-standard (when left pad present)
  const triggerDown = btn(0);
  const gripDown = btn(1);
  return {
    schema: prefs.schema,
    lock: prefs.lock,
    headset: prefs.headset,
    profile: dimosControlProfile(prefs).label,
    bindings: {
      engage: { input: "Y", edge: "tap", action: "calibrate + engage" },
      reset: { input: "Y", edge: "hold_2s", action: "session_reset" },
      gripper: { input: null, action: "removed" },
      activate: { input: "Y", edge: "tap", action: "activate / pause / reactivate" },
      jaw: { input: "trigger", action: "pinch_close" },
      hud_grab: { input: "grip", action: "grab_panel" },
      record: { input: prefs.record || "A", action: "record / stop + save" },
      discard: { input: prefs.discard || "B", action: "discard" },
    },
    live: {
      pads: gp.length,
      y: yDown ? "down" : (pad ? "up" : "no_pad"),
      trigger: triggerDown ? "down" : (pad ? "up" : "no_pad"),
      grip: gripDown ? "down" : (pad ? "up" : "no_pad"),
      observed: !!pad,
    },
    do_not_use: "Hold X+A (old DimOS deadman)",
  };
}

/** Legacy remap path — locked profile does not swap engage/grip slots. */
export function applyDimosControlBindings(mapped, prefs = null) {
  const p = normalizePrefs(prefs || DIMOS_CONTROL_DEFAULTS);
  const buttons = Array.isArray(mapped?.buttons) ? mapped.buttons.slice() : [0, 0, 0, 0, 0, 0, 0];
  const axes = Array.isArray(mapped?.axes) ? mapped.axes.slice() : [0, 0, 0, 0];
  while (buttons.length < 7) buttons.push(0);
  while (axes.length < 4) axes.push(0);
  // y_map + gripper none: identity map (no X↔Y or trigger↔grip swap).
  void p;
  return {
    ...mapped,
    axes,
    buttons,
    primary: buttons[4] === 1,
  };
}

export function dimosControlDiagramSvg(prefs = DIMOS_CONTROL_DEFAULTS) {
  const p = normalizePrefs(prefs);
  const profile = dimosControlProfile(p);
  const recordNote = `Record / Stop + Save · ${p.record} · Discard · ${p.discard}`;
  if (profile.family === "vision") {
    return `<svg class="dimos-controls-diagram" viewBox="0 0 360 168" role="img" aria-label="Vision Pro hand actions">
      <text x="180" y="18" text-anchor="middle" fill="#e6edf3" font-size="12" font-weight="700">${profile.label} · from the headset</text>
      <ellipse cx="110" cy="92" rx="48" ry="58" fill="#151b24" stroke="#58a6ff" stroke-width="1.6"/>
      <ellipse cx="250" cy="92" rx="48" ry="58" fill="#151b24" stroke="#58a6ff" stroke-width="1.6"/>
      <text x="110" y="86" text-anchor="middle" fill="#7ee8ff" font-size="11" font-weight="700">Pinch</text>
      <text x="110" y="104" text-anchor="middle" fill="#8b949e" font-size="10">Menu / UI</text>
      <text x="250" y="86" text-anchor="middle" fill="#7ee8ff" font-size="11" font-weight="700">Pinch</text>
      <text x="250" y="104" text-anchor="middle" fill="#8b949e" font-size="10">Menu / UI</text>
      <text x="180" y="160" text-anchor="middle" fill="#8b949e" font-size="10">Y map · Quest OpenArm uses controller face buttons</text>
    </svg>`;
  }
  if (profile.family === "vive") {
    return `<svg class="dimos-controls-diagram" viewBox="0 0 360 168" role="img" aria-label="Vive controller actions">
      <text x="180" y="18" text-anchor="middle" fill="#e6edf3" font-size="12" font-weight="700">${profile.label} · from the headset</text>
      <rect x="48" y="36" width="100" height="110" rx="18" fill="#151b24" stroke="#58a6ff" stroke-width="1.6"/>
      <rect x="212" y="36" width="100" height="110" rx="18" fill="#151b24" stroke="#58a6ff" stroke-width="1.6"/>
      <text x="98" y="72" text-anchor="middle" fill="#7ee8ff" font-size="10" font-weight="700">Y · Calibrate</text>
      <text x="98" y="94" text-anchor="middle" fill="#8b949e" font-size="10">Hold Y · Reset</text>
      <text x="98" y="116" text-anchor="middle" fill="#8b949e" font-size="10">Grip · HUD only</text>
      <text x="262" y="72" text-anchor="middle" fill="#7ee8ff" font-size="10" font-weight="700">A · Record / Save</text>
      <text x="262" y="94" text-anchor="middle" fill="#8b949e" font-size="10">B · Discard</text>
      <text x="262" y="116" text-anchor="middle" fill="#8b949e" font-size="10">Trigger · Jaw</text>
    </svg>`;
  }
  return `<svg class="dimos-controls-diagram" viewBox="0 0 360 200" role="img" aria-label="Quest controller actions from the headset">
    <text x="180" y="16" text-anchor="middle" fill="#e6edf3" font-size="12" font-weight="700">${profile.label} · looking down at your hands</text>
    <path d="M86 44c-22 8-38 36-34 78 4 36 28 54 52 50 18-4 30-22 34-46 4-28-8-70-28-82-8-6-16-6-24 0z" fill="#151b24" stroke="#58a6ff" stroke-width="1.6"/>
    <path d="M274 44c22 8 38 36 34 78-4 36-28 54-52 50-18-4-30-22-34-46-4-28 8-70 28-82 8-6 16-6 24 0z" fill="#151b24" stroke="#58a6ff" stroke-width="1.6"/>
    <circle cx="78" cy="86" r="11" fill="#0f1720" stroke="#8b949e" stroke-width="1.2"/>
    <text x="78" y="90" text-anchor="middle" fill="#8b949e" font-size="9" font-weight="700">X</text>
    <circle cx="104" cy="68" r="11" fill="#0f1720" stroke="#7ee8ff" stroke-width="1.4"/>
    <text x="104" y="72" text-anchor="middle" fill="#7ee8ff" font-size="9" font-weight="700">Y</text>
    <circle cx="282" cy="86" r="11" fill="#0f1720" stroke="#7ee8ff" stroke-width="1.4"/>
    <text x="282" y="90" text-anchor="middle" fill="#7ee8ff" font-size="9" font-weight="700">A</text>
    <circle cx="256" cy="68" r="11" fill="#0f1720" stroke="#7ee8ff" stroke-width="1.4"/>
    <text x="256" y="72" text-anchor="middle" fill="#7ee8ff" font-size="9" font-weight="700">B</text>
    <text x="92" y="148" text-anchor="middle" fill="#7ee8ff" font-size="10" font-weight="700">Y · tap Calibrate</text>
    <text x="92" y="164" text-anchor="middle" fill="#8b949e" font-size="9">Y · hold 2s Reset</text>
    <text x="268" y="148" text-anchor="middle" fill="#7ee8ff" font-size="10" font-weight="700">A · Record / Save</text>
    <text x="268" y="164" text-anchor="middle" fill="#7ee8ff" font-size="10" font-weight="700">B · Discard</text>
    <text x="180" y="54" text-anchor="middle" fill="#8b949e" font-size="10">Trigger · jaw pinch</text>
    <text x="180" y="108" text-anchor="middle" fill="#8b949e" font-size="10">Grip · HUD grab only (no arm binding)</text>
    <text x="180" y="182" text-anchor="middle" fill="#e6edf3" font-size="9" font-weight="700">${recordNote}</text>
    <text x="180" y="196" text-anchor="middle" fill="#8b949e" font-size="8">Locked profile · Y owns motion · X+A deadman disabled</text>
  </svg>`;
}

function closeControlsPopover() {
  controlsPopover?.remove();
  controlsPopover = null;
  controlsBackdrop?.remove();
  controlsBackdrop = null;
}

export function dimosControlsPopoverIsOpen() {
  return !!controlsPopover;
}

export function closeDimosControlsPopup() {
  closeControlsPopover();
}

function paintControlsPopover(pop, prefs, user) {
  const profile = dimosControlProfile(prefs);
  pop.querySelector("[data-dimos-controls-diagram]").innerHTML = dimosControlDiagramSvg(prefs);
  pop.querySelectorAll("[data-dimos-headset]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.getAttribute("data-dimos-headset") === prefs.headset);
  });
  const engage = pop.querySelector("[data-dimos-engage]");
  if (engage) engage.value = "y_map";
  const sub = pop.querySelector("[data-dimos-controls-sub]");
  if (sub) sub.textContent = `${profile.label} · locked · A Record/Save · B Discard · no grip`;
  void user;
}

export function openDimosControlsPopup({ anchor = null, getUser } = {}) {
  closeControlsPopover();
  const user = (() => {
    try { return getUser?.() || null; } catch { return null; }
  })();
  const prefs = readDimosControlPrefs(user);
  const pop = document.createElement("div");
  pop.className = "robotics-ip-popover robotics-ip-popover--modal dimos-controls-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Robot controls");
  pop.innerHTML = `
    <div class="robotics-ip-popover-head">
      <strong>Controls</strong>
      <span data-dimos-controls-sub></span>
      <button type="button" class="object-iteration-close" data-controls-close aria-label="Close">✕</button>
    </div>
    <div class="dimos-controls-headsets" role="group" aria-label="Headset">
      ${DIMOS_CONTROL_PROFILES.map((row) => (
        `<button type="button" class="btn secondary btn-compact" data-dimos-headset="${row.id}">${row.label}</button>`
      )).join("")}
    </div>
    <div data-dimos-controls-diagram></div>
    <label class="robotics-ip-field">Engage / Reset (locked)
      <select data-dimos-engage class="profile-pretty-input" disabled>
        <option value="y_map">Y tap · Calibrate + engage · Y hold 2s · Home / reset</option>
      </select>
    </label>
    <label class="robotics-ip-field">Recording buttons (locked)
      <select data-dimos-record class="profile-pretty-input" disabled>
        <option value="A">A · Record / Stop + Save</option>
      </select>
      <select data-dimos-discard class="profile-pretty-input" disabled>
        <option value="B">B · Discard</option>
      </select>
    </label>
    <p class="muted small" data-dimos-grip-note>Y owns controller calibration and robot activation. Grip = HUD grab only. Trigger = jaw pinch. X+A deadman disabled.</p>`;
  const back = document.createElement("div");
  back.className = "robotics-ip-popover-backdrop";
  back.addEventListener("click", closeControlsPopover);
  document.body.appendChild(back);
  document.body.appendChild(pop);
  controlsBackdrop = back;
  controlsPopover = pop;
  void anchor;
  pop.querySelector("[data-controls-close]")?.addEventListener("click", closeControlsPopover);
  pop.querySelectorAll("[data-dimos-headset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = persistDimosControlPrefs({ headset: btn.getAttribute("data-dimos-headset") }, user);
      paintControlsPopover(pop, next, user);
    });
  });
  paintControlsPopover(pop, prefs, user);
  return pop;
}
