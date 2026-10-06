/**
 * In-world Render VR headset mark — WebXR session only.
 * Head-locked (posed in front of the XR camera each frame, parented to the scene).
 * Not used on desktop PC boot.
 */

export const XR_ENTER_SPLASH_SVG =
  "/media/images/render-animations/VR-Animations/render-vr-animated.svg?v=20260908-vr-svg1";

export const XR_ENTER_SPLASH_OVERLAY_ID = "xr-enter-splash-overlay";

/** Quest GPU: never upload the 1080 SVG (blur filter inflates the bitmap). */
export const XR_ENTER_SPLASH_TEX_SIZE = 64;

export const XR_ENTER_SPLASH_DISTANCE = 1.2;
export const XR_ENTER_SPLASH_WIDTH = 0.78;
export const XR_ENTER_SPLASH_MIN_MS = 450;
export const XR_ENTER_SPLASH_MAX_MS = 8000;
export const XR_ENTER_SPLASH_FADE_MS = 280;
export const XR_ENTER_SPLASH_POP_MS = 380;

/** Desktop Chrome has navigator.xr — never show this outside a live XR session. */
export function shouldShowXrEnterSplash({ presenting = false } = {}) {
  return presenting === true;
}

/** Quest GPU: skip SVG/canvas upload on present. Tiny size kept if re-enabled. */
export function shouldUploadXrEnterSplashTexture({ presenting = false } = {}) {
  void presenting;
  return false;
}

/** 1080 animated SVG in the 2D overlay next to the XR framebuffer crashes Quest. */
export function shouldInjectXrEnterDomOverlay({ presenting = false } = {}) {
  void presenting;
  return false;
}

/**
 * Headset boot keeps a 1080 SMIL SVG (blur filter) in the 2D compositor.
 * Dismiss can wait 800ms+ — strip it the instant WebXR presents.
 */
export function killBootSplashDomForXr() {
  try { document.body?.classList?.add("xr-presenting"); } catch (_) {}
  try {
    const nodes = document.querySelectorAll?.(".studio-boot-headset-live-svg") || [];
    for (const img of nodes) {
      try { img.removeAttribute("src"); } catch (_) {}
      try { img.remove(); } catch (_) {}
    }
  } catch (_) {}
  try {
    const boot = document.getElementById("studio-boot-screen");
    if (boot) {
      boot.hidden = true;
      boot.classList.add("is-done");
      boot.setAttribute("aria-hidden", "true");
    }
  } catch (_) {}
}

/** Do not unhide the desktop 3D shell until WebXR is actually presenting. */
export function shouldRevealViewportBeforeXrSession() {
  return false;
}

/** `__studioXrEnterChosen` must stay false until requestSession succeeds. */
export function shouldSetXrEnterChosenBeforeSession() {
  return false;
}

export function xrEnterFailMessage(err) {
  const raw = String(err?.message || err || "").trim();
  if (/NotSupported|not supported/i.test(raw)) {
    return "Could not start immersive VR. Stay on this screen and tap Enter VR again.";
  }
  if (/SecurityError|NotAllowed|not allowed/i.test(raw)) {
    return "VR needs a tap on Enter VR. Stay here and tap the button again.";
  }
  return raw || "Could not start VR. Stay on this screen and tap Enter VR again.";
}

/**
 * requestSession failed — put the headset splash back and keep the 2D viewport
 * covered. Never treat a failed enter as a successful studio boot.
 */
export function restoreBootSplashAfterXrFail(message = "") {
  try { document.body?.classList?.remove("xr-presenting"); } catch (_) {}
  try { window.__studioXrEnterChosen = false; } catch (_) {}
  try { window.__studioXrEnterFailedKeepSplash = true; } catch (_) {}
  try {
    const boot = document.getElementById("studio-boot-screen");
    if (boot) {
      boot.hidden = false;
      boot.classList.remove("is-done");
      boot.removeAttribute("aria-hidden");
      try { boot.style.display = ""; } catch (_) {}
    }
  } catch (_) {}
  const text = String(message || "").trim();
  try {
    const sub = document.getElementById("studio-boot-sub");
    if (sub && text) sub.textContent = text;
  } catch (_) {}
  return text;
}

/**
 * Hide after the room / CAD is ready (or session end / safety timeout).
 * minShowMs keeps the pop visible so a fast place does not skip it.
 */
export function shouldDismissXrEnterSplash({
  presenting = false,
  sessionEnded = false,
  worldAnchored = false,
  cadPlaced = false,
  emptySceneReady = false,
  pendingCleared = false,
  shownMs = 0,
  minShowMs = XR_ENTER_SPLASH_MIN_MS,
  maxShowMs = XR_ENTER_SPLASH_MAX_MS,
} = {}) {
  if (sessionEnded || presenting !== true) return true;
  if (shownMs >= maxShowMs) return true;
  if (shownMs < minShowMs) return false;
  return !!(worldAnchored || cadPlaced || emptySceneReady || pendingCleared);
}

/** Strip SMIL + blur so the mark is a still bitmap, not a live SVG document. */
export function freezeAnimatedSvgForTexture(svgText) {
  return String(svgText || "")
    .replace(/<animateTransform\b[\s\S]*?\/>/gi, "")
    .replace(/<animate\b[\s\S]*?\/>/gi, "")
    .replace(/<animateTransform\b[\s\S]*?<\/animateTransform>/gi, "")
    .replace(/<animate\b[\s\S]*?<\/animate>/gi, "")
    .replace(/<filter\b[\s\S]*?<\/filter>/gi, "")
    .replace(/\sfilter="[^"]*"/gi, "")
    .replace(/\swidth="1080"/i, `width="${XR_ENTER_SPLASH_TEX_SIZE}"`)
    .replace(/\sheight="1080"/i, `height="${XR_ENTER_SPLASH_TEX_SIZE}"`);
}

export function xrEnterSplashWorldPos(
  head = { x: 0, y: 1.6, z: 0 },
  forward = { x: 0, y: 0, z: -1 },
  distance = XR_ENTER_SPLASH_DISTANCE,
) {
  return {
    x: Number(head.x) + Number(forward.x) * distance,
    y: Number(head.y) + Number(forward.y) * distance,
    z: Number(head.z) + Number(forward.z) * distance,
  };
}

function popScale(elapsedMs) {
  const t = Math.min(1, Math.max(0, elapsedMs / XR_ENTER_SPLASH_POP_MS));
  const eased = 1 - (1 - t) ** 3;
  return 0.42 + 0.58 * eased;
}

export function createXrEnterSplash({ THREE, scene } = {}) {
  if (!THREE) throw new Error("createXrEnterSplash needs THREE");

  const group = new THREE.Group();
  group.name = "xrEnterSplash";
  group.visible = false;
  group.renderOrder = 24000;
  group.frustumCulled = false;

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(XR_ENTER_SPLASH_WIDTH, XR_ENTER_SPLASH_WIDTH),
    mat,
  );
  mesh.name = "xrEnterSplashMark";
  mesh.renderOrder = 24001;
  mesh.frustumCulled = false;
  group.add(mesh);

  const _fwd = new THREE.Vector3();
  let shownAt = 0;
  let fadingAt = 0;
  let attached = false;
  let loadStarted = false;

  function attach() {
    if (!scene || attached) return;
    scene.add(group);
    attached = true;
  }

  function detach() {
    if (group.parent) group.parent.remove(group);
    attached = false;
    group.visible = false;
    mat.opacity = 0;
    shownAt = 0;
    fadingAt = 0;
  }

  function applyStillBitmap(bitmap) {
    if (!bitmap) return;
    const canvas = document.createElement("canvas");
    canvas.width = XR_ENTER_SPLASH_TEX_SIZE;
    canvas.height = XR_ENTER_SPLASH_TEX_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0, XR_ENTER_SPLASH_TEX_SIZE, XR_ENTER_SPLASH_TEX_SIZE);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    try { mat.map?.dispose?.(); } catch (_) {}
    mat.map = tex;
    mat.needsUpdate = true;
  }

  function loadTexture() {
    if (loadStarted) return;
    loadStarted = true;
    void (async () => {
      try {
        const res = await fetch(XR_ENTER_SPLASH_SVG, { cache: "force-cache" });
        if (!res.ok) return;
        const frozen = freezeAnimatedSvgForTexture(await res.text());
        const blob = new Blob([frozen], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.decoding = "async";
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
        applyStillBitmap(img);
        URL.revokeObjectURL(url);
        img.src = "";
      } catch (_) {
        /* SVG failed — keep the plane; pop still reads as a mark. */
      }
    })();
  }

  function followHead(headPos, headQuat) {
    if (!headPos || !headQuat) return;
    _fwd.set(0, 0, -1).applyQuaternion(headQuat);
    const pos = xrEnterSplashWorldPos(headPos, _fwd, XR_ENTER_SPLASH_DISTANCE);
    group.position.set(pos.x, pos.y, pos.z);
    group.quaternion.copy(headQuat);
  }

  function showLiveOverlay() {
    if (!shouldInjectXrEnterDomOverlay({ presenting: true })) return;
    try { document.body?.classList?.add("xr-enter-splash-css"); } catch (_) {}
    try {
      let el = document.getElementById(XR_ENTER_SPLASH_OVERLAY_ID);
      if (!el) {
        el = document.createElement("div");
        el.id = XR_ENTER_SPLASH_OVERLAY_ID;
        el.className = "xr-enter-splash-overlay";
        el.setAttribute("aria-hidden", "true");
        const img = document.createElement("img");
        img.className = "xr-enter-splash-live";
        img.alt = "";
        img.decoding = "async";
        img.draggable = false;
        img.src = XR_ENTER_SPLASH_SVG;
        el.appendChild(img);
        document.body.appendChild(el);
      }
      el.hidden = false;
    } catch (_) { /* overlay is CSS/DOM only — never a WebGL texture */ }
  }

  function hideLiveOverlay() {
    try { document.body?.classList?.remove("xr-enter-splash-css"); } catch (_) {}
    try {
      const el = document.getElementById(XR_ENTER_SPLASH_OVERLAY_ID);
      if (el) el.hidden = true;
    } catch (_) {}
  }

  function show() {
    if (!shouldShowXrEnterSplash({ presenting: true })) return;
    showLiveOverlay();
    shownAt = performance.now();
    fadingAt = 0;
    if (!shouldUploadXrEnterSplashTexture({ presenting: true })) return;
    loadTexture();
    attach();
    group.visible = true;
    group.scale.setScalar(popScale(0));
    mat.opacity = 0;
  }

  function hide() {
    hideLiveOverlay();
    detach();
  }

  function tick({
    now = performance.now(),
    presenting = false,
    sessionEnded = false,
    worldAnchored = false,
    cadPlaced = false,
    emptySceneReady = false,
    pendingCleared = false,
    headPos = null,
    headQuat = null,
  } = {}) {
    if (!presenting || sessionEnded) {
      hide();
      return;
    }
    if (!shownAt) return;

    const shownMs = now - shownAt;
    if (
      shouldDismissXrEnterSplash({
        presenting,
        sessionEnded,
        worldAnchored,
        cadPlaced,
        emptySceneReady,
        pendingCleared,
        shownMs,
      })
    ) {
      hide();
      return;
    }
    if (!group.visible) return;
    followHead(headPos, headQuat);
    group.scale.setScalar(popScale(shownMs));
    mat.opacity = Math.min(1, shownMs / 160);
  }

  function dispose() {
    detach();
    try { mesh.geometry?.dispose?.(); } catch (_) {}
    try { mat.map?.dispose?.(); } catch (_) {}
    try { mat.dispose?.(); } catch (_) {}
  }

  return {
    group,
    show,
    hide,
    tick,
    dispose,
    isVisible: () => group.visible,
  };
}
