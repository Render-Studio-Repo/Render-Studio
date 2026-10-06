/** CC0 Kenney avatars, loaded only when selected. Shared geometry and one material. */
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
export const AVATAR_ASSETS = [
 {id:'kenney-cyborg',label:'Cyborg',file:'cyborgFemaleA.glb'},
 {id:'kenney-skater-f',label:'Skater · teal',file:'skaterFemaleA.glb'},
 {id:'kenney-skater-m',label:'Skater · cap',file:'skaterMaleA.glb'},
];
const cache=new Map();
export function applyAvatarAsset(root,source,THREE){
 if(root.userData.assetSource===source)return;
 root.userData.assetSource=source;
 if(root.userData.assetBody){root.remove(root.userData.assetBody);root.userData.assetBody=null;root.userData.assetMixer?.stopAllAction();root.userData.assetMixer=null;}
 const procedural=root.userData.proceduralChildren||=root.children.slice();
 for(const c of procedural)c.visible=true;
 const asset=AVATAR_ASSETS.find(a=>a.id===source);if(!asset)return;
 if(!cache.has(asset.id))cache.set(asset.id,new GLTFLoader().loadAsync(`/assets/avatars/kenney/${asset.file}`).catch(e=>{cache.delete(asset.id);throw e;}));
 cache.get(asset.id).then(gltf=>{
  if(root.userData.assetSource!==source)return;
  const body=clone(gltf.scene);body.position.y=-1.58;body.rotation.y=Math.PI;
  body.traverse(o=>{if(o.isMesh){o.frustumCulled=true;o.castShadow=false;}});
  for(const c of procedural)c.visible=false;
  root.add(body);root.userData.assetBody=body;
  if(gltf.animations.length){const mixer=new THREE.AnimationMixer(body);mixer.clipAction(gltf.animations[0]).play();root.userData.assetMixer=mixer;}
 }).catch(e=>console.warn('[avatar] Asset unavailable, using Studio avatar',e.message));
}
export function tickAvatarAsset(root,now){
 const ud=root?.userData;if(!ud?.assetMixer)return;
 const prev=ud.assetTick||now;if(!ud.assetTick)ud.assetTick=now;if(now-prev<33)return;
 ud.assetTick=now;ud.assetMixer.update(Math.min(.1,(now-prev)/1000));
}
