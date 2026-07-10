/**
 * Jake-style planetary gear mesh playback for Render3D rigging Play.
 *
 * Upstream text-to-cad drives this via `.step.js` parameter modules
 * (see planetary_gear_assembly.step.js). We mirror that kinematics on the
 * loaded GLB part meshes when the user hits Play in Rigging.
 */

import * as THREE from "three";

const SUN_TEETH = 24;
const PLANET_TEETH = 18;
const RING_TEETH = 60;
const CARRIER_RATIO = SUN_TEETH / (SUN_TEETH + RING_TEETH);
const FULL_MESH_CYCLE_DEG = 1260;
const DEFAULT_DURATION_SEC = 6;

function normName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isDecor(obj) {
  return !!(obj?.userData?.isSilhouette || obj?.userData?.isEdge);
}

function findNamedObject(root, candidates) {
  if (!root) return null;
  const wanted = new Set(candidates.map(normName));
  let found = null;
  root.traverse((obj) => {
    if (found || isDecor(obj)) return;
    const name = normName(obj.name || obj.userData?.name || obj.userData?.partId);
    if (wanted.has(name)) found = obj;
  });
  if (found) return found;
  root.traverse((obj) => {
    if (found || isDecor(obj)) return;
    const name = normName(obj.name || obj.userData?.name || obj.userData?.partId);
    for (const w of wanted) {
      if (w && name.includes(w)) {
        found = obj;
        return;
      }
    }
  });
  return found;
}

export function detectPlanetaryGearAssembly(root) {
  if (!root) return null;
  const sun = findNamedObject(root, ["sun", "sun_gear"]);
  const ring = findNamedObject(root, ["ring", "ring_gear"]);
  const carrier = findNamedObject(root, ["carrier", "carrier_plate"]);
  const planets = [1, 2, 3]
    .map((i) => findNamedObject(root, [`planet_${i}`, `planet${i}`, `planet_gear_${i}`]))
    .filter(Boolean);
  const pins = [1, 2, 3]
    .map((i) => findNamedObject(root, [`pin_${i}`, `pin${i}`, `planet_pin_${i}`]))
    .filter(Boolean);
  if (!sun || planets.length < 2) return null;
  return { sun, ring, carrier, planets, pins, root };
}

function captureRest(obj) {
  obj.updateMatrixWorld(true);
  return {
    obj,
    restPos: obj.position.clone(),
    restQuat: obj.quaternion.clone(),
    restScale: obj.scale.clone(),
    // World-space center at rest (for orbit math).
    restWorldPos: new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld),
  };
}

/**
 * Apply Jake fixed-ring planetary kinematics at drive angle (degrees).
 * Gear axes are +Z after Render3D's Y-up → Z-up GLB conversion.
 */
function applyDrive(parts, driveDeg, { explode = 0 } = {}) {
  const sunAngle = Number(driveDeg) || 0;
  const carrierAngle = sunAngle * CARRIER_RATIO;
  const planetSpin = -(SUN_TEETH / PLANET_TEETH) * (sunAngle - carrierAngle);
  const sunRad = THREE.MathUtils.degToRad(sunAngle);
  const carrierRad = THREE.MathUtils.degToRad(carrierAngle);
  const planetSpinRad = THREE.MathUtils.degToRad(planetSpin);
  const zAxis = new THREE.Vector3(0, 0, 1);

  function setSpinInPlace(binding, angleRad) {
    if (!binding) return;
    const { obj, restPos, restQuat, restScale } = binding;
    obj.position.copy(restPos);
    obj.scale.copy(restScale);
    obj.quaternion.copy(restQuat).multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, angleRad));
    obj.updateMatrixWorld(true);
  }

  function setOrbitAndSpin(binding, orbitRad, spinRad, radialExplode = 0) {
    if (!binding) return;
    const { obj, restPos, restQuat, restScale } = binding;
    const orbitQ = new THREE.Quaternion().setFromAxisAngle(zAxis, orbitRad);
    const spinQ = new THREE.Quaternion().setFromAxisAngle(zAxis, spinRad);
    const pos = restPos.clone().applyQuaternion(orbitQ);
    if (radialExplode) {
      const radial = new THREE.Vector3(pos.x, pos.y, 0);
      if (radial.lengthSq() > 1e-12) {
        radial.normalize().multiplyScalar(radialExplode);
        pos.add(radial);
      }
    }
    obj.position.copy(pos);
    obj.scale.copy(restScale);
    // Orbit frame, then rest tooth phase, then relative planet spin.
    obj.quaternion.copy(orbitQ).multiply(restQuat).multiply(spinQ);
    obj.updateMatrixWorld(true);
  }

  setSpinInPlace(parts.sun, sunRad);
  setSpinInPlace(parts.carrier, carrierRad);
  // Ring stays fixed (Jake fixed-ring stage).
  for (const planet of parts.planets || []) {
    setOrbitAndSpin(planet, carrierRad, planetSpinRad, explode * 0.016);
  }
  for (const pin of parts.pins || []) {
    setOrbitAndSpin(pin, carrierRad, 0, explode * 0.016);
  }
}

export function createPlanetaryGearRuntime({ getRoot } = {}) {
  let bindings = null;
  let playing = false;
  let raf = 0;
  let startedAt = 0;
  let durationSec = DEFAULT_DURATION_SEC;

  function resolveRoot() {
    return typeof getRoot === "function" ? getRoot() : getRoot;
  }

  function bind(root = resolveRoot()) {
    stop({ reset: true });
    const detected = detectPlanetaryGearAssembly(root);
    if (!detected) {
      bindings = null;
      return 0;
    }
    bindings = {
      sun: detected.sun ? captureRest(detected.sun) : null,
      ring: detected.ring ? captureRest(detected.ring) : null,
      carrier: detected.carrier ? captureRest(detected.carrier) : null,
      planets: detected.planets.map(captureRest),
      pins: detected.pins.map(captureRest),
      root: detected.root,
    };
    return 1 + bindings.planets.length + (bindings.carrier ? 1 : 0);
  }

  function reset() {
    if (!bindings) return;
    for (const key of ["sun", "ring", "carrier"]) {
      const b = bindings[key];
      if (!b) continue;
      b.obj.position.copy(b.restPos);
      b.obj.quaternion.copy(b.restQuat);
      b.obj.scale.copy(b.restScale);
    }
    for (const list of [bindings.planets, bindings.pins]) {
      for (const b of list || []) {
        b.obj.position.copy(b.restPos);
        b.obj.quaternion.copy(b.restQuat);
        b.obj.scale.copy(b.restScale);
      }
    }
  }

  function setDrive(driveDeg, opts) {
    if (!bindings) bind();
    if (!bindings) return false;
    applyDrive(bindings, driveDeg, opts);
    return true;
  }

  function tick(now) {
    if (!playing || !bindings) return;
    const elapsed = (now - startedAt) / 1000;
    const cycle = (elapsed / durationSec) % 1;
    const drive = cycle * FULL_MESH_CYCLE_DEG;
    applyDrive(bindings, drive, { explode: 0 });
    raf = requestAnimationFrame(tick);
  }

  function play({ duration = DEFAULT_DURATION_SEC } = {}) {
    if (!bindings) bind();
    if (!bindings) return false;
    durationSec = Math.max(1, Number(duration) || DEFAULT_DURATION_SEC);
    playing = true;
    startedAt = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    return true;
  }

  function stop({ reset: doReset = false } = {}) {
    playing = false;
    cancelAnimationFrame(raf);
    raf = 0;
    if (doReset) reset();
  }

  function togglePlay() {
    if (playing) {
      stop({ reset: false });
      return false;
    }
    return play();
  }

  return {
    bind,
    detect: () => detectPlanetaryGearAssembly(resolveRoot()),
    isBound: () => !!bindings,
    isPlaying: () => playing,
    play,
    stop,
    togglePlay,
    setDrive,
    reset,
    getPartCount: () =>
      bindings
        ? 1 +
          (bindings.carrier ? 1 : 0) +
          (bindings.ring ? 1 : 0) +
          bindings.planets.length +
          bindings.pins.length
        : 0,
  };
}
