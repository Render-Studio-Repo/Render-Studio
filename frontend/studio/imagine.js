/** Imagine tab: product-image gen, /fetch CAD import, DXF convert prefs. */

import { createPromptHistoryUI } from "../components/prompt-history.js?v=20260908-cadname1-imagine3-imagine4-20260914-imghist1-imaghist1-harness2-harness3";
import { copyPromptChipValue, copiedChipStatus } from "../components/prompt-chip-copy.js?v=20260915-chipcopy1";
import { convertHeicFileToPng } from "../media/heic-to-png.js?v=heicpng1";
import { insertMentionWithTrailingSpace } from "../components/prompt-mention-space.js?v=mentionpad1";
import { pickComposeRestorePrompt } from "./prompt-draft.js?v=20260914-promptdraft1-20260916";

export const IMAGINE_FOLDER = "imagine";
export const IMAGINE_FETCHED_FOLDER = "imagine/fetched";
export const IMAGINE_COUNT_PREF_KEY = "render3d:imagine-count:v1";
export const DXF_CONVERT_PREF_KEY = "render3d:dxf-convert:v1";
export const IMAGINE_IMPROVE_PREF_KEY = "render3d:imagine-improve:v1";
export const IMAGINE_LIBRARY_VIEW_PREF_KEY = "render3d:imagine-library-view:v1";
export const LS_IMAGINE_COMPOSE_DRAFT = "render3d:imagineComposeDraft:v1";
export const DXF_CONVERT_PREF_VALUES = Object.freeze(["ask", "auto", "always_dxf", "always_image"]);
export const IMAGINE_LIBRARY_VIEWS = Object.freeze(["list", "grid", "history"]);

/** OpenAI Image 2.5 (flare = everyday / sunburst = quality), then wired fallbacks. */
export const OPENAI_IMAGINE_MODELS = Object.freeze([
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
]);
export const OPENAI_IMAGINE_QUALITY_MODELS = Object.freeze([
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
]);
export const GROK_IMAGINE_MODELS = Object.freeze(["grok-imagine-image", "grok-2-image"]);

export const FETCH_FORMATS = Object.freeze(["stl", "glb", "step", "3mf"]);
export const FETCH_DEFAULT_ON = Object.freeze(["stl", "glb", "step"]);
export const FETCH_CAD_SUFFIXES = Object.freeze([".step", ".stp", ".stl", ".glb", ".gltf", ".3mf", ".zip"]);

const DXF_CONVERT_RE = /\b(line\s*drawing|technical\s*sketch|floor\s*plan|floorplan|blueprint|silhouette|2d\s*profile|logo|vector|outline|schematic|cad\s*drawing|orthographic)\b/i;
const DXF_KEEP_RE = /\b(photo|photograph|photoreal|product\s*shot|lifestyle|render|texture|scene|hdr|equirect)\b/i;

export function normalizeImagineProvider(value) {
  const p = String(value || "").trim().toLowerCase();
  if (p === "grok" || p === "x-ai" || p === "xai") return "xai";
  if (p === "openai" || p === "chatgpt" || p === "subscription") return "openai";
  return p;
}

export function imagineFilenameFromPrompt(prompt, { suffix, index } = {}) {
  const slug = String(prompt || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "imagine";
  const unique = String(suffix || Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/gi, "").slice(0, 8) || "x";
  const part = Number.isFinite(index) && index > 0 ? `-${index + 1}` : "";
  return `${slug}${part}-${unique}.png`;
}

export function imagineFetchedFilename(prompt, ext, { suffix } = {}) {
  const slug = String(prompt || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\/fetch\s+/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "fetched";
  const unique = String(suffix || Math.random().toString(36).slice(2, 8)).replace(/[^a-z0-9]/gi, "").slice(0, 8) || "x";
  const cleanExt = String(ext || ".step").toLowerCase().replace(/^\./, "");
  return `${slug}-${unique}.${cleanExt}`;
}

export function isImagineRel(filename) {
  const raw = String(filename || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return raw === IMAGINE_FOLDER || raw.startsWith(`${IMAGINE_FOLDER}/`);
}

export function isImagineCadRel(filename) {
  if (!isImagineRel(filename)) return false;
  return /\.(step|stp|stl|glb|gltf|3mf)$/i.test(String(filename || ""));
}

export function clampImagineCount(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.min(4, Math.max(1, fallback));
  return Math.min(4, Math.max(1, Math.round(n)));
}

export function readImagineCountPref(storage = globalThis.localStorage) {
  try {
    return clampImagineCount(storage?.getItem?.(IMAGINE_COUNT_PREF_KEY), 1);
  } catch {
    return 1;
  }
}

export function writeImagineCountPref(value, storage = globalThis.localStorage) {
  const next = clampImagineCount(value, 1);
  try {
    storage?.setItem?.(IMAGINE_COUNT_PREF_KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function readImagineImprovePref(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(IMAGINE_IMPROVE_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeImagineImprovePref(value, storage = globalThis.localStorage) {
  const next = !!value;
  try {
    storage?.setItem?.(IMAGINE_IMPROVE_PREF_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  return next;
}

export function normalizeImagineLibraryView(value, fallback = "grid") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "list" || raw === "grid" || raw === "history") return raw;
  return fallback === "list" ? "list" : "grid";
}

export function readImagineLibraryViewPref(storage = globalThis.localStorage) {
  try {
    return normalizeImagineLibraryView(storage?.getItem?.(IMAGINE_LIBRARY_VIEW_PREF_KEY), "grid");
  } catch {
    return "grid";
  }
}

export function writeImagineLibraryViewPref(value, storage = globalThis.localStorage) {
  const next = normalizeImagineLibraryView(value, "grid") === "list" ? "list" : "grid";
  try {
    storage?.setItem?.(IMAGINE_LIBRARY_VIEW_PREF_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

export function readImagineComposeDrafts(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = JSON.parse(storage?.getItem?.(LS_IMAGINE_COMPOSE_DRAFT) || "{}") || {};
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const nested = Object.values(raw).some((value) => (
    value && typeof value === "object" && !Array.isArray(value) && "prompt" in value
  ));
  if (!nested && ("prompt" in raw)) {
    const pid = String(raw.project_id || "").trim();
    return pid ? { [pid]: { ...raw, project_id: pid } } : {};
  }
  const map = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (!("prompt" in value)) continue;
    const pid = String(key || "").trim();
    if (!pid) continue;
    if (value.project_id && String(value.project_id) !== pid) continue;
    map[pid] = { ...value, project_id: pid };
  }
  return map;
}

export function writeImagineComposeDrafts(map, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(LS_IMAGINE_COMPOSE_DRAFT, JSON.stringify(map || {}));
  } catch {
    /* quota / private mode */
  }
}

export function imagineDisplayName(item = {}) {
  const label = String(item.label || "").trim();
  if (label) return label;
  return String(item.name || "").replace(/^.*\//, "") || "Imagine";
}

export function imagineItemPrompt(item = {}) {
  return String(item.prompt || item.query || "").trim();
}

export function filterImagineLibrary(items = [], query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return Array.isArray(items) ? [...items] : [];
  return (items || []).filter((item) => {
    const hay = [imagineDisplayName(item), imagineItemPrompt(item), item?.name]
      .map((s) => String(s || "").toLowerCase())
      .join(" ");
    return hay.includes(q);
  });
}

export function readDxfConvertPref(storage = globalThis.localStorage) {
  try {
    const raw = String(storage?.getItem?.(DXF_CONVERT_PREF_KEY) || "ask").toLowerCase();
    return DXF_CONVERT_PREF_VALUES.includes(raw) ? raw : "ask";
  } catch {
    return "ask";
  }
}

export function writeDxfConvertPref(value, storage = globalThis.localStorage) {
  const next = DXF_CONVERT_PREF_VALUES.includes(value) ? value : "ask";
  try {
    storage?.setItem?.(DXF_CONVERT_PREF_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

export function classifyImageForDxf({ filenames = [], prompt = "", sources = [], folderHints = [] } = {}) {
  const blob = [prompt, ...filenames, ...sources, ...folderHints].map((s) => String(s || "")).join("\n");
  const names = filenames.map((s) => String(s || "").toLowerCase());
  const inImagine = names.some((n) => n.includes(`${IMAGINE_FOLDER}/`) || n.startsWith("imagine-"));
  if (inImagine || DXF_KEEP_RE.test(blob)) {
    return { action: "keep", reason: "product-photo", confidence: inImagine ? "high" : "med" };
  }
  if (names.some((n) => n.endsWith(".pdf") || n.endsWith(".dxf"))) {
    return { action: "keep", reason: "already-drawing", confidence: "high" };
  }
  if (DXF_CONVERT_RE.test(blob) || names.some((n) => /sketch|drawing|logo|floorplan|blueprint|silhouette|profile/.test(n))) {
    return { action: "dxf", reason: "line-drawing", confidence: "high" };
  }
  return { action: "keep", reason: "uncertain-photo", confidence: "low" };
}

export function resolveDxfConvertDecision(pref, classification = {}) {
  const mode = DXF_CONVERT_PREF_VALUES.includes(pref) ? pref : "ask";
  if (mode === "always_dxf") return { convert: true, ask: false, pref: mode };
  if (mode === "always_image") return { convert: false, ask: false, pref: mode };
  if (mode === "auto") {
    return { convert: classification.action === "dxf", ask: false, pref: mode, reason: classification.reason };
  }
  return { convert: false, ask: true, pref: mode };
}

export function persistDxfDontAskAgain(choice, storage = globalThis.localStorage) {
  const pref = choice === "yes" ? "always_dxf" : "always_image";
  return writeDxfConvertPref(pref, storage);
}

export function listImageCapableProviders(keys = []) {
  const out = new Set();
  for (const key of keys || []) {
    const p = normalizeImagineProvider(key?.provider);
    if (p === "openai" || p === "xai") out.add(p);
  }
  return [...out];
}

export function resolveImagineProvider({ selectedProvider, keys = [], speed = "fast" } = {}) {
  const available = new Set(listImageCapableProviders(keys));
  const selected = normalizeImagineProvider(selectedProvider);
  let provider = null;
  if (selected === "openai" && available.has("openai")) provider = "openai";
  else if (selected === "xai" && available.has("xai")) provider = "xai";
  else if (available.size === 1) provider = [...available][0];
  else if (available.has("openai")) provider = "openai";
  else if (available.has("xai")) provider = "xai";
  if (!provider) return { provider: null, model: null, available: [...available] };
  const quality = String(speed || "").toLowerCase() === "quality";
  const models = provider === "xai"
    ? GROK_IMAGINE_MODELS
    : (quality ? OPENAI_IMAGINE_QUALITY_MODELS : OPENAI_IMAGINE_MODELS);
  return { provider, model: models[0], available: [...available] };
}

export function parseImagineSlash(text) {
  const raw = String(text || "");
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return { kind: "prompt", text: raw };
  if (trimmed === "/") return { kind: "slash-help", command: "", query: "" };
  const match = trimmed.match(/^\/([a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return { kind: "prompt", text: raw };
  const command = String(match[1] || "").toLowerCase();
  const query = String(match[2] || "").trim();
  if (command === "fetch") {
    return { kind: "fetch", command: "fetch", query, formats: fetchFormatsFromQuery(query) };
  }
  if (!command || "fetch".startsWith(command)) {
    return { kind: "slash-help", command: command || "", query };
  }
  return { kind: "slash-unknown", command, query };
}

/** Tab-complete `/` or `/fet` to `/fetch `, Cursor-style. */
export function completeImagineSlash(text) {
  const raw = String(text ?? "");
  const parsed = parseImagineSlash(raw);
  const prefix = raw.match(/^\s*/)?.[0] || "";
  if (parsed.kind === "slash-help") {
    return `${prefix}/fetch${parsed.query ? ` ${parsed.query}` : " "}`;
  }
  if (parsed.kind === "fetch" && !parsed.query && !/\s$/.test(raw)) {
    return `${prefix}/fetch `;
  }
  return null;
}

export function fetchFormatsFromQuery(query) {
  const text = String(query || "").toLowerCase();
  const mentioned = {
    stl: /\bstl\b/.test(text),
    glb: /\bglb\b|\bgltf\b/.test(text),
    step: /\bstep\b|\bstp\b/.test(text),
    "3mf": /\b3mf\b/.test(text),
  };
  const any = FETCH_FORMATS.some((id) => mentioned[id]);
  if (!any) {
    return { stl: true, glb: true, step: true, "3mf": false };
  }
  return {
    stl: mentioned.stl,
    glb: mentioned.glb,
    step: mentioned.step,
    "3mf": mentioned["3mf"],
  };
}

export function normalizeFetchFormats(formats) {
  const src = formats && typeof formats === "object" ? formats : fetchFormatsFromQuery("");
  return {
    stl: !!src.stl,
    glb: !!src.glb,
    step: !!src.step,
    "3mf": !!src["3mf"],
  };
}

export function imagineEmptyStateMessage() {
  return "Connect an OpenAI or Grok API key in AI & Billing to generate Imagine images. Imagine uses your key — OpenAI Image 2.5 or Grok Imagine — not a separate Studio product.";
}

export function imagineMarkupContextText({ strokeCount = 0, notes = "" } = {}) {
  const bits = [];
  if (Number(strokeCount) > 0) bits.push(`Use ${Number(strokeCount)} markup stroke(s) as edit intent.`);
  const note = String(notes || "").trim();
  if (note) bits.push(`Notes:\n${note}`);
  return bits.join("\n");
}

export const IMAGINE_ATTACH_LIMIT = 8;
const IMAGINE_REF_IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|heic|heif|tiff?)$/i;
const IMAGINE_REF_PDF_RE = /\.pdf$/i;
const IMAGINE_REF_DOC_RE = /\.(txt|md|csv|tsv|json|ya?ml|log|rtf|svg)$/i;
const IMAGINE_REF_VIDEO_RE = /\.(webm|mp4|mov|m4v)$/i;

export function isImagineReferenceFile(file) {
  const name = String(file?.name || "");
  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("image/") || IMAGINE_REF_IMAGE_RE.test(name)) return true;
  if (type === "application/pdf" || IMAGINE_REF_PDF_RE.test(name)) return true;
  if (type.startsWith("text/") || type === "application/json" || type.includes("yaml") || IMAGINE_REF_DOC_RE.test(name)) {
    return true;
  }
  if (IMAGINE_REF_VIDEO_RE.test(name) || type.startsWith("video/")) return true;
  return false;
}

export function imagineReferenceKind(file) {
  const name = String(file?.name || "");
  const type = String(file?.type || "").toLowerCase();
  if ((type.startsWith("image/") && type !== "image/svg+xml") || IMAGINE_REF_IMAGE_RE.test(name)) return "image";
  if (type === "application/pdf" || IMAGINE_REF_PDF_RE.test(name)) return "document";
  if (type.startsWith("text/") || type === "application/json" || type.includes("yaml") || IMAGINE_REF_DOC_RE.test(name)) {
    return "document";
  }
  if (IMAGINE_REF_VIDEO_RE.test(name) || type.startsWith("video/")) return "video";
  return "file";
}

export function imagineReferenceToken(name) {
  const stem = String(name || "ref").replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const slug = stem.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "ref";
  return `@${slug}`;
}

function escapeImagineTokenReg(token) {
  return String(token || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function linkImagineReferenceInPrompt(text, token) {
  const raw = String(text || "");
  const tok = String(token || "").trim();
  if (!tok) return raw;
  if (raw.includes(tok)) return raw;
  return insertMentionWithTrailingSpace(raw, tok).value;
}

export function unlinkImagineReferenceFromPrompt(text, token) {
  const tok = String(token || "").trim();
  if (!tok) return String(text || "");
  return String(text || "")
    .replace(new RegExp(`\\s*${escapeImagineTokenReg(tok)}\\s*`, "g"), " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n /g, "\n")
    .trim();
}

export function isImagineComposePaneActive(el) {
  if (!el) return false;
  const cls = el.classList;
  if (cls?.contains) return cls.contains("active") && !cls.contains("hidden");
  const raw = String(el.className || "");
  return /\bactive\b/.test(raw) && !/\bhidden\b/.test(raw);
}

export function isImagineComposeTabActive(root = globalThis.document) {
  return isImagineComposePaneActive(root?.getElementById?.("prompt-pane-imagine"));
}

export function imagineAttachmentsToRequest(attachments = []) {
  const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  const images = list.filter((a) => a.type === "image" && a.data_url);
  const image = images[0]
    ? {
        data_url: images[0].data_url,
        name: images[0].name || "image.png",
        media_type: images[0].media_type || "image/png",
        source_filename: images[0].source_filename,
      }
    : null;
  const references = list.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type || "file",
    token: a.token,
    media_type: a.media_type || undefined,
    text: a.text || undefined,
    source_filename: a.source_filename || undefined,
  }));
  return { image, references };
}

export function imagineReferencePromptBlock(references = []) {
  const lines = [];
  for (const ref of references || []) {
    if (!ref) continue;
    const token = String(ref.token || "").trim();
    const name = String(ref.name || "").trim();
    const kind = String(ref.type || "file").trim() || "file";
    if (!token && !name) continue;
    const extra = name && token && token !== name && token.replace(/^@/, "") !== name ? ` ${name}` : "";
    lines.push(`- ${token || name}: ${kind}${extra}`.trim());
    const text = String(ref.text || "").trim();
    if (text) lines.push(text.slice(0, 4000));
  }
  if (!lines.length) return "";
  return `Attached as reference:\n${lines.join("\n")}`;
}

export function imagineHistoryEntryFromFile(item = {}, projectId = "") {
  const prompt = String(item.prompt || item.label || "").trim();
  const original = String(item.original_prompt || "").trim();
  const mtime = Number(item.mtime);
  const created = Number.isFinite(mtime) && mtime > 0
    ? new Date(mtime > 1e12 ? mtime : mtime * 1000).toISOString()
    : "";
  return {
    id: item.id || item.name || `imagine-${created || "file"}`,
    kind: "imagine",
    prompt,
    original_prompt: original,
    prompt_improved: Boolean(item.prompt_improved) || (original && original !== prompt),
    filename: item.name || "",
    project_id: projectId || item.project_id || "",
    cost_usd: item.cost_usd != null ? Number(item.cost_usd) : null,
    created_at: created,
    model: item.model || "",
    provider: item.provider || "",
    prompt_mode: "imagine",
    success: true,
    image_count: isImagineCadRel(item.name) ? 0 : 1,
    images: isImagineCadRel(item.name) || !item.name ? [] : [{
      id: item.name,
      name: String(item.name).replace(/^.*\//, ""),
      source_filename: item.name,
      url: projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/files/${String(item.name).split("/").filter(Boolean).map(encodeURIComponent).join("/")}`
        : "",
    }],
  };
}

export function createImagineUI({
  root,
  api,
  rawFetch,
  getProjectId,
  ensureProject,
  getSelectedProvider,
  listImageKeys,
  getImagineSpeed,
  getAiKeyFields,
  openAiBilling,
  openImageViewer,
  sendToCad,
  sendToMesh,
  setStatus,
  refreshProject,
  improvePrompt,
  onRenameItem,
  onViewPromptCompare,
  onHistoryChange,
  onFinish,
} = {}) {
  if (!root) return { refresh() {}, receiveMarkup() {}, attachDroppedFiles: async () => 0, getFormats() { return fetchFormatsFromQuery(""); } };

  const input = root.querySelector("#imagine-input");
  const generateBtn = root.querySelector("#imagine-generate");
  const countSel = root.querySelector("#imagine-count");
  const emptyEl = root.querySelector("#imagine-empty");
  const statusEl = root.querySelector("#imagine-status");
  const galleryEl = root.querySelector("#imagine-gallery");
  const historyEl = root.querySelector("#imagine-history");
  const searchEl = root.querySelector("#imagine-search");
  const spiceBtn = root.querySelector("#imagine-spice");
  const slashEl = root.querySelector("#imagine-slash");
  const formatBar = root.querySelector("#imagine-fetch-formats");
  const imageListEl = root.querySelector("#imagine-image-list");
  const chipsEl = root.querySelector("#imagine-inline-ref-chips");
  const composeEl = root.querySelector(".imagine-compose");
  let items = [];
  let selectedName = "";
  let libraryView = readImagineLibraryViewPref();
  let searchQuery = "";
  let markupNotes = "";
  let markupImage = null;
  let attachments = [];
  let busy = false;
  let renameMenu = null;
  let historyUi = null;
  let restoringImagineDraft = false;

  function saveImagineComposeDraft(pid = getProjectId?.()) {
    const key = String(pid || "").trim();
    if (restoringImagineDraft || !key) return;
    const livePid = String(getProjectId?.() || "").trim();
    if (livePid && livePid !== key) return;
    const map = readImagineComposeDrafts();
    map[key] = {
      prompt: String(input?.value || ""),
      project_id: key,
      updated_at: Date.now(),
    };
    writeImagineComposeDrafts(map);
  }

  function restoreImagineComposeDraft(pid = getProjectId?.(), { allowLiveFallback = false } = {}) {
    const key = String(pid || "").trim();
    const map = key ? readImagineComposeDrafts() : {};
    const draft = key ? map[key] : null;
    const owned = draft && String(draft.project_id || key) === key ? draft : null;
    const stored = String(owned?.prompt || "");
    const live = allowLiveFallback ? String(input?.value || "") : "";
    const text = pickComposeRestorePrompt({ stored, live, allowLiveFallback });
    restoringImagineDraft = true;
    try {
      if (input) input.value = text;
      syncSlashUi();
    } finally {
      restoringImagineDraft = false;
    }
  }

  function resetImagineForProjectSwitch(pid) {
    restoringImagineDraft = true;
    try {
      if (input) input.value = "";
      attachments = [];
      renderImagineAttachments();
      historyUi?.render?.([]);
    } finally {
      restoringImagineDraft = false;
    }
    restoreImagineComposeDraft(pid, { allowLiveFallback: false });
  }

  function announce(kind, text) {
    if (statusEl) {
      statusEl.className = `status ${kind || ""}`.trim();
      statusEl.textContent = text || "";
    }
    setStatus?.(kind, text);
  }

  function isImproveOn() {
    return spiceBtn?.getAttribute("aria-pressed") === "true";
  }

  function setImproveOn(on) {
    const next = writeImagineImprovePref(!!on);
    if (!spiceBtn) return next;
    spiceBtn.setAttribute("aria-pressed", next ? "true" : "false");
    spiceBtn.classList.toggle("is-on", next);
    spiceBtn.title = next
      ? "Improve Imagine prompt — on. Expands goal, orientation, and context."
      : "Improve Imagine prompt — off. Sends your text as written.";
    return next;
  }

  function currentFormats() {
    if (!formatBar) return fetchFormatsFromQuery(input?.value || "");
    const out = { stl: false, glb: false, step: false, "3mf": false };
    formatBar.querySelectorAll("[data-imagine-format]").forEach((box) => {
      out[box.dataset.imagineFormat] = !!box.checked;
    });
    return out;
  }

  function syncFormatChecks(formats) {
    if (!formatBar) return;
    formatBar.querySelectorAll("[data-imagine-format]").forEach((box) => {
      box.checked = !!formats[box.dataset.imagineFormat];
    });
  }

  function applySlashCompletion(next) {
    if (!input || next == null) return;
    input.value = next;
    const end = next.length;
    input.setSelectionRange(end, end);
    const parsed = parseImagineSlash(next);
    if (parsed.kind === "fetch" || parsed.kind === "slash-help") {
      syncFormatChecks(fetchFormatsFromQuery(parsed.query || ""));
    }
    syncSlashUi();
  }

  function syncSlashUi() {
    const parsed = parseImagineSlash(input?.value || "");
    const unknown = parsed.kind === "slash-unknown";
    const showMenu = parsed.kind === "slash-help" || unknown;
    slashEl?.classList.toggle("hidden", !showMenu);
    slashEl?.classList.toggle("is-unknown", unknown);
    slashEl?.querySelector("#imagine-slash-fetch")?.classList.toggle("hidden", unknown);
    slashEl?.querySelector("#imagine-slash-unknown")?.classList.toggle("hidden", !unknown);
    formatBar?.classList.toggle("hidden", parsed.kind !== "fetch" && !(parsed.kind === "slash-help" && String(parsed.command || "").startsWith("fet")));
    if (parsed.kind === "fetch" || (parsed.kind === "slash-help" && parsed.query)) {
      syncFormatChecks(parsed.formats || fetchFormatsFromQuery(parsed.query || ""));
    }
    if (generateBtn) {
      const label = generateBtn.querySelector("[data-imagine-generate-label]");
      (label || generateBtn).textContent = parsed.kind === "fetch" ? "Fetch model" : "Imagine";
    }
  }

  function routing() {
    return resolveImagineProvider({
      selectedProvider: getSelectedProvider?.() || "",
      keys: listImageKeys?.() || [],
      speed: getImagineSpeed?.() || "fast",
    });
  }

  function renderEmpty() {
    const route = routing();
    const missing = !route.provider;
    emptyEl?.classList.toggle("hidden", !missing);
    if (emptyEl && missing) emptyEl.textContent = imagineEmptyStateMessage();
    if (generateBtn) generateBtn.disabled = missing || busy;
    return !missing;
  }

  function fileUrl(item) {
    const pid = getProjectId?.();
    if (item?.url) return item.url;
    if (!pid || !item?.name) return "";
    return `/api/projects/${encodeURIComponent(pid)}/files/${String(item.name).split("/").map(encodeURIComponent).join("/")}`;
  }

  function visibleItems() {
    return filterImagineLibrary(items, searchQuery);
  }

  function closeRenameMenu() {
    renameMenu?.remove();
    renameMenu = null;
  }

  function showRenameMenu(event, item) {
    closeRenameMenu();
    if (!item?.name) return;
    const menu = document.createElement("div");
    menu.className = "imagine-rename-menu";
    menu.innerHTML = `<button type="button" data-imagine-rename>Rename</button>`;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - rect.height - 8)}px`;
    menu.querySelector("[data-imagine-rename]")?.addEventListener("click", () => {
      closeRenameMenu();
      void onRenameItem?.(item);
    });
    renameMenu = menu;
  }

  function setLibraryView(view) {
    libraryView = normalizeImagineLibraryView(view, libraryView);
    if (libraryView !== "history") writeImagineLibraryViewPref(libraryView);
    root.querySelectorAll("[data-imagine-library]").forEach((btn) => {
      const on = btn.dataset.imagineLibrary === libraryView;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const showGallery = libraryView === "grid" || libraryView === "list";
    galleryEl?.classList.toggle("hidden", !showGallery);
    galleryEl?.classList.toggle("imagine-gallery--list", libraryView === "list");
    galleryEl?.classList.toggle("imagine-gallery--grid", libraryView === "grid");
    if (galleryEl) galleryEl.dataset.imagineLibraryPane = libraryView === "list" ? "list" : "grid";
    historyEl?.classList.toggle("hidden", libraryView !== "history");
    renderLibrary();
  }

  function renderLibrary() {
    const rows = visibleItems();
    if (galleryEl) {
      if (!rows.length) {
        galleryEl.innerHTML = items.length
          ? `<p class="muted small imagine-gallery-empty">No Imagine files match that search.</p>`
          : `<p class="muted small imagine-gallery-empty">No Imagine files yet. Generated images land in the project <code>${IMAGINE_FOLDER}</code> folder.</p>`;
      } else {
        galleryEl.innerHTML = rows.map((item) => {
          const cad = isImagineCadRel(item.name);
          const active = item.name === selectedName ? " is-selected" : "";
          const src = cad ? "" : fileUrl(item);
          const label = imagineDisplayName(item);
          const prompt = imagineItemPrompt(item);
          const media = cad
            ? `<span class="imagine-thumb-cad">${escapeHtml((item.format || "CAD").toUpperCase())}</span>`
            : `<img src="${escapeAttr(src)}" alt="${escapeHtml(label)}" />`;
          if (libraryView === "list") {
            return `<button type="button" class="imagine-row${active}${cad ? " imagine-row--cad" : ""}" data-imagine-file="${escapeAttr(item.name)}" title="${escapeAttr(label)}">
              <span class="imagine-row-media">${media}</span>
              <span class="imagine-row-copy">
                <strong>${escapeHtml(label)}</strong>
                <span>${escapeHtml(prompt || label)}</span>
              </span>
            </button>`;
          }
          return `<button type="button" class="imagine-thumb${active}${cad ? " imagine-thumb--cad" : ""}" data-imagine-file="${escapeAttr(item.name)}" title="${escapeAttr(label)}">
            ${media}
            <span class="imagine-thumb-name">${escapeHtml(label)}</span>
          </button>`;
        }).join("");
      }
    }
    if (libraryView === "history") void refreshImagineHistory();
  }

  let imagineRefreshAbort = null; // leakfix66
  function beginImagineRefreshFetch() {
    if (imagineRefreshAbort) {
      try { imagineRefreshAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    imagineRefreshAbort = ctl;
    return ctl;
  }

  async function refresh() {
    renderEmpty();
    if (countSel && !countSel.dataset.userSet) countSel.value = String(readImagineCountPref());
    const pid = getProjectId?.();
    if (!pid) {
      items = [];
      renderLibrary();
      return;
    }
    const ctl = beginImagineRefreshFetch();
    try {
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/imagine`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      items = Array.isArray(data?.files) ? data.files : [];
      if (selectedName && !items.some((it) => it.name === selectedName)) selectedName = items[0]?.name || "";
      else if (!selectedName) selectedName = items[0]?.name || "";
      renderLibrary();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      renderLibrary();
    } finally {
      if (imagineRefreshAbort === ctl) imagineRefreshAbort = null;
    }
  }

  function selectedItem() {
    return items.find((it) => it.name === selectedName) || items[0] || null;
  }

  async function runImagine() {
    if (busy) return;
    const parsed = parseImagineSlash(input?.value || "");
    if (parsed.kind === "fetch") {
      await runFetch(parsed);
      return;
    }
    if (parsed.kind === "slash-help" || parsed.kind === "slash-unknown") {
      announce("error", parsed.kind === "slash-unknown"
        ? `Unknown command /${parsed.command}. Try /fetch.`
        : "Type /fetch plus a model name, or a product prompt without a slash.");
      return;
    }
    if (!renderEmpty()) {
      announce("error", imagineEmptyStateMessage());
      openAiBilling?.();
      return;
    }
    let prompt = String(input?.value || "").trim();
    if (!prompt) {
      announce("error", "Describe the product or concept to imagine.");
      return;
    }
    const originalPrompt = prompt;
    const route = routing();
    busy = true;
    if (generateBtn) generateBtn.disabled = true;
    try {
      if (isImproveOn() && typeof improvePrompt === "function") {
        announce("loading", "Improving prompt for Imagine…");
        const improved = String(await improvePrompt(prompt) || "").trim();
        if (improved) prompt = improved;
      }
      announce("loading", `Generating with ${route.provider === "xai" ? "Grok Imagine" : "OpenAI Image 2.5"}…`);
      await ensureProject?.();
      const pid = getProjectId?.();
      if (!pid) throw new Error("Select or create a project first.");
      const attachPayload = imagineAttachmentsToRequest(attachments);
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/imagine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          original_prompt: originalPrompt,
          count: clampImagineCount(countSel?.value || readImagineCountPref()),
          notes: markupNotes,
          image: attachPayload.image || markupImage,
          references: attachPayload.references,
          speed: getImagineSpeed?.() || "fast",
          ...imagineKeyFields(),
        }),
      });
      items = Array.isArray(data?.files) ? data.files : items;
      selectedName = data?.files?.[0]?.name || selectedName;
      renderLibrary();
      announce("ok", data?.message || `Saved ${data?.files?.length || 0} image(s) to ${IMAGINE_FOLDER}/.`);
      markupNotes = "";
      markupImage = null;
      renderImagineAttachments();
      await refreshProject?.();
      await refresh();
      await refreshImagineHistory();
      onHistoryChange?.();
      onFinish?.({ pid, data });
    } catch (err) {
      announce("error", err?.message || "Imagine failed.");
    } finally {
      busy = false;
      renderEmpty();
    }
  }

  function imagineKeyFields() {
    const fromPicker = getAiKeyFields?.() || {};
    if (fromPicker.ai_key_id || fromPicker.ai_key_source) return fromPicker;
    const keys = listImageKeys?.() || [];
    const route = routing();
    const match = keys.find((k) => normalizeImagineProvider(k.provider) === route.provider);
    const fields = {};
    if (match?.id) {
      fields.ai_key_id = match.id;
      fields.ai_key_source = match.source || "personal";
    }
    return fields;
  }

  async function runFetch(parsed) {
    if (busy) return;
    const query = String(parsed.query || "").trim();
    if (!query) {
      announce("error", "Type /fetch plus what to download, e.g. /fetch open arm 2.0 3d step model");
      return;
    }
    busy = true;
    if (generateBtn) generateBtn.disabled = true;
    announce("loading", "Fetching public CAD from step.parts and any pasted file URL…");
    try {
      await ensureProject?.();
      const pid = getProjectId?.();
      if (!pid) throw new Error("Select or create a project first.");
      const data = await api(`/api/projects/${encodeURIComponent(pid)}/imagine/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          formats: currentFormats(),
        }),
      });
      const files = Array.isArray(data?.files) ? data.files : [];
      if (!files.length) {
        announce("error", data?.message || "Nothing found — try a more specific name or paste a public .step / .stl / .glb URL.");
        return;
      }
      items = [...files, ...items.filter((it) => !files.some((f) => f.name === it.name))];
      selectedName = files[0]?.name || selectedName;
      renderLibrary();
      announce("ok", data?.message || `Saved ${files.length} file(s) to ${IMAGINE_FETCHED_FOLDER}/.`);
      await refreshProject?.();
      await refresh();
      await refreshImagineHistory();
      onHistoryChange?.();
    } catch (err) {
      announce("error", err?.message || "Fetch was blocked or found nothing.");
    } finally {
      busy = false;
      renderEmpty();
    }
  }

  function attachmentSrc(img) {
    const dataUrl = String(img?.data_url || "");
    if (dataUrl.startsWith("data:image/") || dataUrl.startsWith("blob:")) return dataUrl;
    const preview = String(img?.preview_url || img?.url || "");
    if (preview.startsWith("data:image/") || preview.startsWith("blob:") || preview.startsWith("/")) return preview;
    return "";
  }

  function syncMarkupImage() {
    markupImage = attachments.find((a) => a.type === "image" && (a.data_url || a.preview_url)) || null;
  }

  function uniqueAttachmentToken(name) {
    const base = imagineReferenceToken(name);
    const used = new Set(attachments.map((a) => a.token));
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}${n}`)) n += 1;
    return `${base}${n}`;
  }

  function ensureTokenInPrompt(token) {
    if (!input || !token) return;
    input.value = linkImagineReferenceInPrompt(input.value, token);
    syncSlashUi();
  }

  function removeTokenFromPrompt(token) {
    if (!input || !token) return;
    input.value = unlinkImagineReferenceFromPrompt(input.value, token);
    syncSlashUi();
  }

  function removeAttachment(id) {
    const next = attachments.filter((a) => a.id !== id);
    const removed = attachments.find((a) => a.id === id);
    attachments = next;
    if (removed?.token) removeTokenFromPrompt(removed.token);
    if (removed?.type === "image") markupNotes = "";
    syncMarkupImage();
    renderImagineAttachments();
    announce("ok", removed?.name ? `Removed ${removed.name} from Imagine.` : "Removed Imagine attachment.");
  }

  function upsertAttachment(att, { insertMention = false } = {}) {
    if (!att?.id) return null;
    const idx = attachments.findIndex((a) => a.id === att.id || (att.fileKey && a.fileKey === att.fileKey));
    if (idx >= 0) {
      attachments[idx] = { ...attachments[idx], ...att };
    } else {
      if (attachments.length >= IMAGINE_ATTACH_LIMIT) return null;
      attachments.push(att);
    }
    if (insertMention && att.token) ensureTokenInPrompt(att.token);
    syncMarkupImage();
    renderImagineAttachments();
    return att;
  }

  function renderImagineAttachments() {
    if (chipsEl) {
      chipsEl.classList.toggle("hidden", !attachments.length);
      if (!attachments.length) {
        chipsEl.innerHTML = "";
      } else {
        const count = attachments.length === 1
          ? "1 file attached as reference"
          : `${attachments.length} files attached as reference`;
        chipsEl.innerHTML = `<div class="prompt-ref-count">${escapeHtml(count)}</div>${attachments.map((att) => {
          const label = att.token || att.name || "file";
          return `<span class="ref-chip ref-chip--inline" data-imagine-ref-id="${escapeAttr(att.id)}" title="${escapeAttr(label)}">
            <span class="ref-token">${escapeHtml(att.name || label)}</span>
            <button type="button" class="ref-remove" title="Remove">×</button>
          </span>`;
        }).join("")}`;
        chipsEl.querySelectorAll(".ref-remove").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = btn.closest("[data-imagine-ref-id]")?.dataset.imagineRefId;
            if (id) removeAttachment(id);
          });
        });
        chipsEl.querySelectorAll("[data-imagine-ref-id]").forEach((chip) => {
          chip.addEventListener("click", (e) => {
            if (e.target.closest(".ref-remove")) return;
            e.preventDefault();
            e.stopPropagation();
            const id = chip.dataset.imagineRefId;
            const att = attachments.find((a) => a.id === id);
            if (!att) return;
            void copyPromptChipValue(att).then((payload) => {
              if (payload) announce("ok", copiedChipStatus(payload.kind));
            });
          });
        });
      }
    }
    if (!imageListEl) return;
    if (!attachments.length) {
      imageListEl.innerHTML = "";
      return;
    }
    imageListEl.innerHTML = attachments.map((att) => {
      const name = String(att.name || att.source_filename || "file");
      const src = att.type === "image" ? attachmentSrc(att) : "";
      const badge = att.type === "document"
        ? (/\.pdf$/i.test(name) ? "PDF" : "DOC")
        : att.type === "image" ? "IMG" : "FILE";
      const thumb = src
        ? `<img src="${escapeAttr(src)}" alt="${escapeHtml(name)}" />`
        : `<div class="prompt-image-missing" title="${escapeAttr(name)}">${escapeHtml(badge)}</div>`;
      return `<div class="prompt-image-card" data-imagine-attach="${escapeAttr(att.id)}" role="button" tabindex="0" title="Attached as reference">
        ${thumb}
        <button type="button" class="prompt-image-remove" title="Remove">×</button>
        <span>${escapeHtml(name)}</span>
      </div>`;
    }).join("");
    imageListEl.querySelectorAll(".prompt-image-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.closest("[data-imagine-attach]")?.dataset.imagineAttach;
        if (id) removeAttachment(id);
      });
    });
    imageListEl.querySelectorAll(".prompt-image-card").forEach((card) => {
      const openAttached = () => {
        const att = attachments.find((a) => a.id === card.dataset.imagineAttach);
        if (att?.source_filename || selectedName) {
          const item = items.find((it) => it.name === (att?.source_filename || selectedName)) || selectedItem();
          if (item && !isImagineCadRel(item.name)) openImageViewer?.(item);
        }
      };
      card.addEventListener("click", (e) => {
        if (e.target.closest(".prompt-image-remove")) return;
        openAttached();
      });
    });
  }

  function readDroppedFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("read"));
      reader.readAsDataURL(file);
    });
  }

  async function attachDroppedFiles(files = []) {
    const list = [...(files || [])].filter((file) => file && isImagineReferenceFile(file));
    if (!list.length) return 0;
    let added = 0;
    for (const file of list) {
      if (attachments.length >= IMAGINE_ATTACH_LIMIT) break;
      const fileKey = `${file.name}:${file.size}:${file.lastModified || 0}`;
      if (attachments.some((a) => a.fileKey === fileKey)) continue;
      if (file.size > 12 * 1024 * 1024) {
        announce("error", `${file.name} is too large. Use files under 12 MB.`);
        continue;
      }
      const kind = imagineReferenceKind(file);
      const token = uniqueAttachmentToken(file.name);
      let ready = file;
      try {
        ready = await convertHeicFileToPng(file);
      } catch (err) {
        announce("error", err?.message || `${file.name} could not be converted from HEIC.`);
        continue;
      }
      const att = {
        id: `imagine-ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        fileKey,
        name: ready.name,
        type: kind,
        token,
        media_type: ready.type || file.type || (kind === "image" ? "image/png" : kind === "document" ? "application/pdf" : "application/octet-stream"),
      };
      try {
        if (kind === "image") {
          att.data_url = await readDroppedFileAsDataUrl(ready);
        } else if (kind === "document" && !/\.pdf$/i.test(file.name) && !/\.svg$/i.test(file.name)) {
          const text = await file.text();
          att.text = String(text || "").slice(0, 100000);
        }
      } catch {
        announce("error", `${file.name} could not be read.`);
        continue;
      }
      if (upsertAttachment(att)) added += 1;
    }
    if (added > 0) {
      announce(
        "ok",
        added === 1
          ? `Attached ${list[0].name} as a reference.`
          : `Attached ${added} files as references.`,
      );
    }
    return added;
  }

  function setComposeDragging(on) {
    composeEl?.classList.toggle("dragging", !!on);
    root?.classList.toggle("dragging-image", !!on);
  }

  function handleImaginePaneDragover(e) {
    const files = [...(e.dataTransfer?.files || [])];
    const types = [...(e.dataTransfer?.types || [])];
    const maybeFiles = types.includes("Files") || files.some((file) => isImagineReferenceFile(file));
    if (!maybeFiles) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setComposeDragging(true);
  }

  async function handleImaginePaneDrop(e) {
    const files = [...(e.dataTransfer?.files || [])].filter((file) => isImagineReferenceFile(file));
    setComposeDragging(false);
    if (!files.length) return 0;
    e.preventDefault();
    e.stopPropagation();
    return attachDroppedFiles(files);
  }

  async function hydrateMarkupFromFilename(name) {
    const item = items.find((it) => it.name === name) || { name };
    const url = fileUrl(item);
    if (!url || !rawFetch) return;
    try {
      const res = await rawFetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("read"));
        reader.readAsDataURL(blob);
      });
      const existing = attachments.find((a) => a.source_filename === name);
      const att = {
        id: existing?.id || `imagine-ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        data_url: dataUrl,
        name: String(name).replace(/^.*\//, "") || "imagine.png",
        media_type: blob.type || "image/png",
        source_filename: name,
        type: "image",
        token: existing?.token || uniqueAttachmentToken(name),
      };
      upsertAttachment(att, { insertMention: false });
    } catch {
      /* keep chip without bytes */
    }
  }

  function loadImagineHistoryEntry(entry, { useOriginal = true } = {}) {
    const original = String(entry?.original_prompt || "").trim();
    const improved = String(entry?.prompt || "").trim();
    const text = useOriginal ? (original || improved) : (improved || original);
    if (input && text) input.value = text;
    selectedName = entry?.filename || selectedName;
    attachments = [];
    const imgs = Array.isArray(entry?.images) ? entry.images : [];
    const first = imgs.find((img) => img?.data_url) || imgs[0];
    if (first?.data_url) {
      upsertAttachment({
        id: first.id || `imagine-hist-${Date.now()}`,
        data_url: first.data_url,
        name: first.name || String(entry.filename || "imagine.png").replace(/^.*\//, ""),
        media_type: first.media_type || "image/png",
        source_filename: first.source_filename || entry.filename,
        type: "image",
        token: imagineReferenceToken(first.name || entry.filename || "imagine.png"),
      }, { insertMention: false });
    } else if (first?.url || first?.source_filename || (entry?.filename && !isImagineCadRel(entry.filename))) {
      const name = first?.source_filename || entry.filename;
      upsertAttachment({
        id: first?.id || `imagine-hist-${Date.now()}`,
        name: String(first?.name || name || "imagine.png").replace(/^.*\//, ""),
        preview_url: first?.url || fileUrl({ name }),
        source_filename: name,
        type: "image",
        token: imagineReferenceToken(first?.name || name || "imagine.png"),
      }, { insertMention: false });
      if (name && !isImagineCadRel(name)) void hydrateMarkupFromFilename(name);
    } else {
      syncMarkupImage();
      renderImagineAttachments();
    }
    syncSlashUi();
    input?.focus?.();
    announce("ok", "Loaded Imagine prompt from history.");
  }

  async function refreshImagineHistory() {
    if (!historyEl) return;
    const pid = getProjectId?.();
    let entries = [];
    let summary = null;
    if (pid) {
      try {
        const data = await api(`/api/projects/${encodeURIComponent(pid)}/prompt-history?kind=imagine`);
        entries = (Array.isArray(data?.entries) ? data.entries : []).map((e) => ({
          ...e,
          kind: e.kind || "imagine",
          project_id: e.project_id || pid,
        }));
        summary = data?.filtered_usage_summary || data?.usage_summary || null;
      } catch {
        entries = [];
      }
    }
    const have = new Set(entries.map((e) => String(e.filename || "")));
    for (const item of items) {
      if (item?.name && !have.has(item.name)) {
        entries.push(imagineHistoryEntryFromFile(item, pid));
      }
    }
    if (searchQuery) {
      const q = String(searchQuery).toLowerCase();
      entries = entries.filter((e) => {
        const hay = [e.prompt, e.original_prompt, e.filename, e.project_id].map((s) => String(s || "").toLowerCase()).join(" ");
        return hay.includes(q);
      });
    }
    if (!historyUi) {
      historyEl.innerHTML = entries.length
        ? ""
        : `<p class="muted small imagine-gallery-empty">Prompt history appears here after you generate Imagine stills.</p>`;
      return;
    }
    historyUi.render(entries, summary);
  }

  function receiveMarkup(payload = {}) {
    markupNotes = String(payload.notes || "").trim();
    const img = (payload.images || [])[0];
    if (img?.data_url) {
      const name = img.name || `${String(payload.filename || "imagine").replace(/^.*\//, "")}-marked.png`;
      upsertAttachment({
        id: img.id || `imagine-mark-${Date.now()}`,
        data_url: img.data_url,
        name,
        media_type: img.media_type || "image/png",
        source_filename: img.source_filename || payload.filename,
        type: "image",
        token: imagineReferenceToken(name),
      }, { insertMention: false });
    } else {
      renderImagineAttachments();
    }
    const block = imagineMarkupContextText({ strokeCount: payload.strokeCount, notes: markupNotes });
    const current = String(input?.value || "").trim();
    if (block) {
      const next = current.includes(block) ? current : (current ? `${current}\n\n${block}` : block);
      input.value = next.replace(/\[Imagine markup:\s*[^\]]+\]\s*/g, "").replace(/\n{3,}/g, "\n\n").trim();
    } else if (current) {
      input.value = current.replace(/\[Imagine markup:\s*[^\]]+\]\s*/g, "").replace(/\n{3,}/g, "\n\n").trim();
    }
    selectedName = payload.filename || selectedName;
    syncSlashUi();
    announce("ok", markupImage ? "Attached marked image to Imagine." : "Markup notes returned to Imagine.");
  }

  function selectImagineFile(name, { openViewer = false } = {}) {
    selectedName = name;
    renderLibrary();
    const item = selectedItem();
    if (openViewer && item && !isImagineCadRel(item.name)) openImageViewer?.(item);
    return item;
  }

  function onLibraryActivate(e) {
    const btn = e.target.closest("[data-imagine-file]");
    if (!btn) return;
    const item = selectImagineFile(btn.dataset.imagineFile, {
      openViewer: e.currentTarget === galleryEl && libraryView === "grid",
    });
    if (e.currentTarget === historyEl && item) {
      const prompt = imagineItemPrompt(item);
      if (prompt && input) input.value = prompt;
    }
  }

  function onLibraryContext(e) {
    const btn = e.target.closest("[data-imagine-file]");
    if (!btn) return;
    e.preventDefault();
    selectedName = btn.dataset.imagineFile;
    renderLibrary();
    showRenameMenu(e, selectedItem());
  }

  generateBtn?.addEventListener("click", () => { void runImagine(); });
  slashEl?.addEventListener("click", (e) => {
    const cmd = e.target.closest("[data-imagine-slash]");
    if (!cmd || !input) return;
    e.preventDefault();
    applySlashCompletion(completeImagineSlash(input.value) || "/fetch ");
    input.focus();
  });
  input?.addEventListener("input", () => {
    if (String(input.value || "").startsWith("/")) {
      const parsed = parseImagineSlash(input.value);
      if (parsed.kind === "fetch" || parsed.kind === "slash-help") syncFormatChecks(fetchFormatsFromQuery(parsed.query || ""));
    }
    syncSlashUi();
    if (!restoringImagineDraft) saveImagineComposeDraft();
  });
  input?.addEventListener("keydown", (e) => {
    if ((e.key === "Tab" || e.key === "Enter") && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      const next = completeImagineSlash(input.value);
      if (next != null && (e.key === "Tab" || parseImagineSlash(input.value).kind === "slash-help")) {
        e.preventDefault();
        applySlashCompletion(next);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void runImagine();
    }
  });
  countSel?.addEventListener("change", () => {
    countSel.dataset.userSet = "1";
    writeImagineCountPref(countSel.value);
  });
  galleryEl?.addEventListener("click", onLibraryActivate);
  galleryEl?.addEventListener("contextmenu", onLibraryContext);
  historyEl?.addEventListener("contextmenu", onLibraryContext);
  searchEl?.addEventListener("input", () => {
    searchQuery = String(searchEl.value || "");
    renderLibrary();
  });
  root.querySelectorAll("[data-imagine-library]").forEach((btn) => {
    btn.addEventListener("click", () => setLibraryView(btn.dataset.imagineLibrary));
  });
  spiceBtn?.addEventListener("click", () => setImproveOn(!isImproveOn()));
  document.addEventListener("click", (e) => {
    if (renameMenu && !renameMenu.contains(e.target)) closeRenameMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRenameMenu();
  });
  root.querySelector("#imagine-open-viewer")?.addEventListener("click", () => {
    const item = selectedItem();
    if (!item) {
      announce("error", "Generate or select an image first.");
      return;
    }
    openImageViewer?.(item);
  });
  root.querySelector("#imagine-send-cad")?.addEventListener("click", () => {
    const item = selectedItem();
    if (!item) {
      announce("error", "Select an Imagine result first.");
      return;
    }
    void sendToCad?.(item, { prompt: String(input?.value || "").trim() });
  });
  root.querySelector("#imagine-send-mesh")?.addEventListener("click", () => {
    const item = selectedItem();
    if (!item) {
      announce("error", "Select an Imagine result first.");
      return;
    }
    void sendToMesh?.(item, { prompt: String(input?.value || "").trim() });
  });
  emptyEl?.addEventListener("click", () => openAiBilling?.());
  if (countSel) countSel.value = String(readImagineCountPref());
  setImproveOn(readImagineImprovePref());
  if (historyEl) {
    historyUi = createPromptHistoryUI({
      listEl: historyEl,
      summaryEl: root.querySelector("#imagine-history-summary"),
      tabRoot: root,
      tabSelector: "[data-imagine-hist-none]",
      panes: { compose: root },
      getProjectId,
      onViewPromptCompare,
      onReuse: (entry, opts) => {
        loadImagineHistoryEntry(entry, opts);
        input?.focus?.();
        return "stay";
      },
    });
  }
  renderImagineAttachments();
  setLibraryView(readImagineLibraryViewPref());
  syncFormatChecks(fetchFormatsFromQuery(""));
  syncSlashUi();
  const dropHosts = [composeEl, input, chipsEl, imageListEl, root].filter(Boolean);
  dropHosts.forEach((el) => {
    el.addEventListener("dragenter", handleImaginePaneDragover);
    el.addEventListener("dragover", handleImaginePaneDragover);
    el.addEventListener("dragleave", (e) => {
      if (!composeEl?.contains(e.relatedTarget) && !root.contains(e.relatedTarget)) setComposeDragging(false);
    });
    el.addEventListener("drop", (e) => { void handleImaginePaneDrop(e); });
  });
  input?.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((file) => isImagineReferenceFile(file));
    if (!files.length) return;
    e.preventDefault();
    void attachDroppedFiles(files);
  });
  void refresh();

  return {
    refresh,
    refreshHistory: refreshImagineHistory,
    loadHistoryEntry: loadImagineHistoryEntry,
    receiveMarkup,
    attachDroppedFiles,
    getFormats: currentFormats,
    runImagine,
    parseSlash: () => parseImagineSlash(input?.value || ""),
    completeSlash: () => completeImagineSlash(input?.value || ""),
    saveDraft: saveImagineComposeDraft,
    restoreDraft: restoreImagineComposeDraft,
    resetForProjectSwitch: resetImagineForProjectSwitch,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
