async () => {
  const THREE = await import("three");
  const { createViewportXR } = await import("/xr/viewport-xr.js?runtime-smoke=1");
  const checks = [];
  window.__xrRuntimeChecks = checks;
  const check = (condition, label) => {
    if (!condition) throw new Error(`XR runtime regression: ${label}`);
    checks.push(label);
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.01, 100);
  camera.position.set(0, 1.6, 0);
  scene.add(camera);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(1200, 900);
  document.getElementById("viewport").append(renderer.domElement);
  const controllers = [new THREE.Group(), new THREE.Group()];
  const grips = [new THREE.Group(), new THREE.Group()];
  const hands = [new THREE.Group(), new THREE.Group()];
  hands.forEach((hand) => { hand.joints = {}; });
  const sources = ["left", "right"].map((handedness, index) => ({
    handedness, targetRayMode: "tracked-pointer",
    profiles: ["meta-quest-touch-plus", "oculus-touch-v3"],
    targetRaySpace: { index, kind: "ray" }, gripSpace: { index, kind: "grip" },
    gamepad: {
      mapping: "xr-standard", axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 6 }, () => ({ pressed: false, touched: false, value: 0 })),
    },
  }));
  const referenceSpace = new EventTarget();
  const session = new EventTarget();
  const frame = {
    session,
    getPose(space) {
      const node = (space.kind === "grip" ? grips : controllers)[space.index];
      return { transform: { position: node.position, orientation: node.quaternion, matrix: node.matrix.toArray() } };
    },
    getViewerPose: () => ({ transform: { position: camera.position, orientation: camera.quaternion } }),
  };
  const manager = {
    enabled: true, isPresenting: false, cameraAutoUpdate: true,
    getController: (i) => controllers[i], getControllerGrip: (i) => grips[i], getHand: (i) => hands[i],
    getCamera: () => camera, getReferenceSpace: () => referenceSpace, getFrame: () => frame,
    getSession: () => manager.isPresenting ? session : null,
    getEnvironmentBlendMode: () => "opaque",
    setSession: async (value) => { manager.isPresenting = !!value; },
    setReferenceSpaceType() {}, setFramebufferScaleFactor() {}, setFoveation() {}, updateCamera() {},
  };
  Object.assign(session, {
    inputSources: sources, visibilityState: "visible", environmentBlendMode: "opaque", interactionMode: "world-space",
    renderState: { baseLayer: {} }, updateRenderState() {},
    requestReferenceSpace: async () => referenceSpace,
    requestAnimationFrame: (callback) => setTimeout(() => callback(performance.now(), frame), 1),
    end: async () => { manager.isPresenting = false; session.dispatchEvent(new Event("end")); },
  });
  renderer.xr = manager;
  Object.defineProperty(navigator, "xr", {
    configurable: true,
    value: { isSessionSupported: async () => true, requestSession: async () => session },
  });
  const assembly = new THREE.Group();
  assembly.name = "test-project";
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xd96446 }));
  body.name = "test CAD part";
  assembly.add(body);
  scene.add(assembly);
  const api = createViewportXR({
    renderer, scene, camera, controls: { enabled: true }, getMeshRoot: () => assembly,
    getProjectId: () => "runtime-test", getMmPerUnit: () => 1000, formatLength: (v) => `${v} mm`,
    getProjects: () => [{ id: "runtime-test", name: "Runtime test" }], getExplorerItems: () => [],
    getXrStudioState: () => ({}), getToken: () => "",
  });
  controllers.forEach((controller, i) => {
    controller.position.set(i ? 0.3 : -0.3, 1.2, -0.2);
    controller.updateMatrix();
    controller.dispatchEvent({ type: "connected", data: sources[i] });
  });
  grips.forEach((grip, i) => {
    grip.position.copy(controllers[i].position);
    grip.updateMatrix();
    grip.dispatchEvent({ type: "connected", data: sources[i] });
  });
  const enter = async () => {
    window.__xrBootEnter = { fromBoot: true, projectId: "runtime-test", openMenu: true, emptyScene: false };
    await api.enter();
    for (let i = 0; i < 10; i += 1) { api.update(); await wait(250); }
    api.openMenuConsole({ tab: "projects", forcePlace: true });
    api.update();
  };
  const worldPosition = (object) => object.getWorldPosition(new THREE.Vector3());
  const moveRight = (position, direction = null) => {
    controllers[1].position.copy(position);
    if (direction) controllers[1].quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    grips[1].position.copy(controllers[1].position);
    grips[1].quaternion.copy(controllers[1].quaternion);
    scene.updateMatrixWorld(true);
  };
  const button = (index, pressed) => {
    sources[1].gamepad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
  };
  const squeeze = (pressed) => {
    button(1, pressed);
    controllers[1].dispatchEvent({ type: pressed ? "squeezestart" : "squeezeend", data: sources[1] });
    api.update();
  };
  await enter();
  check(api.isPresenting(), "synthetic local-floor session enters");
  const tabs = api.__runtimeTest.state().explorerPanel.tabHits.map((target) => target.userData.xrMenuTab);
  for (const tab of tabs) {
    const target = api.__runtimeTest.state().explorerPanel.tabHits.find((row) => row.userData.xrMenuTab === tab);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()));
    moveRight(worldPosition(target).addScaledVector(normal, 0.5), normal.negate());
    api.update();
    const hit = api.__runtimeTest.selectPick(controllers[1]);
    check(hit?.kind === "menu-tab" && hit.tab === tab, `laser hits ${tab} tab (actual ${hit?.kind}/${hit?.tool || hit?.tab || ""} at ${hit?.distance})`);
    button(0, true);
    api.update();
    check(api.__runtimeTest.state().menuTab === tab, `trigger opens ${tab} tab`);
    button(0, false);
    api.update();
    await wait(260); // Separate actual clicks across the production debounce.
  }
  // Both cross-hand wrist menus remain clickable with a world window behind them.
  const moveHand = (hand, position, direction) => {
    controllers[hand].position.copy(position);
    if (direction) controllers[hand].quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    grips[hand].position.copy(position);
    grips[hand].quaternion.copy(controllers[hand].quaternion);
    scene.updateMatrixWorld(true);
  };
  const pressHand = (hand, index, pressed) => {
    sources[hand].gamepad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
    if (index === 1) controllers[hand].dispatchEvent({ type: pressed ? "squeezestart" : "squeezeend", data: sources[hand] });
    api.update();
  };
  for (const [hand, key, tool] of [[1, "dockButtons", "view"], [0, "statusHits", "passthrough"]]) {
    // Put the target wrist in its natural side of the headset first.
    moveHand(1 - hand, new THREE.Vector3(hand ? -.3 : .3, 1.2, -.35), new THREE.Vector3(0, 0, -1));
    api.update();
    const state = api.__runtimeTest.state();
    const target = state[key].find((node) => node.userData.xrTool === tool);
    const point = worldPosition(target);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()));
    state.explorerPanel.group.position.copy(point).addScaledVector(normal, -.35);
    state.explorerPanel.group.quaternion.copy(target.getWorldQuaternion(new THREE.Quaternion()));
    state.explorerPanel.group.updateMatrixWorld(true);
    moveHand(hand, point.clone().addScaledVector(normal, .4), normal.clone().negate());
    api.update();
    const hit = api.__runtimeTest.selectPick(controllers[hand]);
    check(hit?.source === "wrist" && hit.tool === tool, `${hand ? "right" : "left"} ray hits opposite wrist button ahead of world menu`);
    const oldPass = state.passthroughOn;
    await wait(260);
    pressHand(hand, 0, true);
    pressHand(hand, 0, false);
    await wait(300); api.update();
    const next = api.__runtimeTest.state();
    check(tool === "view" ? next.viewPanel?.group?.visible : next.passthroughOn !== oldPass,
      `${hand ? "right" : "left"} trigger activates opposite wrist button`);
    pressHand(hand, 0, false);
    if (next.viewPanel) next.viewPanel.group.visible = false;
    const ray = controllers[hand].getObjectByName("xrRay");
    check(ray.visible && ray.geometry.parameters.radiusTop * ray.scale.x <= .0005, "wrist pointer beam stays under 1 mm wide");
  }
  moveHand(0, new THREE.Vector3(-.3, 1.2, -.2), new THREE.Vector3(0, 0, -1));
  api.openMenuConsole({ tab: "projects", forcePlace: true });
  api.update();
  for (const tool of ["draw", "create_box"]) {
    const wantedTab = tool === "draw" ? "files" : "parts";
    api.__runtimeTest.setTool(tool); api.update();
    const target = api.__runtimeTest.state().explorerPanel.tabHits.find((node) => node.userData.xrMenuTab === wantedTab);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()));
    moveRight(worldPosition(target).addScaledVector(normal, .5), normal.clone().negate()); api.update();
    const hit = api.__runtimeTest.selectPick(controllers[1]);
    check(hit?.kind === "menu-tab" && hit.tab === wantedTab, `${tool} hand controls do not intercept outgoing menu ray (${hit?.kind}/${hit?.tool || hit?.tab})`);
    await wait(260); button(0, true); api.update(); button(0, false); api.update();
    check(api.__runtimeTest.state().menuTab === wantedTab, `${tool} trigger still clicks world menu (${api.__runtimeTest.state().menuTab}, ${api.__runtimeTest.state().lastXrConsume})`);
  }
  // Context palette: real cross-hand rays and trigger dispatch, including settings.
  api.__runtimeTest.state().explorerPanel.group.visible = false;
  moveHand(1, new THREE.Vector3(.3, 1.2, -.4), new THREE.Vector3(0, 0, -1));
  api.__runtimeTest.setTool("draw"); api.update();
  const clickContext = async (id) => {
    api.update();
    const target = api.__runtimeTest.state().toolHand.buttons.find((node) => node.visible && node.userData.xrTool === id);
    check(!!target, `context control ${id} is visible`);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()));
    moveHand(0, worldPosition(target).addScaledVector(normal, .3), normal.negate()); api.update();
    const hit = api.__runtimeTest.selectPick(controllers[0]);
    check(hit?.tool === id, `opposite hand precisely picks ${id} (${hit?.kind}/${hit?.tool})`);
    await wait(260); pressHand(0, 0, true); pressHand(0, 0, false); api.update();
  };
  for (const brush of ["brush", "highlighter", "pen"]) {
    await clickContext(`draw_brush_${brush}`);
    const state = api.__runtimeTest.state();
    check(state.drawBrush === brush && state.activeTool === "draw", `${brush} setting preserves drawing mode`);
    const visibleTips = state.drawPencils.filter((node) => node.visible);
    check(visibleTips.length === 1 && visibleTips[0].userData.toolKind === brush && visibleTips[0].parent === controllers[1], `${brush} silhouette follows dominant target-ray tip`);
    const ink = state.voiceDraw;
    ink.begin(new THREE.Vector3(2, 1, -1));
    for (let n = 1; n <= 8; n++) ink.append(new THREE.Vector3(2 + n * .02, 1, -1));
    ink.end();
    const rec = ink.serializeStroke();
    const tube = ink.listDrawables().filter((node) => node.userData.xrStrokeTube).at(-1);
    check(rec.brush === brush && tube.material.opacity === (brush === "highlighter" ? .35 : 1), `${brush} commits its stroke appearance`);
  }
  let restyledChrome = false;
  api.__runtimeTest.state().toolHand.group.traverse((node) => { restyledChrome ||= !!node.userData.xrControllerOverlayStyled; });
  check(!restyledChrome, "controller rendering leaves context-menu textures and backplate untouched");
  await clickContext("color_e85d4c");
  await clickContext("draw_size_l");
  check(api.__runtimeTest.state().drawColor === 0xe85d4c && api.__runtimeTest.state().drawSizeId === "draw_size_l" && api.__runtimeTest.state().activeTool === "draw", "color and width controls update settings without selecting a bogus tool");
  api.__runtimeTest.setTool("create_box"); api.update();
  for (const shape of ["sphere", "cylinder", "cone", "torus", "wall", "floor", "box"]) {
    await clickContext(`create_${shape}`);
    const state = api.__runtimeTest.state();
    check(state.activeTool === `create_${shape}` && state.drawPencils.find((node) => node.visible)?.userData.toolKind === shape, `${shape} selection changes the actual tool and miniature`);
    check(!state.toolHand.buttons.some((node) => node.visible && node.userData.xrTool.startsWith("draw_brush_")), "shape context hides brush controls");
  }
  await clickContext("color_22c55e");
  check(api.__runtimeTest.state().drawColor === 0x22c55e && api.__runtimeTest.state().activeTool === "create_box", "shape color changes without leaving Cube");
  const solid = api.__runtimeTest.state().xrSolidDraw;
  solid.begin("create_box", new THREE.Vector3(2, 1, -1));
  check(scene.getObjectByName("xrSolidDraw").children.some((node) => node.material?.color?.getHex() === 0x22c55e), "shape preview uses the context color");
  solid.cancel();
  await clickContext("box_move");
  check(api.__runtimeTest.state().toolHand.boxMode() === "box_move", "shape edit control updates move mode");
  api.__runtimeTest.setTool("dock_hand"); api.update();
  const leftContext = api.__runtimeTest.state();
  check(leftContext.drawPencils.find((node) => node.visible)?.parent === controllers[0] && leftContext.toolHand.group.parent === grips[0], "left-dominant preference moves tip and settings to the left hand");
  api.__runtimeTest.setTool("dock_hand"); api.update();
  moveHand(0, new THREE.Vector3(-.3, 1.2, -.2), new THREE.Vector3(0, 0, -1));
  api.__runtimeTest.setTool("grab");
  await wait(350);
  api.openMenuConsole({ tab: "projects", forcePlace: true, force: true }); api.update();
  let state = api.__runtimeTest.state();
  const panel = state.explorerPanel;
  const title = panel.titleBar || panel.plane;
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(title.getWorldQuaternion(new THREE.Quaternion()));
  moveRight(worldPosition(title).addScaledVector(normal, 0.02));
  squeeze(true);
  state = api.__runtimeTest.state();
  check(state.panelDrag?.input === "grip" && state.panelDrag.hand === 1 && state.panelDrag.group === panel.group,
    `one right grip acquires the contacted window (${state.panelDrag?.hand}/${state.panelDrag?.group?.name}, visible=${panel.group.visible})`);
  const beforePanel = worldPosition(panel.group);
  moveRight(grips[1].position.clone().add(new THREE.Vector3(0.1, 0, 0)));
  api.update();
  check(worldPosition(panel.group).distanceTo(beforePanel) > 0.05, "contacted window follows one hand");
  squeeze(false);
  check(!api.__runtimeTest.state().panelDrag, "window releases on squeeze end");
  panel.group.visible = false;
  moveRight(worldPosition(body));
  squeeze(true);
  state = api.__runtimeTest.state();
  check(state.gripGrab?.hand === 1 && state.gripGrab.target === assembly, "one right grip acquires the real CAD surface");
  const beforeCad = worldPosition(assembly);
  moveRight(grips[1].position.clone().add(new THREE.Vector3(0.08, 0, 0)));
  api.update();
  check(worldPosition(assembly).distanceTo(beforeCad) > 0.04, "contacted CAD follows one hand");
  const beforeRotation = assembly.getWorldQuaternion(new THREE.Quaternion());
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(.35, .6, -.4));
  grips[1].quaternion.premultiply(delta);
  controllers[1].quaternion.copy(grips[1].quaternion);
  scene.updateMatrixWorld(true);
  api.update();
  check(assembly.getWorldQuaternion(new THREE.Quaternion()).angleTo(delta.clone().multiply(beforeRotation)) < .001,
    "single grip freely rotates CAD on all three axes without trigger");
  const beforeTrigger = assembly.quaternion.clone();
  button(0, true); api.update(); button(0, false); api.update();
  check(assembly.quaternion.angleTo(beforeTrigger) < .001, "trigger changes during grip do not reset model rotation");
  const originalScale = assembly.scale.clone();
  const rightPosition = grips[1].position.clone();
  moveHand(0, rightPosition.clone().add(new THREE.Vector3(.08, 0, 0)), new THREE.Vector3(0, 0, -1));
  pressHand(0, 1, true);
  check(!!api.__runtimeTest.state().scaleGrab, "second touching grip starts resizing held CAD");
  moveHand(0, rightPosition.clone().add(new THREE.Vector3(.28, 0, 0)), new THREE.Vector3(0, 0, -1));
  api.update();
  check(Math.abs(assembly.scale.x / originalScale.x - 3.5) < .01, "two grips enlarge beyond the former 2.2x limit");
  moveHand(0, rightPosition.clone().add(new THREE.Vector3(.02, 0, 0)), new THREE.Vector3(0, 0, -1));
  api.update();
  check(Math.abs(assembly.scale.x / originalScale.x - .25) < .01, "two grips shrink below the former 0.4x limit");
  const afterScale = assembly.scale.clone();
  pressHand(0, 1, false);
  check(assembly.scale.distanceTo(afterScale) < .001 && !!api.__runtimeTest.state().gripGrab,
    "releasing second hand keeps new scale and first-hand grip");
  moveHand(0, worldPosition(body).add(new THREE.Vector3(.015, 0, 0)), new THREE.Vector3(0, 0, -1));
  pressHand(0, 1, true);
  check(!!api.__runtimeTest.state().scaleGrab, "either hand can rejoin the held model for another resize");
  pressHand(1, 1, false);
  check(api.__runtimeTest.state().gripGrab?.hand === 0, "releasing original resize hand transfers hold to remaining left hand");
  const leftStart = assembly.getWorldQuaternion(new THREE.Quaternion());
  const leftDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, -.3, .1));
  grips[0].quaternion.premultiply(leftDelta); scene.updateMatrixWorld(true); api.update();
  check(assembly.getWorldQuaternion(new THREE.Quaternion()).angleTo(leftDelta.clone().multiply(leftStart)) < .001,
    "remaining left grip freely rotates the resized model");
  await wait(150); api.update(); pressHand(0, 1, false);
  await wait(150); // Avoid synthesizing an intentional high-velocity toss.
  api.update();
  squeeze(false);
  check(!api.__runtimeTest.state().gripGrab, "CAD releases on squeeze end");
  moveRight(new THREE.Vector3(2, 1.2, -0.2));
  squeeze(true);
  state = api.__runtimeTest.state();
  check(!state.gripGrab && !state.panelDrag, "grip in empty space acquires nothing");
  squeeze(false);
  // A trigger-selected object follows the physical grip's rotation too.
  assembly.position.set(0, 1.2, -.65); assembly.quaternion.identity(); assembly.scale.setScalar(.6);
  scene.updateMatrixWorld(true);
  moveRight(new THREE.Vector3(0, 1.2, -.35), new THREE.Vector3(0, 0, -1));
  api.update(); await wait(260);
  button(0, true); api.update();
  check(!!api.__runtimeTest.state().grabState, "trigger acquires a pointed CAD model");
  const triggerStart = assembly.getWorldQuaternion(new THREE.Quaternion());
  const triggerDelta = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.4, .3, .6));
  grips[1].quaternion.premultiply(triggerDelta); scene.updateMatrixWorld(true); api.update();
  check(assembly.getWorldQuaternion(new THREE.Quaternion()).angleTo(triggerDelta.clone().multiply(triggerStart)) < .001,
    "trigger-held CAD follows physical grip rotation independently of aim ray");
  button(0, false); api.update();
  check(!api.__runtimeTest.state().grabState, "trigger release drops rotated CAD");
  moveRight(new THREE.Vector3(2, 1.2, -.2), new THREE.Vector3(0, 0, -1)); api.update();
  const idleRay = controllers[1].getObjectByName("xrRay"), idleTip = controllers[1].getObjectByName("xrRayTip");
  check(!idleRay.visible && idleTip.visible && Math.abs(idleTip.position.z) < .03, "empty-space pointer is a tiny nearby point with no beam");
  const restartAt = performance.now();
  await Promise.race([
    api.__runtimeTest.restart(),
    wait(3000).then(() => { throw new Error("In-place XR restart did not settle"); }),
  ]);
  check(performance.now() - restartAt < 3000 && api.isPresenting(), "in-place restart settles without ending XR");
  api.openMenuConsole({ tab: "projects", forcePlace: true });
  api.update();
  const restartTarget = api.__runtimeTest.state().explorerPanel.tabHits.find((row) => row.userData.xrMenuTab === "files");
  const restartNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(restartTarget.getWorldQuaternion(new THREE.Quaternion()));
  moveRight(worldPosition(restartTarget).addScaledVector(restartNormal, 0.5), restartNormal.negate());
  await wait(260);
  button(0, true);
  api.update();
  check(api.__runtimeTest.state().menuTab === "files", "trigger still works after in-place restart");
  button(0, false);
  api.update();
  await api.exit();
  check(!api.isPresenting(), "session exit clears presenting state");
  await enter();
  check(api.isPresenting(), "a second session enters after exit");
  state = api.__runtimeTest.state();
  const target = state.explorerPanel.tabHits.find((row) => row.userData.xrMenuTab === "parts");
  const secondNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(target.getWorldQuaternion(new THREE.Quaternion()));
  moveRight(worldPosition(target).addScaledVector(secondNormal, 0.5), secondNormal.negate());
  api.update();
  button(0, true);
  api.update();
  check(api.__runtimeTest.state().menuTab === "parts", "trigger still works after a second session enters");
  button(0, false);
  moveRight(new THREE.Vector3(0.3, 1.2, -0.2), new THREE.Vector3(0, 0, -1));
  api.update();
  moveHand(0, new THREE.Vector3(-.3, 1.2, -.35), new THREE.Vector3(0, 0, -1)); api.update();
  const shotTarget = api.__runtimeTest.state().dockButtons.find((node) => node.userData.xrTool === "view");
  const shotPoint = worldPosition(shotTarget);
  const shotNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(shotTarget.getWorldQuaternion(new THREE.Quaternion()));
  moveRight(shotPoint.clone().addScaledVector(shotNormal, .3), shotNormal.negate()); api.update();
  // Frame both test model and left-hand menu for the saved browser artifact.
  // Assertions above used the unchanged headset camera throughout.
  camera.position.set(0, 1.6, 0.3);
  camera.lookAt(-0.3, 1.45, -0.5);
  manager.isPresenting = false;
  renderer.render(scene, camera);
  manager.isPresenting = true;
  window.__xrToolPreview = (tool) => {
    api.__runtimeTest.setTool(tool === "highlighter" ? "draw" : tool);
    if (tool === "highlighter") api.__runtimeTest.setTool("draw_brush_highlighter");
    moveHand(1, new THREE.Vector3(.16, 1.35, -.42), new THREE.Vector3(0, 0, -1));
    moveHand(0, new THREE.Vector3(-.3, 1.2, -.4), new THREE.Vector3(0, 0, -1));
    api.update();
    api.__runtimeTest.state().explorerPanel.group.visible = false;
    camera.position.set(.1, 1.45, .02); camera.lookAt(.13, 1.35, -.4);
    manager.isPresenting = false; renderer.render(scene, camera); manager.isPresenting = true;
  };
  return { checks, count: checks.length, referenceSpace: "local-floor", threeRevision: THREE.REVISION };
}
