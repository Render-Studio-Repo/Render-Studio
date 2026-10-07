/** Collab index IDE — tree + window copied from Project Code / wiring simulator workbench. */
const INDEX_URL = "/docs/media/collab-index.json";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function treeFromFiles(files) {
  const root = { name: "collab-index", folder: true, path: "", children: [] };
  for (const file of files) {
    const parts = String(file.path || "").split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      if (last) {
        node.children.push({ name: part, path: file.path, folder: false, text: file.text || "" });
        return;
      }
      let next = node.children.find((c) => c.folder && c.name === part);
      if (!next) {
        next = { name: part, folder: true, path: parts.slice(0, i + 1).join("/"), children: [] };
        node.children.push(next);
      }
      node = next;
    });
  }
  return root;
}

export function mountCollabIde(host) {
  if (!host || host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  if (!document.querySelector("link[data-code-workspace-collab]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/code/project-code-editor.css?v=20260915-code-workspace3-collab1";
    link.dataset.codeWorkspaceCollab = "1";
    document.head.append(link);
  }
  host.innerHTML = `
    <section class="project-code" aria-label="Collab index IDE">
      <header class="code-head">
        <div><strong>Collab index</strong><small>Tree + window from Project Code / 3D Wiring simulator</small></div>
        <div class="code-actions"><small class="muted">BENCH-COLLAB-01 · find planted faults</small></div>
      </header>
      <div class="code-workbench">
        <aside class="code-explorer">
          <div class="code-explorer-title">EXPLORER</div>
          <input type="search" data-tree-search placeholder="Find a file…" aria-label="Filter file tree">
          <div data-file-tree></div>
        </aside>
        <main class="code-main">
          <div class="code-file-tabs" role="tablist"></div>
          <div class="code-toolbar"><span data-match-count></span></div>
          <div class="code-document" data-document></div>
          <footer class="code-status" role="status"><span data-status>Open a file from the explorer.</span><span data-file-info></span></footer>
        </main>
      </div>
    </section>
  `;
  const treeEl = host.querySelector("[data-file-tree]");
  const surface = host.querySelector("[data-document]");
  const status = host.querySelector("[data-status]");
  const search = host.querySelector("[data-tree-search]");
  let files = [];
  let active = "";

  function renderDoc() {
    const file = files.find((f) => f.path === active);
    if (!file) {
      surface.innerHTML = `<div class="code-empty"><span>‹/›</span><h3>Collab index</h3><p>Open a note from the explorer. Pitch: index notes from GET /mcp/drive-search.</p></div>`;
      return;
    }
    surface.innerHTML = `<div class="code-source"><pre class="code-highlight" style="position:static;color:#d1e0ec">${esc(file.text)}</pre></div>`;
    status.textContent = file.path;
  }

  function renderTree(q = "") {
    const filtered = files.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase()));
    const tree = treeFromFiles(filtered);
    treeEl.replaceChildren();
    const add = (item, parent) => {
      if (item.folder) {
        const details = document.createElement("details");
        details.open = true;
        const summary = document.createElement("summary");
        summary.textContent = item.name;
        details.append(summary);
        (item.children || []).forEach((c) => add(c, details));
        parent.append(details);
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-tree-file" + (active === item.path ? " active" : "");
      btn.innerHTML = `<span class="code-tree-icon">‹/›</span><span>${esc(item.name)}</span>`;
      btn.onclick = () => { active = item.path; renderTree(search.value); renderDoc(); };
      parent.append(btn);
    };
    (tree.children || []).forEach((c) => add(c, treeEl));
  }

  async function loadIndex() {
    let data = null;
    const api = await fetch("/mcp/collab-index?t=" + Date.now()).catch(() => null);
    if (api && api.ok) {
      const wrapped = await api.json();
      data = wrapped.index || wrapped;
    } else {
      const res = await fetch(INDEX_URL + "?t=" + Date.now()).catch(() => null);
      if (res && res.ok) data = await res.json();
    }
    files = (data && data.files) || [];
    renderTree(search.value);
    renderDoc();
    status.textContent = `${files.length} files · live`;
  }

  loadIndex();
  setInterval(loadIndex, 4000);
  search.addEventListener("input", () => renderTree(search.value));
}

const host = document.getElementById("team-collab-ide-host");
if (host) mountCollabIde(host);
