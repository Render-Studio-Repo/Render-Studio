/** Three.js controller slots follow connected events, not inputSources order. */
export function connectedSourceForSlot(controllers, index) {
  return controllers[index]?.userData?.inputSource || null;
}

export function controllerSlotForSource(controllers, source) {
  if (!source) return -1;
  const byRef = controllers.findIndex((node) => node?.userData?.inputSource === source);
  if (byRef >= 0) return byRef;
  if (source.gamepad) {
    const byPad = controllers.findIndex((node) => node?.userData?.inputSource?.gamepad === source.gamepad);
    if (byPad >= 0) return byPad;
  }
  return -1;
}

export function controllerSlotForHand(controllers, hand) {
  if (hand !== "left" && hand !== "right") return -1;
  const bySource = controllers.findIndex((node) => node?.userData?.inputSource?.handedness === hand);
  if (bySource >= 0) return bySource;
  return controllers.findIndex((node) => node?.userData?.handedness === hand);
}
