import { captureWiringPhoto } from './wiring-guide-camera.js?v=20260916-harness1-harness2-harness3';
/** Reuse the existing diagnosis job and billing path, scoped to one photographed connection. */
export async function reviewWiringStep({guide, api, getProjectId, getAiFields, capture=captureWiringPhoto}) {
  const snapshot=guide.reviewSnapshot();
  if(!snapshot.projectId || !snapshot.wire) throw new Error('Load wiring and select a connection first.');
  const current=()=>getProjectId()===snapshot.projectId && guide.reviewSnapshot().signature===snapshot.signature;
  guide.setMessage('Allow the outward camera for one visual check…');
  const image=await capture();
  if(!current())throw new Error('The project or schematic changed. Capture the current step again.');
  const path=`/api/projects/${encodeURIComponent(snapshot.projectId)}/wiring/diagnose-photo`;
  const description=`Review ONLY the photographed physical connection for this guided step: ${JSON.stringify(snapshot.wire).slice(0,1250)}. Compare visible terminal labels and endpoints to the schematic. Report visible mismatch, looks consistent, or cannot determine. A photo cannot establish continuity, insulation, current capacity, hidden wiring, or safe energization. Never mark the circuit electrically verified. Request a closer view if labels are unreadable.`;
  const start=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...getAiFields?.(),model:'gpt-6-astra',description,images:[{name:'wiring-step.jpg',media_type:'image/jpeg',data_url:image}],include_schematic:true})});
  const trace=start.trace_id || start.job?.trace_id;
  if(start.reused_existing)throw new Error('Another photo review is running. Wait for it to finish, then check this wire again.');
  if(!trace)throw new Error('Camera review did not start.');
  guide.setMessage('Astra is reviewing the photographed terminals…');
  for(let count=0;count<240;count++) {
    if(!current())throw new Error('The project or schematic changed. Review stays with its original step.');
    const job=await api(`${path}/status`);
    if(job.trace_id!==trace)throw new Error('Another photo review replaced this job; no result was applied to this step.');
    if(job.status==='complete') {
      const diagnosis=job.diagnosis || {};
      const summary=String(diagnosis.summary || diagnosis.message || 'Visual review finished. Inspect the photo debugger findings.');
      guide.applyReview(snapshot,{summary,issues:diagnosis.issues || [],traceId:trace});guide.setMessage(summary);return {ok:true,message:summary};
    }
    if(['failed','canceled'].includes(job.status))throw new Error(job.error || 'Photo review stopped.');
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error('Review is still running. Its result is available in the Wiring photo debugger.');
}
