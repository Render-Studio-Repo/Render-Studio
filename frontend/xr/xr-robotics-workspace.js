/** Compact spatial Pi menus, printer tools, and shared live Viser controls. */
import { readRoboticsProfile, checkRoboticsProfileAfterWorkspaceUpdate } from './robotics-profile.js?v=roboticsworkspace3&dimos-viser-local1';
import { requestPiTeleop } from './pi-teleop-client.js?v=20260927-teleop-auth2&devicesession=20260927-1&vrrobot=20260927-2';
import { discardDimosRecord, requestDimosGripperClose, requestDimosHomeAndDisarm, startDimosRecord, stopDimosRecord } from './xr-dimos-teleop.js?v=20260929-ab-recorder2';
import { createXrViserScene } from './xr-viser-scene.js?v=roboticsworkspace3-pitriggerviser2-viserroom2-20260916-visergrip1&simrun=20260923-1&robot-size=20260927-1&vrrobot=20260927-2&robotlock=20260927-1';
import { applyRobotPlacement, clearRobotPlacement, readRobotPlacement, saveRobotPlacement } from './xr-robot-placement.js?v=20260927-robot-lock1';
import { isViserGrabMesh } from './xr-viser-grip.js?v=20260916-visergrip1&robot-size=20260927-1&vrrobot=20260927-2';
import { createXrNearGrabPicker } from './xr-near-grab.js?v=20260915-xrgrab1-xrgrab2-xrgrab3-xrgrab4-20260915-contact2-20260915-xrdispatch4';
import { printerFencePointFromRay, printerFenceFromCorners, isLeftoverAutoPrinterFence } from './xr-share-print.js?v=throwprint1-printbox1-xrperf3&printtab=20260916-1&printbox=20260916-2';
import { createHudRefreshGate } from './xr-hud-refresh.js?v=teleophud1';
import { createDatasetFolder, datasetDestinationPayload, datasetDestinationStorageKey, datasetFolderStorageKey, normalizeDatasetLibrary, selectDatasetDestination } from '../studio/robotics-recording-library.js?v=20260929-dataset-folders2';
import {
  paintTeleopVisorHud,
  teleopHudChips,
  teleopHudSignature,
  TELEOP_HUD_CANVAS,
  TELEOP_HUD_PLANE,
  TELEOP_HUD_CACHE,
} from './xr-robotics-hud.js?v=20260930-right-save-picker1';
void TELEOP_HUD_CACHE;

export function reportXrRobotDebug(detail = {}) {
  const safe = {
    source: 'xr-live-robot',
    at: new Date().toISOString(),
    status: 'error',
    message: String(detail.message || 'Could not load live robot'),
    stage: String(detail.stage || 'live-scene'),
    transport: String(detail.transport || 'viser'),
    target: String(detail.target || ''),
    profileVersion: String(detail.profileVersion || 'unknown'),
    trace: String(detail.trace || ''),
  };
  globalThis.dispatchEvent?.(new CustomEvent('render3d:robotics-debug', { detail: safe }));
  return safe;
}

export function createXrRoboticsWorkspace({THREE,scene,getToken,getUserId,getHeadPose,getRightController,getTeleop,getFeed,getWorkshopAnchor,isJoined,joinRoom,onStatus,onPrinter,getPrinter,openConfig,openSlicer,setPiUiState}) {
  const panels=new Map(),robots=new Map(),grabs=new Map(),connectors=new Map(),remoteUi=new Map();
  const _from=new THREE.Vector3(),_to=new THREE.Vector3();
  let lastConnectAt=0;
  function connectPanel(id,from,to){
    const show=!!(from?.visible&&to?.visible);
    let line=connectors.get(id);
    if(!show){if(line)line.visible=false;return;}
    if(!line){line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:0x637789}));scene.add(line);connectors.set(id,line);}
    line.visible=true;
    const now=performance.now();
    if(now-lastConnectAt<80 && grabs.size===0)return;
    lastConnectAt=now;
    const positions=line.geometry.attributes.position;
    positions.setXYZ(0,...from.getWorldPosition(_from).toArray());
    positions.setXYZ(1,...to.getWorldPosition(_to).toArray());
    positions.needsUpdate=true;
  }
  let current=null,active=false,wasArmed=false,lastTick=0,lastPoll=0,polling=false,workspace={presets:[]},docsTab='intro',docsSearch='',emoteItems=[],emoteIndex=0,keyboard=null,fenceMode=0,fenceFirst=null,fence=null;
  let emoteTarget=null,confirmTarget=null,confirmDetail=null,emoteLoadGeneration=0,confirmBusy=false,datasetFolderView=null;
  const datasetProjectId=()=>{try{return new URLSearchParams(location.search).get('project')||'global';}catch{return 'global';}};
  const datasetFolderKey=datasetFolderStorageKey(datasetProjectId());
  const datasetDestinationKey=datasetDestinationStorageKey(datasetProjectId());
  const recordingNamesKey=()=>`render3d:robotics:recording-names:v1:${datasetProjectId()}`;
  const readRecordingNames=()=>{try{return JSON.parse(localStorage.getItem(recordingNamesKey())||'{}')||{};}catch{return {};}};
  const displayRecordingName=item=>readRecordingNames()[String(item?.id||'')]||item?.name||item?.label||item?.id||'Recording';
  const saveRecordingName=(item,name)=>{const clean=String(name||'').trim().replace(/\s+/g,' ').slice(0,64);if(!clean)return null;const names=readRecordingNames();names[String(item.id||item.name)]=clean;try{localStorage.setItem(recordingNamesKey(),JSON.stringify(names));}catch{}item.name=clean;return clean;};
  const readDatasetFolders=()=>{try{const value=JSON.parse(localStorage.getItem(datasetFolderKey)||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
  const saveDatasetFolders=folders=>{try{localStorage.setItem(datasetFolderKey,JSON.stringify(folders.filter(folder=>!folder.builtIn)));}catch{}};
  const readDatasetDestination=library=>{try{return selectDatasetDestination(library,localStorage.getItem(datasetDestinationKey)||'emotes');}catch{return selectDatasetDestination(library);}};
  const saveDatasetDestination=folder=>{try{localStorage.setItem(datasetDestinationKey,folder.id);}catch{}onStatus?.('ok',`${folder.name} is the current recording destination`);};
  let viserTask=null,workspaceGeneration=0;
  const hudGate=createHudRefreshGate(250);
  const raycaster=new THREE.Raycaster(), matrix=new THREE.Matrix4(),v=new THREE.Vector3(),q=new THREE.Quaternion();
  const pickNearSurface=createXrNearGrabPicker(THREE);
  const api=async(path,opts={})=>{const r=await fetch(path,{...opts,headers:{Authorization:`Bearer ${getToken()}`,...opts.headers}});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.detail||`Request failed (${r.status})`);return data;};
  const error=e=>onStatus?.('error',e.message||String(e));
  const perform=fn=>Promise.resolve().then(fn).catch(error);
  const save=()=>api('/api/robotics/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(workspace)}).then((data)=>{void checkRoboticsProfileAfterWorkspaceUpdate().then((report)=>{if(report?.detail)onStatus?.(report.stale?'error':'ok',report.detail);});return data;});
  const local=()=>robots.get(current);
  const isOwner=r=>r?.descriptor?.owner===getUserId();
  const row=(label,action=null)=>({label,action});
  function place(group,index=panels.size) {
    const head=getHeadPose(),f=new THREE.Vector3(0,0,-1).applyQuaternion(head.quaternion);f.y=0;f.normalize();
    const right=new THREE.Vector3().crossVectors(f,new THREE.Vector3(0,1,0));
    group.position.copy(head.position).addScaledVector(f,0.55+Math.floor(index/3)*0.12).addScaledVector(right,((index%3)-1)*0.42);group.position.y-=0.08+Math.floor(index/3)*0.48;
    group.lookAt(head.position);
  }
  function placeAtRightController(group) {
    const controller=getRightController?.();
    if(!controller?.getWorldPosition)return false;
    const head=getHeadPose();
    controller.getWorldPosition(_from);
    const right=new THREE.Vector3(1,0,0).applyQuaternion(head.quaternion);
    const up=new THREE.Vector3(0,1,0).applyQuaternion(head.quaternion);
    const toward=new THREE.Vector3(0,0,1).applyQuaternion(head.quaternion);
    group.position.copy(_from).addScaledVector(right,0.20).addScaledVector(up,0.13).addScaledVector(toward,0.035);
    group.quaternion.copy(head.quaternion);
    return true;
  }
  function panel(id,title,rows) {
    if(panels.has(id)){const p=panels.get(id);p.group.visible=true;p.rows=rows||p.rows;paint(p);return p;}
    const canvas=document.createElement('canvas');
    canvas.width=id==='hud'?TELEOP_HUD_CANVAS.w:1024;
    canvas.height=id==='hud'?TELEOP_HUD_CANVAS.h:id==='cameras'?480:1100;
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
    const group=new THREE.Group();group.name='Robotics '+title;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(id==='hud'?TELEOP_HUD_PLANE.w:0.50,id==='hud'?TELEOP_HUD_PLANE.h:id==='cameras'?0.235:0.54),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false}));
    mesh.renderOrder=2080;mesh.userData.xrRoboticsWorkspace=id;group.add(mesh);scene.add(group);
    if(id==='confirm'){group.scale.setScalar(0.72);if(!placeAtRightController(group))place(group);}else place(group);
    const p={id,title,group,mesh,canvas,texture,cells:[],rows,page:0,images:[null,null],imageBusy:false,lastFrame:0};panels.set(id,p);paint(p);return p;
  }
  function button(p,ctx,label,x,y,w,h,action) {
    ctx.fillStyle='#24313e';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#445464';ctx.strokeRect(x+.5,y+.5,w-1,h-1);
    ctx.fillStyle='#e6edf3';ctx.font='25px Arial';ctx.textAlign='left';
    const lines=String(label).match(new RegExp(`.{1,${Math.max(8,Math.floor(w/13))}}(?:\\s|$)|.{1,${Math.max(8,Math.floor(w/13))}}`,'g'))||[''];
    lines.slice(0,2).forEach((s,i)=>ctx.fillText(s.trim(),x+12,y+27+i*27));
    if(action)p.cells.push({x,y,w,h,action});
  }
  function paint(p) {
    if(!p.group.visible)return;const c=p.canvas,ctx=c.getContext('2d');
    if(p.id==='hud'){
      const snap=getTeleop()||{},widgets=getFeed()?.widgets||{};
      paintTeleopVisorHud(ctx,{w:c.width,h:c.height},teleopHudChips({
        teleop:snap.teleop||{},widgets:{...widgets,state:snap.recording?'RECORDING':snap.pendingIntent==='starting'?'STARTING':widgets.state},lastAction:snap.lastAction,statusKey:snap.statusKey,datasetFolder:snap.datasetFolder,
      }));
      p.cells=[{x:c.width-70,y:6,w:60,h:44,action:()=>{p.group.visible=false;syncPiUi();}}];
      p.texture.needsUpdate=true;return;
    }
    ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(13,20,28,0.96)';ctx.fillRect(0,0,c.width,c.height);p.cells=[];
    ctx.fillStyle='#e6edf3';ctx.font='bold 32px Arial';ctx.textAlign='left';ctx.fillText(p.title,24,46);
    button(p,ctx,'×',948,12,60,54,()=>{p.group.visible=false;syncPiUi();});
    if(p.id==='cameras'){
      p.images.forEach((img,i)=>{if(img?.naturalWidth)ctx.drawImage(img,20+i*496,82,484,363);else{ctx.fillStyle='#96a5b3';ctx.fillText(i?'Right camera — waiting':'Left camera — waiting',24+i*496,240);}});p.texture.needsUpdate=true;return;
    }
    if(p.id==='keyboard' && keyboard){
      ctx.fillStyle='#9dd9ff';ctx.font='28px Arial';ctx.fillText(keyboard.draft.slice(-55),24,108);
      const keys=['1234567890','qwertyuiop','asdfghjkl','zxcvbnm.-'];keys.forEach((line,r)=>[...line].forEach((key,i)=>button(p,ctx,key.toUpperCase(),24+i*96,160+r*105,86,88,()=>{keyboard.draft+=key;paint(p);}))); 
      button(p,ctx,'Space',24,608,400,70,()=>{keyboard.draft+=' ';paint(p);});button(p,ctx,'Backspace',442,608,260,70,()=>{keyboard.draft=keyboard.draft.slice(0,-1);paint(p);});
      button(p,ctx,'Save',720,608,280,70,()=>{const k=keyboard;keyboard=null;p.group.visible=false;perform(()=>k.save(k.draft));});p.texture.needsUpdate=true;return;
    }
    const sourceRows=typeof p.rows==='function'?p.rows():p.rows||[];const rows=sourceRows.flatMap(r=>String(r.label).length>132?(String(r.label).match(/.{1,132}(?:\s|$)|.{1,132}/g)||[]).map(label=>({...r,label})):r);p.page=Math.min(p.page,Math.max(0,Math.ceil(rows.length/11)-1));
    rows.slice(p.page*11,p.page*11+11).forEach((r,i)=>button(p,ctx,r.label,24,96+i*79,976,69,r.action?()=>perform(r.action):null));
    if(rows.length>11){button(p,ctx,'‹ Previous',24,995,470,65,()=>{p.page=Math.max(0,p.page-1);paint(p);});button(p,ctx,'Next ›',510,995,490,65,()=>{p.page++;paint(p);});}
    p.texture.needsUpdate=true;
  }
  function text(label,value,save){keyboard={draft:String(value||''),save};panel('keyboard',label);}
  function syncPiUi(){setPiUiState?.({emoteOpen:!!panels.get('emotes')?.group.visible,confirmOpen:!!panels.get('confirm')?.group.visible});}
  function showDocs(){panel('docs','TeleOP docs',()=>{
    const menu=readRoboticsProfile().profile?.menuDefinition?.panels?.docs||{};
    const page=menu.pages?.[docsTab]||{};const lines=(page.lines||[]).filter(l=>!docsSearch||l.toLowerCase().includes(docsSearch.toLowerCase()));
    return [row('Search: '+(docsSearch||'all topics'),()=>text('Search Pi docs',docsSearch,t=>{docsSearch=t;paint(panels.get('docs'));})),...(menu.tabs||[]).map(t=>row(t.title,()=>{docsTab=t.id;docsSearch='';paint(panels.get('docs'));})),...lines.map(l=>row(l)),...(menu.header?.links||[]).map(l=>row(l.label,()=>window.open(l.url,'_blank','noopener')))];
  });}
  function showControls(){panel('controls','Pi controller configuration',()=>{
    const profile=readRoboticsProfile().profile||{},buttons=profile.controllers?.buttons||{};
    return [row('Update URL / install Pi profile',openConfig),row('Y: tap calibrate + activate/pause/reactivate · hold Home/reset'),row('A: Record / Stop + Save · B: Discard'),...['left','right'].flatMap(side=>Object.entries(buttons[side]||{}).filter(([key])=>side!=='right'||!['A','B'].includes(key)).flatMap(([key,value])=>typeof value==='string'?[row(`${side} ${key}: ${value}`)]:Object.entries(value).filter(([k,v])=>typeof v==='string').map(([action,v])=>row(`${side} ${key} ${action}: ${v}`)))),row('Grip: move Studio models and windows; two grips resize models'),row('Trigger: click menus or control gripper when pointing away')];
  });}
  function showHud(){hudGate.reset();panel('hud','TeleOP');}
  async function ensureViser({own=false,shareRoom,headless=true,forceWorkshopAnchor=false}={}){
    if(viserTask)return viserTask;
    const generation=workspaceGeneration;
    const loading=headless?null:panel('viser','OpenArm · Viser controls',[row('Loading live robot from the Pi…')]);
    const task=(async()=>{
    if(own||!local()){const owned=[...robots.entries()].find(([,r])=>isOwner(r));current=owned?.[0]||null;}
    workspace=await api('/api/robotics/workspace').catch(()=>workspace);
    if(generation!==workspaceGeneration)return;
    if(!local() || local().descriptor.status==='disconnected' || local().connectionState==='disconnected'){
      const previous=local()?.descriptor;
      if(local()){local().close();robots.delete(current);current=null;}
      const selected=readRoboticsProfile(),url=selected.profile?.viser||selected.profile?.visor;
      if(!url)throw Error('Set the Viser URL in Robotics configuration, then retry.');
      const d=await api('/api/robotics/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
      if(generation!==workspaceGeneration)return;
      attach(d);current=d.id;
      const r=local();
      const workshopAnchor=getWorkshopAnchor?.(),savedPlacement=readRobotPlacement();
      if(workshopAnchor && (forceWorkshopAnchor || workshopAnchor.userData?.canonicalWorkshopAnchor)){workshopAnchor.updateWorldMatrix?.(true,false);workshopAnchor.getWorldPosition(r.root.position);workshopAnchor.getWorldQuaternion(r.root.quaternion);r.root.userData.xrWorkshopNetworked=true;r.setPlacementLocked(false);}
      else if(savedPlacement){applyRobotPlacement(r.root,savedPlacement);r.setPlacementLocked(true);}
      else if(workshopAnchor){workshopAnchor.updateWorldMatrix?.(true,false);workshopAnchor.getWorldPosition(r.root.position);workshopAnchor.getWorldQuaternion(r.root.quaternion);r.root.userData.xrWorkshopNetworked=true;}
      else if(previous?.pose)r.setPose(previous.pose);
      else {place(r.root,1);r.root.position.y=Math.max(0.15,getHeadPose().position.y-0.75);}
      await sharePose(r);
      shareRoom ??= previous?.share ?? true;
    }
    const canonicalAnchor=getWorkshopAnchor?.();
    if(local()&&canonicalAnchor&&(forceWorkshopAnchor||canonicalAnchor.userData?.canonicalWorkshopAnchor)){
      canonicalAnchor.updateWorldMatrix?.(true,false);canonicalAnchor.getWorldPosition(local().root.position);canonicalAnchor.getWorldQuaternion(local().root.quaternion);local().root.userData.xrWorkshopNetworked=true;local().setPlacementLocked(false);await sharePose(local());
    }
    if(generation!==workspaceGeneration)return;
    if(shareRoom&&local()&&isOwner(local()))await sharing({room:true});
    if(generation!==workspaceGeneration)return;
    if(!headless){const p=panel('viser','OpenArm · Viser controls',viserRows);if(local()){p.group.position.copy(local().root.position).add(new THREE.Vector3(0.65,0.28,0));p.group.lookAt(getHeadPose().position);}}
    return local();
    })();viserTask=task;
    try{return await task;}catch(e){
      if(generation===workspaceGeneration){
        const message=String(e?.message||e||'Could not load live robot');
        reportXrRobotDebug({message,stage:'viser-load',trace:e?.trace||e?.traceId||'',target:local()?.descriptor?.url||''});
        if(loading){loading.rows=[row('Could not load live robot: '+message),row('Debug sent to Robotics Home · Copy debug'),row('Retry live Viser',()=>perform(()=>showViser({own,shareRoom})))];paint(loading);}
      }
      throw e;
    }finally{if(viserTask===task)viserTask=null;}
  }
  const showViser=(options={})=>ensureViser({...options,headless:false});
  function attach(d){if(robots.has(d.id))return;const robot=createXrViserScene({THREE,scene,api,getToken,onChange:msg=>{
      if(msg?.type==='sharing-revoked'&&msg.owner!==getUserId()){robot.close();robots.delete(d.id);if(current===d.id){current=null;for(const id of ['viser','emotes','cameras'])if(panels.has(id))panels.get(id).group.visible=false;}}
      const descriptor=robot.descriptor;
      if(descriptor&&descriptor.owner!==getUserId()&&current===d.id){
        const previous=remoteUi.get(d.id)||{};
        if(descriptor.emotes_shared&&!previous.emotes)perform(showEmotes);
        if(!descriptor.emotes_shared&&previous.emotes&&panels.has('emotes'))panels.get('emotes').group.visible=false;
        if(descriptor.cameras_shared&&!previous.cameras)showCameras();
        if(!descriptor.cameras_shared&&panels.has('cameras'))panels.get('cameras').group.visible=false;
        remoteUi.set(d.id,{emotes:descriptor.emotes_shared,cameras:descriptor.cameras_shared});
      }
      if(panels.has('viser'))paint(panels.get('viser'));
    },onError:error});robots.set(d.id,robot);robot.connect(d);const saved=readRobotPlacement();if(saved){applyRobotPlacement(robot.root,saved);robot.setPlacementLocked(true);}}
  async function sharing(patch){const r=local();const d=r.descriptor;const result=await r.action('sharing',{room:d.share,emotes:d.emotes_shared,cameras:d.cameras_shared,...patch});if(result.scene)r.receive({scene:result.scene});}
  function guiRows(r){return [...r.gui.values()].filter(g=>g.props?.visible!==false && ['GuiButtonMessage','GuiDropdownMessage','GuiSliderMessage','GuiCheckboxMessage'].includes(g.type)).sort((a,b)=>a.props.order-b.props.order).map(g=>row(`${g.props.label}${g.type==='GuiButtonMessage'?'':' · '+g.value}${g.props.disabled?' (unavailable)':''}`,g.props.disabled?null:async()=>{
    if(/grip/i.test(String(g.props.label||''))){
      if(g.type==='GuiSliderMessage'){const mid=(Number(g.props.min)+Number(g.props.max))/2;await r.action('gui',{uuid:g.uuid,value:Number(g.value)<mid?g.props.max:g.props.min});return;}
      requestDimosGripperClose();
    }
    if(g.type==='GuiDropdownMessage'){panel('options',g.props.label,(g.props.options||[]).map(value=>row(value,async()=>{await r.action('gui',{uuid:g.uuid,value});panels.get('options').group.visible=false;})));}
    else if(g.type==='GuiSliderMessage')text(g.props.label,g.value,async value=>{const n=Number(value);if(!Number.isFinite(n)||n<g.props.min||n>g.props.max)throw Error(`Choose ${g.props.min}–${g.props.max}`);await r.action('gui',{uuid:g.uuid,value:n});});
    else await r.action('gui',{uuid:g.uuid,value:g.type==='GuiCheckboxMessage'?!g.value:true});
  }));}
  function chooseRobot() {
    const choices=[...robots].map(([id,robot])=>row(robot.descriptor.owner_name||'Robot',()=>{
      current=id;
      panels.get('robots').group.visible=false;
      panel('viser','OpenArm · Viser controls',viserRows);
    }));
    panel('robots','Room robots',[row('Add my Pi live scene',()=>showViser({own:true})),...choices]);
  }
  async function joinRobotRoom(){
    const result=await joinRoom?.();
    if(result?.ok===false)throw Error(result.error||'Could not join the public room');
    if(result?.ok)onStatus?.('ok','Joined public room · OpenArm is shared');
  }

  function toggleRobotPlacementLock(r){const lock=!r.root.userData.xrPlacementLocked;if(lock){if(!saveRobotPlacement(r.root))throw Error('Could not save the 3D arm placement');r.setPlacementLocked(true);onStatus?.('ok','3D arm locked in place');}else{clearRobotPlacement();r.setPlacementLocked(false);onStatus?.('ok','3D arm unlocked · grip to reposition');}paint(panels.get('viser'));}
  function viserRows(){const r=local();if(!r)return [row('Add live Viser',showViser)];const d=r.descriptor;const sim=r.root?.userData?.simulationRun;const simRows=sim?[row(`MuJoCo · ${sim.scene||'scene'} · ${sim.runId}`)]:[];
    if(d.status==='disconnected'||r.connectionState==='disconnected')return [row(d.error||'Live robot disconnected · reconnecting'),row('Retry live Viser',()=>isOwner(r)?showViser({own:true,shareRoom:d.share}):pollRooms())];
    if(r.loadError)return [row('Robot geometry could not load: '+r.loadError),row('Retry model download',()=>{r.close();robots.delete(d.id);attach(d);})];
    if(!r.connected)return [row('Connecting to live OpenArm…')];
    if(!isOwner(r))return [row('Choose room robot',chooseRobot),row(`${d.owner_name} · live robot`),...simRows,row('Both hand cameras',showCameras),...(d.emotes_shared?[row('Shared emotes',showEmotes)]:[])];
    return [row(d.share?(isJoined()?'Live OpenArm · visible to room members':'Join public room to share OpenArm'):'Live OpenArm · private',d.share&&!isJoined()&&joinRoom?joinRobotRoom:null),...simRows,row(`3D arm placement · ${r.root.userData.xrPlacementLocked?'locked':'unlocked'}`,()=>toggleRobotPlacementLock(r)),row('Choose room robot',chooseRobot),row('Close left gripper',()=>requestDimosGripperClose('left')),row('Close right gripper',()=>requestDimosGripperClose('right')),row(`Room visibility · ${d.share?'on':'off'}`,()=>sharing({room:!d.share})),row(`Let room users play emotes · ${d.emotes_shared?'on':'off'}`,()=>sharing({room:true,emotes:!d.emotes_shared})),row(`Share both hand cameras · ${d.cameras_shared?'on':'off'}`,()=>sharing({room:true,cameras:!d.cameras_shared})),row('Both hand cameras · one window',showCameras),row('Data Sets · X',showDatasets),row('Save current paused pose',()=>savePreset('current')),row('Save edited target',()=>savePreset('target')),row('Saved target presets',showPresets),...guiRows(r)];
  }
  async function savePreset(source){text('Name target preset','',async name=>{const r=local();await r.action('preset-save',{name,source,role:'current'});workspace=await api('/api/robotics/workspace');showPresets();});}
  function showPresets(){panel('presets','Saved robot targets',()=>workspace.presets.flatMap(p=>[row(`${p.name} · ${p.role}`,()=>local().action('preset-apply',{id:p.id})),row('Rename / set Init, Current or Home',()=>panel('preset-edit',p.name,[row('Rename',()=>text('Preset name',p.name,async name=>{p.name=name;await save();})),...['init','current','home'].map(role=>row(`Set ${role}`,async()=>{p.role=role;await save();paint(panels.get('presets'));})),row('Delete preset',async()=>{workspace.presets=workspace.presets.filter(x=>x.id!==p.id);await save();showPresets();})]))]));}
  const ownEmoteTarget=()=>({profile:readRoboticsProfile().profile});
  const requestEmote=(target,action,value)=>target?.profile
    ? requestPiTeleop(target.profile,action==='list'?'/emotes':'/'+action.replace('-','/'),{body:value})
    : action==='list'?api(`/api/robotics/live/${target.robot.descriptor.id}/emotes`):target.robot.action(action,value||{});
  const playEmote=()=>emoteItems[emoteIndex]&&requestEmote(emoteTarget,'emote-play',{id:emoteItems[emoteIndex].id});
  const startKey='render3d:robot-start-position:v1';
  const readStart=()=>{try{return JSON.parse(localStorage.getItem(startKey)||'null')||{type:'home',id:'home',name:'Home'};}catch{return {type:'home',id:'home',name:'Home'};}};
  const saveStart=value=>{const next=value?.type==='emote'?{type:'emote',id:String(value.id),name:String(value.name||value.id)}:{type:'home',id:'home',name:'Home'};try{localStorage.setItem(startKey,JSON.stringify(next));}catch{}onStatus?.('ok',`${next.name} saved as starting position`);showStartingPositions();};
  function showStartingPositions(){const selected=readStart();panel('starting-position','Starting Position folder',[row(`${selected.type!=='emote'?'✓ ':''}⌂ Home · pinned default`,()=>saveStart({type:'home'})),...emoteItems.map(e=>row(`${selected.type==='emote'&&String(selected.id)===String(e.id)?'✓ ':''}${e.name||e.label||e.id}`,()=>saveStart({type:'emote',id:e.id,name:e.name||e.label||e.id}))),row('Applied automatically before the first Y engage.')]);}
  async function homeOwnRobot(){
    await requestDimosHomeAndDisarm();
    onStatus?.('ok','Robot homed · arms down · controls disarmed');
  }
  async function showEmotes({own=false}={}){
    const r=local(),target=own||!r||isOwner(r)?ownEmoteTarget():{robot:r};emoteTarget=target;
    const generation=++emoteLoadGeneration;emoteItems=[];
    const p=panel('emotes','Emotes',[row('Loading emotes from the Pi…')]);p.page=0;syncPiUi();
    try {
      const data=await requestEmote(target,'list');if(generation!==emoteLoadGeneration||!p.group.visible)return;
      emoteItems=[...(data.recordings||[]),...(data.loops||[])].map(item=>({...item,name:displayRecordingName(item)}));emoteIndex=Math.min(emoteIndex,Math.max(0,emoteItems.length-1));
      p.rows=()=>[row('⌂ Home Robot · stop + home + disarm',()=>homeOwnRobot()),row('📁 Starting Position · assign Home or an emote',showStartingPositions),...(emoteItems.length?emoteItems.map((e,i)=>row(`${i===emoteIndex?'› ':''}${e.name||e.label||e.id}`,()=>{emoteIndex=i;return playEmote();})):[row('No recordings yet. Use Record on the robotics HUD.')])];paint(p);
    } catch(e) {
      if(generation!==emoteLoadGeneration)return;
      p.rows=[row('Could not load Pi emotes: '+(e.message||e)),row('Retry',()=>showEmotes({own}))];paint(p);error(e);
    }
  }
  async function decideEmote(accept,folder={id:'emotes',name:'Emotes'}){
    const target=confirmTarget,detail=confirmDetail;if(!target||confirmBusy)return;confirmBusy=true;
    try {
      await requestEmote(target,accept?'emote-accept':'emote-discard',accept?datasetDestinationPayload(folder,confirmDetail):{});
      if(target!==confirmTarget)return;
      panels.get('confirm').group.visible=false;confirmTarget=null;confirmDetail=null;syncPiUi();
      if(accept){
        onStatus?.('ok',`Take saved to ${folder.name}`);
        globalThis.dispatchEvent?.(new CustomEvent('render3d:robotics-recording-saved',{detail:{name:detail?.name||'Robot take',folderId:folder.id,folderName:folder.name,at:new Date().toISOString()}}));
        await showDatasets({own:true});
      }
    } finally {confirmBusy=false;}
  }
  function showConfirm(detail={}){
    confirmTarget=ownEmoteTarget();confirmDetail=detail;
    const library=normalizeDatasetLibrary({},readDatasetFolders());
    const active=readDatasetDestination(library);
    panel('confirm','Save recording to a dataset',()=>[
      row(`${detail.name||'Saved take'}${detail.samples?' · '+detail.samples+' samples':''}`),
      ...(detail.error?[row('Save failed: '+detail.error)]:[]),
      row(`Current destination · ${active.name}`),
      ...library.folders.map(folder=>row(`${folder.id===active.id?'✓ ':''}Save in ${folder.name}${folder.builtIn?' · replayable':''}`,()=>{saveDatasetDestination(folder);return perform(()=>decideEmote(true,folder));})),
      row('+ Folder',()=>text('New recording folder','',name=>{const folder=createDatasetFolder(name,library.folders);if(!folder)return;saveDatasetFolders([...library.folders,folder]);saveDatasetDestination(folder);showConfirm(detail);})),
      row('Discard take',()=>perform(()=>decideEmote(false))),
    ]);syncPiUi();
  }
  async function showDatasets({own=false}={}){
    const r=local(),target=own||!r||isOwner(r)?ownEmoteTarget():{robot:r};emoteTarget=target;
    const generation=++emoteLoadGeneration;emoteItems=[];
    const p=panel('emotes','Data Sets',[row('Loading recordings from the Pi…')]);p.page=0;syncPiUi();
    try{
      const data=await requestEmote(target,'list');if(generation!==emoteLoadGeneration||!p.group.visible)return;
      const library=normalizeDatasetLibrary(data,readDatasetFolders());emoteItems=library.recordings.map(item=>({...item,name:displayRecordingName(item)}));
      p.rows=()=>{
        const active=readDatasetDestination(library);
        const folder=library.folders.find(item=>item.id===datasetFolderView);
        if(folder){
          const contents=emoteItems.filter(item=>item.folderId===folder.id);
          return [
            row('← All Data Sets',()=>{datasetFolderView=null;paint(p);}),
            row(`${folder.id===active.id?'✓ ':''}Save new recordings here`,()=>{saveDatasetDestination(folder);paint(p);}),
            row(`📁 ${folder.name} · ${contents.length} recording${contents.length===1?'':'s'}`),
            ...(contents.length?contents.flatMap(item=>[
              row(`▶ Run · ${item.name||item.label||item.id}`,()=>{emoteIndex=emoteItems.indexOf(item);return playEmote();}),
              row(`Use as starting position · ${item.name||item.label||item.id}`,()=>saveStart({type:'emote',id:item.id,name:item.name||item.label||item.id})),
            ]):[row('This folder is empty')]),
          ];
        }
        return [
          row(`Recording destination · ${active.name}`),
          row('＋ New folder',()=>text('New recording folder','',name=>{const created=createDatasetFolder(name,library.folders);if(!created)return;saveDatasetFolders([...library.folders,created]);saveDatasetDestination(created);datasetFolderView=created.id;return showDatasets({own});})),
          row('⌂ Home Robot · stop + home + disarm',()=>homeOwnRobot()),
          row('📁 Starting Position · assign Home or a recording',showStartingPositions),
          ...library.folders.map(item=>row(`${item.id===active.id?'✓ ':''}📁 ${item.name} · ${emoteItems.filter(recording=>recording.folderId===item.id).length}`,()=>{datasetFolderView=item.id;paint(p);})),
        ];
      };paint(p);
    }catch(e){if(generation!==emoteLoadGeneration)return;p.rows=[row('Could not load Pi datasets: '+(e.message||e)),row('Retry',()=>showDatasets({own}))];paint(p);error(e);}
  }
  function showCameras(){panel('cameras','Hand cameras · Left / Right');}
  async function showPrinter(){workspace=await api('/api/robotics/workspace');await onPrinter?.('refresh');panel('printer','Robotics · 3D Printer',()=>{
    const p=getPrinter(),n=workspace.printer||{};return [row('Network host · '+(n.host||'not set'),()=>text('Printer LAN host',n.host,async host=>{workspace.printer={...n,host};await save();})),row('Printer serial / profile · '+(n.serial||'not set'),()=>text('Printer serial / profile',n.serial,async serial=>{workspace.printer={...n,serial};await save();})),row('Connection · '+(n.protocol||'Bambu LAN'),()=>{workspace.printer={...n,protocol:n.protocol==='OctoPrint'?'Bambu LAN':'OctoPrint'};return save();}),row('Test LAN connection',async()=>{const result=await api('/api/robotics/printer/probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:n.host,protocol:n.protocol})});onStatus('ok',result.message);}),row(`Accept print requests · ${p.accept_sends?'on':'off'}`,()=>onPrinter('printer_accept')),row(`Printer boundary · ${p.show_outline?'on':'off'}`,()=>onPrinter('printer_outline')),row(`Printer model · ${p.show_model?'on':'off'}`,()=>onPrinter('printer_model')),row('Create bounder · hover, grip move, two grips stretch',()=>onPrinter('printer_bounder')),row('Send to PC',()=>onPrinter('printer_send_pc')),row('Access PIN · '+(p.access_code_set||n.access_code?'set':'not set'),()=>text('Printer PIN / access code','',async pin=>{workspace.printer={...n,access_code:pin};await save();onPrinter('printer_pin',pin);})),row('Draw printer in passthrough · two opposite corners',()=>{onPrinter('start_fence');onStatus('ok','Walk the controller to one corner of the printer you see, then trigger. Then the opposite corner.');}),row('Restore saved printer fence',restoreFence),row('Open slicer / printer network settings',openSlicer),row('Print volume · '+(p.volume?`${Math.round(p.volume.x*1000)} × ${Math.round(p.volume.z*1000)} × ${Math.round(p.volume.y*1000)} mm`:'draw the box in passthrough'))];});}
  function restoreFence(){
    const f=workspace.fence;
    if(!f||isLeftoverAutoPrinterFence(f)){
      workspace.fence=null;
      if(fence)fence.visible=false;
      onPrinter('placement',null);
      return;
    }
    onPrinter('placement',Object.assign({},f,{userDrawn:true}));
  }
  function selectFence(ray){
    const pt=printerFencePointFromRay(ray);
    if(!pt)return;
    if(fenceMode!==2||!fenceFirst){
      fenceFirst=pt;fenceMode=2;
      onStatus('ok','Opposite corner of the printer you see — trigger when the box matches.');
      return;
    }
    const next=printerFenceFromCorners(fenceFirst,pt);
    if(!next){onStatus('error','Too close — mark a real opposite corner.');return;}
    workspace.fence=next;fenceMode=0;fenceFirst=null;
    perform(async()=>{await save();onPrinter('placement',next);});
  }
  function pick(ray){raycaster.ray.copy(ray);let best=null;
    for(const p of panels.values())if(p.group.visible){p.group.updateMatrixWorld(true);const h=raycaster.intersectObject(p.mesh)[0];if(h&&(!best||h.distance<best.distance)){const x=h.uv.x*p.canvas.width,y=(1-h.uv.y)*p.canvas.height;const cell=p.cells.find(c=>x>=c.x&&x<=c.x+c.w&&y>=c.y&&y<=c.y+c.h);if(!cell)continue;best={kind:'robotics-workspace-action',panel:p.id,distance:h.distance,point:h.point,cell};}}
    return best;
  }
  function select(hit){if(hit.fence)selectFence(hit.ray);else hit.cell?.action?.();}
  function beginGrip(hand,source,aim,opts={}){
    if(grabs.has(hand))return true;
    if(!source||!aim)return false;
    source.updateMatrixWorld(true);aim.updateMatrixWorld(true);
    raycaster.ray.origin.setFromMatrixPosition(aim.matrixWorld);
    raycaster.ray.direction.set(0,0,-1).applyQuaternion(aim.getWorldQuaternion(q));
    const lineParams=raycaster.params.Line,prevThresh=lineParams?.threshold;
    if(lineParams)lineParams.threshold=0.006;
    try{
      const hit=pick(raycaster.ray);let target=hit?.panel?panels.get(hit.panel).group:null,robot=null,targetName='';
      const allowRobot=opts.allowRobot!==false && !opts.walkHeld;
      if(!target && allowRobot)for(const r of robots.values())if(isOwner(r)&&r.root?.visible&&!r.root.userData.xrPlacementLocked){
        r.root.updateMatrixWorld(true);
        const h=r.pick(raycaster);if(h){target=r.controls.get(h.name);robot=r;targetName=h.name;break;}
        const meshHit=r.pickMesh?r.pickMesh(raycaster):null;
        if(meshHit){target=r.root;robot=r;break;}
        const origin=opts.contactOrigin;
        if(origin){
          const near=pickNearSurface(origin,[{root:r.root,target:r.root}]);
          if(near && isViserGrabMesh(near.object)){target=r.root;robot=r;break;}
        }
      }
      if(!target)return false;
      const offset=source.matrixWorld.clone().invert().multiply(target.matrixWorld);
      robot?.setInteracting(true);grabs.set(hand,{target,source,offset,robot,targetName});return true;
    }finally{if(lineParams && prevThresh!=null)lineParams.threshold=prevThresh;}
  }
  async function sharePose(r){return r.action('pose',{position:r.root.position.toArray(),quaternion:r.root.quaternion.toArray(),scale:r.root.scale.x});}
  function endGrip(hand){const g=grabs.get(hand);if(!g)return false;grabs.delete(hand);if(g.robot)perform(async()=>{try{if(g.targetName)await g.robot.action('transform',{name:g.targetName,position:g.target.position.toArray(),wxyz:[g.target.quaternion.w,g.target.quaternion.x,g.target.quaternion.y,g.target.quaternion.z]});else await sharePose(g.robot);}finally{g.robot.setInteracting(false);}});return true;}
  async function pollRooms(){
    if(polling)return;
    polling=true;
    const generation=workspaceGeneration,known=new Map(robots);
    try{
      const data=await api('/api/robotics/live');
      if(generation!==workspaceGeneration||!active)return;
      const descriptors=new Map(data.scenes.map(d=>[d.id,d]));
      for(const [id,r] of known){
        // A response started before import/replacement cannot remove the new scene.
        if(robots.get(id)!==r)continue;
        const d=descriptors.get(id);
        if(isOwner(r)){
          if(!d||d.status==='disconnected'){
            if(!viserTask){r.descriptor.status='disconnected';await showViser({own:true,shareRoom:r.descriptor.share});}
          }else if(r.connectionState==='disconnected'){
            r.close();robots.delete(id);attach(d);
          }
        }else if(!d||!d.share||!isJoined()){
          r.close();robots.delete(id);if(current===id)current=null;
        }else if(r.connectionState==='disconnected'&&d.status!=='disconnected'){
          r.close();robots.delete(id);attach(d);
        }
      }
      if(generation!==workspaceGeneration||!active)return;
      for(const d of data.scenes)if(!robots.has(d.id)&&d.owner!==getUserId()&&d.share&&isJoined()&&d.status!=='disconnected'){
        attach(d);if(!current){current=d.id;panel('viser','Room robot · Viser',viserRows);}
      }
    }catch(e){if(generation===workspaceGeneration)error(e);}finally{polling=false;}
  }
  function tick({presenting,now}){
    active=presenting;if(!presenting)return;
    if(!isJoined())for(const [id,r] of robots)if(!isOwner(r)){r.close();robots.delete(id);if(current===id)current=null;}
    connectPanel('viser',local()?.root,panels.get('viser')?.group);
    connectPanel('emotes',panels.get('viser')?.group,panels.get('emotes')?.group);
    const confirmPanel=panels.get('confirm');if(confirmPanel?.group.visible)placeAtRightController(confirmPanel.group);
    const armed=!!getTeleop().armed;
    // Setup installation is explicit in configuration. Installing on every
    // enable emitted a profile-change event, which immediately disabled teleop.
    if(armed&&!wasArmed)showHud();wasArmed=armed;
    const hud=panels.get('hud');
    if(hud?.group.visible){
      const snap=getTeleop()||{},widgets=getFeed()?.widgets||{};
      if(hudGate.shouldPaint(now,teleopHudSignature(teleopHudChips({
        teleop:snap.teleop||{},widgets:{...widgets,state:snap.recording?'RECORDING':snap.pendingIntent==='starting'?'STARTING':widgets.state},lastAction:snap.lastAction,statusKey:snap.statusKey,
      })))) paint(hud);
    }
    for(const g of grabs.values()){g.source.updateMatrixWorld(true);matrix.copy(g.source.matrixWorld).multiply(g.offset);if(g.target.parent)matrix.premultiply(g.target.parent.matrixWorld.clone().invert());matrix.decompose(g.target.position,g.target.quaternion,v);g.target.updateMatrixWorld(true);}
    if(now-lastPoll>3000){lastPoll=now;if(isJoined()||robots.size)void pollRooms();}
    if(now-lastTick<300)return;lastTick=now;
    const cams=panels.get('cameras');if(cams?.group.visible){const r=local();if(r&&(!isOwner(r))){if(!r.descriptor.cameras_shared){cams.group.visible=false;}else if(!cams.imageBusy){cams.imageBusy=true;Promise.all(['left','right'].map((side,i)=>new Promise(resolve=>{const img=new Image();img.onload=()=>{cams.images[i]=img;resolve();};img.onerror=resolve;img.src=`/api/robotics/live/${r.descriptor.id}/camera/${side}?token=${encodeURIComponent(getToken())}&t=${Date.now()}`;}))).finally(()=>{cams.imageBusy=false;paint(cams);});}}else{const feed=getFeed();cams.images=[feed.videoImage,feed.rightVideoImage];}}
  }
  const onPiAction=e=>{if(!active)return;const a=e.detail?.action;if(a==='emote_picker'){const p=panels.get('emotes');if(p?.group.visible){p.group.visible=false;emoteLoadGeneration++;syncPiUi();}else perform(()=>showDatasets({own:true}));}else if(a==='emote_play'&&emoteItems[emoteIndex])perform(playEmote);else if(a==='emote_next'){emoteIndex=Math.max(0,Math.min(emoteItems.length-1,emoteIndex+(e.detail.direction||1)));const p=panels.get('emotes');if(p){p.page=Math.floor(emoteIndex/11);paint(p);}}else if(a==='robot_started'){
    panel('record-status',e.detail.armed?'Robot started':'Starting robot',[row(e.detail.armed?'Robot follow is active':'Start accepted · waiting for the Pi'),row('Record take · HUD only',()=>startDimosRecord()),row('Data Sets',()=>showDatasets({own:true})),row('Y tap · calibrate + engage · Y hold · Home / reset')]);
    onStatus?.('ok',e.detail.armed?'Robot started':'Robot Start requested…');
  }else if(a==='recording_status'){
    const recording=!!e.detail.recording;
    const pending=!!e.detail.pending;
    panel('record-status',e.detail.discarding?'Discarding recording':pending?'Starting recording':recording?'● Recording robot take':e.detail.discarded?'Recording discarded':'Recording complete',recording
      ?[row(e.detail.discarding?'Discard requested · waiting for the Pi':pending?'Record requested · waiting for the Pi':'Recording is active · move the robot with the controllers'),row('Stop + Save',()=>stopDimosRecord()),row('Discard recording',()=>discardDimosRecord()),row('Data Sets',()=>showDatasets({own:true})),row('After Home, tap Y to recalibrate controllers before motion')]
      :[row(`${e.detail.name||'Robot take'} is stopped`),row('Choose a dataset folder to finish saving'),row('Record another take · use Record take')]);
    onStatus?.('ok',pending?'Robot recording requested…':recording?'Robot take is recording':'Robot recording stopped');
  }else if(a==='home_disarm_started')onStatus?.('ok','Stopping, homing, and disarming robot…');else if(a==='home_disarm_complete')onStatus?.('ok','Robot homed and disarmed');else if(a==='home_disarm_failed')onStatus?.('error','Robot disarmed; Home was not confirmed');else if(a==='emote_saved'){const p=panels.get('confirm');if(p)p.group.visible=false;confirmTarget=null;confirmDetail=null;syncPiUi();onStatus?.('ok','Take saved to Data Sets');panel('record-status','Take saved',[row(`${e.detail.name||'Robot take'} is ready`),row('Open Data Sets to view / play',()=>showDatasets({own:true})),row('Set a starting position in Robotics · Start')]);perform(()=>showDatasets({own:true}));}else if(a==='confirm')perform(()=>showConfirm(e.detail));else if(a==='emote_accept'||a==='emote_discard')perform(()=>a==='emote_accept'?showConfirm(e.detail):decideEmote(false));};
  globalThis.addEventListener('render3d:pi-action',onPiAction);
  return {open:tab=>perform(()=>tab==='controls'?showControls():tab==='printer'?showPrinter():tab==='viser'?showViser():tab==='emotes'?showDatasets({own:true}):showHud()),renameRecording:(item,onSaved)=>text('Rename recording',displayRecordingName(item),name=>{const saved=saveRecordingName(item,name);if(saved){onSaved?.(saved);onStatus?.('ok',`Recording renamed to ${saved}`);const p=panels.get('emotes');if(p)paint(p);}}),ensureViser,pick,select,beginGrip,endGrip,tick,groups:()=>[...panels.values()].filter(p=>p.group.visible).map(p=>p.group),close:()=>{workspaceGeneration++;viserTask=null;emoteLoadGeneration++;confirmTarget=null;confirmDetail=null;emoteTarget=null;for(const p of panels.values())p.group.visible=false;for(const r of robots.values())r.close();robots.clear();for(const l of connectors.values())l.visible=false;if(fence)fence.visible=false;grabs.clear();current=null;wasArmed=false;active=false;syncPiUi();},test:{panel,paint,robots,panels,api,showEmotes,showDatasets,emoteItems:()=>emoteItems}};
}
