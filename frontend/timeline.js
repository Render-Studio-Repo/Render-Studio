/** Fusion-style timeline scrubber */

export function createTimelineUI(container, { onScrub, onSelect, onRestoreLatest, onRemove }) {
  const wrap = document.createElement("div");
  wrap.className = "timeline-wrap timeline-wrap--dock";
  wrap.innerHTML = `
    <div class="timeline-header">
      <div class="timeline-header-main">
        <h2>Timeline</h2>
        <span id="timeline-label" class="muted small">No history yet</span>
      </div>
      <button type="button" id="btn-timeline-collapse" class="btn-collapse timeline-collapse-btn" title="Collapse timeline" aria-label="Collapse timeline" aria-pressed="false"><span class="timeline-collapse-icon">▼</span></button>
    </div>
    <div class="timeline-body">
      <input type="range" id="timeline-slider" min="0" max="0" value="0" disabled aria-hidden="true" tabindex="-1" />
      <div id="timeline-steps" class="timeline-steps" role="listbox" aria-label="Timeline steps"></div>
    </div>
  `;
  container.appendChild(wrap);

  const slider = wrap.querySelector("#timeline-slider");
  const stepsEl = wrap.querySelector("#timeline-steps");
  const labelEl = wrap.querySelector("#timeline-label");

  let entries = [];
  let scrubbing = false;
  let contextMenu = null;

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function iconForKind(kind) {
    const k = String(kind || "").toLowerCase();
    if (k === "upload") return "⬆";
    if (k === "prompt" || k === "build") return "✦";
    if (k === "transform") return "↔";
    if (k === "extrude") return "▰";
    if (k === "fillet") return "◜";
    if (k === "chamfer") return "◇";
    if (k === "mirror") return "⇄";
    if (k === "mesh_cleanup") return "♢";
    if (k === "delete_object") return "×";
    if (k === "remove_body") return "−";
    if (k === "restore") return "↺";
    if (k === "render" || k === "scene_render") return "◉";
    if (k === "texture_remove" || k === "remove_texture") return "◌";
    if (k === "texture" || k.includes("texture")) return "🧱";
    if (k.includes("sketch")) return "✎";
    if (k === "fusion_sync" || k === "autodesk_import") return "↻";
    return "▣";
  }

  function promptModeForEntry(entry = {}) {
    const meta = entry.meta || {};
    return String(
      entry.prompt_mode ||
      entry.mode ||
      meta.prompt_mode ||
      meta.mode ||
      meta.source ||
      ""
    ).toLowerCase();
  }

  function entryIsRestorable(entry = {}) {
    return entry.restorable !== false;
  }

  function costLabel(value) {
    const cost = Number(value);
    if (!Number.isFinite(cost) || cost <= 0) return "";
    return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
  }

  function tokenCount(entry = {}) {
    const usage = entry.usage || entry.meta?.usage || {};
    if (!usage || typeof usage !== "object") return 0;
    return Number(
      usage.total_tokens ||
      usage.tokens ||
      ((Number(usage.input_tokens || usage.prompt_tokens) || 0) + (Number(usage.output_tokens || usage.completion_tokens) || 0))
    ) || 0;
  }

  function entryMetaLabel(entry = {}) {
    const meta = entry.meta || {};
    const bits = [];
    const cost = costLabel(entry.cost_usd ?? meta.cost_usd);
    if (cost) bits.push(cost);
    const tokens = tokenCount(entry);
    if (tokens > 0) bits.push(`${tokens.toLocaleString()} tokens`);
    const prompt = String(meta.prompt || entry.summary || "").trim();
    if (prompt) bits.push(prompt.length > 62 ? `${prompt.slice(0, 62)}…` : prompt);
    return bits.join(" · ");
  }

  function userAvatar(entry) {
    const name = entry.user_name || (entry.user_id ? "Teammate" : "User");
    const initial = escapeHtml(String(name).trim().charAt(0).toUpperCase() || "?");
    if (entry.user_avatar_url) {
      return `<span class="timeline-user-avatar timeline-user-avatar--image" style="background-image:url('${escapeHtml(entry.user_avatar_url)}')" title="${escapeHtml(name)}"></span>`;
    }
    return `<span class="timeline-user-avatar" title="${escapeHtml(name)}">${initial}</span>`;
  }

  function entryLabel(entry) {
    const kind = String(entry?.kind || "").toLowerCase();
    const meta = entry?.meta || {};
    if (kind === "transform") {
      if (meta.scale != null && meta.translation == null && meta.rotation_deg == null) {
        return entry.label && entry.label !== "Transform" ? entry.label : "Resize";
      }
    }
    return entry?.label || kind || "Change";
  }

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      if (contextMenu?.contains(e.target)) return;
      closeContextMenu();
    },
    true,
  );
  document.addEventListener("scroll", closeContextMenu, true);
  window.addEventListener("resize", closeContextMenu);

  slider.addEventListener("input", () => {
    scrubbing = true;
    const idx = parseInt(slider.value, 10);
    const entry = entries[idx];
    if (entry) {
      const who = entry.user_name ? ` · ${entry.user_name}` : "";
      const suffix = entryIsRestorable(entry) ? " (preview — release to restore)" : " (history)";
      labelEl.textContent = `${entryLabel(entry)}${who}${suffix}`;
      highlightStep(stepsEl, idx);
      onScrub?.(idx, entry);
    }
  });

  slider.addEventListener("change", () => {
    scrubbing = false;
    const idx = parseInt(slider.value, 10);
    onSelect?.(idx, entries[idx]);
  });

  function highlightStep(container, index) {
    container.querySelectorAll(".timeline-step").forEach((el, i) => {
      el.classList.toggle("active", i === index);
    });
  }

  function scrollStepsToIndex(index, { alignEnd = false } = {}) {
    requestAnimationFrame(() => {
      const max = Math.max(0, entries.length - 1);
      const idx = Math.max(0, Math.min(index, max));
      const step = stepsEl.children[idx];
      if (!step) return;
      if (alignEnd || idx >= max) {
        stepsEl.scrollLeft = stepsEl.scrollWidth;
        return;
      }
      step.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    });
  }

  function goToIndex(index, { preview = false, scroll = true, scrollAlign = "auto" } = {}) {
    if (index < 0 || index >= entries.length) return;
    slider.value = String(index);
    const entry = entries[index];
    const who = entry.user_name ? ` · ${entry.user_name}` : "";
    labelEl.textContent = `${entryLabel(entry)}${who}`;
    highlightStep(stepsEl, index);
    if (scroll) {
      const alignEnd = scrollAlign === "end" || index >= entries.length - 1;
      scrollStepsToIndex(index, { alignEnd });
    }
    if (!preview) onSelect?.(index, entry);
  }

  function showStepContextMenu(e, index, entry) {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "folder-context-menu timeline-context-menu";
    menu.innerHTML = `
      <div class="timeline-context-title">
        <span class="timeline-step-icon">${escapeHtml(iconForKind(entry.kind))}</span>
        <strong>${escapeHtml(entry.label)}</strong>
      </div>
      <button type="button" data-action="restore" ${entryIsRestorable(entry) ? "" : "disabled"}>Restore to this step</button>
      <button type="button" data-action="copy-id">Copy timeline ID</button>
      <button type="button" data-action="remove">Remove timeline node</button>
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    contextMenu = menu;

    menu.addEventListener("click", (ev) => {
      const action = ev.target?.closest("button")?.dataset?.action;
      if (!action) return;
      closeContextMenu();
      if (action === "restore") {
        onRestoreLatest?.(index, entry);
      } else if (action === "copy-id") {
        const text = `timeline:${entry.id} · step:${index + 1} · kind:${entry.kind || "step"} · ${entry.label || ""}`.trim();
        navigator.clipboard?.writeText(text).catch(() => {});
      } else if (action === "remove") {
        onRemove?.(index, entry);
      }
    });
  }

  return {
    goToIndex,
    scrollToIndex: scrollStepsToIndex,
    setTimeline(data, { scroll = true, scrollAlign = "auto" } = {}) {
      entries = data?.entries || [];
      const max = Math.max(0, entries.length - 1);
      const current = Math.max(0, Math.min(data?.current_index ?? max, max));
      slider.min = "0";
      slider.max = String(max);
      slider.value = String(current);
      slider.disabled = entries.length === 0;

      stepsEl.innerHTML = "";
      entries.forEach((e, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "timeline-step";
        const kind = String(e.kind || "").toLowerCase();
        const promptMode = promptModeForEntry(e);
        if (kind === "restore") btn.classList.add("timeline-step--restore");
        if (kind === "prompt" || kind === "build") btn.classList.add("timeline-step--prompt");
        if (promptMode === "v2" || promptMode === "2.0" || promptMode === "mesh" || promptMode === "fusion") {
          btn.classList.add("timeline-step--v2");
        }
        if (kind === "render" || kind === "scene_render" || promptMode === "render") btn.classList.add("timeline-step--render");
        if (!entryIsRestorable(e)) btn.classList.add("timeline-step--history-only");
        if (e.pending || e.id === "__pending_prompt__") btn.classList.add("timeline-step--pending");
        if (e.user_id) btn.classList.add("timeline-step--collab");
        const label = entryLabel(e);
        const who = e.user_name || "";
        const detail = entryMetaLabel(e);
        const tip = [label, detail, who].filter(Boolean).join(" · ");
        btn.title = tip;
        btn.setAttribute("aria-label", tip || label || "Timeline step");
        btn.setAttribute("role", "option");
        const showAvatar = !!(e.user_name || e.user_id || e.user_avatar_url);
        const pending = !!(e.pending || e.id === "__pending_prompt__");
        const pendingKind =
          pending && (promptMode === "render" || kind === "render" || kind === "scene_render")
            ? "rendering"
            : pending
              ? "generating"
              : (e.kind || "change");
        btn.disabled = pending;
        // Icon-dock tile: labels live in title/aria; text kept for screen readers only.
        btn.innerHTML = `
          <span class="timeline-step-icon" aria-hidden="true">${escapeHtml(iconForKind(e.kind))}</span>
          ${showAvatar ? userAvatar(e) : ""}
          <span class="timeline-step-sr">
            <span class="step-kind">${escapeHtml(pendingKind)}</span>
            <span class="step-label">${escapeHtml(label)}</span>
            ${detail ? `<span class="step-meta">${escapeHtml(detail)}</span>` : ""}
            ${who ? `<span class="step-user">${escapeHtml(who)}</span>` : ""}
          </span>
        `;
        if (!pending) {
          btn.addEventListener("click", () => {
            slider.value = String(i);
            const whoLabel = who ? ` · ${who}` : "";
            labelEl.textContent = `${label}${whoLabel}`;
            highlightStep(stepsEl, i);
            onSelect?.(i, e);
          });
          btn.addEventListener("contextmenu", (event) => showStepContextMenu(event, i, e));
        }
        stepsEl.appendChild(btn);
      });

      if (entries.length) {
        const cur = entries[current] || entries[entries.length - 1];
        const label = entryLabel(cur);
        const who = cur.user_name ? ` · ${cur.user_name}` : "";
        labelEl.textContent = `${label}${who}`;
        highlightStep(stepsEl, current);
        if (scroll) {
          const alignEnd = scrollAlign === "end" || current >= max;
          scrollStepsToIndex(current, { alignEnd });
        }
      } else {
        labelEl.textContent = "No history yet";
      }
    },
    get isScrubbing() {
      return scrubbing;
    },
  };
}
