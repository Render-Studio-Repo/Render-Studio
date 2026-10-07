/** One cached, native-scale Quest Touch Plus asset per hand; no per-avatar loader. */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const assets = new Map();
export function attachQuestController(THREE, parent, hand, alive = () => true) {
  if (!['left', 'right'].includes(hand)) return;
  if (!assets.has(hand)) assets.set(hand, new GLTFLoader().loadAsync(new URL(`../assets/controllers/quest-touch-plus/${hand}.glb`, import.meta.url).href).then(gltf => {
    const geometries=[], materials=new Set(); let original;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);
      geometries.push(geometry.index ? geometry.toNonIndexed() : geometry);
      if(geometry.index)geometry.dispose();
      original ||= o.material; materials.add(o.material);
      o.geometry.dispose();
    });
    // These bundled assets have one atlas/material. Bake the static button parts
    // once so each remote hand costs one draw call, rather than six.
    const geometry=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());
    if(!geometry)throw new Error('Quest controller geometry could not be merged');
    geometry.userData.xrShared=true;
    const material=new THREE.MeshBasicMaterial({color:original.color,map:original.map,toneMapped:false});
    material.userData.xrShared=true;materials.forEach(m=>m.dispose());
    const root=new THREE.Group();root.add(new THREE.Mesh(geometry,material));return root;
  }).catch(() => null));
  return assets.get(hand).then(template => {
    if (!template || !alive()) return false;
    for (const child of [...parent.children]) { child.traverse(o => { if (!o.geometry?.userData?.xrShared) o.geometry?.dispose?.(); o.material?.dispose?.(); }); parent.remove(child); }
    const model = template.clone(true);
    model.traverse(o => { o.raycast = () => {}; o.userData.xrNoCollision = true; });
    parent.add(model); parent.userData.questController = hand; return true;
  });
}
