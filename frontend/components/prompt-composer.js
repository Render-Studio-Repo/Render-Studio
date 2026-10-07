/** Cursor-style @reference chips + in-prompt @mentions for the AI prompt */

import { removeReferenceMarker } from "../viewport/picking.js?v=20260715-sharp-labels&editctx=20260915-1&editscale=20260915-1";
import { linkDescriptionBefore, clipboardNodeText } from "./prompt-link-data.js?v=1";
import { decoratePromptLink } from "./prompt-link-ui.js?v=1";
import {
  copiedChipStatus,
  copyPayloadForPromptRef,
  copyPromptChipValue,
} from "./prompt-chip-copy.js?v=20260915-links2";
import { insertMentionWithTrailingSpace } from "./prompt-mention-space.js?v=mentionpad1";

export { copyPayloadForPromptRef, copyPromptChipValue, copiedChipStatus };
export { insertMentionWithTrailingSpace, appendMentionWithTrailingSpace } from "./prompt-mention-space.js?v=mentionpad1";

/** File uploads are chips + payload refs — never dumped as `[Reference: file.webm]` prompt text. */
export const PROMPT_FILE_LINK_TYPES = new Set([
  "document",
  "spec",
  "image",
  "dxf",
  "video",
  "audio",
  "file",
]);

const PROMPT_MENTION_TYPES = new Set([
  "component",
  "sketch",
  "wiring",
  "face",
  "url",
  "link",
  "image",
  "box",
  "line",
  "arrow",
  "view",
  "edge",
  "split",
]);

export function isPromptFileLinkType(type) {
  return PROMPT_FILE_LINK_TYPES.has(String(type || "").toLowerCase());
}

/** Canvas / named-node tags in the prompt: `@piece-example` and `#piece-example`. */
export function promptLinkTokenAliases(token = "") {
  const raw = String(token || "").trim();
  if (!raw) return [];
  const stem = raw.replace(/^[@#]/, "");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(stem)) return [];
  return [`@${stem}`, `#${stem}`];
}

export function isCanvasPromptLink(ref = {}) {
  if (!ref || typeof ref !== "object") return false;
  if (ref.canvas_element_id || ref.elementId) return true;
  if (String(ref.id || "").startsWith("canvas-image:")) return true;
  if (ref.canvas_board || ref.boardName) return true;
  const src = String(ref.source_filename || ref.sourceFilename || ref.filename || "");
  return /(?:^|[\\/])Canvas[\\/]/i.test(src);
}

export function stripPromptFileBanners(text, filename = "") {
  let next = String(text || "");
  const name = String(filename || "").trim();
  if (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(
      new RegExp(`\\[Reference:\\s*${escaped}\\][\\s\\S]*?(?=\\n\\[Reference:|$)`, "gi"),
      "",
    );
  }
  next = next
    .replace(/\[Reference:\s*[^\]]+\]\s*/gi, "")
    .replace(/(?:^|\n)\s*Attached PDF preview as visual reference\.\s*/gi, "\n")
    .replace(/(?:^|\n)\s*Attached image as visual reference\.\s*/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return next;
}

const HTTP_URL_RE = /(?:https?:\/\/|www\.)[^\s<>\]\)\"']+/gi;
const AMAZON_ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/product\/)([A-Z0-9]{10})/i;

function extractHttpUrls(text = "") {
  const urls = [];
  const seen = new Set();
  HTTP_URL_RE.lastIndex = 0;
  for (const match of String(text || "").matchAll(HTTP_URL_RE)) {
    const pasted = match[0];
    const trimmed = pasted.replace(/[),.;:!?]+$/g, "");
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    urls.push({ pasted, href });
  }
  return urls;
}

function amazonAsinFromUrl(href = "") {
  try {
    const u = new URL(href);
    const pathMatch = String(u.pathname || "").match(AMAZON_ASIN_RE);
    if (pathMatch) return pathMatch[1].toUpperCase();
    const asin = u.searchParams.get("asin") || u.searchParams.get("ASIN");
    if (asin && /^[A-Z0-9]{10}$/i.test(asin)) return asin.toUpperCase();
  } catch {
    /* ignore */
  }
  return "";
}

function canonicalizePastedUrl(href = "") {
  try {
    const u = new URL(href);
    const host = String(u.hostname || "").toLowerCase();
    const asin = amazonAsinFromUrl(href);
    if (asin && /(^|\.)amazon\.[a-z.]+$/.test(host)) {
      return `${u.protocol}//${u.host}/dp/${asin}`;
    }
    u.hash = "";
    return u.toString();
  } catch {
    return String(href || "").trim();
  }
}

function urlPromptToken(href = "") {
  const asin = amazonAsinFromUrl(href);
  if (asin) return `@amazon-${asin}`;
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./i, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18);
    const leaf = (u.pathname.split("/").filter(Boolean).pop() || "link")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 18);
    return `@${[host, leaf].filter(Boolean).join("-")}`.slice(0, 42);
  } catch {
    return "@link";
  }
}

function urlPromptLabel(href = "") {
  const asin = amazonAsinFromUrl(href);
  if (asin) return `Amazon ${asin}`;
  try {
    const u = new URL(href);
    const path = u.pathname.length > 28 ? `${u.pathname.slice(0, 25)}…` : u.pathname;
    return `${u.hostname.replace(/^www\./i, "")}${path === "/" ? "" : path}`;
  } catch {
    return String(href || "link").slice(0, 48);
  }
}

function clipboardPasteText(clipboardData) {
  let text = clipboardData?.getData("text/plain") || "";
  const html = clipboardData?.getData("text/html") || "";
  if (html && !extractHttpUrls(text).length) {
    const hrefs = [];
    const seen = new Set();
    for (const match of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"'>\s]+)["']/gi)) {
      const href = match[1];
      if (!href || seen.has(href)) continue;
      seen.add(href);
      hrefs.push(href);
    }
    if (hrefs.length) text = [text.trim(), ...hrefs].filter(Boolean).join(" ").trim();
  }
  return text;
}

function urlPromptRef(href, pasted = "", description = "") {
  const url = href;
  const digest = Math.abs(
    [...(url || href)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0),
  ).toString(36);
  const token = `${urlPromptToken(url || href)}-${digest}`;
  return {
    id: `url:${digest}`,
    type: "url",
    token,
    label: urlPromptLabel(url || href),
    url,
    filename: url,
    stem: token.replace(/^@/, ""),
    pasted: pasted || href,
    original_url: href,
    description,
  };
}

export function createPromptComposer({
  textarea,
  chipsEl,
  inlineChipsEl = null,
  refsListEl,
  onReferencesChange,
  getMentionables = () => [],
  onUnlinkMentionable = null,
  resolveClipboardPaste = null,
  onStatus = null,
  getProjectId = () => null,
  onMentionActivate = null,
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
    editorWrap.append(editor, textarea);
  }
  // Portal above overflow:hidden compose panes so the @ list is visible.
  mentionMenu.classList.add("prompt-mention-menu--portal");
  document.body.appendChild(mentionMenu);

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
    if (ref.type === "url" || ref.type === "link") return ref.label || ref.url || "link";
    if (ref.type === "image") return ref.label || ref.filename || "image";
    if (ref.type === "video") return ref.label || ref.filename || "video";
    if (ref.type === "audio" || ref.type === "file") return ref.label || ref.filename || ref.type;
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

  function flashCopied(el, kind) {
    if (!el) return;
    const message = copiedChipStatus(kind);
    el.classList.add("is-copied");
    el.dataset.copyFlash = message;
    onStatus?.("ok", message);
    window.clearTimeout(el._copyFlashTimer);
    el._copyFlashTimer = window.setTimeout(() => {
      el.classList.remove("is-copied");
    }, 1200);
  }

  async function copyRefFromChip(el, ref) {
    const payload = await copyPromptChipValue(ref);
    if (!payload) return;
    flashCopied(el, payload.kind);
  }

  function attachChipHandlers(chip, ref) {
    chip.querySelector(".ref-remove")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRef(ref.id);
    });
    chip.addEventListener("click", (e) => {
      if (e.target.closest?.(".ref-remove") || e.target.classList.contains("ref-remove")) return;
      e.preventDefault();
      e.stopPropagation();
      void copyRefFromChip(chip, ref);
    });
  }

  function createChipElement(ref, { inline = false } = {}) {
    const chip = document.createElement("span");
    chip.className = inline ? "ref-chip ref-chip--inline" : "ref-chip";
    chip.dataset.refId = ref.id;
    const copyHint = copyPayloadForPromptRef(ref);
    chip.title = copyHint?.text
      ? `${copyHint.text}\nClick to copy ${copyHint.kind}`
      : formatToken(ref);
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
    if (ref.type === "url" || ref.type === "link") decoratePromptLink(chip, ref, { getProjectId, onStatus });
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
    line.addEventListener("click", (e) => {
      if (e.target.closest(".ref-line-remove")) return;
      e.preventDefault();
      void copyRefFromChip(line, ref);
    });
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
        ref.type === "url" ||
        ref.type === "link" ||
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
    mention.className = isCanvasPromptLink(ref) ? "prompt-mention prompt-mention--canvas" : "prompt-mention";
    mention.contentEditable = "false";
    mention.dataset.refId = ref.id;
    mention.dataset.token = token;
    mention.setAttribute("data-type", ref.type || "component");
    if (isCanvasPromptLink(ref)) mention.setAttribute("role", "link");
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
    const copyHint = copyPayloadForPromptRef(ref);
    mention.title = copyHint?.text
      ? `${copyHint.text}\nClick to copy ${copyHint.kind}`
      : token;
    mention.addEventListener("mousedown", (e) => {
      if (e.target.closest(".prompt-mention-remove")) return;
      e.preventDefault();
    });
    mention.addEventListener("click", (e) => {
      if (e.target.closest(".prompt-mention-remove")) return;
      e.preventDefault();
      e.stopPropagation();
      if (isCanvasPromptLink(ref) && onMentionActivate?.(ref)) return;
      void copyRefFromChip(mention, ref);
    });
    if (ref.type === "url" || ref.type === "link") decoratePromptLink(mention, ref, { getProjectId, onStatus });
    return mention;
  }

  function mentionCatalog() {
    const items = [];
    const seen = new Set();
    const push = (ref) => {
      if (!ref?.id || seen.has(ref.id)) return;
      const token = formatToken(ref);
      if (!token) return;
      seen.add(ref.id);
      items.push({ ref, token });
    };
    for (const ref of references) push(ref);
    for (const item of getMentionables?.() || []) {
      push(item.ref || item);
    }
    return items;
  }

  function bindMentionRef(ref) {
    if (!ref?.id) return ref;
    const existing = references.find((row) => row.id === ref.id);
    if (existing) return existing;
    const enriched = enrichReference(ref);
    if (enriched) references.push(enriched);
    return enriched || ref;
  }

  function tokenizePlainText(text) {
    const catalog = mentionCatalog();
    const aliasToRef = new Map();
    for (const { ref, token } of catalog) {
      if (!aliasToRef.has(token)) aliasToRef.set(token, { ref, token });
      for (const alias of promptLinkTokenAliases(token)) {
        if (!aliasToRef.has(alias)) aliasToRef.set(alias, { ref, token });
      }
    }
    const aliases = [...aliasToRef.keys()].sort((a, b) => b.length - a.length);
    if (!aliases.length || !text) {
      return [{ type: "text", value: text || "" }];
    }
    const pattern = new RegExp(`(?<![A-Za-z0-9_])(${aliases.map(escapeReg).join("|")})`, "g");
    const parts = [];
    let last = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) {
        parts.push({ type: "text", value: text.slice(last, match.index) });
      }
      const hit = aliasToRef.get(match[1]);
      if (hit) parts.push({ type: "mention", ref: bindMentionRef(hit.ref), token: hit.token });
      else parts.push({ type: "text", value: match[1] });
      last = match.index + match[1].length;
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
    const parts = tokenizePlainText(text);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const next = parts[i + 1];
      const description = part.type === "text" && next?.type === "mention" && ["url", "link"].includes(next.ref.type)
        ? linkDescriptionBefore(part.value) : "";
      if (description) {
        const start = part.value.lastIndexOf(description + ":");
        appendTextWithBreaks(frag, part.value.slice(0, start));
        const group = document.createElement("span");
        group.className = "prompt-link-binding";
        next.ref.description = description;
        appendTextWithBreaks(group, part.value.slice(start));
        group.appendChild(createMentionNode(next.ref));
        frag.appendChild(group);
        i++;
        continue;
      }
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

  function selectedPlainOffsets() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) {
      const end = serializeEditor().length;
      return { start: end, end };
    }
    const selected = selection.getRangeAt(0);
    const offset = (node, at) => {
      const range = document.createRange();
      range.selectNodeContents(editor); range.setEnd(node, at);
      return serializeFromNode(range.cloneContents()).length;
    };
    return { start: offset(selected.startContainer, selected.startOffset), end: offset(selected.endContainer, selected.endOffset) };
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
    // Focus/placeholder clicks can serialize an empty editor while the mirror
    // still holds the smart-description text — do not wipe it.
    if (!String(text || "").trim() && String(textarea.value || "").trim() && document.activeElement !== editor) {
      syncingEditor = false;
      editor.classList.toggle("is-empty", false);
      return;
    }
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
    mentionMenu.style.left = "";
    mentionMenu.style.top = "";
    mentionMenu.style.bottom = "";
    mentionMenu.style.width = "";
  }

  function positionMentionMenu() {
    if (mentionMenu.classList.contains("hidden")) return;
    const wrapRect = editorWrap.getBoundingClientRect();
    const gap = 6;
    const maxH = Math.min(420, Math.max(220, Math.floor(window.innerHeight * 0.42)));
    const width = Math.max(180, wrapRect.width);
    const left = Math.min(
      Math.max(8, wrapRect.left),
      Math.max(8, window.innerWidth - width - 8),
    );
    mentionMenu.style.position = "fixed";
    mentionMenu.style.left = `${left}px`;
    mentionMenu.style.width = `${width}px`;
    mentionMenu.style.right = "auto";
    mentionMenu.style.maxHeight = `${maxH}px`;
    mentionMenu.style.overflowX = "hidden";
    mentionMenu.style.zIndex = "5200";
    const menuH = Math.min(mentionMenu.offsetHeight || maxH, maxH);
    const spaceAbove = wrapRect.top - gap;
    const spaceBelow = window.innerHeight - wrapRect.bottom - gap;
    if (spaceAbove >= Math.min(menuH, 120) || spaceAbove >= spaceBelow) {
      mentionMenu.style.bottom = `${window.innerHeight - wrapRect.top + gap}px`;
      mentionMenu.style.top = "auto";
    } else {
      mentionMenu.style.top = `${wrapRect.bottom + gap}px`;
      mentionMenu.style.bottom = "auto";
    }
  }

  function mentionKindLabel(item) {
    const detail = String(item?.detail || item?.type || "file").toLowerCase();
    if (detail.includes("selected")) return "selected";
    if (detail.includes("hidden")) return "hidden";
    if (detail.includes("body")) return "body";
    if (detail.includes("canvas") || isCanvasPromptLink(item?.ref || item)) return "canvas";
    if (detail.includes("image")) return "image";
    if (detail.includes("reference")) return "file";
    if (detail.includes("sketch")) return "sketch";
    if (detail.includes("link") || item?.type === "url") return "link";
    if (detail.includes("face")) return "face";
    if (detail.includes("file")) return "file";
    if (detail.includes("object")) return "object";
    return String(item?.type || "file");
  }

  function renderMentionMenu() {
    if (!mentionItems.length) {
      mentionMenu.innerHTML = `<div class="prompt-mention-empty">No references match. Import or select a model item, then type <code>@</code>.</div>`;
      mentionMenu.classList.remove("hidden");
      positionMentionMenu();
      return;
    }
    mentionMenu.innerHTML = mentionItems
      .map((item, index) => {
        const active = index === mentionMenuIndex ? " is-active" : "";
        const token = item.token || "";
        const kind = mentionKindLabel(item);
        const tip = [token, item.label, item.detail, item.filename].filter(Boolean).join(" · ");
        const meta = item.label && item.label !== token
          ? item.label
          : (item.filename || item.detail || "");
        const canvasClass = isCanvasPromptLink(item.ref || item) ? " prompt-mention--canvas" : "";
        return `
          <button type="button" class="prompt-mention-option${active}" role="option" data-index="${index}" aria-selected="${index === mentionMenuIndex}" title="${escapeHtml(tip)}">
            <span class="prompt-mention-option-token${canvasClass}">${escapeHtml(token)}</span>
            ${meta ? `<span class="prompt-mention-option-meta">${escapeHtml(meta)}</span>` : ""}
            <span class="prompt-mention-option-kind">${escapeHtml(kind)}</span>
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
    positionMentionMenu();
  }

  function mentionTriggerBeforeCaret(before) {
    // contenteditable often keeps a trailing <br> that serializes as \n after @
    return String(before || "").replace(/\n+$/, "").match(/[@#]([A-Za-z0-9_-]*)$/);
  }

  function updateMentionMenuFromCaret() {
    const text = serializeEditor();
    const caret = getCaretPlainOffset();
    const before = text.slice(0, caret);
    const match = mentionTriggerBeforeCaret(before);
    if (!match) {
      hideMentionMenu();
      return;
    }
    mentionQuery = match[1] || "";
    const all = (getMentionables?.() || []).filter((item) => item?.token);
    const q = mentionQuery.toLowerCase();
    mentionItems = all.filter((item) => {
      const hay = `${item.token} ${item.label || ""} ${item.detail || ""} ${item.filename || ""}`.toLowerCase();
      return !q || hay.includes(q) || item.token.toLowerCase().includes(`@${q}`) || item.token.toLowerCase().includes(`#${q}`);
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
    const trimmed = before.replace(/\n+$/, "");
    const match = mentionTriggerBeforeCaret(before);
    const start = match ? trimmed.length - match[0].length : caret;
    const insert = insertMentionWithTrailingSpace(text, item.token, start, caret);
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
    if (textarea) textarea.value = insert.value;
    hideMentionMenu();
    renderChips();
    syncEditorFromTextarea();
    setCaretPlainOffset(insert.caret);
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
    if (textarea) textarea.value = insertMentionWithTrailingSpace(text, token).value;
    syncEditorFromTextarea();
    syncTextareaFromEditor();
    if (focus) {
      editor.focus();
      setCaretPlainOffset(serializeEditor().length);
    }
  }

  function shouldInsertPromptMention(ref, insertMention) {
    if (!insertMention || !ref) return false;
    const type = String(ref.type || "").toLowerCase();
    if (isPromptFileLinkType(type)) return false;
    return PROMPT_MENTION_TYPES.has(type);
  }

  function addReference(ref, { insertMention = true } = {}) {
    if (shouldSkipReference(ref)) return;
    references.push(ref);
    renderChips();
    if (shouldInsertPromptMention(ref, insertMention)) {
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
      if (shouldInsertPromptMention(ref, insertMention)) {
        ensureTokenInPrompt(ref);
      }
    }
    if (!added) return 0;
    renderChips();
    notifyRefs();
    return added;
  }

  function revokePromptChipObjectUrl(ref) {
    const url = ref?.url;
    if (typeof url !== "string" || !url.startsWith("blob:")) return;
    try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
  }

  function removeRef(id) {
    const idx = references.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const removed = references[idx];
    const token = removed.token;
    references.splice(idx, 1);
    removeReferenceMarker(id);
    revokePromptChipObjectUrl(removed); // leakfix21
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
    const insert = insertMentionWithTrailingSpace(text, token, caret, caret);
    if (textarea) textarea.value = insert.value;
    syncEditorFromTextarea();
    setCaretPlainOffset(insert.caret);
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
        geometry_context,
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
        url,
        original_url,
        description,
        mime,
        media_type,
        projectId,
        canvas_element_id,
        canvas_board,
        source_filename,
        data_url,
        final_example,
        body_index,
        parent_id,
        parent_token,
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
        geometry_context,
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
        url,
        original_url,
        description,
        mime,
        media_type,
        projectId,
        canvas_element_id,
        canvas_board,
        source_filename,
        data_url,
        final_example,
        body_index,
        parent_id,
        parent_token,
        local_point:
          local_point ||
          (localPoint ? [localPoint.x, localPoint.y, localPoint.z] : undefined),
        local_loop_points,
      }),
    );
  }

  function getPromptText() {
    if (document.activeElement === editor) syncTextareaFromEditor({ emitInput: false });
    return (textarea?.value || serializeEditor()).trim();
  }

  function getRawPromptText() {
    if (document.activeElement === editor) syncTextareaFromEditor({ emitInput: false });
    return textarea?.value || serializeEditor();
  }

  function setPromptText(text = "") {
    if (textarea) textarea.value = stripPromptFileBanners(text || "");
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
      ref.type === "url" ||
      ref.type === "link" ||
      ref.type === "image"
        ? `@${String(stem).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "component"}`
        : `@${ref.id}`);
    return { ...ref, token };
  }

  function replaceReferences(nextRefs = []) {
    const keep = new Set((nextRefs || []).map((r) => r?.url).filter(Boolean));
    for (const r of references) {
      removeReferenceMarker(r.id);
      if (!keep.has(r.url)) revokePromptChipObjectUrl(r); // leakfix21
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

  editor.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.files || [])].length || [...(e.dataTransfer?.types || [])].includes("Files")) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
  });
  editor.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length && ![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    const cleaned = stripPromptFileBanners(serializeEditor());
    if (textarea && cleaned !== String(textarea.value || "").trim()) {
      textarea.value = cleaned;
      syncEditorFromTextarea({ preserveCaret: true });
    }
  });

  editor.addEventListener("paste", (e) => {
    const imageFiles = [...(e.clipboardData?.files || [])].filter((file) => file.type?.startsWith("image/"));
    if (imageFiles.length) return; // app.js image paste handler owns this
    e.preventDefault();
    e.stopPropagation();
    const text = clipboardPasteText(e.clipboardData);
    const resolved = typeof resolveClipboardPaste === "function"
      ? resolveClipboardPaste(text, e.clipboardData)
      : null;
    if (resolved) {
      const refs = Array.isArray(resolved) ? resolved : [resolved];
      const added = addReferences(refs.filter(Boolean), { insertMention: true });
      if (added) {
        hideMentionMenu();
        return;
      }
    }
    const urlHits = extractHttpUrls(text);
    const { start: caret, end: selectionEnd } = selectedPlainOffsets();
    const current = serializeEditor();
    let insert = text;
    if (urlHits.length) {
      const urlRefs = urlHits.map((hit) => urlPromptRef(hit.href, hit.pasted,
        linkDescriptionBefore(current.slice(0, caret) + text.slice(0, text.indexOf(hit.pasted)))));
      addReferences(urlRefs, { insertMention: false });
      for (const ref of urlRefs) {
        const needle = ref.pasted || ref.url;
        if (needle && insert.includes(needle)) insert = insert.split(needle).join(` ${ref.token} `);
        else if (ref.url && insert.includes(ref.url)) insert = insert.split(ref.url).join(` ${ref.token} `);
      }
      insert = insert.replace(/[^\S\n]+/g, " ");
      if (!insert.trim()) {
        insert = urlRefs.map((ref) => ref.token).join(" ");
      }
      if (insert && !insert.endsWith(" ")) insert += " ";
    }
    if (textarea) textarea.value = current.slice(0, caret) + insert + current.slice(selectionEnd);
    syncEditorFromTextarea();
    setCaretPlainOffset(caret + insert.length);
    syncTextareaFromEditor();
    editor.focus();
    if (urlHits.length) hideMentionMenu();
    else updateMentionMenuFromCaret();
  });

  const copySelection = (event) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0);
    const plain = clipboardNodeText(range.cloneContents(), references);
    if (!event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", plain);
    if (event.type === "cut") {
      range.deleteContents();
      syncTextareaFromEditor();
    }
  };
  editor.addEventListener("copy", copySelection);
  editor.addEventListener("cut", copySelection);

  const repositionMentionMenu = () => {
    if (mentionMenu.classList.contains("hidden")) return;
    positionMentionMenu();
  };
  window.addEventListener("resize", repositionMentionMenu);
  window.addEventListener("scroll", repositionMentionMenu, true);

  const onMentionPointerDown = (e) => {
    if (mentionMenu.classList.contains("hidden")) return;
    const t = e.target;
    if (editorWrap.contains(t) || mentionMenu.contains(t)) return;
    hideMentionMenu();
  };
  document.addEventListener("pointerdown", onMentionPointerDown, true);

  editor.addEventListener("focus", () => editorWrap.classList.add("is-focused"));
  editor.addEventListener("blur", () => {
    editorWrap.classList.remove("is-focused");
    // Delay hide so option mousedown can fire.
    setTimeout(() => {
      if (editorWrap.contains(document.activeElement) || mentionMenu.contains(document.activeElement)) return;
      hideMentionMenu();
    }, 120);
  });

  textarea?.addEventListener("input", () => {
    if (syncingEditor) return;
    // The contenteditable is the source of truth while focused. Rebuilding from
    // the mirror on each keystroke duplicated characters (Render tab especially).
    if (document.activeElement === editor) return;
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
