/**
 * Isolated loading-screen Quest headset. Own WebGL canvas — never the CAD viewport.
 * Headset stays small behind the centered Render mark. Prefer the CSS logo on Quest
 * so boot never opens a second WebGL context while presenting.
 */
import * as THREE from "three";
import {
  BOOT_SPLASH_RENDER_ORDER,
  flashlightFromRay,
  headsetSpotlightTarget,
  shouldRunBootSplashRaf,
} from "../xr/xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&astra=20260916-5&threerestore1&webglboot1&models1";

export { headsetSpotlightTarget };

const HEADSET = { x: 0, y: -0.04, z: -0.12 };
const LOGO = { x: 0, y: 0.04, z: 0.08 };
const GEAR = { x: 0, y: 0.03, z: 0.0 };

function makeSteelCubeEnv() {
  const faces = [0x94a3b8, 0x64748b, 0xcbd5e1, 0x1e293b, 0x7dd3fc, 0x334155];
  const images = faces.map((hex) => {
    const cv = document.createElement("canvas");
    cv.width = 16;
    cv.height = 16;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = `#${hex.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, 0, 16, 16);
    return cv;
  });
  const tex = new THREE.CubeTexture(images);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function steelMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.92,
    roughness: 0.16,
    envMapIntensity: 1.15,
    ...extra,
  });
}

function buildMetalGear() {
  const group = new THREE.Group();
  group.name = "bootMetalGear";
  group.renderOrder = BOOT_SPLASH_RENDER_ORDER.gear;
  const steel = steelMat(0x6b7280);
  const dark = steelMat(0x374151, { roughness: 0.22 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 28), dark);
  hub.rotation.x = Math.PI / 2;
  hub.renderOrder = BOOT_SPLASH_RENDER_ORDER.gear;
  group.add(hub);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.022, 28), steel);
  rim.rotation.x = Math.PI / 2;
  rim.renderOrder = BOOT_SPLASH_RENDER_ORDER.gear;
  group.add(rim);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.011, 10, 36), steel);
  ring.name = "bootChromeRing";
  ring.renderOrder = BOOT_SPLASH_RENDER_ORDER.gear;
  group.add(ring);
  const toothGeo = new THREE.BoxGeometry(0.03, 0.022, 0.04);
  for (let i = 0; i < 12; i += 1) {
    const tooth = new THREE.Mesh(toothGeo, steel);
    const a = (i / 12) * Math.PI * 2;
    tooth.position.set(Math.cos(a) * 0.112, Math.sin(a) * 0.112, 0);
    tooth.rotation.z = a;
    tooth.renderOrder = BOOT_SPLASH_RENDER_ORDER.gear;
    group.add(tooth);
  }
  group.position.set(GEAR.x, GEAR.y, GEAR.z);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  return group;
}

function buildGearElectricity() {
  const group = new THREE.Group();
  group.name = "bootGearElectricity";
  group.renderOrder = BOOT_SPLASH_RENDER_ORDER.electricity;
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const spriteMat = new THREE.MeshBasicMaterial({
    color: 0xa5f3fc,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const n = 40;
  for (let ring = 0; ring < 3; ring += 1) {
    const pts = [];
    const radius = 0.128 + ring * 0.012;
    for (let i = 0; i <= n; i += 1) {
      const t = (i / n) * Math.PI * 2;
      const jag = i % 5 === 0 ? 0.014 : i % 2 === 0 ? -0.007 : 0.002;
      pts.push(new THREE.Vector3(
        Math.cos(t) * (radius + jag),
        Math.sin(t) * (radius + jag),
        Math.sin(t * 3 + ring) * 0.008,
      ));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
    line.rotation.x = ring * 0.22;
    line.rotation.y = ring * 0.45;
    line.renderOrder = BOOT_SPLASH_RENDER_ORDER.electricity;
    line.raycast = () => {};
    group.add(line);
  }
  const spark = new THREE.Mesh(new THREE.RingGeometry(0.122, 0.148, 28), spriteMat);
  spark.renderOrder = BOOT_SPLASH_RENDER_ORDER.electricity;
  spark.raycast = () => {};
  group.add(spark);
  group.position.set(GEAR.x, GEAR.y, GEAR.z);
  return group;
}

function buildQuestHeadset() {
  const root = new THREE.Group();
  root.name = "bootQuestHeadset";
  root.scale.setScalar(0.42);
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1a1f27,
    metalness: 0.55,
    roughness: 0.32,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0b1220,
    metalness: 0.2,
    roughness: 0.18,
    emissive: 0x12304a,
    emissiveIntensity: 0.35,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x58a6ff,
    metalness: 0.7,
    roughness: 0.25,
    emissive: 0x1d4ed8,
    emissiveIntensity: 0.45,
  });
  const strap = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.15,
    roughness: 0.7,
  });

  root.renderOrder = BOOT_SPLASH_RENDER_ORDER.headset;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.11, 0.13), visorMat);
  visor.position.set(0, 0.01, 0.02);
  root.add(visor);

  const face = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.09, 0.045), dark);
  face.position.set(0, 0.015, 0.085);
  root.add(face);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.06), dark);
  brow.position.set(0, 0.06, 0.05);
  root.add(brow);

  for (const sx of [-0.055, 0.055]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.02, 24), visorMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(sx, 0.012, 0.108);
    root.add(lens);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.028, 20),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.35 }),
    );
    glow.position.set(sx, 0.012, 0.12);
    root.add(glow);
  }

  const camL = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.02), accent);
  camL.position.set(-0.11, 0.045, 0.1);
  root.add(camL);
  const camR = camL.clone();
  camR.position.x = 0.11;
  root.add(camR);

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 10, 28, Math.PI * 1.15), strap);
  band.rotation.y = Math.PI / 2;
  band.rotation.z = Math.PI;
  band.position.set(0, 0.0, -0.02);
  root.add(band);

  return root;
}

function buildBootLogoMark() {
  const group = new THREE.Group();
  group.name = "bootLogoMark";
  group.renderOrder = BOOT_SPLASH_RENDER_ORDER.logo;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.072, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      alphaTest: 0.08,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }),
  );
  disc.name = "bootLogoDisc";
  disc.renderOrder = BOOT_SPLASH_RENDER_ORDER.logo;
  group.add(disc);
  try {
    const loader = new THREE.TextureLoader();
    loader.load("/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1", (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      disc.material.map = tex;
      disc.material.needsUpdate = true;
    });
  } catch (_) {}
  group.position.set(LOGO.x, LOGO.y, LOGO.z + 0.04);
  return group;
}

export function mountBootHeadsetScene(opts = {}) {
  if (typeof document !== "undefined" && document.body?.classList?.contains("xr-presenting")) {
    return null;
  }
  // Never open a second WebGL context before the studio viewport owns the GPU.
  if (!globalThis.__studioMainWebGlReady) {
    return null;
  }
  const screen = opts.root || document.getElementById("studio-boot-screen");
  if (!screen || screen.dataset.headsetScene === "1" || screen.dataset.headsetScene === "css") return null;
  const headsetOnly = document.documentElement.classList.contains("vr-headset-browser")
    || screen.classList.contains("studio-boot-screen--headset");
  if (!headsetOnly) return null;
  const cssLogo = document.getElementById("studio-boot-logo-center");
  if (cssLogo && opts.forceWebgl !== true) {
    screen.dataset.headsetScene = "css";
    return { cssOnly: true };
  }
  const host = opts.stage
    || document.getElementById("studio-boot-vr-anim")
    || document.getElementById("studio-boot-headset-host")
    || screen.querySelector(".studio-boot-stage");
  if (!host) return null;
  screen.dataset.headsetScene = "1";

  const wrap = document.createElement("div");
  wrap.className = "studio-boot-headset-scene";
  wrap.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.className = "studio-boot-headset-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Render Studio mark");
  wrap.appendChild(canvas);
  const scale = host.querySelector(".studio-boot-vr-anim-scale");
  if (scale) scale.insertBefore(wrap, scale.firstChild);
  else host.insertBefore(wrap, host.firstChild);
  host.classList.add("is-webgl");

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.sortObjects = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 12);
  camera.position.set(0, 0.04, 0.95);
  scene.environment = makeSteelCubeEnv();

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1a120c, 0.7));
  const fill = new THREE.DirectionalLight(0xffffff, 1.15);
  fill.position.set(0.55, 0.9, 1.1);
  scene.add(fill);
  const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.45);
  rimLight.position.set(-0.8, 0.2, 0.4);
  scene.add(rimLight);

  const headset = buildQuestHeadset();
  headset.position.set(HEADSET.x, HEADSET.y, HEADSET.z);
  scene.add(headset);

  const gear = buildMetalGear();
  scene.add(gear);
  const electricity = buildGearElectricity();
  scene.add(electricity);

  const logo = buildBootLogoMark();
  scene.add(logo);
  gear.visible = false;
  electricity.visible = false;

  const logoTarget = new THREE.Object3D();
  logoTarget.position.set(LOGO.x, LOGO.y, LOGO.z);
  scene.add(logoTarget);

  const aim = headsetSpotlightTarget(HEADSET, LOGO);
  const visorSpot = new THREE.SpotLight(0x9ad1ff, 8, 3.2, 0.28, 0.4, 1.1);
  visorSpot.position.set(HEADSET.x, HEADSET.y + 0.02, HEADSET.z + 0.08);
  visorSpot.target = logoTarget;
  visorSpot.castShadow = false;
  scene.add(visorSpot);

  const laserTarget = new THREE.Object3D();
  scene.add(laserTarget);
  const laser = new THREE.SpotLight(0xc4e4ff, 0, 4.4, 0.2, 0.35, 1);
  laser.name = "bootLaserFlashlight";
  laser.target = laserTarget;
  laser.castShadow = false;
  scene.add(laser);

  let rotY = 0.2;
  let raf = 0;
  let dead = false;
  let lastW = 0;
  let lastH = 0;
  let holdStart = 0;
  let aimingLogo = false;
  let pointerHeld = false;
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  function sizeToStage() {
    const w = Math.max(80, host.clientWidth || 160);
    const h = Math.max(80, host.clientHeight || 140);
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function pointerToRay(ev) {
    const rect = canvas.getBoundingClientRect();
    const rw = Math.max(rect.width, 1);
    const rh = Math.max(rect.height, 1);
    ndc.x = ((ev.clientX - rect.left) / rw) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rh) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }

  function aimFlashlight(ev) {
    const ray = pointerToRay(ev);
    const flash = flashlightFromRay(ray.origin, ray.direction, { distance: 1.6 });
    laser.position.set(flash.position.x, flash.position.y, flash.position.z);
    laserTarget.position.set(flash.target.x, flash.target.y, flash.target.z);
    laser.intensity = 14;
    const hits = raycaster.intersectObject(logo, true);
    aimingLogo = hits.length > 0;
    if (aimingLogo) laser.intensity = 22;
  }

  function onPointerMove(ev) {
    aimFlashlight(ev);
  }
  function onPointerDown(ev) {
    pointerHeld = true;
    holdStart = performance.now();
    aimingLogo = !!ev.target?.closest?.("#studio-boot-logo-center, .studio-boot-logo-mark");
    aimFlashlight(ev);
    if (!aimingLogo) aimingLogo = true;
  }
  function onPointerUp() {
    pointerHeld = false;
    holdStart = 0;
    aimingLogo = false;
    laser.intensity = 0;
  }

  const logoEl = document.getElementById("studio-boot-logo-center") || screen;
  logoEl.addEventListener("pointerdown", onPointerDown);
  logoEl.addEventListener("pointerup", onPointerUp);
  logoEl.addEventListener("pointerleave", onPointerUp);
  screen.addEventListener("pointermove", onPointerMove);

  function splashBlocked() {
    try {
      return !!(
        screen.classList.contains("is-done")
        || screen.hidden
        || screen.getAttribute("aria-hidden") === "true"
        || document.body.classList.contains("xr-presenting")
      );
    } catch {
      return true;
    }
  }

  function tick() {
    if (dead) return;
    if (!shouldRunBootSplashRaf({
      splashHidden: splashBlocked(),
      presenting: document.body.classList.contains("xr-presenting"),
    })) {
      raf = 0;
      try { renderer.setAnimationLoop?.(null); } catch (_) {}
      return;
    }
    raf = requestAnimationFrame(tick);
    rotY += 0.003;
    headset.rotation.y = rotY;
    const now = performance.now();
    gear.rotation.z -= 0.012;
    electricity.rotation.z += 0.045;
    electricity.rotation.x = Math.sin(now * 0.002) * 0.18;
    electricity.rotation.y = Math.cos(now * 0.0016) * 0.12;
    logo.rotation.y = Math.sin(now * 0.0012) * 0.18;
    visorSpot.position.set(HEADSET.x, HEADSET.y + 0.02, HEADSET.z + 0.08);
    renderer.render(scene, camera);
  }

  function maybeResumeSplash() {
    if (dead || raf) return;
    if (shouldRunBootSplashRaf({
      splashHidden: splashBlocked(),
      presenting: document.body.classList.contains("xr-presenting"),
    })) {
      tick();
    }
  }

  function dispose() {
    dead = true;
    cancelAnimationFrame(raf);
    logoEl.removeEventListener("pointerdown", onPointerDown);
    logoEl.removeEventListener("pointerup", onPointerUp);
    logoEl.removeEventListener("pointerleave", onPointerUp);
    screen.removeEventListener("pointermove", onPointerMove);
    try { renderer.dispose(); } catch (_) {}
    wrap.remove();
  }

  sizeToStage();
  window.addEventListener("resize", sizeToStage, { passive: true });
  tick();

  const obs = new MutationObserver(() => {
    if (screen.classList.contains("is-done") || !document.body.contains(screen)) {
      obs.disconnect();
      try { bodyObs.disconnect(); } catch (_) {}
      dispose();
      return;
    }
    maybeResumeSplash();
  });
  obs.observe(screen, { attributes: true, attributeFilter: ["class", "hidden", "aria-hidden"] });
  const bodyObs = new MutationObserver(() => {
    if (document.body.classList.contains("xr-presenting")) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      dispose();
      try { bodyObs.disconnect(); } catch (_) {}
      try { obs.disconnect(); } catch (_) {}
    }
  });
  try { bodyObs.observe(document.body, { attributes: true, attributeFilter: ["class"] }); } catch (_) {}

  return { dispose, canvas, spotlight: visorSpot, laser, aim, headset, logo, gear, electricity };
}

if (typeof window !== "undefined") {
  window.__mountBootHeadsetScene = mountBootHeadsetScene;
}
