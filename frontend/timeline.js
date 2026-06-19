/** Fusion-style timeline scrubber */

export function createTimelineUI(container, { onScrub, onSelect, onRestoreLatest, onRemove }) {
  const wrap = document.createElement("div");
  wrap.className = "timeline-wrap";
  wrap.innerHTML = `
    <div class="timeline-header">
      <div class="timeline-header-main">
        <h2>Timeline</h2>
        <span id="timeline-label" class="muted small">No history yet</span>
      </div>
      <button type="button" id="btn-timeline-collapse" class="btn-collapse timeline-collapse-btn" title="Collapse timeline" aria-label="Collapse timeline" aria-pressed="false"><span class="timeline-collapse-icon">▼</span></button>
    </div>
    <div class="timeline-body">
      <input type="range" id="timeline-slider" min="0" max="0" value="0" disabled />
      <div id="timeline-steps" class="timeline-steps"></div>
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
    if (k.includes("sketch")) return "✎";
    return "▣";
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
      labelEl.textContent = `${entry.label}${who} (preview — release to restore)`;
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
    labelEl.textContent = `${entry.label}${who}`;
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
      <button type="button" data-action="restore">Restore to this step</button>
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
        if (e.kind === "restore") btn.classList.add("timeline-step--restore");
        btn.title = e.label;
        btn.innerHTML = `
          <span class="step-topline">
            <span class="timeline-step-icon" aria-hidden="true">${escapeHtml(iconForKind(e.kind))}</span>
            <span class="step-kind">${escapeHtml(e.kind)}</span>
          </span>
          <span class="step-label">${escapeHtml(e.label)}</span>
          ${e.user_name ? `<span class="step-user">${escapeHtml(e.user_name)}</span>` : ""}
        `;
        btn.addEventListener("click", () => {
          slider.value = String(i);
          const who = e.user_name ? ` · ${e.user_name}` : "";
          labelEl.textContent = `${e.label}${who}`;
          highlightStep(stepsEl, i);
          onSelect?.(i, e);
        });
        btn.addEventListener("contextmenu", (event) => showStepContextMenu(event, i, e));
        stepsEl.appendChild(btn);
      });

      if (entries.length) {
        const cur = entries[current] || entries[entries.length - 1];
        const who = cur.user_name ? ` · ${cur.user_name}` : "";
        labelEl.textContent = `${cur.label}${who}`;
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
