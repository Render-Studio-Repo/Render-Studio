/** One explicit outward-camera snapshot. Never reuse room sharing or rendered viewport pixels. */
export async function captureWiringPhoto({mediaDevices=navigator.mediaDevices}={}) {
  if(!mediaDevices?.getUserMedia) throw new Error('This browser cannot expose the outward camera. Use a photo in the Wiring photo debugger.');
  let stream, video;
  try {
    stream=await mediaDevices.getUserMedia({audio:false,video:{facingMode:{exact:'environment'},width:{ideal:1280},height:{ideal:720}}});
    video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
    await video.play();
    if(!video.videoWidth) await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Outward camera did not deliver an image.')),5000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};});
    if(!video.videoWidth)throw new Error('No camera frame is available.');
    const canvas=document.createElement('canvas');canvas.width=Math.min(1280,video.videoWidth);canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.85);
  } catch(error) {
    if(['NotFoundError','OverconstrainedError','NotSupportedError'].includes(error.name))throw new Error('This headset browser does not expose an outward camera. Passthrough cannot be inspected as a rendered screenshot. Use the Wiring photo debugger with an uploaded photo.');
    throw error;
  } finally { stream?.getTracks().forEach(track=>track.stop()); if(video){video.pause();video.srcObject=null;} }
}
