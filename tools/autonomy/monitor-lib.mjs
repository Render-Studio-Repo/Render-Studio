import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONFIG = Object.freeze({
  monitor: {
    enabled: false,
    free_reign: false,
  },
});

export const DEFAULT_INDEX = Object.freeze({
  updated_at: null,
  receipts: [],
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso(date = new Date()) {
  return date.toISOString();
}

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function oneLine(value, fallback = "") {
  const clean = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback;
}

function slugify(value, fallback = "item") {
  const clean = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return clean || fallback;
}

function areaToken(value) {
  const clean = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return clean || "GEN";
}

function normalizeId(value, prefix, fallbackArea, fallbackSlug) {
  const clean = oneLine(value).replace(/[^A-Za-z0-9._-]+/g, "-");
  if (clean) {
    return clean.startsWith(`${prefix}-`) ? clean : `${prefix}-${clean}`;
  }
  return `${prefix}-${fallbackArea}-${dayStamp()}-${fallbackSlug}`;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return cloneJson(fallback);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

export function defaultRootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function resolvePaths(rootDir = defaultRootDir()) {
  const root = path.resolve(rootDir);
  const autonomyDir = path.join(root, "sandbox-sessions", "autonomy");
  return {
    rootDir: root,
    autonomyDir,
    receiptsDir: path.join(root, "sandbox-sessions", "receipts"),
    configPath: path.join(autonomyDir, "monitor.json"),
    killPath: path.join(autonomyDir, "KILL"),
    eventsDir: path.join(autonomyDir, "events"),
    indexPath: path.join(autonomyDir, "fix-index.json"),
    draftsDir: path.join(autonomyDir, "drafts"),
  };
}

function relativePath(rootDir, filePath) {
  return toPosix(path.relative(rootDir, filePath));
}

export function ensureMonitorLayout(rootDir = defaultRootDir()) {
  const paths = resolvePaths(rootDir);
  fs.mkdirSync(paths.eventsDir, { recursive: true });
  fs.mkdirSync(paths.receiptsDir, { recursive: true });
  fs.mkdirSync(paths.draftsDir, { recursive: true });
  if (!fs.existsSync(paths.configPath)) writeJson(paths.configPath, DEFAULT_CONFIG);
  if (!fs.existsSync(paths.indexPath)) writeJson(paths.indexPath, DEFAULT_INDEX);
  return paths;
}

export function loadConfig(rootDir = defaultRootDir()) {
  const paths = ensureMonitorLayout(rootDir);
  const raw = readJson(paths.configPath, DEFAULT_CONFIG);
  const normalized = {
    monitor: {
      enabled: !!raw?.monitor?.enabled,
      free_reign: !!raw?.monitor?.free_reign,
    },
  };
  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    writeJson(paths.configPath, normalized);
  }
  return normalized;
}

function saveConfig(rootDir, config) {
  const paths = ensureMonitorLayout(rootDir);
  writeJson(paths.configPath, config);
  return config;
}

export function setEnabled(rootDir = defaultRootDir(), enabled = false) {
  const config = loadConfig(rootDir);
  config.monitor.enabled = !!enabled;
  return saveConfig(rootDir, config);
}

export function setFreeReign(rootDir = defaultRootDir(), freeReign = false) {
  const config = loadConfig(rootDir);
  config.monitor.free_reign = !!freeReign;
  return saveConfig(rootDir, config);
}

export function tripKill(rootDir = defaultRootDir(), reason = "") {
  const paths = ensureMonitorLayout(rootDir);
  if (!fs.existsSync(paths.killPath)) {
    const lines = [`created_at=${nowIso()}`];
    const note = oneLine(reason);
    if (note) lines.push(`reason=${note}`);
    writeText(paths.killPath, `${lines.join("\n")}\n`);
  }
  return relativePath(paths.rootDir, paths.killPath);
}

export function getMonitorState(rootDir = defaultRootDir()) {
  const paths = ensureMonitorLayout(rootDir);
  const config = loadConfig(rootDir);
  const killPresent = fs.existsSync(paths.killPath);
  const hardStop = killPresent || !config.monitor.enabled;
  return {
    monitor: config.monitor,
    kill_switch: {
      present: killPresent,
      path: relativePath(paths.rootDir, paths.killPath),
      hard_stop: hardStop,
    },
    can_observe: config.monitor.enabled && !killPresent,
    can_emit_draft: config.monitor.enabled && config.monitor.free_reign && !killPresent,
    paths: {
      config: relativePath(paths.rootDir, paths.configPath),
      events: relativePath(paths.rootDir, paths.eventsDir),
      receipts: relativePath(paths.rootDir, paths.receiptsDir),
      index: relativePath(paths.rootDir, paths.indexPath),
      drafts: relativePath(paths.rootDir, paths.draftsDir),
    },
  };
}

function normalizeFailPayload(payload, state, rootDir) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("FAIL payload must be a JSON object.");
  }
  const area = areaToken(payload.area || payload.component || payload.scope || "GEN");
  const slug = slugify(payload.slug || payload.symptom || payload.was || payload.root_cause || "candidate");
  const failId = normalizeId(payload.fail_id, "FAIL", area, slug);
  const fixId = normalizeId(payload.fix_id, "FIX", area, slug);
  const symptom = oneLine(payload.symptom || payload.was || failId, failId);
  const rootCause = oneLine(payload.root_cause, "Root cause pending triage.");
  const verify = oneLine(payload.verify, "Synthetic inject recorded; no apply path executed.");
  const source = ["autonomy-monitor", "manual", "harness"].includes(payload.source)
    ? payload.source
    : "autonomy-monitor";
  const createdAt = nowIso();
  const receiptPointer = oneLine(
    payload.pointer,
    toPosix(path.join("sandbox-sessions", "autonomy", "events", `${failId}.json`)),
  );
  const fixSummary = oneLine(
    payload.fix,
    "Candidate only - no code change applied yet. Manual triage is still required.",
  );
  return {
    area,
    fail_id: failId,
    fix_id: fixId,
    symptom,
    root_cause: rootCause,
    fix: fixSummary,
    verify,
    verify_green: payload.verify_green === true,
    source,
    pointer: receiptPointer,
    root_dir: rootDir,
    free_reign: !!state?.monitor?.free_reign,
    created_at: createdAt,
  };
}

function updateFixIndex(paths, receipt, receiptPath) {
  const index = readJson(paths.indexPath, DEFAULT_INDEX);
  const receipts = Array.isArray(index.receipts) ? index.receipts : [];
  const next = {
    fix_id: receipt.fix_id,
    path: relativePath(paths.rootDir, receiptPath),
    status: receipt.status,
    auto_eligible: receipt.auto_eligible,
    source: receipt.source,
    created_at: receipt.created_at,
    was: receipt.was,
    root_cause: receipt.root_cause,
  };
  const deduped = receipts.filter((entry) => entry?.fix_id !== receipt.fix_id);
  deduped.push(next);
  deduped.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  writeJson(paths.indexPath, {
    updated_at: receipt.created_at,
    receipts: deduped,
  });
}

function buildDraftInstruction(payload, receipt, eventPath, paths) {
  const draftPath = path.join(paths.draftsDir, `${receipt.fix_id}.json`);
  const relDraftPath = relativePath(paths.rootDir, draftPath);
  const relEventPath = relativePath(paths.rootDir, eventPath);
  const draft = {
    kind: "draft_pr_instruction",
    created_at: receipt.created_at,
    fail_id: payload.fail_id,
    fix_id: receipt.fix_id,
    merge: false,
    apply_patch: false,
    note: "Instruction only. Manual review, PR creation, and merge remain human-gated.",
    pr: {
      draft: true,
      title: `[AUTONOMY] ${receipt.fix_id}: ${payload.symptom}`,
      body: [
        `FAIL: ${payload.fail_id}`,
        `Receipt: ${receipt.fix_id}`,
        `Root cause: ${receipt.root_cause}`,
        `Candidate fix: ${receipt.fix}`,
        `Verify: ${receipt.verify}`,
        `Event: ${relEventPath}`,
      ].join("\n"),
    },
  };
  writeJson(draftPath, draft);
  return { draft, draftPath, relDraftPath };
}

export function ingestFail(rootDir = defaultRootDir(), payload = {}) {
  const paths = ensureMonitorLayout(rootDir);
  const state = getMonitorState(rootDir);
  if (state.kill_switch.present) {
    return {
      ok: true,
      noop: true,
      reason: "kill-switch",
      state,
    };
  }
  if (!state.monitor.enabled) {
    return {
      ok: true,
      noop: true,
      reason: "monitor-disabled",
      state,
    };
  }

  const normalized = normalizeFailPayload(payload, state, rootDir);
  const eventPath = path.join(paths.eventsDir, `${normalized.fail_id}.json`);
  const receiptPath = path.join(paths.receiptsDir, `${normalized.fix_id}.json`);

  if (fs.existsSync(eventPath)) {
    throw new Error(`FAIL event already exists: ${relativePath(paths.rootDir, eventPath)}`);
  }
  if (fs.existsSync(receiptPath)) {
    throw new Error(`FIX receipt already exists: ${relativePath(paths.rootDir, receiptPath)}`);
  }

  const receipt = {
    fix_id: normalized.fix_id,
    was: normalized.fail_id || normalized.symptom,
    root_cause: normalized.root_cause,
    fix: normalized.fix,
    verify: normalized.verify,
    pointer: normalized.pointer,
    source: normalized.source,
    status: "candidate",
    auto_eligible: normalized.free_reign && normalized.verify_green,
    created_at: normalized.created_at,
  };

  let draftResult = null;
  if (state.monitor.free_reign) {
    draftResult = buildDraftInstruction(normalized, receipt, eventPath, paths);
    receipt.pointer = draftResult.relDraftPath;
    receipt.fix = oneLine(`${receipt.fix} Draft instruction: ${draftResult.relDraftPath}`);
  }

  const event = {
    fail_id: normalized.fail_id,
    area: normalized.area,
    symptom: normalized.symptom,
    root_cause: normalized.root_cause,
    source: normalized.source,
    created_at: normalized.created_at,
    receipt_id: receipt.fix_id,
    receipt_path: relativePath(paths.rootDir, receiptPath),
    action: state.monitor.free_reign ? "draft-only" : "observe-only",
    free_reign: state.monitor.free_reign,
    auto_eligible: receipt.auto_eligible,
  };
  if (draftResult) {
    event.draft_instruction_path = draftResult.relDraftPath;
  }

  writeJson(eventPath, event);
  writeJson(receiptPath, receipt);
  updateFixIndex(paths, receipt, receiptPath);

  return {
    ok: true,
    noop: false,
    mode: state.monitor.free_reign ? "draft-only" : "observe-only",
    fail_id: normalized.fail_id,
    fix_id: receipt.fix_id,
    event_path: relativePath(paths.rootDir, eventPath),
    receipt_path: relativePath(paths.rootDir, receiptPath),
    draft_instruction_path: draftResult ? draftResult.relDraftPath : null,
  };
}
