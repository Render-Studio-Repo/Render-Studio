/** Sandbox remix: import 3D project tree as copy+pointers, chunk index, exit blueprint. Token remix1. */

import { startChangeSession, recordMappedWrite, addReferencePoint, currentSession, endChangeSession, runSystemCheck, MAP1_TOKEN } from "./change-map.js?v=map1-remix1";
import { postContextEvent } from "./sandbox-context-log.js?v=ctxlog1";
import { collectStudioProjectFiles } from "./sandbox-shop-task.js?v=shoptask1&singlevoice1";

export const REMIX1_TOKEN = "remix1";
export const REMIX_ROOT = "remixes";

function id() {
  return (globalThis.crypto?.randomUUID?.() || `r${Date.now()}`).replace(/-/g, "").slice(0, 12);
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

/** Simple content hash for chunk compare (OpenAI-style window indexing). */
export function contentHash(text) {
  const s = String(text || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (`00000000${(h >>> 0).toString(16)}`).slice(-8);
}

/** Chunk a text blob into overlapping windows for change compare. */
export function chunkText(text, { size = 800, overlap = 120, path = "" } = {}) {
  const raw = String(text || "");
  if (!raw) return [];
  const chunks = [];
  let start = 0;
  let i = 0;
  while (start < raw.length) {
    const end = Math.min(raw.length, start + size);
    const slice = raw.slice(start, end);
    chunks.push({
      chunk_id: `chk_${contentHash(`${path}:${start}:${slice.slice(0, 40)}`)}`,
      path,
      index: i,
      start,
      end,
      content_hash: contentHash(slice),
      preview: slice.slice(0, 120).replace(/\s+/g, " "),
      version: 1,
    });
    i += 1;
    if (end >= raw.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

async function listProjects() {
  const res = await fetch("/api/projects?lite=1", { credentials: "same-origin" }).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.projects) ? data.projects : [];
}

async function listProjectFiles(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid) return { files: [], name: "" };
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}?view=open`, { credentials: "same-origin" }).catch(() => null);
  const fallback = (!res || !res.ok)
    ? await fetch(`/api/projects/${encodeURIComponent(pid)}`, { credentials: "same-origin" }).catch(() => null)
    : res;
  if (!fallback || !fallback.ok) return { files: [], name: pid };
  const data = await fallback.json().catch(() => ({}));
  try {
    const treeRes = await fetch(
      `/api/projects/${encodeURIComponent(pid)}/code/tree?root=${encodeURIComponent("references/Project Code")}`,
      { credentials: "same-origin" },
    ).catch(() => null);
    if (treeRes?.ok) {
      const tree = await treeRes.json().catch(() => ({}));
      const extra = Array.isArray(tree.files) ? tree.files : [];
      data.tree = [...(data.tree || []), ...extra.map((f) => (typeof f === "string" ? { name: f } : f))];
    }
  } catch { /* optional */ }
  return { files: collectStudioProjectFiles(data), name: data.name || data.title || pid, project: data };
}

function filePointer(projectId, name) {
  const rel = String(name || "").replace(/^\/+/, "");
  return {
    path: rel,
    url: `/api/projects/${encodeURIComponent(projectId)}/files/${rel.split("/").map(encodeURIComponent).join("/")}`,
    kind: rel.split(".").pop()?.toLowerCase() || "bin",
  };
}

/**
 * Create a sandbox remix of a Studio project tree.
 * Copies a JSON tree + chunk index into remixes/{id}/; 3D assets stay as restore pointers.
 */
export async function createProjectRemix(projectId, { label = "" } = {}) {
  const pid = String(projectId || "").trim();
  if (!pid) return { ok: false, reason: "missing_project" };
  const listed = await listProjectFiles(pid);
  const files = listed.files.map((f) => {
    const name = f.name || f.path || f.id || f.file || "";
    return filePointer(pid, name);
  }).filter((f) => f.path);

  const remixId = `remix_${id()}`;
  const root = `${REMIX_ROOT}/${remixId}`;
  const tree = {
    token: REMIX1_TOKEN,
    remix_id: remixId,
    source_project_id: pid,
    source_name: listed.name,
    label: String(label || listed.name || pid).slice(0, 120),
    created_at: nowIso(),
    restore_pointers: files.map((f) => ({
      path: f.path,
      url: f.url,
      kind: f.kind,
      restore: `GET ${f.url}`,
    })),
    open_arm: "2.0",
    map_token: MAP1_TOKEN,
  };

  // Chunk index from tree manifest (paths + kinds) for change compare.
  const manifestText = JSON.stringify(tree.restore_pointers, null, 2);
  const chunks = chunkText(manifestText, { path: `${root}/tree.json`, size: 600, overlap: 80 });
  const index = {
    token: REMIX1_TOKEN,
    remix_id: remixId,
    kind: "chunk_index",
    algorithm: "content_hash_window",
    note: "OpenAI-style chunk windows for snapshot compare; keep prior version on edit",
    chunks,
    created_at: nowIso(),
  };

  await mcpWrite(`${root}/tree.json`, tree);
  await mcpWrite(`${root}/chunks.json`, index);
  await mcpWrite(`${root}/README.md`, `# Remix ${remixId}\n\nSource project \`${pid}\` (${listed.name}).\n3D files are restore pointers — not duplicated binaries.\nExit sandbox writes \`blueprint.json\` + health check for merge gate.\n`);

  if (!currentSession()) {
    startChangeSession({ reason: "remix_import", openArm: "2.0" });
  }
  await recordMappedWrite(`${root}/tree.json`, { afterText: `remix tree ${files.length} pointers`, source: "remix_import" });
  await recordMappedWrite(`${root}/chunks.json`, { afterText: `${chunks.length} chunks`, source: "remix_import" });
  addReferencePoint({
    kind: "remix",
    label: `Remix ${listed.name}`,
    path: `${root}/tree.json`,
    note: `${files.length} restore pointers · ${chunks.length} chunks · ${REMIX1_TOKEN}`,
  });

  void postContextEvent({
    source: "sandbox-remix",
    feature_id: "sandbox.remix.import",
    event_kind: "remix_create",
    target_id: remixId,
    context: { project_id: pid, files: String(files.length), chunks: String(chunks.length) },
  });

  const state = { remixId, root, tree, index, fileCount: files.length, chunkCount: chunks.length };
  try {
    sessionStorage.setItem("sb-active-remix", JSON.stringify({ remixId, root, projectId: pid }));
  } catch { /* optional */ }
  return { ok: true, token: REMIX1_TOKEN, ...state };
}

/** Probe merge safety: stats + mapped diffs + chunk integrity. */
export async function runMergeHealthCheck({ remixId = "", sessionId = "" } = {}) {
  const probes = [];
  const push = (id, ok, note) => probes.push({ id, ok: !!ok, note: String(note || "").slice(0, 160) });

  try {
    const stats = await fetch("/mcp/stats?t=" + Date.now()).then((r) => r.json()).catch(() => null);
    push("mcp.stats", !!stats, stats ? "stats reachable" : "stats failed");
  } catch {
    push("mcp.stats", false, "stats exception");
  }

  try {
    const rev = await fetch("/mcp/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rev", agent: "sam" }),
    }).then((r) => r.json()).catch(() => null);
    push("sandbox.rev", !!rev?.ok, rev?.ok ? `rev ${rev.rev}` : "rev failed");
  } catch {
    push("sandbox.rev", false, "rev exception");
  }

  try {
    const teleop = await fetch("/sandbox/openarm-mujoco/index.html").then((r) => r.ok);
    const scenes = await fetch("/sandbox/openarm-mujoco/v2/scenes.json").then((r) => r.ok);
    push("openarm.mujoco_web", teleop, teleop ? "mujoco web ok" : "mujoco web missing");
    push("openarm.mujoco_scenes", scenes, scenes ? "v2 scenes ok" : "v2 scenes missing");
  } catch {
    push("openarm.mujoco_web", false, "mujoco fetch failed");
  }

  try {
    const teleop = await fetch("/sandbox/openarm-teleop/rig.schema.json").then((r) => r.ok);
    push("openarm.rig_2_0", teleop, teleop ? "rig schema ok" : "rig schema missing");
  } catch {
    push("openarm.rig_2_0", false, "rig fetch failed");
  }

  const sess = currentSession();
  const mapped = sess?.entries?.length || 0;
  push("map1.session", !!sess, sess ? `${mapped} mapped files` : "no active map session");

  let chunkOk = true;
  if (remixId) {
    try {
      const res = await fetch(`/mcp/sandbox/file?path=${encodeURIComponent(`${REMIX_ROOT}/${remixId}/chunks.json`)}&t=${Date.now()}`);
      const data = res.ok ? await res.json() : null;
      const parsed = data?.text ? JSON.parse(data.text) : null;
      chunkOk = Array.isArray(parsed?.chunks) && parsed.chunks.length > 0;
      push("remix.chunks", chunkOk, chunkOk ? `${parsed.chunks.length} chunks` : "chunks missing");
    } catch {
      push("remix.chunks", false, "chunk read failed");
      chunkOk = false;
    }
  }

  const failed = probes.filter((p) => !p.ok);
  const safe_to_merge = failed.length === 0;
  const report = {
    kind: "sandbox_merge_health",
    token: REMIX1_TOKEN,
    remix_id: remixId || null,
    session_id: sessionId || sess?.sessionId || null,
    observed_at: nowIso(),
    safe_to_merge,
    probes,
    failed: failed.map((f) => f.id),
    ask: safe_to_merge
      ? "Health green — still require human Approve before promoting sandbox → Studio."
      : `Unsafe to merge: ${failed.map((f) => f.id).join(", ")}. Do not promote.`,
  };

  const checkPath = remixId
    ? `${REMIX_ROOT}/${remixId}/health-check.json`
    : `sandbox-sessions/latest-merge-health.json`;
  await mcpWrite(checkPath, report);
  await mcpWrite("sandbox-sessions/latest-merge-health.json", report);

  // Dual-write to API blueprint table / jsonl.
  try {
    await fetch("/api/sandbox/remix-blueprint", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "health_check",
        remix_id: remixId || null,
        session_id: report.session_id,
        safe_to_merge,
        health: report,
      }),
    });
  } catch { /* optional */ }

  void postContextEvent({
    source: "sandbox-remix",
    feature_id: "sandbox.remix.health",
    event_kind: safe_to_merge ? "health_ok" : "health_fail",
    target_id: remixId || "session",
    context: { failed: failed.map((f) => f.id).join(",") || "none" },
  });

  return report;
}

/** On sandbox exit: keep remix pointers, run health, persist guided blueprint (do not wipe remix). */
export async function exitSandboxSaveRemix({ reverseMapped = false } = {}) {
  let active = null;
  try {
    active = JSON.parse(sessionStorage.getItem("sb-active-remix") || "null");
  } catch {
    active = null;
  }
  const remixId = active?.remixId || "";
  const root = active?.root || (remixId ? `${REMIX_ROOT}/${remixId}` : "");
  const sess = currentSession();

  const health = await runMergeHealthCheck({ remixId, sessionId: sess?.sessionId });
  const sys = await runSystemCheck().catch(() => ({ ok: false }));

  const blueprint = {
    kind: "sandbox_remix_blueprint",
    token: REMIX1_TOKEN,
    remix_id: remixId || null,
    root: root || null,
    source_project_id: active?.projectId || null,
    session_id: sess?.sessionId || null,
    map_token: MAP1_TOKEN,
    created_at: nowIso(),
    restore_guide: {
      tree: root ? `${root}/tree.json` : null,
      chunks: root ? `${root}/chunks.json` : null,
      health: root ? `${root}/health-check.json` : "sandbox-sessions/latest-merge-health.json",
      system_check: "sandbox-sessions/latest-system-check.json",
      openarm_rig: "openarm-teleop/rig.schema.json",
      openarm_lab: "/sandbox/openarm-teleop/index.html",
    },
    safe_to_merge: !!health.safe_to_merge,
    health,
    system_check_ok: !!sys?.ok,
    repeat_steps: [
      "1. Open sandbox Super IDE",
      "2. Remix import the same project_id (restore pointers in tree.json)",
      "3. Diff chunks.json content_hash vs prior blueprint version",
      "4. Run merge health — promote only when safe_to_merge",
      "5. Human Approve — never auto-merge",
    ],
  };

  if (root) {
    await mcpWrite(`${root}/blueprint.json`, blueprint);
  }
  await mcpWrite("sandbox-sessions/latest-remix-blueprint.json", blueprint);

  try {
    await fetch("/api/sandbox/remix-blueprint", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "blueprint", blueprint }),
    });
  } catch { /* optional */ }

  const ended = await endChangeSession({ reverse: reverseMapped, systemCheck: false });
  void postContextEvent({
    source: "sandbox-remix",
    feature_id: "sandbox.remix.exit",
    event_kind: "blueprint_saved",
    target_id: remixId || ended?.sessionId || "exit",
    context: { safe: health.safe_to_merge ? "1" : "0" },
  });

  return { ok: true, blueprint, health, ended, token: REMIX1_TOKEN };
}

export async function pickAndImportRemix() {
  const projects = await listProjects();
  if (!projects.length) return { ok: false, reason: "no_projects" };
  const choice = window.prompt(
    `Remix project into sandbox (id or number).\n${projects.slice(0, 12).map((p, i) => `${i + 1}. ${p.name || p.id} (${p.id})`).join("\n")}`,
    projects[0]?.id || "",
  );
  if (!choice) return { ok: false, reason: "cancelled" };
  const asNum = Number(choice);
  const project = Number.isFinite(asNum) && asNum >= 1 && asNum <= projects.length
    ? projects[asNum - 1]
    : projects.find((p) => p.id === choice || p.name === choice);
  if (!project?.id) return { ok: false, reason: "not_found" };
  return createProjectRemix(project.id, { label: project.name });
}

export { listProjects };
