/**
 * Always-on sandbox live feed: /mcp/stats + /api/health + logs + client obs.
 * Bot control: generate tasks, shared male voice.
 * Token livefeed1.
 */

import { getJson, bump, debugState } from "./bus.js";
import { summarizeStats } from "./charts.js";
import { assignTask, snapshot as taskSnapshot } from "./agent-tasks.js?v=20260923-draw-recordings1";
import {
  getTalkMode,
  talkModeLabel,
  floorHolder,
} from "./tts-mutex.js?v=20260923-singlevoice1";
import { fetchTokenStatus, tokenStatusHtml } from "./token-status.js?v=tokstat1";
import { checkConfigOverlap, overlapHtml } from "./config-overlap.js?v=20260917-cfgov2";
import { dimosControlBindingsSnapshot } from "../xr/xr-dimos-controls.js?v=sam-y-engage-v2";


export const LIVEFEED1_TOKEN = "livefeed1";

const GENERATE_PROMPTS = [
  "Probe /mcp/stats and classify COMM-MISS vs REPORT score",
  "Find Super IDE collab index and list live/ files",
  "Ensure DIMOS coordinator for sandbox (probe only — no arm)",
  "Compare golden WebGL/XR trigger vs current client observation",
  "Write a Gauge-format pass/fail for VR control profile edges",
];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function webglAlive() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { ok: false, detail: "no WebGL context" };
    const lost = typeof gl.isContextLost === "function" && gl.isContextLost();
    return { ok: !lost, detail: lost ? "context lost" : "context alive" };
  } catch (err) {
    return { ok: false, detail: String(err?.message || err).slice(0, 80) };
  }
}

function xrInputMap() {
  const snap = dimosControlBindingsSnapshot();
  const gp = navigator.getGamepads?.() || [];
  const pads = [...gp].filter(Boolean);
  const xr = !!(navigator.xr);
  return {
    xr_api: xr ? "ok" : "missing",
    gamepads: pads.length,
    select_mapped: snap.bindings.jaw.input,
    squeeze_mapped: snap.bindings.hud_grab.input,
    engage: snap.bindings.engage,
    reset: snap.bindings.reset,
    gripper: snap.bindings.gripper,
    live: snap.live,
    detail: pads.length
      ? `${pads.length} pad(s) · Y=${snap.live.y} · trigger=${snap.live.trigger} · grip=${snap.live.grip}`
      : "no gamepad — profile bindings ready; enter VR / Quest for live edges",
  };
}

export async function collectLiveSnapshot() {
  const [stats, health, reports, collab, coord, tokens] = await Promise.all([
    getJson("/mcp/stats?t=" + Date.now()),
    getJson("/api/health?t=" + Date.now()),
    getJson("/mcp/reports?t=" + Date.now()),
    getJson("/mcp/collab-index?t=" + Date.now()),
    getJson("/api/dimos/coordinator?t=" + Date.now()).catch(() => null),
    fetchTokenStatus(60),
  ]);
  const summary = summarizeStats(stats, reports, tokens);
  const gl = webglAlive();
  const xr = xrInputMap();
  const controlSnap = dimosControlBindingsSnapshot();
  const ide = document.getElementById("sb-ide") || document.getElementById("sb-pane-code") || document.querySelector("[data-pane='code']");
  const superIde = document.getElementById("sb-super-ide");
  const collabFiles = (collab?.index?.files || collab?.files || []).length;
  return {
    token: LIVEFEED1_TOKEN,
    at: new Date().toISOString(),
    stats: summary,
    tokens,
    talk: { mode: getTalkMode(), label: talkModeLabel() },
    overlap: checkConfigOverlap({ talkMode: getTalkMode(), floor: floorHolder() }),
    health: {
      ok: health?.status === "ok" || health?.ok === true,
      status: health?.status || health?.detail || (health ? "present" : "unreachable"),
      raw: health,
    },
    client: {
      webgl: gl,
      xr,
      vr_trigger: controlSnap.live.trigger,
      vr_controls: controlSnap,
    },
    collab: {
      files: collabFiles,
      ide_dom: !!ide,
      super_ide: !!superIde,
      path: "Super IDE → NW Collaborate ID · SE Projects (FILEVIEW1) / Debugger VR",
    },
    dimos: {
      up: !!(coord?.up || coord?.running || coord?.listening || coord?.started || coord?.status === "starting" || coord?.status === "already_up"),
      process: !!coord?.process,
      detail: (() => {
        if (!coord) return "coordinator unreachable";
        if (coord.up || coord.status === "already_up") return `${coord.blueprint || "teleop"} · :${coord.port || 8443}`;
        if (coord.started || coord.status === "starting") return `starting · ${coord.blueprint || "teleop"}`;
        if (coord.process || coord.status === "already_running") return `process · waiting :${coord.port || 8443} · ${coord.blueprint || "teleop"}`;
        return `down · ${coord.blueprint || "teleop-quest-openarm"}`;
      })(),
      bin_hint: coord?.dimos_bin || null,
    },
    logs: {
      lastTts: debugState.lastTts || "—",
      lastStt: debugState.lastStt || "—",
      lastFetchError: debugState.lastFetchError || null,
      // Look further than 8 — feed the last 24 REPORT-ish + prompt-trace tails
      reports: (reports?.reports || []).slice(-24),
      promptTail: (tokens?.series || []).slice(-12),
    },
    tasks: taskSnapshot(),
  };
}

export function recommendNextSteps(snap) {
  const steps = [];
  if (!snap?.health?.ok) steps.push({ id: "health", pass: false, do: "Fix /api/health before VR classify" });
  else steps.push({ id: "health", pass: true, do: "Health ok" });
  if (!snap?.stats?.bars?.length) steps.push({ id: "stats", pass: false, do: "Recycle grok-bot if /mcp/stats 404" });
  else steps.push({ id: "stats", pass: true, do: `Stats visible · REPORT n=${snap.stats.bars[0]?.n ?? "?"}` });
  if (!snap?.client?.webgl?.ok) steps.push({ id: "webgl", pass: false, do: "WebGL dead — check browser/GPU" });
  else steps.push({ id: "webgl", pass: true, do: "WebGL context alive (desktop)" });
  const ctrl = snap?.client?.vr_controls;
  const triggerLive = snap?.client?.vr_trigger;
  if (ctrl?.bindings?.engage?.input === "Y" && ctrl?.bindings?.gripper?.action === "removed") {
    const edgeOk = triggerLive === "down" || triggerLive === "up";
    steps.push({
      id: "vr_trigger",
      pass: edgeOk,
      do: edgeOk
        ? `VR controls live · Y=${ctrl.live?.y} · trigger=${triggerLive} · grip binding removed`
        : "VR profile locked (Y engage) — enter Quest for live trigger edge",
    });
  } else {
    steps.push({
      id: "vr_trigger",
      pass: false,
      do: "VR controls profile missing Y-engage lock — check xr-dimos-controls",
    });
  }
  if (!snap?.collab?.super_ide) steps.push({ id: "collab", pass: false, do: "Mount Super IDE (#sb-super-ide)" });
  else steps.push({ id: "collab", pass: true, do: `Collab IDE found · ${snap.collab.files} index files · open SE Code` });
  if (!snap?.dimos?.up) {
    steps.push({ id: "dimos", pass: false, do: "Local DIMOS coordinator down — Ensure coordinator, then probe robot PC separately" });
  } else {
    steps.push({ id: "dimos", pass: true, do: "DIMOS coordinator up (sandbox probe)" });
  }
  if (snap?.tokens?.high) {
    steps.push({ id: "tokens", pass: false, do: `Token usage HIGH Σ≈${snap.tokens.tokens_total} — shorten prompts / stop multi-agent chatter` });
  } else if (snap?.tokens?.warn) {
    steps.push({ id: "tokens", pass: false, do: `Token usage WARN Σ≈${snap.tokens.tokens_total}` });
  } else {
    steps.push({ id: "tokens", pass: true, do: `Tokens OK · lookback ${snap?.tokens?.lookback || 0}` });
  }
  if (snap?.overlap && !snap.overlap.ok) {
    steps.push({ id: "overlap", pass: false, do: `Config overlap — ${snap.overlap.issues.join("; ")}` });
  } else {
    steps.push({ id: "overlap", pass: true, do: "Config overlap OK" });
  }
  return steps;
}

function paintFeed(host, snap, steps) {
  const bars = (snap.stats?.bars || [])
    .map((b) => `<span class="sb-feed-chip">${esc(b.label)} <b>${esc(b.n)}</b></span>`)
    .join("");
  const logRows = [
    ...(snap.logs?.promptTail || []).map((r) =>
      `<li class="sb-feed-prompt-row"><code>${esc(r.log_id)}</code> ≈${esc(r.tokens)} ${esc(r.result)} · ${esc(r.prompt)}</li>`),
    ...(snap.logs?.reports || []).map((r) =>
      `<li>${esc(r.agent || "")} score=${esc(r.result_score ?? "?")} ${esc(r.log_id || "")}</li>`),
  ].join("") || "<li>no deeper log rows</li>";
  const stepRows = steps
    .map((s) => `<li class="${s.pass ? "is-pass" : "is-fail"}"><span>${s.pass ? "PASS" : "NEED"}</span> ${esc(s.do)}</li>`)
    .join("");
  const feedBody = host.querySelector("[data-sb-feed-body]");
  if (!feedBody) return;
  feedBody.innerHTML = `
    <div class="sb-feed-row">
      <span class="sb-feed-k">health</span>
      <span class="${snap.health.ok ? "is-ok" : "is-bad"}">${esc(snap.health.status)}</span>
      <span class="sb-feed-k">webgl</span>
      <span class="${snap.client.webgl.ok ? "is-ok" : "is-bad"}">${esc(snap.client.webgl.detail)}</span>
      <span class="sb-feed-k">talk</span>
      <span class="is-ok">${esc(snap.talk?.label || "1 person")}</span>
      ${overlapHtml(snap.overlap || { ok: true, label: "overlap OK", issues: [] })}
    </div>
    <div class="sb-feed-chips">${bars || "<span class='muted small'>stats pending</span>"}</div>
    ${tokenStatusHtml(snap.tokens || {})}
    <div class="sb-feed-row">
      <span class="sb-feed-k">collab</span>
      <span>${esc(snap.collab.path)} · ${snap.collab.files} files · DOM ${snap.collab.super_ide ? "yes" : "no"}</span>
    </div>
    <div class="sb-feed-row">
      <span class="sb-feed-k">local DIMOS coordinator</span>
      <span class="${snap.dimos.up ? "is-ok" : "is-bad"}">${snap.dimos.up ? "up" : "down"} · ${esc(snap.dimos.detail)}</span>
      <span class="sb-feed-k">xr</span>
      <span>${esc(snap.client.xr.detail)}</span>
    </div>
    <div class="sb-feed-split">
      <div>
        <p class="sb-kicker">GAUGE NEXT</p>
        <ul class="sb-feed-steps">${stepRows}</ul>
      </div>
      <div>
        <p class="sb-kicker">DEEPER LOG (prompt-trace + REPORT)</p>
        <ul class="sb-log sb-feed-log">${logRows}</ul>
        <p class="muted small">TTS: ${esc(snap.logs.lastTts)}</p>
      </div>
    </div>
  `;
}

export function mountLiveFeed(host, { speak } = {}) {
  if (!host) return null;
  host.classList.add("sb-live-feed");
  host.dataset.token = LIVEFEED1_TOKEN;
  host.innerHTML = `
    <header class="sb-feed-head">
      <div>
        <span class="sb-kicker">LIVE FEED · ${LIVEFEED1_TOKEN}</span>
        <h2>Stats · health · logs · bot control</h2>
      </div>
      <div class="sb-feed-actions">
        <button type="button" class="sb-agent-btn" data-sb-feed-refresh>Refresh</button>
        <button type="button" class="sb-agent-btn sb-agent-btn--astra" data-sb-bot-generate title="Bots generate next work items">Generate tasks</button>
        <button type="button" class="sb-agent-btn" data-sb-bot-test title="Run bot recommendation test">Run bot test</button>
        <span class="sb-feed-status" data-sb-feed-status role="status">Idle</span>
      </div>
    </header>
    <label class="sb-feed-prompt">
      <span>Tell bots what to generate</span>
      <input type="text" data-sb-gen-prompt placeholder="e.g. Generate a Gauge gate for VR trigger + collab IDE smoke" />
    </label>
    <div data-sb-feed-body class="sb-feed-body"><p class="muted small">Loading live feed…</p></div>
  `;

  const status = () => host.querySelector("[data-sb-feed-status]");
  const setStatus = (msg) => { if (status()) status.textContent = msg; };

  const refresh = async () => {
    setStatus("Polling…");
    try {
      const snap = await collectLiveSnapshot();
      const steps = recommendNextSteps(snap);
      paintFeed(host, snap, steps);
      bump({
        commMiss: snap.stats?.bars?.find((b) => /COMM/i.test(b.label))?.n,
        reportsN: snap.stats?.bars?.find((b) => /REPORT/i.test(b.label))?.n,
      });
      setStatus(`Live · ${new Date(snap.at).toLocaleTimeString()}`);
      return { snap, steps };
    } catch (err) {
      setStatus(`Feed error · ${String(err?.message || err).slice(0, 60)}`);
      return null;
    }
  };

  host.querySelector("[data-sb-feed-refresh]")?.addEventListener("click", () => { void refresh(); });

  host.querySelector("[data-sb-bot-generate]")?.addEventListener("click", async () => {
    const custom = host.querySelector("[data-sb-gen-prompt]")?.value?.trim();
    const prompts = custom
      ? [custom, ...GENERATE_PROMPTS.slice(0, 2)]
      : GENERATE_PROMPTS;
    const agents = ["vibe-rnd", "analytics", "cursor-engineer", "project-manager", "astra"];
    const made = [];
    prompts.forEach((title, i) => {
      made.push(assignTask(agents[i % agents.length], title, { from: "bot-generate" }));
    });
    setStatus(`Generated ${made.length} tasks`);
    void refresh();
  });

  host.querySelector("[data-sb-bot-test]")?.addEventListener("click", async () => {
    const out = await refresh();
    if (!out) return;
    const { steps } = out;
    const need = steps.filter((s) => !s.pass);
    const pass = steps.filter((s) => s.pass);
    const line = `Bot test: ${pass.length} pass · ${need.length} need. Top: ${need[0]?.do || "all clear"}.`;
    setStatus(line);
    assignTask("vibe-rnd", line.slice(0, 160), { from: "bot-test" });
    assignTask("analytics", "Post Gauge gate: VR Y-engage profile + live trigger edge + log_id", { from: "bot-test" });
  });

  void refresh();
  const timer = setInterval(() => { void refresh(); }, 6000);
  return {
    token: LIVEFEED1_TOKEN,
    refresh,
    stop: () => clearInterval(timer),
  };
}
