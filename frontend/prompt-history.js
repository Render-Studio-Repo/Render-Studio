/** Prompt compose / history tabs (CAD AI + Wiring AI panels). */

import { copyPromptRef, copyText, formatPromptRef, formatPromptModeLabel, formatModelLabel } from "./prompt-ref.js";

export function createPromptHistoryUI({
  listEl,
  summaryEl = null,
  onReuse,
  onTabChange,
  getProjectId,
  onRefCopied,
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
      .replace(/>/g, "&gt;");
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
        const who = e.user_name ? escapeHtml(e.user_name) : null;
        const kindLabel = (e.kind || "cad") === "wiring" ? "Wiring" : null;
        const modeLabel = formatPromptModeLabel(e.prompt_mode);
        const modelLabel = formatModelLabel(e.model, e.provider);
        const costLabel = entryCostLabel(e);
        const meta = [
          who,
          when,
          kindLabel,
          modeLabel ? `<span class="ph-mode">${escapeHtml(modeLabel)}</span>` : null,
          modelLabel ? `<span class="ph-model">${escapeHtml(modelLabel)}</span>` : null,
          costLabel ? `<span class="ph-cost">${escapeHtml(costLabel)}</span>` : null,
          e.filename ? escapeHtml(e.filename) : null,
          e.reference_count ? `${e.reference_count} ref` : null,
          e.image_count ? `${e.image_count} image${e.image_count > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
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
        return `<div class="prompt-history-item${selected}" data-id="${escapeHtml(e.id)}">
          <button type="button" class="ph-ref-btn" data-ref-id="${escapeHtml(e.id)}" title="Copy chat reference ID">${escapeHtml(ref)}</button>
          <button type="button" class="ph-body-btn">
            <span class="ph-head">${status}<span class="ph-meta">${meta}</span></span>
            <span class="ph-prompt">${escapeHtml(e.prompt)}</span>
            ${reply}
          </button>
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
