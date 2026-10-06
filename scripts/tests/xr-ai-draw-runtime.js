async () => {
  const { THREE, scene, camera, renderer, manager, controllers, grips, sources,
    session, api: viewport, assembly, body, moveHand, pressHand, wait, check, checks } = window.__xrAiFixture;
  const { prepareDrawModel, normalizeDrawAssets } = await import("/xr/xr-ai-draw-assets.js?runtime-test=1");
  const startCheck = checks.length;
  const command = (board, payload) => {
    const result = board.dispatch(payload);
    if (result.error) throw new Error(result.error);
    return result.id;
  };
  const resources = (group) => {
    const result = { objects: [], geometries: [], materials: [], textures: [], canvases: new Set() };
    group.traverse((object) => {
      result.objects.push(object.uuid);
      if (object.geometry) result.geometries.push(object.geometry);
      for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) {
        result.materials.push(material);
        if (material.map) {
          result.textures.push(material.map);
          if (material.map.image?.getContext) result.canvases.add(material.map.image);
        }
      }
    });
    return result;
  };
  const sameRefs = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const persistedJson = value => JSON.stringify(value, (_key, item) => typeof item === "number" ? Math.round(item * 1e12) / 1e12 : item);
  const measure = (fn, count = 300) => {
    for (let i = 0; i < 30; i += 1) fn();
    const times = [];
    for (let i = 0; i < count; i += 1) { const start = performance.now(); fn(); times.push(performance.now() - start); }
    times.sort((a, b) => a - b);
    return { samples: count, medianMs: times[Math.floor(count / 2)], p95Ms: times[Math.floor(count * .95)], maxMs: times[count - 1] };
  };
  const idleAssertions = (workspace, label) => {
    const before = resources(workspace.view.root);
    const textureVersions = before.textures.map(texture => texture.version);
    const state = workspace.board.getState();
    let paints = 0;
    const clearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (before.canvases.has(this.canvas)) paints += 1;
      return clearRect.apply(this, args);
    };
    let cost;
    try { cost = measure(() => workspace.update(performance.now()), 500); }
    finally { CanvasRenderingContext2D.prototype.clearRect = clearRect; }
    const after = resources(workspace.view.root);
    check(workspace.board.getState() === state, `${label}: idle frames preserve authoritative state identity`);
    check(sameRefs(before.objects, after.objects), `${label}: idle frames do not rebuild scene objects`);
    check(sameRefs(before.geometries, after.geometries), `${label}: idle frames reuse geometry`);
    check(sameRefs(before.materials, after.materials) && sameRefs(before.textures, after.textures), `${label}: idle frames reuse materials and textures`);
    check(sameRefs(textureVersions, after.textures.map(texture => texture.version)), `${label}: idle frames do not upload text/image textures`);
    check(paints === 0, `${label}: idle frames do not repaint board text canvases (${paints})`);
    return cost;
  };

  const source = new THREE.Group(); source.name = "Housing source";
  source.position.set(20, 50, 80); source.rotation.set(.2, .3, -.1);
  const geometry = new THREE.BoxGeometry(120, 80, 40);
  const sourceMaterial = new THREE.MeshStandardMaterial({ color: "#6795a6" });
  const firstPart = new THREE.Mesh(geometry, sourceMaterial); firstPart.position.set(60, 0, 0); source.add(firstPart);
  const secondPart = new THREE.Mesh(geometry, sourceMaterial); secondPart.position.set(-80, 0, 0); source.add(secondPart);
  const hidden = new THREE.Group(); hidden.visible = false;
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(1e6, 1e6, 1e6), sourceMaterial)); source.add(hidden);
  const helper = new THREE.Mesh(new THREE.BoxGeometry(1e5, 1e5, 1e5), sourceMaterial); helper.userData.pickProxy = true; source.add(helper);
  source.updateMatrixWorld(true);
  const sourceTransform = source.matrixWorld.toArray().join(",");
  const childTransform = firstPart.matrix.toArray().join(",");
  const prepared = prepareDrawModel(THREE, source);
  check(prepared.meshes === 2 && prepared.triangles === 24, "model preview omits hidden descendants and picking helpers");
  const previewMeshes = []; prepared.object.traverse(object => { if (object.isMesh) previewMeshes.push(object); });
  check(previewMeshes.every(object => object.geometry === geometry), "model preview shares original geometry without a second parse");
  check(previewMeshes.every(object => object.material.isMeshBasicMaterial), "model preview uses one lightweight unlit material");
  const wrapper = new THREE.Group(); wrapper.scale.setScalar(prepared.presentationScale); wrapper.add(prepared.object);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrapper), size = box.getSize(new THREE.Vector3());
  check(Math.abs(Math.max(size.x, size.y, size.z) - .28) < 1e-6, "new model preview has a consistent 28 cm presentation extent");
  check(box.getCenter(new THREE.Vector3()).length() < 1e-6, "presentation wrapper centers all original assembly parts");
  check(source.matrixWorld.toArray().join(",") === sourceTransform && firstPart.matrix.toArray().join(",") === childTransform,
    "model presentation preserves source and child transforms");
  let geometryDisposals = 0, sourceMaterialDisposals = 0, previewMaterialDisposals = 0;
  geometry.addEventListener("dispose", () => geometryDisposals++);
  sourceMaterial.addEventListener("dispose", () => sourceMaterialDisposals++);
  previewMeshes[0].material.addEventListener("dispose", () => previewMaterialDisposals++);
  prepared.dispose();
  check(!geometryDisposals && !sourceMaterialDisposals && previewMaterialDisposals === 1,
    "removing model preview disposes only its owned material");
  const reject = (root, pattern) => { try { prepareDrawModel(THREE, root); return false; } catch (error) { return pattern.test(error.message); } };
  const denseGeo = new THREE.PlaneGeometry(1, 1, 100, 100);
  check(reject(new THREE.Mesh(denseGeo, sourceMaterial), /budget/), "dense mesh is declined before adding it to the XR scene");
  const many = new THREE.Group(); for (let i = 0; i < 13; i++) many.add(new THREE.Mesh(geometry, sourceMaterial));
  check(reject(many, /budget/), "too many mesh draw calls are declined");
  check(reject(new THREE.InstancedMesh(geometry, sourceMaterial, 2), /deferred/), "instanced mesh is deferred with a readable performance reason");
  geometry.dispose(); sourceMaterial.dispose(); denseGeo.dispose(); hidden.children[0].geometry.dispose(); helper.geometry.dispose();
  const { createXrAiDrawView } = await import("/xr/xr-ai-draw-view.js?runtime-test=1");
  const { createXrAiBoardStore } = await import("/xr/xr-ai-board-state.js?runtime-test=1");
  const testBoard = createXrAiBoardStore({ projectId: "runtime-test" });
  let budget = { triangles: 12, meshes: 1 }, budgetCalls = 0;
  const sharedGrid = new THREE.GridHelper(.8, 16); let gridDisposals = 0, gridMaterialDisposals = 0;
  sharedGrid.geometry.addEventListener("dispose", () => gridDisposals++);
  const budgetView = createXrAiDrawView({ THREE, scene, camera, gridGeometry: sharedGrid.geometry,
    getPreviewBudget: () => { budgetCalls++; return budget; } });
  const gridPreview = budgetView.root.getObjectByName("AI Draw reference grid");
  gridPreview.material.addEventListener("dispose", () => gridMaterialDisposals++);
  const budgetGeometry = new THREE.BoxGeometry(.2, .2, .2), budgetMaterial = new THREE.MeshBasicMaterial();
  const budgetModel = new THREE.Mesh(budgetGeometry, budgetMaterial); budgetModel.userData.meshId = "CAD-mesh-17";
  budgetModel.userData.faceIds = Array(12).fill("CAD-face-0");
  const addBudgetNode = (id, x) => command(testBoard, { type: "node.add", node: { id, kind: "model", source: { filename: "Housing.glb", revision: "sha-model-v1" },
    transform: { position: [x, 1.6, -.6], scale: [1.4, 1.4, 1.4] } } });
  addBudgetNode("budget-first", -.2); addBudgetNode("budget-second", .2); budgetView.sync(testBoard.getState());
  budgetView.attachModel("budget-first", prepareDrawModel(THREE, budgetModel));
  let rejectedByCombinedBudget = false;
  try { budgetView.attachModel("budget-second", prepareDrawModel(THREE, budgetModel)); }
  catch (error) { rejectedByCombinedBudget = /frame-rate budget/.test(error.message); }
  check(rejectedByCombinedBudget && !budgetView.objects.get("budget-second").model,
    "board model count respects the remaining budget after main CAD and other previews");
  budget = { triangles: 24, meshes: 2 }; budgetView.attachModel("budget-second", prepareDrawModel(THREE, budgetModel));
  budgetView.setVisible(true); budgetView.update(); scene.updateMatrixWorld(true);
  check(gridPreview.visible && gridPreview.geometry === sharedGrid.geometry && budgetView.root.visible,
    "visible AI Draw grid reuses the existing workspace grid geometry");
  budgetView.paint({title:"Grid compositing check"});
  const compositionScene = new THREE.Scene(), compositionCamera = new THREE.OrthographicCamera(-.24,.24,.24,-.24,.01,2);
  compositionCamera.position.z = 1;
  const compositionPanel = new THREE.Mesh(budgetView.panel.geo,budgetView.panel.material);
  compositionPanel.renderOrder = budgetView.panel.plane.renderOrder;
  compositionScene.add(compositionPanel);
  const compositionGrid = new THREE.LineSegments(gridPreview.geometry,gridPreview.material);
  compositionGrid.rotation.x = Math.PI/2; compositionGrid.position.z = -.05;
  compositionScene.add(compositionGrid);
  const compositionTarget = new THREE.WebGLRenderTarget(128,128), panelOnlyPixels = new Uint8Array(128*32*4), panelGridPixels = new Uint8Array(128*32*4);
  const previousTarget = renderer.getRenderTarget(), compositionPresenting = manager.isPresenting;
  try {
    manager.isPresenting = false; renderer.setRenderTarget(compositionTarget);
    compositionGrid.visible = false; renderer.render(compositionScene,compositionCamera);
    renderer.readRenderTargetPixels(compositionTarget,0,1,128,32,panelOnlyPixels);
    compositionGrid.visible = true; renderer.render(compositionScene,compositionCamera);
    renderer.readRenderTargetPixels(compositionTarget,0,1,128,32,panelGridPixels);
  } finally { renderer.setRenderTarget(previousTarget); manager.isPresenting = compositionPresenting; compositionTarget.dispose(); }
  check(sameRefs(panelOnlyPixels,panelGridPixels), "actual WebGL control-panel background remains opaque and readable in front of the transparent grid");
  moveHand(1, new THREE.Vector3(-.2, 1.6, -.2), new THREE.Vector3(0, 0, -1));
  const surface = budgetView.pick(controllers[1], { surface: true });
  check(surface?.anchor?.faceId === "CAD-face-0" && surface.anchor.meshId === "CAD-mesh-17" && surface.anchor.meshPath === "root",
    "surface picking preserves CAD face ID and stable source mesh identity/path");
  check(surface?.anchor?.sourceRevision === "sha-model-v1" && Number.isInteger(surface.anchor.triangleIndex),
    "surface selection records exact source revision and triangle fallback");
  const raycasts = [];
  budgetView.objects.get("budget-first").model.traverse(object => { if (object.isMesh) { raycasts.push([object,object.raycast]); object.raycast = () => { throw new Error("Idle bounds pick triangle-tested geometry"); }; } });
  try { check(budgetView.pickBounds(controllers[1])?.boardId === "budget-first", "hover laser targets board models using bounds without triangle intersections"); }
  finally { for (const [object,raycast] of raycasts) object.raycast = raycast; }
  const callsBeforeIdle = budgetCalls;
  const componentIdleCost = idleAssertions({ board: testBoard, view: budgetView, update: () => budgetView.update() }, "model board");
  check(budgetCalls === callsBeforeIdle, "idle rendering never recomputes the external CAD budget");
  const usage = budgetView.getModelUsage(); budgetView.update();
  check(budgetView.getModelUsage() === usage && usage.triangles === 24 && usage.meshes === 2, "main XR frame loop reads a cached combined board geometry count");
  budgetView.setVisible(false); budget = { triangles: 12, meshes: 1 }; budgetView.setVisible(true);
  check(budgetView.getModelUsage().triangles === 12 && budgetView.getModelUsage().meshes === 1,
    "reopening defers previews when main CAD consumed more of the shared budget while closed");
  const stressPoints = Array.from({ length:64 }, (_, i) => [.08*Math.cos(i*Math.PI/31.5), .08*Math.sin(i*Math.PI/31.5), .1]);
  for (let i=0;i<12;i++) {
    const anchor = { nodeId:"budget-first",sourceRevision:"sha-model-v1",localPoints:stressPoints,localNormal:[0,0,1] };
    command(testBoard,{type:"region.add",region:{id:`stress-region-${i}`,kind:"lasso",anchor}});
    command(testBoard,{type:"drawing.add",drawing:{id:`stress-drawing-${i}`,tool:"pen",anchor}});
  }
  budgetView.sync(testBoard.getState()); budgetView.update();
  const stressState = testBoard.getState(), stressBuffer = budgetView.lineGeo.attributes.position.array;
  let dragStep = 0;
  const activeDragCost = measure(() => {
    budgetView.setTransform("budget-first",{position:[-.2 + (++dragStep%100)*.001,1.6,-.6],quaternion:[0,0,0,1],scale:[1.4,1.4,1.4]});
    budgetView.update();
  },100);
  check(budgetView.lineGeo.attributes.position.array === stressBuffer && testBoard.getState() === stressState,
    "active dragging 12 lassos and 12 drawings of 64 points reuses the line buffer without persistent state writes");
  check(!budgetView.isLineBudgetExceeded() && budgetView.lineGeo.drawRange.count > 2500,
    "bounded active-drag stress keeps all 24 annotations within the visible ink budget");
  budgetView.dispose(); budgetGeometry.dispose(); budgetMaterial.dispose();
  check(!scene.children.includes(budgetView.root), "disposing the board removes its scene subtree");
  check(gridDisposals === 0 && gridMaterialDisposals === 1, "disposing AI Draw releases its grid material without disposing shared workspace geometry");
  sharedGrid.geometry.dispose(); sharedGrid.material.dispose();
  const until = async (condition, label) => {
    const deadline = performance.now() + 3000;
    while (!condition() && performance.now() < deadline) await wait(20);
    check(condition(), label);
  };
  const imageCanvas = document.createElement("canvas"); imageCanvas.width = 720; imageCanvas.height = 360;
  const imageContext = imageCanvas.getContext("2d"); imageContext.fillStyle = "#3d8c9c"; imageContext.fillRect(0, 0, 720, 360);
  const { createXrNotePages } = await import("/xr/xr-note-pages.js?runtime-test=1");
  imageContext.font = "26px sans-serif";
  const longNote = `${"Wide WWW annotations need room. ".repeat(120)}\n${"long_reference_identifier_".repeat(90)}\nFinal assembly requirement.`;
  let measured = 0;
  const pager = createXrNotePages({ text: longNote, measure: value => { measured++; return imageContext.measureText(value).width; } });
  let notePage = pager.page(), noteLines = [...notePage.lines], notePages = 1;
  check(measured < 150, "long note pagination measures only its first visible page");
  while ((!notePage.total || notePage.index < notePage.total - 1) && notePages < 100) {
    notePage = pager.page(notePage.index + 1); noteLines.push(...notePage.lines); notePages++;
  }
  check(noteLines.join("").replace(/\s/g, "") === longNote.replace(/\s/g, ""), "all long-note characters remain accessible across wrapped pages");
  check(noteLines.every(line => imageContext.measureText(line).width <= 720), "long unbroken identifiers fit the spatial note panel");
  check(pager.page(notePage.index + 1).index === 0, "tapping beyond the final note page returns to its first page");
  imageContext.fillStyle = "#c64444"; imageContext.fillRect(0, 0, 720, 180);
  imageContext.fillStyle = "#275bcf"; imageContext.fillRect(0, 180, 720, 180);
  imageContext.fillStyle = "#d9bd72"; imageContext.fillRect(200, 80, 240, 190);
  const imageBlob = await new Promise(resolve => imageCanvas.toBlob(resolve, "image/png"));
  const largeHeader = new Uint8Array(await imageBlob.arrayBuffer()); new DataView(largeHeader.buffer).setUint32(16, 65536);
  const oldFetch = window.fetch, oldBitmap = window.createImageBitmap;
  let imageFetches = 0, decodes = 0, aborted = 0, slowAttempts = 0;
  const imageErrors = [];
  window.createImageBitmap = (...args) => { decodes++; return oldBitmap(...args); };
  window.fetch = (url, options = {}) => {
    const target = String(url);
    if (!target.includes("/__xr-image-fixture/")) return oldFetch(url, options);
    imageFetches++;
    if (target.includes("slow") && !slowAttempts++) return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { aborted++; reject(new DOMException("Aborted", "AbortError")); }, { once: true }));
    return Promise.resolve(new Response(target.includes("oversized") ? largeHeader : imageBlob, { status: 200, headers: { "Content-Type": "image/png" } }));
  };
  const imageBoard = createXrAiBoardStore(), imageView = createXrAiDrawView({ THREE, scene, camera, onStatus: value => imageErrors.push(value) });
  const imageNode = (id, file) => command(imageBoard, { type: "node.add", node: { id, kind: "image", source: { filename: file, url: `/__xr-image-fixture/${file}` } } });
  try {
    imageNode("still", "still.png"); imageView.sync(imageBoard.getState()); await wait(30);
    check(imageFetches === 0, "hidden board hydration starts no image fetch or decode");
    imageView.setVisible(true);
    await until(() => !!imageView.objects.get("still")?.bitmap, "still project image decodes when the board becomes visible");
    const loaded = imageView.objects.get("still");
    check(loaded.bitmap.width === 512 && loaded.bitmap.height === 256, "image preview bounds decoded texture dimensions and preserves 2:1 aspect");
    check(Math.abs((.24 * loaded.card.scale.x) / (.18 * loaded.card.scale.y) - 2) < 1e-6, "spatial image card preserves the original image aspect");
    const orientationScene = new THREE.Scene(), orientationCamera = new THREE.OrthographicCamera(-.12,.12,.09,-.09,.01,2);
    orientationCamera.position.z = 1;
    orientationScene.add(new THREE.Mesh(loaded.card.geometry,loaded.card.material));
    const orientationTarget = new THREE.WebGLRenderTarget(32,32), orientationPixels = new Uint8Array(32*32*4);
    const originalTarget = renderer.getRenderTarget(), wasPresenting = manager.isPresenting;
    try {
      manager.isPresenting = false; renderer.setRenderTarget(orientationTarget); renderer.render(orientationScene,orientationCamera);
      renderer.readRenderTargetPixels(orientationTarget,0,0,32,32,orientationPixels);
    } finally { renderer.setRenderTarget(originalTarget); manager.isPresenting = wasPresenting; orientationTarget.dispose(); }
    const pixel = (x,y) => Array.from(orientationPixels.slice((y*32+x)*4,(y*32+x)*4+3));
    const topPixel = pixel(4,26), bottomPixel = pixel(4,5);
    check(topPixel[0] > topPixel[2] && bottomPixel[2] > bottomPixel[0],
      `project image stays upright after bitmap decode and GPU upload (top ${topPixel}, bottom ${bottomPixel})`);
    imageView.paint({buttons:[{id:"mention:still",label:"Still image"}]});
    const thumbnailButton = imageView.panel.hits[0], thumbnailContext = imageView.panel.canvas.getContext("2d");
    const thumbnailTop = thumbnailContext.getImageData(thumbnailButton.x+11,thumbnailButton.y+11,1,1).data;
    const thumbnailBottom = thumbnailContext.getImageData(thumbnailButton.x+11,thumbnailButton.y+26,1,1).data;
    check(thumbnailTop[0]>thumbnailTop[2] && thumbnailBottom[2]>thumbnailBottom[0],
      "the shared @ reference picker displays the same cached bitmap upright without a second decode");
    const priorDecodes = decodes;
    imageNode("oversized", "oversized.png"); imageView.sync(imageBoard.getState());
    await until(() => imageErrors.some(value => /too large to decode/.test(value)), "oversized image dimensions display a performance explanation");
    check(decodes === priorDecodes, "oversized image is rejected before createImageBitmap allocates pixels");
    imageNode("slow", "slow.png"); imageView.sync(imageBoard.getState()); imageView.setVisible(false);
    await until(() => aborted === 1, "closing the board aborts its pending image request");
    imageView.setVisible(true);
    await until(() => !!imageView.objects.get("slow")?.bitmap, "reopening safely resumes a previously cancelled image request");
    command(imageBoard, { type: "node.remove", id: "slow" }); imageView.sync(imageBoard.getState());
    check(!imageView.objects.has("slow"), "removing an image releases its scene preview");
  } finally { imageView.dispose(); window.fetch = oldFetch; window.createImageBitmap = oldBitmap; }
  if (window.__xrAiAssetsOnly) return { passed: true, checks: checks.length - startCheck, componentIdleCost, activeDragCost, kind: "real Three.js asset budgets and lifetime" };

  const { createXrAiDrawWorkspace } = await import("/xr/xr-ai-draw-workspace.js?runtime-test=1");
  check(typeof createXrAiDrawWorkspace === "function", "spatial Draw workspace module loads");
  camera.position.set(0, 1.6, 0); camera.lookAt(0, 1.6, -1); scene.updateMatrixWorld(true);
  const housingGeometry = new THREE.BoxGeometry(200, 100, 100), housingMaterial = new THREE.MeshStandardMaterial({ color: "#7ca8b5" });
  const housing = new THREE.Mesh(housingGeometry, housingMaterial); housing.name = "Housing CAD";
  housing.userData.meshId = "housing-body-1"; housing.userData.faceIds = Array(12).fill("housing-face-7");
  const project = "runtime-ai-draw";
  const rawAssets = [
    { filename: "housing.glb", label: "Housing", revision: "housing-r1", units: "mm", dimensions: [200, 100, 100] },
    { filename: "references/finish.png", label: "Finish reference", revision: "finish-r1", url: "/__xr-image-fixture/finish.png" },
    { filename: "references/requirements.webm", label: "Assembly memo", revision: "memo-r1", transcript: "Keep the bolts accessible for later disassembly." },
  ];
  const normalizedAssets = normalizeDrawAssets(rawAssets, project);
  let draft = "Preserve the existing mounting holes.", talks = 0, isBlocked = false, saved = null, revision = "missing";
  let puts = 0; const generated = [], organized = [], statuses = [];
  const existingAttachments = [{ id: "original-photo", name: "Existing attachment" }];
  const projectApi = async (_url, options = {}) => {
    if (options.method === "PUT") {
      const body = JSON.parse(options.body);
      if (body.expected_revision !== revision) throw Object.assign(new Error("409 changed in another session"), { status: 409 });
      saved = JSON.parse(JSON.stringify(body.state)); revision = `revision-${++puts}`;
      return { state: saved, storage_revision: revision };
    }
    if (!saved) throw Object.assign(new Error("404 canvas board not found"), { status: 404 });
    return { state: JSON.parse(JSON.stringify(saved)), storage_revision: revision };
  };
  const options = { THREE, scene, camera, getProjectId: () => project, getAssets: () => rawAssets,
    getModel: filename => filename === "housing.glb" ? housing : null, getBudget: () => ({ triangles: 8000, meshes: 12 }),
    getPromptDraft: () => draft, onSetPromptDraft: value => { draft = value; },
    onOrganize: value => { organized.push(value); draft = value.prompt; existingAttachments.push(...value.attachments); },
    onGenerate: value => { generated.push(value); return { ok: true }; }, onTalk: () => { talks++; },
    onStatus: value => statuses.push(value), api: projectApi, blocked: () => isBlocked };
  const previousFetch = window.fetch;
  window.fetch = (url, options) => String(url).includes("/__xr-image-fixture/")
    ? Promise.resolve(new Response(imageBlob, { headers: { "Content-Type": "image/png" } })) : previousFetch(url, options);
  const workspace = createXrAiDrawWorkspace(options);
  const state = () => workspace.board.getState();
  const typeText = async text => { for (const char of text) await workspace.action(`kb:${char === " " ? "space" : char === "\n" ? "enter" : char}`); };
  const pose = (x, y, z = -.30) => { moveHand(1, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, -1)); scene.updateMatrixWorld(true); };
  let workspaceIdleCost;
  try {
    check(await workspace.open(), "AI Draw opens the existing project board");
    await workspace.action("insert", normalizedAssets.find(asset => asset.kind === "model"));
    const model = Object.values(state().nodes).find(node => node.kind === "model");
    check(model && workspace.view.objects.get(model.id)?.model, "project model inserts into the spatial scene");
    check(model.source.units === "mm" && model.source.dimensions.join(",") === "200,100,100", "project model retains original CAD units and dimensions");
    check(new THREE.Vector3().fromArray(model.transform.position).distanceTo(camera.position) < .75, "inserted model starts within grabbing reach");
    check(workspace.sample(1, controllers[1], true) === false, "asset insertion returns to Move");
    command(workspace.board, { type: "node.transform", id: model.id, transform: { position: [0, 1.5, -.60], quaternion: [0, 0, 0, 1] } });
    workspace.update(); scene.updateMatrixWorld(true);
    await workspace.action("talk"); await workspace.action("tool", "lasso");
    for (const [x, y] of [[-.04,1.48],[.04,1.48],[.04,1.52],[-.04,1.52],[-.04,1.48]]) {
      pose(x, y); workspace.sample(1, controllers[1], true); await wait(40);
    }
    workspace.sample(1, controllers[1], false); workspace.update();
    const region = Object.values(state().regions).find(row => row.kind === "lasso");
    check(talks === 1 && region?.anchor?.nodeId === model.id && region.anchor.localPoints.length >= 4,
      "drawing while live voice is enabled creates a model-anchored dotted lasso");
    check(region.anchor.faceId === "housing-face-7" && region.anchor.sourceRevision === "housing-r1", "lasso retains the CAD face and model revision");
    check(workspace.getVoiceContext().selectedRegionId === region.id, "the completed lasso immediately enters live voice structured context");
    const split = await workspace.voiceCommand({ action: "annotate_split", text: "Split here to fit my Bambu printer and assemble afterward.",
      printerModel: "Bambu", intendedSplit: "Split this selected region into printable pieces", assembly: "Reassemble after printing" });
    check(split.ok && split.clarificationId && split.missingDetails.includes("printerModel") && split.missingDetails.includes("jointStyle"),
      "split annotation asks for the missing Bambu model and joint style");
    await workspace.action("select", model.id); pose(.12, 1.55);
    const answer = await workspace.voiceCommand({ action: "answer_clarification", clarificationId: split.clarificationId,
      printerModel: "Bambu P1S", jointStyle: "Alignment pins and bolts", text: "Use alignment pins and bolts." });
    check(answer.regionId === region.id && state().notes[split.noteId].regionId === region.id,
      "voice follow-up stays attached to the original lasso after selection and gaze move");
    check(!/256|build.?plate.*\d/i.test(state().notes[split.noteId].text), "annotation does not invent a printer build volume");
    await workspace.action(`note:${split.noteId}`); await typeText("\nkeep bolts accessible");
    await workspace.action("select", model.id); await workspace.action("edit.save");
    check(state().notes[split.noteId].text.includes("keep bolts accessible"), "spatial note edits save to the original stable note ID");
    await workspace.action("insert", normalizedAssets.find(asset => asset.kind === "image"));
    await workspace.action("insert", normalizedAssets.find(asset => asset.kind === "memo"));
    const photo = Object.values(state().nodes).find(node => node.kind === "image"), memo = Object.values(state().nodes).find(node => node.kind === "memo");
    command(workspace.board, { type: "node.transform", id: photo.id, transform: { position: [.34,1.5,-.6], quaternion: [0,0,0,1] } });
    command(workspace.board, { type: "node.transform", id: memo.id, transform: { position: [.65,1.5,-.6], quaternion: [0,0,0,1] } });
    workspace.update(); scene.updateMatrixWorld(true);
    await workspace.action("tool", "link"); pose(.10,1.5); check(workspace.select(controllers[1]), "link mode selects the model endpoint with a controller ray");
    pose(.34,1.5); check(workspace.select(controllers[1]), "link mode selects the image endpoint with a controller ray");
    await typeText("use this finish"); await workspace.action("edit.save");
    check(Object.values(state().links).some(link => link.toId === photo.id && link.caption === "use this finish"), "dotted link receives its editable relationship caption");
    const memoLink = await workspace.voiceCommand({ action: "add_link", fromId: photo.id, toId: memo.id, caption: "Assembly requirements" });
    check(memoLink.ok, "voice creates a further branch of the same connected graph");
    await workspace.action("select", photo.id); await workspace.action("final");
    check(state().nodes[photo.id].finalLook, "the image can be marked Final look");
    await workspace.action("prompt"); await workspace.action("mentions"); await workspace.action(`mention:${photo.id}`); await workspace.action("edit.save");
    check(draft.includes(`@{${photo.id}}`), "the shared reference picker inserts a stable-ID prompt mention");
    await workspace.voiceCommand({ action: "rename_node", nodeId: photo.id, name: "Brushed chrome finish" });
    check(workspace.getVoiceContext().nodes.some(node => node.id === photo.id && node.name === "Brushed chrome finish"), "renaming updates live voice labels without changing links or references");
    await workspace.action("select", region.id);
    const beforeOrganize = draft; await workspace.action("organize");
    check(organized.length === 1 && draft.startsWith(beforeOrganize) && draft.includes("Assembly requirements") && draft.includes("Keep the bolts accessible") && draft.includes("Final look"),
      "Smart Description follows link chains and appends notes, memo, captions and final-look references to the original draft");
    check(existingAttachments[0].id === "original-photo" && generated.length === 0, "organization preserves existing attachments and never generates");
    await workspace.action("review"); await typeText("\nreviewed for fit"); await workspace.action("edit.save");
    await workspace.action("generate");
    check(generated.length === 1 && generated[0].prompt === draft && Object.isFrozen(generated[0]) && Object.isFrozen(generated[0].graph),
      "only explicit Generate submits the reviewed prompt with an immutable spatial snapshot");
    const frozenText = generated[0].graph.notes.find(note => note.id === split.noteId).text;
    await workspace.voiceCommand({ action: "update_note", noteId: split.noteId, text: "Later edit after generation" });
    check(generated[0].graph.notes.find(note => note.id === split.noteId).text === frozenText, "later board edits cannot mutate a submitted generation snapshot");
    await workspace.action("undo"); check(state().notes[split.noteId].text === frozenText, "board Undo restores the prior spatial note");
    await workspace.action("redo"); check(state().notes[split.noteId].text === "Later edit after generation", "board Redo reapplies the note edit");
    const anchorStart = workspace.view.worldPoint(region, region.anchor.localPoints[0]);
    const modelState = state().nodes[model.id];
    command(workspace.board, { type: "node.transform", id: model.id, transform: { position: [.1,1.6,-.6], quaternion: [0,Math.sin(.2),0,Math.cos(.2)], scale: modelState.transform.scale.map(value => value * 1.2) } });
    workspace.update();
    const anchorEnd = workspace.view.worldPoint(state().regions[region.id], region.anchor.localPoints[0]);
    check(anchorStart.distanceTo(anchorEnd) > .05 && state().regions[region.id].anchor.sourceRevision === "housing-r1", "anchored lasso follows model movement, rotation and scale");
    const completed = Object.keys(state().regions).length;
    await workspace.action("tool", "lasso"); pose(.1,1.6); workspace.sample(1,controllers[1],true); workspace.cancel(); workspace.sample(1,controllers[1],false);
    check(Object.keys(state().regions).length === completed, "Cancel discards unfinished lasso samples and preserves completed regions");
    isBlocked = true; const blockedState = state();
    await workspace.action("tool", "pen"); workspace.sample(1,controllers[1],true); workspace.update();
    check(state() === blockedState, "teleop ownership prevents spatial Draw input mutations"); isBlocked = false;
    workspace.cancel(); workspace.update();
    workspaceIdleCost = idleAssertions(workspace, "completed planning board");
    check(await workspace.flush(), "completed board saves through the existing project Canvas API");
    const expectedSaved = persistedJson({ nodes: state().nodes, regions: state().regions, notes: state().notes, links: state().links, drawings: state().drawings });
    const restored = createXrAiDrawWorkspace(options); await restored.open();
    const restoredState = restored.board.getState();
    window.__xrAiRestoreDiff = { expected: JSON.parse(expectedSaved), actual: { nodes: restoredState.nodes, regions: restoredState.regions, notes: restoredState.notes, links: restoredState.links, drawings: restoredState.drawings } };
    check(persistedJson({ nodes: restoredState.nodes, regions: restoredState.regions, notes: restoredState.notes, links: restoredState.links, drawings: restoredState.drawings }) === expectedSaved,
      "reopening the project restores nodes, transforms, anchors, notes, captions, names and final-look choices");
    restored.dispose();
    workspace.close();
    viewport.__runtimeTest.setTool("draw_ai_prompt");
    const integrated = viewport.getAiDrawWorkspace();
    await until(() => integrated.isActive() && integrated.isReady(), "VR Studio Draw → AI Prompt opens the integrated workspace");
    await integrated.action("insert", normalizeDrawAssets([{ filename: "fixture.glb", revision: "fixture-r1", units: "m", dimensions: [.2,.2,.2] }], "runtime-test")[0]);
    const integratedModel = Object.values(integrated.board.getState().nodes).find(node => node.kind === "model");
    check(integratedModel && integrated.view.objects.get(integratedModel.id)?.model, "the integrated project picker prepares a bounded model preview");
    command(integrated.board, { type: "node.transform", id: integratedModel.id, transform: { position: [0,1.5,-.6], quaternion:[0,0,0,1] } });
    integrated.update(); scene.updateMatrixWorld(true);
    viewport.__runtimeTest.state().explorerPanel.group.visible = false;
    moveHand(0,new THREE.Vector3(-.4,1.1,-.2),new THREE.Vector3(0,0,-1)); viewport.update();
    const inkButton = integrated.view.panel.hits.find(item => item.id === "ink");
    const buttonPoint = integrated.view.panel.plane.localToWorld(new THREE.Vector3(((inkButton.x+inkButton.w/2)/1024-.5)*.48, (.5-(inkButton.y+inkButton.h/2)/1024)*.48, 0));
    const buttonNormal = new THREE.Vector3(0,0,1).applyQuaternion(integrated.view.panel.plane.getWorldQuaternion(new THREE.Quaternion()));
    moveHand(1,buttonPoint.clone().addScaledVector(buttonNormal,.25),buttonNormal.clone().negate()); viewport.update();
    const uiHit = viewport.__runtimeTest.selectPick(controllers[1]);
    check(uiHit?.kind === "ai-action" && uiHit.id === "board:ink", `the actual controller laser selects spatial Draw panel controls (${uiHit?.kind}/${uiHit?.id || uiHit?.tool || uiHit?.tab || ""})`);
    await wait(220); pressHand(1,0,true); pressHand(1,0,false); await wait(50);
    check(integrated.view.panel.hits.some(item => item.id === "tool:lasso"), "actual trigger dispatch opens the grouped drawing tools");
    await integrated.action("back");
    const selectionButton = integrated.view.panel.hits.find(item => item.id === "selection");
    const selectionPoint = integrated.view.panel.plane.localToWorld(new THREE.Vector3(((selectionButton.x+selectionButton.w/2)/1024-.5)*.48, (.5-(selectionButton.y+selectionButton.h/2)/1024)*.48, 0));
    moveHand(1,selectionPoint.clone().addScaledVector(buttonNormal,.015),buttonNormal.clone().negate()); viewport.update();
    check(viewport.__runtimeTest.selectPick(controllers[1])?.id === "board:selection", "the grouped Selection tools button is visible to the actual controller ray");
    await wait(220); pressHand(1,0,true); pressHand(1,0,false); await wait(50);
    check(integrated.view.panel.hits.some(item => item.id === "rename") && integrated.view.panel.hits.some(item => item.id === "larger"),
      "right-hand near trigger opens the selected reference rename and size controls");
    await integrated.action("back");
    moveHand(1,new THREE.Vector3(.45,1.1,-.2),new THREE.Vector3(0,0,-1));
    moveHand(0,buttonPoint.clone().addScaledVector(buttonNormal,.015),buttonNormal.clone().negate()); viewport.update();
    check(viewport.__runtimeTest.selectPick(controllers[0])?.id === "board:ink", "left-hand near input targets the same grouped Draw control");
    await wait(220); pressHand(0,0,true); pressHand(0,0,false); await wait(50);
    check(integrated.view.panel.hits.some(item => item.id === "tool:lasso"), "left-hand near trigger opens the drawing tools without a duplicate action");
    moveHand(0,new THREE.Vector3(-.4,1.1,-.2),new THREE.Vector3(0,0,-1)); viewport.update();
    await integrated.action("tool","lasso");
    for (const [x,y] of [[-.04,1.48],[.04,1.48],[.04,1.52],[-.04,1.52]]) {
      pose(x,y); pressHand(1,0,true); await wait(45);
    }
    pressHand(1,0,false); integrated.update();
    check(Object.keys(integrated.board.getState().regions).length === 1, "actual XR controller polling commits one completed spatial lasso");
    await integrated.action("tool","lasso"); pose(.02,1.5); pressHand(1,0,true);
    session.visibilityState = "hidden"; session.dispatchEvent(new Event("visibilitychange"));
    check(!integrated.view.root.visible, "headset removal hides the spatial board and cancels unfinished input");
    sources[1].gamepad.buttons[0] = { pressed:false,touched:false,value:0 };
    session.visibilityState = "visible"; session.dispatchEvent(new Event("visibilitychange")); viewport.update();
    check(integrated.view.root.visible && Object.keys(integrated.board.getState().regions).length === 1,
      "headset resume preserves completed work without committing the interrupted lasso");
    session.inputSources = [sources[1],sources[0]]; session.dispatchEvent(new Event("inputsourceschange")); viewport.update();
    await integrated.action("tool","pen");
    for (const x of [-.03,.02,.05]) { moveHand(0,new THREE.Vector3(x,1.5,-.3),new THREE.Vector3(0,0,-1)); pressHand(0,0,true); await wait(45); }
    pressHand(0,0,false);
    check(Object.keys(integrated.board.getState().drawings).length === 1, "left-hand drawing remains correctly bound after input source order changes");
    await integrated.action("tool","lasso"); pose(.02,1.5); pressHand(1,0,true);
    controllers[1].dispatchEvent({type:"disconnected"}); grips[1].dispatchEvent({type:"disconnected"});
    sources[1].gamepad.buttons[0] = { pressed:false,touched:false,value:0 };
    controllers[1].dispatchEvent({type:"connected",data:sources[1]}); grips[1].dispatchEvent({type:"connected",data:sources[1]});
    session.inputSources = sources; session.dispatchEvent(new Event("inputsourceschange")); viewport.update();
    check(Object.keys(integrated.board.getState().regions).length === 1, "controller disconnect and reconnect preserves work while cancelling its unfinished lasso");
    check(!(window.__xrIntegratedGenerations||[]).length, "integrated scene interactions never invoke generation implicitly");
    await integrated.action("organize"); await integrated.action("generate");
    check(window.__xrIntegratedGenerations.length === 1 && Object.isFrozen(window.__xrIntegratedGenerations[0]), "integrated explicit Generate reaches the supplied generation pipeline once");
    integrated.close(); await workspace.open();
    const overflowPoints = Array.from({length:128},(_,i)=>[i%2?-1:1,1.4+i*.001,-.6]);
    for (let i=0;i<2;i++) command(workspace.board,{type:"region.add",region:{id:`overflow-${i}`,kind:"lasso",points:overflowPoints}});
    workspace.update(); const beforeOverflowGenerate = generated.length;
    await workspace.action("generate");
    check(workspace.view.isLineBudgetExceeded() && generated.length === beforeOverflowGenerate,
      "ink beyond the fixed preview buffer blocks generation so unseen instructions cannot silently submit");
    for (let i=0;i<2;i++) command(workspace.board,{type:"region.remove",id:`overflow-${i}`});
    workspace.update();
    check(!workspace.view.isLineBudgetExceeded(), "removing oversized ink restores the existing preview budget without replacing buffers");
    const noteMesh = workspace.view.root.children.find(object => object.material?.map?.image?.dataset?.xrAiDraw === "note");
    const noteCanvas = noteMesh.material.map.image;
    const oldFillText = CanvasRenderingContext2D.prototype.fillText; let noteHeader = "";
    CanvasRenderingContext2D.prototype.fillText = function (value,...args) { if (this.canvas === noteCanvas && String(value).startsWith("Notes ·")) noteHeader = String(value); return oldFillText.call(this,value,...args); };
    try {
      command(workspace.board,{type:"note.update",id:split.noteId,patch:{text:longNote,expanded:true}}); workspace.view.hover(split.noteId); workspace.update();
      check(noteHeader.includes("Notes · 1/"),"expanded spatial note renders the first wrapped page");
      workspace.view.notePage(); check(noteHeader.includes("Notes · 2/"),"the spatial note panel's next-page action advances its visible text");
    } finally { CanvasRenderingContext2D.prototype.fillText = oldFillText; }
    command(workspace.board,{type:"note.update",id:split.noteId,patch:{text:frozenText,expanded:true}}); workspace.view.hover(split.noteId);
    await until(() => !!workspace.view.objects.get(photo.id)?.bitmap, "restored project image finishes its asynchronous preview before display capture");
    await workspace.action("organize");
    workspace.view.setVisible(true); workspace.update();
    moveHand(0,new THREE.Vector3(-.45,.7,.1),new THREE.Vector3(0,0,-1)); moveHand(1,new THREE.Vector3(.45,.7,.1),new THREE.Vector3(0,0,-1));
    viewport.update();
    camera.position.set(.06,1.65,.40); camera.lookAt(.06,1.5,-.60); scene.updateMatrixWorld(true);
    manager.isPresenting = false; renderer.render(scene, camera); manager.isPresenting = true;
    window.__xrAiDrawScreenshot = true;
  } finally {
    window.fetch = previousFetch;
    // Leave the verified board visible for the runner's screenshot. Disposal
    // follows screenshot through page close and cannot affect source CAD.
    window.__xrAiWorkspace = workspace;
  }
  return { passed: true, checks: checks.length - startCheck, componentIdleCost, workspaceIdleCost, activeDragCost, generated: generated.length,
    saves: puts, limitations: "Synthetic controller poses and mocked voice/generation/project persistence; not a Quest GPU or microphone timing measurement." };
}
