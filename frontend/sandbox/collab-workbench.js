/**
 * Stay on Collab IDE: edit / generate / CAD without leaving the shared viewport.
 * FILEVIEW1 real files. Writes gated. Token collabwb1. No second WebGL.
 */

import { KEEP_SHOP_REFS } from "./crew-desk-status.js?v=20260923-draw-recordings1";
import { isSandboxProgrammingOn } from "./project-file-viewer.js?v=20260923-draw-recordings1";
import { postToLive } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";

export const COLLABWB1_TOKEN = "collabwb1";
export const CAD_GLB = "90576A119.glb";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function collabWorkbenchMarkup() {
  return `
    <div class="sb-collab-wb" data-collab-wb data-token="${COLLABWB1_TOKEN}">
      <p class="muted small">Stay on this screen · shared viewport stays live · ${COLLABWB1_TOKEN}</p>
      <div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn" data-wb-open-file>Open real file</button>
        <button type="button" class="sb-agent-btn" data-wb-gen>Generate loop</button>
        <button type="button" class="sb-agent-btn" data-wb-cad>Show ${CAD_GLB} in viewport</button>
      </div>
      <label class="sb-dimos-field">
        <span>Project file</span>
        <select data-wb-ref>${KEEP_SHOP_REFS.map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join("")}</select>
      </label>
      <textarea data-wb-editor rows="6" spellcheck="false" placeholder="// Generate or paste sandbox-only code. Writes gated until Sandbox is on."></textarea>
      <p class="sb-dimos-status" data-wb-status role="status">Viewport stays. Edit / generate / CAD here.</p>
    </div>
  `;
}

export function bindCollabWorkbench(root, { onStatus } = {}) {
  if (!root) return null;
  const status = root.querySelector("[data-wb-status]");
  const editor = root.querySelector("[data-wb-editor]");
  const set = (m) => {
    if (status) status.textContent = m;
    onStatus?.(m);
  };

  root.querySelector("[data-wb-open-file]")?.addEventListener("click", async () => {
    const name = root.querySelector("[data-wb-ref]")?.value || CAD_GLB;
    document.querySelector('[data-sb-tab="se"][data-tab="projects"]')?.click?.();
    try {
      window.dispatchEvent(new CustomEvent("render3d-sandbox-fileide", {
        detail: { want: name, on: isSandboxProgrammingOn(), stay: true, token: COLLABWB1_TOKEN },
      }));
    } catch { /* optional */ }
    set(`FILEVIEW1 · ${name} (viewport still here)`);
  });

  root.querySelector("[data-wb-gen]")?.addEventListener("click", async () => {
    if (!isSandboxProgrammingOn()) {
      set("Generate gated — toggle Sandbox on FILEVIEW1");
      return;
    }
    const draft = `/** Collab generate ${new Date().toISOString().slice(0, 10)} */\nexport const LOOP_TOKEN = "loop1";\nexport async function tick(ctx = {}) {\n  return { ok: true, token: LOOP_TOKEN, workshop: "any workshop", ctx };\n}\n`;
    if (editor) editor.value = draft;
    const res = await fetch("/mcp/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "write",
        agent: "cursor",
        path: "examples/character-motion-loop.js",
        text: draft,
      }),
    }).catch(() => null);
    set(res?.ok ? "Generated examples/character-motion-loop.js (jail)" : "Generate failed or MCP offline — draft in box");
  });

  root.querySelector("[data-wb-cad]")?.addEventListener("click", () => {
    postToLive("viewport", {
      type: "sandbox-show-cad",
      token: COLLABWB1_TOKEN,
      file: CAD_GLB,
      refs: KEEP_SHOP_REFS.map((r) => r.name),
    });
    try {
      window.dispatchEvent(new CustomEvent("render3d-sandbox-show-cad", {
        detail: { file: CAD_GLB, token: COLLABWB1_TOKEN },
      }));
    } catch { /* optional */ }
    set(`${CAD_GLB} posted to the same viewport — no second WebGL`);
  });

  return { token: COLLABWB1_TOKEN };
}
