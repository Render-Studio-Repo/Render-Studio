/**
 * VR share sheet + grip+stick throw-to-print.
 * Right analog: xr-standard buttons[3] = thumbstick click (press in toward palm).
 * Fallback: stick X inward (right hand axes[2] < -0.65).
 */

export const SHARE_STICK_CLICK_BUTTON = 3;
export const SHARE_STICK_X_AXIS = 2;
export const SHARE_STICK_IN_THRESHOLD = 0.65;
export const SHARE_THROW_MIN_MPS = 0.55;
export const SHARE_THROW_MS = 520;
export const PRINTER_ACCEPT_KEY = "render3d:printer-accept-sends";
export const PRINTER_OUTLINE_KEY = "render3d:printer-outline";
export const PRINTER_VR_MODEL_KEY = "render3d:printer-vr-model";
export const PRINTER_LAN_IP_KEY = "render3d:printer-lan-ip";
export const PRINTER_SERIAL_KEY = "render3d:printer-serial";
export const PRINTER_NAME_KEY = "render3d:printer-name";
export const PRINTER_ACCESS_KEY = "render3d:printer-access-code";
export const BAMBU_PROFILE_APPLY_KEY = "render3d:bambu-profile-apply";
export const BAMBU_DEFAULT_VOLUME_MM = [256, 256, 256];
export const PRINTER_LAN_IP_HINT =
  "Optional. Printer screen Settings → Network / WLAN, or Bambu Studio → Device → LAN.";
export const PRINTER_PIN_HINT =
  "Bind with PIN code: type the PIN from the printer screen or Bambu Studio → Device → Bind with PIN code.";
export const DISCORD_VR_HREF = "https://discord.com/channels/@me";

export function xrShareXHref({ url = "", title = "" } = {}) {
  const params = new URLSearchParams();
  const text = String(title || "Render Studio").trim();
  if (text) params.set("text", text);
  const shareUrl = String(url || "").trim();
  if (shareUrl) params.set("url", shareUrl);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function readFlag(storage, key, fallback = false) {
  try {
    const v = storage?.getItem?.(key);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function writeFlag(storage, key, on) {
  try { storage?.setItem?.(key, on ? "1" : "0"); } catch { /* ignore */ }
  return !!on;
}

export function readPrinterLan(storage) {
  const get = (key) => {
    try { return String(storage?.getItem?.(key) || ""); } catch { return ""; }
  };
  return {
    lan_ip: get(PRINTER_LAN_IP_KEY),
    serial: get(PRINTER_SERIAL_KEY),
    name: get(PRINTER_NAME_KEY),
    access_code: get(PRINTER_ACCESS_KEY),
  };
}

export function writePrinterLan(storage, fields = {}) {
  const set = (key, value) => {
    try {
      const text = String(value ?? "");
      if (text) storage?.setItem?.(key, text);
      else storage?.removeItem?.(key);
    } catch { /* ignore */ }
  };
  if (fields.lan_ip != null) set(PRINTER_LAN_IP_KEY, fields.lan_ip);
  if (fields.serial != null) set(PRINTER_SERIAL_KEY, fields.serial);
  if (fields.name != null) set(PRINTER_NAME_KEY, fields.name);
  if (fields.access_code != null) set(PRINTER_ACCESS_KEY, fields.access_code);
  return readPrinterLan(storage);
}

export function accessCodeIsSet(code) {
  return String(code || "").trim().length > 0;
}

export function printerLanLabel(prefs = {}) {
  const ip = String(prefs.lan_ip || prefs.host || "").trim();
  const name = String(prefs.name || "").trim();
  if (name && ip) return `${name} · ${ip}`;
  if (ip) return ip;
  if (name) return name;
  return "not set";
}

export function rightStickShareArmed(gamepad, { handedness = "right" } = {}) {
  if (!gamepad) return false;
  const click = gamepad.buttons?.[SHARE_STICK_CLICK_BUTTON];
  if (click?.pressed || (Number(click?.value) || 0) > 0.5) return true;
  const x = Number(gamepad.axes?.[SHARE_STICK_X_AXIS] ?? 0);
  if (!Number.isFinite(x)) return false;
  if (String(handedness) === "left") return x > SHARE_STICK_IN_THRESHOLD;
  return x < -SHARE_STICK_IN_THRESHOLD;
}

export function printerVolumeBoxM(volumeMm = []) {
  const raw = Array.isArray(volumeMm) ? volumeMm : [];
  const x = Math.max(0.06, (Number(raw[0]) || 0) / 1000);
  const z = Math.max(0.06, (Number(raw[1]) || 0) / 1000);
  const y = Math.max(0.06, (Number(raw[2]) || 0) / 1000);
  if (!(Number(raw[0]) > 0 && Number(raw[1]) > 0 && Number(raw[2]) > 0)) return null;
  return { x, y, z };
}

export function printerVolumeFromProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const specs = profile.specs && typeof profile.specs === "object" ? profile.specs : profile;
  return printerVolumeBoxM(specs.volume_mm || profile.volume_mm);
}

export function xrSharePanelLines({
  friends = [],
  searchHits = [],
  roomPrintTargets = [],
  searchDraft = "",
  acceptSends = false,
  showOutline = false,
  showVrModel = false,
  includeDiscord = true,
  includeX = true,
} = {}) {
  const lines = [
    { id: "", label: "Share project link", kind: "hint", icon: "share" },
    { id: "", label: "Friends", kind: "section", icon: "social" },
  ];
  if (!friends.length) {
    lines.push({ id: "", label: "No friends yet", kind: "hint", icon: "social" });
  }
  for (const f of (friends || []).slice(0, 5)) {
    const id = String(f?.id || "").trim();
    if (!id) continue;
    lines.push({
      id: `share-friend:${id}`,
      label: String(f.display_name || f.handle || f.name || "Friend").slice(0, 28),
      kind: "action",
      icon: "social",
    });
  }
  lines.push({
    id: "share-search",
    label: searchDraft ? `Search · ${String(searchDraft).slice(0, 18)}` : "Search users",
    kind: "action",
    icon: "search",
  });
  for (const u of (searchHits || []).slice(0, 4)) {
    const id = String(u?.id || "").trim();
    if (!id) continue;
    lines.push({
      id: `share-user:${id}`,
      label: String(u.display_name || u.handle || u.name || "User").slice(0, 28),
      kind: "action",
      icon: "social",
    });
  }
  if (includeDiscord) {
    lines.push({ id: "share-discord", label: "Send to Discord", kind: "action", icon: "social" });
  }
  if (includeX) {
    lines.push({ id: "share-x", label: "Share to X", kind: "action", icon: "share" });
  }
  lines.push({ id: "share-bambu", label: "Share to Bambu printer", kind: "action", icon: "bambu" });
  if ((roomPrintTargets || []).length) {
    lines.push({ id: "", label: "Send to their printer", kind: "section", icon: "bambu" });
    for (const u of roomPrintTargets.slice(0, 4)) {
      const id = String(u?.id || "").trim();
      if (!id) continue;
      lines.push({
        id: `print-send:${id}`,
        label: `Print → ${String(u.display_name || u.handle || "User").slice(0, 20)}`,
        kind: "action",
        icon: "bambu",
      });
    }
  }
  lines.push({
    id: "printer_accept",
    label: acceptSends ? "Accept print requests · on" : "Accept print requests · off",
    kind: "toggle",
    active: !!acceptSends,
  });
  lines.push({
    id: "printer_outline",
    label: showOutline ? "Printer outline · on" : "Printer outline · off",
    kind: "toggle",
    active: !!showOutline,
  });
  lines.push({
    id: "printer_vr_model",
    label: showVrModel ? "VR printer model · on" : "VR printer model · off",
    kind: "toggle",
    active: !!showVrModel,
  });
  return lines;
}

export function pickShareThrowTarget({
  origin,
  direction,
  candidates = [],
  maxAngleDeg = 28,
} = {}) {
  const ox = Number(origin?.x);
  const oy = Number(origin?.y);
  const oz = Number(origin?.z);
  const dx = Number(direction?.x);
  const dy = Number(direction?.y);
  const dz = Number(direction?.z);
  if (![ox, oy, oz, dx, dy, dz].every((n) => Number.isFinite(n))) return null;
  const dLen = Math.hypot(dx, dy, dz) || 1;
  const ndx = dx / dLen;
  const ndy = dy / dLen;
  const ndz = dz / dLen;
  const maxCos = Math.cos((Number(maxAngleDeg) || 28) * Math.PI / 180);
  let best = null;
  let bestScore = -1;
  for (const row of candidates) {
    const px = Number(row?.x ?? row?.position?.x);
    const py = Number(row?.y ?? row?.position?.y);
    const pz = Number(row?.z ?? row?.position?.z);
    if (![px, py, pz].every((n) => Number.isFinite(n))) continue;
    const vx = px - ox;
    const vy = py - oy;
    const vz = pz - oz;
    const dist = Math.hypot(vx, vy, vz);
    if (!(dist > 0.08) || dist > 8) continue;
    const cos = (vx * ndx + vy * ndy + vz * ndz) / dist;
    if (cos < maxCos) continue;
    const score = cos * (1 / Math.max(0.35, dist));
    if (score > bestScore) {
      bestScore = score;
      best = { ...row, x: px, y: py, z: pz, dist, score };
    }
  }
  return best;
}

/** Snappy fly then dive — scale collapses in the last ~28% (Hank throw feel). */
export function shareThrowFlight({ from, to, t = 0 } = {}) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const fly = u < 0.72 ? (u / 0.72) : 1;
  const dive = u < 0.72 ? 0 : (u - 0.72) / 0.28;
  const ease = fly * fly * (3 - 2 * fly);
  const fx = Number(from?.x) || 0;
  const fy = Number(from?.y) || 0;
  const fz = Number(from?.z) || 0;
  const tx = Number(to?.x) || 0;
  const ty = Number(to?.y) || 0;
  const tz = Number(to?.z) || 0;
  const lift = Math.sin(Math.min(1, fly) * Math.PI) * 0.28 * (1 - dive);
  return {
    x: fx + (tx - fx) * ease,
    y: fy + (ty - fy) * ease + lift,
    z: fz + (tz - fz) * ease,
    scale: Math.max(0.04, 1 - dive * 0.94),
    dive: dive > 0,
  };
}

export const PRINT_FILAMENT_OPTIONS = ["PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "PLA-CF"];
export const THROW_PRINT_FILAMENTS = ["PETG", "PLA"];
export const THROW_PRINT_CACHE = "throwprint1";
export const PRINT_BOX_CACHE = "xrperf3";
export const PRINTER_FENCE_KEY = "render3d:printer-fence";
export const PRINTER_BOX_OBJECT_ID = "printer-box";

export function printSettingsLines({ filament = "PETG", supports = false } = {}) {
  const fil = String(filament || "PETG").toUpperCase() === "PLA" ? "PLA" : "PETG";
  return [
    { id: "", label: "Print settings", kind: "hint" },
    {
      id: "print-fil:PETG",
      label: fil === "PETG" ? "PETG · selected" : "PETG",
      kind: "toggle",
      active: fil === "PETG",
    },
    {
      id: "print-fil:PLA",
      label: fil === "PLA" ? "PLA · selected" : "PLA",
      kind: "toggle",
      active: fil === "PLA",
    },
    {
      id: "print-supports",
      label: supports ? "Supports · on" : "Supports · off",
      kind: "toggle",
      active: !!supports,
    },
    { id: "print-start", label: "Start print", kind: "action" },
    { id: "print-cancel", label: "Cancel", kind: "action" },
  ];
}

export function applyPrintSettingAction(state = {}, id = "") {
  const next = {
    filament: String(state.filament || "PETG").toUpperCase() === "PLA" ? "PLA" : "PETG",
    supports: !!state.supports,
  };
  const action = String(id || "");
  if (action === "print-fil:PLA") next.filament = "PLA";
  else if (action === "print-fil:PETG") next.filament = "PETG";
  else if (action === "print-supports") next.supports = !next.supports;
  return next;
}

export function printStartPayload({
  filament = "PETG",
  supports = false,
  filename = "",
  project_id = "",
} = {}) {
  return {
    filament: String(filament || "PETG").toUpperCase() === "PLA" ? "PLA" : "PETG",
    supports_enabled: !!supports,
    filename: String(filename || "").slice(0, 200),
    project_id: String(project_id || "").slice(0, 80),
  };
}

export const PRINTER_FENCE_MIN_SPAN_M = 0.08;

export function printerFenceFloorY(headY) {
  const y = Number(headY);
  if (!Number.isFinite(y)) return 0;
  return Math.max(-0.25, y - 1.55);
}

/**
 * Corner sits at the controller tip in passthrough — never a guessed floor plane.
 * Floor snap is what buried the leftover 256 mm box under the tracking floor.
 */
export function printerFencePointFromRay(ray, { tipOffset = 0.04 } = {}) {
  const origin = ray?.origin;
  const dir = ray?.direction;
  const ox = Number(origin?.x ?? origin?.[0]);
  const oy = Number(origin?.y ?? origin?.[1]);
  const oz = Number(origin?.z ?? origin?.[2]);
  const dx = Number(dir?.x ?? dir?.[0]);
  const dy = Number(dir?.y ?? dir?.[1]);
  const dz = Number(dir?.z ?? dir?.[2]);
  if (![ox, oy, oz].every((n) => Number.isFinite(n))) return null;
  const dlen = Math.hypot(dx, dy, dz);
  const off = Number(tipOffset);
  const dist = dlen > 1e-6 && Number.isFinite(off) ? off : 0;
  const ndx = dlen > 1e-6 ? dx / dlen : 0;
  const ndy = dlen > 1e-6 ? dy / dlen : 0;
  const ndz = dlen > 1e-6 ? dz / dlen : 0;
  return { x: ox + ndx * dist, y: oy + ndy * dist, z: oz + ndz * dist };
}

/**
 * User-drawn AABB from two opposite corners. Close clicks return null —
 * never invent a default 256 mm cube.
 */
export function printerFenceFromCorners(a, b, { minSpan = PRINTER_FENCE_MIN_SPAN_M } = {}) {
  const ax = Number(a?.x ?? a?.[0]);
  const ay = Number(a?.y ?? a?.[1]);
  const az = Number(a?.z ?? a?.[2]);
  const bx = Number(b?.x ?? b?.[0]);
  const by = Number(b?.y ?? b?.[1]);
  const bz = Number(b?.z ?? b?.[2]);
  if (![ax, ay, az, bx, by, bz].every((n) => Number.isFinite(n))) return null;
  const width = Math.abs(bx - ax);
  const depth = Math.abs(bz - az);
  const rise = Math.abs(by - ay);
  const min = Math.max(0.04, Number(minSpan) || PRINTER_FENCE_MIN_SPAN_M);
  const span = Math.hypot(width, depth, rise);
  if (!(span >= min)) return null;
  const dims = [width, rise, depth].slice().sort((x, y) => y - x);
  if (dims[1] < min) return null;
  return {
    size: [Math.max(width, min), Math.max(rise, min), Math.max(depth, min)],
    position: [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
    userDrawn: true,
  };
}

export function normalizePrinterFence(raw) {
  const size = raw?.size || raw?.s;
  const pos = raw?.position || raw?.p || raw?.pose?.p;
  if (!Array.isArray(size) || size.length < 3 || !Array.isArray(pos) || pos.length < 3) return null;
  const sx = Number(size[0]);
  const sy = Number(size[1]);
  const sz = Number(size[2]);
  const px = Number(pos[0]);
  const py = Number(pos[1]);
  const pz = Number(pos[2]);
  if (![sx, sy, sz, px, py, pz].every((n) => Number.isFinite(n))) return null;
  if (sx < 0.05 || sy < 0.05 || sz < 0.05 || sx > 4 || sy > 4 || sz > 4) return null;
  if (Math.abs(px) > 40 || Math.abs(py) > 8 || Math.abs(pz) > 40) return null;
  const out = { size: [sx, sy, sz], position: [px, py, pz] };
  const quat = raw?.quaternion || raw?.q || raw?.pose?.q;
  if (Array.isArray(quat) && quat.length >= 4) {
    const q = quat.slice(0, 4).map(Number);
    const mag = Math.hypot(...q);
    if (q.every(Number.isFinite) && mag > 1e-6) out.quaternion = q.map((n) => n / mag);
  }
  if (raw?.pinned === true) out.pinned = true;
  if (raw?.userDrawn === true || raw?.drawn === true) out.userDrawn = true;
  return out;
}

/**
 * Silent default at world origin / tracking floor / 256 mm cube.
 * User-drawn volumes (userDrawn) are kept even if they sit on the real floor.
 */
export function isLeftoverAutoPrinterFence(raw) {
  const n = normalizePrinterFence(raw);
  if (!n) return true;
  if (raw?.userDrawn === true || n.userDrawn === true) return false;
  const [sx, sy, sz] = n.size;
  const [px, py, pz] = n.position;
  const bottom = py - sy / 2;
  const defSize = Math.abs(sx - 0.256) < 0.02
    && Math.abs(sy - 0.256) < 0.02
    && Math.abs(sz - 0.256) < 0.02;
  const defPos = Math.abs(px - 0.55) < 0.15 && Math.abs(pz + 0.72) < 0.15;
  if (defSize && defPos) return true;
  if (bottom < -0.04) return true;
  if (defSize && bottom < 0.12 && Math.hypot(px, pz) < 1.6) return true;
  return false;
}

export function packPrinterBoxMessage(fence, { visible = true } = {}) {
  const n = normalizePrinterFence(fence);
  if (!n) return null;
  return {
    type: "xr.printer",
    object_id: PRINTER_BOX_OBJECT_ID,
    kind: "printer",
    size: n.size,
    position: n.position,
    visible: visible !== false,
    userDrawn: n.userDrawn === true,
    pinned: n.pinned === true,
    quaternion: n.quaternion,
    pose: { p: n.position, q: n.quaternion, s: n.size },
  };
}

export function readPrinterFence(storage) {
  try {
    const raw = storage?.getItem?.(PRINTER_FENCE_KEY);
    if (!raw) return null;
    return normalizePrinterFence(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePrinterFence(storage, fence) {
  const n = normalizePrinterFence(fence);
  try {
    if (n) storage?.setItem?.(PRINTER_FENCE_KEY, JSON.stringify(n));
    else storage?.removeItem?.(PRINTER_FENCE_KEY);
  } catch { /* ignore */ }
  return n;
}

export const PRINT_TAB_CACHE = "printtab=20260916-1";
export const PRINT_BOX2_CACHE = "printbox=20260916-2";

export function printerShareIconVisible({
  acceptSends = false,
  roomShared = false,
  printTargets = 0,
} = {}) {
  return !!(acceptSends || roomShared || Number(printTargets) > 0);
}

export function printerConfigFromStorage(storage) {
  const lan = readPrinterLan(storage);
  return {
    lan_ip: lan.lan_ip,
    access_code: lan.access_code,
    serial: lan.serial,
    name: lan.name,
    access_code_set: accessCodeIsSet(lan.access_code),
    accept_sends: readFlag(storage, PRINTER_ACCEPT_KEY, false),
    show_outline: readFlag(storage, PRINTER_OUTLINE_KEY, false),
    show_model: readFlag(storage, PRINTER_VR_MODEL_KEY, false),
    fence: readPrinterFence(storage),
  };
}

export function applyPrinterConfigFields(storage, fields = {}) {
  writePrinterLan(storage, {
    lan_ip: fields.lan_ip,
    serial: fields.serial,
    name: fields.name,
    access_code: fields.access_code != null ? fields.access_code : fields.pin,
  });
  if (fields.accept_sends != null) writeFlag(storage, PRINTER_ACCEPT_KEY, fields.accept_sends);
  if (fields.show_outline != null) writeFlag(storage, PRINTER_OUTLINE_KEY, fields.show_outline);
  if (fields.show_model != null) writeFlag(storage, PRINTER_VR_MODEL_KEY, fields.show_model);
  if (fields.fence !== undefined) writePrinterFence(storage, fields.fence);
  return printerConfigFromStorage(storage);
}

export function printerPrefsApiBody(fields = {}) {
  const body = {};
  if (fields.accept_sends != null) body.accept_sends = !!fields.accept_sends;
  if (fields.show_outline != null) body.show_outline = !!fields.show_outline;
  if (fields.show_model != null) body.show_model = !!fields.show_model;
  if (fields.lan_ip != null) body.lan_ip = String(fields.lan_ip || "").trim();
  if (fields.access_code != null || fields.pin != null) {
    body.access_code = String(fields.access_code != null ? fields.access_code : fields.pin || "").trim();
  }
  if (fields.serial != null) body.serial = String(fields.serial || "").trim();
  if (fields.name != null) body.name = String(fields.name || "").trim();
  if (fields.fence !== undefined) body.fence = fields.fence;
  return body;
}

export function printerSendPcPayload({ focus = "" } = {}) {
  return {
    type: "printer_send_pc",
    open: "printer-config",
    focus: String(focus || "").trim(),
  };
}

/** Reuse an existing user-drawn fence; otherwise spawn one box in front of the headset. */
export function createBounderFence({ head = {}, existing = null } = {}) {
  const kept = normalizePrinterFence(existing);
  if (kept && !isLeftoverAutoPrinterFence({ ...existing, ...kept })) {
    return { ...kept, userDrawn: true };
  }
  const hx = Number(head.x);
  const hy = Number(head.y);
  const hz = Number(head.z);
  const fx = Number(head.forwardX);
  const fz = Number(head.forwardZ);
  const hasHead = [hx, hy, hz].every((n) => Number.isFinite(n));
  const flen = Math.hypot(Number.isFinite(fx) ? fx : 0, Number.isFinite(fz) ? fz : -1) || 1;
  const ndx = (Number.isFinite(fx) ? fx : 0) / flen;
  const ndz = (Number.isFinite(fz) ? fz : -1) / flen;
  return {
    size: [0.256, 0.256, 0.256],
    position: [
      hasHead ? hx + ndx * 0.85 : 0,
      hasHead ? Math.max(0.18, hy - 0.42) : 0.28,
      hasHead ? hz + ndz * 0.85 : -0.85,
    ],
    userDrawn: true,
  };
}

export function fenceFromBounderMesh({ position, scale } = {}) {
  const px = Number(position?.x ?? position?.[0]);
  const py = Number(position?.y ?? position?.[1]);
  const pz = Number(position?.z ?? position?.[2]);
  const sx = Math.abs(Number(scale?.x ?? scale?.[0]));
  const sy = Math.abs(Number(scale?.y ?? scale?.[1]));
  const sz = Math.abs(Number(scale?.z ?? scale?.[2]));
  return normalizePrinterFence({
    size: [sx, sy, sz],
    position: [px, py, pz],
    userDrawn: true,
  });
}
