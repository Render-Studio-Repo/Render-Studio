/** In-product viewer for ai-context, Getting-Started, skills, and log markdown. ctxlink1 */

import { authHeaders, getStoredUser, isSuperAdminUser } from "../studio/auth.js?v=20260914-forgot-pw-sblogin1-sblogin2-loginlog1-loginfix1";
import {
  CTXLINK_CACHE,
  bindWikiLinks,
  ensureWikiCss,
  renderWikiMarkdown,
} from "./context-wiki-links.js?v=ctxlink1";

export { CTXLINK_CACHE };

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function defaultApi(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...authHeaders(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const data = await res.json();
      message = data.detail || message;
    } catch {
      /* ignore */
    }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  if (res.status === 204) return null;
  return res.json();
}

function groupDocs(files) {
  const order = ["Agent", "Getting-Started", "Skill", "Log", "Ops", "Foundry", "Cursor", "Product", "Other"];
  const buckets = new Map();
  for (const file of files) {
    const group = file.group || "Other";
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push(file);
  }
  return order.filter((g) => buckets.has(g)).map((g) => [g, buckets.get(g)]);
}

export function isAiContextHash(hash = typeof location !== "undefined" ? location.hash : "") {
  const raw = String(hash || "").replace(/^#/, "");
  return raw === "ai-context" || raw === "start-here" || raw.startsWith("ai-context") || raw.startsWith("start-here");
}

export function ensureAiContextCss() {
  ensureWikiCss();
  const href = `/site/ai-context-docs.css?v=${CTXLINK_CACHE}`;
  if (typeof document === "undefined") return href;
  if (!document.querySelector(`link[data-aictx="${CTXLINK_CACHE}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-aictx", CTXLINK_CACHE);
    document.head.appendChild(link);
  }
  return href;
}

export async function mountAiContextDocs(host, options = {}) {
  if (!host) return null;
  ensureAiContextCss();
  const api = options.api || defaultApi;
  const user = getStoredUser();
  if (!isSuperAdminUser(user)) {
    host.hidden = false;
    host.innerHTML = `<section class="ai-ctx-docs"><p class="muted small">Workspace / skill / log docs are for the studio owner. Sign in as Sam to open START-HERE and right-click file links.</p></section>`;
    return null;
  }
  host.hidden = false;
  host.innerHTML = `<section class="ai-ctx-docs"><p class="muted small">Loading workspace docs…</p></section>`;
  let files = [];
  try {
    const data = await api("/api/ops/context-wiki/docs");
    files = data.files || [];
  } catch (err) {
    host.innerHTML = `<section class="ai-ctx-docs"><p class="status error">${esc(err.message || "Could not list docs")}</p></section>`;
    return null;
  }
  const start = options.startPath || "ai-context/START-HERE.md";
  const shell = host.querySelector(".ai-ctx-docs") || host;
  shell.className = "ai-ctx-docs";
  let unbind = () => {};
  let currentPath = start;

  async function openPath(path) {
    const article = shell.querySelector("[data-ai-ctx-article]");
    const status = shell.querySelector("[data-ai-ctx-status]");
    if (!article) return;
    article.innerHTML = `<p class="muted small">Opening ${esc(path)}…</p>`;
    try {
      const data = await api(`/api/ops/context-wiki/file?path=${encodeURIComponent(path)}`);
      const file = data.file || {};
      currentPath = file.path || path;
      shell.querySelectorAll("[data-ai-ctx-open]").forEach((btn) => {
        btn.classList.toggle("is-on", btn.getAttribute("data-ai-ctx-open") === currentPath);
      });
      const body = file.body || "";
      const markdown = file.kind === "markdown" || /\.mdc?$/i.test(currentPath);
      article.innerHTML = markdown
        ? renderWikiMarkdown(body, { fromPath: currentPath })
        : `<pre class="ctx-wiki-fence">${esc(body)}</pre>`;
      const wikiRoot = article.querySelector(".ctx-wiki-md") || article;
      wikiRoot.setAttribute("data-ctx-from", currentPath);
      unbind();
      unbind = bindWikiLinks(wikiRoot, {
        api,
        fromPath: currentPath,
        onOpen: (next) => void openPath(next),
        onStatus: (msg) => {
          if (status) status.textContent = msg || "";
        },
      });
      if (status) {
        const edits = file.edits || {};
        const bits = [];
        if (file.truncated) bits.push("truncated");
        if (edits.target_edited) bits.push("file edited recently");
        if (edits.deps_edited) bits.push("a dependency was edited");
        status.textContent = bits.join(" · ") || file.path || "";
      }
    } catch (err) {
      article.innerHTML = `<p class="status error">${esc(err.message || "Could not open file")}</p>`;
    }
  }

  shell.innerHTML = `
    <div class="ai-ctx-docs-head">
      <div>
        <p class="ai-ctx-kicker">Workspace docs</p>
        <h3>START HERE + skills + logs</h3>
        <p class="muted small">Blue paths are wiki links. Click to select, Shift/⌘-click for several. Right-click: Open file, Copy path (name — path for every selected file), Add to debugger.</p>
      </div>
      <p class="muted small" data-ai-ctx-status></p>
    </div>
    <div class="ai-ctx-docs-layout">
      <nav class="ai-ctx-tree" aria-label="Workspace markdown">${groupDocs(files).map(([group, rows]) => `
        <details class="ai-ctx-group" ${["Agent", "Getting-Started", "Skill"].includes(group) ? "open" : ""}>
          <summary>${esc(group)} <span>${rows.length}</span></summary>
          ${rows.map((f) => `<button type="button" data-ai-ctx-open="${esc(f.path)}" ${f.exists ? "" : "disabled"}>${esc(f.name)}<small>${esc(f.path)}</small></button>`).join("")}
        </details>`).join("")}
      </nav>
      <article class="ai-ctx-article admin-md-view" data-ai-ctx-article></article>
    </div>
  `;
  shell.querySelectorAll("[data-ai-ctx-open]").forEach((btn) => {
    btn.addEventListener("click", () => void openPath(btn.getAttribute("data-ai-ctx-open") || ""));
  });
  await openPath(start);
  return { openPath, get path() { return currentPath; } };
}
