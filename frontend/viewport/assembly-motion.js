import * as THREE from 'three';
import {
  JOINT_WIN1_CACHE,
  JOINTS_WINDOW_BOUNDS_KEY,
  attachStudioFloatWindow,
  defaultJointsBounds,
} from "../studio/floating-window.js?v=jointwin1";

export { JOINT_WIN1_CACHE };

// Apply solver deltas in model coordinates, retaining exact original transforms.
export function createAssemblyPose(getRoot) {
  let originals = new Map();
  function reset() {
    for (const [node, base] of originals) {
      node.matrix.copy(base.matrix); node.matrix.decompose(node.position,node.quaternion,node.scale);
      node.matrixAutoUpdate=base.auto; node.updateMatrixWorld(true);
    }
    originals.clear();
  }
  function apply(matrices) {
    reset();
    const root=getRoot();
    if (!root) throw new Error('Load this assembly in the viewport first.');
    root.updateMatrixWorld(true);
    const resolved=[];
    for (const [name,values] of Object.entries(matrices)) {
      const matches=[];
      root.traverse(node=>{if(node.name===name && node!==root) matches.push(node);});
      if (matches.length!==1) throw new Error(`Cannot preview ${name}: expected one named viewport component, found ${matches.length}.`);
      if (!Array.isArray(values)||values.length!==16||!values.every(Number.isFinite)) throw new Error('Invalid solver transform');
      resolved.push([matches[0],values]);
    }
    // Never apply twice to a nested moving body: imported joints must bind independent components.
    for (const [node] of resolved) for (let p=node.parent;p && p!==root;p=p.parent) {
      if(resolved.some(([other])=>other===p)) throw new Error('Nested joint bodies need independent component mapping.');
    }
    for (const [node,values] of resolved) {
      originals.set(node,{matrix:node.matrix.clone(),auto:node.matrixAutoUpdate});
      const delta=new THREE.Matrix4().set(...values);
      const world=new THREE.Matrix4().copy(root.matrixWorld).multiply(delta).multiply(root.matrixWorld.clone().invert()).multiply(node.matrixWorld);
      node.matrix.copy(node.parent.matrixWorld.clone().invert().multiply(world));
      node.matrix.decompose(node.position,node.quaternion,node.scale);node.matrixAutoUpdate=false;
      node.updateMatrixWorld(true);
    }
  }
  return {apply,reset};
}

export function createAssemblyMotion({getProjectId,getFilename,getRoot,headers,onSaved}={}) {
  const pose=createAssemblyPose(getRoot);
  let panel=null, floatWin=null, data={joints:[]}, filename='', request=0, previewEpoch=0;
  const e=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(tag==='button'){n.type='button';n.className='dxf-viewer-btn';}if(tag==='p')n.style.cssText='margin:10px 0;line-height:1.45';return n;};
  function host(){return floatWin?.body||panel;}
  function jointTitle(){return 'Joints · '+(filename.split('/').pop()||'assembly');}
  async function api(method,body) {
    const response=await fetch(`/api/projects/${encodeURIComponent(getProjectId())}/assembly-joints${method==='POST'?'/solve':''}${method==='GET'?'?filename='+encodeURIComponent(filename):''}`,{method,headers:{...headers?.(),'Content-Type':'application/json'},...(body?{body:JSON.stringify({filename,...body})}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.detail||'Assembly request failed');return result;
  }
  function close(){
    ++request;++previewEpoch;pose.reset();
    try{floatWin?.save?.();}catch(_){}
    try{floatWin?.destroy?.();}catch(_){}
    floatWin=null;panel?.remove();panel=null;
  }
  function show(next){data=next;render();}
  function render(){
    if(!panel)return;
    const root=host();
    root.replaceChildren();
    floatWin?.setTitle?.(jointTitle());
    const status=e('p', data.native?.ok?`Native FreeCAD assembly · ${data.joints.length} joints`:(data.native?.error||'No joints yet. Ask the CAD AI to make the mechanism move.'));
    status.setAttribute('role','status');root.append(status);
    const list=e('div');list.className='assembly-motion-list';root.append(list);
    for(const joint of data.joints){
      const row=e('fieldset');row.style.cssText='border:1px solid #3c4657;border-radius:6px;margin:8px 0;padding:8px';
      row.append(e('legend',joint.id+' · '+joint.type),e('small',joint.parent+' → '+joint.child));
      const values={};
      const keys=joint.type==='ball'?['yaw','pitch','roll']:joint.type==='cylindrical'?['angle','distance']:['slider','prismatic'].includes(joint.type)?['distance']:['revolute','continuous'].includes(joint.type)?['angle']:[];
      for(const key of keys){
        const label=e('label',key+' '+(key==='distance'?'mm':'°')+' ');label.style.cssText='display:block;margin-top:8px';
        const limits=joint[key==='distance'?'linear_limits':'angular_limits']||(['revolute','slider','prismatic'].includes(joint.type)?joint.limits:null);
        const input=e('input');input.type='number';input.value=String(keys.length===1?(joint.state||0):0);values[key]=Number(input.value);input.step=key==='distance'?'1':'5';input.style.width='80px';input.setAttribute('aria-label',joint.id+' '+key);
        if(limits){input.min=limits[0];input.max=limits[1];label.append(e('small',`[${limits[0]}, ${limits[1]}] `));}
        input.oninput=()=>{values[key]=Number(input.value);};label.append(input);row.append(label);
      }
      if(keys.length){
        const preview=e('button','Preview motion');preview.style.marginTop='8px';
        preview.onclick=async()=>{const epoch=++previewEpoch;preview.disabled=true;status.textContent='Solving assembly…';try{const result=await api('POST',{values:{[joint.id]:values}});if(epoch!==previewEpoch||!panel)return;pose.apply(result.matrices);status.textContent='Motion preview · FreeCAD constraints solved';}catch(error){if(epoch===previewEpoch)status.textContent=error.message;}finally{preview.disabled=false;}};
        row.append(preview);
      }
      list.append(row);
    }
    const reset=e('button','Reset pose');reset.onclick=()=>{++previewEpoch;pose.reset();status.textContent='Original assembly pose restored';};root.append(reset);
    const details=e('details');details.style.marginTop='12px';details.append(e('summary','Edit joint definitions · all FreeCAD types'));
    details.append(e('p','Types: '+(data.types||[]).join(', ')+'. Anchors in mm; angles in degrees.'));
    const source=e('textarea');source.setAttribute('aria-label','Joint definitions JSON');source.value=JSON.stringify(data.joints,null,2);source.style.cssText='width:100%;height:200px;background:#0d1117;color:#c9d1d9;font:12px monospace';details.append(source);
    const save=e('button','Validate and save joints');save.onclick=async()=>{const epoch=request;save.disabled=true;++previewEpoch;pose.reset();status.textContent='Validating native assembly…';try{const saved=await api('PUT',{joints:JSON.parse(source.value)});if(!panel||epoch!==request)return;show(saved);onSaved?.();}catch(error){status.textContent=error.message;}finally{save.disabled=false;}};details.append(save);root.append(details);
    root.append(e('p','Preview does not change exported geometry. Export STEP + joints to keep the joint definitions and native assembly.'));
  }
  async function open(file=getFilename()){
    close();filename=file;const id=++request;
    panel=e('section');panel.className='assembly-motion-panel studio-float-window';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Assembly joints');
    document.body.append(panel);
    floatWin=attachStudioFloatWindow(panel,{
      title:jointTitle(),
      storageKey:JOINTS_WINDOW_BOUNDS_KEY,
      defaultBounds:defaultJointsBounds,
      minW:280,
      minH:220,
      closeTitle:'Close and reset preview',
      closeLabel:'Close joints',
      onClose:close,
    });
    host().append(e('p','Loading joints…'));
    try{const result=await api('GET');if(id===request)show(result);}catch(error){if(id===request){data={joints:[],native:{error:error.message}};render();}}
  }
  return {open,close,reset:()=>{++previewEpoch;pose.reset();}};
}
