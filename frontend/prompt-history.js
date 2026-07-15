/** Prompt compose / history tabs (CAD AI + Wiring AI panels). */

import { copyPromptRef, copyText, formatPromptRef, formatPromptModeLabel, formatModelLabel, formatSpeedLabel, formatTargetModeLabel } from "./prompt-ref.js?v=20260715-history-codex-target";
import { skillLabel } from "./skills-library.js?v=20260706-ui-fix";

export function createPromptHistoryUI({
  listEl,
  summaryEl = null,
  onReuse,
  onTabChange,
  getProjectId,
  onRefCopied,
  onViewPromptCompare = null,
  tabSelector = ".prompt-tab",
  panes = null,
  refStatusEl = null,
  historyTabSelector = null,
} = {}) {
  const tabs = document.querySelectorAll(tabSelector);
  const paneEls = panes || {
    compose: document.getElementById("prompt-pane-compose"),
    history: document.getElementById("prompt-pane-history"),
  };
  const refStatus = refStatusEl || document.getElementById("prompt-ref-status");

  let selectedId = null;
  let promptDropdown = null;

  function setTab(name) {
    tabs.forEach((btn) => {
      const active = btn.dataset.pane === name;
      btn.classList.toggle("active", active);
    });
    Object.entries(paneEls).forEach(([key, pane]) => {
      if (!pane) return;
      pane.classList.toggle("hidden", key !== name);
      pane.classList.toggle("active", key === name);
    });
    onTabChange?.(name);
  }

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.pane));
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatWhen(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  function showRefCopied(refText, ok = true) {
    if (refStatus) {
      refStatus.classList.remove("hidden");
      refStatus.textContent = ok
        ? `Copied — paste this when asking for help: ${refText}`
        : "Could not copy — select the reference ID and copy manually.";
    }
    onRefCopied?.(refText, ok);
  }

  function showPromptCopied(entry, ok = true, latest = false) {
    const who = entry?.user_name || "user";
    const label = latest ? `latest prompt by ${who}` : `prompt by ${who}`;
    if (refStatus) {
      refStatus.classList.remove("hidden");
      refStatus.textContent = ok
        ? `Copied to clipboard: ${label}`
        : "Could not copy prompt — select the prompt text and copy manually.";
    }
    onRefCopied?.(entry?.prompt || "", ok);
  }

  async function copyEntryRef(entry) {
    const refText = formatPromptRef({
      promptId: entry.id,
      projectId: getProjectId?.(),
      filename: entry.filename,
      traceId: entry.trace_id,
      promptMode: entry.prompt_mode,
      model: entry.model,
      provider: entry.provider,
    });
    const ok = await copyText(refText);
    showRefCopied(refText, ok);
    return ok;
  }

  function selectEntry(id) {
    selectedId = id;
    listEl?.querySelectorAll(".prompt-history-item").forEach((el) => {
      el.classList.toggle("ph-selected", el.dataset.id === id);
    });
  }

  function avatarHtml(e) {
    const name = e.user_name || "User";
    const initial = escapeHtml(name.trim().charAt(0).toUpperCase() || "?");
    if (e.user_avatar_url) {
      return `<span class="ph-avatar ph-avatar--image" style="background-image:url('${escapeHtml(e.user_avatar_url)}')" title="${escapeHtml(name)}"></span>`;
    }
    return `<span class="ph-avatar" title="${escapeHtml(name)}">${initial}</span>`;
  }

  function userKey(entry) {
    return entry?.user_id || entry?.user_name || "unknown";
  }

  function newestFirst(a, b) {
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  }

  function latestPromptsForUser(entries, key, limit = 5) {
    return [...(entries || [])]
      .filter((entry) => userKey(entry) === key && entry.prompt)
      .sort(newestFirst)
      .slice(0, limit);
  }

  function closePromptDropdown() {
    promptDropdown?.remove();
    promptDropdown = null;
  }

  function showPromptDropdown(anchor, userEntries, latestEntry) {
    closePromptDropdown();
    if (!anchor || !userEntries.length) return;
    const menu = document.createElement("div");
    menu.className = "ph-person-menu";
    const name = latestEntry?.user_name || "User";
    menu.innerHTML = `
      <div class="ph-person-menu-title">Latest prompts from ${escapeHtml(name)}</div>
      ${userEntries.map((entry, idx) => `
        <button type="button" data-prompt-index="${idx}">
          <strong>${idx === 0 ? "Latest" : formatWhen(entry.created_at) || `Prompt ${idx + 1}`}</strong>
          <span>${escapeHtml(entry.prompt)}</span>
        </button>
      `).join("")}
    `;
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - menuRect.width - 10);
    const top = Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 10);
    menu.style.left = `${Math.max(10, left)}px`;
    menu.style.top = `${Math.max(10, top)}px`;
    menu.addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-prompt-index]");
      if (!btn) return;
      const entry = userEntries[Number(btn.dataset.promptIndex)];
      if (!entry) return;
      selectEntry(entry.id);
      const ok = await copyText(entry.prompt);
      showPromptCopied(entry, ok, Number(btn.dataset.promptIndex) === 0);
      closePromptDropdown();
    });
    promptDropdown = menu;
  }

  document.addEventListener("click", (event) => {
    if (!promptDropdown) return;
    if (event.target.closest(".ph-person-menu") || event.target.closest(".ph-user-chip")) return;
    closePromptDropdown();
  });

  function formatCostUsd(value) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    const n = Number(value);
    if (n === 0) return "$0.00";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  }

  function formatTokenCount(usage) {
    if (!usage) return null;
    const total =
      Number(usage.total_tokens) ||
      Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
    if (!total) return null;
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(2)}M tok`;
    if (total >= 1000) return `${(total / 1000).toFixed(1)}k tok`;
    return `${total} tok`;
  }

  function entryCostLabel(entry) {
    if (entry?.provider === "deterministic") return "$0.00 · no AI";
    const cost = formatCostUsd(entry?.cost_usd);
    const tokens = formatTokenCount(entry?.usage);
    if (cost && tokens) return `${cost} · ${tokens}`;
    if (cost) return cost;
    if (tokens) return tokens;
    return null;
  }

  function providerLabel(summary) {
    const prov = (summary?.provider || "").toLowerCase();
    if (prov === "deterministic") return "Deterministic";
    if (prov === "anthropic") return "Claude est.";
    if (prov === "openai") return "OpenAI est.";
    const model = (summary?.model || "").toLowerCase();
    if (model.includes("claude")) return "Claude est.";
    if (model.includes("gpt") || model.includes("o1") || model.includes("o3")) return "OpenAI est.";
    return "AI est.";
  }

  function renderSummary(summary) {
    if (!summaryEl) return;
    if (!summary?.tracked_count) {
      summaryEl.classList.add("hidden");
      summaryEl.textContent = "";
      return;
    }
    // Use cost_usd (total, provider-agnostic); openai_cost_usd is 0 for Claude users
    const totalCost = (summary.cost_usd ?? 0) > 0 ? summary.cost_usd : (summary.openai_cost_usd ?? 0);
    const costStr = formatCostUsd(totalCost) || "$0.00";
    const tokens = formatTokenCount(summary.usage);
    const parts = [
      `<strong>${providerLabel(summary)}</strong> ${costStr}`,
      tokens ? `<span class="ph-summary-tokens">${tokens}</span>` : "",
      `<span class="ph-summary-meta">${summary.tracked_count} tracked prompt${summary.tracked_count === 1 ? "" : "s"}</span>`,
    ].filter(Boolean);
    const untracked = summary.untracked_count ?? Math.max(0, (summary.prompt_count || 0) - (summary.tracked_count || 0));
    if (untracked > 0) {
      parts.push(`<span class="ph-summary-meta">${untracked} older prompt${untracked === 1 ? "" : "s"} missing usage</span>`);
    }
    summaryEl.innerHTML = parts.join(" · ");
    summaryEl.classList.remove("hidden");
  }

  function promptPreview(text, limit = 220) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    if (raw.length <= limit) return raw;
    return `${raw.slice(0, limit).trimEnd()}…`;
  }

  function entryHasImprovedPrompt(entry) {
    const original = String(entry?.original_prompt || "").trim();
    const prompt = String(entry?.prompt || "").trim();
    return Boolean(entry?.prompt_improved) || (original && original !== prompt);
  }

  function entrySkills(entry) {
    const seen = new Set();
    return (Array.isArray(entry?.skills) ? entry.skills : [])
      .map((skill) => String(skill || "").trim().toLowerCase())
      .filter((skill) => {
        if (!skill || seen.has(skill)) return false;
        seen.add(skill);
        return true;
      });
  }

  function renderSkillsUsed(entry) {
    const skills = entrySkills(entry);
    if (!skills.length) return "";
    const visible = skills.slice(0, 3);
    const hidden = skills.slice(3);
    const chips = [
      ...visible.map((skill) => `<span class="ph-skill-chip" title="${escapeHtml(skill)}">${escapeHtml(skillLabel(skill))}</span>`),
      ...hidden.map((skill) => `<span class="ph-skill-chip ph-skill-chip--extra hidden" title="${escapeHtml(skill)}">${escapeHtml(skillLabel(skill))}</span>`),
    ].join("");
    const toggle = hidden.length
      ? `<button type="button" class="ph-skills-toggle" data-skills-toggle="${escapeHtml(entry.id)}" aria-expanded="false">+${hidden.length} more</button>`
      : "";
    return `<div class="ph-skills-row" data-skills-row="${escapeHtml(entry.id)}">
      <span class="ph-skills-label">Skills used</span>
      ${chips}
      ${toggle}
    </div>`;
  }

  function render(entries, summary = null) {
    if (!listEl) return;
    if (!entries?.length) {
      listEl.innerHTML = '<p class="muted small prompt-history-empty">No prompts yet for this project.</p>';
      selectedId = null;
      renderSummary(summary);
      return;
    }
    const projectId = getProjectId?.() || "";
    listEl.innerHTML = entries
      .map((e) => {
        const when = formatWhen(e.created_at);
        const status = e.success
          ? `<span class="ph-status ok">OK</span>`
          : `<span class="ph-status err">Failed</span>`;
        const who = e.user_name
          ? `<span class="ph-user-chip" role="button" tabindex="0" data-user-key="${escapeHtml(userKey(e))}" title="Copy latest prompt and show recent prompts">${avatarHtml(e)}${escapeHtml(e.user_name)}</span>`
          : null;
        const kindLabel = (e.kind || "cad") === "wiring" ? "Wiring" : null;
        const modeLabel = formatPromptModeLabel(e.prompt_mode);
        const speedLabel = formatSpeedLabel(e.speed);
        const modelLabel = formatModelLabel(e.model, e.provider);
        const targetLabel = (e.kind || "cad") === "cad"
          ? formatTargetModeLabel(e.target_mode, e.base_filename)
          : null;
        const usedCodex = Boolean(e.codex_agent || e.jake_codex_agent);
        const costLabel = entryCostLabel(e);
        const improved = entryHasImprovedPrompt(e);
        const fullPrompt = String(e.prompt || "");
        const preview = promptPreview(fullPrompt);
        const canExpand = improved || fullPrompt.length > 220;
        const metaParts = [
          who,
          when,
          kindLabel,
          modeLabel ? `<span class="ph-mode">${escapeHtml(modeLabel)}</span>` : null,
          speedLabel ? `<span class="ph-speed">${escapeHtml(speedLabel)}</span>` : null,
          targetLabel
            ? `<span class="ph-target ph-target--${targetLabel === "Edit selected" ? "edit" : "new"}" title="${
                targetLabel === "Edit selected"
                  ? `Edited selected object${e.base_filename ? `: ${escapeHtml(e.base_filename)}` : ""}`
                  : "Created a new object"
              }">${escapeHtml(targetLabel)}</span>`
            : null,
          usedCodex ? `<span class="ph-codex" title="Generated with Codex agent">Codex</span>` : null,
          modelLabel
            ? `<span class="ph-model" title="AI model used for this prompt"><span class="ph-model-label">Model</span> ${escapeHtml(modelLabel)}</span>`
            : `<span class="ph-model ph-model--unknown" title="Model was not recorded for this run">Model unknown</span>`,
          improved ? `<span class="ph-improved">Improved</span>` : null,
          costLabel ? `<span class="ph-cost">${escapeHtml(costLabel)}</span>` : null,
          e.filename ? escapeHtml(e.filename) : null,
          e.reference_count ? `${e.reference_count} ref` : null,
          e.image_count ? `${e.image_count} image${e.image_count > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean);
        const meta = metaParts
          .map((item) => `<span class="ph-meta-part">${item}</span>`)
          .join("");
        const reply = e.message
          ? `<p class="ph-reply">${escapeHtml(e.message)}</p>`
          : e.error
            ? `<p class="ph-reply ph-error">${escapeHtml(e.error)}</p>`
            : "";
        const ref = formatPromptRef({
          promptId: e.id,
          projectId,
          filename: e.filename,
          traceId: e.trace_id,
          promptMode: e.prompt_mode,
          model: e.model,
          provider: e.provider,
        });
        const selected = e.id === selectedId ? " ph-selected" : "";
        const viewMore = canExpand
          ? `<button type="button" class="ph-view-more" data-view-more="${escapeHtml(e.id)}">${
              improved ? "View more · original vs improved" : "View more"
            }</button>`
          : "";
        const skillsUsed = renderSkillsUsed(e);
        return `<div class="prompt-history-item${selected}" data-id="${escapeHtml(e.id)}">
          <button type="button" class="ph-ref-btn" data-ref-id="${escapeHtml(e.id)}" title="Copy chat reference ID">${escapeHtml(ref)}</button>
          <button type="button" class="ph-body-btn">
            <span class="ph-head">${status}<span class="ph-meta">${meta}</span></span>
            <span class="ph-prompt">${escapeHtml(preview)}</span>
            ${reply}
          </button>
          ${skillsUsed}
          ${viewMore}
        </div>`;
      })
      .join("");

    listEl.querySelectorAll(".ph-ref-btn").forEach((btn, i) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const entry = entries[i];
        if (!entry) return;
        selectEntry(entry.id);
        await copyEntryRef(entry);
      });
    });

    listEl.querySelectorAll(".ph-body-btn").forEach((btn, i) => {
      btn.addEventListener("click", async () => {
        const entry = entries[i];
        if (!entry) return;
        selectEntry(entry.id);
        await copyEntryRef(entry);
        onReuse?.(entry);
        setTab("compose");
      });
    });

    listEl.querySelectorAll(".ph-view-more").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const entry = entries.find((item) => item.id === btn.dataset.viewMore);
        if (!entry) return;
        selectEntry(entry.id);
        const original = String(entry.original_prompt || "").trim();
        const improved = String(entry.prompt || "").trim();
        if (onViewPromptCompare) {
          onViewPromptCompare({
            original: original || improved,
            improved,
            unchanged: !original || original === improved,
            promptImproved: entryHasImprovedPrompt(entry),
            entry,
          });
          return;
        }
        // Fallback: expand inline if no compare handler is wired.
        const promptEl = btn.closest(".prompt-history-item")?.querySelector(".ph-prompt");
        if (promptEl) {
          const expanded = btn.dataset.expanded === "1";
          promptEl.textContent = expanded ? promptPreview(improved) : improved;
          btn.dataset.expanded = expanded ? "0" : "1";
          btn.textContent = expanded
            ? (entryHasImprovedPrompt(entry) ? "View more · original vs improved" : "View more")
            : "Show less";
        }
      });
    });

    listEl.querySelectorAll(".ph-skills-toggle").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const row = btn.closest(".ph-skills-row");
        if (!row) return;
        const expanded = btn.getAttribute("aria-expanded") === "true";
        row.querySelectorAll(".ph-skill-chip--extra").forEach((chip) => {
          chip.classList.toggle("hidden", expanded);
        });
        btn.setAttribute("aria-expanded", String(!expanded));
        btn.textContent = expanded ? `+${row.querySelectorAll(".ph-skill-chip--extra").length} more` : "Show less";
      });
    });

    listEl.querySelectorAll(".ph-user-chip").forEach((chip) => {
      const copyLatest = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const key = chip.dataset.userKey;
        const userEntries = latestPromptsForUser(entries, key);
        const latestEntry = userEntries[0];
        if (!latestEntry) return;
        selectEntry(latestEntry.id);
        const ok = await copyText(latestEntry.prompt);
        showPromptCopied(latestEntry, ok, true);
        showPromptDropdown(chip, userEntries, latestEntry);
      };
      chip.addEventListener("click", copyLatest);
      chip.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        void copyLatest(ev);
      });
    });
    renderSummary(summary);
  }

  function setCountBadge(count) {
    const tab = historyTabSelector
      ? document.querySelector(historyTabSelector)
      : document.querySelector('.prompt-tab[data-pane="history"]');
    if (!tab) return;
    const base = "History";
    tab.textContent = count > 0 ? `${base} (${count})` : base;
  }

  return {
    setTab,
    render,
    renderSummary,
    setCountBadge,
    copyEntryRef,
    formatPromptRef,
  };
}
