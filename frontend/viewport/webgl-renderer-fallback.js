/**
 * UI-only WebGLRenderer stand-in so Studio can finish booting when
 * `new THREE.WebGLRenderer()` throws (no GPU, sandboxed Chrome, etc.).
 */

export function makeFallbackXrStub() {
  const dummy = {
    visible: false,
    userData: {},
    add() { return this; },
    remove() { return this; },
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    /** UI-only boot stub — never treat as Three WebXRManager / webcam AR. */
    isFallbackStub: true,
    enabled: false,
    isPresenting: false,
    getController() { return dummy; },
    getControllerGrip() { return dummy; },
    getHand() { return dummy; },
    getCamera() { return null; },
    getSession() { return null; },
    setSession() { return Promise.resolve(); },
    addEventListener() {},
    removeEventListener() {},
  };
}

/** rAF stand-in for Three's WebXR `setAnimationLoop`. */
export function bindFallbackAnimationLoop(renderer, schedule) {
  const next = typeof schedule === "function"
    ? schedule
    : (fn) => globalThis.requestAnimationFrame(fn);
  let raf = 0;
  renderer.setAnimationLoop = (fn) => {
    if (raf) {
      try { globalThis.cancelAnimationFrame?.(raf); } catch { /* ignore */ }
      raf = 0;
    }
    if (typeof fn !== "function") return;
    const tick = (t) => {
      fn(t);
      raf = next(tick);
    };
    raf = next(tick);
  };
  return renderer;
}

/** Bind rAF setAnimationLoop when Three's WebXR method is missing (no-GPU fallback). */
export function ensureRendererAnimationLoop(renderer, schedule) {
  if (typeof renderer?.setAnimationLoop === "function") return renderer;
  return bindFallbackAnimationLoop(renderer || {}, schedule);
}

export function startRendererAnimationLoop(renderer, animate) {
  ensureRendererAnimationLoop(renderer);
  if (typeof renderer?.setAnimationLoop === "function") {
    renderer.setAnimationLoop(animate);
    return "loop";
  }
  const tick = (t) => {
    animate(t);
    globalThis.requestAnimationFrame(tick);
  };
  globalThis.requestAnimationFrame(tick);
  return "raf";
}

/** Silent stand-in after WebGL throws — no overlay copy, empty viewport is OK. */
export function createSilentBootRenderer() {
  const canvas = typeof document !== "undefined" && document.createElement
    ? document.createElement("canvas")
    : { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, parentElement: null };
  try {
    canvas.width = 1;
    canvas.height = 1;
  } catch { /* ignore */ }
  const fallback = {
    domElement: canvas,
    shadowMap: { enabled: false, autoUpdate: false },
    clippingPlanes: [],
    localClippingEnabled: false,
    xr: makeFallbackXrStub(),
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: "srgb",
    autoClear: true,
    setPixelRatio() {},
    getPixelRatio() { return 1; },
    setSize() {},
    setClearColor() {},
    setClearAlpha() {},
    getClearColor() { return { getHex() { return 0; } }; },
    getClearAlpha() { return 0; },
    render() {},
    dispose() {},
    getContext() { return null; },
    compile() {},
    info: { render: { frame: 0 }, memory: {} },
    debug: { checkShaderErrors: false },
    capabilities: { isWebGL2: false },
  };
  return ensureRendererAnimationLoop(fallback);
}
