import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../backend/skills/img2threejs/scripts/node_modules/three/build/three.module.js';
import '../../backend/skills/img2threejs/scripts/node_shims.js';
import { GLTFExporter } from '../../backend/skills/img2threejs/scripts/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from '../../backend/skills/img2threejs/scripts/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { bakeMeshAnimationClips, meshHasExportableAnimation } from './mesh-animation-bake.js';
import { bakeMeshAnimationClips as backendBake } from '../../backend/skills/img2threejs/scripts/bake_mesh_animation.mjs';
import { extractAnimationLiteral } from './mesh-animation-contract.js';

const runtimeSource = readFileSync(new URL('./mesh-animation-runtime.js', import.meta.url), 'utf8')
  .replace("from 'three'", `from '${new URL('../../backend/skills/img2threejs/scripts/node_modules/three/build/three.module.js', import.meta.url).href}'`)
  .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL(path, import.meta.url).href}'`);
const { createMeshAnimationRuntime } = await import(`data:text/javascript;base64,${Buffer.from(runtimeSource).toString('base64')}`);

function model(config, name = 'Pivot') {
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(7, 8, 9);
  pivot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial()));
  root.add(pivot);
  if (config) root.userData.animation = config;
  return { root, pivot };
}

test('source sidecars parse literals and arithmetic without executing expressions', () => {
  const config = extractAnimationLiteral("root.userData.animation = {oscillations:[{targets:['Pivot'], amplitude:Math.PI / 4, frequency:.5, axis:[0,1,0],}],};");
  assert.equal(config.oscillations[0].amplitude, Math.PI / 4);
  assert.equal(config.oscillations[0].frequency, .5);
  globalThis.animationTestExecuted = false;
  assert.equal(extractAnimationLiteral('root.userData.animation = {oscillations:(globalThis.animationTestExecuted=true, [])};'), null);
  assert.equal(globalThis.animationTestExecuted, false);
  assert.equal(extractAnimationLiteral('root.userData.animation = {__proto__: {polluted:true}};'), null);
});

for (const speed of [-20, -.1, 0, .1, 1, 20]) {
  test(`spin ${speed} has a closed loop and preserves requested rate`, () => {
    const { root } = model({ continuousRotations: [{ targets: ['Pivot'], speed }] });
    const clip = bakeMeshAnimationClips(THREE, root)[0];
    const values = clip.tracks[0].values;
    const start = new THREE.Quaternion().fromArray(values);
    const end = new THREE.Quaternion().fromArray(values, values.length - 4);
    assert.ok(start.angleTo(end) < 1e-5);
    if (speed) assert.ok(Math.abs(clip.duration - 2 * Math.PI / Math.abs(speed)) < 1e-5);
    else assert.ok(values.every((v, i) => Math.abs(v - values[i % 4]) < 1e-6));
  });
}

test('zero amplitude and frequency remain stationary; rpm is converted to radians per second', () => {
  for (const entry of [{ amplitude: 0 }, { frequency: 0 }]) {
    const { root } = model({ oscillations: [{ targets: ['Pivot'], ...entry }] });
    const values = bakeMeshAnimationClips(THREE, root)[0].tracks[0].values;
    assert.ok(values.every((v, i) => Math.abs(v - values[i % 4]) < 1e-6));
  }
  const { root } = model({ continuousRotations: [{ targets: ['Pivot'], rpm: 60 }] });
  assert.equal(bakeMeshAnimationClips(THREE, root)[0].duration, 1);
});

test('backend and browser share the same baker', () => assert.equal(backendBake, bakeMeshAnimationClips));

test('runtime and exported default-axis oscillations use the same motion', () => {
  const { root, pivot } = model({ oscillations: [{ targets: ['Pivot'], amplitude: .3, frequency: .5 }] });
  const clips = bakeMeshAnimationClips(THREE, root);
  const runtime = createMeshAnimationRuntime();
  runtime.attach(root); runtime.play(); runtime.update(.25);
  const actual = pivot.quaternion.clone();
  runtime.stop();
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clips[0]).play(); mixer.update(.25);
  assert.ok(actual.angleTo(pivot.quaternion) < 1e-6);
  assert.equal(pivot.quaternion.z, 0);
});

test('missing, ambiguous, overlapping, and nonfinite animation definitions fail closed', () => {
  const { root, pivot } = model({ continuousRotations: [{ targets: ['Missing'] }] });
  assert.throws(() => bakeMeshAnimationClips(THREE, root), /missing/);
  root.userData.animation.continuousRotations[0].targets = ['Pivot'];
  root.add(pivot.clone());
  assert.throws(() => bakeMeshAnimationClips(THREE, root), /ambiguous/);
  root.remove(root.children[1]);
  root.userData.animation.oscillations = [{ targets: ['Pivot'] }];
  assert.throws(() => bakeMeshAnimationClips(THREE, root), /Multiple rotation actions/);
  delete root.userData.animation.oscillations;
  root.userData.animation.continuousRotations[0].axis = [0, NaN, 1];
  assert.throws(() => bakeMeshAnimationClips(THREE, root), /finite/);
});

test('attach, pause, stop and dispose retain rest pose and reset playing identity', () => {
  const { root, pivot } = model({ continuousRotations: [{ targets: ['Pivot'], speed: 2 }] });
  const runtime = createMeshAnimationRuntime();
  runtime.attach(root); runtime.play(); runtime.update(.2);
  assert.ok(pivot.quaternion.angleTo(new THREE.Quaternion()) > .3);
  runtime.pause(); const paused = pivot.quaternion.clone(); runtime.update(2);
  assert.ok(paused.equals(pivot.quaternion));
  runtime.stop(); assert.ok(pivot.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
  runtime.play(); runtime.attach(model(null).root);
  assert.equal(runtime.isPlaying(), false);
  assert.equal(runtime.hasAnimation(), false);
  runtime.dispose();
});

test('imported clips survive rebaking and playback without procedural metadata', () => {
  const { root, pivot } = model(null);
  const clip = new THREE.AnimationClip('move', 1, [new THREE.NumberKeyframeTrack('Pivot.position[x]', [0, 1], [7, 17])]);
  root.animations = [clip];
  assert.equal(meshHasExportableAnimation(root), true);
  assert.equal(bakeMeshAnimationClips(THREE, root)[0], clip);
  const runtime = createMeshAnimationRuntime();
  runtime.attach(root); runtime.play(); runtime.update(.25);
  assert.equal(pivot.position.x, 9.5);
  runtime.stop(); assert.equal(pivot.position.x, 7);
});

test('alternative imported clips are retained and never blended accidentally', () => {
  const { root, pivot } = model(null);
  root.animations = [
    new THREE.AnimationClip('forward', 1, [new THREE.NumberKeyframeTrack('Pivot.position[x]', [0, 1], [7, 17])]),
    new THREE.AnimationClip('backward', 1, [new THREE.NumberKeyframeTrack('Pivot.position[x]', [0, 1], [7, -3])]),
  ];
  assert.equal(bakeMeshAnimationClips(THREE, root).length, 2);
  const runtime = createMeshAnimationRuntime();
  runtime.attach(root); runtime.play(); runtime.update(.25);
  assert.equal(pivot.position.x, 9.5);
  assert.deepEqual(runtime.activeClipNames(), ['forward']);
  runtime.selectClip('backward'); runtime.update(.25);
  assert.equal(pivot.position.x, 4.5);
});

test('real GLB export and reload preserve pivot, clips and targets with sanitized names', async () => {
  const { root } = model({ continuousRotations: [{ targets: ['Wheel.FL'], speed: .1 }] }, 'Wheel.FL');
  const clips = bakeMeshAnimationClips(THREE, root);
  const buffer = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips, trs: true });
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  gltf.scene.animations = gltf.animations;
  const pivot = gltf.scene.getObjectByName('WheelFL');
  assert.deepEqual(pivot.position.toArray(), [7, 8, 9]);
  const rebaked = bakeMeshAnimationClips(THREE, gltf.scene);
  assert.equal(rebaked.length, 1);
  assert.equal(rebaked[0], gltf.animations[0]);
  const runtime = createMeshAnimationRuntime(); runtime.attach(gltf.scene); runtime.play(); runtime.update(.25);
  assert.ok(pivot.quaternion.angleTo(new THREE.Quaternion()) > .02);
});
