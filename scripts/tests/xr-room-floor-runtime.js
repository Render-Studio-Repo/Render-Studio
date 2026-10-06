// Browser fixture extension: actual navigation, board, shared importer and GLTF loader.
async id => {
  const {THREE,scene,lobby,pose} = fixture;
  const {createXrBoard} = await import('/xr/xr-board.js?v=roomfloor1');
  const nav = await import('/xr/xr-room-navigation.js?v=roomfloor1-20260916-vrwalk1');
  const {createXrPublicDrops,applyObjectPose} = await import('/xr/xr-public-drops.js?v=roomfloor1');
  const {createPublicProjectImporter} = await import('/xr/xr-public-import.js?v=roomfloor1');
  const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js');
  const viewport = await (await fetch('/xr/viewport-xr.js')).text();
  const source = name => { const start=viewport.indexOf('  '+(name==='spawnPublicDrop'?'async ':'')+'function '+name+'(');
    if(start<0)throw Error('Missing '+name);
    return viewport.slice(start,viewport.indexOf('\n  function ',start+1)); };
  const board=createXrBoard({THREE,scene});
  const identity=new THREE.Matrix4();
  const session={id};
  const base={matrix:identity,getOffsetReferenceSpace(t) {
    return {matrix:new THREE.Matrix4().compose(new THREE.Vector3(t.position.x,t.position.y,t.position.z),
      new THREE.Quaternion(t.orientation.x,t.orientation.y,t.orientation.z,t.orientation.w),new THREE.Vector3(1,1,1))};
  }};
  let space=base;
  const renderer={xr:{getSession:()=>session,getReferenceSpace:()=>space,setReferenceSpace:next=>{space=next;}}};
  window.XRRigidTransform=class {constructor(position,orientation){this.position=position;this.orientation=orientation;}};
  board.captureRefSpace(renderer);
  const nativeHeight=id==='test-alice'?1.6:1.85;
  const raw=new THREE.Vector3(2,nativeHeight,-3);
  // Reproduce a stale elevated board/seated reference space on one user.
  board.applyLocomotion(renderer,{p:[0,id==='test-bob'?-3:0,0],yaw:0});
  const drops=createXrPublicDrops({THREE,scene,loader:new GLTFLoader(),getUserId:()=>id});drops.setVisible(true);
  scene.add(new THREE.AmbientLight(0xffffff,2));
  const _headPos=new THREE.Vector3(),_headQuat=new THREE.Quaternion();
  function getHeadPose() {
    _headPos.copy(raw).applyMatrix4(space.matrix.clone().invert());
    _headQuat.setFromRotationMatrix(space.matrix).invert();
  }
  function publishPose() {
    getHeadPose();pose.head={p:_headPos.toArray(),q:_headQuat.toArray()};
    pose.left={p:[_headPos.x-.25,_headPos.y-.4,_headPos.z-.1],q:[0,0,0,1]};
    pose.right={p:[_headPos.x+.25,_headPos.y-.4,_headPos.z-.1],q:[0,0,0,1]};lobby.sendPose(pose);
  }
  const makeActions=new Function('THREE','renderer','xrBoard','getHeadPose','_headPos','_headQuat','publicDrops','sendPublicXr','localSocialUserId','socialUsers',
    'floorRecenter','roomFloorSeats','newDropObjectId',`
    let presenting=true,armed=false,pendingRoomFloorSeat=null,menuFooterHint='',poseForceSend=false;
    const roomHeadEuler=new THREE.Euler(0,0,0,'YXZ');
    const isDimosTeleopArmed=()=>armed,publicRoomJoined=()=>true,sharedXrSession=()=>true,onStatus=()=>{};
    const sendSharedXr=sendPublicXr,meshForCatalog=()=>null;
    const frontDropPose=()=>({p:[0,1.2,0],q:[0,1,0,0],s:[1,1,1]}),noteDropInteract=()=>{};
    ${source('applyRoomFloorSeat')} ${source('recenterRoomFloor')} ${source('spawnPublicDrop')}
    return {applyRoomFloorSeat,recenterRoomFloor,spawnPublicDrop,setArmed:v=>{armed=v;},pending:()=>pendingRoomFloorSeat};
  `);
  const actions=makeActions(THREE,renderer,board,getHeadPose,_headPos,_headQuat,drops,m=>lobby.send(m),()=>id,
    ()=>lobby.getOccupants(),nav.floorRecenter,nav.roomFloorSeats,()=> 'shared-test-model');
  const applyMessage=m=>{
    if(m.type==='xr.drop')drops.upsert(m);
    if(m.type==='xr.objects.sync')drops.syncList(m.objects);
    if(m.type==='xr.object')drops.applyObject(m);
    if(m.type==='xr.seat'&&m.action==='floor-recenter') {
      const seat=m.seats.find(s=>s.user_id===id);if(seat){actions.applyRoomFloorSeat(seat);publishPose();}
    }
  };
  sockets.at(-1).addEventListener('message',event=>applyMessage(JSON.parse(event.data)));
  const Socket=window.WebSocket;
  window.WebSocket=class extends Socket {constructor(url){super(url);this.addEventListener('message',event=>applyMessage(JSON.parse(event.data)));}};
  const importer=createPublicProjectImporter({join:()=>lobby.join(),api:async path=>(await fetch(path)).json(),
    createShareUrl:async()=>'/share/test-model',getProjectId:()=> 'test-project',getSelectedFile:()=> 'cube.gltf',getProjects:()=>[],
    spawn:actions.spawnPublicDrop});
  fixture.room={board,nav,drops,actions,importer,publishPose,getHeadPose,head:_headPos,raw,renderer,base,nativeHeight};
  fixture.room.moveObject=(p,grabbing)=>{
    const row=drops.get('shared-test-model');
    if(grabbing&&!drops.setLocalGrabId(row.id))return false;
    applyObjectPose(row.root,{p,q:[0,1,0,0],s:[1,1,1]},THREE);
    lobby.send({type:'xr.object',object_id:row.id,pose:drops.packPose(row.root),grabbing});
    if(!grabbing)drops.setLocalGrabId('');
    return true;
  };
  const makeGrip = new Function('THREE','renderer','publicDrops','sendPublicXr',`
    let gripGrab=null,scaleGrab=null,grabState=null,panelDrag=null,menuFooterHint='',presentationScale=1,lastDropSendAt=0;
    let shareAimTarget=null,tossSamples=[];
    const hand=new THREE.Group(),gripGrabAnchor=new THREE.Group();
    const _grabInv=new THREE.Matrix4(),_grabWorld=new THREE.Matrix4(),_grabNext=new THREE.Matrix4();
    const _v=new THREE.Vector3(),_q=new THREE.Quaternion(),_s=new THREE.Vector3(),_grabOne=new THREE.Vector3(1,1,1);
    const blurXrDom=()=>{},squeezeHandIndex=()=>0,grabAttachObject=()=>hand,objectIsPosed=()=>true;
    const getLiveMesh=()=>null,resolveStudioGripTarget=({hitMesh})=>hitMesh,posedControllerForHand=()=>hand;
    const pickNearGrabMesh=()=>publicDrops.nearest(hand.position,.1)?.root,pickGrabMesh=()=>null;
    const publicRoomJoined=()=>true,sampleTossPoint=()=>{},sampleXrHands=()=>({squeezes:[true,false]});
    const sendSharedXr=sendPublicXr;
    ${source('copyWorldPose')} ${source('sendDropTransform')} ${source('startGripGrabOn')}
    ${source('updateGripGrab')} ${source('releaseGripGrab')}
    return {
      grab:()=>{hand.position.copy(publicDrops.get('shared-test-model').root.position);hand.updateMatrixWorld(true);startGripGrabOn(hand);return !!gripGrab;},
      move:delta=>{hand.position.add(new THREE.Vector3(...delta));hand.updateMatrixWorld(true);updateGripGrab();},
      release:()=>releaseGripGrab(hand),
    };
  `);
  fixture.room.grip=makeGrip(THREE,renderer,drops,m=>lobby.send(m));
  publishPose();
  return {nativeHeight,initialHeight:_headPos.y};
}
