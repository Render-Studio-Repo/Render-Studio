/** One active Astra per account in this browser. A headset session wins over background tabs. */
export function createVoiceTabOwner({getUser, isVr, isActive, stop, Channel=globalThis.BroadcastChannel}={}) {
  const id=globalThis.crypto?.randomUUID?.() || String(Math.random());
  const channel=Channel ? new Channel('render3d-astra-owner-v1') : null;
  let owned=false, blocked=false;
  const send=type=>channel?.postMessage({type,id,user:String(getUser?.()||''),vr:!!isVr?.()});
  if(channel)channel.onmessage=({data})=>{
    if(!data || data.id===id || !data.user || data.user!==String(getUser?.()||''))return;
    if(data.type==='claim') {
      if((owned||isActive?.()) && isVr?.() && !data.vr){send('headset-active');return;}
      if(owned||isActive?.()){owned=false;stop?.();}
    } else if(data.type==='headset-active' && !isVr?.()) {blocked=true;owned=false;stop?.();}
  };
  return {
    async claim(){blocked=false;owned=true;send('claim');await new Promise(r=>setTimeout(r,40));if(blocked||!owned)throw Error('Astra is active in another Studio window. Use its Stop Listening button first.');},
    release(){owned=false;},
    dispose(){owned=false;channel?.close();},
  };
}
