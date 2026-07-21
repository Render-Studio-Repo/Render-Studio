/** AI provider key manager — supports multiple saved keys. */

const PROVIDER_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const PROVIDER_BADGE_CLASS = {
  openai: "badge-openai",
  anthropic: "badge-claude",
};

const MODEL_OPTIONS = {
  openai: [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  ],
  anthropic: [
    { value: "claude-fable-5", label: "Fable 5" },
    { value: "claude-sonnet-4-5", label: "Sonnet 4.5" },
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-4.6-sonnet", label: "Sonnet 4.6" },
  ],
};

function labelFor(provider) {
  return PROVIDER_LABELS[provider] || "OpenAI";
}

function defaultModel(provider) {
  return MODEL_OPTIONS[provider]?.[0]?.value || "gpt-5.5";
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

export function createAIKeyUI({ api, onStatusChange, onSelectPromptKey }) {
  const modal = document.getElementById("ai-key-modal");
  const form = document.getElementById("ai-key-form");
  const providerInput = document.getElementById("ai-key-provider");
  const keyInput = document.getElementById("ai-key-input");
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
  let creditAmount = 2000;
  let creditTransactions = [];
  let creditTxLoading = false;

  function renderModelOptions(provider, selectedModel = "") {
    if (!modelInput) return;
    const options = MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai;
    const selected = selectedModel || defaultModel(provider);
    modelInput.innerHTML = "";
    options.forEach((model) => {
      const opt = document.createElement("option");
      opt.value = model.value;
      opt.textContent = model.label;
      modelInput.appendChild(opt);
    });
    if (selected && !options.some((m) => m.value === selected)) {
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
      keyInput.placeholder = usingSavedSource ? "Using selected saved key" : "sk-... or sk-ant-...";
      if (usingSavedSource) keyInput.value = "";
    }
    if (nameInput) {
      const provider = providerInput?.value || "openai";
      nameInput.placeholder = shared
        ? (provider === "anthropic" ? "e.g. Team Claude key" : "e.g. Team OpenAI key")
        : (provider === "anthropic" ? "e.g. My Claude key" : "e.g. My OpenAI key");
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
    const options = MODEL_OPTIONS[provider] || MODEL_OPTIONS.openai;
    const knownValues = options.map((o) => o.value);
    let html = options.map((o) =>
      `<option value="${esc(o.value)}"${o.value === currentModel ? " selected" : ""}>${esc(o.label)}</option>`
    ).join("");
    if (currentModel && !knownValues.includes(currentModel)) {
      html += `<option value="${esc(currentModel)}" selected>${esc(currentModel)}</option>`;
    }
    return html;
  }

  function renderTeamFilter(teamKeys = []) {
    const teamIds = [...new Set(teamKeys.map((k) => k.team_id).filter(Boolean))];
    if (teamIds.length <= 1) return "";
    if (selectedTeamFilter !== "all" && !teamIds.includes(selectedTeamFilter)) selectedTeamFilter = "all";
    const teamName = (id) => teams.find((team) => team.id === id)?.name || id;
    return `
      <label class="ai-key-team-filter">View team
        <select data-action="team-filter">
          <option value="all"${selectedTeamFilter === "all" ? " selected" : ""}>All teams</option>
          ${teamIds.map((id) => `<option value="${esc(id)}"${selectedTeamFilter === id ? " selected" : ""}>${esc(teamName(id))}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function renderCreditCard(credits = {}) {
    const balance = Number(credits.balance_cents || 0);
    const pct = credits.last_purchase_percent_left;
    const pctValue = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
    const pctLabel = pct == null ? "Buy credits to start" : `${pctValue.toFixed(0)}% left from last buy`;
    const providers = credits.providers || {};
    const openaiOn = !!providers.openai;
    const claudeOn = !!providers.anthropic;
    const models = credits.models || [];
    const preferredProvider = credits.platform_provider === "anthropic" ? "anthropic" : "openai";
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
          Credits unlock Render3D’s shared <strong>OpenAI</strong>${claudeOn ? " and <strong>Claude</strong>" : ""} keys.
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
        <p class="ai-credit-note">Live Stripe checkout. Credits enable Render3D shared keys automatically after payment.</p>
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
          const label = `${m.provider === "anthropic" ? "Anthropic" : "OpenAI"} · ${modelLabel}`;
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
            <span>Use Render3D shared keys when I don’t have a personal key active</span>
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
            <span class="ai-credit-kicker">Render3D Credits</span>
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
    const preferred = credits.platform_provider === "anthropic" ? "anthropic" : "openai";
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
    ];

    let body = "";
    if (balance <= 0) {
      body = `<p class="ai-keys-empty">Buy Studio credits to unlock the Render3D key (OpenAI or Anthropic) — no personal API key required.</p>`;
    } else {
      const available = rows.filter((row) => row.live);
      const current = available.find((row) => row.id === preferred) || available[0];
      if (!current) {
        body = `<p class="ai-keys-empty">Render3D shared keys are not configured on this server yet.</p>`;
      } else {
        const badgeClass = PROVIDER_BADGE_CLASS[current.provider] || "badge-openai";
        const isActive = enabled;
        body = `
          <div class="ai-key-row ai-key-row--platform${isActive ? " ai-key-row--active" : ""}"
               data-platform-provider="${esc(current.id)}">
            <div class="ai-key-row-info">
              <span class="ai-key-row-name">Render3D Key</span>
              <span class="ai-key-badge ${badgeClass}">${esc(labelFor(current.provider))}</span>
              <select class="ai-key-model-select" data-action="render3d-provider" title="OpenAI or Anthropic">
                ${available.map((row) => `
                  <option value="platform:${esc(row.id)}"${row.id === current.id ? " selected" : ""}>${esc(row.name)}</option>
                `).join("")}
              </select>
              <select class="ai-key-model-select" data-action="platform-key-model" data-provider="${esc(current.id)}" title="Model for this Render3D key">
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
        <span>Render3D Key</span>
      </div>
      <p class="ai-keys-section-hint">Anyone with Studio credits can use the shared OpenAI and Anthropic keys you offer — pick a provider, then a model.</p>
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
        <span>Team keys</span>
        <button type="button" class="btn ai-key-btn-activate ai-key-btn-share" data-action="open-shared-add">
          Share a key
        </button>
      </div>`;
    html += renderTeamFilter(teamKeys);
    const visibleTeamKeys = selectedTeamFilter === "all"
      ? teamKeys
      : teamKeys.filter((k) => k.team_id === selectedTeamFilter);
    if (!visibleTeamKeys.length) {
      html += `<p class="ai-keys-empty ai-keys-empty--team">No shared team keys yet. Open “Add a new key”, then check “Share this key with a team”.</p>`;
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
                Team: ${esc(accessLabel)}
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
                  Team
                </button>
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

  function renderMembersPanel(panel, teamId, teamKeyId, members) {
    if (!members.length) {
      panel.innerHTML = `<p class="ai-key-members-empty">No other members in this team.</p>`;
      return;
    }
    panel.innerHTML = `
      <div class="ai-key-members-header">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a2 2 0 100 4 2 2 0 000-4zM5 8a3 3 0 016 0v.5H5V8z"/></svg>
        Member access — toggle to grant or revoke
      </div>
      ${members.map((m) => `
        <div class="ai-key-member-row">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc(m.display_name.charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(m.display_name)}</span>
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
            <select class="ai-key-model-select ai-key-member-model-select"
              data-action="member-model"
              data-team-key-id="${esc(teamKeyId)}"
              data-team-id="${esc(teamId)}"
              data-user-id="${esc(m.user_id)}"
              ${m.granted ? "" : "disabled"}
              title="Model this member uses with this shared key">
              ${modelOptionsHTML(m.provider, m.model)}
            </select>
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
          </div>
        </div>
      `).join("")}`;
  }

  function renderTeamPanel(panel, teamId, teamKeyId, data) {
    const members = data.members || [];
    const invites = data.invites || [];
    const candidates = data.candidates || [];
    const canRemoveMembers = Boolean(data.can_remove_members);
    panel.innerHTML = `
      <div class="ai-key-members-header">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a2 2 0 100 4 2 2 0 000-4zM3 7a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4z"/></svg>
        Team management
      </div>
      <div class="ai-key-team-add">
        <input type="email" placeholder="Add user email, e.g. muhammad@example.com" data-team-add-email spellcheck="false" />
        <button type="button" class="btn ai-key-btn-activate" data-action="team-add-member" data-team-id="${esc(teamId)}" data-team-key-id="${esc(teamKeyId)}">Add</button>
      </div>
      <div class="ai-key-team-subtitle">Available from your workspaces</div>
      ${candidates.length ? candidates.map((m) => `
        <div class="ai-key-member-row">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc((m.display_name || m.email || "?").charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(m.display_name || m.email)}</span>
              <span class="ai-key-member-email">${esc(m.email)} · ${esc(m.source_teams || "another workspace")}</span>
            </div>
          </div>
          <button type="button" class="btn ai-key-btn-activate"
            data-action="team-add-member"
            data-team-id="${esc(teamId)}"
            data-team-key-id="${esc(teamKeyId)}"
            data-email="${esc(m.email)}">
            Add to this team
          </button>
        </div>
      `).join("") : `<p class="ai-key-members-empty">No users from your other workspaces to add.</p>`}
      <div class="ai-key-team-subtitle">Members</div>
      ${members.length ? members.map((m) => `
        <div class="ai-key-member-row">
          <div class="ai-key-member-info">
            <span class="ai-key-member-avatar">${esc((m.display_name || m.email || "?").charAt(0).toUpperCase())}</span>
            <div>
              <span class="ai-key-member-name">${esc(m.display_name || m.email)}</span>
              <span class="ai-key-member-email">${esc(m.email)} · ${esc(m.role || "member")}</span>
            </div>
          </div>
          <div class="ai-key-team-row-actions">
            ${m.role === "owner" ? `<span class="ai-key-active-badge">Owner</span>` : `
              ${canRemoveMembers ? `
              <button type="button" class="btn ai-key-btn-team-toggle"
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
      `).join("") : `<p class="ai-key-members-empty">No team members yet.</p>`}
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
              Add to team
            </button>
          ` : `<span class="ai-key-row-model">Waiting for signup</span>`}
        </div>
      `).join("") : `<p class="ai-key-members-empty">No pending invites.</p>`}
      <p class="ai-key-team-note">After a user is a team member, use the <strong>Members</strong> button on this key to grant or revoke their key access.</p>`;
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
      menuLabel.textContent = hasKey
        ? `${providerLabel} API key`
        : usingCredits
          ? "Render3D credits"
          : "AI & billing";
    }
    if (menuHint) {
      menuHint.textContent = hasKey
        ? `${providerLabel} · ${status.model || ""}${usageLabel}`
        : usingCredits
          ? `${formatCents(creditBal)} · shared OpenAI/Claude`
          : "Keys, credits, and spend";
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

  function showModal(show, { required = false, message = "", preferProvider = "openai", openAdd = false } = {}) {
    if (!modal) return;
    modal.classList.toggle("hidden", !show);
    if (show) {
      modal.dataset.required = required ? "1" : "";
      const provider = preferProvider === "anthropic" ? "anthropic" : "openai";
      setError(
        message
          || (required
            ? (provider === "openai"
              ? "Add your own OpenAI API key, or buy shared-key credits to borrow Render3D's API key."
              : "Add your own key, or buy shared-key credits to use Render3D's API key.")
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
    }
  }

  // Provider dropdown change
  providerInput?.addEventListener("change", () => {
    renderModelOptions(providerInput.value);
    if (nameInput && !nameInput.value) updateSharedAddUI();
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
    showModal(true);
  });

  modal?.querySelectorAll("[data-ai-key-close]").forEach((el) => {
    el.addEventListener("click", () => showModal(false));
  });

  // Delegate model select changes in the keys list
  keysList?.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-action='change-model']");
    const memberModel = e.target.closest("[data-action='member-model']");
    const dailyLimit = e.target.closest("[data-action='member-daily-dollar-limit']");
    if (!sel && !memberModel && !dailyLimit) return;
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
      const provider = providerRaw === "anthropic" ? "anthropic" : "openai";
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
        setError(err.message || "Could not activate Render3D key");
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
        renderTeamPanel(panel, teamId, teamKeyId, data);
      } catch (err) {
        panel.innerHTML = `<span class="ai-key-members-error">${esc(err.message)}</span>`;
      }
      return;
    }

    // Add a registered user to the team, or create/refresh an invite for unknown emails.
    const addMemberBtn = e.target.closest("[data-action='team-add-member']");
    if (addMemberBtn) {
      const teamKeyId = addMemberBtn.dataset.teamKeyId;
      const teamId = addMemberBtn.dataset.teamId;
      const panel = document.getElementById(`team-panel-${teamKeyId}`);
      const input = panel?.querySelector("[data-team-add-email]");
      const email = addMemberBtn.dataset.email || input?.value?.trim();
      if (!email) {
        setError("Enter an email to add.");
        return;
      }
      addMemberBtn.disabled = true;
      try {
        await api(`/api/teams/${teamId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
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
        render({ ...(data.ai || {}), keys: data.ai?.keys || [] });
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
        onSelectPromptKey?.(`platform:${provider === "anthropic" ? "anthropic" : "openai"}`);
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
      const provider = id === "anthropic" ? "anthropic" : "openai";
      const preferredModel = (() => {
        const pinned = String(status?.credits?.platform_model || "").trim();
        if (provider === "anthropic") {
          if (pinned && !/^(gpt|o1|o3|chatgpt)/i.test(pinned)) return pinned;
          return "claude-opus-4-8";
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
        setError(err.message || "Could not switch Render3D provider");
      }
      return;
    }

    const platformKeyModel = e.target.closest("[data-action='platform-key-model']");
    if (platformKeyModel) {
      const providerSel = keysList?.querySelector("[data-action='platform-provider'], [data-action='render3d-provider']");
      const providerRaw = platformKeyModel.dataset.provider
        || String(providerSel?.value || "").split(":")[1]
        || "openai";
      const provider = providerRaw === "anthropic" ? "anthropic" : "openai";
      const model = platformKeyModel.value;
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
        setError(err.message || "Could not update Render3D model");
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

  // Add new key form submit
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        provider: providerInput.value,
        model: modelInput.value.trim() || null,
        name: (nameInput?.value || "").trim() || null,
      };
      if (isSharedAddMode()) {
        const teamId = teamInput?.value;
        if (!teamId) {
          setError("Choose a team for this shared key.");
          return;
        }
        const sourceKeyId = sourceInput?.value || "__new__";
        if (sourceKeyId !== "__new__") {
          payload.source_key_id = sourceKeyId;
        } else {
          payload.api_key = keyInput.value.trim();
        }
        await api(`/api/teams/${teamId}/ai-keys`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await refresh();
      } else {
        payload.api_key = keyInput.value.trim();
        const data = await api("/api/user/ai-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        render({ ...(data.ai || {}), keys: data.ai?.keys || [] });
      }
      // Reset form and collapse
      form.reset();
      providerInput.disabled = false;
      modelInput.disabled = false;
      renderModelOptions("openai");
      updateSharedAddUI();
      if (addSection) addSection.removeAttribute("open");
    } catch (err) {
      setError(err.message || "Could not save API key");
    }
  });

  return {
    render,
    refresh,
    openRequired(opts = {}) {
      showModal(true, {
        required: true,
        preferProvider: opts.preferProvider || "openai",
        message: opts.message || "",
        openAdd: opts.openAdd === true,
      });
    },
  };
}
