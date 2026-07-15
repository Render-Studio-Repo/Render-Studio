/** Guided "Show me" tours for Getting Started + Studio. */

const SHOW_ME_TOURS = {
  "ai-generate": {
    title: "Generate CAD with AI",
    example: "80 x 40 x 12 mm phone stand with a 65° rear tilt and rounded edges",
    studioPath: "/?promptMode=v2&showMe=ai-generate",
    steps: [
      { selector: "#prompt-pane-compose, .prompt-compose-toolbar, #prompt-input, .prompt-editor", label: "AI CAD Prompt" },
      { selector: '[data-prompt-mode="v2"], .prompt-mode-btn--v2', label: "2.0 mode" },
      { selector: "#prompt-generate, #btn-generate, button.prompt-generate", label: "Generate" },
    ],
  },
  workspaces: {
    title: "Workspaces",
    example: "",
    studioPath: "/?showMe=workspaces",
    steps: [
      { selector: "#btn-auth, .btn-auth, #workspace-picker, .workspace-mode-btn", label: "Account / workspace" },
    ],
  },
  "share-folders": {
    title: "Share folders",
    example: "",
    studioPath: "/?showMe=share-folders",
    steps: [
      { selector: "#project-browser, .browser-section, .file-browser", label: "Project browser" },
    ],
  },
  "reference-markup": {
    title: "Reference markup",
    example: "",
    studioPath: "/?showMe=reference-markup",
    steps: [
      { selector: "#project-browser, .browser-section", label: "Project files" },
    ],
  },
  canvas: {
    title: "Canvas",
    example: "",
    studioPath: "/?showMe=canvas",
    steps: [
      { selector: '[data-design-tab="canvas"], #design-tab-canvas, button[data-tab="canvas"]', label: "Canvas tab" },
    ],
  },
  picks: {
    title: "Geometry picks",
    example: "fillet @face-1 2 mm",
    studioPath: "/?showMe=picks",
    steps: [
      { selector: ".ribbon-pick, #pick-face-btn, [data-tool='pick-face']", label: "Pick tools" },
      { selector: "#prompt-input, .prompt-editor", label: "Prompt" },
    ],
  },
  wiring: {
    title: "Wiring Simulator",
    example: "",
    studioPath: "/?showMe=wiring",
    steps: [
      { selector: "#workspace-mode-btn, .workspace-mode-btn", label: "Workspace mode" },
    ],
  },
  "cloud-sync": {
    title: "Fusion / Onshape",
    example: "",
    studioPath: "/?showMe=cloud-sync",
    steps: [
      { selector: "#fusion-library, #onshape-library, .fusion-panel", label: "Cloud libraries" },
    ],
  },
  "render-agent": {
    title: "Render Agent",
    example: "How do I generate my first CAD model?",
    studioPath: "/?showMe=render-agent",
    steps: [
      { selector: "#btn-render-agent, #render-agent-fab", label: "Agent" },
    ],
  },
  "tips-tricks": {
    title: "Tips & tricks",
    example: "",
    studioPath: "/?showMe=tips-tricks",
    steps: [
      { selector: "#project-browser, .file-browser", label: "Project browser" },
    ],
  },
};

function ensureOverlay() {
  let el = document.getElementById("show-me-overlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "show-me-overlay";
  el.className = "show-me-overlay hidden";
  el.innerHTML = `
    <div class="show-me-card">
      <div class="show-me-card-top">
        <strong id="show-me-title">Show me</strong>
        <button type="button" class="show-me-close" aria-label="Close">&times;</button>
      </div>
      <p id="show-me-step" class="show-me-step"></p>
      <div class="show-me-actions">
        <button type="button" class="btn secondary btn-compact" id="show-me-skip">Skip</button>
        <button type="button" class="btn accent btn-compact" id="show-me-next">Next</button>
      </div>
    </div>
    <div class="show-me-spotlight" id="show-me-spotlight"></div>
  `;
  document.body.appendChild(el);
  el.querySelector(".show-me-close")?.addEventListener("click", stopShowMe);
  el.querySelector("#show-me-skip")?.addEventListener("click", () => advanceShowMe(true));
  el.querySelector("#show-me-next")?.addEventListener("click", () => advanceShowMe(false));
  return el;
}

let activeTour = null;
let stepIndex = 0;

function clearHighlight() {
  document.querySelectorAll(".show-me-target").forEach((n) => n.classList.remove("show-me-target"));
  const spot = document.getElementById("show-me-spotlight");
  if (spot) spot.style.cssText = "";
}

function stopShowMe() {
  clearHighlight();
  activeTour = null;
  stepIndex = 0;
  document.getElementById("show-me-overlay")?.classList.add("hidden");
}

function findFirst(selector) {
  for (const part of String(selector || "").split(",")) {
    const el = document.querySelector(part.trim());
    if (el) return el;
  }
  return null;
}

function highlight(el, label) {
  clearHighlight();
  if (!el) return;
  el.classList.add("show-me-target");
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  const rect = el.getBoundingClientRect();
  const spot = document.getElementById("show-me-spotlight");
  if (spot) {
    spot.style.left = `${Math.max(8, rect.left - 8)}px`;
    spot.style.top = `${Math.max(8, rect.top - 8)}px`;
    spot.style.width = `${rect.width + 16}px`;
    spot.style.height = `${rect.height + 16}px`;
  }
  const stepEl = document.getElementById("show-me-step");
  if (stepEl) stepEl.textContent = label || "Look here";
}

function fillExample(example) {
  if (!example) return;
  const editor = document.querySelector(".prompt-editor, #prompt-input, textarea#prompt-input");
  if (editor) {
    if ("value" in editor) editor.value = example;
    else editor.textContent = example;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus?.();
  }
  const agentInput = document.getElementById("render-agent-input");
  if (agentInput && /agent|render agent/i.test(activeTour?.title || "")) {
    agentInput.value = example;
    agentInput.focus();
  }
}

function clickIfSafe(el) {
  if (!el) return;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "button" || el.getAttribute("role") === "button" || el.classList.contains("nav-tab") || el.classList.contains("prompt-mode-btn")) {
    try {
      el.click();
    } catch {
      /* ignore */
    }
  }
}

function advanceShowMe(skipClick) {
  if (!activeTour) {
    stopShowMe();
    return;
  }
  const steps = activeTour.steps || [];
  if (stepIndex >= steps.length) {
    fillExample(activeTour.example);
    stopShowMe();
    return;
  }
  const step = steps[stepIndex];
  const el = findFirst(step.selector);
  highlight(el, `${stepIndex + 1}/${steps.length}: ${step.label}`);
  if (!skipClick) clickIfSafe(el);
  stepIndex += 1;
  if (stepIndex >= steps.length) {
    fillExample(activeTour.example);
    const nextBtn = document.getElementById("show-me-next");
    if (nextBtn) nextBtn.textContent = "Done";
  }
}

export function getShowMeTour(guideId) {
  return SHOW_ME_TOURS[guideId] || null;
}

export function startShowMe(guideId, { onDocsPage = false } = {}) {
  const tour = getShowMeTour(guideId);
  if (!tour) return false;

  if (onDocsPage) {
    // On Getting Started: highlight the feature card, then offer Studio deep-link.
    const card = document.getElementById(guideId);
    ensureOverlay();
    const overlay = document.getElementById("show-me-overlay");
    overlay?.classList.remove("hidden");
    document.getElementById("show-me-title").textContent = tour.title;
    if (card) {
      highlight(card, `${tour.title} — feature guide on this page`);
      document.getElementById("show-me-step").textContent =
        "This is the guide on Getting Started. Click Next to open Studio and walk through the UI.";
      document.getElementById("show-me-next").textContent = "Open Studio walkthrough";
      document.getElementById("show-me-next").onclick = () => {
        window.location.href = tour.studioPath || `/?showMe=${encodeURIComponent(guideId)}`;
      };
      document.getElementById("show-me-skip").onclick = stopShowMe;
      return true;
    }
  }

  ensureOverlay();
  document.getElementById("show-me-overlay")?.classList.remove("hidden");
  document.getElementById("show-me-title").textContent = tour.title;
  document.getElementById("show-me-next").textContent = "Next";
  document.getElementById("show-me-next").onclick = () => advanceShowMe(false);
  document.getElementById("show-me-skip").onclick = () => advanceShowMe(true);
  activeTour = tour;
  stepIndex = 0;
  advanceShowMe(false);
  return true;
}

export function maybeAutoStartShowMeFromQuery() {
  const id = new URLSearchParams(window.location.search).get("showMe");
  if (!id) return;
  const clean = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, "", clean || "/");
  setTimeout(() => startShowMe(id, { onDocsPage: false }), 600);
}
