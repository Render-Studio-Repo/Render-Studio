/** Isolated, cancellable marketplace GLB preview. It never runs product scripts. */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {authHeaders} from '../studio/auth.js';

const MAX_PREVIEW_BYTES=30*1024*1024;
const activePreviews=new WeakMap();

function previewUrl(raw){
  const url=new URL(raw,location.href);
  if(url.origin!==location.origin||url.username||url.password||!url.pathname.startsWith('/api/marketplace/product/'))throw new Error('Choose a marketplace product preview from this server.');
  return url.href;
}

async function fetchPreview(url,signal){
  const response=await fetch(url,{headers:authHeaders(),signal,redirect:'error'});
  if(!response.ok)throw new Error('The 3D preview is not available for this account.');
  if(Number(response.headers.get('content-length')||0)>MAX_PREVIEW_BYTES)throw new Error('3D previews must be 30 MB or smaller.');
  if(!response.body){const bytes=await response.arrayBuffer();if(bytes.byteLength>MAX_PREVIEW_BYTES)throw new Error('3D previews must be 30 MB or smaller.');return bytes;}
  const reader=response.body.getReader(),parts=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_PREVIEW_BYTES){await reader.cancel();throw new Error('3D previews must be 30 MB or smaller.');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes.buffer;
}

function disposeModel(root){
  const geometry=new Set(),materials=new Set(),textures=new Set();
  root?.traverse(node=>{if(node.geometry)geometry.add(node.geometry);for(const material of [].concat(node.material||[]))materials.add(material);});
  for(const material of materials){for(const value of Object.values(material)){if(value?.isTexture)textures.add(value);}material.dispose();}
  for(const texture of textures){texture.dispose();texture.source?.data?.close?.();}
  for(const item of geometry)item.dispose();
}

/** Returns cleanup immediately; cleanup.ready resolves after loading or cancellation. */
export function mountProductModel(host,url){
  const safeUrl=previewUrl(url);
  activePreviews.get(host)?.();
  host.replaceChildren();host.classList.add('shop-model-stage');delete host.dataset.modelReady;
  const canvas=document.createElement('canvas');host.append(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  const scene=new THREE.Scene();scene.background=new THREE.Color('#edf2f4');
  const camera=new THREE.PerspectiveCamera(42,1,.001,10000),controls=new OrbitControls(camera,canvas);controls.enableDamping=true;
  scene.add(new THREE.HemisphereLight(0xffffff,0x668899,3));const light=new THREE.DirectionalLight(0xffffff,4);light.position.set(5,8,6);scene.add(light);
  const tools=document.createElement('div');tools.className='shop-model-tools';tools.innerHTML='<button data-rotate>Auto rotate</button><button data-labels>Part labels</button><button data-demo>Show me</button><button data-reset>Reset view</button>';host.append(tools);
  const labels=document.createElement('div');labels.className='shop-model-labels';host.append(labels);
  let stopped=false,frame=0,model=null,mixer=null,clip=null,rotate=false,showLabels=false,demo=0;
  const names=[],clock=new THREE.Clock(),abort=new AbortController();let fit=1;
  const current=()=>!stopped&&activePreviews.get(host)===dispose&&host.isConnected&&canvas.parentNode===host;
  const fitView=()=>{camera.position.set(fit*1.3,fit*.9,fit*1.7);camera.near=Math.max(.0001,fit/10000);camera.far=Math.max(10,fit*20);camera.updateProjectionMatrix();controls.target.set(0,0,0);controls.update();};
  function resizeView(){if(stopped)return;const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  const resize=new ResizeObserver(resizeView);resize.observe(host);resizeView();
  function draw(){if(!current()){dispose();return;}frame=requestAnimationFrame(draw);if(document.hidden)return;const dt=Math.min(clock.getDelta(),.05);if(rotate&&model)model.rotation.y+=dt*.25;mixer?.update(dt);controls.update();renderer.render(scene,camera);for(const row of names){const p=new THREE.Vector3();row.node.getWorldPosition(p);p.project(camera);row.label.style.transform=`translate(${(p.x*.5+.5)*host.clientWidth}px,${(-p.y*.5+.5)*host.clientHeight}px)`;row.label.hidden=!showLabels||p.z>1||p.z< -1;}}
  tools.querySelector('[data-rotate]').onclick=e=>{rotate=!rotate;e.target.classList.toggle('active',rotate);};
  tools.querySelector('[data-labels]').onclick=e=>{showLabels=!showLabels;e.target.classList.toggle('active',showLabels);};
  tools.querySelector('[data-reset]').onclick=()=>{if(model)model.rotation.set(0,0,0);fitView();};
  tools.querySelector('[data-demo]').onclick=()=>{if(clip){clip.reset().play();return;}const angle=++demo*Math.PI/2;camera.position.set(Math.cos(angle)*fit*1.8,fit*.7,Math.sin(angle)*fit*1.8);controls.update();};
  function dispose(){if(stopped)return;stopped=true;abort.abort();cancelAnimationFrame(frame);resize.disconnect();controls.dispose();mixer?.stopAllAction();if(model)mixer?.uncacheRoot(model);disposeModel(scene);renderer.dispose();renderer.forceContextLoss();if(activePreviews.get(host)===dispose)activePreviews.delete(host);}
  activePreviews.set(host,dispose);draw();
  dispose.ready=(async()=>{
    let parsed=null;
    try{
      const bytes=await fetchPreview(safeUrl,abort.signal);if(!current())return;
      const manager=new THREE.LoadingManager();manager.setURLModifier(path=>{if(!path.startsWith('data:')&&!path.startsWith('blob:'))throw new Error('Use a self-contained GLB preview with embedded textures.');return path;});
      const gltf=await new GLTFLoader(manager).parseAsync(bytes,'');parsed=gltf.scene;
      if(!current()){disposeModel(parsed);parsed=null;return;}
      model=parsed;parsed=null;scene.add(model);
      const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());fit=bounds.getSize(new THREE.Vector3()).length();
      if(bounds.isEmpty()||!Number.isFinite(fit))throw new Error('This preview does not contain visible 3D geometry.');
      fit=Math.max(.01,fit);model.position.sub(center);fitView();
      model.traverse(node=>{if(node.isMesh&&node.name&&names.length<24){const label=document.createElement('span');label.textContent=node.name.replace(/[_-]/g,' ').slice(0,70);label.hidden=true;labels.append(label);names.push({node,label});}});
      if(gltf.animations?.length){mixer=new THREE.AnimationMixer(model);clip=mixer.clipAction(gltf.animations[0]);}
      host.dataset.modelReady='true';
    }catch(error){
      if(parsed)disposeModel(parsed);
      const show=current()&&error.name!=='AbortError';dispose();
      if(show){host.replaceChildren();host.classList.remove('shop-model-stage');const message=document.createElement('p');message.textContent=error.message;host.append(message);}
    }
  })();
  return dispose;
}
