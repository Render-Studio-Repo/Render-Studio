/**
 * FILEVIEW1 — Sam's real Studio project files.
 * Default: read-only. Sandbox / MCP programming only when Sam toggles Sandbox.
 * Shop crew is silent until they find something. Token fileview1.
 */

import { listProjects, createProjectRemix, REMIX1_TOKEN, REMIX_ROOT } from "./sandbox-remix.js?v=remix1-fileview2";
import { assignTask } from "./agent-tasks.js?v=20260923-draw-recordings1";
import {
  collectStudioProjectFiles,
  fileLabel,
  createShopCrew,
  SHOPTASK1_TOKEN,
} from "./sandbox-shop-task.js?v=shoptask1&singlevoice1";

export const FILEVIEW1_TOKEN = "fileview1";
export const CODE_UPDATE_LINK = "live/code-updates-link.md";
export const CODE_UPDATE_JSON = "live/code-updates-link.json";
export const SANDBOX_TOGGLE_KEY = "render3d.sandbox.fileIdeSandbox";
export { collectStudioProjectFiles, fileLabel, SHOPTASK1_TOKEN };

export function isSandboxProgrammingOn(storage = globalThis.localStorage) {
  try { return storage?.getItem?.(SANDBOX_TOGGLE_KEY) === "1"; }
  catch { return false; }
}

export function setSandboxProgrammingOn(on, storage = globalThis.localStorage) {
  const next = !!on;
  try { storage?.setItem?.(SANDBOX_TOGGLE_KEY, next ? "1" : "0"); } catch { /* optional */ }
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent("render3d-sandbox-fileide", {
      detail: { on: next, token: FILEVIEW1_TOKEN },
    }));
  } catch { /* optional */ }
  return next;
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function mcpWrite(path, text, agent = "cursor") {
  if (!isSandboxProgrammingOn()) return { ok: false, gated: true, detail: "sandbox_off" };
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "write",
      agent,
      path,
      text: String(text ?? "").slice(0, 200_000),
    }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, detail: res ? `HTTP ${res.status}` : "network" };
  return { ok: true, ...(await res.json().catch(() => ({}))) };
}

async function mcpRead(path) {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, text: "" };
  const data = await res.json().catch(() => ({}));
  return { ok: true, text: data.text || "", path: data.path || path };
}

export function studioFileUrl(projectId, name) {
  const rel = String(name || "").replace(/^\/+/, "");
  return `/api/projects/${encodeURIComponent(projectId)}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export async function fetchStudioProjectFiles(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return { files: [], name: "", project: null };
  const urls = [
    `/api/projects/${encodeURIComponent(pid)}?view=open`,
    `/api/projects/${encodeURIComponent(pid)}`,
  ];
  let data = {};
  for (const url of urls) {
    const res = await fetch(url, { credentials: "same-origin" }).catch(() => null);
    if (!res?.ok) continue;
    data = await res.json().catch(() => ({}));
    const files = collectStudioProjectFiles(data);
    if (files.length || data.name || data.id) {
      try {
        const treeRes = await fetch(
          `/api/projects/${encodeURIComponent(pid)}/code/tree?root=${encodeURIComponent("references/Project Code")}`,
          { credentials: "same-origin" },
        ).catch(() => null);
        if (treeRes?.ok) {
          const tree = await treeRes.json().catch(() => ({}));
          const extra = Array.isArray(tree.files) ? tree.files : [];
          data.tree = [...(data.tree || []), ...extra.map((f) => (typeof f === "string" ? { name: f } : f))];
        }
      } catch { /* optional */ }
      return {
        files: collectStudioProjectFiles(data),
        name: data.name || data.title || pid,
        project: data,
      };
    }
  }
  return { files: [], name: pid, project: data };
}

/**
 * Bots write/refresh the stable link — gated by Sandbox toggle.
 */
export async function botsCreateCodeUpdateLink({
  remixId,
  projectId,
  projectName,
  fileCount = 0,
  note = "",
} = {}) {
  if (!isSandboxProgrammingOn()) return { ok: false, gated: true };
  const at = new Date().toISOString();
  const remixPath = remixId ? `${REMIX_ROOT}/${remixId}` : "";
  const sandboxHref = `/sandbox/?remix=${encodeURIComponent(remixId || "")}&track=code-updates`;
  const prior = await mcpRead(CODE_UPDATE_JSON);
  let history = [];
  try {
    const parsed = prior.ok && prior.text ? JSON.parse(prior.text) : null;
    history = Array.isArray(parsed?.history) ? parsed.history.slice(-40) : [];
  } catch { history = []; }

  const entry = {
    at,
    remix_id: remixId || null,
    project_id: projectId || null,
    project_name: projectName || null,
    file_count: fileCount,
    note: String(note || "duplicate into sandbox").slice(0, 200),
    agents: ["cursor-engineer", "vibe-rnd", "analytics", "astra"],
  };
  history.push(entry);

  const payload = {
    token: FILEVIEW1_TOKEN,
    kind: "code_update_link",
    href: sandboxHref,
    md_path: CODE_UPDATE_LINK,
    remix_root: remixPath || null,
    tree: remixPath ? `${remixPath}/tree.json` : null,
    chunks: remixPath ? `${remixPath}/chunks.json` : null,
    active_remix: remixId || null,
    source_project_id: projectId || null,
    updated_at: at,
    history,
    ask: "Bots append here when sandbox code changes so Sam can pull any update back.",
  };

  const md = [
    `# Code update link`,
    ``,
    `Stable track for sandbox duplicates. Open: [\`${sandboxHref}\`](${sandboxHref})`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Active remix | \`${remixId || "—"}\` |`,
    `| Source project | \`${projectId || "—"}\` (${projectName || ""}) |`,
    `| Tree | \`${payload.tree || "—"}\` |`,
    `| Chunks | \`${payload.chunks || "—"}\` |`,
    `| Updated | ${at} |`,
    ``,
    `_Token ${FILEVIEW1_TOKEN} · remix ${REMIX1_TOKEN}_`,
  ].join("\n");

  await mcpWrite(CODE_UPDATE_JSON, JSON.stringify(payload, null, 2), "cursor");
  await mcpWrite(CODE_UPDATE_LINK, md, "astra");
  if (remixPath) await mcpWrite(`${remixPath}/UPDATE-LINK.md`, md, "cursor");

  assignTask("cursor-engineer", `Track code updates → ${CODE_UPDATE_LINK}`, { from: "file-viewer" });
  return { ok: true, href: sandboxHref, md_path: CODE_UPDATE_LINK, json_path: CODE_UPDATE_JSON, payload };
}

export async function appendCodeUpdate({ path = "", agent = "cursor", note = "" } = {}) {
  if (!isSandboxProgrammingOn()) return { ok: false, gated: true };
  const prior = await mcpRead(CODE_UPDATE_JSON);
  let payload = { history: [], href: "/sandbox/?track=code-updates" };
  try {
    if (prior.ok && prior.text) payload = { ...payload, ...JSON.parse(prior.text) };
  } catch { /* fresh */ }
  const history = Array.isArray(payload.history) ? payload.history.slice(-40) : [];
  history.push({
    at: new Date().toISOString(),
    remix_id: payload.active_remix || null,
    project_id: payload.source_project_id || null,
    path: String(path || "").slice(0, 160),
    note: String(note || "sandbox write").slice(0, 200),
    agent,
  });
  payload.history = history;
  payload.updated_at = history[history.length - 1].at;
  await mcpWrite(CODE_UPDATE_JSON, JSON.stringify(payload, null, 2), agent);
  return payload;
}

export function mountProjectFileViewer(host, { speak } = {}) {
  if (!host) return null;
  if (host.dataset.ready === "1") return host._fileViewApi || null;
  host.dataset.ready = "1";
  host.dataset.token = FILEVIEW1_TOKEN;
  host.classList.add("sb-file-viewer");

  let sandboxOn = isSandboxProgrammingOn();
  host.dataset.sandbox = sandboxOn ? "1" : "0";

  host.innerHTML = `
    <header class="sb-file-viewer-head">
      <div>
        <span class="sb-kicker">FILE VIEWER · ${FILEVIEW1_TOKEN}</span>
        <p class="muted small">Real Studio project files (keep Mechanical parts list.json, electronics_build_sourcing.md / _2.md, parts_list.md, 90576A119.glb). Bots do not program here unless you toggle Sandbox.</p>
      </div>
      <div class="sb-file-viewer-actions">
        <label class="sb-file-sandbox-toggle">
          <input type="checkbox" data-fv-sandbox ${sandboxOn ? "checked" : ""} />
          Sandbox
        </label>
        <button type="button" class="sb-agent-btn" data-fv-refresh>Refresh</button>
        <button type="button" class="sb-agent-btn" data-fv-shop>Bench check</button>
        <span class="sb-file-sandbox-only" data-fv-sandbox-only>
          <button type="button" class="sb-agent-btn sb-agent-btn--astra" data-fv-dup disabled>Duplicate into sandbox</button>
          <button type="button" class="sb-agent-btn" data-fv-link title="Open bot code-update link">Update link</button>
        </span>
        <span class="muted small" data-fv-status role="status">Idle</span>
      </div>
    </header>
    <div class="sb-file-shop" data-fv-shop-bar>
      <label class="sb-dimos-field">
        <span>Shop task</span>
        <input type="text" data-fv-shop-task value="y'all work on analyzing these models to make sure they can actually be printed" maxlength="200" />
      </label>
      <label class="sb-dimos-field">
        <span>Files on the bench (comma names, or blank = first 3 meshes)</span>
        <input type="text" data-fv-shop-pick placeholder="part.stl, nest.3mf" />
      </label>
      <p class="muted small" data-fv-shop-out>Shop quiet · they work without talking. One speaker if they find something.</p>
    </div>
    <div class="sb-file-viewer-split">
      <nav class="sb-file-viewer-projects" data-fv-projects aria-label="Projects"></nav>
      <div class="sb-file-viewer-files">
        <h3 class="sb-file-viewer-title" data-fv-title>Select a project</h3>
        <ul class="sb-file-viewer-list" data-fv-files></ul>
        <pre class="sb-file-preview muted small" data-fv-preview hidden></pre>
      </div>
    </div>
    <div class="sb-file-sandbox-only" data-fv-sandbox-panel hidden>
      <p class="muted small">Sandbox write jail stays under <code>frontend/sandbox/</code>. One File IDE — not a second tab.</p>
      <div id="sb-ide"></div>
    </div>
    <p class="muted small" data-fv-link-out hidden>Link: <code>${esc(CODE_UPDATE_LINK)}</code></p>
  `;

  const status = host.querySelector("[data-fv-status]");
  const setStatus = (m) => { if (status) status.textContent = m; };
  const shop = createShopCrew({ speak });
  let projects = [];
  let selected = null;
  let files = [];
  let ideApi = null;

  const syncSandboxUi = () => {
    host.dataset.sandbox = sandboxOn ? "1" : "0";
    host.querySelectorAll("[data-fv-sandbox-only]").forEach((el) => {
      el.hidden = !sandboxOn;
    });
    const panel = host.querySelector("[data-fv-sandbox-panel]");
    if (panel) panel.hidden = !sandboxOn;
    const box = host.querySelector("[data-fv-sandbox]");
    if (box) box.checked = sandboxOn;
  };

  const ensureIde = async () => {
    if (!sandboxOn || ideApi) return ideApi;
    const slot = host.querySelector("#sb-ide");
    if (!slot) return null;
    try {
      const { mountIde } = await import("./ide.js?v=20260923-draw-recordings1");
      ideApi = mountIde(slot);
    } catch { ideApi = null; }
    return ideApi;
  };

  const paintProjects = () => {
    const nav = host.querySelector("[data-fv-projects]");
    if (!nav) return;
    nav.innerHTML = projects.length
      ? projects.map((p) => `
          <button type="button" class="sb-file-viewer-proj${selected?.id === p.id ? " is-on" : ""}" data-pid="${esc(p.id)}">
            <strong>${esc(p.name || p.id)}</strong>
            <span class="muted small">${esc(p.id)}</span>
          </button>`).join("")
      : `<p class="muted small">No projects — sign in or create one in Studio.</p>`;
    nav.querySelectorAll("[data-pid]").forEach((btn) => {
      btn.addEventListener("click", () => { void selectProject(btn.getAttribute("data-pid")); });
    });
  };

  const paintFiles = () => {
    const title = host.querySelector("[data-fv-title]");
    const list = host.querySelector("[data-fv-files]");
    const dup = host.querySelector("[data-fv-dup]");
    if (title) {
      title.textContent = selected
        ? `${selected.name || selected.id} · ${files.length} real files`
        : "Select a project";
    }
    if (dup) dup.disabled = !selected?.id || !sandboxOn;
    if (!list) return;
    list.innerHTML = files.length
      ? files.map((f) => {
        const name = fileLabel(f);
        const bag = f.bag ? ` · ${f.bag}` : "";
        return `<li><button type="button" class="sb-file-open" data-fname="${esc(name)}"><code>${esc(name)}</code><span class="muted small">${esc(bag)}</span></button></li>`;
      }).join("")
      : `<li class="muted small">No files listed for this project.</li>`;
    list.querySelectorAll("[data-fname]").forEach((btn) => {
      btn.addEventListener("click", () => { void openRealFile(btn.getAttribute("data-fname")); });
    });
  };

  const openRealFile = async (name) => {
    if (!selected?.id || !name) return;
    const preview = host.querySelector("[data-fv-preview]");
    const url = studioFileUrl(selected.id, name);
    setStatus(`Opening ${name}…`);
    if (preview) {
      preview.hidden = false;
      preview.textContent = `GET ${url}`;
    }
    const res = await fetch(url, { credentials: "same-origin" }).catch(() => null);
    if (!res) {
      setStatus(`Could not fetch ${name}`);
      return;
    }
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      if (preview) preview.textContent = `HTTP ${res.status} · ${url}`;
      setStatus(`Studio file ${res.status}`);
      return;
    }
    if (/json|text|javascript|xml|svg/i.test(ct) || /\.(md|json|txt|js|ts|html|css|xml|svg|py|csv)$/i.test(name)) {
      const text = await res.text();
      if (preview) preview.textContent = text.slice(0, 12_000);
      setStatus(`Showing ${name}`);
    } else {
      if (preview) {
        preview.innerHTML = `Binary / model · <a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a> · ${esc(ct || "bytes")}`;
      }
      setStatus(`Linked ${name}`);
    }
  };

  const selectProject = async (pid) => {
    selected = projects.find((p) => p.id === pid) || { id: pid };
    setStatus(`Loading ${pid}…`);
    paintProjects();
    const listed = await fetchStudioProjectFiles(pid);
    selected = { ...selected, name: listed.name || selected.name };
    files = listed.files || [];
    paintFiles();
    setStatus(`${files.length} real files · read-only${sandboxOn ? " · sandbox on" : ""}`);
  };

  const refresh = async () => {
    setStatus("Loading projects…");
    projects = await listProjects();
    paintProjects();
    if (selected?.id) await selectProject(selected.id);
    else paintFiles();
    setStatus(projects.length ? `${projects.length} projects` : "No projects");
  };

  const runShop = async () => {
    const task = host.querySelector("[data-fv-shop-task]")?.value?.trim() || "";
    const pick = String(host.querySelector("[data-fv-shop-pick]")?.value || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    shop.adjust({ task, pick, limit: pick.length || 3 });
    const out = await shop.run(files, { task, pick });
    const dest = host.querySelector("[data-fv-shop-out]");
    if (dest) {
      dest.textContent = out.line;
      if (out.alerts?.length) dest.classList.add("is-alert");
      else dest.classList.remove("is-alert");
    }
    setStatus(out.line);
    return out;
  };

  host.querySelector("[data-fv-sandbox]")?.addEventListener("change", async (ev) => {
    sandboxOn = setSandboxProgrammingOn(!!ev.target.checked);
    syncSandboxUi();
    setStatus(sandboxOn ? "Sandbox on — MCP writes allowed under frontend/sandbox/" : "Sandbox off — real files only");
    if (sandboxOn) await ensureIde();
  });

  host.querySelector("[data-fv-refresh]")?.addEventListener("click", () => { void refresh(); });
  host.querySelector("[data-fv-shop]")?.addEventListener("click", () => { void runShop(); });
  host.querySelector("[data-fv-shop-task]")?.addEventListener("change", () => {
    shop.adjust({ task: host.querySelector("[data-fv-shop-task]")?.value || "" });
  });
  host.querySelector("[data-fv-shop-pick]")?.addEventListener("change", () => {
    const pick = String(host.querySelector("[data-fv-shop-pick]")?.value || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    shop.adjust({ pick });
  });

  host.querySelector("[data-fv-dup]")?.addEventListener("click", async () => {
    if (!sandboxOn || !selected?.id) return;
    setStatus(`Duplicating ${selected.name || selected.id}…`);
    const out = await createProjectRemix(selected.id, { label: selected.name });
    if (!out?.ok) {
      setStatus(`Duplicate failed · ${out?.reason || "error"}`);
      return;
    }
    const link = await botsCreateCodeUpdateLink({
      remixId: out.remixId,
      projectId: selected.id,
      projectName: selected.name,
      fileCount: out.fileCount,
      note: "duplicated from file viewer",
    });
    const outEl = host.querySelector("[data-fv-link-out]");
    if (outEl && link?.href) {
      outEl.hidden = false;
      outEl.innerHTML = `Link: <a href="${esc(link.href)}"><code>${esc(CODE_UPDATE_LINK)}</code></a> · remix <code>${esc(out.remixId)}</code>`;
    }
    setStatus(`Duplicated → ${out.remixId} · ${out.fileCount} pointers`);
  });

  host.querySelector("[data-fv-link]")?.addEventListener("click", async () => {
    if (!sandboxOn) return;
    const link = await mcpRead(CODE_UPDATE_LINK);
    if (!link.ok) {
      setStatus("No update link yet — duplicate a project first");
      return;
    }
    setStatus(`Opened ${CODE_UPDATE_LINK}`);
    await ensureIde();
    try {
      const pathEl = host.querySelector("[data-sb-ide-path]");
      const editor = host.querySelector("[data-sb-ide-editor]");
      if (pathEl) pathEl.value = CODE_UPDATE_LINK;
      if (editor) editor.value = link.text;
    } catch { /* optional */ }
  });

  syncSandboxUi();
  if (sandboxOn) void ensureIde();
  void refresh();

  const api = {
    token: FILEVIEW1_TOKEN,
    refresh,
    runShop,
    shop,
    botsCreateCodeUpdateLink,
    isSandboxOn: () => sandboxOn,
  };
  host._fileViewApi = api;
  return api;
}
