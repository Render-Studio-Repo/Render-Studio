/**
 * One live surface each: Studio viewport, Viser, DIMOS, MuJoCo.
 * Tabs adopt the same DOM node (move, don't spawn). Token sblive1.
 */

export const SBLIVE1_TOKEN = "sblive1";
export const VIEWPORT_EMBED_SRC = "/?sandboxViewport=1&v=sbvp1&robot=1";
export const MUJOCO_EMBED_SRC = "/sandbox/openarm-mujoco/index.html?embed=1";
export const VISER_IFRAME_SRC = "/api/viser/p/127.0.0.1/8095/";
export const SAM_VISER_IFRAME_SRC = VISER_IFRAME_SRC;
export const LIVE_IDS = Object.freeze(["viewport", "viser", "mujoco", "dimos"]);

/** Launch extraction points — keep logs; do not kill DIMOS coordinator. */
export const LAUNCH_POINTS = Object.freeze({
  token: SBLIVE1_TOKEN,
  control_schema: "sam-y-engage-v2",
  lock: "sam",
  instances: {
    viewport: { token: "sbvp1", src: VIEWPORT_EMBED_SRC, kind: "iframe" },
    viser: { token: "oavis1", src: VISER_IFRAME_SRC, kind: "iframe", proxy: "/api/viser/p/{host}/{port}/" },
    dimos: { token: "dimoswire1", coordinator: "/api/dimos/coordinator", port: 8443, probe: "/api/integrations/grok-bot/dimos/probe" },
    mujoco: { token: "mujoco1", src: MUJOCO_EMBED_SRC, feed: "openarm-mujoco/runs/latest.json" },
  },
  logs: {
    prompt_trace: "log_id (live feed prompt tail)",
    context: "/api/sandbox/context-log",
    teaching: "sandbox-sessions/teaching/latest.json",
    character_moves: "sandbox-sessions/teaching/character-moves.json",
    sql_findings: "sandbox-sessions/supabase-sql-findings.json",
    train_episode: "openarm-mujoco/episodes/latest.json",
    train_manifest: "openarm-mujoco/episodes/manifest.json",
    teleop_runs: "openarm-teleop/",
    repair: "sandbox-sessions/latest-repair.json",
    remix: "sandbox-sessions/latest-remix-blueprint.json",
  },
});

const registry = new Map();

function doc() {
  return globalThis.document || null;
}

function pool() {
  const d = doc();
  if (!d?.createElement) return null;
  let el = d.getElementById("sb-live-pool");
  if (!el) {
    el = d.createElement("div");
    el.id = "sb-live-pool";
    el.hidden = true;
    el.setAttribute("data-sb-live-pool", "1");
    el.setAttribute("data-token", SBLIVE1_TOKEN);
    (d.body || d.documentElement)?.appendChild(el);
  }
  return el;
}

export function liveSrc(id) {
  if (id === "viewport") return VIEWPORT_EMBED_SRC;
  if (id === "mujoco") return MUJOCO_EMBED_SRC;
  if (id === "viser") {
    try {
      const raw = globalThis.localStorage?.getItem("render3d:viserPrefs");
      const parsed = raw ? JSON.parse(raw) : null;
      const active = String(parsed?.active || "");
      const m = active.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/) || active.match(/\[?([0-9a-fA-F:.]+)\]?:(\d+)/);
      if (m) return `/api/viser/p/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}/`;
    } catch { /* default */ }
    return VISER_IFRAME_SRC;
  }
  return "";
}

function makeIframe(id) {
  const d = doc();
  if (!d?.createElement) return null;
  const frame = d.createElement("iframe");
  frame.id = `sb-live-${id}`;
  frame.className = `sb-live-frame sb-live-${id} sb-teleop-frame`;
  frame.title = id === "viewport" ? "Studio viewport (single instance)"
    : id === "viser" ? "Viser (single instance)"
      : "MuJoCo workshop sim (single instance)";
  frame.setAttribute("data-sb-live", id);
  frame.setAttribute("data-src", liveSrc(id));
  frame.setAttribute("src", "about:blank");
  frame.setAttribute("loading", "lazy");
  frame.setAttribute("allow", "fullscreen; xr-spatial-tracking; microphone; camera");
  return frame;
}

function makeDimosHost() {
  const d = doc();
  if (!d?.createElement) return null;
  const wrap = d.createElement("div");
  wrap.id = "sb-live-dimos";
  wrap.className = "sb-live-dimos";
  wrap.setAttribute("data-sb-live", "dimos");
  wrap.setAttribute("data-token", "dimoswire1");
  return wrap;
}

function placeholderHtml(id) {
  const labels = {
    viewport: "Studio viewport",
    viser: "Viser",
    mujoco: "MuJoCo",
    dimos: "DIMOS",
  };
  return `<div class="sb-live-reuse" data-sb-live-placeholder="${id}">
    <p>Same <strong>${labels[id] || id}</strong> instance is live in the other tab — not a second iframe.</p>
    <button type="button" class="sb-agent-btn" data-sb-bring="${id}">Show here</button>
  </div>`;
}

function bindBring(slot, id) {
  slot.querySelectorAll?.(`[data-sb-bring="${id}"]`)?.forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => { adoptLive(id, slot, { live: true }); });
  });
}

function markSlot(slot, id) {
  if (!slot) return;
  try {
    slot.setAttribute?.("data-sb-live-slot", id);
    slot.dataset.sbLiveSlot = id;
  } catch { /* optional */ }
}

export function getLiveRecord(id) {
  return registry.get(id) || null;
}

export function countLiveNodes(id, root = doc()) {
  if (!root?.querySelectorAll) return 0;
  return root.querySelectorAll(`[data-sb-live="${id}"]`).length;
}

/**
 * Create the singleton node (parked) the first time.
 */
export function ensureLive(id) {
  if (!LIVE_IDS.includes(id)) return null;
  let rec = registry.get(id);
  if (rec?.el) return rec;
  const el = id === "dimos" ? makeDimosHost() : makeIframe(id);
  if (!el) {
    rec = { id, el: null, owner: null, live: false, token: SBLIVE1_TOKEN };
    registry.set(id, rec);
    return rec;
  }
  pool()?.appendChild(el);
  rec = { id, el, owner: pool(), live: false, token: SBLIVE1_TOKEN, dimosMounted: false };
  registry.set(id, rec);
  return rec;
}

function setIframeLive(rec, on) {
  if (!rec?.el?.getAttribute) return;
  if (rec.id === "dimos") return;
  const want = rec.el.getAttribute("data-src") || liveSrc(rec.id);
  const next = on ? want : "about:blank";
  if (rec.el.getAttribute("src") !== next) rec.el.setAttribute("src", next);
}

function leavePlaceholder(prevOwner, id) {
  if (!prevOwner || prevOwner.id === "sb-live-pool") return;
  if (typeof prevOwner.innerHTML === "string") {
    prevOwner.innerHTML = placeholderHtml(id);
    bindBring(prevOwner, id);
  }
}

/**
 * Move the single instance into `slot`. Other slots get a reuse placeholder.
 */
export function adoptLive(id, slot, { live = true } = {}) {
  if (!slot) return ensureLive(id);
  markSlot(slot, id);
  const rec = ensureLive(id);
  if (!rec?.el) {
    if (typeof slot.innerHTML === "string") slot.innerHTML = placeholderHtml(id);
    return rec;
  }
  const prev = rec.el.parentNode;
  if (live) {
    if (typeof slot.innerHTML === "string") slot.innerHTML = "";
    slot.appendChild(rec.el);
    rec.owner = slot;
    rec.live = true;
    setIframeLive(rec, true);
    if (prev && prev !== slot) leavePlaceholder(prev, id);
    if (id === "dimos" && !rec.dimosMounted) {
      rec.dimosMounted = true;
      void import("./dimos-link.js?v=dimoswire1-viewport2&teleop-y=20260922-poseconnect1&studio-relay=20260927-1&vrrobot=20260927-2")
        .then(({ mountDimosLink }) => mountDimosLink(rec.el))
        .catch(() => { rec.dimosMounted = false; });
    }
  } else {
    pool()?.appendChild(rec.el);
    rec.owner = pool();
    rec.live = false;
    slot.innerHTML = placeholderHtml(id);
    bindBring(slot, id);
  }
  try {
    globalThis.window?.dispatchEvent?.(new CustomEvent("render3d-sandbox-live", {
      detail: { id, live, token: SBLIVE1_TOKEN },
    }));
  } catch { /* optional */ }
  return rec;
}

export function parkLive(id, { keepSrc = true } = {}) {
  const rec = registry.get(id);
  if (!rec?.el) return rec;
  const prev = rec.el.parentNode;
  pool()?.appendChild(rec.el);
  rec.owner = pool();
  rec.live = false;
  if (!keepSrc) setIframeLive(rec, false);
  if (prev && prev.id !== "sb-live-pool") leavePlaceholder(prev, id);
  return rec;
}

export function postToLive(id, message) {
  const rec = registry.get(id);
  try {
    rec?.el?.contentWindow?.postMessage(message, "*");
    return true;
  } catch {
    return false;
  }
}

export function liveInventory() {
  return LIVE_IDS.map((id) => {
    const rec = registry.get(id);
    return {
      id,
      spawned: !!rec?.el,
      live: !!rec?.live,
      src: rec?.el?.getAttribute?.("src") || (id === "dimos" ? "dom" : "about:blank"),
      duplicates: countLiveNodes(id),
    };
  });
}
