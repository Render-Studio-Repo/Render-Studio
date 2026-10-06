/**
 * In-viewport Viser tab: overlay, split, retractable rail, IP/camera popovers.
 * Persist LAN URLs per user; iframe a same-origin proxy.
 */

import { hostnameOf, isLoopbackHost, isPrivateLanHost } from "../xr/xr-dimos-lan.js?v=20260909-dimosui1-20260914-lanpc1-20260914-visersame1";
import {
  isSamCameraAccount,
  persistHandCamDraft,
  persistHandCamHost,
  persistHandCamMode,
  persistHandCamVrScene,
  readHandCamPrefs,
  resolveHandCamHost,
  resolveHandCamMode,
  displayCameraHost,
  overlayCameraTitle,
  persistCameraOverlayTitle,
  saveHandCamLabelsRemote,
  swapHandCamLabelMap,
  assignCameraDeviceRole,
  maybeHotplugHandCamPublish,
  studioUserId,
  MAC_USB_CAM_COMMANDS,
  SAM_CAMERA_HOST_DEFAULT,
  activateWristCameras,
  handCamJpegUrl,
  HAND_CAM_STATUS_PATH,
} from "../xr/xr-hand-cams.js?v=roboticsworkspace3";
import {
  addTeleopUrl,
  displayTeleopUrl,
  persistTeleopDraft,
  readTeleopPrefs,
  TELEOP_DEFAULT_URL,
} from "./teleop-viewer.js?v=20260914-teleop2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-studio3-pistopsave1-pitriggerviser2&xrtalk=20260916-1&astra=20260916-5&inputfix=20260916-1&teleop-y=20260922-poseconnect1&vrrobot=20260927-2";
import {
  persistDimosWsUrl,
  resolveDimosWsUrl,
  formatDimosHostInput,
} from "../xr/xr-dimos-teleop.js?v=20260929-y-record1";
import {
  VISER_RECORDING_EVENT,
  activeViserRecording,
  deliverViserRecording,
  loadViserRecording,
  readViserRecordingLibrary,
  selectViserRecording,
  viserRecordingLabel,
} from "./viser-recording-selection.js?v=20260923-recording-viser1";
import {
  cloudTrainingManifest,
  DGX_CLOUD_CONSOLE_URL,
  DGX_CLOUD_DOCS_URL,
  huggingFaceDatasetUrl,
  lerobotTrainingCommand,
  readCloudTrainingProfile,
  saveCloudTrainingProfile,
} from "./cloud-robotics-training.js?v=20260929-dgx-folding1";

export const VISER_STORAGE_KEY = "render3d:viserPrefs";
export const VISER_DEFAULT_URL = "http://127.0.0.1:8095/";
export const VISER_DEFAULT_PORT = "8095";
export const SAM_VISER_EXAMPLE = VISER_DEFAULT_URL;
export const LEGACY_SAM_VISER_URL = "http://192.168.1.77:8095/";
export const VISER_TAB_ID = "viser:open";
export const VISER_LAYOUTS = ["cad", "split", "viser"];
export const VISER_DRAFT_DEBOUNCE_MS = 400;
export const VISER_URL_FIELD_SEL = "[data-viser-url], [data-viser-ribbon-url], [data-robotics-viser-url], [data-ip-control], #pref-viser-url";
export const CAM_IP_FIELD_SEL = "[data-ip-camera], [data-hand-cam-ip], #pref-hand-cam-ip";
export const VISER_GITHUB_URL = "https://github.com/nerfstudio-project/viser";
export const VISER_CAMERAS_CACHE = "camvis2";
export const VISER_CAM_LABEL_CACHE = "camlab1";
export const CAM_LIST_CACHE = "camlist1";
export const CAM_DEBUG_CACHE = "camdbg1";
export const CAM_HOTPLUG_CACHE = "camhot1";
export const CAM_REINIT_CACHE = "camre1";
export const CAM_SKIP_CACHE = "camskip1";
export const CAM_TAB_CACHE = "camtab1";
export const CAM_LIST_REFRESH_MS = 1500;
export const NO_WRIST_CAMERA_PLUGGED = "No wrist camera plugged in";
export const VISER_GUI_CACHE = "visgui2";
export const VISER_FS_CACHE = "visfs1";
export const VISER_GUI_ARROW_ID = "studio-viser-gui-arrow";
export const VISER_GUI_STYLE_ID = "studio-viser-gui-style";
export const VISER_JOINT_STREAM_ID = "studio-viser-joint-stream";
export const VISER_JOINT_EVENT = "render3d:viser-joints";
export const VISER_GUI_ARROW_SEL = "[data-viser-gui-arrow]";
export const VISER_FS_SEL = "[data-viser-fs]";
export const VISER_FS_EXIT_SEL = "[data-viser-fs-exit]";
export const VISER_GUI_PANEL_SEL = '[class*="GuiPanel"], [class*="guiPanel"], .GuiPanel, [class*="ControlPanel"], .ControlPanel, [class*="SidebarPanel"]';
export const TELEOP_IP_FIELD_SEL = "[data-ip-teleop], [data-teleop-url], [data-teleop-ribbon-url]";

export const VISER_GUI_HIDE_CSS = `
html.studio-viser-gui-collapsed .GuiPanel,
html.studio-viser-gui-collapsed .ControlPanel,
html.studio-viser-gui-collapsed [class*="GuiPanel"],
html.studio-viser-gui-collapsed [class*="guiPanel"],
html.studio-viser-gui-collapsed [class*="ControlPanel"],
html.studio-viser-gui-collapsed [class*="SidebarPanel"] {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
  width: 0 !important;
  min-width: 0 !important;
  max-width: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
}
#studio-viser-gui-arrow,
[data-viser-gui-arrow] {
  display: none !important;
  pointer-events: none !important;
}
`;

function toggleClass(el, name, on) {
  if (!el?.classList) return;
  if (typeof el.classList.toggle === "function") {
    el.classList.toggle(name, on);
    return;
  }
  if (on) el.classList.add?.(name);
  else el.classList.remove?.(name);
}

function documentOfViserTarget(target) {
  if (!target) return null;
  if (target.documentElement && (target.defaultView || target.nodeType === 9)) return target;
  try {
    if (target.contentDocument) return target.contentDocument;
  } catch {
    /* cross-origin */
  }
  return target.ownerDocument || null;
}

/** Pin the Studio chevron to the left edge of Viser's right GUI (Scene / Manipulation). */
export function pinViserGuiArrow(doc) {
  try {
    const html = doc?.documentElement;
    if (!html?.style?.setProperty) return;
    if (html.classList?.contains?.("studio-viser-gui-collapsed")) return;
    const panel = doc.querySelector?.(VISER_GUI_PANEL_SEL);
    const r = panel?.getBoundingClientRect?.();
    if (!r || !(r.width > 8)) return;
    html.style.setProperty("--studio-viser-gui-edge", `${Math.round(r.left)}px`);
    html.style.setProperty("--studio-viser-gui-mid", `${Math.round(r.top + r.height / 2)}px`);
  } catch {
    /* ignore */
  }
}

function watchViserGuiLayout(doc) {
  if (!doc) return;
  pinViserGuiArrow(doc);
  try {
    if (doc.__studioViserGuiObs) return;
    if (typeof MutationObserver !== "function") return;
    const root = doc.body || doc.documentElement;
    if (!root) return;
    const mo = new MutationObserver(() => pinViserGuiArrow(doc));
    mo.observe(root, { childList: true, subtree: true, attributes: true });
    doc.__studioViserGuiObs = mo;
  } catch {
    /* ignore */
  }
}

export function applyViserGuiCollapsed(target, collapsed) {
  const on = !!collapsed;
  const docs = [];
  const seen = new Set();
  const addDoc = (d) => {
    if (d && !seen.has(d)) {
      seen.add(d);
      docs.push(d);
    }
  };
  addDoc(documentOfViserTarget(target));
  if (target?.classList && target.ownerDocument) addDoc(target.ownerDocument);
  if (target?.documentElement) addDoc(target);
  try { addDoc(target?.contentDocument); } catch { /* cross-origin */ }

  if (on) docs.forEach(pinViserGuiArrow);

  const roots = [];
  if (target?.classList) roots.push(target);
  if (target?.documentElement?.classList) roots.push(target.documentElement);
  for (const d of docs) {
    if (d?.documentElement?.classList) roots.push(d.documentElement);
  }
  for (const root of roots) {
    toggleClass(root, "studio-viser-gui-collapsed", on);
    toggleClass(root, "viser-gui-collapsed", on);
  }
  if (!on) docs.forEach(pinViserGuiArrow);
  return on;
}

export function syncViserGuiArrow(btn, collapsed) {
  if (!btn) return btn;
  const on = !!collapsed;
  btn.setAttribute?.("hidden", on ? "" : "hidden");
  if (btn.hidden != null) btn.hidden = true;
  btn.setAttribute?.("aria-hidden", "true");
  return btn;
}

export function syncViserFsButtons(root, collapsed) {
  const on = !!collapsed;
  const host = root?.querySelector ? root : root?.ownerDocument || null;
  const query = (sel) => {
    if (root?.matches?.(sel) || root?.getAttribute?.("data-viser-fs") || root?.getAttribute?.("data-viser-fs-exit")) {
      return [root];
    }
    return [...(root?.querySelectorAll?.(sel) || host?.querySelectorAll?.(sel) || [])];
  };
  query(VISER_FS_SEL).forEach((btn) => {
    if (btn.hidden != null) btn.hidden = on;
    btn.setAttribute?.("aria-pressed", on ? "true" : "false");
    btn.setAttribute?.("aria-hidden", on ? "true" : "false");
    if (btn.title != null) btn.title = "Hide side panel";
    else btn.setAttribute?.("title", "Hide side panel");
  });
  query(VISER_FS_EXIT_SEL).forEach((btn) => {
    if (btn.hidden != null) btn.hidden = !on;
    btn.setAttribute?.("aria-hidden", on ? "false" : "true");
    if (btn.title != null) btn.title = "Show Viser panel";
    else btn.setAttribute?.("title", "Show Viser panel");
  });
  return on;
}

const LAYOUT_LISTENERS = new Set();
let ipPopover = null;
let ipBackdrop = null;
let cloudPopover = null;
let camListTimer = 0;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function cameraDebugHint(devices = []) {
  const names = (devices || []).map((d) => String(d?.name || d?.label || ""));
  const hasFace = names.some((n) => /facetime/i.test(n));
  const hasScreen = names.some((n) => /capture\s*screen/i.test(n));
  const parts = ["Live USB list (auto-refresh)."];
  if (hasFace && hasScreen) parts.push("FaceTime and Capture screen are skipped.");
  else if (hasFace) parts.push("FaceTime is skipped.");
  else if (hasScreen) parts.push("Capture screen is skipped.");
  parts.push("Swap if Left/Right are backwards.");
  return parts.join(" ");
}

function cameraLabelControlsHtml(user = null) {
  const titles = {
    left: overlayCameraTitle("left", user),
    right: overlayCameraTitle("right", user),
    pov: overlayCameraTitle("pov", user),
  };
  return `
      <div class="robotics-cam-labels" data-cam-labels data-cam-debug-list>
        <p class="muted small" data-cam-debug-hint>${escapeHtml(cameraDebugHint())}</p>
        <div class="robotics-cam-device-list" data-cam-device-list>Looking up cameras…</div>
        <div class="robotics-ip-actions robotics-cam-label-actions">
          <button type="button" class="btn secondary btn-compact" data-cam-swap>Swap Left/Right</button>
        </div>
        <label class="robotics-ip-field">Left overlay
          <input data-cam-title-left class="profile-pretty-input" type="text" maxlength="80" spellcheck="false" value="${escapeHtml(titles.left)}" placeholder="Left" />
        </label>
        <label class="robotics-ip-field">Right overlay
          <input data-cam-title-right class="profile-pretty-input" type="text" maxlength="80" spellcheck="false" value="${escapeHtml(titles.right)}" placeholder="Right wrist" />
        </label>
        <label class="robotics-ip-field">POV overlay
          <input data-cam-title-pov class="profile-pretty-input" type="text" maxlength="80" spellcheck="false" value="${escapeHtml(titles.pov)}" placeholder="Robot POV" />
        </label>
      </div>`;
}

function bindCameraLabelControls(pop, { user, fetchFn, apiFn } = {}) {
  const listEl = pop?.querySelector?.("[data-cam-device-list]");
  const hintEl = pop?.querySelector?.("[data-cam-debug-hint]");
  const swapBtn = pop?.querySelector?.("[data-cam-swap]");
  const leftTitle = pop?.querySelector?.("[data-cam-title-left]");
  const rightTitle = pop?.querySelector?.("[data-cam-title-right]");
  const povTitle = pop?.querySelector?.("[data-cam-title-pov]");
  let devices = [];
  let lastStatus = {};

  const renderList = (rows = devices, status = lastStatus) => {
    if (hintEl) hintEl.textContent = cameraDebugHint(rows);
    if (!listEl) return;
    const usable = (rows || []).filter((d) => !d?.skipped);
    const slot = (side) => usable.find((d) => d.side === side) || null;
    const row = (side, rec) => {
      const label = side === "right" ? "Right" : "Left";
      if (!rec) {
        return `<div class="robotics-cam-device is-empty" data-cam-slot="${side}" data-cam-plugged="0">${label} · not plugged in</div>`;
      }
      const id = rec.uniqueId || rec.usb || "";
      return `<div class="robotics-cam-device" data-cam-device="${escapeHtml(String(rec.index ?? ""))}" data-cam-slot="${side}" data-cam-plugged="1">${escapeHtml(rec.name || "Camera")} · ${label} · plugged in${id ? ` · ${escapeHtml(id)}` : ""}</div>`;
    };
    const extras = (rows || []).filter((d) => d !== slot("left") && d !== slot("right"));
    const parts = [row("left", slot("left")), row("right", slot("right"))];
    if (!usable.length) {
      parts.unshift(`<div data-cam-empty>${NO_WRIST_CAMERA_PLUGGED}</div>`);
    }
    for (const rec of extras) {
      const side = rec.side === "right" ? "Right" : rec.side === "left" ? "Left" : rec.side === "pov" ? "Robot POV" : "Unassigned";
      const id = rec.uniqueId || rec.usb || "";
      const disabled = rec.skipped ? " disabled" : "";
      parts.push(`<div class="robotics-cam-device" data-cam-plugged="${rec.skipped ? "0" : "1"}"><span>${escapeHtml(rec.name || "Camera")} · ${side}${rec.skipped ? " · unavailable" : " · plugged in"}${id ? ` · ${escapeHtml(id)}` : ""}</span><select data-cam-assign="${escapeHtml(String(rec.index ?? ""))}"${disabled}><option value="">Unassigned</option><option value="left"${rec.side === "left" ? " selected" : ""}>Left wrist</option><option value="right"${rec.side === "right" ? " selected" : ""}>Right wrist</option><option value="pov"${rec.side === "pov" ? " selected" : ""}>Robot POV</option></select></div>`);
    }
    void status;
    listEl.innerHTML = parts.join("");
    listEl.querySelectorAll?.("[data-cam-assign]").forEach((select) => {
      select.addEventListener("change", () => {
        const rec = (rows || []).find((item) => String(item?.index ?? "") === select.dataset.camAssign);
        if (!rec) return;
        assignCameraDeviceRole(rec, select.value, user);
        void persistLabels().then(() => loadStatus());
      });
    });
  };

  const loadStatus = async () => {
    const doFetch = fetchFn || globalThis.fetch?.bind(globalThis);
    try {
      const res = await doFetch?.(HAND_CAM_STATUS_PATH, { cache: "no-store", credentials: "include" });
      const data = await res?.json?.().catch?.(() => ({})) || {};
      lastStatus = data;
      devices = Array.isArray(data.devices) ? data.devices : [];
      renderList(devices, data);
      if (data.titles) {
        if (leftTitle && data.titles.left && leftTitle !== globalThis.document?.activeElement) leftTitle.value = data.titles.left;
        if (rightTitle && data.titles.right && rightTitle !== globalThis.document?.activeElement) rightTitle.value = data.titles.right;
        if (povTitle && data.titles.pov && povTitle !== globalThis.document?.activeElement) povTitle.value = data.titles.pov;
      }
      await maybeHotplugHandCamPublish({ status: data, fetchFn, apiFn, user });
    } catch {
      if (listEl) listEl.textContent = NO_WRIST_CAMERA_PLUGGED;
    }
  };

  const persistLabels = () => saveHandCamLabelsRemote({ fetchFn, apiFn, user });

  swapBtn?.addEventListener("click", () => {
    swapHandCamLabelMap(devices, user);
    void persistLabels().then((data) => {
      if (Array.isArray(data?.devices)) {
        devices = data.devices;
        renderList(devices);
      } else {
        void loadStatus();
      }
    });
  });
  const saveTitle = (side, input) => {
    persistCameraOverlayTitle(side, input?.value || "", user);
    void persistLabels();
  };
  leftTitle?.addEventListener("change", () => saveTitle("left", leftTitle));
  rightTitle?.addEventListener("change", () => saveTitle("right", rightTitle));
  povTitle?.addEventListener("change", () => saveTitle("pov", povTitle));
  leftTitle?.addEventListener("input", () => persistCameraOverlayTitle("left", leftTitle.value || "", user));
  rightTitle?.addEventListener("input", () => persistCameraOverlayTitle("right", rightTitle.value || "", user));
  povTitle?.addEventListener("input", () => persistCameraOverlayTitle("pov", povTitle.value || "", user));
  stopCamListRefresh();
  void loadStatus();
  camListTimer = globalThis.setInterval?.(loadStatus, CAM_LIST_REFRESH_MS) || 0;
}

export function viserPrefsKey(user = null, projectId = "") {
  const base = `${VISER_STORAGE_KEY}:${studioUserId(user)}`;
  const pid = String(projectId || "").trim();
  return pid ? `${base}:project:${pid}` : base;
}

export function normalizeViserUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  let candidate = s;
  if (/^ws:\/\//i.test(candidate)) candidate = `http://${candidate.slice(5)}`;
  else if (/^wss:\/\//i.test(candidate)) candidate = `http://${candidate.slice(6)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `http://${candidate.replace(/^\[|\]$/g, "")}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const host = String(u.hostname || "").toLowerCase();
    if (!isPrivateLanHost(host) && !isLoopbackHost(host)) return "";
    if (host === "169.254.169.254") return "";
    const port = u.port || VISER_DEFAULT_PORT;
    u.protocol = "http:";
    u.port = port;
    if (!u.pathname || u.pathname === "") u.pathname = "/";
    return u.toString();
  } catch {
    return "";
  }
}

export function viserWsUrl(raw) {
  const url = normalizeViserUrl(raw);
  if (!url) return "";
  try {
    const u = new URL(url);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${u.host}`;
  } catch {
    return "";
  }
}

export function defaultViserUrlsForUser(user = null) {
  if (isSamCameraAccount(user)) return [SAM_VISER_EXAMPLE];
  return [VISER_DEFAULT_URL];
}

export function migrateViserUrl(raw) {
  const normalized = normalizeViserUrl(raw);
  return normalized === LEGACY_SAM_VISER_URL ? VISER_DEFAULT_URL : normalized;
}

export function viserUnreachableMessage(url) {
  const target = normalizeViserUrl(url) || String(url || "").trim() || VISER_DEFAULT_URL;
  let host = "";
  try { host = new URL(target).hostname; } catch { host = ""; }
  if (isLoopbackHost(host)) {
    return `Can't reach Dimensional Viser at ${target}. Start the local DIMOS viewer, then reconnect.`;
  }
  return `Can't reach Viser at ${target}. Start Viser on 0.0.0.0 (not 127.0.0.1) or enter a LAN address.`;
}

export function shouldLoadViserIframe(payload = {}) {
  const error = String(payload?.error || payload?.detail || "");
  if (/cloud studio cannot reach/i.test(error)) return false;
  if (/viser url must be/i.test(error)) return false;
  return true;
}

export function normalizeViserLayout(raw) {
  return VISER_LAYOUTS.includes(raw) ? raw : "viser";
}

/** Opening VR Viser keeps Split/Viser; CAD-only prefs still open the Viser pane. */
export function layoutForViserTab(prefs) {
  const layout = normalizeViserLayout(prefs?.layout);
  return layout === "cad" ? "viser" : layout;
}

/** Split is a toggle: on → CAD+Viser; click again → full Viser. CAD/Viser set those layouts. */
export function nextViserLayoutFromClick(want, current) {
  const next = normalizeViserLayout(want);
  const now = normalizeViserLayout(current);
  if (next === "split" && now === "split") return "viser";
  return next;
}

export const VISER_STUDIO_TOOLS = [
  { id: "btn-pick-object", label: "Select" },
  { id: "btn-pick-corner", label: "Corner" },
  { id: "btn-pick-face", label: "Face" },
  { id: "btn-pick-edge", label: "Edge" },
  { id: "btn-pick-line", label: "Line" },
  { id: "btn-pick-lasso", label: "Lasso" },
  { id: "btn-pick-orbit", label: "Orbit" },
  { id: "btn-gizmo", label: "Gizmo" },
  { id: "btn-joints", label: "Joints" },
  { id: "btn-measure", label: "Measure" },
  { id: "btn-xr-vr-ribbon", label: "AR" },
  { id: "btn-fit", label: "Fit" },
];

export function clickViserStudioTool(id, root = globalThis.document) {
  const el = root?.getElementById?.(String(id || ""));
  el?.click?.();
  return !!el;
}

/** Overlay pick/gizmo bar is only for full Viser — Split already shows CAD ribbon tools. */
export function shouldShowViserStudioTools(layout) {
  return normalizeViserLayout(layout) === "viser";
}

function layoutFromViserRoot(root) {
  const col = root?.querySelector?.(".main-column");
  const fromData = col?.dataset?.viserLayout;
  if (fromData) return normalizeViserLayout(fromData);
  if (col?.classList?.contains?.("viser-layout-split")) return "split";
  if (col?.classList?.contains?.("viser-layout-cad")) return "cad";
  return "viser";
}

export function syncViserStudioTools(root = globalThis.document, layout) {
  const host = root?.querySelector?.("[data-viser-studio-tools]");
  if (!host) return null;
  const show = shouldShowViserStudioTools(layout || layoutFromViserRoot(root));
  host.hidden = !show;
  host.setAttribute?.("aria-hidden", show ? "false" : "true");
  if (!show || !host.querySelectorAll) return host;
  host.querySelectorAll("[data-viser-tool]").forEach((btn) => {
    const src = root.getElementById?.(btn.getAttribute("data-viser-tool"));
    if (!src) return;
    const on = !!(src.classList?.contains?.("active") || src.getAttribute?.("aria-pressed") === "true");
    btn.classList?.toggle?.("is-on", on);
    btn.setAttribute?.("aria-pressed", on ? "true" : "false");
  });
  return host;
}

function clampSceneBox(box) {
  const w = Math.round(Number(box?.w) || 0);
  const h = Math.round(Number(box?.h) || 0);
  return {
    w: w > 0 ? Math.max(280, Math.min(w, 8000)) : 0,
    h: h > 0 ? Math.max(200, Math.min(h, 8000)) : 0,
  };
}

function parseViserPrefs(raw, seeded) {
  const fallback = {
    urls: seeded,
    active: seeded[0] || VISER_DEFAULT_URL,
    draft: "",
    layout: "viser",
    railOpen: false,
    chromeOpen: true,
    guiHidden: false,
    sceneBox: { w: 0, h: 0 },
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    const urls = Array.isArray(parsed?.urls)
      ? parsed.urls.map(migrateViserUrl).filter(Boolean)
      : [];
    const merged = [...new Set([...urls, ...seeded])];
    const active = migrateViserUrl(parsed?.active) || merged[0] || VISER_DEFAULT_URL;
    return {
      urls: merged,
      active,
      draft: parsed?.draft != null ? String(parsed.draft) : "",
      layout: normalizeViserLayout(parsed?.layout),
      railOpen: parsed?.railOpen === true,
      chromeOpen: parsed?.chromeOpen !== false,
      guiHidden: parsed?.guiHidden === true,
      sceneBox: clampSceneBox(parsed?.sceneBox),
    };
  } catch {
    return fallback;
  }
}

export function readViserPrefs(user = null, projectId = "") {
  const seeded = defaultViserUrlsForUser(user);
  try {
    const projectRaw = projectId ? storage()?.getItem(viserPrefsKey(user, projectId)) : null;
    if (projectRaw) return parseViserPrefs(projectRaw, seeded);
    const userRaw = storage()?.getItem(viserPrefsKey(user));
    return parseViserPrefs(userRaw, seeded);
  } catch {
    return parseViserPrefs(null, seeded);
  }
}

export function persistViserPrefs(partial = {}, user = null, projectId = "") {
  const prev = readViserPrefs(user, projectId);
  const urls = Array.isArray(partial.urls)
    ? partial.urls.map(normalizeViserUrl).filter(Boolean)
    : prev.urls;
  const unique = [...new Set(urls.length ? urls : defaultViserUrlsForUser(user))];
  const active = normalizeViserUrl(partial.active != null ? partial.active : prev.active) || unique[0] || VISER_DEFAULT_URL;
  const next = {
    urls: unique,
    active,
    draft: partial.draft != null ? String(partial.draft) : (prev.draft ?? ""),
    layout: partial.layout != null ? normalizeViserLayout(partial.layout) : prev.layout,
    railOpen: partial.railOpen != null ? !!partial.railOpen : prev.railOpen,
    chromeOpen: partial.chromeOpen != null ? !!partial.chromeOpen : prev.chromeOpen,
    guiHidden: partial.guiHidden != null ? !!partial.guiHidden : prev.guiHidden,
    sceneBox: partial.sceneBox != null ? clampSceneBox(partial.sceneBox) : clampSceneBox(prev.sceneBox),
  };
  try {
    const json = JSON.stringify(next);
    storage()?.setItem(viserPrefsKey(user), json);
    if (projectId) storage()?.setItem(viserPrefsKey(user, projectId), json);
  } catch { /* ignore */ }
  LAYOUT_LISTENERS.forEach((fn) => {
    try { fn(next); } catch { /* ignore */ }
  });
  try {
    window.dispatchEvent(new CustomEvent("render3d:robotics-prefs", {
      detail: { viserUrls: next.urls, viserActive: next.active },
    }));
  } catch { /* ignore */ }
  return next;
}

export function addViserUrl(raw, user = null, projectId = "") {
  const url = normalizeViserUrl(raw);
  if (!url) return persistViserDraft(raw, user, projectId);
  const prev = readViserPrefs(user, projectId);
  return persistViserPrefs({
    urls: [...prev.urls, url],
    active: url,
    draft: String(raw ?? url),
    railOpen: false,
  }, user, projectId);
}

/** Persist Viser URL as the user types. Incomplete values stay as draft until they normalize. */
export function persistViserDraft(raw, user = null, projectId = "") {
  const draft = String(raw ?? "");
  const url = normalizeViserUrl(draft);
  const prev = readViserPrefs(user, projectId);
  if (url) {
    return persistViserPrefs({
      urls: [...prev.urls, url],
      active: url,
      draft,
      railOpen: false,
    }, user, projectId);
  }
  return persistViserPrefs({ draft, railOpen: false }, user, projectId);
}

export function displayViserUrl(prefs = null, fallback = VISER_DEFAULT_URL) {
  const draft = String(prefs?.draft || "");
  if (draft) return draft;
  return prefs?.active || fallback;
}

export function publicWebsiteUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:") return "";
    const host = String(u.hostname || "").toLowerCase();
    if (!host || isPrivateLanHost(host) || isLoopbackHost(host)) return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function viserProxySrc(url) {
  const normalized = normalizeViserUrl(url);
  if (!normalized) return "";
  const u = new URL(normalized);
  const host = hostnameOf(u.hostname);
  const port = u.port || (u.protocol === "https:" ? "443" : VISER_DEFAULT_PORT);
  const path = `${u.pathname || "/"}${u.search || ""}`;
  const joined = path.startsWith("/") ? path : `/${path}`;
  return `/api/viser/p/${encodeURIComponent(host)}/${encodeURIComponent(port)}${joined}`;
}

/** LAN → same document as a browser (direct on http, same-origin proxy on https). Public https → direct. */
export function viserIframeSrc(raw, loc = globalThis.location) {
  const lan = normalizeViserUrl(raw);
  if (lan) {
    const https = String(loc?.protocol || "") === "https:";
    return https ? viserProxySrc(lan) : lan;
  }
  return publicWebsiteUrl(raw);
}

export function shouldHideViewportForViser(shell, layout = "split", { presenting = false } = {}) {
  if (presenting) return false;
  if (shell !== "viser") return null;
  return layout === "viser";
}

function stopCamListRefresh() {
  if (camListTimer) {
    try { globalThis.clearInterval?.(camListTimer); } catch { /* ignore */ }
    camListTimer = 0;
  }
}

function closeIpPopover() {
  stopCamListRefresh();
  ipPopover?.remove();
  ipPopover = null;
  ipBackdrop?.remove();
  ipBackdrop = null;
}

function closeCloudPopover() {
  cloudPopover?.remove();
  cloudPopover = null;
  ipBackdrop?.remove();
  ipBackdrop = null;
}

function mountCenteredDialog(pop) {
  const back = document.createElement("div");
  back.className = "robotics-ip-popover-backdrop";
  back.addEventListener("click", () => {
    closeIpPopover();
    closeCloudPopover();
  });
  document.body.appendChild(back);
  document.body.appendChild(pop);
  ipBackdrop = back;
  return pop;
}

if (typeof window !== "undefined" && !window.__render3dCloseRoboticsPopoversBound) {
  window.__render3dCloseRoboticsPopoversBound = true;
  window.addEventListener("render3d:close-robotics-popovers", () => {
    closeIpPopover();
    closeCloudPopover();
  });
}

export function openRoboticsIpPopover({
  kind = "control",
  anchor = null,
  getUser,
  getProjectId,
  onSave,
  onConnect,
  apiFn,
  onEnableCameras,
} = {}) {
  closeCloudPopover();
  closeIpPopover();
  const user = (() => {
    try { return getUser?.() || null; } catch { return null; }
  })();
  const pid = (() => {
    try { return String(getProjectId?.() || "").trim(); } catch { return ""; }
  })();
  const viser = readViserPrefs(user, pid);
  const cams = readHandCamPrefs(user);
  const teleop = readTeleopPrefs(user, pid);
  const pop = document.createElement("div");
  pop.className = "robotics-ip-popover robotics-ip-popover--modal";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Robot config");
  const controlVal = displayViserUrl(viser) || VISER_DEFAULT_URL;
  const camVal = displayCameraHost(cams, user) || resolveHandCamHost(user);
  const teleopVal = displayTeleopUrl(teleop) || TELEOP_DEFAULT_URL;
  const dimosVal = formatDimosHostInput(resolveDimosWsUrl());
  pop.innerHTML = `
      <div class="robotics-ip-popover-head">
        <strong>Robot config</strong>
        <span>Viser, DIMOS, cameras, teleop</span>
        <button type="button" class="object-iteration-close" data-ip-close aria-label="Close">✕</button>
      </div>
      <label class="robotics-ip-field">Viser
        <input data-ip-control class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(controlVal)}" placeholder="${escapeHtml(VISER_DEFAULT_URL)}" />
      </label>
      <p class="muted small" data-ip-ws>Websocket ${escapeHtml(viserWsUrl(controlVal) || "ws://127.0.0.1:8095")}</p>
      <label class="robotics-ip-field">DIMOS
        <input data-ip-dimos class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(dimosVal)}" placeholder="192.168.1.77:8443" />
      </label>
      <label class="robotics-ip-field">Cameras
        <input data-ip-camera class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(camVal)}" placeholder="192.168.1.83" />
      </label>
      <label class="robotics-ip-field">Teleop
        <input data-ip-teleop class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(teleopVal)}" placeholder="${escapeHtml(TELEOP_DEFAULT_URL)}" />
      </label>
      <p class="muted small">Click Teleop to edit the HTTPS LAN URL (same as Network). Saves as you type.</p>
      <pre class="robotics-mac-cam-cmds" data-mac-usb-cmds>${escapeHtml(MAC_USB_CAM_COMMANDS)}</pre>
      ${cameraLabelControlsHtml(user)}
      <div class="robotics-ip-modes" role="group" aria-label="Camera window mode">
        <button type="button" class="btn secondary btn-compact is-on" data-ip-mode="wrist">Wrist cams</button>
      </div>
      <p class="muted small">LAN only. Pi IP on a laptop — not 127.0.0.1. Saves as you type.</p>
      <div class="robotics-ip-actions">
        <button type="button" class="btn accent" data-ip-connect>Connect</button>
      </div>`;
  ipPopover = pop;
  mountCenteredDialog(pop);
  void anchor;
  pop.querySelector("[data-ip-close]")?.addEventListener("click", closeIpPopover);
  const controlInput = pop.querySelector("[data-ip-control]");
  const camInput = pop.querySelector("[data-ip-camera]");
  const teleopInput = pop.querySelector("[data-ip-teleop]");
  const dimosInput = pop.querySelector("[data-ip-dimos]");
  controlInput?.addEventListener("input", () => {
    const hint = pop.querySelector("[data-ip-ws]");
    if (hint) hint.textContent = `Websocket ${viserWsUrl(controlInput.value) || "—"}`;
  });
  teleopInput?.addEventListener("input", () => {
    persistTeleopDraft(teleopInput.value || "", user, pid);
  });
  dimosInput?.addEventListener("change", () => {
    persistDimosWsUrl(dimosInput.value || "");
  });
  pop.querySelectorAll("[data-ip-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      persistHandCamMode(btn.getAttribute("data-ip-mode"), user);
      pop.querySelectorAll("[data-ip-mode]").forEach((b) => {
        b.classList.toggle("is-on", b.getAttribute("data-ip-mode") === btn.getAttribute("data-ip-mode"));
      });
    });
  });
  pop.querySelector("[data-ip-vr-scene]")?.addEventListener("click", (e) => {
    const next = persistHandCamVrScene(!readHandCamPrefs(user).vrScene, user);
    e.currentTarget.classList.toggle("is-on", !!next.vrScene);
  });
  pop.querySelector("[data-ip-connect]")?.addEventListener("click", () => {
    persistHandCamHost(camInput?.value || "", user);
    addTeleopUrl(teleopInput?.value || "", user, pid);
    persistDimosWsUrl(dimosInput?.value || teleopInput?.value || "");
    const next = addViserUrl(controlInput?.value || "", user, pid);
    onSave?.({ kind: "control", ...next });
    onConnect?.(next.active);
    void activateWristCameras({
      user,
      host: camInput?.value || "",
      apiFn,
      onShow: onEnableCameras,
    });
    closeIpPopover();
  });
  bindCameraLabelControls(pop, { user, apiFn });
  const focusSel = kind === "camera" ? "[data-ip-camera]" : kind === "teleop" ? "[data-ip-teleop]" : kind === "dimos" ? "[data-ip-dimos]" : "[data-ip-control]";
  const focusEl = pop.querySelector(focusSel);
  const focusSoon = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 0);
  focusSoon(() => focusEl?.focus?.());
  void apiFn;
  return pop;
}

export function openCloudComputePopover({ getUser, apiFn } = {}) {
  closeIpPopover();
  closeCloudPopover();
  const user = (() => {
    try { return getUser?.() || null; } catch { return null; }
  })();
  const pop = document.createElement("div");
  pop.className = "robotics-ip-popover robotics-ip-popover--modal";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Cloud compute");
  const profile = readCloudTrainingProfile();
  pop.innerHTML = `
      <div class="robotics-ip-popover-head">
        <strong>Cloud robotics</strong>
        <span>DGX Cloud · LeRobot · simulators</span>
        <button type="button" class="object-iteration-close" data-ip-close aria-label="Close">✕</button>
      </div>
      <p class="muted small">Configure a DGX Cloud Lepton workspace and export a training package. Tokens stay in NVIDIA's workspace or CLI and are never saved in this browser.</p>
      <label class="robotics-ip-field">Workspace ID
        <input data-cloud-workspace-id class="profile-pretty-input" value="${escapeHtml(profile.workspaceId)}" placeholder="Your DGX Cloud Lepton workspace ID" />
      </label>
      <label class="robotics-ip-field">Workspace URL
        <input data-cloud-workspace-url class="profile-pretty-input" value="${escapeHtml(profile.workspaceUrl)}" placeholder="https://your-workspace..." />
      </label>
      <label class="robotics-ip-field">Output policy repository
        <input data-cloud-output-repo class="profile-pretty-input" value="${escapeHtml(profile.outputRepo)}" placeholder="your-hf-user/openarm-folding-act" />
      </label>
      <label class="robotics-ip-field">Policy name
        <input data-cloud-policy-name class="profile-pretty-input" value="${escapeHtml(profile.policyName)}" placeholder="openarm-folding-act" />
      </label>
      <label class="robotics-ip-field">LeRobot dataset repository
        <input data-cloud-dataset-repo class="profile-pretty-input" value="${escapeHtml(profile.datasetRepo)}" placeholder="your-hf-user/openarm-recordings" />
      </label>
      <label class="robotics-ip-field">Task description
        <input data-cloud-task class="profile-pretty-input" value="${escapeHtml(profile.taskDescription)}" placeholder="fold the shirt" />
      </label>
      <label class="robotics-ip-field">Training steps
        <input data-cloud-train-steps class="profile-pretty-input" type="number" min="100" step="100" value="${profile.trainSteps}" />
      </label>
      <label class="robotics-ip-field">Checkpoint frequency
        <input data-cloud-save-freq class="profile-pretty-input" type="number" min="100" step="100" value="${profile.saveFreq}" />
      </label>
      <label class="robotics-ip-field">GPU
        <select data-cloud-gpu class="profile-pretty-input">
          ${["gpu.a10", "gpu.a100-40gb", "gpu.a100-80gb", "gpu.h100-sxm"].map((id) => `<option value="${id}"${profile.gpuType === id ? " selected" : ""}>${id}</option>`).join("")}
        </select>
      </label>
      <label class="robotics-ip-field">Simulator
        <select data-cloud-simulator class="profile-pretty-input">
          <option value="mujoco"${profile.simulator === "mujoco" ? " selected" : ""}>MuJoCo</option>
          <option value="isaac"${profile.simulator === "isaac" ? " selected" : ""}>Isaac Sim WebRTC</option>
        </select>
      </label>
      <label class="robotics-ip-field" data-cloud-isaac-field>Isaac web viewer URL
        <input data-cloud-isaac-url class="profile-pretty-input" value="${escapeHtml(profile.isaacViewerUrl)}" placeholder="https://secured-isaac-viewer.example/" />
      </label>
      <p class="muted small"><strong>Folding recipe:</strong> lerobot/high_quality_folding · ACT · CUDA. The source is OpenArms follower data. It requires joint mapping and a cloth simulation scene before it can be evaluated on OpenArm 2.0.</p>
      <p class="muted small" data-cloud-status></p>
      <div class="robotics-ip-actions">
        <button type="button" class="btn accent" data-cloud-save>Save setup</button>
        <button type="button" class="btn secondary" data-cloud-login>Open DGX login</button>
        <button type="button" class="btn secondary" data-cloud-dataset>Open dataset on Hugging Face</button>
        <button type="button" class="btn secondary" data-cloud-copy>Copy training package</button>
        <button type="button" class="btn secondary" data-cloud-open-sim>Open simulator</button>
      </div>`;
  cloudPopover = pop;
  mountCenteredDialog(pop);
  pop.querySelector("[data-ip-close]")?.addEventListener("click", closeCloudPopover);
  const status = pop.querySelector("[data-cloud-status]");
  const setStatus = (text) => { if (status) status.textContent = text || ""; };
  const formProfile = () => saveCloudTrainingProfile({
    workspaceId: pop.querySelector("[data-cloud-workspace-id]")?.value,
    workspaceUrl: pop.querySelector("[data-cloud-workspace-url]")?.value,
    outputRepo: pop.querySelector("[data-cloud-output-repo]")?.value,
    policyName: pop.querySelector("[data-cloud-policy-name]")?.value,
    datasetRepo: pop.querySelector("[data-cloud-dataset-repo]")?.value,
    taskDescription: pop.querySelector("[data-cloud-task]")?.value,
    trainSteps: pop.querySelector("[data-cloud-train-steps]")?.value,
    saveFreq: pop.querySelector("[data-cloud-save-freq]")?.value,
    gpuType: pop.querySelector("[data-cloud-gpu]")?.value,
    simulator: pop.querySelector("[data-cloud-simulator]")?.value,
    isaacViewerUrl: pop.querySelector("[data-cloud-isaac-url]")?.value,
  });
  const syncIsaac = () => {
    const field = pop.querySelector("[data-cloud-isaac-field]");
    if (field) field.hidden = pop.querySelector("[data-cloud-simulator]")?.value !== "isaac";
  };
  pop.querySelector("[data-cloud-simulator]")?.addEventListener("change", syncIsaac);
  syncIsaac();
  pop.querySelector("[data-cloud-save]")?.addEventListener("click", () => {
    const next = formProfile();
    setStatus(next.workspaceId ? "DGX workspace profile saved. Authenticate with NVIDIA before submitting a paid job." : "Setup saved. Add the DGX workspace ID before job submission.");
  });
  pop.querySelector("[data-cloud-login]")?.addEventListener("click", () => {
    formProfile();
    globalThis.open?.(DGX_CLOUD_CONSOLE_URL, "_blank", "noopener,noreferrer");
    setStatus(`Create an API or service-account token in DGX Cloud, then authenticate this host with lep login. Setup: ${DGX_CLOUD_DOCS_URL}`);
  });
  pop.querySelector("[data-cloud-dataset]")?.addEventListener("click", () => {
    const next = formProfile();
    globalThis.open?.(huggingFaceDatasetUrl(next), "_blank", "noopener,noreferrer");
    setStatus("Dataset page opened. Use Hugging Face authentication to create or upload the LeRobot dataset; Studio does not transmit recordings without that explicit upload.");
  });
  pop.querySelector("[data-cloud-copy]")?.addEventListener("click", async () => {
    const next = formProfile();
    const text = `${JSON.stringify(cloudTrainingManifest(next), null, 2)}\n\n${lerobotTrainingCommand(next)}`;
    try { await globalThis.navigator?.clipboard?.writeText?.(text); setStatus("Training manifest and LeRobot command copied."); }
    catch { setStatus(text); }
  });
  pop.querySelector("[data-cloud-open-sim]")?.addEventListener("click", () => {
    const next = formProfile();
    if (next.simulator === "mujoco") {
      globalThis.__openRoboticsSimulation?.();
      closeCloudPopover();
      return;
    }
    if (!next.isaacViewerUrl) return setStatus("Add the secured Isaac Sim WebRTC viewer URL first.");
    globalThis.open?.(next.isaacViewerUrl, "_blank", "noopener,noreferrer");
    setStatus("Isaac Sim web viewer opened in a browser tab.");
  });
  return pop;
}

export function roboticsIpPopoverIsOpen() {
  return !!ipPopover;
}

export function closeRoboticsIpPopover() {
  closeIpPopover();
  closeCloudPopover();
}

export function openViserCamerasPopup({
  getUser,
  getProjectId,
  onEnableCameras,
  fetchFn,
  apiFn,
} = {}) {
  closeCloudPopover();
  closeIpPopover();
  const user = (() => { try { return getUser?.() || null; } catch { return null; } })();
  const pid = (() => { try { return String(getProjectId?.() || "").trim(); } catch { return ""; } })();
  const cams = readHandCamPrefs(user);
  const teleop = readTeleopPrefs(user, pid);
  const host = displayCameraHost(cams, user) || resolveHandCamHost(user) || SAM_CAMERA_HOST_DEFAULT;
  const pop = document.createElement("div");
  pop.className = "robotics-ip-popover robotics-ip-popover--modal robotics-cameras-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Cameras");
  pop.innerHTML = `
      <div class="robotics-ip-popover-head">
        <strong>Cameras</strong>
        <span>Left / Right status · Cam IP · Teleop</span>
        <button type="button" class="object-iteration-close" data-ip-close aria-label="Close">✕</button>
      </div>
      <div class="viser-cam-status-row" data-viser-cam-status>
        <span data-cam-status-left>Left: …</span>
        <span data-cam-status-right>Right: …</span>
      </div>
      <label class="robotics-ip-field">Cam IP
        <input data-ip-camera class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(host)}" placeholder="192.168.1.83" />
      </label>
      <label class="robotics-ip-field">Teleop
        <input data-ip-teleop class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" value="${escapeHtml(displayTeleopUrl(teleop) || TELEOP_DEFAULT_URL)}" placeholder="${escapeHtml(TELEOP_DEFAULT_URL)}" />
      </label>
      <pre class="robotics-mac-cam-cmds" data-mac-usb-cmds>${escapeHtml(MAC_USB_CAM_COMMANDS)}</pre>
      ${cameraLabelControlsHtml(user)}
      <div class="robotics-ip-actions">
        <button type="button" class="btn accent" data-enable-cameras>Cam</button>
      </div>`;
  ipPopover = pop;
  mountCenteredDialog(pop);
  pop.querySelector("[data-ip-close]")?.addEventListener("click", closeIpPopover);
  const camInput = pop.querySelector("[data-ip-camera]");
  const teleopInput = pop.querySelector("[data-ip-teleop]");
  camInput?.addEventListener("input", () => persistHandCamDraft(camInput.value || "", user));
  teleopInput?.addEventListener("input", () => persistTeleopDraft(teleopInput.value || "", user, pid));
  const startCams = () => {
    const camHost = camInput?.value || host || SAM_CAMERA_HOST_DEFAULT;
    persistHandCamHost(camHost, user);
    if (teleopInput?.value) persistTeleopDraft(teleopInput.value, user, pid);
    return activateWristCameras({
      user,
      host: camHost,
      fetchFn,
      apiFn,
      onShow: onEnableCameras,
    });
  };
  pop.querySelector("[data-enable-cameras]")?.addEventListener("click", () => {
    void startCams();
    closeIpPopover();
  });
  bindCameraLabelControls(pop, { user, fetchFn, apiFn });
  void startCams();
  void (async () => {
    const doFetch = fetchFn || globalThis.fetch?.bind(globalThis);
    const set = async (side, sel) => {
      const el = pop.querySelector(sel);
      if (!el) return;
      const url = handCamJpegUrl(side, camInput?.value || host);
      try {
        const res = await doFetch?.(url, { cache: "no-store" });
        el.textContent = `${side === "right" ? "Right" : "Left"}: ${res?.ok ? "connected" : "no stream"}`;
      } catch {
        el.textContent = `${side === "right" ? "Right" : "Left"}: no stream`;
      }
    };
    await set("left", "[data-cam-status-left]");
    await set("right", "[data-cam-status-right]");
  })();
  return pop;
}

export function openCamDebugPopup({
  getUser,
  fetchFn,
  apiFn,
} = {}) {
  closeCloudPopover();
  closeIpPopover();
  const user = (() => { try { return getUser?.() || null; } catch { return null; } })();
  const pop = document.createElement("div");
  pop.className = "robotics-ip-popover robotics-ip-popover--modal robotics-cam-debug-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Camera debug");
  pop.innerHTML = `
      <div class="robotics-ip-popover-head">
        <strong>Cam debug</strong>
        <span>All devices · assign Left / Right / Robot POV · rename</span>
        <button type="button" class="object-iteration-close" data-ip-close aria-label="Close">✕</button>
      </div>
      ${cameraLabelControlsHtml(user)}`;
  ipPopover = pop;
  mountCenteredDialog(pop);
  pop.querySelector("[data-ip-close]")?.addEventListener("click", closeIpPopover);
  bindCameraLabelControls(pop, { user, fetchFn, apiFn });
  return pop;
}

/** Poll Viser joint sliders and post openarm-viser-joints to Studio (train1). Same-origin proxy only. */
export function injectViserJointStreamer(iframe) {
  try {
    const doc = iframe?.contentDocument;
    if (!doc || doc.getElementById(VISER_JOINT_STREAM_ID)) return;
    const script = doc.createElement("script");
    script.id = VISER_JOINT_STREAM_ID;
    script.textContent = `(function(){
      const names=[];
      for(let i=1;i<=7;i++){names.push('openarm_left_joint'+i,'openarm_right_joint'+i);}
      function readQpos(){
        const qpos={};
        for(const el of document.querySelectorAll('input[type=range],input[type=number]')){
          const label=(el.closest('div')?.textContent||el.getAttribute('aria-label')||el.name||el.id||'');
          for(const n of names){
            if(label.includes(n)||el.name===n||el.id===n) qpos[n]=Number(el.value)||0;
          }
        }
        return qpos;
      }
      setInterval(()=>{
        const qpos=readQpos();
        if(Object.keys(qpos).length) parent.postMessage({type:'openarm-viser-joints',token:'train1',qpos},'*');
      },100);
    })();`;
    (doc.head || doc.documentElement)?.appendChild?.(script);
  } catch {
    /* cross-origin */
  }
}

/** Hide Viser's right GUI via CSS class. Never inject the dead iframe chevron. */
export function injectViserFrameHelpers(iframe, { collapsed = false } = {}) {
  try {
    const doc = iframe?.contentDocument;
    if (!doc) return;
    injectViserJointStreamer(iframe);
    doc.getElementById("studio-viser-settings-x")?.remove();
    doc.getElementById("studio-viser-controls")?.remove();
    doc.getElementById("studio-viser-settings-style")?.remove();
    doc.getElementById(VISER_GUI_ARROW_ID)?.remove();
    doc.querySelectorAll?.(VISER_GUI_ARROW_SEL)?.forEach?.((el) => el.remove?.());
    doc.documentElement?.classList?.remove?.("studio-viser-settings-hidden");

    let style = doc.getElementById(VISER_GUI_STYLE_ID);
    if (!style && doc.createElement) {
      style = doc.createElement("style");
      style.id = VISER_GUI_STYLE_ID;
      (doc.head || doc.documentElement)?.appendChild?.(style);
    }
    if (style && style.textContent != null) style.textContent = VISER_GUI_HIDE_CSS;

    applyViserGuiCollapsed(doc, collapsed);
  } catch {
    /* cross-origin — parent Studio overlay still works */
  }
}

export function createViserViewer({
  viewerEl,
  docTabs,
  getUser,
  getProjectId,
  apiFn,
  onStatus,
  onLayout,
  onActivateCameras,
  onEnableCameras,
  readRecordingFile,
} = {}) {
  function currentUser() {
    try { return getUser?.() || null; } catch { return null; }
  }

  function projectId() {
    try { return String(getProjectId?.() || "").trim(); } catch { return ""; }
  }

  function mainCol() {
    return document.querySelector(".main-column");
  }

  function frame() {
    return viewerEl?.querySelector("[data-viser-frame]") || null;
  }

  async function defaultRecordingReader(path) {
    const response = await globalThis.fetch?.(`/mcp/sandbox/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
    if (!response?.ok) throw new Error(`Unable to read recording data (${response?.status || "offline"}).`);
    const data = await response.json();
    if (data?.ok === false || typeof data?.text !== "string") throw new Error(data?.error || "Invalid recording file response.");
    return data.text;
  }

  function recordingControls() {
    return viewerEl?.querySelector?.("[data-viser-recording-controls]") || null;
  }

  function ensureRecordingControls() {
    const existing = recordingControls();
    if (existing) return existing;
    const toolbar = viewerEl?.querySelector?.(".viser-toolbar");
    if (!toolbar || !document?.createElement) return null;
    const host = document.createElement("div");
    host.dataset.viserRecordingControls = "1";
    host.setAttribute("data-viser-recording-controls", "");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", "Saved recording visualization");
    Object.assign(host.style, { display: "flex", alignItems: "center", gap: "6px", minWidth: "0" });
    const select = document.createElement("select");
    select.setAttribute("data-viser-recording-select", "");
    select.setAttribute("aria-label", "Saved recording");
    Object.assign(select.style, { maxWidth: "220px", minWidth: "120px" });
    const load = document.createElement("button");
    load.type = "button";
    load.className = "dxf-viewer-btn";
    load.setAttribute("data-viser-recording-load", "");
    load.textContent = "Load recording";
    const status = document.createElement("span");
    status.setAttribute("data-viser-recording-status", "");
    status.setAttribute("role", "status");
    status.className = "muted small";
    status.hidden = true;
    host.append(select, load, status);
    toolbar.append(host);
    select.addEventListener("change", () => {
      try {
        selectViserRecording(projectId(), select.value);
        syncRecordingControls();
      } catch (error) {
        showRecordingStatus(error?.message || "Unable to select that recording.", true);
      }
    });
    load.addEventListener("click", () => { void loadSelectedRecording(); });
    return host;
  }

  function showRecordingStatus(message, isError = false) {
    const el = ensureRecordingControls()?.querySelector?.("[data-viser-recording-status]");
    if (!el) return;
    el.hidden = !message;
    el.textContent = String(message || "");
    el.style.color = isError ? "#ff9d9d" : "";
  }

  function syncRecordingControls() {
    const host = ensureRecordingControls();
    const select = host?.querySelector?.("[data-viser-recording-select]");
    const load = host?.querySelector?.("[data-viser-recording-load]");
    if (!select || !load) return null;
    const library = readViserRecordingLibrary(projectId());
    select.replaceChildren?.();
    if (!library.recordings.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved recordings";
      select.append(option);
      select.disabled = true;
      load.disabled = true;
      load.title = "Choose an episode manifest in Robots · Recordings first.";
      return library;
    }
    for (const recording of library.recordings) {
      const option = document.createElement("option");
      option.value = recording.id;
      option.textContent = viserRecordingLabel(recording);
      option.selected = recording.id === library.active_id;
      select.append(option);
    }
    select.disabled = false;
    load.disabled = false;
    load.title = "Load this recording for simulation or telemetry visualization. This never replays hardware actions.";
    return library;
  }

  async function loadSelectedRecording(recording = activeViserRecording(projectId())) {
    if (!recording) {
      showRecordingStatus("Select an episode manifest in Robots · Recordings first.", true);
      return null;
    }
    showRecordingStatus("Loading recording data…");
    try {
      const payload = await loadViserRecording(recording, readRecordingFile || defaultRecordingReader);
      const iframe = frame();
      deliverViserRecording(payload, { frameWindow: iframe?.contentWindow, eventTarget: globalThis });
      const partial = payload.truncated ? ` First ${payload.samples.length} of ${payload.total_sample_count} samples loaded.` : ` ${payload.samples.length} samples loaded.`;
      showRecordingStatus(`${payload.visualization_kind === "simulation" ? "Simulation" : "Telemetry"} visualization.${partial} No hardware commands were sent.`);
      onStatus?.("ok", `Viser recording · ${recording.episode_id} · visualization only`);
      return payload;
    } catch (error) {
      showRecordingStatus(error?.message || "Unable to load recording data.", true);
      onStatus?.("error", error?.message || "Unable to load recording data.");
      return null;
    }
  }

  function urlInputs() {
    return [...(document.querySelectorAll?.(VISER_URL_FIELD_SEL) || [])];
  }

  function camInputs() {
    return [...(document.querySelectorAll?.(CAM_IP_FIELD_SEL) || [])];
  }

  function input() {
    const focused = urlInputs().find((el) => el === document.activeElement);
    return focused || urlInputs()[0] || null;
  }

  function listEl() {
    return viewerEl?.querySelector("[data-viser-list]") || null;
  }

  function emptyEl() {
    return viewerEl?.querySelector("[data-viser-empty]") || null;
  }

  function setEmpty(message) {
    const el = emptyEl();
    const msg = el?.querySelector("[data-viser-empty-msg]");
    const show = !!message;
    if (msg && message) msg.textContent = message;
    el?.classList.toggle("hidden", !show);
    if (el) {
      el.hidden = !show;
      el.setAttribute("aria-hidden", show ? "false" : "true");
    }
    viewerEl?.classList.toggle("viser-has-empty", show);
  }

  function setCloudMenu(_open) {
    void _open;
  }

  function syncSceneBox(next) {
    const el = viewerEl;
    const col = mainCol();
    const w = next.sceneBox?.w || 0;
    const h = next.sceneBox?.h || 0;
    const resized = w > 0 || h > 0;
    el?.classList.toggle("viser-scene-resized", resized);
    col?.classList.toggle("viser-scene-resized", resized && next.layout === "split");
    const wVal = w > 0 ? `${w}px` : "100%";
    const hVal = h > 0 ? `${h}px` : "100%";
    el?.style.setProperty("--viser-scene-w", wVal);
    el?.style.setProperty("--viser-scene-h", hVal);
    col?.style.setProperty("--viser-scene-w", w > 0 ? `${w}px` : "minmax(0, 1fr)");
  }

  function syncGuiChrome(hidden) {
    const on = !!hidden;
    viewerEl?.classList.toggle("viser-gui-collapsed", on);
    viewerEl?.classList.toggle("viser-viewport-fs", on);
    viewerEl?.querySelectorAll?.(VISER_GUI_ARROW_SEL)?.forEach?.((btn) => syncViserGuiArrow(btn, on));
    syncViserFsButtons(viewerEl, on);
    injectViserFrameHelpers(frame(), { collapsed: on });
  }

  function applyGui(hidden) {
    const next = persistViserPrefs({ guiHidden: !!hidden }, currentUser(), projectId());
    syncGuiChrome(next.guiHidden);
    return next;
  }

  function toggleGui(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const prefs = readViserPrefs(currentUser(), projectId());
    return applyGui(!prefs.guiHidden);
  }

  function syncRailChrome(next) {
    viewerEl?.classList.add("viser-rail-collapsed");
    viewerEl?.classList.remove("viser-chrome-collapsed");
    syncGuiChrome(next?.guiHidden);
    const panel = viewerEl?.querySelector("[data-viser-rail-panel]");
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
    }
    const tab = viewerEl?.querySelector("[data-viser-side-tab]");
    if (tab) {
      tab.hidden = true;
      tab.setAttribute("aria-hidden", "true");
    }
    syncSceneBox(next);
  }

  function applyRail(open) {
    if (open) {
      openNetworkPopup();
      return readViserPrefs(currentUser(), projectId());
    }
    const next = persistViserPrefs({ railOpen: false }, currentUser(), projectId());
    syncRailChrome(next);
    return next;
  }

  function applyChrome(open) {
    const next = persistViserPrefs({ chromeOpen: !!open }, currentUser(), projectId());
    syncRailChrome(next);
    return next;
  }

  function applySceneBox(box) {
    const next = persistViserPrefs({ sceneBox: clampSceneBox(box) }, currentUser(), projectId());
    syncSceneBox(next);
    try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
    return next;
  }

  function applyLayout(layout) {
    const next = persistViserPrefs({ layout: normalizeViserLayout(layout) }, currentUser(), projectId());
    const col = mainCol();
    col?.classList.toggle("viser-layout-split", next.layout === "split");
    col?.classList.toggle("viser-layout-viser", next.layout === "viser");
    col?.classList.toggle("viser-layout-cad", next.layout === "cad");
    if (col) col.dataset.viserLayout = next.layout;
    viewerEl?.classList.toggle("hidden", next.layout === "cad");
    viewerEl?.setAttribute("aria-hidden", next.layout === "cad" ? "true" : "false");
    syncRailChrome(next);
    viewerEl?.querySelectorAll("[data-viser-layout]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-viser-layout") === next.layout);
      btn.setAttribute("aria-pressed", btn.getAttribute("data-viser-layout") === next.layout ? "true" : "false");
    });
    docTabs?.render?.();
    syncViserStudioTools(document, next.layout);
    onLayout?.(next);
    try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ }
    return next;
  }

  function syncList() {
    const prefs = readViserPrefs(currentUser(), projectId());
    const cams = readHandCamPrefs(currentUser());
    const el = listEl();
    if (el) {
      el.innerHTML = prefs.urls.length
        ? prefs.urls.map((url) => `<button type="button" class="viser-host-chip${url === prefs.active ? " is-active" : ""}" data-viser-pick="${escapeHtml(url)}">${escapeHtml(url)}</button>`).join("")
        : `<span class="muted small">Add a localhost or LAN Viser URL (127.0.0.1 / 192.168 / 10 / 172.16).</span>`;
    }
    urlInputs().forEach((field) => {
      if (field && document.activeElement !== field) field.value = displayViserUrl(prefs);
    });
    camInputs().forEach((field) => {
      if (field && document.activeElement !== field) field.value = displayCameraHost(cams, currentUser());
    });
    const ws = viewerEl?.querySelector("[data-viser-ws]");
    if (ws) ws.textContent = viserWsUrl(prefs.active) || "ws://127.0.0.1:8095";
    const camHint = viewerEl?.querySelector("[data-viser-cam-host]");
    if (camHint) camHint.textContent = displayCameraHost(cams, currentUser()) || "camera IP";
    syncRecordingControls();
    return prefs;
  }

  function revealPanel() {
    const prefs = readViserPrefs(currentUser(), projectId());
    const layout = layoutForViserTab(prefs);
    docTabs?.upsert({ id: VISER_TAB_ID, label: "Viser", kind: "viser" });
    docTabs?.setActive(VISER_TAB_ID);
    applyLayout(layout);
    viewerEl?.classList.remove("hidden");
    viewerEl?.setAttribute("aria-hidden", "false");
    syncList();
    syncViserStudioTools(document, layout);
    return prefs;
  }

  let connectLock = false;

  async function connect(raw) {
    if (connectLock) return null;
    connectLock = true;
    try {
    return await connectNow(raw);
    } finally {
      connectLock = false;
    }
  }

  async function connectNow(raw) {
    const user = currentUser();
    const pid = projectId();
    revealPanel();
    const typed = raw || input()?.value || readViserPrefs(user, pid).active || VISER_DEFAULT_URL;
    const publicUrl = publicWebsiteUrl(typed);
    if (publicUrl && !normalizeViserUrl(typed)) {
      revealPanel();
      const iframe = frame();
      if (iframe) {
        iframe.src = publicUrl;
        bindFrameHelpers(iframe);
      }
      setEmpty("");
      syncList();
      onStatus?.("ok", `Viser · ${publicUrl}`);
      return { url: publicUrl, iframeSrc: publicUrl };
    }
    const added = addViserUrl(typed, user, pid);
    const url = added.active || normalizeViserUrl(typed);
    if (!url) {
      const msg = "Viser URL must be a private LAN host (192.168 / 10 / 172.16) or localhost.";
      setEmpty(msg);
      onStatus?.("error", msg);
      return null;
    }
    setEmpty(`Connecting to ${url}…`);
    let iframeSrc = viserIframeSrc(url);
    let reachable = true;
    let errorText = "";
    const needProxy = String(globalThis.location?.protocol || "") === "https:";
    if (apiFn && needProxy) {
      try {
        const data = await apiFn("/api/viser/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (data?.iframe) iframeSrc = String(data.iframe);
        if (data?.ok === false) {
          errorText = data?.error || viserUnreachableMessage(url);
          reachable = shouldLoadViserIframe(data);
        }
      } catch (err) {
        errorText = err?.message || viserUnreachableMessage(url);
        if (!/can't reach viser|cloud studio cannot reach|private lan/i.test(errorText)) {
          errorText = viserUnreachableMessage(url);
        }
        reachable = shouldLoadViserIframe({ error: errorText, detail: err?.detail });
        if (err?.status === 403 || err?.status === 400) reachable = false;
      }
    }
    const iframe = frame();
    if (!reachable) {
      if (iframe) iframe.src = "about:blank";
      setEmpty(errorText || viserUnreachableMessage(url));
      syncList();
      persistRemote();
      onStatus?.("error", errorText || viserUnreachableMessage(url));
      return null;
    }
    if (iframe) {
      iframe.src = iframeSrc;
      bindFrameHelpers(iframe);
    }
    setEmpty("");
    syncList();
    persistRemote();
    onStatus?.("ok", `Viser · ${url} · ${viserWsUrl(url)}`);
    return { url, iframeSrc };
  }

  function hideViewerOnly() {
    viewerEl?.classList.add("hidden");
    viewerEl?.setAttribute("aria-hidden", "true");
    const col = mainCol();
    col?.classList.remove("viser-layout-split", "viser-layout-viser");
    col?.classList.add("viser-layout-cad");
  }

  function closeTab() {
    const iframe = frame();
    if (iframe) iframe.src = "about:blank";
    const col = mainCol();
    col?.classList.remove("viser-layout-split", "viser-layout-viser", "viser-layout-cad");
    if (col?.dataset) delete col.dataset.viserLayout;
    viewerEl?.classList.add("hidden");
    viewerEl?.setAttribute("aria-hidden", "true");
    setEmpty("");
    docTabs?.remove(VISER_TAB_ID);
  }

  function bindFrameHelpers(iframe) {
    if (!iframe) return;
    const inject = () => {
      injectViserFrameHelpers(iframe, { collapsed: readViserPrefs(currentUser(), projectId()).guiHidden });
      try {
        const doc = iframe.contentDocument;
        const text = String(doc?.body?.textContent || "");
        if (/can't reach viser|open viser from robotics first|cloud studio cannot reach/i.test(text)) {
          setEmpty(viserUnreachableMessage(readViserPrefs(currentUser(), projectId()).active));
        }
      } catch { /* cross-origin */ }
      syncViserStudioTools();
    };
    inject();
    if (iframe.dataset.studioViserLoadBound) return;
    iframe.dataset.studioViserLoadBound = "1";
    iframe.addEventListener("load", inject);
  }

  function activateFromShared() {
    const prefs = revealPanel();
    bindFrameHelpers(frame());
    const iframe = frame();
    if (iframe && (!iframe.src || iframe.src === "about:blank" || iframe.src.endsWith("about:blank")) && prefs.active) {
      void connect(prefs.active);
    }
  }

  function persistRemote() {
    if (!apiFn) return;
    const viser = readViserPrefs(currentUser(), projectId());
    const cams = readHandCamPrefs(currentUser());
    void apiFn("/api/users/me/robotics-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viserUrls: viser.urls,
        viserActive: viser.active,
        cameraHost: cams.cameraHost,
        camMode: cams.camMode,
        cameraLabels: cams.cameraLabels,
        cameraTitles: cams.cameraTitles,
        cameraPermissionGranted: cams.cameraPermissionGranted,
        teleopUrls: readTeleopPrefs(currentUser(), projectId()).urls,
        teleopActive: readTeleopPrefs(currentUser(), projectId()).active,
      }),
    }).catch(() => {});
  }

  function openNetworkPopup(anchor, kind = "control") {
    return openRoboticsIpPopover({
      kind,
      anchor,
      getUser: currentUser,
      getProjectId: projectId,
      apiFn,
      onSave: () => {
        syncList();
        persistRemote();
      },
      onConnect: (url) => { void connect(url); },
    });
  }

  function openControlPopup(anchor) {
    return openNetworkPopup(anchor, "control");
  }

  function openServerPanel() {
    return openNetworkPopup();
  }

  function openCameraPopup(anchor) {
    return openNetworkPopup(anchor, "camera");
  }

  function openCamerasTabPopup() {
    return openCamDebugPopup({
      getUser: currentUser,
      fetchFn: globalThis.fetch?.bind(globalThis),
      apiFn,
    });
  }

  function openCamDebugFromViewer() {
    return openCamerasTabPopup();
  }

  function enableWristCameras() {
    if (typeof onActivateCameras === "function") return onActivateCameras();
    return activateWristCameras({
      user: currentUser(),
      apiFn,
      fetchFn: globalThis.fetch?.bind(globalThis),
      onShow: onEnableCameras,
      restart: false,
    });
  }

  function openGithubRepo() {
    try {
      globalThis.open?.(VISER_GITHUB_URL, "_blank", "noopener,noreferrer");
    } catch { /* ignore */ }
  }

  function openCloudPopup() {
    return openCloudComputePopover({ getUser: currentUser, apiFn });
  }

  function closeServerPanel(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    applyRail(false);
  }

  viewerEl?.addEventListener("click", (e) => {
    const pick = e.target?.closest?.("[data-viser-pick]");
    if (pick) {
      void connect(pick.getAttribute("data-viser-pick"));
      return;
    }
    const toolBtn = e.target?.closest?.("[data-viser-tool]");
    if (toolBtn) {
      clickViserStudioTool(toolBtn.getAttribute("data-viser-tool"));
      syncViserStudioTools();
      return;
    }
    const layoutBtn = e.target?.closest?.("[data-viser-layout]");
    if (layoutBtn) {
      const want = layoutBtn.getAttribute("data-viser-layout");
      const prefs = readViserPrefs(currentUser(), projectId());
      applyLayout(nextViserLayoutFromClick(want, prefs.layout));
      return;
    }
    if (e.target?.closest?.("[data-viser-rail-close]")) {
      closeServerPanel(e);
      return;
    }
    if (e.target?.closest?.("[data-viser-cloud]")) {
      openCloudPopup();
      return;
    }
    if (e.target?.closest?.("[data-viser-github]")) {
      openGithubRepo();
      return;
    }
    if (e.target?.closest?.("[data-viser-network], [data-viser-network-icon], [data-viser-server], [data-viser-add]")) {
      openNetworkPopup(e.target.closest("button"));
      return;
    }
    if (e.target?.closest?.("[data-viser-ip]")) {
      openControlPopup(e.target.closest("[data-viser-ip]"));
      return;
    }
    if (e.target?.closest?.(VISER_FS_SEL)) {
      applyGui(true);
      return;
    }
    if (e.target?.closest?.(VISER_FS_EXIT_SEL)) {
      applyGui(false);
      return;
    }
    if (e.target?.closest?.(VISER_GUI_ARROW_SEL)) {
      toggleGui(e);
      return;
    }
    if (e.target?.closest?.("[data-viser-cam]")) {
      void enableWristCameras();
      return;
    }
    if (e.target?.closest?.("[data-viser-connect]")) {
      void connect(input()?.value || readViserPrefs(currentUser(), projectId()).active);
    }
  });

  viewerEl?.querySelector("[data-viser-rail-close]")?.addEventListener("pointerdown", closeServerPanel);

  let resizeDrag = null;
  function onResizeMove(e) {
    if (!resizeDrag || e.pointerId !== resizeDrag.id) return;
    const parent = viewerEl?.parentElement?.getBoundingClientRect?.();
    if (!parent) return;
    const kind = resizeDrag.kind;
    let w = resizeDrag.w;
    let h = resizeDrag.h;
    if (kind === "left" || kind === "corner") {
      w = Math.round(parent.right - e.clientX);
    }
    if (kind === "bottom" || kind === "corner") {
      h = Math.round(parent.bottom - e.clientY);
    }
    const box = { w, h };
    resizeDrag.box = box;
    syncSceneBox({ ...readViserPrefs(currentUser(), projectId()), sceneBox: clampSceneBox(box) });
  }
  function onResizeUp(e) {
    if (!resizeDrag || e.pointerId !== resizeDrag.id) return;
    try { resizeDrag.target.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    viewerEl?.classList.remove("is-resizing");
    if (resizeDrag.box) applySceneBox(resizeDrag.box);
    resizeDrag = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeUp);
  }
  viewerEl?.querySelectorAll("[data-viser-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = viewerEl.getBoundingClientRect();
      resizeDrag = {
        id: e.pointerId,
        kind: handle.getAttribute("data-viser-resize") || "left",
        w: rect.width,
        h: rect.height,
        target: handle,
      };
      viewerEl.classList.add("is-resizing");
      try { handle.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      window.addEventListener("pointermove", onResizeMove);
      window.addEventListener("pointerup", onResizeUp);
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (!viewerEl?.querySelector("[data-viser-cloud]")?.classList.contains("is-open")) return;
    if (e.target?.closest?.("[data-viser-cloud]")) return;
    setCloudMenu(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeIpPopover();
      closeCloudPopover();
      setCloudMenu(false);
      if (readViserPrefs(currentUser(), projectId()).guiHidden) applyGui(false);
    }
    const urlField = e.target?.closest?.("[data-viser-url], [data-viser-ribbon-url], [data-robotics-viser-url], [data-ip-control]");
    if (urlField && e.key === "Enter") {
      e.preventDefault();
      flushDraftFromTarget(urlField);
      void connect(urlField.value || "");
    }
  });

  let draftTimer = 0;
  let draftKind = "control";
  let draftRaw = "";

  function commitDraft(kind, raw) {
    if (kind === "camera") persistHandCamDraft(raw, currentUser());
    else persistViserDraft(raw, currentUser(), projectId());
    persistRemote();
    syncList();
  }

  function scheduleDraftPersist(kind, raw) {
    draftKind = kind;
    draftRaw = raw;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = 0;
      commitDraft(kind, raw);
    }, VISER_DRAFT_DEBOUNCE_MS);
  }

  function flushDraftFromTarget(target) {
    if (!target?.closest) return;
    const viserField = target.closest(VISER_URL_FIELD_SEL);
    if (viserField) {
      if (draftTimer) {
        clearTimeout(draftTimer);
        draftTimer = 0;
      }
      commitDraft("control", viserField.value);
      return;
    }
    const camField = target.closest(CAM_IP_FIELD_SEL);
    if (camField) {
      if (draftTimer) {
        clearTimeout(draftTimer);
        draftTimer = 0;
      }
      commitDraft("camera", camField.value);
    }
  }

  document.addEventListener("input", (e) => {
    const viserField = e.target?.closest?.(VISER_URL_FIELD_SEL);
    if (viserField) {
      const ws = viewerEl?.querySelector("[data-viser-ws]");
      if (ws) ws.textContent = viserWsUrl(viserField.value) || "ws://127.0.0.1:8095";
      scheduleDraftPersist("control", viserField.value);
      return;
    }
    const camField = e.target?.closest?.(CAM_IP_FIELD_SEL);
    if (camField) scheduleDraftPersist("camera", camField.value);
  });
  document.addEventListener("change", (e) => {
    flushDraftFromTarget(e.target);
  });
  window.addEventListener("pagehide", () => {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = 0;
      commitDraft(draftKind, draftRaw);
    }
  });

  window.addEventListener("message", (e) => {
    if (e?.data?.type === "studio-viser-network") openNetworkPopup();
    if (e?.data?.type === "openarm-viser-joints" && e.data?.token === "train1") {
      globalThis.dispatchEvent?.(new CustomEvent(VISER_JOINT_EVENT, { detail: { qpos: e.data.qpos || {} } }));
    }
  });
  window.addEventListener("render3d:viser-gui", (e) => {
    applyGui(!!e?.detail?.hidden);
  });
  window.addEventListener("render3d:simulation-feed", (e) => {
    const iframe = viewerEl?.querySelector("[data-viser-frame]");
    try {
      iframe?.contentWindow?.postMessage({ type: "studio-simulation-settings", settings: e?.detail || {} }, "*");
    } catch { /* ignore */ }
  });
  window.addEventListener("render3d:simulation-frame", (e) => {
    const iframe = viewerEl?.querySelector("[data-viser-frame]");
    try {
      iframe?.contentWindow?.postMessage({ type: "studio-simulation-frame", run: e?.detail || {} }, "*");
    } catch { /* ignore */ }
  });
  window.addEventListener(VISER_RECORDING_EVENT, (e) => {
    if (String(e?.detail?.descriptor?.project_id || "") !== projectId()) return;
    syncRecordingControls();
    showRecordingStatus("Recording selected. Click Load recording to visualize it.");
  });

  syncList();
  syncRailChrome(readViserPrefs(currentUser(), projectId()));

  return {
    connect,
    open: () => connect(),
    addUrl: (raw) => addViserUrl(raw, currentUser(), projectId()),
    hideViewerOnly,
    closeTab,
    activateFromShared,
    syncList,
    applyLayout,
    applyRail,
    applyChrome,
    openServerPanel,
    openControlPopup,
    openCameraPopup,
    openCamerasTabPopup,
    openCamDebugPopup: openCamDebugFromViewer,
    enableWristCameras,
    openGithubRepo,
    openCloudPopup,
    openNetworkPopup,
    loadSelectedRecording,
    syncRecordingControls,
    isOpen: () => !viewerEl?.classList.contains("hidden"),
  };
}
