import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
function harness({ model = {}, project = {}, mode = 'v2', rigging = false } = {}) {
  const ctx = vm.createContext({
    projectId: 'p1', selectedFile: 'part.step', promptMode: mode, cadComposeRigging: rigging,
    composeDraftPid: () => 'p1', modelStateKey: () => 'model', projectPromptStateKey: () => 'project',
    readModelPromptState: () => ({ model, project }), readGlobalComposeDraft: () => null,
    clearGlobalComposeDraft() {}, liveComposePromptText: () => 'edit battery',
    pickComposeRestorePrompt: ({ stored }) => stored, restoringModelPromptState: false,
    resetRefCounter() {}, composer: { replaceReferences() {}, setPromptText() {} },
    promptImages: [], restoreReferenceMarkers() {}, currentMesh: null, meshCenterOffset: null,
    isExplorerPromptRef: () => false, promptModeForRef: mode => mode,
    sendCollabPresence() {}, refreshSelectionMeasureOverlay() {}, renderPromptImages() {},
    hydratePromptImages: async () => false, setPromptCadEngine() {},
    applyPromptModeUI(mode) { ctx.promptMode = mode; },
    syncCadComposeRiggingUi() { ctx.activeTab = ctx.cadComposeRigging ? 'rigging' : ctx.promptMode; },
  });
  vm.runInContext(section('function dedupeRefsById(', 'function safeRestoreActiveModelPromptState('), ctx);
  return ctx;
}
const oldRig = { updated_at: 1, promptMode: 'v2', cadRigging: true, prompt: 'add motion', references: [] };
const newCad = { updated_at: 2, promptMode: 'v2', cadRigging: false, prompt: 'edit battery', references: [] };

test('new CAD draft overrides older model Rig and clears routing into rigging', () => {
  const ctx = harness({ model: oldRig, project: newCad, rigging: true });
  ctx.restoreActiveModelPromptState();
  assert.equal(ctx.cadComposeRigging, false);
  assert.equal(ctx.activeTab, 'v2');
});

test('restoring an intentional Rig draft still enables Rig', () => {
  const ctx = harness({ model: newCad, project: { ...oldRig, updated_at: 3 } });
  ctx.restoreActiveModelPromptState();
  assert.equal(ctx.cadComposeRigging, true);
  assert.equal(ctx.activeTab, 'rigging');
});

test('model refresh preserves the live tab even when saved draft is Rig', () => {
  for (const mode of ['v2', 'mesh', 'render']) {
    const ctx = harness({ model: oldRig, project: oldRig, mode });
    ctx.restoreActiveModelPromptState({ restoreMode: false });
    assert.equal(ctx.cadComposeRigging, false);
    assert.equal(ctx.promptMode, mode);
  }
});

test('Render remains a permanent prompt mode while Mesh is generating', () => {
  assert.match(html, /data-prompt-mode="render"[^>]*>Render<\/button>/);
  assert.doesNotMatch(
    styles,
    /body\.mesh-generating\s+\.prompt-mode-wrap\[data-prompt-mode-tip="render"\]\s*\{[^}]*display:\s*none/,
  );
});

test('CAD request remains CAD when live UI changes to Rig during preparation', () => {
  for (const [startedInRig, laterRig] of [[false, true], [true, false]]) {
    const ctx = vm.createContext({
      preparedPrompt: null, promptMode: 'v2', cadComposeRigging: startedInRig,
      promptHistoryId: 'test', prompt: 'make the battery easier to slide in',
      targetBaseFilename: 'part.step', promptReferences: [], usablePromptImages: [],
      convertImagesToDrawing: false, targetMode: 'edit', genMode: 'v2',
      electronicsBuildOptions: {}, spiceMeta: {}, source: 'ui', promptSubmitOpts: {},
      canvasAttached: false, promptReferencesForMode: () => [],
      getPromptGenerationSpeed: () => 'fast', getEnabledSkillsForPrompt: () => ['cad'],
      isCodexEnabled: () => false, inferRigKind: () => 'open_close',
    });
    for (const name of ['getPromptAiKeyBodyFields', 'getJakeSpendBodyFields', 'getCadMcMasterPartsBodyFields',
      'getKnowledgePromptFields', 'getContextLabImproveFields', 'getCadDebugBodyFields']) ctx[name] = () => ({});
    vm.runInContext(section('  const lockedPromptMode = preparedPrompt ?', '  const electronicsBuildOptions ='), ctx);
    ctx.cadComposeRigging = laterRig;
    const bodyStart = source.indexOf('      const body = {\n        prompt_id: promptHistoryId,', source.indexOf('  const lockedPromptMode = preparedPrompt ?'));
    const bodyEnd = source.indexOf('\n      const preparedConflict = preparedGenerationConflict', bodyStart);
    assert.ok(bodyStart >= 0 && bodyEnd > bodyStart);
    vm.runInContext(source.slice(bodyStart, bodyEnd) + '\nthis.sentBody = body;', ctx);
    assert.equal(ctx.sentBody.mode, 'v2');
    assert.equal(ctx.sentBody.target_mode, 'edit');
    assert.equal(ctx.sentBody.prompt, 'make the battery easier to slide in');
    assert.equal(ctx.sentBody.articulation, startedInRig ? true : undefined);
    if (startedInRig) assert.equal(ctx.sentBody.articulation_kind, 'open_close');
  }
});
