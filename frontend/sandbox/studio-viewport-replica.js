/**
 * Workshop host (token sbvp1): wiring + whiteboard + shared live instances.
 * Studio viewport / Viser / MuJoCo are singletons (sandbox-live-instances).
 * Embed MuJoCo hides key-bindings (`body.embed #panel { display: none }`).
 */

import { adoptLive, parkLive, MUJOCO_EMBED_SRC } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import { teachingMarkup, bindTeachingPanel } from "./sandbox-teaching-record.js?v=20260923-draw-recordings1&simrun=20260923-1&vrrobot=20260927-2";
import { featureBoardMarkup, bindFeatureBoard, isFeatureLive } from "./sandbox-feature-board.js?v=20260923-draw-recordings1";
import { techWallMarkup, bindTechWall } from "./sandbox-tech-wall.js?v=20260923-draw-recordings1&vrrobot=20260927-2";

export const SBVP1_TOKEN = "sbvp1";
export const SBWIRE1_TOKEN = "sbwire1";
export const SUPASQL1_TOKEN = "supasql1";
export const STUDIO_VIEWPORT_URL = "/?sandboxViewport=1&v=sbvp1";
export const LEGACY_MUJOCO_LAB = MUJOCO_EMBED_SRC;

export function studioViewportSrc({ openRobot = true } = {}) {
  const u = new URL(STUDIO_VIEWPORT_URL, "https://render3d.app");
  if (openRobot) u.searchParams.set("robot", "1");
  return `${u.pathname}?${u.searchParams.toString()}`;
}

const WORKSHOP_MODES = ["viewport", "board", "wall", "wiring", "sql", "mujoco", "viser", "teach"];

/**
 * Workshop surfaces under one token.
 * Live WebGL/control sockets come from adoptLive — never a second iframe.
 */
export function mountStudioViewportReplica(host, {
  title = "Workshop · wiring + whiteboard",
  kicker = "02 · WORKSHOP",
  openByDefault = false,
  showLegacyMujoco = false,
  defaultMode = "viewport",
} = {}) {
  if (!host) return null;
  const src = studioViewportSrc();
  host.classList.add("sb-studio-viewport");
  host.dataset.token = SBVP1_TOKEN;
  host.innerHTML = `
    <header class="sb-teleop-head">
      <div>
        <span class="sb-kicker">${kicker}</span>
        <h3>${title}</h3>
      </div>
      <div class="sb-teleop-meta">
        <span class="sb-teleop-pill" data-sbvp-token>${SBVP1_TOKEN}</span>
        <span class="sb-teleop-pill">${SBWIRE1_TOKEN}</span>
        <span class="sb-teleop-pill">${SUPASQL1_TOKEN}</span>
        <a class="sb-teleop-expand" href="#sb-teleop">Same instances</a>
        ${showLegacyMujoco ? `<a class="sb-teleop-expand" href="${LEGACY_MUJOCO_LAB}" target="_blank" rel="noopener">MuJoCo pop-out ↗</a>` : ""}
      </div>
    </header>
    <p class="sb-teleop-copy">
      Collab IDE at the top owns this viewport — crew watches while Sam explains.
      One Studio viewport, one Viser, one DIMOS strip, one MuJoCo. Feature board is the live/gated SoR.
      Sam lock <code>sam-y-record-v3</code>: Y tap calibrates + activates/pauses/reactivates, Y hold resets, A records/saves, B discards.
    </p>
    <div class="sb-sbvp-modes" role="tablist" aria-label="Workshop surfaces">
      <button type="button" class="sb-agent-btn" data-sbvp-mode="viewport" aria-selected="false">Studio viewport</button>
      <button type="button" class="sb-agent-btn" data-sbvp-mode="board" aria-selected="false">Feature board</button>
      <button type="button" class="sb-agent-btn" data-sbvp-mode="wall" aria-selected="false">Tech wall</button>
      <button type="button" class="sb-agent-btn" data-sbvp-mode="wiring" aria-selected="false">3D wiring</button>
      <button type="button" class="sb-agent-btn" data-sbvp-mode="sql" aria-selected="false">Supabase SQL</button>
      <button type="button" class="sb-agent-btn" data-sbvp-mode="viser" aria-selected="false">Viser</button>
      <button type="button" class="sb-agent-btn" data-sbvp-mode="mujoco" aria-selected="false">MuJoCo</button>
      <button type="button" class="sb-agent-btn" data-sbvp-mode="teach" aria-selected="false">Record teaching</button>
    </div>
    <div class="sb-sbvp-stage sb-sbvp-wiring" data-sbvp-stage="wiring" hidden>
      <div data-sbvp-wiring-host class="sb-nw-wiring"></div>
    </div>
    <div class="sb-sbvp-stage" data-sbvp-stage="sql" hidden>
      <div data-sbvp-sql-host class="sb-workshop-sql"></div>
    </div>
    <div class="sb-sbvp-stage" data-sbvp-stage="viewport" hidden>
      <div class="sb-live-slot sb-studio-viewport-frame" data-sb-live-slot="viewport" data-src="${src}"></div>
    </div>
    <div class="sb-sbvp-stage" data-sbvp-stage="viser" hidden>
      <div class="sb-live-slot sb-studio-viewport-frame" data-sb-live-slot="viser"></div>
    </div>
    <div class="sb-sbvp-stage" data-sbvp-stage="mujoco" hidden>
      <div class="sb-live-slot sb-studio-viewport-frame" data-sb-live-slot="mujoco" data-src="${LEGACY_MUJOCO_LAB}"></div>
    </div>
    <div class="sb-sbvp-stage" data-sbvp-stage="board" hidden>
      ${featureBoardMarkup()}
    </div>
    <div class="sb-sbvp-stage" data-sbvp-stage="wall" hidden>
      ${techWallMarkup()}
    </div>
    <div class="sb-sbvp-stage" data-sbvp-stage="teach" hidden>
      ${teachingMarkup()}
    </div>
  `;

  const wiringHost = host.querySelector("[data-sbvp-wiring-host]");
  const sqlHost = host.querySelector("[data-sbvp-sql-host]");
  let wiringApi = null;
  let wiringLoad = null;
  let sqlApi = null;
  let sqlLoad = null;
  let teachApi = null;
  let boardApi = null;
  let wallApi = null;
  let mode = "wiring";

  const slot = (id) => host.querySelector(`[data-sb-live-slot="${id}"]`);

  const ensureWiring = () => {
    if (wiringApi || !wiringHost) return Promise.resolve(wiringApi);
    if (wiringLoad) return wiringLoad;
    wiringHost.textContent = "Loading 3D wiring…";
    wiringLoad = import("./sandbox-wiring.js?v=20260923-draw-recordings1")
      .then(({ mountSandboxWiring }) => {
        wiringHost.textContent = "";
        wiringApi = mountSandboxWiring(wiringHost);
        return wiringApi;
      })
      .catch((err) => {
        wiringHost.textContent = `Wiring unavailable: ${err?.message || err}`;
        wiringLoad = null;
        return null;
      });
    return wiringLoad;
  };

  const ensureSql = () => {
    if (sqlApi || !sqlHost) return Promise.resolve(sqlApi);
    if (sqlLoad) return sqlLoad;
    sqlHost.textContent = "Loading Supabase SQL…";
    sqlLoad = import("./supabase-sql.js?v=supasql1")
      .then(({ mountSupabaseSql }) => {
        sqlHost.textContent = "";
        sqlApi = mountSupabaseSql(sqlHost);
        return sqlApi;
      })
      .catch((err) => {
        sqlHost.textContent = `SQL tab unavailable: ${err?.message || err}`;
        sqlLoad = null;
        return null;
      });
    return sqlLoad;
  };

  const parkGl = () => {
    parkLive("viewport", { keepSrc: true });
    parkLive("viser", { keepSrc: true });
    parkLive("mujoco", { keepSrc: true });
  };

  const setMode = (next) => {
    mode = WORKSHOP_MODES.includes(next) ? next : "wiring";
    host.querySelectorAll?.("[data-sbvp-mode]")?.forEach((btn) => {
      const on = btn.getAttribute("data-sbvp-mode") === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    host.querySelectorAll?.("[data-sbvp-stage]")?.forEach((stage) => {
      stage.hidden = stage.getAttribute("data-sbvp-stage") !== mode;
    });
    const gated = (id) => {
      if (isFeatureLive(id)) return false;
      const stage = host.querySelector(`[data-sbvp-stage="${mode}"]`);
      if (stage) stage.insertAdjacentHTML("afterbegin", `<p class="sb-teleop-copy" data-feat-gated>Gated on the feature board (${id}). Flip it live to open this bench.</p>`);
      return true;
    };
    host.querySelectorAll?.("[data-feat-gated]")?.forEach?.((el) => el.remove());
    if (mode === "board") {
      parkGl();
      if (!boardApi) boardApi = bindFeatureBoard(host.querySelector("[data-sb-feat-board]"));
    } else if (mode === "wall") {
      parkGl();
      if (!wallApi) wallApi = bindTechWall(host.querySelector("[data-sb-tech-wall]"));
      else void wallApi.refresh?.();
    } else if (mode === "wiring") {
      parkGl();
      if (gated("wiring")) return;
      void ensureWiring();
      try {
        window.dispatchEvent(new CustomEvent("render3d-sandbox-close-viewport", {
          detail: { source: "sbvp-wiring" },
        }));
      } catch { /* optional */ }
    } else if (mode === "sql") {
      parkGl();
      void ensureSql();
    } else if (mode === "viewport") {
      if (gated("viewport")) return;
      adoptLive("viewport", slot("viewport"), { live: true });
    } else if (mode === "viser") {
      if (gated("viser")) return;
      adoptLive("viser", slot("viser"), { live: true });
    } else if (mode === "mujoco") {
      if (gated("mujoco")) return;
      adoptLive("mujoco", slot("mujoco"), { live: true });
    } else if (mode === "teach") {
      parkGl();
      if (gated("teaching")) return;
      if (!teachApi) {
        teachApi = bindTeachingPanel(host.querySelector("[data-sb-teach]"));
      }
    }
  };

  host.querySelectorAll?.("[data-sbvp-mode]")?.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.getAttribute("data-sbvp-mode") || "wiring"));
  });

  if (typeof window !== "undefined") {
    window.addEventListener("render3d-sandbox-close-viewport", (event) => {
      const srcId = String(event?.detail?.source || "");
      if (srcId === "sbvp-wiring" || srcId === "sbvp-sql") return;
      if (mode === "viewport") setMode("board");
    });
  }

  const start = WORKSHOP_MODES.includes(defaultMode) ? defaultMode : "viewport";
  setMode(start);

  return {
    host,
    token: SBVP1_TOKEN,
    ensure() {
      setMode("viewport");
    },
    ensureWiring() {
      setMode("wiring");
      return ensureWiring();
    },
    ensureSql() {
      setMode("sql");
      return ensureSql();
    },
    ensureMujoco() {
      setMode("mujoco");
    },
    kill() {
      parkLive("viewport", { keepSrc: false });
      parkLive("viser", { keepSrc: false });
      parkLive("mujoco", { keepSrc: false });
    },
    setMode,
  };
}
