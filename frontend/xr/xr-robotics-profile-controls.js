// Sam's Studio Y contract (Mac / Quest / Pi): press starts a timer,
// release before 2s is tap, hold ≥ 2s is session_reset. Never both.
// Live status y_map wins; the saved profile map is enough before hello.
export const Y_HOLD_MS = 2000;
export const HOLD_MS = Y_HOLD_MS;

export function profileYMap(profile) {
  return profile?.y_map
    || profile?.controllers?.y_map
    || profile?.controllers?.buttons?.y_map
    || '';
}

export function yMapAllowsHoldReset(status = {}) {
  return (status.y_map || status.profile_y_map) === 'tap_pause_hold3_kill';
}

export function createProfileYControl() {
  let down = false, started = null, reset = false;
  return {
    clear() { down = false; started = null; reset = false; },
    holdProgress(now) {
      if (!down) return 0;
      if (reset) return 1;
      if (started == null) return 0;
      return Math.min(1, Math.max(0, (now - started) / Y_HOLD_MS));
    },
    sample(pressed, now, status = {}) {
      let action = null;
      if (pressed && !down) {
        started = now;
        reset = false;
      } else if (pressed && !reset && started != null && now - started >= Y_HOLD_MS) {
        reset = true;
        action = yMapAllowsHoldReset(status) ? 'session_reset' : 'reset_unavailable';
      } else if (!pressed && down && !reset && started != null) {
        action = now - started >= Y_HOLD_MS ? (yMapAllowsHoldReset(status) ? 'session_reset' : 'reset_unavailable') : 'tap';
      }
      down = !!pressed;
      if (!down) started = reset ? started : null;
      return action;
    },
  };
}

export function profileUsesYCommands(profile) {
  return profileYMap(profile) === 'tap_pause_hold3_kill';
}

export function preferredRoboticsSources(sources = []) {
  const picked = new Map();
  const score = source => (source.gamepad ? 2 : 0) + (source.hand ? 0 : 1);
  for (const source of sources) {
    if (source.handedness !== 'left' && source.handedness !== 'right') continue;
    const previous = picked.get(source.handedness);
    if (!previous || score(source) > score(previous)) picked.set(source.handedness, source);
  }
  return [...picked.values()];
}
