/** AI provider key manager — supports multiple saved keys. */
import { DEFAULT_AI_MODEL, ASTRA_MODEL_OPTIONS } from "./ai-model-defaults.js?v=astra-default1&astraoffice=20260917-1&gpt61sol=20261001-1";

const PROVIDER_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  kimi: "Kimi",
  xai: "Grok",
  gemini: "Gemini",
  qwen: "Qwen",
  local: "Local LLM",
};

const PROVIDER_BADGE_CLASS = {
  openai: "badge-openai",
  anthropic: "badge-claude",
  kimi: "badge-kimi",
  xai: "badge-grok",
  gemini: "badge-gemini",
  qwen: "badge-qwen",
  local: "badge-local",
};

const MODEL_OPTIONS = {
  openai: [
    ...ASTRA_MODEL_OPTIONS,
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol · $5/$30" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra · $2/$12" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna · $0.20/$1.20" },
    { value: "gpt-5.5", label: "GPT-5.5 · $5/$30" },
  ],
  anthropic: [
    { value: "claude-fable-5-1", label: "Fable 5.1 · $10/$50" },
    { value: "claude-opus-5", label: "Opus 5 · $5/$25" },
    { value: "claude-fable-5", label: "Fable 5 · $10/$50" },
    { value: "claude-sonnet-4-5", label: "Sonnet 4.5 · $3/$15" },
    { value: "claude-opus-4-8", label: "Opus 4.8 · $5/$25" },
    { value: "claude-4.6-sonnet", label: "Sonnet 4.6 · $3/$15" },
  ],
  kimi: [
    { value: "kimi-k2.6", label: "Kimi K2.6 · $0.95/$4" },
    { value: "kimi-k3", label: "Kimi K3 (V3) · $3/$15" },
  ],
  xai: [
    { value: "grok-4.5", label: "Grok 4.5 · $2/$6" },
  ],
  gemini: [
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash · $0.75/$3.75" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro · $1.25/$10" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash · $0.30/$2.50" },
  ],
  qwen: [
    { value: "qwen3-coder-plus", label: "Qwen3 Coder Plus · $1/$5" },
    { value: "qwen3-coder-flash", label: "Qwen3 Coder Flash · $0.30/$1.50" },
    { value: "qwen-plus", label: "Qwen Plus · $0.40/$1.20" },
    { value: "qwen-max", label: "Qwen Max · $1.60/$6.40" },
    { value: "qwen-turbo", label: "Qwen Turbo · $0.05/$0.20" },
  ],
  local: [
    { value: "qwen2.5-coder:32b", label: "Qwen2.5-Coder 32B (Ollama)" },
    { value: "qwen2.5-coder:14b", label: "Qwen2.5-Coder 14B" },
    { value: "qwen2.5:32b", label: "Qwen2.5 32B" },
    { value: "qwen3:32b", label: "Qwen3 32B" },
    { value: "llama3.1:8b", label: "Llama 3.1 8B" },
    { value: "deepseek-coder-v2", label: "DeepSeek Coder V2" },
    { value: "gpt-oss:20b", label: "GPT-OSS 20B" },
  ],
};

function labelFor(provider) {
  return PROVIDER_LABELS[provider] || provider || "AI";
}

function normalizePlatformProviderId(provider) {
  const p = String(provider || "openai").trim().toLowerCase();
  if (p === "anthropic" || p === "claude") return "anthropic";
  if (p === "kimi" || p === "moonshot") return "kimi";
  if (p === "xai" || p === "grok") return "xai";
  if (p === "gemini" || p === "google") return "gemini";
  if (p === "qwen" || p === "dashscope" || p === "alibaba") return "qwen";
  return "openai";
}

function isRetiredOpenAiModel(value) {
  const m = String(value || "").trim().toLowerCase();
  return m === "gpt-5.5-pro" || m.startsWith("gpt-5.5-pro");
}

function defaultModel(provider) {
  return MODEL_OPTIONS[provider]?.[0]?.value || DEFAULT_AI_MODEL;
}

function keyPlaceholder(provider) {
  if (provider === "anthropic") return "sk-ant-...";
  if (provider === "xai") return "xai-...";
  if (provider === "kimi") return "sk-... (Moonshot / Kimi)";
  if (provider === "gemini") return "AIza... (Google AI Studio)";
  if (provider === "qwen") return "sk-... (DashScope / Model Studio)";
  if (provider === "local") return "optional — ollama / lm-studio / sk-...";
  return "sk-...";
}

function nicknamePlaceholder(provider, shared = false) {
  const label = labelFor(provider);
  return shared ? `e.g. Team ${label} key` : `e.g. My ${label} key`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUsd(value) {
  const n = Number(value || 0);
  return `$${n.toFixed(n >= 10 ? 0 : 2)}`;
}

function formatCents(cents) {
  return formatUsd(Number(cents || 0) / 100);
}

export function createAIKeyUI({ api, onStatusChange, onSelectPromptKey, blockGpt55Pro = null }) {
  const modal = document.getElementById("ai-key-modal");
  const form = document.getElementById("ai-key-form");
  const providerInput = document.getElementById("ai-key-provider");
  const keyInput = document.getElementById("ai-key-input");
  const baseUrlLabel = document.getElementById("ai-key-base-url-label");
  const baseUrlInput = document.getElementById("ai-key-base-url");
  const localHint = document.getElementById("ai-key-local-hint");
  const endpointLabel = document.getElementById("ai-key-endpoint-label");
  const endpointInput = document.getElementById("ai-key-endpoint");
  const geminiHint = document.getElementById("ai-key-gemini-hint");
  const qwenHint = document.getElementById("ai-key-qwen-hint");
  const nameInput = document.getElementById("ai-key-name");
  const modelInput = document.getElementById("ai-key-model");
  const sharedInput = document.getElementById("ai-key-shared");
  const sourceLabel = document.getElementById("ai-key-source-label");
  const sourceInput = document.getElementById("ai-key-source");
  const teamLabel = document.getElementById("ai-key-team-label");
  const teamInput = document.getElementById("ai-key-team");
  const shareHint = document.getElementById("ai-key-share-hint");
  const submitBtn = document.getElementById("ai-key-submit");
  const errorEl = document.getElementById("ai-key-error");
  const btnMenu = document.getElementById("btn-ai-key-menu");
  const menuLabel = document.getElementById("ai-key-menu-label");
  const menuHint = document.getElementById("ai-key-menu-hint");
  const keysList = document.getElementById("ai-keys-list");
  const addSection = document.getElementById("ai-key-add-section");
  let status = null;
  let teams = [];
  let selectedTeamFilter = "all";
  let creditTab = "buy";
  let chatgptShareOpen = false;

  function syncLocalProviderFields() {
    const provider = String(providerInput?.value || "openai").trim().toLowerCase();
    const isLocal = provider === "local";
    const isQwen = provider === "qwen";
    if (baseUrlLabel) baseUrlLabel.classList.toggle("hidden", !isLocal);
    if (localHint) localHint.classList.toggle("hidden", !isLocal);
    if (endpointLabel) endpointLabel.classList.toggle("hidden", !isQwen);
    if (geminiHint) geminiHint.classList.toggle("hidden", provider !== "gemini");
    if (qwenHint) qwenHint.classList.toggle("hidden", !isQwen);
    if (isLocal && baseUrlInput && !baseUrlInput.value) {
      baseUrlInput.value = "http://127.0.0.1:11434/v1";
    }
    if (keyInput) keyInput.placeholder = keyPlaceholder(provider);
  }

  function shouldBlockGpt55Pro() {
    try {
      return typeof blockGpt55Pro === "function" ? !!blockGpt55Pro() : !!blockGpt55Pro;
    } catch {
      return false;
    }
  }

  function openaiModelOptions() {
    return (MODEL_OPTIONS.openai || []).filter((o) => !isRetiredOpenAiModel(o.value));
  }
  let creditAmount = 2000;
  let creditTransactions = [];
  let creditTxLoading = false;

  function renderModelOptions(provider, selectedModel = "") {
    if (!modelInput) return;
    let options = String(provider || "").toLowerCase() === "openai"
      ? openaiModelOptions()
      : (MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai);
    let selected = selectedModel || defaultModel(provider);
    if (/codex/i.test(String(selected || "")) && String(provider || "").toLowerCase() === "openai") {
      selected = DEFAULT_AI_MODEL;
    }
    if (String(provider || "").toLowerCase() === "openai" && isRetiredOpenAiModel(selected)) {
      selected = DEFAULT_AI_MODEL;
    }
    modelInput.innerHTML = "";
    options.forEach((model) => {
      const opt = document.createElement("option");
      opt.value = model.value;
      opt.textContent = model.label;
      modelInput.appendChild(opt);
    });
    if (selected && !options.some((m) => m.value === selected) && !isRetiredOpenAiModel(selected)) {
      const custom = document.createElement("option");
      custom.value = selected;
      custom.textContent = `${selected} (saved)`;
      modelInput.appendChild(custom);
    }
    modelInput.value = selected;
  }

  function setError(message = "") {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.toggle("hidden", !message);
    if (message) {
      try {
        errorEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        /* ignore */
      }
    }
  }

  function isSharedAddMode() {
    return Boolean(sharedInput?.checked);
  }

  function renderTeamOptions() {
    if (!teamInput) return;
    teamInput.innerHTML = "";
    teams.forEach((team) => {
      const opt = document.createElement("option");
      opt.value = team.id;
      opt.textContent = team.name;
      teamInput.appendChild(opt);
    });
    const activeTeam = document.getElementById("team-select")?.value;
    if (activeTeam && teams.some((team) => team.id === activeTeam)) {
      teamInput.value = activeTeam;
    }
  }

  async function refreshTeams() {
    try {
      const data = await api("/api/teams");
      teams = data.teams || [];
      renderTeamOptions();
    } catch {
      teams = [];
      renderTeamOptions();
    }
  }

  function updateSharedAddUI() {
    const shared = isSharedAddMode();
    const sourceKeyId = sourceInput?.value || "__new__";
    const usingSavedSource = shared && sourceKeyId !== "__new__";
    teamLabel?.classList.toggle("hidden", !shared);
    sourceLabel?.classList.toggle("hidden", !shared);
    shareHint?.classList.toggle("hidden", !shared);
    if (submitBtn) submitBtn.textContent = shared ? "Save shared key" : "Save & activate";
    if (keyInput) {
      keyInput.required = !usingSavedSource;
      keyInput.disabled = usingSavedSource;
      keyInput.placeholder = usingSavedSource ? "Using selected saved key" : keyPlaceholder(providerInput?.value || "openai");
      if (usingSavedSource) keyInput.value = "";
    }
    if (nameInput) {
      const provider = providerInput?.value || "openai";
      nameInput.placeholder = nicknamePlaceholder(provider, shared);
    }
  }

  function renderSourceOptions(keys = []) {
    if (!sourceInput) return;
    const previous = sourceInput.value || "__new__";
    sourceInput.innerHTML = `<option value="__new__">Paste a new key below</option>`;
    keys.forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key.id;
      opt.textContent = `${key.name} · ${labelFor(key.provider)} · ${key.model}`;
      opt.dataset.provider = key.provider;
      opt.dataset.model = key.model || "";
      sourceInput.appendChild(opt);
    });
    const hasPrevious = [...sourceInput.options].some((opt) => opt.value === previous);
    const activeKey = keys.find((key) => key.is_active);
    sourceInput.value = hasPrevious ? previous : (activeKey?.id || "__new__");
  }

  function applySourceSelection() {
    const selected = sourceInput?.selectedOptions?.[0];
    if (!isSharedAddMode() || !selected || selected.value === "__new__") {
      providerInput.disabled = false;
      modelInput.disabled = false;
      updateSharedAddUI();
      return;
    }
    if (selected.dataset.provider) {
      providerInput.value = selected.dataset.provider;
      renderModelOptions(selected.dataset.provider, selected.dataset.model);
    }
    providerInput.disabled = true;
    modelInput.disabled = false;
    updateSharedAddUI();
  }

  function modelOptionsHTML(provider, currentModel) {
    const options = String(provider || "").toLowerCase() === "openai"
      ? openaiModelOptions()
      : (MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai);
    const knownValues = options.map((o) => o.value);
    let selected = currentModel;
    if (String(provider || "").toLowerCase() === "openai" && isRetiredOpenAiModel(selected)) {
      selected = DEFAULT_AI_MODEL;
    }
    let html = options.map((o) =>
      `<option value="${esc(o.value)}"${o.value === selected ? " selected" : ""}>${esc(o.label)}</option>`
    ).join("");
    if (selected && !knownValues.includes(selected) && !isRetiredOpenAiModel(selected)) {
      html += `<option value="${esc(selected)}" selected>${esc(selected)}</option>`;
    }
    return html;
  }

  function allowedModelsChecklistHTML(provider, allowedModels, { teamId, teamKeyId, userId, disabled = false } = {}) {
    const options = String(provider || "").toLowerCase() === "openai"
      ? openaiModelOptions()
      : (MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai);
    const allowed = new Set(
      Array.isArray(allowedModels) && allowedModels.length
        ? allowedModels
        : options.map((o) => o.value),
    );
    return `
      <div class="ai-key-allowed-models" title="Models this member may use with the shared key">
        <span class="ai-key-allowed-models-label">Allowed models</span>
        <div class="ai-key-allowed-models-list" role="group" aria-label="Allowed models">
          ${options.map((o) => {
            const on = allowed.has(o.value);
            const parts = String(o.label || o.value).split(" · ");
            const name = parts[0] || o.value;
            const price = parts.slice(1).join(" · ");
            return `
            <label class="ai-key-model-chip${on ? " is-on" : ""}${disabled ? " is-disabled" : ""}">
              <input type="checkbox"
                class="ai-key-model-chip-input"
                data-action="member-allowed-model"
                data-team-key-id="${esc(teamKeyId)}"
                data-team-id="${esc(teamId)}"
                data-user-id="${esc(userId)}"
                data-model="${esc(o.value)}"
                ${on ? "checked" : ""}
                ${disabled ? "disabled" : ""} />
              <span class="ai-key-model-chip-mark" aria-hidden="true">${on ? "✓" : ""}</span>
              <span class="ai-key-model-chip-text">
                <strong>${esc(name)}</strong>
                ${price ? `<em>${esc(price)}</em>` : ""}
              </span>
            </label>`;
          }).join("")}
        </div>
      </div>`;
  }

  function memberSearchBlob(m) {
    return [
      m.display_name,
      m.email,
      m.handle,
      m.role,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function renderMembersPanel(panel, teamId, teamKeyId, members, { query = "" } = {}) {
    panel.dataset.teamId = teamId;
    panel.dataset.teamKeyId = teamKeyId;
    panel._membersCache = members;
    const q = String(query || "").trim().toLowerCase();
    const filtered = q
      ? members.filter((m) => memberSearchBlob(m).includes(q))
      : members;
    if (!members.length) {
      panel.innerHTML = `<p class="ai-key-members-empty">No other members in this workspace. Open <strong>Workspace</strong> to add people by email or @handle.</p>`;
      return;
    }
    panel.innerHTML = `
      <div class="ai-key-members-header">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a2 2 0 100 4 2 2 0 000-4zM5 8a3 3 0 016 0v.5H5V8z"/></svg>
        Access — grant, assign, and allow models
      </div>
      <div class="ai-key-members-toolbar">
        <label class="ai-key-members-search">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
          <input type="search"
            data-action="members-search"
            data-team-key-id="${esc(teamKeyId)}"
            data-team-id="${esc(teamId)}"
            placeholder="Search people, email, or @handle…"
            value="${esc(query)}"
            spellcheck="false"
            autocomplete="off" />
        </label>
        <span class="ai-key-members-count">${filtered.length}/${members.length}</span>
      </div>
      ${filtered.length ? filtered.map((m) => `
        <div class="ai-key-member-row" data-member-id="${esc(m.user_id)}" data-search="${esc(memberSearchBlob(m))}">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc((m.display_name || m.email || "?").charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(m.display_name || m.email)}${m.handle ? ` <em class="ai-key-member-handle">@${esc(String(m.handle).replace(/^@/, ""))}</em>` : ""}</span>
              <span class="ai-key-member-email">${esc(m.email)} · ${m.use_key ? "using shared key" : "using own/default key"}</span>
              <span class="ai-key-member-email">Today: ${esc(formatUsd(m.spent_today_usd || 0))} est.</span>
            </div>
          </div>
          <div class="ai-key-member-controls">
            <button type="button"
              class="btn ai-key-grant-btn${m.granted ? " active" : ""}"
              data-action="grant-toggle"
              data-team-key-id="${esc(teamKeyId)}"
              data-team-id="${esc(teamId)}"
              data-user-id="${esc(m.user_id)}"
              data-granted="${m.granted ? "1" : "0"}"
              ${m.is_key_owner ? "disabled" : ""}
              title="${m.granted ? "Revoke access" : "Grant access"}">
              ${m.is_key_owner ? "Owner" : (m.granted ? "Has access" : "No access")}
            </button>
            <button type="button"
              class="btn ai-key-btn-team-toggle${m.use_key ? " active" : ""}"
              data-action="member-use-toggle"
              data-team-key-id="${esc(teamKeyId)}"
              data-team-id="${esc(teamId)}"
              data-user-id="${esc(m.user_id)}"
              data-use="${m.use_key ? "1" : "0"}"
              ${m.granted ? "" : "disabled"}
              title="${m.use_key ? "Set this member back to their own/default key" : "Assign this shared key to this member"}">
              ${m.use_key ? "Shared" : "Own"}
            </button>
            ${allowedModelsChecklistHTML(m.provider, m.allowed_models, {
              teamId,
              teamKeyId,
              userId: m.user_id,
              disabled: !m.granted || m.is_key_owner,
            })}
            <label class="ai-key-daily-limit" title="Daily shared-key dollar limit for this member">
              <span>$/day</span>
              <input type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                placeholder="No limit"
                value="${m.daily_limit_usd == null ? "" : esc(m.daily_limit_usd)}"
                data-action="member-daily-dollar-limit"
                data-team-key-id="${esc(teamKeyId)}"
                data-team-id="${esc(teamId)}"
                data-user-id="${esc(m.user_id)}"
                ${m.granted ? "" : "disabled"} />
            </label>
            ${m.is_key_owner ? "" : `
            <button type="button"
              class="btn ai-key-btn-remove-person"
              data-action="revoke-and-remove"
              data-team-key-id="${esc(teamKeyId)}"
              data-team-id="${esc(teamId)}"
              data-user-id="${esc(m.user_id)}"
              data-name="${esc(m.display_name || m.email || "this person")}"
              title="Revoke key access and remove from workspace">
              Remove
            </button>`}
          </div>
        </div>
      `).join("") : `<p class="ai-key-members-empty">No people match “${esc(query)}”.</p>`}`;
  }

  function renderTeamPanel(panel, teamId, teamKeyId, data) {
    const members = data.members || [];
    const invites = data.invites || [];
    const candidates = data.candidates || [];
    const canRemoveMembers = Boolean(data.can_remove_members);
    const q = String(panel.dataset.teamSearch || "").trim().toLowerCase();
    const match = (m) => {
      if (!q) return true;
      const blob = [m.display_name, m.email, m.handle, m.role, m.source_teams].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    };
    const filteredMembers = members.filter(match);
    const filteredCandidates = candidates.filter(match);
    panel.innerHTML = `
      <div class="ai-key-members-header">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a2 2 0 100 4 2 2 0 000-4zM3 7a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4z"/></svg>
        Workspace people
      </div>
      <div class="ai-key-members-toolbar">
        <label class="ai-key-members-search">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>
          <input type="search"
            data-action="team-search"
            data-team-key-id="${esc(teamKeyId)}"
            data-team-id="${esc(teamId)}"
            placeholder="Search workspace people…"
            value="${esc(panel.dataset.teamSearch || "")}"
            spellcheck="false"
            autocomplete="off" />
        </label>
      </div>
      <div class="ai-key-team-add">
        <input type="text" placeholder="Add by email or @handle" data-team-add-email spellcheck="false" autocomplete="off" />
        <button type="button" class="btn ai-key-btn-activate" data-action="team-add-member" data-team-id="${esc(teamId)}" data-team-key-id="${esc(teamKeyId)}">Add</button>
      </div>
      <div class="ai-key-team-subtitle">Available from your workspaces</div>
      ${filteredCandidates.length ? filteredCandidates.map((m) => `
        <div class="ai-key-member-row">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc((m.display_name || m.email || "?").charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(m.display_name || m.email)}${m.handle ? ` <em class="ai-key-member-handle">@${esc(String(m.handle).replace(/^@/, ""))}</em>` : ""}</span>
              <span class="ai-key-member-email">${esc(m.email)} · ${esc(m.source_teams || "another workspace")}</span>
            </div>
          </div>
          <button type="button" class="btn ai-key-btn-activate"
            data-action="team-add-member"
            data-team-id="${esc(teamId)}"
            data-team-key-id="${esc(teamKeyId)}"
            data-email="${esc(m.email)}">
            Add to this workspace
          </button>
        </div>
      `).join("") : `<p class="ai-key-members-empty">${q ? `No workspace matches for “${esc(q)}”.` : "No users from your other workspaces to add."}</p>`}
      <div class="ai-key-team-subtitle">Members</div>
      ${filteredMembers.length ? filteredMembers.map((m) => `
        <div class="ai-key-member-row">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc((m.display_name || m.email || "?").charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(m.display_name || m.email)}${m.handle ? ` <em class="ai-key-member-handle">@${esc(String(m.handle).replace(/^@/, ""))}</em>` : ""}</span>
              <span class="ai-key-member-email">${esc(m.email)} · ${esc(m.role || "member")}</span>
            </div>
          </div>
          <div class="ai-key-team-row-actions">
            ${m.role === "owner" ? `<span class="ai-key-active-badge">Owner</span>` : `
              ${canRemoveMembers ? `
              <button type="button" class="btn ai-key-btn-remove-person"
                data-action="team-remove-member"
                data-team-id="${esc(teamId)}"
                data-team-key-id="${esc(teamKeyId)}"
                data-user-id="${esc(m.id)}">
                Remove
              </button>
              ` : `<span class="ai-key-row-model">Member</span>`}
            `}
          </div>
        </div>
      `).join("") : `<p class="ai-key-members-empty">${q ? `No members match “${esc(q)}”.` : "No workspace members yet."}</p>`}
      <div class="ai-key-team-subtitle">Pending invites</div>
      ${invites.length ? invites.map((inv) => `
        <div class="ai-key-member-row">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc((inv.display_name || inv.email || "?").charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(inv.display_name || inv.email)}</span>
              <span class="ai-key-member-email">${esc(inv.email)} · invited${inv.user_id ? " · registered" : ""}</span>
            </div>
          </div>
          ${inv.user_id ? `
            <button type="button" class="btn ai-key-btn-activate"
              data-action="team-add-member"
              data-team-id="${esc(teamId)}"
              data-team-key-id="${esc(teamKeyId)}"
              data-email="${esc(inv.email)}">
              Add to workspace
            </button>
          ` : `<span class="ai-key-row-model">Waiting for signup</span>`}
        </div>
      `).join("") : `<p class="ai-key-members-empty">No pending invites.</p>`}
      <p class="ai-key-team-note">After someone is in this workspace, use <strong>Members</strong> to grant or revoke this key or ChatGPT login.</p>`;
  }

  function renderTeamFilter(teamKeys = []) {
    const teamIds = [...new Set(teamKeys.map((k) => k.team_id).filter(Boolean))];
    if (teamIds.length <= 1) return "";
    if (selectedTeamFilter !== "all" && !teamIds.includes(selectedTeamFilter)) selectedTeamFilter = "all";
    const teamName = (id) => teams.find((team) => team.id === id)?.name || id;
    return `
      <label class="ai-key-team-filter">View workspace
        <select data-action="team-filter">
          <option value="all"${selectedTeamFilter === "all" ? " selected" : ""}>All workspaces</option>
          ${teamIds.map((id) => `<option value="${esc(id)}"${selectedTeamFilter === id ? " selected" : ""}>${esc(teamName(id))}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function renderChatgptMembersPanel(panel, teamId, shareId, members) {
    panel.dataset.teamId = teamId;
    panel.dataset.shareId = shareId;
    if (!members.length) {
      panel.innerHTML = `<p class="ai-key-members-empty">No other people in this workspace. Open <strong>Workspace</strong> to add someone by email or @handle.</p>`;
      return;
    }
    panel.innerHTML = `
      <div class="ai-key-members-header">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a2 2 0 100 4 2 2 0 000-4zM5 8a3 3 0 016 0v.5H5V8z"/></svg>
        Who can use this ChatGPT login
      </div>
      ${members.map((m) => `
        <div class="ai-key-member-row" data-member-id="${esc(m.user_id)}">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc((m.display_name || m.email || "?").charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(m.display_name || m.email)}</span>
              <span class="ai-key-member-email">${esc(m.email)} · ${esc(m.role || "member")}</span>
            </div>
          </div>
          <button type="button"
            class="btn ai-key-grant-btn${m.granted || m.is_owner ? " active" : ""}"
            data-action="chatgpt-grant-toggle"
            data-share-id="${esc(shareId)}"
            data-team-id="${esc(teamId)}"
            data-user-id="${esc(m.user_id)}"
            data-granted="${m.granted || m.is_owner ? "1" : "0"}"
            ${m.is_owner ? "disabled" : ""}>
            ${m.is_owner ? "Owner" : (m.granted ? "Has access" : "No access")}
          </button>
        </div>
      `).join("")}
    `;
  }

  function renderChatgptSharesSection() {
    const shares = Array.isArray(status?.chatgpt_shares) ? status.chatgpt_shares : [];
    const ownSignedIn = !!(status?.chatgpt?.own_signed_in);
    const unsharedTeams = teams.filter((t) => !shares.some((s) => s.is_owner && s.team_id === t.id));
    const teamOpts = unsharedTeams.map((t) => `<option value="${esc(t.id)}">${esc(t.name || "Workspace")}</option>`).join("");
    let html = `
      <div class="ai-keys-section-label ai-keys-section-label--with-action">
        <span>Shared ChatGPT</span>
        <button type="button" class="btn ai-key-btn-activate ai-key-btn-share" data-action="open-chatgpt-share">
          Share ChatGPT
        </button>
      </div>`;
    if (chatgptShareOpen) {
      html += `
        <div class="ai-key-chatgpt-share">
          <p class="muted small">A workspace is the same group as the workspace switcher. Share this ChatGPT login with a workspace, add people, then grant them from Members — same as a shared API key.</p>
          ${ownSignedIn ? `
            <div class="ai-sub-share-add">
              <select data-chatgpt-share-team>
                <option value="">Choose a workspace…</option>
                ${teamOpts || ""}
              </select>
              <button type="button" class="btn accent btn-compact" data-action="chatgpt-share-submit">Share with workspace</button>
            </div>
            <div class="ai-key-team-add">
              <input type="text" placeholder="New workspace name" data-chatgpt-new-workspace maxlength="120" />
              <button type="button" class="btn ai-key-btn-activate" data-action="chatgpt-create-workspace">Create &amp; share</button>
            </div>
          ` : `<p class="muted small">Sign in with ChatGPT under <strong>Subscriptions</strong> first, then you can share that login with a workspace.</p>`}
        </div>`;
    }
    if (!shares.length && !chatgptShareOpen) {
      html += `<p class="ai-keys-empty ai-keys-empty--team">Share your ChatGPT login with a workspace, or use one a teammate granted you.</p>`;
      return html;
    }
    html += shares.map((s) => {
      const canManage = s.can_manage || s.is_owner;
      return `
        <div class="ai-key-row ai-key-row--team" data-share-id="${esc(s.id)}" data-team-id="${esc(s.team_id || "")}">
          <div class="ai-key-row-info">
            <div class="ai-key-row-main">
              <span class="ai-key-row-name">${esc(s.name || "ChatGPT")}</span>
              <span class="ai-key-badge badge-openai">ChatGPT</span>
              <span class="ai-key-row-model">${esc(s.team_name || "Workspace")}</span>
            </div>
            <div class="ai-key-team-members">
              ${s.is_owner ? "Your login on this workspace" : `Shared by ${esc(s.owner_name || "a teammate")}`}
              ${s.owner_signed_in ? "" : " · owner signed out"}
            </div>
          </div>
          <div class="ai-key-row-actions">
            ${canManage ? `
              <div class="ai-key-action-group" role="group" aria-label="Manage shared ChatGPT">
                <button type="button" class="btn ai-key-btn-manage-access" data-action="chatgpt-manage-access" data-share-id="${esc(s.id)}" data-team-id="${esc(s.team_id || "")}">Members</button>
                <button type="button" class="btn ai-key-btn-manage-access" data-action="chatgpt-manage-workspace" data-share-id="${esc(s.id)}" data-team-id="${esc(s.team_id || "")}">Workspace</button>
              </div>
              <button type="button" class="btn ai-key-btn-delete" data-action="chatgpt-unshare" data-share-id="${esc(s.id)}" data-team-id="${esc(s.team_id || "")}" title="Stop sharing">✕</button>
            ` : ""}
          </div>
        </div>
        <div class="ai-key-members-panel hidden" id="members-panel-chatgpt-${esc(s.id)}"></div>
        <div class="ai-key-members-panel hidden" id="team-panel-chatgpt-${esc(s.id)}"></div>`;
    }).join("");
    return html;
  }

  function renderCreditCard(credits = {}) {
    const balance = Number(credits.balance_cents || 0);
    const pct = credits.last_purchase_percent_left;
    const pctValue = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
    const pctLabel = pct == null ? "Buy credits to start" : `${pctValue.toFixed(0)}% left from last buy`;
    const providers = credits.providers || {};
    const openaiOn = !!providers.openai;
    const claudeOn = !!providers.anthropic;
    const kimiOn = !!providers.kimi;
    const models = credits.models || [];
    const preferredProvider = normalizePlatformProviderId(credits.platform_provider);
    const allModelsForSelect = models.length ? models : [];
    const selectedModel = credits.platform_model || "";
    const stripeReady = !!(credits.stripe_ready || credits.payment_methods?.stripe);
    const amounts = [
      { cents: 1000, label: "$10", hint: "Light use" },
      { cents: 2000, label: "$20", hint: "Most popular" },
      { cents: 5000, label: "$50", hint: "Power users" },
    ];

    const overviewPanel = `
      <div class="ai-credit-panel" data-credit-panel="overview">
        <p class="ai-credit-copy">
          Credits unlock Render Studio’s shared <strong>OpenAI</strong>${claudeOn ? ", <strong>Claude</strong>" : ""}${kimiOn ? ", and <strong>Kimi</strong>" : ""} keys.
          Generation deducts model cost plus ${Number(credits.markup_percent || 15)}% — no personal API key required.
        </p>
        <div class="ai-credit-meter" title="${esc(pctLabel)}"><span style="width:${pctValue}%"></span></div>
        <div class="ai-credit-meter-label">${esc(pctLabel)}</div>
        <div class="ai-credit-buy-row">
          <button type="button" class="ai-credit-btn-primary" data-action="enable-platform-key">
            ${credits.use_platform_key ? "Shared keys on" : "Enable shared keys"}
          </button>
          ${credits.use_platform_key ? `<button type="button" class="ai-credit-btn-ghost" data-action="disable-platform-key">Turn off</button>` : ""}
          <button type="button" class="ai-credit-btn-ghost" data-action="credit-tab" data-tab="buy">Buy more</button>
        </div>
        <p class="ai-credit-note">
          ${openaiOn ? "OpenAI ready." : "OpenAI platform key missing."}
          ${claudeOn ? " Claude ready." : " Add ANTHROPIC_API_KEY on the server to unlock Claude."}
          ${kimiOn ? " Kimi ready." : " Add KIMI_API_KEY on the server to unlock Kimi."}
        </p>
      </div>`;

    const buyPanel = `
      <div class="ai-credit-panel" data-credit-panel="buy">
        <p class="ai-credit-copy">Pick a pack. You’ll pay securely with Stripe and credits appear on this account immediately.</p>
        <div class="ai-credit-amount-grid">
          ${amounts.map((a) => `
            <button type="button" class="ai-credit-amount${creditAmount === a.cents ? " ai-credit-amount--selected" : ""}"
              data-action="credit-amount" data-amount="${a.cents}">
              ${a.label}
              <small>${esc(a.hint)}</small>
            </button>`).join("")}
        </div>
        <div class="ai-credit-buy-row">
          <button type="button" class="ai-credit-btn-buy" data-action="buy-credits" data-provider="stripe"
            ${stripeReady ? "" : "disabled"}>
            ${stripeReady ? `Buy ${formatCents(creditAmount)} with Stripe` : "Stripe not configured"}
          </button>
        </div>
        <p class="ai-credit-note">Live Stripe checkout. Credits enable Render Studio shared keys automatically after payment.</p>
      </div>`;

    const modelOptions = allModelsForSelect.length
      ? allModelsForSelect.map((m) => {
          const value = `${m.provider}:${m.model}`;
          const isSelected = selectedModel
            ? selectedModel === m.model && preferredProvider === m.provider
            : preferredProvider === m.provider
              && m.model === (allModelsForSelect.find((x) => x.provider === preferredProvider)?.model);
          const modelLabel = (MODEL_OPTIONS[m.provider] || []).find((opt) => opt.value === m.model)?.label
            || String(m.model || "").replace(/^claude-/i, "").replace(/-/g, " ");
          const label = `${labelFor(m.provider)} · ${modelLabel}`;
          return `<option value="${esc(value)}"${isSelected ? " selected" : ""}>${esc(label)}</option>`;
        }).join("")
      : `<option value="openai:">OpenAI (default)</option>`;

    const managePanel = `
      <div class="ai-credit-panel" data-credit-panel="manage">
        <div class="ai-credit-manage-grid">
          <label class="ai-credit-field">Default shared model
            <select data-action="platform-model">
              ${modelOptions}
            </select>
          </label>
          <label class="ai-credit-toggle-row">
            <input type="checkbox" data-action="use-platform-key" ${credits.use_platform_key ? "checked" : ""} />
            <span>Use Render Studio shared keys when I don’t have a personal key active</span>
          </label>
          <label class="ai-credit-toggle-row">
            <input type="checkbox" data-action="auto-refill" ${credits.auto_refill_enabled ? "checked" : ""} />
            <span>Auto refill ${formatCents(credits.auto_refill_amount_cents || 2000)} when balance drops below ${formatCents(credits.auto_refill_threshold_cents || 500)}</span>
          </label>
        </div>
        <div class="ai-credit-buy-row" style="margin-top:12px">
          <button type="button" class="ai-credit-btn-ghost" data-action="refresh-transactions">Refresh activity</button>
        </div>
        <div class="ai-credit-tx-list" data-credit-tx-list>
          ${renderCreditTransactions()}
        </div>
      </div>`;

    const panel = creditTab === "overview" ? overviewPanel : creditTab === "manage" ? managePanel : buyPanel;

    return `
      <div class="ai-credit-card${credits.use_platform_key ? " ai-credit-card--active" : ""}">
        <div class="ai-credit-hero">
          <div class="ai-credit-brand">
            <span class="ai-credit-kicker">render credits</span>
            <strong>Studio AI balance</strong>
            <div class="ai-credit-pill-row">
              <span class="ai-credit-pill ${openaiOn ? "ai-credit-pill--on" : "ai-credit-pill--off"}">OpenAI ${openaiOn ? "live" : "off"}</span>
              <span class="ai-credit-pill ${claudeOn ? "ai-credit-pill--on" : "ai-credit-pill--off"}">Claude ${claudeOn ? "live" : "off"}</span>
              <span class="ai-credit-pill ${credits.use_platform_key ? "ai-credit-pill--on" : "ai-credit-pill--off"}">${credits.use_platform_key ? "Shared on" : "Shared off"}</span>
            </div>
          </div>
          <div class="ai-credit-balance-block">
            <span class="ai-credit-balance-label">Available</span>
            <span class="ai-credit-balance" title="${esc(pctLabel)}">${formatCents(balance)}</span>
          </div>
        </div>
        <div class="ai-credit-tabs" role="tablist">
          <button type="button" class="ai-credit-tab${creditTab === "overview" ? " ai-credit-tab--active" : ""}" data-action="credit-tab" data-tab="overview">View</button>
          <button type="button" class="ai-credit-tab${creditTab === "buy" ? " ai-credit-tab--active" : ""}" data-action="credit-tab" data-tab="buy">Buy</button>
          <button type="button" class="ai-credit-tab${creditTab === "manage" ? " ai-credit-tab--active" : ""}" data-action="credit-tab" data-tab="manage">Manage</button>
        </div>
        ${panel}
      </div>
    `;
  }

  function renderCreditTransactions() {
    if (creditTxLoading) {
      return `<p class="ai-credit-empty">Loading activity…</p>`;
    }
    if (!creditTransactions.length) {
      return `<p class="ai-credit-empty">No purchases or usage yet. Buy credits to get started.</p>`;
    }
    return creditTransactions.map((tx) => {
      const amount = Number(tx.amount_cents || 0);
      const pos = amount >= 0;
      const kind = String(tx.kind || "usage");
      const title = kind === "purchase" || kind === "demo_purchase"
        ? "Credit purchase"
        : kind === "usage"
          ? `Usage · ${tx.model || tx.provider || "AI"}`
          : kind;
      const when = tx.created_at ? new Date(tx.created_at).toLocaleString() : "";
      return `
        <div class="ai-credit-tx">
          <strong>${esc(title)}</strong>
          <span class="ai-credit-tx-amt ${pos ? "ai-credit-tx-amt--pos" : "ai-credit-tx-amt--neg"}">${pos ? "+" : ""}${formatCents(amount)}</span>
          <span class="ai-credit-tx-meta">${esc(when)}${tx.balance_after_cents != null ? ` · bal ${formatCents(tx.balance_after_cents)}` : ""}</span>
        </div>`;
    }).join("");
  }

  async function loadCreditTransactions() {
    creditTxLoading = true;
    try {
      const data = await api("/api/user/ai-credits/transactions?limit=30");
      creditTransactions = data.transactions || [];
      if (data.credits && status) status.credits = data.credits;
    } catch {
      creditTransactions = [];
    } finally {
      creditTxLoading = false;
    }
  }

  function renderPlatformKeysSection(credits = {}, platformKeys = []) {
    const balance = Number(credits.balance_cents || 0);
    const providers = credits.providers || {};
    const preferred = normalizePlatformProviderId(credits.platform_provider);
    const enabled = !!credits.use_platform_key && balance > 0;
    const rows = [
      {
        id: "openai",
        name: "OpenAI",
        provider: "openai",
        live: !!providers.openai,
        model: (platformKeys.find((k) => k.id === "openai") || {}).model
          || (credits.models || []).find((m) => m.provider === "openai")?.model
          || "",
      },
      {
        id: "anthropic",
        name: "Anthropic",
        provider: "anthropic",
        live: !!providers.anthropic,
        model: (platformKeys.find((k) => k.id === "anthropic") || {}).model
          || (credits.models || []).find((m) => m.provider === "anthropic")?.model
          || "",
      },
      {
        id: "kimi",
        name: "Kimi",
        provider: "kimi",
        live: !!providers.kimi,
        model: (platformKeys.find((k) => k.id === "kimi") || {}).model
          || (credits.models || []).find((m) => m.provider === "kimi")?.model
          || "kimi-k3",
      },
    ];

    let body = "";
    if (balance <= 0) {
      body = `<p class="ai-keys-empty">Buy render credits to unlock the temporary Render Studio Key (OpenAI, Anthropic, or Kimi) — no personal API key required. It disappears again when credits run out.</p>`;
    } else {
      const available = rows.filter((row) => row.live);
      const current = available.find((row) => row.id === preferred) || available[0];
      if (!current) {
        body = `<p class="ai-keys-empty">Render Studio shared keys are not configured on this server yet.</p>`;
      } else {
        const badgeClass = PROVIDER_BADGE_CLASS[current.provider] || "badge-openai";
        const isActive = enabled;
        body = `
          <div class="ai-key-row ai-key-row--platform${isActive ? " ai-key-row--active" : ""}"
               data-platform-provider="${esc(current.id)}">
            <div class="ai-key-row-info">
              <span class="ai-key-row-name">Render Studio Key</span>
              <span class="ai-key-badge ${badgeClass}">${esc(labelFor(current.provider))}</span>
              <select class="ai-key-model-select" data-action="render3d-provider" title="OpenAI or Anthropic">
                ${available.map((row) => `
                  <option value="platform:${esc(row.id)}"${row.id === current.id ? " selected" : ""}>${esc(row.name)}</option>
                `).join("")}
              </select>
              <select class="ai-key-model-select" data-action="platform-key-model" data-provider="${esc(current.id)}" title="Model for this Render Studio key">
                ${modelOptionsHTML(current.provider, credits.platform_model || current.model)}
              </select>
            </div>
            <div class="ai-key-row-actions">
              ${isActive
                ? `<span class="ai-key-active-badge">✓ Active</span>`
                : `<button type="button" class="btn ai-key-btn-activate" data-action="activate-platform" data-provider="${esc(current.id)}">Use in prompts</button>`
              }
            </div>
          </div>`;
      }
    }

    return `
      <div class="ai-keys-section-label">
        <span>Render Studio Key</span>
      </div>
      <p class="ai-keys-section-hint">Temporary while you have render credits — use Render Studio’s shared OpenAI, Anthropic, or Kimi keys. The key disappears when your balance hits $0; buy more credits to bring it back.</p>
      ${body}
    `;
  }

  function renderKeysList(keys = [], activeKeyId = null, teamKeys = []) {
    if (!keysList) return;
    const credits = status?.credits || {};
    let html = renderCreditCard(credits);
    html += renderPlatformKeysSection(credits, status?.platform_keys || []);

    // ── Personal keys ──
    if (keys.length) {
      html += `
        <div class="ai-keys-section-label">
          <span>Your keys</span>
        </div>`;
      html += keys.map((k) => {
        const isActive = k.id === activeKeyId || k.is_active;
        const badgeClass = PROVIDER_BADGE_CLASS[k.provider] || "badge-openai";
        return `
          <div class="ai-key-row${isActive ? " ai-key-row--active" : ""}" data-key-id="${esc(k.id)}">
            <div class="ai-key-row-info">
              <span class="ai-key-row-name">${esc(k.name)}</span>
              <span class="ai-key-badge ${badgeClass}">${esc(labelFor(k.provider))}</span>
              <select class="ai-key-model-select" data-action="change-model" data-key-id="${esc(k.id)}" title="Switch model for this key">
                ${modelOptionsHTML(k.provider, k.model)}
              </select>
            </div>
            <div class="ai-key-row-actions">
              ${isActive
                ? `<span class="ai-key-active-badge">✓ Active</span>`
                : `<button type="button" class="btn ai-key-btn-activate" data-action="activate" data-key-id="${esc(k.id)}">Use this</button>`
              }
              <button type="button" class="btn ai-key-btn-rename" data-action="rename" data-key-id="${esc(k.id)}" title="Rename">✎</button>
              <button type="button" class="btn ai-key-btn-delete" data-action="delete" data-key-id="${esc(k.id)}" title="Delete">✕</button>
            </div>
          </div>`;
      }).join("");
    }

    // ── Team shared keys ──
    html += `
      <div class="ai-keys-section-label ai-keys-section-label--with-action">
        <span>Workspace keys</span>
        <button type="button" class="btn ai-key-btn-activate ai-key-btn-share" data-action="open-shared-add">
          Share a key
        </button>
      </div>`;
    html += renderTeamFilter(teamKeys);
    const visibleTeamKeys = selectedTeamFilter === "all"
      ? teamKeys
      : teamKeys.filter((k) => k.team_id === selectedTeamFilter);
    if (!visibleTeamKeys.length) {
      html += `<p class="ai-keys-empty ai-keys-empty--team">No shared workspace keys yet. Open “Add a new key”, then check “Share this key with a workspace”.</p>`;
    } else {
      html += visibleTeamKeys.map((k) => {
        const badgeClass = PROVIDER_BADGE_CLASS[k.provider] || "badge-openai";
        const isUsing = k.use_key;
        const isOwner = k.is_owner;
        const canManage = k.can_manage || isOwner;
        const modelLabel = k.effective_model || k.model;
        const dollarLimitLabel = k.daily_limit_usd == null ? "No daily dollar limit" : `${formatUsd(k.daily_limit_usd)} daily limit`;
        const spentLabel = formatUsd(k.spent_today_usd || 0);
        const accessMembers = Array.isArray(k.access_members) ? k.access_members : [];
        const accessNames = accessMembers.map((m) => m.display_name || m.email).filter(Boolean);
        const accessLabel = accessNames.length
          ? accessNames.join(", ")
          : (k.shared_by_name ? k.shared_by_name : "Team members");
        return `
          <div class="ai-key-row ai-key-row--team${isUsing ? " ai-key-row--active" : ""}"
               data-team-key-id="${esc(k.id)}" data-team-id="${esc(k.team_id || "")}">
            <div class="ai-key-row-info">
              <div class="ai-key-row-main">
                <span class="ai-key-row-name">${esc(k.name)}</span>
                <span class="ai-key-badge ${badgeClass}">${esc(labelFor(k.provider))}</span>
                <span class="ai-key-row-model">${esc(modelLabel)}</span>
              </div>
              <div class="ai-key-team-members" title="${esc(accessLabel)}">
                Workspace: ${esc(accessLabel)}
              </div>
              ${!isOwner ? `
                <div class="ai-key-team-members">
                  Today: ${esc(spentLabel)} est. · ${esc(dollarLimitLabel)}
                </div>
              ` : ""}
            </div>
            <div class="ai-key-row-actions">
              ${isOwner ? "" : `
                <span class="ai-key-shared-by" title="Shared by ${esc(k.shared_by_name)}">
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8 1a2 2 0 100 4 2 2 0 000-4zm-3 7a3 3 0 016 0v.5H5V8z"/><path d="M1.5 8a6.5 6.5 0 1113 0 .75.75 0 01-1.5 0 5 5 0 10-10 0 .75.75 0 01-1.5 0z"/></svg>
                  ${esc(k.shared_by_name)}
                </span>
              `}
              ${canManage ? `
                <div class="ai-key-action-group" role="group" aria-label="Manage shared key">
                  <button type="button"
                    class="btn ai-key-btn-manage-access"
                    data-action="manage-access"
                    data-team-key-id="${esc(k.id)}"
                    data-team-id="${esc(k.team_id || "")}"
                    title="Manage who can use this key">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 1a2 2 0 100 4 2 2 0 000-4zM3 7a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4z"/></svg>
                    Members
                  </button>
                  <button type="button"
                    class="btn ai-key-btn-manage-access"
                    data-action="manage-team"
                    data-team-key-id="${esc(k.id)}"
                    data-team-id="${esc(k.team_id || "")}"
                    title="Add people from your other workspaces">
                    Workspace
                  </button>
                </div>
              ` : ""}
              ${isOwner ? "" : `
                <button type="button"
                  class="btn ai-key-btn-team-toggle${isUsing ? " active" : ""}"
                  data-action="team-toggle"
                  data-team-key-id="${esc(k.id)}"
                  data-team-id="${esc(k.team_id || "")}"
                  data-use="${isUsing ? "1" : "0"}"
                  title="${isUsing ? "Stop using this team key" : "Use this team key"}">
                  ${isUsing ? "✓ Using" : "Use"}
                </button>
              `}
              ${isOwner ? `
                <button type="button" class="btn ai-key-btn-delete"
                  data-action="delete-team-key"
                  data-team-key-id="${esc(k.id)}"
                  data-team-id="${esc(k.team_id || "")}"
                  title="Remove shared key">✕</button>
              ` : ""}
            </div>
          </div>
          <div class="ai-key-members-panel hidden" id="members-panel-${esc(k.id)}"></div>
          <div class="ai-key-members-panel hidden" id="team-panel-${esc(k.id)}"></div>`;
      }).join("");
    }

    if (!html) {
      keysList.innerHTML = `<p class="ai-keys-empty">No saved keys yet. Add one below.</p>`;
    } else {
      keysList.innerHTML = html;
    }
  }


  function render(nextStatus = status) {
    status = nextStatus || null;
    if (!status) return;
    const providerLabel = labelFor(status.provider);
    const hasKey = Boolean(status.has_key);
    const effective = status.effective || null;
    const limit = effective?.daily_limit_usd;
    const spent = effective?.spent_today_usd || 0;
    const usageLabel = limit == null
      ? ""
      : ` · ${formatUsd(spent)}/${formatUsd(limit)} today`;
    const credits = status.credits || {};
    const creditBal = Number(credits.balance_cents || 0);
    const usingCredits = !hasKey && credits.use_platform_key && creditBal > 0;
    if (menuLabel) {
      menuLabel.textContent = "AI and billing";
    }
    if (menuHint) {
      menuHint.textContent = hasKey
        ? `${providerLabel} · ${status.model || ""}${usageLabel}`
        : usingCredits
          ? `${formatCents(creditBal)} · shared OpenAI/Claude`
          : "Subscriptions, keys, and credits";
    }
    renderSourceOptions(status.keys || []);
    applySourceSelection();
    renderKeysList(status.keys || [], status.active_key_id, status.team_keys || []);
    onStatusChange?.(status);
  }

  async function refresh() {
    const data = await api("/api/user/ai-keys");
    render({ ...(data.ai || {}), keys: data.keys || data.ai?.keys || [] });
    return data.ai;
  }

  function setBillingTab(tab = "keys") {
    const next = tab === "subscriptions" ? "subscriptions" : "keys";
    if (modal) modal.dataset.billingTab = next;
    modal?.querySelectorAll("[data-ai-billing-tab]").forEach((btn) => {
      const on = btn.getAttribute("data-ai-billing-tab") === next;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    modal?.querySelectorAll("[data-ai-billing-pane]").forEach((pane) => {
      const on = pane.getAttribute("data-ai-billing-pane") === next;
      pane.classList.toggle("hidden", !on);
      pane.hidden = !on;
    });
    window.dispatchEvent(new CustomEvent("render3d:ai-billing-tab", { detail: { tab: next } }));
    return next;
  }

  function setCostsOpen(open) {
    const card = modal?.querySelector(".ai-billing-card") || modal?.querySelector(".ai-keys-card");
    const panel = document.getElementById("ai-billing-costs-panel");
    const btn = document.getElementById("btn-ai-billing-costs");
    const on = !!open;
    card?.classList.toggle("is-costs-open", on);
    modal?.classList.toggle("ai-billing-costs-open", on);
    if (panel) {
      panel.classList.toggle("hidden", !on);
      panel.hidden = !on;
    }
    btn?.setAttribute("aria-expanded", on ? "true" : "false");
    btn?.classList.toggle("is-active", on);
    if (on) {
      window.dispatchEvent(new CustomEvent("render3d:refresh-billing-costs", {
        detail: { tab: modal?.dataset.billingTab || "keys" },
      }));
    }
    return on;
  }

  function showSelectedKeyAnalytics(key) {
    const box = document.getElementById("ai-key-selected-analytics");
    if (!box) return;
    if (!key) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const name = key.name || labelFor(key.provider);
    const model = key.effective_model || key.model || "";
    const spent = key.spent_today_usd != null ? formatUsd(key.spent_today_usd) : "";
    const limit = key.daily_limit_usd != null ? formatUsd(key.daily_limit_usd) : "No daily cap";
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="ai-key-selected-copy">
        <strong>${esc(name)}</strong>
        <span class="muted small">${esc(labelFor(key.provider))}${model ? ` · ${esc(model)}` : ""} · ${esc(spent || "No spend yet")} today · ${esc(limit)}</span>
      </div>
      <button type="button" class="ai-chip-btn" data-ai-billing-analytics="keys" data-key-id="${esc(key.id || "")}">View key analytics</button>
    `;
  }

  function showModal(show, { required = false, message = "", preferProvider = "openai", openAdd = false, tab = "keys", costs = null } = {}) {
    if (!modal) return;
    modal.classList.toggle("hidden", !show);
    if (show) {
      modal.dataset.required = required ? "1" : "";
      setBillingTab(tab === "subscriptions" ? "subscriptions" : "keys");
      if (costs === true || costs === false) setCostsOpen(costs);
      const provider = ["anthropic", "kimi", "xai", "gemini", "openai"].includes(preferProvider)
        ? preferProvider
        : "openai";
      setError(
        message
          || (required
            ? (provider === "openai"
              ? "Add your own OpenAI API key, or buy shared-key credits to borrow Render Studio's API key."
              : "Add your own key, or buy shared-key credits to use Render Studio's API key.")
            : ""),
      );
      if (providerInput) providerInput.value = provider;
      renderModelOptions(provider);
      if (keyInput) keyInput.value = "";
      if (nameInput) nameInput.value = "";
      if (sharedInput) sharedInput.checked = false;
      updateSharedAddUI();
      if (openAdd && addSection) addSection.open = true;
      refreshTeams();
      refresh();
    } else {
      setCostsOpen(false);
    }
  }

  // Provider dropdown change
  providerInput?.addEventListener("change", () => {
    renderModelOptions(providerInput.value);
    updateSharedAddUI();
    syncLocalProviderFields();
  });

  sharedInput?.addEventListener("change", () => {
    if (isSharedAddMode() && sourceInput?.value === "__new__") {
      const active = (status?.keys || []).find((key) => key.is_active);
      if (active) sourceInput.value = active.id;
    }
    applySourceSelection();
    if (isSharedAddMode() && !teams.length) refreshTeams();
  });

  sourceInput?.addEventListener("change", () => {
    applySourceSelection();
  });

  btnMenu?.addEventListener("click", () => {
    document.getElementById("user-menu")?.classList.add("hidden");
    showModal(true, { tab: "keys" });
  });

  modal?.querySelectorAll(".auth-close[data-ai-key-close]").forEach((el) => {
    el.addEventListener("click", () => showModal(false));
  });

  modal?.querySelector("[data-ai-billing-banner]")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-ai-billing-tab]");
    if (!tabBtn) return;
    setBillingTab(tabBtn.getAttribute("data-ai-billing-tab") || "keys");
  });

  document.getElementById("btn-ai-billing-costs")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = !modal?.classList.contains("ai-billing-costs-open");
    setCostsOpen(open);
  });

  document.getElementById("btn-ai-key-manage")?.addEventListener("click", () => {
    setBillingTab("keys");
    if (addSection) addSection.open = true;
    addSection?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    keyInput?.focus();
  });

  modal?.addEventListener("click", (e) => {
    const analytics = e.target.closest("[data-ai-billing-analytics]");
    if (analytics) {
      window.dispatchEvent(new CustomEvent("render3d:open-costs-analytics", {
        detail: { scope: analytics.getAttribute("data-ai-billing-analytics") || "keys", keyId: analytics.getAttribute("data-key-id") || "" },
      }));
    }
  });

  // Delegate model select changes in the keys list
  keysList?.addEventListener("input", (e) => {
    const membersSearch = e.target.closest("[data-action='members-search']");
    if (membersSearch) {
      const teamKeyId = membersSearch.dataset.teamKeyId;
      const teamId = membersSearch.dataset.teamId;
      const panel = document.getElementById(`members-panel-${teamKeyId}`);
      if (!panel) return;
      const members = panel._membersCache || [];
      renderMembersPanel(panel, teamId, teamKeyId, members, { query: membersSearch.value });
      const input = panel.querySelector("[data-action='members-search']");
      if (input) {
        input.focus();
        const len = input.value.length;
        try { input.setSelectionRange(len, len); } catch { /* ignore */ }
      }
      return;
    }
    const teamSearch = e.target.closest("[data-action='team-search']");
    if (teamSearch) {
      const teamKeyId = teamSearch.dataset.teamKeyId;
      const teamId = teamSearch.dataset.teamId;
      const panel = document.getElementById(`team-panel-${teamKeyId}`);
      if (!panel) return;
      panel.dataset.teamSearch = teamSearch.value || "";
      // Keep cached management payload on the panel when possible
      if (panel._managementCache) {
        renderTeamPanel(panel, teamId, teamKeyId, panel._managementCache);
        const input = panel.querySelector("[data-action='team-search']");
        if (input) {
          input.focus();
          const len = input.value.length;
          try { input.setSelectionRange(len, len); } catch { /* ignore */ }
        }
      }
    }
  });

  keysList?.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-action='change-model']");
    const memberModel = e.target.closest("[data-action='member-model']");
    const memberAllowed = e.target.closest("[data-action='member-allowed-model']");
    const dailyLimit = e.target.closest("[data-action='member-daily-dollar-limit']");
    if (!sel && !memberModel && !memberAllowed && !dailyLimit) return;
    if (dailyLimit) {
      const teamKeyId = dailyLimit.dataset.teamKeyId;
      const teamId = dailyLimit.dataset.teamId;
      const targetUserId = dailyLimit.dataset.userId;
      const raw = dailyLimit.value.trim();
      const value = raw === "" ? null : Number(raw);
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        setError("Daily dollar limit must be a positive number.");
        return;
      }
      try {
        const data = await api(
          `/api/teams/${teamId}/ai-keys/${teamKeyId}/members/${targetUserId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ daily_limit_usd: value }),
          }
        );
        const panel = document.getElementById(`members-panel-${teamKeyId}`);
        if (panel) renderMembersPanel(panel, teamId, teamKeyId, data.members || []);
      } catch (err) {
        setError(err.message || "Could not update daily dollar limit");
      }
      return;
    }
    if (memberAllowed) {
      const teamKeyId = memberAllowed.dataset.teamKeyId;
      const teamId = memberAllowed.dataset.teamId;
      const targetUserId = memberAllowed.dataset.userId;
      const row = memberAllowed.closest(".ai-key-member-row");
      const chip = memberAllowed.closest(".ai-key-model-chip");
      if (chip) chip.classList.toggle("is-on", memberAllowed.checked);
      const mark = chip?.querySelector(".ai-key-model-chip-mark");
      if (mark) mark.textContent = memberAllowed.checked ? "✓" : "";
      const checked = [...(row?.querySelectorAll("[data-action='member-allowed-model']:checked") || [])]
        .map((el) => el.dataset.model)
        .filter(Boolean);
      if (!checked.length) {
        memberAllowed.checked = true;
        if (chip) chip.classList.add("is-on");
        if (mark) mark.textContent = "✓";
        setError("Keep at least one allowed model enabled.");
        return;
      }
      try {
        const data = await api(
          `/api/teams/${teamId}/ai-keys/${teamKeyId}/members/${targetUserId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allowed_models: checked }),
          }
        );
        const panel = document.getElementById(`members-panel-${teamKeyId}`);
        if (panel) {
          panel.classList.remove("hidden");
          document.querySelector(`[data-action='manage-access'][data-team-key-id='${CSS.escape(teamKeyId)}']`)
            ?.classList.add("active");
          renderMembersPanel(panel, teamId, teamKeyId, data.members || []);
        }
        // Soft-update status for prompt pickers — do NOT remount the keys list
        // (full refresh() would collapse this Members panel).
        try {
          const statusData = await api("/api/user/ai-keys");
          status = { ...(statusData.ai || {}), keys: statusData.keys || statusData.ai?.keys || [] };
          onStatusChange?.(status);
        } catch {
          /* ignore soft refresh errors */
        }
      } catch (err) {
        setError(err.message || "Could not update allowed models");
        memberAllowed.checked = !memberAllowed.checked;
      }
      return;
    }
    if (memberModel) {
      const teamKeyId = memberModel.dataset.teamKeyId;
      const teamId = memberModel.dataset.teamId;
      const targetUserId = memberModel.dataset.userId;
      try {
        const data = await api(
          `/api/teams/${teamId}/ai-keys/${teamKeyId}/members/${targetUserId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: memberModel.value }),
          }
        );
        const panel = document.getElementById(`members-panel-${teamKeyId}`);
        if (panel) renderMembersPanel(panel, teamId, teamKeyId, data.members || []);
      } catch (err) {
        setError(err.message || "Could not update member model");
      }
      return;
    }
    const keyId = sel.dataset.keyId;
    const newModel = sel.value;
    setError("");
    try {
      await api(`/api/user/ai-keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModel }),
      });
      const data = await api(`/api/user/ai-keys/${keyId}/activate`, { method: "PUT" });
      render({ ...(data.ai || {}), keys: data.ai?.keys || [] });
    } catch (err) {
      setError(err.message || "Could not update model");
    }
  });

  // Delegate clicks in the keys list
  keysList?.addEventListener("click", async (e) => {
    const keyRow = e.target.closest("[data-key-id], [data-team-key-id]");
    if (keyRow && !e.target.closest("button, select, input, label, a")) {
      const keyId = keyRow.getAttribute("data-key-id") || keyRow.getAttribute("data-team-key-id");
      const key = (status?.keys || []).find((k) => k.id === keyId)
        || (status?.team_keys || []).find((k) => k.id === keyId);
      showSelectedKeyAnalytics(key || { id: keyId, name: keyRow.querySelector(".ai-key-row-name")?.textContent, provider: "openai" });
    }
    const creditTabBtn = e.target.closest("[data-action='credit-tab']");
    if (creditTabBtn) {
      creditTab = creditTabBtn.dataset.tab || "buy";
      render(status);
      if (creditTab === "manage") {
        await loadCreditTransactions();
        render(status);
      }
      return;
    }

    const amountBtn = e.target.closest("[data-action='credit-amount']");
    if (amountBtn) {
      creditAmount = Number(amountBtn.dataset.amount || 2000);
      render(status);
      return;
    }

    const enablePlatform = e.target.closest("[data-action='enable-platform-key']");
    if (enablePlatform) {
      setError("");
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ use_platform_key: true }),
        });
        render({ ...(data.ai || status || {}), credits: data.credits || data.ai?.credits });
      } catch (err) {
        setError(err.message || "Could not enable shared key credits");
      }
      return;
    }

    const activatePlatform = e.target.closest("[data-action='activate-platform']");
    if (activatePlatform) {
      const providerSel = keysList?.querySelector("[data-action='platform-provider']");
      const providerRaw = activatePlatform.dataset.provider || providerSel?.value || "openai";
      const provider = normalizePlatformProviderId(providerRaw);
      const modelSel = keysList?.querySelector(`[data-action='platform-key-model']`);
      const model = modelSel?.value || undefined;
      setError("");
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            use_platform_key: true,
            platform_provider: provider,
            platform_model: model || null,
          }),
        });
        const next = { ...(data.ai || status || {}), credits: data.credits || data.ai?.credits };
        render(next);
        onSelectPromptKey?.(`platform:${provider}`);
      } catch (err) {
        setError(err.message || "Could not activate Render Studio key");
      }
      return;
    }

    const disablePlatform = e.target.closest("[data-action='disable-platform-key']");
    if (disablePlatform) {
      setError("");
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ use_platform_key: false }),
        });
        render({ ...(data.ai || status || {}), credits: data.credits || data.ai?.credits });
      } catch (err) {
        setError(err.message || "Could not disable shared keys");
      }
      return;
    }

    const refreshTx = e.target.closest("[data-action='refresh-transactions']");
    if (refreshTx) {
      await loadCreditTransactions();
      render(status);
      return;
    }

    const buyCredits = e.target.closest("[data-action='buy-credits']");
    if (buyCredits) {
      const provider = buyCredits.dataset.provider || "stripe";
      const amount = creditAmount || 2000;
      setError("");
      buyCredits.disabled = true;
      try {
        const data = await api("/api/user/ai-credits/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_cents: amount,
            provider,
            success_url: `${window.location.origin}${window.location.pathname}?ai_credits=success`,
            cancel_url: `${window.location.origin}${window.location.pathname}?ai_credits=cancel`,
          }),
        });
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        if (data.credits) render({ ...(status || {}), credits: data.credits });
      } catch (err) {
        setError(err.message || `Could not start ${provider} checkout`);
        buyCredits.disabled = false;
      }
      return;
    }

    const openSharedAdd = e.target.closest("[data-action='open-shared-add']");
    if (openSharedAdd) {
      if (addSection) addSection.open = true;
      if (sharedInput) sharedInput.checked = true;
      updateSharedAddUI();
      if (!teams.length) await refreshTeams();
      keyInput?.focus();
      return;
    }

    const openChatgptShare = e.target.closest("[data-action='open-chatgpt-share']");
    if (openChatgptShare) {
      chatgptShareOpen = !chatgptShareOpen;
      if (chatgptShareOpen && !teams.length) await refreshTeams();
      render(status);
      return;
    }

    const chatgptCreate = e.target.closest("[data-action='chatgpt-create-workspace']");
    if (chatgptCreate) {
      const name = document.querySelector("[data-chatgpt-new-workspace]")?.value?.trim();
      if (!name) {
        setError("Name the new workspace first.");
        return;
      }
      chatgptCreate.disabled = true;
      try {
        const created = await api("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const teamId = created?.team?.id;
        if (!teamId) throw new Error("Could not create workspace");
        await api(`/api/teams/${encodeURIComponent(teamId)}/chatgpt`, { method: "POST" });
        chatgptShareOpen = false;
        await refreshTeams();
        await refresh();
      } catch (err) {
        setError(err.message || "Could not create workspace");
        chatgptCreate.disabled = false;
      }
      return;
    }

    const chatgptShareSubmit = e.target.closest("[data-action='chatgpt-share-submit']");
    if (chatgptShareSubmit) {
      const teamId = document.querySelector("[data-chatgpt-share-team]")?.value;
      if (!teamId) {
        setError("Choose a workspace to share with.");
        return;
      }
      chatgptShareSubmit.disabled = true;
      try {
        await api(`/api/teams/${encodeURIComponent(teamId)}/chatgpt`, { method: "POST" });
        chatgptShareOpen = false;
        await refresh();
      } catch (err) {
        setError(err.message || "Could not share ChatGPT");
        chatgptShareSubmit.disabled = false;
      }
      return;
    }

    const chatgptUnshare = e.target.closest("[data-action='chatgpt-unshare']");
    if (chatgptUnshare) {
      const teamId = chatgptUnshare.dataset.teamId;
      const shareId = chatgptUnshare.dataset.shareId;
      if (!teamId || !shareId) return;
      if (!confirm("Stop sharing this ChatGPT login with the workspace?")) return;
      try {
        await api(`/api/teams/${encodeURIComponent(teamId)}/chatgpt/${encodeURIComponent(shareId)}`, { method: "DELETE" });
        await refresh();
      } catch (err) {
        setError(err.message || "Could not stop sharing");
      }
      return;
    }

    const chatgptAccess = e.target.closest("[data-action='chatgpt-manage-access']");
    if (chatgptAccess) {
      const shareId = chatgptAccess.dataset.shareId;
      const teamId = chatgptAccess.dataset.teamId;
      const panel = document.getElementById(`members-panel-chatgpt-${shareId}`);
      if (!panel) return;
      const isOpen = !panel.classList.contains("hidden");
      if (isOpen) {
        panel.classList.add("hidden");
        chatgptAccess.classList.remove("active");
        return;
      }
      chatgptAccess.classList.add("active");
      panel.innerHTML = `<span class="ai-key-members-loading">Loading…</span>`;
      panel.classList.remove("hidden");
      try {
        const data = await api(`/api/teams/${teamId}/chatgpt/${shareId}/members`);
        renderChatgptMembersPanel(panel, teamId, shareId, data.members || []);
      } catch (err) {
        panel.innerHTML = `<span class="ai-key-members-error">${esc(err.message)}</span>`;
      }
      return;
    }

    const chatgptWorkspace = e.target.closest("[data-action='chatgpt-manage-workspace']");
    if (chatgptWorkspace) {
      const shareId = chatgptWorkspace.dataset.shareId;
      const teamId = chatgptWorkspace.dataset.teamId;
      const panel = document.getElementById(`team-panel-chatgpt-${shareId}`);
      if (!panel) return;
      const isOpen = !panel.classList.contains("hidden");
      if (isOpen) {
        panel.classList.add("hidden");
        chatgptWorkspace.classList.remove("active");
        return;
      }
      chatgptWorkspace.classList.add("active");
      panel.innerHTML = `<span class="ai-key-members-loading">Loading workspace…</span>`;
      panel.classList.remove("hidden");
      try {
        const data = await api(`/api/teams/${teamId}/management`);
        panel._managementCache = data;
        renderTeamPanel(panel, teamId, `chatgpt-${shareId}`, data);
      } catch (err) {
        panel.innerHTML = `<span class="ai-key-members-error">${esc(err.message)}</span>`;
      }
      return;
    }

    const chatgptGrant = e.target.closest("[data-action='chatgpt-grant-toggle']");
    if (chatgptGrant) {
      const shareId = chatgptGrant.dataset.shareId;
      const teamId = chatgptGrant.dataset.teamId;
      const targetUserId = chatgptGrant.dataset.userId;
      const newGranted = chatgptGrant.dataset.granted !== "1";
      chatgptGrant.disabled = true;
      try {
        const data = await api(
          `/api/teams/${teamId}/chatgpt/${shareId}/members/${targetUserId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ granted: newGranted }),
          },
        );
        const panel = document.getElementById(`members-panel-chatgpt-${shareId}`);
        if (panel) renderChatgptMembersPanel(panel, teamId, shareId, data.members || []);
      } catch (err) {
        setError(err.message || "Could not update ChatGPT access");
        chatgptGrant.disabled = false;
      }
      return;
    }

    // Team key toggle
    const teamToggle = e.target.closest("[data-action='team-toggle']");
    if (teamToggle) {
      const teamKeyId = teamToggle.dataset.teamKeyId;
      const teamId = teamToggle.dataset.teamId;
      const currentlyUsing = teamToggle.dataset.use === "1";
      const newUse = !currentlyUsing;
      setError("");
      try {
        const data = await api(`/api/teams/${teamId}/ai-keys/${teamKeyId}/toggle`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ use_key: newUse }),
        });
        render({ ...(data.ai || {}), keys: data.ai?.keys || [], team_keys: data.ai?.team_keys || [] });
      } catch (err) {
        setError(err.message || "Could not update team key");
      }
      return;
    }

    // Manage access panel toggle (owner only)
    const manageBtn = e.target.closest("[data-action='manage-access']");
    if (manageBtn) {
      const teamKeyId = manageBtn.dataset.teamKeyId;
      const teamId = manageBtn.dataset.teamId;
      const panel = document.getElementById(`members-panel-${teamKeyId}`);
      if (!panel) return;
      const isOpen = !panel.classList.contains("hidden");
      if (isOpen) {
        panel.classList.add("hidden");
        manageBtn.classList.remove("active");
        return;
      }
      manageBtn.classList.add("active");
      panel.innerHTML = `<span class="ai-key-members-loading">Loading…</span>`;
      panel.classList.remove("hidden");
      try {
        const data = await api(`/api/teams/${teamId}/ai-keys/${teamKeyId}/members`);
        renderMembersPanel(panel, teamId, teamKeyId, data.members || []);
      } catch (err) {
        panel.innerHTML = `<span class="ai-key-members-error">${esc(err.message)}</span>`;
      }
      return;
    }

    // Team management panel toggle (owner only)
    const teamManageBtn = e.target.closest("[data-action='manage-team']");
    if (teamManageBtn) {
      const teamKeyId = teamManageBtn.dataset.teamKeyId;
      const teamId = teamManageBtn.dataset.teamId;
      const panel = document.getElementById(`team-panel-${teamKeyId}`);
      if (!panel) return;
      const isOpen = !panel.classList.contains("hidden");
      if (isOpen) {
        panel.classList.add("hidden");
        teamManageBtn.classList.remove("active");
        return;
      }
      teamManageBtn.classList.add("active");
      panel.innerHTML = `<span class="ai-key-members-loading">Loading team…</span>`;
      panel.classList.remove("hidden");
      try {
        const data = await api(`/api/teams/${teamId}/management`);
        panel._managementCache = data;
        renderTeamPanel(panel, teamId, teamKeyId, data);
      } catch (err) {
        panel.innerHTML = `<span class="ai-key-members-error">${esc(err.message)}</span>`;
      }
      return;
    }

    // Add a registered user to the team by email or @handle.
    const addMemberBtn = e.target.closest("[data-action='team-add-member']");
    if (addMemberBtn) {
      const teamKeyId = addMemberBtn.dataset.teamKeyId;
      const teamId = addMemberBtn.dataset.teamId;
      const panel = document.getElementById(`team-panel-${teamKeyId}`);
      const input = panel?.querySelector("[data-team-add-email]");
      const raw = (addMemberBtn.dataset.email || input?.value || "").trim();
      if (!raw) {
        setError("Enter an email or @handle to add.");
        return;
      }
      const payload = raw.includes("@") && !raw.startsWith("@") && raw.includes(".")
        ? { email: raw }
        : { handle: raw.replace(/^@+/, "") };
      // Plain emails without TLD still go as email; handles never contain @domain
      if (!payload.email && raw.includes("@") && raw.includes(".")) payload.email = raw;
      if (!payload.email && !payload.handle) payload.email = raw;
      addMemberBtn.disabled = true;
      try {
        await api(`/api/teams/${teamId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (input) input.value = "";
        const data = await api(`/api/teams/${teamId}/management`);
        if (panel) renderTeamPanel(panel, teamId, teamKeyId, data);
        await refresh();
      } catch (err) {
        setError(err.message || "Could not add team member");
        addMemberBtn.disabled = false;
      }
      return;
    }

    // Remove a user from the team.
    const removeMemberBtn = e.target.closest("[data-action='team-remove-member']");
    if (removeMemberBtn) {
      const teamKeyId = removeMemberBtn.dataset.teamKeyId;
      const teamId = removeMemberBtn.dataset.teamId;
      const userId = removeMemberBtn.dataset.userId;
      if (!confirm("Remove this person from the team? They will lose access to team keys and workspace projects.")) return;
      removeMemberBtn.disabled = true;
      try {
        await api(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
        const panel = document.getElementById(`team-panel-${teamKeyId}`);
        const data = await api(`/api/teams/${teamId}/management`);
        if (panel) renderTeamPanel(panel, teamId, teamKeyId, data);
        await refresh();
      } catch (err) {
        setError(err.message || "Could not remove team member");
        removeMemberBtn.disabled = false;
      }
      return;
    }

    // Revoke key access and remove from workspace (Members panel).
    const revokeRemoveBtn = e.target.closest("[data-action='revoke-and-remove']");
    if (revokeRemoveBtn) {
      const teamKeyId = revokeRemoveBtn.dataset.teamKeyId;
      const teamId = revokeRemoveBtn.dataset.teamId;
      const userId = revokeRemoveBtn.dataset.userId;
      const name = revokeRemoveBtn.dataset.name || "this person";
      if (!confirm(`Remove ${name} from this workspace? They will lose key access and project access.`)) return;
      revokeRemoveBtn.disabled = true;
      try {
        try {
          await api(`/api/teams/${teamId}/ai-keys/${teamKeyId}/members/${userId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ granted: false, use_key: false }),
          });
        } catch {
          /* still try team remove */
        }
        await api(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
        const membersPanel = document.getElementById(`members-panel-${teamKeyId}`);
        if (membersPanel && !membersPanel.classList.contains("hidden")) {
          const data = await api(`/api/teams/${teamId}/ai-keys/${teamKeyId}/members`);
          renderMembersPanel(membersPanel, teamId, teamKeyId, data.members || []);
        }
        const teamPanel = document.getElementById(`team-panel-${teamKeyId}`);
        if (teamPanel && !teamPanel.classList.contains("hidden")) {
          const data = await api(`/api/teams/${teamId}/management`);
          renderTeamPanel(teamPanel, teamId, teamKeyId, data);
        }
        await refresh();
      } catch (err) {
        setError(err.message || "Could not remove person");
        revokeRemoveBtn.disabled = false;
      }
      return;
    }

    // Delete team key (owner only)
    const delTeamBtn = e.target.closest("[data-action='delete-team-key']");
    if (delTeamBtn) {
      if (!confirm("Remove this shared key? Team members will lose access.")) return;
      const teamKeyId = delTeamBtn.dataset.teamKeyId;
      const teamId = delTeamBtn.dataset.teamId;
      setError("");
      try {
        await api(`/api/teams/${teamId}/ai-keys/${teamKeyId}`, { method: "DELETE" });
        await refresh();
      } catch (err) {
        setError(err.message || "Could not remove key");
      }
      return;
    }

    // Member access grant toggle (inside members panel)
    const grantBtn = e.target.closest("[data-action='grant-toggle']");
    if (grantBtn) {
      const teamKeyId = grantBtn.dataset.teamKeyId;
      const teamId = grantBtn.dataset.teamId;
      const targetUserId = grantBtn.dataset.userId;
      const currentGranted = grantBtn.dataset.granted === "1";
      const newGranted = !currentGranted;
      grantBtn.disabled = true;
      try {
        const data = await api(
          `/api/teams/${teamId}/ai-keys/${teamKeyId}/members/${targetUserId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ granted: newGranted }),
          }
        );
        const panel = document.getElementById(`members-panel-${teamKeyId}`);
        if (panel) renderMembersPanel(panel, teamId, teamKeyId, data.members || []);
      } catch (err) {
        setError(err.message || "Could not update access");
        grantBtn.disabled = false;
      }
      return;
    }

    const useMemberBtn = e.target.closest("[data-action='member-use-toggle']");
    if (useMemberBtn) {
      const teamKeyId = useMemberBtn.dataset.teamKeyId;
      const teamId = useMemberBtn.dataset.teamId;
      const targetUserId = useMemberBtn.dataset.userId;
      const currentUse = useMemberBtn.dataset.use === "1";
      useMemberBtn.disabled = true;
      try {
        const data = await api(
          `/api/teams/${teamId}/ai-keys/${teamKeyId}/members/${targetUserId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ use_key: !currentUse }),
          }
        );
        const panel = document.getElementById(`members-panel-${teamKeyId}`);
        if (panel) renderMembersPanel(panel, teamId, teamKeyId, data.members || []);
      } catch (err) {
        setError(err.message || "Could not update member key choice");
        useMemberBtn.disabled = false;
      }
      return;
    }

    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "change-model") return; // handled by change event above
    const keyId = btn.dataset.keyId;
    setError("");

    if (action === "activate") {
      try {
        const data = await api(`/api/user/ai-keys/${keyId}/activate`, { method: "PUT" });
        let credits = data.ai?.credits || status?.credits;
        try {
          const creditData = await api("/api/user/ai-credits", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ use_platform_key: false }),
          });
          credits = creditData.credits || creditData.ai?.credits || credits;
        } catch {
          /* non-fatal */
        }
        render({ ...(data.ai || {}), keys: data.ai?.keys || [], credits });
        onSelectPromptKey?.(`personal:${keyId}`);
      } catch (err) {
        setError(err.message || "Could not activate key");
      }
    } else if (action === "delete") {
      if (!confirm("Remove this API key?")) return;
      try {
        const data = await api(`/api/user/ai-keys/${keyId}`, { method: "DELETE" });
        render({ ...(data.ai || {}), keys: data.ai?.keys || [] });
      } catch (err) {
        setError(err.message || "Could not delete key");
      }
    } else if (action === "rename") {
      const row = btn.closest(".ai-key-row");
      const nameEl = row?.querySelector(".ai-key-row-name");
      if (!nameEl) return;
      const current = nameEl.textContent.trim();
      const newName = prompt("New nickname for this key:", current);
      if (!newName || newName.trim() === current) return;
      try {
        const data = await api(`/api/user/ai-keys/${keyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        });
        render({ ...(data.ai || {}), keys: data.ai?.keys || [] });
      } catch (err) {
        setError(err.message || "Could not rename key");
      }
    }
  });

  keysList?.addEventListener("change", async (e) => {
    const autoRefill = e.target.closest("[data-action='auto-refill']");
    if (autoRefill) {
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto_refill_enabled: autoRefill.checked }),
        });
        render({ ...(data.ai || status || {}), credits: data.credits || data.ai?.credits });
      } catch (err) {
        setError(err.message || "Could not update auto refill");
        autoRefill.checked = !autoRefill.checked;
      }
      return;
    }

    const usePlatform = e.target.closest("[data-action='use-platform-key']");
    if (usePlatform) {
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ use_platform_key: usePlatform.checked }),
        });
        render({ ...(data.ai || status || {}), credits: data.credits || data.ai?.credits });
      } catch (err) {
        setError(err.message || "Could not update shared key setting");
        usePlatform.checked = !usePlatform.checked;
      }
      return;
    }

    const platformModel = e.target.closest("[data-action='platform-model']");
    if (platformModel) {
      const raw = String(platformModel.value || "");
      const sep = raw.indexOf(":");
      const provider = sep >= 0 ? raw.slice(0, sep) : "openai";
      const model = sep >= 0 ? raw.slice(sep + 1) : raw;
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            use_platform_key: true,
            platform_provider: provider,
            platform_model: model || null,
          }),
        });
        render({ ...(data.ai || status || {}), credits: data.credits || data.ai?.credits });
        onSelectPromptKey?.(`platform:${normalizePlatformProviderId(provider)}`);
      } catch (err) {
        setError(err.message || "Could not update shared model");
      }
      return;
    }

    const platformProvider = e.target.closest("[data-action='platform-provider'], [data-action='render3d-provider']");
    if (platformProvider) {
      const raw = String(platformProvider.value || "");
      const sep = raw.indexOf(":");
      const id = sep >= 0 ? raw.slice(sep + 1) : raw;
      const provider = normalizePlatformProviderId(id);
      const preferredModel = (() => {
        const pinned = String(status?.credits?.platform_model || "").trim();
        if (provider === "anthropic") {
          if (pinned && !/^(gpt|o1|o3|chatgpt|kimi)/i.test(pinned)) return pinned;
          return "claude-opus-4-8";
        }
        if (provider === "kimi") {
          if (pinned && /^kimi/i.test(pinned)) return pinned;
          return "kimi-k3";
        }
        if (pinned && /^(gpt|o1|o3|chatgpt)/i.test(pinned) && !/pro/i.test(pinned)) return pinned;
        const fromList = (status?.credits?.models || []).find((m) => m.provider === provider)?.model;
        if (fromList && /^(gpt|o1|o3|chatgpt)/i.test(fromList) && !/pro/i.test(fromList)) return fromList;
        return defaultModel(provider);
      })();
      setError("");
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            use_platform_key: true,
            platform_provider: provider,
            platform_model: preferredModel || null,
          }),
        });
        const next = { ...(data.ai || status || {}), credits: data.credits || data.ai?.credits };
        render(next);
        onSelectPromptKey?.(`platform:${provider}`);
      } catch (err) {
        setError(err.message || "Could not switch Render Studio provider");
      }
      return;
    }

    const platformKeyModel = e.target.closest("[data-action='platform-key-model']");
    if (platformKeyModel) {
      const providerSel = keysList?.querySelector("[data-action='platform-provider'], [data-action='render3d-provider']");
      const providerRaw = platformKeyModel.dataset.provider
        || String(providerSel?.value || "").split(":")[1]
        || "openai";
      const provider = normalizePlatformProviderId(providerRaw);
      let model = platformKeyModel.value;
      if (isRetiredOpenAiModel(model)) {
        model = DEFAULT_AI_MODEL;
        platformKeyModel.value = model;
      }
      try {
        const data = await api("/api/user/ai-credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            use_platform_key: true,
            platform_provider: provider,
            platform_model: model || null,
          }),
        });
        render({ ...(data.ai || status || {}), credits: data.credits || data.ai?.credits });
        onSelectPromptKey?.(`platform:${provider}`);
      } catch (err) {
        setError(err.message || "Could not update Render Studio model");
      }
    }
  });

  keysList?.addEventListener("change", (e) => {
    const teamFilter = e.target.closest("[data-action='team-filter']");
    if (!teamFilter) return;
    selectedTeamFilter = teamFilter.value || "all";
    render(status);
  });

  async function claimCreditsFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("ai_credits");
    if (flag !== "success" && flag !== "cancel") return;
    const sessionId = params.get("session_id");
    if (flag === "success" && sessionId) {
      try {
        const data = await api("/api/user/ai-credits/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        creditTab = "overview";
        render({ ...(data.ai || status || {}), credits: data.credits || data.ai?.credits });
        showModal(true, { message: "Credits added. Shared OpenAI/Claude keys are ready." });
      } catch (err) {
        setError(err.message || "Payment succeeded but credits are still settling. Refresh in a moment.");
        showModal(true, { message: "Checking your credit purchase…" });
      }
    } else if (flag === "cancel") {
      creditTab = "buy";
      showModal(true, { message: "Checkout canceled. You can buy credits anytime." });
    }
    params.delete("ai_credits");
    params.delete("session_id");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash || ""}`;
    window.history.replaceState({}, "", next);
  }

  void claimCreditsFromUrl();

  let savingKey = false;

  async function saveNewKey() {
    if (savingKey) return;
    setError("");
    const provider = String(providerInput?.value || "openai").trim().toLowerCase();
    if (!MODEL_OPTIONS[provider]) {
      setError("Pick a provider (OpenAI, Claude, Kimi, Grok, Gemini, or Qwen).");
      return;
    }
    // Ensure model options match the selected provider (stale empty <select> blocks nothing but saves wrong defaults).
    if (modelInput && (!modelInput.options.length || !(MODEL_OPTIONS[provider] || []).some((m) => m.value === modelInput.value))) {
      renderModelOptions(provider, modelInput.value);
    }
    const model = String(modelInput?.value || "").trim() || defaultModel(provider);
    const name = (nameInput?.value || "").trim() || null;
    const payload = { provider, model, name };
    if (provider === "local") {
      const baseUrl = String(baseUrlInput?.value || "").trim() || "http://127.0.0.1:11434/v1";
      payload.base_url = baseUrl;
    } else if (provider === "qwen") {
      payload.base_url = String(endpointInput?.value || "").trim()
        || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    }
    const shared = isSharedAddMode();
    const sourceKeyId = sourceInput?.value || "__new__";
    const usingSavedSource = shared && sourceKeyId !== "__new__";
    const apiKey = String(keyInput?.value || "").trim();

    if (shared) {
      const teamId = teamInput?.value;
      if (!teamId) {
        setError("Choose a team for this shared key.");
        return;
      }
      if (!usingSavedSource && provider !== "local" && apiKey.length < 20) {
        setError("Paste a valid API key (or pick a saved key to share).");
        keyInput?.focus();
        return;
      }
      if (usingSavedSource) payload.source_key_id = sourceKeyId;
      else payload.api_key = apiKey || (provider === "local" ? "local-no-key-required" : apiKey);
    } else if (provider === "local") {
      payload.api_key = apiKey || "local-no-key-required";
    } else if (apiKey.length < 20) {
      setError("Paste your API key before saving.");
      keyInput?.focus();
      return;
    } else {
      payload.api_key = apiKey;
    }

    savingKey = true;
    const prevLabel = submitBtn?.textContent || "Save & activate";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = shared ? "Saving shared key…" : "Saving…";
    }
    try {
      if (shared) {
        const teamId = teamInput?.value;
        await api(`/api/teams/${teamId}/ai-keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await refresh();
      } else {
        const data = await api("/api/user/ai-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        // Prefer the new personal key in the compose picker (don't stay on Render Studio Claude).
        try {
          await api("/api/user/ai-credits", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ use_platform_key: false }),
          });
        } catch {
          /* non-fatal */
        }
        const ai = { ...(data.ai || {}), keys: data.ai?.keys || data.keys || [] };
        render(ai);
        const activeId = ai.active_key_id
          || (ai.keys || []).find((k) => k.is_active)?.id
          || (ai.keys || []).find((k) => k.provider === provider)?.id;
        if (activeId) onSelectPromptKey?.(`personal:${activeId}`);
      }
      form?.reset();
      if (providerInput) providerInput.disabled = false;
      if (modelInput) modelInput.disabled = false;
      renderModelOptions("openai");
      updateSharedAddUI();
      if (addSection) addSection.removeAttribute("open");
    } catch (err) {
      setError(err?.message || "Could not save API key");
    } finally {
      savingKey = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isSharedAddMode() ? "Save shared key" : "Save & activate";
        if (!submitBtn.textContent) submitBtn.textContent = prevLabel;
      }
    }
  }

  // Explicit button click — do not rely on native form submit (HTML5 validation / details quirks).
  submitBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void saveNewKey();
  });
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveNewKey();
  });

  return {
    render,
    refresh,
    open(opts = {}) {
      showModal(true, {
        required: false,
        preferProvider: opts.preferProvider || "openai",
        message: opts.message || "",
        openAdd: opts.openAdd === true,
        tab: opts.tab || "keys",
        costs: opts.costs,
      });
    },
    openRequired(opts = {}) {
      showModal(true, {
        required: true,
        preferProvider: opts.preferProvider || "openai",
        message: opts.message || "",
        openAdd: opts.openAdd === true,
        tab: opts.tab || "keys",
      });
    },
    setTab: setBillingTab,
    setCostsOpen,
  };
}
