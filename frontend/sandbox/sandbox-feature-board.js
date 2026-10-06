/**
 * In-workspace feature control board. Source of record for live vs sandbox-gated.
 * Harness can retune without a second talk bar. Token featboard1.
 */

import { isSandboxProgrammingOn, setSandboxProgrammingOn } from "./project-file-viewer.js?v=20260923-draw-recordings1";

export const FEATBOARD1_TOKEN = "featboard1";
export const FEATURE_BOARD_KEY = "render3d.sandbox.featureBoard";

export const FEATURE_FLAGS = Object.freeze([
  { id: "viewport", label: "Studio viewport", live: true, note: "One iframe · sbvp1" },
  { id: "viser", label: "Viser", live: true, note: "One proxy iframe" },
  { id: "dimos", label: "DIMOS strip", live: true, note: "Coordinator :8443 · no arm" },
  { id: "mujoco", label: "MuJoCo sim", live: true, note: "Embed · no key-bindings overlay" },
  { id: "wiring", label: "Wiring simulator", live: true, note: "Crew benches" },
  { id: "whiteboard", label: "White smartboard", live: true, note: "Draw + teach" },
  { id: "teaching", label: "Teaching record", live: true, note: "Cook-like sequences" },
  { id: "shop-print-check", label: "Shop print check", live: true, note: "Silent until alert" },
  { id: "sandbox-writes", label: "Sandbox writes", live: false, note: "FILEVIEW1 toggle · MCP jail" },
]);

function defaults() {
  const map = {};
  for (const f of FEATURE_FLAGS) map[f.id] = !!f.live;
  map["sandbox-writes"] = isSandboxProgrammingOn();
  return map;
}

export function readFeatureBoard(storage = globalThis.localStorage) {
  const base = defaults();
  try {
    const raw = storage?.getItem?.(FEATURE_BOARD_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const f of FEATURE_FLAGS) {
        if (typeof parsed[f.id] === "boolean") base[f.id] = parsed[f.id];
      }
    }
  } catch { /* defaults */ }
  base["sandbox-writes"] = isSandboxProgrammingOn(storage);
  return { token: FEATBOARD1_TOKEN, flags: base, at: new Date().toISOString() };
}

export function isFeatureLive(id, storage = globalThis.localStorage) {
  return !!readFeatureBoard(storage).flags[id];
}

export function setFeatureFlag(id, on, storage = globalThis.localStorage) {
  const next = readFeatureBoard(storage);
  if (!FEATURE_FLAGS.some((f) => f.id === id)) return next;
  next.flags[id] = !!on;
  if (id === "sandbox-writes") setSandboxProgrammingOn(!!on, storage);
  try { storage?.setItem?.(FEATURE_BOARD_KEY, JSON.stringify(next.flags)); } catch { /* optional */ }
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent("render3d-sandbox-features", {
      detail: { id, on: !!on, flags: next.flags, token: FEATBOARD1_TOKEN },
    }));
  } catch { /* optional */ }
  return next;
}

export function featureBoardMarkup(board = readFeatureBoard()) {
  return `
    <div class="sb-feat-board" data-sb-feat-board data-token="${FEATBOARD1_TOKEN}">
      <p class="sb-teleop-copy">
        Feature control board — what is <strong>live</strong> in this shop vs <strong>sandbox-gated</strong>.
        Operators promote/flag here. Harness retunes silently (no extra talk bar).
        Sam lock <code>sam-y-engage-v2</code> stays locked.
      </p>
      <ul class="sb-feat-list">
        ${FEATURE_FLAGS.map((f) => `
          <li>
            <label>
              <input type="checkbox" data-feat="${f.id}" ${board.flags[f.id] ? "checked" : ""} />
              <strong>${f.label}</strong>
              <span class="muted small">${f.note}</span>
            </label>
          </li>`).join("")}
      </ul>
      <p class="sb-dimos-status" data-feat-status role="status">Board · ${FEATBOARD1_TOKEN}</p>
    </div>
  `;
}

export function bindFeatureBoard(root) {
  if (!root) return null;
  const status = root.querySelector("[data-feat-status]");
  const paint = () => {
    const board = readFeatureBoard();
    root.querySelectorAll("[data-feat]").forEach((box) => {
      box.checked = !!board.flags[box.getAttribute("data-feat")];
    });
    if (status) status.textContent = `Live: ${FEATURE_FLAGS.filter((f) => board.flags[f.id]).map((f) => f.id).join(", ") || "none"}`;
    return board;
  };
  root.querySelectorAll("[data-feat]").forEach((box) => {
    box.addEventListener("change", () => {
      setFeatureFlag(box.getAttribute("data-feat"), box.checked);
      paint();
    });
  });
  paint();
  return { token: FEATBOARD1_TOKEN, read: readFeatureBoard, set: setFeatureFlag, paint };
}

export function mountFeatureBoard(host) {
  if (!host) return null;
  host.innerHTML = featureBoardMarkup();
  return bindFeatureBoard(host.querySelector("[data-sb-feat-board]"));
}
