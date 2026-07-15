/** Guided "Show me" tours for Getting Started + Studio. */

const SHOW_ME_TOURS = {
  "ai-generate": {
    title: "Generate CAD with AI",
    example: "80 x 40 x 12 mm phone stand with a 65° rear tilt and rounded edges",
    studioPath: "/?promptMode=v2&showMe=ai-generate",
    gif: "/docs/media/ai-generate.gif?v=20260715-real",
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
    gif: "/docs/media/workspaces.gif?v=20260715-real",
    steps: [
      { selector: "#btn-auth, .btn-auth, #workspace-picker, .workspace-mode-btn", label: "Account / workspace" },
    ],
  },
  "share-folders": {
    title: "Share folders",
    example: "",
    studioPath: "/?showMe=share-folders",
    gif: "/docs/media/share-folder.gif?v=20260715-real",
    steps: [
      { selector: "#project-browser, .browser-section, .file-browser", label: "Project browser" },
    ],
  },
  "reference-markup": {
    title: "Reference markup",
    example: "",
    studioPath: "/?showMe=reference-markup",
    gif: "/docs/media/reference-markup.gif?v=20260715-real",
    steps: [
      { selector: "#project-browser, .browser-section", label: "Project files" },
    ],
  },
  canvas: {
    title: "Canvas",
    example: "",
    studioPath: "/?showMe=canvas",
    gif: "/docs/media/canvas.gif?v=20260715-real",
    steps: [
      { selector: '[data-design-tab="canvas"], #design-tab-canvas, button[data-tab="canvas"]', label: "Canvas tab" },
    ],
  },
  picks: {
    title: "Geometry picks",
    example: "fillet @face-1 2 mm",
    studioPath: "/?showMe=picks",
    gif: "/docs/media/picks.gif?v=20260715-real",
    steps: [
      { selector: ".ribbon-pick, #pick-face-btn, [data-tool='pick-face']", label: "Pick tools" },
      { selector: "#prompt-input, .prompt-editor", label: "Prompt" },
    ],
  },
  wiring: {
    title: "Wiring Simulator",
    example: "Wire this enclosure for an ESP32, motor driver, and limit switches",
    studioPath: "/?designTab=WIRING&showMe=wiring",
    gif: "/docs/media/wiring.gif?v=20260715-real",
    steps: [
      { selector: '[data-design-tab="WIRING"], #design-tab-wiring, button[data-tab="WIRING"], .workspace-modes [data-mode="wiring"]', label: "Wiring tab" },
      { selector: "#project-browser, .browser-section, .file-browser, .browser-item", label: "Project browser — drag your 3D component" },
      { selector: "#wiring-prompt-input, #wiring-prompt-panel, .wiring-prompt-panel", label: "Wiring prompt — drop the component here" },
      { selector: "#wiring-workspace, #wiring-canvas, .wiring-canvas, .wiring-stage", label: "Or drop onto the wiring board for pins" },
    ],
  },
  "cloud-sync": {
    title: "Fusion / Onshape",
    example: "",
    studioPath: "/?showMe=cloud-sync",
    gif: "/docs/media/cloud-sync.gif?v=20260715-real",
    steps: [
      { selector: "#fusion-library, #onshape-library, .fusion-panel", label: "Cloud libraries" },
    ],
  },
  "render-agent": {
    title: "Render Agent",
    example: "How do I generate my first CAD model?",
    studioPath: "/?showMe=render-agent",
    gif: "/docs/media/render-agent.gif?v=20260715-real",
    steps: [
      { selector: "#btn-render-agent, #render-agent-fab", label: "Agent" },
    ],
  },
  "tips-tricks": {
    title: "Tips & tricks",
    example: "",
    studioPath: "/getting-started.html#tips-library",
    gif: null,
    steps: [
      { selector: "#tips-library, .gs-tips-section", label: "Tips & tricks library" },
    ],
  },
  "link-to-prompt": {
    title: "Link project items to the prompt",
    example: "Use @component-1 as the mating part and keep clearances at 0.3 mm",
    studioPath: "/?showMe=link-to-prompt",
    gif: "/docs/media/picks.gif?v=20260715-real",
    steps: [
      { selector: "#project-browser, .browser-section, .file-browser", label: "Project browser — select files" },
      { selector: "#prompt-input, .prompt-editor, #prompt-pane-compose", label: "AI prompt — drop files here" },
      { selector: ".ribbon-pick, #pick-face-btn, [data-tool='pick-face']", label: "Pick tools for @face / @edge / @path" },
    ],
  },
};

let activeTour = null;
let activeGuideId = null;
let stepIndex = 0;
/** @type {"studio" | "docs"} */
let overlayMode = "studio";
let overlayBound = false;

function ensureOverlay() {
  let el = document.getElementById("show-me-overlay");
  if (!el) {
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
      <div class="show-me-spotlight" id="show-me-spotlight" aria-hidden="true"></div>
    `;
    document.body.appendChild(el);
  }
  if (!overlayBound) {
    overlayBound = true;
    el.querySelector(".show-me-close")?.addEventListener("click", stopShowMe);
    el.querySelector("#show-me-skip")?.addEventListener("click", onSkipClick);
    el.querySelector("#show-me-next")?.addEventListener("click", onNextClick);
  }
  return el;
}

function clearHighlight() {
  document.querySelectorAll(".show-me-target").forEach((n) => n.classList.remove("show-me-target"));
  const spot = document.getElementById("show-me-spotlight");
  if (spot) spot.style.cssText = "";
}

function stopShowMe() {
  clearHighlight();
  activeTour = null;
  activeGuideId = null;
  stepIndex = 0;
  overlayMode = "studio";
  document.getElementById("show-me-overlay")?.classList.add("hidden");
}

function findFirst(selector) {
  for (const part of String(selector || "").split(",")) {
    const el = document.querySelector(part.trim());
    if (el && el.offsetParent !== null) return el;
  }
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
    spot.style.width = `${Math.max(24, rect.width + 16)}px`;
    spot.style.height = `${Math.max(24, rect.height + 16)}px`;
  }
  const stepEl = document.getElementById("show-me-step");
  if (stepEl) stepEl.textContent = label || "Look here";
}

function fillExample(example) {
  if (!example) return;
  const editor = document.querySelector(".prompt-editor, #prompt-input, textarea#prompt-input, #wiring-prompt-input");
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

function openDemoGif() {
  const tour = activeTour || getShowMeTour(activeGuideId);
  const card = activeGuideId ? document.getElementById(activeGuideId) : null;
  const fromCard = card?.querySelector("img[src*='.gif'], video source, img.gs-demo-gif");
  const url = fromCard?.getAttribute?.("src") || tour?.gif;
  if (url) {
    window.open(url, "_blank", "noopener");
  }
}

function onNextClick() {
  if (overlayMode === "docs") {
    const path = activeTour?.studioPath || `/?showMe=${encodeURIComponent(activeGuideId || "")}`;
    window.location.href = path;
    return;
  }
  advanceShowMe(false);
}

function onSkipClick() {
  if (overlayMode === "docs") {
    if (activeTour?.gif || document.getElementById(activeGuideId)?.querySelector("img[src*='.gif']")) {
      openDemoGif();
      return;
    }
    stopShowMe();
    return;
  }
  advanceShowMe(true);
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

  ensureOverlay();
  const overlay = document.getElementById("show-me-overlay");
  const nextBtn = document.getElementById("show-me-next");
  const skipBtn = document.getElementById("show-me-skip");
  activeTour = tour;
  activeGuideId = guideId;
  stepIndex = 0;
  overlay?.classList.remove("hidden");
  document.getElementById("show-me-title").textContent = tour.title;

  if (onDocsPage) {
    overlayMode = "docs";
    const card = document.getElementById(guideId);
    if (card) {
      highlight(card, `${tour.title} — guide on this page`);
    } else {
      clearHighlight();
    }
    document.getElementById("show-me-step").textContent =
      "Use Open Studio for a live UI walkthrough, or Watch demo GIF for the looping preview.";
    if (nextBtn) nextBtn.textContent = "Open Studio walkthrough";
    if (skipBtn) skipBtn.textContent = tour.gif ? "Watch demo GIF" : "Close";
    return true;
  }

  overlayMode = "studio";
  if (nextBtn) nextBtn.textContent = "Next";
  if (skipBtn) skipBtn.textContent = "Skip";
  advanceShowMe(false);
  return true;
}

export function maybeAutoStartShowMeFromQuery() {
  const id = new URLSearchParams(window.location.search).get("showMe");
  if (!id) return;
  const clean = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, "", clean || "/");
  setTimeout(() => startShowMe(id, { onDocsPage: false }), 700);
}
