import { boardSampleDistanceSquared, nearestBoardTriangleEdge, displayBoardEditorText } from './xr-ai-draw-geometry.js?v=20260915-spatial-draw4';
import { createXrAiBoardStore } from './xr-ai-board-state.js?v=20260923-draw-recordings1';
import { createXrAiBoardPersistence } from './xr-ai-board-persistence.js?v=20260915-spatial-draw4';
import { boardMentionItems, organizeBoardPrompt, createBoardSnapshot } from './xr-ai-board-graph.js?v=20260923-draw-recordings1';
import { normalizeDrawAssets, prepareDrawModel } from './xr-ai-draw-assets.js?v=20260915-spatial-draw4';
import { createXrAiDrawView, DRAW_VIEW_LIMITS } from './xr-ai-draw-view.js?v=20260923-draw-recordings1';
import { createXrDrawVoice } from './xr-draw-voice.js?v=20260923-draw-recordings1';
import { keyboardLayout, applyKeyboardKey } from './xr-ai-compose.js?v=20260908-xr-ent4';

/** Thin coordination layer: input -> commands -> scene, context, persistence. */
export function createXrAiDrawWorkspace(opts) {
  const { THREE, scene, camera, getProjectId = () => '', getAssets = () => [], getModel = () => null,
    getPromptDraft = () => '', onSetPromptDraft = () => {}, onOrganize, onGenerate, onTalk,
    onContextChange, api, getToken, blocked = () => false, getBudget } = opts;
  const board = createXrAiBoardStore({ projectId: getProjectId() });
  let active = false, mode = 'move', page = 'tools', message = 'Move is ready. Add project references to begin.', pageIndex = 0;
  let editor = null, pickerReturn = null, linkStart = '', stroke = null, grip = null, pointed = null, lastHover = 0, lastSample = 0, generating = false, organizing = false, ready = false;
  let assets = [], currentProject = '', opening = null, disposed = false, memoAudio = null, memoUrl = '', memoId = '', memoAbort = null;
  const pressed = [false, false], preparedIds = new Map(), stagedPrepared = new Map();
  let reattachId = "", notesTarget = "";
  let canvasDrag = null;
  const freshNodeId = () => `node-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  function status(text) { message = String(text || ''); opts.onStatus?.(message); paint(); }
  const view = createXrAiDrawView({ THREE, scene, camera, gridGeometry: opts.gridGeometry, getToken, getPreviewBudget: getBudget, onStatus: status });
  const persistence = typeof api === 'function' ? createXrAiBoardPersistence({ board, api, getProjectId,
    onStatus: value => { if (value.message) status(value.message); } }) : null;
  function record(id = board.getState().selectedIds[0]) { const s = board.getState(); for (const table of ['nodes', 'regions', 'notes', 'links', 'drawings']) if (s[table][id]) return { table, item: s[table][id] }; return null; }
  const voice = createXrDrawVoice({ getBoard: () => active && ready && !blocked() && currentProject === String(getProjectId() || '') ? board : null, getProjectId,
    getPointedFace: () => pointed, onOrganizePrompt: () => organize() });
  const button = (id, label, selected = false) => ({ id, label, active: selected });
  function paint() {
    if (disposed) return;
    const s = board.getState(), selected = record(); let title = 'Draw · AI Prompt', lines = [], buttons = [], keyboard = null;
    if (editor) {
      title = editor.title; lines = displayBoardEditorText(editor.text,s).match(/.{1,66}/gs)?.slice(-8) || ['Type or dictate with the live agent.'];
      keyboard = keyboardLayout({ width: 1024, height: 410, shift: editor.shift });
      buttons = [button('mentions', '@ References'), button('edit.save', 'Save text'), button('cancel', 'Cancel edit')];
    } else if (page === 'assets' || page === 'mentions') {
      const items = page === 'assets' ? assets : boardMentionItems(s); title = page === 'assets' ? 'Project references' : '@ Board references';
      const start = pageIndex * 9;
      lines = [`${items.length} items · page ${pageIndex + 1}/${Math.max(1, Math.ceil(items.length / 9))}`, 'Models use lightweight copies. Source files stay intact.'];
      buttons = items.slice(start, start + 9).map(item => button(`${page === 'assets' ? 'asset' : 'mention'}:${item.id}`, `${item.kind === 'model' ? '3D' : item.kind === 'memo' ? 'Audio' : item.kind === 'image' ? 'Image' : '@'} · ${item.name}`));
      buttons.push(button('previous', 'Previous'), button('next', 'Next'), button('back', 'Back'));
    } else if (page === 'ink') {
      title = 'Draw & select'; lines = ['Trigger: draw / select · grip: move selected reference', 'Surface ink follows the model. Cancel keeps completed work.'];
      buttons = ['pen','line','arrow','lasso','label','link','eraser','face','edge','move'].map(tool => button(`tool:${tool}`, tool[0].toUpperCase()+tool.slice(1), mode === tool)); buttons.push(button('back','Back'), button('cancel','Cancel tool'));
    } else if (page === 'selection') {
      title = 'Selected reference'; const item = selected?.item;
      lines = [item?.name || 'Select an item on the board.', item?.source?.filename || item?.caption || item?.text?.slice(0, 74) || '', item?.source?.units ? `Original units: ${item.source.units} · presentation size is independent` : 'References retain their original project files.'];
      buttons = item ? [button('rename','Rename'),button('remove','Remove from board')] : [];
      if (selected?.table === 'nodes') buttons.push(button('duplicate','Duplicate'),button('smaller','Smaller'),button('larger','Larger'),button('rotate','Rotate 15°'));
      if (item?.kind === 'image') buttons.push(button('final','Final look',item.finalLook));
      if (item?.anchor?.needsReattach) buttons.push(button('reattach','Reattach surface'));
      if (['links','notes'].includes(selected?.table)||item?.kind==='memo') buttons.push(button('caption',item?.kind==='memo'?'Edit transcript':'Edit text'));
      if (item?.kind==='memo') buttons.push(button('play',memoAudio&&!memoAudio.paused?'Stop memo':'Play memo'));
      buttons.push(button('notes','Spatial notes'),button('back','Back'));
    } else if (page === 'notes') {
      title = 'Spatial notes'; const target = record(notesTarget)?.item || selected?.item; const notes = targetNotes(target);
      lines = [target?.name || 'Select a region or reference.', `${notes.length} notes · ${target?.anchor?.needsReattach ? 'Surface needs reattachment' : 'Notes are planning instructions'}`];
      buttons = notes.slice(pageIndex*6,pageIndex*6+6).map(n=>button(`note:${n.id}`, n.text.slice(0,24)||'Empty note'));
      buttons.push(button('note.new','Add note'),button('note.expand','Expand'),button('note.collapse','Collapse'),button('previous','Previous notes'),button('next','Next notes'),button('back','Back'));
    } else {
      lines = [selected ? `${selected.item.name || selected.item.caption || 'Selected'} · ${selected.table.slice(0,-1)}` : 'Select a model, region, image, memo, or dotted link.', `${Object.keys(s.nodes).length}/${DRAW_VIEW_LIMITS.nodes} references · ${Object.keys(s.notes).length} notes · ${mode}`, message.slice(0, 74), message.slice(74, 148)];
      if (reattachId) lines.push('Choose a new surface for this region. Its notes and links stay attached.');
      if (linkStart) lines.push(`Link from ${record(linkStart)?.item.name || linkStart}: choose endpoint B.`);
      buttons = [button('canvas',s.canvas?.enabled?'3D space':'2D Canvas',s.canvas?.enabled),button('save','Save canvas'),button('text','Text box'),button('image','Generate image'),button('assets','Add references'),button('ink','Draw & select'),button('talk','Live voice'),button('notes','Region notes'),button('prompt','Edit prompt'),button('mentions','@ References'),
        button('organize',organizing?'Organizing…':'Smart Description'),button('review','Review prompt'),button('generate',generating?'Submitting…':'Generate'),
        button('selection',selected?.item.anchor?.needsReattach?'Reattach / details':'Selection tools'),button('undo','Undo'),button('redo','Redo'),button('cancel','Move / cancel'),button('close','Close board')];
    }
    if(page!=='tools'&&!editor&&message)lines.push(message.slice(0,74),message.slice(74,148));
    if (!buttons.some(item=>item.id==='close')) buttons.push(button('close','Close board'));
    view.paint({ title, subtitle: editor ? 'Edits save to the same board. @ references retain their IDs.' : !ready ? (opening?'Loading project board…':'Draw board unavailable — see status below.') : 'Plan → annotate → connect → organize → review → Generate', lines, buttons, keyboard });
  }
  function dispatch(command) { const result = board.dispatch(command); if (result.error) status(result.error); return result; }
  function targetNotes(target = (page==='notes'?record(notesTarget)?.item:null) || record()?.item) {
    if (!target) return [];
    const parent = board.getState().notes[target.id];
    const targetId = parent?.regionId || parent?.nodeId || target.id;
    return Object.values(board.getState().notes).filter(note => note.id === targetId || note.regionId === targetId || note.nodeId === targetId);
  }
  function sourceKey(node) { return `${node.source.projectId}:${node.source.filename}:${node.source.revision}`; }
  function prepareNode(node) {
    if (!active || !ready || node.kind !== 'model' || !view.getObject(node.id) || (preparedIds.get(node.id) === sourceKey(node) && view.objects.get(node.id)?.model)) return true;
    // Never retain an old surface under a new source revision.
    if (preparedIds.has(node.id)) { view.detachModel?.(node.id); preparedIds.delete(node.id); }
    let prepared = stagedPrepared.get(node.id); stagedPrepared.delete(node.id);
    const source = prepared ? null : getModel(node.source.filename);
    if (!prepared && !source) { status('Open this model in Studio first to prepare its lightweight VR preview.'); return false; }
    try {
      prepared ||= prepareDrawModel(THREE, source);
      if (!view.attachModel(node.id, prepared)) return false;
      preparedIds.set(node.id, sourceKey(node)); return true;
    } catch (error) { status(error.message); return false; }
  }
  function reconcileSources() {
    const current = new Map(assets.map(asset => [`${asset.source.projectId}:${asset.source.filename}`, asset]));
    const changes = [];
    for (const node of Object.values(board.getState().nodes)) {
      const asset = current.get(`${node.source.projectId}:${node.source.filename}`);
      if (node.kind !== 'model' || !asset || asset.source.revision === node.source.revision) continue;
      view.detachModel?.(node.id); preparedIds.delete(node.id);
      changes.push({ type: 'node.update', id: node.id, patch: { source: { ...node.source, ...asset.source } } });
    }
    if (changes.length) { dispatch({ type: 'batch', commands: changes }); status('Model revision changed. Existing surface regions need explicit reattachment.'); }
  }
  const unsubscribe = board.subscribe((s,event) => {
    const priorVisible = new Set(view.objects.keys());
    view.sync(s); for (const id of preparedIds.keys()) if (!s.nodes[id]||!view.getObject(id)) preparedIds.delete(id);
    // Rebuild changed source instances or newly visible rows after undo; transforms reuse geometry.
    const candidates = new Set(event.changedIds || []);
    for (const id of view.objects.keys()) if (!priorVisible.has(id)) candidates.add(id);
    for (const id of candidates) if (s.nodes[id]?.kind === 'model') prepareNode(s.nodes[id]);
    paint(); onContextChange?.();
  });
  async function open() {
    active = true; view.setVisible(true); cancel(); page='tools'; if(!blocked()&&/^Teleop owns/.test(message))message='Move is ready. Grip a reference to arrange it.'; paint();
    const project = String(getProjectId() || '');
    if (!project) { ready = false; status('Open a project before adding Draw references.'); return false; }
    if (opening) return opening;
    opening = (async () => {
      const needsLoad = project !== currentProject || !ready;
      ready = false;
      if (needsLoad) {
        voice.reset(); preparedIds.clear();
        const loaded = persistence ? await persistence.load(project) : true;
        if (disposed || project !== String(getProjectId() || '')) return false;
        if (!loaded) return false;
        if (!persistence) board.replaceState({projectId:project});
        currentProject = project;
      }
      const freshAssets = await getAssets();
      if (disposed || project !== String(getProjectId() || '') || !active) return false;
      if(blocked()){status('Teleop owns the controls. Disarm teleop before opening Draw.');return false;}
      assets = normalizeDrawAssets(freshAssets, project);
      view.sync(board.getState()); reconcileSources(); ready = true;
      for (const node of Object.values(board.getState().nodes)) prepareNode(node);
      paint(); onContextChange?.(); return true;
    })().catch(error => { ready = false; status(error.message || 'Could not open the Draw board.'); return false; }).finally(()=>{opening=null;}); return opening;
  }
  function cancel() {
    if (grip) { const node=board.getState().nodes[grip.id]; if(node) view.setTransform(node.id,node.transform); }
    if(canvasDrag?.table==='nodes'){const node=board.getState().nodes[canvasDrag.id];if(node)view.setTransform(node.id,node.transform);}
    canvasDrag=null;grip=null; stroke=null; linkStart=''; reattachId=''; pressed.fill(false); view.live([],null); mode='move'; editor=null; pickerReturn=null; page='tools'; pointed=null; paint();
  }
  function close() { cancel(); active=false; view.setVisible(false); stopMemo(); void persistence?.flush(); onContextChange?.(); }
  function selectId(id) { dispatch({type:'selection.set',ids:[id]}); view.hover(id); const node=board.getState().nodes[id]; if(node) prepareNode(node); }
  function edit(title,text,save) { editor={title,text:String(text||''),shift:false,save}; paint(); }
  async function insert(asset, { duplicate = null } = {}) {
    if (!asset || !['model','image','memo'].includes(asset.kind)) return status('Choose a project model, image or voice memo.');
    if (asset.source?.projectId && asset.source.projectId !== currentProject) return status('Choose a reference from the current project.');
    if (Object.keys(board.getState().nodes).length >= DRAW_VIEW_LIMITS.nodes) return status('This board has 12 visible references. Remove one before adding more.');
    if (asset.kind==='image' && Object.values(board.getState().nodes).filter(n=>n.kind==='image').length>=DRAW_VIEW_LIMITS.images) return status('Keep at most six reference images in VR.');
    let prepared=null;
    if(asset.kind==='model') {
      const model=getModel(asset.source.filename);
      if(!model) return status('Open this model in Studio first. Unprepared CAD conversion is held off inside VR.');
      try { prepared=prepareDrawModel(THREE,model); view.assertModelBudget(prepared); }
      catch(error) { prepared?.dispose?.(); return status(error.message); }
    }
    const nodeId = freshNodeId();
    const transform=duplicate ? { ...duplicate.transform, position:duplicate.transform.position.map((value,index)=>value+(index===0?.12:0)) } : view.frontTransform(Object.keys(board.getState().nodes).length);
    if(prepared && !duplicate) transform.scale.fill(prepared.presentationScale);
    if (prepared) stagedPrepared.set(nodeId, prepared);
    const result=dispatch({type:'node.add',node:{...asset,id:nodeId,instanceId:nodeId,name:duplicate?`${asset.name} copy`:asset.name,transform,presentationScale:duplicate?.presentationScale||prepared?.presentationScale||1,source:{...asset.source,dimensions:asset.source.dimensions||null}}});
    // The synchronous subscription consumes this one prepared copy. Failed commands own no scene resources.
    if(stagedPrepared.has(nodeId)){stagedPrepared.delete(nodeId);prepared?.dispose?.();}
    if(result.changed){selectId(result.id);mode='move';page='tools';if(!prepared || preparedIds.has(result.id))status('Reference placed within reach. Move is ready.');}
    return result;
  }
  async function organize() {
    if (!active || !ready || blocked() || currentProject !== String(getProjectId() || '')) { const error=blocked()?'Teleop owns the controls. Disarm teleop before editing the board.':'Open a project board first.';status(error);return {ok:false,generated:false,error}; }
    if (organizing) return {ok:false,generated:false,error:'The prompt is already being organized.'}; organizing=true; status('Organizing connected references…');
    try { const result=organizeBoardPrompt(board.getState(),{prompt:String(getPromptDraft?.()||'')}); if(onOrganize) await onOrganize(result); else onSetPromptDraft(result.prompt); status('Prompt organized. Review and edit it, then press Generate.'); return result; }
    catch(error){status(error.message);return null;} finally {organizing=false;paint();}
  }
  function snapshot() {
    const state = board.getState();
    let prompt = String(getPromptDraft?.() || '');
    const hasDesign = Object.values(state.drawings).some(item => (item.anchor?.localPoints?.length || item.points?.length || 0) >= 2)
      || Object.values(state.regions).some(item => (item.anchor?.localPoints?.length || item.points?.length || 0) >= 2)
      || Object.values(state.notes).some(item => item.text.trim())
      || Object.values(state.nodes).some(item => item.source?.filename || item.source?.url || item.transcript?.trim());
    if (!prompt.trim() && hasDesign) {
      prompt = organizeBoardPrompt(state, { prompt: 'Generate a model from the Draw design below. Use its drawings, reference relationships and written design requirements. Preserve the supplied dimensions and coordinate systems.' }).prompt;
    }
    return createBoardSnapshot(state, { prompt });
  }
  async function action(id,payload) {
    id=String(id||'').replace(/^board:/,'');
    if(id==='close'){close();return true;}
    if(id==='chrome')return true;
    if(id==='cancel'){cancel();return true;}
    if(id==='note_page'){view.notePage();return true;}
    if(!active||!ready||blocked()||currentProject!==String(getProjectId()||'')) {status(blocked()?'Teleop owns the controls. Disarm teleop before editing the board.':'Open a project board first.');return false;}
    if(id.startsWith('kb:')&&editor){const result=applyKeyboardKey(editor.text,id,{shift:editor.shift});editor.text=result.draft.slice(0,12000);editor.shift=result.shift;if(result.action==='done')return action('edit.save');paint();return true;}
    if(id==='edit.save'&&editor){const saved=editor;editor=null;saved.save(saved.text);page='tools';paint();return true;}
    if(id==='tool'||id.startsWith('tool:')){cancel();mode=payload||id.slice(5);page='ink';paint();return true;}
    if(id==='select'){selectId(payload);return true;}
    if(id==='insert'){await insert(payload);return true;}
    if(id.startsWith('asset:')){const asset=assets.find(a=>a.id===id.slice(6));if(asset)await insert(asset);return true;}
    if(id==='assets'){const project=currentProject;const freshAssets=await getAssets();if(project!==currentProject||project!==String(getProjectId()||'')||!active||!ready||blocked())return false;assets=normalizeDrawAssets(freshAssets,project);reconcileSources();page='assets';pageIndex=0;}
    else if(id==='ink'||id==='notes'||id==='selection'){page=id;pageIndex=0;if(id==='notes'){const selected=record();notesTarget=selected?.table==='notes'?(selected.item.regionId||selected.item.nodeId||selected.item.id):selected?.item.id||'';}}
    else if(id==='mentions'){pickerReturn=editor;editor=null;page='mentions';pageIndex=0;}
    else if(id.startsWith('mention:')){const target=id.slice(8);if(pickerReturn){editor=pickerReturn;pickerReturn=null;editor.text+=` @{${target}}`;page='tools';}else{onSetPromptDraft(`${String(getPromptDraft?.()||'')} @{${target}}`);selectId(target);page='tools';}}
    else if(id==='back'){if(pickerReturn){editor=pickerReturn;pickerReturn=null;}page='tools';}
    else if(id==='next'||id==='previous'){const count=page==='assets'?assets.length:page==='mentions'?boardMentionItems(board.getState()).length:targetNotes().length;pageIndex=(pageIndex+(id==='next'?1:-1)+Math.max(1,Math.ceil(count/(page==='notes'?6:9))))%Math.max(1,Math.ceil(count/(page==='notes'?6:9)));}
    else if(id==='canvas'){cancel();view.canvasPlane.setEnabled(!board.getState().canvas?.enabled);dispatch({type:'board.update',patch:{canvas:{enabled:view.canvasPlane.isEnabled(),pose:view.canvasPlane.getPose()}}});status(view.canvasPlane.isEnabled()?'2D canvas ready. Point your laser and draw.':'3D drawing space ready.');}
    else if(id==='save'){const saved=await persistence?.flush();status(saved?'Canvas saved in project files → Canvas → VR AI Draw.':'Canvas could not be saved. Keep this board open and retry.');}
    else if(id==='text'){edit('Canvas text box','',text=>{if(!text.trim())return;const result=dispatch({type:'note.add',note:{text,expanded:true,position:view.frontTransform(Object.keys(board.getState().notes).length).position}});if(result.id)selectId(result.id);});}
    else if(id==='image'){edit('Generate reference image','',text=>{void (async()=>{if(!text.trim())return;try{status('Generating reference image…');const project=currentProject;const asset=await opts.onGenerateImage?.(text);if(project!==currentProject||project!==String(getProjectId()||'')||!active)return;if(!asset)throw new Error('Image generation is unavailable.');await insert(asset);status('Image added. Use Selection tools to resize, and Link to connect a text box.');}catch(error){status(error.message);}})();});}
    else if(id==='talk'){await persistence?.flush();if(!onTalk)return status('Voice is unavailable. The canvas remains saved.');try{const result=await onTalk();if(result?.ok===false)return status(result.error||'Voice could not start.');status('Discuss the canvas and drawings with AI. Review the prompt and press Generate when ready.');}catch(error){status(error.message||'Voice could not start.');}}
    else if(id==='prompt'||id==='review'){edit('Review AI prompt',String(getPromptDraft?.()||''),onSetPromptDraft);}
    else if(id==='organize'){return organize();}
    else if(id==='generate') {
      if(generating)return false;
      view.update();
      if(view.isLineBudgetExceeded())return status('Simplify the board ink before generating; some lines exceed the safe VR preview budget.');
      const immutable=snapshot();
      if(!immutable.prompt.trim())return status('Draw a shape, add a reference or text box, or write a prompt before generating.');
      if(typeof onGenerate!=='function')return status('Model generation is unavailable. Your design is still on the board.');
      generating=true;paint();
      try{const result=await onGenerate(immutable);if(result?.ok===false)status(result.error||'The prompt needs review before generation.');return result;}
      catch(error){status(error.message);}
      finally{generating=false;paint();}
    }
    else if(id==='undo'){cancel();board.undo();}
    else if(id==='redo'){cancel();board.redo();}
    else if(id==='note.collapse'||id==='note.expand'){const expanded=id==='note.expand';const notes=targetNotes();if(notes.length)dispatch({type:'batch',commands:notes.map(note=>({type:'note.update',id:note.id,patch:{expanded}}))});if(expanded){view.hover(notesTarget||record()?.item.id||'');}else view.collapseNotes();}
    else if(id==='note.new'){let selected=(page==='notes'?record(notesTarget):null)||record();if(selected?.table==='notes')selected=record(selected.item.regionId||selected.item.nodeId);if(!selected||!['regions','nodes'].includes(selected.table))return status('Select a region or reference for the note.');const target=selected.item.id;edit('New spatial note','',text=>dispatch({type:'note.add',note:{text,expanded:true,...(selected.table==='regions'?{regionId:target}:{nodeId:target})}}));}
    else if(id.startsWith('note:')){const note=board.getState().notes[id.slice(5)];if(note){selectId(note.id);edit('Edit spatial note',note.text,text=>dispatch({type:'note.update',id:note.id,patch:{text,expanded:true}}));}}
    else {const selected=record();if(!selected)return status('Select an item on the board first.');const {table,item}=selected,entity=table.slice(0,-1);
      if(id==='reattach'&&['regions','drawings'].includes(table)){reattachId=item.id;mode='reattach';page='tools';status('Select the new model surface for this region. Notes and links keep their IDs.');}
      else if(id==='remove'){if(memoId===item.id)stopMemo();dispatch({type:`${entity}.remove`,id:item.id});}
      else if(id==='rename')edit('Rename reference',item.name,name=>dispatch({type:`${entity}.update`,id:item.id,patch:{name}}));
      else if(id==='duplicate'&&table==='nodes'){await insert(item,{duplicate:item});}
      else if(['smaller','larger','rotate'].includes(id)&&table==='nodes'){const t=item.transform;if(id==='rotate'){const q=new THREE.Quaternion().fromArray(t.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/12));dispatch({type:'node.transform',id:item.id,transform:{quaternion:q.toArray()}});}else dispatch({type:'node.transform',id:item.id,transform:{scale:t.scale.map(v=>Math.max(item.presentationScale*.1,Math.min(item.presentationScale*5,v*(id==='larger'?1.2:1/1.2))))}});}
      else if(id==='final'&&item.kind==='image')dispatch({type:'node.update',id:item.id,patch:{finalLook:!item.finalLook}});
      else if(id==='caption'&&table==='links')edit('Relationship caption',item.caption,caption=>dispatch({type:'link.update',id:item.id,patch:{caption,referenceIds:[...caption.matchAll(/@\{([\w.:-]+)\}/g)].map(m=>m[1])}}));
      else if(id==='caption'&&item.kind==='memo')edit('Memo transcript',item.transcript,transcript=>dispatch({type:'node.update',id:item.id,patch:{transcript}}));
      else if(id==='caption'&&table==='notes')edit('Edit spatial note',item.text,text=>dispatch({type:'note.update',id:item.id,patch:{text}}));
      else if(id==='play'&&item.kind==='memo'){await playMemo(item);}
    }
    paint();return true;
  }
  function stopMemo() {
    memoAbort?.abort();memoAbort=null;
    if(memoAudio){memoAudio.pause();memoAudio.removeAttribute('src');memoAudio.load();memoAudio=null;}
    if(memoUrl)URL.revokeObjectURL(memoUrl);memoUrl='';memoId='';
  }
  async function playMemo(item) {
    if(memoId===item.id&&memoAudio&&!memoAudio.paused){stopMemo();paint();return;}
    stopMemo();const url=item.audioUrl||item.source.url;if(!url)return status('This memo has no audio file. Its transcript is still editable.');
    const project=currentProject,abort=new AbortController();memoAbort=abort;memoId=item.id;
    try {
      const target=new URL(url,location.href);if(target.origin!==location.origin)throw new Error('Choose a project voice memo for playback.');
      const token=await getToken?.();const response=await fetch(target.href,{signal:abort.signal,redirect:'error',headers:token?{Authorization:`Bearer ${token}`}:{}});
      if(!response.ok)throw new Error('Audio preview unavailable. The transcript is still editable.');
      const limit=8*1024*1024;if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error('Use a memo under 8 MB for VR playback. Larger audio stays available in the project.');}
      let blob;const reader=response.body?.getReader();
      if(reader){const chunks=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();throw new Error('Use a memo under 8 MB for VR playback.');}chunks.push(part.value);}blob=new Blob(chunks,{type:response.headers.get('content-type')||item.source.mediaType||'audio/webm'});}
      else {blob=await response.blob();if(blob.size>limit)throw new Error('Use a memo under 8 MB for VR playback.');}
      if(abort.signal.aborted||!active||blocked()||currentProject!==project||project!==String(getProjectId()||''))return;
      memoUrl=URL.createObjectURL(blob);memoAudio=new Audio(memoUrl);memoAudio.onended=()=>{stopMemo();paint();};await memoAudio.play();paint();
    } catch(error){if(!abort.signal.aborted)status(error.message||'Audio preview unavailable.');if(memoAbort===abort)stopMemo();}
  }
  function select(controller) {
    if(!active||!ready||blocked())return false;
    const ui=view.pickUI(controller);if(ui){void action(ui.id);return true;}
    if(['pen','line','arrow','lasso'].includes(mode))return true;
    const hit=view.pick(controller,{surface:mode==='face'||mode==='edge'||mode==='reattach'});if(!hit){const bounds=view.pickBounds?.(controller);if(!bounds)return false;if(mode==='move')selectId(bounds.boardId);return true;}
    if(mode==='eraser'){const selected=record(hit.id);if(selected)dispatch({type:`${selected.table.slice(0,-1)}.remove`,id:hit.id});return true;}
    if(mode==='link'){if(!linkStart){linkStart=hit.id;selectId(hit.id);status('Choose the second endpoint.');}else if(hit.id!==linkStart){const fromId=linkStart,toId=hit.id;linkStart='';edit('Relationship caption','',caption=>{const result=dispatch({type:'link.add',link:{fromId,toId,caption,referenceIds:[...caption.matchAll(/@\{([\w.:-]+)\}/g)].map(m=>m[1])}});if(result.id)selectId(result.id);});}return true;}
    if(mode==='reattach'&&hit.anchor) {
      const target=record(reattachId); if(!target||!['regions','drawings'].includes(target.table)) {cancel();return true;}
      const old=target.item, original=old.anchor?.localPoints?.length?old.anchor.localPoints:old.points;
      let points;
      if(old.kind==='edge') points=nearestBoardTriangleEdge(hit.trianglePoints,hit.anchor.localPoints[0]);
      else if(old.kind==='face') points=hit.trianglePoints?.length===3?[...hit.trianglePoints,hit.trianglePoints[0]]:null;
      else if(original?.length) {
        const centroid=new THREE.Vector3();for(const point of original)centroid.add(new THREE.Vector3().fromArray(point));centroid.multiplyScalar(1/original.length);
        const oldNormal=new THREE.Vector3().fromArray(old.anchor?.localNormal||[0,1,0]).normalize(),newNormal=new THREE.Vector3().fromArray(hit.anchor.localNormal).normalize();
        const rotation=new THREE.Quaternion().setFromUnitVectors(oldNormal,newNormal),targetPoint=new THREE.Vector3().fromArray(hit.anchor.localPoints[0]);
        points=original.map(point=>new THREE.Vector3().fromArray(point).sub(centroid).applyQuaternion(rotation).add(targetPoint).toArray());
      }
      if(!points?.length)return status('Choose a visible model face with a valid mesh surface.');
      const result=dispatch({type:`${target.table.slice(0,-1)}.update`,id:old.id,patch:{nodeId:hit.nodeId,anchor:{...hit.anchor,localPoints:points,needsReattach:false},points}});
      if(result.changed){reattachId='';mode='move';selectId(old.id);status('Surface reattached. The region, notes and links retain their IDs.');}return true;
    }
    if((mode==='face'||mode==='edge')&&hit.anchor){
      pointed=hit.anchor;
      const points=mode==='edge'?nearestBoardTriangleEdge(hit.trianglePoints,hit.anchor.localPoints[0]):hit.trianglePoints?.length===3?[...hit.trianglePoints,hit.trianglePoints[0]]:null;
      if(!points)return status('Choose a visible model triangle or edge.');
      const result=dispatch({type:'region.add',region:{name:mode==='edge'?'Mesh edge region':hit.anchor.faceId?'CAD face region':'Mesh face region',kind:mode,nodeId:hit.nodeId,anchor:{...hit.anchor,localPoints:points},points}});
      if(result.id)selectId(result.id);return true;
    }
    selectId(hit.id);pointed=hit.anchor||null;if(mode==='label')void action('note.new');return true;
  }
  function sample(hand,controller,isPressed) {
    if((hand===0||hand===1)&&active&&ready&&!blocked()&&mode==='move'&&board.getState().canvas?.enabled){
      const was=pressed[hand];pressed[hand]=isPressed;
      if(isPressed&&!was&&!canvasDrag&&!view.pickUI(controller)){
        const hit=view.pick(controller);const selected=hit&&record(hit.id);const point=view.drawingPoint(controller,null);
        if(point&&selected&&['nodes','notes'].includes(selected.table)){
          canvasDrag={hand,id:hit.id,table:selected.table,start:point.toArray(),position:selected.item.transform?.position||selected.item.position};selectId(hit.id);
        }
      }
      if(canvasDrag?.hand===hand){
        const point=view.drawingPoint(controller,null);
        if(point){canvasDrag.next=point.toArray().map((v,i)=>v-canvasDrag.start[i]+canvasDrag.position[i]);if(canvasDrag.table==='nodes'){const node=board.getState().nodes[canvasDrag.id];view.setTransform(node.id,{...node.transform,position:canvasDrag.next});}}
        if(!isPressed&&was){const done=canvasDrag;canvasDrag=null;if(done.next)dispatch(done.table==='nodes'?{type:'node.transform',id:done.id,transform:{position:done.next}}:{type:'note.update',id:done.id,patch:{position:done.next}});}
      }
      return true;
    }
    if((hand!==0&&hand!==1)||!active||!ready||blocked()||!['pen','line','arrow','lasso'].includes(mode))return false;
    const was=pressed[hand];pressed[hand]=isPressed;
    if(isPressed&&!was&&!stroke){if(view.pickUI(controller))return true;const planar=board.getState().canvas?.enabled;const hit=planar?null:view.pick(controller,{surface:true});if(!planar&&!hit&&view.pickBounds?.(controller))return true;stroke={hand,tool:mode,anchor:hit?.anchor||null,points:[]};pointed=stroke.anchor;lastSample=-Infinity;}
    if(stroke?.hand!==hand)return true;
    if(isPressed){const now=performance.now();if(now-lastSample<35)return true;lastSample=now;const p=view.drawingPoint(controller,stroke.anchor);if(!p)return true;const points=stroke.points,prev=points.at(-1);if(prev&&boardSampleDistanceSquared(prev,p,stroke.anchor?view.getObject(stroke.anchor.nodeId)?.matrixWorld.elements:null)<.0015**2)return true;
      if(points.length>=128){let write=1;for(let read=2;read<points.length-1;read+=2)points[write++]=points[read];points[write++]=points.at(-1);points.length=write;}points.push(p.toArray());view.live(points,stroke.anchor);
    }else if(was){const done=stroke;stroke=null;view.live([],null);if(done.points.length<2)return true;const points=['line','arrow'].includes(done.tool)?[done.points[0],done.points.at(-1)]:done.points;const anchor=done.anchor?{...done.anchor,localPoints:points}:null;
      const result=dispatch(done.tool==='lasso'?{type:'region.add',region:{name:'Lasso region',kind:'lasso',nodeId:anchor?.nodeId,anchor,points}}:{type:'drawing.add',drawing:{tool:done.tool,nodeId:anchor?.nodeId,anchor,points}});if(result.id)selectId(result.id);}
    return true;
  }
  function beginGrip(hand,controller) {
    if(!active||!ready||blocked()||grip)return false;const hit=view.pick(controller);const node=hit&&board.getState().nodes[hit.id];if(!node)return false;
    const object=view.getObject(node.id);if(!object)return false;controller.updateWorldMatrix?.(true,false);const position=new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);if(position.distanceTo(object.position)>.35)return false;
    controller.updateWorldMatrix?.(true,false);grip={hand,id:node.id,controller,offset:controller.matrixWorld.clone().invert().multiply(object.matrixWorld)};selectId(node.id);return true;
  }
  function endGrip(hand){if(grip?.hand!==hand)return false;const g=grip;grip=null;const object=view.getObject(g.id);if(object)dispatch({type:'node.transform',id:g.id,transform:{position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()}});return true;}
  const matrix=new THREE.Matrix4(),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),scale=new THREE.Vector3();
  function update(time=performance.now()) {
    if(!active)return;
    if(currentProject&&currentProject!==String(getProjectId()||'')){close();return;}
    if(blocked()){if(stroke||grip)cancel();return;}
    if(grip){matrix.multiplyMatrices(grip.controller.matrixWorld,grip.offset);matrix.decompose(pos,quat,scale);view.setTransform(grip.id,{position:pos.toArray(),quaternion:quat.toArray(),scale:scale.toArray()});}
    view.update();
  }
  view.sync(board.getState());paint();
  return { board, view, open, close, isActive:()=>active, getTool:()=>mode, isReady:()=>ready, action, sample, cancel, select, beginGrip, endGrip, update,
    pickUI:controller=>active?view.pickUI(controller):null, getVoiceContext:()=>voice.getContext(), voiceCommand:args=>voice.command(args), snapshot,
    hover(controller,time=performance.now()){if(!active||!ready||blocked()||stroke||time-lastHover<140)return;lastHover=time;const hit=view.pick(controller);view.hover(hit?.id||'');pointed=hit?.anchor||null;},
    flush:()=>persistence?.flush(), dispose(){close();disposed=true;for(const prepared of stagedPrepared.values())prepared.dispose?.();stagedPrepared.clear();unsubscribe();persistence?.dispose();view.dispose();voice.reset();}
  };
}
