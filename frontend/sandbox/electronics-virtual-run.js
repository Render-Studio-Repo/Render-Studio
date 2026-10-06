/**
 * Electronics virtual-run monitor. Crew owns status; no fake hardware protocols.
 * Token elrun1.
 */

import { KEEP_SHOP_REFS } from "./crew-desk-status.js?v=20260923-draw-recordings1";

export const ELRUN1_TOKEN = "elrun1";
export const ELRUN_PATH = "sandbox-sessions/electronics-virtual-run.json";
export const ELRUN_STATUSES = Object.freeze(["idle", "simulating", "waiting-on-Sam"]);

export const ELECTRONICS_DOCS = Object.freeze(
  KEEP_SHOP_REFS.filter((r) => /electronics|parts_list/i.test(r.name)),
);

export const VIRTUAL_DEVICES = Object.freeze([
  { id: "psu-rail", label: "Power rail (sourcing doc)", doc: "electronics_build_sourcing.md" },
  { id: "io-harness", label: "I/O harness (sourcing 2)", doc: "electronics_build_sourcing_2.md" },
  { id: "fastener-bom", label: "Fastener / parts list", doc: "parts_list.md" },
]);

const LS = "render3d.sandbox.elrun";

export function loadElRun(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(LS);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.devices) return parsed;
  } catch { /* seed */ }
  return {
    token: ELRUN1_TOKEN,
    at: new Date().toISOString(),
    devices: VIRTUAL_DEVICES.map((d) => ({ ...d, status: "idle", note: "Not a live protocol — shop monitor only" })),
    docs: ELECTRONICS_DOCS,
  };
}

export function setDeviceStatus(id, status, storage = globalThis.localStorage) {
  const snap = loadElRun(storage);
  const next = ELRUN_STATUSES.includes(status) ? status : "idle";
  snap.devices = snap.devices.map((d) => (d.id === id ? { ...d, status: next, at: new Date().toISOString() } : d));
  snap.at = new Date().toISOString();
  try { storage?.setItem?.(LS, JSON.stringify(snap)); } catch { /* optional */ }
  return snap;
}

export function elRunMarkup() {
  const snap = loadElRun();
  return `
    <div class="sb-elrun" data-sb-elrun data-token="${ELRUN1_TOKEN}">
      <p class="muted small">Electronics virtual-run · ${ELRUN1_TOKEN} · docs only, no invented bus protocol.</p>
      <ul class="sb-elrun-docs">${ELECTRONICS_DOCS.map((d) => `<li><code>${d.name}</code></li>`).join("")}</ul>
      <ul class="sb-elrun-devs">
        ${snap.devices.map((d) => `
          <li data-elrun-id="${d.id}">
            <strong>${d.label}</strong>
            <span class="muted small">${d.status}</span>
            <select data-elrun-set="${d.id}">
              ${ELRUN_STATUSES.map((s) => `<option value="${s}" ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </li>`).join("")}
      </ul>
    </div>
  `;
}

export function bindElRun(root) {
  if (!root) return null;
  root.querySelectorAll("[data-elrun-set]").forEach((sel) => {
    sel.addEventListener("change", () => {
      setDeviceStatus(sel.getAttribute("data-elrun-set"), sel.value);
      const label = sel.closest("li")?.querySelector(".muted");
      if (label) label.textContent = sel.value;
    });
  });
  return { token: ELRUN1_TOKEN, snapshot: loadElRun };
}

export async function persistElRun(snap = loadElRun()) {
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "vibe-rnd", path: ELRUN_PATH, text: JSON.stringify(snap, null, 2) }),
  }).catch(() => null);
  return { ok: !!(res && res.ok), path: ELRUN_PATH, token: ELRUN1_TOKEN };
}
