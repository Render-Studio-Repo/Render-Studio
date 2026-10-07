  const test=api.__runtimeTest;
  for(const id of [...test.tabs().state().tabs,...test.tabs().state().detached])test.tabs().close(id);
  api.update();
  const status=scene.getObjectByName('xrStatusDock'),anchor=scene.getObjectByName('xrStatusAnchor');
  const popup=scene.getObjectByName('xrCaptureOptions');
  const visible=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
  const statusButtons=test.state().dockButtons.filter(o=>o.userData.xrStatus);
  const find=id=>statusButtons.find(o=>o.userData.xrTool===id && visible(o));
  check(anchor.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition(grips[0]))<1e-6,'capture/history anchor follows actual left grip');
  check(!popup.visible,'capture folder starts collapsed');
  check(!!find('capture')&&!!find('undo')&&!!find('redo'),'small Capture, Undo and Redo are available on left wrist');
  check(!find('record')&&!find('share')&&!find('passthrough'),'record, share and passthrough live inside folder');
  check(!scene.getObjectByName('xrCaptureDock').visible,'duplicate legacy recording strip stays hidden');
  const aimAt=o=>{
    o.updateWorldMatrix(true,false);
    const normal=new THREE.Vector3(0,0,1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
    moveRight(worldPosition(o).addScaledVector(normal,.35),normal.negate());api.update();
    return test.selectPick(controllers[1]);
  };
  for(const id of ['undo','redo']){
    const hit=aimAt(find(id));check(hit?.tool===id,`left wrist ${id} is clickable`);
    button(0,true);api.update();button(0,false);api.update();
  }
  check(window.undoCalls===1&&window.redoCalls===1,'wrist history buttons dispatch existing undo/redo actions');
  let hit=aimAt(find('capture'));
  check(hit?.tool==='capture','right trigger ray targets left Capture folder');
  button(0,true);api.update();button(0,false);api.update();
  check(popup.visible,'click expands controller popup');
  check(!!find('record')&&!!find('screenshot')&&!!find('share')&&!!find('passthrough'),'expanded folder exposes capture/share/passthrough actions');
  const local=popup.getWorldPosition(new THREE.Vector3()).sub(worldPosition(grips[0]));
  grips[0].position.x-=.12;controllers[0].position.x-=.12;scene.updateMatrixWorld(true);api.update();
  check(anchor.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition(grips[0]))<1e-6,'left wrist capture follows translated controller without freezing');
  api.setCaptureState({recording:true,elapsedMs:4000});api.update();
  check(!!find('record_pause')&&!!find('record_stop'),'recording shows Pause and Stop in same popup');
  test.setTool('capture');api.update();
  check(!popup.visible&&!find('record_stop'),'folder can collapse during recording without floating buttons');
  test.setTool('capture');api.update();
  check(!!find('record_stop'),'recording controls remain accessible when reopened');
  api.setCaptureState({recording:false,clipReady:true});api.update();
  check(!!find('shot_send_pc')&&!!find('shot_share_x'),'finished clip actions stay inside folder');
  test.setTool('capture');api.update();
  test.setTool('draw');api.update();
  const draw=test.state().toolHand.group,drawAnchor=scene.getObjectByName('xrToolHandAnchor');
  check(draw.visible,'selecting Draw opens tool options immediately');
  check(drawAnchor.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition(grips[1]))<1e-6,'Draw options follow actual right grip');
  check(draw.parent===drawAnchor&&drawAnchor.parent===scene,'Draw popup cannot inherit hidden controller-model visibility');
  check(test.state().toolHand.buttons.some(o=>o.userData.xrTool==='draw_brush_pen'&&visible(o)),'Draw brush options are visible');
  draw.visible=false;api.update();
  check(draw.visible,'active Draw popup restores visibility after external tracking/hide updates');
  moveRight(new THREE.Vector3(.2,1.2,-.4));api.update();
  check(drawAnchor.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition(grips[1]))<1e-6,'Draw popup tracks subsequent controller movement');
  const setYaw=yaw=>{moveRight(new THREE.Vector3(.2,1.35,-.55),new THREE.Vector3(Math.sin(yaw),0,-Math.cos(yaw)));api.update();};
  setYaw(0);for(let i=0;i<14;i++){await wait(20);api.update();}
  const undoBefore=window.undoCalls;await wait(40);setYaw(-.14);await wait(40);setYaw(-.4);
  check(window.undoCalls===undoBefore+1,'right controller left flick dispatches Undo in the viewport');
  const redoBefore=window.redoCalls;await wait(40);setYaw(0);
  check(window.redoCalls===redoBefore,'return motion does not accidentally redo');
  for(let i=0;i<62;i++){await wait(20);api.update();}
  await wait(40);setYaw(.14);await wait(40);setYaw(.4);
  check(window.redoCalls===redoBefore+1,'right controller right flick dispatches Redo in the viewport');
  const texture=new THREE.Texture(),normalMap=new THREE.Texture();
  const {restoreControllerMaterial}=await import('/xr/xr-controller-material.js');
  const model=new THREE.Mesh(new THREE.BoxGeometry(.05,.1,.03),new THREE.MeshStandardMaterial({color:0xffffff,map:texture,normalMap}));
  model.material.depthTest=false;model.material.emissive.setHex(0xffffff);
  restoreControllerMaterial(model);
  check(model.material.isMeshStandardMaterial&&model.material.map===texture&&model.material.normalMap===normalMap,'controller keeps physical material, texture and normal detail');
  check(model.material.depthTest&&model.material.depthWrite&&!model.material.transparent,'controller body keeps correct surface occlusion');
  check(model.material.color.r<.8&&model.material.emissive.getHex()===0,'controller is not overbright emissive white');
  const once=model.material;restoreControllerMaterial(model);check(model.material===once,'controller material is prepared once, not rebuilt per frame');
  // A stale grip scene node is corrected from its own gripSpace, never targetRaySpace.
  const oldGetPose=frame.getPose;
  const pose=new THREE.Vector3(.32,1.12,-.37),quat=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.2);
  frame.getPose=space=>space===sources[1].gripSpace?{transform:{position:pose,orientation:quat}}:oldGetPose(space);
  test.syncGripPosesFromXrFrame();
  check(grips[1].position.distanceTo(pose)<1e-6&&grips[1].quaternion.angleTo(quat)<1e-6,'recorded controller model uses current grip pose independent of target ray');
  frame.getPose=oldGetPose;
  const mono=new THREE.PerspectiveCamera(),eyeL=new THREE.PerspectiveCamera(),eyeR=new THREE.PerspectiveCamera();
  eyeL.position.set(-.032,1.6,0);eyeR.position.set(.032,1.6,0);eyeL.updateMatrixWorld();eyeR.updateMatrixWorld();
  const getCamera=manager.getCamera;manager.getCamera=()=>({cameras:[eyeL,eyeR]});test.copyXrViewToSpectator(mono,16/9);manager.getCamera=getCamera;
  check(Math.abs(mono.position.x)<1e-6,'recording viewpoint uses eye midpoint instead of left-eye offset');
  check(Math.abs(mono.projectionMatrix.elements[5]/mono.projectionMatrix.elements[0]-16/9)<1e-6,'recording projection matches video aspect without stretching controller positions');
  // Trigger movement must not inherit wrist rotation. Grip explicitly rotates.
  api.openMenuConsole({tab:'projects',force:true,forcePlace:true});api.update();
  const menu=test.tabs().windowFor(test.state().explorerPanel.group);
  moveRight(new THREE.Vector3(.2,1.3,-.45),new THREE.Vector3(0,0,-1));
  const oldQuat=menu.quaternion.clone();
  test.beginPanelDrag(controllers[1],menu,{translateOnly:true,workspaceHandle:true});
  moveRight(new THREE.Vector3(.3,1.4,-.45),new THREE.Vector3(0,-1,0));test.updatePanelDrag();
  moveRight(new THREE.Vector3(.4,1.5,-.45),new THREE.Vector3(0,-1,0));test.updatePanelDrag();
  check(menu.quaternion.angleTo(oldQuat)<1e-6,'trigger translates menu without turning it downward');
  test.endGrab(controllers[1]);
  test.beginPanelDrag(controllers[1],menu,{input:'grip',translateOnly:false,workspaceHandle:true});
  moveRight(new THREE.Vector3(.4,1.5,-.45),new THREE.Vector3(1,0,0));test.updatePanelDrag();
  check(menu.quaternion.angleTo(oldQuat)>.1,'grip still rotates menu');test.endGrab(controllers[1]);
  // Stale tracked wrist nodes must never displace an active physical controller HUD.
  const staleWrist=new THREE.Object3D();staleWrist.position.set(4,4,4);hands[1].add(staleWrist);hands[1].joints.wrist=staleWrist;
  test.setTool('create_box');api.update();
  check(drawAnchor.getWorldPosition(new THREE.Vector3()).distanceTo(worldPosition(grips[1]))<1e-6,'stale hand wrist is ignored with a connected controller');
  const {createStudioCommandRouter}=await import('/components/voice-studio-controls.js');
  const route=createStudioCommandRouter({getScope:()=>({user:'test',project:'runtime-test',session:api.getVoiceControlSession()}),getControls:api.getVoiceControls,getActions:api.getVoiceActions});
  const list=await route('get_studio_controls');
  check(list.ok&&list.settings.length>=19,'Astra discovers controls inside actual XR viewport');
  const originalHand=list.settings.find(x=>x.id==='menu_hand').value;
  check((await route('set_studio_setting',{id:'menu_hand',value:'right'})).ok,'Astra changes handedness through existing setter');
  await route('set_studio_setting',{id:'menu_hand',value:originalHand});
  check((await route('set_studio_setting',{id:'draw_size',value:'draw_size_l'})).ok,'Astra changes draw size');
  check(!(await route('set_studio_setting',{id:'draw_size',value:'huge'})).ok,'invalid setting is rejected');
  await route('set_studio_setting',{id:'browser_window',value:true});
  check((await route('set_studio_setting',{id:'browser_window',value:false})).ok,'Astra can close a window without leaving a visible panel');
  const reset=await route('run_studio_action',{id:'reset_scene'});
  check(reset.ok&&api.getVoiceControlSession()===session,'Astra resets scene without ending headset session');
  api.openMenuConsole({tab:'files',force:true});test.setTool('menu');await wait(350);api.update();
  check(test.state().menuTab==='projects','opening Projects menu selects project list, not previous workspace tab');
  for(const id of [...test.tabs().state().tabs,...test.tabs().state().detached])test.tabs().close(id);
  await api.getAiDrawWorkspace().open();api.update();
  for(const tool of ['move','pen','line','arrow','lasso','label','link','eraser','face','edge']){
    await api.getAiDrawWorkspace().action('tool:'+tool);api.update();
    check(draw.visible&&test.state().toolHand.buttons.some(b=>b.userData.xrTool==='board:tool:'+tool&&visible(b)),`AI Draw ${tool} has visible right-wrist controls`);
  }
  api.getAiDrawWorkspace().close();test.setTool('draw');api.update();
  // Compose a readable inspection frame of both wrist panels and real Quest assets.
  grips[0].position.set(-.19,1.48,-.6);controllers[0].position.copy(grips[0].position);
  moveRight(new THREE.Vector3(.16,1.46,-.6),new THREE.Vector3(0,0,-1));scene.updateMatrixWorld(true);api.update();
  api.setCaptureState({recording:false,clipReady:false});test.setTool('capture');api.update();
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const controllerModels=[];
  for(const [i,name] of ['left','right'].entries()){
    const gltf=await new GLTFLoader().loadAsync(`/assets/controllers/quest-touch-plus/${name}.glb`);
    grips[i].clear();grips[i].userData.xrControllerOverlayReady=false;grips[i].userData._xrOverlayStyledAt=0;grips[i].add(gltf.scene);controllerModels.push(gltf.scene);
  }
  api.update();
  for(const grip of controllerModels)grip.traverse(o=>{if(o.isMesh&&!o.userData.xrFallback)check(o.userData.xrControllerSurfaceReady && o.material.depthTest && o.material.emissive?.getHex()===0,`live controller surface ${o.name}: ${JSON.stringify({ready:o.userData.xrControllerSurfaceReady,depth:o.material.depthTest,emit:o.material.emissive?.getHex(),type:o.material.type,parent:o.parent?.name})}`);});
  const plateCanvas=scene.getObjectByName('xrWristBand').material.map.image;
  const platePixel=plateCanvas.getContext('2d').getImageData(Math.floor(plateCanvas.width*.15),Math.floor(plateCanvas.height*.8),1,1).data;
  check(platePixel[3]>200&&platePixel[0]<80,'wrist background fills lower-left quadrant instead of a transparent white triangle');
  window.__platePreview=plateCanvas.toDataURL();
  manager.isPresenting=false;renderer.render(scene,camera);manager.isPresenting=true;
  return {checks,count:checks.length,threeRevision:THREE.REVISION};
}
