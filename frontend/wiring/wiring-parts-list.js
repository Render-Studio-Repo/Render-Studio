/** Wiring Simulator Parts list — filters, multi-select, prompt send. No extra GPU. */

export const WIRING_PARTS_FILTERS_KEY = "render3d:wiring-parts-filters:v1";
export const WIRING_PARTS_FILTER_KEYS = ["models", "mcmaster", "electronics"];

export function defaultWiringPartsFilters() {
  return { models: true, mcmaster: true, electronics: true };
}

export function parseWiringPartsFilters(raw) {
  const fallback = defaultWiringPartsFilters();
  let data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { return fallback; }
  }
  if (!data || typeof data !== "object") return fallback;
  const next = { ...fallback };
  for (const key of WIRING_PARTS_FILTER_KEYS) {
    if (key in data) next[key] = data[key] !== false;
  }
  return next;
}

export function loadWiringPartsFilters(storage = globalThis.localStorage) {
  try {
    return parseWiringPartsFilters(storage?.getItem?.(WIRING_PARTS_FILTERS_KEY));
  } catch {
    return defaultWiringPartsFilters();
  }
}

export function saveWiringPartsFilters(filters, storage = globalThis.localStorage) {
  const next = parseWiringPartsFilters(filters);
  try { storage?.setItem?.(WIRING_PARTS_FILTERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function wiringPartId(part) {
  return String(part?.id || part?.filename || part?.name || part?.label || "").trim();
}

export function classifyWiringPartBucket(part, predicates = {}) {
  if (part?.bucket && WIRING_PARTS_FILTER_KEYS.includes(part.bucket)) return part.bucket;
  if (predicates.isMcMaster?.(part)) return "mcmaster";
  if (predicates.isElectronics?.(part)) return "electronics";
  return "models";
}

export function annotateWiringParts(parts, predicates = {}) {
  return (parts || []).map((part) => {
    const bucket = classifyWiringPartBucket(part, predicates);
    const id = wiringPartId(part) || `part:${bucket}:${part?.label || "item"}`;
    return { ...part, bucket, id };
  });
}

export function filterWiringParts(parts, filters, query = "") {
  const on = parseWiringPartsFilters(filters);
  const q = String(query || "").trim().toLowerCase();
  return (parts || []).filter((part) => {
    const bucket = part?.bucket || "models";
    if (on[bucket] === false) return false;
    if (!q) return true;
    const hay = [
      part.label,
      part.filename,
      part.name,
      part.kind,
      part.stem,
      part.meta,
      part.bucket,
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

export function shiftSelectIds(orderedIds, lastId, nextId) {
  const ids = (orderedIds || []).map(String);
  if (!ids.length) return nextId ? [String(nextId)] : [];
  const next = String(nextId || "");
  if (!next) return [];
  const last = String(lastId || "");
  const nextIdx = ids.indexOf(next);
  const lastIdx = ids.indexOf(last);
  if (nextIdx < 0) return [next];
  if (lastIdx < 0) return [next];
  const lo = Math.min(lastIdx, nextIdx);
  const hi = Math.max(lastIdx, nextIdx);
  return ids.slice(lo, hi + 1);
}

export function applyListSelection(selected, id, orderedIds, { shift = false, toggle = false, replace = false } = {}, lastId = "") {
  const current = new Set([...(selected || [])].map(String));
  const key = String(id || "");
  if (!key) return { selected: current, lastId: lastId || "" };
  if (shift) {
    for (const item of shiftSelectIds(orderedIds, lastId || key, key)) current.add(item);
    return { selected: current, lastId: key };
  }
  if (toggle) {
    if (current.has(key)) current.delete(key);
    else current.add(key);
    return { selected: current, lastId: key };
  }
  if (replace) {
    return { selected: new Set([key]), lastId: key };
  }
  if (current.has(key)) current.delete(key);
  else current.add(key);
  return { selected: current, lastId: key };
}

export function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function idsInMarquee(items, marquee) {
  if (!marquee || !items?.length) return [];
  const hits = [];
  for (const item of items) {
    const id = item?.id;
    const box = item?.rect;
    if (!id || !box) continue;
    if (rectsOverlap(box, marquee)) hits.push(String(id));
  }
  return hits;
}

export function normalizeMarquee(start, end) {
  const x1 = Number(start?.x) || 0;
  const y1 = Number(start?.y) || 0;
  const x2 = Number(end?.x) || 0;
  const y2 = Number(end?.y) || 0;
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

export function catalogCandidateToPart(candidate = {}) {
  const label = String(candidate.name || candidate.id || "Catalog part").trim();
  const partNumber = String(candidate.part_number || candidate.mcmaster_part_number || candidate.id || "").trim();
  return {
    id: `catalog:${partNumber || candidate.step_url || label}`,
    bucket: "mcmaster",
    origin: "catalog",
    label,
    filename: "",
    name: label,
    stem: partNumber || label,
    kind: candidate.category || candidate.family || "McMaster",
    sourced: false,
    thumbUrl: candidate.png_url || (/^[0-9]{3,6}[A-Za-z][0-9A-Za-z]{1,8}$/.test(partNumber) ? `https://images.mcmaster.com/${partNumber}.png` : ""),
    catalog: candidate,
    mcmaster_part_number: partNumber,
    datasheet: candidate.datasheet_url || candidate.page_url || "",
  };
}

export function electronicsItemToPart(item = {}) {
  const label = String(item.label || item.kind || "Electronics").trim();
  const filename = String(item.filename || "").trim();
  return {
    id: item.id || `electronics:${item.type || "part"}:${filename || label}`,
    bucket: "electronics",
    origin: "electronics",
    label,
    filename,
    name: filename || label,
    stem: filename.replace(/\.[^.]+$/, "") || label,
    kind: item.kind || item.type || "Electronics",
    sourced: true,
    thumbUrl: item.thumbUrl || "",
    electronics: item,
    datasheet: item.datasheet || item.search || "",
  };
}

export function bindMarqueeSelect(listEl, { itemSelector = "[data-wiring-part-id]", onSelect } = {}) {
  if (!listEl || listEl.dataset.marqueeBound === "1") return { destroy() {} };
  listEl.dataset.marqueeBound = "1";
  let dragging = false;
  let start = null;
  let boxEl = null;

  function ensureBox() {
    if (boxEl?.isConnected) return boxEl;
    boxEl = document.createElement("div");
    boxEl.className = "wiring-parts-marquee";
    boxEl.setAttribute("aria-hidden", "true");
    listEl.appendChild(boxEl);
    return boxEl;
  }

  function readItems() {
    return [...listEl.querySelectorAll(itemSelector)].map((el) => ({
      id: el.getAttribute("data-wiring-part-id"),
      rect: el.getBoundingClientRect(),
    }));
  }

  let moved = false;

  function onPointerDown(ev) {
    if (ev.button !== 0) return;
    if (ev.target.closest?.("button, a, input, label, textarea, select")) return;
    dragging = true;
    moved = false;
    start = { x: ev.clientX, y: ev.clientY };
    try { listEl.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  }

  function onPointerMove(ev) {
    if (!dragging || !start) return;
    const end = { x: ev.clientX, y: ev.clientY };
    if (Math.abs(end.x - start.x) < 4 && Math.abs(end.y - start.y) < 4) return;
    moved = true;
    const marquee = normalizeMarquee(start, end);
    const host = listEl.getBoundingClientRect();
    const box = ensureBox();
    box.hidden = false;
    box.style.left = `${marquee.left - host.left + listEl.scrollLeft}px`;
    box.style.top = `${marquee.top - host.top + listEl.scrollTop}px`;
    box.style.width = `${marquee.right - marquee.left}px`;
    box.style.height = `${marquee.bottom - marquee.top}px`;
  }

  function onPointerUp(ev) {
    if (!dragging) return;
    dragging = false;
    const didMove = moved;
    const origin = start;
    start = null;
    moved = false;
    if (boxEl) boxEl.hidden = true;
    try { listEl.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
    if (!didMove || !origin) return;
    const marquee = normalizeMarquee(origin, { x: ev.clientX, y: ev.clientY });
    onSelect?.(idsInMarquee(readItems(), marquee), { additive: ev.shiftKey || ev.metaKey || ev.ctrlKey });
  }

  listEl.addEventListener("pointerdown", onPointerDown);
  listEl.addEventListener("pointermove", onPointerMove);
  listEl.addEventListener("pointerup", onPointerUp);
  listEl.addEventListener("pointercancel", onPointerUp);

  return {
    destroy() {
      listEl.removeEventListener("pointerdown", onPointerDown);
      listEl.removeEventListener("pointermove", onPointerMove);
      listEl.removeEventListener("pointerup", onPointerUp);
      listEl.removeEventListener("pointercancel", onPointerUp);
      boxEl?.remove();
      delete listEl.dataset.marqueeBound;
    },
  };
}
