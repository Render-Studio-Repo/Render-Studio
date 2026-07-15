/** Skills Library — enable text-to-cad agent skills for CAD generation prompts */

import { authHeaders, getToken } from "./auth.js";

const STORAGE_KEY = "render3d:enabled-skills";
const SKILL_MEDIA_KEY = "render3d:skill-media:v1";
const DEFAULT_ENABLED = ["cad"];
const BLUEPRINT_VISION_ID = "blueprint-vision";

let catalog = [];
let provenance = {};
let enabled = loadEnabled();
let blueprintVisionAutoEnabled = false;
let blueprintVisionOptOut = false;

function authedFetch(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
}

function loadEnabled() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_ENABLED];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((s) => String(s).toLowerCase()) : [...DEFAULT_ENABLED];
  } catch {
    return [...DEFAULT_ENABLED];
  }
}

function saveEnabled() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
  window.dispatchEvent(new CustomEvent("render3d:skills-changed", { detail: { enabled: [...enabled] } }));
}

export function getEnabledSkills() {
  return [...enabled];
}

const DXF_SKILL_ID = "dxf";

/** Skills sent with a prompt — auto-includes Blueprint Vision + DXF when images are attached. */
export function getEnabledSkillsForPrompt({ hasImages = false } = {}) {
  const ids = new Set(enabled.map((s) => s.toLowerCase()));
  if (hasImages && !blueprintVisionOptOut) {
    ids.add(BLUEPRINT_VISION_ID);
    ids.add(DXF_SKILL_ID);
  }
  return [...ids];
}

/** Turn Blueprint Vision + DXF on/off based on attached prompt images. */
export function syncBlueprintVisionForImages(imageCount) {
  if (imageCount > 0) {
    if (!enabled.includes(BLUEPRINT_VISION_ID)) {
      enabled.push(BLUEPRINT_VISION_ID);
      blueprintVisionAutoEnabled = true;
    }
    if (!enabled.includes(DXF_SKILL_ID)) {
      enabled.push(DXF_SKILL_ID);
    }
    saveEnabled();
    return;
  }
  blueprintVisionOptOut = false;
  if (blueprintVisionAutoEnabled) {
    enabled = enabled.filter((s) => s !== BLUEPRINT_VISION_ID && s !== DXF_SKILL_ID);
    blueprintVisionAutoEnabled = false;
    saveEnabled();
  }
}

export function isSkillEnabled(skillId) {
  return enabled.includes(String(skillId).toLowerCase());
}

export function setSkillEnabled(skillId, on) {
  const id = String(skillId).toLowerCase();
  if (on) {
    if (!enabled.includes(id)) enabled.push(id);
    if (id === BLUEPRINT_VISION_ID) {
      blueprintVisionOptOut = false;
      blueprintVisionAutoEnabled = false;
    }
  } else {
    enabled = enabled.filter((s) => s !== id);
    if (id === BLUEPRINT_VISION_ID) {
      blueprintVisionOptOut = true;
      blueprintVisionAutoEnabled = false;
    }
  }
  saveEnabled();
}

export function toggleSkill(skillId) {
  const id = String(skillId).toLowerCase();
  setSkillEnabled(id, !enabled.includes(id));
  return enabled.includes(id);
}

export function getSkillCatalog() {
  return [...catalog];
}

export async function fetchSkillsCatalog(apiFn = fetch) {
  try {
    const res = await apiFn("/api/skills", { headers: authHeaders() });
    if (!res.ok) return catalog;
    const data = await res.json();
    catalog = data.skills || [];
    provenance = data.provenance || {};
    return catalog;
  } catch {
    return catalog;
  }
}

export function skillLabel(skillId) {
  const id = String(skillId).toLowerCase();
  const item = catalog.find((s) => s.id === id);
  return item?.name || id;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readSkillMediaMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SKILL_MEDIA_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readSkillMedia(skillId) {
  return readSkillMediaMap()[String(skillId || "").toLowerCase()] || null;
}

function writeSkillMedia(skillId, media) {
  const id = String(skillId || "").toLowerCase();
  if (!id) return;
  const map = readSkillMediaMap();
  if (media) map[id] = media;
  else delete map[id];
  try {
    localStorage.setItem(SKILL_MEDIA_KEY, JSON.stringify(map));
  } catch {
    throw new Error("That clip is too large to save in this browser. Try a smaller GIF or short WebM/MP4.");
  }
}

function toolsLine(skill) {
  const tools = skill.tools || [];
  const refs = skill.references || [];
  const bits = [];
  if (tools.length) bits.push(`${tools.length} Python tool${tools.length === 1 ? "" : "s"}: ${tools.join(", ")}`);
  if (refs.length) bits.push(`${refs.length} reference doc${refs.length === 1 ? "" : "s"}`);
  return bits.length ? `<p class="skill-card-meta muted small">${bits.join(" · ")}</p>` : "";
}

function skillCategory(skill = {}) {
  const text = `${skill.id || ""} ${skill.name || ""} ${skill.description || ""}`.toLowerCase();
  if (/urdf|srdf|sdf|robot|moveit/.test(text)) return "Robotics";
  if (/blueprint|vision|image|photo|dxf/.test(text)) return "Vision";
  if (/gcode|bambu|sendcutsend|manufactur|mold|silicone/.test(text)) return "Manufacturing";
  if (/cad|step|build123d|implicit|viewer|parts/.test(text)) return "CAD";
  return "Agent";
}

function skillStoreUrl(skill = {}) {
  const slug = skill.install_slug || skill.marketplace_slug || skill.slug || skill.id || "";
  return skill.store_url
    || skill.user_store_url
    || skill.marketplace_url
    || skill.source_url
    || (slug ? `/agent-store.html?skill=${encodeURIComponent(slug)}` : "/agent-store.html");
}

function skillVisualKind(skill = {}) {
  const text = `${skill.id || ""} ${skill.name || ""} ${skill.description || ""}`.toLowerCase();
  if (/house|architect|room|wall|roof|window/.test(text)) return "build";
  if (/bambu|gcode|print|manufactur|mold|silicone|sendcutsend/.test(text)) return "make";
  if (/vision|blueprint|image|photo|drawing|diagram/.test(text)) return "scan";
  if (/robot|urdf|srdf|sdf|moveit|joint|motion/.test(text)) return "robot";
  if (/cad|step|part|assembly|inspect|validate/.test(text)) return "cad";
  return "agent";
}

function skillHowToText(skill = {}) {
  const name = skill.name || skill.id || "This skill";
  const desc = String(skill.description || skill.preview || "").trim();
  const category = skillCategory(skill).toLowerCase();
  const base = desc
    ? `${name} helps Render3D ${desc.charAt(0).toLowerCase()}${desc.slice(1)}`
    : `${name} adds a focused ${category} workflow to Render3D.`;
  return `${base} Enable it for prompts, then describe the output you want in Studio; Render3D will route relevant requests to @skill:${skill.id} and use its tools or references when they apply.`;
}

function skillMediaHtml(skill = {}) {
  const media = readSkillMedia(skill.id);
  if (!media?.dataUrl) return "";
  const label = media.kind === "generated" ? "Generated loop" : "Uploaded clip";
  if (String(media.type || "").startsWith("video/")) {
    return `<video class="skill-card-media" src="${escapeHtml(media.dataUrl)}" autoplay muted loop playsinline title="${escapeHtml(label)}"></video>`;
  }
  return `<img class="skill-card-media" src="${escapeHtml(media.dataUrl)}" alt="${escapeHtml(label)} for ${escapeHtml(skill.name || skill.id)}" />`;
}

function skillVisualHtml(skill = {}) {
  const category = skillCategory(skill).toLowerCase();
  const visualKind = skillVisualKind(skill);
  const initials = String(skill.name || skill.id || "SK").split(/[\s-_]+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  const mediaHtml = skillMediaHtml(skill);
  return `
    <div class="skill-card-visual skill-card-visual--${escapeHtml(category)} skill-card-visual--${escapeHtml(visualKind)}" aria-hidden="true">
      ${mediaHtml || `
        <span class="skill-anim-grid"></span>
        <span class="skill-anim-path"></span>
        <span class="skill-anim-object skill-anim-object--a"></span>
        <span class="skill-anim-object skill-anim-object--b"></span>
        <span class="skill-card-orbit"></span>
        <span class="skill-card-gear"></span>
        <strong>${escapeHtml(initials || "SK")}</strong>
      `}
    </div>
  `;
}

function skillSearchText(skill = {}) {
  return [
    skill.id,
    skill.name,
    skill.description,
    skill.preview,
    skillCategory(skill),
    ...(skill.tools || []),
    ...(skill.references || []),
  ].join(" ").toLowerCase();
}

export function createSkillsPromptUI({
  chipsEl,
  linkEl,
  toggleEl = null,
  planEl = null,
  promptEl = null,
  getHasImages = () => false,
  onChange,
}) {
  const COLLAPSE_KEY = "render3d:prompt-skills-expanded";
  let expanded = localStorage.getItem(COLLAPSE_KEY) === "1";
  let planned = [];
  let previewTimer = null;
  let previewSeq = 0;

  function setExpanded(next) {
    expanded = !!next;
    try {
      localStorage.setItem(COLLAPSE_KEY, expanded ? "1" : "0");
    } catch {
      /* local storage is best-effort */
    }
    render();
  }

  function render() {
    if (!chipsEl) return;
    if (!enabled.length) {
      chipsEl.innerHTML = '<span class="muted small">No skills active — <a href="/skills.html">enable in Skills Library</a></span>';
      if (linkEl) linkEl.textContent = "";
      if (toggleEl) {
        toggleEl.textContent = "No skills active";
        toggleEl.setAttribute("aria-expanded", "false");
      }
      chipsEl.classList.remove("is-collapsed");
      return;
    }
    chipsEl.classList.toggle("is-collapsed", !expanded);
    chipsEl.innerHTML = enabled
      .map(
        (id) =>
          `<span class="skill-chip" title="${escapeHtml(skillLabel(id))} skill active for prompts"><span class="skill-chip-prefix">@skill</span>:${escapeHtml(id)}</span>`
      )
      .join("");
    if (toggleEl) {
      toggleEl.textContent = `${enabled.length} skill${enabled.length === 1 ? "" : "s"} active`;
      toggleEl.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggleEl.title = expanded ? "Minimize active skill chips" : "Expand active skill chips";
    }
    if (linkEl) {
      linkEl.innerHTML = `<a href="/skills.html" class="skills-manage-link">Manage</a>`;
    }
  }

  function renderPlan({ loading = false } = {}) {
    if (!planEl) return;
    const prompt = (promptEl?.value || "").trim();
    if (!prompt) {
      planned = [];
      planEl.innerHTML = "";
      planEl.classList.add("hidden");
      return;
    }
    planEl.classList.remove("hidden");
    if (loading && !planned.length) {
      planEl.innerHTML = '<span class="muted small">Planning skills...</span>';
      return;
    }
    const availableToAdd = catalog.filter((skill) => {
      const id = String(skill.id || "").toLowerCase();
      return id && (!skill.install_required || skill.installed) && !enabled.includes(id);
    });
    const chips = planned.length
      ? planned
          .map(
            (skill) => `
          <span class="skill-chip skill-chip--planned" title="${escapeHtml(skill.description || skill.name || skill.id)}">
            <span class="skill-chip-prefix">planned</span>:${escapeHtml(skill.id)}
            <button type="button" class="skill-chip-remove" data-skill-remove="${escapeHtml(skill.id)}" aria-label="Remove ${escapeHtml(skill.name || skill.id)}">×</button>
          </span>
        `
          )
          .join("")
      : '<span class="muted small">Type a prompt to preview planned skills.</span>';
    const addControl = availableToAdd.length
      ? `<label class="prompt-skill-add small">Add skill
          <select data-skill-add>
            <option value="">Choose...</option>
            ${availableToAdd.map((skill) => `<option value="${escapeHtml(skill.id)}">${escapeHtml(skill.name || skill.id)}</option>`).join("")}
          </select>
        </label>`
      : '<a href="/skills.html" class="skills-manage-link small">Manage skills</a>';
    planEl.innerHTML = `
      <span class="prompt-skills-label">Will use</span>
      <div class="prompt-skills-chips prompt-skills-chips--planned">${chips}</div>
      ${addControl}
    `;
    planEl.querySelectorAll("[data-skill-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setSkillEnabled(btn.dataset.skillRemove, false);
        updatePlanNow();
      });
    });
    planEl.querySelector("[data-skill-add]")?.addEventListener("change", (event) => {
      const id = event.target.value;
      if (!id) return;
      setSkillEnabled(id, true);
      updatePlanNow();
    });
  }

  async function updatePlanNow() {
    if (!planEl) return;
    const seq = ++previewSeq;
    const prompt = promptEl?.value || "";
    if (!prompt.trim()) {
      planned = [];
      renderPlan();
      return;
    }
    renderPlan({ loading: true });
    try {
      const res = await authedFetch("/api/skills/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          skills: getEnabledSkillsForPrompt({ hasImages: !!getHasImages() }),
          has_images: !!getHasImages(),
        }),
      });
      if (seq !== previewSeq) return;
      if (!res.ok) throw new Error("Could not preview skills");
      const data = await res.json();
      planned = data.skills || [];
      renderPlan();
    } catch {
      if (seq !== previewSeq) return;
      planEl.classList.remove("hidden");
      planEl.innerHTML =
        '<span class="muted small">Skill preview unavailable. Generation will still resolve skills on submit.</span>';
    }
  }

  function schedulePlanUpdate() {
    if (!planEl) return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(updatePlanNow, 250);
  }

  toggleEl?.addEventListener("click", () => setExpanded(!expanded));
  promptEl?.addEventListener("input", schedulePlanUpdate);
  window.addEventListener("render3d:skills-changed", () => {
    render();
    schedulePlanUpdate();
  });
  onChange?.(getEnabledSkills());
  render();
  renderPlan();
  schedulePlanUpdate();

  return { render, getEnabled: getEnabledSkills, setExpanded, updatePlan: updatePlanNow };
}

export function initSkillsLibraryPage({ listEl, detailEl, statusEl, searchEl = null, sortEl = null, viewButtons = [], apiFn = fetch }) {
  let query = "";
  let sortMode = "name";
  let viewMode = "grid";

  function sortedFilteredCatalog() {
    const needle = query.trim().toLowerCase();
    const rows = needle ? catalog.filter((skill) => skillSearchText(skill).includes(needle)) : [...catalog];
    rows.sort((a, b) => {
      if (sortMode === "active") {
        return Number(isSkillEnabled(b.id)) - Number(isSkillEnabled(a.id)) || String(a.name || a.id).localeCompare(String(b.name || b.id));
      }
      if (sortMode === "tools") {
        return (b.tools || []).length - (a.tools || []).length || String(a.name || a.id).localeCompare(String(b.name || b.id));
      }
      if (sortMode === "references") {
        return (b.references || []).length - (a.references || []).length || String(a.name || a.id).localeCompare(String(b.name || b.id));
      }
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
    return rows;
  }

  function renderCatalog() {
    if (!listEl) return;
    const rows = sortedFilteredCatalog();
    listEl.className = `skills-list skills-list--${viewMode}`;
    if (!rows.length) {
      listEl.innerHTML = `<p class="muted skills-empty">No skills match your filters.</p>`;
      return;
    }
    listEl.innerHTML = rows
      .map((skill) => {
        const on = isSkillEnabled(skill.id);
        const tools = skill.tools || [];
        const refs = skill.references || [];
        const category = skillCategory(skill);
        const storeUrl = skillStoreUrl(skill);
        const media = readSkillMedia(skill.id);
        return `<article class="skill-card${on ? " skill-card-active" : ""}" data-skill="${escapeHtml(skill.id)}" tabindex="0">
          ${skillVisualHtml(skill)}
          <div class="skill-card-body">
            <div class="skill-card-head">
              <div>
                <span class="skill-card-category">${escapeHtml(category)}</span>
                <h3 class="skill-card-title">${escapeHtml(skill.name || skill.id)}</h3>
                <p class="skill-card-id mono muted small">@skill:${escapeHtml(skill.id)}</p>
              </div>
              <label class="skill-toggle" title="${on ? "Disable" : "Enable"} for CAD prompts">
                <input type="checkbox" data-skill-toggle="${escapeHtml(skill.id)}" ${on ? "checked" : ""} />
                <span class="skill-toggle-ui"></span>
              </label>
            </div>
            <p class="skill-card-desc">${escapeHtml(skill.description || skill.preview || "")}</p>
            <div class="skill-stats">
              <span>${tools.length} tool${tools.length === 1 ? "" : "s"}</span>
              <span>${refs.length} ref${refs.length === 1 ? "" : "s"}</span>
              <span>${media ? (media.kind === "generated" ? "3D loop" : "Clip") : "Loop ready"}</span>
              <span>${skill.install_required && !skill.installed ? "Download" : "Ready"}</span>
            </div>
            ${toolsLine(skill)}
            <div class="skill-card-actions">
              <button type="button" class="btn secondary btn-compact skill-view-btn" data-skill-view="${escapeHtml(skill.id)}">More info</button>
              <a class="btn secondary btn-compact" href="${escapeHtml(storeUrl)}" target="${storeUrl.startsWith("http") ? "_blank" : "_self"}" rel="noopener">User store</a>
            </div>
          </div>
        </article>`;
      })
      .join("");

    listEl.querySelectorAll("[data-skill-toggle]").forEach((input) => {
      input.addEventListener("change", (event) => {
        event.stopPropagation();
        setSkillEnabled(input.dataset.skillToggle, input.checked);
        renderCatalog();
        renderStatus();
      });
    });

    listEl.querySelectorAll("[data-skill-view]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        void showSkillDetail(btn.dataset.skillView);
      });
    });

    listEl.querySelectorAll(".skill-card").forEach((card) => {
      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button, input, label")) return;
        void showSkillDetail(card.dataset.skill);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void showSkillDetail(card.dataset.skill);
      });
    });
  }

  function renderStatus() {
    if (!statusEl) return;
    const n = enabled.length;
    const rows = sortedFilteredCatalog();
    const src = provenance.source
      ? ` · synced from <a href="${provenance.source}" target="_blank" rel="noopener">text-to-cad</a>`
      : "";
    const rev = provenance.revision ? ` @ ${provenance.revision.slice(0, 7)}` : "";
    statusEl.innerHTML = n
      ? `${n} skill${n === 1 ? "" : "s"} active · showing ${rows.length}/${catalog.length} installed${rev}${src}`
      : `No skills enabled · showing ${rows.length}/${catalog.length} available${rev}${src}`;
  }

  async function showSkillDetail(id) {
    if (!detailEl || !id) return;
    detailEl.classList.remove("hidden");
    detailEl.innerHTML = '<p class="muted">Loading skill details…</p>';
    try {
      const res = await apiFn(`/api/skills/${encodeURIComponent(id)}?full=true`);
      if (!res.ok) throw new Error("Skill not found");
      const skill = await res.json();
      const catalogSkill = catalog.find((item) => item.id === id) || {};
      const merged = { ...catalogSkill, ...skill };
      const tools = merged.tools || [];
      const refs = merged.references || [];
      const storeUrl = skillStoreUrl(merged);
      const referenceBodies = merged.reference_bodies || {};
      const media = readSkillMedia(merged.id);
      detailEl.innerHTML = `<div class="skill-detail-head">
          <div>
            <span class="skill-card-category">${escapeHtml(skillCategory(merged))}</span>
            <h3>${escapeHtml(merged.name || merged.id)}</h3>
            <p class="muted small">@skill:${escapeHtml(merged.id)}</p>
          </div>
          <button type="button" class="btn secondary btn-compact" data-skill-close>Close</button>
        </div>
        <div class="skill-detail-grid">
          ${skillVisualHtml(merged)}
          <div>
            <p>${escapeHtml(merged.description || merged.preview || "No description provided.")}</p>
            <p class="skill-detail-explainer">${escapeHtml(skillHowToText(merged))}</p>
            <div class="skill-stats skill-stats--detail">
              <span>${tools.length} Python tool${tools.length === 1 ? "" : "s"}</span>
              <span>${refs.length} reference doc${refs.length === 1 ? "" : "s"}</span>
              <span>${media ? (media.kind === "generated" ? "Generated 3D loop" : "Uploaded clip") : "Animated preview"}</span>
              <span>${merged.installed === false ? "Needs download" : "Available"}</span>
            </div>
            <div class="skill-card-actions">
              <a class="btn accent btn-compact" href="${escapeHtml(storeUrl)}" target="${storeUrl.startsWith("http") ? "_blank" : "_self"}" rel="noopener">Open user store</a>
              <button type="button" class="btn secondary btn-compact" data-skill-enable="${escapeHtml(merged.id)}">${isSkillEnabled(merged.id) ? "Disable skill" : "Enable skill"}</button>
            </div>
            <div class="skill-media-tools">
              <label class="btn secondary btn-compact">
                Upload GIF/clip
                <input type="file" data-skill-media-upload="${escapeHtml(merged.id)}" accept="image/gif,image/webp,image/png,video/mp4,video/webm" hidden />
              </label>
              <button type="button" class="btn secondary btn-compact" data-skill-media-generate="${escapeHtml(merged.id)}">Generate 3D loop</button>
              ${media?.dataUrl ? `<button type="button" class="btn ghost btn-compact" data-skill-media-clear="${escapeHtml(merged.id)}">Clear media</button>` : ""}
              <small class="muted">Use a small repeating GIF/WebM/MP4, or generate a Render3D loop from the skill summary.</small>
            </div>
          </div>
        </div>
        <p class="muted small skill-detail-meta">Tools: ${escapeHtml(tools.join(", ") || "none listed")}</p>
        <p class="muted small skill-detail-meta">References: ${escapeHtml(refs.slice(0, 16).join(", ") || "none listed")}${refs.length > 16 ? "…" : ""}</p>
        ${Object.keys(referenceBodies).length ? `<details class="skill-reference-preview" open>
          <summary>Reference previews</summary>
          ${Object.entries(referenceBodies).slice(0, 4).map(([name, body]) => `<section><strong>${escapeHtml(name)}</strong><pre>${escapeHtml(String(body || ""))}</pre></section>`).join("")}
        </details>` : ""}
        <details class="skill-markdown-preview" open>
          <summary>SKILL.md preview</summary>
          <pre class="skill-detail-body">${escapeHtml(merged.content || "")}</pre>
        </details>`;
      detailEl.querySelector("[data-skill-close]")?.addEventListener("click", () => {
        detailEl.classList.add("hidden");
      });
      detailEl.querySelector("[data-skill-enable]")?.addEventListener("click", (event) => {
        const skillId = event.currentTarget.getAttribute("data-skill-enable");
        setSkillEnabled(skillId, !isSkillEnabled(skillId));
        renderCatalog();
        renderStatus();
        void showSkillDetail(skillId);
      });
      detailEl.querySelector("[data-skill-media-upload]")?.addEventListener("change", (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 2_500_000) {
          detailEl.querySelector(".skill-media-tools small").textContent = "Clip is too large. Use a GIF/WebM/MP4 under 2.5 MB.";
          input.value = "";
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          try {
            writeSkillMedia(input.dataset.skillMediaUpload, {
              kind: "uploaded",
              type: file.type || "image/gif",
              name: file.name,
              dataUrl: reader.result,
              at: new Date().toISOString(),
            });
            renderCatalog();
            void showSkillDetail(input.dataset.skillMediaUpload);
          } catch (err) {
            detailEl.querySelector(".skill-media-tools small").textContent = err.message || "Could not save this clip.";
          }
        };
        reader.readAsDataURL(file);
      });
      detailEl.querySelector("[data-skill-media-generate]")?.addEventListener("click", (event) => {
        const skillId = event.currentTarget.dataset.skillMediaGenerate;
        writeSkillMedia(skillId, {
          kind: "generated",
          type: "render3d/skill-loop",
          dataUrl: "",
          visualKind: skillVisualKind(merged),
          at: new Date().toISOString(),
        });
        renderCatalog();
        void showSkillDetail(skillId);
      });
      detailEl.querySelector("[data-skill-media-clear]")?.addEventListener("click", (event) => {
        const skillId = event.currentTarget.dataset.skillMediaClear;
        writeSkillMedia(skillId, null);
        renderCatalog();
        void showSkillDetail(skillId);
      });
      detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      detailEl.innerHTML = `<p class="status error">${escapeHtml(err.message)}</p>`;
    }
  }

  async function load() {
    if (statusEl) statusEl.textContent = "Loading skills…";
    await fetchSkillsCatalog(apiFn);
    if (!listEl) return;
    if (!catalog.length) {
      listEl.innerHTML =
        '<p class="muted">No skills installed. Run <code>scripts/sync-skills-from-text-to-cad.sh</code> on the server.</p>';
      if (statusEl) statusEl.textContent = "";
      return;
    }
    renderCatalog();
    renderStatus();
  }

  searchEl?.addEventListener("input", () => {
    query = searchEl.value || "";
    renderCatalog();
    renderStatus();
  });
  sortEl?.addEventListener("change", () => {
    sortMode = sortEl.value || "name";
    renderCatalog();
    renderStatus();
  });
  viewButtons?.forEach?.((btn) => {
    btn.addEventListener("click", () => {
      viewMode = btn.getAttribute("data-skills-view") || "grid";
      viewButtons.forEach((item) => item.classList.toggle("active", item === btn));
      renderCatalog();
    });
  });
  window.addEventListener("render3d:skills-changed", () => {
    renderCatalog();
    renderStatus();
  });
  load();
}
