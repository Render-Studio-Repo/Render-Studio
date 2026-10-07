/** Sandbox session change map: snapshot paths, reverse on off, agent system-check. Token map1. */

export const MAP1_TOKEN = "map1";
export const SESSION_DIR = "sandbox-sessions";

function id() {
  return (globalThis.crypto?.randomUUID?.() || `s${Date.now()}`).replace(/-/g, "").slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

async function mcpWrite(path, obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "sam", path, text: text.slice(0, 110_000) }),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false };
  return { ok: true, ...(await res.json().catch(() => ({}))) };
}

async function mcpRead(path) {
  const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(path)}&t=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, missing: true, text: "" };
  const data = await res.json().catch(() => ({}));
  return { ok: true, missing: false, text: String(data.text || ""), path: data.path || path };
}

async function notifyAgents(text) {
  await fetch("/mcp/group-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "post",
      agent: "sam",
      text: `@cursor-engineer @vibe-rnd @analytics ${text}`.slice(0, 1400),
    }),
  }).catch(() => null);
}

/** @type {{ sessionId: string, startedAt: string, entries: object[], voiceSteps: object[], refs: object[], openArm: string } | null} */
let session = null;

export function currentSession() {
  return session;
}

export function isSessionActive() {
  return !!session;
}

export function startChangeSession({ reason = "sandbox_on", openArm = "2.0" } = {}) {
  session = {
    sessionId: id(),
    startedAt: nowIso(),
    reason,
    openArm,
    token: MAP1_TOKEN,
    entries: [],
    voiceSteps: [],
    refs: [
      {
        ref_id: `ref-openarm-${openArm.replace(/\W+/g, "")}`,
        kind: "product",
        label: `OpenArm ${openArm}`,
        path: "openarm-teleop/rig.schema.json",
        note: "Headset avatar → OpenArm proxy; simulation only until URDF calibrated",
      },
    ],
    status: "active",
  };
  void persistSession();
  void notifyAgents(
    `Sandbox map session ${session.sessionId.slice(0, 8)} started · OpenArm ${openArm} · writes under frontend/sandbox only · token ${MAP1_TOKEN}`,
  );
  return { ...session };
}

export function addReferencePoint({ kind = "checkpoint", label = "", path = "", note = "", promptId = "" } = {}) {
  if (!session) return null;
  const ref = {
    ref_id: `ref-${id().slice(0, 10)}`,
    kind,
    label: String(label || path || kind).slice(0, 120),
    path: String(path || "").replace(/^frontend\/sandbox\//, "").slice(0, 200),
    note: String(note || "").slice(0, 400),
    prompt_id: String(promptId || "").slice(0, 80),
    at: nowIso(),
  };
  session.refs.push(ref);
  void persistSession();
  return ref;
}

export async function recordMappedWrite(path, { afterText = "", source = "write", voiceStepId = "" } = {}) {
  if (!session) return null;
  const rel = String(path || "").replace(/^frontend\/sandbox\//, "");
  if (!rel) return null;
  const existing = session.entries.find((e) => e.path === rel && e.status === "mapped");
  if (existing) {
    existing.after_tip = String(afterText || "").slice(0, 400);
    existing.source = source;
    existing.updated_at = nowIso();
    if (voiceStepId) existing.voice_step_ids = [...new Set([...(existing.voice_step_ids || []), voiceStepId])];
    void persistSession();
    return existing;
  }
  const before = await mcpRead(rel);
  const entry = {
    map_id: `map-${id().slice(0, 10)}`,
    path: rel,
    status: "mapped",
    created: before.missing === true || !before.ok,
    before_text: before.ok ? before.text : "",
    after_tip: String(afterText || "").slice(0, 400),
    source,
    voice_step_ids: voiceStepId ? [voiceStepId] : [],
    ref_id: addReferencePoint({ kind: "code", label: rel, path: rel, note: `first touch · ${source}` })?.ref_id,
    at: nowIso(),
    updated_at: nowIso(),
  };
  session.entries.push(entry);
  void persistSession();
  return entry;
}

export function logVoiceStep(text, { kind = "step", corrective = false } = {}) {
  if (!session) return null;
  const step = {
    step_id: `vs-${id().slice(0, 10)}`,
    kind: corrective ? "corrective" : kind,
    text: String(text || "").slice(0, 800),
    at: nowIso(),
  };
  session.voiceSteps.push(step);
  if (corrective) {
    addReferencePoint({
      kind: "corrective",
      label: "voice correction",
      note: step.text.slice(0, 200),
    });
  }
  void persistSession();
  return step;
}

async function persistSession() {
  if (!session) return;
  const slim = {
    ...session,
    entries: session.entries.map((e) => ({
      ...e,
      before_text: undefined,
      before_bytes: (e.before_text || "").length,
      has_before: !!(e.before_text || e.created),
    })),
  };
  await mcpWrite(`${SESSION_DIR}/latest.json`, slim);
  await mcpWrite(`${SESSION_DIR}/${session.sessionId}.json`, {
    ...session,
    entries: session.entries.map((e) => ({
      map_id: e.map_id,
      path: e.path,
      status: e.status,
      created: e.created,
      before_text: e.before_text,
      after_tip: e.after_tip,
      source: e.source,
      voice_step_ids: e.voice_step_ids,
      ref_id: e.ref_id,
      at: e.at,
    })),
  });
}

export async function reverseSessionChanges() {
  if (!session) return { ok: false, reversed: [] };
  const reversed = [];
  for (const entry of session.entries) {
    if (entry.status === "reversed") continue;
    if (entry.created) {
      await mcpWrite(entry.path, `/* reverted sandbox session ${session.sessionId} — file was created in-session */\n`);
    } else {
      await mcpWrite(entry.path, entry.before_text || "");
    }
    entry.status = "reversed";
    entry.reversed_at = nowIso();
    reversed.push(entry.path);
  }
  return { ok: true, reversed, sessionId: session.sessionId };
}

export async function runSystemCheck() {
  if (!session) return { ok: false };
  const check = {
    kind: "sandbox_system_check",
    token: MAP1_TOKEN,
    session_id: session.sessionId,
    open_arm: session.openArm,
    started_at: session.startedAt,
    ended_at: nowIso(),
    files_touched: session.entries.map((e) => e.path),
    refs: session.refs,
    voice_steps: session.voiceSteps.length,
    corrective_steps: session.voiceSteps.filter((s) => s.kind === "corrective").length,
    reversed: session.entries.filter((e) => e.status === "reversed").map((e) => e.path),
    ask: "Analyze mapped sandbox diffs vs last golden snapshot. List regressions for viewport.boot, viewport.models, vr.controllers.trigger, OpenArm 2.0 teleop packet path. Do not promote to production.",
  };
  await mcpWrite(`${SESSION_DIR}/${session.sessionId}-system-check.json`, check);
  await mcpWrite(`${SESSION_DIR}/latest-system-check.json`, check);
  await notifyAgents(
    `System check for sandbox session ${session.sessionId.slice(0, 8)}: ${check.files_touched.length} files · ${check.voice_steps} voice steps · ${check.corrective_steps} corrective · read sandbox-sessions/latest-system-check.json · OpenArm ${session.openArm}`,
  );
  return { ok: true, check };
}

export async function endChangeSession({ reverse = true, systemCheck = true } = {}) {
  if (!session) return { ok: false, reason: "no_session" };
  let reversed = [];
  if (reverse) {
    const out = await reverseSessionChanges();
    reversed = out.reversed || [];
  }
  let check = null;
  if (systemCheck) {
    const out = await runSystemCheck();
    check = out.check || null;
  }
  session.status = "closed";
  session.endedAt = nowIso();
  await persistSession();
  const summary = {
    ok: true,
    sessionId: session.sessionId,
    reversed,
    check,
    token: MAP1_TOKEN,
  };
  session = null;
  return summary;
}
