  await enter();
  // At headset frame times above the debounce window, one physical press can
  // arrive through native events and polling several hundred ms apart.
  const settingsState = () => api.__talkTest.state();
  const poseForSettings = (hand,position,direction) => {
    controllers[hand].position.copy(position); controllers[hand].quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);
    grips[hand].position.copy(position);grips[hand].quaternion.copy(controllers[hand].quaternion);scene.updateMatrixWorld(true);
  };
  const nativeSelect = (hand,type) => {
    const event=new Event(type);Object.defineProperty(event,'inputSource',{value:sources[hand]});session.dispatchEvent(event);
  };
  api.__talkTest.setTool('workspace');await wait(50);api.__talkTest.workspaceAction('ws-tab:scene');api.update();
  settingsState().explorerPanel.group.visible=false;
  const workspacePanel=settingsState().workspacePanel;
  workspacePanel.group.position.set(0,1.5,-.7);workspacePanel.group.quaternion.identity();scene.updateMatrixWorld(true);
  for (const [hand,reordered] of [[1,false],[0,false],[0,true]]) {
    session.inputSources=reordered?[sources[1],sources[0]]:sources;session.dispatchEvent(new Event('inputsourceschange'));
    api.__talkTest.openWorkspace();api.__talkTest.workspaceAction('ws-tab:scene');api.update();
    poseForSettings(1-hand,new THREE.Vector3(hand===1?-.3:.3,1.2,-.35),new THREE.Vector3(0,0,-1));api.update();
    const settingsIndex=workspacePanel.lines.findIndex(line=>line.id==='settings');
    check(settingsIndex>=0,'Workspace Scene has a visible Settings action');
    const point=workspacePanel.plane.localToWorld(new THREE.Vector3(0,(.5-(154+settingsIndex*50)/640)*.36,0));
    const normal=new THREE.Vector3(0,0,1).applyQuaternion(workspacePanel.plane.getWorldQuaternion(new THREE.Quaternion()));
    poseForSettings(hand,point.clone().addScaledVector(normal,.4),normal.clone().negate());api.update();
    check(api.__talkTest.pick(controllers[hand])?.id==='settings',`${hand?'right':'left'} hand targets the actual Workspace Settings action${reordered?' after source reorder':''}`);
    await wait(220);sources[hand].gamepad.buttons[0]={pressed:true,touched:true,value:1};
    nativeSelect(hand,'selectstart');
    await wait(90); // First-open canvas construction is deferred 48 ms off select.
    check(settingsState().settingsPanel?.group.visible,'native Settings press opens the actual settings popup');
    const settingsPanel=settingsState().settingsPanel.group;
    // The newly opened popup must not cover the original Settings action when
    // testing a second deliberate press; parking windows is normal VR behavior.
    settingsPanel.position.x+=2;settingsPanel.updateMatrixWorld(true);
    await wait(350);api.update();
    check(settingsPanel.visible,'delayed trigger polling cannot close Settings during the same held press');
    await wait(350);controllers[hand].dispatchEvent({type:'selectstart',data:sources[hand]});
    check(settingsPanel.visible,'a second native event after 350 ms cannot toggle Settings closed while the trigger is held');
    nativeSelect(hand,'selectend');sources[hand].gamepad.buttons[0]={pressed:false,touched:false,value:0};api.update();await wait(220);
    // The shared world-window container activates the new Settings tab, so the
    // deliberate second click targets that visible popup's own Close control.
    scene.updateMatrixWorld(true);
    const closeButton=settingsState().settingsPanel.hits.find(hit=>hit.userData.xrGridHit==='hide');
    const closePoint=closeButton.getWorldPosition(new THREE.Vector3());
    const closeNormal=new THREE.Vector3(0,0,1).applyQuaternion(closeButton.getWorldQuaternion(new THREE.Quaternion()));
    poseForSettings(hand,closePoint.addScaledVector(closeNormal,.15),closeNormal.negate());api.update();
    const closingHit=api.__talkTest.pick(controllers[hand]);
    check(closingHit?.kind==='grid-action'&&closingHit.id==='hide',`released hand targets the visible Settings Close button (${closingHit?.kind}/${closingHit?.id||closingHit?.tool||''})`);
    sources[hand].gamepad.buttons[0]={pressed:true,touched:true,value:1};nativeSelect(hand,'selectstart');
    check(!settingsPanel.visible,'release and a new Settings press closes the popup exactly once');
    await wait(350);api.update();check(!settingsPanel.visible,'delayed polling of the closing press cannot reopen Settings');
    nativeSelect(hand,'selectend');sources[hand].gamepad.buttons[0]={pressed:false,touched:false,value:0};api.update();await wait(220);
  }
  workspacePanel.group.visible=false;
  session.inputSources=sources;session.dispatchEvent(new Event('inputsourceschange'));api.__talkTest.setTool('hand_left');api.update();
  api.openAiPromptPanel({ forcePlace:true });
  const state = () => api.__talkTest.state();
  const panel = state().aiPanel;
  const painted = [], paintContext=panel.canvas.getContext("2d"), originalFillText = paintContext.fillText;
  paintContext.fillText = function(text,...args) { if(this.canvas===panel.canvas)painted.push(String(text)); return originalFillText.call(this,text,...args); };
  panel.group.position.set(0,1.5,-.7); panel.group.quaternion.identity();
  const menu = state().explorerPanel.group;
  menu.position.set(0,1.5,-1.1); menu.quaternion.identity();
  const moveHand = (hand,position,direction) => {
    controllers[hand].position.copy(position);
    controllers[hand].quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),direction);
    grips[hand].position.copy(position); grips[hand].quaternion.copy(controllers[hand].quaternion);
    scene.updateMatrixWorld(true);
  };
  const press = (hand,on) => { sources[hand].gamepad.buttons[0]={pressed:on,touched:on,value:on?1:0}; api.update(); };
  const aimTalk = (hand,distance) => {
    const other = 1-hand;
    moveHand(other,new THREE.Vector3(other?.45:-.45,1.1,-.2),new THREE.Vector3(0,0,-1));
    api.update(); scene.updateMatrixWorld(true);
    const hit = panel.hits.find(mesh => mesh.userData.xrAiHit === 'talk');
    const point = hit.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0,0,1).applyQuaternion(hit.getWorldQuaternion(new THREE.Quaternion()));
    moveHand(hand,point.addScaledVector(normal,distance),normal.negate()); api.update();
    return api.__talkTest.pick(controllers[hand]);
  };
  for (const [hand,distance] of [[1,.4],[0,.4],[1,.015],[0,.015]]) {
    const hit = aimTalk(hand,distance);
    check(hit?.kind==='ai-action'&&hit.id==='talk',`${hand?'right':'left'} ${distance<.1?'near':'far'} ray hits the visible AI prompt Talk button with a menu behind it (${hit?.kind}/${hit?.id||hit?.tool||''})`);
    await wait(220); const before=startupCalls.length;
    press(hand,true); press(hand,false); await wait(20);
    check(startupCalls.length===before+1,`${hand?'right':'left'} ${distance<.1?'near':'far'} trigger starts AI Talk once`);
    check(panel.talking && /listening|live/i.test(panel.status),'successful Talk updates the headset panel');
  }
  api.__talkTest.setTool('draw');
  let hit=aimTalk(1,.4); const drawingsBefore=state().voiceDraw.strokeCount();
  await wait(220); let before=startupCalls.length;
  const nativeEvent = new Event('selectstart'); Object.defineProperty(nativeEvent,'inputSource',{value:sources[1]});
  session.dispatchEvent(nativeEvent);
  controllers[1].dispatchEvent({type:'selectstart',data:sources[1]});
  press(1,true); press(1,false); await wait(20);
  check(startupCalls.length===before+1,'native session/controller events and trigger polling deduplicate the same Talk press');
  check(state().voiceDraw.strokeCount()===drawingsBefore,'Talk press while drawing does not make a stroke');
  session.inputSources=[sources[1],sources[0]]; session.dispatchEvent(new Event('inputsourceschange')); api.update();
  hit=aimTalk(0,.4); await wait(220); before=startupCalls.length;
  press(0,true); press(0,false); await wait(20);
  check(hit?.id==='talk' && startupCalls.length===before+1,'left-hand Talk remains bound correctly after source order changes');
  startupResult={ok:false,live:false,error:'Fixture connection failed'};
  aimTalk(1,.4); await wait(220); press(1,true); press(1,false); await wait(20);
  check(!panel.talking && panel.status.includes('Fixture connection failed'),'failed voice startup appears in the headset panel');
  check(painted.includes('Fixture connection failed') && painted.includes('Keep the existing CAD mounting holes.'),'Talk errors render below the buttons without replacing an existing prompt');
  let resolveStartup;
  startupResult=new Promise(resolve=>{resolveStartup=resolve;});
  aimTalk(1,.4); await wait(220); before=startupCalls.length;press(1,true);press(1,false);
  check(panel.talkConnecting && !panel.talking && painted.includes('Connecting…'),'pending startup visibly says Connecting before claiming Astra is live');
  await wait(220);press(1,true);press(1,false);
  check(startupCalls.length===before+1,'repeated Talk clicks during startup keep one pending connection');
  api.closeAiPromptPanel(); resolveStartup({ok:true,live:true});await wait(20);
  api.openAiPromptPanel({keepPose:true});
  check(panel.talking&&!panel.talkConnecting,'only a live result changes Connecting to Talking');
  check(panel.group.visible && /listening/.test(panel.talkStatus),'closing and reopening the panel preserves the completed startup result');
  api.setVoiceMoldLive(false);
  check(!panel.talking && /disconnected/.test(panel.talkStatus),'a later voice socket close clears the panel Listening state');
  session.inputSources=sources;
  // Starting AI Talk must not race a second room-voice getUserMedia request.
  startupResult={ok:true,live:true}; aimTalk(1,.4); await wait(220);
  const getMicBefore=micCallStacks.length; press(1,true); press(1,false); await wait(20);
  check(!micCallStacks.slice(getMicBefore).some(stack=>/primeAstraTalkMedia|beginAstraTalk/.test(stack)),
    'AI Talk delegates microphone ownership to the voice startup controller independently of room-voice retry polling');
  delete window.__activateStudioVoiceAgent; delete window.Render3DXrAgent;
  aimTalk(1,.4); await wait(220); press(1,true); press(1,false); await wait(20);
  check(!panel.talking && /not ready|unavailable/i.test(panel.status),'missing host never reports Astra listening');
  check(painted.some(text=>text.includes('Astra voice is not ready')),'missing-host error is visibly painted even with a prompt draft');
  let fallbackLive=false;
  window.Render3DXrAgent={action:async()=>{fallbackLive=true;},getState:()=>({live:fallbackLive})};
  aimTalk(1,.4);await wait(220);press(1,true);press(1,false);await wait(20);
  check(panel.talking,'direct bridge fallback confirms live state after a void start result');
  window.__activateStudioVoiceAgent=async()=>undefined;
  aimTalk(1,.4);await wait(220);press(1,true);press(1,false);await wait(20);
  check(!panel.talking&&/not ready/.test(panel.status),'undefined host result cannot claim a working voice session');
  paintContext.fillText = originalFillText;
  api.__talkTest.setTool('grab');
  camera.position.set(0,1.5,-.12); camera.lookAt(0,1.5,-.7);
  moveHand(0,new THREE.Vector3(-.5,.7,.1),new THREE.Vector3(0,0,-1));moveHand(1,new THREE.Vector3(.5,.7,.1),new THREE.Vector3(0,0,-1));
  api.update(); assembly.visible=false; menu.visible=false; scene.updateMatrixWorld(true); manager.isPresenting=false;renderer.render(scene,camera);manager.isPresenting=true;
  return {checks, count:checks.length, startupCalls:startupCalls.length, micCalls, paidRequests:0};
}
