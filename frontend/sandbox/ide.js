/**
 * Sandbox file IDE — generate + edit code under frontend/sandbox/ via /mcp/sandbox.
 * Builds new loops + character-motion scopes. Token fileide1.
 */

export const FILEIDE1_TOKEN = "fileide1";

export function ideTreeFiles(files = []) {
  return (files || []).filter((p) => {
    const n = String(p);
    if (/\.(stl|obj|mtl|glb|png|jpg|jpeg|webp|pdf)$/i.test(n)) return false;
    if (/openarm-mujoco\//i.test(n) && !/openarm-mujoco\/(README|SOURCE|index)/i.test(n)) return false;
    if (/node_modules/.test(n)) return false;
    return true;
  }).slice(0, 80);
}

const LOOP_STARTER = `/** Sandbox loop stub — ${new Date().toISOString().slice(0, 10)} */
export const LOOP_TOKEN = "loop1";

export async function tick(ctx = {}) {
  // Agents extend this. Writes stay in frontend/sandbox/.
  return { ok: true, token: LOOP_TOKEN, at: new Date().toISOString(), ctx };
}

export function planCharacterMoves(crew = []) {
  return crew.map((c) => ({
    id: c.id || c,
    move: "approach_desk",
    path: ["home", "near_table", "speak", "home"],
    loop: true,
  }));
}
`;

const CHAR_MOTION_SCOPE = `# Character motion scope (sandbox whiteboard)

## Goal
Agents propose how each crew character moves in the Super IDE smart whiteboard / office hangout.

## Constraints
- Sandbox only — no prod Office mutation
- One WebGL scene (#sb-office)
- Motion is visual / TTS desk highlight — not DIMOS joint commands

## Move vocabulary
| move | meaning |
|------|---------|
| approach_desk | walk toward clicked desk |
| circle_table | orbit the round table |
| speak_pose | stop + face camera while TTS plays |
| return_home | lerp back to seat home |
| whiteboard_pin | highlight token on smart whiteboard |

## Agent asks
1. Cursor — file path + loop hook for each move
2. RnD — timing / ease / collision with desks
3. Analytics — which moves get used (count in /mcp/stats later)
4. Astra — who speaks while moving (1 male voice option)

## Next loop file
\`examples/character-motion-loop.js\` — export planCharacterMoves + tick
`;

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function mcpList() {
  const res = await fetch("/mcp/sandbox?action=list&t=" + Date.now()).catch(() => null);
  if (!res || !res.ok) throw new Error(`File list unavailable (${res?.status || "network"})`);
  const data = await res.json().catch(() => ({}));
  if (data.ok === false) throw new Error(data.error || "File list unavailable");
  return (data.files || []).map((f) => f.path || f).filter(Boolean);
}

async function mcpRead(path) {
  const res = await fetch("/mcp/sandbox/file?path=" + encodeURIComponent(path) + "&t=" + Date.now()).catch(() => null);
  if (!res || !res.ok) throw new Error(`Load failed (${res?.status || "network"}); draft preserved`);
  const data = await res.json().catch(() => ({}));
  if (data.ok === false || typeof data.text !== "string") throw new Error(data.error || "Invalid file response; draft preserved");
  return { ok: true, text: data.text, path: data.path || path, kind: data.kind };
}

async function mcpWrite(path, text, agent = "sam") {
  try {
    const { isSandboxProgrammingOn } = await import("./project-file-viewer.js?v=20260923-draw-recordings1");
    if (!isSandboxProgrammingOn()) return { ok: false, gated: true, detail: "sandbox_off" };
  } catch { /* if viewer missing, still require explicit toggle via localStorage */ 
    try {
      if (globalThis.localStorage?.getItem("render3d.sandbox.fileIdeSandbox") !== "1") {
        return { ok: false, gated: true, detail: "sandbox_off" };
      }
    } catch { return { ok: false, gated: true, detail: "sandbox_off" }; }
  }
  try {
    const { autoPushSandboxCode } = await import("./sandbox-push.js?v=20260923-draw-recordings1");
    return autoPushSandboxCode({ path, text, agent, note: "File IDE auto-push" });
  } catch {
    const res = await fetch("/mcp/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "write",
        agent,
        path,
        text: String(text ?? ""),
      }),
    }).catch(() => null);
    if (!res || !res.ok) return { ok: false, detail: res ? `HTTP ${res.status}` : "network" };
    return { ok: true, ...(await res.json().catch(() => ({}))) };
  }
}

export function mountIde(host) {
  if (!host || host.dataset.ready === "1") return null;
  host.dataset.ready = "1";
  host.dataset.token = FILEIDE1_TOKEN;
  host.classList.add("sb-file-ide");
  host.innerHTML = `
    <div class="sb-file-ide-bar">
      <span class="sb-kicker">FILE IDE · ${FILEIDE1_TOKEN}</span>
      <input type="text" data-sb-ide-path placeholder="examples/my-loop.js" value="examples/character-motion-loop.js" />
      <button type="button" class="btn secondary btn-compact" data-sb-ide-load>Load</button>
      <button type="button" class="btn accent btn-compact" data-sb-ide-save>Save to MCP</button>
      <button type="button" class="btn secondary btn-compact" data-sb-ide-gen-loop>New loop</button>
      <button type="button" class="btn secondary btn-compact" data-sb-ide-gen-motion>Char motion scope</button>
      <span class="muted small" data-sb-ide-status role="status">Idle</span>
    </div>
    <div class="sb-file-ide-split">
      <nav class="sb-file-ide-tree" data-sb-ide-tree aria-label="Sandbox files"></nav>
      <textarea class="sb-file-ide-editor" data-sb-ide-editor spellcheck="false" placeholder="// Generate or load a sandbox file…"></textarea>
    </div>
    <p class="muted small">Writes auto-push → <code>POST /mcp/sandbox</code> + collab history + code-updates link under <code>frontend/sandbox/</code>.</p>
    <pre class="sb-file-ide-collab muted small" data-sb-ide-collab></pre>
  `;

  const pathEl = host.querySelector("[data-sb-ide-path]");
  const editor = host.querySelector("[data-sb-ide-editor]");
  const tree = host.querySelector("[data-sb-ide-tree]");
  const collab = host.querySelector("[data-sb-ide-collab]");
  const status = host.querySelector("[data-sb-ide-status]");
  const setStatus = (m) => { if (status) status.textContent = m; };
  let revision = 0, saved = "", request = 0, saving = false;
  editor.addEventListener("input", () => { revision++; setStatus("Unsaved changes"); });
  pathEl.addEventListener("input", () => { revision++; });
  const discard = () => editor.value === saved || window.confirm("Discard unsaved editor changes?");
  const load = async p => {
    if (!p || saving || !discard()) return;
    const ticket = ++request, started = revision;
    setStatus(`Loading ${p}...`);
    try {
      const out = await mcpRead(p);
      if (ticket !== request) return;
      if (started !== revision) { setStatus("Load ignored because the draft changed"); return; }
      editor.value = saved = out.text; pathEl.value = p;
      setStatus(`Loaded ${p}`);
    } catch (error) { if (ticket === request) setStatus(error.message); }
  };
  const newDraft = (p, body) => {
    if (saving || !discard()) return;
    request++; revision++; saved = ""; pathEl.value = p; editor.value = body;
    setStatus("New draft; not saved");
  };

  const paintTree = async () => {
    let files;
    try { files = await mcpList(); }
    catch (error) { tree.textContent = error.message; return; }
    tree.innerHTML = files.length
      ? ideTreeFiles(files).map((p) => `<button type="button" class="sb-file-ide-item" data-path="${esc(p)}">${esc(p)}</button>`).join("")
      : `<p class="muted small">No files yet — generate a loop.</p>`;
    tree.querySelectorAll("[data-path]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const p = btn.getAttribute("data-path");
        await load(p);
      });
    });
  };

  const paintCollab = async () => {
    const res = await fetch("/mcp/collab-index?t=" + Date.now()).catch(() => null);
    if (!res || !res.ok) {
      collab.textContent = "collab-index unreachable";
      return;
    }
    const wrapped = await res.json().catch(() => ({}));
    const data = wrapped.index || wrapped;
    const files = data.files || [];
    collab.textContent = files.length
      ? files.map((f) => `${f.path} (${f.agent || "?"})`).join("\n")
      : "no collab files — grok_collab_index path=live/<you>.md";
  };

  host.querySelector("[data-sb-ide-load]")?.addEventListener("click", async () => {
    const p = pathEl?.value?.trim();
    if (!p) return;
    await load(p);
  });

  host.querySelector("[data-sb-ide-save]")?.addEventListener("click", async () => {
    const p = pathEl?.value?.trim();
    if (!p) { setStatus("Set a path"); return; }
    if (saving) return;
    const text = editor.value, started = revision;
    if (text.length > 200_000) { setStatus("File exceeds 200,000 characters; nothing was saved"); return; }
    saving = true; request++;
    const button = host.querySelector("[data-sb-ide-save]");
    button.disabled = true;
    setStatus(`Saving ${p}…`);
    const out = await mcpWrite(p, text);
    saving = false; button.disabled = false;
    if (out.ok && started === revision) saved = text;
    setStatus(out.ok ? `Auto-pushed ${p}${started !== revision ? "; newer edits remain unsaved" : ""}` : `Save failed · ${out.detail || out.error || "rejected"}; draft preserved`);
    await paintTree();
  });

  host.querySelector("[data-sb-ide-gen-loop]")?.addEventListener("click", async () => {
    const p = "examples/character-motion-loop.js";
    newDraft(p, LOOP_STARTER);
  });

  host.querySelector("[data-sb-ide-gen-motion]")?.addEventListener("click", async () => {
    const p = "examples/character-motion-scope.md";
    newDraft(p, CHAR_MOTION_SCOPE);
  });

  void paintTree();
  void paintCollab();
  const timer = setInterval(() => { void paintTree(); void paintCollab(); }, 8000);

  return { token: FILEIDE1_TOKEN, reload: paintTree, destroy: () => { request++; clearInterval(timer); } };
}
