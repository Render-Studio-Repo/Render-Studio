async () => {
  const THREE = await import('three');
  const {createXrRoboticsWorkspace} = await import('/xr/xr-robotics-workspace.js?v=viserroom2');
  const checks = [], statuses = [], sockets = [];
  const check = (value, label) => {if (!value) throw Error(label); checks.push(label);};
  const flush = () => new Promise(resolve => setTimeout(resolve, 25));
  let descriptor, deferList = false, resolveList, nextId = 0;
  const b64 = a => btoa(String.fromCharCode(...new Uint8Array(a.buffer)));
  const box = new THREE.BoxGeometry(.2, .5, .2);
  const messages = [
    {type:'MeshMessage',name:'/robot/arm',props:{vertices:{base64:b64(box.attributes.position.array)},faces:{base64:b64(new Uint32Array(box.index.array))},color:[130,150,170]}},
    {type:'SetPositionMessage',name:'/robot/arm',position:[0,0,.4]},
  ];
  const fresh = () => ({id:'robot-'+(++nextId),owner:'owner',owner_name:'Owner',status:'live',share:false,emotes_shared:false,cameras_shared:false,pose:{position:[0,.75,-.75],quaternion:[0,0,0,1],scale:.55}});
  window.WebSocket = class {
    constructor(url) {this.url=url;this.readyState=1;sockets.push(this);setTimeout(()=>this.emit({type:'snapshot',scene:structuredClone(descriptor),messages}),0);}
    emit(data) {if(this.readyState===1)this.onmessage?.({data:JSON.stringify(data)});}
    send() {}
    close() {this.readyState=3;this.onclose?.({code:1006});}
  };
  window.fetch = async (url, options={}) => {
    let data;
    if(url==='/api/robotics/workspace')data={presets:[]};
    else if(url==='/api/robotics/live') {
      if(options.method==='POST'){descriptor ||= fresh();data=structuredClone(descriptor);}
      else if(deferList){deferList=false;data=await new Promise(resolve=>{resolveList=resolve;});}
      else data={scenes:descriptor?[structuredClone(descriptor)]:[]};
    } else if(url.endsWith('/action')) {
      const {action,value}=JSON.parse(options.body);
      if(action==='pose')descriptor.pose=value;
      else if(action==='sharing')descriptor.share=value.room;
      else throw Error('Unexpected robot command: '+action);
      for(const socket of sockets)socket.emit({type:'status',scene:structuredClone(descriptor)});
      data={ok:true,scene:structuredClone(descriptor)};
    } else throw Error('Unexpected request: '+url);
    return {ok:true,json:async()=>data};
  };
  let joined=true;
  const make = id => createXrRoboticsWorkspace({THREE,scene:new THREE.Scene(),getToken:()=>id,getUserId:()=>id,
    getHeadPose:()=>({position:new THREE.Vector3(0,1.5,0),quaternion:new THREE.Quaternion()}),getTeleop:()=>({armed:false}),
    getFeed:()=>({}),isJoined:()=>joined,onStatus:(...s)=>statuses.push(s),getPrinter:()=>({}),onPrinter:()=>{}});
  const owner=make('owner');
  deferList=true;owner.tick({presenting:true,now:4000});await flush();
  await owner.open('viser');await flush();
  const first=[...owner.test.robots.values()][0];
  check(descriptor.share, 'Manual import enables room visibility');
  resolveList({scenes:[]});await flush();
  check(owner.test.robots.get(descriptor.id)===first && first.root.visible, 'Stale room response cannot delete newly imported OpenArm');
  check(first.connected && first.nodes.has('/robot/arm'), 'Imported geometry and live scene handshake are ready');

  const guest=make('guest');guest.tick({presenting:true,now:4000});await flush();
  let remote=guest.test.robots.get(descriptor.id);
  check(remote?.connected && remote.nodes.has('/robot/arm'), 'A room member receives robot geometry without enabling teleop');
  const guestSocket=sockets.at(-1);guestSocket.close();
  remote.receive({type:'status',scene:structuredClone(descriptor)});
  guest.tick({presenting:true,now:8000});await flush();
  remote=guest.test.robots.get(descriptor.id);
  check(remote?.connected && remote.root.visible && sockets.at(-1)!==guestSocket, 'Disconnected viewer reconnects even after a late server status');
  descriptor.pose.position=[.3,.8,-1];
  for(const socket of sockets)socket.emit({type:'status',scene:structuredClone(descriptor),messages:[{type:'SetPositionMessage',name:'/robot/arm',position:[.1,0,.45]}]});
  check(JSON.stringify(first.root.position.toArray())===JSON.stringify(remote.root.position.toArray()),'Placement updates match for owner and guest');
  check(remote.nodes.get('/robot/arm').position.x===.1,'Live joint transforms reach the guest');

  sockets[0].close();owner.tick({presenting:true,now:8000});await flush();
  check(owner.test.robots.get(descriptor.id)?.connected,'Owner reconnects to the same scene identity');
  joined=false;guest.tick({presenting:true,now:8500});
  check(guest.test.robots.size===0,'Leaving the room removes remote robot geometry');
  joined=true;deferList=true;guest.tick({presenting:true,now:12000});await flush();guest.close();resolveList({scenes:[structuredClone(descriptor)]});await flush();
  check(guest.test.robots.size===0,'Closing VR cancels a late room response');
  const current=owner.test.robots.get(descriptor.id),oldId=descriptor.id;
  descriptor=null;current.descriptor.status='disconnected';owner.tick({presenting:true,now:12000});await flush();await flush();
  check(owner.test.robots.size===1 && descriptor.id!==oldId && descriptor.share,'Missing server scene is recreated once and remains shared');
  check(descriptor.pose.position[0]===.3,'Recovery preserves the robot placement');
  owner.close();guest.close();
  return {checks,passed:true,statuses,source:'Real Three.js and workspace/Viser renderer with mocked API and WebSockets; no robot commands.'};
}
