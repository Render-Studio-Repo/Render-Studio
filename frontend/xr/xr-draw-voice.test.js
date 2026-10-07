import test from 'node:test';
import assert from 'node:assert/strict';
import { createXrAiBoardStore } from './xr-ai-board-state.js';
import { createXrDrawVoice, DRAW_VOICE_CONTEXT_BYTES } from './xr-draw-voice.js';
import { voiceRealtimeConfig } from '../components/voice-agent-protocol.js';
import { compactXrAgentContext } from '../components/xr-agent-context.js';

function setup() {
  let projectId = 'project-a', active = true, organized = 0;
  const board = createXrAiBoardStore({ id: 'board-a', projectId });
  for (const node of [{ id: 'model', kind: 'model', name: 'Assembly', source: { filename: 'assembly.step', revision: 'r1', units: 'mm', dimensions: [800, 300, 250] } }, { id: 'photo', kind: 'image', name: 'Finish' }, { id: 'memo', kind: 'memo', name: 'Requirements', transcript: 'Make it serviceable' }]) board.dispatch({ type: 'node.add', node });
  for (const region of [{ id: 'region-a', nodeId: 'model', kind: 'lasso', name: 'Split area' }, { id: 'region-b', nodeId: 'model', kind: 'face', name: 'Other face' }]) board.dispatch({ type: 'region.add', region });
  board.dispatch({ type: 'selection.set', ids: ['region-a'] });
  const voice = createXrDrawVoice({ getBoard: () => active ? board : null, getProjectId: () => projectId, onOrganizePrompt: () => { organized++; } });
  return { board, voice, setProject: value => { projectId = value; }, setActive: value => { active = value; }, organized: () => organized };
}

test('split follow-up stays on original region after gaze changes and never invents printer dimensions', async () => {
  const { board, voice } = setup();
  const first = await voice.command({ action: 'annotate_split', text: 'Split here to fit my Bambu printer, and assemble afterward.', printerModel: 'Bambu', assembly: 'Reassemble after printing' });
  assert.equal(first.ok, true);
  assert.deepEqual(first.missingDetails, ['printerModel', 'jointStyle']);
  assert.equal(board.getState().notes[first.noteId].requirements.printerModel, '');
  assert.match(first.question, /Bambu printer model/);
  board.dispatch({ type: 'selection.set', ids: ['region-b'] });
  assert.equal(voice.getContext().selectedRegionId, 'region-b');
  assert.equal(voice.getContext().pendingClarification.regionId, 'region-a');
  const second = await voice.command({ action: 'answer_clarification', clarificationId: first.clarificationId, regionId: 'region-b', printerModel: 'Bambu P1S', jointStyle: 'Alignment pins and bolts', text: 'Use alignment pins and bolts.' });
  assert.equal(second.regionId, 'region-a');
  assert.equal(board.getState().notes[first.noteId].regionId, 'region-a');
  assert.equal(board.getState().notes[first.noteId].requirements.printerModel, 'Bambu P1S');
  assert.deepEqual(second.missingDetails, []);
  assert.equal(voice.getContext().pendingClarification, null);
  assert.doesNotMatch(board.getState().notes[first.noteId].text, /256|build.?plate.*\d/i);
  board.undo();
  assert.equal(board.getState().notes[first.noteId].requirements.printerModel, '');
});

test('pending answers require their ID and reject deleted regions, changed projects or closed Draw', async () => {
  const f = setup();
  const first = await f.voice.command({ action: 'annotate_split', text: 'Split this' });
  assert.equal((await f.voice.command({ action: 'answer_clarification', clarificationId: 'other', printerModel: 'P1S' })).ok, false);
  f.board.dispatch({ type: 'region.remove', id: 'region-a' });
  assert.equal((await f.voice.command({ action: 'answer_clarification', clarificationId: first.clarificationId })).ok, false);
  f.setProject('project-b');
  assert.equal(f.voice.getContext(), null);
  assert.equal((await f.voice.command({ action: 'add_note', nodeId: 'photo', text: 'Wrong project' })).ok, false);
  f.setProject('project-a'); f.setActive(false);
  assert.equal((await f.voice.command({ action: 'organize_prompt' })).ok, false);
});

test('notes, names, linked memo context and final-look share the store, organization never generates', async () => {
  const f = setup();
  await f.voice.command({ action: 'add_link', fromId: 'region-a', toId: 'photo', caption: 'Use this finish' });
  await f.voice.command({ action: 'add_link', fromId: 'photo', toId: 'memo', caption: 'Assembly notes' });
  await f.voice.command({ action: 'final_look', nodeId: 'photo', finalLook: true });
  await f.voice.command({ action: 'rename_node', nodeId: 'photo', name: 'Brushed chrome' });
  const note = await f.voice.command({ action: 'add_note', text: 'Keep the bolt accessible.' });
  assert.equal(f.board.getState().notes[note.id].regionId, 'region-a');
  const ctx = f.voice.getContext();
  assert.ok(ctx.links.some(item => item.caption === 'Assembly notes'));
  assert.equal(ctx.nodes.find(item => item.id === 'memo').transcript, 'Make it serviceable');
  assert.equal(ctx.nodes.find(item => item.id === 'photo').name, 'Brushed chrome');
  assert.equal(ctx.nodes.find(item => item.id === 'photo').finalLook, true);
  assert.equal(f.voice.getContext(), ctx, 'unchanged metadata is cached');
  assert.equal((await f.voice.command({ action: 'organize_prompt' })).generated, false);
  assert.equal(f.organized(), 1);
  const before = f.board.getState();
  assert.equal((await f.voice.command({ action: 'generate' })).ok, false);
  assert.equal((await f.voice.command({ action: 'apply_micro_edit', text: 'Delete assembly' })).ok, false);
  assert.equal(f.board.getState(), before);
});

test('voice context stays byte-bounded and preserves selection and model identity', async () => {
  const f = setup();
  for (let i = 0; i < 28; i++) f.board.dispatch({ type: 'note.add', note: { id: `note-${i}`, regionId: 'region-a', text: '大'.repeat(7000) } });
  const context = f.voice.getContext();
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).length <= DRAW_VOICE_CONTEXT_BYTES);
  assert.equal(context.selectedRegionId, 'region-a');
  const full = compactXrAgentContext({ projectId: 'project-a', targetFile: 'assembly.step', spatialBoard: context, generationModel: 'chosen', wiring: { large: 'x'.repeat(100000) } });
  assert.equal(full.spatialBoard.selectedRegionId, 'region-a');
  assert.equal(full.generationModel, 'chosen');
});

test('Draw voice capability is opt-in and never offers a generation tool', () => {
  const normal = voiceRealtimeConfig('existing-model', {}, { review: true });
  const draw = voiceRealtimeConfig('existing-model', {}, { review: true, drawBoard: true });
  assert.ok(!normal.tools.some(tool => tool.name === 'draw_board_command'));
  assert.ok(draw.tools.some(tool => tool.name === 'draw_board_command'));
  assert.match(draw.instructions, /never invent printer dimensions/i);
  assert.match(draw.instructions, /original region/);
  assert.ok(!draw.tools.find(tool => /^(generate|execute)/.test(tool.name)));
});
