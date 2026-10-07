/** Wiring progress never means electrical verification; evidence is tracked separately. */
export function createWiringGuide({getProjectId, getContext, selectWire, storage = globalThis.localStorage} = {}) {
  let project = '', signature = '', wires = [], index = 0, guided = false, schematicOnly = true, installed = {}, reviews = {}, message = '';
  const key = () => `render3d:wiring-guide:v1:${project}`;
  const fingerprint = wire => JSON.stringify([wire.id, wire.from, wire.to, wire.gauge, wire.sources]);
  function sync() {
    const pid = String(getProjectId?.() || ''); const current = getContext?.()?.wires || [];
    const next = JSON.stringify(current.map(fingerprint));
    if (pid !== project) {
      project = pid; signature = ''; index = 0; guided = false; installed = {}; reviews = {}; message = '';
      try { const saved = JSON.parse(storage?.getItem(key()) || '{}'); installed = saved.installed || {}; schematicOnly = saved.schematicOnly !== false; } catch {}
    }
    if (next !== signature) { signature = next; wires = current; index = Math.min(index, Math.max(0,wires.length-1)); reviews = {}; }
    return wires[index] || null;
  }
  function save() { try { storage?.setItem(key(), JSON.stringify({installed, schematicOnly})); } catch {} }
  function state() { const wire = sync(); return {projectId:project, guided, schematicOnly, index, total:wires.length, wire,
    installed:!!wire && installed[wire.id] === fingerprint(wire), completed:wires.filter(w=>installed[w.id]===fingerprint(w)).length,
    review:wire ? reviews[wire.id] || null : null, message}; }
  function focus() { const wire = sync(); if (wire) selectWire?.(wire.id); return state(); }
  return {
    state,
    get schematicOnly() {return schematicOnly;},
    start() { sync(); guided=true; return focus(); },
    stop() { guided=false; return state(); },
    next(delta=1) { sync(); index = Math.max(0,Math.min(wires.length-1,index+delta)); return focus(); },
    markInstalled() { const wire=sync(); if(wire){installed[wire.id]=fingerprint(wire);save();} return state(); },
    toggleSchematicOnly() { sync(); schematicOnly=!schematicOnly;save();return state(); },
    setMessage(text) { message=String(text || ''); },
    reviewSnapshot() { const wire=sync(); return {projectId:project,signature,wireId:wire?.id,wire,step:index+1}; },
    applyReview(snapshot,result) {
      sync(); if(snapshot.projectId!==project || snapshot.signature!==signature || !wires.some(w=>w.id===snapshot.wireId)) return false;
      reviews[snapshot.wireId]={...result, scope:'Visual check only; continuity, shorts, polarity under load and current capacity are not confirmed.'};return true;
    },
    voiceBrief() { const s=state();return `Guide me through wiring step ${s.index+1} of ${s.total}. Use GPT-6 Astra for detailed reasoning via ask_selected_model. Keep instructions short and describe both exact terminal names. Current step data: ${JSON.stringify(s.wire)}. Work only on a de-energized circuit; stop at unresolved pinouts. User-marked installed is not electrical verification. Rendered CAD is not a live camera image. Ask me to use Check with camera for a physical visual review. Do not claim continuity or complete electrical safety from a photo. Do not move to the next wire until I ask.`; },
  };
}

export function wiringGuideRows(guide, active=false) {
  const s=guide.state(), w=s.wire;
  return [
    {id:'ws-wiring-load',label:active?'Reload project wiring':'Load project wiring',kind:'action',icon:'model'},
    {id:'ws-wiring-isolate',label:`Schematics only: ${s.schematicOnly?'On':'Off · show CAD'}`,kind:'action',icon:'model'},
    {id:'ws-wiring-guided',label:`Step-by-step: ${s.guided?'On':'Off'}`,kind:'action',icon:'play'},
    ...(s.guided ? [
      {id:'',label:s.total?`Step ${s.index+1}/${s.total} · ${w?.label || 'Wire'}`:'No connected wires in this project yet',kind:'hint'},
      {id:'',label:w?`${w.from.component} · ${w.from.pin} → ${w.to.component} · ${w.to.pin}`:'Generate a schematic before starting guidance.',kind:'hint'},
      {id:'ws-wiring-prev',label:'Previous wire',kind:'action',icon:'back'},
      {id:'ws-wiring-done',label:s.installed?'Installed by you · not electrically tested':'Mark installed',kind:'action',icon:'check'},
      {id:'ws-wiring-next',label:'Next wire',kind:'action',icon:'next'},
      {id:'ws-wiring-talk',label:'Ask Astra · voice guide',kind:'action',icon:'mic'},
      {id:'ws-wiring-check',label:'Check this wire with camera',kind:'action',icon:'camera'},
      {id:'',label:s.review?.summary || s.message || 'Power off before wiring. Camera checks are visual only.',kind:'hint'},
    ]:[]),
    {id:'passthrough',label:'Toggle passthrough',kind:'action',icon:'eye'},
    {id:'ws-wiring-close',label:'Close wiring overlay',kind:'action',icon:'close'},
    {id:'ws-wiring-back',label:'Back to Workspace',kind:'action',icon:'back'},
  ];
}

export function wiringGuideVoiceActions(getApi) {
  return [
    ['wiring_start','Start step-by-step wiring guidance','start'],
    ['wiring_next','Show the next wiring connection','next',1],
    ['wiring_previous','Show the previous wiring connection','next',-1],
    ['wiring_mark_installed','Mark this wire installed by the user; not electrically tested','markInstalled'],
    ['wiring_stop','Stop wiring guidance','stop'],
  ].map(([id,label,method,arg])=>({id,label,run:()=>{
    const api=getApi?.(),guide=api?.guide;
    if(!api?.requestedMode || !guide?.state().total)return {ok:false,error:'Load project wiring from VR Workspace → Wiring first.'};
    const state=guide[method](arg);return {ok:true,message:`Step ${state.index+1} of ${state.total}. ${state.wire?.label || ''}`,step:state.index+1,wire:state.wire,installed:state.installed,verification:'User progress only; not an electrical test.'};
  }}));
}
