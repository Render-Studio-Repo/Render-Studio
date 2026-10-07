/** Sandbox super IDE — layui1 split/quad. Tokens sandbox1 + sandbox2. One WebGL. */
import { mountMarketingPdfDeck, MKTPRES1_TOKEN } from "./marketing-slides.js?v=mktpres1-mktpitch1";
import { mountPitchDeck, mountPitchNotes, MKTPITCH1_TOKEN } from "./pitch-deck.js?v=mktpitch1";
import { mountVoiceBenchDeck, RNDDEMO1_TOKEN } from "./rnd-voice-bench.js?v=rnddemo1&singlevoice1";
import { mountAgentTaskBoard } from "./agent-tasks.js?v=20260923-draw-recordings1";
import { FILEIDE1_TOKEN } from "./ide.js?v=20260923-draw-recordings1";
import { mountDebuggerVr, DBGVR1_TOKEN } from "./debugger-vr.js?v=20260923-draw-recordings1&singlevoice1&vrrobot=20260927-2";
import { mountProjectFileViewer, FILEVIEW1_TOKEN } from "./project-file-viewer.js?v=20260923-draw-recordings1";
import { mountSandboxAvatar, AVATAR1_TOKEN } from "./sandbox-avatar.js?v=avatar1-golden1";
import { mountSupabaseSql, SUPASQL1_TOKEN } from "./supabase-sql.js?v=supasql1";

export const SANDBOX1_TOKEN = "sandbox1";
export const SANDBOX2_TOKEN = "sandbox2";
export { MKTPRES1_TOKEN, MKTPITCH1_TOKEN, RNDDEMO1_TOKEN, FILEIDE1_TOKEN, DBGVR1_TOKEN, FILEVIEW1_TOKEN, AVATAR1_TOKEN, SUPASQL1_TOKEN };
export const SUPER_IDE_LAYOUTS = Object.freeze(["quad", "split-left", "split-down"]);

const NE_TABS = [
  { id: "sql", label: "Supabase SQL" },
  { id: "catalog", label: "Wiring / Parts / McMaster" },
  { id: "draw", label: "Canvas" },
  { id: "photo", label: "Photo" },
  { id: "imagine", label: "Imagine" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "avatar", label: "Avatar" },
  { id: "texture", label: "Texture" },
  { id: "dxf", label: "DXF" },
  { id: "pdf", label: "PDF" },
  { id: "notes", label: "Notes" },
  { id: "sheet", label: "Sheet" },
];

const SW_TABS = [
  { id: "chat", label: "Team chat" },
  { id: "pad", label: "Pad" },
  { id: "tasks", label: "Agents" },
];

const SE_TABS = [
  { id: "projects", label: "Projects" },
  { id: "dbgvr", label: "Debugger VR" },
];

const CAT_TABS = [
  { id: "wiring", label: "Wiring" },
  { id: "parts", label: "Parts" },
  { id: "mcmaster", label: "McMaster" },
];

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function tabBtns(tabs, key, first) {
  return tabs.map((t, i) => (
    `<button type="button" role="tab" data-sb-tab="${key}" data-tab="${t.id}" aria-selected="${(first || tabs[0].id) === t.id ? "true" : "false"}">${esc(t.label)}</button>`
  )).join("");
}

export function countSandboxWebgl(root = document) {
  const canvases = [...(root.querySelectorAll?.("canvas") || [])];
  return canvases.filter((c) => {
    try {
      return !!(c.getContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch {
      return false;
    }
  }).length;
}

export function setSuperIdeLayout(host, layout) {
  const next = SUPER_IDE_LAYOUTS.includes(layout) ? layout : "quad";
  if (host) host.dataset.layout = next;
  return next;
}

function showPanel(root, key, id) {
  root.querySelectorAll(`[data-sb-tab="${key}"]`).forEach((btn) => {
    btn.setAttribute("aria-selected", btn.getAttribute("data-tab") === id ? "true" : "false");
  });
  root.querySelectorAll(`[data-sb-panel="${key}"]`).forEach((el) => {
    el.hidden = el.getAttribute("data-pane") !== id;
  });
}

function bindTabs(root, key) {
  root.querySelectorAll(`[data-sb-tab="${key}"]`).forEach((btn) => {
    btn.addEventListener("click", () => showPanel(root, key, btn.getAttribute("data-tab")));
  });
}

function bindGutter(host, gutter, axis) {
  if (!gutter) return;
  gutter.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const box = host.getBoundingClientRect();
    const move = (e) => {
      if (axis === "x") {
        const ratio = Math.min(0.75, Math.max(0.25, (e.clientX - box.left) / box.width));
        host.style.setProperty("--sb-split-x", `${Math.round(ratio * 1000) / 10}%`);
      } else {
        const ratio = Math.min(0.75, Math.max(0.25, (e.clientY - box.top) / box.height));
        host.style.setProperty("--sb-split-y", `${Math.round(ratio * 1000) / 10}%`);
      }
      window.dispatchEvent(new Event("resize"));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function mountCanvas2d(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">2D canvas (no extra WebGL). Draw, then agents can screenshot via Files.</p>
    <canvas id="sb-canvas-2d" width="720" height="360"></canvas>
    <div class="sb-ide-tools">
      <input type="color" id="sb-canvas-ink" value="#58a6ff" />
      <button type="button" class="btn secondary btn-compact" id="sb-canvas-clear">Clear</button>
    </div>
  `;
  const c = host.querySelector("#sb-canvas-2d");
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#010409";
  ctx.fillRect(0, 0, c.width, c.height);
  let down = false;
  const ink = () => host.querySelector("#sb-canvas-ink")?.value || "#58a6ff";
  const pos = (ev) => {
    const r = c.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (c.width / r.width), y: (ev.clientY - r.top) * (c.height / r.height) };
  };
  c.addEventListener("pointerdown", (ev) => { down = true; const p = pos(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  c.addEventListener("pointermove", (ev) => {
    if (!down) return;
    const p = pos(ev);
    ctx.strokeStyle = ink();
    ctx.lineWidth = 3;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  window.addEventListener("pointerup", () => { down = false; });
  host.querySelector("#sb-canvas-clear")?.addEventListener("click", () => {
    ctx.fillStyle = "#010409";
    ctx.fillRect(0, 0, c.width, c.height);
  });
}

function mountImagine(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">Imagine / image — 2D preview. Drop a PNG or load a sandbox file.</p>
    <input type="file" id="sb-imagine-file" accept="image/*" />
    <div class="sb-imagine-stage"><img id="sb-imagine-img" alt="Imagine preview" /></div>
  `;
  const img = host.querySelector("#sb-imagine-img");
  host.querySelector("#sb-imagine-file")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    img.src = URL.createObjectURL(file);
  });
}

function mountPhotoEditor(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">Photo editor — load a reference, annotate for Astra / repair loops. No extra WebGL.</p>
    <div class="sb-ide-tools">
      <input type="file" id="sb-photo-file" accept="image/*" />
      <input type="color" id="sb-photo-ink" value="#facc15" />
      <button type="button" class="btn secondary btn-compact" id="sb-photo-clear">Clear ink</button>
      <button type="button" class="btn accent btn-compact" id="sb-photo-ref">Set as reference</button>
    </div>
    <canvas id="sb-photo-canvas" width="720" height="420"></canvas>
  `;
  const c = host.querySelector("#sb-photo-canvas");
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#010409";
  ctx.fillRect(0, 0, c.width, c.height);
  let base = null;
  let down = false;
  const ink = () => host.querySelector("#sb-photo-ink")?.value || "#facc15";
  const pos = (ev) => {
    const r = c.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (c.width / r.width), y: (ev.clientY - r.top) * (c.height / r.height) };
  };
  const redraw = () => {
    ctx.fillStyle = "#010409";
    ctx.fillRect(0, 0, c.width, c.height);
    if (base) ctx.drawImage(base, 0, 0, c.width, c.height);
  };
  host.querySelector("#sb-photo-file")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const im = new Image();
    im.onload = () => { base = im; redraw(); };
    im.src = URL.createObjectURL(file);
  });
  c.addEventListener("pointerdown", (ev) => {
    down = true;
    const p = pos(ev);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  c.addEventListener("pointermove", (ev) => {
    if (!down) return;
    const p = pos(ev);
    ctx.strokeStyle = ink();
    ctx.lineWidth = 3;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  window.addEventListener("pointerup", () => { down = false; });
  host.querySelector("#sb-photo-clear")?.addEventListener("click", () => redraw());
  host.querySelector("#sb-photo-ref")?.addEventListener("click", async () => {
    try {
      const { addReferencePoint } = await import("./change-map.js?v=map1");
      addReferencePoint({ kind: "photo", label: "photo-canvas", note: "Photo editor reference for Astra" });
    } catch { /* optional */ }
    try {
      window.dispatchEvent(new CustomEvent("render3d-sandbox-voice-step", {
        detail: { text: "hey Astra, use this photo reference to improve the project", source: "photo-editor" },
      }));
    } catch { /* optional */ }
  });
}

function mountVideo(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">Video editor (2D only · clipperf1). No extra WebGL, no 3D timeline.</p>
    <input type="file" id="sb-video-file" accept="video/*" />
    <video id="sb-video" controls playsinline></video>
  `;
  const vid = host.querySelector("#sb-video");
  host.querySelector("#sb-video-file")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    vid.src = URL.createObjectURL(file);
  });
}

function mountTexture(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">Texture swatch — 2D canvas, not a second WebGL material preview.</p>
    <canvas id="sb-tex-2d" width="360" height="220"></canvas>
    <input type="file" id="sb-tex-file" accept="image/*" />
  `;
  const c = host.querySelector("#sb-tex-2d");
  const ctx = c.getContext("2d");
  const paint = (src) => {
    ctx.fillStyle = "#161b22";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!src) {
      for (let y = 0; y < c.height; y += 16) {
        for (let x = 0; x < c.width; x += 16) {
          ctx.fillStyle = ((x + y) / 16) % 2 ? "#30363d" : "#21262d";
          ctx.fillRect(x, y, 16, 16);
        }
      }
      return;
    }
    const im = new Image();
    im.onload = () => ctx.drawImage(im, 0, 0, c.width, c.height);
    im.src = src;
  };
  paint();
  host.querySelector("#sb-tex-file")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file) paint(URL.createObjectURL(file));
  });
}

function mountAudio(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">Audio document (2D). Studio clip editor product unchanged.</p>
    <input type="file" id="sb-audio-file" accept="audio/*" />
    <audio id="sb-audio" controls></audio>
  `;
  const el = host.querySelector("#sb-audio");
  host.querySelector("#sb-audio-file")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file && el) el.src = URL.createObjectURL(file);
  });
}

function mountDxf(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">DXF viewer stub — 2D SVG, no extra WebGL. Load a .dxf via sandbox files.</p>
    <svg viewBox="0 0 200 120" class="sb-wire-svg" aria-label="DXF stub">
      <rect x="10" y="10" width="180" height="100" fill="none" stroke="#58a6ff"/>
      <circle cx="100" cy="60" r="28" fill="none" stroke="#facc15"/>
    </svg>
  `;
}

function mountPdf(host) {
  if (!host) return;
  host.innerHTML = `
    <div class="sb-ide-tabs" role="tablist">
      <button type="button" role="tab" data-sb-tab="pdf" data-tab="pitch" aria-selected="true">Pitch</button>
      <button type="button" role="tab" data-sb-tab="pdf" data-tab="slides" aria-selected="false">Slideshow</button>
      <button type="button" role="tab" data-sb-tab="pdf" data-tab="bench" aria-selected="false">Voice bench</button>
      <button type="button" role="tab" data-sb-tab="pdf" data-tab="file" aria-selected="false">PDF file</button>
    </div>
    <div data-sb-panel="pdf" data-pane="pitch" id="sb-pdf-pitch"></div>
    <div data-sb-panel="pdf" data-pane="slides" id="sb-pdf-slides" hidden></div>
    <div data-sb-panel="pdf" data-pane="bench" id="sb-pdf-bench" hidden></div>
    <div data-sb-panel="pdf" data-pane="file" id="sb-pdf-file" hidden>
      <p class="muted small">Load a sandbox .pdf from Files (token ${MKTPITCH1_TOKEN}). Point sides on Pitch to step.</p>
      <div id="sb-pdf-view" class="muted small">No PDF loaded.</div>
    </div>
  `;
  bindTabs(host, "pdf");
  mountPitchDeck(host.querySelector("#sb-pdf-pitch"));
  mountMarketingPdfDeck(host.querySelector("#sb-pdf-slides"));
  mountVoiceBenchDeck(host.querySelector("#sb-pdf-bench"));
}

function mountNotes(host) {
  if (!host) return;
  mountPitchNotes(host);
}

function mountSheet(host) {
  if (!host) return;
  host.innerHTML = `
    <p class="muted small">Spreadsheet / CSV (text table). No extra WebGL.</p>
    <pre class="sb1-code" id="sb-sheet">name,qty\nbracket,2\n</pre>
  `;
}

function mountCatalog(host) {
  if (!host) return;
  host.innerHTML = `
    <div class="sb-ide-tabs" role="tablist">${tabBtns(CAT_TABS, "cat")}</div>
    <div data-sb-panel="cat" data-pane="wiring">
      <p class="muted small">Wiring (2D). Production workspace stays on Studio.</p>
      <svg viewBox="0 0 320 140" class="sb-wire-svg" aria-label="Wiring stub">
        <rect x="8" y="20" width="70" height="36" fill="#21262d" stroke="#58a6ff"/>
        <rect x="240" y="80" width="70" height="36" fill="#21262d" stroke="#3fb950"/>
        <line x1="78" y1="38" x2="240" y2="98" stroke="#facc15" stroke-dasharray="4 3"/>
        <text x="16" y="42" fill="#c9d1d9" font-size="11">PWR</text>
        <text x="250" y="102" fill="#c9d1d9" font-size="11">LOAD</text>
      </svg>
    </div>
    <div data-sb-panel="cat" data-pane="parts" hidden>
      <p class="muted small">Kept shop refs (FILEVIEW1 real files). Point from Projects.</p>
      <ul class="sb-log" id="sb-parts-list">
        <li>Mechanical parts list.json</li>
        <li>electronics_build_sourcing.md</li>
        <li>electronics_build_sourcing_2.md</li>
        <li>parts_list.md</li>
        <li>Binary / model · 90576A119.glb</li>
      </ul>
    </div>
    <div data-sb-panel="cat" data-pane="mcmaster" hidden>
      <p class="muted small">McMaster (mcmtab1 style) — search is 2D; catalog iframe if the vendor allows it.</p>
      <form id="sb-mcm-form" class="sb-ide-tools">
        <input id="sb-mcm-q" placeholder="e.g. 91251A194" />
        <button type="submit" class="btn accent btn-compact">Search</button>
      </form>
      <iframe id="sb-mcm-frame" class="sb-ide-frame" title="McMaster" src="about:blank"></iframe>
    </div>
  `;
  bindTabs(host, "cat");
  host.querySelector("#sb-mcm-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = encodeURIComponent(host.querySelector("#sb-mcm-q")?.value || "screw");
    const frame = host.querySelector("#sb-mcm-frame");
    if (frame) frame.src = `https://www.mcmaster.com/search/${q}/`;
  });
}

export function mountSuperIde(host) {
  if (!host || host.dataset.ready === "1") return host;
  host.dataset.ready = "1";
  host.dataset.token = SANDBOX2_TOKEN;
  host.dataset.keep = SANDBOX1_TOKEN;
  host.dataset.layout = "quad";
  host.classList.add("sb-super-ide");
  host.innerHTML = `
    <header class="sb-ide-bar">
      <strong>Super IDE</strong>
      <span class="muted small">${SANDBOX2_TOKEN} · ${SUPASQL1_TOKEN} · ${FILEVIEW1_TOKEN} · ${FILEIDE1_TOKEN} · ${DBGVR1_TOKEN} · keep ${SANDBOX1_TOKEN} · one WebGL</span>
      <div class="sb-ide-layouts">
        ${SUPER_IDE_LAYOUTS.map((id) => `<button type="button" class="btn secondary btn-compact" data-sb-layout="${id}">${id}</button>`).join("")}
      </div>
    </header>
    <div class="sb-ide-grid" data-sb-grid>
      <section class="sb-slot sb-slot-nw" data-slot="nw">
        <header>Live viewport · one WebGL</header>
        <div id="sb-office" class="sb-slot-body sb-live-slot" data-sb-live-slot="viewport"></div>
      </section>
      <div class="sb-gutter sb-gutter-x" data-gutter="x"></div>
      <section class="sb-slot sb-slot-ne" data-slot="ne">
        <header class="sb-ide-tabs" role="tablist">${tabBtns(NE_TABS, "ne")}</header>
        <div class="sb-slot-body">
          <div data-sb-panel="ne" data-pane="sql" id="sb-pane-sql"></div>
          <div data-sb-panel="ne" data-pane="draw" id="sb-pane-draw" hidden></div>
          <div data-sb-panel="ne" data-pane="photo" id="sb-pane-photo" hidden></div>
          <div data-sb-panel="ne" data-pane="imagine" id="sb-pane-imagine" hidden></div>
          <div data-sb-panel="ne" data-pane="video" id="sb-pane-video" hidden></div>
          <div data-sb-panel="ne" data-pane="audio" id="sb-pane-audio" hidden></div>
          <div data-sb-panel="ne" data-pane="avatar" id="sb-pane-avatar" hidden></div>
          <div data-sb-panel="ne" data-pane="catalog" id="sb-pane-catalog" hidden></div>
          <div data-sb-panel="ne" data-pane="texture" id="sb-pane-texture" hidden></div>
          <div data-sb-panel="ne" data-pane="dxf" id="sb-pane-dxf" hidden></div>
          <div data-sb-panel="ne" data-pane="pdf" id="sb-pane-pdf" hidden></div>
          <div data-sb-panel="ne" data-pane="notes" id="sb-pane-notes" hidden></div>
          <div data-sb-panel="ne" data-pane="sheet" id="sb-pane-sheet" hidden></div>
        </div>
      </section>
      <div class="sb-gutter sb-gutter-y" data-gutter="y"></div>
      <section class="sb-slot sb-slot-sw" data-slot="sw">
        <header class="sb-ide-tabs" role="tablist">${tabBtns(SW_TABS, "sw", "tasks")}</header>
        <div class="sb-slot-body">
          <div data-sb-panel="sw" data-pane="chat" hidden>
            <p class="muted small">Full-size Team chat sits in the debugger-sized band above this grid.</p>
          </div>
          <div data-sb-panel="sw" data-pane="pad" id="sb-pad" hidden></div>
          <div data-sb-panel="sw" data-pane="tasks" id="sb-agent-tasks"></div>
        </div>
      </section>
      <section class="sb-slot sb-slot-se" data-slot="se">
        <header class="sb-ide-tabs" role="tablist">${tabBtns(SE_TABS, "se", "projects")}</header>
        <div class="sb-slot-body">
          <div data-sb-panel="se" data-pane="projects" id="sb-pane-projects"></div>
          <div data-sb-panel="se" data-pane="dbgvr" id="sb-pane-dbgvr" hidden></div>
        </div>
      </section>
    </div>
  `;
  host.querySelectorAll("[data-sb-layout]").forEach((btn) => {
    btn.addEventListener("click", () => setSuperIdeLayout(host, btn.getAttribute("data-sb-layout")));
  });
  bindTabs(host, "ne");
  bindTabs(host, "sw");
  bindTabs(host, "se");
  bindGutter(host, host.querySelector("[data-gutter=x]"), "x");
  bindGutter(host, host.querySelector("[data-gutter=y]"), "y");
  mountSupabaseSql(host.querySelector("#sb-pane-sql"));
  mountCanvas2d(host.querySelector("#sb-pane-draw"));
  mountPhotoEditor(host.querySelector("#sb-pane-photo"));
  mountImagine(host.querySelector("#sb-pane-imagine"));
  mountVideo(host.querySelector("#sb-pane-video"));
  mountAudio(host.querySelector("#sb-pane-audio"));
  mountSandboxAvatar(host.querySelector("#sb-pane-avatar"));
  mountCatalog(host.querySelector("#sb-pane-catalog"));
  mountTexture(host.querySelector("#sb-pane-texture"));
  mountDxf(host.querySelector("#sb-pane-dxf"));
  mountPdf(host.querySelector("#sb-pane-pdf"));
  mountNotes(host.querySelector("#sb-pane-notes"));
  mountSheet(host.querySelector("#sb-pane-sheet"));
  mountAgentTaskBoard(host.querySelector("#sb-agent-tasks"));
  mountProjectFileViewer(host.querySelector("#sb-pane-projects"));
  mountDebuggerVr(host.querySelector("#sb-pane-dbgvr"));
  return host;
}
