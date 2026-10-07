/** One-shot actions on the existing POV capture/recorder and PC notification pipeline. */
export async function runVoiceCaptureAction(id, opts) {
  const {viewport,recorder,projectId,token,upload,api,clientId,isCurrent,onSaved} = opts;
  if(!viewport?.isPresenting?.()) return {ok:false,error:'Enter VR Studio first.'};
  if(!projectId||!token) return {ok:false,error:'Sign in and open a project before capturing.'};
  const current=()=>{if(!isCurrent())throw Error('Project, account or VR session changed. Capture cancelled.');};
  try {
    current();
    if(id==='screenshot_to_pc') {
      // Leave the voice event and XR frame before the existing bounded spectator render.
      await new Promise(resolve=>setTimeout(resolve,80)); current();
      let blob;
      try {
        const canvas=viewport.paintRecordOverlayCanvas(1280,720,{force:true,still:true,antialias:false});
        if(!canvas?.toBlob) throw Error('Headset POV capture is unavailable.');
        blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob?.size) throw Error('Headset screenshot was empty.');
      } finally { if(!recorder?.isRecording?.())viewport.disposeRecordSpectator?.(); }
      current();
      const saved=await upload(blob,{projectId,token,kind:'screenshot',folder:'Screenshots',filename:`VR-screenshot-${Date.now()}.png`});
      if(!saved?.filename) throw Error('Screenshot could not be saved.');
      current();
      const result=await api(`/api/projects/${encodeURIComponent(projectId)}/xr-capture-ready`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'screenshot',filename:saved.filename,url:saved.url,mode_label:'VR',source_client_id:clientId,share_x:false})});
      if(isCurrent())onSaved?.(saved);
      if(!result?.capture) return {ok:false,saved:true,error:'Screenshot saved, but the PC notification was not confirmed.'};
      return {ok:true,saved:true,pcQueued:true,filename:saved.filename,message:'Screenshot sent to the Render popup on your signed-in PC. Keep Render open there.',...(viewport.isPassthroughOn?.()?{captureNote:'The screenshot contains rendered 3D content; the headset compositor passthrough camera is not included.'}:{})};
    }
    if(!recorder) throw Error('The Studio video recorder is not ready.');
    if(id==='start_recording') {
      await recorder.startRecording(); current();
      return recorder.isRecording()?{ok:true,recording:true,message:'Recording started.'}:{ok:false,error:'Recording did not start. Check the recording status or browser permission prompt.'};
    }
    if(id==='stop_recording') {
      await recorder.stopRecording();
      return {ok:!recorder.isRecording(),recording:!!recorder.isRecording(),message:'Recording stopped. The clip is being prepared by the existing save workflow.'};
    }
    if(id==='pause_recording'||id==='resume_recording') {
      if(!recorder.isRecording()) throw Error('No recording is active.');
      const wanted=id==='pause_recording';
      if(!!recorder.isPaused()!==wanted)recorder.togglePause();
      return {ok:!!recorder.isPaused()===wanted,recording:true,paused:!!recorder.isPaused()};
    }
    throw Error('Unknown capture action.');
  } catch(error) {return {ok:false,error:error.message||'Capture failed.'};}
}
