export function collectAnimationClips(root) {
  const clips = new Set();
  root?.traverse?.((node) => {
    for (const clip of [...(node.animations || []), ...(node.userData?.gltfAnimations || [])]) if (clip) clips.add(clip);
  });
  return [...clips];
}

export function findAnimationConfig(root) {
  let config = null;
  root?.traverse?.((node) => {
    if (!config && node.userData?.animation && typeof node.userData.animation === 'object') config = node.userData.animation;
  });
  return config;
}

function finite(value, fallback, field) {
  const result = value == null ? fallback : Number(value);
  if (!Number.isFinite(result)) throw new Error(`Animation ${field} must be finite`);
  return result;
}

export function animationPlan(root) {
  const config = findAnimationConfig(root);
  if (!config) return [];
  const entries = [];
  const add = (kind, values) => { for (const entry of [].concat(values || [])) entries.push({ kind, entry }); };
  add('spin', config.continuousRotations);
  add('spin', config.continuous_rotations);
  add('oscillation', config.oscillations);
  add('oscillation', config.steering_oscillation);
  add('oscillation', config.steeringOscillation);
  const reserved = new Set(['continuousRotations', 'continuous_rotations', 'oscillations', 'steering_oscillation', 'steeringOscillation']);
  for (const [key, entry] of Object.entries(config)) {
    if (reserved.has(key) || !entry || Array.isArray(entry) || typeof entry !== 'object') continue;
    if (/oscillat|steer|sway|bob/i.test(key)) add('oscillation', entry);
    else if (/rotation|spin|wheel|crank|propeller/i.test(key) || entry.continuous === true
      || entry.speed != null || entry.speedRadiansPerSecond != null) add('spin', entry);
  }
  const names = new Map();
  root.traverse((node) => {
    if (!names.has(node.name)) names.set(node.name, []);
    names.get(node.name).push(node);
  });
  const driven = new Set(), plan = [];
  for (const { kind, entry } of entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Animation entry must be an object');
    const targets = [].concat(entry.targets ?? entry.names ?? entry.target ?? []);
    if (!targets.length) throw new Error('Animation entry has no targets');
    const axis = entry.axis ?? (kind === 'spin' ? [0, 0, 1] : [0, 1, 0]);
    if (!Array.isArray(axis) || axis.length !== 3 || !axis.every(Number.isFinite)
      || Math.hypot(...axis) < 1e-8) throw new Error('Animation axis must be a finite nonzero three-vector');
    const speed = finite(entry.speed ?? entry.speedRadiansPerSecond ?? entry.speed_radians_per_second
      ?? (entry.rpm == null ? undefined : finite(entry.rpm, 0, 'rpm') * Math.PI / 30), 1, 'speed');
    const amplitude = finite(entry.amplitude ?? entry.amplitudeRadians ?? entry.amplitude_radians ?? entry.angle, .2, 'amplitude');
    const frequency = finite(entry.frequency ?? entry.frequencyHz ?? entry.frequency_hz ?? entry.hz, .5, 'frequency');
    for (const name of targets) {
      const candidates = names.get(String(name)) || [];
      if (candidates.length !== 1) throw new Error(`Animation target ${JSON.stringify(name)} is ${candidates.length ? 'ambiguous' : 'missing'}`);
      const object = candidates[0];
      if (driven.has(object)) throw new Error(`Multiple rotation actions target ${JSON.stringify(name)}. Use separate nested pivots.`);
      driven.add(object);
      plan.push({ kind, object, axis: axis.map(v => v / Math.hypot(...axis)), speed, amplitude, frequency });
    }
  }
  return plan;
}

export function validateAnimationClips(THREE, root, clips) {
  for (const clip of clips) {
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || !clip.tracks?.length) throw new Error('Animation clip must have finite duration and tracks');
    const driven = new Set();
    for (const track of clip.tracks) {
      if (!track.times?.length || !track.values?.length || ![...track.times, ...track.values].every(Number.isFinite)
        || !track.validate()) throw new Error(`Animation track ${track.name} is invalid`);
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      const node = THREE.PropertyBinding.findNode(root, parsed.nodeName);
      if (!node) throw new Error(`Animation track ${track.name} has no target`);
      const binding = `${node.uuid}:${parsed.objectName || ''}:${parsed.objectIndex || ''}:${parsed.propertyName}:${parsed.propertyIndex || ''}`;
      if (driven.has(binding)) throw new Error(`Multiple animation tracks drive ${track.name}`);
      driven.add(binding);
    }
  }
  return clips;
}

export function extractAnimationLiteral(source) {
  const match = /userData\.animation\s*=\s*(?=\{)/.exec(String(source || ''));
  if (!match) return null;
  const text = String(source).slice(match.index + match[0].length);
  let offset = 0;
  const token = /(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)|(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|Math\.(?:PI|E)\b|[A-Za-z_$][\w$]*|[{}\[\]():,;+*/-]/y;
  function next(consume = true) {
    let value;
    do {
      token.lastIndex = offset;
      const found = token.exec(text);
      if (!found) throw new Error('Unsupported animation literal');
      value = found[0];
      if (/^\s|^\/\//.test(value) || value.startsWith('/*')) offset = token.lastIndex;
      else break;
    } while (true);
    if (consume) offset = token.lastIndex;
    return value;
  }
  function expect(value) { if (next() !== value) throw new Error('Invalid animation literal'); }
  function string(value) {
    if (value[0] === '"') return JSON.parse(value);
    const inner = value.slice(1, -1).replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"');
    return JSON.parse(`"${inner}"`);
  }
  function atom() {
    const value = next();
    if (value === '{') {
      const object = {};
      while (next(false) !== '}') {
        const raw = next(), key = /^["']/.test(raw) ? string(raw) : raw;
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid animation key');
        expect(':'); object[key] = expression();
        if (next(false) !== ',') break;
        next();
      }
      expect('}'); return object;
    }
    if (value === '[') {
      const list = [];
      while (next(false) !== ']') {
        list.push(expression());
        if (next(false) !== ',') break;
        next();
      }
      expect(']'); return list;
    }
    if (value === '(') { const result = expression(); expect(')'); return result; }
    if (value === '+' || value === '-') { const result = atom(); if (typeof result !== 'number') throw new Error('Invalid numeric expression'); return value === '-' ? -result : result; }
    if (/^["']/.test(value)) return string(value);
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'Math.PI') return Math.PI;
    if (value === 'Math.E') return Math.E;
    if (/^[\d.]/.test(value)) return finite(value, 0, 'literal');
    throw new Error('Animation literals cannot execute code');
  }
  function expression(min = 0) {
    let left = atom();
    while (offset < text.length) {
      const op = next(false), precedence = ({ '+': 1, '-': 1, '*': 2, '/': 2 })[op];
      if (!precedence || precedence <= min) break;
      next(); const right = expression(precedence);
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error('Invalid arithmetic');
      left = op === '+' ? left + right : op === '-' ? left - right : op === '*' ? left * right : left / right;
      if (!Number.isFinite(left)) throw new Error('Invalid arithmetic');
    }
    return left;
  }
  try { return atom(); } catch { return null; }
}
