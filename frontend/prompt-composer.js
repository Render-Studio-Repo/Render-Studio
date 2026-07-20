/** Cursor-style @reference chips + in-prompt @mentions for the AI prompt */

import { removeReferenceMarker } from "./picking.js?v=20260715-sharp-labels";

export function createPromptComposer({
  textarea,
  chipsEl,
  inlineChipsEl = null,
  refsListEl,
  onReferencesChange,
  getMentionables = () => [],
  onUnlinkMentionable = null,
}) {
  const references = [];
  let inlineExpanded = false;
  const INLINE_VISIBLE_LIMIT = 3;
  let syncingEditor = false;
  let mentionMenuIndex = 0;
  let mentionQuery = null;
  let mentionItems = [];

  const editorWrap = document.createElement("div");
  editorWrap.className = "prompt-editor-wrap";
  const editor = document.createElement("div");
  editor.className = "prompt-editor";
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("aria-label", textarea?.getAttribute("aria-label") || "AI CAD prompt");
  editor.dataset.placeholder = textarea?.placeholder || "Describe what to make or edit. Type @ to link an uploaded file…";
  const mentionMenu = document.createElement("div");
  mentionMenu.className = "prompt-mention-menu hidden";
  mentionMenu.setAttribute("role", "listbox");
  mentionMenu.setAttribute("aria-label", "Link prompt reference");

  if (textarea?.parentNode) {
    textarea.classList.add("prompt-input--mirror");
    textarea.setAttribute("aria-hidden", "true");
    textarea.tabIndex = -1;
    textarea.parentNode.insertBefore(editorWrap, textarea);
    editorWrap.append(editor, textarea, mentionMenu);
  }

  function notifyRefs() {
    onReferencesChange?.(getReferences());
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeReg(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatCoords(pos) {
    if (!Array.isArray(pos)) return "";
    return pos.map((v) => (v * 1000).toFixed(1)).join(", ") + " mm";
  }

  function formatRefDetail(ref) {
    if (ref.type === "face" || ref.type === "edge" || ref.type === "corner" || ref.type === "lasso") return ref.label || formatCoords(ref.position);
    if (ref.type === "component") return ref.label || ref.stem || ref.filename || "component";
    if (ref.type === "sketch") return ref.label || ref.stem || "sketch";
    if (ref.type === "wiring") return ref.label || ref.stem || "wiring";
    if (ref.type === "dxf") return ref.label || ref.filename || "DXF";
    if (ref.type === "document" || ref.type === "spec") return ref.label || ref.filename || "document";
    if (ref.type === "image") return ref.label || ref.filename || "image";
    if (ref.type === "path") return ref.label || `${(ref.loop_points || []).length} pts`;
    return formatCoords(ref.position);
  }

  function formatToken(ref) {
    return ref.token || `@${ref.id}`;
  }

  function shortenChipLabel(text, max = 28) {
    const value = String(text || "").trim();
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(8, max - 1))}…`;
  }

  function formatChipLabel(ref) {
    const detail = formatRefDetail(ref);
    if (detail && !/^[-+]?\d/.test(detail) && detail.length <= 36) {
      return detail.startsWith("@") ? detail : `@${detail}`;
    }
    return shortenChipLabel(formatToken(ref), 32);
  }

  function attachChipHandlers(chip, ref) {
    chip.querySelector(".ref-remove")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRef(ref.id);
    });
    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("ref-remove")) return;
      if (chip.classList.contains("ref-chip--inline")) {
        editor.focus();
        return;
      }
      insertToken(ref.token);
    });
  }

  function createChipElement(ref, { inline = false } = {}) {
    const chip = document.createElement("span");
    chip.className = inline ? "ref-chip ref-chip--inline" : "ref-chip";
    chip.dataset.refId = ref.id;
    chip.title = formatToken(ref);
    if (inline) {
      chip.innerHTML = `<span class="ref-token">${escapeHtml(formatChipLabel(ref))}</span><button type="button" class="ref-remove" title="Remove">×</button>`;
    } else {
      const detail = formatRefDetail(ref);
      const token = formatToken(ref);
      const showDetail = detail && detail !== token && !token.endsWith(detail);
      chip.innerHTML = `<span class="ref-token">${escapeHtml(shortenChipLabel(token, 36))}</span>${
        showDetail ? `<span class="ref-coords">${escapeHtml(shortenChipLabel(detail, 24))}</span>` : ""
      }<button type="button" class="ref-remove" title="Remove">×</button>`;
    }
    attachChipHandlers(chip, ref);
    return chip;
  }

  function createRefLineElement(ref) {
    const line = document.createElement("div");
    line.className = "ref-line";
    line.dataset.refId = ref.id;
    const token = formatToken(ref);

    const details = document.createElement("span");
    details.className = "ref-line-details";
    const code = document.createElement("code");
    code.textContent = token;
    details.appendChild(code);
    details.append(` → ${ref.label || formatRefDetail(ref)}`);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ref-line-remove";
    remove.title = "Remove reference";
    remove.setAttribute("aria-label", `Remove ${ref.label || token || "reference"}`);
    remove.textContent = "×";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRef(ref.id);
    });

    line.append(details, remove);
    return line;
  }

  function renderRefsList(summary = "") {
    if (!refsListEl) return;
    refsListEl.innerHTML = "";
    if (!references.length) {
      refsListEl.innerHTML = '<span class="muted small">Click the model to pick; click again to deselect. Drag components from the explorer into the prompt. Type <code>@</code> to link files, objects, or the selected face.</span>';
      return;
    }
    if (summary) {
      const summaryEl = document.createElement("div");
      summaryEl.className = "ref-summary";
      summaryEl.textContent = `${references.length} references active`;
      refsListEl.appendChild(summaryEl);
    }
    for (const ref of references) {
      refsListEl.appendChild(createRefLineElement(ref));
    }
  }

  function renderChips() {
    if (chipsEl) chipsEl.innerHTML = "";
    if (inlineChipsEl) {
      inlineChipsEl.innerHTML = "";
      inlineChipsEl.classList.toggle("hidden", references.length === 0);
    }
    if (references.length <= INLINE_VISIBLE_LIMIT) inlineExpanded = false;

    const explorerRefs = references.filter(
      (ref) =>
        ref.type === "component" ||
        ref.type === "sketch" ||
        ref.type === "wiring" ||
        ref.type === "dxf" ||
        ref.type === "document" ||
        ref.type === "spec" ||
        ref.type === "image",
    );

    if (chipsEl) {
      references.forEach((ref) => {
        chipsEl.appendChild(createChipElement(ref));
      });
    }

    if (inlineChipsEl) {
      if (explorerRefs.length > 0) {
        const count = document.createElement("div");
        count.className = "prompt-ref-count";
        count.textContent =
          explorerRefs.length === 1
            ? "1 file linked — type @ to insert"
            : `${explorerRefs.length} files linked — type @ to insert`;
        inlineChipsEl.appendChild(count);
      }
      const inlineRefs = inlineExpanded ? references : references.slice(0, INLINE_VISIBLE_LIMIT);
      for (const ref of inlineRefs) {
        inlineChipsEl.appendChild(createChipElement(ref, { inline: true }));
      }
      const hiddenCount = references.length - INLINE_VISIBLE_LIMIT;
      if (hiddenCount > 0) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "ref-chip ref-chip--inline ref-chip--more";
        more.textContent = inlineExpanded
          ? "Show less"
          : `+${hiddenCount} more (${references.length} total)`;
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          inlineExpanded = !inlineExpanded;
          renderChips();
        });
        inlineChipsEl.appendChild(more);
      }
    }

    renderRefsList(references.length > INLINE_VISIBLE_LIMIT);
    syncEditorFromTextarea({ preserveCaret: true });
  }

  function shouldSkipReference(ref) {
    if (!ref?.id) return true;
    if (references.some((r) => r.id === ref.id)) return true;
    if (ref.type === "face" && ref.planar_key) {
      if (references.some((r) => r.type === "face" && r.planar_key === ref.planar_key)) return true;
    }
    if (ref.type === "face" && ref.face_key) {
      if (references.some((r) => r.type === "face" && r.face_key === ref.face_key)) return true;
    }
    return false;
  }

  function createMentionNode(ref) {
    const token = formatToken(ref);
    const mention = document.createElement("span");
    mention.className = "prompt-mention";
    mention.contentEditable = "false";
    mention.dataset.refId = ref.id;
    mention.dataset.token = token;
    mention.setAttribute("data-type", ref.type || "component");
    mention.title = token;
    const label = document.createElement("span");
    label.className = "prompt-mention-label";
    label.textContent = formatChipLabel(ref);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "prompt-mention-remove";
    remove.title = "Unlink";
    remove.setAttribute("aria-label", `Unlink ${token}`);
    remove.textContent = "×";
    remove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeRef(ref.id);
    });
    mention.append(label, remove);
    return mention;
  }

  function tokenizePlainText(text) {
    const tokens = references
      .map((ref) => formatToken(ref))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (!tokens.length || !text) {
      return [{ type: "text", value: text || "" }];
    }
    const pattern = new RegExp(`(${tokens.map(escapeReg).join("|")})`, "g");
    const parts = [];
    let last = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) {
        parts.push({ type: "text", value: text.slice(last, match.index) });
      }
      const token = match[1];
      const ref = references.find((r) => formatToken(r) === token);
      if (ref) parts.push({ type: "mention", ref, token });
      else parts.push({ type: "text", value: token });
      last = match.index + token.length;
    }
    if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
    return parts.length ? parts : [{ type: "text", value: text }];
  }

  function appendTextWithBreaks(parent, text) {
    const lines = String(text || "").split("\n");
    lines.forEach((line, index) => {
      if (line) parent.appendChild(document.createTextNode(line));
      if (index < lines.length - 1) parent.appendChild(document.createElement("br"));
    });
  }

  function buildEditorFragment(text) {
    const frag = document.createDocumentFragment();
    for (const part of tokenizePlainText(text)) {
      if (part.type === "mention") {
        frag.appendChild(createMentionNode(part.ref));
      } else {
        appendTextWithBreaks(frag, part.value);
      }
    }
    return frag;
  }

  function getCaretPlainOffset() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return serializeEditor().length;
    const range = sel.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    const probe = range.cloneContents();
    const tmp = document.createElement("div");
    tmp.appendChild(probe);
    return serializeFromNode(tmp).length;
  }

  function setCaretPlainOffset(offset) {
    let remaining = Math.max(0, Number(offset) || 0);

    const placeInText = (textNode, at) => {
      const range = document.createRange();
      range.setStart(textNode, Math.max(0, Math.min(at, textNode.textContent.length)));
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };

    const placeAfter = (node) => {
      const range = document.createRange();
      range.setStartAfter(node);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };

    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (remaining < 0) return true;
        if (child.nodeType === Node.TEXT_NODE) {
          const len = child.textContent.length;
          if (remaining <= len) {
            placeInText(child, remaining);
            remaining = -1;
            return true;
          }
          remaining -= len;
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.classList?.contains("prompt-mention")) {
          const token = child.dataset.token || "";
          if (remaining <= token.length) {
            placeAfter(child);
            remaining = -1;
            return true;
          }
          remaining -= token.length;
          continue;
        }
        if (child.tagName === "BR") {
          if (remaining <= 1) {
            placeAfter(child);
            remaining = -1;
            return true;
          }
          remaining -= 1;
          continue;
        }
        if (walk(child)) return true;
      }
      return false;
    };

    if (!walk(editor)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function serializeFromNode(root) {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent || "";
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.classList?.contains("prompt-mention")) {
        out += node.dataset.token || "";
        return;
      }
      if (node.tagName === "BR") {
        out += "\n";
        return;
      }
      if (node.tagName === "DIV" || node.tagName === "P") {
        if (out && !out.endsWith("\n")) out += "\n";
      }
      for (const child of node.childNodes) walk(child);
    };
    for (const child of root.childNodes) walk(child);
    return out.replace(/\u00a0/g, " ");
  }

  function serializeEditor() {
    return serializeFromNode(editor);
  }

  function syncTextareaFromEditor({ emitInput = true } = {}) {
    if (!textarea) return;
    syncingEditor = true;
    const text = serializeEditor();
    const changed = textarea.value !== text;
    if (changed) textarea.value = text;
    // Reading the prompt must not re-fire input (that loops into save → getRawPromptText → sync).
    if (changed && emitInput) textarea.dispatchEvent(new Event("input", { bubbles: true }));
    syncingEditor = false;
    editor.classList.toggle("is-empty", !text.trim());
  }

  function syncEditorFromTextarea({ preserveCaret = false } = {}) {
    if (!textarea) return;
    const text = textarea.value || "";
    const caret = preserveCaret ? getCaretPlainOffset() : null;
    syncingEditor = true;
    editor.innerHTML = "";
    editor.appendChild(buildEditorFragment(text));
    editor.classList.toggle("is-empty", !text.trim());
    syncingEditor = false;
    if (preserveCaret && document.activeElement === editor && caret != null) {
      setCaretPlainOffset(caret);
    }
  }

  function hideMentionMenu() {
    mentionQuery = null;
    mentionItems = [];
    mentionMenuIndex = 0;
    mentionMenu.classList.add("hidden");
    mentionMenu.innerHTML = "";
  }

  function renderMentionMenu() {
    if (!mentionItems.length) {
      mentionMenu.innerHTML = `<div class="prompt-mention-empty">No references match. Import or select a model item, then type <code>@</code>.</div>`;
      mentionMenu.classList.remove("hidden");
      return;
    }
    mentionMenu.innerHTML = mentionItems
      .map((item, index) => {
        const active = index === mentionMenuIndex ? " is-active" : "";
        return `
          <button type="button" class="prompt-mention-option${active}" role="option" data-index="${index}" aria-selected="${index === mentionMenuIndex}">
            <span class="prompt-mention-option-token">${escapeHtml(item.token)}</span>
            <span class="prompt-mention-option-meta">
              <strong>${escapeHtml(item.label || item.token)}</strong>
              <small>${escapeHtml(item.detail || item.type || "file")}</small>
            </span>
          </button>
        `;
      })
      .join("");
    mentionMenu.classList.remove("hidden");
    mentionMenu.querySelectorAll(".prompt-mention-option").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const idx = Number(btn.dataset.index);
        applyMentionSelection(mentionItems[idx]);
      });
    });
  }

  function updateMentionMenuFromCaret() {
    const text = serializeEditor();
    const caret = getCaretPlainOffset();
    const before = text.slice(0, caret);
    const match = before.match(/@([a-zA-Z0-9_-]*)$/);
    if (!match) {
      hideMentionMenu();
      return;
    }
    mentionQuery = match[1] || "";
    const all = (getMentionables?.() || []).filter((item) => item?.token);
    const q = mentionQuery.toLowerCase();
    mentionItems = all.filter((item) => {
      const hay = `${item.token} ${item.label || ""} ${item.detail || ""} ${item.filename || ""}`.toLowerCase();
      return !q || hay.includes(q) || item.token.toLowerCase().includes(`@${q}`);
    });
    mentionMenuIndex = 0;
    renderMentionMenu();
  }

  function deleteAtRange(start, end) {
    const text = serializeEditor();
    const next = text.slice(0, start) + text.slice(end);
    if (textarea) textarea.value = next;
    syncEditorFromTextarea();
    setCaretPlainOffset(start);
    syncTextareaFromEditor();
  }

  function applyMentionSelection(item) {
    if (!item?.token) return;
    const text = serializeEditor();
    const caret = getCaretPlainOffset();
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const match = before.match(/@([a-zA-Z0-9_-]*)$/);
    const start = match ? caret - match[0].length : caret;
    const spacer = start > 0 && !/\s$/.test(text.slice(0, start)) ? " " : "";
    const insert = `${spacer}${item.token} `;
    if (item.ref && !references.some((r) => r.id === item.ref.id)) {
      references.push(item.ref);
    } else if (!item.ref && item.id && !references.some((r) => r.id === item.id)) {
      references.push({
        id: item.id,
        type: item.type || "component",
        token: item.token,
        label: item.label,
        filename: item.filename,
        stem: item.stem,
        format: item.format,
        viewer_filename: item.viewer_filename,
        projectId: item.projectId,
        text_content: item.text_content,
        text_truncated: item.text_truncated,
      });
    }
    if (textarea) textarea.value = text.slice(0, start) + insert + after;
    hideMentionMenu();
    renderChips();
    syncEditorFromTextarea();
    setCaretPlainOffset(start + insert.length);
    syncTextareaFromEditor();
    notifyRefs();
    editor.focus();
  }

  function ensureTokenInPrompt(ref, { focus = false } = {}) {
    const token = formatToken(ref);
    if (!token) return;
    const text = textarea?.value || serializeEditor();
    if (text.includes(token)) {
      syncEditorFromTextarea({ preserveCaret: true });
      return;
    }
    const spacer = text && !text.endsWith(" ") && !text.endsWith("\n") ? " " : "";
    if (textarea) textarea.value = `${text}${spacer}${token} `;
    syncEditorFromTextarea();
    syncTextareaFromEditor();
    if (focus) {
      editor.focus();
      setCaretPlainOffset(serializeEditor().length);
    }
  }

  function addReference(ref, { insertMention = true } = {}) {
    if (shouldSkipReference(ref)) return;
    references.push(ref);
    renderChips();
    if (insertMention && (ref.type === "component" || ref.type === "sketch" || ref.type === "wiring" || ref.type === "dxf" || ref.type === "document" || ref.type === "spec" || ref.type === "image")) {
      ensureTokenInPrompt(ref);
    }
    notifyRefs();
  }

  function addReferences(refs = [], { insertMention = true } = {}) {
    let added = 0;
    for (const ref of refs) {
      if (shouldSkipReference(ref)) continue;
      references.push(ref);
      added += 1;
      if (insertMention && (ref.type === "component" || ref.type === "sketch" || ref.type === "wiring" || ref.type === "dxf" || ref.type === "document" || ref.type === "spec" || ref.type === "image")) {
        ensureTokenInPrompt(ref);
      }
    }
    if (!added) return 0;
    renderChips();
    notifyRefs();
    return added;
  }

  function removeRef(id) {
    const idx = references.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const removed = references[idx];
    const token = removed.token;
    references.splice(idx, 1);
    removeReferenceMarker(id);
    if (textarea) {
      textarea.value = textarea.value
        .replace(new RegExp(`\\s*${escapeReg(token)}\\s*`, "g"), " ")
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n /g, "\n")
        .trim();
    }
    onUnlinkMentionable?.(removed);
    renderChips();
    notifyRefs();
  }

  function insertToken(token) {
    editor.focus();
    const text = serializeEditor();
    const caret = getCaretPlainOffset();
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const spacer = before && !before.endsWith(" ") ? " " : "";
    const insert = `${spacer}${token} `;
    if (textarea) textarea.value = before + insert + after;
    syncEditorFromTextarea();
    setCaretPlainOffset(caret + insert.length);
    syncTextareaFromEditor();
  }

  function getReferences() {
    return references.map(
      ({
        id,
        type,
        position,
        normal,
        face_index,
        face_indices,
        face_key,
        planar_key,
        mesh_uuid,
        face_area,
        vertex_index,
        selected_vertices,
        loop_points,
        surface_normals,
        surface_locked,
        label,
        token,
        filename,
        stem,
        format,
        viewer_filename,
        text_content,
        text_truncated,
        projectId,
        body_index,
        local_point,
        local_loop_points,
        localPoint,
      }) => ({
        id,
        type,
        position,
        normal,
        face_index,
        face_indices,
        face_key,
        planar_key,
        mesh_uuid,
        face_area,
        vertex_index,
        selected_vertices,
        loop_points,
        surface_normals,
        surface_locked,
        label,
        token,
        filename,
        stem,
        format,
        viewer_filename,
        text_content,
        text_truncated,
        projectId,
        body_index,
        local_point:
          local_point ||
          (localPoint ? [localPoint.x, localPoint.y, localPoint.z] : undefined),
        local_loop_points,
      }),
    );
  }

  function getPromptText() {
    syncTextareaFromEditor({ emitInput: false });
    return (textarea?.value || serializeEditor()).trim();
  }

  function getRawPromptText() {
    syncTextareaFromEditor({ emitInput: false });
    return textarea?.value || serializeEditor();
  }

  function setPromptText(text = "") {
    if (textarea) textarea.value = text || "";
    syncEditorFromTextarea();
  }

  function clearReferences() {
    for (const r of references) {
      removeReferenceMarker(r.id);
    }
    references.length = 0;
    renderChips();
    notifyRefs();
  }

  function removeReference(id) {
    removeRef(id);
  }

  function enrichReference(ref) {
    if (!ref?.id) return null;
    const stem = ref.stem || ref.filename?.replace(/\.[^.]+$/, "") || ref.label || "component";
    const token =
      ref.token ||
      (ref.type === "component" ||
      ref.type === "sketch" ||
      ref.type === "wiring" ||
      ref.type === "dxf" ||
      ref.type === "document" ||
      ref.type === "spec" ||
      ref.type === "image"
        ? `@${String(stem).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "component"}`
        : `@${ref.id}`);
    return { ...ref, token };
  }

  function replaceReferences(nextRefs = []) {
    for (const r of references) {
      removeReferenceMarker(r.id);
    }
    references.length = 0;
    for (const ref of nextRefs) {
      const enriched = enrichReference(ref);
      if (enriched?.id && !references.some((r) => r.id === enriched.id)) {
        references.push(enriched);
      }
    }
    renderChips();
    notifyRefs();
  }

  editor.addEventListener("input", () => {
    if (syncingEditor) return;
    syncTextareaFromEditor();
    updateMentionMenuFromCaret();
  });

  editor.addEventListener("keydown", (e) => {
    if (!mentionMenu.classList.contains("hidden") && mentionItems.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mentionMenuIndex = (mentionMenuIndex + 1) % mentionItems.length;
        renderMentionMenu();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mentionMenuIndex = (mentionMenuIndex - 1 + mentionItems.length) % mentionItems.length;
        renderMentionMenu();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyMentionSelection(mentionItems[mentionMenuIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideMentionMenu();
        return;
      }
    }

    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      let node = range.startContainer;
      let offset = range.startOffset;
      if (node === editor && offset > 0) {
        const prev = editor.childNodes[offset - 1];
        if (prev?.classList?.contains("prompt-mention")) {
          e.preventDefault();
          removeRef(prev.dataset.refId);
          return;
        }
      }
      if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        const prev = node.previousSibling;
        if (prev?.classList?.contains("prompt-mention")) {
          e.preventDefault();
          removeRef(prev.dataset.refId);
        }
      }
    }
  });

  editor.addEventListener("mouseup", () => updateMentionMenuFromCaret());
  editor.addEventListener("keyup", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
    updateMentionMenuFromCaret();
  });

  editor.addEventListener("paste", (e) => {
    const imageFiles = [...(e.clipboardData?.files || [])].filter((file) => file.type?.startsWith("image/"));
    if (imageFiles.length) return; // app.js image paste handler owns this
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    // Prefer insertText so the contenteditable undo stack (⌘Z / ⌘⇧Z) stays intact.
    if (text && document.queryCommandSupported?.("insertText")) {
      document.execCommand("insertText", false, text);
    } else if (text) {
      const current = serializeEditor();
      const caret = getCaretPlainOffset();
      if (textarea) textarea.value = current.slice(0, caret) + text + current.slice(caret);
      syncEditorFromTextarea();
      setCaretPlainOffset(caret + text.length);
    }
    syncTextareaFromEditor();
    updateMentionMenuFromCaret();
  });

  editor.addEventListener("focus", () => editorWrap.classList.add("is-focused"));
  editor.addEventListener("blur", () => {
    editorWrap.classList.remove("is-focused");
    // Delay hide so option mousedown can fire.
    setTimeout(() => {
      if (!editorWrap.contains(document.activeElement)) hideMentionMenu();
    }, 120);
  });

  textarea?.addEventListener("input", () => {
    if (syncingEditor) return;
    // Mic / external writers update the mirror textarea.
    syncEditorFromTextarea({ preserveCaret: document.activeElement === editor });
  });

  // Keep placeholder state accurate.
  const placeholderObserver = () => editor.classList.toggle("is-empty", !serializeEditor().trim());
  editor.addEventListener("input", placeholderObserver);

  renderChips();
  syncEditorFromTextarea();

  return {
    addReference,
    addReferences,
    removeReference,
    replaceReferences,
    getReferences,
    getPromptText,
    getRawPromptText,
    setPromptText,
    clearReferences,
    insertToken,
    editor,
  };
}
