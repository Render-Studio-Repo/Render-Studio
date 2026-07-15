/**
 * Component profile popup.
 */

import { recognizePart } from "./part-catalog.js";

const WIRING_TYPE_OPTIONS = [
  ["", "— none / not electronic —"],
  ["arduino-uno", "Arduino (Uno/Nano)"],
  ["arduino-mega", "Arduino Mega"],
  ["raspberry-pi", "Raspberry Pi"],
  ["stepper", "Stepper motor"],
  ["servo-motor", "Servo motor"],
  ["motor", "DC motor"],
  ["motor-driver", "Motor driver"],
  ["transistor", "Transistor"],
  ["diode", "Diode"],
  ["resistor", "Resistor"],
  ["led", "LED"],
  ["button", "Push button"],
  ["sensor", "Sensor / module"],
  ["breadboard", "Breadboard"],
];

export function createComponentProfileUI({ api, rawFetch, getProjectId, createMiniViewer, onProfileChange, onImportSource } = {}) {
  let entry = null;
  let profile = null;
  let viewer = null;
  let blobUrl = null;
  let activeProjectId = null;

  const overlay = document.createElement("div");
  overlay.className = "comp-profile-overlay hidden";
  overlay.innerHTML = `
    <div class="comp-profile-modal" role="dialog" aria-label="Component profile">
      <div class="comp-profile-head">
        <div class="comp-profile-head-text">
          <strong class="comp-profile-title">Component</strong>
          <div class="comp-profile-tags hidden">
            <code class="comp-profile-id"></code>
            <span class="comp-profile-type-tag"></span>
          </div>
        </div>
        <button type="button" class="comp-profile-close" aria-label="Close">✕</button>
      </div>
      <div class="comp-profile-body">
        <div class="comp-profile-left">
          <div class="comp-profile-viewer" aria-label="3D preview"></div>
          <div class="comp-profile-source-preview hidden">
            <span class="muted small">Catalog preview</span>
            <img class="comp-profile-source-img" alt="Sourced part preview" />
          </div>
        </div>
        <div class="comp-profile-right">
          <div class="comp-profile-section">
            <label class="comp-profile-field">
              <span>Recognized as</span>
              <span class="comp-profile-kind"></span>
            </label>
            <label class="comp-profile-field">
              <span>Display name</span>
              <input type="text" class="comp-profile-label" />
            </label>
            <label class="comp-profile-field">
              <span>Electrical type (pins)</span>
              <select class="comp-profile-type"></select>
            </label>
          </div>

          <div class="comp-profile-section">
            <h4>Statistics</h4>
            <div class="comp-profile-stats"></div>
          </div>

          <div class="comp-profile-section">
            <h4>Source the part online</h4>
            <div class="comp-profile-search-row">
              <input type="text" class="comp-profile-search" placeholder="Search step.parts (e.g. NEMA 17 stepper)" />
              <button type="button" class="btn secondary comp-profile-search-btn">Search</button>
            </div>
            <div class="comp-profile-results"></div>
            <div class="comp-profile-source-links"></div>
          </div>
        </div>
      </div>
      <div class="comp-profile-foot">
        <span class="comp-profile-status muted small"></span>
        <span class="comp-profile-foot-actions">
          <button type="button" class="btn comp-profile-cancel">Close</button>
          <button type="button" class="btn accent comp-profile-save">Save profile</button>
        </span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const titleEl = $(".comp-profile-title");
  const tagsEl = $(".comp-profile-tags");
  const idEl = $(".comp-profile-id");
  const typeTagEl = $(".comp-profile-type-tag");
  const kindEl = $(".comp-profile-kind");
  const labelInput = $(".comp-profile-label");
  const typeSelect = $(".comp-profile-type");
  const statsEl = $(".comp-profile-stats");
  const searchInput = $(".comp-profile-search");
  const resultsEl = $(".comp-profile-results");
  const sourceLinksEl = $(".comp-profile-source-links");
  const sourcePreview = $(".comp-profile-source-preview");
  const sourceImg = $(".comp-profile-source-img");
  const viewerEl = $(".comp-profile-viewer");
  const statusEl = $(".comp-profile-status");

  for (const [value, label] of WIRING_TYPE_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    typeSelect.appendChild(opt);
  }

  function setStatus(text, kind = "") {
    statusEl.textContent = text || "";
    statusEl.className = `comp-profile-status small ${kind}`;
  }

  function renderStats() {
    const stats = profile?.stats || {};
    const keys = Object.keys(stats);
    if (!keys.length) {
      statsEl.innerHTML = `<p class="muted small">No statistics yet — source the part online to pull its specs.</p>`;
      return;
    }
    statsEl.innerHTML = `<table class="comp-profile-stats-table"><tbody>${keys
      .map((k) => `<tr><th>${escapeHtml(prettyKey(k))}</th><td>${escapeHtml(formatVal(stats[k]))}</td></tr>`)
      .join("")}</tbody></table>`;
  }

  function renderSourceLinks() {
    const src = profile?.source;
    if (!src) {
      sourceLinksEl.innerHTML = "";
      sourcePreview.classList.add("hidden");
      return;
    }
    const links = [];
    if (src.page_url) links.push(`<a href="${escapeAttr(src.page_url)}" target="_blank" rel="noopener">View on step.parts ↗</a>`);
    if (src.product_page_url) links.push(`<a href="${escapeAttr(src.product_page_url)}" target="_blank" rel="noopener">Product Page ↗</a>`);
    if (src.step_url) links.push(`<a href="${escapeAttr(src.step_url)}" target="_blank" rel="noopener">Download STEP ↗</a>`);
    sourceLinksEl.innerHTML = `
      <div class="comp-profile-linked">
        Linked: <strong>${escapeHtml(src.name || src.id || "part")}</strong>${links.length ? ` · ${links.join(" · ")}` : ""}
        ${src.step_url ? `<button type="button" class="btn secondary comp-profile-import-step">Import STEP to project</button>` : ""}
      </div>
    `;
    sourceLinksEl.querySelector(".comp-profile-import-step")?.addEventListener("click", async () => {
      setStatus("Preparing STEP import…");
      try {
        const result = await onImportSource?.({ source: src, profile, entry, projectId: activeProjectId });
        if (result) setStatus(`Imported ${result.filename || src.name || "STEP"} to project.`, "ok");
        else setStatus("");
      } catch (err) {
        setStatus(err.message || "Could not import STEP.", "error");
      }
    });
    if (src.png_url) {
      sourceImg.src = src.png_url;
      sourcePreview.classList.remove("hidden");
    } else {
      sourcePreview.classList.add("hidden");
    }
  }

  function renderTags() {
    const pid = activeProjectId;
    const stem = entry?.stem || entry?.name?.replace(/\.[^.]+$/, "") || entry?.name || "";
    const idToken = pid && stem ? `component:${pid}:${stem}` : "";
    const recognized = stem ? recognizePart(stem) : null;
    const wiringType = profile?.wiring_type || "";
    const kindLabel = profile?.kind || recognized?.kind || "";
    const tagLabel = wiringType ? wiringType.replace(/-/g, " ") : "";
    const hasTags = idToken || tagLabel;

    if (!hasTags) {
      tagsEl.classList.add("hidden");
      return;
    }

    tagsEl.classList.remove("hidden");
    idEl.textContent = idToken;
    idEl.title = idToken;

    if (tagLabel) {
      typeTagEl.textContent = `${tagLabel}${profile?.source ? " ✓" : ""}`;
      typeTagEl.title = profile?.source ? `Sourced: ${kindLabel || tagLabel}` : kindLabel || tagLabel;
      typeTagEl.className = `comp-profile-type-tag${profile?.source ? " comp-profile-type-tag--sourced" : ""}`;
      typeTagEl.classList.remove("hidden");
    } else {
      typeTagEl.textContent = "";
      typeTagEl.classList.add("hidden");
    }
  }

  function renderProfile() {
    kindEl.textContent = profile?.kind || "Unrecognized part";
    labelInput.value = profile?.label || entry?.stem || "";
    typeSelect.value = profile?.wiring_type || "";
    renderTags();
    renderStats();
    renderSourceLinks();
  }

  async function loadProjectModel() {
    const pid = activeProjectId;
    const viewerFile = entry?.viewer_filename || entry?.name;
    if (!pid || !viewerFile || !viewer) return;
    try {
      const res = await rawFetch(`/api/projects/${pid}/files/${encodeURIComponent(viewerFile)}`);
      if (!res.ok) throw new Error("model fetch failed");
      const blob = await res.blob();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      await viewer.load(blobUrl);
    } catch {
      // STEP without a GLB viewer file, or fetch error — leave the viewer empty.
    }
  }

  async function runSearch() {
    const pid = activeProjectId;
    if (!pid) return;
    const q = searchInput.value.trim();
    resultsEl.innerHTML = `<p class="muted small">Searching catalog…</p>`;
    try {
      const data = await api(`/api/projects/${pid}/parts/${encodeURIComponent(entry.stem)}/sources?q=${encodeURIComponent(q)}`);
      renderResults(data.candidates || []);
    } catch (err) {
      resultsEl.innerHTML = `<p class="status error">${escapeHtml(err.message || "Catalog search failed.")}</p>`;
    }
  }

  function renderResults(candidates) {
    if (!candidates.length) {
      resultsEl.innerHTML = `<p class="muted small">No catalog matches. Try different keywords.</p>`;
      return;
    }
    resultsEl.innerHTML = "";
    for (const c of candidates) {
      const card = document.createElement("div");
      card.className = "comp-profile-result";
      const attrs = Object.entries(c.attributes || {}).slice(0, 4)
        .map(([k, v]) => `${prettyKey(k)}: ${formatVal(v)}`).join(" · ");
      card.innerHTML = `
        <div class="comp-profile-result-thumb">${c.png_url ? `<img src="${escapeAttr(c.png_url)}" alt="" loading="lazy" />` : ""}</div>
        <div class="comp-profile-result-main">
          <strong>${escapeHtml(c.name || c.id || "part")}</strong>
          <span class="muted small">${escapeHtml([c.category, c.family].filter(Boolean).join(" / "))}${c.wiring_type ? ` · maps to ${escapeHtml(c.wiring_type)}` : ""}</span>
          ${attrs ? `<span class="muted small">${escapeHtml(attrs)}</span>` : ""}
        </div>
        <button type="button" class="btn secondary comp-profile-use">Use this</button>
      `;
      card.querySelector(".comp-profile-use").addEventListener("click", () => linkCandidate(c));
      resultsEl.appendChild(card);
    }
  }

  async function linkCandidate(candidate) {
    const pid = activeProjectId;
    if (!pid) return;
    setStatus("Linking part…");
    try {
      profile = await api(`/api/projects/${pid}/parts/${encodeURIComponent(entry.stem)}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate }),
      });
      renderProfile();
      setStatus(`Linked ${candidate.name || "part"}. Stats and 3D source attached.`, "ok");
      onProfileChange?.(entry.stem, profile);
    } catch (err) {
      setStatus(err.message || "Could not link part.", "error");
    }
  }

  async function save() {
    const pid = activeProjectId;
    if (!pid) return;
    setStatus("Saving…");
    try {
      profile = await api(`/api/projects/${pid}/parts/${encodeURIComponent(entry.stem)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: labelInput.value.trim(),
          wiring_type: typeSelect.value || null,
          confidence: "user",
        }),
      });
      renderProfile();
      setStatus("Profile saved.", "ok");
      onProfileChange?.(entry.stem, profile);
    } catch (err) {
      setStatus(err.message || "Save failed.", "error");
    }
  }

  $(".comp-profile-close").addEventListener("click", close);
  $(".comp-profile-cancel").addEventListener("click", close);
  $(".comp-profile-save").addEventListener("click", save);
  $(".comp-profile-search-btn").addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });

  async function open(componentEntry, projectIdOverride) {
    entry = componentEntry;
    activeProjectId = projectIdOverride || getProjectId?.();
    const pid = activeProjectId;
    if (!entry || !pid) return;
    titleEl.textContent = entry.label || entry.stem || entry.name || "Component";
    searchInput.value = (entry.stem || "").replace(/[_\-]+/g, " ").trim();
    setStatus("");
    resultsEl.innerHTML = "";
    overlay.classList.remove("hidden");

    if (!viewer && createMiniViewer) viewer = createMiniViewer(viewerEl, { autoRotate: true });

    try {
      profile = await api(`/api/projects/${pid}/parts/${encodeURIComponent(entry.stem)}`);
    } catch {
      profile = { stem: entry.stem, label: entry.label, wiring_type: null, kind: "Unrecognized part", stats: {} };
    }
    renderProfile();
    loadProjectModel();
  }

  function close() {
    overlay.classList.add("hidden");
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
  }

  return { open, close, isOpen: () => !overlay.classList.contains("hidden") };
}

function prettyKey(k) {
  return String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function formatVal(v) {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
