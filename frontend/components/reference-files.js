/** Closable tabs for PDF / text / image / video / audio reference files with notes, pen markup, and Send to AI. */

import { mountVideoTimelineEditor, bindMediaDropTarget, mediaKindFromFile, filesFromDropEvent, isMediaFileDrag, pauseAndDetachMedia, scheduleRevokeObjectURL, scheduleVideoEditorIdle, shouldHeavyTeardownVideoEditorOnCloseTick, applyMusicSnapshotOpts, TIMELINE_CLIP_LOADING_STATUS } from "../viewport/video-timeline-editor.js?v=20260914-clipdnd1-20260914-clipmedia2-20260914-tlupload1-20260914-musicon1-20260914-clipcut1-20260914-shareprompt1-cliplit1-cliptrim1-clipkeys1-clipaud1-clipplay1-sharexcap1-vidclose1-clipaudtrim1-cliptrimui1-cliploop1-clipaudsave1-xsharebtn1-trimup1-addaudio1-escunsel1-trimdone1-sharegif2-sharexsame1-dledit1-clipauddrop1-recdedupe1-vedir1-tlkeys2-tlspin1-tlaudio1-tldupe1-imovie1-tlinstant1-filmeditkey1-clipshare1-trimwave1-trimlen1-sharexfull1-veditorhub1-clipui1-xtab1-vidlayout1-vidzoom1-vidmodel1-vidjob1-clipgen1&vidclose2=20260916-1&dlprog1=20260916-1&clipperf1-deskdbg1&leakobs1&leakfix4&leakfix30&leakfix32&leakfix33&editautosave=20261006-3";
import { authHeaders, getToken } from "../studio/auth.js?v=20260723-invite-claim";
import {
  audioCommentsPanelHtml,
  audioPlayerHtml,
  bindAudioDocumentPlayer,
  cachedAudioPeaks,
  isAudioFilename,
  peaksCacheKey,
  peaksForAudioBlob,
  rememberAudioPeaks,
} from "./audio-document-tab.js?v=mp3c1";
import { buildCanvasDrawingMetadata } from "../viewport/canvas-context.js?v=canvas-2e2d00af6fb4";
import {
  CANVAS_TOOL_SHORTCUTS,
  canvasToolFromShortcutEvent,
  isCanvasEscapeToMove,
  isCanvasRedoShortcut,
  isCanvasUndoShortcut,
} from "../viewport/canvas-mode.js?v=20260908-canvas-edit1-20260914-canvasdrop1-imgshow1-20260915-emptydots1-canvasname1-20260915-canvasperf1-canvascontext1-canvasload1-canvasshare1-toolpin1-canvaslinks1-canvaszoom1-canvascam1-heicpng1-canvasfinal1-smartdesc2-interest1-canvaskit1-promptorange1-canvasq1-caption-export1-canvasmention1-canvaslast1-canvasgrid1-imged1&vrboard=20260915-spatial-draw4&cansplit=20260916-1&cvinvite=20260916-1&leakfix8&leakfix10";
import { sortCaptureEntriesNewestFirst, formatEntryCapturedAt, captureSortMs } from "../viewport/capture-labels.js?v=20260907-capture-names-20260915-refrec1-20260915-recclock1";
import { highlightSource, lineMatchesQuery } from "../wiring/code-highlight.js?v=refcode1-foldcode1";
import { parseCsvText, parseSpreadsheetBlob, spreadsheetTableHtml } from "./spreadsheet-preview.js?v=refcode1-foldcode1";
import { codeTreeFromEntries, flattenCodeTree, PROJECT_CODE_FOLDER } from "./project-code.js?v=foldcode1";
import { triggerTrackedBlobDownload, attachPreviewObjectUrl, trackObjectUrl, revokeTrackedObjectUrls } from "../viewport/viewport-video-editor.js?v=leakfix9";

const refDownloadCreated = [];
const refMiniThumbCreated = [];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encodeFileRel(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

const CODE_FILE_RE = /\.(js|mjs|cjs|jsx|ts|tsx|py|css|scss|less|html?|md|markdown|ya?ml|sh|bash|zsh|ino|c|cc|cpp|cxx|h|hpp|java|go|rs|rb|php|sql|toml|ini|cfg|xml|jsonc)$/i;
const TEXT_FILE_RE = /\.(txt|log|rtf)$/i;
const JSON_FILE_RE = /\.json$/i;
const CSV_FILE_RE = /\.(csv|tsv)$/i;
const SHEET_FILE_RE = /\.xlsx?$/i;

export function kindFromName(filename = "") {
  const lower = String(filename).toLowerCase().split(/[?#]/)[0];
  if (/\.(png|jpe?g|webp|gif|bmp|svg|tiff?|heic|heif)$/i.test(lower)) return "image";
  if (/\.(webm|mp4|mov|m4v)$/i.test(lower)) return "video";
  if (isAudioFilename(lower)) return "audio";
  if (/\.pdf$/i.test(lower)) return "pdf";
  if (JSON_FILE_RE.test(lower)) return "json";
  if (CSV_FILE_RE.test(lower)) return "csv";
  if (SHEET_FILE_RE.test(lower)) return "spreadsheet";
  if (CODE_FILE_RE.test(lower) || TEXT_FILE_RE.test(lower)) return CODE_FILE_RE.test(lower) ? "code" : "text";
  if (/\.(docx?|pptx?)$/i.test(lower)) return "file";
  return "file";
}

export function isTextLikeKind(kind) {
  return kind === "text" || kind === "code" || kind === "json" || kind === "csv";
}

export function resolveViewerKind(filename, kindHint) {
  const hint = String(kindHint || "").toLowerCase();
  if (hint === "image" || hint === "pdf" || hint === "video" || hint === "audio") return hint;
  return kindFromName(filename) || hint || "file";
}

/** Contain-fit an image into the viewer pane (object-fit: contain). */
export function containFitSize(naturalW, naturalH, paneW, paneH, pad = 0) {
  const nw = Number(naturalW) || 0;
  const nh = Number(naturalH) || 0;
  const aw = Math.max(1, (Number(paneW) || 0) - (Number(pad) || 0));
  const ah = Math.max(1, (Number(paneH) || 0) - (Number(pad) || 0));
  if (!(nw > 0) || !(nh > 0)) return { width: 1, height: 1, scale: 1 };
  const scale = Math.min(aw / nw, ah / nh);
  return {
    width: Math.max(1, Math.round(nw * scale)),
    height: Math.max(1, Math.round(nh * scale)),
    scale,
  };
}

/** Prefer the wrap's box; if it collapsed, use the editor pane so screenshots can fill. */
export function imageEditorPaneSize(wrap, fallbackHost = null) {
  const w = Number(wrap?.clientWidth) || 0;
  const h = Number(wrap?.clientHeight) || 0;
  if (w >= 48 && h >= 48) return { width: w, height: h };
  const host = fallbackHost || wrap?.parentElement || wrap?.closest?.(".ref-split-pane, .ref-viewer-main");
  return {
    width: Math.max(w, Number(host?.clientWidth) || 0),
    height: Math.max(h, Number(host?.clientHeight) || 0),
  };
}

export const IMAGE_MARKUP_TOOLS = Object.freeze([
  "pan", "select", "pen", "highlight", "eraser", "rect", "circle", "line", "arrow", "text", "region",
]);

export function imageMarkupToolFromCanvasTool(tool) {
  const id = String(tool || "");
  if (id === "note") return "note";
  return IMAGE_MARKUP_TOOLS.includes(id) ? id : "";
}

export function imageMarkupToolFromCanvasShortcut(letter) {
  return imageMarkupToolFromCanvasTool(CANVAS_TOOL_SHORTCUTS[String(letter || "").toLowerCase()] || "");
}

/** Disk path for nested refs (`canvas.json` under Canvas/<name>/). */
export function referenceDiskPath(entry = {}) {
  const strip = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").split("#")[0].trim();
  const source = strip(entry.source_path || "");
  if (source) return source.replace(/^references\//, "");
  for (const raw of [entry.url, entry.filename, entry.name]) {
    const cleaned = strip(raw).replace(/^api\/projects\/[^/]+\/files\//i, "");
    if (cleaned.includes("/")) return cleaned;
  }
  const folder = strip(entry.folder || entry.parent_folder || "").replace(/\/+$/, "");
  const name = strip(entry.name || "").split("/").pop();
  if (folder && name) {
    const folderPath = folder.startsWith("references/") ? folder : `references/${folder}`;
    return `${folderPath}/${name}`;
  }
  return name || strip(entry.filename);
}

function highlightModeForKind(kind, filename = "") {
  if (kind === "json" || JSON_FILE_RE.test(filename)) return "json";
  return "code";
}

function jsonTreeHtml(value, { query = "", key = "", depth = 0 } = {}) {
  const q = String(query || "").trim();
  const label = key === "" ? (Array.isArray(value) ? "array" : "value") : String(key);
  const selfHit = lineMatchesQuery(`${label} ${previewJson(value)}`, q);
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((item, i) => [String(i), item])
      : Object.entries(value);
    const kids = entries
      .map(([childKey, child]) => jsonTreeHtml(child, { query: q, key: childKey, depth: depth + 1 }))
      .filter(Boolean);
    if (q && !selfHit && !kids.length) return "";
    const open = !q || selfHit || depth < 2 ? " open" : "";
    const summary = Array.isArray(value) ? `${escapeHtml(label)} [${entries.length}]` : `${escapeHtml(label)} {${entries.length}}`;
    return `<details class="ref-json-node"${open}><summary>${summary}</summary>${kids.join("") || `<div class="ref-json-empty muted">empty</div>`}</details>`;
  }
  if (q && !selfHit) return "";
  return `<div class="ref-json-leaf${selfHit && q ? " is-hit" : ""}"><span class="tok-key">${escapeHtml(label)}</span><span class="ref-json-sep">: </span><span class="${jsonLeafClass(value)}">${escapeHtml(previewJson(value))}</span></div>`;
}

function previewJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return `{${Object.keys(value).length}}`;
  return String(value);
}

function jsonLeafClass(value) {
  if (typeof value === "string") return "tok-string";
  if (typeof value === "number") return "tok-number";
  if (typeof value === "boolean" || value === null) return "tok-bool";
  return "";
}

function parseJsonSafe(text) {
  try {
    return { ok: true, value: JSON.parse(String(text || "null")) };
  } catch (err) {
    return { ok: false, error: err.message || "Invalid JSON" };
  }
}

function codeToolbarHtml(tab, kind) {
  const query = escapeHtml(tab.codeQuery || "");
  const jsonView = tab.jsonView === "tree" ? "tree" : "code";
  const csvView = tab.csvView === "table" ? "table" : "code";
  const jsonToggle = kind === "json"
    ? `<div class="ref-code-toggle" role="tablist" aria-label="JSON view">
        <button type="button" class="dxf-viewer-btn${jsonView === "code" ? " active" : ""}" data-ref-action="json-view" data-ref-json-view="code">Code</button>
        <button type="button" class="dxf-viewer-btn${jsonView === "tree" ? " active" : ""}" data-ref-action="json-view" data-ref-json-view="tree">Tree</button>
      </div>`
    : "";
  const csvToggle = kind === "csv"
    ? `<div class="ref-code-toggle" role="tablist" aria-label="CSV view">
        <button type="button" class="dxf-viewer-btn${csvView === "code" ? " active" : ""}" data-ref-action="csv-view" data-ref-csv-view="code">Code</button>
        <button type="button" class="dxf-viewer-btn${csvView === "table" ? " active" : ""}" data-ref-action="csv-view" data-ref-csv-view="table">Table</button>
      </div>`
    : "";
  const search = kind === "spreadsheet" || kind === "json" || kind === "csv" || kind === "code" || kind === "text"
    ? `<input type="search" class="ref-code-search" data-ref-code-search placeholder="Search" value="${query}" spellcheck="false" />`
    : "";
  return `<div class="ref-code-chrome">${jsonToggle}${csvToggle}${search}</div>`;
}

function renderCodeDocumentHtml(tab, kind) {
  const query = tab.codeQuery || "";
  if (kind === "spreadsheet") {
    const rows = Array.isArray(tab.sheetRows) ? tab.sheetRows : [];
    const table = tab.sheetError
      ? `<div class="ref-viewer-empty">${escapeHtml(tab.sheetError)}</div>`
      : spreadsheetTableHtml(rows, { query });
    return `<div class="ref-code-viewer" data-ref-code-root>
      ${codeToolbarHtml(tab, kind)}
      ${table}
    </div>`;
  }
  const jsonView = kind === "json" && tab.jsonView === "tree";
  const csvView = kind === "csv" && tab.csvView === "table";
  const text = tab.textContent || "";
  const mode = highlightModeForKind(kind, tab.filename);
  const highlighted = highlightSource(text, { mode, query });
  let extra = "";
  if (jsonView) {
    const parsed = parseJsonSafe(text);
    extra = parsed.ok
      ? `<div class="ref-json-tree" data-ref-json-tree>${jsonTreeHtml(parsed.value, { query }) || `<div class="ref-viewer-empty">No matches.</div>`}</div>`
      : `<div class="ref-viewer-empty">Could not parse JSON (${escapeHtml(parsed.error)}). Switch to Code to edit.</div>`;
  }
  if (csvView) {
    extra = spreadsheetTableHtml(parseCsvText(text), { query });
  }
  const showEditor = !jsonView && !csvView;
  return `<div class="ref-code-viewer" data-ref-code-root>
    ${codeToolbarHtml(tab, kind)}
    ${showEditor ? `<div class="wiring-code-editor-shell ref-code-editor-shell">
      <div class="wiring-code-gutter" data-ref-code-gutter aria-hidden="true"></div>
      <div class="wiring-code-editor-stack" data-ref-code-stack>
        <div class="wiring-code-editor-inner" data-ref-code-inner>
          <pre class="wiring-code-highlight" data-ref-code-highlight aria-hidden="true">${highlighted}\n</pre>
          <textarea class="wiring-code-text" data-ref-text spellcheck="false" wrap="off">${escapeHtml(text)}</textarea>
        </div>
      </div>
    </div>` : extra}
  </div>`;
}

/** SVG download is only for vector / screenshot SVG sources — not raster PNG/JPG wraps. */
function sourceCanDownloadSvg(tab) {
  const name = String(tab?.filename || "");
  const mime = String(tab?.blob?.type || tab?.editedBlob?.type || tab?.mediaType || tab?.media_type || "");
  return /\.svg$/i.test(name) || /image\/svg/i.test(mime);
}

function imageDownloadTypeButtons(tab, strokeCount = 0) {
  const markup = strokeCount ? " (with markup)" : "";
  const svg = sourceCanDownloadSvg(tab)
    ? `<button type="button" role="menuitem" data-ref-download="svg">SVG${markup}</button>`
    : "";
  return `${svg}<button type="button" role="menuitem" data-ref-download="png">PNG${markup}</button><button type="button" role="menuitem" data-ref-download="jpg">JPG</button>`;
}

function downloadFormatLabel(format) {
  const f = String(format || "").toLowerCase();
  if (f === "jpeg" || f === "jpg") return "JPG";
  return f.toUpperCase();
}

function isMcMasterPartsListFilename(filename = "") {
  const name = String(filename || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
  return name === "parts_list.md" || name === "mcmaster_parts_list.md";
}

function mcmasterProductLabel(description, partNumber) {
  let name = String(description || "").trim();
  const linked = name.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
  if (linked) name = linked[1].trim();
  name = name.replace(/\s*\/\s*McMaster-Carr\s*$/i, "").replace(/\s+/g, " ").trim();
  if (!name || /^(tbd|—|-|mcmaster|buy)$/i.test(name)) {
    return String(partNumber || "McMaster-Carr").trim() || "McMaster-Carr";
  }
  return name;
}

function mcmasterCatalogCopy(description, partNumber) {
  const full = mcmasterProductLabel(description, partNumber);
  const cut = full.search(/,\s+/);
  let title = (cut >= 10 ? full.slice(0, cut) : full).trim();
  let spec = cut >= 10 ? full.slice(cut + 1).replace(/\s+/g, " ").trim() : "";
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length >= 5) {
    title = words.slice(-3).join(" ");
    const material = words.slice(0, -3).join(" ");
    spec = spec ? `${material} · ${spec}` : material;
  }
  return { title, spec };
}

function mcmasterHardwareKind(description = "") {
  const t = String(description || "").toLowerCase();
  if (/washer|shim/.test(t)) return "washer";
  if (/bearing/.test(t)) return "bearing";
  if (/caster|wheel/.test(t)) return "caster";
  if (/(helical|thread)\s*insert|\binsert\b/.test(t) && !/screw|bolt/.test(t)) return "insert";
  if (/\bnut\b|locknut|hex nut/.test(t) && !/screw|bolt/.test(t)) return "nut";
  if (/screw|bolt|cap screw|socket head|machine screw|set screw/.test(t)) return "screw";
  return "part";
}

function mcmasterHardwareGlyph(kind) {
  if (kind === "washer") {
    return `<svg class="mcm-bom-glyph" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="#d0d7de"/><circle cx="32" cy="32" r="22" fill="none" stroke="#8b949e" stroke-width="2"/><circle cx="32" cy="32" r="9" fill="#fff"/><circle cx="32" cy="32" r="9" fill="none" stroke="#6e7781" stroke-width="2"/></svg>`;
  }
  if (kind === "nut") {
    return `<svg class="mcm-bom-glyph" viewBox="0 0 64 64" aria-hidden="true"><polygon points="32,10 54,22 54,42 32,54 10,42 10,22" fill="#c5cdd6" stroke="#6e7781" stroke-width="1.6"/><circle cx="32" cy="32" r="8" fill="#fff"/><circle cx="32" cy="32" r="8" fill="none" stroke="#57606a" stroke-width="1.8"/></svg>`;
  }
  if (kind === "bearing") {
    return `<svg class="mcm-bom-glyph" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="#d8dee4" stroke="#8b949e" stroke-width="1.5"/><circle cx="32" cy="32" r="12" fill="none" stroke="#6e7781" stroke-width="7"/><circle cx="32" cy="32" r="7" fill="#fff" stroke="#57606a" stroke-width="1.4"/></svg>`;
  }
  if (kind === "caster") {
    return `<svg class="mcm-bom-glyph" viewBox="0 0 64 64" aria-hidden="true"><rect x="16" y="12" width="32" height="8" rx="1.5" fill="#8b949e"/><rect x="28" y="20" width="8" height="10" fill="#6e7781"/><circle cx="32" cy="42" r="14" fill="#4d5560" stroke="#2f363d" stroke-width="1.5"/><circle cx="32" cy="42" r="5" fill="#c5cdd6"/></svg>`;
  }
  if (kind === "insert") {
    return `<svg class="mcm-bom-glyph" viewBox="0 0 64 64" aria-hidden="true"><path d="M20 16c10 0 10 8 20 8s10-8 20-8" fill="none" stroke="#6e7781" stroke-width="4" transform="translate(-8 6)"/><path d="M20 28c10 0 10 8 20 8s10-8 20-8" fill="none" stroke="#8b949e" stroke-width="4" transform="translate(-8 6)"/><path d="M20 40c10 0 10 8 20 8s10-8 20-8" fill="none" stroke="#6e7781" stroke-width="4" transform="translate(-8 6)"/></svg>`;
  }
  if (kind === "screw") {
    return `<svg class="mcm-bom-glyph" viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="14" rx="13" ry="5.5" fill="#5b6570"/><rect x="19" y="14" width="26" height="10" fill="#6e7781"/><ellipse cx="32" cy="24" rx="13" ry="5.5" fill="#8b949e"/><polygon points="32,12 37,15 37,18.5 32,21.5 27,18.5 27,15" fill="#1f2428"/><rect x="26" y="24" width="12" height="12" fill="#7d8792"/><rect x="25" y="36" width="14" height="18" rx="1" fill="#9aa4ae"/><path d="M25 40h14M25 44h14M25 48h14M25 52h14" stroke="#6e7781" stroke-width="1.2"/></svg>`;
  }
  return `<svg class="mcm-bom-glyph" viewBox="0 0 64 64" aria-hidden="true"><path fill="#c5cdd6" stroke="#6e7781" stroke-width="1.4" d="M18 22 32 14l14 8v20L32 50 18 42Z"/><path fill="none" stroke="#8b949e" d="M32 14v36M18 22l14 8 14-8"/></svg>`;
}

function parseMcMasterPartsMarkdown(text) {
  const rows = [];
  const seen = new Set();
  const pnRe = /\b([0-9]{4,6}[A-Z][0-9A-Z]{2,8})\b/i;
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
  const cellText = (raw) => {
    const m = String(raw || "").match(linkRe);
    return m ? m[1].trim() : String(raw || "").trim();
  };
  const cellUrl = (raw) => {
    const m = String(raw || "").match(linkRe);
    if (m) return m[2].replace(/[.,;]+$/, "");
    const u = String(raw || "").match(/https?:\/\/[^\s)|]+/);
    return u ? u[0].replace(/[.,);]+$/, "") : "";
  };
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|") || /^\|\s*-+/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells[0] === "") cells.shift();
    if (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.length < 5) continue;
    const [qty, pnCell, descCell, usedCell, statusCell, buyCell = ""] = cells;
    const pnText = cellText(pnCell);
    const descText = cellText(descCell);
    const headerish = `${qty} ${pnText} ${descText} ${statusCell}`.toLowerCase();
    if (headerish.includes("qty") || headerish.includes("part number")) continue;
    const found = pnText.match(pnRe) || String(pnCell || "").match(pnRe);
    const pn = String(found?.[1] || pnText || "").toUpperCase();
    if (!pn || seen.has(pn)) continue;
    seen.add(pn);
    const buy = cellUrl(buyCell) || cellUrl(pnCell) || cellUrl(descCell) || (pn ? `https://www.mcmaster.com/${pn}/` : "");
    rows.push({
      qty: qty || "1",
      part_number: pn,
      description: descText,
      used_in: cellText(usedCell),
      status: String(statusCell || "planned").trim().toLowerCase(),
      buy_url: buy,
    });
  }
  return rows;
}

function renderMcMasterPartsPage(text) {
  const rows = parseMcMasterPartsMarkdown(text);
  const statusLabel = {
    planned: "Listed",
    fetching: "Fetching",
    retrying: "Retrying",
    on_server: "On server",
    downloaded: "On server",
    used: "On server",
    fetch_failed: "Not in catalog",
    removed: "Removed",
    substituted: "Substituted",
  };
  const active = rows.filter((r) => r.status !== "removed");
  const failed = active.filter((r) => r.status === "fetch_failed").length;
  const ready = active.filter((r) => ["on_server", "used", "downloaded", "substituted"].includes(r.status)).length;
  const shown = active.length ? active : rows;
  const body = shown.map((row) => {
    const pn = row.part_number;
    const buy = row.buy_url;
    const { title, spec } = mcmasterCatalogCopy(row.description, pn);
    const status = row.status || "planned";
    const kind = mcmasterHardwareKind(`${title} ${spec} ${row.description || ""}`);
    const qty = String(row.qty || "1").replace(/[×x]\s*$/i, "").trim() || "1";
    const name = buy
      ? `<a class="mcm-bom-name" href="${escapeHtml(buy)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
      : `<span class="mcm-bom-name">${escapeHtml(title)}</span>`;
    const pnHtml = buy
      ? `<a class="mcm-bom-pn" href="${escapeHtml(buy)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pn)}</a>`
      : `<span class="mcm-bom-pn">${escapeHtml(pn)}</span>`;
    const buyHtml = buy
      ? `<a class="mcm-bom-buy" href="${escapeHtml(buy)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(pn)} on McMaster-Carr">Buy <span aria-hidden="true">↗</span></a>`
      : `<span class="mcm-bom-buy mcm-bom-buy--disabled">Buy</span>`;
    const used = String(row.used_in || "").trim();
    return `<tr class="mcm-bom-row mcm-bom-row--${escapeHtml(status)}">
      <td class="mcm-bom-thumb-cell">
        <div class="mcm-bom-thumb" data-kind="${escapeHtml(kind)}">
          ${mcmasterHardwareGlyph(kind)}
          <img class="mcm-bom-photo" data-mcm-thumb="${escapeHtml(pn)}" alt="" />
        </div>
      </td>
      <td class="mcm-bom-item">
        ${name}
        ${spec ? `<div class="mcm-bom-spec">${escapeHtml(spec)}</div>` : ""}
        <div class="mcm-bom-meta">${pnHtml}${used ? `<span class="mcm-bom-used">${escapeHtml(used)}</span>` : ""}</div>
      </td>
      <td class="mcm-bom-qty-cell"><span class="mcm-bom-qty" title="Quantity">${escapeHtml(qty)}</span></td>
      <td class="mcm-bom-status-cell"><span class="mcm-bom-status">${escapeHtml(statusLabel[status] || status)}</span></td>
      <td class="mcm-bom-buy-cell">${buyHtml}</td>
    </tr>`;
  }).join("");
  const countBits = [];
  countBits.push(`${shown.length} item${shown.length === 1 ? "" : "s"}`);
  if (ready) countBits.push(`${ready} ready`);
  if (failed) countBits.push(`${failed} unavailable`);
  return `<div class="mcm-bom">
    <header class="mcm-bom-head">
      <img class="mcm-bom-logo" src="/assets/brands/mcmaster-carr.svg" alt="" width="32" height="32" />
      <div>
        <h1>Cart</h1>
        <p>McMaster-Carr hardware for this project. Product names open the live catalog page.</p>
      </div>
      <span class="mcm-bom-count" title="${escapeHtml(countBits.join(" · "))}">${shown.length}</span>
    </header>
    ${body ? `<div class="mcm-bom-table-wrap"><table class="mcm-bom-table">
      <thead>
        <tr>
          <th class="mcm-bom-col-item" colspan="2">Item</th>
          <th class="mcm-bom-col-qty">Qty</th>
          <th class="mcm-bom-col-status">Availability</th>
          <th class="mcm-bom-col-buy"><span class="visually-hidden">Order</span></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table></div>
    <footer class="mcm-bom-foot">
      <span>${escapeHtml(countBits.join(" · "))}. CAD files stay on the studio server; buying happens on McMaster-Carr.</span>
    </footer>` : `<p class="mcm-bom-empty">Your cart is empty.</p>`}
  </div>`;
}

function labelFromName(filename = "") {
  return String(filename || "").replace(/\.[^.]+$/, "") || filename;
}

let pdfjsLibPromise = null;

async function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
    ).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsLibPromise;
}

function textStrokeBounds(stroke) {
  const x = Number(stroke?.x ?? stroke?.points?.[0]?.[0] ?? 0);
  const y = Number(stroke?.y ?? stroke?.points?.[0]?.[1] ?? 0);
  const size = Number(stroke?.fontSize) || Math.max(14, Number(stroke?.width) * 5 || 16);
  const text = String(stroke?.text || "");
  const w = Math.max(size * 1.2, text.length * size * 0.62);
  const h = size * 1.35;
  return { x, y, size, w, h };
}

function hitTextStrokeIndex(strokes = [], point = [], pageIndex = 0) {
  const [px, py] = point;
  for (let i = (strokes || []).length - 1; i >= 0; i -= 1) {
    const stroke = strokes[i];
    if (String(stroke?.type || "") !== "text") continue;
    const page = stroke.page == null ? 0 : Number(stroke.page);
    if (page !== pageIndex) continue;
    const { x, y, w, h } = textStrokeBounds(stroke);
    if (px >= x - 6 && px <= x + w + 6 && py >= y - h && py <= y + 10) return i;
  }
  return -1;
}

function strokeSvg(strokes = [], pageIndex = null, selectedIndex = -1) {
  return (strokes || [])
    .map((stroke, idx) => ({ stroke, idx }))
    .filter(({ stroke }) => {
      if (pageIndex == null) return true;
      const p = stroke.page == null ? 0 : Number(stroke.page);
      return p === pageIndex;
    })
    .map(({ stroke, idx }) => {
      const type = String(stroke.type || "pen").toLowerCase();
      const color = escapeHtml(stroke.color || "#f0883e");
      const width = Number(stroke.width) || 3;
      if (type === "text") {
        const { x, y, size, w, h } = textStrokeBounds(stroke);
        const text = escapeHtml(stroke.text || "");
        if (!text) return "";
        const ring = idx === selectedIndex
          ? `<rect class="ref-text-select-ring" x="${x - 4}" y="${y - h}" width="${w + 8}" height="${h + 8}" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" />`
          : "";
        return `${ring}<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-family="Inter, system-ui, sans-serif" font-weight="700">${text}</text>`;
      }
      const pts = (stroke.points || [])
        .map((p) => `${Number(p[0])},${Number(p[1])}`)
        .join(" ");
      if (!pts) return "";
      if (type === "rect" && (stroke.points || []).length >= 2) {
        const [[x0, y0], [x1, y1]] = stroke.points;
        const x = Math.min(x0, x1);
        const y = Math.min(y0, y1);
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke" />`;
      }
      if (type === "circle" && (stroke.points || []).length >= 2) {
        const [[x0, y0], [x1, y1]] = stroke.points;
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const rx = Math.abs(x1 - x0) / 2;
        const ry = Math.abs(y1 - y0) / 2;
        return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke" />`;
      }
      if (type === "line" && (stroke.points || []).length >= 2) {
        const [x0, y0] = stroke.points[0];
        const [x1, y1] = stroke.points[stroke.points.length - 1];
        return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" vector-effect="non-scaling-stroke" />`;
      }
      if (type === "arrow" && (stroke.points || []).length >= 2) {
        const ptsArr = stroke.points;
        const [x0, y0] = ptsArr[0];
        const [x1, y1] = ptsArr[ptsArr.length - 1];
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(10, width * 4);
        const ax = x1 - Math.cos(ang) * head;
        const ay = y1 - Math.sin(ang) * head;
        const lx = ax + Math.cos(ang + Math.PI / 2) * head * 0.45;
        const ly = ay + Math.sin(ang + Math.PI / 2) * head * 0.45;
        const rx = ax + Math.cos(ang - Math.PI / 2) * head * 0.45;
        const ry = ay + Math.sin(ang - Math.PI / 2) * head * 0.45;
        return `<g>
          <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" vector-effect="non-scaling-stroke" />
          <polygon points="${x1},${y1} ${lx},${ly} ${rx},${ry}" fill="${color}" />
        </g>`;
      }
      const opacity = type === "highlight" ? 0.35 : 1;
      const sw = type === "highlight" ? Math.max(width * 3, 12) : width;
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
    })
    .join("");
}

function drawStrokesOnCtx(ctx, strokes = [], pageIndex = null) {
  for (const stroke of strokes || []) {
    const p = stroke.page == null ? 0 : Number(stroke.page);
    if (pageIndex != null && p !== pageIndex) continue;
    const type = String(stroke.type || "pen").toLowerCase();
    const color = stroke.color || "#f0883e";
    const width = Number(stroke.width) || 3;
    if (type === "text") {
      const x = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
      const y = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
      const size = Number(stroke.fontSize) || Math.max(14, width * 5);
      if (!stroke.text) continue;
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
      ctx.fillText(String(stroke.text), x, y);
      ctx.restore();
      continue;
    }
    const pts = stroke.points || [];
    if (pts.length < 2) continue;
    if (type === "rect") {
      const [[x0, y0], [x1, y1]] = pts;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
      continue;
    }
    if (type === "circle") {
      const [[x0, y0], [x1, y1]] = pts;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    if (type === "line") {
      const [x0, y0] = pts[0];
      const [x1, y1] = pts[pts.length - 1];
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    if (type === "arrow") {
      const [x0, y0] = pts[0];
      const [x1, y1] = pts[pts.length - 1];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(10, width * 4);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - Math.cos(ang) * head + Math.cos(ang + Math.PI / 2) * head * 0.45, y1 - Math.sin(ang) * head + Math.sin(ang + Math.PI / 2) * head * 0.45);
      ctx.lineTo(x1 - Math.cos(ang) * head + Math.cos(ang - Math.PI / 2) * head * 0.45, y1 - Math.sin(ang) * head + Math.sin(ang - Math.PI / 2) * head * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = type === "highlight" ? 0.35 : 1;
    ctx.lineWidth = type === "highlight" ? Math.max(width * 3, 12) : width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(Number(pts[0][0]), Number(pts[0][1]));
    for (let i = 1; i < pts.length; i += 1) {
      ctx.lineTo(Number(pts[i][0]), Number(pts[i][1]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export function createReferenceFilesViewer(options = {}) {
  const {
    tabBarEl,
    docTabs = null,
    viewerEl,
    api,
    rawFetch,
    getProjectId,
    onStatus,
    onActiveChange,
    onBeforeOpen,
    onSendToPrompt,
    getAiKeyBodyFields,
    getAiKeyPickerState,
    setAiKeyPickerValue,
    onOpenAiKeyPicker,
    onRenderEdited,
    onReferenceAction,
    listBrowsableFiles,
    onOpenVideoEditor,
    onAddToVideoEditor,
    onDropFiles,
    onAskRenderAgent,
  } = options;

  /** @type {Map<string, object>} */
  const tabs = new Map();
  let activeFilename = null;
  let notesHidden = false;
  const MAX_OPEN_TABS = 16;
  /** @type {string[]} filenames shown side-by-side (2–6). Empty = single viewer. */
  let splitFilenames = [];
  const mcmThumbCreated = [];
  /** @type {null | { root: string, label: string, tree: object }} */
  let codeWorkspace = null;
  let refLoadAbort = null; // leakfix106
  function beginRefLoadFetch() {
    if (refLoadAbort) {
      try { refLoadAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    refLoadAbort = ctl;
    return ctl;
  }

  function revokeMcMasterThumbs() {
    revokeTrackedObjectUrls(mcmThumbCreated);
  }

  function revokeMiniThumbs() {
    revokeTrackedObjectUrls(refMiniThumbCreated);
  }

  async function hydrateMcMasterCartThumbs(root, tab) {
    const pid = tab?.projectId || getProjectId?.();
    if (!root || !pid || typeof rawFetch !== "function") return;
    const token = (tab.mcmHydrateGen = (tab.mcmHydrateGen || 0) + 1);
    const imgs = [...root.querySelectorAll("img[data-mcm-thumb]")];
    await Promise.all(imgs.map(async (img) => {
      const pn = String(img.dataset.mcmThumb || "").trim();
      if (!pn) return;
      const names = [`${pn}_snapshot_iso.png`, `${pn}.png`];
      for (const name of names) {
        if (tab.mcmHydrateGen !== token) return;
        try {
          const res = await rawFetch(
            `/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(name)}`,
          );
          if (!res || !res.ok) continue;
          const blob = await res.blob();
          const type = String(blob.type || "").toLowerCase();
          if (type.includes("json") || type.includes("html") || (type && !type.startsWith("image/"))) continue;
          if (blob.size < 64) continue;
          const url = trackObjectUrl(blob, mcmThumbCreated);
          if (tab.mcmHydrateGen !== token) {
            try { URL.revokeObjectURL(url); } catch { /* ignore */ }
            const i = mcmThumbCreated.indexOf(url);
            if (i >= 0) mcmThumbCreated.splice(i, 1);
            return;
          }
          img.src = url;
          img.closest(".mcm-bom-thumb")?.classList.add("has-photo");
          return;
        } catch {
          /* try next candidate */
        }
      }
    }));
  }
  let drawMode = false;
  let drawing = false;
  let currentStroke = null;
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let panDrag = null;
  let markupTool = "pan"; // pan | select | pen | highlight | eraser | rect | circle | line | arrow | text | region
  let selectedStrokeIndex = -1;
  let textDrag = null;
  let textInputEl = null;
  let markupColor = "#f0883e";
  let markupWidth = 3;
  /** @type {ResizeObserver | null} */
  let imageFitObserver = null;
  /** @type {string[]} */
  let undoStack = [];
  /** @type {string[]} */
  let redoStack = [];
  let regionSelect = null; // { start, end, page }
  let regionDrag = null;
  let videoEditorApi = null;
  let unbindVideoMediaDrop = null;
  let videoEditorBoundKey = "";

  function snapshotVideoEditor(tab = activeFilename ? tabs.get(activeFilename) : null) {
    if (!tab || !videoEditorApi) return;
    try {
      const music = videoEditorApi.getMusicTrack?.();
      if (music?.blob) tab.editorMusic = music;
      tab.editorDraft = videoEditorApi.getTimelineDraft?.() || tab.editorDraft;
    } catch (_) { /* keep last snapshot */ }
  }

  function restoreVideoEditorMusic(tab) {
    const music = tab?.editorMusic;
    if (!music?.blob || !videoEditorApi?.setMusicFromFile) return;
    try {
      videoEditorApi.setMusicFromFile(music.blob, { ...applyMusicSnapshotOpts(music), persist: false });
    } catch (_) { /* timeline still has the video */ }
  }

  function destroyVideoEditor() {
    try { videoEditorApi?.park?.(); } catch (_) {}
    snapshotVideoEditor();
    try { unbindVideoMediaDrop?.(); } catch (_) {}
    unbindVideoMediaDrop = null;
    try { videoEditorApi?.destroy?.(); } catch (_) {}
    videoEditorApi = null;
    videoEditorBoundKey = "";
  }

  let audioPlayerApi = null;
  function destroyAudioPlayer() {
    try { audioPlayerApi?.destroy?.(); } catch (_) {}
    audioPlayerApi = null;
  }

  function pauseOpenMedia() {
    pauseAndDetachMedia(viewerEl?.querySelector(".ref-video"));
    pauseAndDetachMedia(viewerEl?.querySelector(".ref-audio"));
    pauseAndDetachMedia(viewerEl?.querySelector("[data-vtl-bed]"));
    try { videoEditorApi?.park?.(); } catch (_) {}
    destroyAudioPlayer();
  }

  const RENDER_EDIT_PREF_KEY = "render3d:renderEditSaveMode:v1";
  let imageEditSaveMode = (() => {
    const pref = (() => {
      try {
        const v = localStorage.getItem(RENDER_EDIT_PREF_KEY);
        if (v === "new" || v === "replace" || v === "ask") return v;
      } catch {
        /* ignore */
      }
      return "ask";
    })();
    return pref === "replace" ? "replace" : "new";
  })();

  function readRenderEditPref() {
    try {
      const v = localStorage.getItem(RENDER_EDIT_PREF_KEY);
      if (v === "new" || v === "replace" || v === "ask") return v;
    } catch {
      /* ignore */
    }
    return "ask";
  }

  function writeRenderEditPref(mode) {
    try {
      localStorage.setItem(RENDER_EDIT_PREF_KEY, mode);
    } catch {
      /* ignore */
    }
    if (mode === "new" || mode === "replace") imageEditSaveMode = mode;
  }

  function setImageEditSaveMode(mode, { persist = false } = {}) {
    imageEditSaveMode = mode === "replace" ? "replace" : "new";
    if (persist) writeRenderEditPref(imageEditSaveMode);
    viewerEl?.querySelectorAll("[data-ref-save-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.refSaveMode === imageEditSaveMode);
      btn.setAttribute("aria-pressed", String(btn.dataset.refSaveMode === imageEditSaveMode));
    });
    const modalToggle = document.querySelector("#ref-region-edit-modal [data-region-save-mode]");
    if (modalToggle) {
      modalToggle.querySelectorAll("[data-save-mode]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.saveMode === imageEditSaveMode);
      });
    }
  }

  function isTypingTarget(el) {
    if (!el) return false;
    if (el.closest?.("textarea.canvas-text-input, .canvas-text-input")) return true;
    const tag = String(el.tagName || "").toLowerCase();
    return tag === "textarea" || tag === "input" || el.isContentEditable;
  }

  function pushStrokeHistory(tab) {
    if (!tab) return;
    undoStack.push(JSON.stringify(tab.strokes || []));
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }

  function redrawActiveMarkup() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    viewerEl?.querySelectorAll("[data-ref-image-stack], [data-ref-pdf-page]").forEach((stack) => {
      const pageIndex = Number(stack.dataset.page || 0);
      const svg = stack.querySelector(".ref-markup-svg");
      if (svg) svg.innerHTML = strokeSvg(tab.strokes, pageIndex, selectedStrokeIndex);
    });
    updateRegionOverlay();
  }

  function undoMarkup() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab || !undoStack.length) return false;
    redoStack.push(JSON.stringify(tab.strokes || []));
    tab.strokes = JSON.parse(undoStack.pop() || "[]");
    markDirty(tab);
    redrawActiveMarkup();
    onStatus?.("ok", "Markup undone");
    return true;
  }

  function redoMarkup() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab || !redoStack.length) return false;
    undoStack.push(JSON.stringify(tab.strokes || []));
    tab.strokes = JSON.parse(redoStack.pop() || "[]");
    markDirty(tab);
    redrawActiveMarkup();
    onStatus?.("ok", "Markup redone");
    return true;
  }

  function setMarkupTool(tool) {
    markupTool = tool;
    drawMode = tool !== "pan";
    viewerEl?.classList.toggle("ref-draw-mode", drawMode);
    viewerEl?.classList.toggle("ref-select-mode", tool === "select");
    viewerEl?.querySelectorAll("[data-ref-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.refTool === tool);
    });
    if (tool !== "region") {
      regionSelect = null;
      regionDrag = null;
      updateRegionOverlay();
    }
    if (tool !== "select" && tool !== "text") {
      selectedStrokeIndex = -1;
      textDrag = null;
      redrawActiveMarkup();
    }
  }

  function exitTextToSelect({ keepSelected = true } = {}) {
    dismissImageTextInput();
    if (!keepSelected) selectedStrokeIndex = -1;
    textDrag = null;
    setMarkupTool("select");
    redrawActiveMarkup();
    onStatus?.("ok", "Select — drag text to move it.");
    return true;
  }

  function dismissImageTextInput() {
    if (!textInputEl) return;
    const node = textInputEl;
    textInputEl = null;
    try { node.remove(); } catch { /* ignore */ }
  }

  function commitImageTextInput() {
    if (!textInputEl) return;
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    const index = Number(textInputEl.dataset.strokeIndex);
    const text = String(textInputEl.value || "").trim().slice(0, 240);
    const node = textInputEl;
    textInputEl = null;
    try { node.remove(); } catch { /* ignore */ }
    if (!tab || !Number.isFinite(index) || !tab.strokes?.[index]) return;
    if (!text) {
      pushStrokeHistory(tab);
      tab.strokes = (tab.strokes || []).filter((_, i) => i !== index);
      selectedStrokeIndex = -1;
      markDirty(tab);
      redrawActiveMarkup();
      return;
    }
    tab.strokes[index].text = text;
    markDirty(tab);
    redrawActiveMarkup();
  }

  function placeImageTextInput(stack, media, stroke, index) {
    dismissImageTextInput();
    if (!stack || !media || !stroke) return;
    const textarea = document.createElement("textarea");
    textarea.className = "canvas-text-input canvas-text-input--box";
    textarea.value = stroke.text || "";
    textarea.placeholder = "Type in this box…";
    textarea.dataset.strokeIndex = String(index);
    const nw = media.naturalWidth || media.width || 1;
    const nh = media.naturalHeight || media.height || 1;
    const rect = media.getBoundingClientRect();
    const stackRect = stack.getBoundingClientRect();
    const x = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
    const y = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
    const left = (x / nw) * rect.width + (rect.left - stackRect.left);
    const top = (y / nh) * rect.height + (rect.top - stackRect.top) - 8;
    textarea.style.left = `${Math.max(0, left)}px`;
    textarea.style.top = `${Math.max(0, top)}px`;
    textarea.style.color = stroke.color || markupColor;
    textarea.style.minWidth = "120px";
    stack.appendChild(textarea);
    textInputEl = textarea;
    textarea.focus();
    textarea.select();
    textarea.addEventListener("keydown", (ev) => {
      if (isCanvasUndoShortcut(ev) || isCanvasRedoShortcut(ev)) return;
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        dismissImageTextInput();
        exitTextToSelect({ keepSelected: true });
      }
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        commitImageTextInput();
      }
    });
    textarea.addEventListener("blur", () => commitImageTextInput());
  }

  function eraseNearPoint(tab, point, pageIndex, radius = 18) {
    const [x, y] = point;
    const next = (tab.strokes || []).filter((stroke) => {
      const p = stroke.page == null ? 0 : Number(stroke.page);
      if (p !== pageIndex) return true;
      if (String(stroke.type || "") === "text") {
        const tx = Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0);
        const ty = Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0);
        return Math.hypot(tx - x, ty - y) > radius * 1.5;
      }
      return !(stroke.points || []).some(([px, py]) => Math.hypot(px - x, py - y) <= radius);
    });
    if (next.length !== (tab.strokes || []).length) {
      pushStrokeHistory(tab);
      tab.strokes = next;
      markDirty(tab);
      redrawActiveMarkup();
    }
  }

  function updateRegionOverlay() {
    const overlay = viewerEl?.querySelector("[data-ref-region-overlay]");
    if (!overlay) return;
    const sel = regionSelect || (regionDrag ? { start: regionDrag.start, end: regionDrag.current } : null);
    if (!sel?.start || !sel?.end) {
      overlay.innerHTML = "";
      overlay.classList.add("hidden");
      return;
    }
    const media = viewerEl.querySelector("[data-ref-image-stack] img, [data-ref-image-stack] canvas");
    if (!media) return;
    const rect = media.getBoundingClientRect();
    const stage = media.closest(".ref-viewer-stage-wrap") || media.parentElement;
    const stageRect = stage.getBoundingClientRect();
    const w = media.naturalWidth || media.width || 1;
    const h = media.naturalHeight || media.height || 1;
    const x0 = Math.min(sel.start[0], sel.end[0]);
    const y0 = Math.min(sel.start[1], sel.end[1]);
    const x1 = Math.max(sel.start[0], sel.end[0]);
    const y1 = Math.max(sel.start[1], sel.end[1]);
    const left = ((x0 / w) * rect.width) + (rect.left - stageRect.left);
    const top = ((y0 / h) * rect.height) + (rect.top - stageRect.top);
    const width = ((x1 - x0) / w) * rect.width;
    const height = ((y1 - y0) / h) * rect.height;
    overlay.classList.remove("hidden");
    overlay.innerHTML = `<div class="ref-region-box" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px"></div>`;
  }

  function syncDocTab(tab, { activate = false } = {}) {
    if (!docTabs || !tab) return;
    docTabs.upsert({
      id: tab.filename,
      label: tab.label || tab.filename,
      kind: tab.kind || kindFromName(tab.filename),
      dirty: !!tab.dirty,
    });
    if (activate) docTabs.setActive(tab.filename);
  }

  function setVisible(on) {
    if (!docTabs) tabBarEl?.classList.toggle("hidden", !on);
    viewerEl?.classList.toggle("hidden", !on);
    viewerEl?.setAttribute("aria-hidden", on ? "false" : "true");
    if (!docTabs) {
      document.getElementById("viewport")?.classList.toggle("ref-viewer-active", !!on);
    }
  }

  function revokeBlob(tab) {
    revokeTrackedObjectUrls(tab?._blobCreated);
    revokeTrackedObjectUrls(tab?._previewCreated);
    const urls = [];
    if (tab?.blobUrl) urls.push(tab.blobUrl);
    if (tab?.previewUrl && tab.previewUrl !== tab.blobUrl) urls.push(tab.previewUrl);
    if (tab) {
      tab.blobUrl = null;
      tab.previewUrl = null;
      tab.blob = null;
      tab.editedBlob = null;
    }
    for (const url of urls) scheduleRevokeObjectURL(url);
  }

  function resetView() {
    panX = 0;
    panY = 0;
    zoom = 1;
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (tab?.kind === "image") fitImageToPane();
    else applyTransform();
  }

  function fitImageToPane() {
    panX = 0;
    panY = 0;
    zoom = 1;
    const root = paneRoot(activeFilename) || viewerEl;
    const wrap = root?.querySelector(".ref-viewer-stage-wrap:not(.ref-viewer-stage-wrap--video):not(.ref-pdf-markup-wrap)");
    const img = wrap?.querySelector("img.ref-image");
    const stack = wrap?.querySelector(".ref-image-stack");
    if (!wrap || !img || !stack) {
      applyTransform();
      return;
    }
    const apply = () => {
      const nw = img.naturalWidth || img.width || 0;
      const nh = img.naturalHeight || img.height || 0;
      const pane = imageEditorPaneSize(wrap, wrap.closest(".ref-split-pane") || wrap.closest(".ref-viewer-main") || viewerEl);
      if (pane.width < 48 || pane.height < 48) {
        if (!wrap.dataset.fitRetry) {
          wrap.dataset.fitRetry = "1";
          requestAnimationFrame(() => {
            delete wrap.dataset.fitRetry;
            fitImageToPane();
          });
        }
        applyTransform();
        return;
      }
      const fitted = containFitSize(nw, nh, pane.width, pane.height, 8);
      const nextW = String(fitted.width);
      const nextH = String(fitted.height);
      if (img.dataset.fitW !== nextW || img.dataset.fitH !== nextH) {
        img.dataset.fitW = nextW;
        img.dataset.fitH = nextH;
        img.style.width = `${fitted.width}px`;
        img.style.height = `${fitted.height}px`;
        stack.style.width = `${fitted.width}px`;
        stack.style.height = `${fitted.height}px`;
      }
      applyTransform();
    };
    if (img.complete && img.naturalWidth) apply();
    else img.addEventListener("load", apply, { once: true });
    applyTransform();
  }

  function observeImageFit() {
    const root = paneRoot(activeFilename) || viewerEl;
    const wrap = root?.querySelector(".ref-viewer-stage-wrap:not(.ref-viewer-stage-wrap--video):not(.ref-pdf-markup-wrap)");
    if (!wrap || typeof ResizeObserver === "undefined") return;
    if (!imageFitObserver) {
      imageFitObserver = new ResizeObserver(() => {
        const tab = activeFilename ? tabs.get(activeFilename) : null;
        if (tab?.kind === "image") fitImageToPane();
      });
    }
    try { imageFitObserver.disconnect(); } catch { /* ignore */ }
    imageFitObserver.observe(wrap);
  }

  function applyTransform() {
    const root = paneRoot(activeFilename) || viewerEl;
    const stage = root?.querySelector(".ref-viewer-stage");
    if (!stage) return;
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function paneRoot(filename) {
    if (!viewerEl || !filename) return null;
    const attr = String(filename).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return viewerEl.querySelector(`[data-ref-pane="${attr}"]`);
  }

  function syncSplitList() {
    splitFilenames = splitFilenames.filter((name) => tabs.has(name));
    if (splitFilenames.length === 1) splitFilenames = [];
  }

  function splitActive() {
    syncSplitList();
    return splitFilenames.length > 1;
  }

  function browsableKind(filename, kind) {
    const k = kind || kindFromName(filename);
    return k === "image" || k === "pdf" || k === "video" || k === "audio";
  }

  function browsableItems() {
    const seen = new Set();
    const out = [];
    const add = (name, label, kind) => {
      const key = String(name || "");
      if (!key || seen.has(key)) return;
      const k = kind || kindFromName(key);
      if (!browsableKind(key, k)) return;
      seen.add(key);
      const tab = tabs.get(key);
      out.push({
        name: key,
        label: label || tab?.label || labelFromName(key),
        kind: k,
        thumb: tab?.previewUrl || tab?.blobUrl || "",
        open: tabs.has(key),
        split: splitFilenames.includes(key),
        active: key === activeFilename,
      });
    };
    for (const tab of tabs.values()) add(tab.filename, tab.label, tab.kind);
    for (const item of listBrowsableFiles?.() || []) add(item.name, item.label, item.kind);
    return out;
  }

  function codeTreeItemHtml(node, depth = 0) {
    if (!node) return "";
    const kids = Array.isArray(node.children) ? node.children : null;
    if (kids) {
      const inner = kids.map((child) => codeTreeItemHtml(child, depth + 1)).join("");
      if (depth === 0) return inner;
      return `<details class="ref-code-tree-folder" open>
        <summary style="--depth:${depth}">${escapeHtml(node.name)}</summary>
        ${inner}
      </details>`;
    }
    const active = node.path === activeFilename ? " is-active" : "";
    const open = tabs.has(node.path) ? " is-open" : "";
    return `<button type="button" class="ref-code-tree-file${active}${open}" data-ref-code-open="${escapeHtml(node.path)}" style="--depth:${depth}" title="${escapeHtml(node.name)}">
      <span>${escapeHtml(node.name)}</span>
    </button>`;
  }

  function renderCodeTreeHtml() {
    if (!codeWorkspace?.tree) return "";
    const files = flattenCodeTree(codeWorkspace.tree);
    return `<aside class="ref-mini-browser ref-code-tree" data-ref-code-tree aria-label="Project code">
      <div class="ref-mini-browser-head">${escapeHtml(codeWorkspace.label || PROJECT_CODE_FOLDER)} <span>${files.length}</span></div>
      <p class="ref-mini-browser-hint muted">Click to open a tab. Contents load when opened.</p>
      <div class="ref-mini-browser-list ref-code-tree-list">${codeTreeItemHtml(codeWorkspace.tree) || `<p class="ref-mini-browser-empty muted small">No files in this folder.</p>`}</div>
    </aside>`;
  }
  function renderMiniBrowserHtml() {
    const items = browsableItems();
    if (!items.length) {
      return `<aside class="ref-mini-browser" aria-label="Project files">
        <div class="ref-mini-browser-head">Files</div>
        <p class="ref-mini-browser-empty muted small">No images or PDFs in this project yet.</p>
      </aside>`;
    }
    const openCount = [...items].filter((item) => item.open).length;
    return `<aside class="ref-mini-browser" aria-label="Project files">
      <div class="ref-mini-browser-head">Files <span>${items.length} · ${openCount} open</span></div>
      <p class="ref-mini-browser-hint muted">Click to open here · ⌘-click new tab</p>
      <div class="ref-mini-browser-list">
        ${items.map((item) => {
          const badge = item.kind === "pdf" ? "PDF" : item.kind === "video" ? "VID" : item.kind === "audio" ? "AUD" : "IMG";
          const thumb = item.thumb
            ? `<img src="${escapeHtml(item.thumb)}" alt="" />`
            : `<span class="ref-mini-browser-badge">${badge}</span>`;
          return `<button type="button" class="ref-mini-browser-item${item.active ? " is-active" : ""}${item.open ? " is-open" : ""}" data-ref-mini-open="${escapeHtml(item.name)}" title="${escapeHtml(item.label)} — click to open, ⌘-click for a new tab, right-click for more">
            <span class="ref-mini-browser-thumb" data-ref-mini-thumb="${escapeHtml(item.name)}">${thumb}</span>
            <span class="ref-mini-browser-name">${escapeHtml(item.label)}</span>
            ${item.kind === "image" || item.kind === "video"
              ? `<span class="ref-mini-editor-btn" data-ref-mini-editor="${escapeHtml(item.name)}" title="Open editor">Editor</span>`
              : ""}
          </button>`;
        }).join("")}
      </div>
    </aside>`;
  }

  function paneCloseButton(filename) {
    if (!splitActive()) return "";
    return `<button type="button" class="ref-pane-close" data-ref-pane-close="${escapeHtml(filename)}" aria-label="Close" title="Close">×</button>`;
  }

  function mediaBodyHtml(tab) {
    const kind = tab.kind || kindFromName(tab.filename);
    if (tab.loading) return `<div class="ref-viewer-empty">Loading…</div>`;
    if (tab.error) return `<div class="ref-viewer-empty">${escapeHtml(tab.error)}</div>`;
    if (isTextLikeKind(kind) || kind === "spreadsheet") {
      const partsList = isMcMasterPartsListFilename(tab.filename);
      if (partsList && !tab.partsListEdit) return renderMcMasterPartsPage(tab.textContent || "");
      return renderCodeDocumentHtml(tab, kind);
    }
    if (kind === "image") {
      return `
        <div class="ref-viewer-stage-wrap">
          ${paneCloseButton(tab.filename)}
          <div class="ref-viewer-stage">
            <div class="ref-image-stack" data-ref-image-stack data-page="0">
              <img class="ref-image" src="${escapeHtml(tab.blobUrl || "")}" alt="${escapeHtml(tab.label || tab.filename)}" draggable="false" />
              <svg class="ref-markup-svg" xmlns="http://www.w3.org/2000/svg">${strokeSvg(tab.strokes, 0, selectedStrokeIndex)}</svg>
            </div>
          </div>
        </div>`;
    }
    if (kind === "video") {
      return `
        <div class="ref-viewer-stage-wrap ref-viewer-stage-wrap--video">
          ${paneCloseButton(tab.filename)}
          <div class="ref-viewer-stage ref-viewer-stage--video" data-video-preview-wrap>
            <video class="ref-video" src="${escapeHtml(tab.previewUrl || tab.blobUrl || "")}" controls playsinline preload="metadata"></video>
            <div class="video-editor-still-layer" data-video-stills></div>
          </div>
          ${splitActive() ? "" : `<div class="ref-video-editor-host" data-ref-video-editor></div>`}
        </div>`;
    }
    if (kind === "audio") {
      return `
        <div class="ref-viewer-stage-wrap ref-viewer-stage-wrap--audio">
          ${paneCloseButton(tab.filename)}
          <div class="ref-viewer-stage ref-viewer-stage--audio">
            ${audioPlayerHtml({
              src: tab.blobUrl || "",
              peaks: tab.waveformPeaks || [],
              comments: tab.comments || [],
              duration: tab.audioDuration || 0,
            })}
          </div>
        </div>`;
    }
    if (kind === "pdf") {
      return `
        <div class="ref-viewer-stage-wrap ref-pdf-markup-wrap">
          ${paneCloseButton(tab.filename)}
          <div class="ref-viewer-stage">
            <div class="ref-pdf-pages" data-ref-pdf-pages>
              <div class="ref-viewer-empty">Rendering PDF…</div>
            </div>
          </div>
        </div>`;
    }
    return `<div class="ref-viewer-empty">
      <p>Preview isn’t available for this file type.</p>
      ${tab.blobUrl ? `<p><a class="ref-download-link" href="${escapeHtml(tab.blobUrl)}" download="${escapeHtml(tab.filename)}">Download ${escapeHtml(tab.filename)}</a></p>` : ""}
    </div>`;
  }

  async function addToSplit(filename) {
    const key = String(filename || "");
    if (!key) return;
    if (!tabs.has(key)) {
      const opened = await openTab(key);
      if (!opened) return;
    }
    if (activeFilename && !splitFilenames.includes(activeFilename)) {
      splitFilenames = [activeFilename];
    }
    if (!splitFilenames.includes(key)) {
      if (splitFilenames.length >= MAX_OPEN_TABS) {
        onStatus?.("error", "Split view supports up to 6 panes.");
        return;
      }
      splitFilenames.push(key);
    }
    syncSplitList();
    activate(key);
  }

  function canMarkup(kind) {
    return kind === "image" || kind === "pdf";
  }

  function renderTabs() {
    if (docTabs) {
      for (const tab of tabs.values()) {
        docTabs.upsert({
          id: tab.filename,
          label: tab.label || tab.filename,
          kind: tab.kind || kindFromName(tab.filename),
          dirty: !!tab.dirty,
        });
      }
      if (activeFilename) docTabs.setActive(activeFilename);
      else docTabs.render?.();
      return;
    }
    if (!tabBarEl) return;
    if (!tabs.size) {
      tabBarEl.innerHTML = "";
      tabBarEl.classList.add("hidden");
      return;
    }
    tabBarEl.classList.remove("hidden");
    tabBarEl.innerHTML = [...tabs.values()]
      .map((tab) => {
        const active = tab.filename === activeFilename;
        const dirty = tab.dirty ? " *" : "";
        const label = (tab.label || tab.filename) + dirty;
        return `<button type="button" class="dxf-tab ${active ? "active" : ""}" data-ref-tab="${escapeHtml(tab.filename)}" role="tab" aria-selected="${active ? "true" : "false"}">
          <span class="dxf-tab-label">${escapeHtml(label)}</span>
          <span class="dxf-tab-close" data-ref-close="${escapeHtml(tab.filename)}" role="button" aria-label="Close ${escapeHtml(tab.label || tab.filename)}" title="Close">×</span>
        </button>`;
      })
      .join("");
  }

  function renderViewer() {
    if (!viewerEl) return;
    revokeMcMasterThumbs();
    revokeMiniThumbs();
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) {
      if (codeWorkspace) {
        setVisible(true);
        viewerEl.innerHTML = `<div class="ref-viewer-body ref-viewer-body--code">
          ${renderCodeTreeHtml()}
          <div class="ref-viewer-main"><div class="ref-viewer-empty">Select a file in the tree. Tabs load on demand.</div></div>
        </div>`;
        onActiveChange?.(null);
        return;
      }
      viewerEl.innerHTML = "";
      setVisible(false);
      onActiveChange?.(null);
      return;
    }
    setVisible(true);
    onActiveChange?.(tab.filename);

    const kind = tab.kind || kindFromName(tab.filename);
    const markupable = canMarkup(kind);
    const statusText = tab.loading ? "Loading…" : tab.error ? tab.error : "";
    const cartMode = isTextLikeKind(kind)
      && isMcMasterPartsListFilename(tab.filename)
      && !tab.partsListEdit
      && !tab.loading
      && !tab.error;

    const splitting = splitActive();
    const paneNames = splitting ? splitFilenames : [tab.filename];
    const mainHtml = splitting
      ? `<div class="ref-split-grid" data-split-count="${paneNames.length}">
          ${paneNames.map((name) => {
            const paneTab = tabs.get(name);
            if (!paneTab) return "";
            const focused = name === tab.filename;
            return `<div class="ref-split-pane${focused ? " is-focused" : ""}" data-ref-pane="${escapeHtml(name)}">
              ${mediaBodyHtml(paneTab)}
            </div>`;
          }).join("")}
        </div>`
      : `<div class="ref-split-pane is-focused" data-ref-pane="${escapeHtml(tab.filename)}">
          ${mediaBodyHtml(tab)}
          ${kind === "image" ? `<div class="ref-region-overlay hidden" data-ref-region-overlay></div>` : ""}
        </div>`;

    const strokeCount = (tab.strokes || []).length;
    const kindIsImage = kind === "image";
    const kindIsVideo = kind === "video";
    const kindIsAudio = kind === "audio";
    const canShare = kindIsImage || kindIsVideo || kind === "pdf" || kind === "file";
    const toolBtn = (id, icon, title) =>
      `<button type="button" class="canvas-tool-btn ${markupTool === id ? "active" : ""}" data-ref-tool="${id}" title="${title}">${icon}</button>`;
    const CANVAS_COLOR_PRESETS = [
      ["#58a6ff", "Blue"],
      ["#f85149", "Red"],
      ["#3fb950", "Green"],
      ["#d29922", "Yellow"],
      ["#bc8cff", "Purple"],
      ["#ffffff", "White"],
      ["#f0883e", "Orange"],
    ];
    destroyVideoEditor();
    destroyAudioPlayer();
    viewerEl.innerHTML = `
      <header class="dxf-viewer-toolbar ref-viewer-toolbar">
        <div class="dxf-viewer-title">
          <strong>${escapeHtml(tab.label || tab.filename)}</strong>
          ${statusText ? `<span class="muted small">${escapeHtml(statusText)}</span>` : ""}
        </div>
        <div class="dxf-viewer-actions ref-markup-toolbar canvas-toolbar-row">
          ${markupable ? `
            <div class="ref-tool-group canvas-tool-group" role="group" aria-label="Markup tools">
              ${toolBtn("pan", "✋", "Pan — drag to move the image")}
              ${toolBtn("select", "✥", "Select / move (V)")}
              ${toolBtn("pen", "✏️", "Pen (P)")}
              ${toolBtn("highlight", "🖍", "Highlight")}
              ${toolBtn("eraser", "🧹", "Eraser (E)")}
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="ref-tool-group canvas-tool-group" role="group" aria-label="Shapes">
              ${toolBtn("line", "╱", "Connector line (L)")}
              ${toolBtn("arrow", "→", "Connector arrow (A)")}
              ${toolBtn("rect", "▭", "Rectangle (R)")}
              ${toolBtn("circle", "◯", "Circle (C)")}
              ${toolBtn("text", "T", "Text box (T)")}
              ${kindIsImage ? toolBtn("region", "AI", "Drag-select a window on the image and prompt an edit of that region") : ""}
            </div>
            ${kindIsImage ? `
            <div class="ref-tool-group ref-tool-group--save-mode canvas-tool-group" role="group" aria-label="AI edit save mode">
              <button type="button" class="canvas-tool-btn ${imageEditSaveMode === "new" ? "active" : ""}" data-ref-save-mode="new" aria-pressed="${imageEditSaveMode === "new" ? "true" : "false"}" title="Always save AI edits as a new image">New</button>
              <button type="button" class="canvas-tool-btn ${imageEditSaveMode === "replace" ? "active" : ""}" data-ref-save-mode="replace" aria-pressed="${imageEditSaveMode === "replace" ? "true" : "false"}" title="Replace the current image with the AI edit">Replace</button>
            </div>
            ` : ""}
            <div class="canvas-tool-sep"></div>
            <div class="ref-tool-group canvas-tool-group canvas-color-group ref-tool-group--style">
              <input type="color" class="canvas-color-pick" data-ref-color value="${escapeHtml(markupColor)}" title="Stroke color" />
              <div class="canvas-preset-colors">
                ${CANVAS_COLOR_PRESETS.map(([c, name]) => `<button type="button" class="canvas-preset${c === markupColor ? " is-active" : ""}" data-ref-swatch="${c}" style="background:${c}" title="${name}"></button>`).join("")}
              </div>
              <label class="canvas-stroke-label" title="Stroke width">
                <span>W</span>
                <input type="range" class="canvas-stroke-range" data-ref-width min="1" max="24" value="${markupWidth}" />
                <span data-ref-width-val>${markupWidth}px</span>
              </label>
            </div>
            <div class="canvas-tool-sep"></div>
            <div class="ref-tool-group canvas-tool-group">
              <button type="button" class="canvas-tool-btn" data-ref-action="undo" title="Undo (⌘Z)">↶</button>
              <button type="button" class="canvas-tool-btn" data-ref-action="redo" title="Redo (⌘⇧Z)">↷</button>
              <button type="button" class="canvas-tool-btn canvas-clear-btn" data-ref-action="clear-strokes" title="Clear markup strokes">🗑</button>
              <button type="button" class="canvas-tool-btn" data-ref-action="fit" title="Fit view">Fit</button>
            </div>
          ` : ""}
          ${kindIsImage ? `<button type="button" class="dxf-viewer-btn" data-ref-action="texture-model" title="Use this render as a texture/material reference for the current model">Texture to model</button>` : ""}
          ${kindIsAudio ? `<button type="button" class="dxf-viewer-btn accent" data-ref-audio-play title="Play or pause this track">Play</button>` : ""}
          ${kindIsVideo
            ? `<button type="button" class="dxf-viewer-btn accent" data-ref-action="share-x" title="Share this video to X" aria-busy="false"><span class="viewport-video-share-x-spinner" hidden aria-hidden="true"></span><span data-ref-share-x-label>Share to X</span></button>`
            : canShare
              ? `<button type="button" class="dxf-viewer-btn" data-ref-action="share-menu" title="Share, copy link, or post to Slack, Discord, or X">Share</button>`
              : ""}
          <button type="button" class="dxf-viewer-btn accent" data-ref-action="send-ai" title="Attach marked-up file and notes to the AI prompt">
            Send to AI${strokeCount ? ` (${strokeCount})` : ""}
          </button>
          ${
            isTextLikeKind(kind)
              ? `<button type="button" class="dxf-viewer-btn" data-ref-action="save" title="Save this file">Save</button>`
              : ""
          }
          ${
            isTextLikeKind(kind) && isMcMasterPartsListFilename(tab.filename)
              ? `<button type="button" class="dxf-viewer-btn ${tab.partsListEdit ? "active" : ""}" data-ref-action="mcm-md-toggle" title="Switch between the parts page and raw markdown">${tab.partsListEdit ? "Parts page" : "Markdown"}</button>`
              : ""
          }
          ${
            kindIsVideo
              ? `<div class="ref-download-menu">
                  <button type="button" class="dxf-viewer-btn" data-ref-action="download" title="Download this video">Download</button>
                  <button type="button" class="dxf-viewer-btn ref-download-caret" data-ref-action="download-toggle" aria-haspopup="true" aria-expanded="false" title="Download format" aria-label="Download format">▾</button>
                  <div class="ref-download-menu-panel hidden" data-ref-download-panel role="menu">
                    <button type="button" role="menuitem" data-ref-download="original">Original file</button>
                    <button type="button" role="menuitem" data-ref-download="mp4">MP4</button>
                    <button type="button" role="menuitem" data-ref-download="webm">WebM</button>
                    <button type="button" role="menuitem" data-ref-download="gif">GIF</button>
                  </div>
                </div>`
              : kindIsImage
              ? `<div class="ref-download-menu">
                  <button type="button" class="dxf-viewer-btn" data-ref-action="download" title="Download this image">Download</button>
                  <button type="button" class="dxf-viewer-btn ref-download-caret" data-ref-action="download-toggle" aria-haspopup="true" aria-expanded="false" title="Download format" aria-label="Download format">▾</button>
                  <div class="ref-download-menu-panel hidden" data-ref-download-panel role="menu">
                    ${imageDownloadTypeButtons(tab, strokeCount)}
                  </div>
                </div>`
              : tab.blobUrl
              ? `<div class="ref-download-menu">
                  <button type="button" class="dxf-viewer-btn" data-ref-action="download" title="Download this file">Download</button>
                </div>`
              : ""
          }
        </div>
      </header>
      <div class="ref-viewer-body${cartMode ? " ref-viewer-body--cart" : ""}${splitting ? " ref-viewer-body--split" : ""}">
        ${codeWorkspace ? renderCodeTreeHtml() : renderMiniBrowserHtml()}
        <div class="ref-viewer-main${splitting ? " ref-viewer-main--split" : ""}">
          ${mainHtml}
        </div>
        <aside class="ref-notes-panel${notesHidden ? " hidden" : ""}" aria-label="Notes and markup" ${notesHidden ? "hidden" : ""}>
          <div class="ref-notes-head">
            <label class="ref-notes-label" for="ref-notes-input">Notes / markup</label>
            <button type="button" class="ref-notes-close" data-ref-action="hide-notes" title="Close notes" aria-label="Close notes">×</button>
          </div>
          ${kindIsAudio ? audioCommentsPanelHtml(tab.comments || []) : ""}
          <textarea id="ref-notes-input" class="ref-notes-editor" data-ref-notes placeholder="${kindIsAudio ? "Optional file notes for this track…" : "Write notes, callouts, or markup for this file…"}">${escapeHtml(tab.notes || "")}</textarea>
        </aside>
      </div>
    `;
    if (markupable) {
      drawMode = markupTool !== "pan";
      applyTransform();
    }
    viewerEl.classList.toggle("ref-draw-mode", !!drawMode && markupable);
    viewerEl.classList.toggle("ref-image-editor", kindIsImage);
    for (const name of paneNames) {
      const paneTab = tabs.get(name);
      if (paneTab?.kind === "image") {
        paneRoot(name)?.querySelectorAll("[data-ref-image-stack]").forEach((stack) => bindMarkupSurface(paneTab, stack));
      }
    }
    if (kind === "video" && !tab.loading && !tab.error && !splitting) bindVideoEditor(tab);
    if (kind === "audio" && !tab.loading && !tab.error) bindAudioPlayer(tab);
    if ((isTextLikeKind(kind) || kind === "spreadsheet") && !tab.loading && !tab.error) bindCodeEditor(tab);
    const pdfTabs = paneNames.map((name) => tabs.get(name)).filter((t) => t && t.kind === "pdf" && !t.loading && !t.error);
    for (const pdfTab of pdfTabs) {
      const host = paneRoot(pdfTab.filename)?.querySelector("[data-ref-pdf-pages]");
      void renderPdfPages(pdfTab, host);
    }
    if (cartMode) {
      void hydrateMcMasterCartThumbs(viewerEl.querySelector(".mcm-bom"), tab);
    }
    if (kindIsImage) {
      fitImageToPane();
      observeImageFit();
    }
    void hydrateMiniBrowserThumbs();
  }

  async function hydrateMiniBrowserThumbs() {
    const pid = getProjectId?.();
    if (!pid || !viewerEl || typeof rawFetch !== "function") return;
    const nodes = [...viewerEl.querySelectorAll("[data-ref-mini-thumb]")];
    revokeMiniThumbs();
    await Promise.all(nodes.map(async (host) => {
      if (host.querySelector("img")) return;
      const name = String(host.dataset.refMiniThumb || "").trim();
      if (!name) return;
      try {
        const res = await rawFetch(
          `/api/projects/${encodeURIComponent(pid)}/files/${encodeFileRel(name)}`,
        );
        if (!res?.ok) return;
        const blob = await res.blob();
        const type = String(blob.type || "").toLowerCase();
        if (type && !type.startsWith("image/") && !type.includes("octet-stream")) return;
        if (blob.size < 64) return;
        const url = trackObjectUrl(blob, refMiniThumbCreated);
        host.innerHTML = `<img src="${url}" alt="" />`;
      } catch {
        /* badge stays */
      }
    }));
  }

  async function openInEditor(filename, { newTab = false } = {}) {
    const key = String(filename || "").trim();
    if (!key) return null;
    if (tabs.has(key)) {
      activate(key);
      return tabs.get(key);
    }
    if (!newTab && activeFilename && activeFilename !== key) {
      closeTab(activeFilename);
    }
    return openTab(key);
  }

  function bindVideoEditor(tab) {
    const host = viewerEl?.querySelector("[data-ref-video-editor]");
    const videoEl = viewerEl?.querySelector(".ref-video");
    if (!host || !videoEl || !tab.blob) return;
    const key = `${tab.filename}:${tab.blobUrl || ""}`;
    if (videoEditorApi && videoEditorBoundKey === key) return;
    destroyVideoEditor();
    videoEditorBoundKey = key;
    videoEditorApi = mountVideoTimelineEditor(host, {
      getPreviewEl: () => viewerEl?.querySelector(".ref-video"),
      getToken,
      getProjectId,
      getAiKeyBodyFields,
      getAiKeyPickerState,
      setAiKeyPickerValue,
      onOpenAiKeyPicker,
      onAskRenderAgent,
      onOutputBlob: (blob) => {
        if (!blob || blob === tab.blob) return;
        tab.editedBlob = blob;
        tab._previewCreated = tab._previewCreated || [];
        const el = viewerEl?.querySelector(".ref-video");
        if (el) {
          tab.previewUrl = attachPreviewObjectUrl(el, blob, tab._previewCreated);
        } else {
          revokeTrackedObjectUrls(tab._previewCreated);
          tab.previewUrl = trackObjectUrl(blob, tab._previewCreated);
        }
      },
      onDownloadClip: async (blob, format) => {
        if (blob) tab.editedBlob = blob;
        await handleDownload(format || "original");
      },
      onStatus: (msg, isError) => {
        onStatus?.(isError ? "error" : "ok", typeof msg === "string" ? msg : String(msg || ""));
      },
    });
    try {
      videoEditorApi.setTimelineLoading?.(true, TIMELINE_CLIP_LOADING_STATUS);
      const pending = videoEditorApi.setPrimaryClip?.(tab.editedBlob || tab.blob, {
        label: tab.label || tab.filename,
        source: "library",
        sourcePath: tab.source_path || tab.filename || "",
      });
      if (pending && typeof pending.then === "function") {
        pending.then(() => restoreVideoEditorMusic(tab)).catch(() => {});
      } else {
        restoreVideoEditorMusic(tab);
      }
    } catch (_) {}
    const stage = viewerEl?.querySelector(".ref-viewer-stage-wrap--video");
    unbindVideoMediaDrop = bindMediaDropTarget(stage || videoEl, {
      onFiles: (files, ev) => {
        videoEditorApi?.ingestFiles?.(files, ev);
        snapshotVideoEditor(tab);
      },
      onDragState: (on) => {
        (stage || videoEl)?.classList.toggle("is-drop-target", on);
      },
    });
  }

  async function persistAudioPeaks(tab, peaks) {
    if (!tab?.projectId || !tab.filename || !Array.isArray(peaks) || !peaks.length) return;
    try {
      await api(
        `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeFileRel(tab.filename)}/markup`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: tab.notes || "",
            strokes: tab.strokes || [],
            comments: tab.comments || [],
            waveform_peaks: peaks,
          }),
        },
      );
    } catch {
      /* peaks stay in memory */
    }
  }

  async function postAudioComment(tab, { text, t }) {
    const res = await api(
      `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeFileRel(tab.filename)}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, t }),
      },
    );
    tab.comments = Array.isArray(res?.comments) ? res.comments : tab.comments || [];
    audioPlayerApi?.setComments?.(tab.comments, tab.audioDuration);
    onStatus?.("ok", "Comment saved for everyone on this project.");
    return tab.comments;
  }

  function bindAudioPlayer(tab) {
    const root = viewerEl?.querySelector("[data-ref-audio-player]");
    if (!root || !tab) return;
    destroyAudioPlayer();
    audioPlayerApi = bindAudioDocumentPlayer(root, {
      comments: tab.comments || [],
      peaks: tab.waveformPeaks || [],
      duration: tab.audioDuration || 0,
      startTime: tab.audioTime || 0,
      onAddComment: (payload) => postAudioComment(tab, payload),
      onTime: ({ t, duration }) => {
        tab.audioTime = t;
        if (duration) tab.audioDuration = duration;
      },
    });
    const key = peaksCacheKey({
      projectId: tab.projectId,
      filename: tab.filename,
      size: tab.blob?.size || 0,
    });
    const cached = cachedAudioPeaks(key) || tab.waveformPeaks;
    if (cached?.length) {
      tab.waveformPeaks = cached;
      audioPlayerApi.setPeaks?.(cached);
      return;
    }
    if (!tab.blob) return;
    void peaksForAudioBlob(tab.blob, key).then((peaks) => {
      if (!peaks?.length || tabs.get(tab.filename) !== tab) return;
      tab.waveformPeaks = rememberAudioPeaks(key, peaks);
      audioPlayerApi?.setPeaks?.(peaks);
      void persistAudioPeaks(tab, peaks);
    });
  }

  function bindCodeEditor(tab) {
    const root = paneRoot(tab.filename) || viewerEl;
    const textarea = root?.querySelector("[data-ref-text]");
    const highlightEl = root?.querySelector("[data-ref-code-highlight]");
    const gutterEl = root?.querySelector("[data-ref-code-gutter]");
    const stackEl = root?.querySelector("[data-ref-code-stack]");
    const innerEl = root?.querySelector("[data-ref-code-inner]");
    if (!textarea || !highlightEl) return;
    const mode = highlightModeForKind(tab.kind, tab.filename);
    const sync = () => {
      const text = textarea.value || "";
      tab.textContent = text;
      const lines = text.split("\n");
      const lineCount = Math.max(1, lines.length);
      if (gutterEl) {
        gutterEl.innerHTML = Array.from({ length: lineCount }, (_, i) => `<span>${i + 1}</span>`).join("");
      }
      highlightEl.innerHTML = `${highlightSource(text, { mode, query: tab.codeQuery || "" })}\n`;
      if (innerEl && stackEl) {
        const lineHeightPx = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
        const maxLineLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
        innerEl.style.minWidth = `${Math.max(stackEl.clientWidth || 0, maxLineLen * 8 + 28)}px`;
        innerEl.style.minHeight = `${Math.max(stackEl.clientHeight || 0, lineCount * lineHeightPx + 24)}px`;
      }
      if (gutterEl && stackEl) gutterEl.scrollTop = stackEl.scrollTop;
    };
    textarea.addEventListener("input", () => {
      sync();
      markDirty(tab);
    });
    textarea.addEventListener("scroll", () => {
      highlightEl.scrollTop = textarea.scrollTop;
      highlightEl.scrollLeft = textarea.scrollLeft;
      if (gutterEl) gutterEl.scrollTop = textarea.scrollTop;
    });
    stackEl?.addEventListener("scroll", () => {
      if (gutterEl) gutterEl.scrollTop = stackEl.scrollTop;
    });
    sync();
  }

  function markDirty(tab) {
    if (!tab) return;
    tab.dirty = true;
    if (docTabs) docTabs.setDirty(tab.filename, true);
    else renderTabs();
    scheduleAutosave(tab);
  }

  let autosaveTimer = 0;
  let autosaveInFlight = false;
  let autosaveEditedVideo = false;

  function scheduleAutosave(tab, { editedVideo = false } = {}) {
    if (!tab || tab.loading) return;
    if (editedVideo) autosaveEditedVideo = true;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = 0;
      void flushAutosave();
    }, 700);
  }

  async function flushAutosave() {
    if (autosaveInFlight) {
      scheduleAutosave(activeFilename ? tabs.get(activeFilename) : null, { editedVideo: autosaveEditedVideo });
      return;
    }
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    autosaveEditedVideo = false;
    autosaveInFlight = true;
    try {
      if (tab.dirty) await saveActive({ silent: true });
    } finally {
      autosaveInFlight = false;
    }
  }

  function syncNotesFromDom(tab) {
    if (!tab) return;
    const notesEl = viewerEl?.querySelector("[data-ref-notes]");
    const textEl = viewerEl?.querySelector("[data-ref-text]");
    if (notesEl) tab.notes = notesEl.value;
    if (textEl) tab.textContent = textEl.value;
  }

  function bindMarkupSurface(tab, root = null) {
    const stacks = root
      ? [root]
      : [...(viewerEl?.querySelectorAll("[data-ref-image-stack], [data-ref-pdf-page]") || [])];
    for (const stack of stacks) {
      if (!stack || stack.dataset.markupBound === "1") continue;
      stack.dataset.markupBound = "1";
      const pageIndex = Number(stack.dataset.page || 0);
      const media = stack.querySelector("img, canvas");
      if (!media) continue;

      const syncSvgSize = () => {
        const svg = stack.querySelector(".ref-markup-svg");
        if (!svg) return;
        const w =
          media.naturalWidth ||
          media.width ||
          media.clientWidth ||
          Number(media.getAttribute("width")) ||
          1;
        const h =
          media.naturalHeight ||
          media.height ||
          media.clientHeight ||
          Number(media.getAttribute("height")) ||
          1;
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
      };

      if (media.tagName === "IMG") {
        if (media.complete) syncSvgSize();
        else media.addEventListener("load", syncSvgSize, { once: true });
      } else {
        syncSvgSize();
      }

      const toLocal = (e) => {
        const rect = media.getBoundingClientRect();
        const w =
          media.naturalWidth ||
          media.width ||
          Number(media.getAttribute("width")) ||
          rect.width ||
          1;
        const h =
          media.naturalHeight ||
          media.height ||
          Number(media.getAttribute("height")) ||
          rect.height ||
          1;
        const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w;
        const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * h;
        return [x, y];
      };

      const redraw = () => {
        const svg = stack.querySelector(".ref-markup-svg");
        if (svg) svg.innerHTML = strokeSvg(tab.strokes, pageIndex, selectedStrokeIndex);
        syncSvgSize();
        updateRegionOverlay();
      };

      stack.addEventListener("pointerdown", (e) => {
        if (!drawMode) return;
        e.preventDefault();
        e.stopPropagation();
        const point = toLocal(e);
        if (markupTool === "eraser") {
          eraseNearPoint(tab, point, pageIndex);
          return;
        }
        if (markupTool === "select" || markupTool === "text") {
          const hit = hitTextStrokeIndex(tab.strokes || [], point, pageIndex);
          if (hit >= 0) {
            selectedStrokeIndex = hit;
            const stroke = tab.strokes[hit];
            textDrag = {
              index: hit,
              start: point,
              originX: Number(stroke.x ?? stroke.points?.[0]?.[0] ?? 0),
              originY: Number(stroke.y ?? stroke.points?.[0]?.[1] ?? 0),
            };
            pushStrokeHistory(tab);
            stack.setPointerCapture?.(e.pointerId);
            redraw();
            return;
          }
        }
        if (markupTool === "select") {
          selectedStrokeIndex = -1;
          textDrag = null;
          redraw();
          return;
        }
        if (markupTool === "text") {
          pushStrokeHistory(tab);
          tab.strokes = [
            ...(tab.strokes || []),
            {
              type: "text",
              text: "",
              x: point[0],
              y: point[1],
              points: [point, point],
              color: markupColor,
              width: markupWidth,
              fontSize: Math.max(16, markupWidth * 6),
              page: pageIndex,
            },
          ];
          selectedStrokeIndex = tab.strokes.length - 1;
          markDirty(tab);
          redraw();
          placeImageTextInput(stack, media, tab.strokes[selectedStrokeIndex], selectedStrokeIndex);
          return;
        }
        if (markupTool === "region") {
          regionDrag = { start: point, current: point, page: pageIndex };
          regionSelect = null;
          updateRegionOverlay();
          stack.setPointerCapture?.(e.pointerId);
          return;
        }
        drawing = true;
        currentStroke = {
          type: ["highlight", "rect", "circle", "line", "arrow"].includes(markupTool) ? markupTool : "pen",
          points: [point, point],
          color: markupColor,
          width: markupWidth,
          page: pageIndex,
        };
        pushStrokeHistory(tab);
        tab.strokes = [...(tab.strokes || []), currentStroke];
        stack.setPointerCapture?.(e.pointerId);
        redraw();
        markDirty(tab);
      });
      stack.addEventListener("pointermove", (e) => {
        if (textDrag && tab.strokes?.[textDrag.index]) {
          const point = toLocal(e);
          const stroke = tab.strokes[textDrag.index];
          const nx = textDrag.originX + (point[0] - textDrag.start[0]);
          const ny = textDrag.originY + (point[1] - textDrag.start[1]);
          stroke.x = nx;
          stroke.y = ny;
          stroke.points = [[nx, ny], [nx, ny]];
          markDirty(tab);
          redraw();
          return;
        }
        if (regionDrag && regionDrag.page === pageIndex) {
          regionDrag.current = toLocal(e);
          updateRegionOverlay();
          return;
        }
        if (!drawing || !currentStroke || currentStroke.page !== pageIndex) return;
        const point = toLocal(e);
        if (currentStroke.type === "rect" || currentStroke.type === "arrow" || currentStroke.type === "circle" || currentStroke.type === "line") {
          currentStroke.points = [currentStroke.points[0], point];
        } else {
          currentStroke.points.push(point);
        }
        redraw();
      });
      const endStroke = (e) => {
        if (regionDrag && regionDrag.page === pageIndex) {
          const end = e ? toLocal(e) : regionDrag.current;
          const start = regionDrag.start;
          regionDrag = null;
          const w = Math.abs(end[0] - start[0]);
          const h = Math.abs(end[1] - start[1]);
          if (w < 8 || h < 8) {
            regionSelect = null;
            updateRegionOverlay();
            return;
          }
          regionSelect = { start, end, page: pageIndex };
          updateRegionOverlay();
          void openRegionEditModal(tab, regionSelect);
          return;
        }
        if (textDrag) {
          textDrag = null;
          return;
        }
        drawing = false;
        currentStroke = null;
      };
      stack.addEventListener("pointerup", endStroke);
      stack.addEventListener("pointercancel", endStroke);
    }
  }

  async function renderPdfPages(tab, hostEl = null) {
    const host = hostEl || viewerEl?.querySelector("[data-ref-pdf-pages]");
    if (!host || !tab.blobUrl) return;
    try {
      const pdfjs = await loadPdfJs();
      const loadingTask = pdfjs.getDocument(tab.blobUrl);
      const pdf = await loadingTask.promise;
      tab.pdfPageCount = pdf.numPages;
      host.innerHTML = "";
      const maxPages = Math.min(pdf.numPages, 20);
      for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.35 });
        const pageEl = document.createElement("div");
        pageEl.className = "ref-pdf-page";
        pageEl.dataset.refPdfPage = "";
        pageEl.dataset.page = String(pageNum - 1);
        const canvas = document.createElement("canvas");
        canvas.className = "ref-pdf-canvas";
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("ref-markup-svg");
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svg.innerHTML = strokeSvg(tab.strokes, pageNum - 1);
        pageEl.append(canvas, svg);
        host.appendChild(pageEl);
        bindMarkupSurface(tab, pageEl);
      }
      if (pdf.numPages > maxPages) {
        const note = document.createElement("p");
        note.className = "muted small ref-pdf-more";
        note.textContent = `Showing first ${maxPages} of ${pdf.numPages} pages for markup.`;
        host.appendChild(note);
      }
    } catch (err) {
      host.innerHTML = `<div class="ref-viewer-empty">Could not render PDF for markup (${escapeHtml(err.message || "error")}). Notes still work — use Send to AI for notes.</div>`;
    }
  }

  async function compositeMarkedImage(tab) {
    const kind = tab.kind || kindFromName(tab.filename);
    if (kind === "image") {
      const loadImg = (url) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not load image for Send to AI"));
        img.src = url;
      });
      const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read image for Send to AI"));
        reader.readAsDataURL(blob);
      });
      let img = null;
      const src = tab.blobUrl || tab.previewUrl;
      if (src) {
        try {
          img = await loadImg(src);
        } catch {
          img = null;
        }
      }
      if (!img && tab.blob) {
        img = await loadImg(await blobToDataUrl(tab.blob));
      }
      if (!img) throw new Error("Could not load image for Send to AI");
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      drawStrokesOnCtx(ctx, tab.strokes, 0);
      return canvas.toDataURL("image/png");
    }
    if (kind === "pdf") {
      const pageCanvases = [...(viewerEl?.querySelectorAll(".ref-pdf-page canvas") || [])];
      if (!pageCanvases.length) {
        // Ensure pages are rendered before compositing
        await renderPdfPages(tab);
      }
      const pages = [...(viewerEl?.querySelectorAll(".ref-pdf-page") || [])];
      if (!pages.length) return null;
      const markedPages = pages.filter((pageEl) => {
        const idx = Number(pageEl.dataset.page || 0);
        return (tab.strokes || []).some((s) => (s.page == null ? 0 : Number(s.page)) === idx);
      });
      const usePages = markedPages.length ? markedPages : pages.slice(0, Math.min(3, pages.length));
      const gap = 12;
      const widths = usePages.map((el) => el.querySelector("canvas")?.width || 0);
      const heights = usePages.map((el) => el.querySelector("canvas")?.height || 0);
      const width = Math.max(...widths, 1);
      const height = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, usePages.length - 1);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      let y = 0;
      for (const pageEl of usePages) {
        const src = pageEl.querySelector("canvas");
        const idx = Number(pageEl.dataset.page || 0);
        if (!src) continue;
        ctx.save();
        ctx.translate(0, y);
        ctx.drawImage(src, 0, 0);
        drawStrokesOnCtx(ctx, tab.strokes, idx);
        ctx.restore();
        y += src.height + gap;
      }
      return canvas.toDataURL("image/png");
    }
    return null;
  }

  function stemForDownload(tab) {
    return String(tab?.label || labelFromName(tab?.filename) || "render").replace(/[^\w.-]+/g, "_") || "render";
  }

  function triggerBlobDownload(blob, filename) {
    triggerTrackedBlobDownload(blob, filename, refDownloadCreated);
  }

  function dataUrlToBlob(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data");
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  }

  async function loadImageElement(src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not load image"));
      img.src = src;
    });
    return img;
  }

  async function buildExportCanvas(tab, { withMarkup = true } = {}) {
    const src = withMarkup ? await compositeMarkedImage(tab) : null;
    if (src) {
      const img = await loadImageElement(src);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas;
    }
    if (!tab.blobUrl) throw new Error("Nothing to download");
    const img = await loadImageElement(tab.blobUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (withMarkup) drawStrokesOnCtx(ctx, tab.strokes, 0);
    return canvas;
  }

  async function downloadAsRaster(tab, format) {
    const canvas = await buildExportCanvas(tab, { withMarkup: true });
    const mime =
      format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const quality = format === "png" ? undefined : 0.92;
    const dataUrl = canvas.toDataURL(mime, quality);
    const ext = format === "jpeg" ? "jpg" : format;
    triggerBlobDownload(dataUrlToBlob(dataUrl), `${stemForDownload(tab)}.${ext}`);
  }

  async function downloadAsSvg(tab) {
    if (!sourceCanDownloadSvg(tab)) {
      throw new Error("SVG download is only available for SVG sources.");
    }
    let text = "";
    const blob = tab.editedBlob || tab.blob;
    if (blob) text = await blob.text();
    else if (tab.blobUrl) {
      const res = await fetch(tab.blobUrl);
      if (!res.ok) throw new Error("Could not read SVG");
      text = await res.text();
    }
    if (!String(text).trim()) throw new Error("Nothing to download");
    const markup = strokeSvg(tab.strokes, 0);
    if (markup) {
      text = /<\/svg>\s*$/i.test(text)
        ? text.replace(/<\/svg>\s*$/i, `<g class="markup">${markup}</g></svg>`)
        : `${text}<g class="markup">${markup}</g>`;
    }
    triggerBlobDownload(new Blob([text], { type: "image/svg+xml" }), `${stemForDownload(tab)}.svg`);
  }

  async function downloadOriginal(tab) {
    const kind = tab.kind || kindFromName(tab.filename);
    if (kind === "video") {
      const blob = await resolveTabVideoBlob(tab);
      const name = tab.filename || `${stemForDownload(tab)}.webm`;
      triggerBlobDownload(blob, name);
      return;
    }
    if (tab.blob instanceof Blob && tab.blob.size > 0) {
      triggerBlobDownload(tab.blob, tab.filename || `${stemForDownload(tab)}.png`);
      return;
    }
    if (!tab.blobUrl) throw new Error("Nothing to download");
    const res = await fetch(tab.blobUrl);
    if (!res.ok) throw new Error("Could not read file");
    triggerBlobDownload(await res.blob(), tab.filename || `${stemForDownload(tab)}.png`);
  }

  function closeDownloadPanel() {
    const panel = viewerEl?.querySelector("[data-ref-download-panel]");
    const toggle = viewerEl?.querySelector('[data-ref-action="download-toggle"]');
    panel?.classList.add("hidden");
    toggle?.setAttribute("aria-expanded", "false");
  }

  function closeReferenceContextMenu() {
    document.getElementById("ref-image-context-menu")?.remove();
  }

  function showMiniBrowserContextMenu(event, filename) {
    const key = String(filename || "");
    if (!key) return;
    closeReferenceContextMenu();
    const menu = document.createElement("div");
    menu.id = "ref-image-context-menu";
    menu.className = "ref-image-context-menu";
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 160)}px`;
    const inSplit = splitFilenames.includes(key);
    const isOpen = tabs.has(key);
    const isImage = /\.(png|jpe?g|webp|gif|bmp|svg|tiff?|heic|heif)$/i.test(key);
    const isVideo = /\.(webm|mp4|mov|m4v)$/i.test(key);
    menu.innerHTML = `
      <div class="ref-image-context-menu-title">
        <strong>${escapeHtml(labelFromName(key))}</strong>
        <button type="button" data-ref-context-close aria-label="Close">×</button>
      </div>
      ${(isImage || isVideo) ? `<button type="button" data-ref-mini-ctx="editor">Open editor</button>` : ""}
      ${isImage ? `<button type="button" data-ref-mini-ctx="add-editor">Add to editor</button>` : ""}
      <button type="button" data-ref-mini-ctx="here">${isOpen ? "Show in editor" : "Open in editor"}</button>
      <button type="button" data-ref-mini-ctx="open">Open new tab</button>
      <button type="button" data-ref-mini-ctx="split">${inSplit ? "Already in split view" : "Add to split view"}</button>
    `;
    document.body.appendChild(menu);
    menu.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-ref-context-close]")) {
        closeReferenceContextMenu();
        return;
      }
      const action = ev.target.closest("[data-ref-mini-ctx]")?.dataset.refMiniCtx;
      if (action === "editor") {
        closeReferenceContextMenu();
        onOpenVideoEditor?.({ filename: key, kind: isVideo ? "video" : isImage ? "image" : "file" });
        return;
      }
      if (action === "add-editor") {
        closeReferenceContextMenu();
        onAddToVideoEditor?.({ filename: key, kind: "image" });
        return;
      }
      if (action === "here") {
        closeReferenceContextMenu();
        void openInEditor(key, { newTab: false });
        return;
      }
      if (action === "open") {
        closeReferenceContextMenu();
        void openInEditor(key, { newTab: true });
        return;
      }
      if (action === "split") {
        closeReferenceContextMenu();
        void addToSplit(key);
      }
    });
  }

  function debugTagForTab(tab) {
    return [
      `Render Studio render image`,
      `project_id=${tab?.projectId || getProjectId?.() || ""}`,
      `filename=${tab?.filename || ""}`,
      `prompt_debug=include this project id and filename when reporting render image issues`,
    ].join("\n");
  }

  async function copyRenderImageWithDebug(tab) {
    const canvas = await buildExportCanvas(tab, { withMarkup: true });
    const debug = debugTagForTab(tab);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not prepare image for clipboard.");
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": blob,
            "text/plain": new Blob([debug], { type: "text/plain" }),
          }),
        ]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(debug);
      } else {
        throw new Error("Clipboard is not available in this browser.");
      }
      onStatus?.("ok", "Copied render image with project/debug tag.");
    } catch (err) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(debug);
        onStatus?.("ok", "Copied render debug tag. Browser blocked image clipboard access.");
        return;
      }
      throw err;
    }
  }

  async function shareOpenVideoToX(tab) {
    const btn = viewerEl?.querySelector('[data-ref-action="share-x"]');
    btn?.classList.add("is-loading");
    btn?.setAttribute("aria-busy", "true");
    let blob = tab?.editedBlob || tab?.blob || null;
    if (!blob && tab?.blobUrl) {
      try {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = setTimeout(() => {
          try { ctrl?.abort(); } catch (_) { /* ignore */ }
        }, 20_000);
        const res = await fetch(tab.blobUrl, ctrl ? { signal: ctrl.signal } : undefined);
        clearTimeout(timer);
        if (res.ok) blob = await res.blob();
      } catch (_) { /* app.js can still fetch the file */ }
    }
    emitReferenceAction("share-x", tab, { blob, inPlace: true });
  }

  function emitReferenceAction(action, tab, extra = {}) {
    closeReferenceContextMenu();
    onReferenceAction?.({
      action,
      filename: tab?.filename,
      label: tab?.label || tab?.filename,
      kind: tab?.kind || kindFromName(tab?.filename),
      projectId: tab?.projectId || getProjectId?.(),
      blobUrl: extra.textureDataUrl || tab?.blobUrl,
      textureDataUrl: extra.textureDataUrl || null,
      wrapMode: extra.wrapMode || "",
      blob: extra.blob || tab?.editedBlob || tab?.blob || null,
      debugText: debugTagForTab(tab),
      includeModel: !!extra.includeModel,
      source: "reference-image",
    });
  }

  function showReferenceContextMenu(event, tab) {
    const kind = tab?.kind || kindFromName(tab?.filename);
    if (!tab || (kind !== "image" && kind !== "video" && kind !== "pdf" && kind !== "file")) return;
    event.preventDefault();
    event.stopPropagation();
    closeReferenceContextMenu();
    const menu = document.createElement("div");
    menu.id = "ref-image-context-menu";
    menu.className = "ref-image-context-menu";
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 280)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 360)}px`;
    const isVideo = kind === "video";
    const isImage = kind === "image";
    const strokeCount = (tab.strokes || []).length;
    menu.innerHTML = `
      <div class="ref-image-context-menu-title">
        <strong>${isVideo ? "Share video" : isImage ? "Share render" : "Share file"}</strong>
        <button type="button" data-ref-context-close aria-label="Close share menu">×</button>
      </div>
      ${isImage ? `<button type="button" data-ref-context="copy">Copy render image + debug tag</button>` : ""}
      ${isImage ? "" : `<button type="button" data-ref-context="copy-link">Copy share link</button>`}
      <button type="button" data-ref-context="share-x">Share to X…</button>
      <button type="button" data-ref-context="share-slack">Share to Slack…</button>
      <button type="button" data-ref-context="share-discord">Share to Discord…</button>
      ${
        isImage
          ? `<div class="ref-ctx-download">
              <button type="button" data-ref-context="download-toggle" aria-expanded="true" aria-haspopup="true">Download ▾</button>
              <div class="ref-ctx-download-panel" data-ref-ctx-download role="menu">
                ${imageDownloadTypeButtons(tab, strokeCount)}
              </div>
            </div>`
          : `<button type="button" data-ref-context="download">Download</button>
             <button type="button" data-ref-context="share-link">Export / share…</button>`
      }
      ${isImage ? `<button type="button" data-ref-context="share-chat">Share to project chat...</button>` : ""}
      ${isImage ? `<button type="button" data-ref-context="share-dm">Share to DM...</button>` : ""}
      ${isImage ? `<button type="button" data-ref-context="store">Add to public profile/store...</button>` : ""}
      ${isImage ? `<button type="button" data-ref-context="texture">Export texture back to model</button>` : ""}
      <hr />
      ${(isVideo || isImage) ? `<button type="button" data-ref-context="open-editor">Open editor</button>` : ""}
      ${isImage ? `<button type="button" data-ref-context="add-editor">Add to editor</button>` : ""}
      <button type="button" data-ref-context="split">Add to split view</button>
      <button type="button" data-ref-context="delete" class="danger">Delete reference file</button>
    `;
    document.body.appendChild(menu);
    menu.addEventListener("click", (e) => {
      if (e.target.closest("[data-ref-context-close]")) {
        closeReferenceContextMenu();
        return;
      }
      const downloadFmt = e.target.closest("[data-ref-download]")?.dataset.refDownload;
      if (downloadFmt) {
        closeReferenceContextMenu();
        void handleDownload(downloadFmt);
        return;
      }
      const action = e.target.closest("[data-ref-context]")?.dataset.refContext;
      if (!action) return;
      if (action === "download-toggle") {
        const panel = menu.querySelector("[data-ref-ctx-download]");
        const toggle = e.target.closest("[data-ref-context]");
        const open = panel?.classList.toggle("hidden") === false;
        toggle?.setAttribute("aria-expanded", String(!!open));
        return;
      }
      if (action === "copy") {
        void copyRenderImageWithDebug(tab).catch((err) => onStatus?.("error", err.message || "Could not copy render image."));
        closeReferenceContextMenu();
        return;
      }
      if (action === "split") {
        closeReferenceContextMenu();
        void addToSplit(tab.filename);
        return;
      }
      if (action === "open-editor") {
        closeReferenceContextMenu();
        onOpenVideoEditor?.({ filename: tab.filename, kind, blob: tab.editedBlob || tab.blob, label: tab.label });
        return;
      }
      if (action === "add-editor") {
        closeReferenceContextMenu();
        onAddToVideoEditor?.({
          filename: tab.filename,
          kind: "image",
          blob: tab.editedBlob || tab.blob,
          label: tab.label,
        });
        return;
      }
      if (action === "delete") {
        closeReferenceContextMenu();
        emitReferenceAction("delete", tab);
        return;
      }
      if (action === "download") {
        closeReferenceContextMenu();
        void handleDownload("original");
        return;
      }
      if (action === "copy-link") emitReferenceAction("copy-link", tab);
      else if (action === "share-x") void shareOpenVideoToX(tab);
      else if (action === "share-slack") emitReferenceAction("share-slack", tab);
      else if (action === "share-discord") emitReferenceAction("share-discord", tab);
      else if (action === "share-link") emitReferenceAction("share-link", tab);
      else if (action === "share-chat") emitReferenceAction("share-chat", tab);
      else if (action === "share-dm") emitReferenceAction("share-dm", tab);
      else if (action === "store") emitReferenceAction("store", tab);
      else if (action === "texture") emitReferenceAction("texture-model", tab);
      closeReferenceContextMenu();
    });
  }

  async function handleDownload(format) {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    closeDownloadPanel();
    const kind = tab.kind || kindFromName(tab.filename);
    const fmt = String(format || (kind === "video" ? "original" : "original")).toLowerCase();
    try {
      if (kind === "video" && (fmt === "mp4" || fmt === "webm" || fmt === "gif")) {
        await downloadVideoFormat(tab, fmt);
      } else if (fmt === "original" || kind === "video") {
        await downloadOriginal(tab);
      } else if (fmt === "svg") {
        await downloadAsSvg(tab);
      } else if (fmt === "jpg" || fmt === "jpeg") {
        await downloadAsRaster(tab, "jpeg");
      } else {
        await downloadAsRaster(tab, fmt);
      }
      onStatus?.("ok", `Downloaded ${downloadFormatLabel(fmt)}`);
    } catch (err) {
      onStatus?.("error", err.message || "Download failed");
    }
  }

  async function resolveTabVideoBlob(tab) {
    try {
      const baked = await videoEditorApi?.ensureBaked?.({ applyPrompt: false, updatePreview: false });
      if (baked) {
        tab.editedBlob = baked;
        return baked;
      }
    } catch (_) { /* fall back to stored blob */ }
    if (tab.editedBlob) return tab.editedBlob;
    if (tab.blob) return tab.blob;
    if (!tab.blobUrl) throw new Error("Nothing to download");
    const res = await fetch(tab.blobUrl);
    if (!res.ok) throw new Error("Could not read video");
    return res.blob();
  }

  async function downloadVideoFormat(tab, format) {
    let blob = await resolveTabVideoBlob(tab);
    const type = String(blob.type || "").toLowerCase();
    const already = format === "mp4"
      ? type.includes("mp4") || type.includes("m4v") || type.includes("quicktime")
      : format === "webm"
        ? type.includes("webm")
        : format === "gif"
          ? type.includes("gif")
          : false;
    if (!already && (format === "mp4" || format === "webm" || format === "gif")) {
      try {
        const token = typeof getToken === "function" ? getToken() : null;
        if (!token) throw new Error(`Sign in to convert this clip to ${format.toUpperCase()}.`);
        const form = new FormData();
        const srcName = type.includes("mp4") ? "clip.mp4" : "clip.webm";
        form.append("video", blob, tab.filename || srcName);
        form.append("format", format);
        const res = await fetch("/api/video/convert", {
          method: "POST",
          headers: { ...authHeaders() },
          body: form,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || `Could not convert to ${format.toUpperCase()}`);
        }
        blob = new Blob([await res.arrayBuffer()], {
          type: format === "gif" ? "image/gif" : format === "mp4" ? "video/mp4" : "video/webm",
        });
      } catch (err) {
        console.warn("[reference-files] convert failed; saving original", err);
      }
    }
    const stem = stemForDownload(tab);
    const ext = typeFromBlob(blob, format);
    triggerBlobDownload(blob, `${stem}.${ext}`);
  }

  function typeFromBlob(blob, fallback) {
    const type = String(blob?.type || "").toLowerCase();
    if (type.includes("mp4") || type.includes("m4v")) return "mp4";
    if (type.includes("webm")) return "webm";
    if (type.includes("gif")) return "gif";
    if (type.includes("quicktime")) return "mov";
    return fallback || "webm";
  }

  async function buildSendPayload(tab) {
    syncNotesFromDom(tab);
    const kind = tab.kind || kindFromName(tab.filename);
    const notes = String(tab.notes || "").trim();
    const strokes = tab.strokes || [];
    const images = [];
    if (canMarkup(kind)) {
      try {
        const dataUrl = await compositeMarkedImage(tab);
        if (dataUrl) {
          images.push({
            id: `ref-mark-${Date.now()}`,
            name: `${labelFromName(tab.filename)}-marked.png`,
            media_type: "image/png",
            data_url: dataUrl,
            source_filename: tab.filename,
            markup_strokes: strokes.length,
            ...(kind === "image" && strokes.length ? {
              role: "canvas",
              drawing_metadata: buildCanvasDrawingMetadata({ title: tab.label || tab.filename,
                elements: strokes.map((stroke, index) => ({
                  id: `annotation-${index}`, type: stroke.type, text: stroke.text,
                  points: (stroke.points || []).map(([x, y]) => ({ x, y })),
                  x1: stroke.points?.[0]?.[0], y1: stroke.points?.[0]?.[1],
                  x2: stroke.points?.at(-1)?.[0], y2: stroke.points?.at(-1)?.[1],
                })),
              }),
            } : {}),
          });
        }
      } catch (err) {
        onStatus?.("error", err.message || "Could not build marked image");
      }
    }
    let documentText = null;
    if (isTextLikeKind(kind)) {
      const parts = [];
      if (notes) parts.push(`Notes:\n${notes}`);
      if (tab.textContent?.trim()) parts.push(tab.textContent.trim());
      documentText = parts.join("\n\n") || null;
    } else if (notes) {
      documentText = `Notes for ${tab.filename}:\n${notes}`;
    }
    return {
      filename: tab.filename,
      label: tab.label || tab.filename,
      kind,
      notes,
      strokeCount: strokes.length,
      images,
      documentText,
      projectId: tab.projectId,
    };
  }

  async function loadTab(tab) {
    if (!tab?.projectId || !tab?.filename) {
      if (refLoadAbort) {
        try { refLoadAbort.abort(); } catch (_) { /* ignore */ }
      }
      return;
    }
    const ctl = beginRefLoadFetch();
    tab.loading = true;
    tab.error = "";
    renderViewer();
    try {
      const fileRes = await rawFetch(
        `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeFileRel(tab.filename)}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      if (!fileRes.ok) throw new Error("Could not load file");
      if (isTextLikeKind(tab.kind)) {
        tab.textContent = await fileRes.text();
        if (ctl.signal.aborted) return;
        tab.blobUrl = null;
        tab.blob = null;
        if (tab.kind === "csv") tab.sheetRows = parseCsvText(tab.textContent);
      } else {
        const blob = await fileRes.blob();
        if (ctl.signal.aborted) return;
        revokeBlob(tab);
        tab.blob = blob;
        tab._blobCreated = tab._blobCreated || [];
        tab.blobUrl = trackObjectUrl(blob, tab._blobCreated);
        tab.previewUrl = null;
        tab.editedBlob = null;
        if (tab.kind === "spreadsheet") {
          try {
            tab.sheetRows = await parseSpreadsheetBlob(blob, tab.filename);
            tab.sheetError = "";
          } catch (err) {
            tab.sheetRows = [];
            tab.sheetError = err.message || "Could not preview spreadsheet";
          }
        }
      }
      let markup = { notes: "", strokes: [] };
      try {
        markup = await api(
          `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeFileRel(tab.filename)}/markup`,
          { signal: ctl.signal },
        );
        if (ctl.signal.aborted) return;
      } catch (err) {
        if (ctl.signal.aborted || err?.name === "AbortError") return;
        /* markup optional */
      }
      tab.notes = markup.notes || "";
      tab.strokes = Array.isArray(markup.strokes) ? markup.strokes : [];
      tab.comments = Array.isArray(markup.comments) ? markup.comments : [];
      tab.waveformPeaks = Array.isArray(markup.waveform_peaks) ? markup.waveform_peaks : [];
      if (tab.waveformPeaks.length) {
        rememberAudioPeaks(peaksCacheKey({
          projectId: tab.projectId,
          filename: tab.filename,
          size: tab.blob?.size || 0,
        }), tab.waveformPeaks);
      }
      tab.loading = false;
      tab.dirty = false;
      renderTabs();
      renderViewer();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      tab.loading = false;
      tab.error = err.message || "Could not load reference file";
      renderViewer();
      onStatus?.("error", tab.error);
    }
  }

  async function saveActive({ silent = false } = {}) {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    syncNotesFromDom(tab);

    try {
      if (isTextLikeKind(tab.kind)) {
        await api(
          `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeFileRel(tab.filename)}/text`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: tab.textContent || "" }),
          },
        );
      }
      await api(
        `/api/projects/${encodeURIComponent(tab.projectId)}/files/${encodeFileRel(tab.filename)}/markup`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: tab.notes || "",
            strokes: tab.strokes || [],
            comments: tab.comments || [],
            waveform_peaks: tab.waveformPeaks || [],
          }),
        },
      );
      tab.dirty = false;
      if (docTabs) docTabs.setDirty(tab.filename, false);
      else renderTabs();
      if (!silent) onStatus?.("ok", `Saved ${tab.label || tab.filename}`);
    } catch (err) {
      onStatus?.("error", err.message || "Save failed");
    }
  }

  function activate(filename, { syncShared = true } = {}) {
    if (!tabs.has(filename)) return;
    const prev = activeFilename ? tabs.get(activeFilename) : null;
    if (prev) {
      const notesEl = viewerEl?.querySelector("[data-ref-notes]");
      const textEl = viewerEl?.querySelector("[data-ref-text]");
      if (notesEl) prev.notes = notesEl.value;
      if (textEl && textEl.value !== prev.textContent) {
        prev.textContent = textEl.value;
        prev.dirty = true;
        if (docTabs) docTabs.setDirty(prev.filename, true);
      }
    }
    activeFilename = filename;
    undoStack = [];
    redoStack = [];
    regionSelect = null;
    regionDrag = null;
    if (canMarkup(tabs.get(filename)?.kind)) resetView();
    if (syncShared) syncDocTab(tabs.get(filename), { activate: true });
    else renderTabs();
    renderViewer();
    onActiveChange?.(filename);
  }

  function clearViewerHost() {
    if (!viewerEl) return;
    revokeMcMasterThumbs();
    revokeMiniThumbs();
    const wipe = () => {
      try { if (viewerEl) viewerEl.innerHTML = ""; } catch (_) {}
    };
    if (shouldHeavyTeardownVideoEditorOnCloseTick()) wipe();
    else scheduleVideoEditorIdle(wipe, 32);
  }

  function closeTab(filename) {
    const tab = tabs.get(filename);
    if (!tab) return;
    if (tab.loading && refLoadAbort) {
      try { refLoadAbort.abort(); } catch (_) { /* ignore */ }
    }
    if (activeFilename === filename) {
      pauseOpenMedia();
      destroyVideoEditor();
    }
    revokeBlob(tab);
    tabs.delete(filename);
    splitFilenames = splitFilenames.filter((name) => name !== filename);
    syncSplitList();
    if (activeFilename === filename) activeFilename = null;
    if (docTabs) {
      docTabs.remove(filename);
      if (!activeFilename) {
        setVisible(false);
        clearViewerHost();
        onActiveChange?.(null);
      }
      return;
    }
    if (activeFilename === filename) {
      activeFilename = tabs.keys().next().value || null;
      if (activeFilename && canMarkup(tabs.get(activeFilename)?.kind)) resetView();
    }
    renderTabs();
    renderViewer();
  }

  function hideViewerOnly() {
    pauseOpenMedia();
    destroyVideoEditor();
    activeFilename = null;
    setVisible(false);
    clearViewerHost();
  }

  async function openTab(filename, { projectId, label, kind, forceReload = false } = {}) {
    const pid = projectId || getProjectId?.();
    if (!pid || !filename) {
      onStatus?.("error", "Select a project before opening a reference file.");
      return null;
    }
    onBeforeOpen?.();
    const key = String(filename);
    let tab = tabs.get(key);
    if (tab && forceReload) {
      revokeBlob(tab);
      tabs.delete(key);
      docTabs?.remove?.(key);
      tab = null;
    }
    if (!tab) {
      if (tabs.size >= MAX_OPEN_TABS) {
        onStatus?.("error", "Close a tab first — up to 6 files can be open.");
        return null;
      }
      tab = {
        filename: key,
        label: label || labelFromName(key),
        projectId: pid,
        kind: resolveViewerKind(key, kind),
        textContent: "",
        notes: "",
        strokes: [],
        comments: [],
        waveformPeaks: [],
        audioTime: 0,
        audioDuration: 0,
        blobUrl: null,
        loading: false,
        error: "",
        dirty: false,
      };
      tabs.set(key, tab);
      syncDocTab(tab);
      await loadTab(tab);
    } else {
      tab.projectId = pid;
      if (label) tab.label = label;
      if (kind === "image" || kind === "pdf" || kind === "video" || kind === "audio") tab.kind = kind;
      else tab.kind = resolveViewerKind(key, tab.kind);
      if (!isTextLikeKind(tab.kind) && !tab.blobUrl && !tab.loading) await loadTab(tab);
      else if (isTextLikeKind(tab.kind) && tab.textContent == null && !tab.loading) await loadTab(tab);
    }
    activate(key);
    onStatus?.("ok", `Opened ${tab.label}`);
    return tab;
  }

  async function sendActiveToPrompt() {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return null;
    try {
      await saveActive();
    } catch {
      /* still try to send */
    }
    try {
      const payload = await buildSendPayload(tab);
      if (onSendToPrompt) {
        await onSendToPrompt(payload);
      }
      return payload;
    } catch (err) {
      onStatus?.("error", err?.message || "Could not attach that image");
      throw err;
    }
  }

  async function sendFilenameToPrompt(filename) {
    if (!filename) return null;
    if (!tabs.has(filename)) {
      await openTab(filename);
    } else {
      activate(filename);
    }
    return sendActiveToPrompt();
  }

  if (!docTabs) {
    tabBarEl?.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-ref-close]");
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        closeTab(closeBtn.dataset.refClose);
        return;
      }
      const tabBtn = e.target.closest("[data-ref-tab]");
      if (tabBtn) activate(tabBtn.dataset.refTab);
    });
  }

  function buildAiKeySelectHtml() {
    const state = getAiKeyPickerState?.() || { options: [], selected: "" };
    const options = Array.isArray(state.options) ? state.options : [];
    if (!options.length) {
      return `<select data-region-ai-key disabled><option value="">Default OpenAI key</option></select>`;
    }
    return `<select data-region-ai-key aria-label="AI key">
      ${options.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === state.selected ? " selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
    </select>`;
  }

  async function openRegionEditModal(tab, region) {
    if (!tab?.blobUrl || !region) return;
    const x0 = Math.min(region.start[0], region.end[0]);
    const y0 = Math.min(region.start[1], region.end[1]);
    const x1 = Math.max(region.start[0], region.end[0]);
    const y1 = Math.max(region.start[1], region.end[1]);
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    let cropUrl = "";
    try {
      const img = await loadImageElement(tab.blobUrl);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, x0, y0, w, h, 0, 0, w, h);
      cropUrl = canvas.toDataURL("image/png");
    } catch (err) {
      onStatus?.("error", err.message || "Could not crop selection");
      return;
    }

    document.getElementById("ref-region-edit-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "ref-region-edit-modal";
    modal.className = "ref-region-edit-modal";
    modal.innerHTML = `
      <div class="ref-region-edit-card" role="dialog" aria-modal="true" aria-labelledby="ref-region-edit-title">
        <button type="button" class="ref-region-edit-close" data-region-close aria-label="Close">×</button>
        <h3 id="ref-region-edit-title">Edit selected region</h3>
        <p class="muted small">Prompt an edit for this crop. The rest of the image stays the same.</p>
        <div class="ref-region-edit-preview"><img src="${cropUrl}" alt="Selected region" /></div>
        <label class="ref-region-field">
          <span>Prompt</span>
          <textarea data-region-prompt rows="3" placeholder="e.g. Change the background to a marble counter, keep lighting…"></textarea>
        </label>
        <label class="ref-region-field">
          <span>AI key</span>
          ${buildAiKeySelectHtml()}
        </label>
        <div class="ref-region-field" data-region-save-mode>
          <span>Save result as</span>
          <div class="ref-save-mode-toggle" role="group" aria-label="Save mode">
            <button type="button" class="dxf-viewer-btn ${imageEditSaveMode === "new" ? "active" : ""}" data-save-mode="new">New image</button>
            <button type="button" class="dxf-viewer-btn ${imageEditSaveMode === "replace" ? "active" : ""}" data-save-mode="replace">Replace current</button>
          </div>
          <small class="muted">Also available on the image toolbar. Change the default later in Preferences.</small>
        </div>
        <div class="ref-region-edit-actions">
          <button type="button" class="btn secondary" data-region-close>Cancel</button>
          <button type="button" class="btn primary" data-region-generate>Generate edit</button>
        </div>
        <p class="muted small ref-region-edit-status" data-region-status></p>
      </div>
    `;
    document.body.appendChild(modal);
    const promptEl = modal.querySelector("[data-region-prompt]");
    const statusEl = modal.querySelector("[data-region-status]");
    const keySelect = modal.querySelector("[data-region-ai-key]");
    promptEl?.focus();

    modal.querySelectorAll("[data-save-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setImageEditSaveMode(btn.dataset.saveMode, { persist: false });
        modal.querySelectorAll("[data-save-mode]").forEach((el) => {
          el.classList.toggle("active", el.dataset.saveMode === imageEditSaveMode);
        });
      });
    });
    keySelect?.addEventListener("change", () => {
      if (keySelect.value) setAiKeyPickerValue?.(keySelect.value);
    });

    const close = () => modal.remove();
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal || ev.target.closest("[data-region-close]")) close();
    });
    modal.querySelector("[data-region-generate]")?.addEventListener("click", async () => {
      const prompt = String(promptEl?.value || "").trim();
      if (!prompt) {
        statusEl.textContent = "Write a prompt describing the edit.";
        return;
      }
      const genBtn = modal.querySelector("[data-region-generate]");
      if (genBtn) genBtn.disabled = true;
      const saveMode = imageEditSaveMode === "replace" ? "replace" : "new";
      statusEl.textContent = saveMode === "replace"
        ? "Generating edit and replacing current image…"
        : "Generating edit as a new image…";
      try {
        if (keySelect?.value) setAiKeyPickerValue?.(keySelect.value);
        const fullDataUrl = await compositeMarkedImage(tab);
        let sourceImage = fullDataUrl;
        if (!sourceImage) {
          const img = await loadImageElement(tab.blobUrl);
          const c = document.createElement("canvas");
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          c.getContext("2d").drawImage(img, 0, 0);
          sourceImage = c.toDataURL("image/png");
        }
        let keyFields = getAiKeyBodyFields?.() || {};
        if (keySelect?.value && keySelect.value.includes(":")) {
          const [source, ...rest] = keySelect.value.split(":");
          const keyId = rest.join(":");
          if (source && keyId) keyFields = { ai_key_id: keyId, ai_key_source: source };
        }
        const body = {
          prompt,
          source_image: sourceImage,
          source_filename: tab.filename,
          region: { x: Math.round(x0), y: Math.round(y0), w, h },
          save_mode: saveMode,
          ...keyFields,
        };
        const data = await api(`/api/projects/${encodeURIComponent(tab.projectId)}/render-region-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }, 240000);
        close();
        await applyRenderEditResult(tab, data, saveMode);
      } catch (err) {
        statusEl.textContent = err.message || "Region edit failed.";
        if (genBtn) genBtn.disabled = false;
      }
    });
  }

  async function applyRenderEditResult(tab, data, choice) {
    const pid = tab.projectId;
    const filename = data?.filename;
    onRenderEdited?.({
      projectId: pid,
      filename,
      replace: choice === "replace",
      previousFilename: tab.filename,
    });
    if (filename) {
      revokeBlob(tab);
      await openTab(filename, {
        projectId: pid,
        label: String(filename).replace(/\.[^.]+$/, "") || "Image",
        kind: "image",
        forceReload: true,
      });
    }
    onStatus?.(
      "ok",
      choice === "replace"
        ? "Replaced current image. Toggle New/Replace on the toolbar anytime."
        : "Saved as a new image. Toggle New/Replace on the toolbar anytime.",
    );
  }

  viewerEl?.addEventListener("click", (e) => {
    const seekBtn = e.target.closest("[data-share-seek]");
    if (seekBtn && viewerEl.contains(seekBtn)) {
      const t = Number(seekBtn.getAttribute("data-share-seek"));
      if (Number.isFinite(t)) {
        e.preventDefault();
        audioPlayerApi?.seekTo?.(t);
        return;
      }
    }
    const closePane = e.target.closest("[data-ref-pane-close]");
    if (closePane) {
      e.preventDefault();
      e.stopPropagation();
      closeTab(closePane.dataset.refPaneClose);
      return;
    }
    const miniEditor = e.target.closest("[data-ref-mini-editor]");
    if (miniEditor) {
      e.preventDefault();
      e.stopPropagation();
      const name = miniEditor.dataset.refMiniEditor;
      const kind = kindFromName(name);
      onOpenVideoEditor?.({ filename: name, kind });
      return;
    }
    const miniOpen = e.target.closest("[data-ref-mini-open]");
    if (miniOpen) {
      e.preventDefault();
      void openInEditor(miniOpen.dataset.refMiniOpen, { newTab: !!(e.metaKey || e.ctrlKey) });
      return;
    }
    const codeOpen = e.target.closest("[data-ref-code-open]");
    if (codeOpen) {
      e.preventDefault();
      void openTab(codeOpen.dataset.refCodeOpen, {
        projectId: getProjectId?.(),
        kind: kindFromName(codeOpen.dataset.refCodeOpen),
      });
      return;
    }
    const pane = e.target.closest("[data-ref-pane]");
    if (pane?.dataset.refPane && pane.dataset.refPane !== activeFilename && tabs.has(pane.dataset.refPane)) {
      if (!e.target.closest("[data-ref-action], [data-ref-tool], [data-ref-download], a, video, audio, textarea, input, button, [data-ref-audio-player], [data-share-seek]")) {
        activate(pane.dataset.refPane);
        return;
      }
    }
    const saveModeBtn = e.target.closest("[data-ref-save-mode]");
    if (saveModeBtn) {
      setImageEditSaveMode(saveModeBtn.dataset.refSaveMode, { persist: true });
      onStatus?.(
        "ok",
        imageEditSaveMode === "replace"
          ? "AI edits will replace the current image."
          : "AI edits will save as a new image.",
      );
      return;
    }
    const tool = e.target.closest("[data-ref-tool]")?.dataset.refTool;
    if (tool) {
      setMarkupTool(tool);
      return;
    }
    const swatch = e.target.closest("[data-ref-swatch]")?.dataset.refSwatch;
    if (swatch) {
      markupColor = swatch;
      const colorInput = viewerEl.querySelector("[data-ref-color]");
      if (colorInput) colorInput.value = swatch;
      viewerEl.querySelectorAll("[data-ref-swatch]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.refSwatch === swatch);
      });
      return;
    }
    const downloadFmt = e.target.closest("[data-ref-download]")?.dataset.refDownload;
    if (downloadFmt) {
      e.preventDefault();
      void handleDownload(downloadFmt);
      return;
    }
    const action = e.target.closest("[data-ref-action]")?.dataset.refAction;
    if (!action) return;
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (action === "download-toggle") {
      const panel = viewerEl.querySelector("[data-ref-download-panel]");
      const toggle = viewerEl.querySelector('[data-ref-action="download-toggle"]');
      const open = panel?.classList.toggle("hidden") === false;
      toggle?.setAttribute("aria-expanded", String(!!open));
      return;
    }
    if (action === "save") {
      void saveActive();
      return;
    }
    if (action === "hide-notes") {
      notesHidden = true;
      const panel = viewerEl?.querySelector(".ref-notes-panel");
      if (panel) {
        panel.hidden = true;
        panel.classList.add("hidden");
      }
      return;
    }
    if (action === "mcm-md-toggle" && tab) {
      tab.partsListEdit = !tab.partsListEdit;
      renderViewer();
      return;
    }
    if (action === "json-view" && tab) {
      tab.jsonView = e.target.closest("[data-ref-json-view]")?.dataset.refJsonView || "code";
      renderViewer();
      return;
    }
    if (action === "csv-view" && tab) {
      tab.csvView = e.target.closest("[data-ref-csv-view]")?.dataset.refCsvView || "code";
      renderViewer();
      return;
    }
    if (action === "close" && activeFilename) {
      closeTab(activeFilename);
      return;
    }
    if (action === "undo") {
      if (!undoMarkup()) emitReferenceAction("viewport-undo", tab);
      return;
    }
    if (action === "redo") {
      if (!redoMarkup()) emitReferenceAction("viewport-redo", tab);
      return;
    }
    if (action === "clear-strokes" && tab) {
      pushStrokeHistory(tab);
      tab.strokes = [];
      markDirty(tab);
      redrawActiveMarkup();
      return;
    }
    if (action === "fit") resetView();
    if (action === "send-ai") {
      void sendActiveToPrompt();
      return;
    }
    if (action === "texture-model" && tab) {
      void (async () => {
        let textureDataUrl = tab.blobUrl || "";
        try {
          const canvas = await buildExportCanvas(tab, { withMarkup: true });
          const max = 2048;
          const srcW = canvas.width || 1;
          const srcH = canvas.height || 1;
          if (Math.max(srcW, srcH) > max) {
            const scale = max / Math.max(srcW, srcH);
            const out = document.createElement("canvas");
            out.width = Math.max(2, Math.round(srcW * scale));
            out.height = Math.max(2, Math.round(srcH * scale));
            out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
            textureDataUrl = out.toDataURL("image/png");
          } else {
            textureDataUrl = canvas.toDataURL("image/png");
          }
        } catch (_) { /* use blob url */ }
        emitReferenceAction("texture-model", tab, {
          textureDataUrl,
          wrapMode: "cover",
        });
      })();
      return;
    }
    if (action === "share-menu" && tab) {
      const btn = e.target.closest("[data-ref-action]");
      const rect = btn?.getBoundingClientRect?.() || { left: e.clientX, bottom: e.clientY };
      showReferenceContextMenu({ ...e, clientX: rect.left, clientY: rect.bottom + 6, preventDefault() {}, stopPropagation() {} }, tab);
      return;
    }
    if (action === "share-x" && tab) {
      void shareOpenVideoToX(tab);
      return;
    }
    if (action === "save-edited-video" && tab) {
      emitReferenceAction("save-edited-video", tab, {
        blob: tab.editedBlob || tab.blob,
      });
    }
  });

  viewerEl?.addEventListener("input", (e) => {
    if (e.target.matches?.("[data-ref-color]")) {
      markupColor = e.target.value || markupColor;
      return;
    }
    if (e.target.matches?.("[data-ref-width]")) {
      markupWidth = Math.max(1, Math.min(24, Number(e.target.value) || 3));
      const val = viewerEl.querySelector("[data-ref-width-val]");
      if (val) val.textContent = `${markupWidth}px`;
      return;
    }
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab) return;
    if (e.target.matches?.("[data-ref-code-search]")) {
      tab.codeQuery = e.target.value || "";
      const kind = tab.kind || kindFromName(tab.filename);
      if (kind === "json" && tab.jsonView === "tree") {
        const parsed = parseJsonSafe(tab.textContent || "");
        const host = viewerEl.querySelector("[data-ref-json-tree]");
        if (host) {
          host.innerHTML = parsed.ok
            ? (jsonTreeHtml(parsed.value, { query: tab.codeQuery }) || `<div class="ref-viewer-empty">No matches.</div>`)
            : `<div class="ref-viewer-empty">Could not parse JSON.</div>`;
        }
        return;
      }
      if (kind === "spreadsheet" || (kind === "csv" && tab.csvView === "table")) {
        const wrap = viewerEl.querySelector(".ref-sheet-wrap")?.parentElement || viewerEl.querySelector("[data-ref-code-root]");
        const rows = kind === "csv" ? parseCsvText(tab.textContent || "") : (tab.sheetRows || []);
        const html = tab.sheetError && kind === "spreadsheet"
          ? `<div class="ref-viewer-empty">${escapeHtml(tab.sheetError)}</div>`
          : spreadsheetTableHtml(rows, { query: tab.codeQuery });
        const existing = viewerEl.querySelector(".ref-sheet-wrap, .ref-viewer-empty");
        if (existing && wrap) {
          const chrome = wrap.querySelector(".ref-code-chrome");
          wrap.querySelectorAll(".ref-sheet-wrap, .ref-code-viewer > .ref-viewer-empty").forEach((el) => {
            if (!el.closest(".ref-code-chrome")) el.remove();
          });
          chrome?.insertAdjacentHTML("afterend", html);
        }
        return;
      }
      const highlightEl = viewerEl.querySelector("[data-ref-code-highlight]");
      const textEl = viewerEl.querySelector("[data-ref-text]");
      if (highlightEl && textEl) {
        highlightEl.innerHTML = `${highlightSource(textEl.value || "", {
          mode: highlightModeForKind(kind, tab.filename),
          query: tab.codeQuery,
        })}\n`;
      }
      return;
    }
    if (e.target.matches?.("[data-ref-notes], [data-ref-text]")) markDirty(tab);
  });

  document.addEventListener("keydown", (e) => {
    if (!activeFilename || !viewerEl || viewerEl.classList.contains("hidden")) return;
    const tab = tabs.get(activeFilename);
    if (!tab || !canMarkup(tab.kind)) return;
    const typing = isTypingTarget(e.target) || isTypingTarget(document.activeElement);

    if (isCanvasUndoShortcut(e)) {
      if (typing) return;
      if (undoMarkup()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (isCanvasRedoShortcut(e)) {
      if (typing) return;
      if (redoMarkup()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      return;
    }
    if (isCanvasEscapeToMove(e)) {
      if (typing && !textInputEl) return;
      e.preventDefault();
      e.stopPropagation();
      dismissImageTextInput();
      const selected = selectedStrokeIndex >= 0 ? tab.strokes?.[selectedStrokeIndex] : null;
      const textActive = markupTool === "text"
        || String(selected?.type || "") === "text"
        || !!textDrag
        || !!textInputEl;
      if (textActive) {
        exitTextToSelect({ keepSelected: true });
        return;
      }
      if (selectedStrokeIndex >= 0) {
        selectedStrokeIndex = -1;
        textDrag = null;
        redrawActiveMarkup();
      }
      return;
    }
    if (typing) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const key = String(e.key || "");
      const code = String(e.code || "");
      if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") {
        e.preventDefault();
        zoom = Math.min(8, zoom * 1.15);
        applyTransform();
        updateRegionOverlay();
        return;
      }
      if (key === "-" || key === "−" || code === "Minus" || code === "NumpadSubtract") {
        e.preventDefault();
        zoom = Math.max(0.2, zoom / 1.15);
        applyTransform();
        updateRegionOverlay();
        return;
      }
      if (key === "0" || code === "Digit0" || code === "Numpad0") {
        e.preventDefault();
        resetView();
        return;
      }
    }
    const canvasTool = canvasToolFromShortcutEvent(e);
    const imageTool = imageMarkupToolFromCanvasTool(canvasTool);
    if (imageTool === "note") {
      e.preventDefault();
      viewerEl.querySelector("[data-ref-notes]")?.focus();
      return;
    }
    if (imageTool) {
      e.preventDefault();
      setMarkupTool(imageTool);
    }
  }, true);

  viewerEl?.addEventListener(
    "wheel",
    (e) => {
      const tab = activeFilename ? tabs.get(activeFilename) : null;
      if (!tab || !canMarkup(tab.kind)) return;
      if (!e.target.closest?.(".ref-viewer-stage-wrap")) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0008);
      zoom = Math.min(8, Math.max(0.2, zoom * factor));
      applyTransform();
      updateRegionOverlay();
    },
    { passive: false },
  );

  viewerEl?.addEventListener("pointerdown", (e) => {
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    if (!tab || !canMarkup(tab.kind) || drawMode) return;
    if (!e.target.closest?.(".ref-viewer-stage-wrap")) return;
    e.preventDefault();
    panDrag = { x: e.clientX - panX, y: e.clientY - panY };
    e.target.setPointerCapture?.(e.pointerId);
  });
  viewerEl?.addEventListener("pointermove", (e) => {
    if (!panDrag) return;
    panX = e.clientX - panDrag.x;
    panY = e.clientY - panDrag.y;
    applyTransform();
    updateRegionOverlay();
  });
  viewerEl?.addEventListener("pointerup", () => {
    panDrag = null;
  });

  const stopViewerFileDrag = (e) => {
    if (!viewerEl || viewerEl.classList.contains("hidden")) return;
    if (!isMediaFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    viewerEl.classList.add("is-drop-target");
    // When the clip editor is mounted, do not stopPropagation — the timeline
    // needs dragover on the real target so drop still has files.
    if (!videoEditorApi) e.stopPropagation();
  };
  viewerEl?.addEventListener("dragenter", stopViewerFileDrag, true);
  viewerEl?.addEventListener("dragover", stopViewerFileDrag, true);
  viewerEl?.addEventListener("dragleave", (e) => {
    if (!viewerEl.contains(e.relatedTarget)) viewerEl.classList.remove("is-drop-target");
  }, true);
  viewerEl?.addEventListener("drop", (e) => {
    if (!viewerEl || viewerEl.classList.contains("hidden")) return;
    const files = filesFromDropEvent(e);
    if (!files.length && !isMediaFileDrag(e)) return;
    e.preventDefault();
    viewerEl.classList.remove("is-drop-target");
    if (videoEditorApi && files.length) {
      const media = files.filter((file) => {
        const kind = mediaKindFromFile(file);
        return kind === "audio" || kind === "video" || kind === "image";
      });
      if (media.length) {
        e.stopPropagation();
        videoEditorApi.ingestFiles(media, e);
        return;
      }
    }
    if (!files.length) return;
    e.stopPropagation();
    onStatus?.("loading", files.length === 1 ? `Opening ${files[0].name} in the image viewer…` : `Opening ${files.length} files in the image viewer…`);
    void Promise.resolve(onDropFiles?.(files)).catch((err) => {
      onStatus?.("error", err?.message || "Could not open that file in the viewer");
    });
  }, true);

  viewerEl?.addEventListener("contextmenu", (e) => {
    const miniItem = e.target.closest("[data-ref-mini-open]");
    if (miniItem) {
      e.preventDefault();
      e.stopPropagation();
      showMiniBrowserContextMenu(e, miniItem.dataset.refMiniOpen);
      return;
    }
    const tab = activeFilename ? tabs.get(activeFilename) : null;
    const kind = tab?.kind || kindFromName(tab?.filename);
    if (!tab || (kind !== "image" && kind !== "video")) return;
    if (!e.target.closest?.("[data-ref-image-stack], .ref-viewer-stage-wrap, .ref-video, .ref-video-editor-host")) return;
    showReferenceContextMenu(e, tab);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("#ref-image-context-menu")) closeReferenceContextMenu();
  });

  return {
    openTab,
    openFolderWorkspace: async ({ root, label, files = [], projectId, openPath } = {}) => {
      const pid = projectId || getProjectId?.();
      const folder = String(root || PROJECT_CODE_FOLDER).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      codeWorkspace = {
        root: folder,
        label: label || folder.split("/").pop() || PROJECT_CODE_FOLDER,
        tree: codeTreeFromEntries(files, folder),
      };
      const first = openPath || flattenCodeTree(codeWorkspace.tree)[0]?.path;
      if (first) {
        await openTab(first, { projectId: pid, kind: kindFromName(first) });
      } else {
        activeFilename = null;
        renderViewer();
      }
      return codeWorkspace;
    },
    closeTab,
    sendToPrompt: sendFilenameToPrompt,
    sendActiveToPrompt,
    activateFromShared(filename) {
      if (!tabs.has(filename)) return false;
      activate(filename, { syncShared: true });
      return true;
    },
    hideViewerOnly,
    showNotesPanel() {
      notesHidden = false;
      const panel = viewerEl?.querySelector(".ref-notes-panel");
      if (panel) {
        panel.hidden = false;
        panel.classList.remove("hidden");
        panel.querySelector("[data-ref-notes]")?.focus?.();
        return true;
      }
      if (activeFilename) {
        renderViewer();
        return true;
      }
      return false;
    },
    hideNotesPanel() {
      notesHidden = true;
      const panel = viewerEl?.querySelector(".ref-notes-panel");
      if (panel) {
        panel.hidden = true;
        panel.classList.add("hidden");
      }
    },
    isNotesPanelOpen: () => !notesHidden && !!activeFilename && !viewerEl?.classList.contains("hidden"),
    refreshBrowsable() {
      if (!activeFilename || !viewerEl || viewerEl.classList.contains("hidden")) return;
      // Never remount the timeline editor here — a file-list refresh after
      // persist/drop used to destroy the editor and wipe unsaved audio, then
      // re-save the recording as another unique VID copy.
      const list = viewerEl.querySelector(".ref-mini-browser:not(.ref-code-tree)");
      if (list && (videoEditorApi || tabs.get(activeFilename)?.kind === "video")) {
        const wrap = document.createElement("div");
        wrap.innerHTML = renderMiniBrowserHtml();
        const next = wrap.firstElementChild;
        if (next) list.replaceWith(next);
        void hydrateMiniBrowserThumbs();
        return;
      }
      renderViewer();
    },
    closeAll({ localOnly = false } = {}) {
      pauseOpenMedia();
      destroyVideoEditor();
      destroyAudioPlayer();
      revokeMcMasterThumbs();
      revokeMiniThumbs();
      for (const name of [...tabs.keys()]) {
        const tab = tabs.get(name);
        revokeBlob(tab);
        if (!localOnly) docTabs?.remove?.(name);
      }
      tabs.clear();
      splitFilenames = [];
      activeFilename = null;
      if (!docTabs || localOnly) {
        if (!docTabs) renderTabs();
      }
      setVisible(false);
      clearViewerHost();
      onActiveChange?.(null);
    },
    isActive: () => !!activeFilename && tabs.has(activeFilename),
    hasTabs: () => tabs.size > 0,
    getActiveFilename: () => activeFilename,
  };
}

export function isReferenceFilename(name = "") {
  return /\.(pdf|txt|md|markdown|csv|tsv|log|json|jsonc|ya?ml|html?|rtf|docx?|xlsx?|pptx?|png|jpe?g|webp|gif|bmp|svg|tiff?|heic|heif|webm|mp4|mov|m4v|mp3|wav|m4a|aac|ogg|opus|flac|aiff?|wma|weba|js|mjs|cjs|jsx|ts|tsx|py|css|scss|less|sh|bash|zsh|ino|c|cc|cpp|cxx|h|hpp|java|go|rs|rb|php|sql|toml|ini|cfg|xml)$/i.test(String(name || ""));
}

export function viewerAcceptsDroppedFile(file) {
  const name = String(file?.name || "");
  const type = String(file?.type || "").toLowerCase();
  if (isReferenceFilename(name)) return true;
  if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/") || type === "application/pdf" || type.startsWith("text/")) return true;
  return /\.(step|stp|stl|glb|gltf|3mf|dxf|obj|ply|off|mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
}

/** Virtual folders under Reference Files. Only shown when they contain files. */
export const REFERENCE_VIRTUAL_FOLDERS = [
  {
    id: "McMaster",
    label: "McMaster parts",
    match: (folder) => String(folder || "").toLowerCase() === "mcmaster",
  },
  {
    id: "Screen Recordings",
    label: "Screen Recordings",
    match: (folder) => {
      const lower = String(folder || "").toLowerCase();
      return lower === "recordings" || lower === "screen recordings";
    },
  },
  {
    id: "Video Editor",
    label: "Video Editor",
    match: (folder) => {
      const raw = String(folder || "");
      const lower = raw.toLowerCase();
      return lower === "video editor"
        || lower === "video-editor"
        || lower === "clip editor"
        || raw.startsWith("Video Editor/");
    },
  },
  {
    id: "Screenshots",
    label: "Screenshots",
    match: (folder) => String(folder || "").toLowerCase() === "screenshots",
  },
  {
    id: "AR",
    label: "AR captures",
    match: (folder) => String(folder || "").toLowerCase() === "ar",
  },
  {
    id: "Improve Lab",
    label: "Improve Lab",
    match: (folder) => {
      const raw = String(folder || "");
      return raw === "Improve Lab" || raw.startsWith("Improve Lab/");
    },
  },
  {
    id: "Electronics wiring",
    label: "Electronics wiring",
    match: (folder) => {
      const lower = String(folder || "").toLowerCase();
      return lower === "electronics wiring" || lower === "electronics" || lower === "electronics-wiring";
    },
  },
  {
    id: "Images",
    label: "Images",
    match: (folder) => {
      const lower = String(folder || "").toLowerCase();
      return lower === "images" || lower === "image renders";
    },
  },
  {
    id: "Videos",
    label: "Videos",
    match: (folder) => String(folder || "").toLowerCase() === "videos",
  },
  {
    id: "Documents",
    label: "Documents",
    match: (folder) => String(folder || "").toLowerCase() === "documents",
  },
  {
    id: "Canvas",
    label: "Canvas",
    match: (folder) => {
      const raw = String(folder || "");
      return raw === "Canvas" || raw.startsWith("Canvas/");
    },
  },
  {
    id: "Project Code",
    label: "Project code",
    match: (folder) => {
      const raw = String(folder || "");
      return raw === "Project Code" || raw.startsWith("Project Code/");
    },
  },
];

export function inferReferenceVirtualFolder(row = {}) {
  const folder = String(row?.folder || row?.parent_folder || "").trim();
  if (folder) {
    const meta = REFERENCE_VIRTUAL_FOLDERS.find((item) => item.match(folder) || item.id === folder);
    return meta?.id || folder;
  }
  const name = String(row?.name || row?.filename || row?.label || "");
  const lower = name.toLowerCase();
  if (/\.(md|markdown)$/i.test(name) && /electr|sourc|wiring|schematic|bom|datasheet/i.test(lower)) {
    return "Electronics wiring";
  }
  if (/\.(js|mjs|cjs|jsx|ts|tsx|py|css|scss|less|html?|json|jsonc|vue|svelte|ino|c|cc|cpp|h|hpp|java|go|rs|rb|php|sql|toml|sh|bash|zsh)$/i.test(name)) {
    return "Project Code";
  }
  if (/\.(webm|mp4|mov|m4v)$/i.test(name)) return "Videos";
  if (/\.(png|jpe?g|webp|gif|bmp|svg|tiff?|heic|heif)$/i.test(name)) return "Images";
  if (/\.(pdf|txt|md|csv|tsv|log|json|ya?ml|html?|rtf|docx?|xlsx?|pptx?|js|mjs|cjs|jsx|ts|tsx|py|css|scss|less|sh|ino|c|cpp|h|java|go|rs|xml)$/i.test(name)) return "Documents";
  return "";
}

export function filterBrowserEntriesByName(items = [], query = "") {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...(items || [])];
  const typeTok = /^(js|mjs|cjs|jsx|ts|tsx|py|json|jsonc|css|html|htm|md|png|jpe?g|webp|gif|svg|heic|heif|glb|gltf|stl|step|stp|pdf|txt|csv|xml|yml|yaml)$/i;
  const hit = (entry) => {
    const name = String(entry?.name || entry?.filename || entry?.label || entry?.stem || entry?.children_label || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
    const hay = [name, entry?.folder, entry?.kind, ext, entry?.label, entry?.stem].filter(Boolean).join(" ").toLowerCase();
    return tokens.every((tok) => {
      if (typeTok.test(tok)) return ext === tok || name.endsWith(`.${tok}`) || hay.includes(tok);
      return hay.includes(tok);
    });
  };
  return (items || []).map((entry) => {
    if (entry?.virtual_folder && Array.isArray(entry.children)) {
      const kids = filterBrowserEntriesByName(entry.children, query);
      if (hit(entry)) return { ...entry, children: kids.length ? kids : entry.children };
      if (kids.length) return { ...entry, children: kids };
      return null;
    }
    return hit(entry) ? entry : null;
  }).filter(Boolean);
}

export function nestReferenceFolderItems(items = []) {
  const list = [...(items || [])];
  const rest = [];
  const buckets = new Map(REFERENCE_VIRTUAL_FOLDERS.map((meta) => [meta.id, []]));
  for (const row of list) {
    if (row?.virtual_folder) {
      rest.push(row);
      continue;
    }
    const folder = inferReferenceVirtualFolder(row);
    const meta = REFERENCE_VIRTUAL_FOLDERS.find((item) => item.match(folder) || item.id === folder);
    if (meta) buckets.get(meta.id).push(row);
    else rest.push(row);
  }
  const out = [...rest];
  const alphaIds = new Set(["McMaster", "Electronics wiring", "Documents"]);
  for (const meta of REFERENCE_VIRTUAL_FOLDERS) {
    const rawKids = buckets.get(meta.id) || [];
    const kids = alphaIds.has(meta.id)
      ? [...rawKids].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }))
      : sortCaptureEntriesNewestFirst(rawKids);
    if (!kids.length) continue;
    const children = meta.id === "Improve Lab" ? nestImproveLabSessions(kids)
      : meta.id === "Canvas" ? nestNamedReferenceStores(kids, "Canvas")
      : meta.id === "Video Editor" ? nestNamedReferenceStores(kids, "Video Editor")
      : meta.id === "Project Code" ? nestNamedReferenceStores(kids, "Project Code")
      : kids.map((child) => ({
        ...child,
        label: child.label || child.name,
        parent_folder: meta.id,
      }));
    if (meta.id === "Video Editor" && !children.length) continue;
    out.push({
      id: `folder:${meta.id}`,
      name: meta.id,
      label: meta.label,
      children_label: meta.label,
      virtual_folder: true,
      folder: meta.id,
      default_collapsed: true,
      children,
    });
  }
  return nestScreenRecordingsUnderVideoEditor(out);
}

export function nestScreenRecordingsUnderVideoEditor(items = []) {
  const list = Array.isArray(items) ? [...items] : [];
  const ve = list.find((row) => row?.id === "folder:Video Editor" || row?.name === "Video Editor");
  const recIdx = list.findIndex((row) => row?.id === "folder:Screen Recordings" || row?.name === "Screen Recordings");
  if (!ve || recIdx < 0) return list;
  const rec = list[recIdx];
  const already = (ve.children || []).some((child) => child?.id === "folder:Screen Recordings" || child?.name === "Screen Recordings");
  if (!already) {
    ve.children = [...(ve.children || []), { ...rec, parent_folder: "Video Editor" }];
  }
  return list.filter((_, i) => i !== recIdx);
}

export function isVideoEditorHubFolder(entry) {
  return !!(entry?.virtual_folder && (
    entry.id === "folder:Video Editor"
    || entry.folder === "Video Editor"
    || entry.name === "Video Editor"
  ));
}

export function isVideoEditorBrowserFolder(entry = {}) {
  if (!entry?.virtual_folder) return false;
  if (isVideoEditorHubFolder(entry)) return true;
  const id = String(entry.id || "");
  const folder = String(entry.folder || entry.parent_folder || "").replace(/\\/g, "/");
  const name = String(entry.name || entry.label || entry.children_label || "");
  if (id === "folder:Screen Recordings" || id === "folder:Videos") return true;
  if (/^(video editor)(\/|$)/i.test(folder) || /^video editor$/i.test(name)) return true;
  if (/^(screen recordings|recordings)$/i.test(folder) || /^(screen recordings|recordings)$/i.test(name)) return true;
  if (/viewport clip/i.test(folder) || /^viewport clip$/i.test(name)) return true;
  return false;
}

export function entryLooksLikeVideoFile(entry = {}) {
  if (!entry || entry.virtual_folder) return false;
  if (String(entry.kind || "").toLowerCase() === "video") return true;
  const mime = String(entry.mime || entry.type || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  const leaf = String(entry.name || entry.filename || entry.url || entry.source_path || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "";
  return /\.(webm|mp4|mov|m4v)$/i.test(leaf);
}

export function entryOpensInVideoEditor(entry = {}) {
  return isVideoEditorBrowserFolder(entry) || entryLooksLikeVideoFile(entry);
}

export function videoEditorActionEntry(entry = {}) {
  if (!entry?.virtual_folder) return entry;
  const folder = String(entry.folder || "").replace(/\\/g, "/");
  if (/^Video Editor\/.+/i.test(folder) && !/(^|\/)(screen recordings|recordings)$/i.test(folder)) {
    return entry;
  }
  return firstVideoInReferenceFolder(entry) || entry;
}

export function firstVideoInReferenceFolder(folder) {
  for (const child of folder?.children || []) {
    if (child?.virtual_folder) {
      const nested = firstVideoInReferenceFolder(child);
      if (nested) return nested;
      continue;
    }
    if (/\.(webm|mp4|mov|m4v)$/i.test(String(child?.name || child?.filename || ""))) return child;
  }
  return null;
}

export function videoEditorHubItems(folder) {
  const out = [];
  const seen = new Set();
  const fileKey = (entry) => String(entry?.filename || entry?.name || entry?.id || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase();
  const push = (row) => {
    const key = fileKey(row?.entry) || String(row?.id || "").toLowerCase();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(row);
  };
  const walk = (node, group = "") => {
    for (const child of node?.children || []) {
      if (child?.virtual_folder && (child.name === "Screen Recordings" || child.id === "folder:Screen Recordings")) {
        walk(child, "Screen Recordings");
        continue;
      }
      if (child?.virtual_folder) {
        const mediaEntry = firstVideoInReferenceFolder(child);
        push({
          id: child.id || child.name,
          label: child.label || child.name,
          group: group || "Projects",
          entry: child,
          mediaEntry,
          folder: child,
        });
        continue;
      }
      if (/\.(webm|mp4|mov|m4v)$/i.test(String(child?.name || child?.filename || ""))) {
        push({
          id: child.id || child.name,
          label: child.label || child.name,
          group: group || "Clips",
          entry: child,
        });
      }
    }
  };
  walk(folder);
  return out;
}

function nestImproveLabSessions(kids = []) {
  const bySession = new Map();
  const loose = [];
  for (const child of kids) {
    const folder = String(child.folder || "");
    const parts = folder.split("/").filter(Boolean);
    const session = parts[1] || "";
    if (!session) {
      loose.push({ ...child, label: child.label || child.name, parent_folder: "Improve Lab" });
      continue;
    }
    if (!bySession.has(session)) bySession.set(session, []);
    bySession.get(session).push({
      ...child,
      label: child.label || child.name,
      parent_folder: `Improve Lab/${session}`,
    });
  }
  const sessions = [...bySession.entries()].map(([session, children]) => ({
    id: `folder:Improve Lab/${session}`,
    name: session,
    label: `Run ${session}`,
    children_label: session,
    virtual_folder: true,
    folder: `Improve Lab/${session}`,
    default_collapsed: true,
    children,
  }));
  return [...loose, ...sessions];
}

function nestCanvasStores(kids = []) {
  return nestNamedReferenceStores(kids, "Canvas");
}

function nestNamedReferenceStores(kids = [], parentId = "Canvas") {
  const byStore = new Map();
  const loose = [];
  for (const child of kids) {
    const folder = String(child.folder || "");
    const parts = folder.split("/").filter(Boolean);
    const store = parts[1] || "";
    if (!store) {
      if (parentId === "Video Editor" && /\.(webm|mp4|mov|m4v)$/i.test(String(child.name || ""))) {
        continue;
      }
      loose.push({ ...child, label: child.label || child.name, parent_folder: parentId });
      continue;
    }
    if (!byStore.has(store)) byStore.set(store, []);
    byStore.get(store).push({
      ...child,
      label: child.label || child.name,
      parent_folder: `${parentId}/${store}`,
    });
  }
  const stores = [...byStore.entries()].map(([store, children]) => ({
    id: `folder:${parentId}/${store}`,
    name: store,
    label: store,
    children_label: store,
    virtual_folder: true,
    folder: `${parentId}/${store}`,
    default_collapsed: true,
    children: [...children]
      .filter((child) => String(child.name || "").toLowerCase() !== "editor.json")
      .sort((a, b) => (Number(b.mtime) || 0) - (Number(a.mtime) || 0)),
  }));
  stores.sort((a, b) => {
    const am = Math.max(0, ...a.children.map((c) => Number(c.mtime) || 0));
    const bm = Math.max(0, ...b.children.map((c) => Number(c.mtime) || 0));
    return bm - am;
  });
  return [...loose, ...stores];
}

export const REFERENCE_FILES_GRID_CLASS = "refs-files-grid";
export const REFERENCE_FILES_PANE = "references";

export function isReferenceVirtualFolder(entry) {
  return !!(entry?.virtual_folder && Array.isArray(entry.children));
}

export function referenceFolderKey(projectId, entry = {}) {
  const folder = String(entry.folder || entry.id || entry.name || "folder").replace(/\\/g, "/");
  return `ref-folder:${projectId || ""}:${folder}`;
}

export function isReferenceFolderOpen(expandedSet, key, { defaultOpen = false } = {}) {
  if (!key) return !!defaultOpen;
  if (expandedSet?.has?.(key)) return true;
  return !!defaultOpen;
}

export function referenceEntryMtimeMs(entry) {
  if (!entry) return 0;
  if (isReferenceVirtualFolder(entry)) {
    return Math.max(0, ...(entry.children || []).map((child) => referenceEntryMtimeMs(child)));
  }
  const captured = captureSortMs(entry);
  if (captured) return captured;
  const parsed = Date.parse(entry.updated_at || entry.created_at || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortReferenceEntries(items = [], direction = "newest") {
  const newestFirst = String(direction || "newest").toLowerCase() !== "oldest";
  const list = [...(items || [])].map((entry) => {
    if (isReferenceVirtualFolder(entry)) {
      return { ...entry, children: sortReferenceEntries(entry.children, newestFirst ? "newest" : "oldest") };
    }
    return entry;
  });
  list.sort((a, b) => {
    const folderBias = Number(!!b?.virtual_folder) - Number(!!a?.virtual_folder);
    if (folderBias) return folderBias;
    const delta = referenceEntryMtimeMs(b) - referenceEntryMtimeMs(a);
    if (delta) return newestFirst ? delta : -delta;
    return String(a?.label || a?.name || "").localeCompare(String(b?.label || b?.name || ""), undefined, { sensitivity: "base" });
  });
  return list;
}

export function formatReferenceTimestamp(entry) {
  if (!entry) return "";
  const labeled = formatEntryCapturedAt(entry);
  if (labeled) return labeled;
  const ms = referenceEntryMtimeMs(entry);
  if (!ms) return "";
  return formatEntryCapturedAt({ mtime: ms > 1e12 ? ms : ms / 1000 });
}

export function collectProjectReferenceItems(browser = {}) {
  return nestReferenceFolderItems([
    ...(browser.drawings || []),
    ...(browser.references || []),
  ]);
}
