/** SolidWorks Library panel — personal vault of STEP/SLDPRT with import and push. */

import { authHeaders } from "../studio/auth.js?v=20260907-sw-lib";

const IMPORTABLE = /\.(step|stp|stl|3mf|sldprt|sldasm)$/i;

export function initSolidworksPanel({
  api,
  getCurrentProjectId,
  onImported,
  onView,
  onStatus,
} = {}) {
  const section = document.getElementById("solidworks-library-section");
  if (!section) return;

  const statusEl = section.querySelector(".solidworks-status");
  const listEl = section.querySelector(".solidworks-doc-list");
  const btnRefresh = section.querySelector(".btn-solidworks-refresh");
  const btnAdd = section.querySelector("#btn-solidworks-add");
  const fileInput = section.querySelector("#solidworks-library-file");

  const importedMap = new Map();

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "solidworks-status muted small" + (isError ? " error" : "");
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function loadLibrary() {
    setStatus("Loading SolidWorks library…");
    try {
      const data = await api("/api/solidworks/library");
      const items = Array.isArray(data?.items) ? data.items : [];
      renderItems(items);
      setStatus(items.length ? `${items.length} part${items.length === 1 ? "" : "s"} in your library.` : "Empty library — add STEP or .sldprt files exported from SolidWorks.");
    } catch (err) {
      setStatus(err.message || "Could not load SolidWorks library.", true);
    }
  }

  function renderItems(items) {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML = `<p class="muted small" style="padding:6px 0">No SolidWorks parts yet. Add a STEP from SolidWorks (File → Save As → STEP AP214) or drop a .sldprt.</p>`;
      return;
    }
    const folders = new Map();
    for (const item of items) {
      const folder = String(item.folder || "My Parts");
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(item);
    }
    for (const [folder, rows] of folders) {
      const group = document.createElement("div");
      group.className = "solidworks-folder";
      group.innerHTML = `<div class="solidworks-folder-label">${esc(folder)}</div>`;
      for (const item of rows) {
        const row = document.createElement("div");
        row.className = "onshape-doc-item solidworks-doc-item";
        const ext = String(item.filename || "").split(".").pop() || "";
        const imported = importedMap.has(item.id);
        row.innerHTML = `
          <div class="onshape-doc-header">
            <span class="onshape-doc-name">${esc(item.name || item.filename)}</span>
            <span class="muted small">${esc(ext.toUpperCase())}</span>
          </div>
          <div class="solidworks-doc-actions">
            <button type="button" class="btn-icon solidworks-import" title="Import into this project">Import</button>
            <button type="button" class="btn-icon solidworks-open" title="Open as a new project">Open</button>
            <button type="button" class="btn-icon solidworks-delete" title="Remove from library">×</button>
          </div>
        `;
        const importBtn = row.querySelector(".solidworks-import");
        const openBtn = row.querySelector(".solidworks-open");
        const delBtn = row.querySelector(".solidworks-delete");
        if (imported) {
          importBtn.textContent = "Imported";
          importBtn.disabled = true;
        }
        importBtn.addEventListener("click", () => void importItem(item, { intoCurrent: true, btn: importBtn }));
        openBtn.addEventListener("click", () => void importItem(item, { intoCurrent: false, btn: openBtn }));
        delBtn.addEventListener("click", () => void deleteItem(item));
        group.appendChild(row);
      }
      listEl.appendChild(group);
    }
  }

  async function importItem(item, { intoCurrent, btn }) {
    if (!IMPORTABLE.test(String(item.filename || ""))) {
      setStatus("This file type cannot be opened in the viewport. Save as STEP from SolidWorks.", true);
      return;
    }
    const label = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Working…";
    }
    try {
      const body = { item_id: item.id, name: item.name || item.filename };
      const currentId = getCurrentProjectId?.();
      if (intoCurrent && currentId) body.target_project_id = currentId;
      const data = await api("/api/solidworks/import", {
        method: "POST",
        body: JSON.stringify(body),
      });
      importedMap.set(item.id, data.project_id);
      setStatus(`Imported ${data.name || item.name}.`);
      onStatus?.("ok", `Imported ${data.name || item.name} from SolidWorks library.`);
      const fn = intoCurrent && currentId ? onImported : onView;
      await fn?.(data.project_id, data.filename, data.name);
    } catch (err) {
      setStatus(err.message || "Import failed.", true);
      onStatus?.("error", err.message || "SolidWorks import failed.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
      void loadLibrary();
    }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Remove ${item.name || item.filename} from your SolidWorks library?`)) return;
    try {
      await api(`/api/solidworks/library/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      void loadLibrary();
    } catch (err) {
      setStatus(err.message || "Could not delete.", true);
    }
  }

  btnRefresh?.addEventListener("click", () => void loadLibrary());
  btnAdd?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("folder", "My Parts");
    setStatus(`Adding ${file.name}…`);
    try {
      const res = await fetch("/api/solidworks/library", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `Upload failed (${res.status})`);
      setStatus(`Added ${data.name || file.name}.`);
      void loadLibrary();
    } catch (err) {
      setStatus(err.message || "Could not add file.", true);
    }
  });

  const io = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      io.disconnect();
      void loadLibrary();
    }
  }, { rootMargin: "80px" });
  io.observe(section);

  window.addEventListener("render3d:open-solidworks-library", () => {
    void loadLibrary();
  });
  window.addEventListener("render3d:solidworks-library-changed", () => void loadLibrary());
}
