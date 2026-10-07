/** Wake transcription uses only an already-permitted headset microphone. Never acquires or stops its tracks. */
export function createWakeFallback({getStream,transcribe,onText,onStatus,Recorder=globalThis.MediaRecorder,Audio=globalThis.AudioContext}={}) {
  let recorder=null,context=null,source=null,meter=null,timer=null,epoch=0,busy=false,speech=false,lastWords='';
  function stop(){
    epoch++;clearInterval(timer);timer=null;
    if(recorder){recorder.ondataavailable=null;recorder.onstop=null;try{recorder.stop();}catch{}recorder=null;}
    source?.disconnect();source=null;meter=null;void context?.close()?.catch(()=>{});context=null;lastWords='';
  }
  function start(){
    if(recorder)return true;
    const stream=getStream?.();if(!Recorder||!Audio||!transcribe||!stream?.getAudioTracks?.().some(t=>t.readyState==='live'))return false;
    const current=++epoch;
    context=new Audio();source=context.createMediaStreamSource(stream);meter=context.createAnalyser();meter.fftSize=512;source.connect(meter);
    void context.resume().catch(()=>{});
    const samples=new Float32Array(512);let startAt=Date.now();
    const makeRecorder=()=>{
      if(epoch!==current)return;
      const chunks=[];speech=false;startAt=Date.now();
      recorder=new Recorder(stream);const active=recorder;
      active.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      active.onstop=()=>{
        if(epoch!==current)return;
        const spoken=speech,blob=new Blob(chunks,{type:active.mimeType||'audio/webm'});
        makeRecorder();
        if(!spoken||busy||blob.size<100)return;
        busy=true;
        void Promise.resolve().then(()=>transcribe(blob)).then(text=>{
          if(epoch!==current)return;
          const words=String(text||'').trim();
          if(words){onText(`${lastWords} ${words}`.trim());lastWords=words.split(/\s+/).slice(-2).join(' ');}
        }).catch(error=>{if(epoch===current){stop();onStatus?.(`Wake listening stopped: ${error.message}. Click Hey to retry voice.`);}}).finally(()=>{busy=false;});
      };
      active.onerror=()=>{if(epoch===current){stop();onStatus?.('Wake listening unavailable. Click Hey to talk.');}};
      active.start();
    };
    try {makeRecorder();}catch(error){stop();onStatus?.(error.message);return false;}
    timer=setInterval(()=>{
      if(epoch!==current)return;
      meter.getFloatTimeDomainData(samples);let energy=0;for(const v of samples)energy+=v*v;
      if(Math.sqrt(energy/samples.length)>.018)speech=true;
      if(Date.now()-startAt>=3500&&recorder?.state==='recording')recorder.stop();
      if(!stream.getAudioTracks().some(t=>t.readyState==='live'))stop();
    },100);
    return true;
  }
  return {start,stop,get running(){return !!recorder;}};
}
