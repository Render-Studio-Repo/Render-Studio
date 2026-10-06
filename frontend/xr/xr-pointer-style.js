// Dimensions are in meters. Both Touch pads keep a thin idle laser; UI hits
// stop the beam at the target. Hold B lengthens and brightens it. Draw/pen
// tools replace the beam with a short controller tip.
import { pointerTipOffsetM } from "./xr-hot-path.js?v=roboticsworkspace3&drawtip=20260916-1&astra=20260916-5";

export const XR_POINTER_RADIUS_M = 0.002;
export const XR_POINTER_IDLE_M = 0.22;
export const XR_POINTER_BRIGHT_M = 1.6;
export const XR_POINTER_UI_REACH_M = 3.2;
export const XR_POINTER_BEAM_RADIUS_M = 0.00045;

export function xrPointerStyle({
  hit = null, ui = false, presenting = false, posed = false, holding = false, bright = false,
  hideLaser = false, tipOffsetM = NaN,
} = {}) {
  const visible = presenting && posed && !holding;
  if (hideLaser === true) {
    const tipM = Number(tipOffsetM);
    const distance = Number.isFinite(tipM) && tipM > 0 ? tipM : pointerTipOffsetM();
    return {
      visible,
      beam: false,
      distance: visible ? distance : 0,
      radius: XR_POINTER_BEAM_RADIUS_M,
      tipRadius: XR_POINTER_RADIUS_M,
      opacity: 0.9,
      color: 0xffffff,
    };
  }
  const distance = Number(hit?.distance);
  const uiBeam = visible && ui === true && Number.isFinite(distance) && distance > 0.002
    && distance <= XR_POINTER_UI_REACH_M;
  const idleLen = bright === true ? XR_POINTER_BRIGHT_M : XR_POINTER_IDLE_M;
  return {
    visible,
    beam: visible,
    distance: uiBeam ? distance : idleLen,
    radius: XR_POINTER_BEAM_RADIUS_M,
    tipRadius: XR_POINTER_RADIUS_M,
    opacity: bright === true ? 0.95 : 0.55,
    color: bright === true ? 0xffffff : (uiBeam ? 0xb9ecff : 0x7dd3fc),
  };
}
