/**
 * Headset HUD lock-in-place + header / rotate hit layout.
 * Cheap localStorage flags — no CAD / WebGL work.
 */

export const LS_XR_HUD_LOCKS = "render3d:xr-hud-locks:v1";

export const XR_HUD_LOCKABLE_KINDS = [
  "menu", "settings", "tools", "ai", "aiHub", "view", "studio",
  "social", "socialHub", "draw", "workspace", "avatar", "place",
  "guides", "robotics",
];

function safeParse(raw) {
  try {
    const data = JSON.parse(String(raw || "{}"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function readXrHudLocks(storage) {
  try {
    return safeParse(storage?.getItem?.(LS_XR_HUD_LOCKS));
  } catch {
    return {};
  }
}

export function isXrHudLocked(kind, storage) {
  const id = String(kind || "");
  if (!id) return false;
  const all = readXrHudLocks(storage);
  return all[id] === true;
}

export function writeXrHudLocked(kind, locked, storage) {
  const id = String(kind || "");
  if (!id) return false;
  const next = !!locked;
  try {
    const all = readXrHudLocks(storage);
    all[id] = next;
    storage?.setItem?.(LS_XR_HUD_LOCKS, JSON.stringify(all));
  } catch {
    /* private mode */
  }
  return next;
}

export function toggleXrHudLocked(kind, storage) {
  return writeXrHudLocked(kind, !isXrHudLocked(kind, storage), storage);
}

/** Header: drag · ⋮ overflow · close. Matches paint overflow/close on the right. */
export function hudHeaderHitLayout(canvasW, headerEnd) {
  const w = Number(canvasW) || 720;
  const header = Number(headerEnd) || 68;
  const h = Math.max(40, header - 10);
  const closeW = 84;
  const overflowW = 84;
  return {
    close: { id: "hide", x: w - closeW - 8, y: 6, w: closeW, h },
    overflow: { id: "overflow", x: w - closeW - overflowW - 12, y: 6, w: overflowW, h },
    drag: { id: "drag", x: 8, y: 6, w: Math.max(48, w - closeW - overflowW - 28), h },
  };
}

/** Legacy edge meshes are inert: trigger manipulation belongs to the top bar. */
export function hudRotateHitLayout(canvasW, canvasH, headerEnd = 68) {
  return {left:{id:'rotate',x:-1,y:-1,w:0,h:0},right:{id:'rotate',x:-1,y:-1,w:0,h:0}};
}

/** Dropdown under ⋮ — lock/unlock and close; manipulation stays on the top bar. */
export function hudOverflowMenuLayout(canvasW, headerEnd, { locked = false } = {}) {
  const header = hudHeaderHitLayout(canvasW, headerEnd);
  const specs = [
    { id: locked ? "unlock" : "lock", label: locked ? "Unlock (follow belt)" : "Lock in place" },
    { id: "hide", label: "Close" },
  ];
  const rowH = 52;
  const w = 300;
  const h = 10 + specs.length * rowH;
  const x = Math.max(12, header.overflow.x + header.overflow.w - w);
  const y = header.overflow.y + header.overflow.h + 6;
  const rows = specs.map((row, i) => ({
    ...row,
    x: x + 8,
    y: y + 8 + i * rowH,
    w: w - 16,
    h: rowH - 8,
  }));
  return {
    x,
    y,
    w,
    h,
    rows,
    lock: rows[0],
  };
}

export function pickHudHeader(px, py, canvasW, headerEnd, { overflowOpen = false, locked = false } = {}) {
  if (!(px >= 0 && py >= 0)) return null;
  const header = hudHeaderHitLayout(canvasW, headerEnd);
  if (overflowOpen) {
    const menu = hudOverflowMenuLayout(canvasW, headerEnd, { locked });
    for (const cell of menu.rows || []) {
      if (px >= cell.x && px <= cell.x + cell.w && py >= cell.y && py <= cell.y + cell.h) {
        const kind = cell.id === "lock" || cell.id === "unlock" ? "hud-lock" : "hud-window";
        return { id: cell.id, kind };
      }
    }
    if (px >= menu.x && px <= menu.x + menu.w && py >= menu.y && py <= menu.y + menu.h) {
      return { id: "overflow", kind: "hud-overflow" };
    }
  }
  if (px >= header.close.x && px <= header.close.x + header.close.w && py >= header.close.y && py <= header.close.y + header.close.h) {
    return { id: "hide", kind: "hud-close" };
  }
  if (px >= header.overflow.x && px <= header.overflow.x + header.overflow.w && py >= header.overflow.y && py <= header.overflow.y + header.overflow.h) {
    return { id: "overflow", kind: "hud-overflow" };
  }
  if (px >= header.drag.x && px <= header.drag.x + header.drag.w && py >= header.drag.y && py <= header.drag.y + header.drag.h) {
    return { id: "drag", kind: "hud-drag" };
  }

  return null;
}

export function shouldFollowBeltHud({
  locked = false,
  dragging = false,
  parked = false,
  kind = "",
  laserAim = false,
} = {}) {
  if (locked === true || dragging === true || parked === true) return false;
  if (laserAim === true) return false;
  if (String(kind || "") === "ai") return false;
  return true;
}
