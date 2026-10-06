/** Studio overlay: Chat / Files / Examples. Token sandbox1. No extra WebGL. */
import { SANDBOX1_TOKEN } from "./tts-mutex.js?v=sandbox1&singlevoice1";
import { createXrLiveControlClient, XRCTRL2_CACHE } from "./xr-control-live.js?v=xrctrl2&sbfix=20260917-2";
import { paintSandboxPitchFile } from "./pitch-deck.js?v=mktpitch1";
import { createVrReferenceCapture } from "./vr-reference-capture.js?v=workspace3-ctxlog1";
import {
  startChangeSession,
  endChangeSession,
  isSessionActive,
  MAP1_TOKEN,
} from "./change-map.js?v=map1";
import { installSandboxVoiceBridge, VOICEMAP1_TOKEN } from "./voice-step-log.js?v=20260923-draw-recordings1&singlevoice1&vrrobot=20260927-2";
import {
  bindRepairPromptButtons,
  ensureRepairPromptButton,
  isRepairTableOpen,
  setRepairTableOpen,
  REPAIR1_TOKEN,
} from "./repair-table.js?v=repair1";
import { paintRepairPanel, runRepairLoop } from "./repair-loop.js?v=20260923-draw-recordings1&vrrobot=20260927-2";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "files", label: "Files" },
  { id: "examples", label: "Code examples" },
];

const OPENARM_VERSION = "2.0";

let lastRev = "";
let openPath = "examples/agenda-20260917.md";
let pollTimer = 0;
let liveClient = null;
let vrCapture = null;
function ensureCapture() {
  if (!vrCapture) vrCapture = createVrReferenceCapture({
    onStatus(message) {
      const status = document.getElementById("sb1-capture-status");
      if (status) status.textContent = message;
    },
  });
  return vrCapture;
}

function applyLiveDoc(doc) {
  try { globalThis.Render3DXrControls?.applyLive?.(doc); } catch { /* optional XR */ }
  const sim = document.getElementById("sb1-sim-ctrl");
  const lis = document.getElementById("sb1-listen-ctrl");
  if (sim) sim.setAttribute("aria-pressed", doc?.simulate ? "true" : "false");
  if (lis) lis.setAttribute("aria-pressed", doc?.listen ? "true" : "false");
  const status = document.getElementById("sb1-live");
  if (status && doc?.rev) status.textContent = `Live controls · rev ${doc.rev} · ${XRCTRL2_CACHE}`;
}

function ensureLiveClient() {
  if (liveClient) return liveClient;
  liveClient = createXrLiveControlClient({ applyDoc: applyLiveDoc });
  return liveClient;
}

function paintFile(kind, path, text, bytesB64) {
  const view = document.getElementById("sb1-file-view");
  if (!view) return;
  const title = document.getElementById("sb1-file-title");
  if (title) title.textContent = path || "(none)";
  if (paintSandboxPitchFile(view, path, text, bytesB64)) return;
  if (kind === "pdf" && bytesB64) {
    view.innerHTML = `<iframe class="sb1-doc" title="${esc(path)}" src="data:application/pdf;base64,${bytesB64}"></iframe>`;
    return;
  }
  if (kind === "md" || kind === "code" || kind === "text") {
    view.innerHTML = `<textarea class="sb1-code" readonly spellcheck="false">${esc(text || "")}</textarea>`;
    return;
  }
  view.innerHTML = `<pre class="sb1-code">${esc(text || "")}</pre>`;
}

export async function loadSandboxFile(path) {
  const rel = String(path || "").replace(/^frontend\/sandbox\//, "").replace(/^\//, "");
  if (!rel) return;
  openPath = rel;
  const res = await fetch("/mcp/sandbox/file?path=" + encodeURIComponent(rel) + "&t=" + Date.now()).catch(() => null);
  if (!res || !res.ok) {
    paintFile("text", rel, "Could not load " + rel + " (MCP sandbox jail).");
    return;
  }
  const data = await res.json();
  paintFile(data.kind || "text", data.path || rel, data.text || "", data.b64 || "");
}

async function listSandboxFiles() {
  const box = document.getElementById("sb1-file-list");
  if (!box) return;
  const res = await fetch("/mcp/sandbox?action=list&t=" + Date.now()).catch(() => null);
  const data = res && res.ok ? await res.json() : { files: [] };
  const files = data.files || [];
  box.innerHTML = files.map((f) => {
    const p = f.path || f;
    return `<button type="button" class="sb1-file" data-path="${esc(p)}">${esc(p)}</button>`;
  }).join("") || `<p class="muted small">No sandbox files yet.</p>`;
  box.querySelectorAll("[data-path]").forEach((btn) => {
    btn.addEventListener("click", () => loadSandboxFile(btn.getAttribute("data-path")));
  });
}

async function pollRev() {
  const res = await fetch("/mcp/sandbox/rev?t=" + Date.now()).catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  const rev = String(data.rev || "");
  if (!rev) return;
  if (!lastRev) {
    lastRev = rev;
    return;
  }
  if (rev === lastRev) return;
  lastRev = rev;
  const iframe = document.getElementById("sb1-chat-frame");
  if (iframe) iframe.src = "/sandbox/team-chat.html?v=" + encodeURIComponent(rev);
  await listSandboxFiles();
  await loadSandboxFile(openPath);
  const status = document.getElementById("sb1-live");
  if (status) status.textContent = "Live edit · rev " + rev.slice(-10);
}

function setTab(id) {
  const win = document.getElementById("sb1-window");
  if (!win) return;
  win.dataset.tab = id;
  win.querySelectorAll("[data-sb1-tab]").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.getAttribute("data-sb1-tab") === id ? "true" : "false");
  });
  win.querySelectorAll("[data-sb1-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-sb1-panel") !== id;
  });
}

export function isSandboxOpen() {
  return document.getElementById("sb1-window")?.classList.contains("is-open") === true;
}

export function setSandboxOpen(on) {
  ensureSandboxWindow();
  installSandboxVoiceBridge();
  const win = document.getElementById("sb1-window");
  if (!win) return { visible: false, token: SANDBOX1_TOKEN };
  const wasOpen = win.classList.contains("is-open");
  win.classList.toggle("is-open", !!on);
  const shown = win.classList.contains("is-open");
  document.querySelectorAll("#btn-sandbox, #btn-sandbox-gen, [data-sandbox-toggle]").forEach((el) => {
    el.setAttribute("aria-pressed", shown ? "true" : "false");
    el.classList.toggle("is-active", shown);
  });
  if (shown) {
    // Sandbox XOR Repair — only one can be up.
    if (isRepairTableOpen()) {
      setRepairTableOpen(false);
      const panel = document.getElementById("sb-page-repair");
      if (panel) panel.hidden = true;
      document.querySelector("[data-sb-repair]")?.setAttribute("aria-pressed", "false");
    }
    listSandboxFiles();
    loadSandboxFile(openPath);
    if (!pollTimer) pollTimer = setInterval(pollRev, 2500);
    pollRev();
    ensureLiveClient().start();
    if (!wasOpen || !isSessionActive()) {
      startChangeSession({ reason: "sandbox_on", openArm: OPENARM_VERSION });
    }
  } else {
    if (wasOpen && isSessionActive()) {
      void import("./sandbox-remix.js?v=remix1").then(({ exitSandboxSaveRemix }) =>
        exitSandboxSaveRemix({ reverseMapped: false }).then((summary) => {
          const status = document.getElementById("sb1-live");
          if (status && summary?.ok) {
            const safe = summary.health?.safe_to_merge ? "safe to merge (Approve still required)" : "NOT safe to merge";
            status.textContent = `Remix blueprint saved · health ${safe} · OpenArm ${OPENARM_VERSION}`;
          }
        }),
      ).catch(() =>
        endChangeSession({ reverse: false, systemCheck: true }).then((summary) => {
          const status = document.getElementById("sb1-live");
          if (status && summary?.ok) {
            status.textContent = `Session closed · system check posted · OpenArm ${OPENARM_VERSION}`;
          }
        }),
      );
    }
    restoreProductionUi();
    ensureCapture().stop();
    const record = document.getElementById("sb1-record-ctrl");
    record?.setAttribute("aria-pressed", "false");
  }
  try {
    window.dispatchEvent(new CustomEvent("render3d-sandbox-toggle", {
      detail: { open: shown, token: "sandbox4", mapToken: MAP1_TOKEN, openArm: OPENARM_VERSION },
    }));
    globalThis.Render3DSandboxShapes?.setVisible?.(shown);
  } catch { /* viewport optional */ }
  if (shown) {
    fetch("/mcp/sandbox/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: `Sandbox enabled — OpenArm ${OPENARM_VERSION} map on, production CAD stays`,
        kind: "sandbox",
        post: true,
      }),
    }).catch(() => null);
  }
  return { visible: shown, token: SANDBOX1_TOKEN, mapToken: MAP1_TOKEN, openArm: OPENARM_VERSION };
}

function restoreProductionUi() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = 0;
  }
  const client = ensureLiveClient();
  void client.patch({ simulate: false, listen: false }).finally(() => {
    client.stop();
  });
  try { globalThis.Render3DXrControls?.simulate?.(false); } catch { /* optional XR */ }
}

export function toggleSandboxWindow() {
  return setSandboxOpen(!isSandboxOpen());
}

function makeSandboxButton(id) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = id;
  btn.dataset.sandboxToggle = "1";
  btn.setAttribute("aria-pressed", "false");
  btn.textContent = "Sandbox";
  btn.title = `Sandbox map · OpenArm ${OPENARM_VERSION} · reverse on off · voice checkpoints`;
  return btn;
}

export function ensureSandboxPromptButton() {
  installSandboxVoiceBridge();
  document.querySelectorAll(
    "#prompt-pane-compose #btn-round-table, #prompt-pane-compose #btn-round-table-gen, #prompt-pane-compose [data-round-table-toggle]",
  ).forEach((btn) => btn.remove());
  const trail = document.querySelector("#prompt-pane-compose .prompt-skills-trail");
  if (trail && !document.getElementById("btn-sandbox")) {
    const repair = trail.querySelector("#btn-repair-table");
    const btn = makeSandboxButton("btn-sandbox");
    if (repair) trail.insertBefore(btn, repair);
    else trail.appendChild(btn);
  }
  const row = document.querySelector("#prompt-pane-compose .prompt-generate-row");
  if (row && !document.getElementById("btn-sandbox-gen")) {
    const repair = row.querySelector("#btn-repair-table-gen");
    const btn = makeSandboxButton("btn-sandbox-gen");
    if (repair) row.insertBefore(btn, repair);
    else row.insertBefore(btn, row.firstChild);
  }
  ensureRepairPromptButton();
  return !!document.getElementById("btn-sandbox");
}

function ensureRepairDock() {
  if (document.getElementById("sb-repair-panel")) return;
  const dock = document.createElement("aside");
  dock.id = "sb-repair-panel";
  dock.className = "sb-repair-panel";
  dock.hidden = !isRepairTableOpen();
  dock.setAttribute("aria-label", "Repair Table");
  document.body.appendChild(dock);
  paintRepairPanel(dock, null);
}

export function bindSandboxPromptButtons() {
  ensureSandboxPromptButton();
  ensureSandboxWindow();
  ensureRepairDock();
  bindRepairPromptButtons(async (next) => {
    const host = document.getElementById("sb-repair-panel");
    if (!host) return;
    host.hidden = !next?.visible;
    if (next?.visible) {
      paintRepairPanel(host, null);
      const report = await runRepairLoop("Sam opened Repair — diagnose why proceed is blocked");
      paintRepairPanel(host, report);
    }
  });
  document.querySelectorAll("#btn-sandbox, #btn-sandbox-gen, [data-sandbox-toggle]").forEach((btn) => {
    if (!btn || btn.dataset.sandbox1Bound) return;
    btn.dataset.sandbox1Bound = "1";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const out = toggleSandboxWindow();
      void import("./sandbox-context-log.js?v=ctxlog1").then(({ postContextEvent }) =>
        postContextEvent({
          source: "studio-vr",
          feature_id: "sandbox.ui.click",
          event_kind: out?.visible ? "sandbox_on" : "sandbox_off",
          target_id: btn.id || "btn-sandbox",
          context: {
            href: String(location.pathname || "").slice(0, 80),
            xr: document.body.classList.contains("xr-presenting") ? "1" : "0",
          },
        }),
      );
    });
  });
}

function ensureSandboxWindow() {
  if (document.getElementById("sb1-window")) return;
  const win = document.createElement("section");
  win.id = "sb1-window";
  win.className = "sb1-window";
  win.dataset.token = SANDBOX1_TOKEN;
  win.innerHTML = `
    <header class="sb1-chrome">
      <strong>Sandbox</strong>
      <span id="sb1-live" class="muted small">sandbox1 · live edits in frontend/sandbox only</span>
      <button type="button" class="sb1-sim-ctrl" id="sb1-sim-ctrl" aria-pressed="false" title="Headset uses sandbox control profile (xrctrl2)">Simulate sandbox controls</button>
      <button type="button" class="sb1-sim-ctrl" id="sb1-listen-ctrl" aria-pressed="false" title="Poll /mcp/sandbox/controls in the current XR session">Listen live</button>
      <button type="button" class="sb1-sim-ctrl" id="sb1-record-ctrl" aria-pressed="false" title="Record compact VR button transitions and tool IDs while sandbox is open">Record VR reference</button>
      <span id="sb1-capture-status" class="muted small" role="status">Capture off</span>
      <div class="sb1-tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" role="tab" data-sb1-tab="${t.id}" aria-selected="${t.id === "chat" ? "true" : "false"}">${t.label}</button>`).join("")}
      </div>
      <button type="button" class="sb1-grow" data-sb1-grow title="Grow window">Grow</button>
      <button type="button" class="sb1-close" data-sb1-close aria-label="Close sandbox">×</button>
    </header>
    <div class="sb1-body">
      <div data-sb1-panel="chat">
        <iframe id="sb1-chat-frame" class="sb1-frame" title="Team chat" src="/sandbox/team-chat.html?embed=1"></iframe>
      </div>
      <div data-sb1-panel="files" hidden>
        <div class="sb1-split">
          <nav id="sb1-file-list" class="sb1-file-list" aria-label="Sandbox files"></nav>
          <div>
            <p id="sb1-file-title" class="muted small">examples/agenda-20260917.md</p>
            <div id="sb1-file-view"></div>
          </div>
        </div>
      </div>
      <div data-sb1-panel="examples" hidden>
        <p class="muted small">Point a file from the Files tab, or load a sandbox example. Agents write under frontend/sandbox/ — the viewer hot-refreshes.</p>
        <div class="sb1-example-actions">
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/dimos-sandbox-link.md">DIMOS sandbox</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/dimos-y-wiring.md">DimOS Y</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/agenda-20260917.md">tonight agenda</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/hello.md">hello.md</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/code-sample.js">code-sample.js</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/pitch-social-growth.md">pitch deck</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/pitch-how-to.md">how to pitch</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/openarm-2.0-base-prompt.md">OpenArm 2.0</button>
          <button type="button" class="btn secondary btn-compact" data-sb1-ex="examples/openarm-teleop-lab.md">teleop lab</button>
        </div>
        <div id="sb1-ex-view"></div>
      </div>
    </div>
    <div class="sb1-resize" data-sb1-resize></div>
  `;
  document.body.appendChild(win);
  win.querySelectorAll("[data-sb1-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.getAttribute("data-sb1-tab")));
  });
  win.querySelector("[data-sb1-close]")?.addEventListener("click", () => setSandboxOpen(false));
  win.querySelector("#sb1-sim-ctrl")?.addEventListener("click", () => {
    const on = win.querySelector("#sb1-sim-ctrl")?.getAttribute("aria-pressed") !== "true";
    const listenOn = win.querySelector("#sb1-listen-ctrl")?.getAttribute("aria-pressed") === "true";
    void ensureLiveClient().patch({ simulate: on, listen: on ? true : listenOn });
  });
  win.querySelector("#sb1-listen-ctrl")?.addEventListener("click", () => {
    const on = win.querySelector("#sb1-listen-ctrl")?.getAttribute("aria-pressed") !== "true";
    void ensureLiveClient().patch({ listen: on });
  });
  win.querySelector("#sb1-record-ctrl")?.addEventListener("click", (event) => {
    const capture = ensureCapture();
    if (capture.running()) capture.stop();
    else capture.start();
    event.currentTarget.setAttribute("aria-pressed", capture.running() ? "true" : "false");
    if (!capture.running()) document.getElementById("sb1-capture-status").textContent = "Capture off";
  });
  win.querySelector("[data-sb1-grow]")?.addEventListener("click", () => {
    win.classList.toggle("is-big");
  });
  win.querySelectorAll("[data-sb1-ex]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      setTab("files");
      await loadSandboxFile(btn.getAttribute("data-sb1-ex"));
    });
  });
  const handle = win.querySelector("[data-sb1-resize]");
  handle?.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startW = win.offsetWidth;
    const startH = win.offsetHeight;
    const move = (e) => {
      win.style.width = Math.max(360, startW + (e.clientX - startX)) + "px";
      win.style.height = Math.max(280, startH + (e.clientY - startY)) + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

export function applySandboxDraft(filename, text) {
  const rel = String(filename || "examples/code-sample.js").replace(/^frontend\/sandbox\//, "");
  const view = document.getElementById("sb1-ex-view") || document.getElementById("sb1-file-view");
  if (view) {
    view.innerHTML = `<textarea class="sb1-code" readonly spellcheck="false">${esc(text || "")}</textarea>`;
  }
  setSandboxOpen(true);
  setTab("examples");
  const title = document.getElementById("sb1-file-title");
  if (title) title.textContent = rel;
  return { ok: true, path: rel, token: SANDBOX1_TOKEN, applied: false };
}

if (typeof window !== "undefined") {
  window.Render3DSandbox = {
    token: SANDBOX1_TOKEN,
    tokens: [SANDBOX1_TOKEN, "sandbox2", MAP1_TOKEN, VOICEMAP1_TOKEN, REPAIR1_TOKEN],
    liveToken: XRCTRL2_CACHE,
    mapToken: MAP1_TOKEN,
    repairToken: REPAIR1_TOKEN,
    openArm: OPENARM_VERSION,
    open: () => setSandboxOpen(true),
    close: () => setSandboxOpen(false),
    isOpen: isSandboxOpen,
    toggle: toggleSandboxWindow,
    loadFile: loadSandboxFile,
    applyDraft: applySandboxDraft,
    simulateControls: (on) => ensureLiveClient().patch({ simulate: !!on, listen: !!on }),
    repair: {
      open: () => setRepairTableOpen(true),
      close: () => setRepairTableOpen(false),
      toggle: () => setRepairTableOpen(!isRepairTableOpen()),
      isOpen: isRepairTableOpen,
      run: (symptom) => runRepairLoop(symptom || ""),
    },
  };
  window.Render3DProjectCode = window.Render3DProjectCode || {};
  const prev = window.Render3DProjectCode.applyDraft;
  window.Render3DProjectCode.applyDraft = (filename, text) => {
    applySandboxDraft(filename, text);
    try { prev?.(filename, text); } catch { /* optional */ }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindSandboxPromptButtons);
  } else {
    bindSandboxPromptButtons();
  }
}
