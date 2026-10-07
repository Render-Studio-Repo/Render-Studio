/** Searchable rich notes: workstation Sam's Notes (owner) + per-user notes. */

export const NOTES_CACHE = "20260909-notesapp1-leakfix29";
export const PERSONAL_LS_KEY = "render3d:notes:personal:v2";
export const WORKSTATION_LS_KEY = "render3d:notes:workstation:v2";
export const PERSONAL_LS_KEY_V1 = "render3d:notes:personal:v1";
export const WORKSTATION_LS_KEY_V1 = "render3d:notes:workstation:v1";

const SECRET_RE = /app secret|user token|app credentials|\bapp id\b|\bOC\|[0-9]{6,}|\bOCAQAG[0-9A-Za-z]+/i;
const NOTE_IMAGE_SRC = /^note-image:([a-z0-9]+)$/i;
const SMALL_DATA_URL = 180_000;
let mountedNotesRevoke = null; // leakfix29

export function revokeMountedNotesUrls() { // leakfix29
  try { mountedNotesRevoke?.(); } catch { /* ignore */ }
  mountedNotesRevoke = null;
}

function authHeaders() {
  try {
    const token = localStorage.getItem("render3d:token") || sessionStorage.getItem("render3d:token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function storedUser() {
  try {
    return JSON.parse(localStorage.getItem("render3d:user") || "null");
  } catch {
    return null;
  }
}

function isSuperAdminUser(user = storedUser()) {
  return Boolean(user?.super_admin);
}

const NOTE_ICON_PATH =
  "M3.5 2h6.25L13 5.25V14H3.5V2zm6.25 0v3.25H13M5.5 8h5M5.5 10h5M5.5 12h3.2";

export function notesIconSvg(size = 16) {
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${NOTE_ICON_PATH}"/></svg>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function htmlToPlainText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function looksLikeSecret(text) {
  return SECRET_RE.test(String(text ?? ""));
}

export function filterNoteText(text, query) {
  const source = String(text ?? "");
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) {
    return { text: source, matchCount: source.split(/\n/).filter((line) => line.trim()).length, filtered: false };
  }
  const hits = source.split(/\n/).filter((line) => line.toLowerCase().includes(q));
  return { text: hits.join("\n"), matchCount: hits.length, filtered: true };
}

export function filterNotesList(notes, query) {
  const q = String(query ?? "").trim().toLowerCase();
  const list = Array.isArray(notes) ? notes : [];
  if (!q) return list;
  return list.filter((note) => {
    const hay = `${note?.title || ""} ${note?.preview || ""} ${htmlToPlainText(note?.html || "")}`.toLowerCase();
    return hay.includes(q);
  });
}

export function serializeNoteHtml(html) {
  const source = String(html || "");
  if (typeof document === "undefined") {
    return source
      .replace(/src="blob:[^"]*"/g, 'src=""')
      .replace(/<(script|iframe|object|embed)[\s\S]*?<\/\1>/gi, "");
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = source;
  wrap.querySelectorAll("script,iframe,object,embed,style,form").forEach((node) => node.remove());
  wrap.querySelectorAll("img").forEach((img) => {
    const id = img.getAttribute("data-note-image") || "";
    const src = String(img.getAttribute("src") || "");
    if (id) {
      img.setAttribute("src", `note-image:${id}`);
      img.setAttribute("data-note-image", id);
    } else if (src.startsWith("data:") && src.length <= SMALL_DATA_URL) {
      /* keep small pasted data URLs */
    } else if (src.startsWith("blob:") || src.startsWith("data:")) {
      img.remove();
    }
  });
  return wrap.innerHTML;
}

function resolveKind(kind) {
  if (kind === "workstation" || kind === "personal") return kind;
  return isSuperAdminUser() ? "workstation" : "personal";
}

function storageKey(kind) {
  return kind === "workstation" ? WORKSTATION_LS_KEY : PERSONAL_LS_KEY;
}

function storageKeyV1(kind) {
  return kind === "workstation" ? WORKSTATION_LS_KEY_V1 : PERSONAL_LS_KEY_V1;
}

function readLocalStore(kind) {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(kind)) || "null");
    if (raw && Array.isArray(raw.notes)) return raw;
  } catch {
    /* ignore */
  }
  try {
    const legacy = String(localStorage.getItem(storageKeyV1(kind)) || "");
    if (legacy) {
      return {
        notes: [{
          id: "local-legacy",
          title: kind === "workstation" ? "Sam's Notes" : "Untitled",
          html: `<p>${escapeHtml(legacy).replace(/\n/g, "</p><p>")}</p>`,
          preview: legacy.slice(0, 80),
          updated_at: null,
        }],
        activeId: "local-legacy",
      };
    }
  } catch {
    /* ignore */
  }
  return { notes: [], activeId: "" };
}

function writeLocalStore(kind, store) {
  try {
    localStorage.setItem(storageKey(kind), JSON.stringify({
      notes: (store.notes || []).map((note) => ({
        id: note.id,
        title: note.title,
        html: note.html || "",
        preview: note.preview || "",
        updated_at: note.updated_at || null,
        may_contain_secrets: !!note.may_contain_secrets,
      })),
      activeId: store.activeId || "",
    }));
  } catch {
    /* ignore quota */
  }
}

function apiBase(kind) {
  return kind === "workstation" ? "/api/notes/workstation" : "/api/users/me/notes";
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.body && !(options.body instanceof FormData) && !options.headers?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = new Error(res.statusText || "Request failed");
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

async function fetchNotesList(kind) {
  return apiJson(`${apiBase(kind)}/items`);
}

async function fetchNote(kind, id) {
  return apiJson(`${apiBase(kind)}/items/${encodeURIComponent(id)}`);
}

async function createNote(kind, payload) {
  return apiJson(`${apiBase(kind)}/items`, { method: "POST", body: JSON.stringify(payload) });
}

async function saveNote(kind, id, payload) {
  return apiJson(`${apiBase(kind)}/items/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

async function deleteNote(kind, id) {
  return apiJson(`${apiBase(kind)}/items/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function uploadNoteImage(kind, blob) {
  const form = new FormData();
  const name = blob.type === "image/png" ? "paste.png" : "paste.jpg";
  form.append("file", blob, name);
  const res = await fetch(`${apiBase(kind)}/images`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: form,
  });
  if (!res.ok) {
    const err = new Error(res.statusText || "Upload failed");
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchNoteImageBlob(kind, imageId) {
  const res = await fetch(`${apiBase(kind)}/images/${encodeURIComponent(imageId)}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error("image");
  return res.blob();
}

export function notesToolbarHtml() {
  return `
    <div class="studio-notes-toolbar" role="toolbar" aria-label="Formatting">
      <button type="button" class="studio-notes-tool" data-notes-cmd="bold" title="Bold"><b>B</b></button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="italic" title="Italic"><i>I</i></button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="h1" title="Heading 1">H1</button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="h2" title="Heading 2">H2</button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="p" title="Paragraph">P</button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="ul" title="Bulleted list">•</button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="ol" title="Numbered list">1.</button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="link" title="Insert link">Link</button>
      <button type="button" class="studio-notes-tool" data-notes-cmd="photo" title="Insert photo">Photo</button>
      <input type="file" accept="image/*" class="studio-notes-file" data-notes-file hidden />
    </div>`;
}

export function notesPanelHtml({ kind = "personal", title = "", embedded = false } = {}) {
  const resolved = resolveKind(kind);
  const heading = title
    || (resolved === "workstation" ? "Sam’s Notes" : "Your notes");
  const hint = resolved === "workstation"
    ? "Private workstation notes (gitignored). Pick a note or create a new one."
    : "Saved to this account. Pick a note or create a new one.";
  return `
    <div class="studio-notes studio-notes--app ${embedded ? "studio-notes--embed" : ""}" data-notes-kind="${resolved}">
      <header class="studio-notes-head">
        <div>
          <h3 class="studio-notes-title">${escapeHtml(heading)}</h3>
          <p class="muted small studio-notes-hint">${hint}</p>
        </div>
        <button type="button" class="btn secondary btn-compact" data-notes-save>Save</button>
      </header>
      <div class="studio-notes-layout">
        <aside class="studio-notes-picker">
          <label class="studio-notes-search-wrap">
            <span class="visually-hidden">Search notes</span>
            <input type="search" class="studio-notes-search" placeholder="Search notes…" autocomplete="off" />
          </label>
          <button type="button" class="btn accent btn-compact studio-notes-new" data-notes-new>New note</button>
          <p class="muted small studio-notes-meta" data-notes-meta></p>
          <ul class="studio-notes-list" data-notes-list></ul>
        </aside>
        <section class="studio-notes-stage">
          <p class="studio-notes-empty" data-notes-empty>Select an existing note or create a new one.</p>
          <div class="studio-notes-editor-wrap hidden" data-notes-editor-wrap hidden>
            <p class="studio-notes-secret-warn hidden" data-notes-secret hidden>
              This note may contain credentials. It stays on this workstation (gitignored) and is not committed to git.
            </p>
            <input type="text" class="studio-notes-note-title" data-notes-title maxlength="200" placeholder="Note title" />
            ${notesToolbarHtml()}
            <div class="studio-notes-editor" contenteditable="true" role="textbox" aria-label="Note" spellcheck="true" data-placeholder="Write a note…"></div>
            <pre class="studio-notes-filtered hidden" hidden></pre>
          </div>
        </section>
      </div>
      <p class="muted small studio-notes-status" data-notes-status></p>
    </div>`;
}

function noteEditorPlain(editor) {
  if (!editor) return "";
  if (typeof editor.value === "string" && !editor.isContentEditable) return editor.value;
  return editor.innerText || editor.textContent || "";
}

export function applyNotesFilter(root, query) {
  const list = root?.querySelector?.("[data-notes-list]");
  if (list) {
    const q = String(query ?? "").trim().toLowerCase();
    const listItems = root.querySelectorAll("[data-note-id]");
    let shown = 0;
    listItems.forEach((el) => {
      const hay = (el.getAttribute("data-note-search") || el.textContent || "").toLowerCase();
      const match = !q || hay.includes(q);
      el.hidden = !match;
      el.classList.toggle("hidden", !match);
      if (match) shown += 1;
    });
    const meta = root.querySelector("[data-notes-meta]");
    if (meta) {
      meta.textContent = q
        ? `${shown} matching note${shown === 1 ? "" : "s"}`
        : "";
    }
    return { filtered: Boolean(q), matchCount: shown, text: "" };
  }
  const editor = root?.querySelector(".studio-notes-editor");
  const filtered = root?.querySelector(".studio-notes-filtered");
  const meta = root?.querySelector("[data-notes-meta]");
  if (!editor || !filtered) return filterNoteText("", query);
  const result = filterNoteText(noteEditorPlain(editor), query);
  const searching = result.filtered;
  editor.hidden = searching;
  editor.classList.toggle("hidden", searching);
  filtered.hidden = !searching;
  filtered.classList.toggle("hidden", !searching);
  filtered.textContent = result.text || (searching ? "No matching lines." : "");
  if (meta) {
    meta.textContent = searching
      ? `${result.matchCount} matching line${result.matchCount === 1 ? "" : "s"}`
      : "";
  }
  return result;
}

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric" });
}

function renderList(root, notes, activeId, query) {
  const list = root.querySelector("[data-notes-list]");
  if (!list) return;
  const visible = filterNotesList(notes, query);
  if (!notes.length) {
    list.innerHTML = `<li class="studio-notes-list-empty muted small">No notes yet.</li>`;
    applyNotesFilter(root, query);
    return;
  }
  list.innerHTML = notes.map((note) => {
    const hidden = query && !visible.some((row) => row.id === note.id);
    return `<li class="studio-notes-item${note.id === activeId ? " is-active" : ""}${hidden ? " hidden" : ""}"
      data-note-id="${escapeHtml(note.id)}"
      data-note-search="${escapeHtml(`${note.title || ""} ${note.preview || ""}`)}"
      ${hidden ? "hidden" : ""}>
      <button type="button" class="studio-notes-item-open" data-note-open="${escapeHtml(note.id)}">
        <span class="studio-notes-item-title">${escapeHtml(note.title || "Untitled")}</span>
        <span class="muted small studio-notes-item-meta">${escapeHtml(formatWhen(note.updated_at) || note.preview || "")}</span>
      </button>
      <button type="button" class="studio-notes-item-delete" data-note-delete="${escapeHtml(note.id)}" title="Delete note" aria-label="Delete note">×</button>
    </li>`;
  }).join("");
  applyNotesFilter(root, query);
}

function runFormat(cmd, editor) {
  editor?.focus();
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch {
    /* ignore */
  }
  if (cmd === "bold") document.execCommand("bold");
  else if (cmd === "italic") document.execCommand("italic");
  else if (cmd === "h1") document.execCommand("formatBlock", false, "H1");
  else if (cmd === "h2") document.execCommand("formatBlock", false, "H2");
  else if (cmd === "p") document.execCommand("formatBlock", false, "P");
  else if (cmd === "ul") document.execCommand("insertUnorderedList");
  else if (cmd === "ol") document.execCommand("insertOrderedList");
  else if (cmd === "link") {
    const selected = window.getSelection()?.toString() || "";
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    if (selected) document.execCommand("createLink", false, url);
    else document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`);
  }
}

function insertImageHtml(editor, src, imageId) {
  editor.focus();
  const safeSrc = escapeHtml(src);
  const attr = imageId ? ` data-note-image="${escapeHtml(imageId)}"` : "";
  document.execCommand("insertHTML", false, `<img src="${safeSrc}"${attr} alt="">`);
}

export function mountNotesPanel(host, { kind = "personal", title = "", embedded = true } = {}) {
  if (!host) return null;
  revokeMountedNotesUrls(); // leakfix29 remount
  const resolved = resolveKind(kind);
  host.innerHTML = notesPanelHtml({ kind: resolved, title, embedded });
  const root = host.querySelector(".studio-notes");
  const editor = root.querySelector(".studio-notes-editor");
  const search = root.querySelector(".studio-notes-search");
  const status = root.querySelector("[data-notes-status]");
  const titleInput = root.querySelector("[data-notes-title]");
  const wrap = root.querySelector("[data-notes-editor-wrap]");
  const empty = root.querySelector("[data-notes-empty]");
  const secret = root.querySelector("[data-notes-secret]");
  const fileInput = root.querySelector("[data-notes-file]");
  let notes = [];
  let activeId = "";
  let timer = 0;
  let objectUrls = [];
  let hydrating = false;

  function setStatus(text, tone = "") {
    if (!status) return;
    status.textContent = text || "";
    status.classList.toggle("is-ok", tone === "ok");
    status.classList.toggle("is-err", tone === "error");
  }

  function revokeUrls() {
    objectUrls.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    });
    objectUrls = [];
  }
  mountedNotesRevoke = revokeUrls;

  function persistLocal() {
    writeLocalStore(resolved, { notes, activeId });
  }

  function showEmpty() {
    activeId = "";
    wrap.hidden = true;
    wrap.classList.add("hidden");
    empty.hidden = false;
    empty.classList.remove("hidden");
    persistLocal();
    renderList(root, notes, activeId, search.value);
  }

  function showEditor() {
    empty.hidden = true;
    empty.classList.add("hidden");
    wrap.hidden = false;
    wrap.classList.remove("hidden");
  }

  function syncSecretWarn() {
    const flagged = looksLikeSecret(`${titleInput.value}\n${noteEditorPlain(editor)}`);
    secret.hidden = !flagged;
    secret.classList.toggle("hidden", !flagged);
  }

  async function hydrateImages(html) {
    revokeUrls();
    if (typeof document === "undefined") return html;
    const box = document.createElement("div");
    box.innerHTML = html || "<p></p>";
    const imgs = [...box.querySelectorAll("img")];
    for (const img of imgs) {
      const src = String(img.getAttribute("src") || "");
      const fromSrc = src.match(NOTE_IMAGE_SRC)?.[1];
      const id = img.getAttribute("data-note-image") || fromSrc || "";
      if (!id) continue;
      try {
        const blob = await fetchNoteImageBlob(resolved, id);
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        img.src = url;
        img.setAttribute("data-note-image", id);
      } catch {
        img.alt = "Photo unavailable";
      }
    }
    return box.innerHTML;
  }

  async function openNote(id, { silent = false } = {}) {
    const summary = notes.find((n) => n.id === id);
    if (!summary) return;
    hydrating = true;
    activeId = id;
    showEditor();
    renderList(root, notes, activeId, search.value);
    persistLocal();
    titleInput.value = summary.title || "Untitled";
    let html = summary.html;
    if (!html) {
      try {
        const full = await fetchNote(resolved, id);
        html = full?.html || "";
        Object.assign(summary, full);
      } catch {
        html = summary.html || "";
      }
    }
    editor.innerHTML = await hydrateImages(serializeNoteHtml(html || "<p></p>"));
    syncSecretWarn();
    hydrating = false;
    if (!silent) setStatus("Loaded.", "ok");
  }

  function currentPayload() {
    return {
      title: titleInput.value.trim() || "Untitled",
      html: serializeNoteHtml(editor.innerHTML),
    };
  }

  function persist(payload = currentPayload(), { silent = false } = {}) {
    if (!activeId || hydrating) return Promise.resolve();
    const idx = notes.findIndex((n) => n.id === activeId);
    if (idx >= 0) {
      notes[idx] = {
        ...notes[idx],
        ...payload,
        preview: htmlToPlainText(payload.html).slice(0, 80),
        updated_at: new Date().toISOString(),
        may_contain_secrets: looksLikeSecret(`${payload.title}\n${htmlToPlainText(payload.html)}`),
      };
      notes.unshift(notes.splice(idx, 1)[0]);
    }
    persistLocal();
    renderList(root, notes, activeId, search.value);
    syncSecretWarn();
    if (String(activeId).startsWith("local-")) {
      if (!silent) setStatus("Saved in this browser only.", "error");
      return Promise.resolve();
    }
    return saveNote(resolved, activeId, payload)
      .then((data) => {
        const found = notes.find((n) => n.id === activeId);
        if (found && data) Object.assign(found, data);
        persistLocal();
        renderList(root, notes, activeId, search.value);
        if (!silent) setStatus("Saved.", "ok");
      })
      .catch((err) => {
        if (!silent) setStatus(err.status === 401 || err.status === 403
          ? "Saved in this browser only."
          : (err.message || "Saved locally."), "error");
      });
  }

  function schedulePersist() {
    persistLocal();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void persist(currentPayload(), { silent: true });
    }, 700);
  }

  async function addImageBlob(blob) {
    if (!blob || !String(blob.type || "").startsWith("image/")) return;
    if (!activeId) return;
    try {
      const saved = await uploadNoteImage(resolved, blob);
      const local = URL.createObjectURL(blob);
      objectUrls.push(local);
      insertImageHtml(editor, local, saved.id);
      schedulePersist();
      setStatus("Photo added.", "ok");
    } catch (err) {
      if (blob.size <= SMALL_DATA_URL) {
        const reader = new FileReader();
        reader.onload = () => {
          insertImageHtml(editor, String(reader.result || ""), "");
          schedulePersist();
          setStatus("Photo saved in the note (local).", "error");
        };
        reader.readAsDataURL(blob);
        return;
      }
      setStatus(err.message || "Could not add photo.", "error");
    }
  }

  search.addEventListener("input", () => {
    applyNotesFilter(root, search.value);
  });
  editor.addEventListener("input", () => {
    syncSecretWarn();
    schedulePersist();
  });
  titleInput.addEventListener("input", () => {
    syncSecretWarn();
    schedulePersist();
  });
  editor.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    files.forEach((file) => { void addImageBlob(file); });
  });
  editor.addEventListener("drop", (event) => {
    const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    files.forEach((file) => { void addImageBlob(file); });
  });
  editor.addEventListener("dragover", (event) => {
    if ([...(event.dataTransfer?.items || [])].some((item) => item.type.startsWith("image/"))) {
      event.preventDefault();
    }
  });
  root.querySelector("[data-notes-save]")?.addEventListener("click", () => {
    void persist(currentPayload());
  });
  root.querySelector("[data-notes-new]")?.addEventListener("click", () => {
    void (async () => {
      try {
        const created = await createNote(resolved, { title: "Untitled", html: "<p></p>" });
        notes.unshift(created);
        persistLocal();
        await openNote(created.id);
        titleInput.focus();
        titleInput.select();
        setStatus("New note.", "ok");
      } catch (err) {
        const local = {
          id: `local-${Date.now()}`,
          title: "Untitled",
          html: "<p></p>",
          preview: "",
          updated_at: new Date().toISOString(),
        };
        notes.unshift(local);
        persistLocal();
        await openNote(local.id, { silent: true });
        setStatus(err.status === 401 || err.status === 403
          ? "Created in this browser only."
          : "Could not reach server — created locally.", "error");
      }
    })();
  });
  root.querySelector(".studio-notes-toolbar")?.addEventListener("mousedown", (event) => {
    const btn = event.target.closest("[data-notes-cmd]");
    if (!btn) return;
    event.preventDefault();
  });
  root.querySelector(".studio-notes-toolbar")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-notes-cmd]");
    if (!btn) return;
    const cmd = btn.getAttribute("data-notes-cmd");
    if (cmd === "photo") {
      fileInput?.click();
      return;
    }
    runFormat(cmd, editor);
    schedulePersist();
  });
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void addImageBlob(file);
  });
  root.querySelector("[data-notes-list]")?.addEventListener("click", (event) => {
    const del = event.target.closest("[data-note-delete]");
    if (del) {
      event.preventDefault();
      const id = del.getAttribute("data-note-delete");
      const note = notes.find((n) => n.id === id);
      if (!id || !note) return;
      if (!window.confirm(`Delete “${note.title || "Untitled"}”?`)) return;
      void (async () => {
        try {
          if (!String(id).startsWith("local-")) await deleteNote(resolved, id);
        } catch {
          /* still remove locally */
        }
        notes = notes.filter((n) => n.id !== id);
        if (activeId === id) {
          if (notes[0]) await openNote(notes[0].id, { silent: true });
          else showEmpty();
        } else {
          persistLocal();
          renderList(root, notes, activeId, search.value);
        }
        setStatus("Deleted.", "ok");
      })();
      return;
    }
    const open = event.target.closest("[data-note-open]");
    if (open) {
      void openNote(open.getAttribute("data-note-open"));
    }
  });

  const cached = readLocalStore(resolved);
  notes = cached.notes || [];
  renderList(root, notes, cached.activeId, "");
  if (cached.activeId && notes.some((n) => n.id === cached.activeId)) {
    void openNote(cached.activeId, { silent: true });
  } else if (notes.length) {
    showEmpty();
  } else {
    showEmpty();
  }
  setStatus("Loading…");
  void fetchNotesList(resolved)
    .then(async (data) => {
      const remote = Array.isArray(data?.notes) ? data.notes : [];
      notes = remote;
      persistLocal();
      renderList(root, notes, activeId, search.value);
      const prefer = (cached.activeId && notes.some((n) => n.id === cached.activeId))
        ? cached.activeId
        : "";
      if (prefer) await openNote(prefer, { silent: true });
      else if (notes.length === 1) await openNote(notes[0].id, { silent: true });
      else showEmpty();
      setStatus(resolved === "workstation" ? "Synced with Sam's Notes (private)." : "Loaded.", "ok");
    })
    .catch((err) => {
      renderList(root, notes, activeId, search.value);
      setStatus(err.status === 401 || err.status === 403
        ? "Using notes saved in this browser."
        : "Could not reach server — using local notes.", "error");
    });
  return root;
}

let modalHost = null;

function ensureModal() {
  if (modalHost) return modalHost;
  modalHost = document.createElement("div");
  modalHost.id = "studio-notes-modal";
  modalHost.className = "studio-notes-modal hidden";
  modalHost.hidden = true;
  modalHost.innerHTML = `
    <div class="studio-notes-modal-backdrop" data-notes-close></div>
    <div class="studio-notes-modal-card" role="dialog" aria-modal="true" aria-labelledby="studio-notes-modal-title">
      <button type="button" class="studio-notes-modal-close" data-notes-close aria-label="Close notes">×</button>
      <div id="studio-notes-modal-body"></div>
    </div>`;
  document.body.appendChild(modalHost);
  modalHost.addEventListener("click", (event) => {
    if (event.target.closest("[data-notes-close]")) closeStudioNotesModal();
  });
  return modalHost;
}

export function closeStudioNotesModal() {
  revokeMountedNotesUrls(); // leakfix29
  if (!modalHost) return;
  modalHost.classList.add("hidden");
  modalHost.hidden = true;
}

export function openStudioNotesModal({ kind = "auto", title = "" } = {}) {
  const host = ensureModal();
  const body = host.querySelector("#studio-notes-modal-body");
  mountNotesPanel(body, { kind: resolveKind(kind), title, embedded: false });
  const heading = body.querySelector(".studio-notes-title");
  if (heading) heading.id = "studio-notes-modal-title";
  host.classList.remove("hidden");
  host.hidden = false;
  body.querySelector(".studio-notes-search")?.focus();
}

export function bindNotesTriggers(root = document) {
  root.querySelectorAll("[data-studio-notes]").forEach((btn) => {
    if (btn.dataset.notesBound === "1") return;
    btn.dataset.notesBound = "1";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      openStudioNotesModal({ kind: btn.getAttribute("data-studio-notes") || "auto" });
    });
  });
}

export function notesFabHtml({ kind = "auto" } = {}) {
  const resolved = resolveKind(kind);
  const title = resolved === "workstation" ? "Sam’s Notes" : "Your notes";
  return `<button type="button" id="studio-notes-fab" class="studio-notes-fab" data-studio-notes="${resolved}" title="${title}" aria-label="Open notes">${notesIconSvg(18)}</button>`;
}

/** Slim fixed note icon (bottom-right). Click opens the notes picker/editor. */
export function mountNotesFab(host = typeof document !== "undefined" ? document.body : null, { kind = "auto" } = {}) {
  if (!host) return null;
  const resolved = resolveKind(kind);
  let fab = typeof document !== "undefined" ? document.getElementById("studio-notes-fab") : null;
  if (!fab) {
    host.insertAdjacentHTML("beforeend", notesFabHtml({ kind: resolved }));
    fab = typeof document !== "undefined" ? document.getElementById("studio-notes-fab") : host.querySelector("#studio-notes-fab");
  } else {
    fab.setAttribute("data-studio-notes", resolved);
    fab.title = resolved === "workstation" ? "Sam’s Notes" : "Your notes";
  }
  bindNotesTriggers(fab?.parentElement || host);
  return fab;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bindNotesTriggers(document), { once: true });
  } else {
    bindNotesTriggers(document);
  }
}
