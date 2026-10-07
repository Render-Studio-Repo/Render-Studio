/** Coalesce overlapping Talk controls while preserving the first user gesture. */
export function createVoiceStartGate() {
  let pending = null;
  function run(start) {
    if (pending) return pending;
    // Call synchronously: deferring start to .then loses headset media activation.
    let result;
    try { result = start(); } catch (error) { result = Promise.reject(error); }
    const operation = Promise.resolve(result);
    pending = operation;
    const clear = () => { if (pending === operation) pending = null; };
    operation.then(clear, clear);
    return operation;
  }
  run.isPending = () => pending !== null;
  return run;
}
