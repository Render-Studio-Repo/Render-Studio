/**
 * Low-poly XR avatars + device-on-head props for Social.
 *
 * Mesh source: procedural Kenney / Ready Player Me *lite* proportions
 * (shared BufferGeometry, per-user materials). We do not vendor 50 photoreal
 * HMD GLBs — WebXR Input Profiles CDN still supplies *controllers*.
 * Live Meta Horizon meshes are not available to arbitrary WebXR sites.
 */

export const XR_AVATAR_LS = "render3d:xr-avatar";
export const HORIZON_AVATAR_NOTE =
  "Meta does not expose your live Horizon mesh to this WebXR studio. We save Horizon as your source and use a Quest-styled stand-in.";

/** Shared primitives — not a downloaded character pack. */
export const AVATAR_MESH_SOURCE = "procedural-shared";
export const AVATAR_MESH_LICENSE = "procedural (no third-party mesh). Kenney CC0 / RPM-lite proportions.";

export const AVATAR_SETTINGS_ACTIONS = [
  "avatar",
  "avatar-open",
  "avatar-body-next",
  "avatar-outfit-next",
  "avatar-body-default",
  "avatar-body-slim",
  "avatar-body-tall",
  "avatar-body-athletic",
  "avatar-outfit-studio",
  "avatar-outfit-quest",
  "avatar-outfit-workshop",
  "avatar-outfit-night",
  "avatar-outfit-field",
  "avatar-source-studio",
  "avatar-source-horizon",
  "avatar-source-rpm",
];

export const AVATAR_BODIES = [
  { id: "default", label: "Classic" },
  { id: "slim", label: "Slim" },
  { id: "tall", label: "Tall" },
  { id: "athletic", label: "Athletic" },
];

export const AVATAR_OUTFITS = [
  { id: "studio", label: "Studio", skin: 0xe8b89a, shirt: 0x334155, pants: 0x1e293b, iris: 0x3b82f6, hair: 0x1e293b },
  { id: "quest", label: "Quest", skin: 0xd4a574, shirt: 0x2563eb, pants: 0x111827, iris: 0x1d4ed8, hair: 0x292524 },
  { id: "workshop", label: "Workshop", skin: 0xc68642, shirt: 0xea580c, pants: 0x292524, iris: 0x78350f, hair: 0x1c1917 },
  { id: "night", label: "Night", skin: 0x8d5524, shirt: 0x7c3aed, pants: 0x0f172a, iris: 0x6d28d9, hair: 0x0f172a },
  { id: "field", label: "Field", skin: 0xf1c27d, shirt: 0x16a34a, pants: 0x14532d, iris: 0x166534, hair: 0x44403c },
];

export const AVATAR_SOURCES = [
  { id: "studio", label: "Studio low-poly" },
  { id: "horizon", label: "Horizon (Quest)" },
  { id: "rpm", label: "Ready Player Me style" },
];

/**
 * Few cheap head props — every product name maps here (not unique 5MB HMDs).
 *   Quest 2/3/3S/Pro, Pico, Vive, Index, WMR, Gear VR, generic VR → hmd
 *   Vision Pro / apple-visor → visor
 *   Spectacles, HoloLens, Magic Leap, generic AR glasses → glasses
 *   iPhone / Android phone → phone
 *   PC / desktop / no XR → none
 */
export const DEVICE_PROP_KINDS = ["none", "hmd", "visor", "glasses", "phone"];

export const DEVICE_PROP_MAP = {
  "Quest 3": "hmd",
  "Quest 3S": "hmd",
  "Quest 2": "hmd",
  "Quest Pro": "hmd",
  Quest: "hmd",
  Pico: "hmd",
  Vive: "hmd",
  Index: "hmd",
  "Gear VR": "hmd",
  Odyssey: "hmd",
  WMR: "hmd",
  VR: "hmd",
  "Vision Pro": "visor",
  Spectacles: "glasses",
  HoloLens: "glasses",
  "Magic Leap": "glasses",
  AR: "glasses",
  Phone: "phone",
  PC: "none",
};

/**
 * WebXR Input Profiles used for *controllers* (jsdelivr assets already in viewport-xr).
 * HMDs use the small procedural set above — do not fetch 40 headset GLBs.
 */
export const XR_INPUT_PROFILES = [
  "generic-trigger-squeeze-touchpad-thumbstick",
  "generic-button",
  "oculus-touch",
  "oculus-touch-v2",
  "oculus-touch-v3",
  "meta-quest-touch-plus",
  "meta-quest-touch-pro",
  "htc-vive",
  "htc-vive-cosmos",
  "htc-vive-focus-3",
  "valve-index",
  "pico-neo",
  "pico-neo3",
  "pico-4",
  "magicleap-one",
  "microsoft-mixed-reality",
  "windows-mixed-reality",
  "samsung-gearvr",
  "samsung-odyssey",
  "apple-visor",
  "snap-spectacles",
];

export const BLINK_MIN_MS = 2000;
export const BLINK_MAX_MS = 5000;
export const BLINK_CLOSE_MS = 70;
export const BLINK_HOLD_MS = 40;
export const BLINK_OPEN_MS = 90;

const BODY_IDS = new Set(AVATAR_BODIES.map((b) => b.id));
const OUTFIT_IDS = new Set(AVATAR_OUTFITS.map((o) => o.id));
const SOURCE_IDS = new Set(AVATAR_SOURCES.map((s) => s.id));
const PROP_IDS = new Set(DEVICE_PROP_KINDS);

const DEVICE_MAX = 24;

let _geos = null;
let _geoTHREE = null;

export function sanitizeXrDevice(raw) {
  const s = String(raw || "")
    .replace(/[^\w .+_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DEVICE_MAX);
  return s;
}

export function sanitizeXrMode(raw) {
  const m = String(raw || "").trim().toLowerCase();
  return m === "ar" || m === "vr" ? m : "";
}

export function sanitizeXrProp(raw) {
  const k = String(raw || "").trim().toLowerCase();
  return PROP_IDS.has(k) ? k : "";
}

export function isQuestUserAgent(ua = "") {
  return /OculusBrowser|MetaBrowser|HorizonOS|Quest/i.test(String(ua || ""));
}

export function defaultAvatarSpec() {
  return { source: "studio", body: "default", outfit: "studio" };
}

export function normalizeAvatarSpec(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const source = SOURCE_IDS.has(row.source) ? row.source : "studio";
  const body = BODY_IDS.has(row.body) ? row.body : "default";
  const outfit = OUTFIT_IDS.has(row.outfit) ? row.outfit : "studio";
  return { source, body, outfit };
}

export function avatarSpecKey(spec) {
  const n = normalizeAvatarSpec(spec);
  return `${n.source}:${n.body}:${n.outfit}`;
}

export function compactAvatarForPose(spec) {
  const n = normalizeAvatarSpec(spec);
  return { source: n.source, body: n.body, outfit: n.outfit };
}

export function parseAvatarFromPose(pose) {
  const row = pose?.avatar || pose?.avatarSpec || pose;
  if (!row || typeof row !== "object") return defaultAvatarSpec();
  return normalizeAvatarSpec(row);
}

export function avatarStorageKey(userId) {
  const id = String(userId || "").trim() || "anon";
  return `${XR_AVATAR_LS}:${id}`;
}

export function loadAvatarSpec(userId, storage = null) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const raw = store?.getItem?.(avatarStorageKey(userId));
    if (!raw) return defaultAvatarSpec();
    return normalizeAvatarSpec(JSON.parse(raw));
  } catch {
    return defaultAvatarSpec();
  }
}

export function saveAvatarSpec(userId, spec, storage = null) {
  const next = normalizeAvatarSpec(spec);
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    store?.setItem?.(avatarStorageKey(userId), JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

export function bodyById(id) {
  return AVATAR_BODIES.find((b) => b.id === id) || AVATAR_BODIES[0];
}

export function outfitById(id) {
  return AVATAR_OUTFITS.find((o) => o.id === id) || AVATAR_OUTFITS[0];
}

export function sourceById(id) {
  return AVATAR_SOURCES.find((s) => s.id === id) || AVATAR_SOURCES[0];
}

export function cycleAvatarBody(spec) {
  const cur = normalizeAvatarSpec(spec);
  const i = Math.max(0, AVATAR_BODIES.findIndex((b) => b.id === cur.body));
  return normalizeAvatarSpec({ ...cur, body: AVATAR_BODIES[(i + 1) % AVATAR_BODIES.length].id });
}

export function cycleAvatarOutfit(spec) {
  const cur = normalizeAvatarSpec(spec);
  const i = Math.max(0, AVATAR_OUTFITS.findIndex((o) => o.id === cur.outfit));
  return normalizeAvatarSpec({ ...cur, outfit: AVATAR_OUTFITS[(i + 1) % AVATAR_OUTFITS.length].id });
}

export function applyAvatarSource(spec, source) {
  const cur = normalizeAvatarSpec(spec);
  const next = SOURCE_IDS.has(source) ? source : "studio";
  const outfit = next === "horizon" ? "quest" : cur.outfit;
  return normalizeAvatarSpec({ ...cur, source: next, outfit });
}

export function canLinkHorizon({ userAgent = "", presenting = false, profiles = [] } = {}) {
  if (isQuestUserAgent(userAgent)) return true;
  const blob = (profiles || []).join(" ").toLowerCase();
  if (/oculus|meta-quest|quest/.test(blob)) return true;
  return !!presenting && /quest|oculus/i.test(blob);
}

export function avatarSettingsLines(spec, { quest = false } = {}) {
  const n = normalizeAvatarSpec(spec);
  const body = bodyById(n.body);
  const outfit = outfitById(n.outfit);
  const horizonOn = n.source === "horizon";
  const rpmOn = n.source === "rpm";
  const lines = [
    { id: "avatar-body-next", label: `Body · ${body.label}`, kind: "action", icon: "move", active: true },
    { id: "avatar-outfit-next", label: `Outfit · ${outfit.label}`, kind: "action", icon: "front", active: true },
    { id: "avatar-source-studio", label: "Studio low-poly", kind: "action", icon: "front", active: n.source === "studio" },
    {
      id: "avatar-source-rpm",
      label: rpmOn ? "Ready Player Me style" : "Ready Player Me style",
      kind: "action",
      icon: "social",
      active: rpmOn,
    },
    {
      id: "avatar-source-horizon",
      label: horizonOn ? "Horizon (Quest) · selected" : "Use Meta Horizon avatar",
      kind: "action",
      icon: "social",
      active: horizonOn,
    },
  ];
  if (horizonOn || quest) {
    lines.push({
      id: "",
      label: quest
        ? "Live Horizon mesh is not available here"
        : "Horizon link is for Quest headsets",
      kind: "hint",
      icon: "ai",
    });
  }
  return lines;
}

function profilesBlob(profiles) {
  return (Array.isArray(profiles) ? profiles : []).join(" ").toLowerCase();
}

/**
 * True for physical XR controllers (Touch, Vive, Index, Pico, …).
 * Hand-only profile names are excluded — those devices fall back to rays / pinch.
 */
export function isXrStandardControllerProfile(profile) {
  const p = String(profile || "").toLowerCase();
  if (!p) return false;
  if (/hand/i.test(p) && !/touch|controller|gamepad|vive|index|pico|visor|spectacles|magicleap/i.test(p)) {
    return false;
  }
  if (XR_INPUT_PROFILES.some((id) => p === id || p.includes(id))) return true;
  return /oculus-touch|meta-quest-touch|touch-plus|touch-pro|pico-controller|pico-4|htc-vive|valve-index|mixed-reality|windows-mixed|samsung-gearvr|samsung-odyssey|apple-visor|snap-spectacles|magicleap/i.test(p);
}

/** Don't advertise hand tracking on Vive wands / Index / Gear VR / desktop. */
export function deviceSupportsHandTracking(label = "") {
  const blob = String(label || "").toLowerCase();
  if (/quest|vision|spectacles|magic leap|hololens|pico 4|pico$/.test(blob)) return true;
  return false;
}

/**
 * Map a product name / kind → one of none | hmd | visor | glasses | phone.
 */
export function avatarDeviceProp(kind, extra = {}) {
  const explicit = sanitizeXrProp(kind);
  if (explicit) return explicit;
  const label = String(kind || extra.label || "").trim();
  if (DEVICE_PROP_MAP[label]) return DEVICE_PROP_MAP[label];
  const blob = `${label} ${extra.userAgent || ""} ${(extra.profiles || []).join(" ")}`.toLowerCase();
  const mode = sanitizeXrMode(extra.mode || extra.xrMode);
  if (/iphone|ipad|phone/.test(blob) && !/quest|oculus|pico|vive|index/.test(blob)) return "phone";
  if (/desktop|macintosh|windows nt|\bpc\b|laptop|cros|linux x86/.test(blob) && !/quest|vive|index|pico|visor|spectacles/.test(blob) && mode !== "vr" && mode !== "ar") {
    return "none";
  }
  if (/desktop|\bpc\b|laptop/.test(String(kind || "").toLowerCase()) && !/quest|vive|index|pico|vr/.test(blob)) return "none";
  if (/spectacle|hololens|holo.?lens|magic.?leap|ar glasses/.test(blob)) return "glasses";
  if (/^ar$/.test(String(kind || "").toLowerCase()) || (mode === "ar" && !/quest|pico|vive|index/.test(blob))) return "glasses";
  if (/vision.?pro|apple-visor|\bvisor\b/.test(blob)) return "visor";
  if (/quest|pico|vive|index|hmd|\bvr\b|gear.?vr|odyssey|wmr|mixed.?reality|oculus/.test(blob)) return "hmd";
  if (/macintosh|windows nt|cros|linux x86/.test(blob) && !/mobile|quest|vive/.test(blob)) return "none";
  if (mode === "vr") return "hmd";
  return "none";
}

/**
 * UA / XR session → Social badge + head prop.
 * Controllers still come from @webxr-input-profiles/assets (viewport-xr).
 */
export function xrHeadsetFromUa({
  userAgent = "",
  profiles = [],
  xrMode = "",
  presenting = false,
  hasXr = false,
} = {}) {
  const detected = detectXrDevice({ userAgent, profiles, xrMode, presenting, hasXr });
  const prop = avatarDeviceProp(detected.label, {
    mode: detected.mode,
    userAgent,
    profiles,
  });
  return { ...detected, prop };
}

/**
 * Map UA / XR session → short Social badge (Quest 3, PC, …).
 */
export function detectXrDevice({
  userAgent = "",
  profiles = [],
  xrMode = "",
  presenting = false,
  hasXr = false,
} = {}) {
  const ua = String(userAgent || "");
  const blob = `${ua} ${profilesBlob(profiles)}`;
  const mode = sanitizeXrMode(xrMode);
  let label = "";

  if (/Quest\s*3S|Quest3S/i.test(blob)) label = "Quest 3S";
  else if (/Quest\s*Pro/i.test(blob) || /meta-quest-touch-pro/.test(blob)) label = "Quest Pro";
  else if (/Quest\s*3(?!\s*S)/i.test(blob) || /meta-quest-touch-plus/.test(blob)) label = "Quest 3";
  else if (/Quest\s*2/i.test(blob) || /oculus-touch-v3/.test(blob)) label = "Quest 2";
  else if (/PicoBrowser|Pico\s*(4|Neo|G3)|PicoNeo|pico-neo|pico-4/i.test(blob)) label = "Pico";
  else if (/VisionOS|AppleVisionPro|RealityApp|apple-visor/i.test(blob)) label = "Vision Pro";
  else if (/snap-spectacles|Spectacles/i.test(blob)) label = "Spectacles";
  else if (/HoloLens|Hololens/i.test(blob)) label = "HoloLens";
  else if (/MagicLeap|Magic Leap|magicleap/i.test(blob)) label = "Magic Leap";
  else if (/valve-index|Knuckles/i.test(blob)) label = "Index";
  else if (/htc-vive|VivePro|Vive XR|Vive Focus|Vive Cosmos/i.test(blob) || (/Vive/i.test(blob) && /htc|vive-focus|vive-cosmos/i.test(blob))) label = "Vive";
  else if (/samsung-odyssey|samsung-gearvr|Gear VR/i.test(blob)) label = "Gear VR";
  else if (/windows-mixed|microsoft-mixed-reality/i.test(blob)) label = "WMR";
  else if (isQuestUserAgent(ua) || /oculus|meta-quest/.test(blob)) label = "Quest";
  else if (!isQuestUserAgent(ua) && /iPhone|iPad|Android.+Mobile|Mobile Safari/i.test(ua) && !/Oculus|Quest|Pico/i.test(blob)) label = "Phone";
  else if (mode === "ar" || /Snapchat|Hololens/i.test(blob)) label = "AR";
  else if (presenting || hasXr || mode === "vr") {
    if (/valve-index/.test(blob)) label = "Index";
    else if (/htc-vive/.test(blob)) label = "Vive";
    else if (/Macintosh|Windows NT|CrOS|Linux x86_64/i.test(ua) && !/Mobile/i.test(ua) && !profilesBlob(profiles)) {
      label = "PC";
    } else if (/Macintosh|Windows NT|CrOS|Linux x86_64/i.test(ua) && !/Mobile/i.test(ua) && !/(touch|vive|index|pico|quest|oculus|wmr|visor)/i.test(blob)) {
      label = "PC";
    } else {
      label = "VR";
    }
  }
  else if (ua) label = "PC";

  if (!label && mode === "ar") label = "AR";
  if (!label && (presenting || mode === "vr")) label = "VR";

  if (label === "VR" && mode === "ar") label = "AR";
  if (label === "Quest 3" && /Quest\s*3S/i.test(blob)) label = "Quest 3S";

  return {
    label: sanitizeXrDevice(label),
    mode: mode || (label === "AR" || label === "Spectacles" || label === "HoloLens" || label === "Magic Leap"
      ? "ar"
      : label && label !== "PC" && label !== "Phone" ? "vr" : ""),
  };
}

export function deviceLabelFromUser(user) {
  const direct = sanitizeXrDevice(user?.xr_device || user?.xrDevice || user?.device);
  if (direct) return direct;
  const fromPose = sanitizeXrDevice(user?.xrPose?.xr_device || user?.xr_pose?.xr_device);
  if (fromPose) return fromPose;
  const mode = sanitizeXrMode(user?.xr_mode || user?.xrMode || user?.xrPose?.xr_mode);
  if (user?.inXr || user?.xrPose) return mode === "ar" ? "AR" : "VR";
  return "";
}

export function devicePropFromUser(user) {
  const explicit = sanitizeXrProp(user?.xr_prop || user?.xrPose?.xr_prop || user?.xr_pose?.xr_prop);
  if (explicit) return explicit;
  const label = deviceLabelFromUser(user);
  const mode = sanitizeXrMode(user?.xr_mode || user?.xrMode || user?.xrPose?.xr_mode);
  return avatarDeviceProp(label, { mode });
}

export function formatNameWithDevice(name, user) {
  const n = String(name || "Person").trim() || "Person";
  const d = deviceLabelFromUser(user);
  return d ? `${n}  ·  ${d}` : n;
}

export function paletteForSpec(spec) {
  const n = normalizeAvatarSpec(spec);
  const outfit = { ...outfitById(n.outfit) };
  if (n.source === "horizon") {
    outfit.skin = 0xd4a574;
    outfit.shirt = 0x0064e0;
    outfit.pants = 0x0b1220;
    outfit.hair = 0x1e293b;
    outfit.visor = 0x0f172a;
  } else if (n.source === "rpm") {
    outfit.visor = null;
  }
  return {
    ...n,
    ...outfit,
    visor: n.source === "rpm" ? 0x111827 : (outfit.visor ?? 0x111827),
    iris: outfit.iris ?? 0x3b82f6,
    hair: outfit.hair ?? 0x1e293b,
  };
}

export function nextBlinkDelay(rand = Math.random) {
  const u = Math.min(1, Math.max(0, Number(typeof rand === "function" ? rand() : rand) || 0));
  return BLINK_MIN_MS + (BLINK_MAX_MS - BLINK_MIN_MS) * u;
}

/** 1 = eyes open, ~0.08 = closed. `elapsedMs` from blink start. */
export function blinkLidScale(elapsedMs) {
  const t = Number(elapsedMs);
  const total = BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS;
  if (!Number.isFinite(t) || t <= 0) return 1;
  if (t < BLINK_CLOSE_MS) return 1 - 0.92 * (t / BLINK_CLOSE_MS);
  if (t < BLINK_CLOSE_MS + BLINK_HOLD_MS) return 0.08;
  if (t < total) {
    const u = (t - BLINK_CLOSE_MS - BLINK_HOLD_MS) / BLINK_OPEN_MS;
    return 0.08 + 0.92 * u;
  }
  return 1;
}

function bodyScale(bodyId) {
  if (bodyId === "slim") return { torso: [0.82, 1.02, 0.86], limb: 0.9, head: 0.94 };
  if (bodyId === "tall") return { torso: [0.92, 1.14, 0.92], limb: 1.08, head: 0.96 };
  if (bodyId === "athletic") return { torso: [1.16, 1.04, 1.1], limb: 1.06, head: 1.02 };
  return { torso: [1, 1, 1], limb: 1, head: 1 };
}

function stdMat(THREE, color, extra = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: extra.roughness ?? 0.55,
    metalness: extra.metalness ?? 0.04,
    emissive: extra.emissiveColor != null ? new THREE.Color(extra.emissiveColor) : c,
    emissiveIntensity: extra.emissive ?? 0.12,
  });
}

function markShared(geo) {
  if (geo && geo.userData) geo.userData.xrShared = true;
  return geo;
}

function sharedGeos(THREE) {
  if (_geos && _geoTHREE === THREE) return _geos;
  _geoTHREE = THREE;
  const torsoGeo = THREE.CapsuleGeometry
    ? new THREE.CapsuleGeometry(0.1, 0.30, 4, 10)
    : new THREE.CylinderGeometry(0.1, 0.12, 0.40, 10);
  _geos = {
    head: markShared(new THREE.SphereGeometry(0.088, 16, 12)),
    ear: markShared(new THREE.SphereGeometry(0.016, 8, 6)),
    neck: markShared(new THREE.CylinderGeometry(0.026, 0.032, 0.055, 8)),
    hair: markShared(new THREE.SphereGeometry(0.092, 12, 10)),
    torso: markShared(torsoGeo),
    collar: markShared(new THREE.TorusGeometry(0.078, 0.014, 6, 12)),
    hips: markShared(new THREE.SphereGeometry(0.092, 10, 8)),
    leg: markShared(new THREE.CylinderGeometry(0.034, 0.028, 0.50, 8)),
    shoe: markShared(new THREE.BoxGeometry(0.068, 0.038, 0.12)),
    arm: markShared(new THREE.CylinderGeometry(0.026, 0.022, 0.40, 8)),
    hand: markShared(new THREE.SphereGeometry(0.028, 8, 6)),
    eye: markShared(new THREE.SphereGeometry(0.015, 10, 8)),
    iris: markShared(new THREE.SphereGeometry(0.0085, 8, 6)),
    pupil: markShared(new THREE.SphereGeometry(0.0036, 6, 4)),
    lid: markShared(new THREE.SphereGeometry(0.017, 8, 6)),
    brow: markShared(new THREE.BoxGeometry(0.026, 0.005, 0.008)),
    hmd: markShared(new THREE.BoxGeometry(0.16, 0.068, 0.078)),
    hmdLens: markShared(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 12)),
    hmdCam: markShared(new THREE.BoxGeometry(0.018, 0.014, 0.016)),
    strap: markShared(new THREE.TorusGeometry(0.09, 0.011, 6, 14, Math.PI)),
    visor: markShared(new THREE.BoxGeometry(0.18, 0.055, 0.042)),
    visorLight: markShared(new THREE.BoxGeometry(0.16, 0.006, 0.006)),
    glassRim: markShared(new THREE.TorusGeometry(0.022, 0.004, 6, 12)),
    glassLens: markShared(new THREE.CircleGeometry(0.018, 12)),
    glassArm: markShared(new THREE.BoxGeometry(0.004, 0.004, 0.09)),
    glassBridge: markShared(new THREE.BoxGeometry(0.018, 0.004, 0.004)),
    phone: markShared(new THREE.BoxGeometry(0.068, 0.142, 0.009)),
    phoneScreen: markShared(new THREE.BoxGeometry(0.058, 0.124, 0.002)),
  };
  return _geos;
}

function paintMesh(mesh, color, vis = true) {
  if (!mesh) return;
  mesh.visible = vis !== false;
  if (mesh.material?.color && color != null) {
    mesh.material.color.setHex(color);
    if (mesh.material.emissive && mesh.material.userData?.keepEmissive !== true) {
      mesh.material.emissive.setHex(color);
    }
  }
}

export function paintHumanoid(root, spec, THREE) {
  if (!root?.userData) return;
  const pal = paletteForSpec(spec);
  const scale = bodyScale(pal.body);
  root.userData.avatarKey = avatarSpecKey(spec);
  paintMesh(root.userData.head, pal.skin);
  paintMesh(root.userData.earL, pal.skin);
  paintMesh(root.userData.earR, pal.skin);
  paintMesh(root.userData.neck, pal.skin);
  paintMesh(root.userData.torso, pal.shirt);
  paintMesh(root.userData.collar, pal.shirt);
  paintMesh(root.userData.hips, pal.pants);
  paintMesh(root.userData.legL, pal.pants);
  paintMesh(root.userData.legR, pal.pants);
  paintMesh(root.userData.armL, pal.shirt);
  paintMesh(root.userData.armR, pal.shirt);
  paintMesh(root.userData.handL, pal.skin);
  paintMesh(root.userData.handR, pal.skin);
  paintMesh(root.userData.shoeL, pal.pants);
  paintMesh(root.userData.shoeR, pal.pants);
  paintMesh(root.userData.hair, pal.hair ?? 0x1e293b, pal.source !== "rpm");
  paintMesh(root.userData.irisL, pal.iris ?? 0x3b82f6);
  paintMesh(root.userData.irisR, pal.iris ?? 0x3b82f6);
  paintMesh(root.userData.browL, pal.hair ?? 0x1e293b);
  paintMesh(root.userData.browR, pal.hair ?? 0x1e293b);
  paintMesh(root.userData.lidL, pal.skin);
  paintMesh(root.userData.lidR, pal.skin);
  const hmdTint = pal.source === "horizon" ? 0x0b1220 : (pal.visor || 0x111827);
  paintMesh(root.userData.props?.hmd, hmdTint);
  paintMesh(root.userData.props?.visor, 0x1e293b);
  if (root.userData.torso) {
    const t = scale.torso;
    root.userData.torso.scale.set(t[0], t[1], t[2]);
  }
  if (root.userData.headAnchor) root.userData.headAnchor.scale.setScalar(scale.head);
  void THREE;
}

function applyLidAmount(root, amount) {
  const a = Math.max(0.08, Math.min(1, Number(amount) || 1));
  const closed = 1 - a;
  const sy = 0.14 + 0.9 * closed;
  for (const lid of [root.userData.lidL, root.userData.lidR]) {
    if (!lid) continue;
    const baseY = Number(lid.userData.baseY) || 0.086;
    lid.scale.set(1.05, sy, 0.88);
    lid.position.y = baseY + 0.017 * (1 - sy);
  }
}

/** Cheap blink: scale eyelid meshes. Never mutates overlay / HUD materials. */
export function tickAvatarBlink(root, nowMs) {
  if (!root?.userData?.lidL) return;
  const ud = root.userData;
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return;
  if (!ud.nextBlinkAt) ud.nextBlinkAt = now + nextBlinkDelay();
  if (ud.blinkStartedAt == null && now < ud.nextBlinkAt) {
    if (ud.lidAmount !== 1) {
      applyLidAmount(root, 1);
      ud.lidAmount = 1;
    }
    return;
  }
  if (ud.blinkStartedAt == null) ud.blinkStartedAt = now;
  const amount = blinkLidScale(now - ud.blinkStartedAt);
  if (ud.lidAmount !== amount) {
    applyLidAmount(root, amount);
    ud.lidAmount = amount;
  }
  if (amount >= 1 && now - ud.blinkStartedAt > BLINK_CLOSE_MS + BLINK_HOLD_MS + BLINK_OPEN_MS) {
    ud.blinkStartedAt = null;
    ud.nextBlinkAt = now + nextBlinkDelay();
  }
}

export function setAvatarDeviceProp(root, kind) {
  const prop = avatarDeviceProp(kind);
  if (!root?.userData?.props) return prop;
  if (root.userData.deviceProp === prop) return prop;
  root.userData.deviceProp = prop;
  const props = root.userData.props;
  for (const key of DEVICE_PROP_KINDS) {
    const node = props[key];
    if (node) node.visible = key === prop && prop !== "none";
  }
  return prop;
}

function buildDeviceProps(THREE, geos, pal) {
  const wrap = new THREE.Group();
  wrap.name = "xr-avatar-device-props";

  const hmd = new THREE.Group();
  hmd.name = "prop-hmd";
  const hmdShell = new THREE.Mesh(geos.hmd, stdMat(THREE, pal.visor || 0x111827, { roughness: 0.32, metalness: 0.18, emissive: 0.06 }));
  hmdShell.position.set(0, 0.01, -0.072);
  const lensMat = stdMat(THREE, 0x38bdf8, { roughness: 0.18, metalness: 0.4, emissive: 0.22, emissiveColor: 0x0ea5e9 });
  lensMat.userData.keepEmissive = true;
  const lensL = new THREE.Mesh(geos.hmdLens, lensMat);
  const lensR = new THREE.Mesh(geos.hmdLens, lensMat.clone());
  lensL.rotation.x = Math.PI / 2;
  lensR.rotation.x = Math.PI / 2;
  lensL.position.set(-0.032, 0.01, -0.112);
  lensR.position.set(0.032, 0.01, -0.112);
  const camL = new THREE.Mesh(geos.hmdCam, stdMat(THREE, 0x0f172a, { roughness: 0.4, metalness: 0.3, emissive: 0.04 }));
  const camR = new THREE.Mesh(geos.hmdCam, stdMat(THREE, 0x0f172a, { roughness: 0.4, metalness: 0.3, emissive: 0.04 }));
  camL.position.set(-0.072, 0.028, -0.092);
  camR.position.set(0.072, 0.028, -0.092);
  const strap = new THREE.Mesh(geos.strap, stdMat(THREE, 0x1e293b, { roughness: 0.7, emissive: 0.04 }));
  strap.rotation.y = Math.PI / 2;
  strap.rotation.z = Math.PI / 2;
  hmd.add(hmdShell, lensL, lensR, camL, camR, strap);
  hmd.visible = false;

  const visor = new THREE.Group();
  visor.name = "prop-visor";
  const visorShell = new THREE.Mesh(geos.visor, stdMat(THREE, 0x1e293b, { roughness: 0.22, metalness: 0.35, emissive: 0.08 }));
  visorShell.position.set(0, 0.012, -0.07);
  const visorLight = new THREE.Mesh(
    geos.visorLight,
    stdMat(THREE, 0xe2e8f0, { roughness: 0.2, metalness: 0.5, emissive: 0.45, emissiveColor: 0xf8fafc }),
  );
  visorLight.material.userData.keepEmissive = true;
  visorLight.position.set(0, 0.038, -0.088);
  const visorStrap = new THREE.Mesh(geos.strap, stdMat(THREE, 0xf1f5f9, { roughness: 0.75, emissive: 0.05 }));
  visorStrap.rotation.y = Math.PI / 2;
  visorStrap.rotation.z = Math.PI / 2;
  visor.add(visorShell, visorLight, visorStrap);
  visor.visible = false;

  const glasses = new THREE.Group();
  glasses.name = "prop-glasses";
  const rimMat = stdMat(THREE, 0x0f172a, { roughness: 0.35, metalness: 0.25, emissive: 0.05 });
  const lensGlass = stdMat(THREE, 0x38bdf8, { roughness: 0.12, metalness: 0.2, emissive: 0.18, emissiveColor: 0x7dd3fc });
  lensGlass.transparent = true;
  lensGlass.opacity = 0.35;
  lensGlass.side = THREE.DoubleSide;
  lensGlass.userData.keepEmissive = true;
  const rimL = new THREE.Mesh(geos.glassRim, rimMat);
  const rimR = new THREE.Mesh(geos.glassRim, rimMat.clone());
  rimL.position.set(-0.028, 0.012, -0.078);
  rimR.position.set(0.028, 0.012, -0.078);
  const glL = new THREE.Mesh(geos.glassLens, lensGlass);
  const glR = new THREE.Mesh(geos.glassLens, lensGlass.clone());
  glL.position.set(-0.028, 0.012, -0.078);
  glR.position.set(0.028, 0.012, -0.078);
  glL.rotation.y = Math.PI;
  glR.rotation.y = Math.PI;
  const bridge = new THREE.Mesh(geos.glassBridge, rimMat.clone());
  bridge.position.set(0, 0.014, -0.078);
  const armL = new THREE.Mesh(geos.glassArm, rimMat.clone());
  const armR = new THREE.Mesh(geos.glassArm, rimMat.clone());
  armL.position.set(-0.048, 0.01, -0.038);
  armR.position.set(0.048, 0.01, -0.038);
  glasses.add(rimL, rimR, glL, glR, bridge, armL, armR);
  glasses.visible = false;

  const phone = new THREE.Group();
  phone.name = "prop-phone";
  const body = new THREE.Mesh(geos.phone, stdMat(THREE, 0x111827, { roughness: 0.28, metalness: 0.4, emissive: 0.05 }));
  const screen = new THREE.Mesh(
    geos.phoneScreen,
    stdMat(THREE, 0x38bdf8, { roughness: 0.2, metalness: 0.1, emissive: 0.35, emissiveColor: 0x38bdf8 }),
  );
  screen.material.userData.keepEmissive = true;
  screen.position.z = -0.0055;
  body.position.set(0, -0.01, -0.14);
  screen.position.set(0, -0.01, -0.146);
  phone.add(body, screen);
  phone.visible = false;

  wrap.add(hmd, visor, glasses, phone);
  return { wrap, props: { none: null, hmd, visor, glasses, phone } };
}

/**
 * Neck-origin humanoid (meters). Head at +0.1 Y so it can sit under the live headset pose.
 * Shared geometry, per-user materials. Eyes + lids for a cheap blink.
 */
export function buildProceduralHumanoid(THREE, spec, opts = {}) {
  const pal = paletteForSpec(spec);
  const geos = sharedGeos(THREE);
  const g = new THREE.Group();
  g.name = "xr-avatar-humanoid";

  const headAnchor = new THREE.Group();
  headAnchor.name = "xr-avatar-head";
  const head = new THREE.Mesh(geos.head, stdMat(THREE, pal.skin));
  head.scale.set(0.96, 1.06, 0.94);
  head.position.y = 0.08;
  const earL = new THREE.Mesh(geos.ear, stdMat(THREE, pal.skin));
  const earR = new THREE.Mesh(geos.ear, stdMat(THREE, pal.skin));
  earL.position.set(-0.078, 0.08, 0);
  earR.position.set(0.078, 0.08, 0);
  const hair = new THREE.Mesh(geos.hair, stdMat(THREE, pal.hair ?? 0x1e293b, { roughness: 0.75, emissive: 0.05 }));
  hair.scale.set(1.02, 0.62, 0.98);
  hair.position.set(0, 0.13, -0.004);
  hair.visible = pal.source !== "rpm";

  const eyeL = new THREE.Mesh(geos.eye, stdMat(THREE, 0xf8fafc, { roughness: 0.35, emissive: 0.08 }));
  const eyeR = new THREE.Mesh(geos.eye, stdMat(THREE, pal.source === "rpm" ? 0xf8fafc : 0xf8fafc, { roughness: 0.35, emissive: 0.08 }));
  eyeL.position.set(-0.028, 0.086, -0.072);
  eyeR.position.set(0.028, 0.086, -0.072);
  const irisL = new THREE.Mesh(geos.iris, stdMat(THREE, pal.iris ?? 0x3b82f6, { roughness: 0.28, emissive: 0.16 }));
  const irisR = new THREE.Mesh(geos.iris, stdMat(THREE, pal.iris ?? 0x3b82f6, { roughness: 0.28, emissive: 0.16 }));
  irisL.position.set(-0.028, 0.086, -0.084);
  irisR.position.set(0.028, 0.086, -0.084);
  const pupilL = new THREE.Mesh(geos.pupil, stdMat(THREE, 0x0f172a, { roughness: 0.4, emissive: 0.04 }));
  const pupilR = new THREE.Mesh(geos.pupil, stdMat(THREE, 0x0f172a, { roughness: 0.4, emissive: 0.04 }));
  pupilL.position.set(-0.028, 0.086, -0.09);
  pupilR.position.set(0.028, 0.086, -0.09);

  const lidL = new THREE.Mesh(geos.lid, stdMat(THREE, pal.skin, { roughness: 0.55, emissive: 0.08 }));
  const lidR = new THREE.Mesh(geos.lid, stdMat(THREE, pal.skin, { roughness: 0.55, emissive: 0.08 }));
  lidL.position.copy(eyeL.position);
  lidR.position.copy(eyeR.position);
  lidL.userData.baseY = eyeL.position.y;
  lidR.userData.baseY = eyeR.position.y;
  const browL = new THREE.Mesh(geos.brow, stdMat(THREE, pal.hair ?? 0x1e293b, { roughness: 0.7, emissive: 0.05 }));
  const browR = new THREE.Mesh(geos.brow, stdMat(THREE, pal.hair ?? 0x1e293b, { roughness: 0.7, emissive: 0.05 }));
  browL.position.set(-0.028, 0.108, -0.074);
  browR.position.set(0.028, 0.108, -0.074);

  const { wrap: propWrap, props } = buildDeviceProps(THREE, geos, pal);
  headAnchor.add(head, earL, earR, hair, eyeL, eyeR, irisL, irisR, pupilL, pupilR, lidL, lidR, browL, browR, propWrap);

  const neck = new THREE.Mesh(geos.neck, stdMat(THREE, pal.skin));
  neck.position.y = -0.012;
  const torso = new THREE.Mesh(geos.torso, stdMat(THREE, pal.shirt));
  torso.position.y = -0.24;
  const collar = new THREE.Mesh(geos.collar, stdMat(THREE, pal.shirt, { roughness: 0.5, emissive: 0.1 }));
  collar.rotation.x = Math.PI / 2;
  collar.position.y = -0.06;
  const hips = new THREE.Mesh(geos.hips, stdMat(THREE, pal.pants));
  hips.position.y = -0.44;
  const legL = new THREE.Mesh(geos.leg, stdMat(THREE, pal.pants));
  const legR = new THREE.Mesh(geos.leg, stdMat(THREE, pal.pants));
  legL.position.set(-0.052, -0.72, 0);
  legR.position.set(0.052, -0.72, 0);
  const shoeL = new THREE.Mesh(geos.shoe, stdMat(THREE, pal.pants, { roughness: 0.65, emissive: 0.05 }));
  const shoeR = new THREE.Mesh(geos.shoe, stdMat(THREE, pal.pants, { roughness: 0.65, emissive: 0.05 }));
  shoeL.position.set(-0.052, -0.98, 0.018);
  shoeR.position.set(0.052, -0.98, 0.018);
  const armL = new THREE.Mesh(geos.arm, stdMat(THREE, pal.shirt));
  const armR = new THREE.Mesh(geos.arm, stdMat(THREE, pal.shirt));
  armL.position.set(-0.16, -0.22, 0);
  armR.position.set(0.16, -0.22, 0);
  armL.rotation.z = 0.28;
  armR.rotation.z = -0.28;
  const handL = new THREE.Mesh(geos.hand, stdMat(THREE, pal.skin));
  const handR = new THREE.Mesh(geos.hand, stdMat(THREE, pal.skin));
  handL.position.set(-0.20, -0.42, 0.01);
  handR.position.set(0.16 + 0.04, -0.42, 0.01);

  g.add(torso, collar, hips, legL, legR, shoeL, shoeR, armL, armR, handL, handR, neck, headAnchor);
  g.userData = {
    head,
    headAnchor,
    earL,
    earR,
    neck,
    hair,
    torso,
    collar,
    hips,
    legL,
    legR,
    armL,
    armR,
    handL,
    handR,
    shoeL,
    shoeR,
    eyeL,
    eyeR,
    irisL,
    irisR,
    lidL,
    lidR,
    browL,
    browR,
    props,
    visor: null,
    deviceProp: "none",
    lidAmount: 1,
    nextBlinkAt: 0,
    blinkStartedAt: null,
  };
  paintHumanoid(g, spec, THREE);
  applyLidAmount(g, 1);
  const prop = avatarDeviceProp(opts.prop || opts.xr_prop || "none");
  g.userData.deviceProp = "";
  setAvatarDeviceProp(g, prop);
  g.traverse((o) => {
    o.frustumCulled = false;
    o.userData.xrNoCollision = true;
    if (o.isMesh) o.raycast = () => {};
  });
  return g;
}

export function poseHumanoidToHead(body, headObj) {
  if (!body || !headObj) return;
  body.position.copy(headObj.position);
  body.quaternion.copy(headObj.quaternion);
  body.position.y -= 0.02;
  body.visible = true;
}

export function tickAvatarPreview(preview, dt = 0.016) {
  if (!preview?.visible) return;
  const fig = preview.userData?.figure;
  if (!fig) return;
  fig.rotation.y += Math.min(0.08, Number(dt) || 0.016);
  const now = typeof performance !== "undefined"
    ? performance.now()
    : (preview.userData._t = (Number(preview.userData._t) || 0) + (Number(dt) || 0.016) * 1000);
  tickAvatarBlink(fig, now);
}

export function applyAvatarAction(spec, action, ctx = {}) {
  const id = String(action || "");
  let next = normalizeAvatarSpec(spec);
  if (id === "avatar-body-next") next = cycleAvatarBody(next);
  else if (id === "avatar-outfit-next") next = cycleAvatarOutfit(next);
  else if (id.startsWith("avatar-body-")) next = normalizeAvatarSpec({ ...next, body: id.slice("avatar-body-".length) });
  else if (id.startsWith("avatar-outfit-")) next = normalizeAvatarSpec({ ...next, outfit: id.slice("avatar-outfit-".length) });
  else if (id === "avatar-source-studio") next = applyAvatarSource(next, "studio");
  else if (id === "avatar-source-rpm") next = applyAvatarSource(next, "rpm");
  else if (id === "avatar-source-horizon") {
    if (!canLinkHorizon(ctx) && ctx.requireQuest) return { spec: next, note: "Horizon linking is for Meta Quest" };
    next = applyAvatarSource(next, "horizon");
    return { spec: next, note: HORIZON_AVATAR_NOTE };
  }
  return { spec: next, note: "" };
}
