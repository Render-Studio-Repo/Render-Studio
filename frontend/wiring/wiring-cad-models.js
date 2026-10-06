import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const productKey=url=>String(url||'').replace(/^https?:\/\/(www\.)?/,'').replace(/\/$/,'');
/** Detached, reusable CAD previews. Wiring owns clones, never the Design meshes. */
export function createWiringCadModels({getProjectId,headers,onReady,onStatus}) {
  let project='', index=[], indexed=false, indexLoading=false;
  const models=new Map(), pending=new Set();
  function syncProject(){const next=getProjectId?.()||'';if(next!==project){project=next;index=[];indexed=false;indexLoading=false;pending.clear();for(const model of models.values())model.traverse(n=>{n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m?.dispose();});models.clear();}return project;}
  async function loadIndex(){const pid=syncProject();if(!pid||indexLoading||indexed)return;indexLoading=true;
    try {const r=await fetch(`/api/projects/${encodeURIComponent(pid)}/wiring/models`,{headers:headers?.()});if(!r.ok)throw new Error('Could not read manufacturer CAD');const data=await r.json();if(pid!==syncProject())return;index=data.models||[];indexed=true;onReady?.();}
    catch(error){onStatus?.(error.message);}finally{if(pid===project)indexLoading=false;}
  }
  function get(component){const pid=syncProject();if(!pid)return null;void loadIndex();
    const record=index.find(m=>productKey(m.product_url)===productKey(component.source_url||component.product_url||component.part?.url));
    const source=component.sourceFile||component.part?.sourceFile||record?.sourceFile;
    if(!source)return null;const filename=source.replace(/\.(step|stp)$/i,'.glb');
    if(models.has(filename))return models.get(filename);
    if(!pending.has(filename)) {pending.add(filename);void (async()=>{
      try{const r=await fetch(`/api/projects/${encodeURIComponent(pid)}/files/${filename.split('/').map(encodeURIComponent).join('/')}`,{headers:headers?.()});if(!r.ok)throw new Error('CAD preview is not ready');const buffer=await r.arrayBuffer();const gltf=await new GLTFLoader().parseAsync(buffer,'');if(pid!==syncProject()){gltf.scene.traverse(n=>{n.geometry?.dispose();n.material?.dispose?.();});return;}gltf.scene.userData.wiringDetachedCad=true;models.set(filename,gltf.scene);onReady?.();}
      catch(error){if(pid===project)onStatus?.(`${component.label||'Part'}: ${error.message}. Reload 3D view when ready.`);}
    })();}return null;
  }
  return {get, async importModels(){const pid=syncProject();const r=await fetch(`/api/projects/${encodeURIComponent(pid)}/wiring/models/import`,{method:'POST',headers:headers?.()});if(!r.ok)throw new Error('Could not import manufacturer CAD');const result=await r.json();if(pid===syncProject()){indexed=false;pending.clear();await loadIndex();}return result;},reload(){syncProject();indexed=false;pending.clear();void loadIndex();}};
}
