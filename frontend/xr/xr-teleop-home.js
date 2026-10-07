/** Acknowledged stop, one guarded Home, then feedback-confirmed completion. */
export async function runGuardedHome({ request, signal, now = () => performance.now(),
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 30000 }) {
  const active = () => {
    if (signal?.aborted) throw new Error('Home cancelled');
  };
  active();
  const stopped = await request('/teleop/y', {body: {action: 'session_reset'}, signal});
  active();
  if (stopped?.armed !== false || stopped.holding === true || stopped.pending_arm === true || stopped.homing === true) {
    throw new Error('Pi did not confirm that the arms stopped');
  }
  let status = await request('/teleop/home', {
    body: {require_stationary: true, require_clear: true}, signal,
  });
  const deadline = now() + timeoutMs;
  while (true) {
    active();
    if (status?.home_failure) throw new Error(status.home_failure);
    const count = Number(status?.home_target_joint_count);
    if (status?.homing === false && status.home_reached === true && status.home_safe_hold === true
        && status.armed === false && status.pending_arm !== true
        && count > 0 && Number(status.home_feedback_joint_count) >= count) return status;
    if (status?.homing !== true) throw new Error('Pi did not confirm a completed safe Home');
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Timed out waiting for Home feedback');
    await wait(Math.min(500, remaining));
    active();
    status = await request('/teleop/status', {signal, timeoutMs: Math.min(8000, Math.max(1, deadline - now()))});
  }
}
