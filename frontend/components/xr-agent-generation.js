/** Trace-specific completion prevents an unrelated concurrent job accepting a review. */
export function findAgentGeneration(snapshot, traceId) {
  const jobs = [...(snapshot?.jobs || []), ...(snapshot?.running_jobs || [])];
  const exact = jobs.find(job => String(job.trace_id || job.id || '') === traceId);
  if (exact) return exact;
  return String(snapshot?.trace_id || snapshot?.id || '') === traceId ? snapshot : null;
}
export async function runReviewedGeneration({ api, projectId, endpoint, body, onAccepted, onComplete, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeout = 30*60*1000 }) {
  const response = await api(`/api/projects/${encodeURIComponent(projectId)}/${endpoint}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},180000);
  if (response?.blocker?.reason || response?.schematic?.blocker?.reason) throw new Error(response.blocker?.reason || response.schematic.blocker.reason);
  if (!response?.accepted && response?.status !== 'running') {
    if (response?.status === 'failed' || response?.error) throw new Error(response.error || 'Generation failed.');
    if (!response?.filename && !response?.schematic) throw new Error(response?.answered ? 'The AI answered without confirming an edited model. Review its response before trying again.' : 'No generated model or schematic was returned.');
    await onComplete?.(response); return {ok:true,message:response.message||'Generated. Inspect the result.'};
  }
  const traceId = String(response.trace_id || response.generation?.trace_id || '');
  if (!traceId) throw new Error('Generation started without a tracking ID. Check project history before retrying.');
  await onAccepted?.(response);
  const start = now();
  while (now()-start < timeout) {
    await wait(2500);
    const snapshot = await api(`/api/projects/${encodeURIComponent(projectId)}/generation`);
    const job = findAgentGeneration(snapshot, traceId);
    if (!job) continue;
    if (['failed','canceled','cancelled','stopped'].includes(job.status)) throw new Error(job.error || job.message || 'Generation stopped.');
    if (['complete','completed','succeeded'].includes(job.status)) {
      if (job.blocker?.reason || job.result?.blocker?.reason) throw new Error(job.blocker?.reason || job.result.blocker.reason);
      await onComplete?.(job); return {ok:true,message:job.message||'Generated. Inspect the result.',traceId};
    }
  }
  throw new Error('Generation is still unconfirmed. Check project history before retrying; it may still be running.');
}
