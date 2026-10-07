// Compact drawing semantics travel with the raster, including through prompt history.
export function isCanvasReference(image = {}) {
  if (image.role === "canvas" || image.drawing_metadata?.kind === "canvas") return true;
  const names = [image.name, image.source_filename, image.filename, image.url, image.folder];
  return names.some((name) => /canvas[-_\s]?(?:sketch|draw)|whiteboard|layout[-_\s]?sketch|(?:^|[\/\\])Canvas[\/\\]|^Canvas(?:[ -]|$)/i.test(String(name || "")));
}

const FOLDER_IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|svg|tiff?)$/i;

function flattenBrowserEntries(entry, out = []) {
  if (!entry) return out;
  if (entry.virtual_folder && Array.isArray(entry.children)) {
    for (const child of entry.children) flattenBrowserEntries(child, out);
    return out;
  }
  out.push(entry);
  return out;
}

export function canvasBoardReference(entry = {}) {
  let path = String(entry.source_filename || entry.filename || entry.name || "");
  if (entry.url && /(?:^|\/)Canvas\//i.test(entry.url)) path = entry.url;
  if (/^canvas\.json$/i.test(path) && entry.folder) path = `${entry.folder}/${path}`;
  try { path = decodeURIComponent(path); } catch { /* keep literal path */ }
  const match = path.replace(/\\/g, "/").match(/(?:^|\/)Canvas\/([^/]+)\/canvas\.json$/i);
  return match ? { name: match[1], filename: `references/Canvas/${match[1]}/canvas.json` } : null;
}

export function canvasBoardFromBrowserEntry(entry = {}) {
  const direct = canvasBoardReference(entry);
  if (direct) return direct;
  const folder = String(entry.folder || "").replace(/\\/g, "/");
  if (entry.virtual_folder) {
    const store = folder.match(/^Canvas\/([^/]+)$/i);
    if (store) return { name: store[1], filename: `references/Canvas/${store[1]}/canvas.json` };
    if (/^Canvas$/i.test(folder || entry.name || "")) {
      const stores = (entry.children || []).filter((child) => child?.virtual_folder);
      if (stores.length === 1) return canvasBoardFromBrowserEntry(stores[0]);
      const json = flattenBrowserEntries(entry).find((row) => /canvas\.json$/i.test(String(row.name || row.filename || "")));
      if (json) return canvasBoardReference({ ...json, folder: json.folder || json.parent_folder || folder });
    }
  }
  return null;
}

export function editableCanvasBoard(entry = {}) {
  const board = canvasBoardFromBrowserEntry(entry);
  if (!board) return null;
  if (entry.virtual_folder) {
    const folder = String(entry.folder || "").replace(/\\/g, "/");
    if (!/^Canvas\/[^/]+$/i.test(folder)) return null;
  }
  return board;
}

export function pickBrowserFolderImage(entry = {}) {
  const files = flattenBrowserEntries(entry);
  const images = files.filter((row) => FOLDER_IMAGE_RE.test(String(row.name || row.filename || "")));
  if (!images.length) return null;
  const scored = images.map((row) => {
    const name = String(row.name || row.filename || "").split("/").pop().toLowerCase();
    let score = Number(row.mtime) || 0;
    if (/^(canvas|preview|board|export)(?:[-_.]|\.png$)/i.test(name) || name === "canvas.png" || name === "preview.png") {
      score += 1e15;
    }
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].row;
}

export function buildCanvasDrawingMetadata({ title = "Canvas", description = "", elements = [], width = 1, height = 1 } = {}) {
  const round = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const point = (p) => ({ x: round(p.x), y: round(p.y) });
  const nodes = elements.slice(0, 300).map((el) => {
    const node = { id: String(el.id || ""), type: String(el.type || "shape") };
    for (const key of ["text", "tag", "parentId", "fromId", "toId", "fromPort", "toPort", "sourceFilename", "relation", "imageName", "linkName", "interestKind", "viewName", "action", "direction", "interestPrompt", "interestMode", "promptToken", "promptKind"]) {
      if (el[key]) node[key] = String(el[key]).slice(0, key === "interestPrompt" ? 2000 : 1000);
    }
    if (Array.isArray(el.memberIds) && el.memberIds.length) {
      node.memberIds = el.memberIds.map((id) => String(id || "")).filter(Boolean).slice(0, 48);
    }
    if (el.finalExample || el.finalLook || el.finishedExample) node.finalExample = true;
    if (Number.isFinite(Number(el.linkNumber)) && Number(el.linkNumber) > 0) {
      node.linkNumber = Math.round(Number(el.linkNumber));
    }
    if (Number.isFinite(Number(el.interestNumber)) && Number(el.interestNumber) > 0) {
      node.interestNumber = Math.round(Number(el.interestNumber));
    }
    if (Number.isFinite(Number(el.promptNumber)) && Number(el.promptNumber) > 0) {
      node.promptNumber = Math.round(Number(el.promptNumber));
    }
    if (el.bounds) node.bounds = Object.fromEntries(["x", "y", "w", "h"].map((k) => [k, round(el.bounds[k])]));
    if (Number.isFinite(el.x1)) node.start = point({ x: el.x1, y: el.y1 });
    if (Number.isFinite(el.x2)) node.end = point({ x: el.x2, y: el.y2 });
    if (el.points?.length) {
      const step = Math.max(1, Math.ceil(el.points.length / 24));
      node.points = el.points.filter((_, i) => i % step === 0 || i === el.points.length - 1).map(point);
    }
    return node;
  });
  const desc = String(description || "").trim().slice(0, 4000);
  const links = nodes
    .filter((el) => el.type === "link" || el.type === "group-link")
    .sort((a, b) => (a.linkNumber || 0) - (b.linkNumber || 0));
  const interests = collectCanvasInterests(nodes);
  return {
    kind: "canvas",
    version: 2,
    title,
    description: desc,
    width,
    height,
    coordinate_system: "Drawing pixels: x right, y down. Not CAD millimetres; only written dimensions set scale.",
    elements: nodes,
    links,
    interests,
    total_elements: elements.length,
    truncated: elements.length > nodes.length,
  };
}

export function canvasInterestKind(el = {}) {
  if (el?.interestKind) return String(el.interestKind);
  if (el?.type === "view-mark") return "view";
  if (el?.type === "edge-mark") return "edge";
  if (el?.type === "split-mark") return "split";
  if (el?.type === "face-mark") return "face";
  return "";
}

export function canvasInterestTitle(el = {}) {
  const kind = canvasInterestKind(el);
  const n = Number(el.interestNumber) || "";
  if (kind === "view") return `View ${el.viewName || el.tag || n}`.trim();
  if (kind === "edge") return `Edge of interest #${n || ""}`.trim();
  if (kind === "split") return `Split #${n || ""}`.trim();
  if (kind === "face") return `Face of interest #${n || ""}`.trim();
  return String(el.tag || "Tagged shape");
}

export function collectCanvasInterests(elements = []) {
  return (Array.isArray(elements) ? elements : [])
    .filter((el) => canvasInterestKind(el))
    .slice()
    .sort((a, b) => (Number(a.interestNumber) || 0) - (Number(b.interestNumber) || 0));
}

export function formatCanvasInterestLine(el = {}) {
  const kind = canvasInterestKind(el);
  if (!kind) return "";
  const title = canvasInterestTitle(el);
  const view = String(el.viewName || "").trim();
  const action = String(el.action || "").trim();
  const direction = String(el.direction || "").trim();
  const prompt = String(el.interestPrompt || "").trim();
  const bits = [];
  if (view && kind !== "view") bits.push(`${view} view`);
  if (action) bits.push(action);
  if (direction) bits.push(direction);
  const detail = bits.length ? ` (${bits.join(", ")})` : "";
  const instruction = prompt ? `: ${prompt}` : "";
  const hint = kind === "view"
    ? " This drawing is that camera view of the part."
    : " This mark is the selected face/edge/region to edit — not a new box solid.";
  return `${title}${detail}${instruction}.${hint}`;
}

export function canvasImageDisplayName(el = {}, fallback = "") {
  const named = String(el?.imageName || el?.label || el?.tag || "").trim();
  if (named) return named;
  const src = String(el?.sourceFilename || el?.source_filename || "").split(/[\\/]/).pop() || "";
  if (src) return src.replace(/\.[^.]+$/, "") || src;
  return String(fallback || "").trim();
}

export function canvasPromptStem(name) {
  return String(name || "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "node";
}

export function canvasPromptMentionToken(name) {
  return `@${canvasPromptStem(name || "image")}`;
}

export function canvasPromptHashToken(name) {
  return `#${canvasPromptStem(name || "piece")}`;
}

export function isCanvasGroupLink(el = {}) {
  return el?.type === "group-link" || (el?.type === "link" && Array.isArray(el.memberIds) && el.memberIds.length >= 2);
}

export function canvasNodeCaption(el = {}, fallback = "") {
  if (!el) return String(fallback || "").trim();
  if (el.type === "image") return canvasImageDisplayName(el, fallback);
  const named = String(el.linkName || el.tag || el.imageName || el.text || el.label || "").trim();
  if (named) return named;
  if (isCanvasGroupLink(el)) return `link-${el.linkNumber || "group"}`;
  return String(fallback || el.type || "").trim();
}

export function canvasMentionAliases(el = {}) {
  const stem = canvasPromptStem(canvasNodeCaption(el, el.id || "node"));
  return [`@${stem}`, `#${stem}`];
}

const CANVAS_BOX_TYPES = new Set([
  "rect", "roundrect", "circle", "oval", "diamond", "parallelogram",
  "triangle", "hexagon", "cloud", "callout", "note", "text",
]);

function escapeCanvasRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canvasPromptSlug(name, fallback = "node") {
  return canvasPromptStem(name || fallback).toLowerCase();
}

export function canvasPromptKind(el = {}) {
  const interest = canvasInterestKind(el);
  if (interest) return interest;
  const type = String(el?.type || "");
  if (type === "image") return "image";
  if (type === "arrow") return "arrow";
  if (type === "line" || type === "pen") return "line";
  if (type === "link" || type === "group-link") return "link";
  if (CANVAS_BOX_TYPES.has(type) || !type) return "box";
  return canvasPromptSlug(type, "box");
}

export function canvasPromptToken(el = {}) {
  if (el?.promptToken) return String(el.promptToken);
  const kind = canvasPromptKind(el);
  if (kind === "link") {
    const n = Number(el.linkNumber || el.promptNumber) || 0;
    return n ? `#${n}` : canvasPromptHashToken(canvasNodeCaption(el, "link"));
  }
  if (kind === "image") {
    const slug = canvasPromptSlug(canvasImageDisplayName(el, ""), "").replace(/^image-/, "");
    if (slug) return `@image-${slug}`;
  }
  if (kind === "view") {
    const name = String(el.viewName || el.tag || "").replace(/ view$/i, "").trim();
    const slug = canvasPromptSlug(name, "");
    if (slug) return `@${/view$/i.test(slug) ? slug : `${slug}-view`}`;
  }
  const n = Number(el.promptNumber) || 1;
  return `@${kind}${n}`;
}

export function canvasPromptMentionPhrase(el = {}) {
  const kind = el.promptKind || canvasPromptKind(el);
  return `${kind}: ${canvasPromptToken(el)}`;
}

function nextCanvasPromptNumber(kind, elements, el) {
  let max = 0;
  for (const other of elements || []) {
    if (!other || other === el || other.id === el.id) continue;
    if ((other.promptKind || canvasPromptKind(other)) !== kind) continue;
    const n = Number(other.promptNumber) || 0;
    if (n > max) max = n;
  }
  return max + 1;
}

export function assignCanvasPromptToken(el, elements = []) {
  if (!el) return el;
  const kind = canvasPromptKind(el);
  el.promptKind = kind;
  if (kind === "link") {
    if (!(Number(el.linkNumber) > 0)) el.linkNumber = nextCanvasPromptNumber("link", elements, el);
    el.promptNumber = Math.round(Number(el.linkNumber));
    el.promptToken = `#${el.promptNumber}`;
    return el;
  }
  if (el.promptToken && Number(el.promptNumber) > 0) return el;
  if (!(Number(el.promptNumber) > 0)) el.promptNumber = nextCanvasPromptNumber(kind, elements, el);
  const taken = new Set();
  for (const other of elements || []) {
    if (!other || other === el || other.id === el.id || !other.promptToken) continue;
    taken.add(String(other.promptToken).toLowerCase());
  }
  let token = canvasPromptToken({ ...el, promptToken: "" });
  if (taken.has(token.toLowerCase())) {
    let n = Number(el.promptNumber) || 1;
    token = `@${kind}${n}`;
    while (taken.has(token.toLowerCase())) {
      n += 1;
      token = `@${kind}${n}`;
    }
    el.promptNumber = n;
  }
  el.promptToken = token;
  return el;
}

export function canvasRegionPromptReference(el, { projectId = "project", boardName = "Canvas", elements = [] } = {}) {
  if (!el?.id) return null;
  const kind = el.promptKind || canvasPromptKind(el);
  const token = el.promptToken || canvasPromptToken(el);
  const parent = (elements || []).find((row) => row?.id && row.id === el.parentId) || null;
  const type = kind === "image" ? "image"
    : kind === "link" ? "link"
    : kind === "face" ? "face"
    : "sketch";
  return {
    id: `canvas-region:${projectId || "project"}:${el.id}`,
    type,
    token,
    label: token,
    stem: String(token).replace(/^[@#]/, ""),
    projectId,
    canvas_element_id: el.id,
    canvas_board: boardName,
    parent_id: el.parentId || undefined,
    parent_token: parent
      ? (parent.promptToken || (parent.type === "image"
        ? canvasPromptMentionToken(canvasImageDisplayName(parent, "image"))
        : ""))
      : undefined,
  };
}

function attachCanvasMentionToSpeech(text, el, token) {
  const kind = el.promptKind || canvasPromptKind(el);
  const candidates = [];
  const tag = String(el.tag || el.imageName || "").trim();
  if (tag) candidates.push(tag);
  if (kind === "box") {
    candidates.push("the highlighted box", "highlighted box", "this box", "the box");
  }
  if (kind === "view") {
    const view = String(el.viewName || "").replace(/ view$/i, "").trim();
    if (view) candidates.push(`${view} view`, `${view} View`, view);
  }
  if (kind === "face") candidates.push("face of interest", "this face", "the face");
  if (kind === "image") {
    const name = canvasImageDisplayName(el, "");
    if (name) candidates.push(name);
  }
  candidates.sort((a, b) => b.length - a.length);
  const next = String(text || "");
  for (const phrase of candidates) {
    if (!phrase) continue;
    const re = new RegExp(`(${escapeCanvasRegExp(phrase)})(?!\\s*:\\s*[@#])`, "i");
    if (re.test(next)) return next.replace(re, `$1: ${token}`);
  }
  return "";
}

export function formatCanvasPromptMentions(text, elements = []) {
  let next = String(text || "");
  const regions = (elements || []).filter((el) => el?.promptToken);
  for (const el of regions) {
    const kind = el.promptKind || canvasPromptKind(el);
    const token = String(el.promptToken);
    const phrase = `${kind}: ${token}`;
    if (kind === "link") {
      const n = Number(el.linkNumber || el.promptNumber) || 0;
      if (n && (next.includes(phrase) || next.includes(`Link #${n}`))) continue;
      if (n && !next.includes(`#${n}`)) next = `${next}${next && !/\s$/.test(next) ? " " : ""}${phrase}`;
      continue;
    }
    const tokenRe = new RegExp(`(?<![A-Za-z0-9_-])${escapeCanvasRegExp(token)}(?![A-Za-z0-9_-])`, "g");
    next = next.replaceAll(phrase, " ");
    next = next.replace(tokenRe, " ");
    next = next.replace(/[^\S\n]{2,}/g, " ");
    const attached = attachCanvasMentionToSpeech(next, el, token);
    next = attached || `${next.trimEnd()}${String(next).trim() ? " " : ""}${phrase}`;
  }
  return next.replace(/[^\S\n]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

export function collectCanvasImageMentions(elements = [], { projectId = "project", boardName = "Canvas" } = {}) {
  const out = [];
  const seen = new Set();
  for (const el of elements || []) {
    if (el?.type !== "image") continue;
    const name = canvasImageDisplayName(el, el.id || "image");
    if (!name) continue;
    const token = canvasPromptMentionToken(name);
    const id = `canvas-image:${projectId || "project"}:${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      token,
      label: name,
      detail: "canvas image",
      type: "image",
      filename: el.sourceFilename || `${name}.png`,
      stem: name,
      elementId: el.id,
      dataUrl: el.dataUrl || "",
      boardName,
    });
  }
  return out;
}

export function collectCanvasNodeMentions(elements = [], { projectId = "project", boardName = "Canvas" } = {}) {
  const out = [];
  const seenIds = new Set();
  const seenTokens = new Set();
  const push = (item) => {
    if (!item?.id || !item.token) return;
    const tokenKey = String(item.token).toLowerCase();
    if (seenIds.has(item.id) || seenTokens.has(tokenKey)) return;
    seenIds.add(item.id);
    seenTokens.add(tokenKey);
    out.push(item);
  };
  for (const el of elements || []) {
    if (!el?.promptToken) continue;
    const kind = el.promptKind || canvasPromptKind(el);
    const image = el.type === "image";
    push({
      id: image ? `canvas-image:${projectId || "project"}:${el.id}` : `canvas-region:${projectId || "project"}:${el.id}`,
      token: el.promptToken,
      label: canvasPromptMentionPhrase(el),
      detail: `${kind} on canvas`,
      type: image ? "image" : (kind === "face" ? "face" : kind === "link" ? "link" : "sketch"),
      filename: el.sourceFilename || undefined,
      stem: String(el.promptToken).replace(/^[@#]/, ""),
      elementId: el.id,
      dataUrl: el.dataUrl || "",
      boardName,
    });
  }
  for (const item of collectCanvasImageMentions(elements, { projectId, boardName })) {
    push(item);
  }
  for (const el of elements || []) {
    if (!el || el.type === "image" || el.type === "pen") continue;
    if (el.type === "link" && !isCanvasGroupLink(el)) continue;
    const caption = canvasNodeCaption(el, "");
    if (!caption && !isCanvasGroupLink(el)) continue;
    const token = canvasPromptHashToken(caption || el.linkName || `link-${el.linkNumber || "group"}`);
    push({
      id: `canvas-node:${projectId || "project"}:${el.id}`,
      token,
      label: caption || token,
      detail: isCanvasGroupLink(el) ? "canvas link" : "canvas shape",
      type: isCanvasGroupLink(el) ? "link" : "sketch",
      stem: canvasPromptStem(caption || token),
      elementId: el.id,
      boardName,
      hash: true,
    });
  }
  return out;
}

export function slugifyCanvasImageName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function canvasMentionToken(id) {
  return `@{${String(id || "")}}`;
}

export const CANVAS_MENTION_RE = /@\{([^}]+)\}/g;

export function expandCanvasMentionText(text, elements = []) {
  const byId = new Map((elements || []).map((el) => [el.id, el]));
  return String(text || "").replace(CANVAS_MENTION_RE, (_, id) => {
    const name = canvasImageDisplayName(byId.get(id), "");
    return name ? `@${name}` : "@image";
  });
}

export function canvasLinkMentionNodes(link = {}, elements = []) {
  const byId = new Map((elements || []).map((el) => [el.id, el]));
  const seen = new Set();
  const out = [];
  const add = (el) => {
    if (!el || seen.has(el.id)) return;
    seen.add(el.id);
    out.push(el);
  };
  const addWithParent = (id) => {
    const el = byId.get(id);
    if (!el) return;
    add(el);
    if (el.parentId) add(byId.get(el.parentId));
  };
  addWithParent(link.fromId);
  addWithParent(link.toId);
  for (const id of link.memberIds || []) addWithParent(id);
  return out;
}

export function canvasPromptBoardKey(image = {}) {
  const board = canvasBoardReference(image);
  if (board?.filename) return board.filename.replace(/\\/g, "/").toLowerCase();
  return String(image.source_filename || image.filename || "").replace(/\\/g, "/").toLowerCase();
}

export function mergeCanvasPromptImages(existing, entry, { limit = 8 } = {}) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  if (!entry) return list;
  const key = canvasPromptBoardKey(entry);
  const next = key
    ? list.filter((img) => canvasPromptBoardKey(img) !== key)
    : list.slice();
  if (next.length >= limit) {
    throw new Error(`The prompt already has ${limit} images. Remove one to attach this canvas.`);
  }
  next.push(entry);
  return next;
}

export const CANVAS_FINAL_LOOK_TIP = "This is what you want the end result to look like.";

export function isCanvasFinalExample(el = {}) {
  if (!el || el.type !== "image") return false;
  if (el.finalExample || el.finalLook || el.finishedExample) return true;
  const role = String(el.role || el.kind || "").toLowerCase();
  return /(?:final[-_ ]?(?:example|look)|finished[-_ ]?example)/.test(role);
}

function canvasGraphImage(el) {
  if (!el || el.type !== "image") return null;
  return {
    id: el.id,
    name: canvasImageDisplayName(el, ""),
    tag: String(el.tag || ""),
    imageName: String(el.imageName || ""),
    sourceFilename: String(el.sourceFilename || el.source_filename || ""),
    dataUrl: el.dataUrl || "",
    finalExample: isCanvasFinalExample(el),
  };
}

export function canvasPromptGraph(elements = [], { boardName = "Canvas", description = "" } = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const byId = new Map(list.map((el) => [el.id, el]));
  const images = list.filter((el) => el?.type === "image");
  const links = list
    .filter((el) => el?.type === "link" || el?.type === "group-link")
    .slice()
    .sort((a, b) => (Number(a.linkNumber) || 0) - (Number(b.linkNumber) || 0));
  const finals = images.filter(isCanvasFinalExample);
  const finalExample = finals[0] || null;
  const connectedIds = new Set();
  const walk = (id) => {
    if (!id || connectedIds.has(id)) return;
    const el = byId.get(id);
    if (!el) return;
    connectedIds.add(id);
    if (el.parentId) walk(el.parentId);
    for (const other of list) {
      if (other.parentId === id) walk(other.id);
    }
    for (const link of links) {
      if (link.fromId === id) walk(link.toId);
      if (link.toId === id) walk(link.fromId);
    }
  };
  for (const link of links) {
    walk(link.fromId);
    walk(link.toId);
    for (const id of link.memberIds || []) walk(id);
    for (const node of canvasLinkMentionNodes(link, list)) walk(node.id);
  }
  if (finalExample) walk(finalExample.id);
  const linkedImages = images
    .filter((el) => (connectedIds.has(el.id) || connectedIds.has(el.parentId)) && !isCanvasFinalExample(el))
    .map(canvasGraphImage);
  const graphLinks = links.map((link) => {
    const members = canvasLinkMentionNodes(link, list);
    return {
      id: link.id,
      kind: isCanvasGroupLink(link) ? "group-link" : "link",
      linkNumber: Number(link.linkNumber) || 0,
      linkName: String(link.linkName || "").trim(),
      memberIds: (link.memberIds || members.map((el) => el.id)).filter(Boolean),
      members: members.map((el) => ({
        id: el.id,
        name: canvasNodeCaption(el, el.type),
        token: el.type === "image" ? canvasPromptMentionToken(canvasNodeCaption(el, "image")) : canvasPromptHashToken(canvasNodeCaption(el, el.type)),
      })),
      fromId: link.fromId || null,
      toId: link.toId || null,
      fromName: canvasImageDisplayName(byId.get(link.fromId), "") || canvasNodeCaption(byId.get(link.fromId), "image"),
      toName: canvasImageDisplayName(byId.get(link.toId), "") || canvasNodeCaption(byId.get(link.toId), "image"),
      relation: expandCanvasMentionText(String(link.relation || "").trim(), list),
    };
  });
  return {
    boardName,
    description: String(description || "").trim(),
    finalExample: canvasGraphImage(finalExample),
    linkedImages,
    images: images.map(canvasGraphImage),
    links: graphLinks,
    notes: formatCanvasLayoutNotes({
      description,
      elements: list,
      links,
    }),
  };
}

export function buildCanvasGoalMetadata({
  elements = [],
  boardName = "Canvas",
  description = "",
} = {}) {
  const graph = canvasPromptGraph(elements, { boardName, description });
  const tokenOf = (img) => canvasPromptMentionToken(img?.name || img?.id || "image");
  const refRow = (img, role) => {
    if (!img) return null;
    return {
      id: img.id || "",
      token: tokenOf(img),
      name: String(img.name || "").trim(),
      filename: String(img.sourceFilename || "").trim(),
      tag: String(img.tag || "").trim(),
      role,
    };
  };
  const seen = new Set();
  const references = [];
  const pushRef = (img, role) => {
    const row = refRow(img, role);
    if (!row || seen.has(row.id || row.token)) return;
    seen.add(row.id || row.token);
    references.push(row);
  };
  pushRef(graph.finalExample, "final-example");
  for (const img of graph.linkedImages || []) pushRef(img, "linked-photo");
  for (const img of graph.images || []) pushRef(img, "canvas-photo");
  return {
    kind: "canvas-metadata",
    purpose: "Connect the attached canvas drawing to reference images and describe the modeling goal. Layout intent, not DXF or a finished-part photo.",
    board: String(boardName || "Canvas"),
    goal: String(description || graph.description || "").trim(),
    canvas_image: "canvas-sketch",
    final_example: refRow(graph.finalExample, "final-example"),
    references,
    links: (graph.links || []).map((link) => ({
      number: Number(link.linkNumber) || 0,
      kind: link.kind || "link",
      name: String(link.linkName || "").trim(),
      members: (link.members || []).map((row) => row.token || row.name),
      from: canvasPromptMentionToken(link.fromName || "image"),
      to: canvasPromptMentionToken(link.toName || "image"),
      relation: String(link.relation || "").trim(),
    })),
    interests: collectCanvasInterests(elements).map((el) => ({
      number: Number(el.interestNumber) || 0,
      kind: canvasInterestKind(el),
      title: canvasInterestTitle(el),
      token: el.promptToken || "",
      phrase: el.promptToken ? canvasPromptMentionPhrase(el) : "",
      view: String(el.viewName || "").trim(),
      action: String(el.action || "").trim(),
      direction: String(el.direction || "").trim(),
      prompt: String(el.interestPrompt || "").trim(),
      tag: String(el.tag || "").trim(),
    })),
    regions: (elements || []).filter((el) => el?.promptToken).map((el) => {
      const parent = (elements || []).find((row) => row?.id && row.id === el.parentId);
      const kind = el.promptKind || canvasPromptKind(el);
      return {
        id: el.id || "",
        kind,
        token: el.promptToken,
        number: Number(el.promptNumber) || 0,
        phrase: canvasPromptMentionPhrase(el),
        parentId: el.parentId || "",
        parentToken: parent?.promptToken
          || (parent?.type === "image" ? canvasPromptMentionToken(canvasImageDisplayName(parent, "image")) : ""),
        tag: String(el.tag || "").trim(),
        view: String(el.viewName || "").trim(),
      };
    }),
    notes: String(graph.notes || "").trim(),
  };
}

export function formatCanvasLayoutNotes(metadata = {}) {
  const elements = Array.isArray(metadata.elements) ? metadata.elements : [];
  const byId = new Map(elements.map((el) => [el.id, el]));
  const caption = (id) => {
    const node = byId.get(id);
    if (!node) return "";
    return canvasImageDisplayName(
      node,
      String(node.tag || node.text || node.sourceFilename || node.type || "").trim(),
    );
  };
  const lines = [];
  const description = String(metadata.description || "").trim();
  if (description) lines.push(`Board description: ${description}`);
  const finals = elements.filter(isCanvasFinalExample);
  for (const el of finals) {
    const name = canvasImageDisplayName(el, "final example");
    lines.push(`Final look: ${canvasPromptMentionToken(name)} — ${CANVAS_FINAL_LOOK_TIP}`);
  }
  const texts = elements
    .filter((el) => String(el.text || "").trim() && el.type !== "link")
    .map((el) => String(el.text).trim())
    .slice(0, 24);
  if (texts.length) lines.push(`Handwritten / typed labels: ${texts.join("; ")}`);
  const arrows = elements.filter((el) => el.type === "arrow");
  if (arrows.length) {
    lines.push(`${arrows.length} arrow(s) on the drawing — treat them as callouts and direction, not CAD geometry.`);
  }
  const links = (Array.isArray(metadata.links) ? metadata.links : elements.filter((el) => el.type === "link" || el.type === "group-link"))
    .slice()
    .sort((a, b) => (Number(a.linkNumber) || 0) - (Number(b.linkNumber) || 0));
  for (const link of links) {
    const n = Number(link.linkNumber) || 0;
    const name = String(link.linkName || "").trim();
    const relation = expandCanvasMentionText(String(link.relation || "").trim(), elements)
      || "related views of the same design";
    if (isCanvasGroupLink(link) || (link.memberIds || []).length || (link.members || []).length) {
      const members = (link.members || canvasLinkMentionNodes(link, elements)).map((row) => {
        const node = row.id && !row.token ? byId.get(row.id) || row : row;
        const label = row.token || (node?.type === "image"
          ? canvasPromptMentionToken(canvasNodeCaption(node, "image"))
          : canvasPromptHashToken(canvasNodeCaption(node, node?.type || "shape")));
        return label;
      });
      const title = name ? canvasPromptHashToken(name) : `Link #${n || "?"}`;
      lines.push(`Named link ${title}: ${members.join(" + ") || "grouped objects"} — ${relation}`);
      continue;
    }
    const fromName = caption(link.fromId);
    const toName = caption(link.toId);
    const from = fromName ? canvasPromptMentionToken(fromName) : "image/node";
    const to = toName ? canvasPromptMentionToken(toName) : "image/node";
    lines.push(`Link #${n || "?"}: ${from} ↔ ${to} — ${relation}`);
  }
  const interests = (Array.isArray(metadata.interests) ? metadata.interests : collectCanvasInterests(elements))
    .slice()
    .sort((a, b) => (Number(a.interestNumber) || 0) - (Number(b.interestNumber) || 0));
  for (const item of interests) {
    const line = formatCanvasInterestLine(item);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export function collectSmartDescriptionImages(elements = []) {
  const graph = canvasPromptGraph(elements);
  const byId = new Map((Array.isArray(elements) ? elements : []).map((el) => [el.id, el]));
  const ids = [];
  if (graph.finalExample?.id) ids.push(graph.finalExample.id);
  for (const img of graph.linkedImages || []) {
    if (img?.id) ids.push(img.id);
  }
  if (!ids.length) {
    for (const img of graph.images || []) {
      if (img?.id) ids.push(img.id);
    }
  }
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const el = byId.get(id);
    if (!el || seen.has(id)) continue;
    seen.add(id);
    out.push(el);
  }
  return out;
}

export function formatSmartDescriptionDraft({
  originalPrompt = "",
  elements = [],
  boardName = "Canvas",
  description = "",
} = {}) {
  const graph = canvasPromptGraph(elements, { boardName, description });
  const tokenOf = (img) => canvasPromptMentionToken(img?.name || img?.id || "image");
  const lines = [];
  const original = formatCanvasPromptMentions(String(originalPrompt || "").trim(), elements);
  if (original) {
    lines.push(original);
    lines.push("");
  }
  const tagged = [];
  const seen = new Set();
  const pushImg = (img) => {
    if (!img?.id || seen.has(img.id)) return;
    seen.add(img.id);
    tagged.push(img);
  };
  pushImg(graph.finalExample);
  for (const img of graph.linkedImages || []) pushImg(img);
  if (!graph.links.length && tagged.length <= (graph.finalExample ? 1 : 0)) {
    for (const img of graph.images || []) pushImg(img);
  }
  if (tagged.length) {
    lines.push(`Use these canvas references: ${tagged.map(tokenOf).join(", ")}.`);
  }
  if (graph.notes) lines.push(graph.notes);
  else if (graph.finalExample) {
    lines.push(`Final look ${tokenOf(graph.finalExample)}: ${CANVAS_FINAL_LOOK_TIP}`);
  }
  return lines.join("\n").trim();
}

export function ensureSmartDescriptionTokens(text, elements = [], boardName = "Canvas") {
  const images = collectSmartDescriptionImages(elements);
  const mentions = collectCanvasImageMentions(images, { boardName });
  let next = formatCanvasPromptMentions(String(text || "").trim(), elements);
  const missing = mentions.filter((m) => m.token && !next.includes(m.token));
  if (missing.length) {
    next = `${next}${next ? "\n\n" : ""}Keep these canvas references: ${missing.map((m) => `image: ${m.token}`).join(", ")}.`;
  }
  return next;
}

export function mergeSmartDescriptionPrompt(original, improved, elements = [], boardName = "Canvas") {
  const draft = formatSmartDescriptionDraft({ originalPrompt: original, elements, boardName });
  let next = String(improved || "").trim() || draft;
  const orig = formatCanvasPromptMentions(String(original || "").trim(), elements);
  const rawOrig = String(original || "").trim();
  if (orig && !next.includes(orig) && (!rawOrig || !next.includes(rawOrig))) next = `${orig}\n\n${next}`;
  return ensureSmartDescriptionTokens(next, elements, boardName);
}

export function collectCanvasInterviewItems(elements = []) {
  const list = Array.isArray(elements) ? elements : [];
  const links = list
    .filter((el) => el?.type === "link" || el?.type === "group-link")
    .slice()
    .sort((a, b) => (Number(a.linkNumber) || 0) - (Number(b.linkNumber) || 0));
  return links.map((link, i) => {
    const members = canvasLinkMentionNodes(link, list);
    const name = String(link.linkName || "").trim() || `Link ${link.linkNumber || i + 1}`;
    const tags = members.map((el) => {
      const caption = canvasNodeCaption(el, el.type);
      const token = el.type === "image" ? canvasPromptMentionToken(caption) : canvasPromptHashToken(caption);
      return { id: el.id, token, caption };
    });
    return {
      id: link.id,
      linkNumber: Number(link.linkNumber) || i + 1,
      linkName: name,
      kind: isCanvasGroupLink(link) ? "group-link" : "link",
      relation: expandCanvasMentionText(String(link.relation || "").trim(), list),
      members: tags,
      tokens: tags.map((row) => row.token),
    };
  });
}

export function composeSmartDescriptionInterview({
  originalPrompt = "",
  elements = [],
  boardName = "Canvas",
  description = "",
  answers = {},
} = {}) {
  const items = collectCanvasInterviewItems(elements);
  const lines = [];
  const target = String(answers.editCurrent || answers.target || "").trim();
  if (target === "edit") lines.push("Edit the current selected model in place. Use @selected unless another body is named.");
  else if (target === "new") lines.push("Create a new object from this canvas. Do not overwrite the current model.");
  for (const item of items) {
    const ans = String(answers[item.id] || answers[`link-${item.linkNumber}`] || "").trim();
    const tags = item.tokens.join(" ");
    const heading = canvasPromptHashToken(item.linkName);
    if (ans) lines.push(`${heading} (${tags}): ${ans}`);
    else if (item.relation) lines.push(`${heading} (${tags}): ${item.relation}`);
    else if (tags) lines.push(`${heading} groups ${tags}.`);
  }
  const seed = formatSmartDescriptionDraft({ originalPrompt, elements, boardName, description });
  return [seed, lines.join("\n")].filter(Boolean).join("\n\n").trim();
}
