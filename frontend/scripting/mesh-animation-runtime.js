import * as THREE from 'three';
import { bakeMeshAnimationClips } from './mesh-animation-bake.js?v=20261001-animation-integrity';
import { extractAnimationLiteral } from './mesh-animation-contract.js?v=20261001-animation-integrity';

export const extractAnimationFromMeshMjs = extractAnimationLiteral;

export function createMeshAnimationRuntime() {
  let root = null;
  let mixer = null;
  let playing = false;
  let clips = [];
  let actions = [];

  function release() {
    if (mixer) {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    }
    mixer = null;
    clips = [];
    actions = [];
    playing = false;
  }

  function chooseActions(selected = null) {
    mixer.stopAllAction();
    const properties = new Set();
    actions = [];
    for (const clip of clips) {
      if (selected && clip.name !== selected) continue;
      const bindings = clip.tracks.map((track) => {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        const object = THREE.PropertyBinding.findNode(root, parsed.nodeName);
        return `${object.uuid}:${parsed.objectName || ''}:${parsed.objectIndex || ''}:${parsed.propertyName}:${parsed.propertyIndex || ''}`;
      });
      if (bindings.some(binding => properties.has(binding))) continue;
      bindings.forEach(binding => properties.add(binding));
      const action = mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      action.paused = !playing;
      actions.push(action);
    }
  }

  function bind() {
    clips = bakeMeshAnimationClips(THREE, root);
    if (!clips.length) return false;
    mixer = new THREE.AnimationMixer(root);
    chooseActions();
    return true;
  }

  function stop() {
    playing = false;
    if (!mixer) return;
    for (const action of actions) { action.reset(); action.paused = false; action.play(); }
    mixer.timeScale = 1;
    mixer.setTime(0);
    for (const action of actions) action.paused = true;
  }

  return {
    attach(object) { release(); root = object || null; return root ? bind() : false; },
    injectAnimation(config) {
      if (!root || !config) return false;
      if (mixer) return true;
      const previous = root.userData.animation;
      root.userData.animation = config;
      try { return bind(); } catch (error) { root.userData.animation = previous; throw error; }
    },
    play() { if (!mixer) return; playing = true; for (const action of actions) action.paused = false; },
    pause() { playing = false; for (const action of actions) action.paused = true; },
    stop,
    resetPose: stop,
    isPlaying: () => playing,
    hasAnimation: () => actions.length > 0,
    clipNames: () => clips.map(clip => clip.name),
    activeClipNames: () => actions.map(action => action.getClip().name),
    selectClip(name) {
      if (!mixer || !clips.some(clip => clip.name === name)) return false;
      chooseActions(name);
      return true;
    },
    update(dt) { if (playing && mixer && Number.isFinite(dt) && dt >= 0) mixer.update(dt); },
    dispose() { release(); root = null; },
  };
}
