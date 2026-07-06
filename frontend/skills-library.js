/** Skills Library — enable text-to-cad agent skills for CAD generation prompts */

import { authHeaders, getToken } from "./auth.js";

const STORAGE_KEY = "render3d:enabled-skills";
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
    .replace(/>/g, "&gt;");
}

function toolsLine(skill) {
  const tools = skill.tools || [];
  const refs = skill.references || [];
  const bits = [];
  if (tools.length) bits.push(`${tools.length} Python tool${tools.length === 1 ? "" : "s"}: ${tools.join(", ")}`);
  if (refs.length) bits.push(`${refs.length} reference doc${refs.length === 1 ? "" : "s"}`);
  return bits.length ? `<p class="skill-card-meta muted small">${bits.join(" · ")}</p>` : "";
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

export function initSkillsLibraryPage({ listEl, detailEl, statusEl, apiFn = fetch }) {
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
    listEl.innerHTML = catalog
      .map((skill) => {
        const on = isSkillEnabled(skill.id);
        return `<article class="skill-card${on ? " skill-card-active" : ""}" data-skill="${skill.id}">
          <div class="skill-card-head">
            <div>
              <h3 class="skill-card-title">${escapeHtml(skill.name)}</h3>
              <p class="skill-card-id mono muted small">@skill:${escapeHtml(skill.id)}</p>
            </div>
            <label class="skill-toggle" title="${on ? "Disable" : "Enable"} for CAD prompts">
              <input type="checkbox" data-skill-toggle="${skill.id}" ${on ? "checked" : ""} />
              <span class="skill-toggle-ui"></span>
            </label>
          </div>
          <p class="skill-card-desc">${escapeHtml(skill.description || skill.preview || "")}</p>
          ${toolsLine(skill)}
          <button type="button" class="btn secondary btn-compact skill-view-btn" data-skill-view="${skill.id}">View SKILL.md</button>
        </article>`;
      })
      .join("");

    listEl.querySelectorAll("[data-skill-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        setSkillEnabled(input.dataset.skillToggle, input.checked);
        load();
      });
    });

    listEl.querySelectorAll("[data-skill-view]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.skillView;
        if (!detailEl) return;
        detailEl.classList.remove("hidden");
        detailEl.innerHTML = '<p class="muted">Loading…</p>';
        try {
          const res = await apiFn(`/api/skills/${id}`);
          if (!res.ok) throw new Error("Skill not found");
          const skill = await res.json();
          const tools = (skill.tools || []).join(", ") || "—";
          const refs = (skill.references || []).slice(0, 12).join(", ");
          detailEl.innerHTML = `<div class="skill-detail-head">
              <h3>${escapeHtml(skill.name)}</h3>
              <button type="button" class="btn secondary btn-compact" data-skill-close>Close</button>
            </div>
            <p class="muted small skill-detail-meta">Python tools: ${escapeHtml(tools)}</p>
            <p class="muted small skill-detail-meta">References: ${escapeHtml(refs)}${(skill.references || []).length > 12 ? "…" : ""}</p>
            <pre class="skill-detail-body">${escapeHtml(skill.content || "")}</pre>`;
          detailEl.querySelector("[data-skill-close]")?.addEventListener("click", () => {
            detailEl.classList.add("hidden");
          });
        } catch (err) {
          detailEl.innerHTML = `<p class="status error">${escapeHtml(err.message)}</p>`;
        }
      });
    });

    if (statusEl) {
      const n = enabled.length;
      const src = provenance.source
        ? ` · synced from <a href="${provenance.source}" target="_blank" rel="noopener">text-to-cad</a>`
        : "";
      const rev = provenance.revision ? ` @ ${provenance.revision.slice(0, 7)}` : "";
      statusEl.innerHTML = n
        ? `${n} skill${n === 1 ? "" : "s"} active for prompts · ${catalog.length} installed${rev}${src}`
        : `No skills enabled — ${catalog.length} available${rev}${src}`;
    }
  }

  window.addEventListener("render3d:skills-changed", load);
  load();
}
