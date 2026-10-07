/**
 * DimOS LAN policy. Quest on this Wi-Fi talks to the Pi the same way cameras
 * do: browser JS → wss://<robot-lan>:8443/ws. Cloudflare cannot route to
 * 192.168.x. Do not iframe cloud as the teleop transport. Do not punch :8443
 * on the public tunnel. Mixed content: HTTPS Studio uses wss/https to :8443.
 */

export const DIMOS_CLOUD_HOST_SUFFIX = "render3d.app";

export const DIMOS_BEST_LAN_PATH =
  "Quest on this Wi-Fi opens wss://ROBOT_LAN:8443/ws directly (default 192.168.1.77). Same path as cameras. Trust the Pi cert once at https://ROBOT_LAN:8443/teleop or http://ROBOT_LAN:8450/trust. Do not send teleop through Cloudflare.";

export const DIMOS_MAC_PROXY_PATH =
  "Studio JS on this headset opens wss://<robot-lan>:8443/ws even when the page loaded from https://render3d.app. Paste the Pi LAN IP. If :8443 is down, Enable Robotics / Activate can start `dimos run teleop-quest-openarm` on the robot PC — it never kills a live coordinator. Do not expose :8443 publicly.";

export const DIMOS_CLOUD_VIEWER_COPY =
  "This page can be https://render3d.app — Quest on this Wi-Fi still opens wss://<robot-lan>:8443/ws directly (same as cameras). Cloudflare cannot route to 192.168.x. Trust the Pi cert once (https://192.168.1.77:8443/teleop or :8450/trust). Y tap starts the arms. Enter VR does not auto-arm.";

export function hostnameOf(hostOrUrl) {
  const raw = String(hostOrUrl || "").trim();
  if (!raw) return "";
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return String(new URL(raw).hostname || "").toLowerCase();
    }
  } catch {
    /* fall through */
  }
  const noBrackets = raw.replace(/^\[|\]$/g, "");
  if (noBrackets.startsWith("::") || noBrackets.includes("::")) return noBrackets.toLowerCase();
  const cut = noBrackets.split("/")[0].split("?")[0];
  if (cut.includes(":") && cut.split(":").length === 2 && /^\d+$/.test(cut.split(":")[1])) {
    return cut.split(":")[0].toLowerCase();
  }
  return cut.toLowerCase();
}

export function isLoopbackHost(host) {
  const h = String(host || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

export function isPrivateLanHost(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return false;
  if (isLoopbackHost(h)) return true;
  if (h.endsWith(".local") && h.includes(".")) return true;
  const m4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m4) {
    const a = Number(m4[1]);
    const b = Number(m4[2]);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return !(Number(m4[3]) === 169 && Number(m4[4]) === 254);
    return false;
  }
  return false;
}

export function isCloudStudioHost(host) {
  const h = String(host || "").toLowerCase().split(":")[0];
  if (!h) return false;
  return h === DIMOS_CLOUD_HOST_SUFFIX || h.endsWith(`.${DIMOS_CLOUD_HOST_SUFFIX}`);
}

export function isCloudStudioOrigin(loc = globalThis.location) {
  try {
    return isCloudStudioHost(loc?.hostname || loc?.host || "");
  } catch {
    return false;
  }
}

export function isLanStudioOrigin(loc = globalThis.location) {
  if (isCloudStudioOrigin(loc)) return false;
  let host = "";
  try { host = String(loc?.hostname || "").toLowerCase(); } catch { host = ""; }
  return isPrivateLanHost(host) || isLoopbackHost(host);
}

export function isPublicDimosHost(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return false;
  if (isPrivateLanHost(h) || isLoopbackHost(h)) return false;
  if (isCloudStudioHost(h)) return true;
  if (/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.test(h)) return true;
  return true;
}

export function colocatedDimosHint(loc = globalThis.location) {
  if (!isLanStudioOrigin(loc)) return "";
  let host = "";
  try { host = String(loc?.hostname || "").toLowerCase(); } catch { host = ""; }
  if (!host || isCloudStudioHost(host)) return "";
  return `wss://${host}:8443/ws`;
}

export function studioCanProxyDimos({ location = globalThis.location, upstream = "" } = {}) {
  void location;
  const host = hostnameOf(upstream);
  if (!host) return false;
  if (isPublicDimosHost(host)) return false;
  return isPrivateLanHost(host) || isLoopbackHost(host);
}

/** Quest → Pi LAN wss. Never Cloudflare /api/dimos/ws. HTTPS Studio cannot use ws://. */
export function dimosDirectLanWsUrl(upstream) {
  const host = hostnameOf(upstream);
  if (!host || isPublicDimosHost(host)) return "";
  if (!isPrivateLanHost(host) && !isLoopbackHost(host)) return "";
  let port = "8443";
  try {
    const raw = String(upstream || "").trim();
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `wss://${raw}`);
    if (u.port) port = u.port;
  } catch {
    const m = String(upstream || "").match(/:(\d+)/);
    if (m) port = m[1];
  }
  return `wss://${host}:${port}/ws`;
}

export function dimosConnectPolicy(loc = globalThis.location, upstream = "") {
  const cloud = isCloudStudioOrigin(loc);
  const host = hostnameOf(upstream);
  const publicHost = !!(host && isPublicDimosHost(host));
  const canProxy = studioCanProxyDimos({ location: loc, upstream });
  let reason = "";
  if (publicHost) reason = "DimOS host must be a LAN or loopback address. Do not point at a public :8443.";
  else if (!canProxy) reason = DIMOS_BEST_LAN_PATH;
  return {
    cloud,
    lanStudio: isLanStudioOrigin(loc),
    canProxy,
    publicHost,
    colocatedHint: colocatedDimosHint(loc),
    reason,
    bestPath: DIMOS_BEST_LAN_PATH,
    macPath: DIMOS_MAC_PROXY_PATH,
    cloudCopy: DIMOS_CLOUD_VIEWER_COPY,
  };
}
