/** Studio client-smoke feature ids. WebGL lost/restored stay off viewport.boot.
 *  Credit groups fill only when a real fetch/ws/VR/RAM/override event stamps.
 */

export const STUDIO_CREDIT_EVENT = "studio-credit-incident";

export function studioNetworkKind({ name = "", message = "", status = 0, kind = "" } = {}) {
  const blob = `${kind} ${name} ${message} ${status}`.toLowerCase();
  if (blob.includes("timeout") || String(name) === "AbortError") return "network.timeout";
  if (/\bdns\b|name_not_resolved|err_name_not_resolved|getaddrinfo/.test(blob)) return "network.dns";
  if (blob.includes("throttle") || Number(status) === 429) return "network.throttle";
  return "network.latency";
}

export function emitStudioCreditEvent(eventType, extra = {}) {
  const kind = String(eventType || "").trim();
  if (!kind) return;
  try {
    globalThis.dispatchEvent?.(new CustomEvent(STUDIO_CREDIT_EVENT, {
      detail: { eventType: kind, ...extra },
    }));
  } catch (_) { /* stamp is best-effort */ }
}

export function studioSmokeFeature(eventType, extra = {}) {
  const kind = String(eventType || "").toLowerCase();
  if (kind === "webglcontextlost" || kind === "webglcontextrestored") return "webgl.context";
  if (kind === "boot" || kind === "webglunavailable") return "viewport.boot";
  if (
    kind === "fetch.fail"
    || kind === "websocket.fail"
    || kind === "websocket.error"
    || kind === "network.fail"
    || kind.startsWith("network.")
  ) {
    return studioNetworkKind({ ...extra, kind, name: extra.name, message: extra.message, status: extra.status });
  }
  if (kind === "timeout") return "network.timeout";
  if (kind === "dns") return "network.dns";
  if (kind === "throttle") return "network.throttle";
  if (
    kind === "controller.miss"
    || kind === "controller.error"
    || kind === "vr.controller.miss"
    || kind === "vr.controllers"
    || kind === "inputsources.lost"
  ) {
    return "vr.controllers";
  }
  if (kind === "controller.trigger.miss" || kind === "select-vs-trigger" || kind === "vr.controllers.trigger") {
    return "vr.controllers.trigger";
  }
  if (kind === "models.missing" || kind === "viewport.models") return "viewport.models";
  if (kind === "models.loaded") return "viewport.models";
  if (kind === "heap.jump" || kind === "memory.leak") return "memory.leak";
  if (kind === "ram.high" || kind === "system.ram" || kind === "ram.watchdog") return "system.ram";
  if (kind === "companion.damage" || kind === "companion_damage") return "companion.damage";
  if (kind === "user.damage" || kind === "user_damage") return "user.damage";
  if (kind === "human.override" || kind === "sam.override") return "human.override";
  if (kind === "user.override") return "user.override";
  return "";
}

export function studioSmokeStatus(eventType, webglAvailable = true) {
  const kind = String(eventType || "").toLowerCase();
  if (kind === "webglcontextlost") return "broken";
  if (kind === "webglcontextrestored") return "ok";
  if (kind === "boot") return webglAvailable ? "ok" : "broken";
  if (kind === "webglunavailable") return "broken";
  if (kind === "models.loaded") return "ok";
  if (kind === "models.missing") return "broken";
  if (kind === "controller.trigger.miss" || kind === "select-vs-trigger" || kind === "vr.controllers.trigger") {
    return "broken";
  }
  if (
    kind === "fetch.fail"
    || kind === "websocket.fail"
    || kind === "websocket.error"
    || kind === "network.fail"
    || kind.startsWith("network.")
    || kind === "timeout"
    || kind === "dns"
    || kind === "throttle"
    || kind === "controller.miss"
    || kind === "controller.error"
    || kind === "vr.controller.miss"
    || kind === "vr.controllers"
    || kind === "inputsources.lost"
    || kind === "heap.jump"
    || kind === "memory.leak"
    || kind === "ram.high"
    || kind === "system.ram"
    || kind === "ram.watchdog"
    || kind === "companion.damage"
    || kind === "companion_damage"
    || kind === "user.damage"
    || kind === "user_damage"
    || kind === "human.override"
    || kind === "sam.override"
    || kind === "user.override"
  ) {
    return "broken";
  }
  return "unknown";
}
