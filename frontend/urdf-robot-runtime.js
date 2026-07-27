/** Jake-style URDF/SRDF robot runtime for Render Studio's Three.js viewport. */

import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function asNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseNumberList(value, count, fallback) {
  if (typeof value !== "string" || !value.trim()) return [...fallback];
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) return [...fallback];
  return parts;
}

function childElements(parent, tag) {
  const want = String(tag || "").toLowerCase();
  return Array.from(parent?.children || []).filter(
    (node) => String(node.tagName || "").toLowerCase() === want,
  );
}

function translation(x, y, z) {
  return [1, 0, 0, asNum(x), 0, 1, 0, asNum(y), 0, 0, 1, asNum(z), 0, 0, 0, 1];
}

function rotationRpy(roll, pitch, yaw) {
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return [
    cy * cp, (cy * sp * sr) - (sy * cr), (cy * sp * cr) + (sy * sr), 0,
    sy * cp, (sy * sp * sr) + (cy * cr), (sy * sp * cr) - (cy * sr), 0,
    -sp, cp * sr, cp * cr, 0,
    0, 0, 0, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      let total = 0;
      for (let k = 0; k < 4; k += 1) total += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = total;
    }
  }
  return out;
}

function originTransform(originEl) {
  if (!originEl) return [...IDENTITY];
  const xyz = parseNumberList(originEl.getAttribute("xyz"), 3, [0, 0, 0]);
  const rpy = parseNumberList(originEl.getAttribute("rpy"), 3, [0, 0, 0]);
  return multiply(translation(...xyz), rotationRpy(...rpy));
}

function axisAngle(axis, angleRad) {
  const [x0, y0, z0] = axis;
  const len = Math.hypot(x0, y0, z0) || 1;
  const x = x0 / len;
  const y = y0 / len;
  const z = z0 / len;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const t = 1 - c;
  return [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s, 0,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s, 0,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t, 0,
    0, 0, 0, 1,
  ];
}

function matrixFromRowMajor(m) {
  const mat = new THREE.Matrix4();
  mat.set(
    m[0], m[1], m[2], m[3],
    m[4], m[5], m[6], m[7],
    m[8], m[9], m[10], m[11],
    m[12], m[13], m[14], m[15],
  );
  return mat;
}

function resolveMeshFilename(filename) {
  const raw = String(filename || "").trim();
  if (!raw) return "";
  const packageMatch = raw.match(/^package:\/\/[^/]+\/(.+)$/i);
  if (packageMatch) return packageMatch[1].split("/").pop();
  if (raw.startsWith("file://")) return raw.split("/").pop();
  return raw.split("/").pop();
}

export function parseUrdfXml(xmlText) {
  const doc = new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Failed to parse URDF XML");
  const robot = doc.documentElement;
  if (!robot || robot.tagName !== "robot") throw new Error("URDF root must be <robot>");

  const links = childElements(robot, "link").map((linkEl) => {
    const name = String(linkEl.getAttribute("name") || "").trim();
    const visuals = childElements(linkEl, "visual").map((visualEl, index) => {
      const geometryEl = childElements(visualEl, "geometry")[0];
      const meshEl = geometryEl ? childElements(geometryEl, "mesh")[0] : null;
      const boxEl = geometryEl ? childElements(geometryEl, "box")[0] : null;
      const cylEl = geometryEl ? childElements(geometryEl, "cylinder")[0] : null;
      const sphereEl = geometryEl ? childElements(geometryEl, "sphere")[0] : null;
      const colorEl = childElements(childElements(visualEl, "material")[0] || {}, "color")[0];
      const rgba = parseNumberList(colorEl?.getAttribute?.("rgba"), 4, [0.7, 0.7, 0.75, 1]);
      const localTransform = originTransform(childElements(visualEl, "origin")[0]);
      if (meshEl) {
        return {
          id: `${name}:v${index + 1}`,
          kind: "mesh",
          filename: resolveMeshFilename(meshEl.getAttribute("filename")),
          scale: parseNumberList(meshEl.getAttribute("scale"), 3, [1, 1, 1]),
          color: rgba,
          localTransform,
        };
      }
      if (boxEl) {
        return {
          id: `${name}:v${index + 1}`,
          kind: "box",
          size: parseNumberList(boxEl.getAttribute("size"), 3, [0.05, 0.05, 0.05]),
          color: rgba,
          localTransform,
        };
      }
      if (cylEl) {
        return {
          id: `${name}:v${index + 1}`,
          kind: "cylinder",
          radius: asNum(cylEl.getAttribute("radius"), 0.02),
          length: asNum(cylEl.getAttribute("length"), 0.05),
          color: rgba,
          localTransform,
        };
      }
      if (sphereEl) {
        return {
          id: `${name}:v${index + 1}`,
          kind: "sphere",
          radius: asNum(sphereEl.getAttribute("radius"), 0.02),
          color: rgba,
          localTransform,
        };
      }
      return {
        id: `${name}:v${index + 1}`,
        kind: "sphere",
        radius: 0.02,
        color: rgba,
        localTransform,
      };
    });
    return { name, visuals };
  });

  const joints = childElements(robot, "joint").map((jointEl) => {
    const name = String(jointEl.getAttribute("name") || "").trim();
    const type = String(jointEl.getAttribute("type") || "fixed").trim().toLowerCase();
    const parent = String(childElements(jointEl, "parent")[0]?.getAttribute("link") || "").trim();
    const child = String(childElements(jointEl, "child")[0]?.getAttribute("link") || "").trim();
    const axis = parseNumberList(childElements(jointEl, "axis")[0]?.getAttribute("xyz"), 3, [0, 0, 1]);
    const limitEl = childElements(jointEl, "limit")[0];
    const lower = asNum(limitEl?.getAttribute("lower"), type === "continuous" ? -Math.PI * 2 : -Math.PI);
    const upper = asNum(limitEl?.getAttribute("upper"), type === "continuous" ? Math.PI * 2 : Math.PI);
    return {
      name,
      type,
      parentLink: parent,
      childLink: child,
      axis,
      lower,
      upper,
      origin: originTransform(childElements(jointEl, "origin")[0]),
    };
  });

  const childLinks = new Set(joints.map((j) => j.childLink).filter(Boolean));
  const rootLink = links.map((l) => l.name).find((name) => !childLinks.has(name)) || links[0]?.name || "";

  return {
    name: String(robot.getAttribute("name") || "robot").trim() || "robot",
    rootLink,
    links,
    joints,
  };
}

export function parseSrdfXml(xmlText) {
  const doc = new DOMParser().parseFromString(String(xmlText || ""), "application/xml");
  if (doc.querySelector("parsererror")) return { groups: [], groupStates: [], endEffectors: [] };
  const root = doc.documentElement;
  if (!root || root.tagName !== "robot") return { groups: [], groupStates: [], endEffectors: [] };

  const groups = childElements(root, "group").map((groupEl) => ({
    name: String(groupEl.getAttribute("name") || "").trim(),
    joints: childElements(groupEl, "joint").map((j) => String(j.getAttribute("name") || "").trim()).filter(Boolean),
    links: childElements(groupEl, "link").map((l) => String(l.getAttribute("name") || "").trim()).filter(Boolean),
  })).filter((g) => g.name);

  const groupStates = childElements(root, "group_state").map((stateEl) => {
    const jointValuesByName = {};
    for (const jointEl of childElements(stateEl, "joint")) {
      const name = String(jointEl.getAttribute("name") || "").trim();
      if (!name) continue;
      jointValuesByName[name] = asNum(jointEl.getAttribute("value"), 0);
    }
    return {
      name: String(stateEl.getAttribute("name") || "").trim(),
      group: String(stateEl.getAttribute("group") || "").trim(),
      jointValuesByName,
    };
  }).filter((s) => s.name);

  const endEffectors = childElements(root, "end_effector").map((ee) => ({
    name: String(ee.getAttribute("name") || "").trim(),
    group: String(ee.getAttribute("group") || "").trim(),
    parentLink: String(ee.getAttribute("parent_link") || "").trim(),
  })).filter((ee) => ee.name);

  return { groups, groupStates, endEffectors };
}

function materialFromRgba(rgba) {
  const [r, g, b, a] = rgba || [0.7, 0.7, 0.75, 1];
  const color = new THREE.Color(r, g, b);
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color.clone().multiplyScalar(0.18),
    emissiveIntensity: 0.35,
    metalness: 0.08,
    roughness: 0.55,
    transparent: a < 0.999,
    opacity: a,
  });
}

function primitiveMesh(visual) {
  let geometry;
  if (visual.kind === "box") {
    geometry = new THREE.BoxGeometry(visual.size[0], visual.size[1], visual.size[2]);
  } else if (visual.kind === "cylinder") {
    // URDF cylinders are Z-aligned. Three's CylinderGeometry is Y-aligned.
    geometry = new THREE.CylinderGeometry(visual.radius, visual.radius, visual.length, 28);
    geometry.rotateX(Math.PI / 2);
  } else {
    geometry = new THREE.SphereGeometry(visual.radius || 0.02, 20, 14);
  }
  const mesh = new THREE.Mesh(geometry, materialFromRgba(visual.color));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrixFromRowMajor(visual.localTransform));
  mesh.matrixWorldNeedsUpdate = true;
  return mesh;
}

async function loadVisualMesh(visual, projectId, authHeaders, resolveFileUrl = null) {
  // Primitives (box / cylinder / sphere) render directly — do not collapse them to spheres.
  if (visual.kind !== "mesh") {
    return primitiveMesh(visual);
  }
  if (!visual.filename || (!projectId && !resolveFileUrl)) {
    return primitiveMesh({ ...visual, kind: "sphere", radius: 0.02 });
  }
  const url = resolveFileUrl?.(visual.filename) || `/api/projects/${projectId}/files/${encodeURIComponent(visual.filename)}`;
  try {
    const res = await fetch(url, { headers: authHeaders?.() || {} });
    if (!res.ok) return primitiveMesh({ ...visual, kind: "sphere", radius: 0.025 });
    const blob = await res.blob();
    const lower = visual.filename.toLowerCase();
    let object;
    if (lower.endsWith(".stl")) {
      const geo = new STLLoader().parse(await blob.arrayBuffer());
      geo.computeVertexNormals();
      object = new THREE.Mesh(geo, materialFromRgba(visual.color));
    } else if (/\.(glb|gltf)$/i.test(lower)) {
      const blobUrl = URL.createObjectURL(blob);
      try {
        object = (await new GLTFLoader().loadAsync(blobUrl)).scene;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } else {
      return primitiveMesh({ ...visual, kind: "sphere", radius: 0.025 });
    }
    const wrapper = new THREE.Group();
    wrapper.matrixAutoUpdate = false;
    const [sx, sy, sz] = visual.scale || [1, 1, 1];
    object.scale.set(sx, sy, sz);
    wrapper.add(object);
    wrapper.matrix.copy(matrixFromRowMajor(visual.localTransform));
    wrapper.matrixWorldNeedsUpdate = true;
    return wrapper;
  } catch {
    return primitiveMesh({ ...visual, kind: "sphere", radius: 0.025 });
  }
}

function posedJointLocal(joint, valueRad) {
  const type = String(joint.type || "fixed");
  if (type === "fixed") return [...joint.origin];
  if (type === "prismatic") {
    const [ax, ay, az] = joint.axis;
    return multiply(joint.origin, translation(ax * valueRad, ay * valueRad, az * valueRad));
  }
  return multiply(joint.origin, axisAngle(joint.axis, valueRad));
}

function solveLinkWorldTransforms(urdf, jointValuesRad = {}) {
  const jointsByParent = new Map();
  for (const joint of urdf.joints) {
    const list = jointsByParent.get(joint.parentLink) || [];
    list.push(joint);
    jointsByParent.set(joint.parentLink, list);
  }
  const out = new Map();
  const visit = (linkName, world) => {
    out.set(linkName, world);
    for (const joint of jointsByParent.get(linkName) || []) {
      const value = asNum(jointValuesRad[joint.name], 0);
      visit(joint.childLink, multiply(world, posedJointLocal(joint, value)));
    }
  };
  if (urdf.rootLink) visit(urdf.rootLink, [...IDENTITY]);
  return out;
}

export function createUrdfRobotRuntime({ scene, authHeaders } = {}) {
  let root = null;
  let urdf = null;
  let srdf = null;
  let linkGroups = new Map();
  let linkParents = new Map(); // childLink -> parent THREE.Object3D
  let jointValuesRad = {};
  let projectId = null;
  let activeUrdfFile = null;
  let activeSrdfFile = null;
  let trajectoryTimer = null;
  let trajectoryRaf = 0;

  function clear() {
    stopTrajectory();
    if (root) {
      scene?.remove(root);
      root.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
    root = null;
    urdf = null;
    srdf = null;
    linkGroups = new Map();
    linkParents = new Map();
    jointValuesRad = {};
    activeUrdfFile = null;
    activeSrdfFile = null;
  }

  function applyPose() {
    if (!urdf || !root) return;
    // Prefer hierarchical local joint poses (Jake-style). Fall back to flat world mats.
    if (linkParents.size) {
      for (const joint of urdf.joints || []) {
        const child = linkGroups.get(joint.childLink);
        if (!child) continue;
        const value = asNum(jointValuesRad[joint.name], 0);
        const local = posedJointLocal(joint, value);
        child.matrixAutoUpdate = false;
        child.matrix.copy(matrixFromRowMajor(local));
        child.matrixWorldNeedsUpdate = true;
      }
      const rootLinkGroup = linkGroups.get(urdf.rootLink);
      if (rootLinkGroup) {
        rootLinkGroup.matrixAutoUpdate = false;
        rootLinkGroup.matrix.identity();
        rootLinkGroup.matrixWorldNeedsUpdate = true;
      }
      root.updateMatrixWorld(true);
      return;
    }
    const worlds = solveLinkWorldTransforms(urdf, jointValuesRad);
    for (const [linkName, group] of linkGroups.entries()) {
      const world = worlds.get(linkName) || IDENTITY;
      group.matrixAutoUpdate = false;
      group.matrix.copy(matrixFromRowMajor(world));
      group.matrixWorldNeedsUpdate = true;
    }
    root.updateMatrixWorld(true);
  }

  async function loadFromProject(pid, { urdfFile, srdfFile } = {}) {
    clear();
    projectId = pid;
    if (!pid || !urdfFile) return null;
    const headers = authHeaders?.() || {};
    const urdfRes = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(urdfFile)}`, { headers });
    if (!urdfRes.ok) throw new Error(`Could not load ${urdfFile}`);
    urdf = parseUrdfXml(await urdfRes.text());
    activeUrdfFile = urdfFile;

    if (srdfFile) {
      try {
        const srdfRes = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(srdfFile)}`, { headers });
        if (srdfRes.ok) {
          srdf = parseSrdfXml(await srdfRes.text());
          activeSrdfFile = srdfFile;
        }
      } catch {
        srdf = null;
      }
    }

    root = new THREE.Group();
    root.name = `urdf:${urdf.name}`;
    root.userData.isUrdfRobot = true;
    // Render Studio CAD viewport is millimeter-based; URDF is meters.
    root.scale.setScalar(1000);
    linkGroups = new Map();
    linkParents = new Map();

    for (const link of urdf.links) {
      const group = new THREE.Group();
      group.name = link.name;
      group.userData.urdfLink = link.name;
      group.matrixAutoUpdate = false;
      for (const visual of link.visuals) {
        const mesh = await loadVisualMesh(visual, pid, authHeaders);
        group.add(mesh);
      }
      if (!link.visuals.length) {
        group.add(primitiveMesh({ kind: "sphere", radius: 0.015, color: [0.55, 0.6, 0.7, 1], localTransform: IDENTITY }));
      }
      linkGroups.set(link.name, group);
    }

    // Build parent→child hierarchy so joint motion is local and reliable.
    const childLinks = new Set((urdf.joints || []).map((j) => j.childLink).filter(Boolean));
    for (const link of urdf.links) {
      const group = linkGroups.get(link.name);
      if (!group) continue;
      if (!childLinks.has(link.name)) {
        root.add(group);
      }
    }
    for (const joint of urdf.joints || []) {
      const parent = linkGroups.get(joint.parentLink);
      const child = linkGroups.get(joint.childLink);
      if (!parent || !child) continue;
      parent.add(child);
      linkParents.set(joint.childLink, parent);
      jointValuesRad[joint.name] = 0;
    }
    for (const joint of urdf.joints || []) {
      if (!(joint.name in jointValuesRad)) jointValuesRad[joint.name] = 0;
    }

    // Prefer SRDF "home" so the arm opens in a readable pose, not collapsed at zeros.
    const home = (srdf?.groupStates || []).find((s) => String(s.name).toLowerCase() === "home");
    if (home?.jointValuesByName) {
      Object.entries(home.jointValuesByName).forEach(([name, value]) => {
        if (name in jointValuesRad) jointValuesRad[name] = asNum(value, 0);
      });
    }

    scene?.add(root);
    applyPose();
    return getState();
  }

  async function loadFromUrls({ urdfUrl, urdfFile, srdfUrl = null, srdfFile = null, resolveFileUrl = null } = {}) {
    clear();
    projectId = null;
    if (!urdfUrl) return null;
    const urdfRes = await fetch(urdfUrl);
    if (!urdfRes.ok) throw new Error(`Could not load ${urdfFile || "URDF"}`);
    urdf = parseUrdfXml(await urdfRes.text());
    activeUrdfFile = urdfFile || urdfUrl.split("/").pop() || "robot.urdf";

    if (srdfUrl) {
      try {
        const srdfRes = await fetch(srdfUrl);
        if (srdfRes.ok) {
          srdf = parseSrdfXml(await srdfRes.text());
          activeSrdfFile = srdfFile || srdfUrl.split("/").pop() || "robot.srdf";
        }
      } catch {
        srdf = null;
      }
    }

    root = new THREE.Group();
    root.name = `urdf:${urdf.name}`;
    root.userData.isUrdfRobot = true;
    root.scale.setScalar(1000);
    linkGroups = new Map();
    linkParents = new Map();

    for (const link of urdf.links) {
      const group = new THREE.Group();
      group.name = link.name;
      group.userData.urdfLink = link.name;
      group.matrixAutoUpdate = false;
      for (const visual of link.visuals) {
        const mesh = await loadVisualMesh(visual, null, null, resolveFileUrl);
        group.add(mesh);
      }
      if (!link.visuals.length) {
        group.add(primitiveMesh({ kind: "sphere", radius: 0.015, color: [0.55, 0.6, 0.7, 1], localTransform: IDENTITY }));
      }
      linkGroups.set(link.name, group);
    }

    const childLinks = new Set((urdf.joints || []).map((j) => j.childLink).filter(Boolean));
    for (const link of urdf.links) {
      const group = linkGroups.get(link.name);
      if (!group) continue;
      if (!childLinks.has(link.name)) root.add(group);
    }
    for (const joint of urdf.joints || []) {
      const parent = linkGroups.get(joint.parentLink);
      const child = linkGroups.get(joint.childLink);
      if (!parent || !child) continue;
      parent.add(child);
      linkParents.set(joint.childLink, parent);
      jointValuesRad[joint.name] = 0;
    }
    for (const joint of urdf.joints || []) {
      if (!(joint.name in jointValuesRad)) jointValuesRad[joint.name] = 0;
    }

    const home = (srdf?.groupStates || []).find((s) => String(s.name).toLowerCase() === "home");
    if (home?.jointValuesByName) {
      Object.entries(home.jointValuesByName).forEach(([name, value]) => {
        if (name in jointValuesRad) jointValuesRad[name] = asNum(value, 0);
      });
    }

    scene?.add(root);
    applyPose();
    return getState();
  }

  function setJointValue(name, valueRad, { apply = true } = {}) {
    const joint = urdf?.joints?.find((j) => j.name === name);
    if (!joint || joint.type === "fixed") return false;
    const lower = asNum(joint.lower, -Math.PI);
    const upper = asNum(joint.upper, Math.PI);
    const clamped = joint.type === "continuous"
      ? asNum(valueRad, 0)
      : Math.max(lower, Math.min(upper, asNum(valueRad, 0)));
    jointValuesRad[name] = clamped;
    if (apply) applyPose();
    return true;
  }

  function setJointValues(values, { apply = true } = {}) {
    Object.entries(values || {}).forEach(([name, value]) => setJointValue(name, value, { apply: false }));
    if (apply) applyPose();
  }

  function resetPose() {
    Object.keys(jointValuesRad).forEach((name) => {
      jointValuesRad[name] = 0;
    });
    applyPose();
  }

  function applyGroupState(stateName) {
    const state = (srdf?.groupStates || []).find((s) => s.name === stateName);
    if (!state) return false;
    setJointValues(state.jointValuesByName || {});
    return true;
  }

  function stopTrajectory() {
    if (trajectoryTimer) {
      clearInterval(trajectoryTimer);
      trajectoryTimer = null;
    }
    if (trajectoryRaf) {
      cancelAnimationFrame(trajectoryRaf);
      trajectoryRaf = 0;
    }
  }

  function normalizeTrajectoryPoint(point) {
    if (!point || typeof point !== "object") return null;
    if (point.positionsByName && typeof point.positionsByName === "object") return point.positionsByName;
    if (point.jointValuesByName && typeof point.jointValuesByName === "object") return point.jointValuesByName;
    if (point.positions && typeof point.positions === "object" && !Array.isArray(point.positions)) return point.positions;
    if (Array.isArray(point.positions) && Array.isArray(point.jointNames)) {
      const values = {};
      point.jointNames.forEach((name, index) => {
        if (name) values[name] = asNum(point.positions[index], 0);
      });
      return values;
    }
    // Bare joint map (demo sweeps).
    const keys = Object.keys(point).filter((k) => !["time", "timeFromStart", "jointNames"].includes(k));
    if (keys.length && keys.every((k) => typeof point[k] === "number")) {
      const values = {};
      keys.forEach((k) => {
        values[k] = asNum(point[k], 0);
      });
      return values;
    }
    return null;
  }

  function playTrajectory(trajectory, { durationSec = 1.2, onFrame } = {}) {
    stopTrajectory();
    const points = Array.isArray(trajectory?.points) ? trajectory.points : (Array.isArray(trajectory) ? trajectory : []);
    if (!points.length) return false;
    const start = performance.now();
    const total = Math.max(0.2, Number(durationSec) || 1.2) * 1000;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / total);
      const idx = Math.min(points.length - 1, Math.floor(t * (points.length - 1)));
      const point = points[idx] || {};
      const values = normalizeTrajectoryPoint(point);
      if (values) setJointValues(values);
      onFrame?.({ t, point, values });
      if (t >= 1) {
        trajectoryRaf = 0;
        return;
      }
      trajectoryRaf = requestAnimationFrame(tick);
    };
    trajectoryRaf = requestAnimationFrame(tick);
    return true;
  }

  function getState() {
    return {
      loaded: !!urdf,
      urdf,
      srdf,
      urdfFile: activeUrdfFile,
      srdfFile: activeSrdfFile,
      jointValuesRad: { ...jointValuesRad },
      root,
    };
  }

  function fitBox() {
    if (!root) return null;
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(root);
  }

  let demoPlaying = false;
  let demoTimer = null;

  function stopDemoPlay() {
    demoPlaying = false;
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
  }

  function togglePlay({ durationSec = 3.6 } = {}) {
    if (demoPlaying) {
      stopDemoPlay();
      stopTrajectory();
      return false;
    }
    if (!urdf) return false;
    const home = (srdf?.groupStates || []).find((s) => String(s.name).toLowerCase() === "home");
    const reach = (srdf?.groupStates || []).find((s) => /reach|wave|open/i.test(String(s.name || "")));
    const movable = (urdf.joints || []).filter((j) => {
      const type = String(j.type || "").toLowerCase();
      return type === "revolute" || type === "continuous" || type === "prismatic";
    });
    if (!movable.length) return false;
    const base = { ...jointValuesRad, ...(home?.jointValuesByName || {}) };
    setJointValues(base);
    const points = [];
    const steps = 90;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const values = { ...base };
      movable.forEach((joint, index) => {
        const mid = asNum(base[joint.name], 0);
        const lower = asNum(joint.lower, -Math.PI);
        const upper = asNum(joint.upper, Math.PI);
        const span = Math.abs(upper - lower);
        const amp = joint.type === "prismatic"
          ? Math.min(0.05, span * 0.4 || 0.025)
          : Math.min(1.1, Math.max(0.45, (span || Math.PI) * 0.28));
        const phase = index * 0.85;
        let next = mid + amp * Math.sin(t * Math.PI * 2 + phase);
        if (reach?.jointValuesByName?.[joint.name] != null) {
          const target = asNum(reach.jointValuesByName[joint.name], mid);
          const blend = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
          next = mid * (1 - blend) + target * blend + amp * 0.25 * Math.sin(t * Math.PI * 2 + phase);
        }
        if (joint.type !== "continuous") {
          next = Math.max(lower, Math.min(upper, next));
        }
        values[joint.name] = next;
      });
      points.push(values);
    }
    demoPlaying = true;
    const started = playTrajectory({ points }, {
      durationSec,
      onFrame: ({ t }) => {
        if (t >= 1) {
          demoPlaying = false;
          if (home?.jointValuesByName) setJointValues(home.jointValuesByName);
        }
      },
    });
    if (!started) {
      demoPlaying = false;
      return false;
    }
    return true;
  }

  function isPlaying() {
    return demoPlaying || !!trajectoryTimer || !!trajectoryRaf;
  }

  return {
    clear: () => {
      stopDemoPlay();
      clear();
    },
    loadFromProject,
    loadFromUrls,
    setJointValue,
    setJointValues,
    resetPose,
    applyGroupState,
    playTrajectory,
    stopTrajectory: () => {
      stopDemoPlay();
      stopTrajectory();
    },
    togglePlay,
    isPlaying,
    getState,
    fitBox,
    isLoaded: () => !!urdf,
  };
}

/** Jake MoveIt2 websocket client (`srdf.solvePose` / `srdf.planToPose`). Offline-safe. */
export function createMoveIt2Client({ url = "ws://127.0.0.1:8765/ws" } = {}) {
  const PROTOCOL_VERSION = 1;
  let socket = null;
  let connected = false;
  const pending = new Map();

  function rejectAll(message) {
    for (const [, req] of pending) {
      clearTimeout(req.timer);
      req.reject(new Error(message));
    }
    pending.clear();
  }

  function close() {
    connected = false;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
    socket = null;
    rejectAll("MoveIt2 disconnected");
  }

  function attachHandlers(active) {
    active.addEventListener("message", (event) => {
      let message = null;
      try {
        message = JSON.parse(String(event.data || ""));
      } catch {
        return;
      }
      const id = String(message?.id || "").trim();
      if (!id || !pending.has(id)) return;
      const req = pending.get(id);
      clearTimeout(req.timer);
      pending.delete(id);
      if (message?.ok === false) {
        const err = message?.error;
        const text = typeof err === "string"
          ? err
          : (err?.message || message?.message || "MoveIt2 request failed");
        req.reject(new Error(text));
        return;
      }
      req.resolve(message?.result ?? message ?? {});
    });
    active.addEventListener("close", () => {
      connected = false;
      rejectAll("MoveIt2 server connection closed.");
      socket = null;
    });
    active.addEventListener("error", () => {
      if (active.readyState !== WebSocket.OPEN) {
        connected = false;
      }
    });
  }

  function connect({ timeoutMs = 2500 } = {}) {
    return new Promise((resolve) => {
      if (typeof WebSocket === "undefined") {
        resolve({ ok: false, reason: "WebSocket unavailable" });
        return;
      }
      if (socket && connected && socket.readyState === WebSocket.OPEN) {
        resolve({ ok: true, url });
        return;
      }
      if (socket && socket.readyState === WebSocket.CONNECTING) {
        const waitOpen = () => {
          connected = true;
          resolve({ ok: true, url });
        };
        const waitFail = () => resolve({ ok: false, reason: "error" });
        socket.addEventListener("open", waitOpen, { once: true });
        socket.addEventListener("error", waitFail, { once: true });
        return;
      }
      try {
        socket = new WebSocket(url);
      } catch (err) {
        resolve({ ok: false, reason: err?.message || "connect failed" });
        return;
      }
      attachHandlers(socket);
      const timer = setTimeout(() => {
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
        connected = false;
        socket = null;
        resolve({ ok: false, reason: "timeout" });
      }, Math.max(400, Number(timeoutMs) || 2500));
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        connected = true;
        resolve({ ok: true, url });
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        connected = false;
        resolve({ ok: false, reason: "error" });
      }, { once: true });
    });
  }

  function request(type, payload = {}, timeoutMs = 60000) {
    if (!socket || socket.readyState > WebSocket.OPEN) {
      return Promise.reject(new Error("MoveIt2 offline"));
    }
    const id = `mv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const body = {
      id,
      type,
      protocolVersion: PROTOCOL_VERSION,
      payload: payload && typeof payload === "object" ? payload : {},
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("MoveIt2 request timeout"));
      }, Math.max(1000, Number(timeoutMs) || 60000));
      pending.set(id, { resolve, reject, timer });
      const send = () => {
        try {
          socket.send(JSON.stringify(body));
        } catch (err) {
          pending.delete(id);
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error("MoveIt2 send failed"));
        }
      };
      if (socket.readyState === WebSocket.OPEN) send();
      else socket.addEventListener("open", send, { once: true });
    });
  }

  return {
    connect,
    close,
    request,
    isConnected: () => connected && !!socket && socket.readyState === WebSocket.OPEN,
    url,
  };
}
