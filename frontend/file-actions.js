import { authHeaders, getToken } from "./auth.js";

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

let openMenu = null;
let openMenuCleanup = null;

function closeExportMenu() {
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

function fallbackExports(filename) {
  const stem = fileStem(filename);
  return PRIMARY_FORMATS.map((fmt) => ({ name: `${stem}.${fmt}`, format: fmt, size: null }));
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

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

function setExportActionsPreparing(menu, preparing) {
  if (!menu) return;
  const selectors = [
    ".file-export-bambu",
    ".file-export-onshape",
    ".file-export-onshape-push",
    ".file-export-fusion-action",
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

function exportLabel(item, targetStem) {
  const name = String(item.name || "");
  let base = item.label || null;
  if (!base && item.format === "step") {
    base = "STEP";
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
  const base = item.url || `/api/projects/${projectId}/files/${encodeURIComponent(name)}`;
  // Strip any prior step_mode, then apply the chooser selection.
  const cleaned = base.replace(/([?&])step_mode=[^&]*/i, "$1").replace(/[?&]$/, "");
  const sep = cleaned.includes("?") ? "&" : "?";
  const stepMode = mode === "regular" || mode === "part" || mode === "single" ? "part" : (mode || "assembly");
  return `${cleaned}${sep}step_mode=${encodeURIComponent(stepMode)}`;
}

function formatApiError(err) {
  const msg = (err?.message || "").trim();
  if (msg && msg !== "Request failed") return msg;
  if (/not authenticated|401/i.test(msg)) return "Sign in again to export files.";
  if (/not found|404/i.test(msg)) return "Model or project not found.";
  if (/403|forbidden/i.test(msg)) return "You do not have access to this project.";
  return "Could not list exports — showing usual download formats below.";
}

function friendlyExportError(err, fallback = "Export failed.") {
  const raw = String(err?.message || fallback || "").trim();
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
  if (/Fusion request failed\s*\(502\)|Fusion export failed\s*\(502\)|502|bad gateway/i.test(raw)) {
    return {
      title: "Fusion is busy",
      message: "Autodesk/Fusion did not finish that request. Reconnect Fusion if needed, then retry the export.",
      action: "Retry",
      kind: "fusion",
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

async function createShareUrl(projectId, filename, shareContext = null) {
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
  // Always mint a fresh share so we never reopen an old Arduino/ball token.
  body.force_new = true;
  if (!Array.isArray(body.visible_filenames)) body.visible_filenames = [];
  const safeName = String(filename || "").trim();
  if (!safeName || /^(visible|project)\s+assembly$/i.test(safeName)) {
    throw new Error("No shareable model file prepared yet. Try Export again.");
  }
  const res = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(safeName)}/share`, {
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
  return shareUrl.startsWith("http") ? shareUrl : `${window.location.origin}${shareUrl}`;
}

async function downloadFile(url, filename, { retries = 3 } = {}) {
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
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return;
    }
    const retryable = [502, 503, 504].includes(res.status);
    const data = await res.json().catch(() => ({}));
    const detail = typeof data.detail === "string" ? data.detail : res.statusText;
    lastErr = new Error(detail || `Download failed (${res.status})`);
    if (retryable && attempt < retries - 1) continue;
    throw lastErr;
  }
  throw lastErr || new Error("Download failed");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
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
      <span>One solid Part (Bodies) — Extrude / Cut in Fusion</span>
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

async function checkOnshapeLinked() {
  if (!getToken()) return false;
  try {
    const res = await fetch("/api/onshape/status", { headers: authHeaders() });
    if (!res.ok) return false;
    const d = await res.json();
    return d.linked === true;
  } catch {
    return false;
  }
}

async function checkAutodeskLinked() {
  if (!getToken()) return false;
  try {
    const res = await fetch("/api/autodesk/status", { headers: authHeaders() });
    if (!res.ok) return false;
    const d = await res.json();
    return d.linked === true;
  } catch {
    return false;
  }
}

async function autodeskJson(path) {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Fusion request failed (${res.status})`);
  }
  return res.json();
}

export async function openFileExportMenu({
  api,
  projectId,
  filename,
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
}) {
  closeExportMenu();

  const onshapeLinked = allowOnshape ? await checkOnshapeLinked() : false;
  const autodeskLinked = allowFusion ? await checkAutodeskLinked() : false;

  // Check if this project was imported from Onshape → show Push button
  let onshapeSource = null;
  if (allowOnshape && onshapeLinked && projectId) {
    try {
      const sr = await fetch(`/api/projects/${projectId}/onshape-source`, { headers: authHeaders() });
      if (sr.ok) { const d = await sr.json(); onshapeSource = d.onshape_source || null; }
    } catch { /* non-critical */ }
  }
  let autodeskSource = null;
  if (allowFusion && autodeskLinked && projectId) {
    try {
      const sr = await fetch(`/api/projects/${projectId}/autodesk-source`, { headers: authHeaders() });
      if (sr.ok) { const d = await sr.json(); autodeskSource = d.autodesk_source || null; }
    } catch { /* non-critical */ }
  }

  const menu = document.createElement("div");
  menu.className = "file-export-menu";
  menu.innerHTML = `
    <div class="file-export-header">
      <div class="file-export-title">${title || `Export ${filename}`}</div>
      <button type="button" class="file-export-close" data-export-close aria-label="Close export">&times;</button>
    </div>
    <p class="file-export-hint muted small">${hint || "Download GLB, STL, STEP, or 3MF — send a plate-ready 3MF to Bambu Studio — or copy a public preview link."}</p>
    <p class="file-export-status muted small">Preparing exports…</p>
    <div class="file-export-list"></div>
    <div class="file-export-actions">
      <button type="button" class="btn secondary btn-compact file-export-share" disabled>Copy share link</button>
      ${onshapeSource ? `
      <button type="button" class="btn file-export-onshape file-export-onshape-push" title="Push updated STEP back to the original Onshape document">
        <img src="/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" />
        Push to Onshape
      </button>` : (onshapeLinked ? `
      <button type="button" class="btn file-export-onshape" title="Create a new Onshape document from this model's STEP file">
        <img src="/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" />
        Export to Onshape
      </button>` : "")}
      ${autodeskLinked ? `
      <button type="button" class="btn file-export-fusion-action" title="${autodeskSource ? "Update the original Fusion file or upload to a shared Fusion folder" : "Pick a Fusion 360 project and folder, then upload this model as a new STEP file"}">
        <img src="/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" />
        Fusion 360
      </button>` : ""}
      <button type="button" class="btn file-export-bambu" title="Open this model as 3MF in local Bambu Studio and place it on the build plate">
        <!-- @milestone id=send-to-bambu-studio title="Send to Bambu Studio" summary="Export prepares a plate-ready 3MF and opens it in local Bambu Studio so the part lands on the build plate." kind=feature href="/" -->
        <span class="file-export-bambu-mark" aria-hidden="true">B</span>
        Send to Bambu Studio
      </button>
    </div>
  `;
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 260)}px`;
  menu.style.left = `${Math.min(rect.left, Math.max(8, window.innerWidth - 316))}px`;
  document.body.appendChild(menu);
  keepMenuInViewport(menu);
  openMenu = menu;

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
    if (ev.key === "Escape") closeFromUi();
  };
  openMenuCleanup = () => {
    document.removeEventListener("mousedown", onDoc);
    document.removeEventListener("keydown", onKey);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
  }, 0);

  const statusEl  = menu.querySelector(".file-export-status");
  const list      = menu.querySelector(".file-export-list");
  const shareBtn  = menu.querySelector(".file-export-share");
  const onshapeBtn = menu.querySelector(".file-export-onshape");
  const pushBtn   = menu.querySelector(".file-export-onshape-push");
  const fusionActionBtn = menu.querySelector(".file-export-fusion-action");
  const bambuBtn = menu.querySelector(".file-export-bambu");

  renderExportPlaceholders(list);
  setExportActionsPreparing(menu, true);

  let data = null;
  let fetchError = null;
  try {
    if (exportsRequest) {
      data = await withTimeout(
        api(exportsRequest.path, exportsRequest.options || {}),
        18000,
        "Export preparation is taking too long. Showing available download formats.",
      );
    } else {
      data = await withTimeout(
        api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/exports`),
        18000,
        "Export preparation is taking too long. Showing available download formats.",
      );
    }
  } catch (err) {
    fetchError = err;
  }

  let exports = collapseExportsToSingleStep(data?.exports || []);
  // Prefer the baked assembly GLB/STEP from exportsRequest — never share the
  // placeholder label "visible assembly" / "project assembly" (404 → old token).
  const bakedGlb = (data?.exports || []).find((item) => item.format === "glb" && String(item.name || "").startsWith("_export_visible_assembly"))
    || (data?.filename && String(data.filename).endsWith(".glb") ? { name: data.filename } : null);
  const shareFilename = bakedGlb?.name
    || (data?.filename && !/^(visible|project)\s+assembly$/i.test(String(data.filename)) ? data.filename : null)
    || (filename && !/^(visible|project)\s+assembly$/i.test(String(filename)) ? filename : null)
    || (exports.find((item) => item.format === "glb")?.name)
    || null;
  if (data?.filename && data.filename !== filename && !/^(visible|project)\s+assembly$/i.test(String(data.filename))) {
    const titleEl = menu.querySelector(".file-export-title");
    if (titleEl && !title) titleEl.textContent = `Export ${data.filename}`;
  }

  if (!exports.length && !exportsRequest) {
    exports = fallbackExports(filename);
  }
  if (extraExports.length) {
    exports = collapseExportsToSingleStep([...exports, ...extraExports]);
  }

  if (fetchError && !(data?.exports?.length)) {
    list.innerHTML = "";
    setExportActionsPreparing(menu, false);
    statusEl.textContent = exportsRequest
      ? (fetchError.message || "Could not prepare assembly exports.")
      : `${formatApiError(fetchError)} Click a format to download.`;
    statusEl.className = "file-export-status status error";
    if (exportsRequest) return;
  } else if (!exports.length) {
    list.innerHTML = "";
    setExportActionsPreparing(menu, false);
    statusEl.textContent = "No export files found for this model.";
    statusEl.className = "file-export-status status error";
    return;
  } else {
    statusEl.remove();
    list.innerHTML = "";
    setExportActionsPreparing(menu, false);
  }

  let preparedShareUrl = "";
  let preparingShare = false;
  const prepareShareLink = async () => {
    if (!shareBtn || preparingShare || preparedShareUrl) return;
    preparingShare = true;
    shareBtn.disabled = true;
    shareBtn.classList.add("is-loading");
    shareBtn.textContent = "Creating share link...";
    try {
      if (!shareFilename) throw new Error("No shareable model file prepared yet.");
      preparedShareUrl = await createShareUrl(projectId, shareFilename, shareContext);
      shareBtn.textContent = "Copy share link";
      shareBtn.disabled = false;
    } catch (err) {
      shareBtn.textContent = "Retry share link";
      showExportError(menu, err, {
        title: "Could not create share link",
        onRetry: () => prepareShareLink(),
      });
    } finally {
      preparingShare = false;
      shareBtn.classList.remove("is-loading");
      if (!preparedShareUrl) shareBtn.disabled = false;
    }
  };
  void prepareShareLink();

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
  const resolvedCloudFilename = cloudFilename || cloudStep?.name || (
    isVisibleAssemblyExport
      ? (allowedFilenames?.[0] ? String(allowedFilenames[0]).replace(/\.[^.]+$/, ".step") : null)
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
  if (!visibleAllowList.length && Array.isArray(allowedFilenames) && allowedFilenames.length) {
    visibleAllowList = allowedFilenames.map(String);
  }
  const fusionDestName = (() => {
    const raw = String(fusionUploadName || "").trim();
    if (raw) return raw.toLowerCase().endsWith(".step") || raw.toLowerCase().endsWith(".stp") ? raw : `${modelStem(raw)}.step`;
    if (visibleAllowList.length) return `${modelStem(visibleAllowList[0])}.step`;
    const cloud = String(resolvedCloudFilename || "");
    if (cloud && !cloud.startsWith("_export_visible_assembly")) return `${modelStem(cloud)}.step`;
    const base = String(filename || "");
    if (base && !/^(visible|project)\s+assembly$/i.test(base)) return `${modelStem(base)}.step`;
    return "model.step";
  })();

  for (const item of sorted) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-export-dl";
    btn.dataset.fmt = item.format;
    btn.dataset.current = item.current || fileStem(item.name) === targetStem ? "true" : "false";
    if (item.base) btn.dataset.base = "true";
    const sizeKb = item.size ? ` · ${Math.max(1, Math.round(item.size / 1024))} KB` : "";
    const label = exportLabel(item, targetStem);
    btn.textContent = `${label}${sizeKb}`;
    btn.title = item.name;
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
        const url = item.url || `/api/projects/${projectId}/files/${encodeURIComponent(item.name)}`;
        const dlName = item.format === "3mf"
          ? item.name.replace(/\.3mf$/i, ".3MF")
          : item.name;
        await downloadFile(url, dlName);
      } catch (err) {
        showExportError(menu, err, { title: "Download failed" });
      }
    });
    list.appendChild(btn);
  }

  shareBtn?.addEventListener("click", async () => {
    try {
      if (!preparedShareUrl) {
        await prepareShareLink();
        if (!preparedShareUrl) return;
      }
      shareBtn.disabled = true;
      await copyText(preparedShareUrl);
      shareBtn.textContent = "Link copied!";
    } catch (err) {
      shareBtn.textContent = "Copy share link";
      showExportError(menu, err, {
        title: "Could not copy share link",
        onRetry: () => shareBtn.click(),
      });
    } finally {
      shareBtn.disabled = false;
    }
  });

  async function onshapeAction(btn, endpoint, body, resetLabel) {
    btn.disabled = true;
    btn.innerHTML = `<img src="/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" /> Working…`;
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
      btn.innerHTML = `<img src="/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" /> Opened in Onshape ✓`;
      window.open(data.url, "_blank", "noopener");
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<img src="/onshape-logo.png" width="14" height="14" alt="" style="vertical-align:-2px" /> ${resetLabel}`;
      showExportError(menu, err, {
        title: "Onshape action failed",
        onRetry: () => onshapeAction(btn, endpoint, body, resetLabel),
      });
    }
  }

  onshapeBtn?.addEventListener("click", () =>
    onshapeAction(
      onshapeBtn,
      `/api/projects/${projectId}/files/${encodeURIComponent(resolvedCloudFilename)}/export-to-onshape`,
      { allow_faceted_step: resolvedCloudStepIsFaceted },
      "Export to Onshape",
    )
  );

  pushBtn?.addEventListener("click", () =>
    onshapeAction(
      pushBtn,
      `/api/projects/${projectId}/push-to-onshape`,
      { filename: resolvedCloudFilename, allow_faceted_step: resolvedCloudStepIsFaceted },
      "Push to Onshape",
    )
  );

  function showFusionStepModeChooser(onChoose, anchorEl = null) {
    // Fusion Part STEP (flattened) so Extrude/Cut works on linked assemblies.
    onChoose?.("part");
  }

  let fusionStepMode = "part";

  const isThreeMfFusionUpload = /\.3mf$/i.test(String(cloudFilename || filename || ""));
  // Prefer native editable STEP of the export target — never a sibling model.
  let fusionUploadFilename = isThreeMfFusionUpload
    ? String(cloudFilename || filename).split(/[/\\]/).pop()
    : resolvedCloudFilename;

  // If caller passed an explicit STEP cloudFilename, always use it for Fusion.
  if (!isThreeMfFusionUpload && cloudFilename && /\.ste?p$/i.test(String(cloudFilename))) {
    fusionUploadFilename = String(cloudFilename).split(/[/\\]/).pop();
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
    fusionUploadFilename = `${modelStem(fusionUploadFilename)}.step`;
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
    btn.innerHTML = `<img src="/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Pushing…`;
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
      btn.innerHTML = `<img src="/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Pushed to Fusion ✓`;
      const sourceNote = data.source_upload?.name ? ` Also uploaded ${data.source_upload.name}.` : "";
      const mirrorCount = data.pushed_mirrors?.length || 0;
      const mirrorErrors = data.push_errors?.length || 0;
      const mirrorNote = mirrorErrors
        ? ` Pushed to ${mirrorCount} teammate mirror${mirrorCount === 1 ? "" : "s"}; ${mirrorErrors} mirror push failed.`
        : mirrorCount
          ? ` Also pushed to ${mirrorCount} teammate mirror${mirrorCount === 1 ? "" : "s"}.`
          : "";
      showExportSuccess(menu, `Pushed ${data.name || fusionUploadFilename} to Fusion.${sourceNote}${mirrorNote} Refresh Fusion 360's Data Panel to see the new version.`);
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
    btn.innerHTML = `<img src="/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Loading Fusion…`;
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

  fusionActionBtn?.addEventListener("click", async () => {
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
  });

  bambuBtn?.addEventListener("click", async () => {
    await sendToBambuStudio({
      btn: bambuBtn,
      projectId,
      filename: shareFilename,
      exports: sorted,
    });
  });

  const rect2 = anchorEl.getBoundingClientRect();
  menu.style.top = `${Math.min(rect2.bottom + 6, window.innerHeight - Math.max(220, menu.offsetHeight + 12))}px`;

  if (autoAction) {
    requestAnimationFrame(() => {
      if (autoAction === "bambu") bambuBtn?.click();
      else if (autoAction === "fusion") fusionActionBtn?.click();
      else if (autoAction === "onshape") (onshapeBtn || pushBtn)?.click();
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

function bambuStudioOpenUrls(fileUrl) {
  // URI-encoded HTTPS in the protocol query is what Bambu Studio actually
  // imports on first open. Plain URLs often only focus an empty plate.
  const encoded = encodeURIComponent(fileUrl);
  return {
    windows: `bambustudio://open?file=${encoded}`,
    windowsEncoded: `bambustudio://open?file=${encoded}`,
    windowsPlain: `bambustudio://open?file=${fileUrl}`,
    linux: `bambustudio://open?file=${encoded}`,
    linuxEncoded: `bambustudio://open?file=${encoded}`,
    linuxPlain: `bambustudio://open?file=${fileUrl}`,
    // macOS registers a different scheme than Windows/Linux.
    macos: `bambustudioopen://${encoded}`,
    macosEncoded: `bambustudioopen://${encoded}`,
    macosPlain: `bambustudioopen://${fileUrl}`,
  };
}

function launchBambuProtocol(url) {
  // location.assign is more reliable than a synthetic <a> click for custom schemes.
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

async function ensureThreeMfExport({ projectId, filename, exports, forceRefresh = false }) {
  let threeMf = !forceRefresh
    ? (
      (exports || []).find((item) => String(item.format || "").toLowerCase() === "3mf")
      || (exports || []).find((item) => /\.3mf$/i.test(item.name || ""))
    )
    : null;

  // Always regenerate when sending to Bambu so the 3MF is plate-seated (Z=0) and fresh.
  try {
    await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filename)}/exports/regenerate`,
      { method: "POST", headers: authHeaders() },
    );
  } catch {
    /* non-fatal — re-list below */
  }
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filename)}/exports`,
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

async function sendToBambuStudio({ btn, projectId, filename, exports }) {
  if (!btn) return;
  const menu = btn.closest(".file-export-menu");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="file-export-bambu-mark" aria-hidden="true">B</span> Preparing 3MF…`;
  try {
    if (!getToken()) {
      throw new Error("Not authenticated. Sign in to create the temporary 3MF share link Bambu Studio needs.");
    }
    const threeMf = await ensureThreeMfExport({
      projectId,
      filename,
      exports,
      forceRefresh: true,
    });
    // Share the 3MF itself so Bambu can fetch a public absolute URL.
    const shareRes = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(threeMf.name)}/share`,
      { method: "POST", headers: authHeaders() },
    );
    if (!shareRes.ok) {
      const data = await shareRes.json().catch(() => ({}));
      throw new Error(data.detail || `Could not create a public 3MF link (${shareRes.status})`);
    }
    const share = await shareRes.json();
    const token = share.token;
    if (!token) throw new Error("Could not create a public 3MF link for Bambu Studio.");

    // Keep a clean .3mf path — Bambu's downloader keys off the extension.
    const safeName = String(threeMf.name || "model.3mf").replace(/\.3MF$/i, ".3mf");
    const filePath = `/api/share/${encodeURIComponent(token)}/files/${encodeURIComponent(safeName)}`;
    const fileUrl = `${window.location.origin}${filePath}`;
    const urls = bambuStudioOpenUrls(fileUrl);
    const os = detectClientOs();
    const primary = urls[os] || urls.windows;

    btn.innerHTML = `<span class="file-export-bambu-mark" aria-hidden="true">B</span> Opening Bambu Studio…`;

    // Also download the 3MF so the user can open it from Downloads if the protocol
    // only focuses an already-running Studio window without importing.
    try {
      await downloadFile(fileUrl, safeName);
    } catch {
      /* non-fatal — protocol open still attempted */
    }

    launchBambuProtocol(primary);

    btn.innerHTML = `<span class="file-export-bambu-mark" aria-hidden="true">B</span> Sent to Bambu ✓`;
    showBambuFollowUp(btn, { urls, os, fileUrl, threeMfName: safeName });
    setTimeout(() => {
      btn.disabled = false;
      if (!btn.dataset.bambuFollowup) btn.innerHTML = original;
    }, 1600);
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = original;
    showExportError(menu, err, {
      title: "Could not send to Bambu Studio",
      onRetry: () => sendToBambuStudio({ btn, projectId, filename, exports }),
    });
  }
}

function showBambuFollowUp(btn, { urls, os, fileUrl, threeMfName }) {
  const menu = btn.closest(".file-export-menu");
  if (!menu) return;
  menu.querySelector(".file-export-bambu-followup")?.remove();
  const panel = document.createElement("div");
  panel.className = "file-export-bambu-followup";
  const alt = os === "macos"
    ? (urls.windowsPlain || urls.windows)
    : (urls.macosPlain || urls.macos);
  const encodedPrimary = os === "macos" ? urls.macosEncoded : (urls[`${os}Encoded`] || urls.windowsEncoded);
  panel.innerHTML = `
    <p><strong>${escText(threeMfName)}</strong> was prepared as a plate-ready 3MF.</p>
    <p class="muted small">If Studio opened with an empty plate:</p>
    <ul class="muted small file-export-bambu-tips">
      <li>Click <strong>Yes</strong> on Bambu’s “not from a trusted site” prompt</li>
      <li>In Bambu Preferences, enable <strong>Keep only one Bambu Studio instance</strong></li>
      <li>Open the downloaded <strong>${escText(threeMfName)}</strong> from your Downloads folder (File → Import)</li>
    </ul>
    <div class="file-export-bambu-followup-actions">
      <button type="button" class="btn secondary btn-compact" data-bambu-encoded>Open again</button>
      <button type="button" class="btn secondary btn-compact" data-bambu-alt>Try alternate open link</button>
      <button type="button" class="btn secondary btn-compact" data-bambu-download>Download 3MF again</button>
    </div>
  `;
  panel.querySelector("[data-bambu-alt]")?.addEventListener("click", () => {
    launchBambuProtocol(alt);
  });
  panel.querySelector("[data-bambu-encoded]")?.addEventListener("click", () => {
    launchBambuProtocol(encodedPrimary || urls[os] || urls.windows);
  });
  panel.querySelector("[data-bambu-download]")?.addEventListener("click", async () => {
    try {
      await downloadFile(fileUrl, threeMfName);
    } catch (err) {
      showExportError(menu, err, { title: "3MF download failed" });
    }
  });
  btn.dataset.bambuFollowup = "1";
  btn.insertAdjacentElement("afterend", panel);
  keepMenuInViewport(menu);
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
      </div>
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
    keepMenuInViewport(menu);
  };

  const loadFolders = async () => {
    submit.disabled = true;
    const hubId = hubSelect.value;
    const apsProjectId = projectSelect.value;
    renderFolderBrowser([], { loading: true });
    if (!hubId || !apsProjectId) return;
    const data = currentFolder
      ? await autodeskJson(`/api/autodesk/projects/${encodeURIComponent(apsProjectId)}/folders/${encodeURIComponent(currentFolder.id)}/contents`)
      : await autodeskJson(`/api/autodesk/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(apsProjectId)}/top-folders`);
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
    setOptions(projectSelect, [], "Loading projects...");
    projectSearch.disabled = true;
    projectSearch.value = "";
    projectGrid.innerHTML = `<p class="muted small">Loading projects…</p>`;
    renderFolderBrowser([], { emptyText: "Select a project first." });
    const hubId = hubSelect.value;
    if (!hubId) return;
    const data = await autodeskJson(`/api/autodesk/hubs/${encodeURIComponent(hubId)}/projects`);
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
      setStatus(`Uploaded ${data.name || uploadBaseName} — closing…`);
      setTimeout(() => closeExportMenu(), 1400);
    } catch (err) {
      submit.disabled = false;
      setSelectedFolder({ id: selectedFolderId, name: selectedFolderName }, { quiet: true });
      setStatus(err.message || "Fusion export failed.", true);
    }
  });

  try {
    const data = await autodeskJson("/api/autodesk/hubs");
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
      menu.style.maxHeight = `${maxH}px`;
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - pad) {
        menu.style.left = `${Math.max(pad, window.innerWidth - rect.width - pad)}px`;
      }
      if (rect.left < pad) menu.style.left = `${pad}px`;
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
