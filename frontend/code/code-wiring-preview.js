/** Isolated 3D wiring preview. Plays validated visual actions, never uploaded code. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWiringSpatialView } from '../wiring/wiring-spatial-view.js?v=20260930-verified-wiring-1';

export function createCodeWiringPreview(host, {onStatus=()=>{}}={}) {
  const scene=new THREE.Scene();scene.background=new THREE.Color('#111a24');
  const camera=new THREE.PerspectiveCamera(42,1,.1,10000);camera.position.set(210,180,240);
  const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));host.append(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
  scene.add(new THREE.HemisphereLight(0xffffff,0x34445a,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(120,200,80);scene.add(light);
  const grid=new THREE.GridHelper(500,25,0x3e536a,0x243446);grid.position.y=-9;scene.add(grid);
  const spatial=createWiringSpatialView({scene,getMmPerUnit:()=>1,onStatus});spatial.setActive(true);
  let frame=0,visible=true,running=false,plan=null,index=0,until=0;const rotations=new Map();
  function resize(){const{width,height}=host.getBoundingClientRect();if(width&&height){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}}
  const observer=new ResizeObserver(resize);observer.observe(host);
  function reset(){for(const node of spatial.getGroup().children){node.traverse(child=>{if(child.material?.emissive)child.material.emissive.setHex(0x000000);});}rotations.clear();}
  function apply(action){
    const node=spatial.getGroup().children.find(n=>String(n.userData.wiringComponentId)===action.component_id);
    if(node){node.traverse(child=>{if(child.material?.emissive){child.material.emissive.set(action.value?'#45d7a0':'#000000');child.material.emissiveIntensity=action.action==='led'?1.8:.4;}});
      if(action.action==='motor')rotations.set(node,action.value*2);
      if(action.action==='servo'||action.action==='stepper'){let indicator=node.getObjectByName('CodeMotionIndicator');if(!indicator){indicator=new THREE.Mesh(new THREE.BoxGeometry(20,2,3),new THREE.MeshStandardMaterial({color:0xffb566}));indicator.name='CodeMotionIndicator';indicator.position.y=10;node.add(indicator);}indicator.rotation.y=action.action==='servo'?THREE.MathUtils.degToRad(action.value):indicator.rotation.y+THREE.MathUtils.degToRad(action.value);}
    }
    onStatus(action.action==='wait'?`Wait ${action.duration_ms} ms`:`${action.component_id} · ${action.action} ${action.value} · ${action.duration_ms} ms`);
  }
  let previous=0;
  function paint(now){frame=0;if(!visible)return;const dt=Math.min(.1,(now-previous)/1000||0);previous=now;
    if(running&&plan&&now>=until){if(index>=plan.actions.length){if(plan.repeat)index=0;else{running=false;onStatus('Simulation finished.');}}if(running){const action=plan.actions[index++];apply(action);until=now+action.duration_ms;}}
    for(const[node,speed]of rotations){let indicator=node.getObjectByName('CodeMotionIndicator');if(!indicator){indicator=new THREE.Mesh(new THREE.BoxGeometry(20,2,3),new THREE.MeshStandardMaterial({color:0x63cbb2}));indicator.name='CodeMotionIndicator';indicator.position.y=10;node.add(indicator);}indicator.rotation.y+=speed*dt;}
    controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(paint);
  }
  function stop(){running=false;reset();onStatus('Simulation stopped.');}
  return{
    load(schematic){stop();spatial.syncFromSchematic(schematic);const box=new THREE.Box3().setFromObject(spatial.getGroup());if(!box.isEmpty()){const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length()||100;controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(.9,.8,1).multiplyScalar(size));camera.far=Math.max(2000,size*20);camera.updateProjectionMatrix();}resize();if(!frame)frame=requestAnimationFrame(paint);},
    run(next){stop();plan=next;index=0;until=0;running=true;if(!frame)frame=requestAnimationFrame(paint);},
    stop,
    setVisible(on){visible=on;if(!on){stop();cancelAnimationFrame(frame);frame=0;}else{resize();if(!frame)frame=requestAnimationFrame(paint);}},
    dispose(){visible=false;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();spatial.clear();spatial.getGroup().removeFromParent();grid.geometry.dispose();grid.material.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
