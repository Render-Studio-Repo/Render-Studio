  const test=api.__runtimeTest;
  for(const id of [...test.tabs().state().tabs,...test.tabs().state().detached])test.tabs().close(id);
  test.setTool('grab');api.update();
  const map=await import('/xr/xr-control-map.js?input-runtime-settings=1');
  const setButton=(hand,index,pressed)=>{sources[hand].gamepad.buttons[index]={pressed,touched:pressed,value:pressed?1:0};};
  const aim=(hand)=>{
    const p=new THREE.Vector3(hand? .23:-.23,1.25,-.35);
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(.20,hand?.12:-.10,hand?-.22:.12));
    controllers[hand].position.copy(p);controllers[hand].quaternion.copy(q);
    grips[hand].position.copy(p).add(new THREE.Vector3(0,-.024,.012));
    grips[hand].quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.75));
    assembly.position.copy(p).add(new THREE.Vector3(0,0,-.55).applyQuaternion(q));
    assembly.quaternion.identity();assembly.scale.setScalar(1);
    scene.updateMatrixWorld(true);api.update();
  };
  // Recorded Quest aim/grip orientations differ by ~40 degrees. Only the laser
  // aims at CAD; acquisition must not cast along the controller handle instead.
  for(const hand of [0,1]){
    aim(hand);setButton(hand,1,true);api.update();
    check(test.state().gripGrab?.hand===hand,`${hand?'right':'left'} squeeze alone acquires laser-targeted model with Quest grip rotation`);
    const start=assembly.position.clone();
    grips[hand].position.x+=.12;controllers[hand].position.x+=.12;
    scene.updateMatrixWorld(true);api.update();
    check(assembly.position.distanceTo(start)>.10,'one-hand model follows grip without trigger');
    setButton(hand,1,false);api.update();check(!test.state().gripGrab,'poll-only grip release drops model');
  }
  map.remapXrControlAction('squeeze',3);
  aim(1);setButton(1,3,true);api.update();
  check(test.state().gripGrab?.hand===1,'new mapping from separate settings module acquires in active VR session');
  const before=assembly.position.clone();grips[1].position.x+=.1;controllers[1].position.x+=.1;scene.updateMatrixWorld(true);api.update();
  check(assembly.position.distanceTo(before)>.08,'remapped grab survives subsequent update frames');
  setButton(1,3,false);api.update();check(!test.state().gripGrab,'remapped release drops');
  setButton(1,1,true);api.update();check(!test.state().gripGrab,'old physical binding no longer acquires');
  setButton(1,1,false);map.resetXrControlMap();api.update();
  session.inputSources=[sources[1],sources[0]];
  aim(0);setButton(0,1,true);api.update();
  check(test.state().gripGrab?.hand===0,'reordered Quest inputSources preserve left-hand grip');
  setButton(0,1,false);api.update();
  moveRight(new THREE.Vector3(2,2,2),new THREE.Vector3(1,0,0));setButton(1,1,true);api.update();
  check(!test.state().gripGrab&&!test.state().panelDrag,'empty-space squeeze acquires nothing');
  setButton(1,1,false);api.update();
  api.openMenuConsole({tab:'projects',force:true,forcePlace:true});api.update();
  map.remapXrControlAction('trigger',3);
  const filesTab=test.state().explorerPanel.tabHits.find(node=>node.userData.xrMenuTab==='files');
  const normal=new THREE.Vector3(0,0,1).applyQuaternion(filesTab.getWorldQuaternion(new THREE.Quaternion()));
  moveRight(worldPosition(filesTab).addScaledVector(normal,.35),normal.clone().negate());api.update();
  check(test.selectPick(controllers[1])?.tab==='files','remap regression aims at visible Files tab');
  setButton(1,0,true);controllers[1].dispatchEvent({type:'selectstart',data:sources[1]});api.update();
  check(test.state().menuTab==='projects','old trigger native event and poll cannot bypass new mapping');
  setButton(1,0,false);controllers[1].dispatchEvent({type:'selectend',data:sources[1]});api.update();
  setButton(1,3,true);api.update();
  check(test.state().menuTab==='files','new trigger mapping clicks menu immediately without VR re-entry');
  setButton(1,3,false);api.update();map.resetXrControlMap();
  manager.isPresenting=false;renderer.render(scene,camera);manager.isPresenting=true;
  return {checks,count:checks.length,threeRevision:THREE.REVISION};
}
