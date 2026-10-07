/** Fixed-rate budget for expensive desktop viewport work. */
export function createFrameBudget(maxFps = 30) {
  const intervalMs = 1000 / Math.max(1, Number(maxFps) || 30);
  let lastRunAt = Number.NEGATIVE_INFINITY;

  return {
    shouldRun(now) {
      const timestamp = Number(now);
      if (!Number.isFinite(timestamp)) return false;
      if (timestamp - lastRunAt < intervalMs - 1) return false;
      lastRunAt = timestamp;
      return true;
    },
    reset() {
      lastRunAt = Number.NEGATIVE_INFINITY;
    },
  };
}
