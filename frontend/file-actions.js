import { authHeaders, getToken } from "./auth.js";

const FORMAT_LABELS = {
  glb: "GLB",
  stl: "STL",
  step: "STEP",
  "3mf": "3MF",
  obj: "OBJ",
  program: "Program JSON",
  sim: "sim.json",
  urdf: "URDF",
  mjcf: "MJCF",
};

const PRIMARY_FORMATS = ["glb", "stl", "step", "3mf"];
const EXPORT_ORDER = ["glb", "stl", "step", "3mf", "obj", "program", "sim", "urdf", "mjcf"];

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

function formatApiError(err) {
  const msg = (err?.message || "").trim();
  if (msg && msg !== "Request failed") return msg;
  if (/not authenticated|401/i.test(msg)) return "Sign in again to export files.";
  if (/not found|404/i.test(msg)) return "Model or project not found.";
  if (/403|forbidden/i.test(msg)) return "You do not have access to this project.";
  return "Could not list exports — showing usual download formats below.";
}

async function downloadFile(url, filename) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = typeof data.detail === "string" ? data.detail : res.statusText;
    throw new Error(detail || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
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

export async function openFileExportMenu({
  api,
  projectId,
  filename,
  anchorEl,
  title = null,
  hint = null,
  exportsRequest = null,
  allowOnshape = true,
}) {
  closeExportMenu();

  const onshapeLinked = allowOnshape ? await checkOnshapeLinked() : false;

  // Check if this project was imported from Onshape → show Push button
  let onshapeSource = null;
  if (allowOnshape && onshapeLinked && projectId) {
    try {
      const sr = await fetch(`/api/projects/${projectId}/onshape-source`, { headers: authHeaders() });
      if (sr.ok) { const d = await sr.json(); onshapeSource = d.onshape_source || null; }
    } catch { /* non-critical */ }
  }

  const menu = document.createElement("div");
  menu.className = "file-export-menu";
  menu.innerHTML = `
    <div class="file-export-title">${title || `Export ${filename}`}</div>
    <p class="file-export-hint muted small">${hint || "Download GLB, STL, STEP, or 3MF — or copy a share link (workspace members must be signed in)."}</p>
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
    </div>
  `;
  const rect = anchorEl.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 260)}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
  document.body.appendChild(menu);
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
  let shareUrl = `/api/projects/${projectId}/files/${encodeURIComponent(filename)}`;

  let data = null;
  let fetchError = null;
  try {
    if (exportsRequest) {
      data = await api(exportsRequest.path, exportsRequest.options || {});
    } else {
      data = await api(`/api/projects/${projectId}/files/${encodeURIComponent(filename)}/exports`);
    }
  } catch (err) {
    fetchError = err;
  }

  let exports = data?.exports || [];
  if (data?.share_url) shareUrl = data.share_url;

  if (!exports.length && !exportsRequest) {
    exports = fallbackExports(filename);
  }

  if (fetchError && !(data?.exports?.length)) {
    statusEl.textContent = exportsRequest
      ? (fetchError.message || "Could not prepare assembly exports.")
      : `${formatApiError(fetchError)} Click a format to download.`;
    statusEl.className = "file-export-status status error";
    if (exportsRequest) return;
  } else if (!exports.length) {
    statusEl.textContent = "No export files found for this model.";
    statusEl.className = "file-export-status status error";
    return;
  } else {
    statusEl.remove();
  }

  shareBtn.disabled = false;

  const sorted = [...exports].sort(
    (a, b) => EXPORT_ORDER.indexOf(a.format) - EXPORT_ORDER.indexOf(b.format) || a.name.localeCompare(b.name),
  );

  for (const item of sorted) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-export-dl";
    btn.dataset.fmt = item.format;
    const sizeKb = item.size ? ` · ${Math.max(1, Math.round(item.size / 1024))} KB` : "";
    btn.textContent = `${FORMAT_LABELS[item.format] || item.format.toUpperCase()}${sizeKb}`;
    btn.title = item.name;
    btn.addEventListener("click", async () => {
      try {
        const url = `/api/projects/${projectId}/files/${encodeURIComponent(item.name)}`;
        const dlName = item.format === "3mf"
          ? item.name.replace(/\.3mf$/i, ".3MF")
          : item.name;
        await downloadFile(url, dlName);
      } catch (err) {
        alert(err.message || "Download failed");
      }
    });
    list.appendChild(btn);
  }

  shareBtn?.addEventListener("click", async () => {
    const abs = `${window.location.origin}${shareUrl}`;
    try {
      await copyText(abs);
      shareBtn.textContent = "Link copied!";
    } catch {
      alert("Could not copy link");
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
      alert(err.message || "Onshape action failed");
    }
  }

  onshapeBtn?.addEventListener("click", () =>
    onshapeAction(
      onshapeBtn,
      `/api/projects/${projectId}/files/${encodeURIComponent(filename)}/export-to-onshape`,
      {},
      "Export to Onshape",
    )
  );

  pushBtn?.addEventListener("click", () =>
    onshapeAction(
      pushBtn,
      `/api/projects/${projectId}/push-to-onshape`,
      { filename },
      "Push to Onshape",
    )
  );

  const rect2 = anchorEl.getBoundingClientRect();
  menu.style.top = `${Math.min(rect2.bottom + 6, window.innerHeight - Math.max(220, menu.offsetHeight + 12))}px`;
}

export function closeFileExportMenu() {
  closeExportMenu();
}
