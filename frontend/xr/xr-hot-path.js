/**
 * Quest-safe XR hot-path rules. Keep draw/move off the CAD triangle raycaster
 * and keep screenshot / history / permission helpers testable without WebXR.
 */

export const XR_POSE_MIN_MS = 90;
export const XR_LIVE_STROKE_MAX_POINTS = 64;
export const XR_COMMIT_STROKE_MAX_POINTS = 24;
export const XR_NETWORK_STROKE_MAX_POINTS = 32;
export const XR_MAX_STROKES = 16;
export const XR_MAX_REMOTE_STROKES = 8;
export const XR_NAMETAG_HIT = { w: 0.76, h: 0.24 };
export const GRANT_WS_TYPE = "ai.keys.changed";
export const GRANT_WS_REASONS = ["chatgpt_granted", "chatgpt_connected"];

export function shouldRebuildTubeWhileDrawing() {
  return false;
}

/** Live ink must reuse one mesh — never `new CylinderGeometry` per 8 mm sample. */
export function shouldAllocateLiveInkCylinderPerAppend() {
  return false;
}

export function liveInkPoolCapacity(maxPoints = XR_LIVE_STROKE_MAX_POINTS) {
  return Math.max(1, Number(maxPoints) || XR_LIVE_STROKE_MAX_POINTS);
}

/**
 * Unit Y-cylinder → instance pose for a segment. Null if too short.
 * Quaternion matches THREE.Quaternion.setFromUnitVectors(Y-up, dir).
 */
export function liveInkInstanceFromSegment(ax, ay, az, bx, by, bz, radius) {
  const dx = Number(bx) - Number(ax);
  const dy = Number(by) - Number(ay);
  const dz = Number(bz) - Number(az);
  const len = Math.hypot(dx, dy, dz);
  const r = Number(radius);
  if (!(len > 1e-5) || !(r > 0)) return null;
  const inv = 1 / len;
  const nx = dx * inv;
  const ny = dy * inv;
  const nz = dz * inv;
  let qx;
  let qy;
  let qz;
  let qw = 1 + ny;
  if (qw < 1e-6) {
    qx = 0;
    qy = -nz;
    qz = 1;
    qw = 0;
  } else {
    qx = nz;
    qy = 0;
    qz = -nx;
  }
  const mag = Math.hypot(qx, qy, qz, qw) || 1;
  return {
    px: (Number(ax) + Number(bx)) * 0.5,
    py: (Number(ay) + Number(by)) * 0.5,
    pz: (Number(az) + Number(bz)) * 0.5,
    sx: r,
    sy: len,
    sz: r,
    qx: qx / mag,
    qy: qy / mag,
    qz: qz / mag,
    qw: qw / mag,
  };
}

export function shouldRebuildExplorerWhileBusy(state = {}) {
  if (state?.enterSettled === false) return false;
  if (state?.presenting === true && state?.menuVisible !== true) return false;
  return !xrInteractionBusy(state);
}

/** Extra hemi/key/fill freeze Quest after enter defer. One ambient only. */
export function xrFillLightsEnabled(state = {}) {
  void state;
  return false;
}

/** Idle XR: full scene.traverse at most every N frames (Quest ~72–90 Hz). */
export const XR_SCENE_CHROME_CULL_FRAMES = 12;
export const XR_OVERLAY_RELAYER_FRAMES = 18;
export const XR_OVERLAY_RELAYER_MAX_MESHES = 48;
export const XR_PLACE_CAD_MIN_MS = 220;
export const XR_PENDING_PLACE_MAX = 3;
export const XR_GUIDES_PAINT_MIN_MS = 160;
export const XR_AVATAR_BLINK_MIN_MS = 90;

/** Chrome cull is once-on-enter (force) or when marked dirty — never a periodic CAD walk. */
export function shouldTraverseSceneChrome(state = {}) {
  const busy = state?.busy && typeof state.busy === "object" ? { ...state.busy, ...state } : state;
  if (xrInteractionBusy(busy)) return false;
  if (state?.enterSettled === false && state?.force !== true) return false;
  if (state?.force === true || state?.dirty === true) return true;
  return false;
}

/**
 * Overlay material mutation (transparent + depthTest:false).
 * Never on pose drag, hover, or idle frames. Flags are set when a mesh is
 * created — walking HUD/dock on Quest at 72 Hz freezes the session.
 */
export function shouldRelayerOverlays(state = {}) {
  if (state?.presenting === false) return false;
  return state?.force === true || state?.panelSetChanged === true;
}

/** Stop walking HUD/dock meshes after this many overlay materials. */
export function shouldStopOverlayTraverse(visited = 0, max = XR_OVERLAY_RELAYER_MAX_MESHES) {
  return Number(visited) >= (Number(max) > 0 ? Number(max) : XR_OVERLAY_RELAYER_MAX_MESHES);
}

/**
 * Equirect as scene.environment forces PBR IBL on every CAD mesh while orbiting.
 * Never bind a wrap HDRI as IBL — not in Quest, not on the laptop CAD viewport.
 */
export function shouldBindSceneEnvironmentWhilePresenting({ presenting = false } = {}) {
  void presenting;
  return false;
}

/** Workspace Change scene / saved equirect wraps must not paint the laptop CAD view. */
export function shouldApplyEquirectWrapToCadViewport({ presenting = false } = {}) {
  void presenting;
  return false;
}

/** Extra boot WebGL context must not keep rendering after splash hide / VR enter. */
export function shouldRunBootSplashRaf({ splashHidden = false, presenting = false } = {}) {
  return !splashHidden && !presenting;
}

/** Second WebGL (gear/headset) next to CAD/XR crashed Quest. CSS logo only. */
export function shouldMountBootHeadsetScene({ presenting = false } = {}) {
  void presenting;
  return false;
}

/** DIMOS teleop: no 80 Hz tick, WS, or X/A steal until Activate. */
export function shouldTickDimosTeleop({ armed = false, recording = false, playing = false } = {}) {
  return armed === true || recording === true || playing === true;
}

/**
 * XR enter must never arm DIMOS, open :8443, or attach session listeners.
 * Leftover armed from a prior Activate / crash is cleared on the boundary —
 * Studio A-hold + grips stay live until the user clicks Activate again.
 */
export function shouldAttachDimosOnXrEnter({ armed = false } = {}) {
  void armed;
  return false;
}

/**
 * Safe coordinator start on Enter VR / Voice / Open Arm.
 * POSTs /api/dimos/ensure-coordinator if :8443 is down. Never arms teleop,
 * never kills a live coordinator, never 1.6s-polls Control Center.
 */
export function shouldEnsureDimosCoordinatorOnXrEnter({ presenting = true } = {}) {
  return presenting === true;
}

/** Studio A-hold tool wheel (right xr-standard buttons[4]). Off while DIMOS is armed. */
export function shouldRunStudioAHold({ armed = false } = {}) {
  return armed !== true;
}

/** Studio B/Y laser. Off while DIMOS is armed so left Y can start the arms. */
export function shouldRunStudioLaser({ armed = false } = {}) {
  return armed !== true;
}

/** Right B is laser. Left Y is DimOS arm-start (same xr-standard index 5, different hand). */
export function sourceOwnsStudioLaser(source) {
  return String(source?.handedness || "") !== "left";
}

/**
 * Studio squeeze grab/scale remains available during robotics.
 * The Pi profile uses triggers for grippers; grip manipulates Studio objects.
 * Always on when teleop is off — do not intercept squeeze on XR load.
 */
export function shouldRunStudioGripGrab({ armed = false, uiHit = false, nearMenu = false } = {}) {
  void armed; void uiHit; void nearMenu;
  return true;
}

/**
 * Live Studio HUD / wrist / menu hit (or standing near a panel and aiming).
 * DimOS must not consume trigger/select — the click belongs to Studio.
 */
export function studioUiOverridesDimosSelect({ uiHit = false, nearMenu = false, rayOnMenu = false } = {}) {
  return uiHit === true || nearMenu === true || rayOnMenu === true;
}

/** False = do not forward XR select / trigger to the arm. */
export function dimosShouldForwardSelect({ uiHit = false, nearMenu = false, rayOnMenu = false } = {}) {
  return !studioUiOverridesDimosSelect({ uiHit, nearMenu, rayOnMenu });
}

/**
 * Face-button poll (A/B). Quest AR often sets `.hand` on Touch — still read
 * buttons[4]/[5] so Hold-A is not gated on isPhysicalControllerSource.
 */
export function sourceHasStudioFaceButtons(source) {
  return (source?.gamepad?.buttons?.length || 0) >= 5;
}

/** Digital GamepadButton click. Analog value / unused Touch Plus slots are not a press. */
export function xrGamepadDigitalPressed(button) {
  return button?.pressed === true;
}

/** xr-standard select = buttons[0]. Quest AR often skips controller `selectstart`. */
export function xrGamepadTriggerPressed(gp) {
  return xrGamepadDigitalPressed(gp?.buttons?.[0]);
}

/** xr-standard squeeze / grab = buttons[1]. Quest AR often skips `squeezestart`. */
export function xrGamepadSqueezePressed(gp) {
  return xrGamepadDigitalPressed(gp?.buttons?.[1]);
}

export const XR_SELECT_DEBOUNCE_MS = 180;

/** Empty selectstart must not eat the gamepad poll. Only debounce real hits. */
export function xrSelectDebounceBlocks({ hasHit = false, elapsedMs = Infinity, windowMs = XR_SELECT_DEBOUNCE_MS } = {}) {
  if (hasHit !== true) return false;
  return Number(elapsedMs) < (Number(windowMs) || XR_SELECT_DEBOUNCE_MS);
}

/** selectstart with no UI hit must not beginGrab — poll handles world/CAD after poses update. */
export function selectStartShouldCommit({ isUi = false } = {}) {
  return isUi === true;
}

/**
 * Quest sometimes drops handedness on the right Touch. Unlabeled sources
 * default to the right so the menu-click trigger is not mapped to the left.
 */
export function xrSourceHandIndex(source, { hasLeft = false, hasRight = false, fallback = -1 } = {}) {
  if (source?.handedness === "left") return 0;
  if (source?.handedness === "right") return 1;
  if (!hasRight) return 1;
  if (!hasLeft) return 0;
  return fallback;
}

/**
 * Quest often poses grip (Touch GLB + DimOS) while target-ray stays identity.
 * Never prefer an unposed hand overlay over a posed physical grip — that stole
 * menu pick / laser (hand at origin) while the robot still tracked the grip.
 */
export function resolvePosedAim({
  pointer = null,
  grip = null,
  hand = null,
  pointerPosed = false,
  gripPosed = false,
  handPosed = false,
  physical = false,
} = {}) {
  if (pointer && pointerPosed === true) return pointer;
  if (physical === true && grip && gripPosed === true) return grip;
  if (physical !== true && hand && handPosed === true) return hand;
  if (grip && gripPosed === true) return grip;
  if (hand && handPosed === true) return hand;
  return null;
}

/** Skip grip.traverse after official Touch overlay is styled once. */
export function shouldRestyleXrControllerOverlay({
  overlayReady = false,
  lastStyleAt = 0,
  now = 0,
  retryMs = 400,
} = {}) {
  if (overlayReady === true) return false;
  if (!(Number(lastStyleAt) > 0)) return true;
  return Number(now) - Number(lastStyleAt) >= (Number(retryMs) || 400);
}

/** Wrist plate is a small world-depth quad — overlay fill-rate froze Quest. */
export function xrWristPlateDepthFlags() {
  return { transparent: true, depthTest: true, depthWrite: true };
}

/**
 * Left-wrist HUD chrome. Pad is beyond the hovered puck edge so the plate
 * frames the 3×3 (not an 8 mm gutter that sat inside 12 mm pucks). Border is
 * a thin visible rim — not the old 4 cm rail that covered CAD.
 */
export const WRIST_PLATE_PAD_M = 0.012;
export const WRIST_PLATE_BORDER_EXTRA_M = 0.003;
export const WRIST_PLATE_HOVER_SCALE = 1.18;
export const WRIST_PLATE_TEX_LONG = 384;

/** Centered puck grid + plate that fully covers hovered pucks. */
export function wristPlateLayout({
  cols = 3,
  rows = 3,
  tile = 0.024,
  gapX = 0.046,
  gapY = 0.026,
  pad = WRIST_PLATE_PAD_M,
  hoverScale = WRIST_PLATE_HOVER_SCALE,
} = {}) {
  const c = Math.max(1, Math.floor(Number(cols) || 1));
  const r = Math.max(1, Math.floor(Number(rows) || 1));
  const t = Number(tile) > 0 ? Number(tile) : 0.024;
  const gx = Number(gapX) >= 0 ? Number(gapX) : 0.046;
  const gy = Number(gapY) >= 0 ? Number(gapY) : 0.026;
  const p = Number(pad) >= 0 ? Number(pad) : WRIST_PLATE_PAD_M;
  const hs = Number(hoverScale) > 0 ? Number(hoverScale) : WRIST_PLATE_HOVER_SCALE;
  const spanX = (c - 1) * gx;
  const spanY = (r - 1) * gy;
  const puckR = (t / 2) * hs;
  return {
    originX: -spanX / 2,
    originY: spanY / 2,
    spanX,
    spanY,
    puckR,
    plateW: spanX + puckR * 2 + p * 2,
    plateH: spanY + puckR * 2 + p * 2,
    plateX: 0,
    plateY: 0,
  };
}

/** Match canvas aspect to the world plate so UVs do not crop the rounded chrome. */
export function wristPlateCanvasSize(plateW, plateH, longEdge = WRIST_PLATE_TEX_LONG) {
  const w = Math.max(1e-4, Number(plateW) || 1);
  const h = Math.max(1e-4, Number(plateH) || 1);
  const aspect = w / h;
  const long = Math.max(64, Number(longEdge) || WRIST_PLATE_TEX_LONG);
  if (aspect >= 1) {
    return { width: long, height: Math.max(64, Math.round(long / aspect)) };
  }
  return { width: Math.max(64, Math.round(long * aspect)), height: long };
}

/**
 * World plate that frames local quads/circles (controller HUD after rx ≈ -90°).
 * `r` is the unscaled half-extent; hoverScale is applied here.
 */
export function xrHudPlateFromItems(items = [], { pad = 0.018, hoverScale = 1.18 } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return { w: pad * 2, h: pad * 2, x: 0, y: 0 };
  }
  const hs = Number(hoverScale) > 0 ? Number(hoverScale) : 1;
  const p = Number(pad) >= 0 ? Number(pad) : 0.018;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const it of list) {
    const r = Math.max(0, Number(it?.r) || 0) * hs;
    const x = Number(it?.x) || 0;
    const y = Number(it?.y) || 0;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  return {
    w: (maxX - minX) + p * 2,
    h: (maxY - minY) + p * 2,
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

/** World slack so a thin HUD plane still catches the aim ray (no setFromObject). */
export const XR_AABB_PAD_M = 0.028;

/**
 * HUD / wrist plate world AABB from PlaneGeometry width/height + Matrix4.elements.
 * Four corners only — never Box3.setFromObject (full child traverse).
 */
export function xrPlaneWorldAabbFromMatrix(width = 0, height = 0, e = null, padM = XR_AABB_PAD_M) {
  const hw = Number(width) / 2;
  const hh = Number(height) / 2;
  if (!(hw > 0) || !(hh > 0)) return null;
  const m = e && e.length >= 16 ? e : null;
  if (!m) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let ix = 0; ix < 2; ix += 1) {
    const x = ix ? hw : -hw;
    for (let iy = 0; iy < 2; iy += 1) {
      const y = iy ? hh : -hh;
      const wx = m[0] * x + m[4] * y + m[12];
      const wy = m[1] * x + m[5] * y + m[13];
      const wz = m[2] * x + m[6] * y + m[14];
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;
    }
  }
  if (!Number.isFinite(minX) || minX === Infinity) return null;
  const pad = Number(padM);
  const slack = Number.isFinite(pad) && pad >= 0 ? pad : XR_AABB_PAD_M;
  return {
    minX: minX - slack,
    maxX: maxX + slack,
    minY: minY - slack,
    maxY: maxY + slack,
    minZ: minZ - slack,
    maxZ: maxZ + slack,
  };
}

/** CircleGeometry wrist pucks — same cheap 4-corner AABB as a square of 2r. */
export function xrCircleWorldAabbFromMatrix(radius = 0, e = null, padM = XR_AABB_PAD_M) {
  const r = Number(radius);
  if (!(r > 0)) return null;
  return xrPlaneWorldAabbFromMatrix(r * 2, r * 2, e, padM);
}

/** PlaneGeometry HUD or CircleGeometry wrist puck — same cheap 4-corner AABB. */
export function xrMeshWorldAabbFromGeometry(mesh, padM = XR_AABB_PAD_M) {
  if (!mesh?.isMesh) return null;
  const e = mesh.matrixWorld?.elements;
  const params = mesh.geometry?.parameters || {};
  const r = Number(params.radius) || 0;
  if (r > 0) return xrCircleWorldAabbFromMatrix(r, e, padM);
  return xrPlaneWorldAabbFromMatrix(Number(params.width) || 0, Number(params.height) || 0, e, padM);
}

/** JPEG decode + blob URL only while Activate / record / play is on. */
export function shouldIngestDimosJpeg({ armed = false, recording = false, playing = false } = {}) {
  return shouldTickDimosTeleop({ armed, recording, playing });
}

/** Wrist-cam JPEG: live at 280 ms; disconnected backs off so enter is not a fetch storm. */
export function shouldPollHandCamJpeg({
  presenting = false,
  wantScene = false,
  live = false,
  lastPollMs = 0,
  now = 0,
  liveMs = 280,
  idleMs = 2500,
} = {}) {
  if (presenting !== true || wantScene !== true) return false;
  const wait = live === true ? (Number(liveMs) || 280) : (Number(idleMs) || 2500);
  if (!(Number(lastPollMs) > 0)) return true;
  return Number(now) - Number(lastPollMs) >= wait;
}

/** Neutral XR lights: hemi / ambient / key. Extra CAD/look-dev fills freeze Quest. */
export const XR_CAD_LIGHT_ROLES_KEEP = ["hemi", "ambient", "key"];

export function shouldKeepXrCadLightRole({
  role = "",
  presenting = false,
  orbitKeep = false,
} = {}) {
  if (presenting !== true) return true;
  if (orbitKeep === true) return true;
  return XR_CAD_LIGHT_ROLES_KEEP.includes(String(role || ""));
}

/** Slab test — menu AABB hit when the HUD plane UV pick misses. */
export function rayHitsAabb(origin, direction, box, maxM = 3) {
  if (!origin || !direction || !box) return null;
  const ox = Number(origin.x);
  const oy = Number(origin.y);
  const oz = Number(origin.z);
  const dx = Number(direction.x);
  const dy = Number(direction.y);
  const dz = Number(direction.z);
  if (![ox, oy, oz, dx, dy, dz].every((n) => Number.isFinite(n))) return null;
  const max = Number(maxM);
  const lim = Number.isFinite(max) && max > 0 ? max : 3;
  let tmin = 0;
  let tmax = lim;
  const axes = [
    [ox, dx, Number(box.minX), Number(box.maxX)],
    [oy, dy, Number(box.minY), Number(box.maxY)],
    [oz, dz, Number(box.minZ), Number(box.maxZ)],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (![mn, mx].every((n) => Number.isFinite(n))) return null;
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (mn - o) * inv;
    let t2 = (mx - o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }
  if (!(tmin >= 0) || tmin > lim) return null;
  return {
    distance: tmin,
    point: { x: ox + dx * tmin, y: oy + dy * tmin, z: oz + dz * tmin },
  };
}

/** Fine menu laser; visibility comes from contrast rather than a thick beam. */
export function menuLaserRadiusM({ uiHit = false } = {}) {
  return uiHit === true ? 0.00045 : 0.00035;
}

/**
 * Quest parks an untracked target-ray at the session origin (a few mm).
 * A live Touch pose is tens of centimetres away. Do not treat origin as posed —
 * that hid the controller laser and aimed picks at the floor.
 */
export const XR_AIM_POSE_MIN_M = 0.2;

export function xrAimPoseIsLive(p = {}) {
  const x = Number(p.x);
  const y = Number(p.y);
  const z = Number(p.z);
  if (![x, y, z].every((n) => Number.isFinite(n))) return false;
  const min = XR_AIM_POSE_MIN_M;
  return (x * x + y * y + z * z) >= min * min;
}

export function applyXrSpacePoseToObject(obj, pose) {
  if (!obj || !pose) return false;
  const p = pose.position || pose;
  const o = pose.orientation || pose.quaternion;
  if (!p || !o) return false;
  const x = Number(p.x);
  const y = Number(p.y);
  const z = Number(p.z);
  const qx = Number(o.x);
  const qy = Number(o.y);
  const qz = Number(o.z);
  const qw = Number(o.w);
  if (![x, y, z, qx, qy, qz, qw].every((n) => Number.isFinite(n))) return false;
  try {
    obj.position.set(x, y, z);
    obj.quaternion.set(qx, qy, qz, qw);
    obj.scale.set(1, 1, 1);
    obj.updateMatrix?.();
    obj.updateMatrixWorld?.(true);
    return true;
  } catch {
    return false;
  }
}

/** Prefer a posed target-ray. If the trigger landed on the grip, still click. */
export function resolveSelectAim({ pointer = null, grip = null, pointerPosed = false, gripPosed = false } = {}) {
  if (pointer && pointerPosed === true) return pointer;
  if (grip && gripPosed === true) return grip;
  return null;
}

/** UI on the aim ray wins; a grip-space UI hit still counts as the click. CAD never beats a menu. */
export function selectHitFromAimOrGrip({ aimHit = null, gripHit = null } = {}) {
  const ui = (aimHit && isXrUiHoverKind(aimHit.kind) ? aimHit : null)
    || (gripHit && isXrUiHoverKind(gripHit.kind) ? gripHit : null);
  const cad = (aimHit && !isXrUiHoverKind(aimHit.kind) ? aimHit : null)
    || (gripHit && !isXrUiHoverKind(gripHit.kind) ? gripHit : null);
  return preferHudHitOverCad(ui, cad);
}

/**
 * Never hide the Touch mesh to reveal a panel — that made the right hand
 * vanish behind the left wrist UI. Draw the GLB after wrist chrome instead.
 */
export function controllerModelHiddenForUi({ occludes = false } = {}) {
  void occludes;
  return false;
}

/** Official controller GLB must paint after the left wrist plate (renderOrder ~10k). */
export const XR_CONTROLLER_OVER_UI_ORDER = 45000;
/** Laser / tip must win over wrist UI (10k) and overlay Touch GLBs (45k). */
export const XR_LASER_OVER_UI_ORDER = 90000;

export function xrControllerOverlaySkipName(name = "") {
  const n = String(name || "");
  return n === "xrRay" || n === "xrRayTip" || n === "xrHandRay" || n === "xrHandRayTip"
    || n === "xrControllerFallback" || n.startsWith("xrControllerFallback");
}

/** Laser / tip / official overlay must not sit on the UI pick list. */
export function disableXrPointerRaycast(obj) {
  if (!obj) return false;
  if (!obj.userData) obj.userData = {};
  obj.userData.xrRaycast = false;
  try { obj.raycast = () => {}; } catch { return false; }
  return true;
}

export function xrMeshIsWristOrHudUi(obj) {
  const u = obj?.userData || {};
  if (u.xrTool || u.xrUi || u.xrIcon || u.xrLabel) return true;
  if (u.xrHudPlane || u.xrGridPanel || u.xrAiPanel || u.xrExplorerPanel || u.xrDebuggerHud) return true;
  const n = String(obj?.name || "");
  return n === "xrWristBand" || n === "xrWristBandBorder" || n === "xrStatusBand"
    || n === "xrStatusDock" || n === "xrCaptureDock" || n === "xrToolDock"
    || n === "xrDebuggerHud" || n.startsWith("xrDebugger")
    || n.startsWith("xrHud") || n.startsWith("xrDock")
    || n.startsWith("xrStatus") || n.startsWith("xrCapture");
}

export function styleXrControllerOverlayMesh(obj, { renderOrder = XR_CONTROLLER_OVER_UI_ORDER } = {}) {
  if (!obj?.isMesh) return false;
  const name = String(obj.name || "");
  if (xrControllerOverlaySkipName(name)) return false;
  if (xrMeshIsWristOrHudUi(obj)) return false;
  if (isXrWorldPickMesh(obj)) return false;
  if (obj.userData?.xrSkipControllerOverlay || obj.userData?.xrFallback) return false;
  const next = Number(renderOrder) || XR_CONTROLLER_OVER_UI_ORDER;
  obj.renderOrder = Math.max(Number(obj.renderOrder) || 0, next);
  obj.frustumCulled = false;
  // Official controller surfaces retain texture, shading and mutual occlusion.
  // Only actual HUD meshes use the no-depth overlay pipeline.
  if (obj.userData?.xrControllerOverlayStyled) return true;
  obj.userData.xrControllerOverlayStyled = true;
  obj.userData.xrRaycast = false;
  try { obj.raycast = () => {}; } catch { /* ignore */ }
  return true;
}

/** Hidden crescent / color pucks must not steal the aim ray. */
export function xrUiHitObjectIsLive(hit) {
  if (!hit?.object) return false;
  if (hit.object.userData?.xrRaycast === false) return false;
  let n = hit.object;
  for (let i = 0; i < 10 && n; i += 1) {
    if (n.visible === false) return false;
    n = n.parent;
  }
  return true;
}

/** Quest Raycaster.layers stay on 0 after CAD hold-layer work; UI is also layer 0 but enableAll is cheap insurance. */
export function prepareXrUiRaycaster(raycaster, { far = 8 } = {}) {
  if (!raycaster) return raycaster;
  try { raycaster.layers?.enableAll?.(); } catch { /* ignore */ }
  raycaster.near = 0;
  const lim = Number(far);
  raycaster.far = Number.isFinite(lim) && lim > 0 ? lim : 8;
  return raycaster;
}

/** Live wrist / HUD pick meshes must use Mesh.raycast — overlay styling and plate hideRaycast ate clicks. */
export function restoreXrUiPickRaycast(obj) {
  if (!obj) return false;
  const u = obj.userData || {};
  if (u.xrControllerOverlayStyled && !xrMeshIsWristOrHudUi(obj) && !isXrWorldPickMesh(obj)) return false;
  const pickable = !!(
    u.xrTool
    || u.xrUi
    || u.xrHudPlane
    || u.xrMenuTab
    || u.xrMenuRow
    || u.xrExplorerPanel
    || u.xrExplorerDrag
    || u.xrAiHit
    || u.xrAiPanel
    || u.xrViewHit
    || u.xrRoboticsHit
    || u.xrGridHit
    || u.xrGridPanel
    || u.xrDebuggerHud
    || u.xrPickOnly
    || xrMeshIsWristOrHudUi(obj)
    || isXrWorldPickMesh(obj)
  );
  if (!pickable) return false;
  if (u.xrRaycast === false) u.xrRaycast = true;
  if (typeof obj.raycast === "function" && obj.raycast.length === 0) {
    try { delete obj.raycast; } catch { obj.raycast = undefined; }
  }
  // Overlay styling used to leave this flag set, and wrist pick filtered those meshes out.
  if (u.xrControllerOverlayStyled) u.xrControllerOverlayStyled = false;
  return true;
}

/** Empty panel AABB / body — handleSelect no-ops and must not steal CAD. */
export function isXrChromeKind(kind = "") {
  const k = String(kind || "");
  return k === "menu-chrome" || k.endsWith("-chrome");
}

/** Title bar / rotate handle — grip moves and yaws that window. */
export function isXrPanelGripHandleKind(kind = "") {
  const k = String(kind || "");
  if (!k) return false;
  if (k === "explorer-drag" || k === "wheel-drag") return true;
  return k.endsWith("-drag") || k.endsWith("-rotate");
}

/** Buttons, tabs, title-bar handles — not empty *-chrome. */
export function hudHitStealsCad(hit) {
  if (!hit?.kind) return false;
  if (isXrChromeKind(hit.kind)) return false;
  if (isXrHudActionKind(hit.kind) || isXrPanelGripHandleKind(hit.kind)) return true;
  return isXrUiHoverKind(hit.kind);
}

/**
 * AABB hover used to stamp menu-chrome (handleSelect no-op) while CAD behind
 * the panel still resized. Prefer a real HUD/wrist/wheel action when present.
 * Empty *-chrome never beats a model hit.
 */
export function preferHudHitOverCad(uiHit, cadHit) {
  if (uiHit && hudHitStealsCad(uiHit)) return uiHit;
  if (cadHit) return cadHit;
  return uiHit || null;
}

/** Buttons / tabs / rows — not empty panel chrome (which handleSelect no-ops). */
export function isXrHudActionKind(kind) {
  const k = String(kind || "");
  if (!k) return false;
  if (k.endsWith("-chrome")) return false;
  if (k.endsWith("-drag") || k === "explorer-drag" || k === "wheel-drag") return false;
  if (k.endsWith("-rotate")) return false;
  return isXrUiHoverKind(k);
}

/**
 * Plane UV often maps a Settings/Menu click to *-chrome while the real button
 * mesh is a millimetre behind. Prefer the action so trigger actually clicks.
 */
export function preferHudActionHit(hits = [], slackM = 0.08) {
  const list = (Array.isArray(hits) ? hits : []).filter((h) => h && Number.isFinite(Number(h.distance)));
  if (!list.length) return null;
  list.sort((a, b) => Number(a.distance) - Number(b.distance));
  const best = list[0];
  // Title-bar drag/rotate must not be rewritten to a nearby tab/button.
  if (isXrPanelGripHandleKind(best.kind)) return best;
  const slack = Number(slackM);
  const maxD = Number(best.distance) + (Number.isFinite(slack) && slack >= 0 ? slack : 0.08);
  const action = list.find((h) => isXrHudActionKind(h.kind) && Number(h.distance) <= maxD);
  return action || best;
}

/** Closest live puck to a world point (plate / AABB chrome → tool id). */
export function nearestDockToolId(point, tools = [], maxM = 0.09) {
  if (!point || !tools?.length) return "";
  const lim = Number(maxM);
  const max = Number.isFinite(lim) && lim > 0 ? lim : 0.09;
  const maxSq = max * max;
  let best = "";
  let bestD = Infinity;
  const px = Number(point.x);
  const py = Number(point.y);
  const pz = Number(point.z);
  if (![px, py, pz].every((n) => Number.isFinite(n))) return "";
  for (const t of tools) {
    if (!t || t.visible === false) continue;
    const id = String(t.id || t.tool || "");
    if (!id) continue;
    const dx = Number(t.x) - px;
    const dy = Number(t.y) - py;
    const dz = Number(t.z) - pz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD && d <= maxSq) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** Presenting laser lives on the target-ray controller — never pick with a different grip node. */
export function laserPickNode({ controller = null, controllerPosed = false, aim = null, aimPosed = false } = {}) {
  if (controller && controllerPosed === true) return controller;
  if (aim && aimPosed === true) return aim;
  return controller || aim || null;
}

/** Grab / Select: short stub + tip even when the ray misses. */
export function selectToolShowsPointer(tool = "") {
  const t = String(tool || "grab");
  return t === "grab" || t === "select" || t === "rotate";
}

export function sessionSelectEventShouldClick({ hasSource = false } = {}) {
  return hasSource === true;
}

/** Controller body or pointer stub overlapping a world-menu AABB. */
export function controllerOccludesWorldUi({
  point = null,
  tip = null,
  menus = [],
  pad = 0.08,
} = {}) {
  const pts = [point, tip].filter((p) => p && Number.isFinite(Number(p.x)));
  if (!pts.length) return false;
  const slack = Number.isFinite(Number(pad)) ? Number(pad) : 0.08;
  for (const menu of menus) {
    if (!menu || !Number.isFinite(menu.minX)) continue;
    for (const p of pts) {
      const x = Number(p.x);
      const y = Number(p.y);
      const z = Number(p.z);
      if (
        x >= menu.minX - slack && x <= menu.maxX + slack
        && y >= menu.minY - slack && y <= menu.maxY + slack
        && z >= menu.minZ - slack && z <= menu.maxZ + slack
      ) return true;
    }
  }
  return false;
}

/**
 * Right trigger must stay on the right pointer. Stealing the other hand's wrist
 * dock (laser-on other-hand search) is why Quest right trigger felt dead on HUD.
 */
export function firstUiPointerMayUseOtherHand() {
  return false;
}

/** A/B poll must run in Draw / Create / grab — never skip pollAbButtons for a tool. */
export function shouldPollStudioFaceButtons() {
  return true;
}

/**
 * Right A lives on xr-standard buttons[4]. If Quest drops handedness after a tool
 * switch, still read unlabeled (non-left) Touch pads so hold-A reopens the wheel.
 */
export function studioAHoldGamepadSources(inputSources) {
  const list = [...(inputSources || [])].filter((s) => sourceHasStudioFaceButtons(s));
  const right = list.filter((s) => s?.handedness === "right");
  if (right.length) return right;
  return list.filter((s) => s?.handedness !== "left");
}

/**
 * Quest Touch pads have 4+ buttons. Hand pinch gamepads are 1–2 and must not
 * count as a labeled *physical* right that swallows an unlabeled pad.
 */
export function xrSourceLooksLikeTouchPad(source) {
  const gp = source?.gamepad;
  const n = gp?.buttons?.length || 0;
  const axes = gp?.axes?.length || 0;
  const xrStandard = String(gp?.mapping || "") === "xr-standard";
  if (n >= 4 || (n >= 3 && axes >= 4)) return true;
  // Quest AR often stamps `.hand` on a live Touch pad. Still a controller.
  if (xrStandard && n >= 2) return true;
  return false;
}

/**
 * Unlabeled physical trigger: never drop it when a labeled right *hand* exists.
 * Prefer the hand that has no labeled Touch pad (right first).
 */
export function unlabeledTriggerHandIndex({
  hasLabeledPhysicalLeft = false,
  hasLabeledPhysicalRight = false,
} = {}) {
  if (hasLabeledPhysicalRight !== true) return 1;
  if (hasLabeledPhysicalLeft !== true) return 0;
  return 1;
}

/** Keep last left/right when Quest clears live inputSource.handedness. */
export function stickyXrHandedness(live, stamped) {
  if (live === "left" || live === "right") return live;
  if (stamped === "left" || stamped === "right") return stamped;
  return "";
}

/**
 * Poll click needs a posed node. After a tool switch Quest drops "right" on the
 * live source — aimPointer(1)/getRightGrip() go null and buttons[0] is swallowed
 * unless a stamped fallback is used.
 */
export function xrPollSelectPointer({
  triggerPressed = false,
  aim = null,
  aimPosed = false,
  gripPosed = false,
  grip = null,
  fallback = null,
} = {}) {
  void triggerPressed;
  if (aim && aimPosed === true) return aim;
  if (gripPosed === true && grip) return grip;
  return fallback || null;
}

/** Rising trigger edge with no posed ray — selectstart also has nothing to aim. */
export function xrTriggerRayMiss({ triggerPressed = false, wasPressed = false, pointer = null } = {}) {
  return triggerPressed === true && wasPressed !== true && !pointer;
}

/**
 * Overlay session.inputSources buttons[0] by handedness so a missed controller
 * slot still fires trigger. Unlabeled Touch pads map to the empty *physical*
 * hand (right first) — Quest often drops right handedness after a tool switch,
 * while a labeled right hand overlay still reports handedness.
 */
export function applySessionTriggerPoll(triggers, inputSources) {
  const next = [!!triggers?.[0], !!triggers?.[1]];
  const list = [...(inputSources || [])];
  const hasLeft = list.some((s) => s?.handedness === "left");
  const hasRight = list.some((s) => s?.handedness === "right");
  const physicalLeft = list.some((s) => s?.handedness === "left" && xrSourceLooksLikeTouchPad(s));
  const physicalRight = list.some((s) => s?.handedness === "right" && xrSourceLooksLikeTouchPad(s));
  for (const source of list) {
    let hi = xrSourceHandIndex(source, { hasLeft, hasRight, fallback: -1 });
    if (hi < 0) {
      if (!xrGamepadTriggerPressed(source.gamepad) && !xrSourceLooksLikeTouchPad(source)) continue;
      hi = unlabeledTriggerHandIndex({
        hasLabeledPhysicalLeft: physicalLeft,
        hasLabeledPhysicalRight: physicalRight,
      });
    }
      if (xrGamepadTriggerPressed(source.gamepad)) next[hi] = true;
  }
  return next;
}

/** Overlay squeeze (buttons[1]) by handedness — same unlabeled-right mapping as trigger. */
export function applySessionSqueezePoll(squeezes, inputSources) {
  const next = [!!squeezes?.[0], !!squeezes?.[1]];
  const list = [...(inputSources || [])];
  const hasLeft = list.some((s) => s?.handedness === "left");
  const hasRight = list.some((s) => s?.handedness === "right");
  const physicalLeft = list.some((s) => s?.handedness === "left" && xrSourceLooksLikeTouchPad(s));
  const physicalRight = list.some((s) => s?.handedness === "right" && xrSourceLooksLikeTouchPad(s));
  for (const source of list) {
    let hi = xrSourceHandIndex(source, { hasLeft, hasRight, fallback: -1 });
    if (hi < 0) {
      if (!xrGamepadSqueezePressed(source.gamepad) && !xrSourceLooksLikeTouchPad(source)) continue;
      hi = unlabeledTriggerHandIndex({
        hasLabeledPhysicalLeft: physicalLeft,
        hasLabeledPhysicalRight: physicalRight,
      });
    }
    if (xrGamepadSqueezePressed(source.gamepad)) next[hi] = true;
  }
  return next;
}

/** Dismiss lock only while A is still down after a tool pick. A-up always clears. */
export function wheelDismissLockActive({ aPressed = false, dismissedThisHold = false } = {}) {
  return aPressed === true && dismissedThisHold === true;
}

/**
 * Wrist dock / Snap / draw-hand pucks must not abort a single-grip model grab.
 * World HUD hits still block — squeezestart starts a panel drag first.
 */
export function uiPickBlocksGripGrab(hit) {
  if (!hit?.kind) return false;
  if (hit.source === "wrist") return false;
  if (hit.kind === "tool" || hit.kind === "color" || hit.kind === "draw-hud-color" || hit.kind === "draw-hud-size" || hit.kind === "draw-hud-chrome") {
    return false;
  }
  return isXrWorldMenuHoverKind(hit.kind);
}

/** Save the live tool on Activate; restore it on Turn off / XR leave. */
export function nextToolAfterDimosArmChange({
  armed = false,
  previousTool = "",
  currentTool = "grab",
  starter = XR_STARTER_TOOL_ID,
} = {}) {
  const cur = String(currentTool || starter || "grab");
  if (armed === true) {
    return { tool: String(starter || "grab"), previousTool: String(previousTool || cur) };
  }
  const restore = String(previousTool || "");
  return { tool: restore || cur, previousTool: "" };
}

/** Never walk/replace CAD materials on the XR enter hot path (OOM / hitch). */
export function shouldRestyleCadMaterialsOnXrEnter() {
  return false;
}

/** Full-tree stripCadExtras on present hitchs large STEP/GLB — XR parks parts instead. */
export function shouldStripCadExtrasOnXrEnter() {
  return false;
}

/** 1080 animated SVG + blur next to WebXR framebuffer crashes Quest Browser. */
export function shouldKillBootSplashForXrPresent({ presenting = false } = {}) {
  return presenting === true;
}

/** Last-project GLB parse/upload must not share the requestSession / first-frame window. */
export function shouldOpenLastProjectOnXrEnterHotPath() {
  return false;
}

/** window.requestAnimationFrame beside a live WebXR session freezes Quest Browser. */
export function shouldUseWindowRafWhileXrPresenting() {
  return false;
}

/** Opening Settings / Menu / View / Tools must not walk or clone CAD materials. */
export function shouldRestyleCadOnXrMenuOpen() {
  return false;
}

export function shouldStripCadOnXrMenuOpen() {
  return false;
}

/** Dock Menu lists project labels only — never openProjectById on the click that opens it. */
export function shouldOpenProjectOnXrMenuOpen() {
  return false;
}

/** Extra WebGLRenderer / getContext('webgl') while XR owns the compositor. */
export function shouldCreateWebglForXrSettings({ presenting = false } = {}) {
  return presenting !== true;
}

/** JSON.parse of multi-MB equirect dataUrls just to list Environment rows. */
export function shouldParseEnvironmentDataUrlsOnXrMenuOpen() {
  return false;
}

/** Desktop Preferences store explorer / GLB thumbs / extra canvas while presenting. */
export function shouldHydrateDesktopPreferencesWhileXrPresenting({ presenting = false } = {}) {
  return presenting !== true;
}

/** GPU readback of the XR framebuffer (canvas.toDataURL) freezes Quest. */
export function shouldCaptureWebglFramebufferOnXrMenu({ presenting = false } = {}) {
  return presenting !== true;
}

/** Full-canvas metal gradients hitch the Quest 2D/WebGL lock. Solid fill while presenting. */
export function shouldUseLiteXrPanelChrome({ presenting = false } = {}) {
  return presenting === true;
}

export function shouldResizeXrUiCanvas(el, width, height) {
  if (!el) return true;
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  return Number(el.width) !== w || Number(el.height) !== h;
}

/** Quest HUD canvases — 2.5× backing with native eye buffers froze the headset.
 * 2.2× keeps sitting-distance chrome readable without a second renderer. */
export const XR_HUD_CANVAS_SCALE = 2.2;

export function xrHudCanvasScale({ dpr } = {}) {
  void dpr;
  return XR_HUD_CANVAS_SCALE;
}

export function xrHudCanvasBackingSize(logicalW, logicalH, scale = XR_HUD_CANVAS_SCALE) {
  const s = Number(scale) > 0 ? Number(scale) : XR_HUD_CANVAS_SCALE;
  return {
    width: Math.max(1, Math.round(Number(logicalW) * s)),
    height: Math.max(1, Math.round(Number(logicalH) * s)),
    scale: s,
  };
}

/** HUD CanvasTexture: Linear (no mip blur), light anisotropy. Never stretch 128px onto a big quad. */
export function xrHudTextureOpts({ anisotropy = 4 } = {}) {
  return {
    generateMipmaps: false,
    minFilter: "LinearFilter",
    magFilter: "LinearFilter",
    anisotropy: Math.max(1, Math.min(8, Number(anisotropy) || 4)),
  };
}

/** View-panel controls that restyle the CAD tree or open huge DOM while presenting. */
export const XR_CAD_HEAVY_VIEW_TOOL_IDS = [
  "explode",
  "wireframe",
  "tree",
  "section",
  "agent",
  "knowledge",
];

export function xrViewToolIsCadHeavy(id) {
  return XR_CAD_HEAVY_VIEW_TOOL_IDS.includes(String(id || ""));
}

export function shouldRunCadHeavyXrViewTool({ presenting = false, toolId = "" } = {}) {
  if (!xrViewToolIsCadHeavy(toolId)) return true;
  return presenting !== true;
}

export function xrMenuOpenForbiddenWork({ presenting = true } = {}) {
  return {
    applyCadStyle: shouldRestyleCadOnXrMenuOpen(),
    stripCadExtras: shouldStripCadOnXrMenuOpen(),
    openProject: shouldOpenProjectOnXrMenuOpen(),
    extraWebgl: shouldCreateWebglForXrSettings({ presenting }),
    envDataUrls: shouldParseEnvironmentDataUrlsOnXrMenuOpen(),
    webglCapture: shouldCaptureWebglFramebufferOnXrMenu({ presenting }),
    hydrateDesktopPrefs: shouldHydrateDesktopPreferencesWhileXrPresenting({ presenting }),
  };
}

/**
 * First-open headset HUD canvases (Settings / Tools / Menu / Prompt).
 * Allocating CanvasTexture + 720–1080 2D paint on the XR select frame freezes Quest.
 * Re-showing an already-built panel is cheap.
 */
export function shouldAllocateXrHudPanelOnSelectTick({
  presenting = false,
  panelReady = false,
} = {}) {
  if (panelReady === true) return true;
  return presenting !== true;
}

/** Canvas paint + GPU upload of a HUD panel — never on the XR click/select tick. */
export function shouldPaintXrHudPanelOnSelectTick({ presenting = false } = {}) {
  return presenting !== true;
}

export const XR_LAZY_HUD_PANEL_KINDS = [
  "settings", "tools", "social", "draw", "aiHub", "view", "menu",
  "workspace", "guides", "avatar", "ai", "studio", "robotics",
  "scene-browser", "scene-display", "share",
];

export function xrHudPanelNeedsDeferredPaint({
  presenting = false,
  kind = "",
  panelReady = false,
} = {}) {
  if (presenting !== true) return false;
  if (panelReady === true) return false;
  const id = String(kind || "");
  if (!id) return true;
  return XR_LAZY_HUD_PANEL_KINDS.includes(id);
}

/** Environment wrap JSON may contain equirect data-URLs — never parse on the click frame. */
export function shouldParseXrEnvironmentStoreOnSelectTick({ presenting = false } = {}) {
  return presenting !== true;
}

/** Desktop Preferences is a huge DOM overlay — same crash class as the boot SVG. */
export function shouldOpenDesktopPreferencesWhilePresenting({ presenting = false } = {}) {
  return presenting !== true;
}

/**
 * Quest Browser synthesizes a 2D click from XR select/squeeze.
 * Only the WebXR canvas may receive it — never studio Settings / menus.
 */
export function shouldLetXrSelectReachDomTarget({
  presenting = false,
  isXrCanvas = false,
} = {}) {
  if (presenting !== true) return true;
  return isXrCanvas === true;
}

/** Real camera passthrough — Quest AR alpha-blend / additive, preference on. */
export function xrPassthroughShowsRealWorld({
  passthroughOn = true,
  sessionIsPassthrough = true,
} = {}) {
  return passthroughOn === true && sessionIsPassthrough === true;
}

/** Opaque cheap sky when Pass is off. Never the old 1024-grid white room. */
export function xrCheapVrStageVisible({
  presenting = false,
  passthroughOn = true,
  sessionIsPassthrough = true,
} = {}) {
  return presenting === true && !xrPassthroughShowsRealWorld({
    passthroughOn,
    sessionIsPassthrough,
  });
}

/** Headset don, input-source churn, or reference-space swap — rebind dock/toolhand. */
export function shouldRebindXrDockHosts({
  presenting = false,
  sessionBecameVisible = false,
  documentBecameVisible = false,
  inputSourcesChanged = false,
  referenceSpaceRestored = false,
} = {}) {
  return presenting === true && (
    sessionBecameVisible
    || documentBecameVisible
    || inputSourcesChanged
    || referenceSpaceRestored
  );
}

/** Keep last world pose only briefly while tracking drops; then head-lock. */
export function shouldKeepFrozenDockPose({
  attachedLive = false,
  lastDockAt = 0,
  now = 0,
  maxStaleMs = 400,
} = {}) {
  if (attachedLive) return false;
  const at = Number(lastDockAt) || 0;
  const t = Number(now) || 0;
  if (!(at > 0)) return false;
  return (t - at) <= (Number(maxStaleMs) || 400);
}

/** Geometric left/right check is only for unlabeled sources. */
export function shouldRequireDockSideCheck({
  liveHandedness = "",
  preferredHand = "left",
} = {}) {
  const want = preferredHand === "right" ? "right" : "left";
  return liveHandedness !== want;
}

/** Enter: hide tagged desktop chrome only — never walk the CAD tree. */
export function shouldSkipCadChromeTraverse({ skipByLayer = false } = {}) {
  return skipByLayer === true;
}

/** Floors / grids / gizmos — not CAD meshes. Used for cheap XR enter culling. */
export function isDesktopSceneChrome(obj) {
  if (!obj) return false;
  const u = obj.userData || {};
  if (u.xrDesktopChrome || u.isFloor || u.isShadowFloor || u.isArchitectBay || u.isArchitectGrid) return true;
  if (u.isObjectHighlight || u.isHover) return true;
  if ((obj.isGridHelper || obj.type === "GridHelper") && !u.xrSnapGrid) return true;
  const name = String(obj.name || "");
  if (name === "large-grid-axes" || name === "grid-dots" || name === "architect-grid-dots") return true;
  if (obj.isBoxHelper || obj.type === "BoxHelper" || obj.type === "Box3Helper") return true;
  if (isXrSelectionAabb(obj)) return true;
  if (name === "create-solid-preview" || name === "hover-preview" || name === "xrModelMarker") return true;
  return false;
}

/** Desktop selection / hover AABB — not the CAD mesh itself. */
export function isXrSelectionAabb(obj) {
  if (!obj) return false;
  const u = obj.userData || {};
  if (u.isObjectHighlight || u.isHover || u.isHoverBody) return true;
  if (obj.isBoxHelper || obj.type === "BoxHelper" || obj.type === "Box3Helper") return true;
  const name = String(obj.name || "");
  return name === "selectionBox" || name === "SelectionBox" || /selection.*(?:box|aabb)/i.test(name);
}

/** Cheap scene-child walk. Never a full CAD traverse. */
export function hideXrSelectionAabbs(root, { max = 64, depth = 2 } = {}) {
  if (!root) return 0;
  let n = 0;
  const cap = Number(max) > 0 ? Number(max) : 64;
  const maxDepth = Number(depth) >= 0 ? Number(depth) : 2;
  const stack = [{ obj: root, d: 0 }];
  while (stack.length && n < cap) {
    const { obj, d } = stack.pop();
    if (!obj) continue;
    if (isXrSelectionAabb(obj)) {
      try { obj.visible = false; } catch { /* ignore */ }
      n += 1;
    }
    if (d >= maxDepth) continue;
    const kids = obj.children;
    if (!kids?.length) continue;
    for (let i = 0; i < kids.length && i < 24; i += 1) {
      stack.push({ obj: kids[i], d: d + 1 });
    }
  }
  return n;
}

/**
 * Controller SpotLight on every CAD fragment is a Quest freeze.
 * Easter-egg aiming is gone — keep the light off.
 */
export function shouldEnableXrRayFlashlight() {
  return false;
}

/** First ~1.4s of present — no CAD place/material swap / blink / lights / clip / voice. */
export const XR_ENTER_DEFER_MS = 1400;

export function shouldRunXrEnterDeferredWork({
  presenting = false,
  now = 0,
  presentStartedAt = 0,
  minMs = XR_ENTER_DEFER_MS,
} = {}) {
  if (presenting !== true) return false;
  return Number(now) - Number(presentStartedAt) >= (Number(minMs) || XR_ENTER_DEFER_MS);
}

/** True while a live XR session is still in the first-frame budget. */
export function shouldDeferXrEnterWork(state = {}) {
  if (state?.presenting !== true) return false;
  return !shouldRunXrEnterDeferredWork(state);
}

/** Hide CAD on enter so desktop-scale GLBs are not drawn in the first XR frames. */
export function shouldHideCadOnXrEnter({ emptyScene = false } = {}) {
  void emptyScene;
  return true;
}

/** Material clone / wrap unbind waits until the session is stable. */
export function shouldPrepareXrMeshesOnEnter({ enterSettled = true } = {}) {
  return enterSettled === true;
}

/** Triangle CAD raycast (Measure) — never on the first XR frames. */
export function shouldSkipCadTrianglePick({ enterSettled = true } = {}) {
  return enterSettled === false;
}

/** Live CAD AABB pick still walks the mesh tree — skip until enter settles. */
export function shouldPickLiveCad({ enterSettled = true } = {}) {
  return enterSettled === true;
}

/** VideoTexture / clip plane only when the user (or a peer) is actually viewing. */
export function shouldCreateXrClipViewer({
  presenting = false,
  viewing = false,
  enterSettled = true,
} = {}) {
  return presenting === true && viewing === true && enterSettled === true;
}

/** Guides / stats canvas uploads — only while that window is actually open. */
export function shouldTickGuidesCanvas({
  visible = false,
  lastPaintAt = 0,
  now = 0,
  minMs = XR_GUIDES_PAINT_MIN_MS,
  enterSettled = true,
} = {}) {
  if (enterSettled === false) return false;
  if (!visible) return false;
  return Number(now) - Number(lastPaintAt) >= (Number(minMs) || XR_GUIDES_PAINT_MIN_MS);
}

export function shouldTickAvatarBlink({
  avatarCount = 0,
  lastBlinkAt = 0,
  now = 0,
  minMs = XR_AVATAR_BLINK_MIN_MS,
  enterSettled = true,
  avatarFxEnabled = false,
} = {}) {
  if (avatarFxEnabled !== true) return false;
  if (enterSettled === false) return false;
  if (!(Number(avatarCount) > 0)) return false;
  return Number(now) - Number(lastBlinkAt) >= (Number(minMs) || XR_AVATAR_BLINK_MIN_MS);
}

/** Hover-label CAD picks — not the world UI raycast on idle grab frames. */
export function shouldHoverDrawablePick({ tool = "", drawing = false, busy = false } = {}) {
  if (busy === true) return false;
  return String(tool || "") === "draw" || !!drawing;
}

/** Extra hover/grip CAD picks after the per-controller cache is filled. */
export function shouldExtraWorldPick({ busy = false, alreadyPicked = false } = {}) {
  if (busy === true || alreadyPicked === true) return false;
  return true;
}

/** Grab/draw already have a target — skip a second CAD AABB / triangle pick. */
export function shouldSkipWorldMeshPick(state = {}) {
  if (state?.drawing || String(state?.tool || "") === "draw") return false;
  if (state?.tool === "measure") return false;
  return xrInteractionBusy(state);
}

/** Never walk the full CAD graph for a content box while presenting. */
export function shouldTraverseCadForXrContentBox({ presenting = false, hasCached = false } = {}) {
  if (hasCached === true) return false;
  if (presenting === true) return false;
  return true;
}

/** skipTraverse XR frames must not detach gizmos / clear selection / re-grid. */
export function shouldRunXrChromeSideEffects({ skipTraverse = false } = {}) {
  return skipTraverse !== true;
}

/** AR button chooser — camera AR vs joining the collab VR workspace. */
export const AR_CHOOSER_ACTION_IDS = ["ar", "vr-workspace", "cancel"];

export function isArChooserAction(id) {
  return AR_CHOOSER_ACTION_IDS.includes(String(id || ""));
}

/** Three WebXRManager vs UI-only `makeFallbackXrStub`. */
export function isFallbackXrManager(xr) {
  return !!(xr && xr.isFallbackStub === true);
}

export function shouldSetupXrControllers(renderer) {
  const xr = renderer?.xr;
  if (!xr || isFallbackXrManager(xr)) return false;
  return typeof xr.getController === "function";
}

/**
 * PC AR button: live GPU + WebXR AR when the session is actually supported.
 * Fallback stubs must never take this path (no real setSession / camera).
 */
export function shouldRequestImmersiveArOnDesktop({
  headset = false,
  hasRealXr = false,
  immersiveArSupported = false,
} = {}) {
  if (headset) return false;
  return !!(hasRealXr && immersiveArSupported);
}

/** After headset WebXR or a failed desktop immersive-ar, use webcam / mobile AR. */
export function desktopCameraArPlan({
  headset = false,
  hasDesktopAr = false,
  hasMobileAr = false,
} = {}) {
  if (headset) return "none";
  if (hasDesktopAr) return "camera";
  if (hasMobileAr) return "mobile";
  return "none";
}

function quatFromEulerYxz(x, y, z) {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

function quatMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function quatNorm(q) {
  const m = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / m, y: q.y / m, z: q.z / m, w: q.w / m };
}

/**
 * Phone head pose from DeviceOrientationEvent (Tait-Bryan Z-X'-Y'').
 * Applies the usual screen-to-camera -90° X so an upright phone looks along -Z.
 */
export function headPoseFromDeviceOrientation(ev = {}, {
  position = [0, 1.6, 0],
  screenOrientDeg = 0,
} = {}) {
  const deg = Math.PI / 180;
  const alpha = (Number(ev.alpha) || 0) * deg;
  const beta = (Number(ev.beta) || 0) * deg;
  const gamma = (Number(ev.gamma) || 0) * deg;
  const orient = (Number(screenOrientDeg) || 0) * deg;
  let q = quatFromEulerYxz(beta, alpha, -gamma);
  if (orient) {
    const half = -orient / 2;
    q = quatMul(q, { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) });
  }
  const q0 = { x: Math.sin(-Math.PI / 4), y: 0, z: 0, w: Math.cos(-Math.PI / 4) };
  q = quatNorm(quatMul(q0, q));
  const p = Array.isArray(position) ? position : [0, 1.6, 0];
  return {
    p: [Number(p[0]) || 0, Number(p[1]) || 1.6, Number(p[2]) || 0],
    q: [q.x, q.y, q.z, q.w],
  };
}

/** Explorer / menu canvas — only GPU-upload when the painted content changed. */
export function xrConsoleSignature({ title = "", tab = "", tabsKey = "", lines = [], footer = "" } = {}) {
  const row = (lines || [])
    .map((l) => `${l?.id || ""}|${l?.label || ""}|${l?.sub || ""}|${l?.active ? 1 : 0}`)
    .join(";");
  return `${title}|${tab}|${tabsKey}|${footer}|${row}`;
}

export function shouldRedrawXrConsole({ lastSig = "", nextSig = "", force = false } = {}) {
  if (force === true) return true;
  return String(lastSig) !== String(nextSig);
}

/** Recreate tab/row hit planes only when count or ids change — never per click. */
export function shouldRebuildMenuHits({ lastKey = "", nextKey = "", lastCount = 0, nextCount = 0 } = {}) {
  return String(lastKey) !== String(nextKey) || Number(lastCount) !== Number(nextCount);
}

/** Saved room pose parks CAD off-headset. Enter / project load always placeInFront. */
export function shouldRestoreSavedCadPoseOnEnter() {
  return false;
}

/** 1e-6 park + resetXrSafeTransform made every project-load a full re-bake. */
export function shouldParkXrAssemblyAtTinyScale() {
  return false;
}

/** Detailed humanoids stay off; presence supplies a small head/body/hands fallback. */
export function shouldLoadXrAvatarMeshes() {
  return false;
}

export function shouldCloneCadGhostForAvatars() {
  return false;
}

/** CAD material swap is once per mesh — repeating it on every Place/click OOMs Quest. */
export function shouldPrepareXrMeshes({ prepared = false } = {}) {
  return prepared !== true;
}

/** Any pictured map on the live XR mesh — wrap PBR, imported GLB, Fusion bake. */
export const XR_WRAP_TEXTURE_MAP_KEYS = [
  "map", "lightMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap",
  "emissiveMap", "bumpMap", "displacementMap", "alphaMap", "envMap",
  "specularMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap",
  "sheenColorMap", "specularColorMap", "specularIntensityMap",
  "transmissionMap", "thicknessMap", "anisotropyMap",
];

/** Desktop keeps pictured wraps. XR / skipCadExtras must not. */
export function shouldKeepAuthoredTextureMaps({
  presenting = false,
  skipCadExtras = false,
} = {}) {
  return presenting !== true && skipCadExtras !== true;
}

/** “Insert texture from a render” / cover wrap is desktop-only. */
export function shouldApplyRenderedTextureWrap({ presenting = false } = {}) {
  return presenting !== true;
}

export function materialHasWrapMaps(mat, keys = XR_WRAP_TEXTURE_MAP_KEYS) {
  if (!mat) return false;
  return keys.some((key) => !!mat[key]);
}

/** Unbind wrap/PBR slots on a live XR material. Do not dispose — desktop bak owns the maps. */
export function unbindMaterialWrapMaps(mat, keys = XR_WRAP_TEXTURE_MAP_KEYS) {
  if (!mat) return false;
  let changed = false;
  for (const key of keys) {
    if (!mat[key]) continue;
    mat[key] = null;
    changed = true;
  }
  if (changed) mat.needsUpdate = true;
  return changed;
}

/**
 * Parked maps stay unbound on the live XR material. Do not dispose() —
 * that can drop the WebGL context. `_xrMatBak` keeps the Texture objects.
 */
export function disposeParkedWrapGpuTextures(_mat, _keys = XR_WRAP_TEXTURE_MAP_KEYS) {
  return 0;
}

export function disposeParkedWrapGpuFromObject(_root) {
  return 0;
}

/**
 * Re-bind `_xrMatBak` (desktop albedo / wrap) while presenting.
 * Never texture.dispose() — Quest drops the WebGL context.
 */
export function reviveXrParkedMaterials(object3d) {
  if (!object3d) return 0;
  let n = 0;
  const visit = (child) => {
    if (!child || !(child.isMesh || child.isSkinnedMesh)) return;
    const bak = child.userData?._xrMatBak;
    if (!bak) return;
    if (child.material !== bak) {
      child.material = bak;
      n += 1;
    }
  };
  if (typeof object3d.traverse === "function") object3d.traverse(visit);
  else visit(object3d);
  return n;
}

export function wrapReviveDisposesParkedMaps() {
  return false;
}

/** After exit, re-upload parked maps from CPU image. */
export function reviveParkedWrapGpuTextures(mat, keys = XR_WRAP_TEXTURE_MAP_KEYS) {
  if (!mat) return 0;
  let n = 0;
  for (const key of keys) {
    const tex = mat[key];
    if (!tex) continue;
    tex.needsUpdate = true;
    if (tex.userData) tex.userData._xrGpuDisposed = false;
    n += 1;
  }
  return n;
}

/** Set overlay flags only when they actually differ — avoids material.needsUpdate storms. */
export function applyOverlayMaterialFlags(mat, flags = { transparent: true, depthTest: false, depthWrite: false }) {
  if (!mat) return false;
  let changed = false;
  if (flags.transparent != null && mat.transparent !== flags.transparent) {
    mat.transparent = flags.transparent;
    changed = true;
  }
  if (flags.depthTest != null && mat.depthTest !== flags.depthTest) {
    mat.depthTest = flags.depthTest;
    changed = true;
  }
  if (flags.depthWrite != null && mat.depthWrite !== flags.depthWrite) {
    mat.depthWrite = flags.depthWrite;
    changed = true;
  }
  if (flags.colorWrite != null && mat.colorWrite !== flags.colorWrite) {
    mat.colorWrite = flags.colorWrite;
    changed = true;
  }
  if (changed) mat.needsUpdate = true;
  return changed;
}

/** Opaque world menus — occlusion without alpha blend. */
export const XR_WORLD_UI_MAT_FLAGS = { transparent: false, depthTest: true, depthWrite: true };

/** Invisible pick planes — no depth write, no color (hover glow uses opacity on a few). */
export const XR_WORLD_PICK_MAT_FLAGS = { transparent: true, depthTest: true, depthWrite: false };

/** World-space menus/windows — real depth so CAD/drawings in front occlude them. */
export function applyWorldUiMaterialFlags(mat, flags = XR_WORLD_UI_MAT_FLAGS) {
  return applyOverlayMaterialFlags(mat, flags);
}

export function applyWorldUiPickMaterialFlags(mat, flags = XR_WORLD_PICK_MAT_FLAGS) {
  return applyOverlayMaterialFlags(mat, flags);
}

export function isXrWorldPickMesh(obj) {
  const u = obj?.userData || {};
  if (
    u.xrPickOnly
    || u.xrAiHit
    || u.xrAiDrag
    || u.xrGridHit
    || u.xrStudioDrag
    || u.xrStudioClose
    || u.xrMenuTab
    || u.xrMenuRow
    || u.xrMenuClose
    || u.xrExplorerDrag
    || u.xrViewHit
    || u.xrRoboticsHit
    || u.xrRoboticsDrag
  ) return true;
  const mat = Array.isArray(obj?.material) ? obj.material[0] : obj?.material;
  if (mat?.colorWrite === false) return true;
  const op = Number(mat?.opacity);
  return Number.isFinite(op) && op > 0 && op < 0.05;
}

export function skipXrInstancedPick(obj) {
  return !!(obj?.isInstancedMesh || obj?.userData?.xrLiveInk || isXrCadGrabProxy(obj));
}

/** AABB/debug cubes (xrCadProxy, cyan face probe) — never a squeeze target. */
export function isXrCadGrabProxy(obj) {
  if (!obj) return false;
  const u = obj.userData || {};
  if (u.xrCadProxy === true) return true;
  const name = String(obj.name || "");
  return name === "xrCadProxy" || name === "xrFaceProbe";
}

/** Squeeze never attaches the live mesh unless the controller is on/aiming at it. */
export function studioGripAllowsLiveMeshFallback() {
  return false;
}

export function resolveStudioGripTarget({ hitMesh = null, liveMesh = null } = {}) {
  if (hitMesh) return hitMesh;
  if (studioGripAllowsLiveMeshFallback()) return liveMesh || null;
  return null;
}

/**
 * Studio CAD / share / drawable mesh — same “must actually hit the model”
 * rule as visergrip1’s viserGeometry check. Floor, grid, axes, helpers, and
 * AABB cubes are never a trigger-move target.
 */
export function isStudioModelGrabMesh(obj) {
  if (!obj?.isMesh || obj.visible === false) return false;
  if (obj.isLine || obj.isLineSegments || obj.isPoints || obj.isSprite) return false;
  if (obj.isGridHelper || obj.type === "GridHelper" || obj.isAxesHelper || obj.type === "AxesHelper") return false;
  if (isDesktopSceneChrome(obj) || isXrCadGrabProxy(obj) || isXrSelectionAabb(obj)) return false;
  const u = obj.userData || {};
  if (u.xrIgnoreBounds || u.xrCadProxy || u.viserHelper || u.xrHudPlane || u.xrSnapGrid) return false;
  if (u.isEdge || u.isSilhouette || u.isObjectHighlight) return false;
  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  if (mat?.colorWrite === false) return false;
  for (let p = obj; p; p = p.parent) {
    if (p.visible === false) return false;
    if (isDesktopSceneChrome(p) || isXrCadGrabProxy(p) || isXrSelectionAabb(p)) return false;
    const pu = p.userData || {};
    if (pu.xrIgnoreBounds || pu.viserHelper || pu.xrHudPlane || pu.xrSnapGrid) return false;
    const name = String(p.name || "");
    if (name === "large-grid-axes" || name === "grid-dots" || name === "architect-grid-dots") return false;
    if (name === "Live OpenArm") break;
  }
  return true;
}

/** One-shot triangle hit on a CAD / share root. Never AABB, never per-frame Box3. */
export function studioAimHitsModel(raycaster, root) {
  if (!raycaster || !root || root.visible === false) return null;
  const hits = raycaster.intersectObject(root, true);
  return hits.find((h) => isStudioModelGrabMesh(h.object)) || null;
}

/**
 * Trigger may move the model only on a real mesh hit.
 * Teleop owns triggers as grippers; UI / cheap AABB / miss never steal CAD.
 */
export function studioTriggerMovesModel({
  teleopArmed = false,
  uiHit = false,
  cheapHit = false,
  meshHit = false,
  hoverCad = false,
} = {}) {
  if (teleopArmed === true) return false;
  if (uiHit === true) return false;
  if (meshHit === true || hoverCad === true) return true;
  if (cheapHit === true) return false;
  return false;
}

/** Keep lastProjectId until app.js wired __openDeferredXrProject — do not drop it on first present. */
export function shouldFlushDeferredXrProject({ presenting = false, hasOpener = false } = {}) {
  return presenting === true && hasOpener === true;
}

export function xrDrawablePickList(meshes = []) {
  return (meshes || []).filter((m) => m && !skipXrInstancedPick(m));
}

/** CAD triangle raycast (Measure edge snap) — never for grab/draw/idle. */
export function shouldCadTrianglePick(state = {}) {
  const tool = String(state.tool || "");
  if (tool !== "measure" && tool !== "transparent") return false;
  return !shouldSkipCadTrianglePick(state);
}

export function xrAiPanelSignature(state = {}) {
  const imgs = Array.isArray(state.composeImages) ? state.composeImages : [];
  return [
    state.draft || "",
    state.generating ? 1 : 0,
    state.listening ? 1 : 0,
    state.status || "",
    state.drawStrokes || 0,
    state.drawClips || 0,
    state.keyboardOpen ? 1 : 0,
    state.modelPickerOpen ? 1 : 0,
    state.modelPickerScroll || 0,
    state.talking ? 1 : 0,
    state.talkConnecting ? 1 : 0,
    state.talkStatus || "",
    state.talkError ? 1 : 0,
    imgs.length,
    imgs.map((im) => im?.id || im?.data_url?.slice(0, 24) || "").join(","),
    state.progress || "",
    state.overlayLine || "",
    state.generating ? Math.floor(Number(state.now || 0) / 250) : 0,
    state.overflowOpen ? 1 : 0,
    state.locked ? 1 : 0,
    state.roundTable ? 1 : 0,
    state.sandbox ? 1 : 0,
  ].join("|");
}

export function xrGridPopupSignature({ kind = "", tab = "", tools = [] } = {}) {
  const row = (tools || [])
    .map((t) => `${t?.id || ""}|${t?.label || ""}|${Number(t?.color) || 0}|${t?.on ? 1 : 0}`)
    .join(";");
  return `${kind}|${tab}|${row}`;
}

export function xrUiHoverSignature(hit) {
  if (!hit || typeof hit !== "object") return "";
  return `${hit.kind || ""}|${hit.id || ""}|${hit.tab || ""}|${hit.panel || ""}|${hit.line?.id || ""}`;
}

export function shouldUpdateXrUiHover({ lastSig = "", nextSig = "" } = {}) {
  return String(lastSig) !== String(nextSig);
}

export function shouldUploadXrVideoFrame({
  hasTex = false,
  isVideo = false,
  ready = false,
  paused = false,
} = {}) {
  if (!hasTex || isVideo !== true) return false;
  if (paused === true) return false;
  return ready === true;
}

export function shouldFaceNametag({
  headMoved = false,
  viewerMoved = false,
} = {}) {
  return headMoved === true || viewerMoved === true;
}

export function shouldTickXrPresence({
  enterSettled = true,
  busy = false,
  avatarCount = 0,
} = {}) {
  if (enterSettled === false || busy === true) return false;
  return Number(avatarCount) > 0;
}

export function shouldApplyOverlayRelayerFlags(obj) {
  if (!obj?.isMesh) return false;
  if (obj.userData?.xrWorldDepth) return false;
  if (obj.userData?.xrClipViewer || obj.userData?.xrSharedVideo) return false;
  if (obj.userData?.xrBoardPlane || obj.userData?.xrRoundTable || obj.userData?.xrChair) return false;
  return Number(obj.renderOrder) >= 2000;
}

/**
 * Clip/still plane in headset. Opaque + no depth so Quest VideoTexture
 * (often alpha=0) is not discarded, and world-UI relayer cannot paint it black.
 */
export function applyXrClipViewerMaterialFlags(mat) {
  return applyOverlayMaterialFlags(mat, {
    transparent: false,
    depthTest: false,
    depthWrite: false,
  });
}

export function xrCaptureIsStillKind({ kind = "", url = "", mime = "", filename = "" } = {}) {
  const blobType = String(mime || "");
  if (blobType.startsWith("image/")) return true;
  if (blobType.startsWith("video/")) return false;
  const k = String(kind || "").toLowerCase();
  if (k === "screenshot" || k === "image" || k === "still") return true;
  if (k === "video" || k === "recording") return false;
  const name = `${url} ${filename}`.split("?")[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg|tiff?)$/i.test(name)) return true;
  if (/\.(webm|mp4|mov|m4v)$/i.test(name)) return false;
  return false;
}

export function xrCaptureIsHeadsetMediaName(name = "") {
  return /\.(png|jpe?g|webp|gif|bmp|webm|mp4|mov|m4v)$/i.test(String(name || "").split("?")[0]);
}

/** Same-origin paths can take ?token=; blob/data URLs must not. */
export function xrMediaUrlWithToken(url = "", token = "") {
  const src = String(url || "").trim();
  const tok = String(token || "").trim();
  if (!src || !tok) return src;
  if (/^(blob:|data:|https?:\/\/)/i.test(src) && !src.startsWith("/")) {
    try {
      const u = new URL(src, "https://render3d.app");
      if (u.protocol === "blob:" || u.protocol === "data:") return src;
      if (u.origin && typeof location !== "undefined" && u.origin !== location.origin) return src;
    } catch {
      if (/^(blob:|data:)/i.test(src)) return src;
    }
  }
  if (!src.startsWith("/") && !src.startsWith(String(typeof location !== "undefined" ? location.origin : ""))) {
    return src;
  }
  if (/[?&]token=/.test(src)) return src;
  return `${src}${src.includes("?") ? "&" : "?"}token=${encodeURIComponent(tok)}`;
}

export function xrClipViewerTextureOpts() {
  return { generateMipmaps: false, minFilter: "LinearFilter", magFilter: "LinearFilter" };
}

export const XR_STARTER_TOOL_ID = "grab";
export const XR_B_HOLD_RESET_MS = 480;

/** Hold B (not a tap) restores grab / starter wrist tools. */
export function shouldResetStarterOnBHold({ heldMs = 0, alreadyReset = false, holdMs = XR_B_HOLD_RESET_MS } = {}) {
  if (alreadyReset) return false;
  return Number(heldMs) >= (Number(holdMs) || XR_B_HOLD_RESET_MS);
}

/** B-down dismisses the tool immediately — do not wait for the hold timer. */
export function shouldDismissToolOnBPress({ alreadyPointer = false } = {}) {
  void alreadyPointer;
  return true;
}

/** Hold-B, post-B pointer, or presenting pick lasers: HUD trigger picks live. */
export function laserPointerModeOn({ bHeld = false, aimMode = false, presenting = false } = {}) {
  return bHeld === true || aimMode === true || presenting === true;
}

/** Thin aim beams on both Touch pads while the headset is posed. */
export function presentingPickLasersOn({ presenting = false, posed = false } = {}) {
  return presenting === true && posed === true;
}

const HANDHELD_INK_TOOL_RE = /^(pen|brush|ink|highlighter|eraser|line|arrow)$/;

/** Canonical ink id for draw / board pen tools. */
export function handheldInkToolId(tool) {
  const t = String(tool || "").trim().toLowerCase();
  if (!t) return "";
  if (t === "draw" || t === "voice_draw") return "pen";
  if (t.startsWith("board:")) return t.replace(/^board:(?:tool:)?/, "");
  if (t.startsWith("draw_brush_")) return t.slice("draw_brush_".length);
  return t;
}

/** Handheld draw/create replaces the laser; grab/menus keep it. */
export function handheldToolHidesLaser(tool) {
  const t = String(tool || "").trim();
  if (toolHandUiIds(t).length > 0) return true;
  const lower = t.toLowerCase();
  if (lower === "draw" || lower === "voice_draw") return true;
  return HANDHELD_INK_TOOL_RE.test(handheldInkToolId(t));
}

/** Drawing/create hand is tip-only; the other controller may keep a menu laser. */
export function controllerHidesDrawLaser({ tool = "", hand = "", drawHand = "right" } = {}) {
  if (!handheldToolHidesLaser(tool)) return false;
  const h = String(hand || "").toLowerCase();
  const d = String(drawHand || "right").toLowerCase();
  if (h !== "left" && h !== "right") return true;
  return h === d;
}

export function isXrStarterTool(id) {
  const t = String(id || "");
  return t === "grab" || t === "rotate" || t === "scale";
}

/** Quest VideoTexture often fails on VP9; prefer VP8/mp4 in headset. */
export function pickXrRecordMimeType(isTypeSupported = (t) => !!t) {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/mp4",
    "video/webm",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
  ];
  for (const type of candidates) {
    try {
      if (isTypeSupported(type)) return type;
    } catch { /* ignore */ }
  }
  return "";
}

/** Hidden capture strip must not rebuild on VR enter — Shot/Rec live on the wrist rail. */
export function shouldRebuildCaptureDock({ visible = false, modeChanged = false, buttonCount = 0 } = {}) {
  if (!visible) return false;
  return !!modeChanged || !(Number(buttonCount) > 0);
}

/** Don't re-place CAD every XR frame while the headset pose is still settling. */
export function shouldPlaceCadThisFrame({
  pending = false,
  worldAnchored = false,
  lastPlaceAt = 0,
  now = 0,
  attempts = 0,
  minIntervalMs = XR_PLACE_CAD_MIN_MS,
  enterSettled = true,
} = {}) {
  if (!pending || worldAnchored) return false;
  if (enterSettled !== true) return false;
  if (!(Number(attempts) > 1)) return true;
  return Number(now) - Number(lastPlaceAt) >= (Number(minIntervalMs) || XR_PLACE_CAD_MIN_MS);
}

/** Stop the enter retry after one seated place or a short miss cap — never 45×. */
export function shouldClearPendingCadPlace({
  worldAnchored = false,
  enterSettled = false,
  attempts = 0,
  maxAttempts = XR_PENDING_PLACE_MAX,
} = {}) {
  if (worldAnchored === true) return true;
  if (enterSettled !== true) return false;
  return Number(attempts) >= (Number(maxAttempts) > 0 ? Number(maxAttempts) : XR_PENDING_PLACE_MAX);
}

/** Parked XR scale (desktop 1e-6 swap). Never bake forever. */
export const XR_PARKED_SCALE_MAX = 1e-4;
export const XR_SIZE_RESCUE_MAX = 2;
export const XR_SIZE_RESCUE_MIN_MS = 700;

/** Hidden but already handheld — just show it. No placeInFront. */
export function shouldUnhideXrCad({
  visible = true,
  grabbing = false,
  emptyScene = false,
  projectSwap = false,
  enterSettled = true,
} = {}) {
  if (grabbing === true || emptyScene === true || projectSwap === true) return false;
  if (enterSettled === false) return false;
  return visible !== true;
}

/**
 * 1e-6 park leaking into XR. At most two placeCadForSession bakes.
 * After the cap, leave the mesh; unhide-only still applies if scale recovers.
 */
export function shouldBakeParkedXrCad({
  scaleX = 1,
  grabbing = false,
  emptyScene = false,
  projectSwap = false,
  attempts = 0,
  maxAttempts = XR_SIZE_RESCUE_MAX,
  lastAt = 0,
  now = 0,
  minMs = XR_SIZE_RESCUE_MIN_MS,
  parkedScaleMax = XR_PARKED_SCALE_MAX,
} = {}) {
  if (grabbing === true || emptyScene === true || projectSwap === true) return false;
  const cap = Number(maxAttempts) > 0 ? Number(maxAttempts) : XR_SIZE_RESCUE_MAX;
  if (Number(attempts) >= cap) return false;
  if (!(Math.abs(Number(scaleX) || 0) < parkedScaleMax)) return false;
  if (Number(attempts) > 0) {
    return Number(now) - Number(lastAt) >= (Number(minMs) || XR_SIZE_RESCUE_MIN_MS);
  }
  return true;
}

/**
 * Saved-pose restore already has a legal handheld/room size — do not keep
 * calling placeInFront / applySavedPose (full CAD traverse + scale bake).
 */
export function shouldMarkCadWorldAnchored({ restored = false, placed = false } = {}) {
  return restored === true || placed === true;
}

/** Near-plane push + AABB rebuild — skip once the model is seated. */
export function shouldKeepModelClearOfNearPlane({
  worldAnchored = false,
  grabbing = false,
  enterSettled = true,
} = {}) {
  if (enterSettled === false) return false;
  return worldAnchored !== true && grabbing !== true;
}

/** Idle content-box refresh. Anchored CAD must not rebuild every 280 ms. */
export const XR_CONTENT_BOX_SETTLING_MS = 280;
export const XR_CONTENT_BOX_ANCHORED_MS = 4000;

export function shouldRefreshXrContentBox({
  grabbing = false,
  worldAnchored = false,
  lastMs = 0,
  now = 0,
  force = false,
} = {}) {
  if (force === true) return true;
  if (grabbing) return false;
  const age = Number(now) - Number(lastMs);
  const wait = worldAnchored ? XR_CONTENT_BOX_ANCHORED_MS : XR_CONTENT_BOX_SETTLING_MS;
  return !(Number.isFinite(age) && age < wait);
}

/** Already ~12cm handheld — skip scale bake / second traverse. */
export function shouldSkipXrScaleBake({
  worldMax = 0,
  targetM = 0.12,
  minRatio = 0.85,
  maxRatio = 1.15,
} = {}) {
  const w = Number(worldMax);
  const t = Number(targetM) || 0.12;
  if (!(w > 1e-6) || !(t > 0)) return false;
  const r = w / t;
  return r >= minRatio && r <= maxRatio;
}

/**
 * First XR place must not walk every CAD fragment. Reuse a stashed local AABB
 * (8-corner transform) instead of a full `Box3` mesh traverse.
 */
export const XR_PLACE_AABB_MESH_CAP = 8;

export function shouldReuseCachedXrBounds({ hasCached = false } = {}) {
  return hasCached === true;
}

/** Walk only when there is no stashed local box. First place is still capped. */
export function shouldWalkXrPlaceAabb({
  hasCached = false,
  firstPlace = false,
  force = false,
} = {}) {
  if (hasCached === true) return false;
  if (firstPlace === true) return true;
  return force === true;
}

export function shouldStopXrPlaceAabbWalk({
  visited = 0,
  firstPlace = false,
  maxMeshes = XR_PLACE_AABB_MESH_CAP,
} = {}) {
  if (firstPlace !== true) return false;
  const cap = Number(maxMeshes) > 0 ? Number(maxMeshes) : XR_PLACE_AABB_MESH_CAP;
  return Number(visited) >= cap;
}

/** Abortable mesh walk — Three.js `traverse` cannot stop, which OOMs giant CAD. */
export function xrWalkMeshesCapped(root, visit, maxMeshes = XR_PLACE_AABB_MESH_CAP) {
  const cap = Number(maxMeshes) > 0 ? Number(maxMeshes) : XR_PLACE_AABB_MESH_CAP;
  let n = 0;
  const stack = root ? [root] : [];
  while (stack.length && n < cap) {
    const o = stack.pop();
    if (!o) continue;
    if (o.isMesh && o.geometry) {
      try { if (visit(o) !== false) n += 1; } catch { n += 1; }
    }
    const kids = o.children;
    if (!kids?.length) continue;
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return n;
}

/**
 * Transform a local AABB through a column-major 4×4 (Three.js Matrix4.elements).
 * Eight corners only — no mesh traverse.
 */
export function xrWorldBoxFromLocalBox(localMin = [0, 0, 0], localMax = [0, 0, 0], e = null) {
  const m = e && e.length >= 16 ? e : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const x0 = Number(localMin[0]);
  const y0 = Number(localMin[1]);
  const z0 = Number(localMin[2]);
  const x1 = Number(localMax[0]);
  const y1 = Number(localMax[1]);
  const z1 = Number(localMax[2]);
  if (![x0, y0, z0, x1, y1, z1].every(Number.isFinite)) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  for (let ix = 0; ix < 2; ix += 1) {
    const x = ix ? x1 : x0;
    for (let iy = 0; iy < 2; iy += 1) {
      const y = iy ? y1 : y0;
      for (let iz = 0; iz < 2; iz += 1) {
        const z = iz ? z1 : z0;
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (wx < minx) minx = wx;
        if (wy < miny) miny = wy;
        if (wz < minz) minz = wz;
        if (wx > maxx) maxx = wx;
        if (wy > maxy) maxy = wy;
        if (wz > maxz) maxz = wz;
      }
    }
  }
  return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}

export function readXrLocalBox(mesh) {
  const rec = mesh?.userData?._xrLocalBox;
  if (!rec?.min || !rec?.max) return null;
  const min = rec.min;
  const max = rec.max;
  if (![min[0], min[1], min[2], max[0], max[1], max[2]].every(Number.isFinite)) return null;
  return rec;
}

export function stashXrLocalBox(mesh, worldMin, worldMax, invWorldElements) {
  if (!mesh) return null;
  const rec = xrWorldBoxFromLocalBox(worldMin, worldMax, invWorldElements);
  if (!Number.isFinite(rec.min[0]) || rec.min[0] === Infinity) return null;
  try {
    mesh.userData = mesh.userData || {};
    mesh.userData._xrLocalBox = rec;
  } catch {
    return rec;
  }
  return rec;
}

/** Skip `new MeshStandardMaterial` per part in XR — unique programs freeze Quest. */
export function shouldCloneXrPbrMaterials({ presenting = false } = {}) {
  return presenting !== true;
}

/** One CAD plastic program for the whole assembly on the first XR place. */
export function shouldShareXrCadMaterial({ presenting = false } = {}) {
  return presenting === true;
}

export const XR_MAT_SWAP_CHUNK = 24;

export function xrMaterialSwapBudget({ remaining = 0, chunk = XR_MAT_SWAP_CHUNK } = {}) {
  const n = Math.max(0, Number(remaining) || 0);
  const c = Number(chunk) > 0 ? Number(chunk) : XR_MAT_SWAP_CHUNK;
  return Math.min(n, c);
}

/** Crease LineSegments2 / EdgesGeometry — skip while presenting. */
export function shouldSyncCadEdgesWhilePresenting({ presenting = false } = {}) {
  return presenting !== true;
}

export function shouldHideCadEdgesInXr({ presenting = false } = {}) {
  return presenting === true;
}

/** First XR present: do not fill every CAD triangle in one frame. */
export const XR_UNHIDE_MESHES_PER_FRAME = 2;
export const XR_FIRST_FRAME_TRI_BUDGET = 6000;
export const XR_HIGH_POLY_TRI_DELAY = 8000;
/** Never enable a full BufferGeometry above this in XR (Quest crash on million-tri draws). */
export const XR_MESH_TRI_HARD_CAP = 40000;
/** Session draw cap — leftover parts stay on the cheap bounds proxy. */
export const XR_CAD_DRAW_MAX_PARTS = 24;
export const XR_CAD_DRAW_MAX_TRIS = 16000;
export const XR_UNHIDE_UNIT_CAP = 48;
/** Sharp-but-stable Quest eye buffer. Scale 1.0 + HUD 2.5× froze the headset (20260914-2038). */
export const XR_FRAMEBUFFER_SCALE = 0.85;
export const XR_FOVEATION = 0.35;
/** Quest HUD/printer/share work after printbox1 + roomshare2 + near windows. */
export const XR_PERF_CACHE = "xrperf3";
export const XR_CLOCK_HUD_MS = 1000;
export const XR_HUD_FOLLOW_MS = 48;
export const XR_SHARE_AIM_PAINT_MS = 140;
export const XR_PRINTER_DASH_REBUILD_M = 0.025;

/** Printer outline / model — only when prefs or the drawn volume changed. */
export function shouldSyncPrinterVisuals({ dirty = false } = {}) {
  return dirty === true;
}

/** Dashed preview / fence follow — only while the user is placing corners. */
export function shouldTickPrinterFencePreview({ placing = false } = {}) {
  return placing === true;
}

/** Canvas + texture upload for the throw-to-print nameplate. */
export function shouldPaintShareAimHud({
  armed = false,
  targetKey = "",
  lastKey = "",
  now = 0,
  lastAt = 0,
  minMs = XR_SHARE_AIM_PAINT_MS,
} = {}) {
  if (armed !== true) return false;
  if (String(targetKey) !== String(lastKey)) return true;
  return Number(now) - Number(lastAt) >= (Number(minMs) || XR_SHARE_AIM_PAINT_MS);
}

/** Belt-follow + window arc. New windows run immediately; idle head motion is ~20 Hz. */
export function shouldFollowHudThisFrame({
  now = 0,
  lastAt = 0,
  minMs = XR_HUD_FOLLOW_MS,
  windowOpened = false,
  headMoved = false,
} = {}) {
  if (windowOpened === true) return true;
  const elapsed = Number(now) - Number(lastAt);
  if (headMoved === true) return elapsed >= (Number(minMs) || XR_HUD_FOLLOW_MS);
  return elapsed >= 240;
}

export function shouldFormatXrClockHud({
  now = 0,
  lastAt = 0,
  minMs = XR_CLOCK_HUD_MS,
} = {}) {
  return Number(now) - Number(lastAt) >= (Number(minMs) || XR_CLOCK_HUD_MS);
}

/** Scale an existing dashed box — do not remake EdgesGeometry every mm. */
export function shouldRebuildDashedPrinterBox({
  prev = null,
  next = null,
  minDeltaM = XR_PRINTER_DASH_REBUILD_M,
} = {}) {
  if (!next) return false;
  if (!prev) return true;
  const lim = Number(minDeltaM) > 0 ? Number(minDeltaM) : XR_PRINTER_DASH_REBUILD_M;
  return Math.abs(Number(prev.x || 0) - Number(next.x || 0)) > lim
    || Math.abs(Number(prev.y || 0) - Number(next.y || 0)) > lim
    || Math.abs(Number(prev.z || 0) - Number(next.z || 0)) > lim;
}
export const XR_CAD_CENSUS_MESH_CAP = 64;
export const XR_CAD_DRAW_LAYER = 0;
export const XR_CAD_HOLD_LAYER = 2;
export const XR_HIGH_POLY_IDLE_FRAMES = 12;
export const XR_ENTER_CANVAS_MS = 2200;
export const XR_CAD_PALETTE_COLORS = [
  0x4a4f57, 0x8b9098, 0xd0d4dc,
  0xc45c5c, 0xc4a05c, 0x5c8f4a,
  0x4a8f9a, 0x5c6ec4, 0x9a5c9a,
];

/** Menu / howto / layout canvases wait until CAD has a few unhide frames. */
export function shouldRunXrEnterCanvasWork({
  presenting = false,
  now = 0,
  presentStartedAt = 0,
  minMs = XR_ENTER_CANVAS_MS,
  unhideBusy = false,
  revealedThisFrame = 0,
} = {}) {
  if (presenting !== true) return false;
  if (unhideBusy === true) return false;
  if (Number(revealedThisFrame) > 0) return false;
  return Number(now) - Number(presentStartedAt) >= (Number(minMs) || XR_ENTER_CANVAS_MS);
}

/** Voice fetch / ICE restart must not share a frame with a large CAD unhide. */
export function shouldRunXrVoiceIceWork({
  presenting = false,
  enterSettled = true,
  unhideBusy = false,
  revealedThisFrame = 0,
} = {}) {
  if (presenting !== true || enterSettled !== true) return false;
  if (unhideBusy === true) return false;
  if (Number(revealedThisFrame) > 0) return false;
  return true;
}

export function xrMeshTriangleCount(geometry) {
  if (!geometry) return 0;
  const idx = geometry.index;
  if (idx && Number(idx.count) > 0) return Math.floor(Number(idx.count) / 3);
  const n = Number(geometry.attributes?.position?.count) || 0;
  return Math.floor(n / 3);
}

export function xrCadNodeKind(o) {
  if (!o) return "empty";
  if (
    o.userData?.isEdge
    || o.userData?.isSilhouette
    || o.isLineSegments2
    || o.isLineSegments
    || o.isLine
  ) return "line";
  if (o.isMesh || o.isSkinnedMesh) return "mesh";
  if (o.isLight || o.isSprite || o.isPoints || o.isBone || o.isCamera) return "extra";
  return "group";
}

export function xrCadTreeCensus(root, { maxMeshes = XR_CAD_CENSUS_MESH_CAP } = {}) {
  const cap = Number(maxMeshes) > 0 ? Number(maxMeshes) : XR_CAD_CENSUS_MESH_CAP;
  const out = {
    parts: 0,
    triangles: 0,
    lineSegments: 0,
    extras: 0,
    truncated: false,
  };
  let meshN = 0;
  const stack = root ? [root] : [];
  while (stack.length) {
    const o = stack.pop();
    if (!o) continue;
    const kind = xrCadNodeKind(o);
    if (kind === "line") out.lineSegments += 1;
    else if (kind === "extra") out.extras += 1;
    else if (kind === "mesh") {
      if (meshN >= cap) {
        out.truncated = true;
      } else {
        out.parts += 1;
        out.triangles += xrMeshTriangleCount(o.geometry);
        meshN += 1;
      }
    }
    const kids = o.children;
    if (!kids?.length) continue;
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return out;
}

function xrCadSkipUnhideNode(c) {
  return !!(
    c?.userData?.isEdge
    || c?.userData?.isSilhouette
    || c?.userData?.cadInternalHidden
    || c?.userData?.xrCadProxy
    || c?.userData?.xrDrop
    || c?.name === "xrModelMarker"
    || c?.name === "xrCadProxy"
  );
}

/** Top-level CAD parts to reveal — never a second GLB, just visibility chunks. */
export function xrCadUnhideUnits(root, { maxUnits = XR_UNHIDE_UNIT_CAP } = {}) {
  const cap = Number(maxUnits) > 0 ? Number(maxUnits) : XR_UNHIDE_UNIT_CAP;
  if (!root) return [];
  const top = (root.children || []).filter((c) => !xrCadSkipUnhideNode(c));
  if (top.length >= 2) return top.slice(0, cap);
  if (top.length === 1 && (top[0].children || []).length >= 2) {
    const inner = top[0].children.filter((c) => !xrCadSkipUnhideNode(c));
    if (inner.length >= 2) return inner.slice(0, cap);
  }
  const meshes = [];
  xrWalkMeshesCapped(root, (o) => {
    if (xrCadSkipUnhideNode(o)) return false;
    meshes.push(o);
    return true;
  }, cap);
  if (meshes.length) return meshes;
  return xrCadSkipUnhideNode(root) ? [] : [root];
}

export function xrUnitTriangleCount(unit, maxMeshes = XR_PLACE_AABB_MESH_CAP) {
  if (!unit) return 0;
  if (unit.isMesh || unit.isSkinnedMesh) return xrMeshTriangleCount(unit.geometry);
  let t = 0;
  xrWalkMeshesCapped(unit, (o) => {
    t += xrMeshTriangleCount(o.geometry);
    return true;
  }, maxMeshes);
  return t;
}

export function shouldSkipOverBudgetXrMesh({
  triangles = 0,
  hardCap = XR_MESH_TRI_HARD_CAP,
} = {}) {
  return Number(triangles) > (Number(hardCap) > 0 ? Number(hardCap) : XR_MESH_TRI_HARD_CAP);
}

export function xrIsPreviewStandInName(name = "") {
  return /preview|lowpoly|low-poly|lod0|_lite|_simp/i.test(String(name || ""));
}

/**
 * Already-simplified geometry / preview mesh in the live tree — never a second GLB.
 */
export function xrSimplifiedStandIn(obj, { hardCap = XR_MESH_TRI_HARD_CAP } = {}) {
  if (!obj) return null;
  const cap = Number(hardCap) > 0 ? Number(hardCap) : XR_MESH_TRI_HARD_CAP;
  const ud = obj.userData || {};
  const cands = [];
  const pushGeo = (geo, host, swapGeometry) => {
    const tris = xrMeshTriangleCount(geo);
    if (!(tris > 0) || tris > cap) return;
    cands.push({ obj: host || obj, geometry: geo, triangles: tris, swapGeometry: !!swapGeometry });
  };
  const pushMesh = (mesh, swapGeometry) => {
    if (!mesh) return;
    if (mesh.isMesh || mesh.isSkinnedMesh) pushGeo(mesh.geometry, mesh, swapGeometry);
    else if (mesh.geometry) pushGeo(mesh.geometry, obj, true);
  };
  if (ud.simplifiedGeometry) pushGeo(ud.simplifiedGeometry, obj, true);
  if (ud.previewGeometry) pushGeo(ud.previewGeometry, obj, true);
  if (ud.liteGeometry) pushGeo(ud.liteGeometry, obj, true);
  for (const key of ["xrLiteMesh", "xrPreviewMesh", "previewMesh", "liteMesh"]) {
    const m = ud[key];
    if (m) pushMesh(m, m === obj);
  }
  for (const child of obj.children || []) {
    if (!child || child.userData?.xrCadProxy) continue;
    const n = String(child.name || "");
    if (
      child.userData?.xrPreview
      || child.userData?.xrLite
      || child.userData?.isPreview
      || xrIsPreviewStandInName(n)
    ) pushMesh(child, false);
  }
  cands.sort((a, b) => a.triangles - b.triangles);
  return cands[0] || null;
}

export function xrAnnotateUnhideUnit(obj) {
  const triangles = xrUnitTriangleCount(obj);
  const standIn = xrSimplifiedStandIn(obj);
  return { obj, triangles, standIn };
}

export function shouldDelayHighPolyXrPart({
  triangles = 0,
  maxTris = XR_HIGH_POLY_TRI_DELAY,
} = {}) {
  return Number(triangles) > (Number(maxTris) > 0 ? Number(maxTris) : XR_HIGH_POLY_TRI_DELAY);
}

export function shouldRevealXrHighPoly({
  enterSettled = false,
  framesSincePlace = 0,
  minFrames = XR_HIGH_POLY_IDLE_FRAMES,
} = {}) {
  if (enterSettled !== true) return false;
  return Number(framesSincePlace) >= (Number(minFrames) > 0 ? Number(minFrames) : XR_HIGH_POLY_IDLE_FRAMES);
}

export function shouldShowXrCadProxy({ remaining = 0, shown = 0, skipped = 0 } = {}) {
  void remaining;
  void shown;
  void skipped;
  return false;
}

export function shouldCapXrCadSessionDraw({
  shown = 0,
  triShown = 0,
  maxParts = XR_CAD_DRAW_MAX_PARTS,
  maxTris = XR_CAD_DRAW_MAX_TRIS,
} = {}) {
  const parts = Number(maxParts) > 0 ? Number(maxParts) : XR_CAD_DRAW_MAX_PARTS;
  const tris = Number(maxTris) > 0 ? Number(maxTris) : XR_CAD_DRAW_MAX_TRIS;
  return Number(shown) >= parts || Number(triShown) >= tris;
}

/** Quest WebXRManager scale + foveation (0 = full res, 1 = max foveation). */
export function xrFramebufferScaleFactor({ presenting = true } = {}) {
  return presenting === true ? XR_FRAMEBUFFER_SCALE : 1;
}

export function xrFoveationLevel({ presenting = true } = {}) {
  return presenting === true ? XR_FOVEATION : 0;
}

export function applyXrRenderScale(xr, { presenting = true } = {}) {
  if (!xr) return false;
  const scale = xrFramebufferScaleFactor({ presenting });
  const fov = xrFoveationLevel({ presenting });
  let ok = false;
  try {
    xr.setFramebufferScaleFactor?.(scale);
    ok = true;
  } catch { /* ignore */ }
  try {
    xr.setFoveation?.(fov);
    ok = true;
  } catch { /* ignore */ }
  return ok;
}

/** Best-effort session.renderState foveation when the UA exposes it. */
export function xrSessionFoveation(session, { presenting = true } = {}) {
  if (presenting !== true || !session) return 0;
  const level = xrFoveationLevel({ presenting });
  try {
    const layer = session.renderState?.baseLayer;
    if (layer && "fixedFoveation" in layer) layer.fixedFoveation = level;
  } catch { /* ignore */ }
  return level;
}

export function xrCadUnhideInProgress(state) {
  if (!state || typeof state !== "object") return false;
  return Array.isArray(state.rest) && state.rest.length > 0;
}

export function xrCadChildDrawLayer({ enterSettled = false } = {}) {
  return enterSettled === true ? XR_CAD_DRAW_LAYER : XR_CAD_HOLD_LAYER;
}

/**
 * Pick up to N units this frame without exceeding the triangle budget.
 * High-poly units wait until `delayHighPoly` is false.
 */
export function xrUnhideFramePlan({
  remaining = [],
  meshesPerFrame = XR_UNHIDE_MESHES_PER_FRAME,
  triBudget = XR_FIRST_FRAME_TRI_BUDGET,
  triShown = 0,
  delayHighPoly = true,
  highPolyTris = XR_HIGH_POLY_TRI_DELAY,
  hardCap = XR_MESH_TRI_HARD_CAP,
  partsShown = 0,
  maxParts = XR_CAD_DRAW_MAX_PARTS,
  sessionTriShown = 0,
} = {}) {
  const list = Array.isArray(remaining) ? remaining : [];
  const shown = Math.max(0, Number(triShown) || 0);
  const parts = Math.max(0, Number(partsShown) || 0);
  const sessionTris = Math.max(0, Number(sessionTriShown) || 0);
  const partCap = Number(maxParts) > 0 ? Number(maxParts) : XR_CAD_DRAW_MAX_PARTS;
  if (shouldCapXrCadSessionDraw({ shown: parts, triShown: sessionTris, maxParts: partCap })) {
    return { show: [], rest: [], skip: list, triShown: shown, done: true };
  }
  const per = Number(meshesPerFrame) > 0 ? Number(meshesPerFrame) : XR_UNHIDE_MESHES_PER_FRAME;
  const budget = Number(triBudget) > 0 ? Number(triBudget) : XR_FIRST_FRAME_TRI_BUDGET;
  const cap = Number(hardCap) > 0 ? Number(hardCap) : XR_MESH_TRI_HARD_CAP;
  const slots = Math.max(0, partCap - parts);
  const show = [];
  const defer = [];
  const skip = [];
  let used = 0;
  let i = 0;
  for (; i < list.length && show.length < per && show.length < slots; i += 1) {
    const unit = list[i];
    const tris = Math.max(0, Number(unit?.triangles) || 0);
    const standInTris = Math.max(0, Number(unit?.standIn?.triangles) || 0);
    const hasStandIn = standInTris > 0 && !shouldSkipOverBudgetXrMesh({ triangles: standInTris, hardCap: cap });
    const overHard = shouldSkipOverBudgetXrMesh({ triangles: tris, hardCap: cap });
    if (overHard && !hasStandIn) {
      if (delayHighPoly) {
        defer.push(unit);
        continue;
      }
      skip.push(unit);
      continue;
    }
    const drawTris = overHard && hasStandIn ? standInTris : tris;
    if (delayHighPoly && shouldDelayHighPolyXrPart({ triangles: drawTris, maxTris: highPolyTris })) {
      defer.push(unit);
      continue;
    }
    if (shown + used + drawTris > budget && show.length > 0) break;
    if (shown + used + drawTris > budget && show.length === 0) {
      if (delayHighPoly) {
        defer.push(unit);
        continue;
      }
      if (overHard && !hasStandIn) {
        skip.push(unit);
        i += 1;
        break;
      }
      show.push(unit);
      used += drawTris;
      i += 1;
      break;
    }
    show.push(unit);
    used += drawTris;
  }
  let rest = list.slice(i).concat(defer);
  if (shouldCapXrCadSessionDraw({
    shown: parts + show.length,
    triShown: sessionTris + used,
    maxParts: partCap,
  })) {
    skip.push(...rest);
    rest = [];
  }
  return {
    show,
    rest,
    skip,
    triShown: shown + used,
    done: rest.length === 0,
  };
}

/** Geometry AABB only — no scene graph walk. */
export function xrGeometryLocalBox(geometry) {
  const bb = geometry?.boundingBox;
  const min = bb?.min;
  const max = bb?.max;
  if (!min || !max) return null;
  const rec = {
    min: [Number(min.x), Number(min.y), Number(min.z)],
    max: [Number(max.x), Number(max.y), Number(max.z)],
  };
  if (![...rec.min, ...rec.max].every(Number.isFinite)) return null;
  if (rec.min[0] === Infinity || rec.max[0] === -Infinity) return null;
  return rec;
}

/** Stash local AABB from this node's geometry (Group roots skip). */
export function stashXrLocalBoxFromOwnGeometry(mesh) {
  if (!mesh || readXrLocalBox(mesh)) return readXrLocalBox(mesh);
  const rec = xrGeometryLocalBox(mesh.geometry);
  if (!rec) return null;
  try {
    mesh.userData = mesh.userData || {};
    mesh.userData._xrLocalBox = rec;
  } catch {
    return rec;
  }
  return rec;
}

export function xrCadColorRgb(mat) {
  const c = Array.isArray(mat) ? mat[0]?.color : mat?.color;
  if (c && typeof c.r === "number") return [c.r, c.g, c.b];
  return [0.77, 0.79, 0.83];
}

/** Few shared palettes — color is a uniform, not a unique shader clone. */
export function xrCadPaletteKey(r = 0.77, g = 0.79, b = 0.83) {
  const q = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 2);
  return q(r) * 9 + q(g) * 3 + q(b);
}

export function xrCadPaletteHex(key) {
  const k = Math.max(0, Number(key) || 0);
  const r = Math.floor(k / 9) % 3;
  const g = Math.floor(k / 3) % 3;
  const b = k % 3;
  const ch = (n) => Math.round((n / 2) * 255);
  return (ch(r) << 16) | (ch(g) << 8) | ch(b);
}

/** 4k wrap GPU upload on enter. Cap at 1024 while presenting. */
export function shouldUploadXrWrapTexture({
  presenting = false,
  width = 0,
  height = 0,
  maxDim = 1024,
} = {}) {
  if (presenting !== true) return true;
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const cap = Number(maxDim) > 0 ? Number(maxDim) : 1024;
  return Math.max(w, h) <= cap;
}

export function xrTextureMaxDim(tex) {
  const img = tex?.image || tex?.source?.data;
  const w = Number(img?.width || img?.videoWidth || 0);
  const h = Number(img?.height || img?.videoHeight || 0);
  return Math.max(w, h);
}

/** Spectator / mask / extra WebGL targets must not sit beside the XR framebuffer. */
export function shouldDisposeDesktopOnlyTarget({ presenting = false, recording = false } = {}) {
  return presenting === true && recording !== true;
}

export function shouldResizeDesktopRenderer({ presenting = false } = {}) {
  return presenting !== true;
}

/**
 * Desktop Canvas tab must not keep the 3D WebGL rAF/render running underneath
 * the 2D overlay (Chrome GPU tab death). Never park while XR is presenting —
 * the Quest framebuffer lives on `#viewport`.
 */
export function shouldParkDesktopViewportForCanvasTab({ presenting = false, canvasTabActive = false, canvasSplit = false } = {}) {
  return canvasTabActive === true && !canvasSplit && presenting !== true;
}

export function shouldKeepViewportVisibleWhilePresenting({ presenting = false } = {}) {
  return presenting === true;
}

/** WebXR framebuffer lives on `#viewport` — never leave it `display:none` / `hidden`. */
export function applyXrPresentingViewportEl(el, { presenting = false } = {}) {
  if (!el || presenting !== true) return false;
  try { el.hidden = false; } catch { /* ignore */ }
  try { el.removeAttribute?.("hidden"); } catch { /* ignore */ }
  try {
    el.classList?.remove?.("doc-viewer-active", "dxf-viewer-active", "ref-viewer-active", "hidden");
  } catch { /* ignore */ }
  try {
    if (el.style) {
      el.style.display = "";
      el.style.visibility = "visible";
    }
  } catch { /* ignore */ }
  return true;
}

export function isWebglContextLost(renderer) {
  try {
    const gl = renderer?.getContext?.();
    return gl?.isContextLost?.() === true;
  } catch {
    return false;
  }
}

/** Ask the browser to restore a lost GPU context. No-op when the context is live. */
export function tryRestoreWebglContext(renderer) {
  if (!isWebglContextLost(renderer)) return false;
  try {
    renderer.getContext?.()?.getExtension?.("WEBGL_lose_context")?.restoreContext?.();
    return true;
  } catch {
    return false;
  }
}

/** Keep the studio WebGL canvas on `#viewport` after an editor overlay unmounts. */
export function reattachRendererCanvas(renderer, viewport) {
  const el = renderer?.domElement;
  if (!el || !viewport) return false;
  try { el.hidden = false; } catch { /* ignore */ }
  try { el.removeAttribute?.("hidden"); } catch { /* ignore */ }
  try {
    el.classList?.remove?.("hidden");
  } catch { /* ignore */ }
  try {
    if (el.style) {
      if (el.style.display === "none") el.style.display = "";
      if (el.style.visibility === "hidden") el.style.visibility = "";
    }
  } catch { /* ignore */ }
  if (el.parentElement === viewport) return false;
  try {
    viewport.appendChild(el);
    return true;
  } catch {
    return false;
  }
}

/**
 * Covering editor panes (canvas / clip / VR-only layouts) must not stay on
 * top of `#viewport` after the 3D shell is active. X share sheet-only stays.
 */
export function hideEditorCoveringViewport({ canvasWorkspace, videoModal, mainColumn } = {}) {
  try { canvasWorkspace?.classList?.add?.("hidden"); } catch { /* ignore */ }
  try {
    if (videoModal && !videoModal.classList?.contains?.("is-sheet-only")) {
      videoModal.classList.add("hidden");
    }
  } catch { /* ignore */ }
  try {
    mainColumn?.classList?.remove?.("viser-layout-viser", "teleop-layout-teleop", "sim-layout-sim");
  } catch { /* ignore */ }
}

/** Remote xr.table / xr.board must not offset the reference space until the user taps Board / Round table / Walk. */
export function shouldApplyRemoteBoardLoco({ userArmed = false } = {}) {
  return !!userArmed;
}

export function nametagHitSize() {
  return { ...XR_NAMETAG_HIT, d: 0.08 };
}

/** First nametag along a ray — ignores dock/CAD hits. */
export function nametagPickFromHits(hits = []) {
  let best = null;
  for (const h of hits || []) {
    const data = h?.object?.userData || {};
    const uid = String(data.xrUserId || "");
    if (!uid || !(data.xrNametag || data.xrUserId)) continue;
    if (best && !(h.distance < best.distance)) continue;
    best = { kind: "nametag", userId: uid, distance: Number(h.distance) || 0, object: h.object };
  }
  return best;
}

/** World nametag wins even if the capture dock / wrist strip is closer on the same ray. */
export function nametagBeatsDock(tagHit, dockHit) {
  void dockHit;
  return !!(tagHit?.userId || tagHit?.kind === "nametag");
}

/**
 * Cheap AABB CAD / stroke / drop hits are grab targets.
 * Do not require a 18 cm proximity check after a real ray hit — that made
 * idle AABB pick attach only when the controller was already on the mesh.
 */
export function grabAttachesFromHit(hit) {
  if (!hit || typeof hit !== "object") return false;
  const kind = String(hit.kind || "");
  if (kind === "drop") return !!(hit.root || hit.object);
  if (kind === "mesh") return !!hit.object;
  return false;
}

export function resolveNametagPerson(userId, { users = [], me = null, avatarName = "" } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  if (me?.id && String(me.id) === uid) return { ...me, id: uid, isSelf: true };
  const found = (users || []).find((u) => String(u?.id || "") === uid);
  if (found) return { ...found, id: uid, isSelf: false };
  return { id: uid, display_name: String(avatarName || "Teammate"), isSelf: false };
}

/** World-space nametag: above the skull, nudged toward the viewer so lookAt never hides it behind the head. */
export function nametagAnchorFromHead(headP, viewerP, up = 0.22, toward = 0.08) {
  const hx = Number(headP?.[0] || 0);
  const hy = Number(headP?.[1] || 0);
  const hz = Number(headP?.[2] || 0);
  const vx = Number(viewerP?.[0] || 0);
  const vz = Number(viewerP?.[2] || 0);
  let dx = vx - hx;
  let dz = vz - hz;
  const len = Math.hypot(dx, dz);
  if (len > 1e-4) {
    dx = (dx / len) * toward;
    dz = (dz / len) * toward;
  } else {
    dx = 0;
    dz = toward;
  }
  return [hx + dx, hy + up, hz + dz];
}

export function permissionRefreshSurfaces() {
  return ["connect-vr-permissions", "studio-keys"];
}

export function shouldRefreshPermissionSurfaces(msg = {}) {
  const type = String(msg.type || "");
  const reason = String(msg.reason || "");
  return type === GRANT_WS_TYPE && GRANT_WS_REASONS.includes(reason);
}

/** Drop oldest remote first so a flood cannot evict the local sketch. */
export function nextStrokeEvictIndex(strokes = [], incomingRemote = false) {
  const remotes = [];
  for (let i = 0; i < strokes.length; i += 1) {
    if (strokes[i]?.remote) remotes.push(i);
  }
  const nextLen = strokes.length + 1;
  const nextRemote = remotes.length + (incomingRemote ? 1 : 0);
  if (incomingRemote && nextRemote > XR_MAX_REMOTE_STROKES) return remotes[0] ?? 0;
  if (nextLen > XR_MAX_STROKES) return remotes[0] ?? 0;
  return -1;
}

export function xrInteractionBusy(state = {}) {
  return !!(state.grabbing || state.drawing || state.creating || state.solidDraw || state.combining || state.grouping);
}

/** CSG never runs on the draw/move pick loop — only after a Combine tap / commit. */
export function shouldRunCsgNow(state = {}) {
  return !xrInteractionBusy(state);
}

/**
 * Headset CAD pick is AABB except Measure (edge snap). Default XR tool is
 * grab, so idle Move/aim must stay cheap — do not wait until `grabbing`.
 */
export function shouldCheapMeshPick(state = {}) {
  return String(state.tool || "") !== "measure";
}

/** Grab/move must reuse scratch matrices — no `new Matrix4` per XR frame. */
export function shouldAllocGrabTransformTemps() {
  return false;
}

/** Draw / Create rays must not click floating HUD menus. Belt + tool-hand stay pickable. */
export function xrDrawLikeToolActive(state = {}) {
  const tool = String(state.tool || "");
  if (state.drawing === true) return true;
  if (tool === "draw" || tool === "voice_draw") return true;
  if (state.creating === true) return true;
  if (tool.startsWith("create_")) return true;
  return false;
}

/**
 * Skip world HUD only while Draw/Create is out in empty space.
 * A menu ray hit or standing near a panel (≤1.1 m) must stay clickable.
 */
export function shouldSkipWorldUiPick(state = {}) {
  if (state.uiHit === true || state.nearMenu === true) return false;
  if (shouldUseMenuAimTip(state)) return false;
  return xrDrawLikeToolActive(state);
}

/** Close enough to a world window that aiming should override tool chrome. */
export const XR_MENU_AIM_NEAR_M = 1.1;

export function controllerIsNearMenu(origin, panelPos, maxM = XR_MENU_AIM_NEAR_M) {
  if (!origin || !panelPos) return false;
  const max = Number(maxM);
  const lim = Number.isFinite(max) && max > 0 ? max : XR_MENU_AIM_NEAR_M;
  const dx = Number(origin.x) - Number(panelPos.x);
  const dy = Number(origin.y) - Number(panelPos.y);
  const dz = Number(origin.z) - Number(panelPos.z);
  if (![dx, dy, dz].every((n) => Number.isFinite(n))) return false;
  return (dx * dx + dy * dy + dz * dz) <= lim * lim;
}

/**
 * Aiming at a menu overrides Draw/Create chrome. Ray hit is enough;
 * nearMenu is the 0.8–1.2 m closeness gate used by pick / dock yield.
 */
export function shouldUseMenuAimTip({ nearMenu = false, uiHit = false, rayOnMenu = false, tool = "" } = {}) {
  void tool;
  void nearMenu;
  if (uiHit === true || rayOnMenu === true) return true;
  return false;
}

/** Small tip that replaces the pen / solid preview while menu-aiming. */
export function menuAimTipKind(tool = "") {
  const t = String(tool || "");
  if (t === "create_box" || t.includes("box")) return "cube";
  if (t === "create_cylinder" || t.includes("cyl")) return "cylinder";
  if (t === "create_sphere" || t.includes("sphere")) return "sphere";
  return "cylinder";
}

/** World windows / HUDs — not wrist dock, tool-hand pucks, or CAD. */
export function isXrWorldMenuHoverKind(kind) {
  const k = String(kind || "").trim();
  if (!k) return false;
  if (k === "tool" || k === "color") return false;
  return isXrUiHoverKind(k);
}

/** Resolve actual wrist buttons and world menus by depth on this hand's ray. */
export function wristYieldsToWorldMenu({
  wristHit = null,
  worldHit = null,
  nearMenu = false,
} = {}) {
  if (!worldHit || !isXrWorldMenuHoverKind(worldHit.kind)) return false;
  if (!wristHit) return true;
  return Number(worldHit.distance) < Number(wristHit.distance);
}

/** Trigger on UI must not start a Draw stroke or Create solid. */
export function xrUiPickBlocksDraw(hit) {
  if (!hit?.kind) return false;
  return isXrUiHoverKind(hit.kind);
}

export function shouldSkipXrHudPanelPick(state = {}) {
  // Trigger must still click Menu / AI / Settings while Draw or Create is out.
  // Laser-on already unskipped HUD; skipping without laser ate right-trigger HUD hits.
  void state;
  return false;
}

/** Poke-only. 38 cm used to let the left wrist plate eat world-menu lasers. */
export const XR_WRIST_UI_EXCLUSIVE_M = 0.14;

/**
 * Wrist dock / snap / tool-hand may sit along the same ray as a world HUD.
 * Only a real close poke is exclusive; long-range chrome must not swallow trigger.
 */
export function wristUiHitIsExclusive(hit, maxM = XR_WRIST_UI_EXCLUSIVE_M) {
  if (!hit) return false;
  if (hit.kind === "tool" && hit.tool === "snap") return false;
  const d = Number(hit.distance);
  if (!Number.isFinite(d) || d < 0) return false;
  if (hit.kind === "menu-chrome") return d < 0.18;
  return d < (Number(maxM) || XR_WRIST_UI_EXCLUSIVE_M);
}

/** Snap beside the grip must not eat the aim laser. Poke only (<10 cm). */
export function snapLaserHitIsPoke(hit, maxM = 0.10) {
  if (!hit || hit.kind !== "tool" || hit.tool !== "snap") return false;
  const d = Number(hit.distance);
  return Number.isFinite(d) && d >= 0 && d < (Number(maxM) || 0.10);
}

export function closerUiHit(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (Number(a.distance) || Infinity) <= (Number(b.distance) || Infinity) ? a : b;
}

/** AI prompt stays where it opened — never head-locked or glued to the belt/hand. */
export function hudKindStaysWorldLocked(kind) {
  return String(kind || "") === "ai";
}

export const XR_HANDHELD_SIZE_M = 0.12;
export const XR_COMFORT_SIZE_KEY = "render3d:xr-comfort-size-m";
export const XR_COMFORT_DIST_KEY = "render3d:xr-comfort-dist-m";

export function clampXrComfortSizeM(sizeM, fallback = XR_HANDHELD_SIZE_M) {
  const n = Number(sizeM);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(0.45, Math.max(0.06, n));
}

export function readXrComfortSizeM(storage, fallback = XR_HANDHELD_SIZE_M) {
  try {
    const raw = storage?.getItem?.(XR_COMFORT_SIZE_KEY);
    if (raw == null || String(raw).trim() === "") return fallback;
    return clampXrComfortSizeM(raw, fallback);
  } catch {
    return fallback;
  }
}

export function writeXrComfortSizeM(storage, sizeM) {
  const next = clampXrComfortSizeM(sizeM);
  try { storage?.setItem?.(XR_COMFORT_SIZE_KEY, String(next)); } catch { /* ignore */ }
  return next;
}

export function readXrComfortDistM(storage, fallback = 0.55) {
  try {
    const raw = Number(storage?.getItem?.(XR_COMFORT_DIST_KEY));
    if (Number.isFinite(raw) && raw >= 0.28 && raw <= 1.4) return raw;
  } catch { /* ignore */ }
  return fallback;
}

export function writeXrComfortDistM(storage, distM) {
  const next = Number(distM);
  const clamped = Number.isFinite(next) ? Math.min(1.4, Math.max(0.28, next)) : 0.55;
  try { storage?.setItem?.(XR_COMFORT_DIST_KEY, String(clamped)); } catch { /* ignore */ }
  return clamped;
}

export const XR_VOICE_PREFS_KEY = "render3d:xr-voice-prefs";
export const XR_VOICE_WANTED_KEY = "render3d:xr-voice-wanted";

export function normalizeXrVoicePrefs(raw) {
  if (raw && typeof raw === "object") {
    return {
      wanted: raw.wanted !== false,
      asked: !!raw.asked,
      granted: !!raw.granted,
      muted: !!raw.muted,
    };
  }
  return { wanted: true, asked: false, granted: false, muted: false };
}

export function readXrVoicePrefs(storage) {
  try {
    const raw = JSON.parse(storage?.getItem?.(XR_VOICE_PREFS_KEY) || "null");
    if (raw && typeof raw === "object") return normalizeXrVoicePrefs(raw);
  } catch { /* fall through to legacy */ }
  try {
    const legacy = storage?.getItem?.(XR_VOICE_WANTED_KEY);
    if (legacy === "0" || legacy === "false") {
      return { wanted: false, asked: true, granted: false, muted: false };
    }
  } catch { /* default on */ }
  return normalizeXrVoicePrefs(null);
}

export function writeXrVoicePrefs(storage, patch = {}) {
  const next = normalizeXrVoicePrefs({ ...readXrVoicePrefs(storage), ...patch });
  try {
    storage?.setItem?.(XR_VOICE_PREFS_KEY, JSON.stringify(next));
    storage?.setItem?.(XR_VOICE_WANTED_KEY, next.wanted ? "1" : "0");
  } catch { /* ignore */ }
  return next;
}

/** Prefer last comfortable XR size so new generates are not origin-scale / huge. */
export function xrSpawnTargetM({ lastSizeM, presetSizeM, handheld = XR_HANDHELD_SIZE_M } = {}) {
  const last = Number(lastSizeM);
  if (Number.isFinite(last) && last >= 0.06) return clampXrComfortSizeM(last, handheld);
  const preset = Number(presetSizeM);
  if (Number.isFinite(preset) && preset > 0) return clampXrComfortSizeM(preset, handheld);
  return handheld;
}

export function xrSpawnInFrontOfHead({
  head = { x: 0, y: 1.55, z: 0 },
  forward = { x: 0, y: 0, z: -1 },
  distance = 0.55,
} = {}) {
  const hx = Number(head.x);
  const hy = Number(head.y);
  const hz = Number(head.z);
  const headX = Number.isFinite(hx) ? hx : 0;
  const headY = Number.isFinite(hy) && hy > 0.2 ? hy : 1.55;
  const headZ = Number.isFinite(hz) ? hz : 0;
  let fx = Number(forward.x) || 0;
  let fz = Number(forward.z) || 0;
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) {
    fx = 0;
    fz = -1;
  } else {
    fx /= len;
    fz /= len;
  }
  const dist = Number(distance);
  const d = Number.isFinite(dist) && dist >= 0.28 ? Math.min(1.4, dist) : 0.55;
  return {
    x: headX + fx * d,
    y: headY - 0.08,
    z: headZ + fz * d,
  };
}

/** Shortest drawn laser (meters). Idle / miss uses 0 — no void line. */
export const XR_LASER_MIN_M = 0.05;
/** Cap so a CAD hit never becomes a 10 m beam into the room. */
export const XR_LASER_MAX_M = 3;
/** When a hit has no distance (some UI maps), use arm-reach instead of max. */
export const XR_LASER_FALLBACK_M = 0.45;
/** Visible idle stub from the controller — same ray as hover/click, not a room beam. */
export const XR_LASER_IDLE_STUB_M = 0.16;

/**
 * Controller / hand laser is only for a real aim target — menu, UI, CAD, world
 * object. Null / empty kind means the ray is pointing into the void.
 */
export function laserVisibleForHit(hit) {
  if (!hit || typeof hit !== "object") return false;
  return String(hit.kind || "").trim().length > 0;
}

/** Idle controller / finger tip — a point, never a void beam. Matches ink spawn. */
export const XR_POINTER_TIP_M = 0.018;

export function pointerTipOffsetM() {
  return XR_POINTER_TIP_M;
}

/** Menu / wheel / window chrome — not CAD mesh / board / drop. */
export function isXrUiHoverKind(kind) {
  const k = String(kind || "").trim();
  if (!k) return false;
  if (k === "mesh" || k === "edge" || k === "board" || k === "drop" || k === "solid-handle") return false;
  return true;
}

/** UI wins over CAD; competing UI targets use their actual ray distance. */
export function preferUiHoverHit(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const aUi = isXrUiHoverKind(a.kind);
  const bUi = isXrUiHoverKind(b.kind);
  if (aUi !== bUi) return aUi ? a : b;
  const ad = Number(a.distance), bd = Number(b.distance);
  return (Number.isFinite(ad) ? ad : Infinity) <= (Number.isFinite(bd) ? bd : Infinity) ? a : b;
}

/** Beam on a real aim target. force (B-hold laser / presenting stub) stays on. */
export function laserVisibleForAim(hit, { force = false, hideLaser = false } = {}) {
  if (hideLaser === true) return false;
  if (force === true) return true;
  return laserVisibleForHit(hit);
}

/** Beam length in meters, or 0 when the laser should be hidden. */
export function laserLengthM(hit, { min = XR_LASER_MIN_M, max = XR_LASER_MAX_M } = {}) {
  if (!laserVisibleForHit(hit)) return 0;
  const lo = Number(min);
  const hi = Number(max);
  const minM = Number.isFinite(lo) && lo > 0 ? lo : XR_LASER_MIN_M;
  const maxM = Number.isFinite(hi) && hi >= minM ? hi : XR_LASER_MAX_M;
  const d = Number(hit.distance);
  if (!Number.isFinite(d) || d <= 0) {
    return Math.min(Math.max(XR_LASER_FALLBACK_M, minM), maxM);
  }
  return Math.min(Math.max(d, minM), maxM);
}

export function laserLengthForAim(hit, { force = false, hideLaser = false, min = XR_LASER_MIN_M, max = XR_LASER_MAX_M } = {}) {
  if (hideLaser === true) return 0;
  if (laserVisibleForHit(hit)) return laserLengthM(hit, { min, max });
  if (force === true) {
    const lo = Number(min);
    const hi = Number(max);
    const minM = Number.isFinite(lo) && lo > 0 ? lo : XR_LASER_MIN_M;
    const maxM = Number.isFinite(hi) && hi >= minM ? hi : XR_LASER_MAX_M;
    return Math.min(Math.max(XR_LASER_IDLE_STUB_M, minM), maxM);
  }
  return 0;
}

/** Compact control-log tag so dock / world HUD / A-wheel / CAD show up in xr-ctl rows. */
export function xrControlsUiTag(hit = null) {
  if (!hit || typeof hit !== "object") return "";
  const k = String(hit.kind || "");
  if (!k) return "";
  if (hit.source === "wrist") return "dock";
  if (k === "color" || k === "wheel-drag") return "spinwheel";
  if (k === "tool") return "spinwheel";
  if (isXrUiHoverKind(k)) return "xrUi";
  if (k === "mesh" || k === "edge" || k === "solid-handle" || k === "board") return "cad";
  return "";
}

export const XR_UI_PICK_CACHE = "20260915-xrui1";
export const XR_GRAB_CACHE = "20260915-xrgrab1";
export const XR_GRAB2_CACHE = "xrgrab2";
export const XR_GRAB3_CACHE = "xrgrab3";
export const XR_GRAB4_CACHE = "xrgrab4";
export const XR_TOOL1_CACHE = "xrtool1";
export const XR_WIN1_CACHE = "xrwin1";
export const VISER_GRIP_CACHE = "20260916-visergrip1";

/** Trigger / HUD clicks never start a window drag. Grip on the title bar does. */
export function xrHudClickStartsWindowDrag() {
  return false;
}

/** Desktop fit / scale=1 / seat-to-floor must not run on the live XR framebuffer. */
export function shouldApplyDesktopCadFitDuringXr({ presenting = false } = {}) {
  return presenting !== true;
}

/**
 * A parked / user-placed window stays put even when close to the face.
 * Only NaN or absurd world coords count as lost (then first-open spawn is OK).
 */
export function panelWorldPoseIsKept(pos = null) {
  const x = Number(pos?.x);
  const y = Number(pos?.y);
  const z = Number(pos?.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > 40 || Math.abs(y) > 20 || Math.abs(z) > 40) return false;
  return true;
}

/**
 * Right stick X flick undo/redo stays live in Draw / Create / AI board.
 * Stick tilt-Y never qualifies. L3+R3 click and Hold-B walk keep the stick.
 */
export function stickHistoryFlickEnabled({
  presenting = false,
  dimosArmed = false,
  walkHeld = false,
  bothSticksClicked = false,
  rightStickClicked = false,
  drawing = false,
  creating = false,
  aiBoard = false,
} = {}) {
  void drawing;
  void creating;
  void aiBoard;
  return presenting === true
    && dimosArmed !== true
    && walkHeld !== true
    && bothSticksClicked !== true
    && rightStickClicked !== true;
}
export const XR_GRIP_MOVE_CACHE = "gripmove1";

/** Full-panel / AABB overlays that sat in front of CAD and ate squeeze. */
export function isXrSqueezeOverlayKind(kind = "", hit = null) {
  const k = String(kind || "");
  if (hit?.fromAabb === true) return true;
  if (isXrChromeKind(k)) return true;
  if (k === "howto-drag" || k === "place-drag") return true;
  return false;
}

export function isExitVrHudHit(hit) {
  if (!hit) return false;
  const tool = String(hit.tool || hit.id || "");
  return tool === "exit" && (hit.kind === "tool" || hit.kind === "menu-action" || hit.kind === "menu-row");
}

/** Laser hover on the model (including cheap live AABB) — not HUD chrome. */
export function cadHoverGrabMesh(hit) {
  if (!hit) return null;
  const k = String(hit.kind || "");
  if (k !== "mesh" && k !== "drop") return null;
  return hit.object || hit.root || hit.mesh || null;
}

/** Grip or trigger alone grabs CAD. Both are never required. HUD chrome is not CAD. */
export function studioEitherButtonGrabsModel({
  squeeze = false,
  trigger = false,
  teleopArmed = false,
  uiHit = false,
  cadHit = false,
} = {}) {
  if (teleopArmed === true) return false;
  if (uiHit === true && cadHit !== true) return false;
  if (cadHit !== true) return false;
  return squeeze === true || trigger === true;
}

/** OpenArm / Viser body moves only on that mesh. UI, CAD, empty space, and B-walk win. */
export function viserRobotGripBlocked({ walkHeld = false, hoverKind = "" } = {}) {
  if (walkHeld) return true;
  const kind = String(hoverKind || "").trim();
  if (!kind || kind === "robotics-workspace-action") return false;
  if (kind === "mesh" || kind === "drop" || kind === "edge" || kind === "board" || kind === "solid-handle") return true;
  return isXrUiHoverKind(kind);
}

/** Left Touch X / touchpad / indented Menu ☰ — not analog extras 7–10. */
export function studioLeftMenuFacePressed(gp) {
  const buttons = gp?.buttons;
  if (!buttons?.length) return false;
  const down = (i) => xrGamepadDigitalPressed(buttons[i]);
  if (buttons.length >= 5 && down(4)) return true;
  if (buttons.length >= 3 && down(2)) return true;
  if (buttons.length > 7 && down(7)) return true;
  return false;
}

export function shouldToggleWristMenuOnLeftFace({ handedness = "", pressed = false } = {}) {
  return String(handedness || "") === "left" && pressed === true;
}

/** Small tip stays on while presenting, even when the beam is hidden. */
export function pointerVisibleWhilePresenting({ presenting = false } = {}) {
  return presenting === true;
}

export function pointerTipVisible({ presenting = false, useRay = true, hideLaser = false } = {}) {
  if (!pointerVisibleWhilePresenting({ presenting })) return false;
  if (hideLaser === true) return true;
  return useRay !== false;
}

/** A held object follows full hand rotation without an extra button. */
export function shouldOrbitGrabbedModel({ gripping = false, triggerHeld = false } = {}) {
  return gripping === true;
}

export function gripHoldIsTranslateOnly({ triggerHeld = false } = {}) {
  return false;
}

/** Hold-A first page must expose Measure (not a hidden later tab). */
export function wheelPageHasMeasure(ids = []) {
  return Array.isArray(ids) && ids.includes("measure");
}

export function shouldSendXrPose(elapsedMs, minMs = XR_POSE_MIN_MS) {
  return Number(elapsedMs) >= minMs;
}

export function shouldIncludeHeldPose(grabbing) {
  return !!grabbing;
}

export function captureDockVisible({ presenting = false, sessionEnded = false } = {}) {
  // Capture lives on the wrist rail (one puck + crescent) — not a second vertical strip.
  void presenting;
  void sessionEnded;
  return false;
}

/** Right-wrist 2×2: Eye, Mic / Record, Share. Not on the left watch grid. */
export const WRIST_STATUS_TOOL_IDS = ["passthrough", "voice_toggle", "capture", "share"];
/** @deprecated alias — status icons live on the opposite wrist, not a left rail. */
export const WRIST_RAIL_TOOL_IDS = WRIST_STATUS_TOOL_IDS;
export const WRIST_STATUS_COLS = 2;
export const XR_SHARE_TARGETS = ["friends", "search", "discord", "x", "bambu"];
export const DISCORD_VR_HREF = "https://discord.com/channels/@me";
export const X_SHARE_INTENT_HOST = "twitter.com";

export function xrShareXHref({ url = "", title = "" } = {}) {
  const params = new URLSearchParams();
  const text = String(title || "Render Studio").trim();
  if (text) params.set("text", text);
  const shareUrl = String(url || "").trim();
  if (shareUrl) params.set("url", shareUrl);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function printerVolumeBoxM(volumeMm = []) {
  const raw = Array.isArray(volumeMm) ? volumeMm : [];
  const x = Math.max(0.06, (Number(raw[0]) || 256) / 1000);
  const z = Math.max(0.06, (Number(raw[1]) || 256) / 1000);
  const y = Math.max(0.06, (Number(raw[2]) || 256) / 1000);
  return { x, y, z };
}

export const PRINT_FILAMENT_OPTIONS = ["PLA", "PETG", "ABS", "ASA", "TPU", "Nylon", "PLA-CF"];
export const WRIST_MENU_GRID_IDS = ["menu", "ai", "draw", "view", "tools", "social", "workspace", "robotics", "exit"];
export const SETTINGS_PANEL_TAB_IDS = ["controller", "controls", "environment", "windows", "robotics", "developer"];
export const SETTINGS_PANEL_TAB_LABELS = {
  controller: "Ctrl",
  controls: "VR",
  environment: "Env",
  windows: "Win",
  robotics: "Robot",
  developer: "Dev",
};

function shortRoboticsUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "not set";
  return s.replace(/^https?:\/\//i, "").slice(0, 28);
}

export const ROBOTICS_PREFS_EVENT = "render3d:robotics-prefs";

function latestStoredPrefs(prefix) {
  try {
    const ls = localStorage;
    if (!ls) return null;
    let project = null;
    let user = null;
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      let parsed = null;
      try { parsed = JSON.parse(ls.getItem(key) || "null"); } catch { continue; }
      if (!parsed) continue;
      if (key.includes(":project:")) project = parsed;
      else user = parsed;
    }
    return project || user;
  } catch {
    return null;
  }
}

/** Desktop localStorage is the source of truth for VR Settings robotics rows. */
export function readRoboticsHudPrefs() {
  const viser = latestStoredPrefs("render3d:viserPrefs:");
  const teleop = latestStoredPrefs("render3d:teleopPrefs:");
  const cams = latestStoredPrefs("render3d:handCamPrefs:");
  return {
    viserUrl: String(viser?.draft || viser?.active || ""),
    teleopUrl: String(teleop?.draft || teleop?.active || ""),
    cameraHost: String(cams?.cameraHostDraft || cams?.cameraHost || ""),
  };
}

/** VR Settings → Robotics: same prefs object as desktop (Viser, teleop, cameras, server). */
export function roboticsSettingsLines({
  viserUrl = "",
  teleopUrl = "",
  cameraHost = "",
} = {}) {
  const stored = readRoboticsHudPrefs();
  const viser = viserUrl || stored.viserUrl;
  const teleop = teleopUrl || stored.teleopUrl;
  const cams = cameraHost || stored.cameraHost;
  return [
    { id: "rob_viser", label: `Viser · ${shortRoboticsUrl(viser)}`, kind: "action", icon: "view" },
    { id: "rob_teleop", label: `Teleop · ${shortRoboticsUrl(teleop)}`, kind: "action", icon: "robot" },
    { id: "rob_cam", label: `Cameras · ${shortRoboticsUrl(cams) || "IP"}`, kind: "action", icon: "view" },
    { id: "rob_server", label: "Cloud", kind: "action", icon: "export" },
  ];
}
export const WORKSPACE_PANEL_TABS = [
  { id: "projects", label: "Projects" },
  { id: "scene", label: "Scene" },
];
export const XR_DEV_MODE_KEY = "render3d:xrDeveloperMode";

/** Stable Mic → Pass → Capture order on the right-wrist cluster. */
export function wristRailToolOrder(ids = WRIST_STATUS_TOOL_IDS) {
  const have = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "")));
  return WRIST_STATUS_TOOL_IDS.filter((id) => have.has(id));
}

export function captureIsCrescentNotStrip(railIds = WRIST_STATUS_TOOL_IDS) {
  const raw = Array.isArray(railIds) ? railIds.map((id) => String(id || "")) : [...WRIST_STATUS_TOOL_IDS];
  if (raw.includes("screenshot")) return false;
  const ids = wristRailToolOrder(raw);
  return ids.includes("capture");
}

/** Scene tab: mic / passthrough / capture / settings (settings opens the existing panel). */
export function workspaceSceneSettingsLines({
  micOn = false,
  passthroughOn = true,
  recording = false,
  acceptPrint = false,
  printerOutline = false,
  printerModel = false,
  printerLanIp = "",
  printerAccessSet = false,
  printerSerial = "",
  printerName = "",
} = {}) {
  const ip = String(printerLanIp || "").trim();
  const serial = String(printerSerial || "").trim();
  const name = String(printerName || "").trim();
  return [
    {
      id: "voice_toggle",
      label: micOn ? "Mic on" : "Mic off",
      kind: "toggle",
      icon: "mic",
      active: !!micOn,
    },
    {
      id: "passthrough",
      label: passthroughOn ? "Passthrough on" : "Passthrough off",
      kind: "toggle",
      icon: "eye",
      active: !!passthroughOn,
    },
    {
      id: "capture",
      label: recording ? "Capture · recording" : "Capture",
      kind: "action",
      icon: "rec",
    },
    { id: "settings", label: "Settings", kind: "action", icon: "settings" },
    {
      id: "printer_bind",
      label: printerAccessSet || ip
        ? "Bind with PIN · set"
        : "Bind with PIN code",
      kind: "action",
      icon: "bambu",
    },
    {
      id: "printer_ip",
      label: ip ? `Printer IP · ${ip.slice(0, 18)}` : "Printer IP · optional",
      kind: "action",
      icon: "bambu",
    },
    {
      id: "printer_serial",
      label: serial ? `Serial · ${serial.slice(0, 16)}` : "Serial · not set",
      kind: "action",
      icon: "bambu",
    },
    {
      id: "printer_name",
      label: name ? `Printer name · ${name.slice(0, 16)}` : "Printer name · optional",
      kind: "action",
      icon: "bambu",
    },
    {
      id: "printer_accept",
      label: acceptPrint ? "Incoming printer on" : "Allow print requests · off",
      kind: "toggle",
      icon: "bambu",
      active: !!acceptPrint,
    },
    {
      id: "printer_outline",
      label: printerOutline ? "Printer boundary on" : "Printer boundary off",
      kind: "toggle",
      icon: "export",
      active: !!printerOutline,
    },
    {
      id: "printer_fence",
      label: "Place printer boundary",
      kind: "action",
      icon: "export",
    },
    {
      id: "printer_model",
      label: printerModel ? "VR printer model on" : "VR printer model off",
      kind: "toggle",
      icon: "bambu",
      active: !!printerModel,
    },
  ];
}

export const PRINTER_ACCEPT_KEY = "render3d:printer-accept-sends";
export const PRINTER_OUTLINE_KEY = "render3d:printer-outline";
export const PRINTER_MODEL_KEY = "render3d:printer-vr-model";
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

export function xrSharePanelLines({
  friends = [],
  searchHits = [],
  searchDraft = "",
  acceptPrint = false,
  printerOutline = false,
  includeX = true,
  roomPrint = [],
} = {}) {
  const lines = [
    { id: "", label: "Share project link", kind: "hint", icon: "share" },
    { id: "", label: "Friends", kind: "section", icon: "social" },
  ];
  if (!friends.length) {
    lines.push({ id: "", label: "No friends yet", kind: "hint", icon: "social" });
  }
  for (const f of (friends || []).slice(0, 5)) {
    const name = f.display_name || f.handle || f.name || "Friend";
    lines.push({
      id: `share-friend:${f.id}`,
      label: name,
      kind: "action",
      icon: "social",
    });
  }
  lines.push({
    id: "share-search",
    label: searchDraft ? `Search · ${searchDraft}` : "Search users",
    kind: "action",
    icon: "search",
  });
  for (const u of (searchHits || []).slice(0, 4)) {
    lines.push({
      id: `share-user:${u.id}`,
      label: u.display_name || u.handle || u.name || "User",
      kind: "action",
      icon: "social",
    });
  }
  if ((roomPrint || []).length) {
    lines.push({ id: "", label: "Send to their printer", kind: "section", icon: "bambu" });
    for (const u of roomPrint.slice(0, 4)) {
      lines.push({
        id: `share-print:${u.id}`,
        label: u.display_name || u.handle || "Friend",
        kind: "action",
        icon: "bambu",
      });
    }
  }
  lines.push({ id: "share-discord", label: "Send to Discord", kind: "action", icon: "social" });
  if (includeX) {
    lines.push({ id: "share-x", label: "Share to X", kind: "action", icon: "share" });
  }
  lines.push({ id: "share-bambu", label: "Share to Bambu printer", kind: "action", icon: "bambu" });
  lines.push({
    id: "printer_accept",
    label: acceptPrint ? "Incoming printer on" : "Allow print requests · off",
    kind: "toggle",
    icon: "bambu",
    active: !!acceptPrint,
  });
  lines.push({
    id: "printer_outline",
    label: printerOutline ? "Printer boundary on" : "Printer boundary off",
    kind: "toggle",
    icon: "export",
    active: !!printerOutline,
  });
  lines.push({
    id: "printer_fence",
    label: "Place printer boundary",
    kind: "action",
    icon: "export",
  });
  return lines;
}

export function developerModeEnabled(value) {
  if (value === true || value === 1 || value === "1" || value === "on" || value === "true") return true;
  return false;
}

/** Timestamped XR perf log name — lives in ai-context/debugger/ and data/debugger/{user}/. */
/** Legacy 10s auto dump — xrdbg1 never auto-uploads; stick-hold debugger + Send only. */
export const XR_PERF_SAMPLE_MIN_MS = 10000;
export const XR_HITCH_MS = 20;
export const XR_HITCH_MAX = 40;

/** Upload after debugger Send, or immediately on L3+R3 exit flush. Never auto. */
export function shouldUploadXrDebuggerLog({
  debuggerOpen = false,
  explicit = false,
  auto = false,
  exitFlush = false,
} = {}) {
  if (auto === true) return false;
  if (explicit !== true) return false;
  return debuggerOpen === true || exitFlush === true;
}

export function shouldPostXrPerfSample({
  presenting = false,
  posted = false,
  presentStartedAt = 0,
  now = 0,
  minMs = XR_PERF_SAMPLE_MIN_MS,
  debuggerOpen = false,
  explicit = false,
} = {}) {
  if (!shouldUploadXrDebuggerLog({ debuggerOpen, explicit, auto: false })) return false;
  if (presenting !== true || posted === true) return false;
  return Number(now) - Number(presentStartedAt) >= (Number(minMs) || XR_PERF_SAMPLE_MIN_MS);
}

export function summarizeXrFrameTimes(samples = []) {
  const dts = [];
  for (const row of samples || []) {
    const dt = Number(row?.dt);
    if (Number.isFinite(dt) && dt > 0) dts.push(dt);
  }
  const n = dts.length;
  if (!n) return { avgMs: 0, p95Ms: 0, n: 0 };
  dts.sort((a, b) => a - b);
  const avgMs = Math.round((dts.reduce((a, b) => a + b, 0) / n) * 10) / 10;
  const p95Ms = Math.round(dts[Math.min(n - 1, Math.floor(n * 0.95))] * 10) / 10;
  return { avgMs, p95Ms, n };
}

/** Long frames + JS-heap jumps — the CPU/GPU hitch list for a VR debug dump. */
export function summarizeXrHitchSpikes(samples = [], { hitchMs = XR_HITCH_MS, maxSpikes = XR_HITCH_MAX } = {}) {
  const threshold = Number(hitchMs) > 0 ? Number(hitchMs) : XR_HITCH_MS;
  const cap = Number(maxSpikes) > 0 ? Number(maxSpikes) : XR_HITCH_MAX;
  const spikes = [];
  let maxDt = 0;
  let prevMem = null;
  for (const row of samples || []) {
    const dt = Number(row?.dt);
    if (Number.isFinite(dt) && dt > maxDt) maxDt = dt;
    const mem = Number(row?.memMb);
    const memJump = Number.isFinite(mem) && prevMem != null && (mem - prevMem) >= 8;
    if (Number.isFinite(mem)) prevMem = mem;
    if ((Number.isFinite(dt) && dt >= threshold) || memJump) {
      const item = {
        t: Math.round(Number(row?.t) || 0),
        dt: Math.round((Number.isFinite(dt) ? dt : 0) * 10) / 10,
        fps: Math.round((Number(row?.fps) || 0) * 10) / 10,
      };
      if (Number.isFinite(mem)) item.memMb = Math.round(mem * 10) / 10;
      if (memJump) item.heap = 1;
      if (row?.where) item.where = String(row.where).slice(0, 160);
      if (row?.stack) item.stack = String(row.stack).slice(0, 400);
      if (row?.lastClick) item.lastClick = String(row.lastClick).slice(0, 160);
      spikes.push(item);
    }
  }
  return {
    hitchCount: spikes.length,
    hitchMs: threshold,
    maxDt: Math.round(maxDt * 10) / 10,
    spikes: spikes.slice(-cap),
  };
}

export function xrDebuggerLogFilename(when = new Date(), slug = "xr-perf") {
  const d = when instanceof Date ? when : new Date(when);
  const utc = Number.isFinite(d.getTime()) ? d : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}-${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}`;
  const safe = String(slug || "xr-perf").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "xr-perf";
  return `${stamp}-${safe}.jsonl`;
}

export const CRESCENT_CAPTURE_TOOL_IDS = ["screenshot", "record", "stream"];
export const CRESCENT_RECORDING_TOOL_IDS = ["record_pause", "record_stop"];
/** After Stop (or a shot): Send to PC / Share to X / new Shot — not Rec-as-toggle. */
export const CRESCENT_CLIP_READY_TOOL_IDS = ["shot_send_pc", "shot_share_x", "screenshot"];
export const CRESCENT_STREAM_DEST_IDS = ["stream_x_live", "stream_twitch", "stream_kick"];
export const CRESCENT_STREAM_LINK_IDS = ["stream_browser", "stream_send_pc"];
/** After Stream: existing live dests vs headset OS cast. */
export const CRESCENT_STREAM_PICK_IDS = ["stream_live", "stream_cast_meta", "stream_cast_apple"];
/** Official Meta Cast *receiver* (phone/PC Chromium) — not a Quest JS API. */
export const META_CAST_RECEIVER_URL = "https://www.oculus.com/casting";
/** Meta’s documented in-headset Cast path (Quick controls). */
export const META_CAST_HELP_URL = "https://www.meta.com/help/quest/192719842695017/";

function profilesBlobForCast(profiles) {
  return (Array.isArray(profiles) ? profiles : []).join(" ");
}

function xrSpatialMediaMatches(matchMedia) {
  if (matchMedia === true) return true;
  if (typeof matchMedia !== "function") return false;
  try {
    return !!(matchMedia("(xr-spatial)")?.matches || matchMedia("(display-mode: xr-spatial)")?.matches);
  } catch {
    return false;
  }
}

/**
 * Quest vs Vision Pro vs neither. Desktop Chrome/Safari stay `"none"` so Stream
 * is unchanged. `"ambiguous"` only when both headset families are signaled.
 */
export function detectHeadsetCastFamily({
  userAgent = "",
  locationHref = "",
  sessionMode = "",
  xrMode = "",
  profiles = [],
  presenting = false,
  matchMedia = null,
} = {}) {
  const ua = String(userAgent || "");
  const href = String(locationHref || "");
  const mode = `${sessionMode || ""} ${xrMode || ""}`;
  const prof = profilesBlobForCast(profiles);
  const blob = `${ua} ${href} ${mode} ${prof}`;
  const spatial = xrSpatialMediaMatches(matchMedia);

  const quest = (
    /OculusBrowser|MetaBrowser|HorizonOS|XRBrowser/i.test(ua)
    || /xr\.quest/i.test(href)
    || (/\bQuest\b/i.test(ua) && /Oculus|Meta|Horizon|Mobile VR|Wolvic/i.test(ua))
    || /oculus-touch|meta-quest-touch/i.test(prof)
    || (/immersive-(ar|vr)/i.test(mode) && /quest|oculus|meta-quest/i.test(blob))
  );
  const apple = (
    /visionOS|AppleVisionPro|RealityApp|apple-visor/i.test(blob)
    || /xr-spatial/i.test(blob)
    || spatial
    || (/AppleWebKit/i.test(ua) && /Mobile/i.test(ua) && /Vision/i.test(ua))
  );
  if (quest && apple) return "ambiguous";
  if (quest) return "meta";
  if (apple) return "apple";
  return presenting && /quest|oculus|meta-quest/i.test(blob) ? "meta" : "none";
}

export function shouldOpenStreamCastPicker(family = "none") {
  return family === "meta" || family === "apple" || family === "ambiguous";
}

export function streamCastPickerToolIds(family = "none") {
  if (family === "meta") return ["stream_live", "stream_cast_meta"];
  if (family === "apple") return ["stream_live", "stream_cast_apple"];
  if (family === "ambiguous") return ["stream_live", "stream_cast_meta", "stream_cast_apple"];
  return [];
}

export function streamCastFooterHint(family = "none") {
  if (family === "apple") return "Stream or AirPlay / SharePlay";
  if (family === "ambiguous") return "Stream, Cast with Meta, or AirPlay";
  if (family === "meta") return "Stream or Cast with Meta";
  return "Stream · X Live, Twitch, or Kick";
}

export function headsetCastHudCopy(family = "meta") {
  if (family === "apple") {
    return "AirPlay / SharePlay / Share to Mac are visionOS system features — this page cannot start them by itself. Look up for Control Center, then AirPlay, SharePlay, or Share to Mac. Stream stays available so you can AirPlay the browser window.";
  }
  return "Cast with Meta is Quest system casting (phone, TV, or browser). There is no web JS API for it. Press the Meta button → Quick controls → Cast → Mobile, Web, or a nearby device. Same Wi-Fi and Meta account. A computer can wait at oculus.com/casting.";
}

export function headsetCastOpenUrl(family = "meta", { presenting = false, userAgent = "" } = {}) {
  if (family === "apple") return "";
  const questBrowser = /OculusBrowser|MetaBrowser|HorizonOS|XRBrowser/i.test(String(userAgent || ""));
  if (presenting || questBrowser) return META_CAST_HELP_URL;
  return META_CAST_RECEIVER_URL;
}

export function streamCastPickerLabel(id = "") {
  if (id === "stream_cast_meta") return "Cast with Meta";
  if (id === "stream_cast_apple") return "AirPlay / SharePlay";
  if (id === "stream_live") return "Stream";
  return "Stream";
}

/**
 * Best-effort OS cast. There is no Meta Cast or visionOS SharePlay JS API.
 * Tries PresentationRequest, optional getDisplayMedia, and Meta’s documented URL.
 * Never captures a WebGL framebuffer / toDataURL (Quest freeze).
 */
export async function startHeadsetCastSession({
  family = "meta",
  href = "",
  userAgent = "",
  presenting = false,
  PresentationRequestCtor = typeof PresentationRequest === "function" ? PresentationRequest : null,
  getDisplayMedia = null,
  openUrl = null,
  webkitPicker = null,
  onDisplayStream = null,
  skipDisplayMedia = false,
  skipOpen = false,
} = {}) {
  const fam = family === "apple" ? "apple" : "meta";
  const page = String(href || "");
  const result = {
    family: fam,
    nativeCastApi: false,
    presentation: false,
    displayMedia: false,
    airplayPicker: false,
    openedUrl: "",
    footerHint: fam === "apple"
      ? "Control Center → AirPlay / SharePlay / Share to Mac"
      : "Meta button → Quick controls → Cast",
    copy: headsetCastHudCopy(fam),
    receiverUrl: META_CAST_RECEIVER_URL,
    helpUrl: fam === "apple" ? "" : META_CAST_HELP_URL,
  };

  if (typeof PresentationRequestCtor === "function") {
    try {
      const urls = page ? [page] : [META_CAST_RECEIVER_URL];
      const req = new PresentationRequestCtor(urls);
      if (typeof navigator !== "undefined" && navigator.presentation) {
        try { navigator.presentation.defaultRequest = req; } catch { /* ignore */ }
      }
      await req.start();
      result.presentation = true;
    } catch { /* user cancel or unsupported */ }
  }

  if (fam === "apple" && typeof webkitPicker === "function") {
    try {
      await webkitPicker();
      result.airplayPicker = true;
    } catch { /* ignore */ }
  }

  const gdm = getDisplayMedia
    || (!skipDisplayMedia && typeof navigator !== "undefined"
      ? navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices)
      : null);
  if (!result.presentation && !skipDisplayMedia && typeof gdm === "function") {
    try {
      const stream = await gdm({ video: true, audio: false, preferCurrentTab: true });
      result.displayMedia = !!stream;
      if (stream && typeof onDisplayStream === "function") onDisplayStream(stream);
      else if (stream && typeof onDisplayStream !== "function") {
        try { stream.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
      }
    } catch { /* user cancel */ }
  }

  if (!skipOpen) {
    const target = headsetCastOpenUrl(fam, { presenting, userAgent });
    if (target) {
      const opener = openUrl || ((url) => {
        try {
          return typeof window !== "undefined" ? window.open(url, "_blank", "noopener,noreferrer") : null;
        } catch {
          return null;
        }
      });
      try {
        const opened = opener(target);
        if (opened) result.openedUrl = target;
      } catch { /* popup blocked */ }
    }
  }
  return result;
}

export function formatXrRecordingClock(elapsedMs = 0, { paused = false } = {}) {
  const s = Math.max(0, Math.floor(Number(elapsedMs) / 1000));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return `${paused ? "❚❚ " : "● "}${clock}`;
}

/** Recapture vs republish last file over xr.capture.ready. */
export function xrCaptureSendAction({ hasLastCapture = false, toolId = "" } = {}) {
  const id = String(toolId || "");
  if (id === "screenshot") return "capture";
  if (id === "shot_send_pc" || id === "shot_share_x") {
    return hasLastCapture ? "send_last" : "capture";
  }
  return "none";
}

/**
 * WebXR grip/aim -Z points forward and sits on the controller. Wrist / forearm is +Z.
 * Right-hand DRAW chrome must use this, never a negative Z that occludes the hand.
 * Hand-tracking wrist joints are already at the bone — keep a smaller watch-face offset.
 *
 * PlaneGeometry faces +Z. Rotate ~-90° around X so the plate faces grip +Y (the
 * readable top of the controller / toward the eyes) — not along the grip or at the floor.
 */
export const DRAW_HAND_FACE_RX = -Math.PI / 2 + 0.28;

export function drawHandWristLocalOffset({ drawingIsRight = true, useWrist = false } = {}) {
  const right = drawingIsRight !== false;
  if (useWrist) {
    return {
      x: right ? 0.022 : -0.022,
      y: 0.014,
      z: 0.024,
      rx: DRAW_HAND_FACE_RX,
      ry: right ? 0.16 : -0.16,
      rz: 0,
    };
  }
  return {
    x: right ? 0.028 : -0.028,
    y: -0.016,
    z: 0.082,
    rx: DRAW_HAND_FACE_RX,
    ry: right ? 0.22 : -0.22,
    rz: 0,
  };
}

/** Host looks like a WebXR wrist joint (not the aiming/target-ray controller). */
export function drawHandHostIsWristBone(host) {
  const n = `${host?.name || ""} ${host?.jointName || ""}`.toLowerCase();
  return n.includes("wrist");
}

/** Aim/controller space is in front of the Touch. DRAW chrome follows grip or wrist. */
export function shouldAttachDrawHandToAimController() {
  return false;
}

/**
 * Snap chip on the pointing GRIP — beside the body toward the wrist (+Z).
 * Never -Z: that sits in the aim laser and eats trigger/squeeze.
 */
export function snapControlLocalOffset({ pointingIsRight = true } = {}) {
  const right = pointingIsRight !== false;
  return {
    x: right ? -0.048 : 0.048,
    y: 0.016,
    z: 0.032,
    rx: -0.52,
    ry: right ? 0.28 : -0.28,
    rz: 0,
  };
}

/** Snap must parent to the grip/body, never the target-ray / aim controller. */
export function shouldAttachSnapControlToAimController() {
  return false;
}

/** Full XR framebuffer readback (toDataURL / readPixels of the headset layer) on the select tick freezes Quest. */
export function shouldCaptureXrFramebufferOnSelectTick() {
  return false;
}

/**
 * Spectator / still capture size from the XR layer. Stereo buffers are ~2× wide;
 * use one-eye width. Never a CSS-pixel 960×540 still.
 */
export function xrSpectatorCaptureSize({
  framebufferWidth = 0,
  framebufferHeight = 0,
  still = false,
} = {}) {
  const fw = Number(framebufferWidth) || 0;
  const fh = Number(framebufferHeight) || 0;
  const capW = still === true ? 2560 : 1920;
  const capH = still === true ? 1440 : 1080;
  const minW = still === true ? 1600 : 1280;
  const minH = still === true ? 900 : 720;
  let w = still === true ? 1920 : 1280;
  let h = still === true ? 1080 : 720;
  if (fw >= 800 && fh >= 600) {
    const stereo = fw > fh * 1.55;
    w = stereo ? Math.round(fw / 2) : fw;
    h = fh;
  }
  return {
    w: Math.min(capW, Math.max(minW, Math.round(w))),
    h: Math.min(capH, Math.max(minH, Math.round(h))),
  };
}

/** Headset stills stay PNG — JPEG 0.88 + 540p looked scanlined in-visor. */
export function xrScreenshotMimeType() {
  return "image/png";
}

/** Same defer as other HUD work — start MediaRecorder / spectator paint off the click frame. */
export function xrRecordStartDeferMs() {
  return 80;
}

/** The XR DOM canvas is cleared transparent; blit it while presenting and the reel is black. */
export function shouldBlitXrDomCanvasWhilePresenting({ presenting = false } = {}) {
  return presenting !== true;
}

/** Quest compositor passthrough is not in the GL canvas — open the world camera when AR / Pass is on. */
export function shouldOpenXrPassthroughCamera({
  presenting = false,
  passthroughOn = false,
  sessionMode = "",
} = {}) {
  if (presenting !== true) return false;
  if (passthroughOn === true) return true;
  return String(sessionMode || "").toLowerCase().includes("immersive-ar");
}

export const CRESCENT_HIT_LOCAL_Z = 0.028;
export const WRIST_GRID_HIT_LOCAL_Z = 0.008;

/** Stop / SC sit in the crescent — prefer them when they overlap the wrist grid. */
export function preferCrescentDockHit(hits = []) {
  const usable = (Array.isArray(hits) ? hits : []).filter((h) => (
    h?.object?.userData?.xrTool && h.object.visible !== false
  ));
  if (!usable.length) return null;
  const sorted = usable.slice().sort((a, b) => (Number(a.distance) || 0) - (Number(b.distance) || 0));
  const closest = sorted[0];
  const crescent = sorted.find((h) => h.object.userData?.xrCrescent);
  if (crescent && ((Number(crescent.distance) || 0) - (Number(closest.distance) || 0)) < 0.08) {
    return crescent;
  }
  return closest;
}

export const DRAW_HAND_COLOR_IDS = [
  "color_e85d4c", "color_f59e0b", "color_22c55e", "color_06b6d4",
  "color_3b82f6", "color_a855f7", "color_ec4899", "color_f8fafc",
];

export function toolHandShowsCreateHistory(tool) {
  const t = String(tool || "");
  return t === "draw" || t === "wall_height" || t.startsWith("create_");
}

export function toolHandUiIds(tool) {
  const t = String(tool || "");
  if (t === "draw") {
    return ["pen", ...DRAW_HAND_COLOR_IDS, "draw_size_s", "draw_size_m", "draw_size_l", "undo", "redo"];
  }
  if (t === "create_box") {
    return ["box_face", "box_extrude", "box_corner", "box_move", "box_turn_left", "box_turn_right", "undo", "redo"];
  }
  if (t.startsWith("create_") || t === "wall_height") {
    return ["prim_size", "prim_move", "undo", "redo"];
  }
  return [];
}

/** Session create/draw history: one step per committed solid or stroke. Redo clears on push. */
export function createXrCreateHistory({ max = 64 } = {}) {
  const undo = [];
  const redo = [];
  const cap = Math.max(1, Number(max) || 64);
  return {
    push(entry) {
      if (!entry) return;
      undo.push(entry);
      redo.length = 0;
      while (undo.length > cap) undo.shift();
    },
    undo() {
      const entry = undo.pop();
      if (!entry) return null;
      redo.push(entry);
      return entry;
    },
    redo() {
      const entry = redo.pop();
      if (!entry) return null;
      undo.push(entry);
      return entry;
    },
    canUndo() {
      return undo.length > 0;
    },
    canRedo() {
      return redo.length > 0;
    },
    undoCount() {
      return undo.length;
    },
    redoCount() {
      return redo.length;
    },
  };
}

export function parkXrObject(obj, parked = true) {
  if (!obj) return obj;
  const u = obj.userData || (obj.userData = {});
  if (parked) {
    if (u.xrParkPrevVisible == null) u.xrParkPrevVisible = obj.visible !== false;
    if (u.xrParkPrevDrawable == null) u.xrParkPrevDrawable = !!u.xrDrawable;
    obj.visible = false;
    u.xrParked = true;
    u.xrDrawable = false;
  } else {
    obj.visible = u.xrParkPrevVisible !== false;
    u.xrDrawable = u.xrParkPrevDrawable !== false;
    u.xrParked = false;
  }
  return obj;
}

/** Snap chip follows the aiming / non-dock hand (right when the dock stays on the left). */
export function xrSnapControlHand(dockHand = "left") {
  return String(dockHand).toLowerCase() === "right" ? "left" : "right";
}

export const AUTHORIZED_APP_STREAM_PROVIDERS = [
  { id: "x_live", label: "X Live", detail: "Go live on X" },
  { id: "twitch", label: "Twitch", detail: "Go live on Twitch" },
  { id: "kick", label: "Kick", detail: "Go live on Kick" },
];

export function authorizedAppStreamProviderIds() {
  return AUTHORIZED_APP_STREAM_PROVIDERS.map((p) => p.id);
}

export function authorizedAppStreamProviders(status = {}) {
  const list = Array.isArray(status)
    ? status
    : (status.providers || status.streams || status.connections || []);
  const byId = {};
  for (const row of list || []) {
    const id = String(row?.id || row?.provider || "").trim();
    if (id) byId[id] = row;
  }
  if (status && !Array.isArray(status) && typeof status === "object") {
    for (const p of AUTHORIZED_APP_STREAM_PROVIDERS) {
      if (status[p.id] && typeof status[p.id] === "object") byId[p.id] = { ...byId[p.id], ...status[p.id] };
    }
  }
  return AUTHORIZED_APP_STREAM_PROVIDERS.map((p) => {
    const row = byId[p.id] || {};
    return {
      ...p,
      connected: !!(row.connected || row.linked),
      handle: String(row.handle || row.username || row.display_name || ""),
    };
  });
}

export function crescentCaptureToolIds({
  open = false,
  recording = false,
  clipReady = false,
  kind = "capture",
  castFamily = "none",
} = {}) {
  if (kind === "stream_pick") return open ? streamCastPickerToolIds(castFamily) : [];
  if (kind === "stream") return open ? [...CRESCENT_STREAM_DEST_IDS] : [];
  if (kind === "link") return open ? [...CRESCENT_STREAM_LINK_IDS] : [];
  if (recording) return [...CRESCENT_RECORDING_TOOL_IDS];
  if (clipReady) return open ? [...CRESCENT_CLIP_READY_TOOL_IDS] : [];
  if (!open) return [];
  return [...CRESCENT_CAPTURE_TOOL_IDS];
}

/** Backwards-C / half-moon offsets around a puck (opens to +X, away from the menu grid). */
export function crescentMoonOffsets(count, {
  radius = 0.074,
  startRad = -Math.PI * 0.32,
  endRad = Math.PI * 0.32,
} = {}) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return [];
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = startRad + (endRad - startRad) * t;
    out.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, angle: a });
  }
  return out;
}

/**
 * Aim a visor spotlight at the Render Studio wordmark in the loading mini-scene.
 * Extracted so tests can check direction without WebGL.
 */
export function headsetSpotlightTarget(headset = { x: 0, y: 0.08, z: 0.42 }, logo = { x: 0, y: -0.62, z: 0.05 }) {
  const hx = Number(headset.x) || 0;
  const hy = Number(headset.y) || 0;
  const hz = Number(headset.z) || 0;
  const lx = Number(logo.x) || 0;
  const ly = Number(logo.y) || 0;
  const lz = Number(logo.z) || 0;
  const dx = lx - hx;
  const dy = ly - hy;
  const dz = lz - hz;
  const distance = Math.hypot(dx, dy, dz) || 1;
  return {
    x: lx,
    y: ly,
    z: lz,
    dir: { x: dx / distance, y: dy / distance, z: dz / distance },
    distance,
    angle: Math.atan2(Math.hypot(dx, dz), dy),
  };
}

/** Folder-qualified path so the PC image viewer can GET the saved screenshot. */
export function resolveXrCaptureFileRel(url, fallbackName = "") {
  const raw = String(url || "");
  const idx = raw.indexOf("/files/");
  if (idx >= 0) {
    const encoded = raw.slice(idx + 7).split("?")[0];
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return String(fallbackName || "").replace(/^\/+/, "");
}

export function studioTabIds() {
  return ["stats", "history", "access", "keys"];
}

export function publicProfileTabIds() {
  return ["profile", "store", "activity", "settings", "calendar"];
}

export function publicProfileTabLabels() {
  return [
    { id: "profile", label: "Profile" },
    { id: "store", label: "Store" },
    { id: "activity", label: "Activity" },
    { id: "settings", label: "Settings" },
    { id: "calendar", label: "Calendar" },
  ];
}

function profileHandle(profile = {}) {
  const raw = String(profile.handle || "").replace(/^@/, "").trim();
  return raw ? `@${raw}` : "";
}

function activityLabel(ev = {}) {
  const named = String(ev.label || ev.title || ev.name || "").trim();
  const kind = String(ev.kind || ev.type || "").toLowerCase();
  if (named) return named.slice(0, 46);
  if (kind === "store") return "published an item on Render3D stores";
  if (kind === "cad" || kind === "project") return "generated a new CAD model";
  if (kind === "app") return "published an agent app";
  return "recent activity";
}

export function publicProfileLinesForTab(tab, profile = {}, extras = {}) {
  const uid = String(profile.id || extras.userId || "");
  const handle = profileHandle(profile);
  const self = !!(profile.is_self || extras.isSelf);
  const lines = [];
  if (extras.includeBack !== false) {
    lines.push({ id: "room_back", label: "← Back", active: false, kind: "social", icon: "undo" });
  }
  if (tab === "store") {
    const items = [
      ...(Array.isArray(profile.store_items) ? profile.store_items : []),
      ...(Array.isArray(profile.store_listings) ? profile.store_listings : []),
      ...((profile.store?.items && Array.isArray(profile.store.items)) ? profile.store.items : []),
    ];
    const projects = Array.isArray(profile.projects) ? profile.projects : [];
    if (items.length) {
      items.slice(0, 8).forEach((item) => {
        lines.push({
          id: "",
          label: String(item.name || item.title || "Listing").slice(0, 42),
          sub: item.tagline || item.summary || (item.price_cents ? `$${(Number(item.price_cents) / 100).toFixed(0)}` : "Render3D store"),
          kind: "hint",
          icon: "export",
        });
      });
    } else if (projects.length) {
      projects.slice(0, 6).forEach((p) => {
        lines.push({
          id: "",
          label: String(p.name || p.project_id || "Project").slice(0, 42),
          sub: `${p.model_count || 0} models · public CAD`,
          kind: "hint",
          icon: "front",
        });
      });
    } else {
      lines.push({
        id: "",
        label: "No store items yet",
        sub: "Published Render3D store listings show here",
        kind: "hint",
        icon: "export",
      });
    }
    return { lines, footer: "Items they published on Render3D stores" };
  }
  if (tab === "activity") {
    const events = Array.isArray(profile.activity) && profile.activity.length
      ? profile.activity
      : (Array.isArray(profile.posts) ? profile.posts : []);
    if (events.length) {
      events.slice(0, 8).forEach((ev) => {
        lines.push({
          id: "",
          label: activityLabel(ev),
          sub: String(ev.created_at || ev.published_at || ev.summary || "").slice(0, 42),
          kind: "hint",
          icon: "ai",
        });
      });
    } else {
      lines.push({
        id: "",
        label: "No recent activity",
        sub: "CAD publishes and store posts land here",
        kind: "hint",
        icon: "ai",
      });
    }
    return { lines, footer: "Recent public activity" };
  }
  if (tab === "settings") {
    if (self || !uid) {
      lines.push({
        id: "",
        label: "This is you",
        sub: "Mute / friend live on other people's profiles",
        kind: "hint",
        icon: "move",
      });
    } else {
      lines.push(
        {
          id: `room_mute:${uid}`,
          label: extras.muted ? "Unmute them" : "Mute them",
          active: !!extras.muted,
          kind: "social",
          icon: "mic",
        },
        {
          id: `room_add:${uid}`,
          label: extras.isFriend ? "Friends" : "Add friend",
          active: !!extras.isFriend,
          kind: "social",
          icon: "front",
        },
        {
          id: `room_file:${uid}`,
          label: "Send file",
          sub: "Share the open model",
          kind: "social",
          icon: "export",
        },
        {
          id: `room_msg:${uid}`,
          label: "Message",
          sub: "Invite them into this project",
          kind: "social",
          icon: "ai",
        },
      );
    }
    return { lines, footer: "Person settings · not your account" };
  }
  if (tab === "calendar") {
    const cal = profile.calendar || {};
    const slots = Array.isArray(profile.suggested_slots) && profile.suggested_slots.length
      ? profile.suggested_slots
      : (Array.isArray(cal.suggested_slots) ? cal.suggested_slots : []);
    if (self) {
      lines.push({
        id: "",
        label: cal.connected ? "Your calendar is connected" : "Connect Google / Outlook on laptop",
        sub: "Studio → Profile → availability",
        kind: "hint",
        icon: "ai",
      });
    } else if (uid) {
      lines.push({
        id: `meet:${uid}`,
        label: "Request a meeting",
        sub: cal.internal_only ? "Open slots · busy times stay private" : "Uses their Studio scheduler",
        kind: "social",
        icon: "ai",
        active: true,
      });
      slots.slice(0, 6).forEach((s) => {
        const start = s.starts_at || "";
        const end = s.ends_at || "";
        lines.push({
          id: start && end ? `meetslot:${uid}|${start}|${end}` : "",
          label: String(s.label || start).slice(0, 42),
          sub: "Tap to request this slot",
          kind: "social",
          icon: "front",
        });
      });
      if (!slots.length) {
        lines.push({
          id: "",
          label: "No open slots listed",
          sub: "Request still sends a Studio meeting invite",
          kind: "hint",
          icon: "front",
        });
      }
    }
    return { lines, footer: "Same meeting-request API as the laptop profile" };
  }
  lines.push({
    id: "",
    label: profile.display_name || "Profile",
    sub: handle || "Public profile",
    active: false,
    kind: "hint",
    icon: "move",
    avatarUrl: extras.avatarUrl || profile.avatar_url,
  });
  if (handle) {
    lines.push({
      id: "",
      label: handle,
      sub: profile.online ? "Online" : (profile.status_text || "Render3D handle"),
      kind: "hint",
      icon: "ai",
    });
  }
  const bio = String(profile.bio || "").trim();
  if (bio) {
    const chunks = bio.match(/.{1,42}/g) || [bio];
    chunks.slice(0, 3).forEach((chunk) => {
      lines.push({ id: "", label: chunk, kind: "hint", icon: "ai" });
    });
  }
  if (profile.status_text || profile.status_icon) {
    lines.push({
      id: "",
      label: [profile.status_icon, profile.status_text].filter(Boolean).join(" "),
      sub: profile.online ? "Online now" : "",
      kind: "hint",
      icon: "mic",
    });
  }
  return { lines, footer: handle ? `${handle} · public profile` : "Public profile" };
}

export function studioLinesForTab(tab, data = {}) {
  const usage = data?.usage || {};
  const history = Array.isArray(data?.history) ? data.history : [];
  const shares = Array.isArray(data?.shares) ? data.shares : [];
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (tab === "stats") {
    const people = Array.isArray(usage.by_user) ? usage.by_user : [];
    const lines = [
      {
        id: "",
        label: `${usage.queries || 0} queries · ${usage.tokens || 0} tokens`,
        sub: "Same prompt History totals as the laptop, across everyone on this project",
        kind: "hint",
        active: true,
      },
      ...people.slice(0, 6).map((u) => ({
        id: "",
        label: `${u.name || "Someone"} · ${u.queries || 0} queries`,
        sub: `${u.tokens || 0} tokens`,
        kind: "hint",
      })),
    ];
    return {
      lines,
      footer: people.length ? "Totals from laptop prompt History" : "Generate once to see per-person tokens",
    };
  }
  if (tab === "history") {
    const lines = mapHistoryToStudioLines(history, 12);
    return {
      lines: lines.length ? lines : [{ id: "", label: "No History yet", sub: "Same log as the laptop History tab", kind: "hint" }],
      footer: "Newest first · trigger a Timeline row to restore · Log only does not restore",
    };
  }
  if (tab === "access") {
    const lines = [
      ...teams.slice(0, 5).map((t) => ({
        id: `ws:${t.id}`,
        label: `Save to ${t.name || "workspace"}`,
        sub: t.id === data.team_id ? "Current workspace" : "Move this project",
        kind: "studio",
        active: t.id === data.team_id,
      })),
      ...shares.slice(0, 4).map((s) => ({
        id: s.user_id ? `unshare:${s.user_id}` : "",
        label: s.display_name || s.email || "Shared user",
        sub: "Has project access · trigger to remove",
        kind: "studio",
      })),
      { id: "share_invite", label: "Share with someone…", sub: "Uses project share / workspace invite", kind: "studio" },
    ];
    return { lines, footer: "Workspace ACL · same Save to workspace as laptop Share" };
  }
  const keyLines = keys.flatMap((k) => {
    const members = Array.isArray(k.members) ? k.members : [];
    return [
      { id: "", label: k.label || "Key", sub: k.kind === "chatgpt" ? "ChatGPT subscription" : "API key", kind: "hint" },
      ...members.filter((m) => !m.is_owner).slice(0, 5).map((m) => ({
        id: `key:${k.kind}:${k.team_id}:${k.id}:${m.user_id}:${m.granted ? "0" : "1"}`,
        label: `${m.granted ? "On" : "Off"} · ${m.display_name || m.email || "Member"}`,
        sub: "VR permission · syncs to laptop Sub / Connect",
        kind: "studio",
        active: !!m.granted,
      })),
    ];
  });
  const streamLines = authorizedAppStreamProviders(data.streams || data.stream_providers || {}).map((p) => ({
    id: `stream:${p.id}`,
    label: `${p.connected ? "Live ready" : "Connect"} · ${p.label}`,
    sub: p.handle ? `@${p.handle.replace(/^@/, "")}` : "Headset browser or Send to PC + QR",
    kind: "studio",
    active: !!p.connected,
  }));
  const lines = [...streamLines, ...(keyLines.length ? keyLines : [{ id: "", label: "No shared keys yet", sub: "Share ChatGPT from Connect, then grant people here", kind: "hint" }])];
  return {
    lines,
    footer: "Stream apps + key grants · laptop Authorized Apps stay in sync",
  };
}

export function mapHistoryToStudioLines(history, limit = 12) {
  const newest = [...(history || [])].sort((a, b) => (
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  ));
  return newest.slice(0, limit).map((e, i) => {
    const restorable = !!(e.restorable && e.timeline_index != null);
    return {
      id: restorable ? `hist:${e.timeline_index}` : "",
      label: String(e.label || e.kind || "Change").slice(0, 40),
      sub: [
        e.user_name,
        restorable ? `Timeline #${Number(e.timeline_index) + 1}` : "Log only",
        e.created_at ? String(e.created_at).slice(0, 16) : "",
      ].filter(Boolean).join(" · "),
      kind: restorable ? "studio" : "hint",
      active: i === 0,
    };
  });
}

export function vrPermissionRows(ownedShares = [], shareMembers = {}) {
  const rows = [];
  for (const share of ownedShares || []) {
    for (const member of shareMembers[share.id] || []) {
      if (member.is_owner) continue;
      rows.push({
        shareId: share.id,
        teamId: share.team_id,
        userId: member.user_id,
        granted: !!member.granted,
        label: `${member.display_name || member.email || "Member"} · ${share.team_name || "workspace"}`,
      });
    }
  }
  return rows;
}

export function grantNotifyUserIds(actorId, targetId) {
  const out = [];
  for (const uid of [targetId, actorId]) {
    const id = String(uid || "").trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function xrRelayTypes() {
  return ["xr.stroke", "xr.file", "xr.prompt.bridge", "xr.fit", "xr.draw", "xr.video", "rtc.signal", "xr.drop", "xr.object", "xr.printer", "xr.board", "xr.table", "xr.seat"];
}

/** Same Google STUN the voice path already used — no new vendor. */
export const XR_STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export const XR_ICE_API = "/api/rtc/ice";

/** Bearer token so /api/rtc/ice can attach env TURN without leaking it anonymously. */
export function xrIceFetchInit(token = "") {
  const headers = {};
  const t = String(token || "").trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  return { credentials: "same-origin", headers };
}

export function iceServersFromApiPayload(data) {
  const list = data?.iceServers || data?.ice_servers;
  if (!Array.isArray(list)) return [];
  return list.filter((row) => row && (row.urls || row.url));
}

export function extraIceServersFromWindow(win = globalThis) {
  try {
    const raw = win?.RENDER3D_ICE_SERVERS || win?.__XR_ICE_SERVERS__;
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function xrIceServers(extra = []) {
  const out = [];
  const seen = new Set();
  const add = (row) => {
    if (!row || typeof row !== "object") return;
    const urls = row.urls || row.url;
    if (!urls) return;
    const key = `${Array.isArray(urls) ? urls.join(",") : urls}|${row.username || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  };
  for (const s of XR_STUN_SERVERS) add(s);
  for (const s of extra || []) add(s);
  return out;
}

export function xrIceServersHaveStun(servers = []) {
  return (servers || []).some((s) => /stun:/i.test(String(s?.urls || s?.url || "")));
}

export function xrIceServersHaveTurn(servers = []) {
  return (servers || []).some((s) => /turns?:/i.test(String(s?.urls || s?.url || "")));
}

export function iceRestartOfferOptions() {
  return { offerToReceiveAudio: true, iceRestart: true };
}

/** restart = renegotiate on the same PC; recreate = teardown and dial again. */
export function shouldRestartIce({
  iceConnectionState = "",
  connectionState = "",
  lastRestartAt = 0,
  now = 0,
  restartCount = 0,
  gpuBusy = false,
} = {}) {
  if (gpuBusy === true) return "";
  const ice = String(iceConnectionState || "");
  const conn = String(connectionState || "");
  if (conn === "closed") return "recreate";
  if (Number(restartCount) >= 4) return "recreate";
  const failed = ice === "failed" || conn === "failed";
  const stuck = ice === "disconnected" || conn === "disconnected";
  if (!failed && !stuck) return "";
  const t = Number(now) || 0;
  const last = Number(lastRestartAt) || 0;
  if (last && t - last < 4000) return "";
  if (failed) return "restart";
  if (stuck) return "restart";
  return "";
}

export function shouldSendIceCandidate(candidate) {
  if (candidate === null) return true;
  if (!candidate || typeof candidate !== "object") return false;
  return !!(candidate.candidate || candidate.sdpMid != null || candidate.sdpMLineIndex != null);
}

export function shouldQueueRemoteIce({ remoteDescriptionSet = false } = {}) {
  return !remoteDescriptionSet;
}

export function downsampleStrokePoints(points, max = XR_NETWORK_STROKE_MAX_POINTS) {
  const src = Array.isArray(points) ? points : [];
  if (src.length <= max) return src;
  const out = [];
  const last = src.length - 1;
  const steps = Math.max(1, max - 1);
  for (let i = 0; i < steps; i += 1) {
    out.push(src[Math.round((i * last) / steps)]);
  }
  out.push(src[last]);
  return out;
}

export function poseSignature(pose) {
  const h = pose?.head?.p || [0, 0, 0];
  const l = pose?.left?.p || [0, 0, 0];
  const r = pose?.right?.p || [0, 0, 0];
  const grab = pose?.held?.grabbing ? 1 : 0;
  const speak = pose?.speaking ? 1 : 0;
  const positions = [...h, ...l, ...r, grab, speak]
    .map((n) => Math.round(Number(n) * 50) / 50)
    .join(",");
  const rotations = ['head', 'left', 'right'].flatMap(key => pose?.[key]?.q || [0, 0, 0, 1])
    .map(n => Math.round(Number(n) * 100) / 100).join(',');
  return `${positions};${rotations}`;
}

export function poseMoved(prevSig, nextSig) {
  return !prevSig || prevSig !== nextSig;
}

/** How far past the last sample we keep sliding (90 ms ticks → ~1 extra packet). */
export const XR_POSE_EXTRAPOLATE_MS = 120;
export const XR_POSE_SNAP_M = 2.4;

export function makePoseTrack() {
  return {
    t0: 0,
    t1: 0,
    p0: [0, 0, 0],
    p1: [0, 0, 0],
    q0: [0, 0, 0, 1],
    q1: [0, 0, 0, 1],
    has: false,
    hasQ: false,
  };
}

export function ingestPosePart(track, part, t) {
  const row = track || makePoseTrack();
  const p = part?.p || part?.position;
  if (!Array.isArray(p) || p.length !== 3) {
    row.has = false;
    return row;
  }
  const q = part?.q || part?.quaternion;
  const now = Number(t) || 0;
  if (!row.has) {
    row.t0 = now;
    row.t1 = now;
    row.p0[0] = p[0];
    row.p0[1] = p[1];
    row.p0[2] = p[2];
    row.p1[0] = p[0];
    row.p1[1] = p[1];
    row.p1[2] = p[2];
    if (Array.isArray(q) && q.length === 4) {
      row.q0[0] = q[0];
      row.q0[1] = q[1];
      row.q0[2] = q[2];
      row.q0[3] = q[3];
      row.q1[0] = q[0];
      row.q1[1] = q[1];
      row.q1[2] = q[2];
      row.q1[3] = q[3];
      row.hasQ = true;
    }
    row.has = true;
    return row;
  }
  row.t0 = row.t1;
  row.p0[0] = row.p1[0];
  row.p0[1] = row.p1[1];
  row.p0[2] = row.p1[2];
  if (row.hasQ) {
    row.q0[0] = row.q1[0];
    row.q0[1] = row.q1[1];
    row.q0[2] = row.q1[2];
    row.q0[3] = row.q1[3];
  }
  row.t1 = now;
  row.p1[0] = p[0];
  row.p1[1] = p[1];
  row.p1[2] = p[2];
  if (Array.isArray(q) && q.length === 4) {
    row.q1[0] = q[0];
    row.q1[1] = q[1];
    row.q1[2] = q[2];
    row.q1[3] = q[3];
    row.hasQ = true;
  }
  return row;
}

export function poseSampleAlpha(t0, t1, now, maxExtrapMs = XR_POSE_EXTRAPOLATE_MS) {
  const span = Number(t1) - Number(t0);
  if (!(span > 1e-3)) return 1;
  const raw = (Number(now) - Number(t0)) / span;
  const maxU = 1 + Math.max(0, Number(maxExtrapMs) || 0) / span;
  if (raw < 0) return 0;
  if (raw > maxU) return maxU;
  return raw;
}

export function lerpVec3(a, b, u, out) {
  const dest = out || [0, 0, 0];
  const t = Number(u) || 0;
  dest[0] = a[0] + (b[0] - a[0]) * t;
  dest[1] = a[1] + (b[1] - a[1]) * t;
  dest[2] = a[2] + (b[2] - a[2]) * t;
  return dest;
}

export function nlerpQuat(a, b, u, out) {
  const dest = out || [0, 0, 0, 1];
  const t = Math.max(0, Math.min(1, Number(u) || 0));
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  dest[0] = a[0] + (s * b[0] - a[0]) * t;
  dest[1] = a[1] + (s * b[1] - a[1]) * t;
  dest[2] = a[2] + (s * b[2] - a[2]) * t;
  dest[3] = a[3] + (s * b[3] - a[3]) * t;
  const n = Math.hypot(dest[0], dest[1], dest[2], dest[3]) || 1;
  dest[0] /= n;
  dest[1] /= n;
  dest[2] /= n;
  dest[3] /= n;
  return dest;
}

export function samplePoseTrack(track, now, outP, outQ, maxExtrapMs = XR_POSE_EXTRAPOLATE_MS) {
  if (!track?.has) return null;
  const destP = outP || [0, 0, 0];
  const destQ = outQ || [0, 0, 0, 1];
  const dx = track.p1[0] - track.p0[0];
  const dy = track.p1[1] - track.p0[1];
  const dz = track.p1[2] - track.p0[2];
  if (Math.hypot(dx, dy, dz) > XR_POSE_SNAP_M) {
    destP[0] = track.p1[0];
    destP[1] = track.p1[1];
    destP[2] = track.p1[2];
    if (track.hasQ) {
      destQ[0] = track.q1[0];
      destQ[1] = track.q1[1];
      destQ[2] = track.q1[2];
      destQ[3] = track.q1[3];
    }
    return { p: destP, q: track.hasQ ? destQ : null, u: 1, snapped: true };
  }
  const u = poseSampleAlpha(track.t0, track.t1, now, maxExtrapMs);
  lerpVec3(track.p0, track.p1, u, destP);
  if (track.hasQ) nlerpQuat(track.q0, track.q1, u, destQ);
  return { p: destP, q: track.hasQ ? destQ : null, u, snapped: false };
}

/** Mute always wins — volume sliders must not un-mute. */
export function peerVoiceOutputGain(muted, volume) {
  if (muted) return 0;
  const v = Number(volume);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

/** Local -Z (headset look) from a world quaternion. */
export function listenerAxesFromQuat(q) {
  const x = Number(q?.x ?? q?.[0]) || 0;
  const y = Number(q?.y ?? q?.[1]) || 0;
  const z = Number(q?.z ?? q?.[2]) || 0;
  const w = Number(q?.w ?? q?.[3]) || 1;
  return {
    fx: -2 * (x * z + w * y),
    fy: -2 * (y * z - w * x),
    fz: -(1 - 2 * (x * x + y * y)),
    ux: 2 * (x * y - w * z),
    uy: 1 - 2 * (x * x + z * z),
    uz: 2 * (y * z + w * x),
  };
}

/** Loading-screen layout class names (DOM splash + Quest pre-present overlay). */
export const BOOT_LAYOUT_CLASS_NAMES = {
  screen: "studio-boot-screen",
  card: "studio-boot-card",
  chromeWord: "studio-boot-chrome-word",
  logoCenter: "studio-boot-logo-center",
  logoMark: "studio-boot-logo-mark",
  headsetHost: "studio-boot-headset-host",
  xrEnter: "studio-boot-xr-enter",
  xrBtn: "studio-boot-xr-btn",
  xrBtnPrimary: "studio-boot-xr-btn--primary",
  xrBtnSecondary: "studio-boot-xr-btn--secondary",
};

/** Wordmark top-right of the loading window; animated mark centered. */
export function bootLogoPlacement() {
  return {
    chromeWord: "top-right",
    mark: "center",
    headset: "behind-center",
    xrControls: "compact",
    innerFrame: "padded",
  };
}

/** Splash Three draw order — logo must paint over the metal gear. */
export const BOOT_SPLASH_RENDER_ORDER = {
  headset: 0,
  gear: 1,
  electricity: 2,
  logo: 10,
};

export function bootSplashLogoInFrontOfGear(
  logoOrder = BOOT_SPLASH_RENDER_ORDER.logo,
  gearOrder = BOOT_SPLASH_RENDER_ORDER.gear,
) {
  return Number(logoOrder) > Number(gearOrder);
}

export const LOGO_EGG_HOLD_MS = 650;
export const LOGO_EGG_STORAGE_KEY = "render3d:xrLogoEgg:v1";
export const LOGO_EGG_PENDING_KEY = "render3d:xrLogoEgg:pending";

export function flashlightFromRay(origin = {}, dir = {}, { distance = 2.2 } = {}) {
  const ox = Number(origin.x) || 0;
  const oy = Number(origin.y) || 0;
  const oz = Number(origin.z) || 0;
  const dx = Number(dir.x) || 0;
  const dy = Number(dir.y) || 0;
  const dz = Number(dir.z) || -1;
  const len = Math.hypot(dx, dy, dz) || 1;
  const dist = Number(distance);
  const d = Number.isFinite(dist) && dist > 0 ? dist : 2.2;
  return {
    position: { x: ox, y: oy, z: oz },
    target: {
      x: ox + (dx / len) * d,
      y: oy + (dy / len) * d,
      z: oz + (dz / len) * d,
    },
    distance: d,
  };
}

/** Cheap ray vs sphere (no alloc). Used for aiming at the boot / studio logo. */
export function rayHitsSphere(origin = {}, dir = {}, center = {}, radius = 0.16) {
  const ox = (Number(origin.x) || 0) - (Number(center.x) || 0);
  const oy = (Number(origin.y) || 0) - (Number(center.y) || 0);
  const oz = (Number(origin.z) || 0) - (Number(center.z) || 0);
  const dx = Number(dir.x) || 0;
  const dy = Number(dir.y) || 0;
  const dz = Number(dir.z) || -1;
  const r = Math.max(0.01, Number(radius) || 0.16);
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-12) return false;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0;
}

/** Planetary Tinkerbell / gears easter egg — removed. */
export function logoEasterEggShouldFire() {
  return false;
}

export function parseLogoEggStore(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!v || typeof v !== "object") return { count: 0, lastPlayedAt: 0 };
    return {
      count: Math.max(0, Number(v.count) || 0),
      lastPlayedAt: Number(v.lastPlayedAt) || 0,
    };
  } catch {
    return { count: 0, lastPlayedAt: 0 };
  }
}

export function recordLogoEggPlay(prev = {}, at = Date.now()) {
  const cur = parseLogoEggStore(prev);
  return { count: cur.count + 1, lastPlayedAt: Number(at) || Date.now() };
}

export function logoEggTimeline(t, duration = 4.2) {
  const time = Math.max(0, Number(t) || 0);
  const dur = Number(duration) > 0 ? Number(duration) : 4.2;
  const u = Math.min(1, time / dur);
  let phase = "orbit";
  if (time >= dur) phase = "done";
  else if (time >= 2.55) phase = "fall";
  else if (time >= 2.35) phase = "burst";
  else if (time >= 1.55) phase = "approach";
  return {
    phase,
    u,
    done: phase === "done",
    disposeGears: phase === "done",
    logoVisible: phase === "orbit" || phase === "approach",
    gearCount: phase === "burst" || phase === "fall" || phase === "done" ? 7 : 0,
  };
}

export const GPT_IMAGE_MODEL_CANDIDATES = ["gpt-image-2", "gpt-image-1"];

export function environmentWrapPrompt(userPrompt = "") {
  const brief = String(userPrompt || "").trim() || "calm photoreal empty studio";
  return [
    "Create a seamless equirectangular 360-degree environment panorama for WebVR / WebXR.",
    "Layout: 2:1 equirectangular skybox wrap (full spherical map), photoreal, no UI, no people, no text, no logos.",
    "Optimized for Quest WebXR as scene.background / scene.environment — a lightweight wrap, not a dense 3D mesh.",
    "Even lighting, continuous left-right horizon, no sparkling noise. Cubemap-style environment wrap.",
    `User scene: ${brief}`,
  ].join(" ");
}

export function isEnvironmentWrapIntent(text, { armed = false } = {}) {
  if (armed) return true;
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  return /\b(skybox|equirect|environment wrap|360\s*(room|scene|panorama)|webvr\s+environment|webxr\s+environment)\b/.test(t);
}

/**
 * Generate only saves. GPU apply is VR Change scene while presenting.
 * Laptop CAD viewport never gets the equirect as background or IBL.
 */
export function shouldApplyEnvironmentWrapNow({ userPickedScene = false, presenting = false } = {}) {
  return userPickedScene === true && presenting === true;
}

export const XR_BUILTIN_ENVIRONMENTS = [
  { id: "workshop", label: "★ Workshop", kind: "builtin", pinned: true },
  { id: "white", label: "White room", kind: "builtin" },
  { id: "warehouse", label: "Warehouse", kind: "builtin" },
];

/** Scenes offered inside the shared public VR room (same ids as builtins). */
export const XR_PUBLIC_ROOM_SCENES = XR_BUILTIN_ENVIRONMENTS.map((row) => ({
  id: row.id,
  label: row.label,
  kind: row.kind || "builtin",
}));

export const XR_ENV_STORE_KEY = "render3d:xrEnvironments:v1";

export function parseXrEnvironmentStore(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const list = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [];
    return list
      .map((row, i) => ({
        id: String(row?.id || `wrap-${i + 1}`),
        label: String(row?.label || row?.name || "Saved environment").slice(0, 48),
        url: String(row?.url || ""),
        dataUrl: String(row?.dataUrl || ""),
        kind: "wrap",
      }))
      .filter((row) => row.url || row.dataUrl)
      .slice(0, 6);
  } catch {
    return [];
  }
}

export function serializeXrEnvironmentStore(items = []) {
  return JSON.stringify(
    (items || [])
      .slice(0, 6)
      .map((row) => ({
        id: String(row?.id || ""),
        label: String(row?.label || row?.name || "Saved environment").slice(0, 48),
        url: String(row?.url || ""),
        dataUrl: String(row?.dataUrl || "").length > 1_400_000 ? "" : String(row?.dataUrl || ""),
      }))
      .filter((row) => row.id && (row.url || row.dataUrl)),
  );
}

export function workspaceEnvironmentLines({
  saved = [],
  sceneId = "white",
  sceneMenu = false,
} = {}) {
  if (sceneMenu) {
    const rows = [
      ...XR_BUILTIN_ENVIRONMENTS.map((row) => ({
        id: `ws-env:${row.id}`,
        label: row.id === "workshop" ? "★ Workshop · realistic robotics room" : row.label,
        kind: "scene",
        icon: row.id === "workshop" ? "robotics" : "workspace",
        thumbnail: row.id === "workshop" ? "workshop" : row.id,
        active: sceneId === row.id,
      })),
      ...parseXrEnvironmentStore(saved).map((row) => ({
        id: `ws-env:${row.id}`,
        label: row.label,
        kind: "scene",
        icon: "workspace",
        active: sceneId === row.id,
      })),
      { id: "ws-env-back", label: "Back", kind: "action", icon: "undo" },
    ];
    return rows;
  }
  return [
    { id: "ws-scene-settings-open", label: "Open Scene Settings", kind: "action", icon: "settings" },
    { id: "ws-save-layout", label: "Save current space", kind: "action", icon: "save" },
    { id: "ws-env-generate", label: "Generate environment", kind: "action", icon: "ai" },
    { id: "ws-env-menu", label: "Change scene", kind: "action", icon: "workspace" },
  ];
}
