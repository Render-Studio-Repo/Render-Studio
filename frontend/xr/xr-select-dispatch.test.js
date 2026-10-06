import { test } from "node:test";
import {createXrUiPressLatch} from "./xr-ui-press-latch.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {panelChromeStartsDrag} from './xr-window-manager.js';
import {
  isXrUiHoverKind,
  preferUiHoverHit,
  preferHudHitOverCad,
  hudHitStealsCad,
  resolveSelectAim,
  laserPickNode,
  xrPollSelectPointer,
} from "./xr-hot-path.js?v=roboticsworkspace3";

// Exercise the real viewport functions without constructing a WebGL renderer.
const source = readFileSync(new URL("./viewport-xr.js", import.meta.url), "utf8");
function viewportFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

function harness() {
  const left = { hand: 0, posed: true };
  const right = { hand: 1, posed: true };
  const grips = [{ hand: 0, posed: true, grip: true }, { hand: 1, posed: true, grip: true }];
  const state = { picks: new Map(), aabbs: new Map(), clicks: [], draws: [], grabbed: [], notes: [], panel: {userData:{}} };
  const context = vm.createContext({
    THREE: { Vector3: class Vector3 {} },
    performance: { now: () => 1000 },
    blurXrDom() {},
    aiDrawWorkspace:{pickUI:()=>null,select:()=>false,isActive:()=>false},
    roboticsWorkspace:{select:hit=>state.clicks.push(hit.panel)},
    roboticsOwnsControls:false,
    isDimosTeleopArmed:()=>false,
    studioRoboticsInputAllowed:()=>true,
    reserveDimosMenuTrigger(){},
    window:{dispatchEvent(){}},CustomEvent:class{},
    squeezeHandIndex: (node) => node?.hand ?? -1,
    objectIsPosed: (node) => !!node?.posed,
    getLeftGrip: () => grips[0],
    getRightGrip: () => grips[1],
    aimPointer: (hand) => [left, right][hand],
    posedControllerForHand: (hand) => [left, right][hand],
    fallbackSelectPointer: () => null,
    resolveSelectAim,
    laserPickNode,
    xrPollSelectPointer,
    pickWithController: (node) => state.picks.get(node) || null,
    controllerAimRay: (node, origin) => { origin.node = node; return true; },
    menuHitFromAabb: (origin) => state.aabbs.get(origin.node) || null,
    mapHudPointToAction: (point) => point?.action || null,
    remapHudChromeHit: (hit) => hit,
    preferUiHoverHit,
    preferHudHitOverCad,
    hudHitStealsCad,
    isXrUiHoverKind,
    isXrSceneWindowHitKind:()=>false,
    isUiPick: (hit) => !!hit && isXrUiHoverKind(hit.kind),
    xrUiPickBlocksDraw: (hit) => !!hit && isXrUiHoverKind(hit.kind),
    xrSelectDebounceBlocks: () => false,
    lastSelectAt: 0,
    uiSelectPress: createXrUiPressLatch(),
    noteSelectConsume: (note) => state.notes.push(note),
    lastPointerHoverHit: { kind: "studio-tab", tab: "left-other-hand" },
    lastRayOnMenu: true,
    lastMenuAimNear: true,
    gripGrab: null,
    panelDrag: null,
    activeTool: "grab",
    xrBoard: null,
    dock: {},
    captureDock: null,
    controllerNearMesh: () => false,
    beginGrab: (node) => state.grabbed.push(node),
    xrStudio: { setTab: (tab) => state.clicks.push(tab) },
    refreshStudioPanel() {},
    handleViewAction: (id) => state.clicks.push(id),
    panelChromeStartsDrag,
    panelGroupFromHit:()=>state.panel,
    beginPanelDrag: (...args)=>state.grabbed.push(args),
    explorerPanel:{group:{visible:true}},
    menuTab:'social',menuFooterHint:'',socialPane:'hub',socialFocusId:'',socialProfile:null,
    presenting:true,openMenuConsole(){},onStatus(){},
    onSocialAction:action=>{state.clicks.push(action);return Promise.resolve({ok:true,message:'Connected to public room'});},
    laserPointerActive: () => false,
    triggers: [false, true],
    prevTrigger: [false, false],
    sampleVoiceDraw: (hand) => { state.draws.push(hand); return true; },
    drawPointFromController: () => ({ point: { x: 0.3, y: 1.1, z: -0.4 } }),
    localAuthor: () => ({ id: "test" }),
    voiceDraw: { isDrawing: () => false, begin: () => state.draws.push("ink") },
    solidDrawPoint: () => ({ x: 0.3, y: 1.1, z: -0.4 }),
    xrBuild: { snapEnabled: () => false },
    xrSolidDraw: { isActive: () => false, begin: () => state.draws.push("solid") },
    endGrab() {},
  });
  vm.runInContext(viewportFunction("pickControllerSelectHit"), context);
  vm.runInContext(viewportFunction("handleSelect"), context);
  const pollStart = source.indexOf("    // Trigger / pinch edge:");
  const pollEnd = source.indexOf("\n    if (panelDrag &&", pollStart);
  assert.ok(pollStart >= 0 && pollEnd > pollStart);
  vm.runInContext(`function pollTriggerForTest() { ${source.slice(pollStart, pollEnd)} }`, context);
  return { context, state, left, right, grips };
}

test("right trigger miss never clicks a left-hand hover or differently aimed grip", () => {
  const { context, state, right, grips } = harness();
  state.picks.set(grips[1], { kind: "studio-tab", tab: "grip-direction" });
  context.handleSelect(right);
  assert.deepEqual(state.clicks, []);
  assert.deepEqual(state.grabbed, []);
  assert.equal(state.notes[0].hasPick, false);
});

test("right trigger dispatches its own laser hit despite another hand's hover", () => {
  const { context, state, right } = harness();
  state.picks.set(right, { kind: "studio-tab", tab: "projects" });
  context.handleSelect(right);
  assert.deepEqual(state.clicks, ["projects"]);
  assert.equal(state.panel.userData.xrHudParked, true);
  assert.equal(state.panel.userData.xrUserRotated, true);
});

test('clicking menu backgrounds never starts dragging, including geometric fallback',()=>{
 for(const kind of ['menu-chrome','robotics-chrome','studio-chrome','view-chrome','grid-chrome']){
  const {context,state,right}=harness();state.picks.set(right,{kind});context.handleSelect(right);
  assert.deepEqual(state.grabbed,[],kind);
 }
});

test('Join click reaches the room callback and clears only its own old trigger drag',async()=>{
 const {context,state,right}=harness();context.panelDrag={hand:1,input:'trigger'};
 state.picks.set(right,{kind:'menu-row',line:{id:'public_join',kind:'social'}});
 context.handleSelect(right);await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(state.clicks,['public_join']);assert.equal(context.panelDrag,null);
 assert.deepEqual(state.grabbed,[]);assert.equal(context.socialPane,'room');
});

test('robotics menu buttons clear old trigger drags without moving the panel',()=>{
 const {context,state,right}=harness();context.panelDrag={hand:1,input:'trigger'};
 state.picks.set(right,{kind:'robotics-workspace-action',panel:'hud'});
 context.handleSelect(right);assert.deepEqual(state.clicks,['hud']);assert.equal(context.panelDrag,null);
 assert.deepEqual(state.grabbed,[]);
});

test('duplicate select events preserve an explicit trigger drag',()=>{
 const {context,state,right}=harness();
 const drag={hand:1,input:'trigger'};context.panelDrag=drag;
 context.uiSelectPress.commit(1);
 state.picks.set(right,{kind:'studio-drag'});
 context.handleSelect(right);
 assert.equal(context.panelDrag,drag);assert.deepEqual(state.grabbed,[]);
});

test('explicit Move handles remain available',()=>{
 const {context,state,right}=harness();
 state.picks.set(right,{kind:'studio-drag'});
 context.handleSelect(right);assert.equal(state.grabbed.length,1);
 assert.equal(state.grabbed[0][0],right);
});

test("trigger reaches a same-ray HUD fallback even when the mesh raycast misses", () => {
  const { context, state, right } = harness();
  state.aabbs.set(right, {
    kind: "menu-chrome", fromAabb: true, distance: 0.6,
    point: { action: { kind: "studio-tab", tab: "history" } },
  });
  context.handleSelect(right);
  assert.deepEqual(state.clicks, ["history"]);
});

test("native select while gripping a part keeps trigger reserved for rotation", () => {
  const { context, state, right } = harness();
  state.picks.set(right, { kind: "studio-tab", tab: "projects" });
  context.gripGrab = { hand: 1 };
  context.handleSelect(right);
  assert.deepEqual(state.clicks, []);
  assert.deepEqual(state.notes, []);
});

test("trigger down while gripping a window cannot click or start drawing", () => {
  const { context, state, right } = harness();
  context.panelDrag = { hand: 1, input: "grip" };
  state.picks.set(right, { kind: "studio-tab", tab: "projects" });
  context.handleSelect(right);
  context.activeTool = "draw";
  context.pollTriggerForTest();
  assert.deepEqual(state.clicks, []);
  assert.deepEqual(state.draws, []);
});

test("other-hand button click preserves a grip window's ownership", () => {
  const { context, state, right } = harness();
  const heldWindow = { hand: 0, input: "grip" };
  context.panelDrag = heldWindow;
  state.picks.set(right, { kind: "view-action", id: "reset" });
  context.handleSelect(right);
  assert.deepEqual(state.clicks, ["reset"]);
  assert.equal(context.panelDrag, heldWindow);
});

test("unidentified input cannot click the right controller's menu", () => {
  const { context, state, right } = harness();
  state.picks.set(right, { kind: "studio-tab", tab: "projects" });
  context.handleSelect({ posed: true });
  assert.deepEqual(state.clicks, []);
});

test("other-hand menu hover does not intercept this hand's draw trigger", () => {
  const { context, state } = harness();
  context.activeTool = "draw";
  context.pollTriggerForTest();
  assert.deepEqual(state.draws, [1]);
  assert.deepEqual(state.clicks, []);
});

test("this hand's menu ray takes priority over draw", () => {
  const { context, state, right } = harness();
  context.activeTool = "draw";
  state.picks.set(right, { kind: "studio-tab", tab: "projects" });
  context.pollTriggerForTest();
  assert.deepEqual(state.draws, []);
  assert.deepEqual(state.clicks, ["projects"]);
});

for (const [name, tool, expected] of [
  ["sampleVoiceDraw", "draw", "ink"],
  ["sampleSolidDraw", "create_box", "solid"],
]) {
  test(`${name} ignores other-hand hover but still blocks its own menu hit`, () => {
    const { context, state, right } = harness();
    context.activeTool = tool;
    vm.runInContext(viewportFunction(name), context);
    assert.equal(context[name](1, right), true);
    assert.deepEqual(state.draws, [expected]);
    state.picks.set(right, { kind: "studio-tab", tab: "projects" });
    assert.equal(context[name](1, right), false);
    assert.deepEqual(state.draws, [expected]);
  });
}
