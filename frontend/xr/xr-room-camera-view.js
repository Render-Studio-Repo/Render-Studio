/** Video windows live in room coordinates; changing their pose never drives the robot. */
export function createRoomCameraView({THREE,scene,getUserId,onPose,onStop,getDefaultPose}) {
  const windows=new Map(), poses=new Map(), grips=new Map(), ray=new THREE.Raycaster();
  let lastSend=0;
  const poseOf=root=>({p:root.position.toArray(),q:root.quaternion.toArray(),s:root.scale.toArray()});
  function remove(id) {
    const row=windows.get(id); if(!row)return;
    for(const [hand,g] of grips)if(g.row===row)grips.delete(hand);
    scene.remove(row.root); row.video.pause(); row.video.srcObject=null;
    row.root.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});
    windows.delete(id); poses.delete(id);
  }
  function setPose(id,pose) {
    if(!pose)return; poses.set(id,pose);
    const row=windows.get(id); if(!row||[...grips.values()].some(g=>g.row===row))return;
    row.root.position.fromArray(pose.p);row.root.quaternion.fromArray(pose.q);row.root.scale.fromArray(pose.s);row.root.updateMatrixWorld(true);
  }
  function setStream(id,stream) {
    if(!stream){remove(id);return;}
    const saved=poses.get(id);remove(id);if(saved)poses.set(id,saved);
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.autoplay=true;video.srcObject=stream;
    void video.play().catch(()=>{});
    const texture=new THREE.VideoTexture(video);texture.colorSpace=THREE.SRGBColorSpace;
    const root=new THREE.Group();root.name='Room outward camera';
    const screen=new THREE.Mesh(new THREE.PlaneGeometry(.64,.48),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false}));root.add(screen);
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=112;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#17212c';ctx.fillRect(0,0,1024,112);
    ctx.fillStyle='#b7f5d0';ctx.font='28px system-ui';ctx.fillText(id===getUserId()?'LIVE · Your outward camera':'LIVE · Room outward camera',24,45);
    ctx.fillStyle='#c3d0de';ctx.font='21px system-ui';ctx.fillText('Grip to move · − / + resize',24,85);
    ctx.font='40px system-ui';ctx.fillText('−',785,67);ctx.fillText('+',875,67);
    if(id===getUserId()){ctx.font='22px system-ui';ctx.fillText('Stop',954,67);}
    const bar=new THREE.Mesh(new THREE.PlaneGeometry(.64,.07),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),side:THREE.DoubleSide,toneMapped:false}));bar.position.y=.28;root.add(bar);
    const row={id,root,video,screen,bar};windows.set(id,row);scene.add(root);
    setPose(id,poses.get(id)||getDefaultPose?.()||{p:[0,1.45,-.55],q:[0,0,0,1],s:[1,1,1]});return row;
  }
  function pick(inputRay) {
    ray.ray.copy(inputRay);
    const hits=ray.intersectObjects([...windows.values()].map(r=>r.root),true);
    const hit=hits[0];if(!hit)return null;
    const row=[...windows.values()].find(r=>hit.object.parent===r.root);if(!row)return null;
    let action=()=>{void row.video.play().catch(()=>{});};
    if(hit.object===row.bar){
      const x=hit.uv.x;
      if(x>.93&&row.id===getUserId())action=onStop;
      else if(x>.74&&x<.93)action=()=>{
        row.root.scale.setScalar(THREE.MathUtils.clamp(row.root.scale.x*(x<.83?.85:1.15),.15,4));onPose(row.id,poseOf(row.root));
      };
    }
    return {kind:'robotics-workspace-action',point:hit.point,distance:hit.distance,cell:{action},cameraRow:row};
  }
  function beginGrip(hand,source,aim=source) {
    source.updateWorldMatrix(true,false);aim.updateWorldMatrix(true,false);
    const p=new THREE.Vector3().setFromMatrixPosition(aim.matrixWorld),q=new THREE.Quaternion();aim.getWorldQuaternion(q);
    const hit=pick(new THREE.Ray(p,new THREE.Vector3(0,0,-1).applyQuaternion(q)));
    if(!hit||hit.distance>3)return false;
    const row=hit.cameraRow;if([...grips.values()].some(g=>g.row===row))return true;
    row.root.updateMatrixWorld(true);
    grips.set(hand,{row,source,offset:new THREE.Matrix4().copy(source.matrixWorld).invert().multiply(row.root.matrixWorld)});return true;
  }
  function endGrip(hand) {
    const g=grips.get(hand);if(!g)return false;
    grips.delete(hand);onPose(g.row.id,poseOf(g.row.root));return true;
  }
  function tick(now) {
    for(const g of grips.values()){
      g.source.updateWorldMatrix(true,false);
      new THREE.Matrix4().multiplyMatrices(g.source.matrixWorld,g.offset).decompose(g.row.root.position,g.row.root.quaternion,g.row.root.scale);
      if(now-lastSend>90)onPose(g.row.id,poseOf(g.row.root));
    }
    if(grips.size&&now-lastSend>90)lastSend=now;
  }
  function clear(){for(const id of [...windows.keys()])remove(id);poses.clear();grips.clear();}
  return {windows,setStream,setPose,pick,beginGrip,endGrip,tick,clear};
}
