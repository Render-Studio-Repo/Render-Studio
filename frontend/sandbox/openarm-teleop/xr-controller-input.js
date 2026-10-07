/** Physical Quest controller selection independent of WebXR slot order. */
export function physicalControllerSources(controllers = []) {
  const out = { left: null, right: null };
  for (const controller of controllers) {
    const source = controller?.userData?.inputSource;
    const side = source?.handedness;
    if ((side === "left" || side === "right") && source.gamepad?.buttons?.length) {
      out[side] = { controller, source };
    }
  }
  return out;
}

export function rightTriggerPressed(source) {
  const button = source?.gamepad?.buttons?.[0];
  return !!(button && (button.pressed || Number(button.value) >= 0.5));
}

export function controllerInputStatus({ presenting, rightSource, observedTrigger }) {
  if (!presenting) return { input: "unknown", trigger: "unknown", message: "Enter headset to check controllers" };
  if (!rightSource) return { input: "broken", trigger: "unknown", message: "No right Quest gamepad detected · wake controller or re-enter VR" };
  return {
    input: "ok",
    trigger: observedTrigger ? "ok" : "unknown",
    message: observedTrigger ? "Right controller + trigger observed" : "Right controller connected · press trigger to verify",
  };
}
