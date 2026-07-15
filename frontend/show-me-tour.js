/** Guided "Show me" tours for Getting Started + Studio. */

const SHOW_ME_TOURS = {
  "ai-generate": {
    title: "Generate CAD with AI",
    example: "80 x 40 x 12 mm phone stand with a 65° rear tilt and rounded edges",
    studioPath: "/?promptMode=v2&showMe=ai-generate",
    gif: "/docs/media/ai-generate.gif?v=20260715-real",
    steps: [
      { selector: "#prompt-pane-compose, .prompt-compose-toolbar, #prompt-input, .prompt-editor", label: "Open the AI CAD prompt", click: false },
      { selector: '[data-prompt-mode="v2"], .prompt-mode-btn--v2', label: "Click 2.0 mode", click: true },
      { selector: "#btn-prompt, #prompt-generate, #btn-generate", label: "Generate button (highlight only)", click: false },
    ],
  },
  workspaces: {
    title: "Workspaces",
    example: "",
    studioPath: "/?showMe=workspaces",
    gif: "/docs/media/workspaces.gif?v=20260715-real",
    steps: [
      { selector: "#btn-auth, .btn-auth", label: "Click Account", click: true },
    ],
  },
  "share-folders": {
    title: "Share folders",
    example: "",
    studioPath: "/?showMe=share-folders",
    gif: "/docs/media/share-folder.gif?v=20260715-real",
    steps: [
      { selector: "#project-browser, .browser-section, .file-browser", label: "Project browser — folders live here", click: false },
    ],
  },
  "reference-markup": {
    title: "Reference markup",
    example: "",
    studioPath: "/?showMe=reference-markup",
    gif: "/docs/media/reference-markup.gif?v=20260715-real",
    steps: [
      { selector: "#project-browser, .browser-section", label: "Open a PDF/image from Project files", click: false },
    ],
  },
  canvas: {
    title: "Canvas",
    example: "",
    studioPath: "/?showMe=canvas",
    gif: "/docs/media/canvas.gif?v=20260715-real",
    steps: [
      { selector: '[data-design-tab="CANVAS"]', label: "Click Canvas tab", click: true },
    ],
  },
  picks: {
    title: "Geometry picks",
    example: "fillet @face-1 2 mm",
    studioPath: "/?showMe=picks",
    gif: "/docs/media/picks.gif?v=20260715-real",
    steps: [
      { selector: "#btn-pick-face", label: "Click Face pick", click: true },
      { selector: "#prompt-input, .prompt-editor", label: "@face chips land in the prompt", click: false },
    ],
  },
  wiring: {
    title: "Wiring Simulator",
    example: "Wire this enclosure for an ESP32, motor driver, and limit switches",
    studioPath: "/?designTab=WIRING&showMe=wiring",
    gif: "/docs/media/wiring.gif?v=20260715-real",
    steps: [
      { selector: "#workspace-mode-btn", label: "Open workspace modes", click: true },
      {
        selector: "#workspace-mode-menu .workspace-mode-option",
        matchText: "Wiring",
        label: "Click Wiring Simulator",
        click: true,
        ensureMenu: true,
      },
      { selector: "#project-browser, .browser-section, .file-browser", label: "Drag a 3D component from here", click: false },
      { selector: "#wiring-prompt-input, #wiring-prompt-panel, .wiring-prompt-panel", label: "Drop it into the Wiring prompt", click: false },
      { selector: "#wiring-workspace, #wiring-canvas, .wiring-canvas, .wiring-stage", label: "Or drop onto the wiring board", click: false },
    ],
  },
  "cloud-sync": {
    title: "Fusion / Onshape",
    example: "",
    studioPath: "/?showMe=cloud-sync",
    gif: "/docs/media/cloud-sync.gif?v=20260715-real",
    steps: [
      { selector: "#fusion-library-section, #fusion-library, .fusion-library-section", label: "Open Fusion library", click: true },
    ],
  },
  "render-agent": {
    title: "Render Agent",
    example: "How do I generate my first CAD model?",
    studioPath: "/?showMe=render-agent",
    gif: "/docs/media/render-agent.gif?v=20260715-real",
    steps: [
      { selector: "#btn-render-agent, #render-agent-fab, .render-agent-fab", label: "Click Agent", click: true },
    ],
  },
  "tips-tricks": {
    title: "Tips & tricks",
    example: "",
    studioPath: "/getting-started.html#tips-library",
    gif: null,
    steps: [
      { selector: "#tips-library, .gs-tips-section", label: "Tips & tricks library", click: false },
    ],
  },
  "link-to-prompt": {
    title: "Link project items to the prompt",
    example: "Use @component-1 as the mating part and keep clearances at 0.3 mm",
    studioPath: "/?showMe=link-to-prompt",
    gif: "/docs/media/picks.gif?v=20260715-real",
    steps: [
      { selector: "#project-browser, .browser-section, .file-browser", label: "Select files in Project browser", click: false },
      { selector: "#prompt-input, .prompt-editor, #prompt-pane-compose", label: "Drop them into the AI prompt", click: false },
      { selector: "#btn-pick-face", label: "Or click Face pick for @face chips", click: true },
    ],
  },
};

let activeTour = null;
let activeGuideId = null;
let stepIndex = 0;
/** @type {"studio" | "docs"} */
let overlayMode = "studio";
let overlayBound = false;
let resizeHandler = null;

function ensureOverlay() {
  let el = document.getElementById("show-me-overlay");
  if (el && !el.querySelector("#show-me-circle")) {
    el.remove();
    el = null;
    overlayBound = false;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "show-me-overlay";
    el.className = "show-me-overlay hidden";
    el.innerHTML = `
      <div class="show-me-dim" id="show-me-dim" aria-hidden="true"></div>
      <div class="show-me-circle" id="show-me-circle" aria-hidden="true"></div>
      <div class="show-me-click" id="show-me-click" aria-hidden="true">
        <span class="show-me-click-ring"></span>
        <span class="show-me-click-dot"></span>
      </div>
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
  const circle = document.getElementById("show-me-circle");
  const click = document.getElementById("show-me-click");
  const dim = document.getElementById("show-me-dim");
  if (circle) {
    circle.classList.remove("is-on");
    circle.style.cssText = "";
  }
  if (click) {
    click.classList.remove("is-on", "is-press");
    click.style.cssText = "";
  }
  if (dim) dim.style.opacity = "";
}

function stopShowMe() {
  clearHighlight();
  activeTour = null;
  activeGuideId = null;
  stepIndex = 0;
  overlayMode = "studio";
  document.getElementById("show-me-overlay")?.classList.add("hidden");
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
}

function findFirst(selector, matchText) {
  const needle = String(matchText || "").trim().toLowerCase();
  const parts = String(selector || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const tryList = (visibleOnly) => {
    for (const part of parts) {
      const nodes = Array.from(document.querySelectorAll(part));
      for (const el of nodes) {
        if (visibleOnly && !el.getClientRects().length) continue;
        if (el.closest?.(".hidden")) continue;
        if (needle) {
          const text = `${el.textContent || ""} ${el.getAttribute("title") || ""}`.toLowerCase();
          if (!text.includes(needle)) continue;
        }
        return el;
      }
    }
    return null;
  };

  return tryList(true) || tryList(false);
}

function ensureWorkspaceMenuOpen() {
  const menu = document.getElementById("workspace-mode-menu");
  if (!menu || !menu.classList.contains("hidden")) return;
  const btn = document.getElementById("workspace-mode-btn");
  if (btn) btn.click();
}

function placeCircle(el) {
  const circle = document.getElementById("show-me-circle");
  const click = document.getElementById("show-me-click");
  const dim = document.getElementById("show-me-dim");
  if (!el || !circle || !click) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const diameter = Math.max(48, Math.min(180, Math.max(rect.width, rect.height) + 36));
  circle.style.width = `${diameter}px`;
  circle.style.height = `${diameter}px`;
  circle.style.left = `${cx - diameter / 2}px`;
  circle.style.top = `${cy - diameter / 2}px`;
  circle.classList.add("is-on");
  // Hole is cut by the circle's box-shadow; keep base dim subtle when circle is on.
  if (dim) dim.style.opacity = "0";
  click.style.left = `${cx}px`;
  click.style.top = `${cy}px`;
  click.classList.add("is-on");
}

function highlight(el, label) {
  clearHighlight();
  const stepEl = document.getElementById("show-me-step");
  if (stepEl) stepEl.textContent = label || "Look here";
  if (!el) {
    const dim = document.getElementById("show-me-dim");
    if (dim) dim.style.opacity = "1";
    return;
  }
  el.classList.add("show-me-target");
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch {
    /* ignore */
  }
  requestAnimationFrame(() => {
    placeCircle(el);
    setTimeout(() => placeCircle(el), 220);
  });
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

function isClickable(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "button" || tag === "a" || tag === "summary") return true;
  if (el.getAttribute("role") === "button" || el.getAttribute("role") === "tab") return true;
  if (el.classList.contains("nav-tab") || el.classList.contains("prompt-mode-btn")) return true;
  if (el.classList.contains("workspace-tab") || el.classList.contains("workspace-mode-btn")) return true;
  if (el.classList.contains("workspace-mode-option") || el.classList.contains("pick-btn")) return true;
  if (el.hasAttribute("data-design-tab") || el.hasAttribute("data-prompt-mode") || el.hasAttribute("data-mode")) return true;
  if (el.hasAttribute("data-tab") || el.hasAttribute("data-tool") || el.hasAttribute("data-panel")) return true;
  return typeof el.onclick === "function";
}

function simulateClick(el) {
  if (!el) return false;
  const marker = document.getElementById("show-me-click");
  marker?.classList.remove("is-press");
  void marker?.offsetWidth;
  marker?.classList.add("is-press");
  try {
    // Prefer native click so listeners that call stopPropagation (workspace menu) work.
    if (typeof el.click === "function") {
      el.click();
      return true;
    }
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  } catch {
    return false;
  }
}

function openDemoGif() {
  const tour = activeTour || getShowMeTour(activeGuideId);
  const card = activeGuideId ? document.getElementById(activeGuideId) : null;
  const fromCard = card?.querySelector("img[src*='.gif'], video source, img.gs-demo-gif");
  const url = fromCard?.getAttribute?.("src") || tour?.gif;
  if (url) window.open(url, "_blank", "noopener");
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

function syncNextLabel() {
  const nextBtn = document.getElementById("show-me-next");
  if (!nextBtn || !activeTour) return;
  const steps = activeTour.steps || [];
  if (stepIndex >= steps.length) nextBtn.textContent = "Done";
  else nextBtn.textContent = `Next (${stepIndex + 1}/${steps.length})`;
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
  if (step.ensureMenu) ensureWorkspaceMenuOpen();
  const el = findFirst(step.selector, step.matchText);
  const n = stepIndex + 1;
  highlight(el, `${n}/${steps.length}: ${step.label}`);
  const shouldClick = !skipClick && step.click !== false && (isClickable(el) || step.click === true);
  if (shouldClick && el) {
    setTimeout(() => {
      if (step.ensureMenu) ensureWorkspaceMenuOpen();
      simulateClick(el);
    }, 320);
  }
  stepIndex += 1;
  syncNextLabel();
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

  if (!resizeHandler) {
    resizeHandler = () => {
      const target = document.querySelector(".show-me-target");
      if (target) placeCircle(target);
    };
    window.addEventListener("resize", resizeHandler);
  }

  if (onDocsPage) {
    overlayMode = "docs";
    const card = document.getElementById(guideId);
    if (card) highlight(card, `${tour.title} — guide on this page`);
    else clearHighlight();
    document.getElementById("show-me-step").textContent =
      "Open Studio for a live click-through, or watch the demo GIF.";
    if (nextBtn) nextBtn.textContent = "Open Studio walkthrough";
    if (skipBtn) skipBtn.textContent = tour.gif ? "Watch demo GIF" : "Close";
    return true;
  }

  overlayMode = "studio";
  if (skipBtn) skipBtn.textContent = "Skip step";
  syncNextLabel();
  advanceShowMe(false);
  return true;
}

export function maybeAutoStartShowMeFromQuery() {
  const id = new URLSearchParams(window.location.search).get("showMe");
  if (!id) return;
  const params = new URLSearchParams(window.location.search);
  params.delete("showMe");
  const qs = params.toString();
  const clean = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", clean || "/");
  setTimeout(() => startShowMe(id, { onDocsPage: false }), 900);
}
