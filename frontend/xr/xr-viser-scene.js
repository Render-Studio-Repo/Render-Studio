/** Render Viser messages in Studio's existing renderer; no iframe or extra XR session. */
import {
  isViserSceneFurnitureName,
  muteViserHelperRaycast,
  viserAimHitsRobot,
} from "./xr-viser-grip.js?v=20260916-visergrip1&robot-size=20260927-1&vrrobot=20260927-2";

import { normalizeViserPresentation } from "./xr-viser-presentation.js?v=20260927-robot-size1&vrrobot=20260927-2";

export {
  VISER_GRIP_CACHE,
  VISER_GRAB_MAX_EXTENT_M,
  isViserSceneFurnitureName,
  viserMeshExceedsGrabExtent,
  isViserGrabMesh,
  viserAimHitsRobot,
} from "./xr-viser-grip.js?v=20260916-visergrip1&robot-size=20260927-1&vrrobot=20260927-2";

export function applySimulationFrameToViserRoot(root, run) {
  if (!root || !run?.runId || !run?.sample) return false;
  root.userData.simulationRun = {
    runId: String(run.runId),
    scene: String(run.scene || run.sample.scene || ""),
    status: String(run.status || "running"),
    sample: run.sample,
  };
  return true;
}

export function createXrViserScene({ THREE, scene, api, getToken, onChange = () => {}, onError = () => {} }) {
  const root=new THREE.Group();root.name='Live OpenArm';root.userData.xrViserRobot=true;root.visible=false;scene.add(root);
  const content=new THREE.Group();content.rotation.x=-Math.PI/2;content.visible=false;root.add(content);
  const nodes=new Map(), gui=new Map(), controls=new Map(), pending=new Set();
  let descriptor=null,socket=null,heartbeat=0,disposed=false,interacting=false,connected=false,connectionTimer=0;
  let loadError='',connectionState='connecting';
  let loader=null,geometryDirty=false;
  async function glbLoader(){
    if(!loader){const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');loader=new GLTFLoader();}
    return loader;
  }
  function node(name) {
    if(nodes.has(name))return nodes.get(name);
    const group=new THREE.Group();group.name=name;nodes.set(name,group);
    const parent=name.substring(0,name.lastIndexOf('/'));
    (parent ? node(parent) : content).add(group);return group;
  }
  function clearGeometry(group) {
    for(const child of [...group.children]) if(child.userData.viserGeometry) {
      group.remove(child);child.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [o.material].flat())m.dispose();});
    }
  }
  function bytes(v) {
    const s=v?.base64 || v?.data?.base64;if(!s)return new ArrayBuffer(0);
    return Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
  }
  function appearance(group,props={}) {
    if(typeof props.scale==='number')group.scale.setScalar(props.scale);
    group.traverse(o=>{if(!o.material)return;for(const m of [o.material].flat()) {
      if(props.color)m.color?.setRGB(...props.color.map(v=>v/255));
      if(props.opacity!=null){m.opacity=props.opacity;m.transparent=props.opacity<1;}
      if(props.wireframe!=null)m.wireframe=props.wireframe;
    }});
  }
  async function message(m) {
    const type=m.type;
    // The room shows the live robot. Viser's red target/ghost and collision
    // copies otherwise overlap it and multiply headset geometry. Keep target
    // transform controls, but omit those duplicate model meshes in both formats.
    if(['GlbMessage','MeshMessage'].includes(type) && isViserSceneFurnitureName(m.name||''))return;
    if(type.startsWith('Gui')) {
      if(type==='GuiRemoveMessage')gui.delete(m.uuid);
      else if(type==='GuiUpdateMessage') {const row=gui.get(m.uuid);if(row){Object.assign(row.props,m.updates);if('value' in m.updates)row.value=m.updates.value;}}
      else if(m.uuid)gui.set(m.uuid,structuredClone(m));
      onChange();return;
    }
    if(!m.name)return;
    if(type==='RemoveSceneNodeMessage') {
      for(const [name,n] of nodes)if(name===m.name || name.startsWith(m.name+'/')){n.removeFromParent();clearGeometry(n);nodes.delete(name);controls.delete(name);}return;
    }
    const group=node(m.name),p=m.props||{};
    if(type==='SetPositionMessage')group.position.fromArray(m.position);
    else if(type==='SetOrientationMessage')group.quaternion.set(m.wxyz[1],m.wxyz[2],m.wxyz[3],m.wxyz[0]);
    else if(type==='SetSceneNodeVisibilityMessage')group.visible=m.visible;
    else if(type==='SceneNodeUpdateMessage'){group.userData.viserProps={...group.userData.viserProps,...m.updates};appearance(group,m.updates);}
    else if(type==='GlbMessage') {
      const key=p.glb_data?.asset;if(!key)return;
      const gltf=await (await glbLoader()).loadAsync(`/api/robotics/live/${descriptor.id}/asset/${key}?token=${encodeURIComponent(getToken())}`);
      if(disposed || nodes.get(m.name)!==group)return;
      clearGeometry(group);gltf.scene.userData.viserGeometry=true;
      gltf.scene.traverse(o=>{
        if(o.isLine||o.isLineSegments||o.isPoints||o.isSprite)muteViserHelperRaycast(o);
        else if(o.isMesh)o.userData.viserGeometry=true;
      });
      group.add(gltf.scene);appearance(group,{...p,...group.userData.viserProps});geometryDirty=true;
    } else if(type==='MeshMessage') {
      const vertices=new Float32Array(bytes(p.vertices)),faces=new Uint32Array(bytes(p.faces));
      if(!vertices.length || faces.length/3>100000)return;
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setIndex(new THREE.BufferAttribute(faces,1));geometry.computeVertexNormals();geometry.computeBoundingBox();
      const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xb0b7c0,roughness:0.65}));mesh.userData.viserGeometry=true;mesh.name=m.name||'';clearGeometry(group);group.add(mesh);appearance(group,p);geometryDirty=true;
    } else if(type==='TransformControlsMessage') {
      clearGeometry(group);
      const axes=new THREE.AxesHelper(0.14);axes.userData.viserGeometry=true;axes.userData.viserHelper=true;muteViserHelperRaycast(axes);group.add(axes);
      const handle=new THREE.Mesh(new THREE.SphereGeometry(0.035,10,8),new THREE.MeshBasicMaterial({color:0x4ec9b0,depthTest:false}));
      handle.userData.viserGeometry=true;handle.userData.viserTarget=m.name;handle.renderOrder=2000;group.add(handle);controls.set(m.name,group);onChange();
    }
  }
  function setPose(p) {
    if(!p)return;
    root.position.fromArray(p.position);
    root.quaternion.fromArray(p.quaternion);
    root.scale.setScalar(Math.max(0.05,Math.min(5,p.scale||0.55)));
    const tableY = Number(root.userData.tableHeightM);
    if (Number.isFinite(tableY)) root.position.y = tableY;
  }
  function onSimulationFeed(e) {
    const mm = Number(e?.detail?.tableHeightMm);
    if (Number.isFinite(mm)) root.userData.tableHeightM = mm / 1000;
    root.userData.standstill = e?.detail?.standstill !== false;
    if (descriptor?.pose) setPose(descriptor.pose);
    else if (Number.isFinite(root.userData.tableHeightM)) root.position.y = root.userData.tableHeightM;
  }
  window.addEventListener("render3d:simulation-feed", onSimulationFeed);
  function onSimulationFrame(e) {
    if (applySimulationFrameToViserRoot(root, e?.detail)) onChange({ type: "simulation-frame", run: root.userData.simulationRun });
  }
  window.addEventListener("render3d:simulation-frame", onSimulationFrame);
  function receive(data) {
    if(disposed)return;
    if(data.type==='simulation-frame'){
      if(applySimulationFrameToViserRoot(root,data.run))onChange({type:'simulation-frame',run:root.userData.simulationRun});
      return;
    }
    if(data.scene){descriptor=data.scene;if(!interacting&&!root.userData.xrPlacementLocked)setPose(descriptor.pose);onChange();}
    if(data.type==='sharing-revoked'){onChange(data);return;}
    if(data.type==='error'){if(descriptor)descriptor.status='disconnected';onChange();onError(data.error);return;}
    for(const m of data.messages||[]){const task=message(m).catch(e=>{if(!disposed){loadError=e.message;onError('Could not load robot geometry: '+e.message);onChange();}});pending.add(task);task.finally(()=>{pending.delete(task);if(!disposed && !pending.size && geometryDirty){geometryDirty=false;content.visible=normalizeViserPresentation(THREE,content);}});}
  }
  function connect(d) {
    descriptor=d;root.visible=true;setPose(d.pose);disposed=false;connectionState='connecting';
    const current=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/robotics/live/${d.id}/ws?token=${encodeURIComponent(getToken())}`);socket=current;
    connectionTimer=setTimeout(()=>{if(socket===current&&!connected){current.close();onError('Live robot connection timed out. Retrying…');}},10000);
    socket.onmessage=e=>{if(disposed||socket!==current)return;try{const data=JSON.parse(e.data);if(data.type==='snapshot'){connected=true;connectionState='connected';clearTimeout(connectionTimer);}receive(data);}catch(error){onError(error.message);}};
    socket.onclose=()=>{if(disposed||socket!==current)return;clearInterval(heartbeat);clearTimeout(connectionTimer);connected=false;connectionState='disconnected';onChange();onError('Live robot disconnected. Reconnecting…');};
    heartbeat=setInterval(()=>{if(socket?.readyState===1)socket.send('ping');},10000);
  }
  const action=(name,value={})=>api(`/api/robotics/live/${descriptor.id}/action`,{method:'POST',body:JSON.stringify({action:name,value}),headers:{'Content-Type':'application/json'}});
  function pick(raycaster){const hits=raycaster.intersectObjects([...controls.values()],true);const h=hits.find(h=>h.object.visible!==false&&h.object.userData.viserTarget);return h?{...h,name:h.object.userData.viserTarget}:null;}
  function pickMesh(raycaster){return viserAimHitsRobot(raycaster,root);}
  function close(){disposed=true;connected=false;clearInterval(heartbeat);clearTimeout(connectionTimer);window.removeEventListener("render3d:simulation-feed", onSimulationFeed);window.removeEventListener("render3d:simulation-frame", onSimulationFrame);if(socket){socket.onclose=null;socket.close();}socket=null;root.visible=false;for(const n of nodes.values())clearGeometry(n);nodes.clear();gui.clear();controls.clear();content.clear();root.removeFromParent();}
  return {root,nodes,gui,controls,connect,receive,action,pick,pickMesh,close,get descriptor(){return descriptor;},get connected(){return connected;},get connectionState(){return connectionState;},get loadError(){return loadError;},setInteracting:value=>{interacting=!!value;},setPlacementLocked:value=>{root.userData.xrPlacementLocked=!!value;},setPose,settled:()=>Promise.all([...pending])};
}
