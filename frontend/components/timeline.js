/** Fusion-style timeline scrubber */

import { formatPromptModeLabel, isCadPromptModeLabel } from "./prompt-ref.js?v=20260908-hist-dur1&gpt61sol=20261001-1";
import { generationUsedCanvas, canvasGenerateChip } from "../viewport/viewer-overlay.js?v=20260909-sharefast1-hudcard1-gencost1-loadhud1-gencost2-canvasload1-canvashist1-genanother3-mcmcad1-partelect1-genheadtime1&gpt61sol=20261001-1";

export function timelineEntryUsedCanvas(entry = {}) {
  return generationUsedCanvas(entry);
}

export function timelineCanvasIconLabel(entry = {}) {
  const mode = String(
    entry.prompt_mode ||
    entry.mode ||
    entry.meta?.prompt_mode ||
    entry.meta?.mode ||
    "",
  ).toLowerCase();
  return canvasGenerateChip({ promptMode: mode, canvas: true });
}

export function timelineEntryIsRestorable(entry = {}) {
  if (!entry || entry.pending || entry.id === "__pending_prompt__") return false;
  if (entry.restorable === false) return false;
  if (entry.restorable === true) return true;
  return Boolean(
    entry.snapshot
    || entry.drive_file_id
    || (Array.isArray(entry.snapshot_files) && entry.snapshot_files.length),
  );
}

function entryPromptText(entry = {}, { original = false } = {}) {
  const meta = entry.meta || {};
  const orig = String(entry.original_prompt || meta.original_prompt || "").trim();
  const improved = String(meta.prompt || entry.prompt || "").trim();
  if (original) return orig || improved;
  return improved || orig;
}

export function createTimelineUI(container, { onScrub, onSelect, onRestoreLatest, onRemove, onReusePrompt }) {
  const wrap = document.createElement("div");
  wrap.className = "timeline-wrap timeline-wrap--dock timeline-wrap--empty";
  wrap.innerHTML = `
    <div class="timeline-body">
      <input type="range" id="timeline-slider" min="0" max="0" value="0" disabled aria-hidden="true" tabindex="-1" />
      <div id="timeline-steps" class="timeline-steps" role="listbox" aria-label="Timeline steps"></div>
      <button type="button" id="btn-timeline-collapse" class="btn-collapse timeline-collapse-btn" title="Collapse timeline" aria-label="Collapse timeline" aria-pressed="false" hidden><span class="timeline-collapse-icon">▼</span></button>
    </div>
  `;
  container.appendChild(wrap);
  container.classList.add("timeline-panel--empty");

  const slider = wrap.querySelector("#timeline-slider");
  const stepsEl = wrap.querySelector("#timeline-steps");
  const collapseBtn = wrap.querySelector("#btn-timeline-collapse");
  // Kept for scrub/preview status; not shown in the dock chrome.
  const labelEl = { textContent: "" };

  function syncEmptyState(count) {
    const empty = count <= 0;
    wrap.classList.toggle("timeline-wrap--empty", empty);
    container.classList.toggle("timeline-panel--empty", empty);
    if (collapseBtn) collapseBtn.hidden = empty;
    window.dispatchEvent(
      new CustomEvent("render3d:timeline-entries", { detail: { count, empty } }),
    );
  }

  // Initial: no activities yet — hide the bottom arrow immediately.
  queueMicrotask(() => syncEmptyState(0));

  let entries = [];
  let scrubbing = false;
  let contextMenu = null;
  /** @type {number | null} */
  let restoringIndex = null;

  function ensureStepSpinner(el) {
    if (el.querySelector(":scope > .timeline-step-spinner")) return;
    const spinner = document.createElement("span");
    spinner.className = "timeline-step-spinner";
    spinner.setAttribute("aria-hidden", "true");
    el.appendChild(spinner);
  }

  function applyRestoringState() {
    const busy = Number.isInteger(restoringIndex);
    container.classList.toggle("timeline-panel--restoring", busy);
    wrap.classList.toggle("timeline-wrap--restoring", busy);
    stepsEl.querySelectorAll(".timeline-step").forEach((el, i) => {
      const isTarget = busy && i === restoringIndex;
      const pending = el.classList.contains("timeline-step--pending");
      el.classList.toggle("is-restoring", isTarget);
      el.toggleAttribute("aria-busy", isTarget || pending);
      const spinner = el.querySelector(":scope > .timeline-step-spinner");
      if (isTarget || pending) {
        ensureStepSpinner(el);
      } else if (spinner) {
        spinner.remove();
      }
    });
    if (busy) {
      const entry = entries[restoringIndex];
      const label = entry ? entryLabel(entry) : "timeline step";
      labelEl.textContent = `Loading ${label}…`;
    }
  }

  function setRestoring(index = null, { label = "" } = {}) {
    restoringIndex = Number.isInteger(index) ? index : null;
    applyRestoringState();
    if (restoringIndex != null && label) {
      labelEl.textContent = label;
    }
  }

  // Vertical wheel → horizontal scroll once the dock overflows.
  // Snap to full icons so the strip never shows a half tile.
  let wheelSnapTimer = null;
  stepsEl.addEventListener(
    "wheel",
    (e) => {
      if (stepsEl.scrollWidth <= stepsEl.clientWidth + 1) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      stepsEl.scrollLeft += e.deltaY;
      clearTimeout(wheelSnapTimer);
      wheelSnapTimer = setTimeout(() => snapScrollToFullIcons(), 80);
    },
    { passive: false },
  );

  stepsEl.addEventListener(
    "scrollend",
    () => snapScrollToFullIcons(),
    { passive: true },
  );

  function stepPitch() {
    const step = stepsEl.querySelector(".timeline-step");
    if (!step) return 39;
    const gap = parseFloat(getComputedStyle(stepsEl).columnGap || getComputedStyle(stepsEl).gap) || 5;
    return step.getBoundingClientRect().width + gap;
  }

  function snapScrollToFullIcons() {
    const pitch = stepPitch();
    if (pitch <= 0) return;
    const max = Math.max(0, stepsEl.scrollWidth - stepsEl.clientWidth);
    const snapped = Math.round(stepsEl.scrollLeft / pitch) * pitch;
    stepsEl.scrollLeft = Math.max(0, Math.min(max, snapped));
  }

  /** Fit the strip to an integer number of icons — never wider than the real entry count. */
  function fitFullIconViewport() {
    const stepNodes = stepsEl.querySelectorAll(".timeline-step");
    const step = stepNodes[0];
    if (!step || !container) return;
    const count = stepNodes.length || entries.length || 1;
    const gap = parseFloat(getComputedStyle(stepsEl).columnGap || getComputedStyle(stepsEl).gap) || 5;
    const padL = parseFloat(getComputedStyle(stepsEl).paddingLeft) || 10;
    const padR = parseFloat(getComputedStyle(stepsEl).paddingRight) || 10;
    const stepW = step.getBoundingClientRect().width;
    if (stepW <= 0) return;
    const pitch = stepW + gap;
    const panelPad = 24;
    const available = Math.max(
      pitch,
      Math.min(
        container.parentElement?.clientWidth || window.innerWidth,
        window.innerWidth,
      ) - 280 - panelPad,
    );
    const nFit = Math.max(1, Math.floor((available - padL - padR + gap) / pitch));
    const n = Math.max(1, Math.min(nFit, count));
    const inner = n * pitch - gap;
    stepsEl.style.width = `${Math.ceil(inner + padL + padR)}px`;
    stepsEl.style.maxWidth = `${Math.ceil(inner + padL + padR)}px`;
    snapScrollToFullIcons();
  }

  let fitRaf = 0;
  function scheduleFitFullIcons() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      fitFullIconViewport();
    });
  }

  window.addEventListener("resize", scheduleFitFullIcons);
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleFitFullIcons());
    ro.observe(container);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function iconHtmlForEntry(entry = {}) {
    if (timelineEntryUsedCanvas(entry)) {
      const mark = timelineCanvasIconLabel(entry);
      const kind = escapeHtml(mark.replace(/\s*🎨\s*/g, "").trim() || "CAD");
      return `<span class="timeline-step-icon timeline-step-icon--canvas" aria-hidden="true"><span class="timeline-canvas-kind">${kind}</span><span class="timeline-canvas-paint">🎨</span></span>`;
    }
    return `<span class="timeline-step-icon" aria-hidden="true">${escapeHtml(iconForKind(entry.kind))}</span>`;
  }

  function iconForKind(kind) {
    const k = String(kind || "").toLowerCase();
    if (k === "upload") return "⬆";
    if (k === "import" || k === "autodesk_import") return "⬇";
    if (k === "fusion_sync") return "↻";
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
    return timelineEntryIsRestorable(entry);
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
    const base = entry?.label || kind || "Change";
    if (meta.success === false || entry?.success === false || meta.error) {
      return base.startsWith("Failed:") ? base : `Failed: ${base}`;
    }
    return base;
  }

  function formatWhen(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  function entryWho(entry = {}) {
    return String(entry.user_name || "").trim()
      || (entry.user_id ? "Teammate" : "")
      || "You";
  }

  let hoverPopup = null;
  let hoverPopupStep = null;

  function hideStepHoverPopup() {
    hoverPopup?.remove();
    hoverPopup = null;
    hoverPopupStep = null;
  }

  function positionStepHoverPopup(btn) {
    if (!hoverPopup || !btn) return;
    const rect = btn.getBoundingClientRect();
    const pad = 8;
    const popupRect = hoverPopup.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - popupRect.width / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - popupRect.width - pad));
    let top = rect.top - popupRect.height - 10;
    if (top < pad) top = rect.bottom + 10;
    hoverPopup.style.left = `${Math.round(left)}px`;
    hoverPopup.style.top = `${Math.round(top)}px`;
  }

  function showStepHoverPopup(btn, entry, index) {
    if (!btn || !entry) return;
    if (hoverPopupStep === btn && hoverPopup) {
      positionStepHoverPopup(btn);
      return;
    }
    hideStepHoverPopup();
    const label = entryLabel(entry);
    const who = entryWho(entry);
    const when = formatWhen(entry.created_at || entry.meta?.created_at || entry.updated_at);
    const detail = entryMetaLabel(entry);
    const rawKind = String(entry.kind || "change").toLowerCase();
    const modeLabel = formatPromptModeLabel(
      promptModeForEntry(entry),
      entry.skills || entry.meta?.skills,
    );
    const cadHistoryKind = isCadPromptModeLabel(modeLabel);
    const kind = timelineEntryUsedCanvas(entry)
      ? timelineCanvasIconLabel(entry)
      : (rawKind === "prompt" || rawKind === "build") && cadHistoryKind
        ? modeLabel
        : String(entry.kind || "change").replace(/_/g, " ");
    const popup = document.createElement("div");
    popup.className = "timeline-step-popup";
    popup.setAttribute("role", "tooltip");
    popup.innerHTML = `
      <div class="timeline-step-popup-head">
        ${iconHtmlForEntry(entry).replace("timeline-step-icon", "timeline-step-popup-icon")}
        <div class="timeline-step-popup-copy">
          <strong class="timeline-step-popup-title">${escapeHtml(label)}</strong>
          <span class="timeline-step-popup-kind">${escapeHtml(kind)}${Number.isFinite(index) ? ` · step ${index + 1}` : ""}</span>
        </div>
      </div>
      <div class="timeline-step-popup-who">
        ${userAvatar({ ...entry, user_name: who })}
        <div class="timeline-step-popup-who-text">
          <span class="timeline-step-popup-who-name">${escapeHtml(who)}</span>
          ${when ? `<span class="timeline-step-popup-when">${escapeHtml(when)}</span>` : ""}
        </div>
      </div>
      ${detail ? `<p class="timeline-step-popup-detail">${escapeHtml(detail)}</p>` : ""}
    `;
    document.body.appendChild(popup);
    hoverPopup = popup;
    hoverPopupStep = btn;
    positionStepHoverPopup(btn);
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
  document.addEventListener("scroll", () => {
    closeContextMenu();
    hideStepHoverPopup();
  }, true);
  window.addEventListener("resize", () => {
    closeContextMenu();
    hideStepHoverPopup();
  });

  slider.addEventListener("input", () => {
    if (Number.isInteger(restoringIndex)) return;
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
    if (Number.isInteger(restoringIndex)) {
      scrubbing = false;
      return;
    }
    scrubbing = false;
    const idx = parseInt(slider.value, 10);
    onSelect?.(idx, entries[idx]);
  });

  function highlightStep(container, index) {
    container.querySelectorAll(".timeline-step").forEach((el, i) => {
      const on = i === index;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
  }

  function scrollStepsToIndex(index, { alignEnd = false } = {}) {
    requestAnimationFrame(() => {
      const max = Math.max(0, entries.length - 1);
      const idx = Math.max(0, Math.min(index, max));
      const step = stepsEl.children[idx];
      if (!step) return;
      if (alignEnd || idx >= max) {
        const pitch = stepPitch();
        const maxScroll = Math.max(0, stepsEl.scrollWidth - stepsEl.clientWidth);
        const raw = stepsEl.scrollWidth;
        stepsEl.scrollLeft = pitch > 0
          ? Math.min(maxScroll, Math.round(maxScroll / pitch) * pitch)
          : raw;
        return;
      }
      step.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      requestAnimationFrame(() => snapScrollToFullIcons());
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
    const canReusePrompt = Boolean(entryPromptText(entry) || entryPromptText(entry, { original: true }));
    const canReuseOriginal = Boolean(entryPromptText(entry, { original: true }));
    menu.innerHTML = `
      <div class="timeline-context-title">
        ${iconHtmlForEntry(entry)}
        <strong>${escapeHtml(entry.label)}</strong>
      </div>
      <button type="button" data-action="restore" ${entryIsRestorable(entry) ? "" : "disabled"}>Restore to this step</button>
      <button type="button" data-action="reuse-original" ${canReuseOriginal ? "" : "disabled"}>Reuse original prompt</button>
      <button type="button" data-action="reuse-prompt" ${canReusePrompt ? "" : "disabled"}>Reuse prompt</button>
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
      } else if (action === "reuse-original") {
        onReusePrompt?.(index, entry, { useOriginal: true });
      } else if (action === "reuse-prompt") {
        onReusePrompt?.(index, entry, { useOriginal: false });
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
        if (timelineEntryUsedCanvas(e)) btn.classList.add("timeline-step--canvas");
        if (kind === "render" || kind === "scene_render" || promptMode === "render") btn.classList.add("timeline-step--render");
        if (!entryIsRestorable(e)) btn.classList.add("timeline-step--history-only");
        if (e.pending || e.id === "__pending_prompt__") btn.classList.add("timeline-step--pending");
        if (e.user_id) btn.classList.add("timeline-step--collab");
        if (e?.meta?.success === false || e?.success === false || e?.meta?.error) {
          btn.classList.add("timeline-step--failed");
        }
        const label = entryLabel(e);
        const who = e.user_name || "";
        const detail = entryMetaLabel(e);
        const tip = [label, detail, who].filter(Boolean).join(" · ");
        // Custom hover popup replaces native title (avoids delayed OS tooltip).
        btn.removeAttribute("title");
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
        // Icon-dock tile: labels live in hover popup; text kept for screen readers only.
        btn.innerHTML = `
          ${iconHtmlForEntry(e)}
          ${pending ? '<span class="timeline-step-spinner" aria-hidden="true"></span>' : ""}
          ${showAvatar ? userAvatar(e) : ""}
          <span class="timeline-step-sr">
            <span class="step-kind">${escapeHtml(pendingKind)}</span>
            <span class="step-label">${escapeHtml(label)}</span>
            ${detail ? `<span class="step-meta">${escapeHtml(detail)}</span>` : ""}
            ${who ? `<span class="step-user">${escapeHtml(who)}</span>` : ""}
          </span>
        `;
        btn.addEventListener("mouseenter", () => {
          const whoLabel = who ? ` · ${who}` : "";
          labelEl.textContent = `${label}${whoLabel}`;
          showStepHoverPopup(btn, e, i);
        });
        btn.addEventListener("mouseleave", hideStepHoverPopup);
        btn.addEventListener("focus", () => showStepHoverPopup(btn, e, i));
        btn.addEventListener("blur", hideStepHoverPopup);
        if (!pending) {
          btn.addEventListener("click", () => {
            if (Number.isInteger(restoringIndex)) return;
            slider.value = String(i);
            const whoLabel = who ? ` · ${who}` : "";
            labelEl.textContent = `${label}${whoLabel}`;
            highlightStep(stepsEl, i);
            hideStepHoverPopup();
            onSelect?.(i, e);
          });
          btn.addEventListener("contextmenu", (event) => {
            if (Number.isInteger(restoringIndex)) {
              event.preventDefault();
              return;
            }
            hideStepHoverPopup();
            showStepContextMenu(event, i, e);
          });
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
        labelEl.textContent = "No history yet — model backups live on Google Drive";
        hideStepHoverPopup();
      }
      syncEmptyState(entries.length);
      scheduleFitFullIcons();
      applyRestoringState();
    },
    setRestoring,
    get isScrubbing() {
      return scrubbing;
    },
    get entryCount() {
      return entries.length;
    },
    get isRestoring() {
      return Number.isInteger(restoringIndex);
    },
  };
}
