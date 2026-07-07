/** 3D rig editor — bones, joints, keyframe animation, URDF export */

import * as THREE from "three";
import { createRiggingAnimationTimeline } from "./rigging-animation-timeline.js";
import { createRiggingMeshDriver } from "./rigging-mesh-driver.js?v=20260629-sim-joints";

const BONE_COLOR = 0xf0883e;
const BONE_SELECTED = 0x58a6ff;
const LINK_COLOR = 0x8b949e;
const AXIS_COLORS = { x: 0xf85149, y: 0x3fb950, z: 0x58a6ff };

function uid(prefix = "bone") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function asVec3(value, fallback = [0, 0, 0]) {
  if (Array.isArray(value) && value.length >= 3) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  if (value && typeof value === "object") {
    return [
      Number(value.x ?? value[0]) || 0,
      Number(value.y ?? value[1]) || 0,
      Number(value.z ?? value[2]) || 0,
    ];
  }
  return [...fallback];
}

function normalizePose(pose, fallback = {}) {
  return {
    position: asVec3(pose?.position, fallback.position || [0, 0, 0]),
    rotation: asVec3(pose?.rotation, fallback.rotation || [0, 0, 0]),
  };
}

function clonePose(bones) {
  const poses = {};
  for (const b of bones) {
    poses[b.id] = normalizePose(b);
  }
  return poses;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function eulerToQuat(euler) {
  const e = asVec3(euler);
  return new THREE.Euler(e[0], e[1], e[2], "XYZ");
}

function dominantAxisIndex(axis) {
  const v = asVec3(axis, [0, 0, 1]).map((n) => Math.abs(n));
  return v.indexOf(Math.max(...v));
}

function defaultAnimation(bones) {
  return {
    id: uid("anim"),
    name: "Animation 1",
    duration: 5,
    fps: 30,
    keyframes: [{ time: 0, poses: clonePose(bones) }],
  };
}

export function createRiggingEditor({
  scene,
  camera,
  renderer,
  controls,
  getMeshRoot,
  getAssemblyRoot,
  getPartRoot,
  getSim,
  api,
  getProjectId,
  onStatus,
  onChange,
  timelineContainer,
}) {
  const dom = renderer.domElement;
  const group = new THREE.Group();
  group.name = "rigging-editor";
  group.visible = false;
  scene.add(group);

  let active = false;
  let tool = "select";
  let bones = [];
  let animations = [];
  let activeAnimationId = null;
  let selectedId = null;
  let connectFromId = null;
  let dragBoneId = null;
  let rotateDrag = null;
  let saveTimer = null;
  let playbackRaf = null;
  let playbackStart = 0;
  let playbackFrom = 0;
  let syncingTimeline = false;

  const boneMeshes = new Map();
  const linkLines = [];
  const axisHelpers = new Map();

  const animTimeline = timelineContainer
    ? (() => {
        timelineContainer.innerHTML = "";
        return createRiggingAnimationTimeline(timelineContainer, {
          onScrub: (time) => applyAnimationTime(time),
          onPlayPause: (playing) => {
            if (playing) startPlayback();
            else stopPlayback();
          },
          onTimeChange: (time) => applyAnimationTime(time),
          onKeyframe: () => insertKeyframe(),
        });
      })()
    : null;

  const meshDriver = createRiggingMeshDriver({
    getPartRoot: getPartRoot || getAssemblyRoot || getMeshRoot,
    getSim,
  });

  function refreshMeshBindings() {
    const n = meshDriver.rebind(bones);
    if (active && n >= 1) {
      applyAnimationTime(animTimeline?.getTime?.() ?? 0);
    }
    return n;
  }

  function syncBoneOverlayVisibility() {
    const meshDriven = meshDriver.isMeshDriven?.();
    group.visible = active && !meshDriven;
  }

  function activeAnimation() {
    return animations.find((a) => a.id === activeAnimationId) || animations[0] || null;
  }

  function boneById(id) {
    return bones.find((b) => b.id === id) || null;
  }

  function normalizeBone(b) {
    return {
      id: b.id || uid(),
      name: b.name || "Bone",
      position: asVec3(b.position),
      rotation: asVec3(b.rotation),
      parentId: b.parentId || null,
      jointType: b.jointType || "revolute",
      jointAxis: asVec3(b.jointAxis, [0, 0, 1]),
      limits: b.limits || { lower: -3.14, upper: 3.14 },
    };
  }

  function gearSpinBoneIds(boneList) {
    const gear = boneList
      .filter(
        (b) =>
          b.jointType === "revolute" &&
          (/^bone_gear/i.test(b.id) ||
            b.name === "gear_input" ||
            b.name === "gear_output" ||
            /^gear_\d/i.test(b.name))
      )
      .map((b) => b.id);
    if (gear.length) return gear;
    return boneList.filter((b) => b.jointType === "revolute").map((b) => b.id);
  }

  function sanitizeKeyframes(keyframes, boneList) {
    if (!keyframes?.length) return keyframes;
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (sorted.length <= 3) return sorted;

    const spinBones = gearSpinBoneIds(boneList);
    const looksLikeGearTrain = spinBones.some((id) => /gear/i.test(id));
    if (!looksLikeGearTrain) return sorted;
    const zAt = (kf, boneId) => Number(kf.poses?.[boneId]?.rotation?.[2]) || 0;
    const isSpinPoint = (kf) => spinBones.some((id) => Math.abs(zAt(kf, id)) > 0.05);
    const isAccidentalReset = (kf, prev) =>
      spinBones.every((id) => Math.abs(zAt(kf, id)) < 0.05) &&
      spinBones.some((id) => Math.abs(zAt(prev, id)) > 0.5);

    const kept = [sorted[0]];
    for (let i = 1; i < sorted.length - 1; i += 1) {
      const kf = sorted[i];
      const prev = kept[kept.length - 1];
      const next = sorted[i + 1];
      const prevZ = spinBones.map((id) => zAt(prev, id));
      const kfZ = spinBones.map((id) => zAt(kf, id));
      const nextZ = spinBones.map((id) => zAt(next, id));
      const flat = kfZ.every((z, idx) => Math.abs(z - prevZ[idx]) < 0.01 && Math.abs(z - nextZ[idx]) < 0.01);
      if (isAccidentalReset(kf, prev)) continue;
      if (!flat || isSpinPoint(kf)) kept.push(kf);
    }
    kept.push(sorted[sorted.length - 1]);
    return kept;
  }

  function normalizeAnimations(rawAnimations, boneList) {
    return (rawAnimations || []).map((anim, idx) => {
      let keyframes = (anim.keyframes || [])
        .filter((kf) => kf && Number.isFinite(kf.time))
        .map((kf) => ({
          time: kf.time,
          poses: Object.fromEntries(
            Object.entries(kf.poses || {}).map(([boneId, pose]) => {
              const bone = boneList.find((b) => b.id === boneId);
              return [boneId, normalizePose(pose, bone || {})];
            })
          ),
        }));
      keyframes = sanitizeKeyframes(keyframes, boneList);
      if (!keyframes.length) {
        keyframes.push({ time: 0, poses: clonePose(boneList) });
      }
      return {
        id: anim.id || uid(`anim_${idx}`),
        name: anim.name || `Animation ${idx + 1}`,
        duration: Math.max(0.1, anim.duration || 5),
        fps: anim.fps || 30,
        keyframes,
      };
    });
  }

  function worldMatrix(boneId, cache = new Map()) {
    if (cache.has(boneId)) return cache.get(boneId);
    const bone = boneById(boneId);
    if (!bone) return new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3(...bone.position);
    const rot = eulerToQuat(bone.rotation);
    m.compose(pos, new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(1, 1, 1));
    if (bone.parentId) {
      const parent = worldMatrix(bone.parentId, cache);
      m.premultiply(parent);
    }
    cache.set(boneId, m);
    return m;
  }

  function worldPosition(bone) {
    if (!bone?.id) return new THREE.Vector3();
    const m = worldMatrix(bone.id);
    const p = new THREE.Vector3();
    p.setFromMatrixPosition(m);
    return p;
  }

  function clearVisuals() {
    for (const mesh of boneMeshes.values()) {
      group.remove(mesh);
      mesh.geometry?.dispose?.();
      mesh.material?.dispose?.();
    }
    boneMeshes.clear();
    for (const helper of axisHelpers.values()) {
      group.remove(helper);
      helper.geometry?.dispose?.();
      helper.material?.dispose?.();
    }
    axisHelpers.clear();
    for (const line of linkLines) {
      group.remove(line);
      line.geometry?.dispose?.();
      line.material?.dispose?.();
    }
    linkLines.length = 0;
  }

  function renderAll({ syncTimeline = true } = {}) {
    clearVisuals();
    for (const bone of bones) {
      const pos = worldPosition(bone);
      const geom = new THREE.SphereGeometry(bone.parentId ? 0.06 : 0.09, 16, 12);
      const mat = new THREE.MeshBasicMaterial({
        color: bone.id === selectedId ? BONE_SELECTED : BONE_COLOR,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      mesh.renderOrder = 10;
      mesh.userData.boneId = bone.id;
      group.add(mesh);
      boneMeshes.set(bone.id, mesh);

      if (bone.id === selectedId && bone.jointType === "revolute") {
        const axis = new THREE.Vector3(...asVec3(bone.jointAxis, [0, 0, 1])).normalize();
        const parentBone = bone.parentId ? boneById(bone.parentId) : null;
        const parentPos = parentBone ? worldPosition(parentBone) : pos;
        const len = 0.25;
        const end = parentPos.clone().add(axis.clone().multiplyScalar(len));
        const axisGeom = new THREE.BufferGeometry().setFromPoints([parentPos, end]);
        const axisIdx = Math.abs(axis.x) > 0.5 ? "x" : Math.abs(axis.y) > 0.5 ? "y" : "z";
        const axisMat = new THREE.LineBasicMaterial({
          color: AXIS_COLORS[axisIdx],
          depthTest: false,
          linewidth: 2,
        });
        const axisLine = new THREE.Line(axisGeom, axisMat);
        axisLine.renderOrder = 11;
        group.add(axisLine);
        axisHelpers.set(bone.id, axisLine);
      }
    }
    for (const bone of bones) {
      if (!bone.parentId) continue;
      const parent = boneById(bone.parentId);
      if (!parent) continue;
      const a = worldPosition(parent);
      const b = worldPosition(bone);
      const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
      const mat = new THREE.LineBasicMaterial({ color: LINK_COLOR, depthTest: false });
      const line = new THREE.Line(geom, mat);
      line.renderOrder = 9;
      group.add(line);
      linkLines.push(line);
    }
    if (syncTimeline) syncTimelineUI();
    syncBoneOverlayVisibility();
  }

  function syncTimelineUI() {
    const anim = activeAnimation();
    if (!animTimeline || !anim || syncingTimeline) return;
    syncingTimeline = true;
    try {
      animTimeline.setAnimation({
        name: anim.name,
        durationSec: anim.duration,
        fps: anim.fps,
        keyframes: anim.keyframes,
      });
      animTimeline.setTime(animTimeline.getTime?.() ?? 0, { fromPlayback: true });
    } finally {
      syncingTimeline = false;
    }
  }

  function interpolatePoses(t) {
    const anim = activeAnimation();
    if (!anim || !anim.keyframes?.length) return null;
    const keys = [...anim.keyframes]
      .filter((k) => k && Number.isFinite(k.time))
      .sort((a, b) => a.time - b.time);
    if (!keys.length) return null;
    if (t <= keys[0].time) return keys[0].poses || null;
    if (t >= keys[keys.length - 1].time) return keys[keys.length - 1].poses || null;
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].time && t <= keys[i + 1].time) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const span = b.time - a.time || 1;
    const u = (t - a.time) / span;
    const out = {};
    for (const bone of bones) {
      const pa = normalizePose(a.poses?.[bone.id], bone);
      const pb = normalizePose(b.poses?.[bone.id], pa);
      out[bone.id] = {
        position: [
          lerp(pa.position[0], pb.position[0], u),
          lerp(pa.position[1], pb.position[1], u),
          lerp(pa.position[2], pb.position[2], u),
        ],
        rotation: [
          lerpAngle(pa.rotation[0], pb.rotation[0], u),
          lerpAngle(pa.rotation[1], pb.rotation[1], u),
          lerpAngle(pa.rotation[2], pb.rotation[2], u),
        ],
      };
    }
    return out;
  }

  function applyAnimationTime(time) {
    const poses = interpolatePoses(time);
    if (!poses) return;

    const meshDriven = meshDriver.isMeshDriven?.();
    if (meshDriven) {
      group.visible = false;
      meshDriver.applyBoneRotations(bones, poses);
      return;
    }

    for (const bone of bones) {
      const raw = poses[bone.id];
      if (!raw) continue;
      const p = normalizePose(raw, bone);
      bone.position = p.position;
      bone.rotation = p.rotation;
    }
    group.visible = active;
    renderAll({ syncTimeline: false });
    meshDriver.applyBoneRotations(bones, poses);
  }

  function currentAnimationPoses() {
    const t = animTimeline?.getTime?.() ?? 0;
    const interpolated = interpolatePoses(t);
    if (interpolated) {
      return Object.fromEntries(
        bones.map((bone) => {
          const raw = interpolated[bone.id];
          return [bone.id, raw ? normalizePose(raw, bone) : normalizePose(bone, bone)];
        }),
      );
    }
    return clonePose(bones);
  }

  function insertKeyframe(atTime) {
    const anim = activeAnimation();
    if (!anim) return;
    const t = atTime ?? animTimeline?.getTime?.() ?? 0;
    const poses = currentAnimationPoses();
    const existing = anim.keyframes.findIndex((k) => Math.abs(k.time - t) < 0.02);
    if (existing >= 0) {
      anim.keyframes[existing].poses = poses;
    } else {
      anim.keyframes.push({ time: t, poses });
      anim.keyframes.sort((a, b) => a.time - b.time);
    }
    animTimeline?.refreshMarkers(anim.keyframes);
    scheduleSave();
    onStatus?.("ok", `Keyframe at ${t.toFixed(2)}s`);
  }

  function startPlayback() {
    stopPlayback(false);
    const anim = activeAnimation();
    if (!anim) return;
    playbackFrom = animTimeline?.getTime() ?? 0;
    playbackStart = performance.now();
    const tick = (now) => {
      if (!animTimeline?.isPlaying()) return;
      const elapsed = (now - playbackStart) / 1000;
      let t = playbackFrom + elapsed;
      const dur = anim.duration || 5;
      if (t >= dur) {
        t = 0;
        playbackFrom = 0;
        playbackStart = now;
      }
      animTimeline.setTime(t, { fromPlayback: true });
      applyAnimationTime(t);
      playbackRaf = requestAnimationFrame(tick);
    };
    playbackRaf = requestAnimationFrame(tick);
  }

  function stopPlayback(resetPlaying = true) {
    if (playbackRaf) cancelAnimationFrame(playbackRaf);
    playbackRaf = null;
    if (resetPlaying) animTimeline?.setPlaying(false);
    if (meshDriver.isMeshDriven?.()) {
      group.visible = false;
    } else if (active) {
      group.visible = true;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  }

  function serialize() {
    return {
      bones,
      animations: animations.map((anim) => ({
        ...anim,
        keyframes: sanitizeKeyframes(anim.keyframes, bones),
      })),
      activeAnimationId,
      name: "Rig",
    };
  }

  async function save() {
    const projectId = getProjectId?.();
    if (!projectId || !api) return;
    try {
      await api(`/api/projects/${projectId}/rigging`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serialize()),
      });
      onChange?.();
    } catch {
      /* ignore autosave errors */
    }
  }

  async function load() {
    const projectId = getProjectId?.();
    if (!projectId || !api) return;
    try {
      const data = await api(`/api/projects/${projectId}/rigging`);
      bones = (data.bones || []).map(normalizeBone);
      animations = (data.animations || []).length
        ? normalizeAnimations(data.animations, bones)
        : [defaultAnimation(bones)];
      activeAnimationId = data.activeAnimationId || animations[0]?.id;
      if (!activeAnimationId && animations[0]) activeAnimationId = animations[0].id;
    } catch {
      bones = [];
      animations = [defaultAnimation([])];
      activeAnimationId = animations[0].id;
    }
    selectedId = null;
    connectFromId = null;
    renderAll();
    refreshMeshBindings();
  }

  function applyRigData(data) {
    bones = (data.bones || []).map(normalizeBone);
    animations = (data.animations || []).length
      ? normalizeAnimations(data.animations, bones)
      : [defaultAnimation(bones)];
    activeAnimationId = data.activeAnimationId || animations[0]?.id;
    selectedId = null;
    connectFromId = null;
    renderAll();
    refreshMeshBindings();
    scheduleSave();
  }

  function addBone(at) {
    const pos = at ? [at.x, at.y, at.z] : [0, 0, 0.5];
    const bone = normalizeBone({
      id: uid(),
      name: `link_${bones.length + 1}`,
      position: pos,
      parentId: null,
    });
    bones.push(bone);
    selectedId = bone.id;
    renderAll();
    scheduleSave();
    onStatus?.("ok", `Added ${bone.name}. Connect to parent or set joint axis.`);
    return bone;
  }

  function autoRigChain() {
    const root = getMeshRoot?.();
    const box = new THREE.Box3();
    if (root) box.setFromObject(root);
    else box.set(new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 1));
    const h = box.max.z - box.min.z || 1;
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const z0 = box.min.z;
    bones = [];
    const names = ["base_link", "link_1", "link_2", "link_3", "ee_link"];
    let parentId = null;
    for (let i = 0; i < names.length; i++) {
      const b = normalizeBone({
        id: uid(),
        name: names[i],
        position: [cx, cy, z0 + (h * i) / (names.length - 1 || 1)],
        parentId,
        jointType: i === 0 ? "fixed" : "revolute",
        jointAxis: [0, 0, 1],
      });
      bones.push(b);
      parentId = b.id;
    }
    animations = [defaultAnimation(bones)];
    activeAnimationId = animations[0].id;
    selectedId = bones[0]?.id || null;
    renderAll();
    scheduleSave();
    onStatus?.("ok", "Auto rig chain created — adjust bones and export URDF.");
  }

  function simulationBonesFromSim(sim) {
    const joints = (sim?.joints || []).filter((joint) =>
      ["continuous", "revolute", "prismatic"].includes(String(joint?.type || "").toLowerCase()) && joint.child
    );
    return joints.map((joint, idx) =>
      normalizeBone({
        id: `sim_${String(joint.child).replace(/[^A-Za-z0-9_]+/g, "_")}_${idx}`,
        name: String(joint.child),
        position: asVec3(joint.anchor_m, [idx * 0.15, 0, 0]),
        parentId: null,
        jointType: joint.type,
        jointAxis: asVec3(joint.axis, [0, 0, 1]),
        limits: joint.limits || { lower: -Math.PI, upper: Math.PI },
      })
    );
  }

  function simulationAnimationForBones(boneList, { previewOnly = false } = {}) {
    const duration = previewOnly ? 6 : 4;
    const start = {};
    const end = {};
    boneList.forEach((bone, idx) => {
      const axisIdx = dominantAxisIndex(bone.jointAxis);
      const direction = idx % 2 ? -1 : 1;
      const rotation = [0, 0, 0];
      rotation[axisIdx] = direction * (bone.jointType === "revolute" ? Math.PI * 0.75 : Math.PI * 2);
      start[bone.id] = normalizePose({ position: bone.position, rotation: [0, 0, 0] }, bone);
      end[bone.id] = normalizePose({ position: bone.position, rotation }, bone);
    });
    return {
      id: uid(previewOnly ? "preview" : "sim"),
      name: previewOnly ? "Model preview simulation" : "Simulation preview",
      duration,
      fps: 30,
      keyframes: [
        { time: 0, poses: start },
        { time: duration, poses: end },
      ],
    };
  }

  function simulateModel() {
    stopPlayback();
    const sim = getSim?.();
    const simBones = simulationBonesFromSim(sim);
    const previewOnly = !simBones.length;
    bones = previewOnly
      ? [
          normalizeBone({
            id: "sim_model_preview",
            name: "model_preview",
            position: [0, 0, 0],
            jointType: "continuous",
            jointAxis: [0, 0, 1],
          }),
        ]
      : simBones;
    animations = [simulationAnimationForBones(bones, { previewOnly })];
    activeAnimationId = animations[0].id;
    selectedId = bones[0]?.id || null;
    if (previewOnly) meshDriver.bindPreviewRoot?.();
    else refreshMeshBindings();
    renderAll();
    animTimeline?.setTime(0);
    animTimeline?.setPlaying(true);
    startPlayback();
    scheduleSave();
    onStatus?.(
      previewOnly ? "ok" : "ok",
      previewOnly
        ? "No joint sim metadata found, running a turntable preview. Add rig joints for true mechanism motion."
        : `Simulation running — ${bones.length} joint${bones.length === 1 ? "" : "s"} animated from sim metadata.`
    );
    return { jointCount: previewOnly ? 0 : bones.length, previewOnly };
  }

  function deleteSelected() {
    if (!selectedId) {
      onStatus?.("error", "Select a bone first.");
      return;
    }
    const remove = new Set([selectedId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of bones) {
        if (b.parentId && remove.has(b.parentId) && !remove.has(b.id)) {
          remove.add(b.id);
          changed = true;
        }
      }
    }
    bones = bones.filter((b) => !remove.has(b.id));
    for (const b of bones) {
      if (remove.has(b.parentId)) b.parentId = null;
    }
    selectedId = null;
    connectFromId = null;
    renderAll();
    scheduleSave();
    onStatus?.("ok", "Bone removed.");
  }

  function connectBones(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return false;
    const child = boneById(toId);
    if (!child) return false;
    if (wouldCycle(fromId, toId)) {
      onStatus?.("error", "Cannot connect — would create a cycle.");
      return false;
    }
    child.parentId = fromId;
    renderAll();
    scheduleSave();
    onStatus?.("ok", "Bones connected.");
    return true;
  }

  function wouldCycle(parentId, childId) {
    let cur = parentId;
    while (cur) {
      if (cur === childId) return true;
      cur = boneById(cur)?.parentId || null;
    }
    return false;
  }

  function rotateSelectedJoint(deltaRad) {
    const bone = boneById(selectedId);
    if (!bone) {
      onStatus?.("error", "Select a bone to rotate.");
      return;
    }
    const axis = asVec3(bone.jointAxis, [0, 0, 1]);
    const idx = Math.abs(axis[0]) > 0.5 ? 0 : Math.abs(axis[1]) > 0.5 ? 1 : 2;
    if (!Array.isArray(bone.rotation)) bone.rotation = asVec3(bone.rotation);
    bone.rotation[idx] = (bone.rotation[idx] || 0) + deltaRad;
    const lim = bone.limits || { lower: -3.14, upper: 3.14 };
    bone.rotation[idx] = Math.max(lim.lower, Math.min(lim.upper, bone.rotation[idx]));
    renderAll();
    scheduleSave();
  }

  function jointAxisIndex(bone) {
    const axis = asVec3(bone?.jointAxis, [0, 0, 1]);
    return Math.abs(axis[0]) > 0.5 ? 0 : Math.abs(axis[1]) > 0.5 ? 1 : 2;
  }

  function jointControls() {
    return bones
      .filter((bone) => bone.jointType !== "fixed")
      .map((bone) => {
        const idx = jointAxisIndex(bone);
        const lim = bone.limits || { lower: -3.14, upper: 3.14 };
        const rotation = asVec3(bone.rotation);
        return {
          id: bone.id,
          name: bone.name || bone.id,
          jointType: bone.jointType || "revolute",
          axis: asVec3(bone.jointAxis, [0, 0, 1]),
          lower: Number.isFinite(Number(lim.lower)) ? Number(lim.lower) : -3.14,
          upper: Number.isFinite(Number(lim.upper)) ? Number(lim.upper) : 3.14,
          value: Number(rotation[idx]) || 0,
        };
      });
  }

  function setJointValue(id, valueRad) {
    const bone = boneById(id);
    if (!bone || bone.jointType === "fixed") return false;
    const idx = jointAxisIndex(bone);
    const lim = bone.limits || { lower: -3.14, upper: 3.14 };
    const lower = Number.isFinite(Number(lim.lower)) ? Number(lim.lower) : -3.14;
    const upper = Number.isFinite(Number(lim.upper)) ? Number(lim.upper) : 3.14;
    const value = Math.max(lower, Math.min(upper, Number(valueRad) || 0));
    bone.rotation = asVec3(bone.rotation);
    bone.rotation[idx] = value;
    selectedId = id;
    renderAll();
    scheduleSave();
    return true;
  }

  function exportUrdfText() {
    const lines = ['<?xml version="1.0"?>', '<robot name="render3d_rig">'];
    for (const bone of bones) {
      lines.push(`  <link name="${bone.name}">`);
      lines.push("    <visual><geometry><sphere radius=\"0.05\"/></geometry></visual>");
      lines.push("  </link>");
    }
    for (const bone of bones) {
      if (!bone.parentId) continue;
      const parent = boneById(bone.parentId);
      if (!parent) continue;
      const jname = `joint_${parent.name}_to_${bone.name}`;
      const jtype = bone.jointType === "fixed" ? "fixed" : "revolute";
      const axis = bone.jointAxis || [0, 0, 1];
      const origin = bone.position;
      lines.push(`  <joint name="${jname}" type="${jtype}">`);
      lines.push(`    <parent link="${parent.name}"/>`);
      lines.push(`    <child link="${bone.name}"/>`);
      lines.push(`    <origin xyz="${origin.join(" ")}" rpy="${(bone.rotation || [0, 0, 0]).join(" ")}"/>`);
      if (jtype === "revolute") {
        lines.push(`    <axis xyz="${axis.join(" ")}"/>`);
        const lim = bone.limits || { lower: -3.14, upper: 3.14 };
        lines.push(`    <limit lower="${lim.lower}" upper="${lim.upper}" effort="10" velocity="1"/>`);
      }
      lines.push("  </joint>");
    }
    lines.push("</robot>");
    return lines.join("\n");
  }

  async function exportUrdf() {
    const projectId = getProjectId?.();
    if (!projectId || !api) return;
    try {
      const data = await api(`/api/projects/${projectId}/rigging/export-urdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serialize()),
      });
      const sidecar = data.animation_filename ? ` Animation keyframes saved to ${data.animation_filename}.` : "";
      onStatus?.("ok", `${data.message || "URDF exported."}${sidecar}`);
      onChange?.();
    } catch (err) {
      onStatus?.("error", err.message || "URDF export failed.");
    }
  }

  function setTool(next) {
    tool = next;
    connectFromId = null;
    rotateDrag = null;
    if (active) onStatus?.("ok", `Rigging tool: ${next}`);
  }

  function show() {
    active = true;
    return load().then(() => {
      const n = refreshMeshBindings();
      syncBoneOverlayVisibility();
      onStatus?.(
        "ok",
        n >= 2
          ? `Rigging — ${n} gears bound. Press Play to spin the CAD model.`
          : "Rigging — load the gear GLB on SOLID, then press Play here."
      );
    });
  }

  function hide() {
    active = false;
    dragBoneId = null;
    connectFromId = null;
    rotateDrag = null;
    stopPlayback();
    meshDriver.resetMeshes();
    meshDriver.clear();
    group.visible = false;
  }

  function clearRig() {
    bones = [];
    animations = [defaultAnimation([])];
    activeAnimationId = animations[0].id;
    selectedId = null;
    connectFromId = null;
    renderAll();
    scheduleSave();
    onStatus?.("ok", "Rig cleared.");
  }

  function ndc(event) {
    const rect = dom.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  function raycastBones(event) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc(event), camera);
    const hits = rc.intersectObjects([...boneMeshes.values()], false);
    return hits[0]?.object?.userData?.boneId || null;
  }

  function raycastPlacement(event) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc(event), camera);
    const root = getMeshRoot?.();
    if (root) {
      const hits = rc.intersectObject(root, true);
      if (hits[0]) return hits[0].point.clone();
    }
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    if (rc.ray.intersectPlane(plane, hit)) return hit;
    return null;
  }

  function onPointerDown(e) {
    if (!active || e.button !== 0) return;
    const boneId = raycastBones(e);
    if (tool === "add") {
      e.preventDefault();
      e.stopPropagation();
      addBone(raycastPlacement(e));
      return;
    }
    if (tool === "connect") {
      e.preventDefault();
      e.stopPropagation();
      if (!boneId) {
        onStatus?.("error", "Click a bone to connect.");
        return;
      }
      if (!connectFromId) {
        connectFromId = boneId;
        selectedId = boneId;
        renderAll();
        onStatus?.("ok", "Connect: click the child bone.");
        return;
      }
      connectBones(connectFromId, boneId);
      connectFromId = null;
      return;
    }
    if (tool === "rotate" && boneId) {
      e.preventDefault();
      e.stopPropagation();
      selectedId = boneId;
      rotateDrag = { boneId, lastX: e.clientX };
      renderAll();
      return;
    }
    if (boneId) {
      e.preventDefault();
      e.stopPropagation();
      selectedId = boneId;
      if (tool === "move") dragBoneId = boneId;
      renderAll();
      return;
    }
    if (tool === "select") {
      selectedId = null;
      renderAll();
    }
  }

  function onPointerMove(e) {
    if (!active) return;
    if (rotateDrag) {
      const dx = e.clientX - rotateDrag.lastX;
      rotateDrag.lastX = e.clientX;
      selectedId = rotateDrag.boneId;
      rotateSelectedJoint(dx * 0.01);
      return;
    }
    if (!dragBoneId) return;
    const hit = raycastPlacement(e);
    if (!hit) return;
    const bone = boneById(dragBoneId);
    if (!bone) return;
    bone.position = [hit.x, hit.y, hit.z];
    renderAll();
  }

  function onPointerUp() {
    if (dragBoneId || rotateDrag) {
      dragBoneId = null;
      rotateDrag = null;
      scheduleSave();
    }
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.target?.matches("input, textarea, select")) return;
    if (e.code === "Space") {
      e.preventDefault();
      animTimeline?.togglePlay();
    }
    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      insertKeyframe();
    }
  }

  dom.addEventListener("pointerdown", onPointerDown, true);
  dom.addEventListener("pointermove", onPointerMove, true);
  dom.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("keydown", onKeyDown);

  return {
    show,
    hide,
    load,
    save,
    clearRig,
    addBone: () => addBone(null),
    deleteSelected,
    setTool,
    autoRigChain,
    simulateModel,
    insertKeyframe,
    exportUrdf,
    exportUrdfText,
    applyRigData,
    refreshMeshBindings,
    isActive: () => active,
    getTool: () => tool,
    getBones: () => bones,
    getJointControls: jointControls,
    setJointValue,
    getSelectedId: () => selectedId,
    togglePlay: () => animTimeline?.togglePlay(),
    setPlaying: (p) => (p ? startPlayback() : stopPlayback()),
  };
}
