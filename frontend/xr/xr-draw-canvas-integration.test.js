import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createXrAiBoardStore } from './xr-ai-board-state.js';
import { createBoardSnapshot, boardPromptContext } from './xr-ai-board-graph.js';

test('canvas enabled and pose roundtrip with undo and serialized project state', () => {
  const board = createXrAiBoardStore({ projectId: 'p' });
  const pose = { position: [1, 2, -3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
  board.dispatch({ type: 'board.update', patch: { canvas: { enabled: true, pose } } });
  const restored = createXrAiBoardStore(JSON.parse(JSON.stringify(board.exportState())));
  assert.deepEqual(restored.getState().canvas, { enabled: true, pose });
  board.undo(); assert.equal(board.getState().canvas.enabled, false);
  board.redo(); assert.equal(board.getState().canvas.enabled, true);
});

test('generation snapshot includes canvas and disconnected full geometry regardless of selection', () => {
  const board = createXrAiBoardStore({ projectId: 'p', canvas: { enabled: true, pose: { position: [0, 1, -2] } } });
  board.dispatch({ type: 'node.add', node: { id: 'photo', kind: 'image', source: { filename: 'chair.png' } } });
  board.dispatch({ type: 'drawing.add', drawing: { id: 'stroke', tool: 'pen', points: [[0, 1, 2], [3, 4, 5]] } });
  board.dispatch({ type: 'selection.set', ids: ['photo'] });
  const snapshot = createBoardSnapshot(board.getState());
  assert.equal(snapshot.canvas.enabled, true);
  assert.deepEqual(snapshot.graph.drawings[0].points, [[0, 1, 2], [3, 4, 5]]);
  assert.match(boardPromptContext(board.getState()).text, /Drawing \[stroke\].*2 vertices/);
  board.dispatch({ type: 'drawing.remove', id: 'stroke' });
  assert.equal(snapshot.graph.drawings.length, 1);
  assert.equal(Object.isFrozen(snapshot.graph.drawings[0].points), true);
});

async function workspaceFixture(api, options = {}) {
  let ui = false, point = 0, drawingSamples = 0, enabled = false;
  const statuses = [];
  const view = { objects: new Map(), sync() {}, paint() {}, live() {}, hover() {}, setVisible() {}, update() {}, dispose() {}, isLineBudgetExceeded: () => false,
    pickUI: () => ui ? { id: 'chrome' } : null, pick: () => null, pickBounds: () => null,
    drawingPoint: () => { drawingSamples++; return { toArray: () => [point++, 1, -2] }; },
    canvasPlane: { setEnabled: value => { enabled = value; }, isEnabled: () => enabled, getPose: () => ({ position: [0, 1, -2], quaternion: [0, 0, 0, 1] }) },
  };
  globalThis[Symbol.for('draw-canvas-test-view')] = view;
  const file = new URL('./xr-ai-draw-workspace.js', import.meta.url);
  const source = (await readFile(file, 'utf8')).replace(/^import \{ createXrAiDrawView, DRAW_VIEW_LIMITS \}[^\n]+/m,
    "const createXrAiDrawView = () => globalThis[Symbol.for('draw-canvas-test-view')]; const DRAW_VIEW_LIMITS = {nodes:12,images:6};")
    .replace(/from '(\.\/[^']+)'/g, (_match, relative) => `from '${new URL(relative, file).href}'`);
  const { createXrAiDrawWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const workspace = createXrAiDrawWorkspace({ THREE: { Matrix4: class {}, Vector3: class {}, Quaternion: class {} },
    getProjectId: () => 'p', onStatus: status => statuses.push(status), api, ...options });
  await workspace.open();
  return { workspace, statuses, setUI: value => { ui = value; }, sampleCount: () => drawingSamples };
}

test('a trigger press on UI cannot turn into a stroke while held away from UI', async () => {
  const f = await workspaceFixture();
  try {
    await f.workspace.action('canvas'); await f.workspace.action('tool', 'pen');
    f.setUI(true); f.workspace.sample(1, {}, true);
    f.setUI(false); f.workspace.sample(1, {}, true); f.workspace.sample(1, {}, false);
    assert.equal(f.sampleCount(), 0);
    assert.equal(Object.keys(f.workspace.board.getState().drawings).length, 0);
    f.workspace.sample(1, {}, true);
    await new Promise(resolve => setTimeout(resolve, 40));
    f.workspace.sample(1, {}, true); f.workspace.sample(1, {}, false);
    assert.equal(Object.keys(f.workspace.board.getState().drawings).length, 1);
  } finally { f.workspace.dispose(); }
});

test('Save canvas reports failure and retains unsaved geometry when storage rejects', async () => {
  const f = await workspaceFixture(async (_url, options) => {
    if (options?.method === 'PUT') throw new Error('Disk unavailable');
    throw Object.assign(new Error('404 canvas board not found'), { status: 404 });
  });
  try {
    await f.workspace.action('canvas');
    f.workspace.board.dispatch({ type: 'drawing.add', drawing: { id: 'keep', points: [[0, 0, 0], [1, 1, 1]] } });
    await f.workspace.action('save');
    assert.match(f.statuses.at(-1), /could not be saved/);
    assert.ok(f.workspace.board.getState().drawings.keep);
    assert.ok(!f.statuses.some(status => /^Canvas saved/.test(status)));
  } finally { f.workspace.dispose(); }
});

test('explicit Generate submits a drawing with an empty composer and snapshot supports outer submit', async () => {
  const generated = [];
  const f = await workspaceFixture(undefined, { getPromptDraft: () => '', onGenerate: snapshot => { generated.push(snapshot); return { ok: true }; } });
  try {
    f.workspace.board.dispatch({ type: 'drawing.add', drawing: { id: 'design', points: [[0, 0, 0], [1, 1, 0], [2, 0, 0]] } });
    const snapshot = f.workspace.snapshot();
    assert.match(snapshot.prompt, /Generate a model from the Draw design/);
    assert.match(snapshot.prompt, /Drawing \[design\].*3 vertices/);
    assert.equal(generated.length, 0, 'capturing a design never submits it');
    await f.workspace.action('generate');
    assert.equal(generated.length, 1);
    assert.equal(generated[0].graph.drawings[0].id, 'design');
    assert.ok(generated[0].prompt.trim());
  } finally { f.workspace.dispose(); }
});

test('empty canvas and blank notes do not become a fabricated generation prompt', async () => {
  const generated = [];
  const f = await workspaceFixture(undefined, { onGenerate: snapshot => generated.push(snapshot) });
  try {
    await f.workspace.action('canvas');
    f.workspace.board.dispatch({ type: 'note.add', note: { id: 'blank', text: '   ' } });
    assert.equal(f.workspace.snapshot().prompt, '');
    await f.workspace.action('generate');
    assert.equal(generated.length, 0);
    assert.match(f.statuses.at(-1), /Draw a shape/);
  } finally { f.workspace.dispose(); }
});

test('text-only board gets a fallback while an existing human prompt is preserved exactly', async () => {
  let draft = '';
  const f = await workspaceFixture(undefined, { getPromptDraft: () => draft });
  try {
    f.workspace.board.dispatch({ type: 'note.add', note: { id: 'intent', text: 'A 40 mm wide bracket with two bolt holes.' } });
    assert.match(f.workspace.snapshot().prompt, /40 mm wide bracket/);
    draft = '  Keep my custom instructions exactly.  ';
    assert.equal(f.workspace.snapshot().prompt, draft);
  } finally { f.workspace.dispose(); }
});
