import { createVoiceTabOwner } from './voice-tab-owner.js?v=20260916-repair1&astra=20260916-5';
import { createXrAgentStore, createXrAgentLiveAccountStorage, readXrAgentAccountSnapshot, xrAgentRemoteSyncDelayMs, getXrAgentThrowSound, saveXrAgentThrowSound, deleteXrAgentThrowSound, playXrAgentThrowSound } from '../xr/xr-agent-state.js?v=20260915-xragent1-20260915-xragent3&voicesample=20260916-1&vrsave=20260916-1&astra=20260916-5';
import { createXrAgentSettings } from './xr-agent-settings.js?v=20260915-xragent1-20260915-xragent3&voicesample=20260916-1&vrsave=20260916-1&astra=20260916-5&voice-natural=20260918-1&hey-ai-single=20260929-1';
import { compactXrAgentContext } from './xr-agent-context.js?v=20260923-draw-recordings1';
import { createXrAgentRoom } from '../xr/xr-agent-room.js?v=20260915-xragent1-20260915-xragent3&xrtalk=20260916-1&astra=20260916-5';
import { createVoiceSamplePlayer } from './voice-sample.js?voicesample=20260916-1&voice-natural=20260918-1';

/** Owns review/voice UI; generation always enters through an explicit review action. */
export function createXrAgentBridge(opts) {
  const store = createXrAgentStore({storage:createXrAgentLiveAccountStorage(()=>opts.getUserId?.())});
  function immutable(value) { if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(immutable);Object.freeze(value);}return value; }
  let cached=immutable(store.getState()), viewVersion=0, remoteAgents=[], lastLiveState=false;
  let accountId = null, accountReady = false, accountEpoch = 0, soundAccount = '', soundName = '', soundSignature = '', soundResetPromise = Promise.resolve();
  let pullTask = null, startTask = null, startSequence = 0;
  let voiceStartedInVr = false;
  let voice = null, visible = false, level = 0, generating = false, syncing = false, dirty = false, revision = -1, lastPc = '', disposed = false;
  let settingsSignature = '', syncTimer, lastImageAt = 0, lastImage = null, lastSelection = null, lastContextProject = null, lastContextWorkspace = null, applyingRemote = false;
  const remoteStates = new Map();
  const samplePlayer = createVoiceSamplePlayer({
    getToken: opts.getToken,
    getVolume: () => cached.settings.volume,
    getProjectId: opts.getProjectId,
  });
  samplePlayer.subscribe(() => { viewVersion++; });
  const status = (message) => { ui?.setStatus(message); opts.onStatus?.(message); };
  function checkAccount() {
    const next = String(opts.getUserId?.() || '');
    if (next === accountId) return next;
    accountId = next; accountEpoch++; soundAccount = ''; soundName = ''; soundSignature = '';
    soundResetPromise = soundResetPromise.then(() => deleteXrAgentThrowSound()).catch(() => {}); accountReady = false; dirty = false; revision = -1; lastPc = '';
    visible = false; level = 0; voice?.stop(); samplePlayer.stop(); lastSelection = null; lastImage = null; lastImageAt = 0;
    applyingRemote = true; try { store.reset?.(next ? readXrAgentAccountSnapshot(next) : null); } finally { applyingRemote = false; }
    return next;
  }
  const owner=createVoiceTabOwner({getUser:opts.getUserId,isVr:opts.isPresenting,isActive:()=>!!voice?.getState().live,stop:()=>void stop()});
  const state = () => {
    checkAccount();
    const live=!!voice?.getState().live;
    if(live!==lastLiveState){lastLiveState=live;viewVersion++;}
    return { ...cached, visible, level, live, listening:!!voice?.getState().listening, viewVersion, remoteAgents, sampleVoice: samplePlayer.playing() };
  };
  const context = () => {
    const projectId = opts.getProjectId?.() || '';
    if (projectId !== lastContextProject) { lastContextProject = projectId; lastSelection = null; lastImage = null; lastImageAt = 0; }
    const design = opts.getDesignContext?.() || {};
    if(design.workspace!==lastContextWorkspace){lastContextWorkspace=design.workspace;lastSelection=null;}
    const wiring = design.workspace === 'wiring' ? window.Render3DWiringContext : null;
    return compactXrAgentContext({ ...design, spatialBoard: opts.getDrawBoardContext?.() || null, projectId, targetFile:lastSelection?.targetFile||design.targetFile, selected:lastSelection?.name||lastSelection?.label||design.selected, generationModel:opts.getGenerationModel?.(), selection:lastSelection || wiring?.getSelection?.() || null, wiring:wiring?.getContext?.() || null });
  };
  const modelSignature = value => JSON.stringify(value?.generationModel || opts.getGenerationModel?.() || '');
  const syncRoom = () => { if (!disposed) void Promise.resolve().then(() => room.sync()).catch(error => status(error.message || 'Room audio could not update.')); };
  async function image() {
    if (!visible || !voice?.getState().live || !cached.settings.includeVisualContext) return null;
    // Drawing already uses the frame budget. Spatial IDs and anchors provide context without a second render/readback.
    if (opts.getDrawBoardContext?.()?.active) return null;
    if (Date.now()-lastImageAt<5000) return lastImage;
    lastImageAt=Date.now();
    // Leave the controller event/render callback before drawing a separate camera view.
    await new Promise(resolve=>setTimeout(resolve,0));
    try { lastImage=await opts.getSceneImage?.(); } catch { lastImage=null; }
    return lastImage;
  }
  const room = createXrAgentRoom({
    getToken:opts.getToken, getPeers:()=>opts.isPresenting?.() ? (opts.getPeers?.()||[]).filter(peer=>!peer.isSelf && String(peer.user_id||peer.id||peer)!==String(opts.getUserId?.()||'')) : [], sendSignal:(id,signal)=>opts.sendSignal?.(id,signal),
    getState:()=>({...state(),pose:opts.getAgentPose?.()}),getOutputStream:()=>voice?.getOutputStream?.(),
    getMicStream:()=>opts.getMicStream?.(),onRemoteState:(id,value)=>{if(value)remoteStates.set(id,value);else remoteStates.delete(id);remoteAgents=Object.freeze([...remoteStates].map(([id,value])=>Object.freeze({id,...value})));viewVersion++;},
    onRemoteMicStream:stream=>voice?.setRemoteInputStream?.(stream),onError:error=>status(error.message||String(error)),
  });
  async function syncSound(file) {
    const uid=checkAccount();
    const token=await opts.getToken?.();if(!uid||!token)throw new Error('Sign in to share this sound with your headset.');
    const response=await fetch('/api/xr-agent/throw-sound',{method:file?'PUT':'DELETE',headers:{Authorization:`Bearer ${token}`,...(file?{'Content-Type':file.type||'audio/mpeg'}:{})},...(file?{body:file}:{})});
    if(!response.ok)throw new Error('Could not sync the audio clip to your account.');
    if(uid===accountId){soundAccount=uid;soundName=file?.name||'';soundSignature='';}
    status(file?'Audio saved for your PC and headset.':'Audio clip removed.');
  }
  const ui=createXrAgentSettings({store,onStart:()=>start(),onStop:()=>stop(),onGenerate:generate,onOpenPc:openPc,onThrowSound:syncSound,samplePlayer});
  function start(options = {}) {
    if (startTask) return startTask;
    if (!checkAccount()) return Promise.reject(new Error('Sign in to start your voice companion.'));
    if (!voice) return Promise.reject(new Error('Voice agent is still loading. Try again in a moment.'));
    samplePlayer.stop();
    const sequence = ++startSequence, account = accountEpoch;
    const media = voice.primeMedia?.(options); // synchronous user-gesture portion
    void Promise.resolve(media).catch(() => {});
    const task = (async () => {
      try {
        await owner.claim();
        if (!accountReady) await pull();
        await media;
        if (sequence !== startSequence || account !== accountEpoch) return;
        if (!accountReady) throw new Error('Could not load your agent settings. Try again.');
        visible=true;voiceStartedInVr=!!opts.isPresenting?.();viewVersion++;voice.setModel(cached.settings.voiceModel);
        samplePlayer.stop();
        await voice.start({greet:options.greet!==false,text:options.text,stream:options.stream});
        if(sequence!==startSequence || account!==accountEpoch)return;
        if(!voice.getState().live)throw new Error(voice.getState().statusMessage||'Voice could not start. Check your selected model and API key.');
        syncRoom();
      } catch(error) {
        if(sequence===startSequence){visible=false;viewVersion++;voice.stop();status(error.message);}
        throw error;
      }
    })();
    startTask=task;
    void task.finally(()=>{if(startTask===task)startTask=null;}).catch(()=>{});
    return task;
  }
  async function stop({thrown=false}={}) {voiceStartedInVr=false;samplePlayer.stop();opts.onStopListening?.();owner.release();startSequence++;startTask=null;visible=false;viewVersion++;voice?.stop();level=0;opts.dismissAvatar?.();syncRoom();if(thrown&&cached.settings.throwSoundEnabled){try{await playXrAgentThrowSound({volume:cached.settings.volume});}catch{status('Dismissed. The audio clip could not play.');}}}
  function review() {visible=true;if(opts.isPresenting?.())opts.openReview?.();else ui.openChanges();}
  function propose(proposal={}) {
    let change=null;
    if (context().spatialBoard?.active) return { queued: false, generated: false, error: "Draw planning stays on the annotation board. Review the Draw AI Prompt and press Generate." };
    if(proposal.instruction?.trim()) {
      const current=context();
      if(proposal.context?.projectId&&proposal.context.projectId!==current.projectId)throw new Error('The project changed. Discuss this change in the current project.');
      const target=compactXrAgentContext({...current,...proposal.context,projectId:current.projectId,targetIds:proposal.targetIds||proposal.context?.targetIds||[]});
      const normalized=text=>String(text||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
      const identity=ctx=>JSON.stringify([ctx?.projectId,ctx?.targetFile,[...(ctx?.targetIds||[])].sort()]);
      change=cached.changes.find(item=>['pending','running'].includes(item.status)&&normalized(item.prompt)===normalized(proposal.instruction)&&identity(item.context)===identity(target))
        ||store.queueChange({title:proposal.title,prompt:proposal.instruction,context:target});
    }
    if(proposal.requestReview)review();
    return {changeId:change?.id,pending:cached.changes.filter(c=>c.status==='pending').length};
  }
  async function discuss(question, supplied) {
    const current=context();
    if(current.spatialBoard?.active && !cached.settings.includeSelectionMetadata) throw new Error("Enable selection metadata to discuss and annotate the Draw board.");
    if(supplied?.projectId&&supplied.projectId!==current.projectId)throw new Error('The project changed. Ask your question again in the current project.');
    const snapshot=compactXrAgentContext(cached.settings.includeSelectionMetadata?{...current,...supplied,projectId:current.projectId}:{projectId:current.projectId,generationModel:current.generationModel,workspace:current.workspace});
    if(modelSignature(snapshot)!==modelSignature(current))throw new Error('The selected CAD model changed. Ask again using the new model.');
    const response=await opts.discuss(question,snapshot);
    if(disposed||snapshot.projectId!==opts.getProjectId?.()||modelSignature(snapshot)!==modelSignature(context()))throw new Error('Project or CAD model changed while the agent was answering. Ask again in the current project.');
    if (snapshot.spatialBoard?.active) {
      // The selected model may suggest an inert annotation, but never queue CAD edits from planning.
      const boardCommand = response.boardCommand ? { ...response.boardCommand } : null;
      if (boardCommand && ["add_note", "annotate_split"].includes(boardCommand.action) && !boardCommand.regionId && snapshot.spatialBoard.selectedRegionId) boardCommand.regionId = snapshot.spatialBoard.selectedRegionId;
      const boardResult = boardCommand && typeof opts.onDrawBoardCommand === "function"
        ? await opts.onDrawBoardCommand(boardCommand) : null;
      return { answer: response.answer, boardResult, pendingChanges: [], generated: false };
    }
    for(const item of response.proposals||[])propose({instruction:item.prompt,title:item.title,targetIds:item.targetIds,context:snapshot});
    if(response.requestReview)review();
    return {answer:response.answer,pendingChanges:cached.changes.filter(c=>c.status==='pending').map(c=>({id:c.id,title:c.title}))};
  }
  async function generate({changes=[],mode='one'}={}) {
    if(generating)return status('A reviewed change is still generating.');
    checkAccount();
    const ids=new Set(changes.map(c=>c.id));
    const pending=cached.changes.filter(c=>ids.has(c.id)&&['pending','failed'].includes(c.status));
    if(!pending.length)return;
    const batch=mode==='all'?pending:pending.slice(0,1);
    const project=opts.getProjectId?.(), epoch=accountEpoch;
    if(batch.some(c=>!c.context?.projectId||c.context.projectId!==project))return status('Open the project where these changes were discussed before generating them.');
    generating=true;
    let completed=0;
    try {
      for(const change of batch){
        if(epoch!==accountEpoch||String(opts.getUserId?.()||'')!==accountId||project!==opts.getProjectId?.())throw new Error('Project or account changed. Remaining changes have not been started.');
        store.updateChange(change.id,{status:'running'});
        try {
          const result=await opts.generate({changes:[change],mode:'one'});
          if(!result||result.ok===false)throw new Error(result?.error||'Generation did not confirm a result');
          if(epoch!==accountEpoch||String(opts.getUserId?.()||'')!==accountId)return;
          store.updateChange(change.id,{status:'succeeded',result:result.message||'Generated. Inspect the result and choose accept or adjust.'});
          completed++;
        } catch(error){
          if(epoch===accountEpoch)store.updateChange(change.id,{status:'failed',result:error.message});
          throw error;
        }
      }
      voice?.sendText('The reviewed changes finished generating. Ask the user to inspect the result and say what to adjust. Do not claim they have approved the result.',{respond:true});
      review();
    } catch(error){status(`${completed?`${completed} change(s) completed. `:''}${error.message}`);}
    finally{generating=false;}
  }
  async function openPc(){await push();const result=await opts.api('/api/xr-agent/open-pc',{method:'POST'});lastPc=result.id;status('Settings requested on your signed-in PC. Keep Studio open there.');if(!opts.isPresenting?.())ui.open();}
  async function push(){
    if(!checkAccount()||syncing||disposed||!accountReady)return;
    const epoch=accountEpoch;
    syncing=true;dirty=false;
    try{
      const result=await opts.api('/api/xr-agent/state',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(cached)});
      if(epoch===accountEpoch)revision=result.revision;
    }catch{if(epoch===accountEpoch)dirty=true;}finally{syncing=false;}
  }
  function pull(){
    if(pullTask)return pullTask;
    const task=loadRemoteState();pullTask=task;
    void task.finally(()=>{if(pullTask===task)pullTask=null;}).catch(()=>{});
    return task;
  }
  async function loadRemoteState(){
    const uid=checkAccount();
    if(!uid||syncing||(dirty&&accountReady)||disposed)return;
    const epoch=accountEpoch;
    syncing=true;
    try{
      const remote=await opts.api('/api/xr-agent/state');
      if(epoch!==accountEpoch||uid!==String(opts.getUserId?.()||'')){checkAccount();return;}
      if(remote.revision!==revision){applyingRemote=true;try{store.mergeRemote?.(remote);}finally{applyingRemote=false;}revision=remote.revision;}
      accountReady=true;
      const request=remote.pcRequest;
      if(request?.id!==lastPc&&Date.now()-Number(request?.at)<60000){lastPc=request.id;if(!opts.isPresenting?.()&&!/Quest|Oculus|Mobile VR/i.test(navigator.userAgent))ui.open();}
      const name=cached.settings.throwSoundName;
      await soundResetPromise;
      const signature=JSON.stringify([uid,remote.settingsUpdatedAt,remote.soundUpdatedAt,name]);
      if(name&&(soundAccount!==uid||soundName!==name||soundSignature!==signature)){
        const token=await opts.getToken?.();
        const response=await fetch('/api/xr-agent/throw-sound',{headers:{Authorization:`Bearer ${token}`}});
        if(response.ok){const blob=await response.blob();if(epoch===accountEpoch){await saveXrAgentThrowSound(new File([blob],name,{type:blob.type}));soundAccount=uid;soundName=name;soundSignature=signature;}}
      }else if(!name&&soundName){await deleteXrAgentThrowSound();soundName='';}
    }catch{/* Offline preferences remain in this account's active session. */}finally{syncing=false;}
  }
  const unsubscribe=store.subscribe(next=>{cached=immutable(next);viewVersion++;const signature=JSON.stringify(next.settings);const previousSettings=JSON.parse(settingsSignature||'{}');const settingsChanged=signature!==settingsSignature;if(settingsChanged){settingsSignature=signature;if(previousSettings.voiceModel&&previousSettings.voiceModel!==next.settings.voiceModel)voice?.setModel(next.settings.voiceModel);voice?.refreshSettings();syncRoom();}if(!applyingRemote){dirty=true;clearTimeout(syncTimer);const delay=settingsChanged?xrAgentRemoteSyncDelayMs(previousSettings,next.settings):800;if(delay<=0)void push();else syncTimer=setTimeout(push,delay);}});
  function flushRemote(){clearTimeout(syncTimer);if(dirty&&accountReady&&!disposed)void push();}
  const onHidden=()=>{if(typeof document==='undefined'||document.visibilityState==='hidden')flushRemote();};
  try{document.addEventListener('visibilitychange',onHidden);window.addEventListener('pagehide',onHidden);}catch{/* ignore */}
  function select(event){
    const current=context();
    if(event.detail?.projectId&&event.detail.projectId!==current.projectId)return;
    if(['render3d:wiring-selection','wiring-selection'].includes(event.type)&&current.workspace!=='wiring')return;
    lastSelection=event.detail||null;
    if(visible&&voice?.getState().live)void voice.sendContext(context(),{image:true,force:true}).catch(error=>status(error.message));
  }
  window.addEventListener('render3d:xr-selection',select);window.addEventListener('render3d:wiring-selection',select);window.addEventListener('wiring-selection',select);
  const poll=setInterval(()=>{checkAccount();if(dirty&&accountReady)void push();else void pull();},3000);
  const roomPoll=setInterval(()=>{if(voiceStartedInVr&&!opts.isPresenting?.())void stop();else syncRoom();},250);
  const visualPoll=setInterval(()=>{if(visible&&voice?.getState().live&&cached.settings.includeVisualContext)void voice.sendContext(context(),{image:true,force:false}).catch(error=>status(error.message));},5000);
  async function action(id,payload){
    checkAccount();
    if(id==='agent:talk')return start({greet:true,...(payload||{})});
    if(id==='agent:toggle'||id==='agent:order'||id==='agent:bubble')return (visible&&voice?.getState().live)?stop():start({greet:true,...(payload||{})});if(id==='agent:off'||id==='agent:stop-listening'||id==='agent:throw')return stop({thrown:id==='agent:throw'});
    if(id==='agent:setting')return store.updateSettings(payload);if(id==='agent:pc')return openPc();
    if(id==='agent:sample-voice'||id==='voice:sample'){
      // Voice previews and live Hey AI never speak over each other.
      if(voice?.getState?.().live)await stop();
      return samplePlayer.play(payload?.voice || cached.settings.voice);
    }
    if(id==='agent:generate-all')return generate({changes:cached.changes.filter(c=>['pending','failed'].includes(c.status)),mode:'all'});
    if(id.startsWith('agent:generate:'))return generate({changes:[{id:id.slice(15)}],mode:'one'});
    if(id.startsWith('agent:accept:'))return store.updateChange(id.slice(13),{status:'accepted',feedback:'Accepted in VR'});
    if(id.startsWith('agent:reject:')){const change=store.updateChange(id.slice(13),{status:'rejected',feedback:'Requested adjustment in VR'});voice?.sendText(`The user wants to adjust this generated change: ${change.prompt}. Ask what should be different, then propose a correction for review.`,{respond:true});status('Tell the agent what to adjust, or edit the correction in settings on your PC.');}
    if(id==='agent:correction'){
      const original=cached.changes.find(change=>change.id===payload?.id);
      const correction=String(payload?.text||'').trim().slice(0,6000);
      if(!original||!correction)return;
      if(original.status==='succeeded')store.updateChange(original.id,{status:'rejected',feedback:correction,correction});
      else store.updateChange(original.id,{feedback:correction,correction});
      const next=store.queueChange({title:`Adjust: ${original.title}`,parentId:original.id,context:original.context,prompt:`Adjust the current result of this previous edit: ${original.prompt}\nUser correction: ${correction}\nPreserve the working portions of the current result and unrelated objects.`});
      review();
      return next;
    }
    if(id==='agent:settings')ui.open();
    if(id.startsWith('agent-remote:')){const [,command,peer]=id.split(':');if(command==='invoke')return room.invoke(peer);if(command==='mute')return room.mutePeer(peer,!remoteStates.get(peer)?.muted);if(command==='down'||command==='up')return room.setRemoteVolume(peer,Math.max(0,Math.min(1,(remoteStates.get(peer)?.volume??.8)+(command==='up'?.1:-.1))));}
  }
  let drawContextTimer;
  function refreshDrawContext() {
    clearTimeout(drawContextTimer);
    if (disposed || !visible || !voice?.getState().live) return;
    drawContextTimer = setTimeout(() => { if (!disposed && visible && voice?.getState().live) void voice.sendContext(context(), { image: false, force: true }).catch(error => status(error.message)); }, 120);
  }
  const bridge={store,ui,room,refreshDrawContext,getState:state,getContext:context,action,start,stop,generate,openSettings:()=>ui.open(),openReview:review,
    bindVoice(value){voice=value;checkAccount();settingsSignature=JSON.stringify(cached.settings);voice.refreshSettings();void pull();},
    voiceOptions:{onStudioCommand: opts.onStudioCommand ? (name,args)=>checkAccount()&&accountReady?opts.onStudioCommand(name,args):Promise.resolve({ok:false,error:'Sign in and wait for your Astra settings to load.'}) : undefined,onRobotCommand: opts.onRobotCommand ? (name,args)=>checkAccount()&&accountReady?opts.onRobotCommand(name,args):Promise.resolve({ok:false,error:'Sign in and wait for your Astra settings to load.'}) : undefined,onDrawBoardCommand: opts.onDrawBoardCommand,onSlicerPlateCommand: opts.onSlicerPlateCommand,onControlDebuggerFeed: opts.onControlDebuggerFeed, getSceneContext:context,getSceneImage:image,getAgentSettings:()=>cached.settings,askSelectedModel:discuss,onTranscript:item=>store.addTranscript(item),onAudioLevel:value=>{level=value;},onChangeProposal:propose},
    dispose(){disposed=true;samplePlayer.stop();owner.dispose();clearTimeout(drawContextTimer);clearInterval(poll);clearInterval(roomPoll);clearInterval(visualPoll);clearTimeout(syncTimer);try{document.removeEventListener('visibilitychange',onHidden);window.removeEventListener('pagehide',onHidden);}catch{/* ignore */}unsubscribe();room.dispose();voice?.stop();ui.dispose();window.removeEventListener('render3d:xr-selection',select);window.removeEventListener('render3d:wiring-selection',select);window.removeEventListener('wiring-selection',select);},
  };
  return bridge;
}
