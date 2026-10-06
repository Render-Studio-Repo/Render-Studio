/** Reconcile the full room inventory with current peers, including older 8-item relays. */
export const INVENTORY_CHANNEL = 'xr-inventory-v1';
export function createRoomInventory({drops,getPeers,getUserId,isJoined,send,sendPose,isHeld=()=>false}) {
  let last=0, known=new Set();const signatures=new Map();
  const peers=()=>new Set(getPeers().map(p=>String(p.id||p)).filter(id=>id&&id!==getUserId()));
  const signal=(peer,data)=>send(peer,{channel:INVENTORY_CHANNEL,...data});
  function receive(peer,message){
    if(!isJoined()||!peers().has(peer))return;
    if(message.kind==='request')for(const row of drops.items.values()){
      if(!row.glbUrl||row.loading)continue;
      signal(peer,{kind:'item',spec:{...row.spec,object_id:row.id,glb_url:row.glbUrl,pose:drops.packPose(row.root)}});
    }
    if(message.kind==='item'&&message.spec?.object_id&&message.spec?.glb_url){
      // A live instance already has more recent transforms than a peer's snapshot.
      if(!drops.get(message.spec.object_id)?.glbUrl)drops.upsert(message.spec);
    }
  }
  function tick(now){
    if(!isJoined()){known.clear();signatures.clear();return;}
    if(now-last<100)return;last=now;
    const current=peers();
    for(const peer of current)if(!known.has(peer))signal(peer,{kind:'request'});
    known=current;
    // Parent/assembly moves must also update adopted components, even if the root is held.
    for(const row of drops.items.values())if(row.adopted){
      const pose=drops.packPose(row.root),sig=JSON.stringify(pose);
      if(signatures.get(row.id)!==sig){
        signatures.set(row.id,sig);
        if(row.spec.grabbing && row.spec.grabber_id!==getUserId() && Date.now()-(row.lastGrabAt||0)<2000)continue;
        sendPose({type:'xr.object',object_id:row.id,pose,grabbing:isHeld(row.root)});
      }
    }
  }
  return {tick,receive};
}
