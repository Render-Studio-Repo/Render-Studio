// Execute the actual Studio submission functions with isolated UI/network stubs.
// No provider, project mutation, browser, or generation request leaves this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/studio/app.js'), 'utf8');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Actual app function exists: ${start}`);
  return source.slice(a, b);
}
const submission = between('async function generateXrDrawBoardPrompt(', '\n// ── Parametric ribbon');
const resolveTarget = between('function resolvePromptEditTarget(', '\nfunction annotatePickedReference');
const filterRefs = between('function promptReferencesForMode(', '\nasync function attachMcMasterSpecPointers');
const snapshot = () => ({ boardId: 'board', boardRevision: 5, prompt: 'Split this bracket; assemble with bolts.', graph: {
  nodes: [{ id: 'bracket', kind: 'model', source: { filename: 'bracket.step' } }, { id: 'finish', kind: 'image', source: { filename: 'finish.png' } }],
  regions: [{ id: 'cut', kind: 'lasso', nodeId: 'bracket' }], notes: [{ id: 'plan', text: 'P1S; alignment pins and bolts.' }],
} });
function harness() {
  const events = [], requests = [], errors = [];
  const element = { className: '', textContent: '', value: '', click() { events.push('wiring'); } };
  const c = {
    console, Object, Array, Set, Map, JSON, Date, Promise,
    window: { setTimeout() {}, dispatchEvent() {} },
    document: { getElementById: () => element, body: { classList: { contains: () => true } } },
    projectId: 'project', promptMode: 'v2', engine: 'vibecad', selectedFile: 'bracket.step', targetMode: 'edit',
    draft: snapshot().prompt, refs: [{ id: 'original', type: 'document', filename: 'requirements.md' }],
    promptImages: [{ id: 'original-image', data_url: 'data:image/png;base64,AA==', source_filename: 'original.png' }],
    workspaceModes: { isWiring: () => c.wiring }, wiring: false, boardActive: true, lineOverflow: false,
    promptSubmitOpts: {}, promptClickInFlight: false, promptSubmitInFlight: false,
    suppressAiComposePanelSwitch: false, userCancelRequested: false, pendingPromptSelectionContext: null,
    generationWatchPid: null, generationWatchOverlay: null, generationPollTimer: null,
    activePromptGenerationId: 0, activePromptAbort: null, lastPromptCopyContext: null,
    pendingPromptImagePersists: [], currentUser: null, allProjects: [], aiStatus: { ai_ready: true },
    promptDictation: { liveText: 'unreviewed dictation', committed: '' },
    composer: { getPromptText: () => c.draft, setPromptText: text => { c.draft = text; events.push('composer-write'); }, getReferences: () => c.refs },
    viewportVideoRecorder: { isStudioOpen: () => true, applyEditCommand: async () => { events.push('video'); return { ok: true }; } },
    viewportXR: { getAiDrawWorkspace: () => c.workspace, setAiPanelStatus: text => events.push(text), refreshAiPromptPanel() {}, isPresenting: () => true,
      isVoiceDrawOn: () => true, toggleVoiceDraw: () => events.push('toggle-voice-draw') },
    workspace: { getVoiceContext: () => ({ active: c.boardActive }), isActive: () => true, snapshot,
      view: { update() {}, isLineBudgetExceeded: () => c.lineOverflow } },
    viewerOverlay: { clearError() {}, showError: error => errors.push(error) },
    promptReferencesForSubmit: () => [...c.refs, { id: `auto:${c.selectedFile}`, type: 'component', filename: c.selectedFile }],
    getPromptTargetMode: () => c.targetMode, promptBaseFilename: () => c.targetMode === 'edit' ? c.selectedFile : null,
    isComponentHidden: () => false, isFixtureArtifactFilename: () => false,
    resolveCadPromptMode: () => c.engine, resolveMeshPromptMode: () => c.engine,
    promptImageHasBytes: image => !!image.data_url, promptImageApiPayload: image => ({ ...image }),
    getSelectedPromptModelInfo: () => ({ model: 'test', provider: 'isolated', source: 'test' }),
    getPromptGenerationSpeed: () => 'normal', getEnabledSkillsForPrompt: () => [],
    getPromptAiKeyBodyFields: () => ({}), getJakeSpendBodyFields: () => ({}), getCadMcMasterPartsBodyFields: () => ({}),
    getKnowledgePromptFields: () => ({}), getContextLabImproveFields: () => ({}),
    getCadDebugBodyFields: () => ({}), microEditTools: null,
    isGenerationUiActive: () => false, isCodexEnabled: () => false, selectedPromptSupportsElectronics: () => false,
    selectedPromptSupportsMcMasterParts: () => false, isMcMasterPromptRef: () => false,
    hasGenerationPoll: () => false, isCadGenerationActive: () => false, currentGenerateUsedCanvas: () => false,
    cadPromptWatchIsLive: () => false, markAdditionalGenerationPending: () => false, liveServerCadJobs: () => [],
    isPendingGenerationJob: () => false,
    newPromptHistoryId: () => 'test-prompt', promptModeForRef: mode => mode, promptCopyContextBase: () => ({}),
    formatUserError: error => error.message, isVerboseGenerationFailureMessage: () => false,
    setPromptPanelFailureStatus() {}, showPromptGenerationFailure: error => errors.push(error.message),
    ensureProject: async () => { await c.onEnsureProject?.(); },
    api: async (url, opts) => {
      assert.equal(opts?.method, 'POST');
      requests.push({ url, body: JSON.parse(opts.body) });
      if (c.failPost) throw new Error('Isolated provider failure');
      return { accepted: true, status: 'running', filename: 'result.step' };
    },
    getXrDrawPromptBridge: () => ({ prepare: async value => {
      events.push('prepare');
      c.refs.push({ id: 'vr-board:cut', type: 'lasso', filename: 'bracket.step', geometry_context: { regionId: 'cut' } },
        { id: 'vr-board-snapshot:board', type: 'document', text_content: JSON.stringify(value) });
      c.promptImages.push({ id: 'vr-board-image:finish', source_filename: 'finish.png', data_url: 'data:image/png;base64,AA==' });
      const references = JSON.parse(JSON.stringify(c.refs.filter(ref => ref.id.startsWith('vr-board'))));
      await c.onPrepare?.();
      return { ok: true, prompt: `${value.prompt}\n[VR DRAW SPATIAL SNAPSHOT]\n${JSON.stringify(value)}`, references };
    } }),
  };
  for (const name of ['syncStopButtonVisibility', 'setEditStatus', 'showAiComposePanel', 'stopGenerationWatch', 'hideViewportOverlay',
    'addPendingPromptHistoryEntry', 'updatePendingPromptHistoryEntry', 'syncViewportGenerationOverlay', 'refreshTrialRenderCount',
    'refreshPromptHistory', 'syncCanvasGenerationUi', 'renderPromptImages']) c[name] = () => {};
  c.beginGenerationWatch = pid => { c.generationWatchPid = pid; c.generationWatchOverlay = {}; };
  c.showViewportOverlay = () => {};
  for (const name of ['applyCanvasSketchToPrompt', 'applyVoiceDrawToPrompt', 'runDrawPrompt', 'runSceneRenderPrompt', 'runEnvironmentWrapPrompt',
    'isDimensionQuestion', 'answerDimensionPrompt', 'askConvertImageToDrawing', 'classifyImageForDxf', 'readDxfConvertPref', 'hydratePromptImages',
    'maybeSpiceUpPrompt', 'clearActiveProjectPromptDraft', 'applyPromptModeUI', 'isPromptDictationActive', 'ensurePromptEditSelection', 'syncPromptTargetUI', 'capturePromptSelectionContext']) {
    c[name] = () => { events.push(name); throw new Error(`Unreviewed side route: ${name}`); };
  }
  c.promptHasCanvasSketchImage = () => false;
  vm.createContext(c);
  vm.runInContext(`${resolveTarget}\n${filterRefs}\n${submission}`, c);
  return { c, events, requests, errors };
}

test('real explicit Generate pins reviewed target/engine, manifest, and original attachments across awaits', async () => {
  const { c, events, requests, errors } = harness();
  c.onPrepare = async () => {
    c.selectedFile = 'unrelated.step'; c.targetMode = 'new'; c.promptMode = 'render'; c.engine = 'mac';
    c.refs.push({ id: 'later', type: 'document', filename: 'later.md' });
    c.promptImages.push({ id: 'later-image', data_url: 'later bytes' });
  };
  const result = await c.generateXrDrawBoardPrompt(snapshot());
  assert.equal(result.ok, true, JSON.stringify(errors)); assert.equal(requests.length, 1);
  const { body, url } = requests[0];
  assert.equal(url, '/api/projects/project/prompt'); assert.equal(body.base_filename, 'bracket.step');
  assert.equal(body.target_mode, 'edit'); assert.equal(body.mode, 'vibecad'); assert.equal(body.client, 'xr');
  assert.match(body.prompt, /VR DRAW SPATIAL SNAPSHOT/); assert.match(body.prompt, /alignment pins and bolts/);
  assert.ok(body.references.some(ref => ref.id === 'vr-board-snapshot:board'));
  assert.ok(body.references.some(ref => ref.id === 'original'));
  assert.ok(!body.references.some(ref => /unrelated|later/.test(JSON.stringify(ref))));
  assert.deepEqual(body.images.map(image => image.id), ['original-image', 'vr-board-image:finish']);
  assert.equal(body.convert_images_to_drawing, false);
  assert.equal(c.draft, snapshot().prompt); assert.equal(c.promptMode, 'render');
  assert.ok(!events.includes('video') && !events.includes('toggle-voice-draw') && !events.includes('composer-write'));
});

test('selected spatial face supplies a stable edit target when no desktop target is selected', async () => {
  const { c, requests } = harness(); c.targetMode = 'new'; c.selectedFile = null;
  assert.equal((await c.generateXrDrawBoardPrompt(snapshot())).ok, true);
  assert.equal(requests[0].body.base_filename, 'bracket.step'); assert.equal(requests[0].body.target_mode, 'edit');
});

test('actual adapter + submission retain snapshot anchors when live composer geometry changes during prepare', async () => {
  const { createXrDrawPromptBridge } = await import('../../frontend/xr/xr-ai-draw-prompt.js');
  const { c, requests } = harness(), reviewed = snapshot();
  reviewed.graph.nodes[0].source.revision = 'r1';
  reviewed.graph.nodes[0].transform = { position: [1, 2, 3] };
  reviewed.graph.nodes[1].source.url = '/api/projects/project/files/finish.png';
  reviewed.graph.regions[0].anchor = { nodeId: 'bracket', sourceRevision: 'r1', localPoints: [[1, 2, 3]], triangleIndex: 7 };
  const bridge = createXrDrawPromptBridge({
    getDraft: () => c.draft, getAttachments: () => ({ references: c.refs, images: c.promptImages }),
    appendImage: async image => { c.promptImages.push({ ...image, data_url: 'data:image/png;base64,AA==' }); return true; },
    appendReference: async ref => {
      const index = c.refs.findIndex(row => row.id === ref.id);
      if (index < 0) c.refs.push(ref); else c.refs[index] = ref;
      if (ref.id.startsWith('vr-board-snapshot:')) {
        // Simulate the board subscriber updating references while the last
        // asynchronous attachment callback is pending.
        c.refs.find(row => row.id === 'vr-board:cut').geometry_context.localPoints = [[9, 9, 9]];
        c.refs.find(row => row.id === 'vr-board:cut').loop_points[0][0] = 9;
        c.refs.find(row => row.id === 'vr-board:bracket').geometry_context.sourceRevision = 'r2';
        reviewed.graph.nodes[0].transform.position = [9, 9, 9];
        await Promise.resolve();
      }
      return true;
    },
  });
  c.getXrDrawPromptBridge = () => bridge;
  assert.equal((await c.generateXrDrawBoardPrompt(reviewed)).ok, true);
  const body = requests[0].body;
  const region = body.references.find(ref => ref.id === 'vr-board:cut');
  assert.deepEqual(region.geometry_context.localPoints, [[1, 2, 3]]);
  assert.deepEqual(region.loop_points, [[1, 2, 3]]);
  assert.equal(body.references.find(ref => ref.id === 'vr-board:bracket').geometry_context.sourceRevision, 'r1');
  const manifest = JSON.parse(body.references.find(ref => ref.id === 'vr-board-snapshot:board').text_content);
  assert.deepEqual(manifest.graph.nodes[0].transform.position, [1, 2, 3]);
  assert.deepEqual(c.refs.find(ref => ref.id === 'vr-board:cut').geometry_context.localPoints, [[9, 9, 9]]);
  assert.equal(c.draft, snapshot().prompt);
});

for (const route of ['render', 'wiring', 'line budget']) test(`board ${route} guard refuses unsafe/lossy submission before attachment work`, async () => {
  const { c, requests, events } = harness();
  if (route === 'render') c.promptMode = 'render';
  if (route === 'wiring') c.wiring = true;
  if (route === 'line budget') c.lineOverflow = true;
  const result = await c.generateXrDrawBoardPrompt(snapshot());
  assert.equal(result.ok, false); assert.equal(requests.length, 0); assert.ok(!events.includes('prepare'));
});

test('closing board while references attach does not submit', async () => {
  const { c, requests } = harness(); c.onPrepare = async () => { c.boardActive = false; };
  const result = await c.generateXrDrawBoardPrompt(snapshot());
  assert.equal(result.ok, false); assert.match(result.error, /closed|teleop/); assert.equal(requests.length, 0);
});

test('project change during final image-persistence wait aborts before POST', async () => {
  const { c, requests } = harness();
  c.onEnsureProject = async () => { c.pendingPromptImagePersists = [{ then(resolve) { c.projectId = 'other-project'; resolve(); } }]; };
  const result = await c.generateXrDrawBoardPrompt(snapshot());
  assert.equal(result.ok, false); assert.match(result.error, /changed/); assert.equal(requests.length, 0);
});

test('actual POST error reaches VR board instead of reporting generation success', async () => {
  const { c, requests } = harness(); c.failPost = true;
  const result = await c.generateXrDrawBoardPrompt(snapshot());
  assert.equal(result.ok, false); assert.equal(result.error, 'Isolated provider failure'); assert.equal(requests.length, 1);
  assert.equal(c.draft, snapshot().prompt);
});

test('Stop during attachment persistence cancels before any POST', async () => {
  const { c, requests } = harness();
  c.onEnsureProject = async () => { c.pendingPromptImagePersists = [{ then(resolve) { c.userCancelRequested = true; resolve(); } }]; };
  const result = await c.generateXrDrawBoardPrompt(snapshot());
  assert.equal(result.ok, false); assert.match(result.error, /canceled/); assert.equal(requests.length, 0);
});

test('ordinary desktop video-edit routing remains available', async () => {
  const { c, requests, events } = harness(); c.draft = 'Split the clip and add music';
  const result = await c.handlePromptGenerateClick();
  assert.equal(result.routed, 'video-studio'); assert.ok(events.includes('video')); assert.equal(requests.length, 0);
});
