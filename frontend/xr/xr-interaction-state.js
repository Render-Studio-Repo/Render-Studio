/** Keep controller poses separate from stale hand tracking and UI motion. */
export function drawingWristHost({source, grip, hand, wrist, posed}) {
  if (source?.gamepad && grip && posed(grip)) return grip;
  if (source?.hand && wrist && posed(wrist)) return wrist;
  if (grip && posed(grip)) return grip;
  if (source?.hand && hand && posed(hand)) return hand;
  return null;
}

export function panelDragTranslatesOnly(input, requested) {
  return input !== 'grip' || requested === true;
}

export function liveVoiceXrSession(presenting, localSession, xr) {
  const active = xr?.getSession?.() || localSession;
  return (presenting || xr?.isPresenting) && active && !active.ended ? active : null;
}
