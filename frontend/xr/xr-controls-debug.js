/**
 * Compact XR Controls debug ring — Foundry "XR Controls" section.
 * No screenshots, no scene dumps, no tokens. Tens of KB, not MB.
 */

import {
  xrControlId,
  xrAxesControlId,
  xrHandSide,
} from "./xr-control-map.js?v=xrmap1-20260915-xrdbg2-20260915-finepointer2&inputfix=20260916-1";

export const XR_CONTROLS_DEBUG_HZ = 8;
export const XR_CONTROLS_RING_MS = 120000;
export const XR_CONTROLS_MAX_ROWS = 240;
export const XR_CONTROLS_MAX_EVENTS = 48;
export const XR_CONTROLS_MAX_BYTES = 72_000;
export const XR_CONTROLS_SLUG = "xr-ctl";
export const XR_CONTROLS_BUILD = "20260915-toolcontext1-xrgrab4-xrtool1-xrwin1-xrctrl1";
export const XRCTRL1_CACHE = "xrctrl1";
export const XRCTRL2_CACHE = "xrctrl2";

/** Compact talk-time feed for Astra + grok/harness. No scene, no secrets. */
export function compactTalkControlsFeed({
  controls = null,
  overlayHit = "",
  dimosArmed = false,
  astraTalk = false,
  triggerAllowed = true,
} = {}) {
  const rows = Array.isArray(controls?.rows) ? controls.rows.slice(-6) : [];
  const ev = Array.isArray(controls?.ev) ? controls.ev.slice(-8) : [];
  return {
    v: 1,
    kind: "xr-ctl-talk",
    build: XRCTRL2_CACHE,
    dimos: dimosArmed ? 1 : 0,
    talk: astraTalk ? 1 : 0,
    ov: String(overlayHit || "").slice(0, 16),
    allowTr: triggerAllowed ? 1 : 0,
    last: rows.map((row) => ({
      t: Number(row?.t) || 0,
      tr: Number(row?.r?.tr || row?.l?.tr || 0) || 0,
      sq: Number(row?.r?.sq || row?.l?.sq || 0) || 0,
      c: String(row?.c || "").slice(0, 12),
      hit: String(row?.hit || "").slice(0, 12),
    })),
    ev: ev.map((row) => ({
      t: Number(row?.t) || 0,
      ev: String(row?.ev || "").slice(0, 8),
      c: String(row?.c || "").slice(0, 12),
      h: String(row?.h || "").slice(0, 2),
    })),
  };
}

export function xrControlsShouldSample({
  lastAt = 0,
  now = 0,
  hz = XR_CONTROLS_DEBUG_HZ,
  edge = false,
} = {}) {
  if (edge === true) return true;
  const rate = Number(hz);
  const minMs = 1000 / (Number.isFinite(rate) && rate > 0 ? rate : XR_CONTROLS_DEBUG_HZ);
  return Number(now) - Number(lastAt) >= minMs;
}

export function xrControlsRingPush(rows, row, {
  maxRows = XR_CONTROLS_MAX_ROWS,
  windowMs = XR_CONTROLS_RING_MS,
} = {}) {
  const next = Array.isArray(rows) ? rows.slice() : [];
  if (row && typeof row === "object") next.push(row);
  const cap = Number(maxRows) > 0 ? Number(maxRows) : XR_CONTROLS_MAX_ROWS;
  const win = Number(windowMs) > 0 ? Number(windowMs) : XR_CONTROLS_RING_MS;
  const newest = Number(next[next.length - 1]?.t) || 0;
  const cut = newest - win;
  while (next.length > cap) next.shift();
  while (next.length && (Number(next[0]?.t) || 0) < cut) next.shift();
  return next;
}

export function edgeSnapshot(row) {
  const l = row?.l;
  const r = row?.r;
  const u = row?.u;
  const h = (r && typeof r === "object" && "tr" in r) ? r
    : (l && typeof l === "object" && "tr" in l) ? l
      : (u && typeof u === "object" && "tr" in u) ? u
        : row;
  if (!h || typeof h !== "object") {
    return {
      tr: 0,
      sq: 0,
      a: 0,
      b: 0,
      sel: 0,
      sqe: 0,
      st: 0,
      menu: 0,
      move: 0,
      c: String(row?.c || ""),
      on: [],
    };
  }
  return {
    tr: Number(r?.tr || l?.tr || u?.tr || h.tr) || 0,
    sq: Number(r?.sq || l?.sq || u?.sq || h.sq) || 0,
    a: Number(r?.a || l?.a || u?.a || h.a) || 0,
    b: Number(r?.b || l?.b || u?.b || h.b) || 0,
    st: Number(r?.st || l?.st || u?.st || h.st) || 0,
    menu: Number(r?.menu || l?.menu || u?.menu || h.menu) || 0,
    move: Number(r?.move || l?.move || u?.move || h.move) || 0,
    sel: row?.ev === "sel" || row?.ev === "selend" ? 1 : 0,
    sqe: row?.ev === "sq" || row?.ev === "sqend" ? 1 : 0,
    c: String(row?.c || ""),
    on: Array.isArray(r?.on) ? r.on : Array.isArray(l?.on) ? l.on : Array.isArray(h.on) ? h.on : [],
    // OR-ing hands alone loses a left-hand press while the right is held.
    hands: [l, r, u].map((side) => side
      ? ["tr", "sq", "a", "b", "st", "menu", "move"].map((key) => Number(side[key]) || 0).join("")
        + ":" + (Array.isArray(side.on) ? side.on.join(",") : "")
      : "-").join("|"),
  };
}

export function xrControlsButtonEdge(prev, next) {
  if (!next || typeof next !== "object") return false;
  if (!prev || typeof prev !== "object") {
    return !!(next.tr || next.sq || next.a || next.b || next.sel || next.sqe || next.st || next.menu);
  }
  const keys = ["tr", "sq", "a", "b", "sel", "sqe", "c", "st", "menu", "move", "hands"];
  for (const k of keys) {
    if ((prev[k] || 0) !== (next[k] || 0)) return true;
  }
  const po = Array.isArray(prev.on) ? prev.on.join(",") : "";
  const no = Array.isArray(next.on) ? next.on.join(",") : "";
  return po !== no;
}

/**
 * Who should own this select. Studio HUD always beats DIMOS.
 * DIMOS never consumes when Robot / Activate is off.
 */
export function xrSelectConsumeTarget({
  dimosArmed = false,
  uiHit = false,
  nearMenu = false,
  rayOnMenu = false,
  hasPick = false,
  blocked = "",
} = {}) {
  const block = String(blocked || "").slice(0, 12);
  if (block) return block;
  if (uiHit === true || nearMenu === true || rayOnMenu === true) return "ui";
  if (dimosArmed === true) return "dimos";
  if (hasPick === true) return "pick";
  return "miss";
}

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function btnBit(buttons, index) {
  return buttons?.[index]?.pressed === true ? 1 : 0;
}

function axesMoving(axes, dead = 0.2) {
  const ax = Array.isArray(axes) ? axes : [];
  return ax.some((n) => Math.abs(Number(n) || 0) >= dead);
}

function handKey(handedness) {
  if (handedness === "left") return "l";
  if (handedness === "right") return "r";
  return "u";
}

export function compactXrInputSource(source) {
  if (!source) return null;
  const gp = source.gamepad;
  const profiles = Array.isArray(source.profiles) ? source.profiles : [];
  const prof = String(profiles[0] || "").slice(0, 28);
  return {
    h: handKey(source.handedness),
    m: String(source.targetRayMode || "").slice(0, 16),
    p: prof,
    g: gp ? 1 : 0,
    map: String(gp?.mapping || "").slice(0, 12),
    n: gp?.buttons?.length || 0,
    hand: source.hand ? 1 : 0,
  };
}

export function compactXrGamepadHands(inputSources = []) {
  const out = {};
  for (const source of inputSources || []) {
    const key = handKey(source?.handedness);
    const side = xrHandSide(source?.handedness) || (key === "l" ? "left" : key === "r" ? "right" : "");
    const gp = source?.gamepad;
    const buttons = gp?.buttons || [];
    const axes = gp?.axes || [];
    const extra = [];
    const on = [];
    const named = (index) => {
      const id = xrControlId(index, side || source?.handedness);
      if (id && !on.includes(id)) on.push(id);
    };
    if (btnBit(buttons, 0)) named(0);
    if (btnBit(buttons, 1)) named(1);
    if (btnBit(buttons, 3)) named(3);
    if (btnBit(buttons, 4)) named(4);
    if (btnBit(buttons, 5)) named(5);
    for (let i = 0; i < buttons.length && i < 16; i += 1) {
      if (i === 0 || i === 1 || i === 3 || i === 4 || i === 5) continue;
      if (!btnBit(buttons, i)) continue;
      if (i === 7 && key === "l") continue;
      extra.push(i);
      named(i);
    }
    const menu = key === "l" && btnBit(buttons, 7) ? 1 : 0;
    if (menu) named(7);
    const move = axesMoving(axes) ? 1 : 0;
    if (move) {
      const axId = xrAxesControlId(side || source?.handedness);
      if (!on.includes(axId)) on.push(axId);
    }
    const row = {
      tr: btnBit(buttons, 0),
      sq: btnBit(buttons, 1),
      a: btnBit(buttons, 4),
      b: btnBit(buttons, 5),
      st: btnBit(buttons, 3),
      ax: [0, 1, 2, 3].map((i) => round2(axes[i])),
      g: gp ? 1 : 0,
      m: String(source.targetRayMode || "").slice(0, 16),
    };
    if (move) row.move = 1;
    if (on.length) row.on = on;
    if (menu) row.menu = 1;
    if (extra.length) row.x = extra;
    // Unlabeled pad still records — last unlabeled overwrites `u`.
    out[key] = row;
  }
  return out;
}

export function compactXrControlRow({
  t = 0,
  fps = 0,
  dt = 0,
  dropped = 0,
  throttle = 0,
  hands = null,
  consume = "",
  ev = "",
  hit = "",
  hand = "",
  nSrc = 0,
  interaction = null,
} = {}) {
  const row = {
    t: Math.round(Number(t) || 0),
    f: round2(fps),
    dt: round2(dt),
    drop: dropped ? 1 : 0,
    th: throttle ? 1 : 0,
    n: Number(nSrc) || 0,
  };
  if (hands && typeof hands === "object") {
    if (hands.l) row.l = hands.l;
    if (hands.r) row.r = hands.r;
    if (hands.u) row.u = hands.u;
  }
  const inferred = hand
    || (hands?.r?.tr ? "r" : hands?.l?.tr ? "l" : hands?.u?.tr ? "u" : "");
  const hh = String(inferred || "").slice(0, 2);
  if (hh) row.h = hh;
  const c = String(consume || "").slice(0, 12);
  if (c) row.c = c;
  const e = String(ev || "").slice(0, 8);
  if (e) row.ev = e;
  row.hit = String(hit || "miss").slice(0, 12) || "miss";
  const detail = compactXrInteraction(interaction);
  if (detail) row.interaction = detail;
  return row;
}

/** Optional numeric poses and short target labels; never serialize scene objects. */
export function compactXrInteraction(interaction) {
  if (!interaction || typeof interaction !== "object") return null;
  const out = {};
  for (const hand of ["l", "r"]) {
    const input = interaction[hand];
    if (!input || typeof input !== "object") continue;
    const side = {};
    for (const key of ["aim", "grip"]) {
      const pose = input[key];
      if (Array.isArray(pose) && pose.length === 7 && pose.every(Number.isFinite)) {
        side[key] = pose.map((value) => Math.round(value * 1000) / 1000);
      }
    }
    for (const key of ["hit", "near", "held"]) {
      if (typeof input[key] === "string") side[key] = input[key].slice(0, 64);
    }
    if (Number.isFinite(input.distance)) side.distance = Math.round(input.distance * 1000) / 1000;
    if (Object.keys(side).length) out[hand] = side;
  }
  return Object.keys(out).length ? out : null;
}

export function compactXrSessionMeta({
  started = false,
  ended = false,
  mode = "",
  ref = "",
  blend = "",
  nSrc = 0,
} = {}) {
  return {
    on: started ? 1 : 0,
    end: ended ? 1 : 0,
    mode: String(mode || "").slice(0, 16),
    ref: String(ref || "").slice(0, 16),
    blend: String(blend || "").slice(0, 12),
    n: Number(nSrc) || 0,
  };
}

export function compactXrOverrideFlags({
  dimosArmed = false,
  snapLaser = false,
  sticky = false,
  laser = false,
} = {}) {
  return {
    d: dimosArmed ? 1 : 0,
    s: snapLaser ? 1 : 0,
    st: sticky ? 1 : 0,
    l: laser ? 1 : 0,
  };
}

function utf8Bytes(text) {
  try {
    return new TextEncoder().encode(String(text || "")).length;
  } catch {
    return String(text || "").length;
  }
}

/** Thin older poses before dropping control history to fit the upload budget. */
export function capXrControlsPayload(payload, maxBytes = XR_CONTROLS_MAX_BYTES) {
  const cap = Number(maxBytes) > 0 ? Number(maxBytes) : XR_CONTROLS_MAX_BYTES;
  const body = payload && typeof payload === "object" ? { ...payload } : {};
  const controls = body.controls && typeof body.controls === "object" ? { ...body.controls } : {};
  let rows = Array.isArray(controls.rows) ? controls.rows.slice() : [];
  let samples = Array.isArray(body.samples) ? body.samples.slice() : [];
  let events = Array.isArray(controls.ev) ? controls.ev.slice() : [];
  const pack = () => {
    const next = {
      ...body,
      samples,
      controls: { ...controls, rows, ev: events },
    };
    return { next, text: JSON.stringify(next) };
  };
  let { next, text } = pack();
  // Full poses on every 8 Hz row can otherwise consume the whole budget and
  // leave only ~10 seconds of buttons. Keep recent poses and every event;
  // progressively thin older periodic detail while retaining its button rows.
  const overBudget = () => utf8Bytes(text) + 24 > cap; // room for _bytes
  for (let stride = 2; overBudget() && stride <= rows.length * 2; stride *= 2) {
    rows = rows.map((row, index) => {
      if (index >= rows.length - 8 || index % stride === 0 || !row?.interaction) return row;
      const { interaction, ...periodic } = row;
      return periodic;
    });
    ({ next, text } = pack());
  }
  while (overBudget() && (rows.length > 8 || samples.length > 8 || events.length > 4)) {
    if (rows.length > 8) rows = rows.slice(Math.ceil(rows.length * 0.15) || 1);
    else if (samples.length > 8) samples = samples.slice(Math.ceil(samples.length * 0.15) || 1);
    else events = events.slice(-4);
    ({ next, text } = pack());
  }
  if (overBudget()) {
    rows = rows.slice(-8);
    samples = samples.slice(-8);
    events = events.slice(-4);
    ({ next, text } = pack());
  }
  next._bytes = 0;
  next._bytes = utf8Bytes(JSON.stringify(next));
  next._bytes = utf8Bytes(JSON.stringify(next));
  return next;
}

export function createXrControlsRecorder() {
  let rows = [];
  let events = [];
  let lastSampleAt = null;
  let lastRow = null;
  let session = null;
  let sources = [];
  let overrides = compactXrOverrideFlags({});
  let startedAt = null;
  let teleopY = null;

  function reset() {
    rows = [];
    events = [];
    lastSampleAt = null;
    lastRow = null;
    session = null;
    sources = [];
    overrides = compactXrOverrideFlags({});
    startedAt = null;
    teleopY = null;
  }

  function noteSession(meta) {
    session = compactXrSessionMeta(meta || {});
    const t = Math.round(Number.isFinite(meta?.t) ? meta.t : (typeof performance !== "undefined" ? performance.now() : 0));
    events = xrControlsRingPush(events, {
      t,
      ev: session.end ? "end" : "sess",
      mode: session.mode,
      ref: session.ref,
      n: session.n,
    }, { maxRows: XR_CONTROLS_MAX_EVENTS, windowMs: XR_CONTROLS_RING_MS * 4 });
    if (startedAt == null) startedAt = t;
  }

  function noteSources(list) {
    const next = [];
    for (const s of inputSourceList(list)) {
      const row = compactXrInputSource(s);
      if (row) next.push(row);
    }
    sources = next.slice(0, 4);
    const t = Math.round(typeof performance !== "undefined" ? performance.now() : 0);
    events = xrControlsRingPush(events, {
      t,
      ev: "src",
      n: sources.length,
      h: sources.map((s) => s.h).join(""),
    }, { maxRows: XR_CONTROLS_MAX_EVENTS, windowMs: XR_CONTROLS_RING_MS * 4 });
  }

  function noteEvent(ev, extra = {}) {
    const t = Math.round(Number(extra.t) || (typeof performance !== "undefined" ? performance.now() : 0));
    const row = {
      t,
      ev: String(ev || "").slice(0, 8),
      c: String(extra.consume || extra.c || "").slice(0, 12),
      h: String(extra.h || "").slice(0, 2),
    };
    if (extra.both) row.both = 1;
    if (extra.st != null) row.st = Number(extra.st) || 0;
    events = xrControlsRingPush(events, row, { maxRows: XR_CONTROLS_MAX_EVENTS, windowMs: XR_CONTROLS_RING_MS * 4 });
  }

  function noteFrame({
    now = 0,
    fps = 0,
    dt = 0,
    dropped = false,
    throttle = false,
    inputSources = null,
    consume = "",
    ev = "",
    hit = "",
    hand = "",
    ov = null,
    interaction = null,
    teleopY: yDebug = null,
  } = {}) {
    if (yDebug) teleopY = {
      build: String(yDebug.build || "").slice(0, 40), sampledAt: Number(yDebug.sampledAt) || 0,
      pressed: yDebug.pressed === true, action: String(yDebug.action || "").slice(0, 32),
      actionAt: Number(yDebug.actionAt) || 0, armed: yDebug.armed === true,
      pendingStart: yDebug.pendingStart === true, stopPhase: String(yDebug.stopPhase || "").slice(0, 24),
      profileMap: String(yDebug.profileMap || "").slice(0, 64), liveMap: String(yDebug.liveMap || "").slice(0, 64),
    };
    const t = Number(now) || 0;
    if (startedAt == null) startedAt = t;
    const liveSources = inputSourceList(inputSources);
    const hands = compactXrGamepadHands(liveSources);
    if (ov) overrides = compactXrOverrideFlags(ov);
    const packed = compactXrControlRow({
      t: Math.round(t - startedAt),
      fps,
      dt,
      dropped: dropped ? 1 : 0,
      throttle: throttle ? 1 : 0,
      hands,
      consume,
      ev,
      hit: hit || "miss",
      hand,
      nSrc: inputSources == null ? sources.length : liveSources.length,
      interaction,
    });
    const edge = xrControlsButtonEdge(edgeSnapshot(lastRow), edgeSnapshot(packed));
    // Edges have their own bounded ring; a held button/consume="miss" must
    // not force 72–90 Hz samples and evict the user's preceding grab attempt.
    if (edge || ev) {
      events = xrControlsRingPush(events, { ...packed, t: Math.round(t), ev: ev || "input" }, {
        maxRows: XR_CONTROLS_MAX_EVENTS,
        windowMs: XR_CONTROLS_RING_MS * 4,
      });
    }
    lastRow = packed;
    if (lastSampleAt != null && !xrControlsShouldSample({ lastAt: lastSampleAt, now: t })) return null;
    lastSampleAt = t;
    rows = xrControlsRingPush(rows, packed);
    return packed;
  }

  function snapshot() {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    return {
      section: "xr-controls",
      build: XR_CONTROLS_BUILD,
      hz: XR_CONTROLS_DEBUG_HZ,
      windowMs: XR_CONTROLS_RING_MS,
      sess: session || compactXrSessionMeta({}),
      src: sources,
      ov: overrides,
      teleopY,
      ev: events.slice(),
      rows: rows.slice(),
      durationMs: startedAt != null ? Math.round(now - startedAt) : 0,
    };
  }

  return { reset, noteSession, noteSources, noteEvent, noteFrame, snapshot };
}

function inputSourceList(list) {
  if (!list) return [];
  try {
    return [...list];
  } catch {
    return [];
  }
}
