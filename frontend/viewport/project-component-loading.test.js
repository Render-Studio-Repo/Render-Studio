import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { assembledStemsFromEntries, shouldSkipDuplicateExploded, startBlobPrefetch } from "./project-mesh-load.js";
import { modelCachePath } from "./model-cache-path.js";

// Exercise the actual orchestration hook with a controlled network/viewport.
const app = readFileSync(new URL("../studio/app.js", import.meta.url), "utf8");
const invite = readFileSync(new URL("../workspace/workspace-send-invite.js", import.meta.url), "utf8");
const browser = readFileSync(new URL("../workspace/workspace-browser.js", import.meta.url), "utf8");
const inspect = readFileSync(new URL("../workspace/workspace-inspect.js", import.meta.url), "utf8");
const hub = readFileSync(new URL("../workspace/workspace-hub.js", import.meta.url), "utf8");
const mgmt = readFileSync(new URL("../workspace/workspace-management.js", import.meta.url), "utf8");
const apps = readFileSync(new URL("../studio/authorized-app-setup.js", import.meta.url), "utf8");
const social = readFileSync(new URL("../social/social-network-ui.js", import.meta.url), "utf8");
const subs = readFileSync(new URL("../components/ai-subscriptions-ui.js", import.meta.url), "utf8");
const chat = readFileSync(new URL("../social/project-chat.js", import.meta.url), "utf8");
const fusion = readFileSync(new URL("../cad/fusion-panel.js", import.meta.url), "utf8");
const onshape = readFileSync(new URL("../cad/onshape-panel.js", import.meta.url), "utf8");
const tex = readFileSync(new URL("../viewport/texture-panel.js", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../components/catalog-panel.js", import.meta.url), "utf8");
const mcmaster = readFileSync(new URL("../components/mcmaster-insert.js", import.meta.url), "utf8");
const imagine = readFileSync(new URL("../studio/imagine.js", import.meta.url), "utf8");
const agent = readFileSync(new URL("../components/render-agent.js", import.meta.url), "utf8");
const ctxlab = readFileSync(new URL("../components/context-lab.js", import.meta.url), "utf8");
const onlineModels = readFileSync(new URL("../components/online-models-panel.js", import.meta.url), "utf8");
const storePrefs = readFileSync(new URL("../marketplace/store-preferences.js", import.meta.url), "utf8");
const knowledge = readFileSync(new URL("../components/knowledge-base.js", import.meta.url), "utf8");
const recvPay = readFileSync(new URL("../marketplace/receive-payments.js", import.meta.url), "utf8");
const userProf = readFileSync(new URL("../components/user-profile.js", import.meta.url), "utf8");
const voiceMold = readFileSync(new URL("../components/voice-mold.js", import.meta.url), "utf8");
const feedback = readFileSync(new URL("../components/feedback-ui.js", import.meta.url), "utf8");
const projectShare = readFileSync(new URL("../social/project-share.js", import.meta.url), "utf8");
const sharedProjects = readFileSync(new URL("../workspace/shared-projects-browser.js", import.meta.url), "utf8");
const fileActions = readFileSync(new URL("../components/file-actions.js", import.meta.url), "utf8");
const assist = readFileSync(new URL("../studio/design-assistance.js", import.meta.url), "utf8");
const skills = readFileSync(new URL("../components/skills-library.js", import.meta.url), "utf8");
const driverPicker = readFileSync(new URL("../components/driver-picker.js", import.meta.url), "utf8");
const videoRecord = readFileSync(new URL("../viewport/viewport-video-record.js", import.meta.url), "utf8");
const componentProfile = readFileSync(new URL("../components/component-profile.js", import.meta.url), "utf8");
const rigging = readFileSync(new URL("../components/rigging-editor.js", import.meta.url), "utf8");
const architect = readFileSync(new URL("../architect/architect-session.js", import.meta.url), "utf8");
const dxf = readFileSync(new URL("../viewport/dxf-viewer.js", import.meta.url), "utf8");
const refs = readFileSync(new URL("../components/reference-files.js", import.meta.url), "utf8");
const codeEd = readFileSync(new URL("../code/project-code-editor.js", import.meta.url), "utf8");
const xr = readFileSync(new URL("../xr/viewport-xr.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function loadProjectComponents("), app.indexOf("\nasync function openSketchInViewport("));
function fixture() {
  const models = new Set();
  const calls = [];
  const errors = [];
  const context = {
    console: { warn() {}, error() {} },
    loadProjectGeneration: 1, projectId: "p1", viewportMeshProjectId: null, lastProjectFiles: [],
    viewportXR: null, renderer: null,
    selectedFile: null, currentMesh: null, VIEWPORT_MAX_MESH_BYTES: 1000000,
    isInternalCadSidecar: () => false, isJakeStepPreviewName: () => false,
    firstDesignedViewportName: () => null, prepareViewportForModels() {},
    isBrowserComponentHidden: (c) => c.hidden === true,
    isCatalogHardwareComponent: (c) => c.catalog_hardware === true,
    viewportViewerFor: (c) => c.viewer_filename || c.name,
    expandViewportLoadEntries: (comps) => comps || [],
    stampStudioCreditIncident() {},
    isViewportViewableFilename: (name) => /\.glb$/.test(name),
    primaryViewportComponent: (comps) => comps.find((c) => c.primary) || comps[0],
    projectAssembly: { count: () => models.size, has: (n) => models.has(n), getRoot: () => ({}) },
    clearModelContents: () => { models.clear(); context.viewportMeshProjectId = null; },
    assembledStemsFromEntries, shouldSkipDuplicateExploded, startBlobPrefetch,
    projectFileUrl: (pid, viewer) => `${pid}/${viewer}`,
    _cacheBustModelPath: (p) => p, _apiPath: (p) => p,
    fetchModelBlob: async () => ({ size: 10 }),
    hasBakedPlacement: () => false, hasMeshFactorySibling: () => false,
    setEditStatus: (status, msg) => calls.push([status, msg]),
    viewerOverlay: { showError: (e) => errors.push(e), clearError() {} },
    projectTree: { setSelected: (n) => calls.push(["selected", n]) },
    featureEditor: { setModel() {} }, safeRestoreActiveModelPromptState() {},
    seatAssemblyToFloor() {}, fitCamera() {}, syncExportButton() {},
    loadModel: async (url, name, opts) => {
      calls.push(["load", name, opts.append]);
      if (context.failLoad) return false;
      if (name === "broken.glb") throw new Error("Invalid GLB");
      if (!opts.append) models.clear();
      models.add(opts.catalogFilename);
      return true;
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, models, calls, errors };
}
const broken = { name: "broken.glb", primary: true, auto_load: true };
const good = { name: "good.glb", auto_load: true };

test("one corrupt primary cannot prevent another component loading", async () => {
  const { context, models, calls } = fixture();
  models.add("previous-project.glb");
  const ok = await context.loadProjectComponents([broken, good], { projectId: "p1", loadGen: 1, replaceExisting: true, loadAll: true });
  assert.equal(ok, true);
  assert.deepEqual([...models], ["good.glb"]);
  assert.equal(context.selectedFile, "good.glb");
  assert.deepEqual(calls.filter((c) => c[0] === "load"), [["load", "broken.glb", false], ["load", "good.glb", false]]);
  assert.ok(calls.some(([status, msg]) => status === "error" && msg.includes("Invalid GLB")));
});

test("project open loads only the primary mesh, not leftover auto_load parts", async () => {
  const { context, models, calls } = fixture();
  const primary = { name: "clamp.glb", primary: true, auto_load: true };
  const leftover = { name: "OpenArm_2.0.glb", auto_load: true };
  const ok = await context.loadProjectComponents([primary, leftover], {
    projectId: "p1", loadGen: 1, replaceExisting: true, loadAll: false, latestFile: "clamp.glb",
  });
  assert.equal(ok, true);
  assert.deepEqual([...models], ["clamp.glb"]);
  assert.deepEqual(calls.filter((c) => c[0] === "load"), [["load", "clamp.glb", false]]);
});

test("failed secondary preserves the successful primary", async () => {
  const { context, models } = fixture();
  assert.equal(await context.loadProjectComponents([{...good, primary: true}, {...broken, primary: false}], {projectId: "p1", loadGen: 1}), true);
  assert.deepEqual([...models], ["good.glb"]);
  assert.equal(context.selectedFile, "good.glb");
});

test("a superseded project cannot clear or change the current viewport", async () => {
  const { context, models, calls } = fixture();
  context.loadProjectGeneration = 2;
  models.add("current.glb");
  assert.equal(await context.loadProjectComponents([{...good, hidden: true}], {projectId: "p1", loadGen: 1}), false);
  assert.deepEqual([...models], ["current.glb"]);
  assert.deepEqual(calls, []);
});

test("failed new project cannot leave the previous project masquerading as loaded", async () => {
  const { context, models, errors } = fixture();
  models.add("previous-project.glb");
  assert.equal(await context.loadProjectComponents([broken], {projectId: "p1", loadGen: 1, replaceExisting: true}), false);
  assert.equal(models.size, 0);
  assert.equal(context.selectedFile, null);
  assert.match(errors[0], /Invalid GLB/);
});

test("full browser hydrate does not race the primary GLB with a CAD-tree walk", () => {
  const fn = app.slice(
    app.indexOf("async function hydrateFullProjectBrowser"),
    app.indexOf("\nasync function loadProject("),
  );
  assert.match(fn, /loadAll: false/);
  assert.match(fn, /recoverViewport/);
  assert.match(fn, /\?view=open/);
  assert.doesNotMatch(fn, /\?view=full/);
  assert.doesNotMatch(fn, /setTimeout\(resolve, 90000\)/);
  assert.doesNotMatch(fn, /hydrateBrowserBodyChildren/);
});

test("lite open hydrates history from dedicated endpoints, not view=full", () => {
  const histFn = app.slice(
    app.indexOf("async function hydrateProjectHistories"),
    app.indexOf("\nasync function hydrateFullProjectBrowser"),
  );
  const loadFn = app.slice(
    app.indexOf("async function loadProject(id)"),
    app.indexOf("\nlet newProjectWorkspaceModalEl"),
  );
  assert.match(histFn, /projectHistoryApiPath\(id, "timeline"\)/);
  assert.match(histFn, /refreshPromptHistory/);
  assert.match(app, /let promptHistoryAbort = null; \/\/ leakfix15/);
  assert.match(app, /let refreshFilesAbort = null; \/\/ leakfix18/);
  assert.match(app, /let workspaceHistoryAbort = null; \/\/ leakfix19/);
  assert.match(app, /let workspaceRealtimeAbort = null; \/\/ leakfix19/);
  assert.match(app, /let workspaceMenuAbort = null; \/\/ leakfix20/);
  assert.match(app, /const composerClipCreated = \[\]; \/\/ leakfix21/);
  assert.match(app, /leakfix22/);
  assert.match(app, /leakfix23/);
  assert.match(app, /leakfix24/);
  assert.match(app, /leakfix25/);
  assert.match(app, /leakfix26/);
  assert.match(app, /leakfix27/);
  assert.match(app, /leakfix28/);
  assert.match(app, /leakfix29/);
  assert.match(app, /leakfix30/);
  assert.match(app, /leakfix31/);
  assert.match(app, /leakfix32/);
  assert.match(app, /leakfix33/);
  assert.match(app, /leakfix35/);
  assert.match(app, /async function refreshPartProfiles\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix36/);
  assert.match(app, /async function refreshElectronicsSuggestions\(\{ showDock = false \} = \{\}\)[\s\S]{0,900}collectElectronicsUsed\(ctl\.signal\)/);
  assert.match(app, /leakfix37/);
  assert.match(app, /async function hydrateBrowserBodyChildren[\s\S]{0,2400}signal: ctl\.signal/);
  assert.match(app, /leakfix38/);
  assert.match(app, /leakfix39/);
  assert.match(app, /async function loadXrCreationsManifest[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(app, /leakfix40/);
  assert.match(app, /async function renderElectronicsUsedList[\s\S]{0,1200}collectElectronicsUsed\(ctl\.signal\); \/\/ leakfix40/);
  assert.match(app, /leakfix41/);
  assert.match(app, /async function refreshTeamInvites\(\{ presentNew = true \} = \{\}\)[\s\S]{0,700}signal: ctl\.signal/);
  assert.match(app, /leakfix42/);
  assert.match(app, /async function refreshTeamMembers\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix43/);
  assert.match(invite, /let inviteCandidatesAbort = null; \/\/ leakfix43/);
  assert.match(invite, /export async function refreshInviteCandidates[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix44/);
  assert.match(invite, /let havePanelAbort = null; \/\/ leakfix44/);
  assert.match(invite, /async function refreshHavePanel[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(app, /leakfix45/);
  assert.match(invite, /let foldersForTeamAbort = null; \/\/ leakfix45/);
  assert.match(invite, /async function loadFoldersForTeam[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix46/);
  assert.match(invite, /folders = prefetchedFolders; \/\/ leakfix46/);
  assert.match(invite, /refreshHavePanel\(\{ api, teamId, folders \}\); \/\/ leakfix46/);
  assert.match(app, /leakfix47/);
  assert.match(browser, /let foldersRefreshAbort = null; \/\/ leakfix47/);
  assert.match(app, /let resumeGenerationAbort = null; \/\/ leakfix48/);
  assert.match(app, /async function resumeGenerationFromProjects\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix49/);
  assert.match(inspect, /let inspectMembersAbort = null; \/\/ leakfix49/);
  assert.match(inspect, /async function reloadMembers[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /let canvasBoardsAbort = null; \/\/ leakfix50/);
  assert.match(app, /async function fetchProjectCanvasBoards\(\)[\s\S]{0,700}signal: ctl\.signal/);
  assert.match(app, /async function listRecentCanvasBoards\(\)[\s\S]{0,700}signal: ctl\.signal/);
  assert.match(app, /leakfix51/);
  assert.match(hub, /let hubRefreshAbort = null; \/\/ leakfix51/);
  assert.match(hub, /async function refresh\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /let viewportSearchMembersAbort = null; \/\/ leakfix52/);
  assert.match(app, /async function hydrateViewportSearchMembers\(\)[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(app, /let costsRefreshAbort = null; \/\/ leakfix53/);
  assert.match(app, /async function refreshCostsMenuPanel\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix54/);
  assert.match(mgmt, /let managementAbort = null; \/\/ leakfix54/);
  assert.match(mgmt, /async function loadTeam\(teamId\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /let calendarPrefsAbort = null; \/\/ leakfix55/);
  assert.match(app, /async function loadSocialCalendarPrefs\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /let emailPreferencesAbort = null; \/\/ leakfix56/);
  assert.match(app, /async function loadEmailPreferences[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix57/);
  assert.match(apps, /let authorizedAppsAbort = null; \/\/ leakfix57/);
  assert.match(apps, /export async function hydrateAuthorizedAppList[\s\S]{0,900}loadAuthorizedAppStatuses\(api, ctl\.signal\)/);
  assert.match(app, /leakfix58/);
  assert.match(social, /let socialHubAbort = null; \/\/ leakfix58/);
  assert.match(social, /async function refresh\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix59/);
  assert.match(subs, /let subscriptionsAbort = null; \/\/ leakfix59/);
  assert.match(subs, /async function refresh\(\)[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(app, /leakfix60/);
  assert.match(chat, /let chatHydrateAbort = null; \/\/ leakfix60/);
  assert.match(chat, /async function loadThreads\(signal\)[\s\S]{0,500}signal/);
  assert.match(app, /leakfix61/);
  assert.match(fusion, /let fusionLibraryAbort = null; \/\/ leakfix61/);
  assert.match(fusion, /async function loadAllMirrors\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(fusion, /ensureImportDestination/);
  assert.match(fusion, /resolveImportDestination/);
  assert.doesNotMatch(fusion, /if \(currentId\) body\.target_project_id = currentId/);
  assert.match(app, /resolveFusionImportDestination/);
  assert.match(app, /append: intoCurrent/);
  assert.match(app, /leakfix62/);
  assert.match(onshape, /let onshapeDocsAbort = null; \/\/ leakfix62/);
  assert.match(onshape, /async function loadDocuments\(\)[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(app, /leakfix63/);
  assert.match(tex, /let texturesAbort = null; \/\/ leakfix63/);
  assert.match(tex, /async function refresh\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix64/);
  assert.match(catalog, /let catalogSearchAbort = null; \/\/ leakfix64/);
  assert.match(catalog, /async function search\(\{ query, category, heading \} = \{\}\)[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(app, /leakfix65/);
  assert.match(mcmaster, /let mcmasterSuggestAbort = null; \/\/ leakfix65/);
  assert.match(mcmaster, /async function refreshSuggest\(query\)[\s\S]{0,900}onSuggestParts\(q, \{ signal: ctl\.signal \}\)/);
  assert.match(app, /leakfix66/);
  assert.match(imagine, /let imagineRefreshAbort = null; \/\/ leakfix66/);
  assert.match(imagine, /async function refresh\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix67/);
  assert.match(agent, /let renderAgentThreadsAbort = null; \/\/ leakfix67/);
  assert.match(agent, /async function refreshThreads\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix68/);
  assert.match(ctxlab, /let contextLabAbort = null; \/\/ leakfix68/);
  assert.match(ctxlab, /async function refresh\(\)[\s\S]{0,400}signal: ctl\.signal/);
  assert.match(app, /leakfix69/);
  assert.match(agent, /let renderAgentMembersAbort = null; \/\/ leakfix69/);
  assert.match(agent, /async function refreshTeamMembers\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix70/);
  assert.match(app, /let preferredAiKeyAbort = null; \/\/ leakfix70/);
  assert.match(app, /async function hydratePreferredAiKeySelect[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix71/);
  assert.match(onlineModels, /let onlineModelsAbort = null; \/\/ leakfix71/);
  assert.match(onlineModels, /async function loadMarketplace\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix72/);
  assert.match(storePrefs, /let storePrefsAbort = null; \/\/ leakfix72/);
  assert.match(storePrefs, /async function hydrate\(panel\)[\s\S]{0,2400}loadStoreSettings\(ctl\.signal\)/);
  assert.match(app, /leakfix73/);
  assert.match(knowledge, /let knowledgeBaseAbort = null; \/\/ leakfix73/);
  assert.match(knowledge, /function openModal\(\)[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(app, /leakfix74/);
  assert.match(recvPay, /let receivePaymentsAbort = null; \/\/ leakfix74/);
  assert.match(recvPay, /const render = async \(\) => \{[\s\S]{0,700}loadReceiveStatus\(ctl\.signal\)/);
  assert.match(app, /leakfix75/);
  assert.match(userProf, /let userProfileAbort = null; \/\/ leakfix75/);
  assert.match(userProf, /export async function openUserProfile[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(app, /leakfix76/);
  assert.match(app, /let handleAvailabilityAbort = null; \/\/ leakfix76/);
  assert.match(app, /function scheduleClaimHandleCheck[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(app, /function scheduleProfileHandleAvailabilityCheck[\s\S]{0,1400}signal: ctl\.signal/);
  assert.match(app, /leakfix77/);
  assert.match(voiceMold, /let voiceMoldAbort = null; \/\/ leakfix77/);
  assert.match(voiceMold, /async function loadCatalog\(\)[\s\S]{0,700}signal: ctl\.signal/);
  assert.match(app, /leakfix78/);
  assert.match(feedback, /let feedbackPromptsAbort = null; \/\/ leakfix78/);
  assert.match(feedback, /async function loadPrompts\(projectId\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(browser, /leakfix79/);
  assert.match(projectShare, /let projectShareAbort = null; \/\/ leakfix79/);
  assert.match(projectShare, /async function loadShareList\(project, signal\)[\s\S]{0,700}signal \? \{ signal \}/);
  assert.match(app, /leakfix80/);
  assert.match(sharedProjects, /let sharedInvitesAbort = null; \/\/ leakfix80/);
  assert.match(sharedProjects, /async function refreshInvites\(\)[\s\S]{0,700}signal: ctl\.signal/);
  assert.match(app, /leakfix81/);
  assert.match(fileActions, /let fusionExportAbort = null; \/\/ leakfix81/);
  assert.match(fileActions, /const loadFolders = async \(\) => \{[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix82/);
  assert.match(fileActions, /let exportShareWorkspaceAbort = null; \/\/ leakfix82/);
  assert.match(fileActions, /async function showShareWorkspacePicker\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix83/);
  assert.match(browser, /let folderShareAbort = null; \/\/ leakfix83/);
  assert.match(browser, /async function openShareDialog\(folder\)[\s\S]{0,900}beginFolderShareFetch\(\)/);
  assert.match(app, /leakfix84/);
  assert.match(assist, /let partsListAbort = null; \/\/ leakfix84/);
  assert.match(assist, /async function openParts\(initialTab, host = null\)[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(app, /leakfix85/);
  assert.match(skills, /let skillPopupAbort = null; \/\/ leakfix85/);
  assert.match(skills, /async function openSkillPopup\(skillId, \{ forceReload = false \} = \{\}\)[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(app, /leakfix86/);
  assert.match(driverPicker, /let driverPickerAbort = null; \/\/ leakfix86/);
  assert.match(driverPicker, /async function runSearch\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix87/);
  assert.match(videoRecord, /let discordDestAbort = null; \/\/ leakfix87/);
  assert.match(videoRecord, /async function loadDiscordDestinations\(query\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix88/);
  assert.match(componentProfile, /let componentProfileSearchAbort = null; \/\/ leakfix88/);
  assert.match(componentProfile, /async function runSearch\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(componentProfile, /let componentProfileLoadAbort = null; \/\/ leakfix103/);
  assert.match(componentProfile, /async function open\(componentEntry, projectIdOverride\)[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(app, /leakfix89/);
  assert.match(app, /let printerShareAbort = null; \/\/ leakfix89/);
  assert.match(app, /leakfix90/);
  assert.match(onshape, /let onshapeElementsAbort = null; \/\/ leakfix90/);
  assert.match(onshape, /async function openDocument\(doc\)[\s\S]{0,1200}signal: ctl\.signal/);
  assert.match(app, /leakfix91/);
  assert.match(fileActions, /let exportOnshapeSourceAbort = null; \/\/ leakfix91/);
  assert.match(fileActions, /onshape-source`, \{ headers: authHeaders\(\), signal: ctl\.signal \}/);
  assert.match(app, /leakfix92/);
  assert.match(ctxlab, /let driveFoldersAbort = null; \/\/ leakfix92/);
  assert.match(ctxlab, /\/api\/users\/me\/drive\/folders", \{ headers: authHeaders\(\), signal: ctl\.signal \}/);
  assert.match(app, /leakfix93/);
  assert.match(knowledge, /let kbDriveFoldersAbort = null; \/\/ leakfix93/);
  assert.match(knowledge, /\/api\/users\/me\/drive\/folders", \{ signal: ctl\.signal \}/);
  assert.match(app, /leakfix94/);
  assert.match(videoRecord, /let videoEditorListAbort = null; \/\/ leakfix94/);
  assert.match(videoRecord, /\/video-editor`, \{\s*headers: editorAuthHeaders\(\),\s*signal: ctl\.signal,/);
  assert.match(app, /leakfix95/);
  assert.match(app, /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/xr-studio`, signal \? \{ signal \} : undefined/);
  assert.match(app, /leakfix96/);
  assert.match(app, /api\("\/api\/social\/friends", opt\)/);
  assert.match(app, /leakfix97/);
  assert.match(rigging, /let riggingLoadAbort = null; \/\/ leakfix97/);
  assert.match(rigging, /\/rigging`, \{ signal: ctl\.signal \}/);
  assert.match(app, /leakfix98/);
  assert.match(architect, /let architectLoadAbort = null; \/\/ leakfix98/);
  assert.match(architect, /\/architect\/building`, \{ signal: ctl\.signal \}/);
  assert.match(app, /leakfix99/);
  assert.match(app, /let jointOverlayAbort = null; \/\/ leakfix99/);
  assert.match(app, /assembly-joints\?filename=\$\{encodeURIComponent\(selectedFile\)\}`, \{\s*headers: authHeaders\(\),\s*cache: "no-store",\s*signal: ctl\.signal,/);
  assert.match(app, /leakfix100/);
  assert.match(app, /let modelRigsAbort = null; \/\/ leakfix100/);
  assert.match(app, /async function fetchProjectJsonFile\(name, signal\)[\s\S]{0,400}signal,/);
  assert.match(app, /leakfix101/);
  assert.match(app, /let simLoadAbort = null; \/\/ leakfix101/);
  assert.match(app, /\.sim\.json[\s\S]{0,80}signal: ctl\.signal/);
  assert.match(app, /leakfix102/);
  assert.match(app, /let meshAnimAbort = null; \/\/ leakfix102/);
  assert.match(app, /encodeURIComponent\(sidecar\)\}`, \{\s*headers: authHeaders\(\),\s*signal: ctl\.signal,/);
  assert.match(app, /leakfix103/);
  assert.match(app, /let sketchOpenAbort = null; \/\/ leakfix104/);
  assert.match(app, /async function openSketchInViewport\(entry\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix105/);
  assert.match(dxf, /let dxfPreviewAbort = null; \/\/ leakfix105/);
  assert.match(dxf, /async function loadPreview\(tab\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix106/);
  assert.match(refs, /let refLoadAbort = null; \/\/ leakfix106/);
  assert.match(refs, /async function loadTab\(tab\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(app, /leakfix107/);
  assert.match(codeEd, /let codeManifestAbort = null; \/\/ leakfix107/);
  assert.match(codeEd, /async function refresh\(\)[\s\S]{0,900}signal:ctl\.signal/);
  assert.match(app, /leakfix108/);
  assert.match(codeEd, /let codeWiringProjectsAbort = null; \/\/ leakfix108/);
  assert.match(app, /leakfix109/);
  assert.match(xr, /let roboticsHudEmotesAbort = null; \/\/ leakfix109/);
  assert.match(xr, /async function loadRoboticsHudEmotes\(\)[\s\S]{0,1600}signal: ctl\.signal/);
  assert.match(codeEd, /async function loadWiringProjects\(\)[\s\S]{0,900}signal:ctl\.signal/);
  assert.match(app, /\/api\/me\/printer-share", \{ signal: ctl\.signal \}/);
  assert.match(browser, /async function refreshFolders\(\)[\s\S]{0,3200}signal: ctl\.signal/);
  assert.match(app, /async function refreshPromptHistory\(\)[\s\S]{0,900}signal: ctl\.signal/);
  assert.match(histFn, /refreshObjectHistory/);
  assert.match(histFn, /Promise\.all/);
  assert.doesNotMatch(histFn, /currentUser \|\| isPublicProject/);
  assert.doesNotMatch(histFn, /\?view=full/);
  assert.match(loadFn, /void hydrateProjectHistories\(id, loadGen\)/);
  assert.match(loadFn, /stubLiteTimeline/);
  assert.match(loadFn, /onFirstLoaded:[\s\S]*hydrateProjectHistories/);
  assert.match(loadFn, /markViewportFirstPaint/);
  assert.match(loadFn, /Do not fetch \/timeline/);
  assert.doesNotMatch(loadFn, /in parallel with the mesh/);
  assert.match(app, /__studioDeferExplorerThumbs = true/);
  assert.match(app, /ensureActiveProjectListed[\s\S]{0,400}\?view=open/);
  assert.doesNotMatch(loadFn, /\?view=full/);
  const fullFn = app.slice(
    app.indexOf("async function hydrateFullProjectBrowser"),
    app.indexOf("\nasync function loadProject("),
  );
  assert.match(fullFn, /void hydrateProjectHistories\(id, loadGen\)/);
  assert.doesNotMatch(fullFn, /\?view=full/);
});

test("generation poll stays quiet while a project mesh is loading", () => {
  const fn = app.slice(
    app.indexOf("const poll = async () => {"),
    app.indexOf("generationPollTimers.set(pid, setInterval(poll,"),
  );
  assert.match(fn, /loadingProjectIds\.size > 0/);
  assert.match(fn, /abortGenerationPoll\(pid\)/);
  assert.match(fn, /new AbortController\(\)/);
  assert.match(fn, /api\(`\/api\/projects\/\$\{pid\}\/generation`, \{ signal: ctl\.signal \}\)/);
  assert.match(app, /setInterval\(poll, 8000\)/);
  assert.match(app, /function abortGenerationPoll\(pid\)/);
  assert.match(app, /clearGenerationPoll[\s\S]{0,180}abortGenerationPoll\(pid\)/);
});

test("explorer thumbs wait until first mesh instead of boot-rasterizing", () => {
  const browser = readFileSync(new URL("../workspace/workspace-browser.js", import.meta.url), "utf8");
  assert.match(browser, /__studioDeferExplorerThumbs/);
  assert.match(browser, /render3d:explorer-thumbs-ready/);
  assert.match(browser, /flushDeferredExplorerThumbs/);
});

test("project switch does not start a 4s bodies trimesh walk", () => {
  const fn = app.slice(
    app.indexOf("async function loadProject(id)"),
    app.indexOf("\nlet newProjectWorkspaceModalEl"),
  );
  assert.doesNotMatch(fn, /setTimeout\([\s\S]{0,200}hydrateBrowserBodyChildren/);
  assert.doesNotMatch(fn, /beginGenerationWatch\(id/);
});

test("leftover mesh from another project is replaced even if replaceExisting is omitted", async () => {
  const { context, models, calls } = fixture();
  models.add("untitled.glb");
  context.viewportMeshProjectId = "old-project";
  const ok = await context.loadProjectComponents(
    [{ name: "untitled.glb", primary: true, auto_load: true }],
    { projectId: "p1", loadGen: 1, latestFile: "untitled.glb" },
  );
  assert.equal(ok, true);
  assert.equal(context.viewportMeshProjectId, "p1");
  assert.deepEqual([...models], ["untitled.glb"]);
  assert.deepEqual(calls.filter((c) => c[0] === "load"), [["load", "untitled.glb", false]]);
});

test("same-project catalog is reused without a second fetch", async () => {
  const { context, models, calls } = fixture();
  models.add("untitled.glb");
  context.viewportMeshProjectId = "p1";
  const ok = await context.loadProjectComponents(
    [{ name: "untitled.glb", primary: true, auto_load: true }],
    { projectId: "p1", loadGen: 1, latestFile: "untitled.glb" },
  );
  assert.equal(ok, true);
  assert.equal(context.viewportMeshProjectId, "p1");
  assert.deepEqual([...models], ["untitled.glb"]);
  assert.deepEqual(calls.filter((c) => c[0] === "load"), []);
});

test("loadProjectComponents refuses to reuse another project's leftover mesh", () => {
  const fn = app.slice(
    app.indexOf("async function loadProjectComponents("),
    app.indexOf("\nasync function openSketchInViewport("),
  );
  assert.match(fn, /viewportMeshProjectId === pid/);
  assert.match(fn, /shouldReplace = replaceExisting \|\| !meshBelongsHere/);
  assert.match(fn, /reuseExisting = !shouldReplace && meshBelongsHere/);
  assert.match(fn, /leftoverSameName/);
  assert.match(fn, /ok \|\| \(meshBelongsHere && projectAssembly\.has\(entry\.name\)\)/);
});

test("cancelled load of untitled.glb does not stamp leftover as the new project", async () => {
  const { context, models } = fixture();
  models.add("untitled.glb");
  context.viewportMeshProjectId = "old-project";
  context.failLoad = true;
  const ok = await context.loadProjectComponents(
    [{ name: "untitled.glb", primary: true, auto_load: true }],
    { projectId: "p1", loadGen: 1, latestFile: "untitled.glb" },
  );
  assert.equal(ok, false);
  assert.equal(models.size, 0);
  assert.equal(context.viewportMeshProjectId, null);
});

test("project switch does not treat another project's leftover mesh as already loaded", () => {
  const fn = app.slice(
    app.indexOf("async function loadProject(id)"),
    app.indexOf("\nlet newProjectWorkspaceModalEl"),
  );
  assert.match(fn, /viewportMeshProjectId === id/);
  assert.match(fn, /viewportMeshProjectId !== id/);
  assert.match(fn, /saveHiddenComponentState\(prevProjectId\)/);
  assert.match(fn, /id === projectId && loadingProjectIds\.has\(id\)/);
  assert.match(fn, /replaceExisting: prevProjectId !== id \|\| viewportMeshProjectId !== id/);
  assert.match(fn, /cacheBust: false/);
  assert.match(fn, /keepModel: xrLive/);
  assert.doesNotMatch(fn, /keepModel: true/);
  assert.doesNotMatch(fn, /loadHubs/);
  assert.match(fn, /isInternalCadSidecar\(filename\) && !isJakeStepPreviewName\(filename\)/);
});

test("recoverViewport does not treat keepModel leftover as a successful open", () => {
  const fn = app.slice(
    app.indexOf("async function hydrateFullProjectBrowser"),
    app.indexOf("\nasync function loadProject("),
  );
  assert.match(fn, /viewportMeshProjectId === id && Number\(projectAssembly\.count/);
  assert.equal([...fn.matchAll(/if \(Number\(projectAssembly\.count\?\.?\(\) \|\| 0\) > 0\) return/g)].length, 0);
});

test("reloadViewportFromProject pins reloadPid and does not load another project's files", () => {
  const fn = app.slice(
    app.indexOf("async function reloadViewportFromProject("),
    app.indexOf("\nasync function restoreAssemblySiblingsAfterXr("),
  );
  assert.match(fn, /const reloadPid = projectId/);
  assert.match(fn, /loadProjectSketches\?\.\(reloadPid/);
  assert.match(fn, /projectFileUrl\(reloadPid/);
  assert.match(fn, /projectId: reloadPid/);
  assert.equal([...fn.matchAll(/if \(reloadPid !== projectId\) return/g)].length >= 4, true);
  assert.doesNotMatch(fn, /projectFileUrl\(projectId,/);
  assert.doesNotMatch(fn, /loadProjectComponents\(comps, \{\s*projectId,/);
});

test("model cache-bust covers public and private project files", () => {
  const fn = app.slice(
    app.indexOf("function _cacheBustModelPath"),
    app.indexOf("\nfunction sleep("),
  );
  assert.match(fn, /modelCachePath\(path/);
  for (const scope of ["", "public/"]) {
    const path = `/api/${scope}projects/p1/files/model.glb`;
    assert.equal(modelCachePath(path, { force: 42 }), `${path}?_=42`);
  }
});

test("mesh blob fetches abort instead of waiting on a hung origin", () => {
  const fn = app.slice(
    app.indexOf("async function fetchModelBlob"),
    app.indexOf("\nfunction sanitizeGltfNodeCycles"),
  );
  assert.match(fn, /rawFetch\(fetchPath, \{\}, 25000\)/);
});
