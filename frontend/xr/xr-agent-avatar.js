import { cycleRealtimeVoice, normalizeRealtimeVoice } from "../components/realtime-voices.js?voicesample=20260916-1";

/**
 * Inner analog-stick side of the pointing Touch — the face the other hand
 * can see and click. Never +X (outer) or -Y (down the handle / aim laser).
 */
export function agentControllerSideLocal({ pointingIsRight = true } = {}) {
  const right = pointingIsRight !== false;
  return {
    x: right ? -0.018 : 0.018,
    y: 0.038,
    z: 0.004,
    rx: -0.18,
    ry: right ? -Math.PI / 2 : Math.PI / 2,
    rz: 0,
    aiY: 0.014,
    micY: -0.014,
  };
}

/** Headset-native agent bubble, settings, review queue and contact-only dismissal. */
export function createXrAgentAvatar(THREE, { scene, camera, getState, onAction } = {}) {
  const root = new THREE.Group(); root.name = 'xrAgent'; root.userData.xrUi = true;
  const bubble = new THREE.Group(); bubble.name = 'xrAgentBubble'; root.add(bubble);
  const mat = (color) => new THREE.MeshBasicMaterial({ color, transparent:true, depthTest:false, depthWrite:false });
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.062, 2), mat(0xc4efff)); bubble.add(orb);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.07), mat(0x82c8ff)); bubble.add(gem);
  const robot = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(.105,.08,.07),mat(0xa5dcff)); robot.add(head);
  for(const x of [-.025,.025]) {const eye=new THREE.Mesh(new THREE.SphereGeometry(.009,8,6),mat(0x123349));eye.position.set(x,.012,.038);robot.add(eye);} bubble.add(robot);
  const spikes=[];
  for(let i=0;i<24;i++){ const bar=new THREE.Mesh(new THREE.BoxGeometry(.003,.012,.003),mat(0x4ba8e8)); const a=i/24*Math.PI*2;bar.position.set(Math.sin(a)*.082,Math.cos(a)*.082,0);bar.rotation.z=-a;spikes.push(bar);bubble.add(bar); }
  const buttons=[];
  function chip(id,label,x,y,parent=bubble){
    const c=document.createElement('canvas');c.width=c.height=96;const ctx=c.getContext('2d');ctx.fillStyle='#17344c';ctx.beginPath();ctx.arc(48,48,45,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.font='bold 42px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,48,48);
    const mesh=new THREE.Mesh(new THREE.CircleGeometry(.021,24),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false}));mesh.position.set(x,y,.02);mesh.userData.xrTool=id;mesh.userData.xrUi=true;parent.add(mesh);buttons.push(mesh);return mesh;
  }
  const stopListening=chip('agent:stop-listening','■',0,-.115); stopListening.name='xrAgentStopListening';
  const gear=chip('agent:settings','⚙',.12,.025), more=chip('agent:more','⋯',.12,-.027);
  function roundRect(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();}
  function paintSide(mesh,kind,on){
    const sig=kind+(on?'1':'0');if(mesh.userData.paintSig===sig)return;mesh.userData.paintSig=sig;
    const c=mesh.userData.canvas,ctx=c.getContext('2d');
    ctx.clearRect(0,0,128,128);
    ctx.beginPath();ctx.arc(64,64,60,0,Math.PI*2);
    ctx.fillStyle=kind==='mic'?(on?'#22c55e':'#ef4444'):(on?'#7dd3fc':'#38bdf8');ctx.fill();
    ctx.lineWidth=6;ctx.strokeStyle='rgba(255,255,255,0.92)';ctx.stroke();
    if(kind==='ai'){
      ctx.fillStyle='#e8f7ff';roundRect(ctx,36,40,56,46,12);ctx.fill();
      ctx.fillStyle='#0b1c2c';ctx.beginPath();ctx.arc(54,58,6,0,Math.PI*2);ctx.arc(74,58,6,0,Math.PI*2);ctx.fill();
    }else{
      ctx.fillStyle='#fff';roundRect(ctx,54,30,20,38,10);ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.lineCap='round';ctx.beginPath();ctx.arc(64,62,22,0,Math.PI);ctx.stroke();
      ctx.beginPath();ctx.moveTo(64,84);ctx.lineTo(64,96);ctx.moveTo(52,96);ctx.lineTo(76,96);ctx.stroke();
      if(!on){ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(38,96);ctx.lineTo(90,32);ctx.stroke();}
    }
    mesh.material.map.needsUpdate=true;
  }
  function sideChip(id,kind,y){
    const c=document.createElement('canvas');c.width=c.height=128;
    const map=new THREE.CanvasTexture(c);
    const mesh=new THREE.Mesh(new THREE.CircleGeometry(.0135,24),new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false}));
    mesh.position.set(0,y,.006);mesh.userData.xrTool=id;mesh.userData.xrUi=true;mesh.userData.xrLabel=kind==='ai'?'AI':'Mic';
    mesh.userData.canvas=c;mesh.userData.kind=kind;wrist.add(mesh);buttons.push(mesh);paintSide(mesh,kind,kind==='ai');return mesh;
  }
  const wrist=new THREE.Group();wrist.name='xrAgentWrist';wrist.userData.xrUi=true;scene.add(wrist);
  // This shares the desktop scene and must remain hidden until XR supplies a grip.
  wrist.visible=false;
  const off0=agentControllerSideLocal({pointingIsRight:true});
  const aiBtn=sideChip('agent:toggle','ai',off0.aiY); aiBtn.name='xrAgentAiButton';
  const micBtn=sideChip('agent:mic','mic',off0.micY); micBtn.name='xrAgentMicButton';
  const sideButtons=[aiBtn,micBtn];
  const panel=new THREE.Group();panel.name='xrAgentPanel';panel.userData.xrUi=true;root.add(panel);
  const canvas=document.createElement('canvas');canvas.width=900;canvas.height=860;const ctx=canvas.getContext('2d');const texture=new THREE.CanvasTexture(canvas);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(.63,.602),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false}));panel.add(face);
  let panelMode='', page=0, hovered='', hoverAt=-Infinity, signature='', placed=false, drag=null, visible=false, query='', editing='', editValue='';let rects=[];
  root.traverse(o=>{o.frustumCulled=false;o.renderOrder=95000;});wrist.traverse(o=>{o.frustumCulled=false;o.renderOrder=95000;});root.renderOrder=95000;wrist.renderOrder=95000; scene.add(root);root.visible=false;panel.visible=false;
  function place(){camera.updateMatrixWorld(true);const p=camera.getWorldPosition(new THREE.Vector3()),q=camera.getWorldQuaternion(new THREE.Quaternion());root.position.copy(p).add(new THREE.Vector3(.32,-.1,-.7).applyQuaternion(q));root.quaternion.copy(q);placed=true;}
  function commitTextEdit(){if(!editing||editing==='search'||editing.startsWith('correction:'))return;onAction?.('agent:setting',{[editing]:editValue});}
  function open(mode){commitTextEdit();if(!placed)place(); panelMode=mode;page=0;query='';editing='';panel.visible=true;signature='';}
  function rows(state){ const s=state.settings||{};
    if(panelMode==='more')return [{id:'agent:settings',text:'Settings'},{id:'agent:review',text:'Review discussed changes'},{id:'agent:off',text:'Turn off and dismiss'}];
    if(panelMode==='changes')return (state.changes||[]).map(c=>({id:'change:'+c.id,text:`${c.status} · ${c.title||c.prompt}`,change:c}));
    if(panelMode==='history')return (state.history||[]).slice().reverse().map(c=>({id:'',text:`${c.role||c.type||'Agent'}: ${c.text||c.prompt||''}`}));
    return [{id:'agent:stop-listening',text:'Stop listening and speaking'},{id:'showToRoom',text:`Room can see agent: ${s.showToRoom?'On':'Off'}`},{id:'name',text:`Name: ${s.name||'Astra'}`},{id:'wakeName',text:`Wake phrase: Hey ${s.wakeName||s.name||'Astra'}`},{id:'volume',text:`Volume: ${Math.round((s.volume??.8)*100)}%`},{id:'avatar',text:`Appearance: ${s.avatar||'orb'}`},{id:'shareWithRoom',text:`Room can hear agent: ${s.shareWithRoom?'On':'Off'}`},{id:'allowOtherUsersTrigger',text:`Room can call agent: ${s.allowOtherUsersTrigger?'On':'Off'}`},{id:'includeVisualContext',text:`Scene images: ${s.includeVisualContext?'On':'Off'}`},{id:'includeSelectionMetadata',text:`Pointed part and source links: ${s.includeSelectionMetadata?'On':'Off'}`},{id:'voiceModel',text:`Voice model: ${s.voiceModel||'gpt-realtime'}`},{id:'voice',text:`Realtime voice: ${s.voice||'marin'}`},{id:'agent:history',text:'Prompt and conversation history'},{id:'prompt',text:`Prompt configuration: ${s.prompt||'Default'}`},{id:'agent:pc',text:'Open full settings on my PC'},{id:'throwSoundEnabled',text:`Throw sound: ${s.throwSoundEnabled?'On':'Off'} · upload on PC`}];
  }
  function paint(state){
    const key=JSON.stringify([panelMode,page,query,editing,editValue,hovered,state.sampleVoice,state.viewVersion ?? [state.settings,state.changes,state.history?.slice(-12)]]);if(key===signature)return;signature=key;rects=[];ctx.clearRect(0,0,900,860);ctx.fillStyle='#102235';ctx.fillRect(0,0,900,860);
    const text=(s,x,y,size=25,color='#e4f4ff')=>{ctx.fillStyle=color;ctx.font=`${size}px sans-serif`;ctx.textAlign='left';ctx.fillText(String(s).slice(0,70),x,y);};
    function button(id,label,x,y,w,h=52){ctx.fillStyle=id===hovered?'#267499':'#21445f';ctx.fillRect(x,y,w,h);text(label,x+12,y+34,22);rects.push({id,x,y,w,h});}
    text(panelMode==='changes'?'Review changes':panelMode==='history'?'Prompt history':`${state.settings?.name||'Astra'} settings`,28,45,30);button('agent:close','×',820,12,52);
    button('search',query?`Search: ${query}`:'Search settings or history',28,70,700);button('clear-search','Clear',740,70,130);
    if(editing){text(editing.startsWith('correction:') ? `Adjustment: ${editValue}` : `Edit ${editing}: ${editValue}`,28,180);const chars='1234567890qwertyuiopasdfghjklzxcvbnm';for(let i=0;i<chars.length;i++){const col=i%10,row=Math.floor(i/10);button('key:'+chars[i],chars[i],28+col*84,215+row*62,74);}button('key:space','Space',28,490,240);button('key:back','⌫',285,490,170);button('key:done','Save',480,490,170);button('key:cancel','Cancel',675,490,175);if(editing.startsWith('correction:'))text('Describe what needs to change. Save sends your correction to the agent.',28,595,20);texture.needsUpdate=true;return;}
    const list=rows(state).filter(r=>!query||r.text.toLowerCase().includes(query.toLowerCase()));const per=6;page=Math.min(page,Math.max(0,Math.ceil(list.length/per)-1));let y=146;
    for(const r of list.slice(page*per,(page+1)*per)){
      text(r.text,28,y+28,22);if(r.change){const c=r.change;if(c.status==='pending'||c.status==='failed'){button('agent:generate:'+c.id,'Generate',680,y,180);}else if(c.status==='succeeded'){button('agent:accept:'+c.id,'✓',675,y,55);button('agent:reject:'+c.id,'Adjust',740,y,120);}}
      else if(r.id==='volume'){button('volume:-','−',695,y,72);button('volume:+','+',782,y,72);}else if(r.id==='voice'){button('voice:prev','‹',560,y,48);button('voice:sample',state.sampleVoice===normalizeRealtimeVoice(state.settings?.voice)?'Stop':'Listen',616,y,118);button('voice:next','›',742,y,118);}else if(r.id){button(r.id,r.id==='agent:stop-listening'?'Stop':r.id.startsWith('agent:')?'Open':'Change',730,y,130);}y+=90;
    }
    button('page:prev','‹',28,710,70);text(`${page+1}/${Math.max(1,Math.ceil(list.length/per))}`,112,746);button('page:next','›',210,710,70);
    if(panelMode==='changes'){button('agent:generate-all','Generate all pending',310,710,340);}else{button('agent:review','Review changes',310,710,250);button('agent:history','History',580,710,150);}
    button('agent:stop-listening',state.live?'■ Stop listening':'Microphone is off',28,782,360);
    ctx.fillStyle='#facc15';ctx.fillRect(400,776,250,68);ctx.strokeStyle='#052e16';ctx.lineWidth=4;ctx.strokeRect(400,776,250,68);
    ctx.fillStyle='#052e16';ctx.font='800 24px sans-serif';ctx.textAlign='left';ctx.fillText('Round Table',414,818);
    rects.push({id:'agent:round-table',x:400,y:776,w:250,h:68});
    text(state.listening?'Listening…':'Not listening',660,820,20,'#97b6ce');texture.needsUpdate=true;
  }
  function action(id){const state=getState?.()||{},s=state.settings||{};
    if(id==='agent:round-table'){onAction?.('agent:round-table');return true;}
    if(id==='agent:settings'||id==='agent:more'||id==='agent:review'||id==='agent:history'){open(id==='agent:review'?'changes':id.slice(6));return true;}
    if(id==='agent:close'){commitTextEdit();editing='';panel.visible=false;panelMode='';return true;}
    if(id==='page:prev'||id==='page:next'){page=Math.max(0,page+(id.endsWith('next')?1:-1));signature='';return true;}
    if(id==='clear-search'){query='';signature='';return true;}
    if(id==='search'||['name','wakeName','prompt'].includes(id)){editing=id;editValue=id==='search'?query:String(s[id]||'');signature='';return true;}
    if(id.startsWith('agent:reject:')){editing='correction:'+id.slice('agent:reject:'.length);editValue='';panel.visible=true;panelMode='changes';signature='';return true;}
    if(id.startsWith('key:')){const k=id.slice(4);if(k==='cancel'){editing='';}else if(k==='done'){if(!editing)return false;if(editing==='search')query=editValue;else if(editing.startsWith('correction:')){if(!editValue.trim())return true;onAction?.('agent:correction',{id:editing.slice('correction:'.length),text:editValue.trim()});}else onAction?.('agent:setting',{[editing]:editValue});editing='';}else if(k==='back')editValue=editValue.slice(0,-1);else editValue=(editValue+(k==='space'?' ':k)).slice(0,1000);signature='';texture.needsUpdate=true;return true;}
    if(id.startsWith('volume:')){onAction?.('agent:setting',{volume:Math.min(1,Math.max(0,(s.volume??.8)+(id.endsWith('+')?.1:-.1)))});return true;}
    if(id==='avatar'){const a=['orb','robot','gem'];onAction?.('agent:setting',{avatar:a[(a.indexOf(s.avatar)+1)%3]});return true;}
    if(['showToRoom','shareWithRoom','allowOtherUsersTrigger','includeVisualContext','includeSelectionMetadata','throwSoundEnabled'].includes(id)){onAction?.('agent:setting',{[id]:!s[id]});return true;}
    if(id==='voiceModel'){const a=['gpt-realtime-mini','gpt-realtime','gpt-6-astra'];onAction?.('agent:setting',{voiceModel:a[(a.indexOf(s.voiceModel)+1)%3]});return true;}
    if(id==='voice'||id==='voice:next'){onAction?.('agent:setting',{voice:cycleRealtimeVoice(s.voice,1)});return true;}
    if(id==='voice:prev'){onAction?.('agent:setting',{voice:cycleRealtimeVoice(s.voice,-1)});return true;}
    if(id==='voice:sample'){onAction?.('agent:sample-voice',{voice:normalizeRealtimeVoice(s.voice)});return true;}
    if(id.startsWith('agent:')){onAction?.(id);return true;}return false;
  }
  function pick(raycaster){if(!root.visible&&!wrist.visible)return null;root.updateMatrixWorld(true);wrist.updateMatrixWorld(true);let best=null;
    const meshes=[...(visible?[orb,gem,head,...buttons.filter(x=>!sideButtons.includes(x))]:[]),...(wrist.visible?sideButtons:[]),...(panel.visible?[face]:[])];
    const hits=raycaster.intersectObjects(meshes,false).filter(h=>{for(let n=h.object;n;n=n.parent)if(!n.visible)return false;return h.distance>.003;});
    for(const hit of hits){let id=hit.object.userData.xrTool;if(hit.object===face&&hit.uv){const x=hit.uv.x*900,y=(1-hit.uv.y)*860;id=rects.find(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)?.id||'agent:panel';}if(hit.object===orb||hit.object===gem||hit.object===head)id='agent:toggle';if(!id)id='agent:toggle';best={kind:'tool',tool:'agent-ui:'+id,distance:hit.distance,point:hit.point,source:'agent'};break;}
    if(best){hovered=best.tool.slice(9);hoverAt=performance.now();}return best;
  }
  function setMicLive(on){paintSide(micBtn,'mic',!!on);}
  let lastPresenting=false;
  function update({presenting,rightGrip,headCamera=camera,level=0,micLive}={}){
    if(lastPresenting&&!presenting)commitTextEdit();
    lastPresenting=!!presenting;
    camera=headCamera;const state=getState?.()||{};visible=!!state.visible;
    // Settings/history belong to the user's open panel, not the microphone's
    // lifecycle. A failed or inactive voice session must not hide that panel.
    root.visible=!!presenting&&(visible||panel.visible);bubble.visible=visible;
    wrist.visible=!!presenting&&!!rightGrip;if(rightGrip&&wrist.parent!==rightGrip)rightGrip.add(wrist);
    const off=agentControllerSideLocal({pointingIsRight:true});
    wrist.position.set(off.x,off.y,off.z);wrist.rotation.set(off.rx,off.ry,off.rz);
    paintSide(aiBtn,'ai',!!(visible||state.live));if(micLive!==undefined)setMicLive(micLive);
    if(root.visible&&!placed)place();const a=state.settings?.avatar||'orb';orb.visible=a==='orb';gem.visible=a==='gem';robot.visible=a==='robot';
    const t=performance.now()/1000;stopListening.visible=!!state.live;const power=Math.min(1,Math.max(0,level));const listening=state.listening ? .12+.08*Math.sin(t*3) : 0;spikes.forEach((bar,i)=>bar.scale.y=1+listening+power*(1.5+Math.sin(t*13+i)*.7));orb.scale.setScalar(1+listening*.12+power*.12);gem.rotation.y=t*.25;
    gear.visible=more.visible=performance.now()-hoverAt<1800||panel.visible;if(!panel.userData.xrManagedWindow)panel.position.set(-.36,-.05,-.10);if(panel.visible)paint(state);
    if(drag){const p=drag.host; p.updateMatrixWorld(true);root.matrix.copy(p.matrixWorld).multiply(drag.offset);if(root.parent){root.parent.updateWorldMatrix(true,false);root.matrix.premultiply(new THREE.Matrix4().copy(root.parent.matrixWorld).invert());}root.matrix.decompose(root.position,root.quaternion,root.scale);const now=performance.now();drag.samples.push({at:now,p:root.position.clone()});drag.samples=drag.samples.filter(x=>now-x.at<130);}
  }
  function beginGrip(hand,host){if(!root.visible||!bubble.visible||drag||!host)return false;const p=host.getWorldPosition(new THREE.Vector3());if(p.distanceTo(root.getWorldPosition(new THREE.Vector3()))>.12)return false;host.updateMatrixWorld(true);root.updateMatrixWorld(true);drag={hand,host,offset:new THREE.Matrix4().copy(host.matrixWorld).invert().multiply(root.matrixWorld),samples:[]};return true;}
  function endGrip(hand){if(!drag||drag.hand!==hand)return false;const list=drag.samples;const first=list[0],last=list.at(-1);const speed=first&&last&&last.at>first.at?first.p.distanceTo(last.p)/((last.at-first.at)/1000):0;drag=null;if(speed>1.25){commitTextEdit();onAction?.('agent:throw');panel.visible=false;placed=false;}return true;}
  function spawn() {
    place();
    root.visible = true;
    bubble.visible = true;
    placed = true;
    return { ok: true, spawned: true, pose: { position: root.position.toArray(), quaternion: root.quaternion.toArray() } };
  }
  return {root,wrist,buttons,getPanel:()=>panel,update,pick,action,setMicLive,beginGrip,endGrip,spawn,openReview:()=>open('changes'),dismiss:()=>{commitTextEdit();panel.visible=false;placed=false;root.visible=false;},getPose:()=>({position:root.position.toArray(),quaternion:root.quaternion.toArray()}),dispose(){root.removeFromParent();wrist.removeFromParent();for(const tree of [root,wrist])tree.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});}};
}
