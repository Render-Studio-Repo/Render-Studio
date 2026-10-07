import { animationPlan, collectAnimationClips, findAnimationConfig, validateAnimationClips } from './mesh-animation-contract.js?v=20261001-animation-integrity';

export function bakeMeshAnimationClips(THREE, root, opts = {}) {
  if (!THREE || !root) return [];
  const existing = collectAnimationClips(root);
  if (existing.length) return validateAnimationClips(THREE, root, existing);
  const fps = Math.max(12, Math.min(60, Number(opts.fps) || 30));
  return animationPlan(root).map((entry) => {
    const { object, kind, speed, amplitude, frequency } = entry;
    const rate = kind === 'spin' ? Math.abs(speed) / (2 * Math.PI) : Math.abs(frequency);
    const moving = rate > 0 && (kind === 'spin' || amplitude !== 0);
    const period = moving ? 1 / rate : 1;
    if (!Number.isFinite(period) || period > 3600) throw new Error('Animation period exceeds one hour; use zero for stationary parts');
    const cycles = Math.max(1, Math.ceil((Number(opts.duration) || period) / period));
    const duration = cycles * period;
    const frames = Math.max(33 * cycles, Math.ceil(duration * fps) + 1);
    if (frames > 120000) throw new Error('Animation exceeds the keyframe budget');
    const times = new Float32Array(frames);
    const values = new Float32Array(frames * 4);
    const axis = new THREE.Vector3(...entry.axis);
    const base = object.quaternion.clone();
    for (let i = 0; i < frames; i += 1) {
      times[i] = duration * i / (frames - 1);
      const phase = i / (frames - 1) * cycles;
      const angle = !moving ? 0 : kind === 'spin' ? Math.sign(speed) * phase * 2 * Math.PI
        : Math.sin(Math.sign(frequency) * phase * 2 * Math.PI) * amplitude;
      const quaternion = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      quaternion.toArray(values, i * 4);
    }
    const track = new THREE.QuaternionKeyframeTrack(`${object.uuid}.quaternion`, times, values);
    return new THREE.AnimationClip(`${kind}_${object.name}`, times[frames - 1], [track]);
  });
}

export function meshHasExportableAnimation(root) {
  if (collectAnimationClips(root).length) return true;
  return animationPlan(root).length > 0;
}

export { findAnimationConfig };
