/** Keep motion stopped until the Pi confirms reset and the user explicitly resumes. */
export function createTeleopStop({ onStatus = () => {}, onError = () => {}, delayMs = 750 } = {}) {
  let phase = 'idle', generation = 0, timer = null;
  const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const confirmed = status => status?.armed === false && status?.holding !== true
    && status?.pending_arm !== true && status?.homing !== true;
  const accept = status => {
    if (phase === 'idle' || !confirmed(status)) return false;
    cancelTimer(); phase = 'stopped'; return true;
  };
  return {
    phase: () => phase,
    blocksMotion: () => phase !== 'idle',
    accept,
    clear() { generation++; cancelTimer(); phase = 'idle'; },
    resume() {
      if (phase === 'pending' || phase === 'failed') return false;
      generation++; cancelTimer(); phase = 'idle'; return true;
    },
    request({ send, fallback }) {
      if (phase === 'pending') return;
      cancelTimer(); phase = 'pending';
      const own = ++generation;
      let fallbackStarted = false;
      const receive = status => {
        if (own !== generation || phase !== 'pending') return;
        if (status) { accept(status); onStatus(status); }
      };
      const backup = async () => {
        if (own !== generation || phase !== 'pending' || fallbackStarted) return;
        fallbackStarted = true;
        cancelTimer();
        try {
          const status = await fallback();
          if (own !== generation || phase !== 'pending') return;
          receive(status);
          if (phase === 'pending') throw Error('Pi did not confirm that the arms stopped');
        } catch (error) {
          if (own !== generation || phase !== 'pending') return;
          phase = 'failed'; onError(error);
        }
      };
      // Only the idempotent session_reset command is retried. Never retry Y tap.
      timer = setTimeout(backup, delayMs);
      try { Promise.resolve(send()).then(receive).catch(backup); }
      catch { void backup(); }
    },
  };
}
