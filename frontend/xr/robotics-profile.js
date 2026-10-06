/** Shared, per-user discovery profile. Reading/importing never connects a robot. */
export const ROBOTICS_PROFILE_EVENT = "render3d:robotics-profile";
export const DEFAULT_ROBOTICS_PROFILE = {
  "ok": true,
  "teleop_up": true,
  "schema": "render-studio-robotics/v1",
  "kind": "dimos-quest-openarm",
  "host": "192.168.1.77",
  "paste_url": "http://192.168.1.77:8450/robotics/config",
  "docs": "https://render3d.app/getting-started.html#robotics-configuration",
  "url": "https://192.168.1.77:8443/teleop?autoconnect=1",
  "ui": "https://192.168.1.77:8443/teleop",
  "passthrough_ui": "https://192.168.1.77:8443/teleop",
  "autoconnect": "https://192.168.1.77:8443/teleop?autoconnect=1",
  "embed": {
    "iframe": false,
    "reason": "Quest immersive-ar / passthrough WebXR must run as a full-page document, not inside an iframe from render3d.app. Download HUD/docs HTML from this API and mount them in Render; keep live tracking on :8443."
  },
  "websocket": "wss://192.168.1.77:8443/ws",
  "controllers": {
    "stream": "wss://192.168.1.77:8443/ws",
    "websocket": "wss://192.168.1.77:8443/ws",
    "protocol": "binary DimOS LCM PoseStamped + Joy (~80 Hz from Quest WebXR)",
    "single_client": true,
    "http_backups": {
      "y": {
        "method": "POST",
        "url": "https://192.168.1.77:8443/teleop/y",
        "body": {
          "action": "tap | session_reset"
        }
      },
      "emotes": {
        "method": "GET",
        "url": "https://192.168.1.77:8443/emotes"
      },
      "emote_play": {
        "method": "POST",
        "url": "https://192.168.1.77:8443/emote/play"
      },
      "emote_accept": {
        "method": "POST",
        "url": "https://192.168.1.77:8443/emote/accept"
      },
      "emote_discard": {
        "method": "POST",
        "url": "https://192.168.1.77:8443/emote/discard"
      }
    },
    "buttons": {
      "gamepad": "xr-standard",
      "y_map": "tap_pause_hold3_kill",
      "note": "Quest WebXR page owns the live /ws client. Only one control WebSocket is accepted. Render should open the passthrough UI rather than a second /ws.",
      "joy": {
        "mapping": "xr-standard",
        "axes": {
          "0": {
            "id": "thumbstick_x",
            "label": "Thumbstick X"
          },
          "1": {
            "id": "thumbstick_y",
            "label": "Thumbstick Y"
          },
          "2": {
            "id": "trigger_analog",
            "label": "Trigger analog"
          },
          "3": {
            "id": "grip_analog",
            "label": "Grip analog"
          }
        },
        "buttons": {
          "0": {
            "id": "trigger",
            "label": "Trigger"
          },
          "1": {
            "id": "grip",
            "label": "Grip / squeeze"
          },
          "2": {
            "id": "touchpad",
            "label": "Touchpad"
          },
          "3": {
            "id": "thumbstick_press",
            "label": "Thumbstick press"
          },
          "4": {
            "id": "primary",
            "label": "Primary",
            "left": "X",
            "right": "A"
          },
          "5": {
            "id": "secondary",
            "label": "Secondary",
            "left": "Y",
            "right": "B"
          },
          "6": {
            "id": "menu",
            "label": "Menu"
          }
        },
        "frame_id": "left | right"
      },
      "left": {
        "Y": {
          "tap": "engage / pause-resume in place (ON\u2192HOLD, HOLD\u2192resume, OFF\u2192fresh enable)",
          "hold_ms": 3000,
          "hold": "hold Y 2s session_reset (kill follow + fresh session; next Y tap calibrates)"
        },
        "X": "emote picker",
        "trigger": "pinch-to-close gripper (rest 0.5)",
        "grip": "grab HUD / docs panel (no arm binding)"
      },
      "right": {
        "A": "pause follow",
        "B": "start follow",
        "trigger": "pinch-to-close gripper (rest 0.5)",
        "grip": "grab HUD / docs panel (no arm binding)"
      },
      "do_not_use": "Hold X+A (old DimOS deadman) — locked out by sam-y-engage-v2",
      "actions": [
        "pause",
        "resume",
        "session_reset",
        "record",
        "discard",
        "emote_picker",
        "gripper_pinch"
      ]
    },
    "y_map": "tap_pause_hold3_kill",
    "actions": [
      "pause",
      "resume",
      "session_reset",
      "record",
      "discard",
      "emote_picker",
      "gripper_pinch"
    ],
    "full": "http://192.168.1.77:8450/robotics/controls"
  },
  "y_map": "tap_pause_hold3_kill",
  "trust": "http://192.168.1.77:8450/trust",
  "trust_url": "http://192.168.1.77:8450/trust",
  "trust_https_url": "https://192.168.1.77:8443/trust",
  "cert": "http://192.168.1.77:8450/cert.pem",
  "viser": "http://127.0.0.1:8095",
  "visor": "http://127.0.0.1:8095",
  "viser_up": true,
  "ports": {
    "discovery_http": 8450,
    "teleop_https": 8443,
    "viser_http": 8095
  },
  "setup": {
    "version": "1.0.0",
    "schema": "render-studio-robotics/v1",
    "download": "http://192.168.1.77:8450/robotics/bundle.zip",
    "assets_root": "http://192.168.1.77:8450/robotics/assets/",
    "load_order": [
      "manifest.json",
      "controls.json",
      "menus.json",
      "ui/setup.js",
      "ui/panels.css",
      "ui/hud.html",
      "ui/docs.html",
      "ui/y_hold.html",
      "ui/emote.html",
      "ui/confirm.html"
    ],
    "apply": "Download the zip (or each asset). Bind action ids from controls.json. Mount panels from menus.json (docs icon \u2192 docs, Y-hold overlay, emote/confirm). Live passthrough remains https://<LAN>:8443/teleop \u2014 do not iframe it.",
    "assets": [
      {
        "id": "hud",
        "kind": "ui",
        "url": "http://192.168.1.77:8450/robotics/ui/hud",
        "path": "ui/hud.html"
      },
      {
        "id": "docs",
        "kind": "ui",
        "url": "http://192.168.1.77:8450/robotics/ui/docs",
        "path": "ui/docs.html"
      },
      {
        "id": "y_hold",
        "kind": "ui",
        "url": "http://192.168.1.77:8450/robotics/ui/y_hold",
        "path": "ui/y_hold.html"
      },
      {
        "id": "emote",
        "kind": "ui",
        "url": "http://192.168.1.77:8450/robotics/ui/emote",
        "path": "ui/emote.html"
      },
      {
        "id": "confirm",
        "kind": "ui",
        "url": "http://192.168.1.77:8450/robotics/ui/confirm",
        "path": "ui/confirm.html"
      },
      {
        "id": "controls",
        "kind": "controls",
        "url": "http://192.168.1.77:8450/robotics/controls",
        "path": "controls.json"
      },
      {
        "id": "menus",
        "kind": "menu",
        "url": "http://192.168.1.77:8450/robotics/menus",
        "path": "menus.json"
      },
      {
        "id": "setup_js",
        "kind": "script",
        "url": "http://192.168.1.77:8450/robotics/assets/ui/setup.js",
        "path": "ui/setup.js"
      },
      {
        "id": "panels_css",
        "kind": "style",
        "url": "http://192.168.1.77:8450/robotics/assets/ui/panels.css",
        "path": "ui/panels.css"
      }
    ]
  },
  "controls_summary": {
    "gamepad": "xr-standard",
    "y": "tap engage / pause-resume \u00b7 hold 2s session_reset",
    "actions": [
      "pause",
      "resume",
      "session_reset",
      "record",
      "discard",
      "emote_picker",
      "gripper_pinch"
    ],
    "url": "http://192.168.1.77:8450/robotics/controls"
  },
  "ui_summary": {
    "panels": [
      "hud",
      "docs",
      "y_hold",
      "emote",
      "confirm"
    ],
    "menus": "http://192.168.1.77:8450/robotics/menus",
    "download": "http://192.168.1.77:8450/robotics/bundle.zip"
  }
};

export function profileUrl(raw, protocols = ["http:", "https:"]) {
  const text = String(raw || "").trim().replace(/^\[[^\]]*\]\(([^)]+)\)$/, "$1").replace(/\\([_:~])/g, "$1");
  if (!text) return "";
  const url = new URL(text);
  if (!protocols.includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP(S) URL without embedded credentials.");
  return url.href;
}
export function configUrlForTeleop(raw) {
  const u = new URL(profileUrl(raw || DEFAULT_ROBOTICS_PROFILE.ui));
  u.protocol = "http:"; u.port = "8450"; u.pathname = "/robotics/config"; u.search = ""; u.hash = "";
  return u.href;
}

/** Discovery and teleop are separate services; :8443 may not serve discovery. */
export function lanRoboticsConfigUrls(raw) {
  const supplied = new URL(profileUrl(raw || DEFAULT_ROBOTICS_PROFILE.paste_url));
  const isConfig = /^\/(?:robotics\/)?config\/?$/.test(supplied.pathname);
  const http = isConfig && supplied.protocol === 'http:' ? supplied.href : configUrlForTeleop(raw);
  const u = new URL(http);
  const host = u.hostname;
  return {
    http,
    https: isConfig && supplied.protocol === 'https:' ? supplied.href : `https://${host}:8443/robotics/config`,
    trust: `https://${host}:8443/trust`,
    trustHttp: `http://${host}:8450/trust`,
  };
}

export async function fetchRoboticsConfigFromLan(raw, { fetchFn, httpsPage = false, timeoutMs = 8000 } = {}) {
  const doFetch = fetchFn || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("fetch unavailable");
  const urls = lanRoboticsConfigUrls(raw);
  // Use the user's discovery endpoint first, including HTTP on HTTPS pages.
  // Browsers with Local Network Access can permit it; older browsers may block
  // mixed content. Never substitute a cloud proxy for the device's LAN request.
  const supplied = profileUrl(raw || DEFAULT_ROBOTICS_PROFILE.paste_url);
  const preferHttps = supplied.startsWith('https:') && (httpsPage || /\/config\/?(?:[?#]|$)/.test(supplied));
  const order = preferHttps ? [urls.https, urls.http] : [urls.http, urls.https];
  const failures = [];
  for (const url of order) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { cache: "no-store", credentials: "omit", signal: controller.signal });
      if (!res?.ok) throw new Error(`HTTP ${res?.status || 'error'}`);
      const profile = normalizeRoboticsProfile(await res.json());
      return { profile, configUrl: url };
    } catch (err) {
      failures.push(`${url}: ${controller.signal.aborted ? 'timed out' : err?.message || 'request failed'}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Could not read the Pi configuration from this browser. Use the Pi's Wi-Fi and allow local-network access if prompted. If blocked, open the config page and import or paste its JSON below. A missing HTTPS config endpoint does not mean teleop is down. ${failures.join('; ')}`);
}

export const ROBOTICS_PROFILE_CHECK_EVENT = "render3d:robotics-profile-check";

export async function checkRoboticsProfileAfterWorkspaceUpdate(user = null, { fetchFn, timeoutMs = 4000 } = {}) {
  const selection = readRoboticsProfile(user);
  const report = {
    ok: true,
    stale: false,
    changed: false,
    mode: selection.mode || "studio",
    kind: selection.profile?.kind || "",
    y_map: selection.profile?.controllers?.buttons?.y_map || "",
    detail: "Studio profile — no Pi fetch.",
  };
  if (selection.mode === "studio" || !selection.profile) {
    try {
      globalThis.dispatchEvent?.(new CustomEvent(ROBOTICS_PROFILE_CHECK_EVENT, { detail: report }));
    } catch { /* ignore */ }
    return report;
  }
  try {
    const loaded = await fetchRoboticsConfigFromLan(selection.profile.paste_url || selection.profile, { fetchFn, timeoutMs });
    const prev = JSON.stringify({
      kind: selection.profile?.kind,
      host: selection.profile?.host,
      y_map: selection.profile?.controllers?.buttons?.y_map,
      ui: selection.profile?.ui,
    });
    const next = JSON.stringify({
      kind: loaded.profile?.kind,
      host: loaded.profile?.host,
      y_map: loaded.profile?.controllers?.buttons?.y_map,
      ui: loaded.profile?.ui,
    });
    report.kind = loaded.profile?.kind || report.kind;
    report.y_map = loaded.profile?.controllers?.buttons?.y_map || report.y_map;
    if (prev !== next) {
      persistRoboticsProfile({ ...selection, profile: loaded.profile }, user);
      report.changed = true;
      report.detail = `Profile refreshed from ${loaded.configUrl}`;
    } else {
      report.detail = `Profile still matches ${loaded.configUrl}`;
    }
  } catch (err) {
    report.stale = true;
    report.ok = false;
    report.detail = err?.message || "Could not re-check the Pi profile after the workspace update.";
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(ROBOTICS_PROFILE_CHECK_EVENT, { detail: report }));
  } catch { /* ignore */ }
  return report;
}

export function normalizeRoboticsProfile(raw) {
  if (!raw || raw.schema !== "render-studio-robotics/v1") throw new Error("Expected a render-studio-robotics/v1 JSON profile.");
  if (JSON.stringify(raw).length > 65536) throw new Error("Profile must be smaller than 64 KB.");
  const p = JSON.parse(JSON.stringify(raw));
  for (const k of ["paste_url", "url", "ui", "passthrough_ui", "autoconnect", "docs", "trust", "trust_url", "trust_https_url", "cert", "viser", "visor"]) {
    if (p[k]) p[k] = profileUrl(p[k]);
  }
  p.ui = profileUrl(p.passthrough_ui || p.ui || p.url);
  if (!p.ui) throw new Error("Profile needs a teleop UI URL.");
  if (p.websocket) p.websocket = profileUrl(p.websocket, ["ws:", "wss:"]);
  p.controllers ||= {};
  for (const k of ["stream", "websocket"]) if (p.controllers[k]) p.controllers[k] = profileUrl(p.controllers[k], ["ws:", "wss:"]);
  for (const endpoint of Object.values(p.controllers.http_backups || {})) {
    if (endpoint?.url) endpoint.url = profileUrl(endpoint.url);
  }
  return p;
}
const PROFILE_KEY_PREFIX = "render3d:roboticsProfile:";
const MIGRATE_FLAG = "render3d:roboticsStorageMigrate:v1";
const IDB_NAME = "render3d-robotics-profile";
const IDB_STORE = "profiles";
const memory = new Map();
let lastIdbWrite = Promise.resolve();

export function isRoboticsStorageQuotaError(error) {
  const name = error?.name || "";
  const code = error?.code;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED"
    || code === 22 || code === 1014
    || /exceeded the quota|quota exceeded/i.test(error?.message || "");
}

export function resetRoboticsProfileStorageForTests() {
  memory.clear();
  lastIdbWrite = Promise.resolve();
}

function key(user) {
  try { user ||= JSON.parse(localStorage.getItem("render3d:user") || "null"); } catch {}
  return PROFILE_KEY_PREFIX + (user?.id || "anon");
}
function defaultSelection() {
  return { mode: "integrated", version: 2, configUrl: DEFAULT_ROBOTICS_PROFILE.paste_url, profile: normalizeRoboticsProfile(DEFAULT_ROBOTICS_PROFILE) };
}
function decodeSaved(saved, fallback) {
  if (!saved || typeof saved !== "object") return null;
  if (saved.mode === "studio") return saved;
  if (saved.profile) {
    return { ...saved, mode: saved.version === 2 ? saved.mode : "integrated", version: 2, profile: normalizeRoboticsProfile(saved.profile) };
  }
  if (saved.storage === "idb" && fallback && (fallback.mode === "studio" || fallback.profile)) return fallback;
  return null;
}
function selectionFromValue(value) {
  return value.mode === "studio" ? { mode: "studio" } : {
    mode: value.mode === "external" ? "external" : "integrated", version: 2, profile: normalizeRoboticsProfile(value.profile),
    configUrl: profileUrl(value.configUrl || value.profile.paste_url || configUrlForTeleop(value.profile.ui)),
  };
}
function pointerFor(next) {
  return { mode: next.mode, version: next.version || 2, configUrl: next.configUrl || "", storage: "idb" };
}
function storageKeys(ls) {
  const keys = [];
  try {
    if (!ls || typeof ls.key !== "function" || !Number.isFinite(ls.length)) return keys;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k) keys.push(k);
    }
  } catch {}
  return keys;
}
function isProtectedStorageKey(k, keepKey) {
  if (!k || k === keepKey || k === MIGRATE_FLAG) return true;
  if (k === "render3d:token" || k === "render3d:user" || k === "render3d:refresh") return true;
  if (k.startsWith("render3d:token")) return true;
  return false;
}
function looksLikeBlobValue(value) {
  if (!value) return false;
  if (value.length >= 100000) return true;
  return value.length >= 16000 && /data:(?:image|video|audio|application)\//i.test(value);
}
function dropStaleRoboticsKeys(keepKey, ls = globalThis.localStorage) {
  if (!ls?.removeItem) return;
  const anon = PROFILE_KEY_PREFIX + "anon";
  if (keepKey !== anon) {
    try { ls.removeItem(anon); } catch {}
  }
  for (const k of storageKeys(ls)) {
    if (!k.startsWith(PROFILE_KEY_PREFIX) || k === keepKey) continue;
    let raw = "";
    try { raw = ls.getItem(k) || ""; } catch {}
    if (raw.length > 70000) {
      try { ls.removeItem(k); } catch {}
    }
  }
}
function pruneBulkyLocalStorage(keepKey, needed = 65536) {
  const ls = globalThis.localStorage;
  if (!ls?.removeItem) return;
  dropStaleRoboticsKeys(keepKey, ls);
  const bulky = [];
  for (const k of storageKeys(ls)) {
    if (isProtectedStorageKey(k, keepKey)) continue;
    let value = "";
    try { value = ls.getItem(k) || ""; } catch {}
    if (looksLikeBlobValue(value)) bulky.push({ k, n: value.length });
  }
  bulky.sort((a, b) => b.n - a.n);
  let freed = 0;
  for (const { k, n } of bulky) {
    try { ls.removeItem(k); freed += n; } catch {}
    if (freed >= needed) break;
  }
}
function writeLocalStorage(k, json) {
  try {
    localStorage.setItem(k, json);
    return true;
  } catch (error) {
    if (!isRoboticsStorageQuotaError(error)) return false;
    pruneBulkyLocalStorage(k, Math.max(String(json || "").length, 65536) * 2);
    try {
      localStorage.setItem(k, json);
      return true;
    } catch {
      return false;
    }
  }
}
function openProfileIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no idb"));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb"));
  });
}
function putProfileIdb(storageKey, value) {
  return openProfileIdb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, storageKey);
    tx.oncomplete = () => { try { db.close?.(); } catch {} resolve(); };
    tx.onerror = () => { try { db.close?.(); } catch {} reject(tx.error); };
  })).catch(() => {});
}
function getProfileIdb(storageKey) {
  return openProfileIdb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(storageKey);
    req.onsuccess = () => { try { db.close?.(); } catch {} resolve(req.result || null); };
    req.onerror = () => { try { db.close?.(); } catch {} reject(req.error); };
  })).catch(() => null);
}
function migrateRoboticsStorageOnce(keepKey) {
  try {
    if (localStorage.getItem(MIGRATE_FLAG) === "1") {
      dropStaleRoboticsKeys(keepKey);
      return;
    }
  } catch {
    return;
  }
  pruneBulkyLocalStorage(keepKey, 2_000_000);
  try { localStorage.setItem(MIGRATE_FLAG, "1"); } catch {
    pruneBulkyLocalStorage(keepKey, 2_000_000);
  }
}
export function readRoboticsProfile(user = null) {
  const k = key(user);
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const decoded = decodeSaved(JSON.parse(raw), memory.get(k));
      if (decoded) return decoded;
    }
  } catch {}
  if (memory.has(k)) return memory.get(k);
  return defaultSelection();
}
export function persistRoboticsProfile(value, user = null, { notify = true } = {}) {
  const next = selectionFromValue(value);
  const k = key(user);
  memory.set(k, next);
  try {
    migrateRoboticsStorageOnce(k);
    dropStaleRoboticsKeys(k);
    const json = JSON.stringify(next);
    if (!writeLocalStorage(k, json)) writeLocalStorage(k, JSON.stringify(pointerFor(next)));
  } catch { /* quota / private mode — memory + IndexedDB + account prefs remain */ }
  lastIdbWrite = putProfileIdb(k, next);
  if (notify) globalThis.dispatchEvent?.(new CustomEvent(ROBOTICS_PROFILE_EVENT, { detail: next }));
  return next;
}
export function persistRoboticsProfileDurable(value, user = null, opts = {}) {
  const next = persistRoboticsProfile(value, user, opts);
  return lastIdbWrite.then(() => next);
}
function hydrateRoboticsProfileFromIdb() {
  try {
    const k = key();
    void getProfileIdb(k).then((saved) => {
      if (!saved || memory.has(k)) return;
      let lsRaw = null;
      try { lsRaw = localStorage.getItem(k); } catch {}
      if (lsRaw) {
        try {
          const decodedLs = decodeSaved(JSON.parse(lsRaw), null);
          if (decodedLs?.profile || decodedLs?.mode === "studio") return;
        } catch {}
      }
      const decoded = decodeSaved(saved, null);
      if (!decoded) return;
      memory.set(k, decoded);
      writeLocalStorage(k, JSON.stringify(decoded));
      globalThis.dispatchEvent?.(new CustomEvent(ROBOTICS_PROFILE_EVENT, { detail: decoded }));
    });
  } catch {}
}
try { if (globalThis.localStorage) migrateRoboticsStorageOnce(key()); } catch {}
if (typeof indexedDB !== "undefined") hydrateRoboticsProfileFromIdb();
export function roboticsOwnsExternalSession(value = readRoboticsProfile()) {
  return value.mode === "external" && (value.profile?.embed?.iframe === false || value.profile?.controllers?.single_client === true);
}
export function roboticsLaunchUrl(value = readRoboticsProfile()) {
  if (!roboticsOwnsExternalSession(value)) return "";
  const p = value.profile;
  return profileUrl(p.autoconnect || p.url || p.passthrough_ui || p.ui);
}
export function roboticsProfileSummary(p) {
  const lines = [p.kind || "Robotics", p.controllers?.protocol || "", `Teleop: ${p.ui}`, `Controller stream: ${p.controllers?.websocket || p.websocket || "not provided"}`];
  for (const side of ["left", "right"]) for (const [button, action] of Object.entries(p.controllers?.buttons?.[side] || {})) {
    lines.push(`${side} ${button}: ${typeof action === "string" ? action : Object.entries(action).map(([k,v]) => `${k}: ${v}`).join(" · ")}`);
  }
  if (p.controllers?.buttons?.do_not_use) lines.push(`Retired mapping: ${p.controllers.buttons.do_not_use}`);
  return lines.filter(Boolean).join("\n");
}

export function roboticsIntegratedProfile(value = readRoboticsProfile()) {
  return value.mode === "integrated" ? value.profile : null;
}
export function roboticsControllerUrl(value = readRoboticsProfile()) {
  const p = roboticsIntegratedProfile(value);
  return p ? profileUrl(p.controllers?.websocket || p.controllers?.stream || p.websocket, ["ws:", "wss:"]) : "";
}
