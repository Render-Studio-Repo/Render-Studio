import { authHeaders, getToken } from "../studio/auth.js";
import {
  bindSharedWorkspacePicker,
  gateRemixOrShare,
  mustAuthBeforeRemixOrShare,
  readSharedWorkspacePicker,
  sharedWorkspacePickerHtml,
  sharedWorkspacesFromTeams,
} from "../studio/share-auth-gate.js?v=20260909-remix1";
import { maybeShowFusionUnlinkHowto } from "../cad/fusion-unlink-howto.js?v=20260908-img";
import {
  SLICERS,
  getPreferredSlicer,
  getPreferredSlicerId,
  hasChosenSlicer,
  setPreferredSlicerId,
  slicerExportLabel,
  slicerOpenUrls,
  canOpenRemoteSlicerUrl,
  getSlicerById,
} from "./slicer-prefs.js?v=20260805-slicer-pick&bambulocal3";
import {
  stripExportTraceId,
  listedDownloadExports,
  timeoutDownloadExports,
  missingSourceDownloadMessage,
} from "./file-download-list.js?v=20260908-editstep1-exproute1";
import { triggerTrackedBlobDownload } from "../viewport/viewport-video-editor.js?v=leakfix6";
import {
  startSlicerDeviceHandoffListener,
} from "./slicer-device-handoff.js?v=20261002-public-control-plane1&current-device-copy=1";

export {
  stripExportTraceId,
  listedDownloadExports,
  timeoutDownloadExports,
  missingSourceDownloadMessage,
};

const BAMBU_PROFILE_APPLY_KEY = "render3d:bambu-profile-apply";
const fileDownloadCreated = [];

startSlicerDeviceHandoffListener();

export function bambuProfileApplyEnabled() {
  try {
    const v = localStorage.getItem(BAMBU_PROFILE_APPLY_KEY);
    if (v === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function setBambuProfileApplyEnabled(on) {
  try { localStorage.setItem(BAMBU_PROFILE_APPLY_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

const FORMAT_LABELS = {
  glb: "GLB",
  stl: "STL",
  step: "STEP",
  "3mf": "3MF",
  obj: "OBJ",
  source: "build123d source (.py)",
  program: "Program JSON",
  sim: "sim.json",
  urdf: "URDF",
  mjcf: "MJCF",
};

const PRIMARY_FORMATS = ["glb", "stl", "step", "3mf"];
const EXPORT_ORDER = ["glb", "stl", "step", "source", "3mf", "obj", "program", "sim", "urdf", "mjcf"];

/**
 * Encode nested project files (mesh/foo.glb) without turning "/" into %2F.
 * encodeURIComponent("mesh/foo.glb") breaks /exports and /share routes.
 */
export function encodeProjectFilePath(filename) {
  return String(filename || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function projectFileApiPath(projectId, filename) {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeProjectFilePath(filename)}`;
}

let openMenu = null;
let openMenuCleanup = null;

/**
 * Optional hook from app.js:-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1-20260915-xragent3 bake Mesh procedural animation into a Blender-ready GLB.
 * @type {null | ((ctx: { filename: string, item: object }) => Promise<null | { blob: Blob, filename: string, clipCount?: number }>)}
 */
let animatedGlbBaker = null;
/** @type {null | ((ctx: { filename: string, item?: object }) => boolean)} */
let animatedGlbAvailable = null;

/**
 * Register a baker that returns an animated GLB Blob for Mesh beta models.
 * @param {typeof animatedGlbBaker} bakeFn
 * @param {typeof animatedGlbAvailable} [availableFn]
 */
export function setAnimatedGlbBaker(bakeFn, availableFn = null) {
  animatedGlbBaker = typeof bakeFn === "function" ? bakeFn : null;
  animatedGlbAvailable = typeof availableFn === "function" ? availableFn : null;
}

let exportOnshapeSourceAbort = null; // leakfix91
function beginExportOnshapeSourceFetch() {
  if (exportOnshapeSourceAbort) {
    try { exportOnshapeSourceAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  exportOnshapeSourceAbort = ctl;
  return ctl;
}

function closeExportMenu() {
  if (exportOnshapeSourceAbort) {
    try { exportOnshapeSourceAbort.abort(); } catch (_) { /* ignore */ }
  }
  openMenuCleanup?.();
  openMenuCleanup = null;
  openMenu?.remove();
  openMenu = null;
}

function fileStem(filename) {
  const base = String(filename || "").split("/").pop() || "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

function withDirSiblingExt(filename, ext) {
  const rel = String(filename || "").replace(/\\/g, "/");
  const slash = rel.lastIndexOf("/");
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : "";
  return `${dir}${modelStem(rel)}.${String(ext || "").replace(/^\./, "")}`;
}

function modelStemKey(filename) {
  return fileStem(filename)
    .toLowerCase()
    .replace(/\.part$/i, "")
    .replace(/__faceted$/i, "");
}

/** Public share viewer only renders GLB — never mint a share rooted on 3MF/STL alone. */
function preferShareFilename(filename, exports = [], dataFilename = null) {
  const candidates = [
    ...(Array.isArray(exports) ? exports.map((item) => item?.name).filter(Boolean) : []),
    dataFilename,
    filename,
  ]
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .filter((name) => !/^(visible|project)\s+assembly$/i.test(name));
  if (!candidates.length) return null;
  const targetKey = modelStemKey(filename || candidates[0]);
  const sameStem = (name) => modelStemKey(name) === targetKey;
  const byExt = (ext) =>
    candidates.find((name) => sameStem(name) && name.toLowerCase().endsWith(ext))
    || candidates.find((name) => name.toLowerCase().endsWith(ext));
  return (
    byExt(".glb")
    || byExt(".gltf")
    || byExt(".step")
    || byExt(".stp")
    || byExt(".stl")
    || candidates.find(sameStem)
    || candidates[0]
  );
}

/** Keep Export → share on the model being exported, not every eye-visible sibling. */
async function scopedShareContext(shareContext, filename) {
  let body = {};
  if (typeof shareContext === "function") {
    try {
      const ctx = await shareContext();
      if (ctx && typeof ctx === "object") body = { ...ctx };
    } catch (err) {
      console.warn("shareContext failed; sharing without viewport snapshot", err);
    }
  } else if (shareContext && typeof shareContext === "object") {
    body = { ...shareContext };
  }
  const key = modelStemKey(filename);
  if (key) {
    const visible = Array.isArray(body.visible_filenames) ? body.visible_filenames : [];
    const scoped = visible
      .map((name) => String(name || "").split("#")[0].trim())
      .filter((name) => name && modelStemKey(name) === key);
    body.visible_filenames = scoped.length ? scoped : [String(filename || "").trim()].filter(Boolean);
    // Don't re-hide unrelated scene parts into this single-model share.
    if (Array.isArray(body.hidden_filenames)) {
      body.hidden_filenames = body.hidden_filenames.filter(
        (name) => modelStemKey(name) === key,
      );
    }
  }
  return body;
}

function renderExportPlaceholders(listEl) {
  if (!listEl) return;
  listEl.innerHTML = "";
  for (const fmt of PRIMARY_FORMATS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-export-dl is-preparing";
    btn.dataset.fmt = fmt;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = `<span class="file-export-spinner" aria-hidden="true"></span>${FORMAT_LABELS[fmt] || fmt.toUpperCase()}`;
    listEl.appendChild(btn);
  }
}

function setExportActionsPreparing(menu, preparing) {
  if (!menu) return;
  const selectors = [
    ".file-export-bambu",
    ".file-export-slicer",
    ".file-export-onshape",
    ".file-export-onshape-push",
    ".file-export-fusion-action",
    ".file-export-solidworks",
  ];
  for (const sel of selectors) {
    const btn = menu.querySelector(sel);
    if (!btn) continue;
    if (preparing) {
      btn.dataset.wasDisabled = btn.disabled ? "1" : "0";
      btn.disabled = true;
      btn.classList.add("is-preparing");
    } else {
      btn.classList.remove("is-preparing");
      if (btn.dataset.wasDisabled !== "1") btn.disabled = false;
      delete btn.dataset.wasDisabled;
    }
  }
}

function modelStem(filename) {
  return fileStem(filename)
    .replace(/\.part$/i, "")
    .replace(/\.fusionpart$/i, "")
    .replace(/__faceted$/i, "");
}

function exportPriority(item, targetStem) {
  const name = String(item.name || "");
  const stem = modelStem(name);
  const target = modelStem(targetStem || "");
  if (item.format === "step") return -3; // single STEP slot — already Fusion-ready
  if (item.current || stem === target || fileStem(name) === targetStem) return 0;
  if (item.base) return 2;
  return 1;
}

function exportLabel(item, targetStem, { animatedGlb = false } = {}) {
  const name = String(item.name || "");
  let base = item.label || null;
  if (!base && item.format === "step") {
    base = "STEP";
  }
  if (!base && item.format === "glb" && animatedGlb) {
    base = "GLB · animated";
  }
  if (!base) base = FORMAT_LABELS[item.format] || item.format.toUpperCase();
  const stem = modelStem(name);
  const target = modelStem(targetStem || "");
  if (item.current || stem === target || fileStem(name) === targetStem) return `${base} · current`;
  if (item.base) return `${base} · original/base`;
  return base;
}

function collapseExportsToSingleStep(items = []) {
  const out = [];
  let bestStep = null;
  for (const item of items) {
    if (String(item?.format || "").toLowerCase() !== "step") {
      out.push(item);
      continue;
    }
    const name = String(item.name || "");
    if (/__faceted/i.test(name) || item.step_structure === "faceted" || item.step_kind === "faceted_mesh") {
      continue;
    }
    // Prefer native editable B-rep; Part flatten happens via ?step_mode=part / Fusion push.
    const score =
      (item.step_kind === "editable_brep" ? 6 : 0)
      + (/\.part\.step$/i.test(name) || /\.fusionpart\.step$/i.test(name) ? -8 : 2)
      + (item.base ? 1 : 0)
      + (item.current ? 1 : 0);
    const prevName = String(bestStep?.name || "");
    const prev = bestStep
      ? (bestStep.step_kind === "editable_brep" ? 6 : 0)
        + (/\.part\.step$/i.test(prevName) || /\.fusionpart\.step$/i.test(prevName) ? -8 : 2)
        + (bestStep.base ? 1 : 0)
        + (bestStep.current ? 1 : 0)
      : -999;
    if (!bestStep || score > prev) bestStep = item;
  }
  if (bestStep) {
    out.push({
      ...bestStep,
      label: "STEP",
      download_name: bestStep.download_name || `${modelStem(bestStep.name)}.step`,
    });
  }
  return out;
}

function stepDownloadUrl(projectId, item, mode = "assembly") {
  const name = item?.name;
  if (!name) return item?.url || "";
  const base = item.url || `${projectFileApiPath(projectId, name)}`;
  // Strip any prior step_mode, then apply the chooser selection.
  const cleaned = base.replace(/([?&])step_mode=[^&]*/i, "$1").replace(/[?&]$/, "");
  const sep = cleaned.includes("?") ? "&" : "?";
  const stepMode = mode === "regular" || mode === "part" || mode === "single" ? "part" : (mode || "assembly");
  return `${cleaned}${sep}step_mode=${encodeURIComponent(stepMode)}`;
}

function formatApiError(err) {
  const msg = stripExportTraceId(err?.message || "");
  if (msg && msg !== "Request failed") return msg;
  if (/not authenticated|401/i.test(msg)) return "Sign in again to export files.";
  if (/not found|404/i.test(msg)) return "Model or project not found.";
  if (/403|forbidden/i.test(msg)) return "You do not have access to this project.";
  return "Could not list exports.";
}

function friendlyExportError(err, fallback = "Export failed.") {
  const raw = stripExportTraceId(err?.message || fallback || "");
  if (/not authenticated|invalid or expired token|sign in|401/i.test(raw)) {
    return {
      title: "Sign in required",
      message: "Your session is missing or expired. Sign in again, then retry this export.",
      action: "Sign in",
      kind: "auth",
      detail: raw,
      retryable: false,
    };
  }
  if (/not on disk|never (wrote|generated)|was never generated/i.test(raw)) {
    return {
      title: "File not found",
      message: stripExportTraceId(raw),
      action: null,
      kind: "generic",
      detail: raw,
      retryable: false,
    };
  }
  if (/could not prepare 3mf|3mf export|no 3mf is available/i.test(raw)) {
    return {
      title: "Could not prepare 3MF",
      message: "The print file could not be generated for this model. Retry, or download STL from the list above.",
      action: "Retry",
      kind: "generic",
      detail: raw,
      retryable: true,
    };
  }
  if (/Link a Fusion mirror folder|aps_project_id|folder_id/i.test(raw)) {
    return {
      title: "Pick a Fusion folder",
      message: "This project isn’t linked to a Fusion folder yet. Choose a hub/project/folder to export.",
      action: null,
      kind: "fusion",
      detail: raw,
      retryable: false,
    };
  }
  if (/Fusion request failed\s*\(502\)|Fusion export failed\s*\(502\)|Fusion push failed/i.test(raw)) {
    return {
      title: "Fusion is busy",
      message: "Autodesk/Fusion did not finish that request. Reconnect Fusion if needed, then retry the export.",
      action: "Retry",
      kind: "fusion",
      detail: raw,
      retryable: true,
    };
  }
  if (/\b(502|503|504)\b|bad gateway/i.test(raw)) {
    return {
      title: "Export timed out",
      message: "The server did not finish preparing this file. Wait a few seconds and retry.",
      action: "Retry",
      kind: "generic",
      detail: raw,
      retryable: true,
    };
  }
  return {
    title: fallback,
    message: raw || fallback,
    action: "Retry",
    kind: "generic",
    detail: raw,
    retryable: true,
  };
}

function showExportError(menu, err, { title = "Export failed", onRetry = null, autoDismissMs = 4200 } = {}) {
  if (!menu) {
    alert(err?.message || title);
    return;
  }
  const info = friendlyExportError(err, title);
  const canRetry = typeof onRetry === "function" && info.retryable !== false && info.action;
  menu.querySelector(".file-export-error-card")?.remove();
  const card = document.createElement("div");
  card.className = `file-export-error-card file-export-error-card--${info.kind}`;
  card.innerHTML = `
    <div class="file-export-error-icon" aria-hidden="true">${info.kind === "fusion" ? "F" : info.kind === "auth" ? "!" : "×"}</div>
    <div class="file-export-error-body">
      <strong>${escText(info.title)}</strong>
      <p>${escText(info.message)}</p>
      ${info.detail && info.detail !== info.message ? `<small>${escText(info.detail)}</small>` : ""}
      <div class="file-export-error-actions">
        ${info.kind === "auth" ? `<button type="button" class="btn btn-compact" data-export-sign-in>${escText(info.action)}</button>` : ""}
        ${canRetry ? `<button type="button" class="btn secondary btn-compact" data-export-retry>${escText(info.action)}</button>` : ""}
      </div>
    </div>
  `;
  const actions = menu.querySelector(".file-export-actions");
  actions?.insertAdjacentElement("afterend", card) || menu.appendChild(card);
  card.querySelector("[data-export-sign-in]")?.addEventListener("click", () => {
    closeExportMenu();
    document.getElementById("btn-auth")?.click();
  });
  card.querySelector("[data-export-retry]")?.addEventListener("click", () => {
    window.clearTimeout(card._dismissTimer);
    card.remove();
    onRetry?.();
  });
  keepMenuInViewport(menu);
  if (autoDismissMs > 0) {
    card._dismissTimer = window.setTimeout(() => {
      if (!card.isConnected) return;
      card.classList.add("is-dismissing");
      window.setTimeout(() => card.remove(), 220);
    }, autoDismissMs);
  }
}

function showExportSuccess(menu, message, { autoDismissMs = 4200 } = {}) {
  if (!menu) return;
  menu.querySelector(".file-export-error-card")?.remove();
  menu.querySelector(".file-export-success-card")?.remove();
  const card = document.createElement("div");
  card.className = "file-export-success-card";
  card.innerHTML = `
    <div class="file-export-success-icon" aria-hidden="true">✓</div>
    <div>
      <strong>Export complete</strong>
      <p>${escText(message)}</p>
    </div>
  `;
  const actions = menu.querySelector(".file-export-actions");
  actions?.insertAdjacentElement("afterend", card) || menu.appendChild(card);
  keepMenuInViewport(menu);
  if (autoDismissMs > 0) {
    card._dismissTimer = window.setTimeout(() => {
      if (!card.isConnected) return;
      card.classList.add("is-dismissing");
      window.setTimeout(() => card.remove(), 220);
    }, autoDismissMs);
  }
}

export async function createShareRecord(projectId, filename, shareContext = null, extra = {}) {
  const body = await scopedShareContext(shareContext, filename);
  const reuse = extra && typeof extra === "object" && (extra.reuse === true || extra.force_new === false);
  // Export mints a fresh share so we never reopen an old Arduino/ball token.
  // Project Share reuses the existing token so permissions stay on the same link.
  body.force_new = !reuse;
  if (!Array.isArray(body.visible_filenames)) body.visible_filenames = [];
  if (extra && typeof extra === "object") {
    if ("allow_download" in extra) body.allow_download = !!extra.allow_download;
    if ("allow_remix" in extra) body.allow_remix = !!extra.allow_remix;
    if ("allow_join" in extra) body.allow_join = !!extra.allow_join;
    if ("share_mode" in extra) body.share_mode = extra.share_mode;
    if ("allow_edit" in extra) body.allow_edit = !!extra.allow_edit;
    if ("folder_scope" in extra) body.folder_scope = extra.folder_scope;
    if ("code_root" in extra) body.code_root = extra.code_root;
  }
  if (!reuse && !("share_mode" in body) && !("allow_download" in body)) {
    try {
      const mode = String(localStorage.getItem("render3d:shareDefault:v1") || "view").toLowerCase();
      body.share_mode = mode === "edit" ? "edit" : mode === "remix" ? "remix" : "view";
    } catch {
      body.share_mode = "view";
    }
  }
  const safeName = String(filename || "").trim();
  if (!safeName || /^(visible|project)\s+assembly$/i.test(safeName)) {
    throw new Error("No shareable model file prepared yet. Try Export again.");
  }
  // Prefer a GLB (or STEP) root so the public viewer can actually load the model.
  // Sharing a .3mf alone creates a link with no 3D preview.
  if (/\.3mf$/i.test(safeName) && !body.viewer_hint) {
    body.prefer_viewer = "glb";
  }
  const res = await fetch(`${projectFileApiPath(projectId, safeName)}/share`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Could not create share link (${res.status})`);
  }
  const data = await res.json();
  const shareUrl = data.share_url;
  if (!shareUrl || !/\/share\/[^/]+/i.test(String(shareUrl))) {
    throw new Error("Could not create a public preview share link.");
  }
  data.share_url = shareUrl.startsWith("http") ? shareUrl : `${window.location.origin}${shareUrl}`;
  return data;
}

export async function createShareUrl(projectId, filename, shareContext = null) {
  const data = await createShareRecord(projectId, filename, shareContext);
  return data.share_url;
}

export async function patchShareSettings(token, patch = {}) {
  const clean = String(token || "").trim();
  if (!clean) throw new Error("No share link to update.");
  const res = await fetch(`/api/share/${encodeURIComponent(clean)}/settings`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Could not update share settings (${res.status})`);
  if (data.share_url && !String(data.share_url).startsWith("http")) {
    data.share_url = `${window.location.origin}${data.share_url}`;
  }
  return data;
}

export async function downloadFile(url, filename, { retries = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
    let res;
    try {
      res = await fetch(url, { headers: authHeaders() });
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) continue;
      throw err;
    }
    if (res.ok) {
      const blob = await res.blob();
      triggerTrackedBlobDownload(blob, filename, fileDownloadCreated);
      return;
    }
    const retryable = [502, 503, 504].includes(res.status);
    const data = await res.json().catch(() => ({}));
    const detail = typeof data.detail === "string"
      ? data.detail
      : (data.detail?.message || data.detail?.msg || res.statusText);
    lastErr = new Error(stripExportTraceId(detail) || `Download failed (${res.status})`);
    if (retryable && attempt < retries - 1) continue;
    throw lastErr;
  }
  throw lastErr || new Error("Download failed");
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) throw new Error("Nothing to copy.");

  // Prefer Clipboard API when available, but always fall back — iOS/Android
  // often reject writeText after an await (lost user gesture) even though
  // navigator.clipboard exists.
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through to execCommand / selection */
    }
  }

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;margin:0;border:0;opacity:0;";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  if (!ok) throw new Error("Clipboard copy was blocked on this device.");
  return true;
}

async function shareOrCopyUrl(url, { title = "Render Studio share" } = {}) {
  const shareUrl = String(url || "").trim();
  if (!shareUrl) throw new Error("No share link to copy.");

  // Native share sheet is the reliable mobile path (clipboard is flaky on iOS).
  if (isMobileClient() && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url: shareUrl, text: shareUrl });
      return { method: "share" };
    } catch (err) {
      // User cancelled the sheet — treat as success (they saw the link).
      if (err?.name === "AbortError") return { method: "share-cancel" };
      /* fall through to clipboard */
    }
  }

  await copyText(shareUrl);
  return { method: "clipboard" };
}

function revealShareUrlForManualCopy(menu, shareUrl, shareBtn) {
  if (!menu || !shareUrl) return;
  let box = menu.querySelector(".file-export-share-url");
  if (!box) {
    box = document.createElement("div");
    box.className = "file-export-share-url";
    box.innerHTML = `
      <label class="muted small">Share link — tap to select, then copy</label>
      <input type="text" readonly inputmode="none" autocomplete="off" spellcheck="false" />
    `;
    const shareBar = menu.querySelector(".file-export-share-bar");
    const actions = menu.querySelector(".file-export-actions");
    if (shareBar) shareBar.insertAdjacentElement("afterend", box);
    else if (actions) actions.insertAdjacentElement("beforebegin", box);
    else menu.appendChild(box);
    const input = box.querySelector("input");
    input?.addEventListener("focus", () => {
      try {
        input.select();
        input.setSelectionRange(0, input.value.length);
      } catch {
        /* ignore */
      }
    });
    input?.addEventListener("click", () => {
      try {
        input.select();
        input.setSelectionRange(0, input.value.length);
      } catch {
        /* ignore */
      }
    });
  }
  const input = box.querySelector("input");
  if (input) {
    input.value = shareUrl;
    requestAnimationFrame(() => {
      try {
        input.focus();
        input.select();
        input.setSelectionRange(0, shareUrl.length);
      } catch {
        /* ignore */
      }
    });
  }
  setExportShareLabel(shareBtn, "Copy share link");
}

function setExportShareLabel(shareBtn, text) {
  const label = shareBtn?.querySelector("[data-share-label]");
  if (label) label.textContent = text;
  else if (shareBtn) shareBtn.textContent = text;
}

function showStepModeChooser(menu, item, onChoose, anchorEl = null, clickEvent = null) {
  // Default Part STEP so Extrude/Cut works (linked assemblies fail Cut in Fusion).
  // Hold Alt/Option when clicking STEP in the list to keep the Assembly chooser.
  if (!clickEvent?.altKey) {
    onChoose?.("part", item);
    return;
  }
  menu.querySelector(".file-export-step-chooser")?.remove();
  const chooser = document.createElement("div");
  chooser.className = "file-export-step-chooser";
  chooser.innerHTML = `
    <div class="file-export-step-title">Export STEP as part or assembly?</div>
    <button type="button" class="file-export-step-choice" data-step-mode="part">
      <strong>Part STEP</strong>
      <span>Standalone Part with Bodies — Extrude / Cut in Fusion (Open from Data Panel, don’t Insert)</span>
    </button>
    <button type="button" class="file-export-step-choice" data-step-mode="assembly">
      <strong>Assembly STEP</strong>
      <span>Keep linked components / appearances as authored</span>
    </button>
  `;
  chooser.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-step-mode]");
    if (!btn) return;
    onChoose(btn.dataset.stepMode || "assembly", item);
  });
  if (anchorEl?.parentNode) anchorEl.insertAdjacentElement("afterend", chooser);
  else menu.appendChild(chooser);
  chooser.scrollIntoView({ block: "nearest" });
}

function showFusionActionChooser(menu, onChoose, anchorEl = null, { allowPush = true, allowShared = true } = {}) {
  menu.querySelector(".file-export-fusion-action-chooser")?.remove();
  if (!allowPush && !allowShared) return;
  // One action → run it; don't show a useless single-option card.
  if (allowPush && !allowShared) {
    onChoose("push");
    return;
  }
  if (!allowPush && allowShared) {
    onChoose("shared");
    return;
  }
  const chooser = document.createElement("div");
  chooser.className = "file-export-step-chooser file-export-fusion-action-chooser";
  chooser.innerHTML = `
    <button type="button" class="file-export-fusion-close" data-fusion-close aria-label="Close Fusion export">&times;</button>
    <div class="file-export-step-title">How should Fusion handle this model?</div>
    ${allowPush ? `
    <button type="button" class="file-export-step-choice" data-fusion-action="push">
      <strong>Update original Fusion file</strong>
      <span>Push a new version back to the Fusion item this project came from.</span>
    </button>` : ""}
    ${allowShared ? `
    <button type="button" class="file-export-step-choice" data-fusion-action="shared">
      <strong>Shared Fusion folder/link</strong>
      <span>Choose a Fusion project folder so other Fusion users can access the uploaded file.</span>
    </button>` : ""}
  `;
  chooser.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-fusion-close]")) {
      chooser.remove();
      return;
    }
    const btn = ev.target.closest("[data-fusion-action]");
    if (!btn) return;
    chooser.remove();
    onChoose(btn.dataset.fusionAction || "shared");
  });
  if (anchorEl?.parentNode) anchorEl.insertAdjacentElement("afterend", chooser);
  else menu.appendChild(chooser);
  chooser.scrollIntoView({ block: "nearest" });
  keepMenuInViewport(menu);
}

const CAD_LINK_CACHE_MS = 60_000;
const cadLinkCache = {
  onshape: { value: null, at: 0, inflight: null },
  autodesk: { value: null, at: 0, inflight: null },
};

async function cachedCadLinked(kind, fetcher) {
  const slot = cadLinkCache[kind];
  const now = Date.now();
  if (slot.value !== null && now - slot.at < CAD_LINK_CACHE_MS) return slot.value;
  if (slot.inflight) return slot.inflight;
  slot.inflight = Promise.resolve()
    .then(fetcher)
    .then((value) => {
      slot.value = Boolean(value);
      slot.at = Date.now();
      slot.inflight = null;
      return slot.value;
    })
    .catch(() => {
      slot.inflight = null;
      return false;
    });
  return slot.inflight;
}

async function checkOnshapeLinked() {
  if (!getToken()) return false;
  return cachedCadLinked("onshape", async () => {
    const res = await fetch("/api/onshape/status", { headers: authHeaders() });
    if (!res.ok) return false;
    const d = await res.json();
    return d.linked === true;
  });
}

async function checkAutodeskLinked() {
  if (!getToken()) return false;
  return cachedCadLinked("autodesk", async () => {
    const res = await fetch("/api/autodesk/status", { headers: authHeaders() });
    if (!res.ok) return false;
    const d = await res.json();
    return d.linked === true;
  });
}

function cadExportButtonsHtml({ onshapeLinked, onshapeSource, autodeskLinked, autodeskSource }) {
  const onshape = onshapeSource
    ? `<button type="button" class="btn file-export-onshape file-export-onshape-push" title="Push updated STEP back to the original Onshape document">
        <img src="/cad/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" />
        Push to Onshape
      </button>`
    : (onshapeLinked ? `<button type="button" class="btn file-export-onshape" title="Create a new Onshape document from this model's STEP file">
        <img src="/cad/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" />
        Export to Onshape
      </button>` : "");
  const fusion = autodeskLinked
    ? `<button type="button" class="btn file-export-fusion-action" title="${autodeskSource ? "Update the original Fusion file or upload to a shared Fusion folder" : "Pick a Fusion 360 project and folder, then upload this model as a new STEP file"}">
        <img src="/cad/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" />
        Fusion 360
      </button>`
    : "";
  return `${onshape}${fusion}`;
}

function insertCadExportButtons(menu, html, { preparing = false } = {}) {
  const actions = menu?.querySelector(".file-export-actions");
  if (!actions) return;
  actions.querySelectorAll(".file-export-onshape, .file-export-fusion-action").forEach((el) => el.remove());
  if (!html) return;
  const slicerRow = actions.querySelector(".file-export-slicer-row");
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  while (wrap.firstChild) {
    actions.insertBefore(wrap.firstChild, slicerRow);
  }
  if (preparing) setExportActionsPreparing(menu, true);
}

let fusionExportAbort = null; // leakfix81
function beginFusionExportFetch() {
  if (fusionExportAbort) {
    try { fusionExportAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  fusionExportAbort = ctl;
  return ctl;
}
let exportShareWorkspaceAbort = null; // leakfix82
function beginExportShareWorkspaceFetch() {
  if (exportShareWorkspaceAbort) {
    try { exportShareWorkspaceAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  exportShareWorkspaceAbort = ctl;
  return ctl;
}

async function autodeskJson(path, { method = "GET", body = null, signal } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...authHeaders(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Fusion request failed (${res.status})`);
  }
  return res.json();
}

export async function openFileExportMenu({
  api,
  projectId,
  filename: filenameArg,
  anchorEl,
  title = null,
  hint = null,
  exportsRequest = null,
  extraExports = [],
  allowOnshape = true,
  allowFusion = true,
  cloudFilename = null,
  fusionUploadName = null,
  allowedFilenames = null,
  autoAction = null,
  shareContext = null,
  getVisibleBodyIndices = null,
  /** Optional per-menu baker; falls back to setAnimatedGlbBaker() */
  bakeAnimatedGlb = null,
  /**
   * After first paint, optionally replace the export target (sidebar Export
   * before project files have been fetched).
   * @type {null | (() => Promise<null | { filename?: string, cloudFilename?: string, fusionUploadName?: string, allowedFilenames?: string[] }>)}
   */
  resolveExportTarget = null,
  openWorkspacePicker = false,
}) {
  closeExportMenu();

  let filename = filenameArg;
  let effectiveCloudFilename = cloudFilename;
  let effectiveFusionUploadName = fusionUploadName;
  let effectiveAllowedFilenames = allowedFilenames;

  const mobile = isMobileClient();
  const preferredSlicer = getPreferredSlicer();
  const slicerLabel = slicerExportLabel(preferredSlicer, { mobile });
  const defaultHint = preferredSlicer
    ? (
      mobile
        ? `Download GLB, STL, STEP, or 3MF — export to ${preferredSlicer.name} (bodies packed across print plates) — or copy a public preview link.`
        : `Download GLB, STL, STEP, or 3MF — export to ${preferredSlicer.name} (bodies packed across print plates) — or copy a public preview link.`
    )
    : "Download GLB, STL, STEP, or 3MF — pick a slicer to open your 3MF, or copy a public preview link.";

  const menu = document.createElement("div");
  menu.className = `file-export-menu${mobile ? " file-export-menu--mobile" : ""}`;
  menu.innerHTML = `
    <div class="file-export-header">
      <div class="file-export-title">${title || `Export ${filename}`}</div>
      <button type="button" class="file-export-close" data-export-close aria-label="Close export">&times;</button>
    </div>
    <p class="file-export-hint muted small">${hint || defaultHint}</p>
    <div class="file-export-share-bar">
      <div class="file-export-share-row">
        <button type="button" class="btn file-export-share share-fx-btn" disabled>
          <svg class="share-fx-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l1.92-1.92a5 5 0 0 0-7.07-7.07l-1.09 1.09"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54L4.54 12.38a5 5 0 0 0 7.07 7.07l1.09-1.09"></path>
          </svg>
          <span data-share-label>Copy share link</span>
        </button>
        <button type="button" class="btn file-export-share-gear share-fx-btn share-fx-btn--icon" disabled aria-label="Share permissions" aria-expanded="false" title="Share permissions">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 1-2 0 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 1 0-2 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 1 2 0 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 .33 1.82 1.65 1.65 0 0 1 0 2Z"></path>
          </svg>
        </button>
      </div>
      <div class="file-export-share-settings-pop hidden" data-share-settings-pop>
        <div class="file-export-share-settings-head">
          <strong>Share permissions</strong>
          <button type="button" class="file-export-close" data-share-settings-close aria-label="Close share permissions">&times;</button>
        </div>
        <label class="file-export-share-opt">
          <input type="radio" name="file-export-share-mode" value="view" data-share-mode="view" checked>
          <span><strong>View only</strong><span class="muted small">People can watch and leave comments</span></span>
        </label>
        <label class="file-export-share-opt">
          <input type="radio" name="file-export-share-mode" value="remix" data-share-mode="remix">
          <span><strong>Remix only</strong><span class="muted small">They can download and copy into their own project</span></span>
        </label>
        <label class="file-export-share-opt">
          <input type="radio" name="file-export-share-mode" value="edit" data-share-mode="edit">
          <span><strong>Remix and edit</strong><span class="muted small">They can edit the live project and pin markup</span></span>
        </label>
        <label class="file-export-share-opt file-export-share-opt--join">
          <input type="checkbox" data-share-join>
          <span><strong>Anyone can join this project</strong><span class="muted small">A separate join-project link. Copy share link still copies the view URL.</span></span>
        </label>
        <div class="file-export-share-join hidden" data-share-join-box>
          <label class="muted small">Join-project link</label>
          <div class="file-export-share-join-row">
            <input type="text" readonly data-share-join-url>
            <button type="button" class="btn share-fx-btn share-fx-btn--compact" data-share-join-copy>Copy</button>
          </div>
          <p class="muted small" data-share-join-hint>Signed-in visitors are added automatically. Role matches view / remix / edit above.</p>
        </div>
        <p class="muted small file-export-share-settings-status" data-share-settings-status></p>
      </div>
      <button type="button" class="btn file-export-share-workspace share-fx-btn">
        <svg class="share-fx-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
        <span>Share to workspace</span>
      </button>
    </div>
    <div class="file-export-ws-host hidden" data-share-ws-host></div>
    <p class="file-export-status muted small">Preparing exports…</p>
    <div class="file-export-list"></div>
    <div class="file-export-actions">
      <div class="file-export-slicer-row">
        <button type="button" class="btn file-export-bambu file-export-slicer" data-slicer-export
          title="${preferredSlicer ? `Prepare a 3MF and open in ${preferredSlicer.name}` : "Choose your slicer, then export a plate-packed 3MF"}"
          style="${preferredSlicer ? `--slicer-accent:${preferredSlicer.accent}` : ""}">
          <!-- @milestone id=send-to-slicer title="Export to slicer" summary="Export prepares a plate-packed 3MF and opens it in the user's preferred slicer (Bambu, Orca, Prusa, Cura, …)." kind=feature href="/" -->
          ${preferredSlicer
            ? `<img class="file-export-slicer-logo" src="${preferredSlicer.logo}" width="18" height="18" alt="" />`
            : `<span class="file-export-bambu-mark" aria-hidden="true">3D</span>`}
          <span data-slicer-label>${preferredSlicer ? slicerLabel : "Choose a slicer…"}</span>
          <span class="file-export-profile-badge hidden" data-slicer-profile-badge>Profile</span>
        </button>
        <button type="button" class="btn secondary file-export-slicer-gear" data-slicer-profile-gear
          title="Context Lab print profile" aria-label="Print profile settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 1-2 0 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 1 0-2 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 1 2 0 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0 .33 1.82 1.65 1.65 0 0 1 0 2Z"></path>
          </svg>
        </button>
        <button type="button" class="btn secondary file-export-slicer-change" data-slicer-change
          title="Change preferred slicer" aria-label="Change preferred slicer">
          ▾
        </button>
      </div>
      <div class="file-export-profile-pop hidden" data-slicer-profile-pop>
        <div class="file-export-share-settings-head">
          <strong>Context Lab profile</strong>
          <button type="button" class="file-export-close" data-slicer-profile-close aria-label="Close profile settings">&times;</button>
        </div>
        <label class="file-export-share-opt">
          <input type="checkbox" data-slicer-profile-apply checked>
          <span><strong>Apply profile on export</strong><span class="muted small">Filament + supports from the selected profile</span></span>
        </label>
        <label class="muted small">Default profile</label>
        <select data-slicer-profile-id></select>
        <p class="muted small" data-slicer-profile-hint>Save profiles in Context Lab → Print.</p>
      </div>
    </div>
  `;
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = "fixed";
  if (mobile) {
    menu.style.left = "8px";
    menu.style.right = "8px";
    menu.style.width = "auto";
    menu.style.bottom = "8px";
    menu.style.top = "auto";
  } else {
    menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 260)}px`;
    menu.style.left = `${Math.min(rect.left, Math.max(8, window.innerWidth - 316))}px`;
  }
  document.body.appendChild(menu);
  keepMenuInViewport(menu);
  openMenu = menu;

  // First-time: show slicer picker immediately so new users pick before exporting.
  if (!hasChosenSlicer()) {
    showSlicerPicker(menu, {
      title: "Choose your slicer",
      subtitle: "We’ll remember this for every export. You can change it anytime.",
      requireChoice: true,
      onChosen: (slicer) => syncSlicerExportButton(slicer),
    });
  }

  const closeFromUi = () => {
    closeExportMenu();
  };
  menu.querySelector("[data-export-close]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    closeFromUi();
  });

  const onDoc = (ev) => {
    if (menu.contains(ev.target) || anchorEl.contains(ev.target)) return;
    closeFromUi();
  };
  const onKey = (ev) => {
    if (ev.key !== "Escape") return;
    const pop = menu.querySelector("[data-share-settings-pop]");
    if (pop && !pop.classList.contains("hidden")) {
      hideShareSettings();
      return;
    }
    closeFromUi();
  };
  openMenuCleanup = () => {
    document.removeEventListener("mousedown", onDoc);
    document.removeEventListener("touchstart", onDoc);
    document.removeEventListener("keydown", onKey);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
  }, 0);

  const statusEl  = menu.querySelector(".file-export-status");
  const list      = menu.querySelector(".file-export-list");
  const shareBtn  = menu.querySelector(".file-export-share");
  const shareGearBtn = menu.querySelector(".file-export-share-gear");
  const shareSettingsPop = menu.querySelector("[data-share-settings-pop]");
  const shareWorkspaceBtn = menu.querySelector(".file-export-share-workspace");
  const workspaceHost = menu.querySelector("[data-share-ws-host]");
  let onshapeBtn = null;
  let pushBtn = null;
  let fusionActionBtn = null;
  const slicerBtn = menu.querySelector("[data-slicer-export]");
  const slicerChangeBtn = menu.querySelector("[data-slicer-change]");
  const slicerGearBtn = menu.querySelector("[data-slicer-profile-gear]");
  const slicerProfilePop = menu.querySelector("[data-slicer-profile-pop]");
  const slicerProfileApply = menu.querySelector("[data-slicer-profile-apply]");
  const slicerProfileSelect = menu.querySelector("[data-slicer-profile-id]");
  const slicerProfileBadge = menu.querySelector("[data-slicer-profile-badge]");
  let printProfiles = [];
  let defaultPrintProfile = null;

  function syncSlicerProfileChrome() {
    const apply = bambuProfileApplyEnabled() && !!(defaultPrintProfile || slicerProfileSelect?.value);
    slicerBtn?.classList.toggle("is-profile-on", apply);
    if (slicerProfileBadge) slicerProfileBadge.classList.toggle("hidden", !apply);
    if (slicerProfileApply) slicerProfileApply.checked = bambuProfileApplyEnabled();
  }

  async function loadPrintProfiles() {
    try {
      const res = await fetch("/api/context-lab", { headers: authHeaders() });
      if (!res.ok) return;
      const snap = await res.json();
      printProfiles = snap.print_profiles || [];
      defaultPrintProfile = snap.default_print_profile || printProfiles.find((p) => p.is_default) || null;
      if (slicerProfileSelect) {
        slicerProfileSelect.innerHTML = printProfiles.length
          ? printProfiles.map((p) => `<option value="${p.id}"${defaultPrintProfile && p.id === defaultPrintProfile.id ? " selected" : ""}>${p.name} · ${p.filament}</option>`).join("")
          : `<option value="">No profiles — open Context Lab</option>`;
      }
    } catch { /* ignore */ }
    syncSlicerProfileChrome();
  }

  slicerGearBtn?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    slicerProfilePop?.classList.toggle("hidden");
    if (slicerProfilePop && !slicerProfilePop.classList.contains("hidden")) void loadPrintProfiles();
  });
  menu.querySelector("[data-slicer-profile-close]")?.addEventListener("click", () => {
    slicerProfilePop?.classList.add("hidden");
  });
  slicerProfileApply?.addEventListener("change", () => {
    setBambuProfileApplyEnabled(!!slicerProfileApply.checked);
    syncSlicerProfileChrome();
  });
  slicerProfileSelect?.addEventListener("change", () => {
    const id = slicerProfileSelect.value;
    if (!id) return;
    void fetch(`/api/context-lab/print-profiles/${encodeURIComponent(id)}/default`, {
      method: "POST",
      headers: authHeaders(),
    }).then(() => loadPrintProfiles()).catch(() => {});
  });
  void loadPrintProfiles();
  let onshapeLinked = false;
  let autodeskLinked = false;
  let onshapeSource = null;
  let autodeskSource = null;
  let cadButtonsReady = false;
  let exportsPreparing = true;

  function syncSlicerExportButton(slicer) {
    if (!slicerBtn) return;
    const label = slicerExportLabel(slicer, { mobile });
    const labelEl = slicerBtn.querySelector("[data-slicer-label]");
    if (labelEl) labelEl.textContent = slicer ? label : "Choose a slicer…";
    slicerBtn.title = slicer
      ? `Prepare a 3MF and open in ${slicer.name}`
      : "Choose your slicer, then export a plate-packed 3MF";
    if (slicer) {
      slicerBtn.style.setProperty("--slicer-accent", slicer.accent);
      let logo = slicerBtn.querySelector(".file-export-slicer-logo");
      if (!logo) {
        slicerBtn.querySelector(".file-export-bambu-mark")?.remove();
        logo = document.createElement("img");
        logo.className = "file-export-slicer-logo";
        logo.width = 18;
        logo.height = 18;
        logo.alt = "";
        slicerBtn.prepend(logo);
      }
      logo.src = slicer.logo;
    }
    const hintEl = menu.querySelector(".file-export-hint");
    if (hintEl && !hint && slicer) {
      hintEl.textContent = `Download GLB, STL, STEP, or 3MF — export to ${slicer.name} (bodies packed across print plates) — or copy a public preview link.`;
    }
  }

  renderExportPlaceholders(list);
  setExportActionsPreparing(menu, true);

  const cadLinksPromise = (async () => {
    const [osLinked, adLinked] = await Promise.all([
      allowOnshape ? checkOnshapeLinked() : false,
      allowFusion ? checkAutodeskLinked() : false,
    ]);
    if (openMenu !== menu) return;
    onshapeLinked = osLinked;
    autodeskLinked = adLinked;
    if (allowOnshape && onshapeLinked && projectId) {
      const ctl = beginExportOnshapeSourceFetch();
      try {
        const sr = await fetch(`/api/projects/${encodeURIComponent(projectId)}/onshape-source`, { headers: authHeaders(), signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (sr.ok) { const d = await sr.json(); onshapeSource = d.onshape_source || null; }
      } catch (err) {
        if (ctl.signal.aborted || err?.name === "AbortError") return;
        /* non-critical */
      }
    }
    if (allowFusion && autodeskLinked && projectId) {
      try {
        const sr = await fetch(`/api/projects/${encodeURIComponent(projectId)}/autodesk-source`, { headers: authHeaders() });
        if (sr.ok) { const d = await sr.json(); autodeskSource = d.autodesk_source || null; }
      } catch { /* non-critical */ }
    }
    if (openMenu !== menu) return;
    insertCadExportButtons(menu, cadExportButtonsHtml({
      onshapeLinked,
      onshapeSource,
      autodeskLinked,
      autodeskSource,
    }), { preparing: exportsPreparing });
    cadButtonsReady = true;
    keepMenuInViewport(menu);
  })();

  let preparedShareUrl = "";
  let preparedShare = null;
  let preparingShare = false;
  let prepareSharePromise = null;
  let shareFilename = preferShareFilename(filename, [], null);
  const shareReadyLabel = () => "Copy share link";
  function requireAuthForShare(kind) {
    const gate = gateRemixOrShare({
      token: getToken(),
      action: {
        kind,
        projectId,
        filename: shareFilename || filename,
        shareContext,
      },
    });
    if (!gate.needsAuth) return false;
    window.dispatchEvent(new CustomEvent("render3d:require-auth", { detail: gate.action }));
    return true;
  }

  async function showShareWorkspacePicker() {
    if (!workspaceHost) return;
    if (requireAuthForShare("share-workspace")) return;
    workspaceHost.classList.remove("hidden");
    const ctl = beginExportShareWorkspaceFetch();
    if (!workspaceHost.querySelector("[data-share-ws-picker]")) {
      workspaceHost.innerHTML = `<p class="muted small">Loading shared workspaces…</p>`;
    }
    try {
      const res = await fetch("/api/teams", { headers: authHeaders(), signal: ctl.signal });
      if (ctl.signal.aborted) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not load workspaces");
      const workspaces = sharedWorkspacesFromTeams(data.teams || []);
      workspaceHost.innerHTML = `${sharedWorkspacePickerHtml({
        workspaces,
        prefix: "export-share",
      })}<button type="button" class="btn accent btn-compact file-export-ws-apply">Save to workspace</button>
      <p class="muted small file-export-ws-status"></p>`;
      bindSharedWorkspacePicker(workspaceHost);
      workspaceHost.querySelector(".file-export-ws-apply")?.addEventListener("click", () => {
        void applyShareWorkspaceChoice();
      });
      keepMenuInViewport(menu);
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      workspaceHost.innerHTML = `<p class="status error">${escText(err.message || "Could not load workspaces.")}</p>`;
    } finally {
      if (exportShareWorkspaceAbort === ctl) exportShareWorkspaceAbort = null;
    }
  }

  async function applyShareWorkspaceChoice() {
    if (requireAuthForShare("share-workspace")) return;
    const status = workspaceHost?.querySelector(".file-export-ws-status");
    const choice = readSharedWorkspacePicker(workspaceHost);
    if (choice.mode === "none") {
      if (status) status.textContent = "Pick an existing shared workspace or create a new one.";
      return;
    }
    if (choice.mode === "existing" && !choice.teamId) {
      if (status) status.textContent = "Choose a shared workspace.";
      return;
    }
    const applyBtn = workspaceHost?.querySelector(".file-export-ws-apply");
    if (applyBtn) applyBtn.disabled = true;
    if (status) status.textContent = choice.mode === "new" ? "Creating shared workspace…" : "Saving to workspace…";
    try {
      let teamId = choice.teamId;
      if (choice.mode === "new") {
        const created = await fetch("/api/teams", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ name: choice.workspaceName || "Shared workspace" }),
        });
        const createdData = await created.json().catch(() => ({}));
        if (!created.ok) throw new Error(createdData.detail || "Could not create workspace");
        teamId = createdData.team?.id;
      }
      if (!teamId) throw new Error("Choose a shared workspace.");
      const moved = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ team_id: teamId }),
      });
      const movedData = await moved.json().catch(() => ({}));
      if (!moved.ok) throw new Error(movedData.detail || "Could not save to workspace");
      if (status) status.textContent = movedData.team_name ? `Saved to ${movedData.team_name}.` : "Saved to workspace.";
    } catch (err) {
      if (status) status.textContent = err.message || "Could not save to workspace.";
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  shareWorkspaceBtn?.addEventListener("click", () => {
    void showShareWorkspacePicker();
  });
  if (openWorkspacePicker) {
    void showShareWorkspacePicker();
  }

  const setShareButtonsEnabled = (enabled) => {
    if (shareBtn) shareBtn.disabled = !enabled;
    if (shareGearBtn) shareGearBtn.disabled = !enabled;
  };

  function hideShareSettings() {
    shareSettingsPop?.classList.add("hidden");
    shareGearBtn?.setAttribute("aria-expanded", "false");
  }

  function syncShareSettingsUi(share = preparedShare) {
    if (!shareSettingsPop) return;
    const mode = String(share?.share_mode || (share?.allow_edit ? "edit" : (share?.allow_remix || share?.allow_download ? "remix" : "view")));
    shareSettingsPop.querySelectorAll("[data-share-mode]").forEach((input) => {
      input.checked = input.getAttribute("data-share-mode") === mode;
    });
    const joinOn = !!share?.allow_join;
    const joinCheck = shareSettingsPop.querySelector("[data-share-join]");
    if (joinCheck) joinCheck.checked = joinOn;
    const joinBox = shareSettingsPop.querySelector("[data-share-join-box]");
    joinBox?.classList.toggle("hidden", !joinOn);
    const joinInput = shareSettingsPop.querySelector("[data-share-join-url]");
    if (joinInput) joinInput.value = share?.join_url || "";
    const hint = shareSettingsPop.querySelector("[data-share-join-hint]");
    if (hint) {
      hint.textContent = mode === "edit"
        ? "Signed-in visitors are added as editors. Copy share link still copies the view URL."
        : mode === "remix"
          ? "Signed-in visitors are added as remixers. Copy share link still copies the view URL."
          : "Signed-in visitors are added as viewers. Copy share link still copies the view URL.";
    }
  }

  async function persistShareSettings(patch) {
    const token = preparedShare?.token;
    if (!token) throw new Error("No share link to update.");
    const status = shareSettingsPop?.querySelector("[data-share-settings-status]");
    if (status) status.textContent = "Saving…";
    const data = await patchShareSettings(token, patch);
    preparedShare = { ...(preparedShare || {}), ...data };
    if (data.share_url) preparedShareUrl = data.share_url;
    syncShareSettingsUi(preparedShare);
    if (status) status.textContent = "Saved.";
    window.setTimeout(() => {
      if (status?.isConnected && status.textContent === "Saved.") status.textContent = "";
    }, 1400);
    return data;
  }

  const prepareShareLink = async () => {
    if (preparedShareUrl) return preparedShareUrl;
    if (prepareSharePromise) return prepareSharePromise;
    if (!shareBtn) return "";
    preparingShare = true;
    setShareButtonsEnabled(false);
    shareBtn.classList.add("is-loading");
    setExportShareLabel(shareBtn, "Creating share link...");
    prepareSharePromise = (async () => {
      try {
        const name = shareFilename || preferShareFilename(filename, [], null);
        if (!name) throw new Error("No shareable model file prepared yet.");
        preparedShare = await createShareRecord(projectId, name, shareContext);
        preparedShareUrl = preparedShare.share_url;
        setExportShareLabel(shareBtn, shareReadyLabel());
        setShareButtonsEnabled(true);
        syncShareSettingsUi(preparedShare);
        return preparedShareUrl;
      } catch (err) {
        setExportShareLabel(shareBtn, "Retry share link");
        showExportError(menu, err, {
          title: "Could not create share link",
          onRetry: () => prepareShareLink(),
        });
        return "";
      } finally {
        preparingShare = false;
        prepareSharePromise = null;
        shareBtn.classList.remove("is-loading");
        if (!preparedShareUrl) {
          setShareButtonsEnabled(true);
        }
      }
    })();
    return prepareSharePromise;
  };

  shareGearBtn?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (requireAuthForShare("copy-share")) return;
    try {
      if (!preparedShareUrl) {
        await prepareShareLink();
        if (!preparedShareUrl) return;
      }
      const opening = shareSettingsPop?.classList.contains("hidden");
      if (opening) {
        syncShareSettingsUi(preparedShare);
        shareSettingsPop?.classList.remove("hidden");
        shareGearBtn?.setAttribute("aria-expanded", "true");
        keepMenuInViewport(menu);
      } else {
        hideShareSettings();
      }
    } catch (err) {
      showExportError(menu, err, {
        title: "Could not open share settings",
        onRetry: () => shareGearBtn.click(),
      });
    }
  });
  shareSettingsPop?.querySelector("[data-share-settings-close]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    hideShareSettings();
  });
  shareSettingsPop?.querySelectorAll("[data-share-mode]").forEach((input) => {
    input.addEventListener("change", () => {
      const mode = shareSettingsPop.querySelector("[data-share-mode]:checked")?.getAttribute("data-share-mode") || "view";
      void persistShareSettings({ share_mode: mode }).catch((err) => {
        const status = shareSettingsPop.querySelector("[data-share-settings-status]");
        if (status) status.textContent = err.message || "Could not save permissions.";
        syncShareSettingsUi(preparedShare);
      });
    });
  });
  shareSettingsPop?.querySelector("[data-share-join]")?.addEventListener("change", (ev) => {
    const enabled = !!ev.currentTarget.checked;
    void persistShareSettings({ allow_join: enabled }).catch((err) => {
      const status = shareSettingsPop.querySelector("[data-share-settings-status]");
      if (status) status.textContent = err.message || "Could not save join link.";
      syncShareSettingsUi(preparedShare);
    });
  });
  shareSettingsPop?.querySelector("[data-share-join-copy]")?.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const url = preparedShare?.join_url || shareSettingsPop.querySelector("[data-share-join-url]")?.value;
    const status = shareSettingsPop.querySelector("[data-share-settings-status]");
    try {
      if (!url) throw new Error("Turn on join-project to create the link.");
      await copyText(url);
      const copyBtn = shareSettingsPop.querySelector("[data-share-join-copy]");
      if (copyBtn) copyBtn.textContent = "Copied!";
      if (status) status.textContent = "Join-project link copied.";
      window.setTimeout(() => {
        if (copyBtn?.isConnected) copyBtn.textContent = "Copy";
        if (status?.isConnected && status.textContent === "Join-project link copied.") status.textContent = "";
      }, 1400);
    } catch (err) {
      if (status) status.textContent = err.message || "Could not copy join link.";
    }
  });
  shareBtn?.addEventListener("click", async () => {
    if (requireAuthForShare("copy-share")) return;
    try {
      if (!preparedShareUrl) {
        await prepareShareLink();
        if (!preparedShareUrl) return;
      }
      shareBtn.disabled = true;
      const result = await shareOrCopyUrl(preparedShareUrl, {
        title: title || `Share ${shareFilename || filename}`,
      });
      if (result.method === "share-cancel") {
        setExportShareLabel(shareBtn, shareReadyLabel());
        revealShareUrlForManualCopy(menu, preparedShareUrl, shareBtn);
      } else if (result.method === "share") {
        setExportShareLabel(shareBtn, "Shared!");
        window.setTimeout(() => {
          if (shareBtn.isConnected) setExportShareLabel(shareBtn, shareReadyLabel());
        }, 1600);
      } else {
        setExportShareLabel(shareBtn, "Link copied!");
        window.setTimeout(() => {
          if (shareBtn.isConnected) setExportShareLabel(shareBtn, shareReadyLabel());
        }, 1600);
      }
      void showShareWorkspacePicker();
    } catch (err) {
      setExportShareLabel(shareBtn, shareReadyLabel());
      if (preparedShareUrl) revealShareUrlForManualCopy(menu, preparedShareUrl, shareBtn);
      showExportError(menu, err, {
        title: "Could not copy share link",
        onRetry: () => shareBtn.click(),
      });
    } finally {
      shareBtn.disabled = false;
    }
  });

  if (typeof resolveExportTarget === "function") {
    try {
      const next = await resolveExportTarget();
      if (openMenu !== menu) return;
      if (next && typeof next === "object") {
        if (next.filename) filename = next.filename;
        if (next.cloudFilename != null) effectiveCloudFilename = next.cloudFilename;
        if (next.fusionUploadName != null) effectiveFusionUploadName = next.fusionUploadName;
        if (next.allowedFilenames != null) effectiveAllowedFilenames = next.allowedFilenames;
        shareFilename = preferShareFilename(filename, [], null);
        const titleEl = menu.querySelector(".file-export-title");
        if (titleEl && !title && next.filename) {
          titleEl.textContent = `Export ${next.filename}`;
        }
      }
    } catch (err) {
      list.innerHTML = "";
      exportsPreparing = false;
      setExportActionsPreparing(menu, false);
      statusEl.textContent = err.message || "Could not load project for export";
      statusEl.className = "file-export-status status error";
      keepMenuInViewport(menu);
      return;
    }
  }
  // Mint the share in parallel with export listing — do not wait on STEP/3MF prep.
  if (getToken()) void prepareShareLink();
  else {
    setShareButtonsEnabled(true);
  }

  let data = null;
  let fetchError = null;
  try {
    // Listing must return existing GLB/STEP immediately. STL/3MF/McMaster
    // conversions happen on download — do not 18s-timeout the menu into a
    // stuck "Export preparation is taking too long" overlay.
    if (exportsRequest) {
      data = await api(exportsRequest.path, exportsRequest.options || {});
    } else {
      data = await api(`${projectFileApiPath(projectId, filename)}/exports`);
    }
  } catch (err) {
    fetchError = err;
  }

  let exports = listedDownloadExports(collapseExportsToSingleStep(data?.exports || []));
  // Prefer the baked assembly GLB/STEP from exportsRequest — never share the
  // placeholder label "visible assembly" / "project assembly" (404 → old token).
  const bakedGlb = (data?.exports || []).find((item) => item.format === "glb" && String(item.name || "").startsWith("_export_visible_assembly"))
    || (data?.filename && String(data.filename).endsWith(".glb") ? { name: data.filename } : null);
  // Public share needs a GLB (or STEP) — never root the share on a regenerated 3MF.
  // Keep the early-minted shareFilename unless exports found a better same-stem GLB.
  const preferredShare = preferShareFilename(
    bakedGlb?.name || filename,
    data?.exports || exports,
    data?.filename,
  );
  if (preferredShare && !preparedShareUrl && !preparingShare) {
    shareFilename = preferredShare;
  } else if (preferredShare) {
    shareFilename = preferredShare;
  }
  if (data?.filename && data.filename !== filename && !/^(visible|project)\s+assembly$/i.test(String(data.filename))) {
    const titleEl = menu.querySelector(".file-export-title");
    if (titleEl && !title) titleEl.textContent = `Export ${data.filename}`;
  }

  if (extraExports.length) {
    exports = listedDownloadExports(collapseExportsToSingleStep([...exports, ...extraExports]));
  }

  if (fetchError && !(data?.exports?.length)) {
    list.innerHTML = "";
    exportsPreparing = false;
    setExportActionsPreparing(menu, false);
    const sourceMissing = Number(fetchError.status) === 404
      || /not found|never wrote|not on disk|never generated/i.test(String(fetchError.message || ""));
    if (sourceMissing) {
      statusEl.textContent = missingSourceDownloadMessage(filename, fetchError);
      statusEl.className = "file-export-status status error";
      keepMenuInViewport(menu);
      return;
    }
    exports = timeoutDownloadExports(filename);
    if (!exports.length) {
      statusEl.textContent = formatApiError(fetchError);
      statusEl.className = "file-export-status status error";
      keepMenuInViewport(menu);
      return;
    }
    // Current GLB/STEP is enough to share/download. Do not leave a permanent
    // "taking too long" banner on the export loading window.
    statusEl.remove();
  } else if (!exports.length) {
    list.innerHTML = "";
    exportsPreparing = false;
    setExportActionsPreparing(menu, false);
    statusEl.textContent = "No export files found for this model.";
    statusEl.className = "file-export-status status error";
    keepMenuInViewport(menu);
    return;
  } else {
    statusEl.remove();
    list.innerHTML = "";
    exportsPreparing = false;
    setExportActionsPreparing(menu, false);
  }

  const targetStem = fileStem(filename);
  const sorted = [...exports].sort(
    (a, b) =>
      exportPriority(a, targetStem) - exportPriority(b, targetStem)
      || EXPORT_ORDER.indexOf(a.format) - EXPORT_ORDER.indexOf(b.format)
      || a.name.localeCompare(b.name),
  );
  const isVisibleAssemblyExport = Boolean(exportsRequest)
    || /^(visible|project)\s+assembly$/i.test(String(filename || ""))
    || sorted.some((item) => String(item.name || "").startsWith("_export_visible_assembly"));
  // Prefer the visible-assembly bake. Never fall back to a sibling STEP
  // (that was uploading hidden arduino_uno_q while the gripper was showing).
  const isPartCache = (item) => /\.part\.step$/i.test(String(item?.name || "")) || /\.fusionpart\.step$/i.test(String(item?.name || ""));
  const cloudStep = isVisibleAssemblyExport
    ? (
      // Only the bake — never fall back to a random sibling STEP (arduino latch).
      sorted.find((item) => item.format === "step" && String(item.name || "").startsWith("_export_visible_assembly") && item.step_kind === "editable_brep" && !isPartCache(item))
      || sorted.find((item) => item.format === "step" && String(item.name || "").startsWith("_export_visible_assembly") && !/__faceted/i.test(String(item.name || "")) && !isPartCache(item))
      || sorted.find((item) => item.format === "step" && String(item.name || "").startsWith("_export_visible_assembly") && !/__faceted/i.test(String(item.name || "")))
      || null
    )
    : (
      sorted.find((item) => item.format === "step" && item.step_kind === "editable_brep" && !isPartCache(item) && (item.current || modelStem(item.name) === modelStem(targetStem)))
      || sorted.find((item) => item.format === "step" && !isPartCache(item) && !/__faceted/i.test(String(item.name || "")) && (item.current || modelStem(item.name) === modelStem(targetStem)))
      || sorted.find((item) => item.format === "step" && item.step_kind === "editable_brep" && (item.current || modelStem(item.name) === modelStem(targetStem)))
      || null
    );
  const resolvedCloudFilename = effectiveCloudFilename || cloudStep?.name || (
    isVisibleAssemblyExport
      ? (effectiveAllowedFilenames?.[0] ? String(effectiveAllowedFilenames[0]).replace(/\.[^.]+$/, ".step") : null)
      : filename
  );
  const resolvedCloudStepIsFaceted = Boolean(
    cloudStep?.step_kind === "faceted_mesh"
    || /__faceted/i.test(String(cloudStep?.name || resolvedCloudFilename || ""))
  );

  let visibleAllowList = [];
  try {
    const rawBody = exportsRequest?.options?.body;
    const parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    if (Array.isArray(parsed?.filenames)) visibleAllowList = parsed.filenames.map(String);
  } catch {
    visibleAllowList = [];
  }
  if (!visibleAllowList.length && Array.isArray(effectiveAllowedFilenames) && effectiveAllowedFilenames.length) {
    visibleAllowList = effectiveAllowedFilenames.map(String);
  }
  const fusionDestName = (() => {
    const raw = String(effectiveFusionUploadName || "").trim();
    if (raw) return raw.toLowerCase().endsWith(".step") || raw.toLowerCase().endsWith(".stp") ? raw : `${modelStem(raw)}.step`;
    if (visibleAllowList.length) return `${modelStem(visibleAllowList[0])}.step`;
    const cloud = String(resolvedCloudFilename || "");
    if (cloud && !cloud.startsWith("_export_visible_assembly")) return `${modelStem(cloud)}.step`;
    const base = String(filename || "");
    if (base && !/^(visible|project)\s+assembly$/i.test(base)) return `${modelStem(base)}.step`;
    return "model.step";
  })();

  const bakeGlbFn = typeof bakeAnimatedGlb === "function" ? bakeAnimatedGlb : animatedGlbBaker;
  const canBakeAnimatedGlb = typeof bakeGlbFn === "function" && (
    typeof animatedGlbAvailable !== "function"
    || animatedGlbAvailable({ filename, item: null })
  );

  for (const item of sorted) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-export-dl";
    btn.dataset.fmt = item.format;
    btn.dataset.current = item.current || fileStem(item.name) === targetStem ? "true" : "false";
    if (item.base) btn.dataset.base = "true";
    const sizeKb = item.size ? ` · ${Math.max(1, Math.round(item.size / 1024))} KB` : "";
    const label = exportLabel(item, targetStem, {
      animatedGlb: item.format === "glb" && canBakeAnimatedGlb,
    });
    btn.textContent = `${label}${sizeKb}`;
    btn.title = item.format === "glb" && canBakeAnimatedGlb
      ? `${item.name} — includes baked glTF animations for Blender`
      : item.name;
    btn.addEventListener("click", async (ev) => {
      try {
        if (item.format === "step" && item.step_kind === "faceted_mesh") {
          const ok = window.confirm(
            "This STEP was generated from mesh triangles, so Fusion may import it but boolean Cut may fail. Download it anyway?"
          );
          if (!ok) return;
        }
        if (item.format === "step") {
          showStepModeChooser(menu, item, async (mode, picked) => {
            try {
              const chooser = menu.querySelector(".file-export-step-chooser");
              chooser?.querySelectorAll("button")?.forEach((b) => (b.disabled = true));
              const title = chooser?.querySelector(".file-export-step-title");
              if (title) title.textContent = mode === "assembly" ? "Preparing assembly STEP…" : "Preparing Part STEP…";
              const url = stepDownloadUrl(projectId, picked, mode);
              const dlName = picked.download_name || fusionDestName || `${modelStem(picked.name)}.step`;
              await downloadFile(url, dlName);
              chooser?.remove();
            } catch (err) {
              showExportError(menu, err, { title: "Download failed" });
              menu.querySelector(".file-export-step-chooser")?.querySelectorAll("button")?.forEach((b) => (b.disabled = false));
            }
          }, btn, ev);
          return;
        }
        if (item.format === "glb" && typeof bakeGlbFn === "function" && canBakeAnimatedGlb) {
          const prevLabel = btn.innerHTML;
          btn.disabled = true;
          btn.classList.add("is-preparing");
          btn.setAttribute("aria-busy", "true");
          btn.innerHTML = `<span class="file-export-spinner" aria-hidden="true"></span>Baking animation…`;
          try {
            const baked = await bakeGlbFn({ filename, item });
            if (baked?.blob) {
              const dlName = baked.filename || item.name.replace(/\.glb$/i, "_animated.glb") || "model_animated.glb";
              triggerTrackedBlobDownload(baked.blob, dlName, fileDownloadCreated);
              return;
            }
          } finally {
            btn.disabled = false;
            btn.classList.remove("is-preparing");
            btn.removeAttribute("aria-busy");
            btn.innerHTML = prevLabel;
          }
          // Fall through to server GLB if baker returns null (no animation on this mesh).
        }
        const url = item.url || projectFileApiPath(projectId, item.name);
        let dlName = item.format === "3mf"
          ? item.name.replace(/\.3mf$/i, ".3MF")
          : item.name;
        if (item.format === "3mf") {
          let visibleBodyIndices = null;
          try {
            if (typeof getVisibleBodyIndices === "function") {
              visibleBodyIndices = getVisibleBodyIndices();
            }
          } catch {
            visibleBodyIndices = null;
          }
          if (Array.isArray(visibleBodyIndices) && visibleBodyIndices.length === 0) {
            throw new Error("No visible parts to export. Unhide at least one body with the eye icon.");
          }
          const bodyCount = Array.isArray(visibleBodyIndices) ? visibleBodyIndices.length : null;
          const preparing3mf = (bodyCount == null || bodyCount > 1)
            ? "Preparing assembly…"
            : "Preparing 3MF…";
          const prevLabel = btn.innerHTML;
          btn.disabled = true;
          btn.classList.add("is-preparing");
          btn.setAttribute("aria-busy", "true");
          btn.innerHTML = `<span class="file-export-spinner" aria-hidden="true"></span>${preparing3mf}`;
          try {
            const refreshed = await ensureThreeMfExport({
              projectId,
              filename: shareFilename || filename,
              exports: sorted,
              forceRefresh: true,
              visibleBodyIndices,
            });
            if (refreshed?.name) {
              dlName = refreshed.name.replace(/\.3mf$/i, ".3MF");
              await downloadFile(
                projectFileApiPath(projectId, refreshed.name),
                dlName,
              );
              return;
            }
          } finally {
            btn.disabled = false;
            btn.classList.remove("is-preparing");
            btn.removeAttribute("aria-busy");
            btn.innerHTML = prevLabel;
          }
        }
        await downloadFile(url, dlName);
      } catch (err) {
        showExportError(menu, err, { title: "Download failed" });
      }
    });
    list.appendChild(btn);
  }

  if (data?.joint_export_url && data?.joint_count) {
    const jointDownload = document.createElement("button");
    jointDownload.type = "button";
    jointDownload.className = "file-export-dl";
    jointDownload.textContent = `STEP + joints · ${data.joint_count}`;
    jointDownload.title = "STEP geometry + joint definitions + compatibility report + validated FreeCAD assembly when available. Fusion requires the included importer; Onshape/SolidWorks mates require separate setup.";
    jointDownload.addEventListener("click", async () => {
      jointDownload.disabled = true;
      try {
        await downloadFile(data.joint_export_url, `${modelStem(filename)}-joints.zip`);
      } catch (err) {
        showExportError(menu, err, { title: "Joint package download failed" });
      } finally {
        jointDownload.disabled = false;
      }
    });
    list.appendChild(jointDownload);
    const jointNotice = document.createElement("small");
    jointNotice.textContent = "STEP alone transfers geometry, not native mates. The joints package includes compatibility details; Onshape and SolidWorks need mate setup.";
    jointNotice.style.cssText = "display:block;padding:5px 10px;color:var(--muted,#9ca3af);line-height:1.4";
    list.appendChild(jointNotice);
  }

  async function onshapeAction(btn, endpoint, body, resetLabel) {
    btn.disabled = true;
    btn.innerHTML = `<img src="/cad/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" /> Working…`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `Failed (${res.status})`);
      }
      const data = await res.json();
      btn.innerHTML = `<img src="/cad/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" /> Opened in Onshape ✓`;
      if (data.joint_instructions) {
        statusEl.textContent = data.joint_instructions;
        statusEl.className = "file-export-status status";
      }
      window.open(data.url, "_blank", "noopener");
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<img src="/cad/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" /> ${resetLabel}`;
      showExportError(menu, err, {
        title: "Onshape action failed",
        onRetry: () => onshapeAction(btn, endpoint, body, resetLabel),
      });
    }
  }

  function showFusionStepModeChooser(onChoose, anchorEl = null) {
    // Fusion Part STEP (flattened) so Extrude/Cut works on linked assemblies.
    onChoose?.("part");
  }

  let fusionStepMode = "part";

  const isThreeMfFusionUpload = /\.3mf$/i.test(String(effectiveCloudFilename || filename || ""));
  // Prefer native editable STEP of the export target — never a sibling model.
  let fusionUploadFilename = isThreeMfFusionUpload
    ? String(effectiveCloudFilename || filename)
    : resolvedCloudFilename;

  // If caller passed an explicit STEP cloudFilename, always use it for Fusion.
  if (!isThreeMfFusionUpload && effectiveCloudFilename && /\.ste?p$/i.test(String(effectiveCloudFilename))) {
    fusionUploadFilename = String(effectiveCloudFilename);
  }

  // Never Fusion-push a file outside the visible allow-list (blocks hidden Arduino).
  if (visibleAllowList.length && fusionUploadFilename) {
    const allowStems = new Set(visibleAllowList.map((n) => modelStem(n).toLowerCase()));
    const uploadStem = modelStem(fusionUploadFilename).toLowerCase();
    const isBake = String(fusionUploadFilename).startsWith("_export_visible_assembly");
    if (!isBake && uploadStem && !allowStems.has(uploadStem)) {
      const fallback = visibleAllowList[0];
      fusionUploadFilename = String(fallback || "").replace(/\.[^.]+$/, ".step");
    }
  }
  // Prefer bake STEP as the bytes source; Fusion *display* name is the visible part.
  if (isVisibleAssemblyExport) {
    const bake = sorted.find((item) => item.format === "step" && String(item.name || "").startsWith("_export_visible_assembly") && !/__faceted/i.test(String(item.name || "")));
    if (bake?.name) fusionUploadFilename = bake.name;
    else if (!fusionUploadFilename && visibleAllowList.length) {
      fusionUploadFilename = String(visibleAllowList[0]).replace(/\.[^.]+$/, ".step");
    }
  }
  if (!fusionUploadFilename && visibleAllowList.length) {
    fusionUploadFilename = String(visibleAllowList[0]).replace(/\.[^.]+$/, ".step");
  }
  // Never upload faceted mesh STEP to Fusion (not Extrude/Cut editable).
  if (fusionUploadFilename && /__faceted/i.test(String(fusionUploadFilename))) {
    fusionUploadFilename = String(fusionUploadFilename).replace(/__faceted/i, "");
  }
  if (fusionUploadFilename && !/\.(step|stp|3mf)$/i.test(String(fusionUploadFilename))) {
    fusionUploadFilename = withDirSiblingExt(fusionUploadFilename, "step");
  }

  // Fusion push: Part STEP for Extrude/Cut; no companion .py.
  let fusionPushInFlight = false;
  function fusionPushBody(extra = {}) {
    const body = {
      filename: fusionUploadFilename,
      name: fusionDestName,
      allow_faceted_step: resolvedCloudStepIsFaceted,
      step_mode: fusionStepMode || "part",
      upload_source: false,
      ...extra,
    };
    if (isThreeMfFusionUpload) {
      body.format = "3mf";
    }
    if (visibleAllowList.length) {
      body.allowed_filenames = visibleAllowList;
      body.visible_filenames = visibleAllowList;
    }
    return body;
  }

  async function pushToOriginalFusion(btn) {
    if (!fusionUploadFilename) {
      showExportError(menu, new Error("No STEP/3MF prepared for Fusion. Try Export again."), {
        title: "Nothing to send to Fusion",
        onRetry: null,
      });
      return;
    }
    if (fusionPushInFlight) return;
    fusionPushInFlight = true;
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<img src="/cad/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Pushing…`;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/push-to-autodesk`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(fusionPushBody()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Fusion push failed (${res.status})`);
      }
      const data = await res.json();
      btn.innerHTML = `<img src="/cad/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Pushed to Fusion ✓`;
      const sourceNote = data.source_upload?.name ? ` Also uploaded ${data.source_upload.name}.` : "";
      const mirrorCount = data.pushed_mirrors?.length || 0;
      const mirrorErrors = data.push_errors?.length || 0;
      const mirrorNote = mirrorErrors
        ? ` Pushed to ${mirrorCount} teammate mirror${mirrorCount === 1 ? "" : "s"}; ${mirrorErrors} mirror push failed.`
        : mirrorCount
          ? ` Also pushed to ${mirrorCount} teammate mirror${mirrorCount === 1 ? "" : "s"}.`
          : "";
      const openHint = String(data.open_instructions || "").trim()
        || (
          (fusionStepMode || "part") === "part"
            ? "In Fusion Data Panel: Open this file (do not Insert into another design). If you see a chain-link component, Break Link first — then Extrude/Cut."
            : ""
        );
      const partName = data.name || fusionUploadFilename;
      showExportSuccess(
        menu,
        `Pushed Part “${partName}” to Fusion.${sourceNote}${mirrorNote} Refresh the Data Panel, then Open it.${openHint ? ` ${openHint}` : ""}`,
      );
      void maybeShowFusionUnlinkHowto();
    } catch (err) {
      fusionPushInFlight = false;
      btn.disabled = false;
      btn.innerHTML = original;
      const needsFolder = /Link a Fusion mirror folder|aps_project_id|folder_id/i.test(String(err?.message || ""));
      showExportError(menu, err, {
        title: "Fusion push failed",
        onRetry: needsFolder ? null : () => pushToOriginalFusion(btn),
      });
      if (needsFolder) {
        window.setTimeout(() => {
          void openSharedFusionExport(btn);
        }, 900);
      }
    }
  }

  async function openSharedFusionExport(btn) {
    if (!fusionUploadFilename) {
      showExportError(menu, new Error("No STEP/3MF prepared for Fusion. Try Export again."), {
        title: "Nothing to send to Fusion",
        onRetry: null,
      });
      return;
    }
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<img src="/cad/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Loading Fusion…`;
    try {
      await showFusionExportPicker(menu, btn, {
        projectId,
        filename: fusionUploadFilename,
        uploadName: fusionDestName,
        allowFacetedStep: resolvedCloudStepIsFaceted,
        format: isThreeMfFusionUpload ? "3mf" : "step",
        allowedFilenames: visibleAllowList,
        stepMode: fusionStepMode,
      });
    } catch (err) {
      showExportError(menu, err, {
        title: "Could not open Fusion export picker",
        onRetry: () => openSharedFusionExport(btn),
      });
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  async function onFusionActionClick() {
    // Update-original only when a Fusion item is linked; Shared folder/link only
    // when there is an uploadable STEP/3MF. One action → run it (no chooser card).
    const source = autodeskSource || {};
    const allowPush = Boolean(source.item_id);
    const allowShared = Boolean(
      fusionUploadFilename
      && /\.(step|stp|3mf)$/i.test(String(fusionUploadFilename))
    );
    if (!allowPush && !allowShared) {
      showExportError(menu, new Error("No Fusion file or STEP/3MF available to export."), {
        title: "Nothing to send to Fusion",
        onRetry: null,
      });
      return;
    }
    const afterStepMode = (stepMode) => {
      fusionStepMode = "part";
      showFusionActionChooser(menu, (choice) => {
        if (choice === "push") void pushToOriginalFusion(fusionActionBtn);
        else void openSharedFusionExport(fusionActionBtn);
      }, fusionActionBtn, { allowPush, allowShared });
    };
    afterStepMode("part");
  }

  slicerChangeBtn?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    showSlicerPicker(menu, {
      title: "Choose your slicer",
      subtitle: "This becomes your default for every export.",
      onChosen: (slicer) => syncSlicerExportButton(slicer),
    });
  });

  slicerBtn?.addEventListener("click", async () => {
    if (!hasChosenSlicer()) {
      showSlicerPicker(menu, {
        title: "Choose your slicer",
        subtitle: "Pick once — we’ll use it for every export.",
        requireChoice: true,
        onChosen: async (slicer) => {
          syncSlicerExportButton(slicer);
          let visibleBodyIndices = null;
          try {
            if (typeof getVisibleBodyIndices === "function") {
              visibleBodyIndices = getVisibleBodyIndices();
            }
          } catch {
            visibleBodyIndices = null;
          }
          await sendToPreferredSlicer({
            btn: slicerBtn,
            projectId,
            filename,
            exports: sorted,
            visibleBodyIndices,
          });
        },
      });
      return;
    }
    let visibleBodyIndices = null;
    try {
      if (typeof getVisibleBodyIndices === "function") {
        visibleBodyIndices = getVisibleBodyIndices();
      }
    } catch {
      visibleBodyIndices = null;
    }
    await sendToPreferredSlicer({
      btn: slicerBtn,
      projectId,
      filename,
      exports: sorted,
      visibleBodyIndices,
    });
  });

  if (!mobile) {
    const rect2 = anchorEl.getBoundingClientRect();
    menu.style.top = `${Math.min(rect2.bottom + 6, window.innerHeight - Math.max(220, menu.offsetHeight + 12))}px`;
  }
  keepMenuInViewport(menu);

  let cadActionsWired = false;
  function wireCadExportActions() {
    if (cadActionsWired || openMenu !== menu || !cadButtonsReady) return;
    cadActionsWired = true;
    onshapeBtn = menu.querySelector(".file-export-onshape:not(.file-export-onshape-push)");
    pushBtn = menu.querySelector(".file-export-onshape-push");
    fusionActionBtn = menu.querySelector(".file-export-fusion-action");
    onshapeBtn?.addEventListener("click", () =>
      onshapeAction(
        onshapeBtn,
        `${projectFileApiPath(projectId, resolvedCloudFilename)}/export-to-onshape`,
        { allow_faceted_step: resolvedCloudStepIsFaceted },
        "Export to Onshape",
      )
    );
    pushBtn?.addEventListener("click", () =>
      onshapeAction(
        pushBtn,
        `/api/projects/${encodeURIComponent(projectId)}/push-to-onshape`,
        { filename: resolvedCloudFilename, allow_faceted_step: resolvedCloudStepIsFaceted },
        "Push to Onshape",
      )
    );
    fusionActionBtn?.addEventListener("click", () => { void onFusionActionClick(); });
  }
  void cadLinksPromise.then(() => {
    wireCadExportActions();
    if (autoAction === "fusion" || autoAction === "onshape") {
      requestAnimationFrame(() => {
        if (autoAction === "fusion") fusionActionBtn?.click();
        else if (autoAction === "onshape") (onshapeBtn || pushBtn)?.click();
      });
    }
  });

  if (autoAction === "bambu" || autoAction === "slicer" || autoAction === "download") {
    requestAnimationFrame(() => {
      if (autoAction === "bambu" || autoAction === "slicer") slicerBtn?.click();
      else if (autoAction === "download") list?.querySelector(".file-export-dl")?.click();
    });
  }
}

function detectClientOs() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(platform)) return "macos";
  if (/Win/i.test(ua) || /Win/i.test(platform)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "windows";
}

function isMobileClient() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  try {
    if (window.matchMedia?.("(pointer: coarse)").matches && window.matchMedia("(max-width: 1024px)").matches) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function isIosClient() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "")
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroidClient() {
  return /Android/i.test(navigator.userAgent || "");
}

function bambuTargetLabel() {
  return isMobileClient() ? "Bambu Handy" : "Bambu Studio";
}

function launchSlicerProtocol(url) {
  if (!url) return;
  try {
    window.location.href = url;
    return;
  } catch {
    /* fall through */
  }
  const opener = document.createElement("a");
  opener.href = url;
  opener.rel = "noopener";
  opener.style.display = "none";
  document.body.appendChild(opener);
  opener.click();
  opener.remove();
}

/** @deprecated use launchSlicerProtocol */
function launchBambuProtocol(url) {
  launchSlicerProtocol(url);
}

function slicerLogoHtml(slicer, size = 18) {
  if (!slicer?.logo) {
    return `<span class="file-export-bambu-mark" aria-hidden="true">${escText((slicer?.shortName || "?").slice(0, 1))}</span>`;
  }
  return `<img class="file-export-slicer-logo" src="${escAttr(slicer.logo)}" width="${size}" height="${size}" alt="" />`;
}

function showSlicerPicker(menu, {
  title = "Choose your slicer",
  subtitle = "We’ll remember this for every export.",
  requireChoice = false,
  onChosen = null,
} = {}) {
  if (!menu) return;
  menu.querySelector(".file-export-slicer-picker")?.remove();
  const currentId = getPreferredSlicerId();
  const panel = document.createElement("div");
  panel.className = "file-export-slicer-picker";
  panel.innerHTML = `
    <div class="file-export-slicer-picker-head">
      <div>
        <div class="file-export-slicer-picker-title">${escText(title)}</div>
        <p class="muted small file-export-slicer-picker-sub">${escText(subtitle)}</p>
      </div>
      ${requireChoice ? "" : `<button type="button" class="file-export-slicer-picker-close" data-slicer-picker-close aria-label="Close">&times;</button>`}
    </div>
    <div class="file-export-slicer-grid" role="listbox" aria-label="Slicers">
      ${SLICERS.map((s) => `
        <button type="button" class="file-export-slicer-option${s.id === currentId ? " is-selected" : ""}"
          role="option" aria-selected="${s.id === currentId ? "true" : "false"}"
          data-slicer-id="${escAttr(s.id)}" style="--slicer-accent:${escAttr(s.accent)}">
          <img src="${escAttr(s.logo)}" width="28" height="28" alt="" />
          <span class="file-export-slicer-option-name">${escText(s.name)}</span>
          ${s.protocolOpen ? `<span class="file-export-slicer-option-meta muted">Opens app</span>` : `<span class="file-export-slicer-option-meta muted">Downloads 3MF</span>`}
        </button>
      `).join("")}
    </div>
  `;
  panel.querySelector("[data-slicer-picker-close]")?.addEventListener("click", () => {
    panel.remove();
    keepMenuInViewport(menu);
  });
  panel.querySelectorAll("[data-slicer-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slicer = setPreferredSlicerId(btn.getAttribute("data-slicer-id"));
      if (!slicer) return;
      panel.remove();
      onChosen?.(slicer);
      keepMenuInViewport(menu);
    });
  });
  const actions = menu.querySelector(".file-export-actions");
  if (actions) actions.insertAdjacentElement("beforebegin", panel);
  else menu.appendChild(panel);
  keepMenuInViewport(menu);
}

async function shareThreeMfToApps(fileUrl, filename, shareText = "Open in your slicer to print") {
  if (!navigator.share) return false;
  try {
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Could not fetch 3MF (${res.status})`);
    const blob = await res.blob();
    const type = blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : "model/3mf";
    const file = new File([blob], filename, { type });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: filename,
        text: shareText,
        url: fileUrl,
      });
      return true;
    }
    await navigator.share({
      files: [file],
      title: filename,
      text: shareText,
    });
    return true;
  } catch (err) {
    if (String(err?.name || "") === "AbortError") return true;
    return false;
  }
}

async function ensureThreeMfExport({
  projectId,
  filename,
  exports,
  forceRefresh = false,
  visibleBodyIndices = null,
}) {
  let threeMf = !forceRefresh && visibleBodyIndices == null
    ? (
      (exports || []).find((item) => String(item.format || "").toLowerCase() === "3mf")
      || (exports || []).find((item) => /\.3mf$/i.test(item.name || ""))
    )
    : null;

  // Always regenerate when sending to a slicer so the 3MF is plate-seated (Z=0) and fresh.
  let printProfile = null;
  if (bambuProfileApplyEnabled()) {
    try {
      const snap = await fetch("/api/context-lab", { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null));
      printProfile = snap?.default_print_profile || null;
    } catch { printProfile = null; }
  }
  const regenBody = {};
  if (visibleBodyIndices != null) regenBody.visible_body_indices = visibleBodyIndices;
  if (printProfile) {
    regenBody.print_profile = {
      filament: printProfile.filament,
      supports_enabled: !!printProfile.supports_enabled,
    };
  }
  const hasBody = Object.keys(regenBody).length > 0;
  const regenRes = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeProjectFilePath(filename)}/exports/regenerate`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(regenBody) : undefined,
    },
  );
  if (!regenRes.ok) {
    const data = await regenRes.json().catch(() => ({}));
    const detail = data.detail || `Could not prepare 3MF export (${regenRes.status})`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeProjectFilePath(filename)}/exports`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Could not prepare 3MF export (${res.status})`);
  }
  const data = await res.json();
  threeMf = (data.exports || []).find((item) => String(item.format || "").toLowerCase() === "3mf")
    || (data.exports || []).find((item) => /\.3mf$/i.test(item.name || ""))
    || threeMf;
  if (!threeMf?.name) {
    throw new Error("No 3MF is available for this model yet. Download STL instead, or regenerate the model.");
  }
  return threeMf;
}

async function sendToPreferredSlicer({ btn, projectId, filename, exports, visibleBodyIndices = null }) {
  if (!btn) return;
  const menu = btn.closest(".file-export-menu");
  const slicer = getPreferredSlicer();
  if (!slicer) {
    showSlicerPicker(menu, {
      title: "Choose your slicer",
      subtitle: "Pick once — we’ll use it for every export.",
      requireChoice: true,
      onChosen: () => sendToPreferredSlicer({ btn, projectId, filename, exports, visibleBodyIndices }),
    });
    return;
  }

  const original = btn.innerHTML;
  const mobile = isMobileClient();
  const target = slicerExportLabel(slicer, { mobile }).replace(/^Export to\s+/i, "");
  const bodyCount = Array.isArray(visibleBodyIndices) ? visibleBodyIndices.length : null;
  const isAssembly = bodyCount == null || bodyCount > 1;
  const preparingLabel = isAssembly ? "Preparing assembly…" : "Preparing 3MF…";
  btn.disabled = true;
  btn.classList.add("is-preparing");
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `<span class="file-export-spinner" aria-hidden="true"></span><span>${preparingLabel}</span>`;
  try {
    if (!getToken()) {
      throw new Error(`Not authenticated. Sign in to create the temporary 3MF share link ${target} needs.`);
    }
    if (Array.isArray(visibleBodyIndices) && visibleBodyIndices.length === 0) {
      throw new Error("No visible parts to send. Unhide at least one body with the eye icon, then try again.");
    }
    const threeMf = await ensureThreeMfExport({
      projectId,
      filename,
      exports,
      forceRefresh: true,
      visibleBodyIndices,
    });
    btn.innerHTML = `<span class="file-export-spinner" aria-hidden="true"></span><span>Creating share link…</span>`;
    const shareRes = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeProjectFilePath(threeMf.name)}/share`,
      {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        // The slicer is a separate native process with no Render Studio login.
        // Give this one generated artifact a fresh downloadable share instead
        // of reusing the model's view-only preview token (which returns 403).
        body: JSON.stringify({ force_new: true, allow_download: true }),
      },
    );
    if (!shareRes.ok) {
      const data = await shareRes.json().catch(() => ({}));
      throw new Error(data.detail || `Could not create a public 3MF link (${shareRes.status})`);
    }
    const share = await shareRes.json();
    const token = share.token;
    if (!token || !share.file_url) throw new Error(`Could not create a public 3MF link for ${target}.`);

    const safeName = String(threeMf.name || "model.3mf").replace(/\.3MF$/i, ".3mf");
    const fileUrl = share.file_url;
    const urls = slicerOpenUrls(slicer, fileUrl);
    const os = detectClientOs();

    if (mobile) {
      btn.innerHTML = `<span class="file-export-spinner" aria-hidden="true"></span><span>Sending…</span>`;
      const shared = await shareThreeMfToApps(fileUrl, safeName, `Open in ${slicer.name}`);
      if (!shared) {
        try {
          await downloadFile(fileUrl, safeName);
        } catch {
          /* non-fatal */
        }
      }
      if (slicer.mobileHandy) {
        if (isAndroidClient()) launchSlicerProtocol(urls.handyAndroid || urls.handy);
        else launchSlicerProtocol(urls.handyIos || urls.handy);
      }
      btn.classList.remove("is-preparing");
      btn.removeAttribute("aria-busy");
      btn.innerHTML = `${slicerLogoHtml(slicer)} Sent ✓`;
      showSlicerFollowUp(btn, { slicer, urls, os, fileUrl, threeMfName: safeName, mobile: true });
    } else {
      const canProtocol = canOpenRemoteSlicerUrl(slicer, os, urls);
      if (!canProtocol) {
        try {
          await downloadFile(fileUrl, safeName);
        } catch {
          /* The follow-up still offers a manual download. */
        }
      }

      btn.classList.remove("is-preparing");
      btn.removeAttribute("aria-busy");
      btn.innerHTML = canProtocol
        ? `${slicerLogoHtml(slicer)} Open ${escText(slicer.shortName)}…`
        : `${slicerLogoHtml(slicer)} 3MF downloaded ✓`;
      showSlicerFollowUp(btn, {
        slicer,
        urls,
        os,
        fileUrl,
        threeMfName: safeName,
        mobile: false,
        canProtocol,
      });
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove("is-preparing");
      btn.removeAttribute("aria-busy");
      if (!btn.dataset.slicerFollowup) btn.innerHTML = original;
    }, 1600);
  } catch (err) {
    btn.disabled = false;
    btn.classList.remove("is-preparing");
    btn.removeAttribute("aria-busy");
    btn.innerHTML = original;
    showExportError(menu, err, {
      title: `Could not export to ${target}`,
      onRetry: () => sendToPreferredSlicer({ btn, projectId, filename, exports, visibleBodyIndices }),
    });
  }
}

/** Back-compat alias */
async function sendToBambuStudio(opts) {
  if (!getPreferredSlicerId()) setPreferredSlicerId("bambu");
  return sendToPreferredSlicer(opts);
}

function showSlicerFollowUp(btn, {
  slicer,
  urls,
  os,
  fileUrl,
  threeMfName,
  mobile = false,
  canProtocol = canOpenRemoteSlicerUrl(slicer, os, urls),
}) {
  const menu = btn.closest(".file-export-menu");
  if (!menu) return;
  menu.querySelector(".file-export-bambu-followup")?.remove();
  const panel = document.createElement("div");
  panel.className = "file-export-bambu-followup file-export-slicer-followup";
  panel.style.setProperty("--slicer-accent", slicer.accent);
  const name = slicer.name;
  const displayName = String(threeMfName || "model.3mf").split(/[\\/]/).pop() || "model.3mf";

  if (mobile) {
    const store = slicer.mobileHandy
      ? (isIosClient() ? urls.handyAppStore : urls.handyPlayStore)
      : (slicer.homepage || "");
    panel.innerHTML = `
      <p><strong>${escText(threeMfName)}</strong> is ready for ${escText(name)}.</p>
      <p class="muted small">Use the share sheet and pick <strong>${escText(name)}</strong>, or open the downloaded 3MF from Files.</p>
      <div class="file-export-bambu-followup-actions">
        <button type="button" class="btn secondary btn-compact" data-slicer-share>Share again</button>
        <button type="button" class="btn secondary btn-compact" data-slicer-download>Download 3MF</button>
        ${store ? `<a class="btn secondary btn-compact" href="${escAttr(store)}" target="_blank" rel="noopener">Get ${escText(slicer.shortName)}</a>` : ""}
      </div>
    `;
    panel.querySelector("[data-slicer-share]")?.addEventListener("click", async () => {
      const ok = await shareThreeMfToApps(fileUrl, threeMfName, `Open in ${name}`);
      if (!ok) {
        try {
          await downloadFile(fileUrl, threeMfName);
        } catch (err) {
          showExportError(menu, err, { title: "3MF share failed" });
        }
      }
    });
  } else if (canProtocol) {
    const primary = urls[os] || urls.windows || urls.macos;
    const alt = os === "macos"
      ? (urls.macosAlt || urls.windowsPlain || urls.windows)
      : (urls.macosPlain || urls.macos);
    const encodedPrimary = os === "macos" ? urls.macosEncoded : (urls[`${os}Encoded`] || urls.windowsEncoded);
    const openHref = encodedPrimary || primary;
    panel.innerHTML = `
      <div class="file-export-slicer-followup-head">
        <span class="file-export-slicer-followup-check" aria-hidden="true">✓</span>
        <div>
          <strong>Open in ${escText(name)} on this device?</strong>
          <div class="file-export-slicer-filename" title="${escAttr(threeMfName)}">${escText(displayName)}</div>
        </div>
      </div>
      <p class="muted small">Your plate-packed 3MF is ready. Your browser may ask permission to open the installed app on this device.</p>
      <div class="file-export-bambu-followup-actions">
        <a class="btn btn-compact file-export-slicer-open" data-slicer-open href="${escAttr(openHref)}">Open ${escText(name)}</a>
        <button type="button" class="btn secondary btn-compact" data-slicer-alt>Alternate open</button>
        <button type="button" class="btn secondary btn-compact" data-slicer-download>Download 3MF</button>
        <button type="button" class="btn secondary btn-compact" data-slicer-change>Change slicer</button>
      </div>
    `;
    panel.querySelector("[data-slicer-alt]")?.addEventListener("click", () => {
      launchSlicerProtocol(alt);
    });
  } else {
    panel.innerHTML = `
      <p><strong>${escText(threeMfName)}</strong> downloaded for ${escText(name)}.</p>
      <p class="muted small">${escText(name)} doesn’t support one-click open from the browser — import the 3MF from your Downloads folder.</p>
      <div class="file-export-bambu-followup-actions">
        <button type="button" class="btn secondary btn-compact" data-slicer-download>Download 3MF again</button>
        ${slicer.homepage ? `<a class="btn secondary btn-compact" href="${escAttr(slicer.homepage)}" target="_blank" rel="noopener">Get ${escText(slicer.shortName)}</a>` : ""}
        <button type="button" class="btn secondary btn-compact" data-slicer-change>Change slicer</button>
      </div>
    `;
  }

  panel.querySelector("[data-slicer-download]")?.addEventListener("click", async () => {
    try {
      await downloadFile(fileUrl, threeMfName);
    } catch (err) {
      showExportError(menu, err, { title: "3MF download failed" });
    }
  });
  panel.querySelector("[data-slicer-change]")?.addEventListener("click", () => {
    showSlicerPicker(menu, {
      title: "Choose your slicer",
      subtitle: "This becomes your default for every export.",
    });
  });
  btn.dataset.slicerFollowup = "1";
  btn.dataset.bambuFollowup = "1";
  const slicerRow = btn.closest(".file-export-slicer-row");
  (slicerRow || btn).insertAdjacentElement("afterend", panel);
  keepMenuInViewport(menu);
}

function showBambuFollowUp(btn, opts) {
  const slicer = getSlicerById("bambu") || getPreferredSlicer();
  return showSlicerFollowUp(btn, { ...opts, slicer });
}

async function showFusionExportPicker(menu, anchorBtn, {
  projectId,
  filename,
  uploadName = null,
  allowFacetedStep = false,
  format = "step",
  allowedFilenames = [],
  stepMode = "part",
}) {
  menu.querySelector(".file-export-fusion-picker")?.remove();
  const picker = document.createElement("div");
  picker.className = "file-export-fusion-picker";
  const isThreeMf = format === "3mf" || /\.3mf$/i.test(String(filename || ""));
  const uploadLabel = isThreeMf ? "3MF" : "STEP";
  picker.innerHTML = `
    <button type="button" class="file-export-fusion-close" data-fusion-close aria-label="Close Fusion export">&times;</button>
    <div class="file-export-fusion-title">Export to Fusion 360</div>
    <div class="file-export-fusion-picker-body">
      <p class="muted small file-export-fusion-lead">Pick a hub, project, and folder, then export once.</p>
      ${allowFacetedStep && !isThreeMf ? '<p class="status error small">Only faceted mesh STEP is available for this model. Export will work, but Fusion boolean Cut may be limited.</p>' : ""}
      ${isThreeMf ? '<p class="muted small">This file is 3MF — it will upload as 3MF for Fusion mesh import.</p>' : ""}
      <label class="file-export-cloud-field">
        <span>Hub</span>
        <select data-fusion-hub disabled><option>Loading hubs...</option></select>
      </label>
      <div class="file-export-cloud-field">
        <span>Project</span>
        <div class="file-export-fusion-project-tools">
          <input type="search" data-fusion-project-search placeholder="Search Fusion projects…" autocomplete="off" disabled />
          <select data-fusion-project class="file-export-fusion-project-select" disabled aria-label="Fusion project">
            <option value="">Select a hub first</option>
          </select>
        </div>
        <div class="file-export-fusion-project-grid" data-fusion-project-grid>
          <p class="muted small">Select a hub to load projects.</p>
        </div>
      </div>
      <div class="file-export-cloud-field">
        <span>Folder</span>
        <div class="file-export-fusion-folder-browser" data-fusion-folder-browser>
          <p class="muted small">Select a project first.</p>
        </div>
      </div>
    </div>
    <div class="file-export-fusion-footer">
      <p class="file-export-fusion-dest" data-fusion-dest>Pick a folder above, then export.</p>
      <button type="button" class="btn file-export-fusion-submit" disabled>Export to Fusion</button>
      <div class="file-export-fusion-status muted small"></div>
    </div>
  `;
  // Must be a direct child of the export menu so the sticky footer isn't clipped
  // inside .file-export-actions (that was hiding "Export to Fusion").
  menu.appendChild(picker);
  menu.classList.add("has-fusion-picker");
  picker.scrollIntoView({ block: "nearest" });
  keepMenuInViewport(menu);

  picker.querySelector("[data-fusion-close]")?.addEventListener("click", () => {
    picker.remove();
    menu.classList.remove("has-fusion-picker");
    keepMenuInViewport(menu);
  });

  const hubSelect = picker.querySelector("[data-fusion-hub]");
  const projectSelect = picker.querySelector("[data-fusion-project]");
  const projectSearch = picker.querySelector("[data-fusion-project-search]");
  const projectGrid = picker.querySelector("[data-fusion-project-grid]");
  const folderBrowser = picker.querySelector("[data-fusion-folder-browser]");
  const submit = picker.querySelector(".file-export-fusion-submit");
  const status = picker.querySelector(".file-export-fusion-status");
  const destLabel = picker.querySelector("[data-fusion-dest]");
  let currentFolder = null;
  let folderStack = [];
  let selectedFolderId = "";
  let selectedFolderName = "";
  let allProjects = [];
  let lastFolderList = [];
  let lastFolderItems = [];
  // Never auto-pick a folder past project root — user must click to select.

  const askReplaceOrNew = (existingName) => new Promise((resolve) => {
    menu.querySelector(".file-export-fusion-conflict")?.remove();
    const stem = String(existingName || "model").replace(/(\.[^.]+)$/, "");
    const ext = (String(existingName || "").match(/(\.[^.]+)$/) || [".step"])[0];
    const card = document.createElement("div");
    // Overlay on the picker — picker uses overflow:hidden, so appending at the
    // bottom used to clip this dialog while status still said “Uploading…”.
    card.className = "file-export-step-chooser file-export-fusion-conflict";
    card.innerHTML = `
      <button type="button" class="file-export-fusion-close" data-fusion-close aria-label="Close">&times;</button>
      <div class="file-export-step-title">“${escText(existingName)}” already exists in this folder</div>
      <p class="muted small" style="margin:0 0 4px">Choose how to continue — upload has not started yet.</p>
      <button type="button" class="file-export-step-choice" data-conflict="replace">
        <strong>Replace</strong>
        <span>Upload a new version of the existing Fusion file</span>
      </button>
      <button type="button" class="file-export-step-choice" data-conflict="new">
        <strong>Create new file</strong>
        <span>Keep the old one and upload as “${escText(`${stem} (2)${ext}`)}”</span>
      </button>
    `;
    const finish = (mode) => {
      card.remove();
      resolve(mode);
    };
    card.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-fusion-close]")) return finish(null);
      const btn = ev.target.closest("[data-conflict]");
      if (!btn) return;
      finish(btn.dataset.conflict || "replace");
    });
    picker.appendChild(card);
    setStatus(`“${existingName}” already exists — choose Replace or Create new.`);
    keepMenuInViewport(menu);
  });

  const findExistingFolderItem = (uploadName) => {
    const needle = String(uploadName || "").toLowerCase();
    return (lastFolderItems || []).find((item) => String(item?.name || "").toLowerCase() === needle) || null;
  };

  const LAST_KEY = "render3d:lastFusionExportTarget";
  const readLastTarget = () => {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) || "null") || null;
    } catch {
      return null;
    }
  };
  const writeLastTarget = (payload) => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  };
  const lastTarget = readLastTarget();

  const formatWhen = (raw) => {
    if (!raw) return "";
    try {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return "";
    }
  };

  const setStatus = (text, isError = false) => {
    if (isError && text) {
      const info = friendlyExportError(new Error(text), "Fusion export failed");
      status.innerHTML = `
        <div class="file-export-inline-error file-export-inline-error--${info.kind}">
          <strong>${escText(info.title)}</strong>
          <span>${escText(info.message)}</span>
          ${info.detail && info.detail !== info.message ? `<small>${escText(info.detail)}</small>` : ""}
        </div>
      `;
    } else {
      status.textContent = text || "";
    }
    status.className = `file-export-fusion-status small ${isError ? "error" : "muted"}`;
    keepMenuInViewport(menu);
  };

  const setOptions = (select, items, placeholder) => {
    select.innerHTML = items.length
      ? items.map((item) => `<option value="${escAttr(item.id)}">${escText(item.name || item.id)}</option>`).join("")
      : `<option value="">${escText(placeholder)}</option>`;
    select.disabled = !items.length;
  };

  const setSelectedFolder = (folder, { quiet = false, pulse = false } = {}) => {
    selectedFolderId = folder?.id || "";
    selectedFolderName = folder?.name || selectedFolderId;
    submit.disabled = !selectedFolderId;
    submit.classList.toggle("is-ready", !!selectedFolderId);
    if (selectedFolderId) {
      const dest = selectedFolderName || "folder";
      submit.textContent = `Export to Fusion · ${dest}`;
      submit.title = `Upload into “${dest}”`;
      if (destLabel) destLabel.textContent = `✓ Destination: ${dest}`;
      if (pulse) {
        submit.classList.remove("is-ready");
        // reflow so animation can replay
        void submit.offsetWidth;
        submit.classList.add("is-ready");
        try {
          submit.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } catch {
          /* ignore */
        }
      }
    } else {
      submit.textContent = `Export to Fusion`;
      submit.title = "";
      if (destLabel) destLabel.textContent = "Pick a folder above, then export.";
    }
    if (!quiet) {
      setStatus(selectedFolderId ? `Ready: “${selectedFolderName}”` : "");
    }
  };

  const markExportSuccess = (label = "Exported ✓") => {
    submit.classList.add("file-export-fusion-submit--success");
    submit.classList.remove("is-ready");
    submit.textContent = label;
    submit.disabled = true;
  };

  const exportToFolder = (folder) => {
    if (!folder?.id) {
      setStatus("Choose a Fusion folder first.", true);
      return;
    }
    // Second click on the already-selected folder starts the upload.
    if (selectedFolderId && selectedFolderId === folder.id) {
      setSelectedFolder(folder, { quiet: true, pulse: true });
      if (!submit.disabled) submit.click();
      return;
    }
    setSelectedFolder(folder, { quiet: true, pulse: true });
    setStatus(`Ready: “${folder.name || "folder"}”. Tap the orange Export button below.`);
    renderFolderBrowser(lastFolderList, { items: lastFolderItems });
  };

  const renderProjectGrid = () => {
    const q = String(projectSearch?.value || "").trim().toLowerCase();
    const filtered = !q
      ? allProjects
      : allProjects.filter((p) => {
          const hay = `${p.name || ""} ${p.id || ""}`.toLowerCase();
          return hay.includes(q);
        });
    if (!filtered.length) {
      projectGrid.innerHTML = `<p class="muted small">${allProjects.length ? "No projects match that search." : "No projects found."}</p>`;
      return;
    }
    projectGrid.innerHTML = filtered.map((project, index) => {
      const active = projectSelect.value === project.id;
      const when = formatWhen(project.last_modified || project.created);
      const badge = index === 0 && !q ? `<span class="file-export-fusion-pill">Recent</span>` : "";
      return `
        <button type="button" class="file-export-fusion-project-card${active ? " is-active" : ""}" data-fusion-pick-project="${escAttr(project.id)}" title="${escAttr(project.name || project.id)}">
          <strong>${escText(project.name || "Untitled project")}</strong>
          <span>${when ? `Updated ${escText(when)}` : "Fusion project"}</span>
          ${badge}
        </button>
      `;
    }).join("");
    projectGrid.querySelectorAll("[data-fusion-pick-project]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.fusionPickProject;
        if (!id || projectSelect.value === id) return;
        projectSelect.value = id;
        projectSelect.dispatchEvent(new Event("change"));
        renderProjectGrid();
      });
    });
    keepMenuInViewport(menu);
  };

  const projectFilesFolderId = (folders) => {
    const match = (folders || []).find((folder) => /project files/i.test(String(folder?.name || "")));
    return match?.id || "";
  };

  const parentFolderForCreate = (folders = lastFolderList) => {
    if (currentFolder?.id) return { id: currentFolder.id, name: currentFolder.name || "folder", browse: false };
    if (selectedFolderId) {
      const selected = (folders || []).find((f) => f.id === selectedFolderId);
      return { id: selectedFolderId, name: selected?.name || selectedFolderName || "folder", browse: true };
    }
    const projectFiles = (folders || []).find((folder) => /project files/i.test(String(folder?.name || "")));
    if (projectFiles?.id) return { id: projectFiles.id, name: projectFiles.name, browse: true };
    return null;
  };

  const createFusionFolder = async (name) => {
    const parent = parentFolderForCreate();
    const apsProjectId = projectSelect.value;
    if (!parent?.id || !apsProjectId) {
      throw new Error("Open or select a Fusion folder first (for example Project Files).");
    }
    const data = await autodeskJson(
      `/api/autodesk/projects/${encodeURIComponent(apsProjectId)}/folders`,
      {
        method: "POST",
        body: {
          parent_folder_id: parent.id,
          name,
          hub_id: hubSelect.value,
        },
      },
    );
    const created = data.folder || data;
    if (!created?.id) throw new Error("Fusion did not return the new folder.");
    if (parent.browse && (!currentFolder || currentFolder.id !== parent.id)) {
      selectedFolderId = "";
      selectedFolderName = "";
      setSelectedFolder(null, { quiet: true });
      if (currentFolder) folderStack.push(currentFolder);
      currentFolder = { id: parent.id, name: parent.name };
      await loadFolders();
    } else {
      await loadFolders();
    }
    exportToFolder(created);
    setStatus(`Created “${created.name || name}”. Ready to export.`);
    return created;
  };

  const folderPathPayload = () => {
    const path = [...folderStack];
    if (currentFolder) path.push(currentFolder);
    return path.map((f) => ({ id: f.id, name: f.name || "Folder" }));
  };

  const openFolder = (folder) => {
    if (!folder?.id) return;
    // Browsing clears selection — user must click to pick an export target.
    selectedFolderId = "";
    selectedFolderName = "";
    setSelectedFolder(null, { quiet: true });
    if (currentFolder) folderStack.push(currentFolder);
    currentFolder = folder;
    loadFolders().catch((err) => setStatus(err.message || "Could not load Fusion folders.", true));
  };

  const goToBreadcrumb = (depth) => {
    // depth 0 = top folders; 1 = first stack entry as current; etc.
    selectedFolderId = "";
    selectedFolderName = "";
    setSelectedFolder(null, { quiet: true });
    if (depth <= 0) {
      folderStack = [];
      currentFolder = null;
    } else {
      const full = [...folderStack];
      if (currentFolder) full.push(currentFolder);
      const target = full[depth - 1] || null;
      folderStack = full.slice(0, Math.max(0, depth - 1));
      currentFolder = target;
    }
    loadFolders().catch((err) => setStatus(err.message || "Could not load Fusion folders.", true));
  };

  const renderFolderBrowser = (folders, { loading = false, emptyText = "No folders found.", items = null } = {}) => {
    lastFolderList = folders || [];
    if (items) lastFolderItems = items;
    if (loading) {
      folderBrowser.innerHTML = `<p class="muted small">Loading folders...</p>`;
      return;
    }
    const path = folderPathPayload();
    const crumbParts = [
      { label: "Top", depth: 0 },
      ...path.map((f, i) => ({ label: f.name || "Folder", depth: i + 1 })),
    ];
    const currentSelected = !!(currentFolder && selectedFolderId === currentFolder.id);
    const fileCards = (lastFolderItems || []).slice(0, 12).map((item) => {
      const thumb = item.thumbnail_url
        ? `<span class="file-export-fusion-file-thumb" style="background-image:url('${escAttr(item.thumbnail_url)}')"></span>`
        : `<span class="file-export-fusion-file-thumb file-export-fusion-file-thumb--cube" aria-hidden="true"></span>`;
      return `
        <div class="file-export-fusion-file-card" title="${escAttr(item.name || "")}">
          ${thumb}
          <span class="file-export-fusion-file-name">${escText(item.name || "file")}</span>
        </div>
      `;
    }).join("");
    const newFolderParent = currentFolder?.id || selectedFolderId || projectFilesFolderId(folders);
    const newFolderTitle = newFolderParent
      ? "Create a new folder in Fusion"
      : "Open or select a folder first (for example Project Files)";
    folderBrowser.innerHTML = `
      <div class="file-export-fusion-folder-head">
        <button type="button" class="btn secondary btn-compact" data-folder-back ${path.length ? "" : "disabled"} title="Go up one folder">Back</button>
        <nav class="file-export-fusion-folder-crumbs" aria-label="Folder path">
          ${crumbParts.map((c, i) => {
            const last = i === crumbParts.length - 1;
            return last
              ? `<span class="file-export-fusion-crumb is-current" title="${escAttr(c.label)}">${escText(c.label)}</span>`
              : `<button type="button" class="file-export-fusion-crumb" data-folder-crumb="${c.depth}" title="${escAttr(c.label)}">${escText(c.label)}</button>`;
          }).join('<span class="file-export-fusion-crumb-sep" aria-hidden="true">/</span>')}
        </nav>
        <button type="button" class="file-export-fusion-new-folder" data-fusion-new-folder ${newFolderParent ? "" : "disabled"} title="${escAttr(newFolderTitle)}" aria-label="New Fusion folder">
          <svg class="file-export-fusion-new-folder-icon" viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
            <path d="M2.75 5.75c0-.97.78-1.75 1.75-1.75h3.15l1.55 1.65h6.3c.97 0 1.75.78 1.75 1.75v7.1c0 .97-.78 1.75-1.75 1.75h-11c-.97 0-1.75-.78-1.75-1.75V5.75z" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"></path>
            <path d="M10 8.25v5M7.5 10.75h5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
      <form class="file-export-fusion-new-folder-form" data-fusion-new-folder-form hidden>
        <input type="text" class="file-export-fusion-new-folder-input" data-fusion-new-folder-name placeholder="New folder name" maxlength="255" autocomplete="off" />
        <button type="submit" class="btn btn-compact file-export-fusion-new-folder-create">Create</button>
      </form>
      ${currentFolder ? `
        <button type="button" class="btn secondary btn-compact file-export-fusion-use-current${currentSelected ? " is-active" : ""}" data-folder-select-here title="${currentSelected ? "Export into this folder" : "Select this folder as the export destination"}">
          ${currentSelected ? "✓ Selected · " : "Select · "}${escText(currentFolder.name || "this folder")}
        </button>
        <p class="muted small file-export-fusion-folder-hint">${currentSelected ? "Export to Fusion is pinned below." : "Select this folder to export here, or Select / Open a subfolder."}</p>
      ` : `
        <p class="muted small file-export-fusion-folder-hint">Root folders of this project — click <strong>Select</strong> on one to export into it (or Open to go deeper).</p>
      `}
      ${selectedFolderId && !currentSelected ? `<p class="muted small">Selected destination: <strong>✓ ${escText(selectedFolderName)}</strong></p>` : ""}
      <div class="file-export-fusion-folder-grid" role="list">
        ${folders.length ? folders.map((folder, index) => {
          const when = formatWhen(folder.last_modified || folder.created);
          const active = selectedFolderId === folder.id;
          const atRoot = !currentFolder && !folderStack.length;
          return `
            <div class="file-export-fusion-folder-tile${active ? " is-active" : ""}" role="listitem" data-folder-tile="${escAttr(folder.id)}">
              <button type="button" class="file-export-fusion-folder-tile-main" data-folder-select="${escAttr(folder.id)}" title="Select ${escAttr(folder.name || "folder")} for export" aria-pressed="${active ? "true" : "false"}">
                <span class="file-export-fusion-folder-icon" aria-hidden="true"></span>
                <span class="file-export-fusion-folder-tile-body">
                  <strong>${active ? "✓ " : ""}${escText(folder.name || "Folder")}</strong>
                  <span>${active ? "Selected — ready to export" : (atRoot ? "Root folder · click Select" : (when ? `Updated ${escText(when)}` : "Click Select"))}</span>
                </span>
                ${active ? `<span class="file-export-fusion-folder-check" aria-hidden="true">✓</span>` : ""}
              </button>
              <div class="file-export-fusion-folder-actions">
                <button type="button" class="btn btn-compact file-export-fusion-folder-pick${active ? " is-active" : ""}" data-folder-select="${escAttr(folder.id)}" title="Select this folder for export">${active ? "✓ Selected" : "Select"}</button>
                <button type="button" class="btn secondary btn-compact file-export-fusion-folder-open" data-folder-open="${escAttr(folder.id)}" title="Browse inside ${escAttr(folder.name || "folder")}">Open</button>
              </div>
            </div>
          `;
        }).join("") : `<p class="muted small file-export-fusion-folder-empty">${escText(emptyText)}</p>`}
      </div>
      ${fileCards ? `
        <div class="file-export-fusion-files">
          <p class="muted small">Files already in this folder</p>
          <div class="file-export-fusion-file-grid">${fileCards}</div>
        </div>
      ` : ""}
    `;
    folderBrowser.querySelector("[data-folder-back]")?.addEventListener("click", () => {
      selectedFolderId = "";
      selectedFolderName = "";
      setSelectedFolder(null, { quiet: true });
      if (currentFolder) {
        currentFolder = folderStack.pop() || null;
      }
      loadFolders().catch((err) => setStatus(err.message || "Could not load Fusion folders.", true));
    });
    folderBrowser.querySelectorAll("[data-folder-crumb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        goToBreadcrumb(Number(btn.dataset.folderCrumb) || 0);
      });
    });
    folderBrowser.querySelector("[data-folder-select-here]")?.addEventListener("click", () => {
      if (!currentFolder) return;
      // Second tap on an already-selected folder starts the export (big orange CTA).
      if (selectedFolderId && selectedFolderId === currentFolder.id) {
        if (!submit.disabled) submit.click();
        return;
      }
      exportToFolder(currentFolder);
    });
    folderBrowser.querySelectorAll("[data-folder-open]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const folder = folders.find((item) => item.id === btn.dataset.folderOpen);
        if (!folder) return;
        openFolder(folder);
      });
    });
    folderBrowser.querySelectorAll("[data-folder-select]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = btn.dataset.folderSelect;
        const folder = folders.find((item) => item.id === id)
          || (id ? { id, name: btn.closest("[data-folder-tile]")?.querySelector("strong")?.textContent?.replace(/^✓\s*/, "").trim() || "Folder" } : null);
        if (!folder?.id) return;
        exportToFolder(folder);
      });
    });
    const newFolderForm = folderBrowser.querySelector("[data-fusion-new-folder-form]");
    const newFolderInput = folderBrowser.querySelector("[data-fusion-new-folder-name]");
    folderBrowser.querySelector("[data-fusion-new-folder]")?.addEventListener("click", () => {
      if (!newFolderParent) {
        setStatus("Open or select a folder first (for example Project Files).", true);
        return;
      }
      if (!newFolderForm) return;
      newFolderForm.hidden = !newFolderForm.hidden;
      if (!newFolderForm.hidden) {
        newFolderInput?.focus();
        newFolderInput?.select();
      }
      keepMenuInViewport(menu);
    });
    newFolderForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = String(newFolderInput?.value || "").trim();
      if (!name) {
        setStatus("Enter a folder name.", true);
        newFolderInput?.focus();
        return;
      }
      const createBtn = newFolderForm.querySelector(".file-export-fusion-new-folder-create");
      if (createBtn) createBtn.disabled = true;
      setStatus(`Creating “${name}” in Fusion…`);
      try {
        await createFusionFolder(name);
        if (newFolderForm) newFolderForm.hidden = true;
      } catch (err) {
        setStatus(err.message || "Could not create Fusion folder.", true);
      } finally {
        if (createBtn) createBtn.disabled = false;
      }
    });
    keepMenuInViewport(menu);
  };

  const loadFolders = async () => {
    submit.disabled = true;
    const hubId = hubSelect.value;
    const apsProjectId = projectSelect.value;
    if (!folderBrowser.querySelector("[data-folder-tile], [data-folder-open], [data-folder-select]")) {
      renderFolderBrowser([], { loading: true });
    }
    if (!hubId || !apsProjectId) return;
    const ctl = beginFusionExportFetch();
    let data;
    try {
      data = currentFolder
        ? await autodeskJson(`/api/autodesk/projects/${encodeURIComponent(apsProjectId)}/folders/${encodeURIComponent(currentFolder.id)}/contents`, { signal: ctl.signal })
        : await autodeskJson(`/api/autodesk/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(apsProjectId)}/top-folders`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      throw err;
    } finally {
      if (fusionExportAbort === ctl) fusionExportAbort = null;
    }
    const folders = data.folders || [];
    lastFolderItems = currentFolder ? (data.items || []) : [];

    // Stay at the level the user opened — never auto-select or dive past root.
    setSelectedFolder(null, { quiet: true });
    setStatus(currentFolder
      ? `Inside “${currentFolder.name || "folder"}”. Click a folder (or Select this folder) to choose where to export.`
      : "Click a folder to select it for export. Use Open to browse inside.");
    renderFolderBrowser(folders, {
      items: lastFolderItems,
      emptyText: currentFolder
        ? "No subfolders here — use Select · this folder above to export here, or go Back."
        : "No top folders found.",
    });
    submit.disabled = !selectedFolderId;
  };

  const loadProjects = async () => {
    submit.disabled = true;
    currentFolder = null;
    folderStack = [];
    selectedFolderId = "";
    selectedFolderName = "";
    allProjects = [];
    if (!projectSelect.querySelector("option[value]:not([value=''])")) {
      setOptions(projectSelect, [], "Loading projects...");
    }
    projectSearch.disabled = true;
    projectSearch.value = "";
    if (!projectGrid.querySelector("[data-fusion-pick-project]")) {
      projectGrid.innerHTML = `<p class="muted small">Loading projects…</p>`;
    }
    if (!folderBrowser.querySelector("[data-folder-tile], [data-folder-open], [data-folder-select]")) {
      renderFolderBrowser([], { emptyText: "Select a project first." });
    }
    const hubId = hubSelect.value;
    if (!hubId) return;
    const ctl = beginFusionExportFetch();
    let data;
    try {
      data = await autodeskJson(`/api/autodesk/hubs/${encodeURIComponent(hubId)}/projects`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      throw err;
    } finally {
      if (fusionExportAbort === ctl) fusionExportAbort = null;
    }
    allProjects = data.projects || [];
    setOptions(projectSelect, allProjects, "No projects found");
    projectSearch.disabled = !allProjects.length;
    // Remember hub/project only — never restore a nested folder path.
    if (lastTarget?.hub_id === hubId && lastTarget?.aps_project_id
      && allProjects.some((p) => p.id === lastTarget.aps_project_id)) {
      projectSelect.value = lastTarget.aps_project_id;
    }
    renderProjectGrid();
    if (projectSelect.value) {
      await loadFolders();
    } else {
      renderFolderBrowser([], { emptyText: "Select a project first." });
    }
  };

  hubSelect.addEventListener("change", () => {
    loadProjects().catch((err) => setStatus(err.message || "Could not load Fusion projects.", true));
  });
  projectSelect.addEventListener("change", () => {
    currentFolder = null;
    folderStack = [];
    selectedFolderId = "";
    selectedFolderName = "";
    setSelectedFolder(null, { quiet: true });
    renderProjectGrid();
    loadFolders().catch((err) => setStatus(err.message || "Could not load Fusion folders.", true));
  });
  projectSearch?.addEventListener("input", () => renderProjectGrid());

  submit.addEventListener("click", async () => {
    if (!selectedFolderId) {
      setStatus("Choose a Fusion folder first.", true);
      return;
    }
    // If destination folder contents aren't loaded yet (exporting a sibling
    // without opening it), fetch items so we can detect name collisions.
    if (!currentFolder || selectedFolderId !== currentFolder.id || !lastFolderItems.length) {
      try {
        const contents = await autodeskJson(
          `/api/autodesk/projects/${encodeURIComponent(projectSelect.value)}/folders/${encodeURIComponent(selectedFolderId)}/contents`
        );
        lastFolderItems = contents.items || [];
      } catch {
        /* collision check is best-effort */
      }
    }
    const destName = (() => {
      const raw = String(uploadName || filename || "model.step").split(/[/\\]/).pop();
      if (/\.3mf$/i.test(raw)) return raw;
      const stem = String(raw).replace(/(\.fusionpart|\.part)?(\.[^.]+)?$/i, "");
      return `${stem || "model"}.step`;
    })();
    const uploadBaseName = destName;
    const existing = findExistingFolderItem(uploadBaseName);
    let conflictMode = "replace";
    if (existing) {
      const choice = await askReplaceOrNew(existing.name || uploadBaseName);
      if (!choice) {
        setStatus("Export cancelled.");
        submit.disabled = false;
        setSelectedFolder({ id: selectedFolderId, name: selectedFolderName }, { quiet: true });
        return;
      }
      conflictMode = choice;
    }
    submit.disabled = true;
    setStatus(isThreeMf ? "Uploading 3MF to Fusion..." : `Uploading ${uploadBaseName} to Fusion...`);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/push-to-autodesk`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          hub_id: hubSelect.value,
          hub_label: hubSelect.options[hubSelect.selectedIndex]?.textContent || "",
          aps_project_id: projectSelect.value,
          aps_project_label: projectSelect.options[projectSelect.selectedIndex]?.textContent || "",
          folder_id: selectedFolderId,
          folder_label: selectedFolderName,
          filename,
          name: uploadBaseName,
          allow_faceted_step: allowFacetedStep,
          conflict_mode: conflictMode,
          step_mode: stepMode || "part",
          // One STEP only — never companion .py (was creating 2 Fusion files).
          upload_source: false,
          ...(isThreeMf ? { format: "3mf" } : {}),
          ...(Array.isArray(allowedFilenames) && allowedFilenames.length
            ? { allowed_filenames: allowedFilenames, visible_filenames: allowedFilenames }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Fusion export failed (${res.status})`);
      }
      const data = await res.json();
      const navPath = folderPathPayload();
      if (selectedFolderId && selectedFolderId !== currentFolder?.id) {
        navPath.push({ id: selectedFolderId, name: selectedFolderName });
      }
      writeLastTarget({
        hub_id: hubSelect.value,
        aps_project_id: projectSelect.value,
        folder_id: selectedFolderId,
        folder_label: selectedFolderName,
        folder_path: navPath,
      });
      markExportSuccess("Exported ✓");
      const openHint = String(data.open_instructions || "").trim();
      const jointHint = String(data.joint_instructions || "");
      setStatus(
        `Uploaded ${data.fusion_document_kind === "assembly" ? "assembly" : "Part"} “${data.name || uploadBaseName}”.`
        + (openHint ? ` ${openHint}` : "")
        + (jointHint ? ` ${jointHint}` : " Closing…"),
      );
      if (data.joint_export_url) {
        const packageBtn = document.createElement("button");
        packageBtn.type = "button";
        packageBtn.className = "file-export-dl";
        packageBtn.textContent = `Download STEP + joints (${data.joint_count})`;
        packageBtn.addEventListener("click", async () => {
          packageBtn.disabled = true;
          try {
            await downloadFile(data.joint_export_url, `${modelStem(uploadBaseName)}-joints.zip`);
          } catch (err) {
            setStatus(err.message || "Joint package download failed", true);
          } finally {
            packageBtn.disabled = false;
          }
        });
        submit.parentElement.appendChild(packageBtn);
      } else {
        void maybeShowFusionUnlinkHowto();
        setTimeout(() => closeExportMenu(), 2200);
      }
    } catch (err) {
      submit.disabled = false;
      setSelectedFolder({ id: selectedFolderId, name: selectedFolderName }, { quiet: true });
      setStatus(err.message || "Fusion export failed.", true);
    }
  });

  try {
    const ctl = beginFusionExportFetch();
    const data = await autodeskJson("/api/autodesk/hubs", { signal: ctl.signal });
    if (ctl.signal.aborted) return;
    setOptions(hubSelect, data.hubs || [], "No hubs found");
    if (!hubSelect.value) {
      setStatus("No Fusion hubs found for this Autodesk account.", true);
      return;
    }
    if (lastTarget?.hub_id && [...hubSelect.options].some((o) => o.value === lastTarget.hub_id)) {
      hubSelect.value = lastTarget.hub_id;
    }
    await loadProjects();
  } catch (err) {
    if (err?.name === "AbortError") return;
    setStatus(err.message || "Could not load Fusion library.", true);
  }
}

function keepMenuInViewport(menu) {
  if (!menu) return;
  requestAnimationFrame(() => {
    const pad = 8;
    const maxH = Math.max(240, window.innerHeight - pad * 2);
    menu.style.maxHeight = `${maxH}px`;
    const hasFusion = menu.classList.contains("has-fusion-picker")
      || !!menu.querySelector(".file-export-fusion-picker");
    // Fusion picker: pin near the top so the Export footer stays on-screen.
    if (hasFusion) {
      menu.style.top = `${pad}px`;
      menu.style.bottom = "";
      menu.style.maxHeight = `${maxH}px`;
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - pad) {
        menu.style.left = `${Math.max(pad, window.innerWidth - rect.width - pad)}px`;
      }
      if (rect.left < pad) menu.style.left = `${pad}px`;
      return;
    }
    if (menu.classList.contains("file-export-menu--mobile")) {
      menu.style.left = `${pad}px`;
      menu.style.right = `${pad}px`;
      menu.style.width = "auto";
      menu.style.bottom = `${pad}px`;
      menu.style.top = "auto";
      menu.style.maxHeight = `${Math.min(maxH, window.innerHeight * 0.78)}px`;
      menu.style.overflowY = "auto";
      return;
    }
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - pad || rect.top < pad) {
      menu.style.top = `${Math.max(pad, Math.min(rect.top, window.innerHeight - Math.min(rect.height, maxH) - pad))}px`;
    }
    if (rect.right > window.innerWidth - pad) {
      menu.style.left = `${Math.max(pad, window.innerWidth - rect.width - pad)}px`;
    }
    if (rect.left < pad) {
      menu.style.left = `${pad}px`;
    }
  });
}

function escText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(value) {
  return escText(value).replace(/"/g, "&quot;");
}

export function closeFileExportMenu() {
  closeExportMenu();
}
