/** Native events and delayed gamepad polls may describe the same physical press. */
export function createXrUiPressLatch() {
  const held = [false, false];
  return {
    held: hand => held[hand] === true,
    commit(hand) { if (hand === 0 || hand === 1) held[hand] = true; },
    release(hand) { if (hand === 0 || hand === 1) held[hand] = false; },
    reset() { held[0] = held[1] = false; },
  };
}
