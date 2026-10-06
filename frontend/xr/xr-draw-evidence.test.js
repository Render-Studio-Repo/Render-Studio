import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDrawEvidence, DRAW_DESIGN_DISCUSSION_INSTRUCTIONS } from './xr-draw-evidence.js';

test('whole-board evidence retains disconnected geometry and linked image notes', () => {
  const state = { selectedIds: ['image'], nodes: { image: { id: 'image', kind: 'image', source: { units: 'mm' }, transform: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] } } },
    drawings: { stroke: { id: 'stroke', points: [[0, 0, 0], [1, 2, 3]] } },
    notes: { note: { id: 'note', text: 'Match silhouette' } }, links: { link: { id: 'link', fromId: 'image', toId: 'note' } } };
  const original = JSON.stringify(state), result = collectDrawEvidence(state);
  assert.deepEqual(result.drawings[0].points, [[0, 0, 0], [1, 2, 3]]);
  assert.deepEqual(result.nodes[0].transform.position, [1, 2, 3]);
  assert.equal(result.nodes[0].source.units, 'mm');
  assert.equal(result.notes[0].text, 'Match silhouette');
  assert.equal(result.links[0].toId, 'note');
  assert.equal(result.truncated, false);
  result.drawings[0].points[0][0] = 99;
  assert.equal(JSON.stringify(state), original);
});

test('local geometry retains anchor coordinates, normal and face identity', () => {
  const result = collectDrawEvidence({ regions: { face: { id: 'face', anchor: { nodeId: 'model', faceId: 0, localNormal: [0, 1, 0], localPoints: [[1, 2, 3]] } } } });
  assert.equal(result.regions[0].coordinateSpace, 'node-local');
  assert.deepEqual(result.regions[0].points, [[1, 2, 3]]);
  assert.equal(result.regions[0].anchor.faceId, '0');
  assert.deepEqual(result.regions[0].anchor.localNormal, [0, 1, 0]);
  const anchoredStroke = collectDrawEvidence({ drawings: { line: { id: 'line', points: [[3, 2, 1]], anchor: { nodeId: 'model' } } } });
  assert.equal(anchoredStroke.drawings[0].coordinateSpace, 'node-local');
});

test('bounded geometry sampling retains endpoints and reports omissions', () => {
  const result = collectDrawEvidence({ drawings: { stroke: { id: 'stroke', points: Array.from({ length: 10000 }, (_, i) => [i, i / 2, 0]) } } }, { maxBytes: 2000 });
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= 2000);
  assert.deepEqual(result.drawings[0].points[0], [0, 0, 0]);
  assert.deepEqual(result.drawings[0].points.at(-1), [9999, 4999.5, 0]);
  assert.equal(result.geometry.totalPoints, 10000);
  assert.equal(result.geometry.sampledPoints, 10000 - result.drawings[0].points.length);
  assert.equal(result.truncated, true);
});

test('invalid coordinates and text omissions respect UTF-8 budget', () => {
  const result = collectDrawEvidence({ drawings: { stroke: { id: 'stroke', points: [[0, 0, 0], [Infinity, 0, 0], ['1', 2, 3], [1, 2]] } },
    notes: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, { id: String(i), text: '大'.repeat(3000) }])) }, { maxBytes: 1024 });
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= 1024);
  assert.equal(result.geometry.invalidPoints, 3);
  assert.equal(result.totals.notes, 100);
  assert.equal(result.omitted.notes + result.notes.length, 100);
  assert.ok(result.omitted.notes > 0);
  assert.ok(result.clippedTextCharacters > 0);
  assert.throws(() => collectDrawEvidence({}, { maxBytes: 2 }), RangeError);
});

test('readiness requires explicit human generation confirmation', () => {
  assert.match(DRAW_DESIGN_DISCUSSION_INSTRUCTIONS, /Selection indicates focus/);
  assert.match(DRAW_DESIGN_DISCUSSION_INSTRUCTIONS, /say the design is ready to submit/);
  assert.match(DRAW_DESIGN_DISCUSSION_INSTRUCTIONS, /press Generate/);
});
