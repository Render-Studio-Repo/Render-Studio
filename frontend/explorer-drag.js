/** Shared drag payload helpers for workspace + design browser → AI prompt drops. */

let pendingExplorerDragItems = null;

export function setExplorerDragData(e, items = []) {
  const payloads = items.filter(Boolean);
  pendingExplorerDragItems = payloads.length ? payloads : null;
  const data = { type: "multi", count: payloads.length, items: payloads };
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("application/render3d-component", JSON.stringify(data));
  e.dataTransfer.setData(
    "text/plain",
    payloads.map((p) => `@${p.stem || p.filename || p.name}`).join(" ")
  );
}

export function readExplorerDragPayloads(e) {
  const raw = e?.dataTransfer?.getData("application/render3d-component");
  if (raw) {
    try {
      const payload = JSON.parse(raw);
      if (payload?.type === "multi" && Array.isArray(payload.items)) {
        const items = payload.items.filter(Boolean);
        if (items.length) {
          pendingExplorerDragItems = null;
          return items;
        }
      }
      if (payload?.filename || payload?.name) {
        pendingExplorerDragItems = null;
        return [payload];
      }
    } catch {
      // fall through to pending cache
    }
  }
  const pending = pendingExplorerDragItems || [];
  pendingExplorerDragItems = null;
  return pending;
}

export function clearExplorerDragPayloads() {
  pendingExplorerDragItems = null;
}
