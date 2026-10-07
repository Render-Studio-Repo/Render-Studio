/** Embed workshop replica + one DIMOS strip. Shared live instances. Token sbvp1. */

import { adoptLive } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import { DIMOS_WIRE_TOKEN } from "./dimos-link.js?v=dimoswire1-viewport2&teleop-y=20260922-poseconnect1&studio-relay=20260927-1&vrrobot=20260927-2";
import {
  mountStudioViewportReplica,
  SBVP1_TOKEN,
  LEGACY_MUJOCO_LAB,
} from "./studio-viewport-replica.js?v=20260923-draw-recordings1&simrun=20260923-1&vrrobot=20260927-2";

export const TELEOP_TOKEN = SBVP1_TOKEN;
export const MUJOCO_LAB = LEGACY_MUJOCO_LAB;
export { DIMOS_WIRE_TOKEN, SBVP1_TOKEN };

export function mountTeleopLab(host) {
  if (!host) return null;
  host.classList.add("sb-teleop-lab");
  host.innerHTML = `<div data-sb-dimos-slot data-sb-live-slot="dimos"></div><div data-sb-studio-replica></div>`;
  adoptLive("dimos", host.querySelector("[data-sb-dimos-slot]"), { live: true });
  const replica = mountStudioViewportReplica(host.querySelector("[data-sb-studio-replica]"), {
    title: "Workshop · shared viewport + benches",
    kicker: "02 · WORKSHOP",
    openByDefault: false,
    showLegacyMujoco: false,
    defaultMode: "viewport",
  });
  host.dataset.ready = "1";
  host.dataset.token = TELEOP_TOKEN;
  return Object.assign(host, { replica });
}
