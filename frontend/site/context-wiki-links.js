/** Obsidian-style file links for agent / skill / log markdown. Cache: ctxlink1 */

export const CTXLINK_CACHE = "ctxlink1";

const FILE_EXT = /\.(md|mdc|js|mjs|cjs|jsx|ts|tsx|py|css|html|json|yml|yaml|toml|sh|svg|plist|service|jsonl|txt)$/i;
const ROOTS = /^(frontend|backend|ai-context|Getting-Started|TODO|scripts|docs|deploy|extensions|mcp|logs|\.cursor)\//;
const SECRET_RE = /(^|\/)(\.env|\.env\..+|credentials\.json|.*\.pem|.*\.key|id_rsa|render3d\.db)(\/|$)/i;
const KNOWN_FILES = {
  "render3d.service": "deploy/render3d.service",
  "render3d-stray-cleanup.service": "deploy/render3d-stray-cleanup.service",
  "render3d-worker-watch.service": "deploy/render3d-worker-watch.service",
  "com.render3d.app.plist": "deploy/mac/com.render3d.app.plist",
  "com.render3d.watchdog.plist": "deploy/mac/com.render3d.watchdog.plist",
};
const ISSUE_RE = /\b(not working|broken|broke|404|lag|crash|fail(?:ed|ure)?|error|exception|timeout|hang|wrong|missing|degraded|down|outage)\b/i;

export function isSecretPath(text) {
  return SECRET_RE.test(String(text || ""));
}

export function isWikiPath(text) {
  const raw = String(text || "").trim().replace(/^<|>$/g, "");
  if (!raw || raw.length > 240 || raw.includes(" ")) return false;
  if (/^(https?:|mailto:|#)/i.test(raw)) return false;
  if (isSecretPath(raw)) return false;
  const bare = raw.replace(/^\.\//, "").split("?")[0];
  if (KNOWN_FILES[bare] || KNOWN_FILES[bare.toLowerCase()]) return true;
  const trimmed = bare.replace(/\/+$/, "");
  if (FILE_EXT.test(trimmed) && (trimmed.includes("/") || /\.(md|mdc|service|plist)$/i.test(trimmed))) return true;
  if (ROOTS.test(trimmed) && /\/[^/]+\.[A-Za-z0-9]+$/.test(trimmed)) return true;
  return false;
}

export function resolveWikiPath(fromPath, target) {
  const raw = String(target || "").trim().replace(/^<|>$/g, "").split("?")[0];
  if (!raw || isSecretPath(raw)) return "";
  const known = KNOWN_FILES[raw] || KNOWN_FILES[raw.replace(/^\.\//, "")];
  if (known) return known;
  const cleaned = raw.replace(/\\/g, "/");
  if (!cleaned.startsWith(".") && (ROOTS.test(cleaned) || cleaned.includes("/"))) {
    return cleaned.replace(/^\//, "");
  }
  const base = String(fromPath || "").replace(/\\/g, "/").split("/").slice(0, -1);
  const parts = cleaned.replace(/^\.\//, "").split("/");
  for (const part of parts) {
    if (part === "..") base.pop();
    else if (part && part !== ".") base.push(part);
  }
  return base.join("/");
}

export function fileNameOf(path) {
  const rel = String(path || "").replace(/\\/g, "/");
  return rel.split("/").filter(Boolean).pop() || rel;
}

export function formatCopyPaths(rows) {
  return rows
    .map((row) => {
      const path = String(row.path || row).trim();
      const name = String(row.name || fileNameOf(path)).trim();
      return `${name} — ${path}`;
    })
    .filter((line) => line.includes("—"))
    .join("\n");
}

export function selectionHasIssue(text) {
  return ISSUE_RE.test(String(text || ""));
}

export function featureKeyFor(path) {
  const slug = String(path || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return (`file.${slug}`).slice(0, 80) || "file.unknown";
}

export function relatedStatus(paths) {
  const list = [...new Set((paths || []).map((p) => String(p || "").replace(/\\/g, "/")).filter(Boolean))];
  if (list.length < 2) {
    return { related: true, label: "single file", reason: "Only one file is highlighted." };
  }
  const dirs = list.map((p) => p.split("/").slice(0, -1).join("/"));
  if (new Set(dirs).size === 1) {
    return { related: true, label: "related", reason: "Same folder." };
  }
  const roots = list.map((p) => p.split("/")[0] || "");
  const stems = list.map((p) => fileNameOf(p).replace(/\.[^.]+$/, "").toLowerCase());
  const sharedStem = stems.some((a, i) => stems.some((b, j) => i !== j && (a.includes(b) || b.includes(a)) && a.length > 3));
  if (sharedStem) {
    return { related: true, label: "related", reason: "Matching file names (same feature)." };
  }
  const prefixes = ["frontend/xr", "frontend/studio", "frontend/site", "frontend/admin", "frontend/wiring", "backend/skills", "backend/services", "ai-context/ops", "ai-context/debugger", "Getting-Started"];
  for (const prefix of prefixes) {
    if (list.filter((p) => p.startsWith(prefix + "/") || p.startsWith(prefix)).length === list.length) {
      return { related: true, label: "related", reason: `Same area: ${prefix}.` };
    }
  }
  if (new Set(roots).size === 1) {
    return { related: true, label: "related", reason: `Same tree: ${roots[0]}/.` };
  }
  return { related: false, label: "unrelated", reason: "Different trees; no shared folder or name." };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wikiAnchor(label, path, fromPath) {
  const resolved = resolveWikiPath(fromPath, path);
  if (!resolved || isSecretPath(resolved)) return esc(label);
  return `<a class="ctx-wiki-link" href="#ctx=${esc(resolved)}" data-ctx-path="${esc(resolved)}" data-ctx-name="${esc(fileNameOf(resolved))}" title="${esc(resolved)}">${esc(label)}</a>`;
}

function inlineWiki(text, fromPath) {
  let out = "";
  let i = 0;
  const src = String(text || "");
  while (i < src.length) {
    if (src.startsWith("[[", i)) {
      const end = src.indexOf("]]", i + 2);
      if (end > i) {
        const inner = src.slice(i + 2, end);
        const [target, label] = inner.includes("|") ? inner.split("|", 2) : [inner, inner];
        if (isWikiPath(target) || isWikiPath(resolveWikiPath(fromPath, target))) {
          out += wikiAnchor(label || target, target, fromPath);
          i = end + 2;
          continue;
        }
      }
    }
    if (src[i] === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        const inner = src.slice(i + 1, end);
        if (isWikiPath(inner)) {
          out += wikiAnchor(inner, inner, fromPath);
          i = end + 1;
          continue;
        }
        out += `<code>${esc(inner)}</code>`;
        i = end + 1;
        continue;
      }
    }
    if (src[i] === "[") {
      const md = src.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
      if (md) {
        const href = md[2];
        if (isWikiPath(href) || href.startsWith("./") || href.startsWith("../")) {
          out += wikiAnchor(md[1], href, fromPath);
          i += md[0].length;
          continue;
        }
        if (/^https?:/i.test(href)) {
          out += `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(md[1])}</a>`;
          i += md[0].length;
          continue;
        }
      }
    }
    if (src.startsWith("**", i)) {
      const end = src.indexOf("**", i + 2);
      if (end > i) {
        out += `<strong>${inlineWiki(src.slice(i + 2, end), fromPath)}</strong>`;
        i = end + 2;
        continue;
      }
    }
    out += esc(src[i]);
    i += 1;
  }
  return out;
}

function renderTable(rows, fromPath) {
  const cells = (line) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const head = cells(rows[0] || "");
  const body = rows.slice(1).filter((line) => !/^\|?\s*:?-/.test(line));
  return `<table class="ctx-wiki-table"><thead><tr>${head.map((c) => `<th>${inlineWiki(c, fromPath)}</th>`).join("")}</tr></thead><tbody>${body.map((line) => `<tr>${cells(line).map((c) => `<td>${inlineWiki(c, fromPath)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function renderWikiMarkdown(markdown, { fromPath = "" } = {}) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let fence = null;
  let fenceBuf = [];
  let list = false;
  let table = [];
  const closeList = () => {
    if (list) {
      out.push("</ul>");
      list = false;
    }
  };
  const flushTable = () => {
    if (table.length) {
      closeList();
      out.push(renderTable(table, fromPath));
      table = [];
    }
  };
  for (const raw of lines) {
    const fenceMatch = raw.match(/^```(\w*)/);
    if (fenceMatch && !fence) {
      flushTable();
      closeList();
      fence = fenceMatch[1] || "text";
      fenceBuf = [];
      continue;
    }
    if (fence && raw.startsWith("```")) {
      out.push(`<pre class="ctx-wiki-fence"><code>${esc(fenceBuf.join("\n"))}</code></pre>`);
      fence = null;
      continue;
    }
    if (fence) {
      fenceBuf.push(raw);
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(raw)) {
      closeList();
      table.push(raw);
      continue;
    }
    flushTable();
    if (/^\s*$/.test(raw)) {
      closeList();
      continue;
    }
    if (/^#{1,3}\s+/.test(raw)) {
      closeList();
      const level = raw.match(/^#+/)[0].length;
      out.push(`<h${level}>${inlineWiki(raw.replace(/^#+\s+/, ""), fromPath)}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(raw)) {
      if (!list) {
        out.push("<ul>");
        list = true;
      }
      out.push(`<li>${inlineWiki(raw.replace(/^[-*]\s+/, ""), fromPath)}</li>`);
      continue;
    }
    closeList();
    if (/^---+$/.test(raw.trim())) {
      out.push("<hr />");
      continue;
    }
    out.push(`<p>${inlineWiki(raw, fromPath)}</p>`);
  }
  flushTable();
  closeList();
  if (fence) out.push(`<pre class="ctx-wiki-fence"><code>${esc(fenceBuf.join("\n"))}</code></pre>`);
  return `<div class="ctx-wiki-md" data-ctx-from="${esc(fromPath)}">${out.join("\n")}</div>`;
}

export function ensureWikiCss() {
  const href = `/site/context-wiki-links.css?v=${CTXLINK_CACHE}`;
  if (typeof document === "undefined") return href;
  if (!document.querySelector(`link[data-ctxlink="${CTXLINK_CACHE}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-ctxlink", CTXLINK_CACHE);
    document.head.appendChild(link);
  }
  return href;
}

export function collectWikiLinks(root, { selectedOnly = false } = {}) {
  if (!root) return [];
  const nodes = [...root.querySelectorAll("a.ctx-wiki-link[data-ctx-path]")];
  const picked = selectedOnly
    ? nodes.filter((el) => el.classList.contains("is-ctx-picked") || linkInDomSelection(el))
    : nodes;
  const use = picked.length ? picked : nodes.filter((el) => el.classList.contains("is-ctx-picked"));
  const rows = [];
  const seen = new Set();
  for (const el of use.length ? use : []) {
    const path = el.getAttribute("data-ctx-path") || "";
    if (!path || seen.has(path) || isSecretPath(path)) continue;
    seen.add(path);
    rows.push({ path, name: el.getAttribute("data-ctx-name") || fileNameOf(path), el });
  }
  return rows;
}

function linkInDomSelection(el) {
  try {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    return sel.getRangeAt(0).intersectsNode(el);
  } catch {
    return false;
  }
}

function selectedIssueText(root) {
  try {
    const sel = window.getSelection?.();
    const text = sel && !sel.isCollapsed ? String(sel.toString() || "") : "";
    if (text.trim()) return text.trim().slice(0, 800);
  } catch {
    /* ignore */
  }
  return String(root?.closest?.("[data-ctx-from]")?.textContent || "").slice(0, 200);
}

function closeWikiMenu() {
  document.querySelectorAll(".ctx-wiki-menu, .ctx-wiki-dialog-root").forEach((el) => el.remove());
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function placeMenu(menu, x, y) {
  const pad = 8;
  const w = menu.offsetWidth || 220;
  const h = menu.offsetHeight || 160;
  menu.style.left = `${Math.min(x, window.innerWidth - w - pad)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - h - pad)}px`;
}

export function bindWikiLinks(root, handlers = {}) {
  if (!root) return () => {};
  ensureWikiCss();
  const api = handlers.api;
  const onOpen = handlers.onOpen;
  const onStatus = handlers.onStatus || (() => {});

  function rowsFor(anchor) {
    const selected = collectWikiLinks(root, { selectedOnly: true });
    if (selected.length) return selected;
    const path = anchor?.getAttribute?.("data-ctx-path");
    if (!path) return [];
    return [{ path, name: anchor.getAttribute("data-ctx-name") || fileNameOf(path), el: anchor }];
  }

  function togglePick(anchor, { additive }) {
    if (!additive) {
      root.querySelectorAll("a.ctx-wiki-link.is-ctx-picked").forEach((el) => {
        if (el !== anchor) el.classList.remove("is-ctx-picked");
      });
    }
    anchor.classList.toggle("is-ctx-picked");
  }

  async function copyRows(rows) {
    const text = formatCopyPaths(rows);
    const ok = text && (await copyText(text));
    onStatus(ok ? `Copied ${rows.length} path${rows.length === 1 ? "" : "s"}.` : "Could not copy.");
    return ok;
  }

  function showMenu(event, anchor) {
    event.preventDefault();
    closeWikiMenu();
    const rows = rowsFor(anchor);
    if (!rows.length) return;
    const related = relatedStatus(rows.map((r) => r.path));
    const issueHint = selectionHasIssue(selectedIssueText(root));
    const menu = document.createElement("div");
    menu.className = "ctx-wiki-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <p class="ctx-wiki-menu-kicker">${esc(rows.length === 1 ? rows[0].name : `${rows.length} files`)}</p>
      <button type="button" data-ctx-act="open">Open file</button>
      <button type="button" data-ctx-act="copy">Copy path${rows.length > 1 ? "s" : ""}</button>
      <button type="button" data-ctx-act="debug">Add to debugger</button>
      <p class="ctx-wiki-menu-status" data-related="${related.related ? "yes" : "no"}">${esc(related.label)} — ${esc(related.reason)}${issueHint ? " · issue language in selection" : ""}</p>
    `;
    document.body.appendChild(menu);
    placeMenu(menu, event.clientX, event.clientY);
    menu.addEventListener("click", async (ev) => {
      const act = ev.target.closest("[data-ctx-act]")?.getAttribute("data-ctx-act");
      if (!act) return;
      closeWikiMenu();
      if (act === "copy") {
        await copyRows(rows);
        return;
      }
      if (act === "open") {
        const first = rows[0];
        if (typeof onOpen === "function") onOpen(first.path, rows);
        return;
      }
      if (act === "debug") {
        openDebuggerDialog(rows, { related, issueText: selectedIssueText(root), api, onStatus, fromPath: root.getAttribute("data-ctx-from") || handlers.fromPath || "" });
      }
    });
  }

  const onClick = (event) => {
    const anchor = event.target.closest?.("a.ctx-wiki-link");
    if (!anchor || !root.contains(anchor)) return;
    event.preventDefault();
    togglePick(anchor, { additive: event.metaKey || event.ctrlKey || event.shiftKey });
    if (!(event.metaKey || event.ctrlKey || event.shiftKey) && typeof onOpen === "function") {
      onOpen(anchor.getAttribute("data-ctx-path") || "", rowsFor(anchor));
    }
  };
  const onContext = (event) => {
    const anchor = event.target.closest?.("a.ctx-wiki-link");
    if (!anchor || !root.contains(anchor)) return;
    if (!anchor.classList.contains("is-ctx-picked")) togglePick(anchor, { additive: true });
    showMenu(event, anchor);
  };
  const onDocDown = (event) => {
    if (event.target.closest?.(".ctx-wiki-menu, .ctx-wiki-dialog-root, a.ctx-wiki-link")) return;
    closeWikiMenu();
  };
  root.addEventListener("click", onClick);
  root.addEventListener("contextmenu", onContext);
  document.addEventListener("mousedown", onDocDown);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("contextmenu", onContext);
    document.removeEventListener("mousedown", onDocDown);
    closeWikiMenu();
  };
}

function openDebuggerDialog(rows, { related, issueText, api, onStatus, fromPath }) {
  closeWikiMenu();
  const issue = selectionHasIssue(issueText);
  const root = document.createElement("div");
  root.className = "ctx-wiki-dialog-root";
  root.innerHTML = `
    <div class="ctx-wiki-dialog-backdrop" data-ctx-cancel></div>
    <form class="ctx-wiki-dialog" role="dialog" aria-label="Add to debugger">
      <h4>Add to debugger</h4>
      <p class="muted small">${esc(rows.map((r) => r.name).join(", "))}</p>
      <p class="ctx-wiki-menu-status" data-related="${related.related ? "yes" : "no"}">${esc(related.label)} — ${esc(related.reason)}</p>
      <label>Why do you think this happened?
        <textarea name="reason" rows="3" maxlength="800" placeholder="Short reason">${esc(issueText || "")}</textarea>
      </label>
      <label>Component status
        <select name="status">
          <option value="ok">Good</option>
          <option value="degraded" ${issue ? "selected" : ""}>Degraded</option>
          <option value="broken" ${issue ? "" : ""}>Broken</option>
        </select>
      </label>
      <div class="ctx-wiki-dialog-actions">
        <button type="button" class="btn secondary" data-ctx-cancel>Cancel</button>
        <button type="submit" class="btn accent">Send</button>
      </div>
      <p class="ctx-wiki-dialog-note muted small" data-ctx-note></p>
    </form>
  `;
  document.body.appendChild(root);
  const form = root.querySelector("form");
  const note = root.querySelector("[data-ctx-note]");
  root.querySelectorAll("[data-ctx-cancel]").forEach((el) => el.addEventListener("click", () => root.remove()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = String(form.reason.value || "").trim() || "wiki-link debugger";
    const status = form.status.value || (issue ? "degraded" : "ok");
    note.textContent = "Sending…";
    try {
      const payload = {
        paths: rows.map((r) => r.path),
        from_path: fromPath || "",
        reason,
        status,
        selected_text: String(issueText || "").slice(0, 800),
        related: related.related,
        related_label: related.label,
      };
      if (typeof api === "function") {
        const data = await api("/api/ops/context-wiki/debugger", { method: "POST", body: JSON.stringify(payload) });
        note.textContent = data?.ok ? "Logged to debugger." : (data?.error || "Sent.");
        onStatus?.("Logged to debugger.");
      } else {
        throw new Error("Not signed in as studio owner.");
      }
      setTimeout(() => root.remove(), 700);
    } catch (err) {
      note.textContent = err.message || "Could not send.";
    }
  });
}
