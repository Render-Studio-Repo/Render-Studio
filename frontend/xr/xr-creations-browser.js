/**
 * VR drawing → Browser: solids are bodies under a component (VR Room / user groups),
 * listed in the VR Creations folder — not a new component per brush.
 */

export const VR_ROOM_ID = "vr-room";
export const DEFAULT_VR_ROOM_NAME = "VR Room";
export const DEFAULT_VR_GROUP_NAME = "VR Group";
export const VR_CREATIONS_FOLDER = "VR Creations";
export const XR_CREATIONS_MANIFEST = "xr_creations.json";
export const XR_CREATIONS_SORTS = [
  { id: "newest", label: "Newest → oldest" },
  { id: "user", label: "By creator" },
  { id: "name", label: "Name A–Z" },
  { id: "kind", label: "Kind" },
];

const KIND_LABEL = {
  box: "Box",
  cube: "Box",
  cylinder: "Cylinder",
  cyl: "Cylinder",
  sphere: "Sphere",
  cone: "Cone",
  torus: "Torus",
  wall: "Wall",
  floor: "Floor",
  combine: "Combine",
  revolve: "Revolve",
  loft: "Loft",
  solid: "Solid",
};

export function emptyXrCreationsState() {
  return {
    version: 1,
    sort: "newest",
    components: [implicitVrRoom()],
    bodies: [],
  };
}

function implicitVrRoom(extra = {}) {
  return {
    id: VR_ROOM_ID,
    name: DEFAULT_VR_ROOM_NAME,
    implicit: true,
    kind: "room",
    createdAt: Number(extra.createdAt || 0) || 0,
    authorId: String(extra.authorId || ""),
    authorName: String(extra.authorName || ""),
  };
}

export function isXrCreationsManifest(name = "") {
  return String(name || "").split("/").pop().toLowerCase() === XR_CREATIONS_MANIFEST;
}

const _CREATE_PRIMITIVE_STEM_RE = /^(?:xr_)?(box|cube|cylinder|cyl|sphere|cone|torus)\d*$/i;
const _XR_CLIENTS = new Set(["xr", "vr", "headset", "quest"]);

export function isFreecadPrimitiveFilename(name = "") {
  const base = String(name || "").split("/").pop() || "";
  const stem = base.replace(/\.[^.]+$/, "");
  return _CREATE_PRIMITIVE_STEM_RE.test(stem);
}

export function isXrCreationFilename(name = "") {
  const base = String(name || "").split("/").pop().toLowerCase();
  if (!base || isXrCreationsManifest(base)) return false;
  if (/^xr_/.test(base)) return true;
  return false;
}

function entryClientToken(entry = {}) {
  return String(
    entry.client
    || entry.source
    || entry.xr_client
    || entry.request_body?.client
    || "",
  ).trim().toLowerCase();
}

/** VR draw/sculpt, Create primitives, and VR-generated solids — never Fusion components. */
export function isVrCreationEntry(entry = {}, filename = "") {
  const name = filename || entry?.name || entry?.viewer_filename || entry?.filename || entry?.stem || "";
  if (!name || isXrCreationsManifest(name)) return false;
  if (entry?.catalog_hardware || entry?.virtual_folder) return false;
  if (
    entry?.xr_creation
    || entry?.xr_body
    || entry?.xr_folder
    || entry?.xr_headset
    || entry?.freecad_primitive
    || entry?.vr_generation
    || entry?.createPrimitive
  ) return true;
  if (_XR_CLIENTS.has(entryClientToken(entry))) return true;
  if (isXrCreationFilename(name) || isFreecadPrimitiveFilename(name)) return true;
  return false;
}

function inferredBodyLabel(entry, kind, existingLabels) {
  const raw = String(entry?.stem || entry?.name || entry?.viewer_filename || "")
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "");
  if (isFreecadPrimitiveFilename(raw)) {
    const pretty = prettyXrKind(kindFromFilename(raw) || kind);
    const num = raw.match(/(\d+)$/);
    return num ? `${pretty}${num[1]}` : pretty;
  }
  const explicit = String(entry?.label || "").trim();
  if (explicit && !/^(component|body|solid)$/i.test(explicit)) return explicit;
  if (raw && !isFreecadPrimitiveFilename(raw)) return raw;
  return nextBodyLabel(kind, existingLabels);
}

export function prettyXrKind(kind = "") {
  const key = String(kind || "").replace(/^create_/, "").toLowerCase();
  return KIND_LABEL[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Solid");
}

export function nextBodyLabel(kind, existing = []) {
  const base = prettyXrKind(kind);
  const used = new Set((existing || []).map((s) => String(s || "").toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let i = 2;
  while (used.has(`${base}${i}`.toLowerCase())) i += 1;
  return `${base}${i}`;
}

export function authorDisplayName(entry = {}) {
  const name = String(
    entry.authorName
    || entry.author_name
    || entry.xrAuthorName
    || entry.created_by_name
    || "",
  ).trim();
  if (name) return name;
  const id = String(entry.authorId || entry.author_id || entry.xrAuthorId || entry.created_by || "").trim();
  return id || "";
}

export function authorHighlightText(entry = {}) {
  const who = authorDisplayName(entry);
  return who ? `Made by ${who}` : "Made in VR";
}

function bodyKey(body = {}) {
  return String(body.id || body.drawId || body.filename || body.name || "").trim();
}

export function normalizeXrCreationsState(raw) {
  const base = emptyXrCreationsState();
  const src = raw && typeof raw === "object" ? raw : {};
  const sort = XR_CREATIONS_SORTS.some((s) => s.id === src.sort) ? src.sort : "newest";
  const compsIn = Array.isArray(src.components) ? src.components : [];
  const bodiesIn = Array.isArray(src.bodies) ? src.bodies : [];
  const components = [];
  const seenComp = new Set();
  components.push(implicitVrRoom(compsIn.find((c) => c?.id === VR_ROOM_ID || c?.implicit) || {}));
  seenComp.add(VR_ROOM_ID);
  for (const c of compsIn) {
    const id = String(c?.id || "").trim();
    if (!id || seenComp.has(id)) continue;
    seenComp.add(id);
    components.push({
      id,
      name: String(c.name || DEFAULT_VR_GROUP_NAME).trim() || DEFAULT_VR_GROUP_NAME,
      implicit: false,
      kind: String(c.kind || "group"),
      createdAt: Number(c.createdAt || c.created_at || 0) || 0,
      authorId: String(c.authorId || c.author_id || ""),
      authorName: String(c.authorName || c.author_name || ""),
    });
  }
  const bodies = [];
  const seenBody = new Set();
  for (const b of bodiesIn) {
    const id = bodyKey(b);
    if (!id || seenBody.has(id)) continue;
    seenBody.add(id);
    const componentId = String(b.componentId || b.component_id || VR_ROOM_ID) || VR_ROOM_ID;
    bodies.push({
      id,
      filename: String(b.filename || b.name || id),
      name: String(b.name || b.filename || id),
      label: String(b.label || "").trim(),
      kind: String(b.kind || "solid"),
      drawId: String(b.drawId || b.draw_id || ""),
      componentId: seenComp.has(componentId) ? componentId : VR_ROOM_ID,
      createdAt: Number(b.createdAt || b.created_at || 0) || 0,
      authorId: String(b.authorId || b.author_id || ""),
      authorName: String(b.authorName || b.author_name || ""),
    });
  }
  return { version: 1, sort, components, bodies };
}

export function upsertXrBody(state, spec = {}) {
  const next = normalizeXrCreationsState(state);
  const filename = String(spec.filename || spec.name || "").trim();
  const drawId = String(spec.drawId || spec.draw_id || "").trim();
  const id = String(spec.id || drawId || filename).trim();
  if (!id) return next;
  const existing = next.bodies.find((b) => b.id === id || (filename && b.filename === filename) || (drawId && b.drawId === drawId));
  const labels = next.bodies
    .filter((b) => !existing || b.id !== existing.id)
    .map((b) => b.label);
  const kind = spec.kind || existing?.kind || "solid";
  const row = {
    id,
    filename: filename || existing?.filename || id,
    name: filename || existing?.name || id,
    label: String(spec.label || existing?.label || "").trim() || nextBodyLabel(kind, labels),
    kind,
    drawId: drawId || existing?.drawId || "",
    componentId: String(spec.componentId || existing?.componentId || VR_ROOM_ID) || VR_ROOM_ID,
    createdAt: Number(spec.createdAt || spec.created_at || existing?.createdAt || Date.now()) || Date.now(),
    authorId: String(spec.authorId || spec.author_id || existing?.authorId || ""),
    authorName: String(spec.authorName || spec.author_name || existing?.authorName || ""),
  };
  if (existing) {
    Object.assign(existing, row);
  } else {
    next.bodies.push(row);
  }
  const room = next.components.find((c) => c.id === VR_ROOM_ID);
  if (room && !room.createdAt) room.createdAt = row.createdAt;
  if (room && !room.authorId && row.authorId) {
    room.authorId = row.authorId;
    room.authorName = row.authorName;
  }
  return next;
}

export function remapXrBodyFilename(state, fromName, toName) {
  const next = normalizeXrCreationsState(state);
  const from = String(fromName || "").trim();
  const to = String(toName || "").trim();
  if (!from || !to) return next;
  for (const b of next.bodies) {
    if (b.filename === from || b.name === from || b.id === from) {
      b.filename = to;
      b.name = to;
      if (b.id === from) b.id = to;
    }
  }
  return next;
}

export function groupBodiesAsComponent(state, bodyIds = [], opts = {}) {
  const next = normalizeXrCreationsState(state);
  const ids = new Set((bodyIds || []).map((v) => String(v || "").trim()).filter(Boolean));
  if (!ids.size) return next;
  const name = String(opts.name || DEFAULT_VR_GROUP_NAME).trim() || DEFAULT_VR_GROUP_NAME;
  const id = String(opts.id || `vr-group-${Date.now().toString(36)}`);
  const at = Number(opts.createdAt || Date.now()) || Date.now();
  next.components.push({
    id,
    name,
    implicit: false,
    kind: "group",
    createdAt: at,
    authorId: String(opts.authorId || opts.author_id || ""),
    authorName: String(opts.authorName || opts.author_name || ""),
  });
  for (const b of next.bodies) {
    if (ids.has(b.id) || ids.has(b.filename) || ids.has(b.drawId) || ids.has(b.name)) {
      b.componentId = id;
    }
  }
  return next;
}

function cmpText(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
}

export function sortXrCreationComponents(components = [], bodies = [], mode = "newest") {
  const list = [...(components || [])];
  const kids = bodies || [];
  const newestOf = (comp) => {
    const mine = kids.filter((b) => b.componentId === comp.id);
    const times = [Number(comp.createdAt) || 0, ...mine.map((b) => Number(b.createdAt) || 0)];
    return Math.max(0, ...times);
  };
  const kindOf = (comp) => {
    if (comp.kind && comp.kind !== "group" && comp.kind !== "room") return comp.kind;
    const mine = kids.filter((b) => b.componentId === comp.id);
    return mine[0]?.kind || comp.kind || "";
  };
  list.sort((a, b) => {
    if (mode === "name") return cmpText(a.name, b.name) || cmpText(a.id, b.id);
    if (mode === "user") {
      return cmpText(authorDisplayName(a), authorDisplayName(b))
        || (newestOf(b) - newestOf(a));
    }
    if (mode === "kind") {
      return cmpText(kindOf(a), kindOf(b)) || cmpText(a.name, b.name);
    }
    return newestOf(b) - newestOf(a) || cmpText(a.name, b.name);
  });
  return list;
}

export function sortXrBodies(bodies = [], mode = "newest") {
  const list = [...(bodies || [])];
  list.sort((a, b) => {
    if (mode === "name") return cmpText(a.label || a.name, b.label || b.name);
    if (mode === "user") {
      return cmpText(authorDisplayName(a), authorDisplayName(b))
        || ((Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    }
    if (mode === "kind") return cmpText(a.kind, b.kind) || cmpText(a.label, b.label);
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  });
  return list;
}

export function inferXrBodiesFromComponents(components = [], state = emptyXrCreationsState()) {
  const next = normalizeXrCreationsState(state);
  for (const entry of components || []) {
    const filename = String(entry?.name || entry?.viewer_filename || "");
    if (!filename) continue;
    if (entry?.catalog_hardware || entry?.virtual_folder || entry?.virtual_body) continue;
    if (!isVrCreationEntry(entry, filename)) continue;
    if (next.bodies.some((b) => b.filename === filename || b.name === filename || b.id === filename)) continue;
    const kind = kindFromFilename(filename) || String(entry.kind || entry.format || "solid");
    next.bodies.push({
      id: filename,
      filename,
      name: filename,
      label: inferredBodyLabel(entry, kind, next.bodies.map((b) => b.label)),
      kind,
      drawId: "",
      componentId: VR_ROOM_ID,
      createdAt: Number(entry.mtime || entry.createdAt || 0) || 0,
      authorId: String(entry.authorId || entry.author_id || ""),
      authorName: String(entry.authorName || entry.author_name || ""),
    });
  }
  return next;
}

function kindFromFilename(name = "") {
  const stem = String(name || "").split("/").pop().replace(/\.[^.]+$/, "");
  const xr = stem.match(/^xr_([a-z]+)/i);
  if (xr) return String(xr[1]).toLowerCase();
  const prim = stem.match(/^(box|cube|cylinder|cyl|sphere|cone|torus)/i);
  return prim ? String(prim[1]).toLowerCase() : "solid";
}

export function isXrTrackedFilename(name, state, entry = null) {
  const n = String(name || "");
  if (!n) return false;
  if (isXrCreationsManifest(n)) return true;
  if (isVrCreationEntry(entry || {}, n)) return true;
  const st = state || emptyXrCreationsState();
  return (st.bodies || []).some((b) => b.filename === n || b.name === n || b.id === n);
}

function bodyChildEntry(body, component) {
  return {
    id: `${component.id}:body:${body.id}`,
    name: body.filename || body.name || body.id,
    filename: body.filename,
    stem: String(body.label || "body").replace(/\s+/g, "_"),
    label: body.label || prettyXrKind(body.kind),
    format: "body",
    viewer_filename: body.filename,
    source_filename: body.filename,
    parent_filename: body.filename,
    body_index: 0,
    body_name: body.label,
    virtual_body: true,
    xr_creation: true,
    xr_body: true,
    authorId: body.authorId,
    authorName: body.authorName,
    createdAt: body.createdAt,
    kind: body.kind,
  };
}

export function buildVrCreationEntries(state = emptyXrCreationsState()) {
  const st = normalizeXrCreationsState(state);
  const comps = sortXrCreationComponents(st.components, st.bodies, st.sort);
  const entries = [];
  for (const comp of comps) {
    const kids = sortXrBodies(st.bodies.filter((b) => b.componentId === comp.id), st.sort);
    if (!kids.length && comp.implicit) continue;
    entries.push({
      id: `xr-comp:${comp.id}`,
      name: `xr-comp:${comp.id}`,
      stem: comp.id,
      label: comp.name,
      format: "component",
      virtual_component: true,
      xr_creation: true,
      xr_component: true,
      xr_headset: true,
      children_label: "Bodies",
      authorId: comp.authorId,
      authorName: comp.authorName,
      createdAt: comp.createdAt,
      kind: comp.kind,
      source_filename: kids[0]?.filename || "",
      viewer_filename: kids[0]?.filename || "",
      children: kids.map((b) => bodyChildEntry(b, comp)),
    });
  }
  return entries;
}

export function nestXrCreationsInBrowser(browser = {}, state = emptyXrCreationsState(), liveBodies = []) {
  let st = normalizeXrCreationsState(state);
  for (const live of liveBodies || []) st = upsertXrBody(st, live);
  st = inferXrBodiesFromComponents(browser.components || [], st);

  const vr_creations = buildVrCreationEntries(st);
  const components = (browser.components || []).filter((entry) => {
    const n = entry?.name || entry?.viewer_filename || "";
    if (isVrCreationEntry(entry, n)) return false;
    return !isXrTrackedFilename(n, st, entry);
  });
  const references = (browser.references || []).filter((entry) => !isXrCreationsManifest(entry?.name || entry?.filename));
  return {
    ...browser,
    components,
    references,
    vr_creations,
    xr_creations_sort: st.sort,
  };
}

export function flattenVrExplorerItems(vrEntries = [], selectedName = "") {
  const items = [];
  for (const comp of vrEntries || []) {
    items.push({
      id: comp.source_filename || comp.name,
      label: `${comp.label || DEFAULT_VR_ROOM_NAME}`,
      name: comp.source_filename || comp.name,
      kind: "vr-component",
      authorName: comp.authorName,
      active: false,
    });
    for (const child of comp.children || []) {
      const name = child.source_filename || child.filename || child.name;
      items.push({
        id: name,
        label: `${comp.label} / ${child.label || child.name}`,
        name,
        kind: "vr-body",
        authorName: child.authorName,
        active: name === selectedName,
      });
    }
  }
  return items;
}
