/**
 * Onshape Library panel — Fusion-style two-pane thumbnail browser.
 *
 * Usage:
 *   import { initOnshapePanel } from './onshape-panel.js';
 *   initOnshapePanel({ api, onImported });
 *     onImported(projectId, filename, name) — called after a successful import
 */

import { authHeaders } from '../studio/auth.js';
import {
  ELEM_TYPE_LABEL,
  filterOnshapeLibrary,
  isImportable,
  onshapeThumbnailRequestUrl,
  shouldShow,
} from './onshape-library-ui.js';
import { trackObjectUrl, revokeTrackedObjectUrls } from "../viewport/viewport-video-editor.js?v=leakfix24";

const ONSHAPE_FOLDER_FILE_PREVIEW = 12;

export { ELEM_TYPE_LABEL, filterOnshapeLibrary, isImportable, onshapeThumbnailRequestUrl, shouldShow };

export function initOnshapePanel({ api, onImported, onView, getCurrentProjectId } = {}) {
  const section = document.getElementById('onshape-library-section');
  if (!section) return;

  const browsePanel = section.querySelector('[data-onshape-panel="browse"]');
  const controlsEl = browsePanel?.querySelector('.onshape-library-controls');
  const listEl  = browsePanel?.querySelector('.onshape-doc-list') || section.querySelector('.onshape-doc-list');
  const statusEl = section.querySelector('.onshape-status');
  const btnRefresh = section.querySelector('.btn-onshape-refresh');

  let docsCache = [];
  let elementsCache = [];
  let activeDoc = null;
  let librarySearch = "";
  let filePickerModal = null;
  const importedMap = new Map();

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'onshape-status muted small' + (isError ? ' error' : '');
  }

  function clearStatus() { if (statusEl) statusEl.textContent = ''; }

  function searchNeedle() {
    return String(librarySearch || "").trim().toLowerCase();
  }

  function renderControls() {
    if (!controlsEl) return;
    const inDoc = !!activeDoc;
    controlsEl.innerHTML = `
      <div class="fusion-library-toolbar">
        <label class="fusion-library-search">
          <span class="visually-hidden">Search Onshape</span>
          <input type="search" id="onshape-library-search" placeholder="${inDoc ? "Search parts…" : "Search documents…"}" maxlength="120" autocomplete="off" />
        </label>
      </div>
      <div class="fusion-library-actions">
        <button type="button" class="cad-lib-btn cad-lib-btn--ghost btn-onshape-back"${inDoc ? "" : " hidden"}>Documents</button>
      </div>
      <p class="muted small fusion-folder-hint">${inDoc
        ? `Open a part in “${escHtml(activeDoc.name || "document")}” to Import, View, or Push.`
        : "Search filters documents. Open a document to import Part Studios or assemblies."}</p>
    `;
    const searchInput = controlsEl.querySelector("#onshape-library-search");
    if (searchInput) {
      searchInput.value = librarySearch;
      searchInput.addEventListener("input", () => {
        librarySearch = searchInput.value || "";
        paintLibrary();
      });
    }
    controlsEl.querySelector(".btn-onshape-back")?.addEventListener("click", () => {
      if (onshapeElementsAbort) {
        try { onshapeElementsAbort.abort(); } catch (_) { /* ignore */ }
      }
      activeDoc = null;
      elementsCache = [];
      librarySearch = "";
      renderControls();
      paintLibrary();
    });
  }

  function paintLibrary() {
    if (activeDoc) renderElementsGrid(activeDoc, elementsCache);
    else renderDocs(docsCache);
  }

  function revokeOnshapeThumbsIn(root) {
    if (!root) return;
    root.querySelectorAll(".fusion-file-browser").forEach((wrap) => {
      revokeTrackedObjectUrls(wrap._onshapeThumbCreated);
    });
  }

  async function hydrateOnshapeThumbnail(img, { did, wid, eid = "", fallbackUrl = "", large = false, created = null } = {}) {
    if (!img) return;
    const url = onshapeThumbnailRequestUrl({ did, wid, eid, fallbackUrl, large });
    if (!url) {
      img.classList.add("is-missing");
      return;
    }
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`thumb ${res.status}`);
      const blob = await res.blob();
      if (!blob || !blob.size) throw new Error("empty thumb");
      const objectUrl = trackObjectUrl(blob, created);
      img._onshapeThumbUrl = objectUrl;
      img.src = objectUrl;
      img.classList.remove("is-missing");
      img.classList.add("is-loaded");
    } catch {
      img.removeAttribute("src");
      img.classList.add("is-missing");
    }
  }

  function closeFilePickerModal() {
    if (!filePickerModal) return;
    if (filePickerModal._onKey) {
      document.removeEventListener("keydown", filePickerModal._onKey);
    }
    revokeTrackedObjectUrls(filePickerModal._onshapeThumbCreated); // leakfix24
    filePickerModal.remove();
    filePickerModal = null;
  }

  function openFilePickerModal({ title, countLabel, items, paintCard }) {
    closeFilePickerModal();
    const list = Array.isArray(items) ? items : [];
    const modal = document.createElement("div");
    modal.className = "fusion-file-picker-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", title);
    modal.innerHTML = `
      <div class="fusion-file-picker-dialog">
        <div class="fusion-file-picker-head">
          <div class="fusion-file-picker-titles">
            <strong>${escHtml(title)}</strong>
            <span class="muted small">${escHtml(countLabel)}</span>
          </div>
          <div class="fusion-file-picker-head-actions">
            <input type="search" class="fusion-file-search fusion-file-search--modal" placeholder="Search…" aria-label="Search" />
            <button type="button" class="btn btn-compact" data-onshape-picker-close>Close</button>
          </div>
        </div>
        <div class="fusion-file-grid fusion-file-grid--modal" data-onshape-picker-grid role="list"></div>
      </div>
    `;
    document.body.appendChild(modal);
    filePickerModal = modal;
    const grid = modal.querySelector("[data-onshape-picker-grid]");
    const search = modal.querySelector(".fusion-file-search--modal");
    const thumbs = modal._onshapeThumbCreated || (modal._onshapeThumbCreated = []); // leakfix24
    const paint = () => {
      const matches = filterOnshapeLibrary(list, search?.value || "");
      revokeTrackedObjectUrls(thumbs);
      grid.innerHTML = "";
      if (!matches.length) {
        grid.innerHTML = `<p class="muted small fusion-file-empty">${search?.value ? "No items match that search." : "Nothing to show."}</p>`;
        return;
      }
      for (const item of matches) grid.appendChild(paintCard(item, { large: true, created: thumbs }));
    };
    search?.addEventListener("input", paint);
    modal.querySelector("[data-onshape-picker-close]")?.addEventListener("click", closeFilePickerModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeFilePickerModal();
    });
    const onKey = (event) => {
      if (event.key === "Escape") {
        closeFilePickerModal();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    modal._onKey = onKey;
    paint();
    queueMicrotask(() => {
      try { search?.focus({ preventScroll: true }); } catch { /* ignore */ }
    });
  }

  function appendCardBrowser(container, { items, paintCard, emptyLabel, expandTitle, searchPlaceholder }) {
    const list = Array.isArray(items) ? items : [];
    const wrap = document.createElement("div");
    wrap.className = "fusion-file-browser";
    const previewCount = Math.max(6, Math.min(24, ONSHAPE_FOLDER_FILE_PREVIEW));
    let query = searchNeedle();
    let showAll = list.length <= previewCount;
    wrap.innerHTML = `
      <div class="fusion-file-browser-bar">
        <input type="search" class="fusion-file-search" placeholder="${escHtml(searchPlaceholder)}" aria-label="${escHtml(searchPlaceholder)}" />
        <button type="button" class="btn btn-compact fusion-file-expand" title="Open a larger grid">Expand</button>
      </div>
      <div class="fusion-file-grid" data-onshape-file-grid role="list"></div>
      <div class="fusion-file-browser-footer" data-onshape-file-footer hidden></div>
    `;
    container.appendChild(wrap);
    const grid = wrap.querySelector("[data-onshape-file-grid]");
    const footer = wrap.querySelector("[data-onshape-file-footer]");
    const search = wrap.querySelector(".fusion-file-search");
    if (search) search.value = query;

    const thumbs = wrap._onshapeThumbCreated || (wrap._onshapeThumbCreated = []); // leakfix24
    const paint = () => {
      const matches = filterOnshapeLibrary(list, query);
      const visible = showAll || query ? matches : matches.slice(0, previewCount);
      const hiddenCount = Math.max(0, matches.length - visible.length);
      revokeTrackedObjectUrls(thumbs);
      grid.innerHTML = "";
      for (const item of visible) grid.appendChild(paintCard(item, { large: false, created: thumbs }));
      if (!matches.length) {
        grid.innerHTML = `<p class="muted small fusion-file-empty">${query ? "No items match that search." : emptyLabel}</p>`;
      }
      if (hiddenCount) {
        footer.hidden = false;
        footer.innerHTML = "";
        const moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "btn btn-compact fusion-view-more";
        moreBtn.textContent = `View more (${hiddenCount} more)`;
        moreBtn.addEventListener("click", () => {
          showAll = true;
          paint();
        });
        footer.appendChild(moreBtn);
      } else {
        footer.hidden = true;
        footer.innerHTML = "";
      }
    };

    search?.addEventListener("input", () => {
      query = search.value || "";
      librarySearch = query;
      const chromeSearch = controlsEl?.querySelector("#onshape-library-search");
      if (chromeSearch && chromeSearch.value !== query) chromeSearch.value = query;
      paint();
    });
    wrap.querySelector(".fusion-file-expand")?.addEventListener("click", () => {
      openFilePickerModal({
        title: expandTitle,
        countLabel: `${list.length} item${list.length === 1 ? "" : "s"}`,
        items: list,
        paintCard,
      });
    });
    paint();
  }

  function docCard(doc, { large = false, created = null } = {}) {
    const row = document.createElement("div");
    row.className = `onshape-elem-row fusion-file-row fusion-file-card onshape-doc-card${large ? " fusion-file-card--large" : ""}`;
    row.dataset.name = doc.name || "";
    row.innerHTML = `
      <div class="fusion-file-thumb-wrap" aria-hidden="true">
        <img class="fusion-file-thumb" alt="" loading="lazy" decoding="async" />
        <span class="fusion-file-thumb-fallback"></span>
      </div>
      <div class="fusion-file-card-meta">
        <span class="onshape-elem-type-badge">Document</span>
        <span class="onshape-elem-name" title="${escHtml(doc.name || "Untitled")}">${escHtml(doc.name || "Untitled")}</span>
      </div>
      <div class="onshape-elem-btns">
        <button type="button" class="btn accent btn-compact btn-onshape-open-doc">Open</button>
        ${doc.href ? `<a class="btn btn-compact btn-onshape-view" target="_blank" rel="noopener" href="${escHtml(doc.href)}">Onshape</a>` : ""}
      </div>
    `;
    const img = row.querySelector(".fusion-file-thumb");
    void hydrateOnshapeThumbnail(img, {
      did: doc.id,
      wid: doc.workspace_id,
      fallbackUrl: doc.thumbnail,
      large,
      created,
    });
    row.querySelector(".btn-onshape-open-doc")?.addEventListener("click", () => {
      closeFilePickerModal();
      void openDocument(doc);
    });
    row.addEventListener("dblclick", () => {
      closeFilePickerModal();
      void openDocument(doc);
    });
    return row;
  }

  function elemCard(doc, el, { large = false, created = null } = {}) {
    const canImport = isImportable(el);
    const typeLabel = ELEM_TYPE_LABEL[el.type] || el.type;
    const key = `${doc.id}:${el.id}`;
    const alreadyImported = importedMap.has(key);
    const imp = importedMap.get(key);
    const row = document.createElement("div");
    row.className = `onshape-elem-row fusion-file-row fusion-file-card onshape-elem-card${large ? " fusion-file-card--large" : ""}${canImport ? "" : " onshape-elem-row--dim"}`;
    row.dataset.name = el.name || "";
    row.dataset.elemKey = key;
    row.innerHTML = `
      <div class="fusion-file-thumb-wrap" aria-hidden="true">
        <img class="fusion-file-thumb" alt="" loading="lazy" decoding="async" />
        <span class="fusion-file-thumb-fallback"></span>
      </div>
      <div class="fusion-file-card-meta">
        <span class="onshape-elem-type-badge">${escHtml(typeLabel)}</span>
        <span class="onshape-elem-name" title="${escHtml(el.name || "Untitled")}">${escHtml(el.name || "Untitled")}</span>
      </div>
      <div class="onshape-elem-btns">
        ${alreadyImported ? `
          <button type="button" class="btn btn-compact btn-onshape-view" title="Switch to this model in the viewport">View</button>
          <button type="button" class="btn btn-compact btn-onshape-push" title="Push current edits back to Onshape">
            <img src="/cad/onshape-logo.png" width="11" height="11" alt="" style="vertical-align:-1px" /> Push
          </button>
        ` : `
          <button type="button" class="btn accent btn-compact btn-onshape-import"
            ${canImport ? "" : "disabled title=\"Not a 3D model\""}>Import</button>
        `}
      </div>
    `;
    const img = row.querySelector(".fusion-file-thumb");
    void hydrateOnshapeThumbnail(img, {
      did: doc.id,
      wid: doc.workspace_id,
      eid: el.id,
      fallbackUrl: el.thumbnail,
      large,
      created,
    });
    if (canImport) {
      if (alreadyImported) {
        row.querySelector(".btn-onshape-view")?.addEventListener("click", () => {
          onView?.(imp.projectId, imp.filename, imp.name);
          closeFilePickerModal();
        });
        row.querySelector(".btn-onshape-push")?.addEventListener("click", (e) => {
          pushElement(imp.projectId, el.name, e.currentTarget);
        });
      } else {
        row.querySelector(".btn-onshape-import")?.addEventListener("click", () => importElement(doc, el, row, key));
      }
    }
    return row;
  }

  function renderDocs(docs) {
    if (!listEl) return;
    revokeOnshapeThumbsIn(listEl);
    listEl.innerHTML = "";
    if (!docs.length) {
      listEl.innerHTML = '<p class="muted small" style="padding:6px 0">No documents found.</p>';
      return;
    }
    appendCardBrowser(listEl, {
      items: docs,
      paintCard: (doc, opts) => docCard(doc, opts),
      emptyLabel: "No documents found.",
      expandTitle: "Onshape documents",
      searchPlaceholder: "Search documents…",
    });
  }

  let onshapeElementsAbort = null; // leakfix90
  function beginOnshapeElementsFetch() {
    if (onshapeElementsAbort) {
      try { onshapeElementsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    onshapeElementsAbort = ctl;
    return ctl;
  }

  async function openDocument(doc) {
    activeDoc = doc;
    librarySearch = "";
    renderControls();
    if (!listEl) return;
    const ctl = beginOnshapeElementsFetch();
    if (!listEl.querySelector(".onshape-elem-card")) {
      revokeOnshapeThumbsIn(listEl);
      listEl.innerHTML = '<p class="muted small loading-dots">Loading parts…</p>';
    }
    setStatus(`Opening “${doc.name || "document"}”…`);
    try {
      const data = await api(
        `/api/onshape/documents/${doc.id}/elements?wid=${encodeURIComponent(doc.workspace_id)}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      elementsCache = (data.elements || []).filter(shouldShow);
      renderElementsGrid(doc, elementsCache);
      const n = elementsCache.length;
      setStatus(n ? `“${doc.name || "document"}” — ${n} part${n === 1 ? "" : "s"}.` : `No 3D models found in “${doc.name || "document"}”.`);
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      listEl.innerHTML = `<p class="muted small error">${escHtml(err.message || "Failed to load")}</p>`;
      setStatus(err.message || "Could not load document parts.", true);
    }
  }

  function renderElementsGrid(doc, elements) {
    if (!listEl) return;
    revokeOnshapeThumbsIn(listEl);
    listEl.innerHTML = "";
    appendCardBrowser(listEl, {
      items: elements,
      paintCard: (el, opts) => elemCard(doc, el, opts),
      emptyLabel: "No 3D models found in this document.",
      expandTitle: doc.name || "Onshape parts",
      searchPlaceholder: "Search parts…",
    });
  }

  async function importElement(doc, el, row, key) {
    const importBtn = row.querySelector('.btn-onshape-import');
    if (!importBtn) return;
    importBtn.disabled = true;
    importBtn.textContent = el.type === 'BLOB' ? 'Downloading…' : 'Converting…';

    let dotInterval = null;
    if (el.type !== 'BLOB') {
      let dots = 0;
      const labels = ['Converting.', 'Converting..', 'Converting...', 'Converting'];
      dotInterval = setInterval(() => { importBtn.textContent = labels[dots++ % labels.length]; }, 700);
    }

    try {
      const res = await fetch('/api/onshape/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          document_id:    doc.id,
          workspace_id:   doc.workspace_id,
          element_id:     el.id,
          element_type:   el.type,
          name:           el.name || doc.name,
          document_name:  doc.name,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `Import failed (${res.status})`);
      }
      const result = await res.json();
      clearInterval(dotInterval);
      importBtn.textContent = 'Imported ✓';
      importBtn.classList.add('success');

      importedMap.set(key, { projectId: result.project_id, filename: result.filename, name: result.name });

      const btns = row.querySelector('.onshape-elem-btns');
      if (btns) {
        btns.innerHTML = `
          <button type="button" class="btn btn-compact btn-onshape-view" title="Switch to this model in the viewport">View</button>
          <button type="button" class="btn btn-compact btn-onshape-push" title="Push current edits back to Onshape">
            <img src="/cad/onshape-logo.png" width="11" height="11" alt="" style="vertical-align:-1px" /> Push
          </button>
        `;
        btns.querySelector('.btn-onshape-view').addEventListener('click', () => {
          onView?.(result.project_id, result.filename, result.name);
          closeFilePickerModal();
        });
        btns.querySelector('.btn-onshape-push').addEventListener('click', (e) => {
          pushElement(result.project_id, el.name, e.currentTarget);
        });
      }

      onImported?.(result.project_id, result.filename, result.name);
    } catch (err) {
      clearInterval(dotInterval);
      importBtn.disabled = false;
      importBtn.textContent = 'Import';
      alert(err.message || 'Import failed');
    }
  }

  async function pushElement(projectId, elementName, btn) {
    if (!projectId) { alert('No project linked — import first.'); return; }
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<img src="/cad/onshape-logo.png" width="11" height="11" alt="" style="vertical-align:-1px" /> Pushing…`;
    try {
      const res = await fetch(`/api/projects/${projectId}/push-to-onshape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `Push failed (${res.status})`);
      }
      const data = await res.json();

      const btns = btn.closest('.onshape-elem-btns');
      if (btns) {
        btn.remove();
        const link = document.createElement('a');
        link.href = data.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'btn btn-compact btn-onshape-push success';
        link.style.textDecoration = 'none';
        link.innerHTML = `<img src="/cad/onshape-logo.png" width="11" height="11" alt="" style="vertical-align:-1px" /> Open in Onshape`;
        link.title = 'Onshape is processing the STEP file — click to open once ready (may take 1–2 min for large models)';
        btns.appendChild(link);
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = orig;
      alert(err.message || 'Push failed');
    }
  }

  function renderDisconnected() {
    setStatus("Sign in with Onshape to browse your documents.");
    activeDoc = null;
    renderControls();
    if (!listEl) return;
    revokeOnshapeThumbsIn(listEl);
    listEl.innerHTML = `
      <div class="cloud-library-connect">
        <p class="muted small">Link Onshape to browse documents and import Part Studios or assemblies into Render Studio.</p>
        <button type="button" class="btn primary btn-compact btn-cloud-connect-now" data-cloud="onshape">
          <img src="/cad/onshape-logo.png?v=20260617-small" width="14" height="14" alt="" />
          Connect now
        </button>
      </div>
    `;
    listEl.querySelector(".btn-cloud-connect-now")?.addEventListener("click", () => {
      const profileBtn = document.getElementById("btn-onshape-connect");
      if (profileBtn) {
        profileBtn.click();
        return;
      }
      void startOnshapeConnect();
    });
  }

  async function startOnshapeConnect() {
    try {
      const res = await fetch("/api/onshape/oauth-url", {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setStatus("Sign in to Render Studio first, then connect Onshape.", true);
        return;
      }
      if (!res.ok) throw new Error(data.detail || `Could not start Onshape connect (${res.status})`);
      const url = data.url;
      if (!url) throw new Error("Onshape authorization URL was not returned.");
      window.open(url, "render3d-onshape-connect", "popup=yes,width=720,height=820");
    } catch (err) {
      setStatus(err.message || "Could not start Onshape connection.", true);
    }
  }

  let onshapeDocsAbort = null; // leakfix62
  function beginOnshapeDocsFetch() {
    if (onshapeDocsAbort) {
      try { onshapeDocsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    onshapeDocsAbort = ctl;
    return ctl;
  }

  async function loadDocuments() {
    if (!listEl) return;
    if (onshapeElementsAbort) {
      try { onshapeElementsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = beginOnshapeDocsFetch();
    const hasRows = !!listEl.querySelector(".onshape-doc-card, .onshape-elem-row");
    if (!hasRows) {
      activeDoc = null;
      elementsCache = [];
      revokeOnshapeThumbsIn(listEl);
      listEl.innerHTML = "";
      renderControls();
      setStatus("Loading your Onshape documents…");
    }
    try {
      try {
        const statusRes = await fetch("/api/onshape/status", { headers: authHeaders(), signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (statusRes.ok) {
          const status = await statusRes.json();
          if (!status?.linked) {
            renderDisconnected();
            return;
          }
        }
      } catch (err) {
        if (ctl.signal.aborted || err?.name === "AbortError") return;
        /* fall through to documents fetch */
      }

      const data = await api("/api/onshape/documents?limit=50", { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      docsCache = data.documents || [];
      clearStatus();
      const n = docsCache.length;
      setStatus(n ? `${n} document${n === 1 ? "" : "s"}. Open one to see parts.` : "No documents found.");
      renderDocs(docsCache);
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      if (/not linked|401|not authenticated/i.test(err.message || "")) {
        renderDisconnected();
      } else {
        setStatus(err.message || "Could not load documents.", true);
      }
    } finally {
      if (onshapeDocsAbort === ctl) onshapeDocsAbort = null;
    }
  }

  renderControls();
  btnRefresh?.addEventListener("click", () => loadDocuments());

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== "render3d:oauth-done") return;
    if (String(event.data.provider || "").toLowerCase() !== "onshape") return;
    if (event.data.ok) loadDocuments();
  });

  window.addEventListener("render3d:open-onshape-library", () => {
    void loadDocuments();
  });
  // Do not IntersectionObserver-load on boot. The section is on-screen
  // in the parked rail, so the old observer hit Onshape on every studio
  // load and again when project-switch relaid out the docks.

  return { loadDocuments };
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

