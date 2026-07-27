/**
 * Jake-compatible STEP parameter module runtime for Render Studio.
 *
 * Motion is not inferred from mesh names. Jake (and this runtime) only animate
 * when a sidecar `.<stem>.step.js` module exists beside the STEP/GLB. The module
 * declares features, parameters, animations, and an update() that drives
 * effects.transform / visible / style.
 *
 * See backend/skills/cad/references/parameters.md and
 * tmp_jake_text_to_cad docs/public/hero/*.step.js.
 */

import * as THREE from "three";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

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

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v || "").trim()).filter(Boolean))];
}

function normalizePoint(value, fallback = [0, 0, 0]) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [toNumber(value[0], fallback[0]), toNumber(value[1], fallback[1]), toNumber(value[2], fallback[2])];
  }
  if (value && typeof value === "object") {
    return [toNumber(value.x, fallback[0]), toNumber(value.y, fallback[1]), toNumber(value.z, fallback[2])];
  }
  return [...fallback];
}

function buildRotateMatrix(spec = {}) {
  const axis = new THREE.Vector3(...normalizePoint(spec.axis, [0, 0, 1]));
  if (axis.lengthSq() <= 1e-12) axis.set(0, 0, 1);
  axis.normalize();
  const origin = new THREE.Vector3(...normalizePoint(spec.origin, [0, 0, 0]));
  const angleRad = Number.isFinite(Number(spec.angleRad))
    ? Number(spec.angleRad)
    : (toNumber(spec.angleDeg, 0) * Math.PI) / 180;
  return new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angleRad))
    .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
}

function buildScaleMatrix(spec = {}) {
  const raw = spec.scale ?? spec;
  const scale = Array.isArray(raw) || ArrayBuffer.isView(raw)
    ? normalizePoint(raw, [1, 1, 1])
    : [toNumber(raw, 1), toNumber(raw, 1), toNumber(raw, 1)];
  const origin = new THREE.Vector3(...normalizePoint(spec.origin, [0, 0, 0]));
  return new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]))
    .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
}

function buildTranslateMatrix(value) {
  const t = normalizePoint(value, [0, 0, 0]);
  return new THREE.Matrix4().makeTranslation(t[0], t[1], t[2]);
}

function buildSingleEffectMatrix(spec = {}) {
  if (!spec || typeof spec !== "object") return new THREE.Matrix4();
  if (Array.isArray(spec.matrix) && spec.matrix.length === 16) {
    return new THREE.Matrix4().fromArray(spec.matrix.map((v) => toNumber(v, 0)));
  }
  const matrix = new THREE.Matrix4();
  if (spec.scale !== undefined) matrix.premultiply(buildScaleMatrix(spec));
  if (spec.rotate && typeof spec.rotate === "object") matrix.premultiply(buildRotateMatrix(spec.rotate));
  if (spec.translate !== undefined) matrix.premultiply(buildTranslateMatrix(spec.translate));
  return matrix;
}

function buildEffectMatrix(spec = {}) {
  if (!spec || typeof spec !== "object") return new THREE.Matrix4();
  const steps = Array.isArray(spec.transforms) ? spec.transforms : [spec];
  const matrix = new THREE.Matrix4();
  for (const step of steps) matrix.premultiply(buildSingleEffectMatrix(step));
  return matrix;
}

function findNamedObject(root, candidates) {
  if (!root) return null;
  const wanted = new Set(candidates.map(normName).filter(Boolean));
  if (!wanted.size) return null;
  let found = null;
  root.traverse((obj) => {
    if (found || isDecor(obj)) return;
    const name = normName(obj.name || obj.userData?.name || obj.userData?.partId || obj.userData?.label);
    if (wanted.has(name)) found = obj;
  });
  if (found) return found;
  root.traverse((obj) => {
    if (found || isDecor(obj)) return;
    const name = normName(obj.name || obj.userData?.name || obj.userData?.partId || obj.userData?.label);
    for (const w of wanted) {
      if (w && (name === w || name.endsWith(`_${w}`) || name.includes(w))) {
        found = obj;
        return;
      }
    }
  });
  return found;
}

function centerInRoot(obj, root) {
  if (!obj || !root) return [0, 0, 0];
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) {
    const p = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    root.worldToLocal(p);
    return [p.x, p.y, p.z];
  }
  const c = box.getCenter(new THREE.Vector3());
  root.worldToLocal(c);
  return [c.x, c.y, c.z];
}

function captureBinding(obj) {
  obj.updateMatrixWorld(true);
  return {
    obj,
    restPos: obj.position.clone(),
    restQuat: obj.quaternion.clone(),
    restScale: obj.scale.clone(),
    restMatrix: obj.matrix.clone(),
  };
}

function applyBindingMatrix(binding, effectMatrix) {
  if (!binding?.obj) return;
  const { obj, restPos, restQuat, restScale } = binding;
  obj.position.copy(restPos);
  obj.quaternion.copy(restQuat);
  obj.scale.copy(restScale);
  obj.updateMatrix();
  if (effectMatrix) {
    obj.applyMatrix4(effectMatrix);
  }
  obj.updateMatrixWorld(true);
}

function defaultParamValue(def) {
  const type = String(def?.type || "number").toLowerCase();
  if (type === "boolean") return def?.default === true;
  if (type === "select" || type === "enum") {
    const opts = Array.isArray(def?.options) ? def.options : [];
    const first = opts[0];
    const v = typeof first === "object" ? first?.value : first;
    return def?.default ?? def?.defaultValue ?? v ?? "";
  }
  if (type === "color") return String(def?.default || "#ffffff");
  if (type === "string") return String(def?.default ?? "");
  return toNumber(def?.default ?? def?.defaultValue, 0);
}

function normalizeParamValue(def, value) {
  const type = String(def?.type || "number").toLowerCase();
  if (type === "boolean") return value === true;
  if (type === "select" || type === "enum") return String(value ?? defaultParamValue(def));
  if (type === "color" || type === "string") return String(value ?? "");
  const min = toNumber(def?.min, Number.NEGATIVE_INFINITY);
  const max = toNumber(def?.max, Number.POSITIVE_INFINITY);
  return clamp(toNumber(value, defaultParamValue(def)), min, max);
}

/**
 * Candidate sidecar names for a model file (Jake convention).
 * foo.step / foo.glb → .foo.step.js
 */
export function stepModuleCandidateNames(filename) {
  const safe = String(filename || "").split("/").pop() || "";
  if (!safe) return [];
  const lower = safe.toLowerCase();
  const names = new Set();
  if (/\.step\.js$/i.test(safe)) {
    names.add(safe.startsWith(".") ? safe : `.${safe}`);
    return [...names];
  }
  if (lower.endsWith(".step") || lower.endsWith(".stp")) {
    names.add(`.${safe}.js`);
    names.add(`.${safe.replace(/\.(step|stp)$/i, "")}.step.js`);
  } else {
    const stem = safe.replace(/\.[^.]+$/, "");
    names.add(`.${stem}.step.js`);
    names.add(`.${stem}.step.stp.js`);
  }
  return [...names];
}

export function createStepModuleRuntime({
  getRoot,
  getProjectId,
  getFilename,
  authHeaders = () => ({}),
  requestRender = () => {},
} = {}) {
  let moduleUrl = null;
  let moduleName = null;
  let rawModule = null;
  let manifest = null;
  let parameterDefs = {};
  let params = {};
  let animations = {};
  let activeAnimationId = null;
  let root = null;
  let featureBindings = new Map(); // id -> binding
  let featureState = {}; // id -> { center, label, ... }
  let playing = false;
  let raf = 0;
  let startedAt = 0;
  let elapsedSec = 0;
  let cleanups = [];
  let loadPromise = null;
  let loadKey = "";

  function runCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try {
        fn?.();
      } catch (err) {
        console.warn("step-module cleanup failed", err);
      }
    }
  }

  function resetBindings() {
    for (const binding of featureBindings.values()) {
      applyBindingMatrix(binding, null);
    }
  }

  function resolveFeatureTargets(target) {
    if (Array.isArray(target)) {
      return uniqueStrings(target.flatMap((t) => resolveFeatureTargets(t)));
    }
    if (target && typeof target === "object") {
      if (Array.isArray(target.partIds)) return uniqueStrings(target.partIds);
      if (target.partId) return uniqueStrings([target.partId]);
      if (target.feature) return resolveFeatureTargets(target.feature);
      if (target.ref) return resolveFeatureTargets(String(target.ref));
    }
    const id = String(target || "").trim();
    if (!id) return [];
    if (id === "*" || id === "all" || id === "__all__") return [...featureBindings.keys()];
    if (featureBindings.has(id) || featureState[id]) return [id];
    // Soft match normalized names
    const want = normName(id);
    for (const key of featureBindings.keys()) {
      if (normName(key) === want) return [key];
    }
    return [id];
  }

  function createEffectsApi(effectsById) {
    const ensure = (id) => {
      const key = String(id || "").trim();
      if (!key) return null;
      let cur = effectsById.get(key);
      if (!cur) {
        cur = { matrix: null, style: null, visible: null, highlighted: false };
        effectsById.set(key, cur);
      }
      return cur;
    };
    const forEach = (target, cb) => {
      for (const id of resolveFeatureTargets(target)) {
        const effect = ensure(id);
        if (effect) cb(effect, id);
      }
    };
    return {
      transform(target, spec) {
        const matrix = buildEffectMatrix(spec);
        forEach(target, (effect) => {
          effect.matrix = effect.matrix ? effect.matrix.clone().premultiply(matrix) : matrix.clone();
        });
      },
      style(target, style = {}) {
        if (!style || typeof style !== "object") return;
        forEach(target, (effect) => {
          effect.style = { ...(effect.style || {}), ...style };
        });
      },
      visible(target, visible = true) {
        forEach(target, (effect) => {
          effect.visible = visible !== false;
        });
      },
      highlight(target, highlighted = true) {
        forEach(target, (effect) => {
          effect.highlighted = highlighted !== false;
        });
      },
      clear(target) {
        for (const id of resolveFeatureTargets(target)) effectsById.delete(id);
      },
    };
  }

  function applyStyles(binding, effect) {
    if (!binding?.obj || !effect) return;
    const style = effect.style;
    const visible = effect.visible;
    binding.obj.traverse((child) => {
      if (!child.isMesh || isDecor(child)) return;
      if (visible !== null && visible !== undefined) child.visible = visible !== false;
      const mats = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      for (const mat of mats) {
        if (!mat) continue;
        if (!mat.userData) mat.userData = {};
        if (mat.userData._stepModuleStyleBackup == null) {
          mat.userData._stepModuleStyleBackup = {
            opacity: mat.opacity,
            transparent: mat.transparent,
            emissive: mat.emissive?.clone?.() || null,
            emissiveIntensity: mat.emissiveIntensity,
          };
        }
        const backup = mat.userData._stepModuleStyleBackup;
        if (!style) {
          mat.opacity = backup.opacity;
          mat.transparent = backup.transparent;
          if (mat.emissive && backup.emissive) mat.emissive.copy(backup.emissive);
          if (backup.emissiveIntensity != null) mat.emissiveIntensity = backup.emissiveIntensity;
          continue;
        }
        if (style.opacity != null) {
          mat.opacity = toNumber(style.opacity, 1);
          mat.transparent = mat.opacity < 0.999;
        }
        if (style.emissive) {
          if (!mat.emissive) mat.emissive = new THREE.Color();
          mat.emissive.set(style.emissive);
        } else if (style.emissive === "" && mat.emissive && backup.emissive) {
          mat.emissive.copy(backup.emissive);
        }
        if (style.emissiveIntensity != null) {
          mat.emissiveIntensity = toNumber(style.emissiveIntensity, 0);
        }
      }
    });
  }

  function buildFeaturesForUpdate() {
    const out = {};
    for (const [id, state] of Object.entries(featureState)) {
      out[id] = { ...state };
    }
    return out;
  }

  function setParam(id, value) {
    const def = parameterDefs[id];
    params[id] = def ? normalizeParamValue(def, value) : value;
  }

  function tickFrame(now) {
    if (!playing || !rawModule) return;
    const anim = animations[activeAnimationId] || Object.values(animations)[0];
    const duration = Math.max(toNumber(anim?.duration, 1), 0.001);
    const loop = anim?.loop !== false;
    elapsedSec = (now - startedAt) / 1000;
    let progress = elapsedSec / duration;
    let cycle = progress;
    if (loop) {
      progress = progress % 1;
      cycle = elapsedSec / duration;
    } else {
      progress = clamp(progress, 0, 1);
      cycle = progress;
      if (progress >= 1) {
        playing = false;
        syncUpdate({ progress, cycle, playing: false });
        requestRender();
        return;
      }
    }
    if (typeof anim?.update === "function") {
      try {
        anim.update({
          progress,
          cycle,
          elapsed: elapsedSec,
          elapsedSec,
          duration,
          playing: true,
          set: setParam,
          params,
        });
      } catch (err) {
        console.warn("step-module animation update failed", err);
      }
    }
    syncUpdate({ progress, cycle, playing: true, duration, elapsedSec });
    requestRender();
    raf = requestAnimationFrame(tickFrame);
  }

  function syncUpdate(timeState = {}) {
    if (!rawModule || typeof rawModule.update !== "function") return;
    const effectsById = new Map();
    const effects = createEffectsApi(effectsById);
    const features = buildFeaturesForUpdate();
    const duration = Math.max(toNumber(timeState.duration, 1), 0.001);
    const elapsed = toNumber(timeState.elapsedSec, elapsedSec);
    const time = {
      elapsed,
      elapsedSec: elapsed,
      duration,
      progress: timeState.progress != null ? timeState.progress : clamp(elapsed / duration, 0, 1),
      cycle: timeState.cycle != null ? timeState.cycle : elapsed / duration,
      playing: timeState.playing === true || playing,
      speed: 1,
    };
    try {
      rawModule.update({ params: { ...params }, features, effects, time, THREE, modelGroup: root });
    } catch (err) {
      console.warn("step-module update failed", err);
      return;
    }
    for (const [id, binding] of featureBindings.entries()) {
      const effect = effectsById.get(id);
      applyBindingMatrix(binding, effect?.matrix || null);
      applyStyles(binding, effect || {});
    }
  }

  function bindFeatures(nextRoot) {
    root = nextRoot;
    featureBindings = new Map();
    featureState = {};
    const featureDefs = manifest?.features && typeof manifest.features === "object" ? manifest.features : {};
    for (const [id, def] of Object.entries(featureDefs)) {
      const label = def?.label || id;
      const obj = findNamedObject(root, [id, label, def?.partId, ...(Array.isArray(def?.partIds) ? def.partIds : [])]);
      if (!obj) continue;
      const binding = captureBinding(obj);
      featureBindings.set(id, binding);
      const origin = Array.isArray(def?.origin) ? normalizePoint(def.origin) : centerInRoot(obj, root);
      featureState[id] = {
        id,
        label,
        description: def?.description || "",
        ref: def?.ref || "",
        center: origin,
        origin,
        axis: Array.isArray(def?.axis) ? normalizePoint(def.axis, [0, 0, 1]) : [0, 0, 1],
        partIds: [id],
        missing: false,
      };
    }
    return featureBindings.size;
  }

  function ingestModule(mod, { url = "", name = "" } = {}) {
    rawModule = mod?.default && typeof mod.default === "object" ? mod.default : mod;
    if (!rawModule || typeof rawModule !== "object") {
      throw new Error("STEP module must export an object");
    }
    manifest = rawModule.manifest && typeof rawModule.manifest === "object" ? rawModule.manifest : rawModule;
    parameterDefs = {};
    params = {};
    const rawParams = manifest.parameters && typeof manifest.parameters === "object" ? manifest.parameters : {};
    for (const [id, def] of Object.entries(rawParams)) {
      parameterDefs[id] = def || {};
      params[id] = defaultParamValue(def);
    }
    animations = {};
    const rawAnims = manifest.animations && typeof manifest.animations === "object" ? manifest.animations : {};
    for (const [id, def] of Object.entries(rawAnims)) {
      animations[id] = {
        id,
        label: def?.label || id,
        duration: Math.max(toNumber(def?.duration ?? def?.durationSeconds, 1), 0.001),
        loop: def?.loop !== false,
        update: typeof def?.update === "function" ? def.update : null,
      };
    }
    activeAnimationId = Object.keys(animations)[0] || null;
    moduleUrl = url;
    moduleName = name;
  }

  async function discoverAndLoad() {
    const projectId = getProjectId?.();
    const filename = getFilename?.();
    if (!projectId || !filename) return false;
    const key = `${projectId}::${filename}`;
    if (loadPromise && loadKey === key && rawModule) return true;
    loadKey = key;
    loadPromise = (async () => {
      const headers = { ...(authHeaders() || {}) };
      const metaRes = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(filename)}/step-module`,
        { headers }
      );
      if (!metaRes.ok) {
        rawModule = null;
        moduleUrl = null;
        moduleName = null;
        return false;
      }
      const meta = await metaRes.json();
      const url = meta.url || `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(meta.module)}`;
      // Cache-bust so regenerated sidecars reload.
      const bust = `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(meta.mtime || Date.now())}`;
      const mod = await import(/* @vite-ignore */ bust);
      ingestModule(mod, { url: bust, name: meta.module });
      return true;
    })();
    try {
      return await loadPromise;
    } catch (err) {
      console.warn("Failed to load STEP module", err);
      rawModule = null;
      return false;
    }
  }

  function setupModule() {
    runCleanups();
    if (!rawModule || !root) return;
    if (typeof rawModule.setup === "function") {
      try {
        rawModule.setup({
          THREE,
          modelGroup: root,
          scene: root?.parent || null,
          params: { ...params },
          features: buildFeaturesForUpdate(),
          manifest: manifest || {},
          cleanup: (fn) => {
            if (typeof fn === "function") cleanups.push(fn);
          },
          requestRender,
        });
      } catch (err) {
        console.warn("step-module setup failed", err);
      }
    }
  }

  return {
    async ensureLoaded() {
      return discoverAndLoad();
    },
    hasModule() {
      return !!rawModule;
    },
    moduleName() {
      return moduleName;
    },
    isBound() {
      return featureBindings.size > 0;
    },
    isPlaying() {
      return playing;
    },
    featureCount() {
      return featureBindings.size;
    },
    animationIds() {
      return Object.keys(animations);
    },
    async bind(nextRoot = getRoot?.()) {
      const ok = await discoverAndLoad();
      if (!ok || !nextRoot) return 0;
      const n = bindFeatures(nextRoot);
      setupModule();
      syncUpdate({ playing: false, progress: 0, cycle: 0 });
      requestRender();
      return n;
    },
    stop({ reset = true } = {}) {
      playing = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (reset) {
        // Reset params to defaults and rest pose
        for (const [id, def] of Object.entries(parameterDefs)) {
          params[id] = defaultParamValue(def);
        }
        elapsedSec = 0;
        resetBindings();
        syncUpdate({ playing: false, progress: 0, cycle: 0 });
      }
      requestRender();
    },
    play(animationId = null) {
      if (!rawModule) return false;
      if (!featureBindings.size) {
        const n = bindFeatures(getRoot?.() || root);
        if (!n) return false;
        setupModule();
      }
      if (animationId && animations[animationId]) activeAnimationId = animationId;
      if (!activeAnimationId) activeAnimationId = Object.keys(animations)[0] || null;
      if (!activeAnimationId && typeof rawModule.update === "function") {
        // Module with update but no animations: nudge a drive-like param if present
        activeAnimationId = "__implicit__";
        animations.__implicit__ = {
          id: "__implicit__",
          duration: 6,
          loop: true,
          update: ({ cycle, set }) => {
            if ("drive" in params) set("drive", (cycle % 1) * toNumber(parameterDefs.drive?.max, 360));
            else if ("angle" in params) set("angle", (cycle % 1) * toNumber(parameterDefs.angle?.max, 360));
            else if ("hinge_angle_deg" in params) {
              set("hinge_angle_deg", (cycle % 1) * toNumber(parameterDefs.hinge_angle_deg?.max, 90));
            }
          },
        };
      }
      if (!activeAnimationId) return false;
      playing = true;
      startedAt = performance.now() - elapsedSec * 1000;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tickFrame);
      return true;
    },
    togglePlay() {
      if (playing) {
        this.stop({ reset: false });
        return false;
      }
      return this.play();
    },
    dispose() {
      this.stop({ reset: true });
      runCleanups();
      if (typeof rawModule?.dispose === "function") {
        try {
          rawModule.dispose({ THREE, modelGroup: root });
        } catch {
          /* ignore */
        }
      }
      rawModule = null;
      featureBindings = new Map();
      featureState = {};
      root = null;
    },
  };
}
