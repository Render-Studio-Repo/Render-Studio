/** Guided "Show me" tours for Getting Started + Studio. */

/** Tours that click the 3D viewport always seed the Robot Arm demo project. */
const ROBOT_ARM_DEMO_TOURS = new Set(["picks", "select-object", "solid-tools", "link-to-prompt"]);

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
      {
        selector: '[data-design-tab="CANVAS"], #workspace-mode-btn',
        label: "Click Canvas tab",
        click: true,
        matchText: "CANVAS",
      },
    ],
  },
  "select-object": {
    title: "Select object & body",
    example: "",
    studioPath: "/?showMe=select-object",
    gif: "/docs/media/select-object.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: "#btn-pick-object, .mobile-tool-btn[data-pick='object'], button[data-mode='object']",
        label: "Click Select (object pick)",
        click: true,
        reveal: "mobile-tools",
      },
      {
        viewport: "click",
        label: "Click the robot arm to select the whole model",
        click: true,
        fraction: [0.52, 0.42],
      },
      {
        viewport: "dblclick",
        label: "Double-click a link to select just that body/part",
        click: true,
        fraction: [0.58, 0.36],
      },
    ],
  },
  picks: {
    title: "Geometry picks",
    example: "fillet @face-1 2 mm",
    studioPath: "/?showMe=picks",
    gif: "/docs/media/picks.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: "#btn-pick-face, .mobile-tool-btn[data-pick='face'], button[data-pick='face']",
        label: "Click Face pick",
        click: true,
        reveal: "mobile-tools",
      },
      {
        viewport: "click",
        label: "Click a face on the robot arm",
        click: true,
        fraction: [0.52, 0.40],
      },
      {
        selector: "#prompt-input, .prompt-editor, [data-mobile-corner='ai']",
        label: "@face chips land in the prompt",
        click: false,
        reveal: "mobile-ai",
      },
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
    gif: "/docs/media/picks.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: "#project-browser, .browser-section, .file-browser, [data-mobile-corner='workspace']",
        label: "Select files in Project browser",
        click: false,
      },
      {
        selector: "#prompt-input, .prompt-editor, #prompt-pane-compose, [data-mobile-corner='ai']",
        label: "Drop them into the AI prompt",
        click: false,
        reveal: "mobile-ai",
      },
      {
        selector: "#btn-pick-face, .mobile-tool-btn[data-pick='face'], button[data-pick='face']",
        label: "Or click Face pick for @face chips",
        click: true,
        reveal: "mobile-tools",
      },
      {
        viewport: "click",
        label: "Click a face on the robot arm",
        click: true,
        fraction: [0.52, 0.42],
      },
    ],
  },
  "solid-tools": {
    title: "Solid modeling tools",
    example: "",
    studioPath: "/?showMe=solid-tools",
    gif: "/docs/media/select-object.gif?v=20260715-robot-arm",
    needsRobotArm: true,
    steps: [
      {
        selector: '[data-design-tab="SOLID"], .workspace-tab',
        label: "Stay on SOLID",
        click: true,
        matchText: "SOLID",
      },
      {
        selector: "#btn-pick-object, button[data-mode='object']",
        label: "Select tool — click whole model, double-click a part",
        click: true,
      },
      {
        viewport: "click",
        label: "Click the robot arm (whole object)",
        click: true,
        fraction: [0.52, 0.42],
      },
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

function isOnScreen(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest?.(".hidden")) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  if (rect.bottom < 8 || rect.right < 8) return false;
  if (rect.top > window.innerHeight - 8 || rect.left > window.innerWidth - 8) return false;
  return true;
}

function findFirst(selector, matchText) {
  const needle = String(matchText || "").trim().toLowerCase();
  const parts = String(selector || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    const nodes = Array.from(document.querySelectorAll(part));
    for (const el of nodes) {
      if (!isOnScreen(el)) continue;
      if (needle) {
        const text = `${el.textContent || ""} ${el.getAttribute("title") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
        if (!text.includes(needle)) continue;
      }
      return el;
    }
  }
  return null;
}

function isNarrowViewport() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function ensureWorkspaceMenuOpen() {
  const menu = document.getElementById("workspace-mode-menu");
  if (!menu || !menu.classList.contains("hidden")) return;
  const btn = document.getElementById("workspace-mode-btn");
  if (btn && isOnScreen(btn)) btn.click();
}

function openMobileSheet(sheetId) {
  if (!isNarrowViewport()) return;
  const sheet = document.getElementById(sheetId);
  if (!sheet) return;
  document.querySelectorAll(".mobile-sheet.mobile-open, .sidebar.mobile-open").forEach((n) => {
    n.classList.remove("mobile-open");
  });
  sheet.classList.add("mobile-open");
  sheet.setAttribute("aria-hidden", "false");
  document.getElementById("mobile-backdrop")?.classList.remove("hidden");
  document.body.classList.add("mobile-sheet-open");
}

function ensureReveal(kind) {
  if (!kind) return;
  if (kind === "mobile-tools") openMobileSheet("mobile-tools-sheet");
  if (kind === "mobile-ai") {
    if (isNarrowViewport()) {
      const aiBtn = document.querySelector("[data-mobile-corner='ai']");
      if (aiBtn && isOnScreen(aiBtn)) aiBtn.click();
      else {
        document.querySelector(".sidebar.right")?.classList.add("mobile-open");
        document.getElementById("mobile-backdrop")?.classList.remove("hidden");
        document.body.classList.add("mobile-sheet-open");
      }
    }
  }
}

function placeCircle(el) {
  const circle = document.getElementById("show-me-circle");
  const click = document.getElementById("show-me-click");
  const dim = document.getElementById("show-me-dim");
  if (!circle || !click) return;
  if (!el || !isOnScreen(el)) {
    circle.classList.remove("is-on");
    click.classList.remove("is-on", "is-press");
    if (dim) {
      dim.style.opacity = "0.5";
      dim.style.background = "rgba(1, 4, 9, 0.55)";
    }
    return;
  }
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const diameter = Math.max(56, Math.min(180, Math.max(rect.width, rect.height) + 40));
  const radius = diameter / 2;
  circle.style.width = `${diameter}px`;
  circle.style.height = `${diameter}px`;
  circle.style.left = `${cx - radius}px`;
  circle.style.top = `${cy - radius}px`;
  circle.classList.add("is-on");
  if (dim) {
    dim.style.opacity = "1";
    // Soft blue wash in the hole so the target reads clearly against the dim.
    dim.style.background =
      `radial-gradient(circle at ${cx}px ${cy}px,` +
      ` rgba(126, 200, 255, 0.2) 0px,` +
      ` rgba(126, 200, 255, 0.06) ${Math.max(16, radius - 10)}px,` +
      ` transparent ${Math.max(20, radius - 2)}px,` +
      ` rgba(1, 4, 9, 0.72) ${radius + 4}px)`;
  }
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

function getViewportEl() {
  return (
    document.querySelector("#viewport canvas")
    || document.querySelector("#viewport")
    || document.querySelector("canvas.viewport-canvas")
    || document.querySelector("main canvas")
    || document.querySelector("canvas")
  );
}

function viewportPoint(step) {
  const el = getViewportEl();
  if (!el || !isOnScreen(el)) return null;
  const rect = el.getBoundingClientRect();
  const [fx, fy] = Array.isArray(step.fraction) ? step.fraction : [0.52, 0.42];
  return {
    el,
    x: rect.left + rect.width * Math.min(0.9, Math.max(0.1, Number(fx) || 0.5)),
    y: rect.top + rect.height * Math.min(0.9, Math.max(0.1, Number(fy) || 0.5)),
  };
}

function placeCircleAt(x, y, diameter = 96) {
  const circle = document.getElementById("show-me-circle");
  const click = document.getElementById("show-me-click");
  const dim = document.getElementById("show-me-dim");
  if (!circle || !click) return;
  const radius = diameter / 2;
  circle.style.width = `${diameter}px`;
  circle.style.height = `${diameter}px`;
  circle.style.left = `${x - radius}px`;
  circle.style.top = `${y - radius}px`;
  circle.classList.add("is-on");
  if (dim) {
    dim.style.opacity = "1";
    dim.style.background =
      `radial-gradient(circle at ${x}px ${y}px,` +
      ` rgba(126, 200, 255, 0.2) 0px,` +
      ` rgba(126, 200, 255, 0.06) ${Math.max(16, radius - 10)}px,` +
      ` transparent ${Math.max(20, radius - 2)}px,` +
      ` rgba(1, 4, 9, 0.72) ${radius + 4}px)`;
  }
  click.style.left = `${x}px`;
  click.style.top = `${y}px`;
  click.classList.add("is-on");
}

function simulatePointerAt(x, y, { dbl = false } = {}) {
  const el = document.elementFromPoint(x, y) || getViewportEl();
  if (!el) return false;
  const marker = document.getElementById("show-me-click");
  marker?.classList.remove("is-press");
  void marker?.offsetWidth;
  marker?.classList.add("is-press");
  const common = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
  try {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", common));
    el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", common));
    el.dispatchEvent(new MouseEvent("click", common));
    if (dbl) {
      el.dispatchEvent(new MouseEvent("mousedown", common));
      el.dispatchEvent(new MouseEvent("mouseup", common));
      el.dispatchEvent(new MouseEvent("click", common));
      el.dispatchEvent(new MouseEvent("dblclick", common));
    }
    return true;
  } catch {
    return false;
  }
}

function authToken() {
  try {
    return localStorage.getItem("render3d:token") || "";
  } catch {
    return "";
  }
}

async function seedRobotArmProject() {
  const token = authToken();
  if (!token) return null;
  const res = await fetch("/api/demo/robot-arm", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Could not seed robot arm (${res.status})`);
  }
  return res.json();
}

async function ensureRobotArmForTour(guideId) {
  const tour = getShowMeTour(guideId);
  if (!tour?.needsRobotArm && !ROBOT_ARM_DEMO_TOURS.has(guideId)) return true;
  const stepEl = document.getElementById("show-me-step");
  if (stepEl) stepEl.textContent = "Opening your private Robot Arm project…";
  try {
    const seeded = await seedRobotArmProject();
    const pid = seeded?.project_id;
    if (!pid) return true;
    try {
      localStorage.setItem("render3d:lastProjectId", pid);
      localStorage.setItem("render3d:demoRobotArmProjectId", pid);
    } catch {
      /* ignore */
    }
    if (typeof window.__openProject === "function") {
      await window.__openProject(pid);
      // Give the mesh a moment to appear before viewport clicks.
      await new Promise((r) => setTimeout(r, 1200));
    } else {
      const params = new URLSearchParams(window.location.search);
      params.set("project", pid);
      params.set("showMe", guideId);
      window.location.href = `/?${params.toString()}`;
      return false;
    }
  } catch (err) {
    console.warn("Robot arm demo seed failed:", err);
    if (stepEl) stepEl.textContent = "Could not open Robot Arm demo — continuing with current project.";
  }
  return true;
}

function resolveStepTarget(step) {
  if (step.ensureMenu) ensureWorkspaceMenuOpen();
  if (step.reveal) ensureReveal(step.reveal);
  if (step.viewport) return getViewportEl();
  return findFirst(step.selector, step.matchText);
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
  const n = stepIndex + 1;
  resolveStepTarget(step);
  setTimeout(() => {
    if (!activeTour) return;
    if (step.ensureMenu) ensureWorkspaceMenuOpen();
    if (step.reveal) ensureReveal(step.reveal);

    if (step.viewport) {
      const pt = viewportPoint(step);
      const stepEl = document.getElementById("show-me-step");
      if (stepEl) stepEl.textContent = `${n}/${steps.length}: ${step.label}`;
      clearHighlight();
      if (pt) {
        placeCircleAt(pt.x, pt.y, 110);
        if (!skipClick && step.click !== false) {
          setTimeout(() => {
            if (!activeTour) return;
            simulatePointerAt(pt.x, pt.y, { dbl: step.viewport === "dblclick" });
          }, 320);
        }
      }
      return;
    }

    const el = findFirst(step.selector, step.matchText);
    highlight(el, `${n}/${steps.length}: ${step.label}`);
    const shouldClick = !skipClick && step.click !== false && el && (isClickable(el) || step.click === true);
    if (shouldClick) {
      setTimeout(() => {
        if (!activeTour) return;
        simulateClick(el);
      }, 280);
    }
  }, step.reveal || step.ensureMenu ? 180 : 0);
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
      tour.needsRobotArm || ROBOT_ARM_DEMO_TOURS.has(guideId)
        ? "Open Studio — we'll spin up a private Robot Arm project for the live click-through."
        : "Open Studio for a live click-through, or watch the demo GIF.";
    if (nextBtn) nextBtn.textContent = "Open Studio walkthrough";
    if (skipBtn) skipBtn.textContent = tour.gif ? "Watch demo GIF" : "Close";
    return true;
  }

  overlayMode = "studio";
  if (skipBtn) skipBtn.textContent = "Skip step";
  syncNextLabel();
  void (async () => {
    const ready = await ensureRobotArmForTour(guideId);
    if (!ready || !activeTour) return;
    advanceShowMe(false);
  })();
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
  const delay = ROBOT_ARM_DEMO_TOURS.has(id) ? 1400 : 900;
  setTimeout(() => startShowMe(id, { onDocsPage: false }), delay);
}
