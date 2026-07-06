/** Fusion-style timeline scrubber */

export function createTimelineUI(container, { onScrub, onSelect }) {
  const wrap = document.createElement("div");
  wrap.className = "timeline-wrap";
  wrap.innerHTML = `
    <div class="timeline-header">
      <h2>Timeline</h2>
      <span id="timeline-label" class="muted small">No history yet</span>
    </div>
    <input type="range" id="timeline-slider" min="0" max="0" value="0" disabled />
    <div id="timeline-steps" class="timeline-steps"></div>
  `;
  container.appendChild(wrap);

  const slider = wrap.querySelector("#timeline-slider");
  const stepsEl = wrap.querySelector("#timeline-steps");
  const labelEl = wrap.querySelector("#timeline-label");

  let entries = [];
  let scrubbing = false;

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

  function goToIndex(index, { preview = false } = {}) {
    if (index < 0 || index >= entries.length) return;
    slider.value = String(index);
    const entry = entries[index];
    const who = entry.user_name ? ` · ${entry.user_name}` : "";
    labelEl.textContent = `${entry.label}${who}`;
    highlightStep(stepsEl, index);
    if (!preview) onSelect?.(index, entry);
  }

  return {
    goToIndex,
    setTimeline(data) {
      entries = data?.entries || [];
      const max = Math.max(0, entries.length - 1);
      const current = data?.current_index ?? max;
      slider.min = "0";
      slider.max = String(max);
      slider.value = String(Math.max(0, current));
      slider.disabled = entries.length === 0;

      stepsEl.innerHTML = "";
      entries.forEach((e, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "timeline-step";
        btn.title = e.label;
        btn.innerHTML = `<span class="step-kind">${e.kind}</span><span class="step-label">${e.label}</span>${e.user_name ? `<span class="step-user">${e.user_name}</span>` : ""}`;
        btn.addEventListener("click", () => {
          slider.value = String(i);
          const who = e.user_name ? ` · ${e.user_name}` : "";
          labelEl.textContent = `${e.label}${who}`;
          highlightStep(stepsEl, i);
          onSelect?.(i, e);
        });
        stepsEl.appendChild(btn);
      });

      if (entries.length) {
        const cur = entries[Math.max(0, current)] || entries[entries.length - 1];
        const who = cur.user_name ? ` · ${cur.user_name}` : "";
        labelEl.textContent = `${cur.label}${who}`;
        highlightStep(stepsEl, Math.max(0, current));
      } else {
        labelEl.textContent = "No history yet";
      }
    },
    get isScrubbing() {
      return scrubbing;
    },
  };
}
