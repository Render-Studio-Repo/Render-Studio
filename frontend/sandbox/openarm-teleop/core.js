export function wilsonLower(successes, trials, z = 1.96) {
  if (!trials) return 0;
  const p = successes / trials, z2 = z * z;
  return Math.max(0, (p + z2 / (2 * trials) - z * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials))) / (1 + z2 / trials));
}

export function trainingDecision(trials, target = 0.8, minTrials = 20, maxTrials = 60) {
  const valid = trials.filter(t => t.valid === true);
  const wins = valid.filter(t => t.success === true).length;
  const lower = wilsonLower(wins, valid.length);
  const unsafe = trials.some(t => t.hardLimitViolations > 0);
  const invalid = trials.length !== valid.length;
  const modes = valid.filter(t => !t.success).map(t => t.failureMode || "unknown");
  const counts = new Map(); modes.forEach(m => counts.set(m, (counts.get(m) || 0) + 1));
  const mode = [...counts].sort((a,b) => b[1] - a[1])[0]?.[0] || null;
  let action = "run_5_more_heldout_trials";
  if (unsafe || invalid) action = "repair_harness_or_safety_gate";
  else if (valid.length >= minTrials && lower >= target) action = "stop_and_report_heldout_success";
  else if (valid.length >= maxTrials) action = "stop_budget_exhausted_and_review";
  else if (mode) action = "collect_5_new_demos_for_failure_mode_then_retrain";
  return { action, trials: valid.length, wins, lower: +lower.toFixed(3), priorityFailureMode: mode };
}

export function validateSample(sample, previous = null) {
  const failures = [];
  if (!Number.isInteger(sample.sequence) || sample.sequence < 0) failures.push("bad_sequence");
  if (!Number.isFinite(sample.timestamp_ms)) failures.push("bad_time");
  if (previous && (sample.sequence <= previous.sequence || sample.timestamp_ms <= previous.timestamp_ms)) failures.push("non_monotonic");
  for (const name of ["head_pose", "left_grip_pose", "right_grip_pose"]) {
    const pose = sample[name];
    if (!pose || pose.position?.length !== 3 || pose.quaternion?.length !== 4 ||
        ![...pose.position, ...pose.quaternion].every(Number.isFinite)) failures.push(`bad_${name}`);
  }
  return failures;
}
