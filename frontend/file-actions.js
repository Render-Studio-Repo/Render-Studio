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

function closeExportMenu() {
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

function exportPriority(item, targetStem) {
  if (item.current || fileStem(item.name) === targetStem) return 0;
  if (item.base) return 2;
  return 1;
}

function exportLabel(item, targetStem) {
  const base =
    item.label ||
    (
      item.format === "step"
        ? item.step_kind === "faceted_mesh"
          ? "STEP (faceted mesh fallback)"
          : String(item.name || "").startsWith("_export_visible_assembly")
            ? "STEP (assembly)"
            : "STEP (editable B-rep)"
        : (FORMAT_LABELS[item.format] || item.format.toUpperCase())
    );
  if (item.current || fileStem(item.name) === targetStem) return `${base} · current updated`;
  if (item.base) return `${base} · original/base`;
  return base;
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
    };
  }
  if (/Fusion request failed\s*\(502\)|Fusion export failed\s*\(502\)|502|bad gateway/i.test(raw)) {
    return {
      title: "Fusion is busy",
      message: "Autodesk/Fusion did not finish that request. Reconnect Fusion if needed, then retry the export.",
      action: "Retry",
      kind: "fusion",
      detail: raw,
    };
  }
  return {
    title: fallback,
    message: raw || fallback,
    action: "Retry",
    kind: "generic",
    detail: raw,
  };
}

function showExportError(menu, err, { title = "Export failed", onRetry = null } = {}) {
  if (!menu) {
    alert(err?.message || title);
    return;
  }
  const info = friendlyExportError(err, title);
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
        ${typeof onRetry === "function" ? `<button type="button" class="btn secondary btn-compact" data-export-retry>${escText(info.action)}</button>` : ""}
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
    card.remove();
    onRetry?.();
  });
  keepMenuInViewport(menu);
}

function showExportSuccess(menu, message) {
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
}

async function createShareUrl(projectId, filename, shareContext = null) {
  let body = null;
  if (typeof shareContext === "function") {
    try {
      body = await shareContext();
    } catch {
      body = null;
    }
  }
  const res = await fetch(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/share`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

function showStepModeChooser(menu, item, onChoose, anchorEl = null) {
  menu.querySelector(".file-export-step-chooser")?.remove();
  const chooser = document.createElement("div");
  chooser.className = "file-export-step-chooser";
  chooser.innerHTML = `
    <div class="file-export-step-title">Export STEP as part or assembly?</div>
    <button type="button" class="file-export-step-choice" data-step-mode="regular">
      <strong>Part STEP</strong>
      <span>Single flattened part for normal CAD import</span>
    </button>
    <button type="button" class="file-export-step-choice" data-step-mode="assembly">
      <strong>Assembly STEP</strong>
      <span>Preserve separate bodies/components and appearances</span>
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

function showFusionActionChooser(menu, onChoose, anchorEl = null) {
  menu.querySelector(".file-export-fusion-action-chooser")?.remove();
  const chooser = document.createElement("div");
  chooser.className = "file-export-step-chooser file-export-fusion-action-chooser";
  chooser.innerHTML = `
    <div class="file-export-step-title">How should Fusion handle this model?</div>
    <button type="button" class="file-export-step-choice" data-fusion-action="push">
      <strong>Update original Fusion file</strong>
      <span>Push a new version back to the Fusion item this project came from.</span>
    </button>
    <button type="button" class="file-export-step-choice" data-fusion-action="shared">
      <strong>Shared Fusion folder/link</strong>
      <span>Choose a Fusion project folder so other Fusion users can access the uploaded STEP.</span>
    </button>
  `;
  chooser.addEventListener("click", (ev) => {
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
    <div class="file-export-title">${title || `Export ${filename}`}</div>
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

  const onDoc = (ev) => {
    if (menu.contains(ev.target) || anchorEl.contains(ev.target)) return;
    closeExportMenu();
    document.removeEventListener("mousedown", onDoc);
  };
  setTimeout(() => document.addEventListener("mousedown", onDoc), 0);

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

  let exports = data?.exports || [];
  const shareFilename = data?.filename || filename;

  if (!exports.length && !exportsRequest) {
    exports = fallbackExports(filename);
  }
  if (extraExports.length) {
    exports = [...exports, ...extraExports];
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
  const cloudStep = sorted.find((item) => item.format === "step" && item.step_kind === "editable_brep" && (item.current || fileStem(item.name) === targetStem))
    || sorted.find((item) => item.format === "step" && item.step_kind === "editable_brep")
    || sorted.find((item) => item.format === "step" && (item.current || fileStem(item.name) === targetStem))
    || sorted.find((item) => item.format === "step")
    || null;
  const resolvedCloudFilename = cloudFilename || cloudStep?.name || filename;
  const resolvedCloudStepIsFaceted = false;

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
    btn.addEventListener("click", async () => {
      try {
        if (item.format === "step" && item.step_kind !== "editable_brep") {
          const ok = window.confirm(
            "This STEP was generated from mesh triangles, so Fusion may import it but boolean Cut may fail. Download it anyway?"
          );
          if (!ok) return;
        }
        if (item.format === "step" && item.step_kind == null) {
          showStepModeChooser(menu, item, async (mode, picked) => {
            try {
              const chooser = menu.querySelector(".file-export-step-chooser");
              chooser?.querySelectorAll("button")?.forEach((b) => (b.disabled = true));
              const title = chooser?.querySelector(".file-export-step-title");
              if (title) title.textContent = "Preparing STEP download…";
              const baseUrl = picked.url || `/api/projects/${projectId}/files/${encodeURIComponent(picked.name)}`;
              const sep = baseUrl.includes("?") ? "&" : "?";
              const url = `${baseUrl}${sep}step_mode=${encodeURIComponent(mode)}`;
              const stem = picked.name.replace(/\.(step|stp)$/i, "");
              const dlName = mode === "regular" ? `${stem}.part.step` : picked.name;
              await downloadFile(url, dlName);
              chooser?.remove();
            } catch (err) {
              showExportError(menu, err, { title: "Download failed" });
              menu.querySelector(".file-export-step-chooser")?.querySelectorAll("button")?.forEach((b) => (b.disabled = false));
            }
          }, btn);
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

  async function pushToOriginalFusion(btn) {
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<img src="/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Pushing…`;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/push-to-autodesk`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ filename: resolvedCloudFilename, allow_faceted_step: resolvedCloudStepIsFaceted }),
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
      showExportSuccess(menu, `Pushed ${data.name || resolvedCloudFilename} to Fusion.${sourceNote}${mirrorNote} Refresh Fusion 360's Data Panel to see the new version.`);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = original;
      showExportError(menu, err, {
        title: "Fusion push failed",
        onRetry: () => pushToOriginalFusion(btn),
      });
    }
  }

  async function openSharedFusionExport(btn) {
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<img src="/fusion-360-logo.png?v=20260629" width="14" height="14" alt="" /> Loading Fusion…`;
    try {
      await showFusionExportPicker(menu, btn, {
        projectId,
        filename: resolvedCloudFilename,
        allowFacetedStep: resolvedCloudStepIsFaceted,
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
    if (autodeskSource) {
      showFusionActionChooser(menu, (choice) => {
        if (choice === "push") void pushToOriginalFusion(fusionActionBtn);
        else void openSharedFusionExport(fusionActionBtn);
      }, fusionActionBtn);
      return;
    }
    await openSharedFusionExport(fusionActionBtn);
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

async function showFusionExportPicker(menu, anchorBtn, { projectId, filename, allowFacetedStep = false }) {
  menu.querySelector(".file-export-fusion-picker")?.remove();
  const picker = document.createElement("div");
  picker.className = "file-export-fusion-picker";
  picker.innerHTML = `
    <div class="file-export-fusion-title">Export to Fusion 360</div>
    <p class="muted small">Pick a hub and project, then a folder. The most recently updated folder is selected automatically.</p>
    ${allowFacetedStep ? '<p class="status error small">Only faceted mesh STEP is available for this model. Export will work, but Fusion boolean Cut may be limited.</p>' : ""}
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
    <button type="button" class="btn primary file-export-fusion-submit" disabled>Upload STEP to Fusion</button>
    <div class="file-export-fusion-status muted small"></div>
  `;
  anchorBtn.insertAdjacentElement("afterend", picker);
  picker.scrollIntoView({ block: "nearest" });
  keepMenuInViewport(menu);

  const hubSelect = picker.querySelector("[data-fusion-hub]");
  const projectSelect = picker.querySelector("[data-fusion-project]");
  const projectSearch = picker.querySelector("[data-fusion-project-search]");
  const projectGrid = picker.querySelector("[data-fusion-project-grid]");
  const folderBrowser = picker.querySelector("[data-fusion-folder-browser]");
  const submit = picker.querySelector(".file-export-fusion-submit");
  const status = picker.querySelector(".file-export-fusion-status");
  let currentFolder = null;
  let folderStack = [];
  let selectedFolderId = "";
  let selectedFolderName = "";
  let allProjects = [];
  let lastFolderList = [];
  let autoSelectFolders = true;

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

  const setSelectedFolder = (folder, { quiet = false } = {}) => {
    selectedFolderId = folder?.id || "";
    selectedFolderName = folder?.name || selectedFolderId;
    submit.disabled = !selectedFolderId;
    if (!quiet) {
      setStatus(selectedFolderId ? `Selected: ${selectedFolderName}` : "");
    }
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

  const renderFolderBrowser = (folders, { loading = false, emptyText = "No folders found." } = {}) => {
    lastFolderList = folders || [];
    if (loading) {
      folderBrowser.innerHTML = `<p class="muted small">Loading folders...</p>`;
      return;
    }
    const crumbs = ["Top folders", ...folderStack.map((f) => f.name || "Folder"), currentFolder?.name].filter(Boolean);
    folderBrowser.innerHTML = `
      <div class="file-export-fusion-folder-head">
        <button type="button" class="btn secondary btn-compact" data-folder-back ${folderStack.length || currentFolder ? "" : "disabled"}>Back</button>
        <span class="muted small">${escText(crumbs.join(" / "))}</span>
      </div>
      ${currentFolder ? `<button type="button" class="btn btn-compact file-export-fusion-use-current" data-folder-select-current>Use this folder</button>` : ""}
      ${selectedFolderId ? `<p class="muted small">Selected: <strong>${escText(selectedFolderName)}</strong></p>` : ""}
      <div class="file-export-fusion-folder-grid">
        ${folders.length ? folders.map((folder, index) => {
          const when = formatWhen(folder.last_modified || folder.created);
          const active = selectedFolderId === folder.id;
          const recent = index === 0 && !currentFolder && !folderStack.length;
          return `
            <div class="file-export-fusion-folder-card${active ? " is-active" : ""}">
              <div class="file-export-fusion-folder-card-body">
                <strong title="${escAttr(folder.name || folder.id)}">${escText(folder.name || "Folder")}</strong>
                <span>${when ? `Updated ${escText(when)}` : "Folder"}${recent ? " · most recent" : ""}</span>
              </div>
              <div class="file-export-fusion-folder-card-actions">
                <button type="button" class="btn secondary btn-compact" data-folder-open="${escAttr(folder.id)}">Open</button>
                <button type="button" class="btn btn-compact" data-folder-select="${escAttr(folder.id)}">${active ? "Selected" : "Select"}</button>
              </div>
            </div>
          `;
        }).join("") : `<p class="muted small">${escText(emptyText)}</p>`}
      </div>
    `;
    folderBrowser.querySelector("[data-folder-back]")?.addEventListener("click", () => {
      autoSelectFolders = false;
      if (currentFolder) {
        currentFolder = folderStack.pop() || null;
      }
      loadFolders().catch((err) => setStatus(err.message || "Could not load Fusion folders.", true));
    });
    folderBrowser.querySelector("[data-folder-select-current]")?.addEventListener("click", () => {
      autoSelectFolders = false;
      setSelectedFolder(currentFolder);
      renderFolderBrowser(lastFolderList);
    });
    folderBrowser.querySelectorAll("[data-folder-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const folder = folders.find((item) => item.id === btn.dataset.folderOpen);
        if (!folder) return;
        autoSelectFolders = true;
        if (currentFolder) folderStack.push(currentFolder);
        currentFolder = folder;
        loadFolders().catch((err) => setStatus(err.message || "Could not load Fusion folders.", true));
      });
    });
    folderBrowser.querySelectorAll("[data-folder-select]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const folder = folders.find((item) => item.id === btn.dataset.folderSelect);
        if (!folder) return;
        autoSelectFolders = false;
        setSelectedFolder(folder);
        renderFolderBrowser(lastFolderList);
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
    if (autoSelectFolders && folders.length) {
      // Prefer remembered folder when still present; otherwise most recent (API already sorted).
      const remembered = lastTarget?.folder_id
        ? folders.find((f) => f.id === lastTarget.folder_id)
        : null;
      const pick = remembered || folders[0];
      setSelectedFolder(pick, { quiet: true });
      setStatus(`Auto-selected ${remembered ? "your last" : "most recent"} folder: ${pick.name || pick.id}`);
    }
    renderFolderBrowser(folders, { emptyText: currentFolder ? "This folder has no subfolders." : "No top folders found." });
    submit.disabled = !selectedFolderId;
  };

  const loadProjects = async () => {
    submit.disabled = true;
    currentFolder = null;
    folderStack = [];
    selectedFolderId = "";
    selectedFolderName = "";
    autoSelectFolders = true;
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
    autoSelectFolders = true;
    renderProjectGrid();
    loadFolders().catch((err) => setStatus(err.message || "Could not load Fusion folders.", true));
  });
  projectSearch?.addEventListener("input", () => renderProjectGrid());

  submit.addEventListener("click", async () => {
    if (!selectedFolderId) {
      setStatus("Choose a Fusion folder first.", true);
      return;
    }
    submit.disabled = true;
    setStatus("Uploading STEP to Fusion...");
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
          allow_faceted_step: allowFacetedStep,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Fusion export failed (${res.status})`);
      }
      const data = await res.json();
      writeLastTarget({
        hub_id: hubSelect.value,
        aps_project_id: projectSelect.value,
        folder_id: selectedFolderId,
        folder_label: selectedFolderName,
      });
      submit.classList.add("file-export-fusion-submit--success");
      submit.textContent = "Uploaded ✓";
      setStatus(`Uploaded ${data.name || filename} — closing…`);
      setTimeout(() => closeExportMenu(), 1200);
    } catch (err) {
      submit.disabled = false;
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
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    if (rect.bottom > window.innerHeight - pad) {
      menu.style.top = `${Math.max(pad, window.innerHeight - rect.height - pad)}px`;
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
