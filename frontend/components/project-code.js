/** Detect project-code uploads and folder actions for the code viewer. */

export const PROJECT_CODE_FOLDER = "Project Code";
export const CODE_DUMP_FOLDER = "Dropped files";

export const CODE_FILE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|css|scss|less|html?|json|jsonc|vue|svelte|ino|c|cc|cpp|cxx|h|hpp|java|go|rs|rb|php|sql|toml|ini|cfg|xml|ya?ml|sh|bash|zsh|kt|kts|swift|cs|lua|r)$/i;
const STRONG_CODE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|css|scss|less|html?|vue|svelte|ino|c|cc|cpp|cxx|h|hpp|java|go|rs|rb|php|sh|bash|zsh|kt|kts|swift|cs)$/i;
const CODE_NAMES = new Set(["Dockerfile", "Makefile", "CMakeLists.txt", "requirements.txt", "Pipfile", "Gemfile"]);
const CAD_RE = /\.(step|stp|stl|glb|gltf|3mf|obj|sldprt|sldasm|f3d|f3z|iges|igs|brep|brp)$/i;
const EDITOR_FILE_RE = /\.(pdf|xlsx?|csv|tsv|png|jpe?g|webp|gif|bmp|svg|tiff?|txt|md|markdown)$/i;
export const MODEL_FILE_RE = /\.(glb|gltf|stl|step|stp|obj|3mf|ply|off)$/i;
export const EXECUTABLE_FILE_RE = /\.(exe|dll|so|dylib|bin|app|com|msi|bat|cmd|ps1|apk|dmg|pkg)$/i;
const SKIP_DROP_DIRS = new Set([".git", ".svn", "node_modules", "__pycache__", ".venv", "venv", "__MACOSX"]);
const TYPE_FILTER_RE = /^(js|mjs|cjs|jsx|ts|tsx|py|json|jsonc|css|html|htm|md|png|jpe?g|webp|gif|svg|glb|gltf|stl|step|stp|pdf|txt|csv|xml|yml|yaml)$/i;
const MAX_DROP_FILES = 2000;

export function isCodeFilename(name = "") {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  return CODE_FILE_RE.test(base) || CODE_NAMES.has(base);
}

export function isExecutableFilename(name = "") {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  return EXECUTABLE_FILE_RE.test(base);
}

export function isModelFilename(name = "") {
  return MODEL_FILE_RE.test(String(name || "").replace(/\\/g, "/").split("/").pop() || "");
}

export function dumpFolderRoot() {
  return `references/${PROJECT_CODE_FOLDER}/${CODE_DUMP_FOLDER}`;
}

export function codeFolderRootFromEntry(entry = {}) {
  const folder = String(entry?.folder || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (folder) return folder.startsWith("references/") ? folder : `references/${folder}`;
  const path = String(entry?.url || entry?.filename || entry?.path || entry?.name || "").replace(/\\/g, "/");
  const parts = path.split("/").filter((part) => part && part !== "." && part !== "..");
  if (parts.length > 1) return parts.slice(0, -1).join("/");
  return `references/${PROJECT_CODE_FOLDER}`;
}

export function isStrongCodeFilename(name = "") {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  return STRONG_CODE_RE.test(base) || CODE_NAMES.has(base);
}

export function isProjectCodeFolder(entry = {}) {
  const folder = String(entry?.folder || "").replace(/\\/g, "/");
  const name = String(entry?.label || entry?.children_label || entry?.name || "");
  return /^(Project Code)(\/|$)/i.test(folder) || /^Project Code$/i.test(name);
}

export function isCanvasBoardFolder(entry = {}) {
  return /^Canvas\/[^/]+$/i.test(String(entry?.folder || "").replace(/\\/g, "/"));
}

export function flattenFolderFiles(entry, out = []) {
  if (!entry) return out;
  if (entry.virtual_folder && Array.isArray(entry.children)) {
    for (const child of entry.children) flattenFolderFiles(child, out);
    return out;
  }
  if (entry.name || entry.filename || entry.url) out.push(entry);
  return out;
}

export function folderHasCode(entry = {}) {
  return flattenFolderFiles(entry).some((row) => isCodeFilename(row.name || row.filename || ""));
}

export function folderHasEditorFiles(entry = {}) {
  return flattenFolderFiles(entry).some((row) => {
    const name = String(row.name || row.filename || "");
    return isCodeFilename(name) || EDITOR_FILE_RE.test(name);
  });
}

export function folderShareEntry(entry = {}) {
  const files = flattenFolderFiles(entry);
  const scored = files.map((row) => {
    const name = String(row.name || row.filename || "").split("/").pop().toLowerCase();
    let score = Number(row.mtime) || 0;
    if (name === "canvas.png" || name === "preview.png") score += 1e15;
    else if (/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) score += 1e12;
    else if (/canvas\.json$/i.test(name)) score += 1e11;
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.row || null;
}

export function looksLikeCodeFileList(files = []) {
  const list = [...(files || [])].filter(Boolean);
  if (!list.length) return false;
  const names = list.map((file) => String(file.webkitRelativePath || file.name || ""));
  const strong = names.filter((name) => isStrongCodeFilename(name)).length;
  const code = names.filter((name) => isCodeFilename(name)).length;
  const cad = names.filter((name) => CAD_RE.test(name)).length;
  const nested = names.some((name) => name.includes("/"));
  if (cad && !strong) return false;
  if (list.length === 1 && /\.zip$/i.test(names[0]) && !nested) return false;
  if (nested && strong) return true;
  if (strong >= 2) return true;
  if (list.length === 1 && isCodeFilename(names[0]) && !cad) return true;
  return code > 0 && !cad && nested;
}

export function codeBundleName(files = []) {
  const paths = [...(files || [])]
    .map((file) => String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/"))
    .filter(Boolean);
  const firsts = paths.map((path) => path.split("/").filter(Boolean)[0]).filter(Boolean);
  if (firsts.length && firsts.every((part) => part === firsts[0]) && paths.some((path) => path.includes("/"))) {
    return firsts[0];
  }
  const zip = paths.find((name) => /\.zip$/i.test(name));
  if (zip) return zip.replace(/\.zip$/i, "") || "Uploaded code";
  return "Project code";
}

export function codeTreeFromEntries(entries = [], rootFolder = PROJECT_CODE_FOLDER) {
  const root = String(rootFolder || PROJECT_CODE_FOLDER).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const files = [];
  for (const entry of entries || []) {
    const path = String(entry.path || entry.url || entry.filename || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    const name = String(entry.name || path.split("/").pop() || "");
    if (!path && !name) continue;
    const full = path.includes("/") ? path : (entry.folder ? `references/${entry.folder}/${name}` : name);
    files.push({
      path: full,
      name: name || full.split("/").pop(),
      kind: entry.kind || "",
      size: entry.size,
    });
  }
  const prefix = root.startsWith("references/") ? root : `references/${root}`;
  return nestCodePaths(files, prefix);
}

function nestCodePaths(files, prefix) {
  const root = { name: prefix.split("/").pop() || PROJECT_CODE_FOLDER, path: prefix, children: [] };
  const folders = new Map([["", root]]);
  const relOf = (path) => {
    const full = String(path || "").replace(/\\/g, "/");
    if (full === prefix || full === `${prefix}/`) return "";
    if (full.startsWith(`${prefix}/`)) return full.slice(prefix.length + 1);
    return full;
  };
  for (const file of files) {
    const rel = relOf(file.path);
    const parts = rel.split("/").filter(Boolean);
    if (!parts.length) continue;
    let cursor = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      const next = cursor ? `${cursor}/${parts[i]}` : parts[i];
      if (!folders.has(next)) {
        const node = { name: parts[i], path: `${prefix}/${next}`, children: [] };
        folders.get(cursor)?.children.push(node);
        folders.set(next, node);
      }
      cursor = next;
    }
    folders.get(cursor)?.children.push({
      name: parts[parts.length - 1],
      path: file.path,
      kind: file.kind,
      size: file.size,
    });
  }
  const sortNode = (node) => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      const ad = Array.isArray(a.children) ? 0 : 1;
      const bd = Array.isArray(b.children) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
    });
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

export function flattenCodeTree(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node.children)) {
    for (const child of node.children) flattenCodeTree(child, out);
    return out;
  }
  if (node.path) out.push(node);
  return out;
}

export function entryMatchesNameAndType(entry = {}, query = "") {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const name = String(entry?.name || entry?.filename || entry?.label || entry?.stem || entry?.children_label || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const hay = [name, entry?.folder, entry?.kind, ext].filter(Boolean).join(" ").toLowerCase();
  return tokens.every((tok) => {
    if (TYPE_FILTER_RE.test(tok)) return ext === tok || name.endsWith(`.${tok}`) || hay.includes(tok);
    return hay.includes(tok);
  });
}

export function filterEntriesByNameAndType(items = [], query = "") {
  const q = String(query || "").trim();
  if (!q) return [...(items || [])];
  return (items || []).map((entry) => {
    if (entry?.virtual_folder && Array.isArray(entry.children)) {
      const kids = filterEntriesByNameAndType(entry.children, query);
      if (entryMatchesNameAndType(entry, query)) return { ...entry, children: kids.length ? kids : entry.children };
      if (kids.length) return { ...entry, children: kids };
      return null;
    }
    return entryMatchesNameAndType(entry, query) ? entry : null;
  }).filter(Boolean);
}

function stampRelativePath(file, rel) {
  try {
    Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: rel });
  } catch {
    try { file.webkitRelativePath = rel; } catch { /* ignore */ }
  }
  return file;
}

async function walkDroppedEntry(entry, out, prefix = "") {
  if (!entry || out.length >= MAX_DROP_FILES) return;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const rel = prefix ? `${prefix}/${file.name}` : (file.webkitRelativePath || file.name);
    out.push(stampRelativePath(file, rel));
    return;
  }
  if (!entry.isDirectory) return;
  const name = String(entry.name || "");
  if (SKIP_DROP_DIRS.has(name)) return;
  const nextPrefix = prefix ? `${prefix}/${name}` : name;
  const reader = entry.createReader();
  const readBatch = async () => {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return;
    for (const child of batch) {
      if (out.length >= MAX_DROP_FILES) return;
      await walkDroppedEntry(child, out, nextPrefix);
    }
    await readBatch();
  };
  await readBatch();
}

export async function collectDroppedCodeFiles(dataTransfer) {
  const out = [];
  const items = [...(dataTransfer?.items || [])];
  const canWalk = items.some((item) => typeof item.webkitGetAsEntry === "function" && item.webkitGetAsEntry());
  if (canWalk) {
    await Promise.all(items.map((item) => walkDroppedEntry(item.webkitGetAsEntry?.(), out)));
    if (out.length) return out.slice(0, MAX_DROP_FILES);
  }
  return [...(dataTransfer?.files || [])].slice(0, MAX_DROP_FILES);
}
