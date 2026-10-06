"""Swarm-debug credit scores, chat history index, read-only CLI, area-code ids.

Does not replace analytics/privilege/metrics. Same sqlite. Credit is a dashboard
metric — not a license to write production code. Approval gates stay.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.services import debugger_analytics_service as das
from backend.services import prompt_trace_service as trace

# Hard cap: 160 chars. Typical `project:5bf8e783+log:d9c98119-004` is ~36.
# 160 fits a Debugger copy line and a query string; 24×80-char members would
# blow past 2k. Over cap → packed sha256[:16] + ref_* JSON pointer.
TRACKING_ID_CAP = 160
LOCAL_AREA = "501"
AREA_LABELS = {"501": "Little Rock Mini"}
INSTANCE_MEMBER_KINDS = ("user", "project", "log", "agent")
CREDIT_PERIODS = ("daily", "weekly", "monthly", "yearly")
DEBUG_JOB_TICK_CAP = 5
KERNEL_FEATURES = frozenset({"prompt.run", "cad.gen_step", "cad.generate"})
UNDERPERFORM_FLOOR = 40
THIN_HOOK_FEATURES = frozenset({
    "webgl.context", "viewport.boot", "viewport.models", "viewport.duplicates",
    "vr.controllers.trigger", "vr.controllers",
    "api.health", "network.latency", "network.lag", "network.rtt", "network.webrtc",
})
THIN_HOOK_PREFIXES = ("webgl.", "viewport.", "api.", "network.", "vr.controllers")
SAM_QUEUE_HOW = (
    "Read ai-context/debugger/swarm-reports/sam-queue-latest.md (or .json). "
    "Confirm candidate / Not fixed in Debugger, or scripts/confirm-candidate.py {job_id} "
    "(job_id required). Do not confirm_fixed. Do not kickstart render3d. "
    "pending_reload = reload the Studio tab. replace-approach = kernel, not a JS patch. "
    "pending_sam league reports stay reports — never auto-fire."
)
REPO_ROOT = Path(__file__).resolve().parents[2]
FEATURE_FOCUSED_TESTS = {
    "memory.leak": "frontend/viewport/viewport-video-editor.test.js",
    "viewport.models": "frontend/viewport/project-component-loading.test.js",
    "webgl.context": "frontend/viewport/webgl-startup-panel.test.js",
    "vr.controllers.trigger": "frontend/xr/xr-hot-path.test.js",
}
FOCUSED_TEST_TIMEOUT_S = 90
SHIPPED_THIN_HOOKS = {
    "memory.leak": "object-URL revoke leakfix1 + bake/share preview leakfix2 + leakfix3 + film-history leakfix4 + download track leakfix5 + file/shot/X-image leakfix6 + ref/share-download leakfix7 + canvas/micro leakfix8 + ref preview leakfix9 + canvas display leakfix10 + search-thumb cap leakfix11 + fusion follow-timer leakfix12 + prompt-history follow-timer leakfix13 + generation-poll abort leakfix14 + prompt-history abort leakfix15 + timeline/object-history abort leakfix16 + wiring/rigging history abort leakfix17 + refreshFiles abort leakfix18 + workspace-history/realtime abort leakfix19 + workspace-menu abort leakfix20 + composer clip-url leakfix21 + chat pending-thumb leakfix22 + fusion thumb leakfix23 + onshape thumb leakfix24 + x-share preview leakfix25 + texture thumb leakfix26 + project-browser thumb leakfix27 + workspace-inspect thumb leakfix28 + studio-notes thumb leakfix29 + timeline history-url leakfix30 + boot-suggest thumb leakfix31 + addClip reuse-url leakfix32 + film same-trace url leakfix33 + share-markup frame leakfix34 + part-profiles abort leakfix35 + electronics abort leakfix36 + body-hydrate abort leakfix37 + sketch-load abort leakfix38 + xr-creations abort leakfix39 + electronics-list abort leakfix40 + team-invites abort leakfix41 + team-members abort leakfix42 + invite-candidates abort leakfix43 + have-panel abort leakfix44 + invite-folders abort leakfix45 + have-panel folders reuse leakfix46 + explorer-folders abort leakfix47 + resume-generation abort leakfix48 + inspect-members abort leakfix49 + canvas-boards abort leakfix50 + workspace-hub abort leakfix51 + viewport-search-members abort leakfix52 + costs-panel abort leakfix53 + workspace-management abort leakfix54 + calendar-prefs abort leakfix55 + email-prefs abort leakfix56 + authorized-apps abort leakfix57 + social-hub abort leakfix58 + subscriptions abort leakfix59 + project-chat hydrate abort leakfix60 + fusion-library abort leakfix61 + onshape-docs abort leakfix62 + textures abort leakfix63 + catalog-search abort leakfix64 + mcmaster-suggest abort leakfix65 + imagine-library abort leakfix66 + render-agent-threads abort leakfix67 + context-lab abort leakfix68 + render-agent-members abort leakfix69 + preferred-ai-key abort leakfix70 + online-models abort leakfix71 + store-prefs abort leakfix72 + knowledge-base abort leakfix73 + receive-payments abort leakfix74 + user-profile abort leakfix75 + handle-availability abort leakfix76 + voice-mold abort leakfix77 + feedback-prompts abort leakfix78 + project-share abort leakfix79 + shared-invites abort leakfix80 + fusion-export abort leakfix81 + export-workspace abort leakfix82 + folder-share abort leakfix83 + parts-list abort leakfix84 + skills-popup abort leakfix85 + driver-picker abort leakfix86 + discord-dest abort leakfix87 + component-profile-search abort leakfix88 + printer-share remount abort leakfix89 + onshape-open-document abort leakfix90 + onshape-export-source abort leakfix91 + drive-folders abort leakfix92 + kb-drive-folders abort leakfix93 + video-editor-list abort leakfix94 + xr-studio-state abort leakfix95 + xr-share-roster abort leakfix96 + rigging-load abort leakfix97 + architect-load abort leakfix98 + assembly-joints abort leakfix99 + model-rigs abort leakfix100 + sim-json abort leakfix101 + mesh-mjs abort leakfix102 + component-profile-load abort leakfix103 + sketch-open abort leakfix104 + dxf-preview abort leakfix105 + ref-load abort leakfix106 + code-manifest abort leakfix107 + code-wiring-projects abort leakfix108 + robotics-hud-emotes abort leakfix109 + heap scope leakobs1; breakage≠0",
    "viewport.models": "reloadPid modelsfix1 + models.missing/loaded stamps; catalog-empty expected; breakage≠0",
    "vr.controllers.trigger": "controller.trigger.miss stamp (rising trigger, no posed ray); breakage≠0",
    "webgl.context": "lost/restored stamp webgl.context not boot; breakage≠0",
    "prompt.run": "none (kernel unpatched); replace-approach; breakage≠0",
}
STANDING_DEBUG_TARGETS = (
    {"feature": "webgl.context", "needles": ("Error creating WebGL", "webgl context", "3D viewport unavailable")},
    {"feature": "vr.controllers.trigger", "needles": ("controller trigger", "right controller trigger")},
    {"feature": "memory.leak", "needles": ("memory leak",)},
    {"feature": "viewport.boot", "needles": ("3D viewport unavailable", "WebGL2 could not start")},
    {"feature": "viewport.models", "needles": ("models missing", "models disappeared")},
)
CREDIT_CATEGORIES = (
    "networking",
    "controllers",
    "memory_leaks",
    "time_to_complete",
    "optimization",
    "network_troubleshooting",
    "liabilities",
)
READONLY_CMDS = ("ls", "pwd", "date", "wc", "head", "cat")
READONLY_OUTPUT_CAP = 12000
JAIL_SECRET_RE = re.compile(r"(\.env$|\.env\.|credentials|secrets?)", re.I)
BLOCKED_TOKENS = re.compile(
    r"\b(rm|sudo|git|chmod|chown|mv|cp|dd|curl|wget|ssh|scp|python|bash|zsh|sh|kill|reboot)\b"
    r"|[|;&`$<>]|https?://",
    re.I,
)
AREA_RE = re.compile(r"^[0-9]{3}$")
VISION = {
    "sam": {"technical": 78, "desired_swarm": 52, "note": "Compact ids + gates are sound; full autonomy is not safe yet."},
    "cursor": {"technical": 86, "desired_swarm": 70, "note": "Same ids, packed refs at 160, league reports to Sam, no vector hot path."},
}
# Taxonomy / feature-id fragments → credit categories. webgl is not its own period bucket.
TAXONOMY_TO_CREDIT = {
    "networking": "networking",
    "network": "networking",
    "performance": "optimization",
    "webgl": "optimization",
    "optimization": "optimization",
    "vr": "controllers",
    "controls": "controllers",
    "controllers": "controllers",
    "watchdog": "time_to_complete",
    "feature_missing": "time_to_complete",
    "cad": "time_to_complete",
    "ui": "time_to_complete",
    "data": "time_to_complete",
    "api": "network_troubleshooting",
    "memory": "memory_leaks",
    "other": "time_to_complete",
}
# Exact incident feature ids → credit. Prefix table is checked longest-first.
FEATURE_ID_TO_CREDIT = {
    "network.latency": "networking",
    "network.lag": "networking",
    "network.rtt": "networking",
    "network.webrtc": "networking",
    "network.timeout": "network_troubleshooting",
    "network.dns": "network_troubleshooting",
    "network.throttle": "network_troubleshooting",
    "api.health": "network_troubleshooting",
    "memory.leak": "memory_leaks",
    "system.ram": "memory_leaks",
    "vr.controllers.trigger": "controllers",
    "vr.controllers": "controllers",
    "vr.controls": "controllers",
    "webgl.context": "optimization",
    "viewport.boot": "time_to_complete",
    "viewport.models": "time_to_complete",
    "viewport.duplicates": "time_to_complete",
    "rigging.models": "time_to_complete",
    "system.cpu": "time_to_complete",
    "user.data": "time_to_complete",
    "feature.visibility": "time_to_complete",
    "button.actions": "time_to_complete",
    "human.override": "liabilities",
    "user.override": "liabilities",
    "companion.damage": "liabilities",
    "user.damage": "liabilities",
    "companion_damage": "liabilities",
    "user_damage": "liabilities",
}
FEATURE_PREFIX_TO_CREDIT = (
    ("network.timeout", "network_troubleshooting"),
    ("network.dns", "network_troubleshooting"),
    ("network.throttle", "network_troubleshooting"),
    ("api.", "network_troubleshooting"),
    ("network.", "networking"),
    ("memory.", "memory_leaks"),
    ("vr.controllers", "controllers"),
    ("vr.controls", "controllers"),
    ("webgl.", "optimization"),
    ("viewport.", "time_to_complete"),
    ("human.", "liabilities"),
    ("user.override", "liabilities"),
    ("user.damage", "liabilities"),
    ("companion.", "liabilities"),
    ("companion_damage", "liabilities"),
)
FEATURE_HINTS = (
    (("leak", "memory", "rss"), "memory_leaks"),
    (("trigger", "controller", "vr.", "gizmo", "controls"), "controllers"),
    (("dns", "timeout", "throttle"), "network_troubleshooting"),
    (("network", "lag", "rtt", "webrtc"), "networking"),
    (("webgl", "shader", "gpu", "gl."), "optimization"),
    (("human", "override", "liabilit"), "liabilities"),
    (("slow", "duration", "time_to"), "time_to_complete"),
)

CATALOG_SKILLS = (
    ("prompt-trace", "ai-context/skills/prompt-trace/SKILL.md", "PROMPT_RESULT + /api/prompt-trace/prompts → log_id"),
    ("desired-result-score", "ai-context/skills/desired-result-score/SKILL.md", "score 0–100, tracking_id, ref_*, res_*"),
    ("incident-research", "ai-context/skills/incident-research/SKILL.md", "grok_incident events/snapshots/exports; traceback_id"),
    ("debugger-analytics", "ai-context/skills/debugger-analytics/SKILL.md", "search_ids, drafts, bugs, scores, swarm-summary, claim, cad_snapshots, candidate_confirm"),
    ("debugger-metrics", "ai-context/skills/desired-result-score/SKILL.md", "latency, confirm_fixed PERF-07-00012, blacklist"),
    ("debugger-privileges", "ai-context/skills/debugger-analytics/SKILL.md", "ask_safe, fork_, rb_, iss_"),
    ("api-tracking-explain", "ai-context/skills/api-tracking-explain/SKILL.md", "explain last3 log_ids, privileges, cost_*, sandbox MCP; harness1; no prod writes"),
    ("debug-id-catalog", "mcp/grok-bot/skills/debug-id-catalog/SKILL.md", "this catalog; agree/disagree analysis"),
)


def _ensure(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS credit_scores (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, period TEXT NOT NULL,
            category TEXT NOT NULL, credit REAL NOT NULL, damage REAL NOT NULL,
            n INTEGER NOT NULL, actor TEXT, extra_json TEXT
        );
        CREATE TABLE IF NOT EXISTS agent_league (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, agent_id TEXT NOT NULL,
            period TEXT NOT NULL, category TEXT NOT NULL,
            credit_score REAL NOT NULL, damage REAL NOT NULL, n INTEGER NOT NULL,
            note TEXT
        );
        CREATE TABLE IF NOT EXISTS agent_reports (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, agent_id TEXT NOT NULL,
            recommendation TEXT NOT NULL, credit_score REAL, note TEXT,
            status TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS catalog_reviews (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL,
            verdict TEXT NOT NULL, technical INTEGER, desired INTEGER,
            delta INTEGER, note TEXT
        );
        CREATE TABLE IF NOT EXISTS instance_users (
            user_id TEXT NOT NULL, instance_id TEXT NOT NULL, area_id TEXT,
            project_ids_json TEXT NOT NULL, log_ids_json TEXT NOT NULL,
            agent_ids_json TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, instance_id)
        );
        CREATE TABLE IF NOT EXISTS period_rollups (
            period TEXT NOT NULL, category TEXT NOT NULL, bucket TEXT NOT NULL,
            credit REAL NOT NULL, damage REAL NOT NULL, n INTEGER NOT NULL,
            ts TEXT NOT NULL,
            PRIMARY KEY (period, category, bucket)
        );
        CREATE TABLE IF NOT EXISTS league_cycles (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, agent_id TEXT NOT NULL,
            peer_id TEXT, snapshot_id TEXT, category TEXT, credit REAL,
            phase TEXT NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS debug_jobs (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, day TEXT NOT NULL,
            feature_id TEXT NOT NULL, category TEXT NOT NULL,
            instance_id TEXT, user_id TEXT, project_id TEXT, log_id TEXT,
            agent_id TEXT, last_working_id TEXT, first_broken_id TEXT,
            log_path TEXT, tracking_id TEXT, status TEXT NOT NULL,
            recommendation TEXT NOT NULL, note TEXT, extra_json TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_debug_jobs_feature_day
            ON debug_jobs(feature_id, day);
        CREATE TABLE IF NOT EXISTS swarm_instances (
            instance_id TEXT PRIMARY KEY,
            area_code TEXT NOT NULL,
            label TEXT,
            extra_json TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS swarm_instance_members (
            instance_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            member_id TEXT NOT NULL,
            area_id TEXT,
            tracking_id TEXT,
            extra_json TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (instance_id, kind, member_id)
        );
        CREATE TABLE IF NOT EXISTS cad_votes (
            id TEXT PRIMARY KEY,
            ts TEXT NOT NULL,
            voter TEXT NOT NULL,
            subject TEXT NOT NULL,
            loop TEXT NOT NULL,
            verdict TEXT NOT NULL,
            reason TEXT,
            tracking_id TEXT,
            extra_json TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cad_votes_voter_subject_loop
            ON cad_votes(voter, subject, loop);
        """
    )


def _conn():
    conn = das._conn()
    _ensure(conn)
    return conn


def jail_roots() -> tuple[Path, ...]:
    root = das.ROOT_DIR.resolve()
    debugger = (root / "ai-context" / "debugger").resolve()
    return (
        debugger,
        (root / "data" / "prompt-trace").resolve(),
        (debugger / "incident-intelligence").resolve(),
    )


def _jailed(path: str | Path) -> Path:
    raw = str(path or "").strip()
    if not raw:
        raise ValueError("path required")
    raw_path = Path(raw)
    if any(part == ".." for part in raw_path.parts):
        raise ValueError("readonly CLI rejects ..")
    if raw.startswith("~") or raw.startswith("~/"):
        raise ValueError("readonly CLI rejects home dumps")
    if JAIL_SECRET_RE.search(raw_path.name) or JAIL_SECRET_RE.search(raw):
        raise ValueError("readonly CLI rejects secrets")
    if any(part.lower() == "marketing" for part in raw_path.parts):
        raise ValueError("readonly CLI rejects Marketing")
    if any(part.lower() == "kernel" for part in raw_path.parts):
        raise ValueError("readonly CLI rejects kernel")
    root = das.ROOT_DIR.resolve()
    if raw_path.is_absolute():
        target = raw_path.resolve()
        if target != root and root not in target.parents:
            raise ValueError("readonly CLI rejects home dumps")
    else:
        target = (root / raw_path).resolve()
    if any(part.lower() == "marketing" for part in target.parts):
        raise ValueError("readonly CLI rejects Marketing")
    if JAIL_SECRET_RE.search(target.name):
        raise ValueError("readonly CLI rejects secrets")
    roots = jail_roots()
    if not any(target == item or item in target.parents for item in roots):
        raise ValueError("path must stay under ai-context/debugger or data/prompt-trace")
    return target


def encode_tracking_capped(members: list[Any]) -> dict[str, Any]:
    """Encode members; if over TRACKING_ID_CAP, store ref_* and return packed id."""
    composite = das.encode_tracking_id(members)
    if len(composite) <= TRACKING_ID_CAP:
        return {"tracking_id": composite, "packed": False, "cap": TRACKING_ID_CAP, "length": len(composite)}
    digest = hashlib.sha256(composite.encode()).hexdigest()[:16]
    stored = das._store_ref("tracking", members if isinstance(members[0], dict) else [{"kind": a, "id": b} for a, b in members], {"reason": "over_cap", "length": len(composite)})
    packed = f"ref:{stored['id']}"
    return {
        "tracking_id": packed,
        "packed": True,
        "cap": TRACKING_ID_CAP,
        "length": len(composite),
        "ref_id": stored["id"],
        "composite_was": composite[:TRACKING_ID_CAP] + "…",
    }


def encode_area_id(
    *,
    instance_id: str | None = None,
    user_id: str = "",
    project_id: str = "",
    log_id: str = "",
    agent_id: str = "",
    extra: dict[str, str] | None = None,
) -> dict[str, Any]:
    area = re.sub(r"[^0-9]", "", str(instance_id or LOCAL_AREA))[:3] or LOCAL_AREA
    if not AREA_RE.fullmatch(area):
        area = LOCAL_AREA
    parts = [area]
    if user_id:
        parts.append("u" + re.sub(r"[^A-Za-z0-9]", "", str(user_id))[:12])
    if project_id:
        parts.append("p" + re.sub(r"[^A-Za-z0-9]", "", str(project_id))[:16])
    if log_id:
        parts.append("l" + re.sub(r"[^A-Za-z0-9._:-]", "", str(log_id))[:24])
    if agent_id:
        parts.append("a" + re.sub(r"[^A-Za-z0-9]", "", str(agent_id))[:12])
    for key, value in (extra or {}).items():
        slug = re.sub(r"[^a-z0-9]", "", str(key).lower())[:6]
        val = re.sub(r"[^A-Za-z0-9._:-]", "", str(value))[:16]
        if slug and val:
            parts.append(f"{slug}{val}")
    raw = ".".join(parts)
    if len(raw) <= TRACKING_ID_CAP:
        return {"area_id": raw, "area": area, "packed": False, "length": len(raw), "cap": TRACKING_ID_CAP}
    members = [{"kind": "instance", "id": area}]
    if user_id:
        members.append({"kind": "user", "id": str(user_id)[:80]})
    if project_id:
        members.append({"kind": "project", "id": str(project_id)[:80]})
    if log_id:
        members.append({"kind": "log", "id": str(log_id)[:80]})
    packed = encode_tracking_capped(members)
    return {"area_id": packed["tracking_id"], "area": area, "packed": True, "length": len(raw), "cap": TRACKING_ID_CAP, "ref_id": packed.get("ref_id")}


def _feature_blob(data: dict[str, Any], score_row: dict[str, Any]) -> str:
    features = score_row.get("features") or data.get("features") or {}
    feat_keys = features.keys() if isinstance(features, dict) else []
    return " ".join([
        str(data.get("actor") or data.get("source") or ""),
        str(data.get("method") or ""),
        str(data.get("feature") or data.get("subcategory") or data.get("sub") or ""),
        str(data.get("category") or data.get("category_slug") or ""),
        " ".join(score_row.get("broken") or data.get("broken") or []),
        " ".join(score_row.get("fixed") or data.get("fixed") or []),
        " ".join(str(k) for k in feat_keys),
        str(score_row.get("notes") or data.get("notes") or ""),
        str(data.get("privilege") or ""),
    ]).lower()


def _feature_ids(data: dict[str, Any], score_row: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for key in ("feature", "feature_id", "subcategory", "sub"):
        val = data.get(key) or score_row.get(key)
        if val:
            ids.append(str(val))
    for src in (score_row.get("broken"), data.get("broken"), score_row.get("fixed"), data.get("fixed")):
        if isinstance(src, list):
            ids.extend(str(x) for x in src)
    features = score_row.get("features") or data.get("features") or {}
    if isinstance(features, dict):
        ids.extend(str(k) for k in features.keys())
    return ids


def category_for_feature_id(feature: str) -> str | None:
    """Map an incident feature id onto a CREDIT category. None if unknown."""
    fid = str(feature or "").strip().lower()
    if not fid:
        return None
    if fid in FEATURE_ID_TO_CREDIT:
        return FEATURE_ID_TO_CREDIT[fid]
    for prefix, category in FEATURE_PREFIX_TO_CREDIT:
        if fid == prefix.rstrip(".") or fid.startswith(prefix):
            return category
    return None


def infer_category(data: dict[str, Any], score_row: dict[str, Any] | None = None) -> str:
    score_row = score_row or {}
    hinted = str(data.get("credit_category") or data.get("category") or data.get("category_slug") or "").strip().lower()
    hinted = hinted.replace("-", "_").replace(" ", "_")
    aliases = {
        "memory-leaks": "memory_leaks",
        "memory_leak": "memory_leaks",
        "memory.leak": "memory_leaks",
        "time": "time_to_complete",
        "time_taken": "time_to_complete",
        "time-to-complete": "time_to_complete",
        "duration": "time_to_complete",
        "net": "networking",
    }
    hinted = aliases.get(hinted, hinted)
    blob = _feature_blob(data, score_row)
    if hinted in CREDIT_CATEGORIES:
        return hinted
    for fid in _feature_ids(data, score_row):
        mapped = category_for_feature_id(fid)
        if mapped:
            return mapped
    if "memory.leak" in blob or "memory_leak" in blob or ("leak" in blob and "memory" in blob):
        return "memory_leaks"
    if hinted in TAXONOMY_TO_CREDIT:
        return TAXONOMY_TO_CREDIT[hinted]
    actor = str(data.get("actor") or data.get("source") or "").lower()
    if actor == "user" or data.get("liability") or "human" in blob or "override" in blob:
        return "liabilities"
    for needles, category in FEATURE_HINTS:
        if any(w in blob for w in needles):
            return category
    if _damage_value(data, score_row) > 0:
        return "liabilities"
    if _duration_seconds(data, score_row) > 0:
        return "time_to_complete"
    if int(score_row.get("score") or data.get("score") or 0) >= 85 or data.get("token_cost"):
        return "optimization"
    return "time_to_complete"


def _duration_seconds(data: dict[str, Any] | None = None, score_row: dict[str, Any] | None = None) -> float:
    data = data or {}
    score_row = score_row or {}
    for key in ("duration_s", "duration", "time_taken", "time_to_complete"):
        raw = score_row.get(key) if score_row.get(key) not in (None, "") else data.get(key)
        if raw in (None, ""):
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return 0.0


def _damage_value(data: dict[str, Any] | None = None, score_row: dict[str, Any] | None = None) -> float:
    data = data or {}
    score_row = score_row or {}
    for key in ("companion_damage", "damage_score", "user_damage", "damage"):
        raw = score_row.get(key) if score_row.get(key) not in (None, "") else data.get(key)
        if raw in (None, ""):
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return 0.0


def duration_credit(duration_s: float) -> float:
    """Inverse duration → 0–100 credit. 0s≈85, 60s≈55, 180s≈25."""
    return round(max(15.0, min(90.0, 85.0 - float(duration_s) * 0.5)), 2)


def damage_liability_credit(damage: float) -> float:
    """Companion/user damage → liabilities credit (high damage, low credit)."""
    return round(max(5.0, min(70.0, 70.0 - float(damage) * 0.5)), 2)


def register_user(data: dict[str, Any]) -> dict[str, Any]:
    uid = str(data.get("user_id") or "").strip()[:80]
    if not uid:
        raise ValueError("user_id is required to register under an instance")
    instance_id = re.sub(r"[^0-9A-Za-z]", "", str(data.get("instance_id") or LOCAL_AREA))[:8] or LOCAL_AREA
    if instance_id.isdigit() and len(instance_id) > 3:
        instance_id = instance_id[:3]
    if AREA_RE.fullmatch(re.sub(r"[^0-9]", "", instance_id)[:3] or ""):
        instance_id = re.sub(r"[^0-9]", "", instance_id)[:3]
    else:
        instance_id = LOCAL_AREA
    area = encode_area_id(
        instance_id=instance_id,
        user_id=uid,
        project_id=str(data.get("project_id") or ""),
        log_id=str(data.get("log_id") or ""),
        agent_id=str(data.get("agent_id") or ""),
    )
    project_id = str(data.get("project_id") or "")[:80]
    log_id = str(data.get("log_id") or "")[:80]
    agent_id = str(data.get("agent_id") or "")[:40]
    with _conn() as conn:
        existing = conn.execute(
            "SELECT * FROM instance_users WHERE user_id = ? AND instance_id = ?",
            (uid, instance_id),
        ).fetchone()
        projects = json.loads(existing["project_ids_json"] or "[]") if existing else []
        logs = json.loads(existing["log_ids_json"] or "[]") if existing else []
        agents = json.loads(existing["agent_ids_json"] or "[]") if existing else []
        for bucket, value in ((projects, project_id), (logs, log_id), (agents, agent_id)):
            if value and value not in bucket:
                bucket.append(value)
        conn.execute(
            """INSERT INTO instance_users VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(user_id, instance_id) DO UPDATE SET
                 area_id=excluded.area_id, project_ids_json=excluded.project_ids_json,
                 log_ids_json=excluded.log_ids_json, agent_ids_json=excluded.agent_ids_json,
                 updated_at=excluded.updated_at""",
            (uid, instance_id, area["area_id"], das._json(projects[-12:]), das._json(logs[-24:]), das._json(agents[-8:]), das.now()),
        )
    row = get_instance_user(uid, instance_id) or {}
    _sync_instance_registry_from_user(row)
    return row


def get_instance_user(user_id: str, instance_id: str = LOCAL_AREA) -> dict[str, Any] | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM instance_users WHERE user_id = ? AND instance_id = ?",
            (str(user_id), str(instance_id)),
        ).fetchone()
    if not row:
        return None
    data = dict(row)
    data["project_ids"] = json.loads(data.pop("project_ids_json") or "[]")
    data["log_ids"] = json.loads(data.pop("log_ids_json") or "[]")
    data["agent_ids"] = json.loads(data.pop("agent_ids_json") or "[]")
    data["relations"] = {
        "user_id": data["user_id"],
        "instance_id": data["instance_id"],
        "project_ids": data["project_ids"],
        "log_ids": data["log_ids"],
        "agent_ids": data["agent_ids"],
        "area_id": data.get("area_id"),
    }
    return data


def list_instance_users(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT user_id, instance_id FROM instance_users ORDER BY updated_at DESC LIMIT ?", (max(1, min(limit, 40)),)).fetchall()
    return [get_instance_user(r["user_id"], r["instance_id"]) for r in rows if r["user_id"]]


def _normalize_area(raw: Any) -> str:
    text = str(raw or LOCAL_AREA).strip()
    if text.startswith("instance:") or "+" in text:
        try:
            for member in das.decode_tracking_id(text):
                if member.get("kind") == "instance" and member.get("id"):
                    text = str(member["id"])
                    break
        except ValueError:
            pass
    if "." in text and AREA_RE.fullmatch(text.split(".", 1)[0]):
        return text.split(".", 1)[0]
    digits = re.sub(r"[^0-9]", "", text)[:3] or LOCAL_AREA
    return digits if AREA_RE.fullmatch(digits) else LOCAL_AREA


def register_instance(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Ensure swarm_instances row. Debugger sqlite only — never ALTER users."""
    data = dict(data or {})
    instance_id = _normalize_area(data.get("instance_id") or data.get("area_code") or data.get("area") or LOCAL_AREA)
    label = str(data.get("label") or AREA_LABELS.get(instance_id) or "")[:80]
    extra = dict(data.get("extra") or {})
    extra.setdefault("license", "dashboard-metric")
    extra.setdefault("vector_db", False)
    with _conn() as conn:
        conn.execute(
            """INSERT INTO swarm_instances VALUES (?,?,?,?,?)
               ON CONFLICT(instance_id) DO UPDATE SET
                 area_code=excluded.area_code, label=excluded.label,
                 extra_json=excluded.extra_json, updated_at=excluded.updated_at""",
            (instance_id, instance_id, label, das._json(extra), das.now()),
        )
    return {
        "ok": True,
        "instance_id": instance_id,
        "area_code": instance_id,
        "label": label,
        "vector_db": False,
        "auto_fire": False,
    }


def register_instance_member(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Upsert one user/project/log/agent under an area. No invented ids. Cap 160 then pack."""
    data = dict(data or {})
    instance_id = _normalize_area(data.get("instance_id") or data.get("area_code") or data.get("area") or LOCAL_AREA)
    kind = str(data.get("kind") or "").strip().lower()
    member_id = str(data.get("member_id") or data.get("id") or data.get(f"{kind}_id") or "")[:80]
    if kind not in INSTANCE_MEMBER_KINDS or not member_id:
        return {"ok": False, "skipped": True, "reason": "kind-or-id", "invented": False}
    kwargs = {"instance_id": instance_id}
    kwargs[{"user": "user_id", "project": "project_id", "log": "log_id", "agent": "agent_id"}[kind]] = member_id
    area = encode_area_id(**kwargs)
    packed = encode_tracking_capped([
        {"kind": "instance", "id": instance_id},
        {"kind": kind, "id": member_id},
    ])
    register_instance({"instance_id": instance_id, "label": data.get("label")})
    extra = {"kind": kind, "packed": packed.get("packed"), "cap": TRACKING_ID_CAP}
    with _conn() as conn:
        conn.execute(
            """INSERT INTO swarm_instance_members VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(instance_id, kind, member_id) DO UPDATE SET
                 area_id=excluded.area_id, tracking_id=excluded.tracking_id,
                 extra_json=excluded.extra_json, updated_at=excluded.updated_at""",
            (instance_id, kind, member_id, area.get("area_id"), packed.get("tracking_id"), das._json(extra), das.now()),
        )
    return {
        "ok": True,
        "instance_id": instance_id,
        "area_code": instance_id,
        "kind": kind,
        "member_id": member_id,
        "area_id": area.get("area_id"),
        "tracking_id": packed.get("tracking_id"),
        "packed": packed.get("packed"),
        "invented": False,
        "vector_db": False,
    }


def _sync_instance_registry_from_user(row: dict[str, Any] | None) -> None:
    row = row or {}
    instance_id = _normalize_area(row.get("instance_id") or LOCAL_AREA)
    uid = str(row.get("user_id") or "")[:80]
    if uid:
        register_instance_member({"instance_id": instance_id, "kind": "user", "member_id": uid})
    for kind, key in (("project", "project_ids"), ("log", "log_ids"), ("agent", "agent_ids")):
        for ident in row.get(key) or []:
            if ident:
                register_instance_member({"instance_id": instance_id, "kind": kind, "member_id": str(ident)[:80]})


def _register_members_from_tracking(tracking_id: str, fallback_instance: str = LOCAL_AREA) -> int:
    text = str(tracking_id or "").strip()
    if not text:
        return 0
    n = 0
    instance_id = fallback_instance
    members: list[dict[str, str]] = []
    if text.startswith("ref:"):
        return 0
    try:
        members = das.decode_tracking_id(text)
    except ValueError:
        if AREA_RE.fullmatch(text.split(".", 1)[0] if "." in text else ""):
            instance_id = text.split(".", 1)[0]
            for part in text.split(".")[1:]:
                if len(part) < 2:
                    continue
                prefix, ident = part[0], part[1:]
                kind = {"u": "user", "p": "project", "l": "log", "a": "agent"}.get(prefix)
                if kind and ident:
                    members.append({"kind": kind, "id": ident})
        else:
            return 0
    for member in members:
        kind = str(member.get("kind") or "")
        ident = str(member.get("id") or "")[:80]
        if kind == "instance" and ident:
            instance_id = _normalize_area(ident)
        elif kind in INSTANCE_MEMBER_KINDS and ident:
            register_instance_member({"instance_id": instance_id, "kind": kind, "member_id": ident})
            n += 1
    if instance_id:
        register_instance({"instance_id": instance_id})
    return n


def seed_instance_registry(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fill registry from existing instance_users / jobs / credit extras / 501.* ids. Never invents."""
    data = dict(data or {})
    n_members = 0
    register_instance({"instance_id": LOCAL_AREA})
    for row in list_instance_users(40):
        before = _registry_member_count()
        _sync_instance_registry_from_user(row)
        n_members += max(0, _registry_member_count() - before)
        if row.get("area_id"):
            n_members += _register_members_from_tracking(str(row.get("area_id")), str(row.get("instance_id") or LOCAL_AREA))
    for job in list_debug_jobs(40):
        instance_id = _normalize_area(job.get("instance_id") or LOCAL_AREA)
        register_instance({"instance_id": instance_id})
        for kind, key in (("user", "user_id"), ("project", "project_id"), ("log", "log_id"), ("agent", "agent_id")):
            ident = str(job.get(key) or "")[:80]
            if ident:
                register_instance_member({"instance_id": instance_id, "kind": kind, "member_id": ident})
                n_members += 1
        if job.get("tracking_id"):
            n_members += _register_members_from_tracking(str(job.get("tracking_id")), instance_id)
    for row in list_credit(40):
        extra = row.get("extra") or {}
        instance_id = _normalize_area(extra.get("instance_id") or LOCAL_AREA)
        for kind, key in (("user", "user_id"), ("project", "project_id"), ("log", "log_id"), ("agent", "agent_id")):
            ident = str(extra.get(key) or "")[:80]
            if ident:
                register_instance_member({"instance_id": instance_id, "kind": kind, "member_id": ident})
                n_members += 1
        if extra.get("log_id"):
            n_members += _register_members_from_tracking(str(extra.get("log_id")), instance_id)
    instances = list_instances()
    return {
        "ok": True,
        "n_instances": len(instances),
        "n_members": _registry_member_count(),
        "n_seeded": n_members,
        "instances": instances,
        "invented": False,
        "vector_db": False,
        "auto_fire": False,
        "goal": "OPEN",
        "users_table": "untouched",
    }


def _registry_member_count() -> int:
    with _conn() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM swarm_instance_members").fetchone()
    return int((row["n"] if row else 0) or 0)


def list_instances(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT instance_id, area_code, label, updated_at FROM swarm_instances ORDER BY instance_id LIMIT ?",
            (max(1, min(int(limit or 20), 40)),),
        )]
        counts = [dict(r) for r in conn.execute(
            "SELECT instance_id, kind, COUNT(*) AS n FROM swarm_instance_members GROUP BY instance_id, kind"
        )]
    by: dict[str, dict[str, int]] = {}
    for row in counts:
        by.setdefault(row["instance_id"], {})[row["kind"]] = int(row["n"] or 0)
    out = []
    for row in rows:
        n = by.get(row["instance_id"]) or {}
        out.append({
            **row,
            "label": row.get("label") or AREA_LABELS.get(row["instance_id"], ""),
            "counts": {kind: n.get(kind, 0) for kind in INSTANCE_MEMBER_KINDS},
            "n": sum(n.values()),
        })
    return out


def resolve_instance(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """area_code / instance_id → grouped members. sqlite only. No vector DB."""
    data = dict(data or {})
    raw = data.get("instance_id") or data.get("area_code") or data.get("area") or data.get("q") or LOCAL_AREA
    instance_id = _normalize_area(raw)
    register_instance({"instance_id": instance_id})
    with _conn() as conn:
        inst = conn.execute("SELECT * FROM swarm_instances WHERE instance_id = ?", (instance_id,)).fetchone()
        rows = [dict(r) for r in conn.execute(
            "SELECT kind, member_id, area_id, tracking_id FROM swarm_instance_members WHERE instance_id = ? ORDER BY kind, member_id",
            (instance_id,),
        )]
    grouped = {kind: [] for kind in INSTANCE_MEMBER_KINDS}
    for row in rows:
        kind = row.get("kind")
        if kind in grouped:
            grouped[kind].append({
                "id": row.get("member_id"),
                "area_id": row.get("area_id"),
                "tracking_id": row.get("tracking_id"),
            })
    inst = dict(inst) if inst else {"instance_id": instance_id, "area_code": instance_id, "label": AREA_LABELS.get(instance_id, "")}
    return {
        "ok": True,
        "instance_id": instance_id,
        "area_code": instance_id,
        "label": inst.get("label") or AREA_LABELS.get(instance_id, ""),
        "users": grouped["user"],
        "projects": grouped["project"],
        "logs": grouped["log"],
        "agents": grouped["agent"],
        "counts": {kind: len(grouped[kind]) for kind in INSTANCE_MEMBER_KINDS},
        "how": INSTANCE_REGISTRY_HOW,
        "cap": TRACKING_ID_CAP,
        "vector_db": False,
        "auto_fire": False,
        "goal": "OPEN",
        "users_table": "untouched",
    }


INSTANCE_REGISTRY_HOW = (
    "grok_debugger action=instance_registry q=501 (or instance_id/area_code). "
    "sqlite swarm_instances + swarm_instance_members. No hot-path vector DB. Cap 160 then pack."
)


lookup_area = resolve_instance
instance_registry = resolve_instance


def compact_instance_registry(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Overview-sized 501 lookup. Ids only, 8 per kind."""
    row = resolve_instance(data or {"q": LOCAL_AREA})
    out = {
        "ok": True,
        "instance_id": row.get("instance_id"),
        "area_code": row.get("area_code"),
        "label": row.get("label"),
        "counts": row.get("counts") or {},
        "how": row.get("how"),
        "vector_db": False,
        "auto_fire": False,
        "goal": "OPEN",
        "users_table": "untouched",
    }
    for kind, plural in (("user", "users"), ("project", "projects"), ("log", "logs"), ("agent", "agents")):
        out[plural] = [{"id": item.get("id")} for item in (row.get(plural) or [])[:8] if item.get("id")]
    return out


def history_search(query: str = "", *, limit: int = 20, offset: int = 0) -> dict[str, Any]:
    needle = str(query or "").strip().lower()
    limit = max(1, min(int(limit), 40))
    offset = max(0, int(offset))
    rows = []
    for item in reversed(trace.all_prompts()):
        blob = " ".join(str(item.get(k) or "") for k in ("log_id", "chat_id", "prompt", "project", "result"))
        if needle and needle not in blob.lower():
            continue
        rows.append({
            "log_id": item.get("log_id") or item.get("id") or "",
            "chat_id": item.get("chat_id") or item.get("chat") or "",
            "timestamp": item.get("timestamp") or item.get("ts") or "",
            "excerpt": das._excerpt(item.get("prompt") or item.get("excerpt") or item.get("notes"), 120),
        })
    page = rows[offset: offset + limit]
    coverage = {}
    try:
        from backend.services import cursor_transcript_index as cti

        coverage = cti.coverage(indexed=list(trace.indexed_prompts() or []))
    except Exception:
        coverage = {}
    return {
        "ok": True,
        "q": query,
        "offset": offset,
        "limit": limit,
        "count": len(page),
        "total": len(rows),
        "hits": page,
        "bodies": False,
        "excerpt_cap": 120,
        "coverage": coverage,
    }


def history_get(log_id: str) -> dict[str, Any]:
    ident = str(log_id or "").strip()
    if not ident:
        raise ValueError("log_id is required")
    for item in reversed(trace.all_prompts()):
        if str(item.get("log_id") or item.get("id") or "") == ident:
            return {
                "ok": True,
                "log_id": ident,
                "chat_id": item.get("chat_id") or "",
                "timestamp": item.get("timestamp") or item.get("ts") or "",
                "excerpt": das._excerpt(item.get("prompt") or item.get("excerpt") or item.get("notes"), 120),
                "result": item.get("result") or "",
                "blamed_log_id": item.get("blamed_log_id") or "",
                "note": "one log_id only; body capped at 120",
            }
    raise ValueError("log_id not found")


def parse_readonly(data: dict[str, Any]) -> dict[str, Any]:
    raw = str(data.get("command") or data.get("q") or data.get("command_key") or "").strip()
    if BLOCKED_TOKENS.search(raw):
        raise ValueError("readonly CLI rejects rm, writes, git, sudo, pipes, and network")
    tokens = raw.split()
    if not tokens:
        key = str(data.get("command_key") or "pwd").strip()
        if key.startswith("ro_"):
            key = key[3:]
        cmd = key.split("_")[0] if key.startswith(("ls", "pwd", "date", "wc", "head", "cat")) else key
    else:
        cmd = tokens[0].lower()
    if cmd not in READONLY_CMDS:
        raise ValueError(f"readonly command must be one of: {', '.join(READONLY_CMDS)}")
    path = ""
    if cmd in {"ls", "wc", "head", "cat"}:
        extra = [tok for tok in tokens[1:] if not tok.startswith("-")]
        path = str(data.get("path") or (extra[0] if extra else "ai-context/debugger"))
        if cmd == "ls" and (not path or path in {".", "-la", "-l"}):
            path = "ai-context/debugger"
        if cmd in {"head", "cat"} and path in {".", "ai-context/debugger"}:
            raise ValueError(f"{cmd} requires a jailed file path")
        _jailed(path)
    argv = [cmd]
    if cmd == "ls":
        argv += [str(_jailed(path))]
    elif cmd == "wc":
        argv += [str(_jailed(path))]
    elif cmd in {"head", "cat"}:
        argv += [str(_jailed(path))]
    return {"command_key": f"ro_{cmd}", "argv": argv, "cmd": cmd, "path": path, "shell": False}


def exec_readonly_cli(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """In-process allowlist read. No subprocess, no writes, no coordinator."""
    spec = parse_readonly(dict(data or {}))
    cmd = spec["cmd"]
    path = spec.get("path") or ""
    if cmd == "pwd":
        out = str(jail_roots()[0])
    elif cmd == "date":
        out = das.now()
    elif cmd == "ls":
        target = _jailed(path)
        names = [target.name] if target.is_file() else sorted(item.name for item in target.iterdir())[:80]
        out = "\n".join(names)
    elif cmd == "wc":
        target = _jailed(path)
        if target.is_file():
            out = str(len(target.read_text(encoding="utf-8", errors="replace").splitlines()))
        else:
            out = str(sum(1 for _ in target.iterdir()))
    elif cmd in {"head", "cat"}:
        target = _jailed(path)
        if not target.is_file():
            raise ValueError(f"{cmd} requires a jailed file")
        text = target.read_text(encoding="utf-8", errors="replace")
        out = "\n".join(text.splitlines()[:40]) if cmd == "head" else text[:READONLY_OUTPUT_CAP]
    else:
        raise ValueError("readonly allowlist violated")
    excerpt = das._excerpt(out[:400], 240)
    return {
        "ok": True,
        "status": "ran",
        "ran": True,
        "cmd": cmd,
        "path": path,
        "argv": spec["argv"],
        "command_key": spec["command_key"],
        "output": out[:READONLY_OUTPUT_CAP],
        "output_excerpt": excerpt,
        "shell": False,
        "subprocess": False,
        "readonly": True,
        "auto_fire": False,
        "license": "cli.readonly",
    }


def _readonly_safe() -> bool:
    try:
        from backend.services import debugger_privilege_service as dps

        return dps.can_act("cli.readonly") or dps.can_act("cli.journalctl")
    except Exception:
        return False


def queue_readonly_cli(data: dict[str, Any]) -> dict[str, Any]:
    """Jailed in-process read. Never starts a shell."""
    ran = exec_readonly_cli(data)
    row = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "status": "ran",
        "command_key": ran["command_key"],
        "argv": ran["argv"],
        "note": das._excerpt(data.get("note") or "in-process readonly; no shell", 160),
        "output_excerpt": ran["output_excerpt"],
        "readonly": True,
        "ran": True,
        "shell": False,
        "subprocess": False,
    }
    with das._conn() as conn:
        conn.execute(
            "INSERT INTO cli_requests VALUES (?,?,?,?,?,?,?)",
            (row["id"], row["ts"], row["status"], row["command_key"], das._json(row["argv"]), row["note"], row["output_excerpt"]),
        )
    return {**ran, **row}


def request_readonly_cli(data: dict[str, Any]) -> dict[str, Any]:
    return queue_readonly_cli(data)


def run_readonly_cli(cli_id: str) -> dict[str, Any]:
    row = das.get_cli(cli_id)
    if not row:
        raise ValueError("CLI request not found")
    if not str(row.get("command_key") or "").startswith("ro_"):
        raise ValueError("not a readonly CLI request")
    argv = row.get("argv") or []
    if not argv:
        raise ValueError("missing argv")
    cmd = str(argv[0])
    if cmd not in READONLY_CMDS:
        raise ValueError("readonly allowlist violated")
    payload: dict[str, Any] = {"command": cmd}
    if cmd in {"ls", "wc", "head", "cat"}:
        payload["path"] = argv[-1]
    ran = exec_readonly_cli(payload)
    with das._conn() as conn:
        conn.execute("UPDATE cli_requests SET status = 'ran', output_excerpt = ? WHERE id = ?", (ran["output_excerpt"], cli_id))
    return {**row, **ran, "id": cli_id}


def record_credit(data: dict[str, Any]) -> dict[str, Any]:
    period = str(data.get("period") or "daily").strip().lower()
    if period not in CREDIT_PERIODS:
        raise ValueError(f"period must be one of: {', '.join(CREDIT_PERIODS)}")
    category = str(data.get("category") or "").strip().lower()
    if category not in CREDIT_CATEGORIES:
        raise ValueError(f"category must be one of: {', '.join(CREDIT_CATEGORIES)}")
    credit = float(data.get("credit") if data.get("credit") is not None else data.get("score") or 0)
    credit = max(0.0, min(100.0, credit))
    damage = float(data.get("damage") or 0)
    row = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "period": period,
        "category": category,
        "credit": round(credit, 2),
        "damage": round(max(0.0, min(100.0, damage)), 2),
        "n": int(data.get("n") or 1),
        "actor": das._excerpt(data.get("actor") or data.get("agent_id") or "grok", 40),
        "extra": {
            "log_id": data.get("log_id") or "",
            "user_id": data.get("user_id") or "",
            "project_id": data.get("project_id") or "",
            "instance_id": data.get("instance_id") or LOCAL_AREA,
            "agent_id": data.get("agent_id") or "",
            "area_id": data.get("area_id") or "",
        },
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO credit_scores VALUES (?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], period, category, row["credit"], row["damage"], row["n"], row["actor"], das._json(row["extra"])),
        )
    if data.get("agent_id"):
        note_agent(data["agent_id"], period=period, category=category, credit=credit, damage=damage)
    return row


def _period_start(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "daily":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "weekly":
        return (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "monthly":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


def rollup_credit(period: str = "weekly") -> dict[str, Any]:
    if period not in CREDIT_PERIODS:
        raise ValueError("invalid period")
    start = _period_start(period)
    since = start.isoformat()
    bucket = start.date().isoformat()
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM credit_scores WHERE ts >= ? AND actor != 'rollup'",
            (since,),
        )]
        scores = [dict(r) for r in conn.execute("SELECT score, label, broken_json FROM scores WHERE ts >= ?", (since,))]
    by_cat: dict[str, list[float]] = {c: [] for c in CREDIT_CATEGORIES}
    dmg_cat: dict[str, list[float]] = {c: [] for c in CREDIT_CATEGORIES}
    for row in rows:
        cat = row["category"] if row["category"] in CREDIT_CATEGORIES else "time_to_complete"
        by_cat[cat].append(float(row["credit"] or 0))
        dmg_cat[cat].append(float(row["damage"] or 0))
    if scores:
        avg = sum(int(s["score"] or 0) for s in scores) / len(scores)
        by_cat["time_to_complete"].append(avg)
        high = [int(s["score"] or 0) for s in scores if str(s.get("label") or "") in {"achieved", "exceeded"}]
        if high:
            by_cat["optimization"].append(sum(high) / len(high))
    rolled = []
    with _conn() as conn:
        for category in CREDIT_CATEGORIES:
            values = by_cat.get(category) or []
            if not values:
                continue
            item = {
                "period": period,
                "category": category,
                "bucket": bucket,
                "credit_score": round(sum(values) / len(values), 2),
                "n": len(values),
                "damage": round(sum(dmg_cat.get(category) or [0]) / max(1, len(dmg_cat.get(category) or [0])), 2),
            }
            rolled.append(item)
            conn.execute(
                """INSERT INTO period_rollups VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(period, category, bucket) DO UPDATE SET
                     credit=excluded.credit, damage=excluded.damage, n=excluded.n, ts=excluded.ts""",
                (period, category, bucket, item["credit_score"], item["damage"], item["n"], das.now()),
            )
    reports = maybe_report_underperformers()
    return {"period": period, "since": since, "bucket": bucket, "categories": rolled, "score_count": len(scores), "reports": reports}


def rollup_all_periods() -> dict[str, Any]:
    return {period: rollup_credit(period) for period in CREDIT_PERIODS}


def list_period_rollups(period: str | None = None) -> list[dict[str, Any]]:
    with _conn() as conn:
        if period:
            rows = conn.execute("SELECT * FROM period_rollups WHERE period = ? ORDER BY bucket DESC", (period,))
        else:
            rows = conn.execute("SELECT * FROM period_rollups ORDER BY period, bucket DESC")
        return [dict(r) for r in rows]


def chart_periods() -> dict[str, list[dict[str, Any]]]:
    charts: dict[str, list[dict[str, Any]]] = {}
    for period in CREDIT_PERIODS:
        rows = [r for r in list_period_rollups(period)]
        charts[period] = [{"key": r["category"][:10], "value": r["credit"]} for r in rows[:7]]
    return charts


def list_credit(period: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        if period:
            rows = conn.execute("SELECT * FROM credit_scores WHERE period = ? ORDER BY ts DESC LIMIT ?", (period, max(1, min(limit, 40))))
        else:
            rows = conn.execute("SELECT * FROM credit_scores ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))
        out = [dict(r) for r in rows]
    for row in out:
        row["extra"] = json.loads(row.pop("extra_json") or "{}")
    return out


def resolve_ingest_agent(item: dict[str, Any] | None = None, data: dict[str, Any] | None = None) -> str:
    """Who owns this credit. Tick default grok does not steal cursor/kernel CAD."""
    item = dict(item or {})
    _ = data  # tick agent_id is not a per-row owner
    raw = str(item.get("agent_id") or item.get("actor") or "").strip().lower()
    if raw in {"", "live", "score", "prompt-trace", "tick", "cad-swarm-tick", "offline-jsonl"}:
        raw = ""
    features = [str(item.get("feature") or "")]
    features.extend(str(feat) for feat in (item.get("broken") or []))
    features.extend(str(feat) for feat in (item.get("features") or {}))
    blob = " ".join(str(item.get(k) or "") for k in ("prompt", "notes", "note"))
    kernel = any(_is_kernel_feature(feat) for feat in features if feat) or "gen_step" in blob.lower()
    if kernel:
        return "cursor" if raw in {"", "grok"} else raw
    if raw in {"cursor", "grok", "harness", "render-agent"}:
        return raw
    return "cursor"


def _league_avg_sql(*, exclude_empty_ticks: bool = True) -> str:
    where = ""
    if exclude_empty_ticks:
        where = " WHERE NOT (credit_score <= 0 AND IFNULL(note, '') IN ('act', ''))"
    return (
        "SELECT agent_id, AVG(credit_score) AS credit, AVG(damage) AS damage, COUNT(*) AS n "
        f"FROM agent_league{where} GROUP BY agent_id"
    )


def note_agent(agent_id: str, *, period: str, category: str, credit: float, damage: float, note: str = "") -> dict[str, Any]:
    aid = re.sub(r"[^A-Za-z0-9._-]", "", str(agent_id))[:40]
    if not aid:
        raise ValueError("agent_id required")
    if period not in CREDIT_PERIODS or category not in CREDIT_CATEGORIES:
        raise ValueError("invalid period or category")
    row = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "agent_id": aid,
        "period": period,
        "category": category,
        "credit_score": round(float(credit), 2),
        "damage": round(float(damage), 2),
        "n": 1,
        "note": das._excerpt(note, 160),
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO agent_league VALUES (?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], aid, period, category, row["credit_score"], row["damage"], 1, row["note"]),
        )
    return row


def list_league(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM agent_league ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))]


def underperformers(*, floor: float = UNDERPERFORM_FLOOR) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute(_league_avg_sql())]
    out = []
    for row in rows:
        credit = float(row["credit"] or 0)
        damage = float(row["damage"] or 0)
        n = int(row["n"] or 0)
        if credit < floor or damage >= 40:
            rec = "fix-few-issues"
            # Below floor with repeated or severe fails → fire (report only).
            if credit < floor and (n >= 2 or damage >= 40):
                rec = "fire"
            out.append({**row, "recommendation": rec, "n": n, "auto_fire": False})
    return out


def maybe_report_underperformers() -> list[dict[str, Any]]:
    created = []
    for row in underperformers():
        with _conn() as conn:
            existing = conn.execute(
                "SELECT id FROM agent_reports WHERE agent_id = ? AND status = 'pending_sam'",
                (row["agent_id"],),
            ).fetchone()
        if existing:
            continue
        created.append(report_agent({
            "agent_id": row["agent_id"],
            "recommendation": row["recommendation"],
            "credit_score": row["credit"],
            "note": f"auto-queued for Sam ({row['recommendation']}); never auto-fire",
        }))
    return created


def league_cycle(data: dict[str, Any]) -> dict[str, Any]:
    """CAD-style loop: act → snapshot → score → improve. Peer score is recorded. Never auto-fire."""
    agent_id = str(data.get("agent_id") or "grok")[:40]
    peer_id = str(data.get("peer_id") or data.get("scored_by") or "cursor")[:40]
    category = infer_category(data)
    credit = float(data.get("credit") if data.get("credit") is not None else data.get("score") or 50)
    damage = float(data.get("damage") or 0)
    snapshot_id = str(data.get("snapshot_id") or "")[:80]
    note_agent(agent_id, period=str(data.get("period") or "daily"), category=category, credit=credit, damage=damage, note="act")
    if peer_id and peer_id != agent_id:
        note_agent(peer_id, period="daily", category=category, credit=70, damage=0, note=f"scored {agent_id}")
    cid = uuid.uuid4().hex
    phase = "improve" if credit >= 70 else "score"
    with _conn() as conn:
        conn.execute(
            "INSERT INTO league_cycles VALUES (?,?,?,?,?,?,?,?,?)",
            (cid, das.now(), agent_id, peer_id, snapshot_id, category, credit, phase, das._excerpt(data.get("note") or "act→snapshot→score→improve", 160)),
        )
    reports = maybe_report_underperformers()
    return {
        "id": cid,
        "loop": ["act", "snapshot", "score", "improve"],
        "phase": phase,
        "agent_id": agent_id,
        "peer_id": peer_id,
        "snapshot_id": snapshot_id,
        "category": category,
        "credit": credit,
        "reports": reports,
        "auto_fire": False,
    }


def note_from_score(score_row: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = dict(data or {})
    agent_id = str(data.get("agent_id") or data.get("source") or data.get("actor") or "cursor")[:40]
    if agent_id in {"live", "score", "prompt-trace"}:
        agent_id = "cursor"
    instance_id = str(data.get("instance_id") or LOCAL_AREA)
    user_id = str(data.get("user_id") or data.get("debug_user_id") or data.get("uid") or score_row.get("user_id") or "")[:80]
    project_id = str(score_row.get("project_id") or data.get("project_id") or "")[:80]
    log_id = str(score_row.get("log_id") or data.get("log_id") or "")[:80]
    category = infer_category(data, score_row)
    duration = _duration_seconds(data, score_row)
    damage = _damage_value(data, score_row)
    raw_score = score_row.get("outcome")
    if raw_score in (None, ""):
        raw_score = score_row.get("score")
    if raw_score in (None, "") and category == "time_to_complete" and duration:
        raw_score = duration_credit(duration)
    elif raw_score in (None, "") and category == "liabilities" and damage:
        raw_score = damage_liability_credit(damage)
    extras: dict[str, Any] = {
        "agent_id": agent_id,
        "instance_id": instance_id if instance_id else LOCAL_AREA,
        "credit_category": category,
    }
    if user_id:
        extras["instance_user"] = register_user({
            "user_id": user_id,
            "instance_id": extras["instance_id"],
            "project_id": project_id,
            "log_id": log_id,
            "agent_id": agent_id,
        })
        extras["area_id"] = extras["instance_user"].get("area_id")
        extras["relations"] = extras["instance_user"].get("relations")
    credit = record_credit({
        "period": "daily",
        "category": category,
        "credit": raw_score or 0,
        "damage": damage or score_row.get("damage_score") or data.get("damage") or 0,
        "agent_id": agent_id,
        "actor": data.get("actor") or agent_id,
        "user_id": user_id,
        "project_id": project_id,
        "instance_id": extras["instance_id"],
        "log_id": log_id,
        "area_id": extras.get("area_id") or "",
    })
    extras["credit"] = credit
    extras["auto_fire"] = False
    extras["license"] = "dashboard-metric"
    if data.get("snapshot_id") or data.get("peer_id"):
        extras["cycle"] = league_cycle({**data, "agent_id": agent_id, "category": category, "credit": credit["credit"], "damage": credit["damage"]})
    return extras


def _ingested_today(log_id: str) -> bool:
    ident = str(log_id or "").strip()
    if not ident:
        return False
    since = _period_start("daily").isoformat()
    with _conn() as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(credit_scores)").fetchall()}
        col = "extra_json" if "extra_json" in cols else "extra"
        row = conn.execute(
            f"SELECT id FROM credit_scores WHERE ts >= ? AND {col} LIKE ? LIMIT 1",
            (since, f"%{ident}%"),
        ).fetchone()
    return bool(row)


_RESULT_SCORE = {"broke": 22, "partial": 50, "continued": 55, "improved": 75, "unknown": 40}


def _jsonl_score(item: dict[str, Any]) -> float:
    raw = item.get("score")
    if raw is not None and str(raw) != "":
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
    return float(_RESULT_SCORE.get(str(item.get("result") or "unknown").lower(), 40))


def _confirm_fixed_sidecar() -> list[dict[str, Any]]:
    try:
        from backend.services import debugger_metrics_service as dms

        rows: list[dict[str, Any]] = []
        for row in dms.list_confirms(40):
            logs = row.get("log_ids") or []
            log_id = str((logs[-1] if logs else row.get("individual_id") or row.get("id") or ""))[:80]
            if not log_id:
                continue
            rows.append({
                "log_id": log_id,
                "user_id": row.get("user_id") or "",
                "project_id": row.get("project_id") or "",
                "score": 90,
                "result": "improved",
                "fixed": [str(row.get("category_slug") or ""), str(row.get("subcategory") or "")],
                "category": row.get("category_slug") or "",
                "subcategory": row.get("subcategory") or "",
                "agent_id": "cursor",
                "source": "confirm-fixed",
            })
        return rows
    except Exception:
        return []


def _checklist_sidecar() -> list[dict[str, Any]]:
    try:
        from backend.services import incident_intelligence_service as ii

        if not Path(ii.DB_PATH).is_file():
            return []
        with ii._conn() as conn:
            found = conn.execute(
                "SELECT prompt_id, feature, status, project_id FROM events WHERE kind = 'checklist' ORDER BY ts DESC LIMIT 80"
            ).fetchall()
        grouped: dict[str, dict[str, Any]] = {}
        for row in found:
            item = dict(row)
            pid = str(item.get("prompt_id") or "")[:80]
            if not pid:
                continue
            bucket = grouped.setdefault(pid, {
                "log_id": pid,
                "project_id": item.get("project_id") or "",
                "features": {},
                "source": "checklist",
                "agent_id": "cursor",
            })
            bucket["features"][str(item.get("feature") or "")] = str(item.get("status") or "unknown")
        out = []
        for bucket in grouped.values():
            broken = [k for k, status in bucket["features"].items() if status in {"broken", "missing", "degraded"}]
            bucket["broken"] = broken
            bucket["score"] = 20 if broken else 70
            out.append(bucket)
        return out
    except Exception:
        return []


def ingest_offline_jsonl(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Credit prompt-trace jsonl + sqlite sidecars while Studio HTTP is stale.

    Same log_id is not credited twice in the current daily window. Dashboard
    metric only — never a write license. auto_fire stays false.
    """
    data = dict(data or {})
    limit = max(1, min(int(data.get("limit") or 80), 200))
    sources: list[dict[str, Any]] = []
    if data.get("include_index"):
        sources.extend(item for item in trace.all_prompts() if isinstance(item, dict))
    else:
        sources.extend(item for item in trace._load_live() if isinstance(item, dict))
    if data.get("sidecars", True):
        sources.extend(_confirm_fixed_sidecar())
        sources.extend(_checklist_sidecar())

    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in sources:
        log_id = str(item.get("log_id") or item.get("id") or "")[:80]
        if not log_id or log_id in seen:
            continue
        seen.add(log_id)
        if _ingested_today(log_id):
            skipped.append({"log_id": log_id, "reason": "already counted today"})
            continue
        if len(credited) >= limit:
            skipped.append({"log_id": log_id, "reason": "limit"})
            continue
        user_id = str(item.get("user_id") or item.get("debug_user_id") or item.get("uid") or data.get("user_id") or "sam-local")[:80]
        project_id = str(item.get("project_id") or item.get("project") or data.get("project_id") or "5bf8e783")[:80]
        if project_id in {"render-studio", "home-workspace", "uncategorized"}:
            project_id = str(data.get("project_id") or "5bf8e783")[:80]
        agent_id = resolve_ingest_agent(item, data)
        duration = _duration_seconds(item)
        damage = _damage_value(item)
        score = item.get("score")
        broken = list(item.get("broken") or [])
        features = dict(item.get("features") or {})
        payload = {
            "user_id": user_id,
            "project_id": project_id,
            "instance_id": str(item.get("instance_id") or data.get("instance_id") or LOCAL_AREA),
            "agent_id": agent_id,
            "log_id": log_id,
            "broken": broken,
            "fixed": list(item.get("fixed") or []),
            "features": features,
            "duration_s": duration,
            "damage": damage,
            "companion_damage": item.get("companion_damage") or item.get("user_damage") or "",
            "category": item.get("category") or item.get("credit_category") or "",
            "subcategory": item.get("subcategory") or "",
            "notes": f"offline-jsonl {item.get('source') or 'live-prompts'}",
        }
        if score not in (None, ""):
            payload["score"] = score
        extras = ingest_live_outcome(payload, {
            "score": score,
            "broken": broken,
            "features": features,
            "duration_s": duration,
            "damage_score": damage,
            "companion_damage": item.get("companion_damage"),
            "label": str(item.get("label") or item.get("result") or "partial"),
        })
        credited.append({
            "log_id": log_id,
            "category": extras.get("credit_category") or (extras.get("credit") or {}).get("category"),
            "credit": (extras.get("credit") or {}).get("credit"),
            "period": (extras.get("credit") or {}).get("period"),
            "user_id": user_id,
            "agent_id": agent_id,
            "area_id": extras.get("area_id") or (extras.get("instance_user") or {}).get("area_id"),
        })

    rollups = rollup_all_periods()
    cycle: dict[str, Any] = {"skipped": True, "reason": "no new credit", "auto_fire": False}
    if credited:
        last = credited[-1]
        cycle = league_cycle({
            "agent_id": str(last.get("agent_id") or "cursor")[:40],
            "peer_id": str(data.get("peer_id") or "grok")[:40],
            "snapshot_id": str(data.get("snapshot_id") or "cad-offline-jsonl")[:80],
            "category": last.get("category") or "time_to_complete",
            "credit": float(last.get("credit") or 0),
            "note": "offline jsonl ingest",
        })
    return {
        "ok": True,
        "ingest": "offline-jsonl",
        "credited": credited,
        "skipped": skipped,
        "n_credited": len(credited),
        "n_skipped": len(skipped),
        "periods": list(CREDIT_PERIODS),
        "rollups": {k: True for k in rollups},
        "cycle": {"id": cycle.get("id"), "phase": cycle.get("phase"), "skipped": cycle.get("skipped"), "auto_fire": False},
        "auto_fire": False,
        "license": "dashboard-metric",
        "via": "local",
    }


ingest_jsonl = ingest_offline_jsonl
rollup_live = ingest_offline_jsonl


def swarm_credit_tick(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Cheap idempotent ingest + period rollup + league_cycle. Dashboard metric only."""
    body = dict(data or {})
    body.setdefault("snapshot_id", "cad-swarm-tick")
    body.setdefault("peer_id", "grok")
    out = ingest_offline_jsonl(body)
    out["prompt_scores"] = ingest_prompt_result_liabilities(body)
    out["tick"] = True
    out["auto_fire"] = False
    out["license"] = "dashboard-metric"
    out["debug_jobs"] = swarm_debug_tick(body)
    out["shipped_hooks"] = stamp_shipped_thin_hooks({**body, "snapshots": False})
    out["candidate_confirm"] = out["shipped_hooks"].get("candidate_confirm") or propose_candidate_confirm({**body, "snapshots": False})
    out["test_verified"] = stamp_test_verified({**body, "snapshots": False})
    out["job_clocks"] = ingest_job_clock_time_to_complete(body)
    out["instance_registry"] = seed_instance_registry(body)
    out["hook_optimization"] = ingest_shipped_hook_optimization(body)
    out["http_classes"] = ingest_http_network_troubleshooting(body)
    out["controller_stamps"] = ingest_controller_stamps(body)
    out["networking_stamps"] = ingest_networking_stamps(body)
    out["cad_votes"] = (
        backfill_cad_votes_from_loop_md(body)
        if body.get("backfill_loop_md")
        else {"ok": True, "skipped": "not-on-tick", "n": 0}
    )
    if body.get("reports", True):
        out["reports"] = write_swarm_period_reports()
    out["sam_queue"] = write_sam_queue()
    if body.get("cad_snapshots", True):
        out["cad_snapshots"] = write_cad_job_snapshots(body)
    return out


credit_tick = swarm_credit_tick


def _job_day() -> str:
    return _period_start("daily").date().isoformat()


def suggest_debug_agent(category: str = "") -> str:
    """Higher league credit for the category wins. Never a write license."""
    cat = str(category or "").strip()
    with _conn() as conn:
        if cat and cat in CREDIT_CATEGORIES:
            rows = [dict(r) for r in conn.execute(
                "SELECT agent_id, AVG(credit_score) AS credit FROM agent_league WHERE category = ? AND agent_id IN ('cursor','grok') GROUP BY agent_id",
                (cat,),
            )]
        else:
            rows = []
        if not rows:
            rows = [dict(r) for r in conn.execute(
                "SELECT agent_id, AVG(credit_score) AS credit FROM agent_league WHERE agent_id IN ('cursor','grok') GROUP BY agent_id"
            )]
    if not rows:
        return "grok"
    return str(max(rows, key=lambda r: float(r.get("credit") or 0)).get("agent_id") or "grok")


def open_incident_alerts() -> list[dict[str, Any]]:
    """Latest broken/missing/degraded features. Does not write weekly reports."""
    try:
        from backend.services import incident_intelligence_service as ii
    except Exception:
        return []
    if not Path(ii.DB_PATH).is_file():
        return []
    try:
        with ii._conn() as conn:
            rows = conn.execute("SELECT * FROM events ORDER BY ts DESC, rowid DESC LIMIT 1000").fetchall()
        events = [ii._row(row) for row in rows]
    except Exception:
        return []
    latest: dict[str, dict[str, Any]] = {}
    for event in events:
        latest.setdefault(str(event.get("feature") or ""), event)
    alerts: list[dict[str, Any]] = []
    for feature, event in latest.items():
        if not feature or str(event.get("status") or "") not in {"broken", "missing", "degraded"}:
            continue
        try:
            comparison = ii.compare(feature)
        except Exception:
            comparison = {}
        first = comparison.get("first_failure") or event
        last = comparison.get("last_working")
        alerts.append({
            "feature": feature,
            "status": event.get("status"),
            "project_id": event.get("project_id") or (first or {}).get("project_id") or "",
            "user_id": ((event.get("fields") or {}).get("user.id") if isinstance(event.get("fields"), dict) else "") or "",
            "last_working": last,
            "first_failure": first,
            "log_id": (first or {}).get("id") or event.get("id") or "",
            "log_path": (first or {}).get("log_path") or event.get("log_path") or "",
            "cause_hint": comparison.get("cause_hint") or "",
        })
    return alerts


def _prompt_feature_ids(item: dict[str, Any], *, broken_only: bool = False) -> list[str]:
    ids: list[str] = []
    features = item.get("features") or {}
    if isinstance(features, dict):
        for key, status in features.items():
            feat = str(key or "").strip()
            if not feat or feat.lower() == "none":
                continue
            state = str(status or "").strip().lower()
            if broken_only and state not in {"broken", "missing", "degraded"}:
                continue
            if not broken_only and state not in {"ok", "fixed"}:
                continue
            ids.append(feat)
    if broken_only:
        for feat in item.get("broken") or []:
            name = str(feat or "").strip()
            if name and name.lower() != "none" and name not in ids:
                ids.append(name)
    return ids


def open_prompt_trace_alerts(*, limit: int = 80) -> list[dict[str, Any]]:
    """Broken feature ids from live-prompts.jsonl (and compact index). Never executes."""
    rows: list[dict[str, Any]] = []
    seen_logs: set[str] = set()
    try:
        live = [item for item in (trace._load_live() or []) if isinstance(item, dict)]
    except Exception:
        live = []
    extra: list[dict[str, Any]] = []
    if len(live) < 8:
        try:
            extra = [item for item in (trace.indexed_prompts() or []) if isinstance(item, dict)][-max(1, min(int(limit), 80)):]
        except Exception:
            extra = []
    for item in extra + live:
        lid = str(item.get("log_id") or item.get("id") or "")
        if lid and lid in seen_logs:
            continue
        if lid:
            seen_logs.add(lid)
        rows.append(item)
    latest: dict[str, str] = {}
    first_broken: dict[str, dict[str, Any]] = {}
    last_working: dict[str, dict[str, Any]] = {}
    meta: dict[str, dict[str, Any]] = {}
    for item in rows:
        for feat in _prompt_feature_ids(item, broken_only=False):
            last_working[feat] = item
            latest[feat] = "ok"
        for feat in _prompt_feature_ids(item, broken_only=True):
            first_broken.setdefault(feat, item)
            latest[feat] = "broken"
            meta[feat] = item
    alerts: list[dict[str, Any]] = []
    log_path = "data/prompt-trace/live-prompts.jsonl"
    for feature, status in latest.items():
        if status not in {"broken", "missing", "degraded"}:
            continue
        first = first_broken.get(feature) or {}
        last = last_working.get(feature)
        src = meta.get(feature) or first
        alerts.append({
            "feature": feature,
            "status": status,
            "project_id": str(src.get("project_id") or src.get("project") or first.get("project_id") or "")[:80],
            "user_id": str(src.get("user_id") or src.get("debug_user_id") or src.get("uid") or "")[:80],
            "last_working": {"id": str(last.get("log_id") or last.get("id") or "")} if last else None,
            "first_failure": {"id": str(first.get("log_id") or first.get("id") or ""), "log_path": log_path},
            "log_id": str(first.get("log_id") or first.get("id") or "")[:80],
            "log_path": log_path,
            "cause_hint": "prompt-trace jsonl broken feature",
            "source": "prompt-trace",
        })
    return alerts


def _decorate_debug_job(row: dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    extra = data.pop("extra_json", None)
    if extra is not None:
        data["extra"] = json.loads(extra or "{}")
    else:
        data.setdefault("extra", {})
    extra = data.get("extra") or {}
    data["candidate_confirm"] = bool(extra.get("candidate_confirm"))
    data["test_verified"] = bool(extra.get("test_verified"))
    data["test_path"] = extra.get("test_path") or ""
    data["auto_fire"] = False
    data["executed"] = False
    blocked = patch_claim_blocked(data)
    data["patch_claim"] = not blocked
    if blocked == "replace_approach_guard":
        brief = replacement_brief(data)
        data["replacement_brief"] = brief
        data["playbook"] = brief.get("playbook")
    elif blocked == "pending_reload_guard":
        brief = pending_reload_brief(data)
        data["reload_brief"] = brief
        data["playbook"] = brief.get("playbook")
        if _normalize_cad_rec(data.get("recommendation")) != "pending_reload":
            data["recommendation"] = "pending_reload"
    return data


def _compact_debug_job(job: dict[str, Any]) -> dict[str, Any]:
    extra = job.get("extra") or {}
    return {
        "id": job.get("id"),
        "tracking_id": job.get("tracking_id"),
        "feature": job.get("feature_id") or job.get("feature"),
        "status": job.get("status"),
        "category": job.get("category"),
        "candidate_confirm": bool(job.get("candidate_confirm") or extra.get("candidate_confirm")),
        "test_verified": bool(job.get("test_verified") or extra.get("test_verified")),
        "test_path": job.get("test_path") or extra.get("test_path") or "",
        "recommendation": job.get("recommendation") or extra.get("recommendation") or "",
        "patch_claim": not patch_claim_blocked(job),
        "executed": False,
    }


def _is_kernel_feature(feature: str, extra: dict[str, Any] | None = None) -> bool:
    extra = extra or {}
    return bool(extra.get("kernel")) or feature in KERNEL_FEATURES or feature.startswith("prompt.")


def stamp_incident_for_debug_job(job: dict[str, Any] | None = None) -> dict[str, Any]:
    """Mirror a non-kernel debug job into incident events so compare can Jaccard.

    Studio client-smoke POSTs from a logged-in user or harness key, so jsonl-minted
    webgl.context never becomes first_failure without this stamp. Kernel
    prompt.run / cad.gen_step / cad.generate stay unstamped. Context-lost never
    writes viewport.boot as broken; boot stays a separate ok vector.
    """
    from backend.services import incident_intelligence_service as ii

    job = dict(job or {})
    feature = str(job.get("feature_id") or job.get("feature") or "")[:80]
    extra = job.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    if not feature or _is_kernel_feature(feature, extra):
        return {"ok": False, "skipped": True, "reason": "kernel-or-empty", "feature": feature, "executed": False}
    latest = ii.latest(feature)
    if latest and latest.get("status") == "broken":
        webgl = ii.compare(feature)
        boot = ii.compare("viewport.boot") if feature == "webgl.context" else {}
        return {
            "ok": True,
            "skipped": True,
            "reason": "already broken",
            "feature": feature,
            "first_failure": ((webgl.get("first_failure") or {}) or {}).get("id"),
            "last_working": ((webgl.get("last_working") or {}) or {}).get("id"),
            "boot_first_failure": ((boot.get("first_failure") or {}) or {}).get("id") if boot else None,
            "executed": False,
        }
    project_id = str(job.get("project_id") or "")[:100]
    prompt_id = str(job.get("first_broken_id") or job.get("log_id") or "")[:100]
    boot_event = None
    if feature == "webgl.context" and not ii.latest("viewport.boot"):
        boot_event = ii.record_event({
            "feature": "viewport.boot",
            "status": "ok",
            "kind": "client-smoke",
            "note": "Renderer initialized",
            "source": "debug-job-stamp",
            "project_id": project_id,
            "prompt_id": prompt_id,
        })
    note = "WebGL context lost" if feature == "webgl.context" else das._excerpt(job.get("note") or feature, 200)
    event = ii.record_event({
        "feature": feature,
        "status": "broken",
        "kind": "client-smoke" if feature == "webgl.context" else "debug-job",
        "note": note,
        "source": "debug-job-stamp",
        "project_id": project_id,
        "prompt_id": prompt_id,
        "fields": {"job_id": str(job.get("id") or ""), "tracking_id": str(job.get("tracking_id") or "")},
    })
    compared = ii.compare(feature)
    boot = ii.compare("viewport.boot") if feature == "webgl.context" else {}
    return {
        "ok": True,
        "skipped": False,
        "feature": feature,
        "event_id": event["id"],
        "first_failure": ((compared.get("first_failure") or {}) or {}).get("id"),
        "last_working": ((compared.get("last_working") or {}) or {}).get("id"),
        "boot_first_failure": ((boot.get("first_failure") or {}) or {}).get("id") if boot else None,
        "boot_event_id": (boot_event or {}).get("id"),
        "executed": False,
    }


def stamp_offline_feature(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Grok/local stamp when Studio HTTP 404/401s. Allowlist only. Never kernel."""
    from backend.routers.debugger_analytics import client_stamp_allowed
    from backend.services import incident_intelligence_service as ii

    data = dict(data or {})
    feature = str(data.get("feature") or data.get("feature_id") or "").strip().lower()[:80]
    extra = data.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    if not feature:
        raise ValueError("feature required")
    if _is_kernel_feature(feature, extra):
        return {"ok": False, "skipped": True, "reason": "kernel", "feature": feature, "auto_fire": False}
    if not client_stamp_allowed(feature, super_admin=False):
        return {"ok": False, "skipped": True, "reason": "not-allowlisted", "feature": feature, "auto_fire": False}
    status = str(data.get("status") or "unknown").lower()
    if status == "restored":
        status = "ok"
    if status not in {"ok", "degraded", "broken", "missing", "unknown"}:
        status = "unknown"
    day = das.now()[:10]
    log_id = str(data.get("log_id") or f"stamp:{feature}:{day}:{status}")[:80]
    prev = ii.latest(feature)
    same_day = bool(prev and str(prev.get("ts") or "")[:10] == day)
    if (same_day and str(prev.get("status") or "") == status) or _ingested_today(log_id):
        marked = propose_candidate_confirm({"feature": feature, "snapshots": True})
        return {
            "ok": True,
            "skipped": True,
            "reason": "already-stamped-today",
            "feature": feature,
            "log_id": log_id,
            "candidate_confirm": marked,
            "auto_fire": False,
        }
    event = ii.record_event({
        "feature": feature,
        "status": status,
        "kind": data.get("kind") or "client-smoke",
        "source": data.get("source") or "grok-offline-stamp",
        "note": data.get("note") or f"offline stamp {feature}",
        "project_id": data.get("project_id") or "",
        "prompt_id": data.get("prompt_id") or log_id,
        "fields": data.get("fields") or {},
    })
    broken = [feature] if status in {"broken", "missing"} else []
    score = 25 if broken else 65
    ingest = ingest_live_outcome({
        "log_id": log_id,
        "feature": feature,
        "broken": broken,
        "agent_id": data.get("agent_id") or "grok",
        "user_id": data.get("user_id") or data.get("uid") or "grok-offline",
        "project_id": data.get("project_id") or "",
        "instance_id": data.get("instance_id") or LOCAL_AREA,
        "score": score,
        "notes": data.get("note") or f"offline stamp {feature}",
        "actor": data.get("actor") or "grok",
    }, {"score": score, "broken": broken, "features": {feature: status}})
    marked = propose_candidate_confirm({"feature": feature, "snapshots": True})
    return {
        "ok": True,
        "skipped": False,
        "feature": feature,
        "status": status,
        "event": event,
        "ingest": ingest,
        "log_id": log_id,
        "candidate_confirm": marked,
        "auto_fire": False,
        "license": "dashboard-metric",
    }


def propose_candidate_confirm(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Claimed/pending job + later ok stamp → candidate_confirm pending_sam. Never confirm_fixed."""
    from backend.services import incident_intelligence_service as ii

    data = dict(data or {})
    only = str(data.get("feature") or data.get("feature_id") or "").strip().lower()
    jobs = list_debug_jobs(40, status="claimed") + list_debug_jobs(40, status="pending_sam")
    marked: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for job in jobs:
        extra = dict(job.get("extra") or {})
        feature = str(job.get("feature_id") or job.get("feature") or "").strip().lower()
        if only and feature != only:
            continue
        if extra.get("candidate_confirm"):
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "already-candidate"})
            continue
        if extra.get("sam_confirmed") or job.get("status") == "sam_confirmed":
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "sam-confirmed"})
            continue
        if _is_kernel_feature(feature, extra):
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "kernel"})
            continue
        latest = ii.latest(feature)
        status = str((latest or {}).get("status") or "").lower()
        if status == "restored":
            status = "ok"
        if not latest or status != "ok":
            continue
        first_id = str(job.get("first_broken_id") or "")
        first = ii.get_event(first_id) if first_id else None
        first_ts = str((first or {}).get("ts") or "")
        if not first_ts:
            broken = ii.latest(feature, status="broken")
            first_ts = str((broken or {}).get("ts") or "")
        ok_ts = str(latest.get("ts") or "")
        if not first_ts or not ok_ts or ok_ts <= first_ts:
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "ok-not-newer"})
            continue
        extra["candidate_confirm"] = True
        extra["candidate_confirm_at"] = das.now()
        extra["candidate_ok_event"] = latest.get("id")
        extra["executed"] = False
        extra["confirm_fixed"] = False
        with _conn() as conn:
            conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra), job["id"]))
        marked.append({
            "id": job["id"],
            "feature_id": feature,
            "status": job.get("status"),
            "candidate_confirm": True,
            "executed": False,
            "confirm_fixed": False,
        })
    snaps = None
    if marked and data.get("snapshots", True):
        snaps = write_cad_job_snapshots(data)
    return {
        "ok": True,
        "marked": marked,
        "n": len(marked),
        "skipped": skipped,
        "cad_snapshots": snaps,
        "auto_fire": False,
        "executed": False,
        "confirm_fixed": False,
        "license": "pending_sam",
        "goal": "OPEN",
    }


def _is_shipped_thin_hook(feature: str, extra: dict[str, Any] | None = None) -> bool:
    extra = extra or {}
    feat = str(feature or "").strip().lower()
    if not feat or _is_kernel_feature(feat, extra):
        return False
    note = str(SHIPPED_THIN_HOOKS.get(feat) or "")
    return bool(note) and not note.lower().startswith("none")


def stamp_shipped_thin_hooks(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Later-ok for shipped thin hooks so tick can candidate_confirm. Not breakage=0. Never kernel."""
    from backend.services import incident_intelligence_service as ii

    data = dict(data or {})
    stamped: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    jobs = list_debug_jobs(40, status="claimed") + list_debug_jobs(40, status="pending_sam")
    day = das.now()[:10]
    for job in jobs:
        extra = dict(job.get("extra") or {})
        feature = str(job.get("feature_id") or job.get("feature") or "").strip().lower()
        if not _is_shipped_thin_hook(feature, extra):
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "not-shipped-or-kernel"})
            continue
        if extra.get("candidate_confirm") or extra.get("sam_confirmed") or job.get("status") == "sam_confirmed":
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "already-candidate"})
            continue
        log_id = f"shipped:{feature}:{day}"[:80]
        latest = ii.latest(feature)
        if latest and str(latest.get("status") or "").lower() in {"ok", "restored"} and str(latest.get("source") or "") == "shipped-thin-hook":
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "already-shipped-ok"})
            continue
        event = ii.record_event({
            "feature": feature,
            "status": "ok",
            "kind": "shipped-thin-hook",
            "source": "shipped-thin-hook",
            "note": f"shipped {SHIPPED_THIN_HOOKS.get(feature)}; not breakage=0",
            "project_id": job.get("project_id") or extra.get("project_id") or "",
            "prompt_id": log_id,
        })
        stamped.append({
            "id": job.get("id"),
            "feature_id": feature,
            "event_id": (event or {}).get("id"),
            "log_id": log_id,
            "breakage_zero": False,
            "executed": False,
        })
    marked = propose_candidate_confirm({**data, "snapshots": bool(data.get("snapshots"))})
    return {
        "ok": True,
        "stamped": stamped,
        "n_stamped": len(stamped),
        "skipped": skipped,
        "candidate_confirm": marked,
        "auto_fire": False,
        "executed": False,
        "confirm_fixed": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


def focused_test_spec(feature: str) -> dict[str, Any]:
    feat = str(feature or "").strip().lower()
    rel = FEATURE_FOCUSED_TESTS.get(feat) or ""
    if not rel:
        return {}
    return {"feature": feat, "path": rel, "runner": "node --test"}


def run_focused_test(spec: dict[str, Any] | None = None, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Run one mapped node:test file. Not confirm. Not breakage=0."""
    data = dict(data or {})
    hook = data.get("run_focused_test")
    spec = dict(spec or {})
    if callable(hook):
        return hook(spec)
    rel = str(spec.get("path") or "").strip().replace("\\", "/")
    allowed = set(FEATURE_FOCUSED_TESTS.values())
    if rel not in allowed:
        return {"ok": False, "passed": False, "reason": "unmapped-path", "path": rel}
    root = Path(data.get("repo_root") or REPO_ROOT).resolve()
    full = (root / rel).resolve()
    try:
        full.relative_to(root)
    except ValueError:
        return {"ok": False, "passed": False, "reason": "path-escape", "path": rel}
    if not full.is_file():
        return {"ok": False, "passed": False, "reason": "missing", "path": rel}
    try:
        proc = subprocess.run(
            ["node", "--test", str(full)],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=int(data.get("timeout") or FOCUSED_TEST_TIMEOUT_S),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "passed": False, "reason": type(exc).__name__, "path": rel}
    return {
        "ok": True,
        "passed": proc.returncode == 0,
        "returncode": proc.returncode,
        "path": rel,
        "excerpt": das._excerpt((proc.stderr or proc.stdout or "")[-400:], 120),
    }


def stamp_test_verified(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """candidate_confirm + mapped focused test pass → extra.test_verified. Not sam_confirmed. Not breakage=0."""
    data = dict(data or {})
    stamped: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    jobs = list_debug_jobs(40, status="claimed") + list_debug_jobs(40, status="pending_sam")
    for job in jobs:
        extra = dict(job.get("extra") or {})
        feature = str(job.get("feature_id") or job.get("feature") or "").strip().lower()
        if extra.get("sam_confirmed") or job.get("status") == "sam_confirmed":
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "sam-confirmed"})
            continue
        if _is_kernel_feature(feature, extra):
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "kernel"})
            continue
        if not (job.get("candidate_confirm") or extra.get("candidate_confirm")):
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "not-candidate"})
            continue
        if extra.get("test_verified"):
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "already-verified"})
            continue
        spec = focused_test_spec(feature)
        if not spec:
            skipped.append({"id": job.get("id"), "feature_id": feature, "reason": "no-mapped-test"})
            continue
        ran = run_focused_test(spec, data)
        if not ran.get("passed"):
            skipped.append({
                "id": job.get("id"),
                "feature_id": feature,
                "reason": ran.get("reason") or "test-failed",
                "path": spec.get("path"),
                "test_verified": False,
            })
            continue
        extra["test_verified"] = True
        extra["test_verified_at"] = das.now()
        extra["test_path"] = spec["path"]
        extra["breakage_zero"] = False
        extra["executed"] = False
        extra["sam_confirmed"] = False
        with _conn() as conn:
            conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra), job["id"]))
        stamped.append({
            "id": job["id"],
            "feature_id": feature,
            "test_verified": True,
            "test_path": spec["path"],
            "breakage_zero": False,
            "executed": False,
            "sam_confirmed": False,
            "goal": "OPEN",
        })
    return {
        "ok": True,
        "stamped": stamped,
        "n_stamped": len(stamped),
        "skipped": skipped,
        "auto_fire": False,
        "executed": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


stamp_feature = stamp_offline_feature

SEED_CREDIT_BUCKETS = frozenset({"networking", "controllers", "memory_leaks", "liabilities"})
SEED_BUCKET_FEATURES = (
    "memory.leak",
    "system.ram",
    "vr.controllers",
    "vr.controllers.trigger",
    "vr.controls",
    "network.latency",
    "network.lag",
    "network.rtt",
    "network.webrtc",
    "companion.damage",
    "user.damage",
    "human.override",
    "user.override",
)


def ingest_existing_incident_stamps(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Credit existing incident events into the 4 seed buckets. Never invents events."""
    from backend.services import incident_intelligence_service as ii

    data = dict(data or {})
    wanted = [str(feat).strip().lower()[:80] for feat in (data.get("features") or SEED_BUCKET_FEATURES) if feat]
    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    missing: list[str] = []
    for feature in wanted:
        category = category_for_feature_id(feature) or infer_category({"feature": feature})
        if category not in SEED_CREDIT_BUCKETS:
            skipped.append({"feature": feature, "reason": "not-seed-bucket", "category": category})
            continue
        event = ii.latest(feature)
        if not event:
            missing.append(feature)
            continue
        log_id = str(event.get("id") or "")[:80]
        if not log_id:
            skipped.append({"feature": feature, "reason": "no-event-id"})
            continue
        if _ingested_today(log_id):
            skipped.append({"log_id": log_id, "feature": feature, "reason": "already counted today"})
            continue
        status = str(event.get("status") or "").lower()
        broken = [feature] if status in {"broken", "missing"} else []
        score = 25 if broken else 65
        extras = ingest_live_outcome({
            "log_id": log_id,
            "feature": feature,
            "broken": broken,
            "agent_id": data.get("agent_id") or "cursor",
            "user_id": data.get("user_id") or "sam-local",
            "project_id": event.get("project_id") or data.get("project_id") or "5bf8e783",
            "instance_id": data.get("instance_id") or LOCAL_AREA,
            "score": score,
            "notes": event.get("note") or f"incident {feature}",
            "source": event.get("source") or "incident-stamp",
        }, {"score": score, "broken": broken, "features": {feature: status or "unknown"}})
        credited.append({
            "log_id": log_id,
            "feature": feature,
            "category": extras.get("credit_category") or category,
            "credit": (extras.get("credit") or {}).get("credit"),
            "status": status,
            "note": das._excerpt(event.get("note") or "", 80),
        })
    rollups = rollup_all_periods()
    return {
        "ok": True,
        "credited": credited,
        "skipped": skipped,
        "missing": missing,
        "n_credited": len(credited),
        "n_skipped": len(skipped),
        "invented": False,
        "auto_fire": False,
        "license": "dashboard-metric",
        "goal": "OPEN",
        "rollups": {key: True for key in rollups},
    }


def ingest_thumb_down_liability(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Credit a real thumbs-down as user.damage liabilities. Never invents a thumb."""
    data = dict(data or {})
    log_id = str(data.get("log_id") or data.get("event_id") or "")[:80]
    export_id = str(data.get("export_id") or "")[:80]
    if not log_id and export_id:
        log_id = f"thumb:{export_id}"[:80]
    if not log_id:
        return {"ok": False, "skipped": True, "reason": "no-export", "invented": False, "auto_fire": False}
    if _ingested_today(log_id):
        return {"ok": True, "skipped": True, "reason": "already counted today", "log_id": log_id, "invented": False, "auto_fire": False}
    damage = _damage_value(data) or 40.0
    score = damage_liability_credit(damage)
    extras = ingest_live_outcome({
        "log_id": log_id,
        "feature": "user.damage",
        "broken": ["user.damage"],
        "user_damage": damage,
        "damage": damage,
        "agent_id": data.get("agent_id") or "cursor",
        "actor": "user",
        "user_id": data.get("user_id") or "sam-local",
        "project_id": data.get("project_id") or "5bf8e783",
        "instance_id": data.get("instance_id") or LOCAL_AREA,
        "score": score,
        "notes": data.get("note") or f"thumbs-down {export_id}",
    }, {
        "score": score,
        "broken": ["user.damage"],
        "features": {"user.damage": "broken"},
        "damage_score": damage,
    })
    extras["skipped"] = False
    extras["invented"] = False
    extras["log_id"] = log_id
    extras["feature"] = "user.damage"
    extras["auto_fire"] = False
    extras["goal"] = "OPEN"
    return extras


PROMPT_SCORE_LIABILITY_FLOOR = 60


def _score_number(item: dict[str, Any] | None = None) -> float | None:
    item = item or {}
    raw = item.get("score") if item.get("score") not in (None, "") else item.get("desired_score")
    if raw in (None, ""):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value < 0 or value > 100:
        return None
    return value


def _iter_prompt_result_scores(data: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Real jsonl (+ optional scores table) rows that already have a numeric score. Never invents."""
    data = dict(data or {})
    seen: dict[str, dict[str, Any]] = {}
    for item in trace._load_live():
        if not isinstance(item, dict):
            continue
        log_id = str(item.get("log_id") or "")[:80]
        score = _score_number(item)
        if not log_id or score is None:
            continue
        seen[log_id] = {**item, "score": score, "source": item.get("source") or "live-prompts"}
    if data.get("include_score_table", True):
        try:
            for row in das.list_scores(80):
                if not isinstance(row, dict):
                    continue
                log_id = str(row.get("log_id") or "")[:80]
                score = _score_number(row)
                if not log_id or score is None or log_id in seen:
                    continue
                seen[log_id] = {**row, "score": score, "source": "scores-table"}
        except Exception:
            pass
    return list(seen.values())


def ingest_prompt_result_liabilities(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """PROMPT_RESULT / desired-result scores → liabilities. Low=user.damage, high=credit. No invented incidents."""
    data = dict(data or {})
    limit = max(1, min(int(data.get("limit") or 80), 200))
    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in _iter_prompt_result_scores(data):
        log_id = str(item.get("log_id") or "")[:80]
        credit_log = f"prompt-score:{log_id}"[:80]
        if not log_id:
            skipped.append({"log_id": log_id, "reason": "no-log", "invented": False})
            continue
        if _ingested_today(credit_log):
            skipped.append({"log_id": log_id, "reason": "already counted today", "invented": False})
            continue
        if len(credited) >= limit:
            skipped.append({"log_id": log_id, "reason": "limit", "invented": False})
            continue
        score = float(item["score"])
        low = score < PROMPT_SCORE_LIABILITY_FLOOR
        damage = round(max(0.0, 100.0 - score), 2) if low else 0.0
        credit = damage_liability_credit(damage) if low else score
        user_id = str(item.get("user_id") or item.get("debug_user_id") or item.get("uid") or data.get("user_id") or "sam-local")[:80]
        project_id = str(item.get("project_id") or item.get("project") or data.get("project_id") or "5bf8e783")[:80]
        if project_id in {"render-studio", "home-workspace", "uncategorized"}:
            project_id = str(data.get("project_id") or "5bf8e783")[:80]
        extras = ingest_live_outcome({
            "log_id": credit_log,
            "credit_category": "liabilities",
            "feature": "user.damage" if low else "",
            "broken": ["user.damage"] if low else [],
            "user_damage": damage,
            "damage": damage,
            "actor": "user" if low else (item.get("agent_id") or "cursor"),
            "agent_id": item.get("agent_id") or data.get("agent_id") or "cursor",
            "user_id": user_id,
            "project_id": project_id,
            "instance_id": item.get("instance_id") or data.get("instance_id") or LOCAL_AREA,
            "score": credit,
            "notes": f"prompt-result {'low' if low else 'high'} {log_id}",
        }, {
            "score": credit,
            "broken": ["user.damage"] if low else [],
            "features": {"user.damage": "broken"} if low else {},
            "damage_score": damage,
            "label": str(item.get("label") or ("missed" if low else "achieved")),
        })
        credited.append({
            "log_id": log_id,
            "credit_log_id": credit_log,
            "score": score,
            "low": low,
            "feature": "user.damage" if low else "",
            "category": "liabilities",
            "credit": (extras.get("credit") or {}).get("credit"),
            "damage": damage,
            "invented": False,
        })
    return {
        "ok": True,
        "n_credited": len(credited),
        "credited": credited,
        "skipped": skipped,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


def liabilities_queue_stats() -> dict[str, Any]:
    rows = [r for r in list_credit(limit=40) if r.get("category") == "liabilities"]
    credits = [float(r.get("credit") or 0) for r in rows]
    return {
        "n": len(rows),
        "credit_avg": round(sum(credits) / len(credits), 2) if credits else 0.0,
        "populated": bool(rows),
        "source": "prompt-result-scores",
        "auto_fire": False,
    }


def time_to_complete_queue_stats() -> dict[str, Any]:
    rows = []
    for row in list_credit(limit=40):
        if row.get("category") != "time_to_complete":
            continue
        extra = row.get("extra") or {}
        if str(extra.get("log_id") or "").startswith("job-clock:"):
            rows.append(row)
    credits = [float(r.get("credit") or 0) for r in rows]
    return {
        "n": len(rows),
        "credit_avg": round(sum(credits) / len(credits), 2) if credits else 0.0,
        "populated": bool(rows),
        "source": "job-clocks",
        "sam_gate": "candidate_confirm wait is not a grok penalty",
        "auto_fire": False,
    }


def optimization_queue_stats() -> dict[str, Any]:
    rows = []
    for row in list_credit(limit=40):
        if row.get("category") != "optimization":
            continue
        extra = row.get("extra") or {}
        if str(extra.get("log_id") or "").startswith("opt-hook:"):
            rows.append(row)
    credits = [float(r.get("credit") or 0) for r in rows]
    return {
        "n": len(rows),
        "credit_avg": round(sum(credits) / len(credits), 2) if credits else 0.0,
        "populated": bool(rows),
        "source": "shipped-thin-hooks",
        "auto_fire": False,
    }


def network_troubleshooting_queue_stats() -> dict[str, Any]:
    rows = []
    for row in list_credit(limit=40):
        if row.get("category") != "network_troubleshooting":
            continue
        extra = row.get("extra") or {}
        if str(extra.get("log_id") or "").startswith("http-class:"):
            rows.append(row)
    credits = [float(r.get("credit") or 0) for r in rows]
    return {
        "n": len(rows),
        "credit_avg": round(sum(credits) / len(credits), 2) if credits else 0.0,
        "populated": bool(rows),
        "source": "http-classes",
        "auto_fire": False,
    }


def controllers_queue_stats() -> dict[str, Any]:
    rows = []
    for row in list_credit(limit=40):
        if row.get("category") != "controllers":
            continue
        extra = row.get("extra") or {}
        if str(extra.get("log_id") or "").startswith("ctrl-stamp:"):
            rows.append(row)
    credits = [float(r.get("credit") or 0) for r in rows]
    return {
        "n": len(rows),
        "credit_avg": round(sum(credits) / len(credits), 2) if credits else 0.0,
        "populated": bool(rows),
        "source": "controller-stamps",
        "auto_fire": False,
    }


CONTROLLER_STAMP_FEATURES = ("vr.controllers.trigger", "vr.controllers", "vr.controls")


def ingest_controller_stamps(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Existing vr.controllers* incident stamps → controllers. Never invents headset events."""
    from backend.services import incident_intelligence_service as ii

    data = dict(data or {})
    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for feature in CONTROLLER_STAMP_FEATURES:
        try:
            event = ii.latest(feature)
        except Exception:
            event = None
        if event:
            items.append(event)
        try:
            broken = ii.latest(feature, status="broken")
        except Exception:
            broken = None
        if broken and str(broken.get("id") or "") != str((event or {}).get("id") or ""):
            items.append(broken)
    for event in items:
        origin = str(event.get("id") or "")[:80]
        feature = str(event.get("feature") or "vr.controllers.trigger")[:80]
        if not origin:
            skipped.append({"reason": "no-id", "invented": False})
            continue
        credit_log = f"ctrl-stamp:{origin}"[:80]
        if credit_log in seen or _ingested_today(credit_log):
            skipped.append({"id": origin, "reason": "already counted today", "invented": False})
            continue
        seen.add(credit_log)
        status = str(event.get("status") or "").lower()
        broken = [feature] if status in {"broken", "missing"} else []
        credit = 42.0 if broken else 70.0
        extras = ingest_live_outcome({
            "log_id": credit_log,
            "credit_category": "controllers",
            "feature": feature,
            "actor": "cursor",
            "agent_id": data.get("agent_id") or event.get("agent_id") or "cursor",
            "user_id": event.get("user_id") or data.get("user_id") or "sam-local",
            "project_id": event.get("project_id") or data.get("project_id") or "5bf8e783",
            "instance_id": data.get("instance_id") or LOCAL_AREA,
            "score": credit,
            "notes": f"ctrl-stamp {feature} {status} {origin}",
            "broken": broken,
            "source": event.get("source") or "controller-stamp",
        }, {"score": credit, "log_id": credit_log, "broken": broken, "features": {feature: status or "unknown"}})
        credited.append({
            "id": origin,
            "credit_log_id": credit_log,
            "feature": feature,
            "status": status,
            "category": "controllers",
            "credit": (extras.get("credit") or {}).get("credit"),
            "invented": False,
        })
    return {
        "ok": True,
        "n_credited": len(credited),
        "credited": credited,
        "skipped": skipped,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


def networking_queue_stats() -> dict[str, Any]:
    rows = []
    for row in list_credit(limit=40):
        if row.get("category") != "networking":
            continue
        extra = row.get("extra") or {}
        if str(extra.get("log_id") or "").startswith("net-stamp:"):
            rows.append(row)
    credits = [float(r.get("credit") or 0) for r in rows]
    return {
        "n": len(rows),
        "credit_avg": round(sum(credits) / len(credits), 2) if credits else 0.0,
        "populated": bool(rows),
        "source": "network-stamps",
        "auto_fire": False,
    }


NETWORKING_STAMP_FEATURES = ("network.latency", "network.lag", "network.rtt", "network.webrtc")


def ingest_networking_stamps(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Existing network.latency / fetch incident stamps → networking. Never invents events."""
    from backend.services import incident_intelligence_service as ii

    data = dict(data or {})
    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for feature in NETWORKING_STAMP_FEATURES:
        try:
            event = ii.latest(feature)
        except Exception:
            event = None
        if event:
            items.append(event)
        try:
            broken = ii.latest(feature, status="broken")
        except Exception:
            broken = None
        if broken and str(broken.get("id") or "") != str((event or {}).get("id") or ""):
            items.append(broken)
    for event in items:
        origin = str(event.get("id") or "")[:80]
        feature = str(event.get("feature") or "network.latency")[:80]
        if category_for_feature_id(feature) != "networking":
            skipped.append({"id": origin, "reason": "not-networking", "invented": False})
            continue
        if not origin:
            skipped.append({"reason": "no-id", "invented": False})
            continue
        credit_log = f"net-stamp:{origin}"[:80]
        if credit_log in seen or _ingested_today(credit_log):
            skipped.append({"id": origin, "reason": "already counted today", "invented": False})
            continue
        seen.add(credit_log)
        status = str(event.get("status") or "").lower()
        broken = [feature] if status in {"broken", "missing"} else []
        credit = 42.0 if broken else 70.0
        extras = ingest_live_outcome({
            "log_id": credit_log,
            "credit_category": "networking",
            "feature": feature,
            "actor": "cursor",
            "agent_id": data.get("agent_id") or event.get("agent_id") or "cursor",
            "user_id": event.get("user_id") or data.get("user_id") or "sam-local",
            "project_id": event.get("project_id") or data.get("project_id") or "ce8294df",
            "instance_id": data.get("instance_id") or LOCAL_AREA,
            "score": credit,
            "notes": f"net-stamp {feature} {status} {origin}",
            "broken": broken,
            "source": event.get("source") or "network-stamp",
        }, {"score": credit, "log_id": credit_log, "broken": broken, "features": {feature: status or "unknown"}})
        credited.append({
            "id": origin,
            "credit_log_id": credit_log,
            "feature": feature,
            "status": status,
            "category": "networking",
            "credit": (extras.get("credit") or {}).get("credit"),
            "invented": False,
        })
    return {
        "ok": True,
        "n_credited": len(credited),
        "credited": credited,
        "skipped": skipped,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


def shipped_hook_optimization_credit(note: str) -> float:
    blob = str(note or "").lower()
    tokens = ("leakfix", "modelsfix", "reloadpid", "revoke", "preview", "stamp", "restored", "miss")
    n = sum(1 for token in tokens if token in blob)
    return round(max(60.0, min(88.0, 58.0 + n * 6.0)), 2)


SHIPPED_HOOK_TOKEN_RE = re.compile(r"leakfix\d+|modelsfix\d+|leakobs\d+")


def shipped_hook_tokens(note: str) -> list[str]:
    """Named leakfix/modelsfix/leakobs tokens already in SHIPPED_THIN_HOOKS. Never invents."""
    return sorted(set(SHIPPED_HOOK_TOKEN_RE.findall(str(note or "").lower())))


def ingest_shipped_hook_optimization(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """SHIPPED_THIN_HOOKS → optimization. Skip kernel/none. No invented incidents. Not breakage=0."""
    data = dict(data or {})
    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for feature, note in SHIPPED_THIN_HOOKS.items():
        if _is_kernel_feature(feature) or not str(note or "").strip() or str(note).lower().startswith("none"):
            skipped.append({"feature": feature, "reason": "kernel-or-none", "invented": False})
            continue
        jobs = [(f"opt-hook:{feature}"[:80], note, "")]
        for token in shipped_hook_tokens(note):
            jobs.append((f"opt-hook:{feature}:{token}"[:80], token, token))
        for log_id, credit_note, token in jobs:
            if _ingested_today(log_id):
                skipped.append({"feature": feature, "token": token, "reason": "already counted today", "invented": False})
                continue
            credit = shipped_hook_optimization_credit(credit_note)
            extras = ingest_live_outcome({
                "log_id": log_id,
                "credit_category": "optimization",
                "feature": feature,
                "actor": "grok",
                "agent_id": data.get("agent_id") or "grok",
                "user_id": data.get("user_id") or "sam-local",
                "project_id": data.get("project_id") or "5bf8e783",
                "instance_id": data.get("instance_id") or LOCAL_AREA,
                "score": credit,
                "notes": f"shipped thin hook {feature}{(' ' + token) if token else ''}; not breakage=0",
            }, {
                "score": credit,
                "log_id": log_id,
            })
            credited.append({
                "feature": feature,
                "token": token,
                "credit_log_id": log_id,
                "credit": (extras.get("credit") or {}).get("credit"),
                "category": "optimization",
                "invented": False,
                "breakage_zero": False,
            })
    return {
        "ok": True,
        "n_credited": len(credited),
        "credited": credited,
        "skipped": skipped,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


HTTP_CLASS_CREDIT = {
    "fetch_drop": 52.0,
    "timeout": 50.0,
    "http_401": 62.0,
    "http_404": 48.0,
}
HTTP_401_RE = re.compile(r"\b401\b|unauthorized|unauth", re.I)
HTTP_404_RE = re.compile(r"\b404\b|not found", re.I)
HTTP_TIMEOUT_RE = re.compile(r"timeout|timed out|etimedout|deadline exceeded", re.I)


def classify_http_failure(blob: Any) -> str:
    """Map a real fetch/HTTP note to a class. Empty if unclassified. Never invents."""
    text = " ".join(str(blob or "").split())
    if not text:
        return ""
    if HTTP_401_RE.search(text):
        return "http_401"
    if HTTP_404_RE.search(text):
        return "http_404"
    if HTTP_TIMEOUT_RE.search(text):
        return "timeout"
    if CONNECTION_DROP_RE.search(text) or re.search(r"fetch failed", text, re.I):
        return "fetch_drop"
    return ""


def _http_class_blob(item: dict[str, Any] | None = None) -> str:
    item = item or {}
    extra = item.get("extra") or item.get("fields") or {}
    if not isinstance(extra, dict):
        extra = {}
    fields = extra.get("fields") if isinstance(extra.get("fields"), dict) else extra
    return " ".join(str(part or "") for part in (
        item.get("note"), item.get("cause_hint"), extra.get("note"), extra.get("cause_hint"),
        extra.get("message"), fields.get("message"), fields.get("name"), fields.get("path"),
        item.get("status"),
    ))


def ingest_http_network_troubleshooting(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Real incident/job fetch-HTTP classes → network_troubleshooting. Never invents events."""
    from backend.services import incident_intelligence_service as ii

    data = dict(data or {})
    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for feature in ("network.latency", "network.timeout", "network.dns", "network.throttle", "api.health"):
        try:
            event = ii.latest(feature)
        except Exception:
            event = None
        if event:
            items.append({**event, "source_kind": "incident"})
        try:
            broken = ii.latest(feature, status="broken")
        except TypeError:
            broken = None
        except Exception:
            broken = None
        if broken and str(broken.get("id") or "") != str((event or {}).get("id") or ""):
            items.append({**broken, "source_kind": "incident"})
    for job in list_debug_jobs(40, status="claimed") + list_debug_jobs(40, status="pending_sam"):
        feat = str(job.get("feature_id") or job.get("feature") or "")
        if feat.startswith("network.") or feat.startswith("api."):
            items.append({**job, "source_kind": "job", "note": _connection_drop_blob(job)})
    for item in items:
        klass = classify_http_failure(_http_class_blob(item) + " " + str(item.get("note") or ""))
        origin = str(
            item.get("first_broken_id") if item.get("source_kind") == "job" else item.get("id")
            or item.get("first_broken_id")
            or item.get("id")
            or ""
        )[:80]
        if not klass:
            skipped.append({"id": origin, "reason": "unclassified", "invented": False})
            continue
        if not origin:
            skipped.append({"reason": "no-id", "invented": False})
            continue
        credit_log = f"http-class:{origin}"[:80]
        if credit_log in seen or _ingested_today(credit_log):
            skipped.append({"id": origin, "reason": "already counted today", "http_class": klass, "invented": False})
            continue
        seen.add(credit_log)
        credit = HTTP_CLASS_CREDIT[klass]
        extras = ingest_live_outcome({
            "log_id": credit_log,
            "credit_category": "network_troubleshooting",
            "feature": str(item.get("feature") or item.get("feature_id") or "network.latency")[:80],
            "actor": "cursor",
            "agent_id": data.get("agent_id") or item.get("agent_id") or "cursor",
            "user_id": item.get("user_id") or data.get("user_id") or "sam-local",
            "project_id": item.get("project_id") or data.get("project_id") or "5bf8e783",
            "instance_id": item.get("instance_id") or data.get("instance_id") or LOCAL_AREA,
            "score": credit,
            "notes": f"http-class {klass} {origin}",
        }, {
            "score": credit,
            "log_id": credit_log,
            "http_class": klass,
        })
        credited.append({
            "id": origin,
            "credit_log_id": credit_log,
            "http_class": klass,
            "category": "network_troubleshooting",
            "credit": (extras.get("credit") or {}).get("credit"),
            "invented": False,
        })
    return {
        "ok": True,
        "n_credited": len(credited),
        "credited": credited,
        "skipped": skipped,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


def _parse_job_clock(raw: Any) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def job_clock_credit(duration_s: float) -> float:
    """Hours/minutes inverse credit. 15m≈87, 1h≈85, 6h≈70, 24h≈16. Not the prompt-trace seconds curve."""
    hours = max(0.0, float(duration_s) / 3600.0)
    return round(max(15.0, min(90.0, 88.0 - hours * 3.0)), 2)


def ingest_job_clock_time_to_complete(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Verified job clocks → time_to_complete. Sam-wait (candidate_confirm, no verify) is not a penalty. No invented clocks."""
    data = dict(data or {})
    credited: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    jobs = list_debug_jobs(40, status="claimed") + list_debug_jobs(40, status="pending_sam")
    seen: set[str] = set()
    for job in jobs:
        job_id = str(job.get("id") or "")[:80]
        if not job_id or job_id in seen:
            continue
        seen.add(job_id)
        extra = dict(job.get("extra") or {})
        feature = str(job.get("feature_id") or job.get("feature") or "")[:80]
        credit_log = f"job-clock:{job_id}"[:80]
        if extra.get("sam_confirmed") or job.get("status") == "sam_confirmed":
            skipped.append({"id": job_id, "reason": "sam-confirmed", "invented": False})
            continue
        if _is_kernel_feature(feature, extra):
            skipped.append({"id": job_id, "reason": "kernel", "invented": False})
            continue
        if extra.get("candidate_confirm") and not extra.get("test_verified"):
            skipped.append({"id": job_id, "reason": "sam-gate", "invented": False, "penalty": False})
            continue
        if not extra.get("test_verified"):
            skipped.append({"id": job_id, "reason": "not-verified", "invented": False})
            continue
        start = _parse_job_clock(extra.get("claimed_at") or job.get("ts"))
        end = _parse_job_clock(extra.get("test_verified_at"))
        if not start or not end:
            skipped.append({"id": job_id, "reason": "missing-clock", "invented": False})
            continue
        duration_s = (end - start).total_seconds()
        if duration_s <= 0:
            skipped.append({"id": job_id, "reason": "non-positive-clock", "invented": False})
            continue
        if _ingested_today(credit_log):
            skipped.append({"id": job_id, "reason": "already counted today", "invented": False})
            continue
        agent_id = str(extra.get("claimed_by") or job.get("agent_id") or "grok")[:40]
        credit = job_clock_credit(duration_s)
        extras = ingest_live_outcome({
            "log_id": credit_log,
            "credit_category": "time_to_complete",
            "duration_s": duration_s,
            "actor": agent_id,
            "agent_id": agent_id,
            "user_id": job.get("user_id") or data.get("user_id") or "sam-local",
            "project_id": job.get("project_id") or data.get("project_id") or "5bf8e783",
            "instance_id": job.get("instance_id") or data.get("instance_id") or LOCAL_AREA,
            "score": credit,
            "notes": f"job-clock {job_id} {round(duration_s / 60.0, 1)}m claim→verified",
        }, {
            "score": credit,
            "duration_s": duration_s,
            "log_id": credit_log,
        })
        credited.append({
            "id": job_id,
            "credit_log_id": credit_log,
            "feature": feature,
            "agent_id": agent_id,
            "duration_s": duration_s,
            "credit": (extras.get("credit") or {}).get("credit"),
            "category": "time_to_complete",
            "invented": False,
        })
    return {
        "ok": True,
        "n_credited": len(credited),
        "credited": credited,
        "skipped": skipped,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


def _with_incident_stamp(out: dict[str, Any]) -> dict[str, Any]:
    try:
        out["incident_stamp"] = stamp_incident_for_debug_job(out)
    except Exception as exc:
        out["incident_stamp"] = {"ok": False, "skipped": True, "reason": str(exc)[:160], "executed": False}
    return out


def debug_job_cursor_packet(job: dict[str, Any]) -> str:
    return "\n".join([
        "CURSOR_FIX",
        f"job_id: {job.get('id') or ''}",
        f"feature: {job.get('feature_id') or ''}",
        f"category: {job.get('category') or ''}",
        f"tracking_id: {job.get('tracking_id') or ''}",
        f"last_working: {job.get('last_working_id') or 'none'}",
        f"first_broken: {job.get('first_broken_id') or 'none'}",
        f"log_path: {job.get('log_path') or ''}",
        f"agent: {job.get('agent_id') or ''}",
        f"status: {job.get('status') or ''}",
        "executed: false",
        "auto_fire: false",
    ])


def replace_approach_guard(job: dict[str, Any] | None = None) -> bool:
    """Kernel / replace-approach jobs are not code-patch claims."""
    job = dict(job or {})
    extra = job.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    feature = str(job.get("feature_id") or job.get("feature") or "")
    rec = _normalize_cad_rec(job.get("recommendation") or suggest_cad_next({
        "feature_id": feature,
        "extra": extra,
        "category": job.get("category"),
        "agent_id": job.get("agent_id"),
    }))
    return rec == "replace-approach" or _is_kernel_feature(feature, extra)


def replacement_brief(job: dict[str, Any] | None = None) -> dict[str, Any]:
    """What to replace, why 7 tries failed, fire vs replace vs fix. Never a kernel patch."""
    job = dict(job or {})
    extra = job.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    feature = str(job.get("feature_id") or job.get("feature") or "")
    playbook = _playbook_path_for_job(str(job.get("id") or "")) or "ai-context/debugger/PLAYBOOK-job_f0319f9ce6-prompt-run.md"
    return {
        "guard": "replace_approach_guard",
        "patch_claim": False,
        "recommendation": "replace-approach",
        "feature": feature,
        "job_id": job.get("id") or "",
        "replace": "Different authoring path that emits gen_step() or a cadgen @step model. Do not patch kernel, gen_step, or CAD 2.0 retries.",
        "why_7_tries_failed": "text-to-cad 2.0 failed after 7 attempts: AI response did not contain gen_step() or a cadgen @step model.",
        "fire": "league avg below 40 with repeated real fails — report only, never auto-fire",
        "replace_approach": "kernel prompt.run / cad.gen_step / cad.generate",
        "fix_few_issues": "thin JS/API hooks only — not this job",
        "playbook": playbook,
        "executed": False,
        "auto_fire": False,
        "goal": "OPEN",
        "breakage_zero": False,
    }


def debug_job_replace_packet(job: dict[str, Any]) -> str:
    brief = replacement_brief(job)
    return "\n".join([
        "REPLACE_APPROACH",
        "guard: replace_approach_guard",
        "patch_claim: false",
        f"job_id: {job.get('id') or ''}",
        f"feature: {brief.get('feature') or ''}",
        f"replace: {brief.get('replace') or ''}",
        f"why_7_tries_failed: {brief.get('why_7_tries_failed') or ''}",
        f"fire: {brief.get('fire') or ''}",
        f"replace_approach: {brief.get('replace_approach') or ''}",
        f"fix_few_issues: {brief.get('fix_few_issues') or ''}",
        f"playbook: {brief.get('playbook') or ''}",
        "executed: false",
        "auto_fire: false",
        "breakage_zero: false",
    ])


CONNECTION_DROP_RE = re.compile(
    r"failed to fetch|typeerror|load failed|networkerror|err_connection|connection (lost|drop|refused)|cannot reach server|chrome-error",
    re.I,
)


def _connection_drop_blob(job: dict[str, Any]) -> str:
    extra = job.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    fields = extra.get("fields") or {}
    if not isinstance(fields, dict):
        fields = {}
    parts = [
        job.get("note"), job.get("cause_hint"), extra.get("cause_hint"), extra.get("note"),
        extra.get("message"), fields.get("message"), fields.get("name"), fields.get("path"),
    ]
    first_id = str(job.get("first_broken_id") or job.get("log_id") or "")
    feature = str(job.get("feature_id") or job.get("feature") or "")
    try:
        from backend.services import incident_intelligence_service as ii
        event = ii.get_event(first_id) if first_id else None
        event = event or (ii.latest(feature) if feature.startswith("network.") else None)
        if event:
            ev_fields = event.get("fields") or {}
            parts.extend([event.get("note"), ev_fields.get("message"), ev_fields.get("name"), ev_fields.get("path")])
    except Exception:
        pass
    return " ".join(str(part or "") for part in parts)


def connection_drop_guard(job: dict[str, Any] | None = None) -> bool:
    """Failed-to-fetch / connection-drop jobs are not code-patch claims."""
    job = dict(job or {})
    extra = job.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    feature = str(job.get("feature_id") or job.get("feature") or "").strip().lower()
    rec = str(job.get("recommendation") or extra.get("recommendation") or "").strip().lower()
    if rec in {"pending_reload", "reload", "pending-reload"}:
        return True
    if _is_kernel_feature(feature, extra):
        return False
    if feature != "network.latency" and not feature.startswith("network."):
        return False
    return bool(CONNECTION_DROP_RE.search(_connection_drop_blob({**job, "extra": extra})))


def pending_reload_brief(job: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sam tab reload — not a CURSOR_FIX. Do not kickstart render3d."""
    job = dict(job or {})
    extra = job.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    feature = str(job.get("feature_id") or job.get("feature") or "")
    playbook = _playbook_path_for_job(str(job.get("id") or "")) or "ai-context/debugger/PLAYBOOK-job_8b8791fe58-network.md"
    return {
        "guard": "pending_reload_guard",
        "patch_claim": False,
        "recommendation": "pending_reload",
        "feature": feature,
        "job_id": job.get("id") or "",
        "reload": "Reload the Studio tab. Do not kickstart render3d.service / com.render3d.app. Do not patch fetch.",
        "why": "TypeError Failed to fetch is a connection drop; GET /generation route is live (401 unauth / health 200).",
        "fire": "league avg below 40 with repeated real fails — report only, never auto-fire",
        "pending_reload": "connection-drop network.latency — Sam tab reload",
        "fix_few_issues": "thin JS/API hooks only — not this job",
        "playbook": playbook,
        "executed": False,
        "auto_fire": False,
        "goal": "OPEN",
        "breakage_zero": False,
    }


def debug_job_reload_packet(job: dict[str, Any]) -> str:
    brief = pending_reload_brief(job)
    return "\n".join([
        "PENDING_RELOAD",
        "guard: pending_reload_guard",
        "patch_claim: false",
        f"job_id: {job.get('id') or ''}",
        f"feature: {brief.get('feature') or ''}",
        f"reload: {brief.get('reload') or ''}",
        f"why: {brief.get('why') or ''}",
        f"playbook: {brief.get('playbook') or ''}",
        "executed: false",
        "auto_fire: false",
        "breakage_zero: false",
    ])


def patch_claim_blocked(job: dict[str, Any] | None = None) -> str:
    """Why this job is not a CURSOR_FIX, or empty if it may be claimed as a patch."""
    if replace_approach_guard(job):
        return "replace_approach_guard"
    if connection_drop_guard(job):
        return "pending_reload_guard"
    return ""


def debug_job_handoff_packet(job: dict[str, Any]) -> str:
    reason = patch_claim_blocked(job)
    if reason == "replace_approach_guard":
        return debug_job_replace_packet(job)
    if reason == "pending_reload_guard":
        return debug_job_reload_packet(job)
    return debug_job_cursor_packet(job)


def _apply_claim_handoff(out: dict[str, Any]) -> dict[str, Any]:
    reason = patch_claim_blocked(out)
    out["patch_claim"] = not reason
    out["cursor_packet"] = debug_job_handoff_packet(out)
    if reason == "replace_approach_guard":
        out["replacement_brief"] = replacement_brief(out)
        out.setdefault("reason", reason)
    elif reason == "pending_reload_guard":
        out["reload_brief"] = pending_reload_brief(out)
        out.setdefault("reason", reason)
    out["executed"] = False
    out["auto_fire"] = False
    return out


def get_debug_job(job_id: str) -> dict[str, Any]:
    jid = str(job_id or "").strip()
    if not jid:
        raise ValueError("job_id required")
    with _conn() as conn:
        row = conn.execute("SELECT * FROM debug_jobs WHERE id = ?", (jid,)).fetchone()
    if not row:
        raise ValueError("job not found")
    return _decorate_debug_job(dict(row))


def confirm_candidate(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sam super-admin: candidate_confirm → sam_confirmed. Never executed. Never breakage=0."""
    data = dict(data or {})
    job = get_debug_job(str(data.get("job_id") or data.get("id") or ""))
    extra = dict(job.get("extra") or {})
    if extra.get("sam_confirmed") or job.get("status") == "sam_confirmed":
        out = get_debug_job(job["id"])
        out.update({
            "ok": True, "sam_confirmed": True, "executed": False,
            "breakage_zero": False, "auto_fire": False, "goal": "OPEN",
        })
        return out
    if not (extra.get("candidate_confirm") or job.get("candidate_confirm")):
        raise ValueError("job is not candidate_confirm")
    extra["candidate_confirm"] = False
    extra["sam_confirmed"] = True
    extra["sam_confirmed_at"] = das.now()
    extra["executed"] = False
    extra["confirm_fixed"] = False
    extra["breakage_zero"] = False
    extra.pop("breakage", None)
    with _conn() as conn:
        conn.execute(
            "UPDATE debug_jobs SET status = 'sam_confirmed', extra_json = ? WHERE id = ?",
            (das._json(extra), job["id"]),
        )
    ingest = _ingest_sam_confirm_credit(job)
    if ingest.get("credit"):
        extra["sam_confirm_credited"] = True
        extra["sam_confirm_credit_id"] = (ingest.get("credit") or {}).get("id") or ""
        with _conn() as conn:
            conn.execute("UPDATE debug_jobs SET extra_json = ? WHERE id = ?", (das._json(extra), job["id"]))
    out = get_debug_job(job["id"])
    out.update({
        "ok": True, "sam_confirmed": True, "executed": False,
        "breakage_zero": False, "auto_fire": False, "goal": "OPEN",
        "credit": ingest.get("credit"),
        "credit_category": ingest.get("credit_category") or job.get("category"),
        "credited_agent": ingest.get("agent_id") or job.get("agent_id"),
    })
    return out


def _ingest_sam_confirm_credit(job: dict[str, Any]) -> dict[str, Any]:
    """Daily/category credit for the claiming agent. Does not mean the bug is gone."""
    extra = dict(job.get("extra") or {})
    agent_id = str(extra.get("claimed_by") or job.get("agent_id") or "grok")[:40]
    feature = str(job.get("feature_id") or job.get("feature") or "")[:80]
    category = str(job.get("category") or infer_category({"feature": feature}))
    log_id = f"sam-confirm:{job.get('id')}"
    if extra.get("sam_confirm_credited") or _ingested_today(log_id):
        return {"skipped": True, "reason": "already credited", "agent_id": agent_id, "credit_category": category}
    return ingest_live_outcome({
        "log_id": log_id,
        "feature": feature,
        "category": category,
        "credit_category": category,
        "agent_id": agent_id,
        "actor": agent_id,
        "user_id": job.get("user_id") or "sam-local",
        "project_id": job.get("project_id") or "5bf8e783",
        "instance_id": job.get("instance_id") or LOCAL_AREA,
        "score": 55,
        "notes": "sam_confirmed candidate; not breakage=0",
        "broken": [],
    }, {"score": 55, "broken": [], "features": {feature: "unknown"}})


def reject_candidate(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sam: not fixed. Back to claimed / fix-few-issues. Still not executed."""
    data = dict(data or {})
    job = get_debug_job(str(data.get("job_id") or data.get("id") or ""))
    extra = dict(job.get("extra") or {})
    if not (extra.get("candidate_confirm") or job.get("candidate_confirm") or extra.get("sam_confirmed")):
        raise ValueError("job is not candidate_confirm")
    extra["candidate_confirm"] = False
    extra["sam_confirmed"] = False
    extra["sam_rejected"] = True
    extra["sam_rejected_at"] = das.now()
    extra["executed"] = False
    extra["confirm_fixed"] = False
    extra["breakage_zero"] = False
    extra.pop("breakage", None)
    with _conn() as conn:
        conn.execute(
            "UPDATE debug_jobs SET status = 'claimed', recommendation = 'fix-few-issues', extra_json = ? WHERE id = ?",
            (das._json(extra), job["id"]),
        )
    out = get_debug_job(job["id"])
    out.update({
        "ok": True, "sam_confirmed": False, "rejected": True, "executed": False,
        "breakage_zero": False, "auto_fire": False, "goal": "OPEN",
        "credit": None,
        "credited": False,
    })
    return out


def list_debug_jobs(limit: int = 20, *, status: str = "") -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 20), 40))
    with _conn() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM debug_jobs WHERE status = ? ORDER BY ts DESC LIMIT ?",
                (status, limit),
            )
        else:
            rows = conn.execute("SELECT * FROM debug_jobs ORDER BY ts DESC LIMIT ?", (limit,))
        out = [dict(r) for r in rows]
    return [_decorate_debug_job(row) for row in out]


def list_handoff_jobs(limit: int = 12) -> list[dict[str, Any]]:
    claimed = list_debug_jobs(limit, status="claimed")
    pending = list_debug_jobs(limit, status="pending_sam")
    return (claimed + pending)[: max(1, min(int(limit or 12), 24))]


def claim_debug_job(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Next pending_sam job → claimed by an agent. Never executed=true."""
    data = dict(data or {})
    agent_id = re.sub(r"[^A-Za-z0-9._-]", "", str(data.get("agent_id") or data.get("agent") or "grok"))[:40] or "grok"
    job_id = str(data.get("job_id") or data.get("id") or "").strip()
    with _conn() as conn:
        if not job_id:
            mine = conn.execute(
                "SELECT * FROM debug_jobs WHERE status = 'claimed' AND agent_id = ? ORDER BY ts DESC LIMIT 1",
                (agent_id,),
            ).fetchone()
            if mine:
                out = _decorate_debug_job(dict(mine))
                out["claimed"] = True
                out["idempotent"] = True
                return _with_incident_stamp(_apply_claim_handoff(out))
            pending = [dict(r) for r in conn.execute(
                "SELECT * FROM debug_jobs WHERE status = 'pending_sam' ORDER BY ts ASC"
            ).fetchall()]
            row = None
            guarded_row = None
            for item in pending:
                decorated = _decorate_debug_job(item)
                if patch_claim_blocked(decorated):
                    if guarded_row is None:
                        guarded_row = decorated
                    continue
                row = item
                job_id = row["id"]
                break
            if not row:
                if guarded_row:
                    out = dict(guarded_row)
                    out["ok"] = False
                    out["claimed"] = False
                    out["skipped"] = True
                    out["reason"] = patch_claim_blocked(out) or "replace_approach_guard"
                    return _apply_claim_handoff(out)
                return {
                    "ok": False,
                    "reason": "no pending_sam jobs",
                    "claimed": False,
                    "executed": False,
                    "auto_fire": False,
                }
        else:
            found = conn.execute("SELECT * FROM debug_jobs WHERE id = ?", (job_id,)).fetchone()
            if not found:
                raise ValueError("job not found")
            row = dict(found)
            if row["status"] == "claimed" and str(row.get("agent_id") or "") == agent_id:
                out = _decorate_debug_job(row)
                out["claimed"] = True
                out["idempotent"] = True
                return _with_incident_stamp(_apply_claim_handoff(out))
            if row["status"] == "claimed":
                out = _decorate_debug_job(row)
                out["skipped"] = True
                out["reason"] = "already claimed"
                out["claimed"] = True
                return _apply_claim_handoff(out)
            if row["status"] != "pending_sam":
                out = _decorate_debug_job(row)
                out["skipped"] = True
                out["reason"] = f"status {row['status']}"
                out["executed"] = False
                return _apply_claim_handoff(out)
            decorated = _decorate_debug_job(row)
            blocked = patch_claim_blocked(decorated)
            if blocked:
                out = decorated
                out["ok"] = True
                out["claimed"] = False
                out["skipped"] = True
                out["reason"] = blocked
                return _apply_claim_handoff(out)
        extra = json.loads(row.get("extra_json") or "{}")
        extra["claimed_by"] = agent_id
        extra["claimed_at"] = das.now()
        extra["executed"] = False
        conn.execute(
            "UPDATE debug_jobs SET status = 'claimed', agent_id = ?, extra_json = ? WHERE id = ? AND status = 'pending_sam'",
            (agent_id, das._json(extra), job_id),
        )
        fresh = conn.execute("SELECT * FROM debug_jobs WHERE id = ?", (job_id,)).fetchone()
        if not fresh:
            raise ValueError("job not found")
        row = dict(fresh)
    out = _decorate_debug_job(row)
    out["claimed"] = True
    out["idempotent"] = False
    out["ok"] = True
    return _with_incident_stamp(_apply_claim_handoff(out))


def mint_debug_job(alert: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Insert one pending_sam debug job. Never executes a code fix."""
    data = dict(data or {})
    feature = str(alert.get("feature") or data.get("feature") or "")[:80]
    if not feature:
        raise ValueError("feature_id required")
    day = _job_day()
    with _conn() as conn:
        existing = conn.execute(
            "SELECT * FROM debug_jobs WHERE feature_id = ? AND day = ?",
            (feature, day),
        ).fetchone()
        if existing:
            row = dict(existing)
            row["extra"] = json.loads(row.pop("extra_json") or "{}")
            row["skipped"] = True
            row["reason"] = "already queued today"
            row["auto_fire"] = False
            row["executed"] = False
            return row
    first = alert.get("first_failure") or {}
    last = alert.get("last_working") or {}
    category = infer_category({"broken": [feature], "feature": feature}, {"broken": [feature]})
    instance_id = str(data.get("instance_id") or LOCAL_AREA)[:8]
    user_id = str(alert.get("user_id") or data.get("user_id") or "sam-local")[:80]
    project_id = str(alert.get("project_id") or data.get("project_id") or "5bf8e783")[:80]
    log_id = str(alert.get("log_id") or first.get("id") or "")[:80]
    agent_id = suggest_debug_agent(category)
    packed = encode_tracking_capped([
        {"kind": "instance", "id": instance_id},
        {"kind": "user", "id": user_id},
        {"kind": "project", "id": project_id},
        {"kind": "log", "id": (log_id or feature.replace(".", "-"))[:80]},
        {"kind": "agent", "id": agent_id},
    ])
    last_id = str((last or {}).get("id") or "")[:80]
    first_id = str((first or {}).get("id") or log_id)[:80]
    log_path = str(alert.get("log_path") or first.get("log_path") or "")[:240]
    row = {
        "id": "job_" + uuid.uuid4().hex[:10],
        "ts": das.now(),
        "day": day,
        "feature_id": feature,
        "category": category,
        "instance_id": instance_id,
        "user_id": user_id,
        "project_id": project_id,
        "log_id": log_id,
        "agent_id": agent_id,
        "last_working_id": last_id,
        "first_broken_id": first_id,
        "log_path": log_path,
        "tracking_id": packed.get("tracking_id"),
        "status": "pending_sam",
        "recommendation": suggest_cad_next({
            "feature_id": feature,
            "category": category,
            "agent_id": agent_id,
            "note": alert.get("note") or alert.get("cause_hint") or "",
            "cause_hint": alert.get("cause_hint") or alert.get("note") or "",
            "extra": {
                "kernel": feature in KERNEL_FEATURES or feature.startswith("prompt."),
                "cause_hint": alert.get("cause_hint") or alert.get("note") or "",
                "note": alert.get("note") or "",
            },
        }),
        "note": das._excerpt(
            f"minted from {feature}; last_working={last_id or 'none'}; first_broken={first_id or 'none'}; never auto-execute",
            200,
        ),
        "extra": {
            "cause_hint": alert.get("cause_hint") or alert.get("note") or "",
            "packed": packed.get("packed"),
            "license": "dashboard-metric",
            "kernel": feature in KERNEL_FEATURES or feature.startswith("prompt."),
            "source": alert.get("source") or "incident",
        },
        "auto_fire": False,
        "executed": False,
        "skipped": False,
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO debug_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                row["id"], row["ts"], row["day"], feature, category, instance_id, user_id,
                project_id, log_id, agent_id, last_id, first_id, log_path, row["tracking_id"],
                row["status"], row["recommendation"], row["note"], das._json(row["extra"]),
            ),
        )
    return _with_incident_stamp(row)


def search_standing_debug_targets() -> dict[str, Any]:
    """Cheap index hunt for standing Studio targets. Excerpts ≤120. No LLM."""
    from backend.services import incident_intelligence_service as ii

    findings: list[dict[str, Any]] = []
    for spec in STANDING_DEBUG_TARGETS:
        feature = spec["feature"]
        first: dict[str, Any] | None = None
        last: dict[str, Any] | None = None
        hits_out: list[dict[str, Any]] = []
        for needle in spec["needles"]:
            try:
                page = ii.search_chat_logs(needle, limit=8)
            except ValueError:
                continue
            for hit in page.get("hits") or []:
                row = {
                    "log_id": hit.get("log_id"),
                    "result": hit.get("result") or "",
                    "blamed_log_id": hit.get("blamed_log_id") or "",
                    "excerpt": das._excerpt(hit.get("excerpt") or hit.get("prompt") or "", 120),
                }
                hits_out.append(row)
                blob = str(hit.get("excerpt") or hit.get("prompt") or "").lower()
                res = str(hit.get("result") or "").lower()
                looks_broken = res == "broke" or any(
                    token in blob
                    for token in (
                        "still", "urgent", "missing", "don't work", "doesnt work",
                        "could not", "error creating", "unavailable",
                    )
                )
                if looks_broken and not first:
                    first = row
                    if row.get("blamed_log_id"):
                        last = {"log_id": row["blamed_log_id"], "excerpt": "", "result": ""}
        latest = ii.latest(feature)
        findings.append({
            "feature": feature,
            "first_broken": first,
            "last_working": last,
            "latest_status": (latest or {}).get("status") or "",
            "hits": hits_out[:6],
            "kernel": _is_kernel_feature(feature),
        })
    return {
        "ok": True,
        "findings": findings,
        "excerpt_cap": 120,
        "auto_fire": False,
        "executed": False,
        "goal": "OPEN",
    }


def standing_debug_alerts() -> list[dict[str, Any]]:
    """Alerts for mint_debug_job. Skip kernel and features whose latest stamp is ok."""
    alerts: list[dict[str, Any]] = []
    for row in search_standing_debug_targets().get("findings") or []:
        first = row.get("first_broken") or {}
        if not first.get("log_id") or row.get("kernel"):
            continue
        if str(row.get("latest_status") or "").lower() == "ok":
            continue
        last = row.get("last_working") or {}
        alerts.append({
            "feature": row["feature"],
            "status": "broken",
            "log_id": first["log_id"],
            "last_working": {"id": last.get("log_id") or ""},
            "first_failure": {"id": first["log_id"], "log_path": "cursor-transcript-index"},
            "cause_hint": das._excerpt(first.get("excerpt"), 120),
            "source": "transcript-index",
            "project_id": "5bf8e783",
            "user_id": "sam-local",
        })
    return alerts


def swarm_debug_tick(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Mint pending_sam debug jobs from incidents + prompt-trace jsonl. Never auto-applies a fix."""
    data = dict(data or {})
    minted: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    cap = int(data.get("job_cap") or data.get("limit") or DEBUG_JOB_TICK_CAP)
    cap = max(1, min(cap, 12))
    seen: set[str] = set()
    alerts = list(open_incident_alerts()) + list(open_prompt_trace_alerts()) + list(standing_debug_alerts())
    for alert in alerts:
        feature = str(alert.get("feature") or "")[:80]
        if not feature or feature in seen:
            continue
        seen.add(feature)
        if len(minted) >= cap:
            skipped.append({"feature_id": feature, "reason": "tick cap"})
            continue
        job = mint_debug_job(alert, data)
        if job.get("skipped"):
            skipped.append({"id": job.get("id"), "feature_id": job.get("feature_id"), "reason": job.get("reason")})
            continue
        minted.append({
            "id": job["id"],
            "feature_id": job["feature_id"],
            "category": job["category"],
            "agent_id": job["agent_id"],
            "tracking_id": job["tracking_id"],
            "status": job["status"],
            "kernel": bool((job.get("extra") or {}).get("kernel")),
            "executed": False,
        })
    return {
        "ok": True,
        "minted": minted,
        "skipped": skipped,
        "n_minted": len(minted),
        "n_skipped": len(skipped),
        "jobs": list_debug_jobs(12, status="pending_sam"),
        "auto_fire": False,
        "executed": False,
        "license": "pending_sam",
        "cap": cap,
    }


def ingest_live_outcome(data: dict[str, Any], score_row: dict[str, Any] | None = None) -> dict[str, Any]:
    """Roll a real prompt-trace / incident outcome into period credit. Never a write license."""
    extras = note_from_score(score_row or {}, data)
    extras["rollups"] = rollup_all_periods()
    extras["auto_fire"] = False
    extras["license"] = "dashboard-metric"
    extras["periods"] = list(CREDIT_PERIODS)
    return extras


def ingest_from_compare(comparison: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    """One credit bump per feature per day when incident compare lands."""
    data = dict(data or {})
    feature = str(comparison.get("feature") or data.get("feature") or "")[:80]
    log_id = str(data.get("log_id") or f"cmp:{feature}")[:80]
    if not (data.get("user_id") or data.get("debug_user_id") or data.get("uid") or data.get("ingest")):
        return {
            "skipped": True,
            "reason": "compare GET stays read-only; checklist/confirm-fixed ingest",
            "feature": feature,
            "credit_category": infer_category({"feature": feature}, {"broken": [feature] if comparison.get("first_failure") else []}),
            "auto_fire": False,
        }
    if _ingested_today(log_id):
        return {"skipped": True, "reason": "already counted today", "log_id": log_id, "auto_fire": False}
    broken = [feature] if comparison.get("first_failure") else []
    score = 25 if broken else 65
    return ingest_live_outcome({
        **data,
        "log_id": log_id,
        "feature": feature,
        "broken": broken,
        "agent_id": data.get("agent_id") or "cursor",
        "instance_id": data.get("instance_id") or LOCAL_AREA,
        "score": score,
        "notes": f"incident compare {feature}",
    }, {"score": score, "broken": broken, "features": {feature: "broken" if broken else "ok"}})


def report_agent(data: dict[str, Any]) -> dict[str, Any]:
    agent_id = re.sub(r"[^A-Za-z0-9._-]", "", str(data.get("agent_id") or ""))[:40]
    if not agent_id:
        raise ValueError("agent_id required")
    rec = _normalize_cad_rec(data.get("recommendation") or "fix-few-issues")
    if rec not in CAD_NEXT:
        raise ValueError("recommendation must be fire, replace-approach, or fix-few-issues")
    row = {
        "id": "rpt_" + uuid.uuid4().hex[:10],
        "ts": das.now(),
        "agent_id": agent_id,
        "recommendation": rec,
        "credit_score": float(data.get("credit_score") or data.get("credit") or 0),
        "note": das._excerpt(data.get("note") or "report to Sam — never auto-fire", 200),
        "status": "pending_sam",
        "auto_fire": False,
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO agent_reports VALUES (?,?,?,?,?,?,?)",
            (row["id"], row["ts"], agent_id, rec, row["credit_score"], row["note"], row["status"]),
        )
    return row


def list_reports(limit: int = 12) -> list[dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM agent_reports ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 30)),))]


def decide_report(report_id: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Sam picks fire / replace / fix. Status stays pending_sam unless noted. Never executes."""
    rid = str(report_id or "").strip()
    if not rid:
        raise ValueError("report id required")
    data = data or {}
    action = str(data.get("recommendation") or data.get("action") or "").strip().lower()
    with _conn() as conn:
        row = conn.execute("SELECT * FROM agent_reports WHERE id = ?", (rid,)).fetchone()
        if not row:
            raise ValueError("report not found")
        if action in {"fire", "replace", "replace-approach", "fix-few-issues"}:
            stored = _normalize_cad_rec(action)
            conn.execute("UPDATE agent_reports SET recommendation = ? WHERE id = ?", (stored, rid))
            status = "pending_sam"
        elif action in {"noted", "ack"}:
            conn.execute("UPDATE agent_reports SET status = 'sam_noted' WHERE id = ?", (rid,))
            status = "sam_noted"
        else:
            raise ValueError("recommendation must be fire, replace-approach, fix-few-issues, or noted")
        fresh = dict(conn.execute("SELECT * FROM agent_reports WHERE id = ?", (rid,)).fetchone())
    fresh["auto_fire"] = False
    fresh["executed"] = False
    fresh["status"] = status
    return fresh


def list_reviews(limit: int = 12) -> list[dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM catalog_reviews ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 30)),))]


def catalog() -> dict[str, Any]:
    return {
        "read_once": True,
        "skills": [{"name": n, "path": p, "mints": m} for n, p, m in CATALOG_SKILLS],
        "ids": {
            "log_id": "{chat8}-{n} e.g. d9c98119-004",
            "chat_id": "Cursor transcript stem (uuid)",
            "tracking_id": "kind:id+kind:id  cap 160 then ref:{id}",
            "ref_*": "pointer JSON of members",
            "res_*": "token/time swing result ref",
            "bug_*": "gated confirmed fix",
            "fork_*": "Sam override",
            "individual_id": "PERF-07-00012 or 4.07.0012",
            "instance_suffix": "project.instance8",
            "project": "project:hex",
            "agent_id": "grok | cursor | harness | render-agent",
            "area_id": f"{LOCAL_AREA}.u{{user}}.p{{project}}.l{{log}}.a{{agent}}  (501 = Little Rock Mini)",
            "job_id": "job_{hex10} claimed never executed",
            "rpt_id": "rpt_{hex10} pending_sam",
            "feature_id": "viewport.boot | viewport.models | webgl.context | prompt.run | cad.gen_step | memory.leak | vr.controllers.trigger | user.damage",
            "recommendation": "fire | replace-approach | fix-few-issues | pending_reload",
            "cad_snapshots": "ai-context/debugger/cad-snapshots/{job_id}-latest.md|.json",
            "stamp_feature": "offline allowlist stamp → incident + ingest, log_id stamp:{feature}:{day}:{status}, never kernel",
            "readonly_cli": "ls|pwd|date|wc|head|cat in-process jail; debugger + prompt-trace + incident-intelligence; no shell",
            "candidate_confirm": "claimed/pending + later ok stamp; pending_sam; never confirm_fixed",
            "sam_confirmed": "Sam confirm-candidate status; executed=false; breakage_zero=false",
            "confirm_candidate": "MCP grok_debugger action=confirm_candidate + job_id required; or CLI; log_id sam-confirm:{job_id}; score 55 daily; not breakage=0",
            "reject_candidate": "MCP grok_debugger action=reject_candidate + job_id required; claimed + fix-few-issues; no credit",
            "ingest_existing_incident_stamps": "credit existing seed-bucket incidents; never invents",
            "ingest_thumb_down_liability": "vote_export(down) → user.damage liabilities; never invents thumb",
            "ingest_prompt_result_liabilities": "PROMPT_RESULT / desired-result scores → liabilities; low=user.damage, high=credit; never invents incidents",
            "ingest_job_clock_time_to_complete": "verified job clocks claim→test_verified → time_to_complete; Sam-wait not a grok penalty; never invents clocks",
            "instance_registry": "swarm_instances + swarm_instance_members; area_code 501 → users/projects/logs/agents; grok_debugger action=instance_registry; no vector DB; cap 160 then pack",
            "ingest_shipped_hook_optimization": "SHIPPED_THIN_HOOKS leakfix/modelsfix/stamps → optimization credit; per-token opt-hook:{feature}:{leakfixN}; skip kernel/none; never invents; not breakage=0",
            "ingest_http_network_troubleshooting": "real fetch/HTTP classes (fetch_drop|http_401|http_404|timeout) → network_troubleshooting; never invents events",
            "write_league_underperform_report": "sqlite fire/replace/fix league recs; recommendation only; never auto-fire; generate source return is kernel-only",
            "stamp_design_build_error_if_missing": "router/main DesignBuildError → prompt.run only if history save missed; never kernel",
            "ingest_controller_stamps": "existing vr.controllers* incident stamps → controllers; never invents headset events",
            "ingest_networking_stamps": "existing network.latency/fetch incident stamps → networking; never invents events",
            "cache_bust": "leakfix1 | leakfix4 | leakfix5 | leakfix6 | leakfix7 | leakfix8 | leakfix9 | leakfix10 | leakfix11 | leakfix12 | leakfix13 | leakfix14 | leakfix15 | leakfix16 | leakfix17 | leakfix18 | leakfix19 | leakfix20 | leakfix21 | leakfix22 | leakfix23 | leakfix24 | leakfix25 | leakfix26 | leakfix27 | leakfix28 | leakfix29 | leakfix30 | leakfix31 | leakfix32 | leakfix33 | leakfix34 | leakfix35 | leakfix36 | leakfix37 | leakfix38 | leakfix39 | leakfix40 | leakfix41 | leakfix42 | leakfix43 | leakfix44 | leakfix45 | leakfix46 | leakfix47 | leakfix48 | leakfix49 | leakfix50 | leakfix51 | leakfix52 | leakfix53 | leakfix54 | leakfix55 | leakfix56 | leakfix57 | leakfix58 | leakfix59 | leakfix60 | leakfix61 | leakfix62 | leakfix63 | leakfix64 | leakfix65 | leakfix66 | leakfix67 | leakfix68 | leakfix69 | leakfix70 | leakfix71 | leakfix72 | leakfix73 | leakfix74 | leakfix75 | leakfix76 | leakfix77 | leakfix78 | leakfix79 | leakfix80 | leakfix81 | leakfix82 | leakfix83 | leakfix84 | leakfix85 | leakfix86 | leakfix87 | leakfix88 | leakfix89 | leakfix90 | leakfix91 | leakfix92 | leakfix93 | leakfix94 | leakfix95 | leakfix96 | leakfix97 | leakfix98 | leakfix99 | leakfix100 | leakfix101 | leakfix102 | leakfix103 | leakfix104 | leakfix105 | leakfix106 | leakfix107 | leakfix108 | leakfix109 | modelsfix1 | candact1 | replguard1 | reloadguard1 | samqueue1 | samqueue2 | samqueue3 | testver1 | area5011 query tokens (not new id schemes)",
            "replace_approach_guard": "kernel/replace-approach jobs are not CURSOR_FIX claims; replacement_brief only",
            "pending_reload_guard": "Failed to fetch / connection-drop network.latency is PENDING_RELOAD, not CURSOR_FIX; Sam tab reload; do not kickstart render3d",
            "stamp_shipped_thin_hooks": "later-ok for SHIPPED_THIN_HOOKS so tick can candidate_confirm; not sam_confirmed; not breakage=0; never kernel",
            "hours_open": "SAM-QUEUE wait age from claimed_at else mint ts; age_s + hours_open; display only; Sam-wait is not a grok penalty",
            "cad_votes": "sqlite cad_votes; voter/subject/loop/verdict/reason/tracking_id; record_cad_vote; list on swarm_summary + SAM-QUEUE; Sam-wait is not a grok penalty",
            "sam_queue": "persistent SAM-QUEUE md+json under swarm-reports; candidate_confirm + pending_reload + replace-approach + pending_sam reports first; hours_open display; never auto-confirm",
            "explain_tracking": "grok_debugger action=explain_tracking; token harness1; read-only API+logs; GET /mcp/sandbox/explain; never prod writes",
            "test_verified": "candidate_confirm + mapped focused test pass; extra.test_verified; not sam_confirmed; not breakage=0",
        },
        "periods": list(CREDIT_PERIODS),
        "categories": list(CREDIT_CATEGORIES),
        "cap": TRACKING_ID_CAP,
        "area": LOCAL_AREA,
        "auto_fire": False,
        "vector_db": "bad idea on the hot path; sqlite + Jaccard now; FTS5 later; offline 120-char excerpts only if ever",
        "vision": VISION,
        "cursor_vs_sam": {
            "technical_delta": VISION["cursor"]["technical"] - VISION["sam"]["technical"],
            "desired_delta": VISION["cursor"]["desired_swarm"] - VISION["sam"]["desired_swarm"],
        },
        "grok_instruction": "Read this catalog once. POST /analysis agree or disagree with the PM report + Cursor architecture (necessary vs not). Then score how many points better your improvements would be vs Cursor; store via action=agree. Credit score is a dashboard metric, not a write license.",
        "approval": "skill_proposal still needs Sam. Full autonomy is not safe.",
    }


def agree(data: dict[str, Any]) -> dict[str, Any]:
    verdict = str(data.get("verdict") or data.get("agree") or "").strip().lower()
    if verdict in {"true", "1", "yes"}:
        verdict = "agree"
    if verdict in {"false", "0", "no"}:
        verdict = "disagree"
    if verdict not in {"agree", "disagree"}:
        raise ValueError("verdict must be agree or disagree")
    technical = int(data.get("technical") if data.get("technical") is not None else VISION["cursor"]["technical"])
    desired = int(data.get("desired") if data.get("desired") is not None else VISION["cursor"]["desired_swarm"])
    delta = int(data.get("delta") if data.get("delta") is not None else desired - VISION["cursor"]["desired_swarm"])
    row = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "actor": das._excerpt(data.get("actor") or "grok", 40),
        "verdict": verdict,
        "technical": technical,
        "desired": desired,
        "delta": delta,
        "note": das._excerpt(data.get("note") or data.get("worked") or "", 240),
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO catalog_reviews VALUES (?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], row["actor"], verdict, technical, desired, delta, row["note"]),
        )
    analysis = das.post_analysis({
        "worked": f"{verdict} technical={technical} desired={desired} delta={delta}",
        "failed": "" if verdict == "agree" else row["note"],
        "method": "catalog.agree",
        "feature": "debugger.catalog",
        "token_cost": das.estimate_tokens(row["note"]),
    })
    row["analysis_id"] = analysis["id"]
    if data.get("loop") and data.get("subject"):
        vote = record_cad_vote({
            **data,
            "voter": data.get("voter") or row["actor"],
            "verdict": verdict,
            "reason": row["note"],
            "agree_id": row["id"],
            "tracking_id": data.get("tracking_id") or row["id"],
            "source": data.get("source") or "agree",
        })
        row["cad_vote"] = vote
    return row


CAD_LOOP_HEADER_RE = re.compile(
    r"^# CAD loop(?: snapshot[^\n]*\(loop)?(\d+)\b",
    re.MULTILINE,
)
CAD_AGREE_RE = re.compile(
    r"Grok `catalog\.agree` id `([0-9a-fA-F]+)` \(verdict \*\*(agree|disagree)\*\*",
)
CAD_VOTES_HOW = (
    "Agents score each other agree|disagree per CAD loop (voter / subject / loop). "
    "Display only. Sam-wait is not a grok penalty."
)


def _normalize_cad_loop(raw: Any) -> str:
    text = str(raw or "").strip().lower()
    match = re.search(r"(\d{1,4})", text)
    if match:
        return f"loop{int(match.group(1))}"
    return das._excerpt(re.sub(r"[^a-z0-9._-]", "", text), 24)


def _compact_cad_vote(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "ts": row.get("ts"),
        "voter": row.get("voter"),
        "subject": row.get("subject"),
        "loop": row.get("loop"),
        "verdict": row.get("verdict"),
        "reason": row.get("reason") or "",
        "tracking_id": row.get("tracking_id") or "",
        "penalty": False,
    }


def record_cad_vote(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Persist one peer CAD-loop vote. Display only — not a grok penalty. Never auto-fire."""
    data = dict(data or {})
    voter = re.sub(r"[^A-Za-z0-9._-]", "", str(data.get("voter") or data.get("actor") or "grok"))[:40] or "grok"
    subject = _normalize_cad_loop(data.get("subject") or data.get("vs") or "")
    loop = _normalize_cad_loop(data.get("loop") or data.get("cad_loop") or "")
    if not subject or not loop:
        raise ValueError("subject and loop required")
    verdict = str(data.get("verdict") or data.get("vote") or "").strip().lower()
    if verdict in {"true", "1", "yes"}:
        verdict = "agree"
    if verdict in {"false", "0", "no"}:
        verdict = "disagree"
    if verdict not in {"agree", "disagree"}:
        raise ValueError("verdict must be agree or disagree")
    reason = das._excerpt(data.get("reason") or data.get("note") or "", 240)
    extra = {
        "penalty": False,
        "source": das._excerpt(data.get("source") or "live", 40),
        "agree_id": das._excerpt(data.get("agree_id") or "", 80),
    }
    with _conn() as conn:
        found = conn.execute(
            "SELECT * FROM cad_votes WHERE voter = ? AND subject = ? AND loop = ?",
            (voter, subject, loop),
        ).fetchone()
        if found:
            out = _compact_cad_vote(dict(found))
            out.update({
                "ok": True,
                "idempotent": True,
                "penalty": False,
                "invented": False,
                "auto_fire": False,
                "breakage_zero": False,
                "goal": "OPEN",
            })
            return out
        tracking = str(data.get("tracking_id") or data.get("agree_id") or "").strip()
        if not tracking:
            tracking = f"vote:{voter}:{loop}:{subject}"
        tracking = tracking[:TRACKING_ID_CAP]
        row_id = str(data.get("id") or uuid.uuid4().hex)
        ts = das.now()
        conn.execute(
            "INSERT INTO cad_votes VALUES (?,?,?,?,?,?,?,?,?)",
            (row_id, ts, voter, subject, loop, verdict, reason, tracking, json.dumps(extra, ensure_ascii=False)),
        )
    return {
        "ok": True,
        "id": row_id,
        "ts": ts,
        "voter": voter,
        "subject": subject,
        "loop": loop,
        "verdict": verdict,
        "reason": reason,
        "tracking_id": tracking,
        "penalty": False,
        "idempotent": False,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
    }


def list_cad_votes(limit: int = 12) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 12), 40))
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM cad_votes ORDER BY ts DESC LIMIT ?", (limit,))]
    return [_compact_cad_vote(row) for row in rows]


def parse_cad_loop_votes(text: str) -> list[dict[str, Any]]:
    """Parse CAD-LOOP markdown hashes. Does not invent votes."""
    headers = list(CAD_LOOP_HEADER_RE.finditer(text or ""))
    parsed: list[dict[str, Any]] = []
    for index, match in enumerate(headers):
        start = match.start()
        end = headers[index + 1].start() if index + 1 < len(headers) else len(text)
        chunk = text[start:end]
        agree = CAD_AGREE_RE.search(chunk)
        if not agree:
            continue
        number = int(match.group(1))
        reason_m = re.search(r"- \*\*Agree:\*\* ([^\n]+)", chunk)
        parsed.append({
            "voter": "grok",
            "subject": f"loop{max(1, number - 1)}",
            "loop": f"loop{number}",
            "verdict": agree.group(2).lower(),
            "tracking_id": agree.group(1),
            "agree_id": agree.group(1),
            "source": "backfill",
            "reason": das._excerpt((reason_m.group(1) if reason_m else f"catalog.agree {agree.group(2)} vs loop{max(1, number - 1)}"), 240),
        })
    return parsed


def backfill_cad_votes_from_loop_md(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Idempotent hash backfill from CAD-LOOP markdown. Never invents. Not a grok penalty."""
    data = dict(data or {})
    path = Path(data.get("path") or (Path(das.ROOT_DIR) / "ai-context" / "debugger" / "CAD-LOOP-20260916.md"))
    if not path.is_file():
        return {
            "ok": True,
            "n_new": 0,
            "n": len(list_cad_votes(40)),
            "skipped": "missing-md",
            "penalty": False,
            "invented": False,
            "goal": "OPEN",
        }
    created: list[dict[str, Any]] = []
    for item in parse_cad_loop_votes(path.read_text(encoding="utf-8", errors="replace")):
        row = record_cad_vote(item)
        if not row.get("idempotent"):
            created.append(row)
    return {
        "ok": True,
        "n_new": len(created),
        "n": len(list_cad_votes(40)),
        "penalty": False,
        "invented": False,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
    }


def _queue_jobs() -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for status in ("claimed", "pending_sam"):
        for job in list_debug_jobs(40, status=status):
            jid = str(job.get("id") or "")
            if jid:
                seen[jid] = job
    for job in list_debug_jobs(40):
        jid = str(job.get("id") or "")
        if jid and jid not in seen:
            seen[jid] = job
    return list(seen.values())


def queue_wait_age(job: dict[str, Any], *, now: str | None = None) -> dict[str, Any]:
    """Hours-open from claimed_at (else mint ts). Display only — Sam-wait is not a grok penalty."""
    extra = dict(job.get("extra") or {})
    opened = extra.get("claimed_at") or job.get("claimed_at") or job.get("ts") or extra.get("minted_at")
    start = _parse_job_clock(opened)
    end = _parse_job_clock(now or das.now())
    if not start or not end:
        return {
            "opened_at": str(opened or ""),
            "age_s": None,
            "hours_open": None,
            "penalty": False,
        }
    age_s = max(0.0, (end - start).total_seconds())
    return {
        "opened_at": start.isoformat(),
        "age_s": round(age_s, 1),
        "hours_open": round(age_s / 3600.0, 2),
        "penalty": False,
    }


def _sam_queue_job(job: dict[str, Any]) -> dict[str, Any]:
    extra = dict(job.get("extra") or {})
    age = queue_wait_age(job)
    return {
        "id": job.get("id"),
        "feature": job.get("feature_id") or job.get("feature"),
        "status": job.get("status"),
        "recommendation": job.get("recommendation") or extra.get("recommendation") or "",
        "candidate_confirm": bool(job.get("candidate_confirm") or extra.get("candidate_confirm")),
        "test_verified": bool(job.get("test_verified") or extra.get("test_verified")),
        "test_path": job.get("test_path") or extra.get("test_path") or "",
        "patch_claim": bool(job.get("patch_claim")) if "patch_claim" in job else not bool(patch_claim_blocked(job)),
        "agent_id": job.get("agent_id") or extra.get("claimed_by") or "",
        "playbook": job.get("playbook") or extra.get("playbook") or "",
        "opened_at": age.get("opened_at") or "",
        "age_s": age.get("age_s"),
        "hours_open": age.get("hours_open"),
        "penalty": False,
    }


def sam_queue() -> dict[str, Any]:
    """Human-gate lists the swarm cannot close. Never confirms. Never fires."""
    candidates: list[dict[str, Any]] = []
    reloads: list[dict[str, Any]] = []
    kernels: list[dict[str, Any]] = []
    for job in _queue_jobs():
        extra = dict(job.get("extra") or {})
        if extra.get("sam_confirmed") or job.get("status") == "sam_confirmed":
            continue
        row = _sam_queue_job(job)
        if job.get("candidate_confirm") or extra.get("candidate_confirm"):
            row["gate"] = "candidate_confirm"
            row["action"] = "Debugger Confirm candidate / Not fixed; or scripts/confirm-candidate.py {job_id}"
            candidates.append(row)
            continue
        blocked = patch_claim_blocked(job)
        if blocked == "pending_reload_guard":
            row["gate"] = "pending_reload"
            row["action"] = "Reload the Studio tab. Do not kickstart render3d."
            reloads.append(row)
            continue
        if blocked == "replace_approach_guard":
            row["gate"] = "replace-approach"
            row["action"] = "Kernel replace-approach. Not a CURSOR_FIX patch."
            kernels.append(row)
    candidates.sort(key=lambda j: (str(j.get("feature") or ""), str(j.get("id") or "")))
    reloads.sort(key=lambda j: str(j.get("id") or ""))
    kernels.sort(key=lambda j: str(j.get("id") or ""))
    reports = []
    for r in list_reports(30):
        if r.get("status") != "pending_sam":
            continue
        reports.append({
            "id": r.get("id"),
            "agent_id": r.get("agent_id"),
            "recommendation": r.get("recommendation"),
            "status": r.get("status"),
            "gate": "pending_sam",
            "action": "League report only. Never auto-fire.",
        })
    votes = list_cad_votes(8)
    return {
        "ok": True,
        "title": "SAM-QUEUE",
        "goal": "OPEN",
        "auto_fire": False,
        "breakage_zero": False,
        "confirm_none": True,
        "how": SAM_QUEUE_HOW,
        "candidate_confirm": candidates,
        "pending_reload": reloads,
        "replace_approach": kernels,
        "pending_sam": reports,
        "liabilities": liabilities_queue_stats(),
        "time_to_complete": time_to_complete_queue_stats(),
        "optimization": optimization_queue_stats(),
        "network_troubleshooting": network_troubleshooting_queue_stats(),
        "controllers": controllers_queue_stats(),
        "networking": networking_queue_stats(),
        "cad_votes": votes,
        "cad_votes_how": CAD_VOTES_HOW,
        "counts": {
            "candidate_confirm": len(candidates),
            "pending_reload": len(reloads),
            "replace_approach": len(kernels),
            "pending_sam": len(reports),
            "cad_votes": len(votes),
        },
        "files": [
            "ai-context/debugger/swarm-reports/sam-queue-latest.md",
            "ai-context/debugger/swarm-reports/sam-queue-latest.json",
        ],
    }


def _render_sam_queue_md(payload: dict[str, Any]) -> str:
    def _lines(title: str, rows: list[dict[str, Any]], empty: str) -> list[str]:
        out = ["", f"## {title}"]
        if not rows:
            out.append(f"- {empty}")
            return out
        for row in rows:
            rid = row.get("id") or "?"
            feat = row.get("feature") or row.get("recommendation") or ""
            status = row.get("status") or ""
            agent = row.get("agent_id") or ""
            action = row.get("action") or ""
            bits = [f"`{rid}`"]
            if feat:
                bits.append(f"`{feat}`")
            if status:
                bits.append(status)
            if agent:
                bits.append(agent)
            if row.get("test_verified"):
                bits.append("test_verified")
                if row.get("test_path"):
                    bits.append(f"`{row.get('test_path')}`")
            if row.get("hours_open") is not None:
                bits.append(f"{row.get('hours_open')}h open")
            line = "- " + " · ".join(bits)
            if action:
                line += f" — {action}"
            out.append(line)
        return out

    counts = payload.get("counts") or {}
    return "\n".join([
        "# SAM-QUEUE",
        "",
        f"Goal **{payload.get('goal') or 'OPEN'}**. `auto_fire=false`. `breakage_zero=false`. Swarm cannot close this.",
        "",
        "## How Sam reads this",
        payload.get("how") or SAM_QUEUE_HOW,
        "",
        f"- candidate_confirm: {counts.get('candidate_confirm', 0)}",
        f"- pending_reload: {counts.get('pending_reload', 0)}",
        f"- replace-approach: {counts.get('replace_approach', 0)}",
        f"- pending_sam reports: {counts.get('pending_sam', 0)}",
        f"- liabilities: {(payload.get('liabilities') or {}).get('n', 0)} rows avg {(payload.get('liabilities') or {}).get('credit_avg', 0)} (prompt-result scores, not invented)",
        f"- time_to_complete: {(payload.get('time_to_complete') or {}).get('n', 0)} job-clock rows avg {(payload.get('time_to_complete') or {}).get('credit_avg', 0)} (verified jobs only; Sam-wait not a penalty)",
        f"- optimization: {(payload.get('optimization') or {}).get('n', 0)} shipped-hook rows avg {(payload.get('optimization') or {}).get('credit_avg', 0)} (leakfix/modelsfix/stamps, not prompt-trace proxies)",
        f"- network_troubleshooting: {(payload.get('network_troubleshooting') or {}).get('n', 0)} http-class rows avg {(payload.get('network_troubleshooting') or {}).get('credit_avg', 0)} (fetch_drop/401/404/timeout from real events)",
        f"- controllers: {(payload.get('controllers') or {}).get('n', 0)} ctrl-stamp rows avg {(payload.get('controllers') or {}).get('credit_avg', 0)} (vr.controllers.trigger stamps, not prompt-trace proxies)",
        f"- networking: {(payload.get('networking') or {}).get('n', 0)} net-stamp rows avg {(payload.get('networking') or {}).get('credit_avg', 0)} (network.latency/fetch stamps, not prompt-trace proxies)",
        *_lines("candidate_confirm (pending Sam confirm — do not auto-confirm)", payload.get("candidate_confirm") or [], "none"),
        *_lines("pending_reload (Sam tab reload — do not kickstart render3d)", payload.get("pending_reload") or [], "none"),
        *_lines("replace-approach (kernel — not a patch claim)", payload.get("replace_approach") or [], "none"),
        *_lines("pending_sam league reports (never auto-fire)", payload.get("pending_sam") or [], "none"),
        *_cad_vote_md_lines(payload.get("cad_votes") or []),
        "",
    ]) + "\n"


def _cad_vote_md_lines(rows: list[dict[str, Any]]) -> list[str]:
    out = ["", "## cad_votes (peer agree|disagree — Sam-wait not a grok penalty)"]
    if not rows:
        out.append("- none")
        return out
    for row in rows:
        bits = [
            f"`{row.get('id') or '?'}`",
            row.get("verdict") or "",
            f"{row.get('voter') or '?'} vs {row.get('subject') or '?'}",
            f"from {row.get('loop') or '?'}",
        ]
        if row.get("tracking_id"):
            bits.append(f"`{row.get('tracking_id')}`")
        if row.get("reason"):
            bits.append(str(row.get("reason")))
        out.append("- " + " · ".join(str(bit) for bit in bits if bit))
    return out


def write_sam_queue() -> dict[str, Any]:
    """Persist SAM-QUEUE markdown+json. Never confirms. Never fires."""
    root = swarm_reports_root()
    root.mkdir(parents=True, exist_ok=True)
    payload = sam_queue()
    json_path = root / "sam-queue-latest.json"
    md_path = root / "sam-queue-latest.md"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(_render_sam_queue_md(payload), encoding="utf-8")
    rel = lambda p: str(Path(p).relative_to(das.ROOT_DIR)) if str(p).startswith(str(das.ROOT_DIR)) else str(p)
    return {
        "ok": True,
        "dir": str(root),
        "latest": [rel(json_path), rel(md_path)],
        "sam_queue": payload,
        "auto_fire": False,
        "breakage_zero": False,
        "goal": "OPEN",
    }


def swarm_summary() -> dict[str, Any]:
    """Read-only compact swarm proof for harness GET. No fire buttons, no secrets."""

    def _avg(vals: list[float]) -> float:
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    rollups = list_period_rollups()
    by_period: dict[str, list[float]] = {p: [] for p in CREDIT_PERIODS}
    by_cat: dict[str, list[float]] = {c: [] for c in CREDIT_CATEGORIES}
    for row in rollups:
        period = str(row.get("period") or "")
        cat = str(row.get("category") or "")
        credit = float(row.get("credit") or 0)
        if period in by_period:
            by_period[period].append(credit)
        if cat in by_cat:
            by_cat[cat].append(credit)
    league_avgs: dict[str, float] = {}
    with _conn() as conn:
        for row in conn.execute(_league_avg_sql()):
            aid = str(row["agent_id"] or "")
            if aid:
                league_avgs[aid] = round(float(row["credit"] or 0), 2)
    users = []
    for row in list_instance_users(8):
        if not row:
            continue
        users.append({
            "user_id": row.get("user_id"),
            "instance_id": row.get("instance_id"),
            "area_id": row.get("area_id"),
            "area": LOCAL_AREA,
        })
    pending = [
        {
            "id": r.get("id"),
            "agent_id": r.get("agent_id"),
            "recommendation": r.get("recommendation"),
            "status": r.get("status"),
        }
        for r in list_reports(12)
        if r.get("status") == "pending_sam"
    ]
    claimed = [_compact_debug_job(r) for r in list_debug_jobs(12, status="claimed")]
    candidates = [_compact_debug_job(r) for r in list_handoff_jobs(24) if r.get("candidate_confirm")]
    queue = write_sam_queue()
    return {
        "sam_queue": queue.get("sam_queue") or sam_queue(),
        "ok": True,
        "read_only": True,
        "auto_fire": False,
        "license": "dashboard-metric",
        "periods": list(CREDIT_PERIODS),
        "categories": list(CREDIT_CATEGORIES),
        "rollup_avgs": {p: _avg(by_period[p]) for p in CREDIT_PERIODS},
        "category_avgs": {c: _avg(by_cat[c]) for c in CREDIT_CATEGORIES},
        "instance_users": users,
        "area": LOCAL_AREA,
        "league_avgs": league_avgs,
        "pending_sam": pending,
        "claimed_jobs": claimed,
        "candidate_confirm": candidates,
        "instance_registry": compact_instance_registry(),
        "liabilities": liabilities_queue_stats(),
        "time_to_complete": time_to_complete_queue_stats(),
        "optimization": optimization_queue_stats(),
        "network_troubleshooting": network_troubleshooting_queue_stats(),
        "controllers": controllers_queue_stats(),
        "networking": networking_queue_stats(),
        "cad_votes": list_cad_votes(8),
    }


def swarm_reports_root() -> Path:
    return Path(das.ROOT_DIR) / "ai-context" / "debugger" / "swarm-reports"


def cad_snapshots_root() -> Path:
    return Path(das.ROOT_DIR) / "ai-context" / "debugger" / "cad-snapshots"


CAD_NEXT = ("fix-few-issues", "replace-approach", "fire", "pending_reload")


def _normalize_cad_rec(rec: Any) -> str:
    value = str(rec or "fix-few-issues").strip().lower()
    if value == "replace":
        return "replace-approach"
    if value in {"reload", "pending-reload"}:
        return "pending_reload"
    return value if value in CAD_NEXT else "fix-few-issues"


def _is_thin_hook(feature: str, extra: dict[str, Any] | None = None) -> bool:
    extra = extra or {}
    feat = str(feature or "").strip().lower()
    source = str(extra.get("source") or "").strip().lower()
    if source in {"debug-job-stamp", "studio-webgl", "client-smoke", "prompt-trace"}:
        if feat and not _is_kernel_feature(feat, extra):
            return True
    if feat in THIN_HOOK_FEATURES:
        return True
    return any(feat.startswith(prefix) for prefix in THIN_HOOK_PREFIXES)


def agent_underperform_fire(agent_id: str) -> bool:
    """League below floor with repeated/severe fails. Report-only; never auto-fire."""
    aid = str(agent_id or "")[:40]
    if not aid:
        return False
    for row in underperformers(floor=UNDERPERFORM_FLOOR):
        if str(row.get("agent_id") or "") != aid:
            continue
        return str(row.get("recommendation") or "") == "fire"
    return False


def recommend_swarm_action(subject: dict[str, Any] | None = None, *, kind: str = "job") -> str:
    """Evidence → fire / replace-approach / fix-few-issues. Sam-facing only."""
    subject = dict(subject or {})
    extra = subject.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    feature = str(subject.get("feature_id") or subject.get("feature") or "")
    agent_id = str(subject.get("agent_id") or "")[:40]
    note = " ".join(str(subject.get(k) or extra.get(k) or "") for k in ("note", "cause_hint"))
    if kind == "report":
        if agent_underperform_fire(agent_id):
            return "fire"
        return "fix-few-issues"
    if _is_kernel_feature(feature, extra) or "gen_step" in note.lower():
        return "replace-approach"
    if connection_drop_guard({**subject, "extra": extra, "note": note, "cause_hint": extra.get("cause_hint") or note}):
        return "pending_reload"
    if _is_thin_hook(feature, extra):
        return "fix-few-issues"
    return "fix-few-issues"


def suggest_cad_next(job: dict[str, Any] | None = None) -> str:
    """Sam-facing next step for a debug job. Never executed."""
    return recommend_swarm_action(job, kind="job")


def recompute_league_attribution() -> dict[str, Any]:
    """Refresh pending_sam recs from filtered league avgs. Does not delete history."""
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute(_league_avg_sql())]
    avgs = []
    for row in rows:
        avgs.append({
            "agent_id": row.get("agent_id"),
            "credit": round(float(row.get("credit") or 0), 2),
            "damage": round(float(row.get("damage") or 0), 2),
            "n": int(row.get("n") or 0),
        })
    reports = sync_pending_sam_recommendations()
    return {
        "ok": True,
        "avgs": avgs,
        "underperform": underperformers(),
        "reports": reports,
        "rewrote_history": False,
        "auto_fire": False,
        "executed": False,
        "license": "dashboard-metric",
    }


def _agent_league_recommendation(row: dict[str, Any]) -> str:
    credit = float(row.get("credit") or 0)
    damage = float(row.get("damage") or 0)
    n = int(row.get("n") or 0)
    if credit < UNDERPERFORM_FLOOR and (n >= 2 or damage >= 40):
        return "fire"
    return "fix-few-issues"


def write_league_underperform_report() -> dict[str, Any]:
    """Refresh fire/replace/fix league recs from sqlite. Recommendation only. Never auto-fire."""
    recomputed = recompute_league_attribution()
    agents: list[dict[str, Any]] = []
    for row in recomputed.get("avgs") or []:
        rec = _agent_league_recommendation(row)
        agents.append({
            "agent_id": row.get("agent_id"),
            "credit": row.get("credit"),
            "damage": row.get("damage"),
            "n": row.get("n"),
            "recommendation": rec,
            "auto_fire": False,
            "executed": False,
        })
    pending = [r for r in list_reports(30) if r.get("status") == "pending_sam"]
    payload = {
        "ok": True,
        "generated_at": das.now(),
        "goal": "OPEN",
        "auto_fire": False,
        "executed": False,
        "fire_anyone": False,
        "path": "league-refresh; generate source return is kernel-only",
        "area": LOCAL_AREA,
        "license": "dashboard-metric",
        "agents": agents,
        "underperform": recomputed.get("underperform") or [],
        "pending_sam": pending,
        "kernel_job": "job_f0319f9ce6 replace-approach (not an agent fire)",
        "attribution": recomputed,
    }
    root = swarm_reports_root()
    root.mkdir(parents=True, exist_ok=True)
    (root / "league-underperform-latest.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    lines = [
        "# League underperformer report",
        "",
        f"Goal **{payload['goal']}**. `auto_fire=false`. `executed=false`. Recommendation only.",
        f"Path: {payload['path']}. Generated {payload['generated_at']}.",
        "",
        "## Agents (filtered league)",
    ]
    if agents:
        for row in agents:
            lines.append(
                f"- `{row.get('agent_id')}` **{row.get('recommendation')}** avg {row.get('credit')} dmg {row.get('damage')} n={row.get('n')}"
            )
    else:
        lines.append("- none")
    lines += ["", "## Under floor 40 (fire only if repeated/severe — not executed)"]
    under = payload.get("underperform") or []
    if under:
        for row in under:
            lines.append(
                f"- `{row.get('agent_id')}` **{row.get('recommendation')}** avg {row.get('credit')} dmg {row.get('damage')} n={row.get('n')}"
            )
    else:
        lines.append("- none")
    lines += ["", "## pending_sam reports (never auto-fire)"]
    if pending:
        for row in pending:
            lines.append(
                f"- `{row.get('id')}` {row.get('agent_id')} **{row.get('recommendation')}** ({row.get('status')})"
            )
    else:
        lines.append("- none")
    lines += [
        "",
        "Kernel `job_f0319f9ce6` stays **replace-approach**. Fire anyone? **No.**",
        "Do not treat this file as breakage=0. Goal stays OPEN.",
        "",
    ]
    (root / "league-underperform-latest.md").write_text("\n".join(lines), encoding="utf-8")
    write_swarm_period_reports()
    return payload


def sync_pending_sam_recommendations() -> dict[str, Any]:
    """Rewrite pending_sam report recs from evidence. Never executes."""
    updated: list[dict[str, Any]] = []
    for row in list_reports(30):
        if row.get("status") != "pending_sam":
            continue
        rec = recommend_swarm_action(row, kind="report")
        if rec == str(row.get("recommendation") or ""):
            continue
        with _conn() as conn:
            conn.execute("UPDATE agent_reports SET recommendation = ? WHERE id = ?", (rec, row["id"]))
        updated.append({"id": row["id"], "recommendation": rec, "auto_fire": False, "executed": False})
    return {"ok": True, "updated": updated, "auto_fire": False, "executed": False}


def _period_bucket(period: str) -> str:
    start = _period_start(period)
    if period == "monthly":
        return start.strftime("%Y-%m")
    if period == "yearly":
        return str(start.year)
    return start.date().isoformat()


def period_effectiveness(period: str, summary: dict[str, Any] | None = None) -> dict[str, Any]:
    """One period's durable effectiveness payload. No secrets, no fire buttons."""
    if period not in CREDIT_PERIODS:
        raise ValueError("invalid period")
    summary = summary or swarm_summary()
    scores = {c: 0.0 for c in CREDIT_CATEGORIES}
    for row in list_period_rollups(period):
        cat = str(row.get("category") or "")
        if cat in scores:
            scores[cat] = round(float(row.get("credit") or 0), 2)
    league = summary.get("league_avgs") or {}
    return {
        "ok": True,
        "period": period,
        "bucket": _period_bucket(period),
        "generated_at": das.now(),
        "goal": "OPEN",
        "auto_fire": False,
        "license": "dashboard-metric",
        "area": LOCAL_AREA,
        "periods": list(CREDIT_PERIODS),
        "categories": list(CREDIT_CATEGORIES),
        "scores": scores,
        "rollup_avg": (summary.get("rollup_avgs") or {}).get(period, 0),
        "instance_users": summary.get("instance_users") or [],
        "league": {
            "cursor": float(league.get("cursor") or 0),
            "grok": float(league.get("grok") or 0),
        },
        "pending_sam": summary.get("pending_sam") or [],
        "claimed_jobs": summary.get("claimed_jobs") or [],
        "candidate_confirm": summary.get("candidate_confirm") or [],
    }


def _render_period_md(payload: dict[str, Any]) -> str:
    scores = payload.get("scores") or {}
    users = payload.get("instance_users") or []
    league = payload.get("league") or {}
    pending = payload.get("pending_sam") or []
    jobs = payload.get("claimed_jobs") or []
    candidates = payload.get("candidate_confirm") or []
    lines = [
        f"# Swarm effectiveness · {payload.get('period')} · {payload.get('bucket')}",
        "",
        f"Goal **{payload.get('goal') or 'OPEN'}**. `auto_fire=false`. Credit is a dashboard metric.",
        f"Area `{payload.get('area') or LOCAL_AREA}`. Generated {payload.get('generated_at') or ''}.",
        "",
        "## Period scores (7 categories)",
    ]
    for cat in CREDIT_CATEGORIES:
        lines.append(f"- `{cat}`: {scores.get(cat, 0)}")
    lines += ["", f"Rollup avg: {payload.get('rollup_avg') or 0}", "", "## 501 users"]
    if users:
        for user in users:
            lines.append(
                f"- `{user.get('user_id') or '?'}` instance `{user.get('instance_id') or ''}` area `{user.get('area') or user.get('area_id') or ''}`"
            )
    else:
        lines.append("- none yet")
    lines += [
        "",
        "## League (cursor vs grok)",
        f"- cursor: {league.get('cursor', 0)}",
        f"- grok: {league.get('grok', 0)}",
        "",
        "## pending_sam (fire / replace / fix — not executed)",
    ]
    if pending:
        for row in pending:
            lines.append(
                f"- `{row.get('id')}` {row.get('agent_id') or ''} **{row.get('recommendation') or 'fix-few-issues'}** ({row.get('status')})"
            )
    else:
        lines.append("- none")
    lines += ["", "## Claimed jobs"]
    if jobs:
        for job in jobs:
            flag = " candidate_confirm" if job.get("candidate_confirm") else ""
            lines.append(
                f"- `{job.get('id')}` `{job.get('feature') or ''}` tracking `{job.get('tracking_id') or ''}`{flag}"
            )
    else:
        lines.append("- none claimed")
    lines += ["", "## candidate_confirm (pending_sam — Sam may confirm-fixed)"]
    if candidates:
        for job in candidates:
            lines.append(
                f"- `{job.get('id')}` `{job.get('feature') or ''}` **candidate confirm-fixed** ({job.get('status')}) executed=false"
            )
    else:
        lines.append("- none")
    lines += ["", "Do not treat this file as breakage=0. Goal stays OPEN.", ""]
    return "\n".join(lines)


def write_swarm_period_reports() -> dict[str, Any]:
    """Rewrite *-latest.md/json. Dated snapshot only if that period bucket is new."""
    root = swarm_reports_root()
    root.mkdir(parents=True, exist_ok=True)
    summary = swarm_summary()
    latest: list[str] = []
    dated: list[str] = []
    for period in CREDIT_PERIODS:
        payload = period_effectiveness(period, summary)
        latest_json = root / f"{period}-latest.json"
        latest_md = root / f"{period}-latest.md"
        latest_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        latest_md.write_text(_render_period_md(payload), encoding="utf-8")
        latest.extend([str(latest_json), str(latest_md)])
        snap_json = root / f"{period}-{payload['bucket']}.json"
        snap_md = root / f"{period}-{payload['bucket']}.md"
        if not snap_json.is_file():
            snap_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            snap_md.write_text(_render_period_md(payload), encoding="utf-8")
            dated.extend([str(snap_json), str(snap_md)])
    rel = lambda p: str(Path(p).relative_to(das.ROOT_DIR)) if str(p).startswith(str(das.ROOT_DIR)) else p
    return {
        "ok": True,
        "dir": str(root),
        "latest": [rel(p) for p in latest],
        "dated": [rel(p) for p in dated],
        "periods": list(CREDIT_PERIODS),
        "auto_fire": False,
        "license": "dashboard-metric",
    }


def _rel_under_root(path: Path | str) -> str:
    text = str(path)
    root = str(das.ROOT_DIR)
    if text.startswith(root):
        return str(Path(text).relative_to(das.ROOT_DIR))
    return text


def _jailed_file_excerpt(rel_path: str, *, head: bool = False) -> str:
    """Read via exec_readonly_cli (in-process jail). Empty if denied or missing."""
    path = str(rel_path or "").strip()
    if not path:
        return ""
    try:
        ran = exec_readonly_cli({"command": "head" if head else "cat", "path": path})
    except (ValueError, OSError):
        return ""
    return das._excerpt(ran.get("output") or "", 120)


def _playbook_path_for_job(job_id: str) -> str:
    jid = str(job_id or "").strip()
    if not jid:
        return ""
    debugger = das.ROOT_DIR / "ai-context" / "debugger"
    if not debugger.is_dir():
        return ""
    matches = sorted(debugger.glob(f"PLAYBOOK-{jid}*.md"))
    if not matches:
        return ""
    try:
        rel = str(matches[0].relative_to(das.ROOT_DIR))
        _jailed(rel)
        return rel
    except (ValueError, OSError):
        return ""


def cad_job_snapshot_payload(job: dict[str, Any]) -> dict[str, Any]:
    extra = job.get("extra") or {}
    if isinstance(extra, str):
        extra = json.loads(extra or "{}")
    suggestion = suggest_cad_next(job)
    log_path = str(job.get("log_path") or "")
    log_excerpt = _jailed_file_excerpt(log_path)
    playbook_path = _playbook_path_for_job(str(job.get("id") or ""))
    playbook_excerpt = _jailed_file_excerpt(playbook_path, head=True) if playbook_path else ""
    return {
        "ok": True,
        "job_id": job.get("id") or "",
        "tracking_id": job.get("tracking_id") or "",
        "feature": job.get("feature_id") or job.get("feature") or "",
        "category": job.get("category") or "",
        "status": job.get("status") or "",
        "agent_id": job.get("agent_id") or "",
        "last_working": job.get("last_working_id") or "",
        "first_broken": job.get("first_broken_id") or "",
        "log_path": log_path,
        "log_excerpt": log_excerpt,
        "playbook_path": playbook_path,
        "playbook_excerpt": playbook_excerpt,
        "league_suggestion": suggestion,
        "recommendation": suggestion,
        "suggested_next": suggestion,
        "day": _job_day(),
        "generated_at": das.now(),
        "goal": "OPEN",
        "auto_fire": False,
        "executed": False,
        "kernel": bool(extra.get("kernel")) or _is_kernel_feature(str(job.get("feature_id") or job.get("feature") or ""), extra),
        "candidate_confirm": bool(extra.get("candidate_confirm") or job.get("candidate_confirm")),
        "shipped": SHIPPED_THIN_HOOKS.get(str(job.get("feature_id") or job.get("feature") or ""), "none; breakage≠0"),
        "breakage_zero": False,
        "patch_claim": not patch_claim_blocked(job),
        "license": "dashboard-metric",
        "area": LOCAL_AREA,
    }


def _render_cad_snapshot_md(payload: dict[str, Any]) -> str:
    return "\n".join([
        f"# CAD snapshot · {payload.get('job_id') or '?'}",
        "",
        f"Goal **{payload.get('goal') or 'OPEN'}**. `auto_fire=false`. `executed=false`.",
        f"Generated {payload.get('generated_at') or ''}. Area `{payload.get('area') or LOCAL_AREA}`.",
        "",
        f"- tracking_id: `{payload.get('tracking_id') or 'none'}`",
        f"- feature: `{payload.get('feature') or ''}`",
        f"- category: `{payload.get('category') or ''}`",
        f"- status: `{payload.get('status') or ''}`",
        f"- agent: `{payload.get('agent_id') or ''}`",
        f"- last_working: `{payload.get('last_working') or 'none'}`",
        f"- first_broken: `{payload.get('first_broken') or 'none'}`",
        f"- log_path: `{payload.get('log_path') or ''}`",
        f"- log_excerpt: {payload.get('log_excerpt') or 'none'}",
        f"- playbook: `{payload.get('playbook_path') or 'none'}`",
        f"- playbook_excerpt: {payload.get('playbook_excerpt') or 'none'}",
        f"- recommendation (stored): **{payload.get('recommendation') or 'fix-few-issues'}**",
        f"- league suggestion (next for Sam): **{payload.get('league_suggestion') or 'fix-few-issues'}**",
        f"- kernel: {payload.get('kernel')}",
        f"- candidate_confirm: {payload.get('candidate_confirm')}",
        f"- shipped: {payload.get('shipped') or 'none; breakage≠0'}",
        f"- patch_claim: {payload.get('patch_claim')}",
        f"- breakage=0: no",
        "",
        (
            "candidate confirm-fixed — pending_sam. Sam may confirm-fixed. Never auto-execute. Do not treat this as breakage=0."
            if payload.get("candidate_confirm")
            else "Suggested next is for Sam only. Never auto-execute. Do not treat this file as breakage=0."
        ),
        "",
    ])


def write_cad_job_snapshots(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Rewrite {job_id}-latest.md/json. Dated file once per job per day.

    Claimed jobs always. pending_sam included unless data.include_pending is false.
    Same job same day overwrites latest only — no 300s dated flood.
    """
    data = dict(data or {})
    include_pending = data.get("include_pending", True)
    jobs = list(list_debug_jobs(40, status="claimed"))
    if include_pending:
        jobs.extend(list_debug_jobs(40, status="pending_sam"))
    by_id: dict[str, dict[str, Any]] = {}
    for job in jobs:
        jid = str(job.get("id") or "")
        if jid:
            by_id[jid] = job
    root = cad_snapshots_root()
    root.mkdir(parents=True, exist_ok=True)
    latest: list[str] = []
    dated: list[str] = []
    written: list[dict[str, Any]] = []
    reports = sync_pending_sam_recommendations()
    day = _job_day()
    for job in by_id.values():
        rec = suggest_cad_next(job)
        jid = str(job.get("id") or "")
        if jid and rec != str(job.get("recommendation") or ""):
            with _conn() as conn:
                conn.execute("UPDATE debug_jobs SET recommendation = ? WHERE id = ?", (rec, jid))
            job["recommendation"] = rec
        payload = cad_job_snapshot_payload(job)
        jid = str(payload["job_id"])
        latest_json = root / f"{jid}-latest.json"
        latest_md = root / f"{jid}-latest.md"
        blob = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        md = _render_cad_snapshot_md(payload)
        latest_json.write_text(blob, encoding="utf-8")
        latest_md.write_text(md, encoding="utf-8")
        latest.extend([_rel_under_root(latest_json), _rel_under_root(latest_md)])
        snap_json = root / f"{jid}-{day}.json"
        snap_md = root / f"{jid}-{day}.md"
        if not snap_json.is_file():
            snap_json.write_text(blob, encoding="utf-8")
            snap_md.write_text(md, encoding="utf-8")
            dated.extend([_rel_under_root(snap_json), _rel_under_root(snap_md)])
        written.append({
            "job_id": jid,
            "feature": payload["feature"],
            "league_suggestion": payload["league_suggestion"],
            "recommendation": payload["recommendation"],
            "status": payload["status"],
            "candidate_confirm": bool(payload.get("candidate_confirm")),
            "executed": False,
        })
    return {
        "ok": True,
        "dir": _rel_under_root(root),
        "latest": latest,
        "dated": dated,
        "n": len(written),
        "jobs": written,
        "reports": reports,
        "auto_fire": False,
        "executed": False,
        "license": "dashboard-metric",
        "goal": "OPEN",
    }


def list_cad_snapshots(limit: int = 20) -> dict[str, Any]:
    """Readonly latest CAD snapshots. No fire, no execute."""
    limit = max(1, min(int(limit or 20), 40))
    root = cad_snapshots_root()
    items: list[dict[str, Any]] = []
    if root.is_dir():
        for path in sorted(root.glob("*-latest.json"), reverse=True):
            try:
                row = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(row, dict):
                items.append(row)
            if len(items) >= limit:
                break
    return {
        "ok": True,
        "read_only": True,
        "snapshots": items,
        "n": len(items),
        "dir": _rel_under_root(root),
        "auto_fire": False,
        "executed": False,
        "goal": "OPEN",
        "license": "dashboard-metric",
    }


def overview_addon() -> dict[str, Any]:
    charts = chart_periods()
    reports = list_reports(8)
    jobs = list_handoff_jobs(12)
    return {
        "sam_queue": sam_queue(),
        "credit": list_credit(limit=16),
        "rollups": list_period_rollups(),
        "charts": charts,
        "periods": list(CREDIT_PERIODS),
        "categories": list(CREDIT_CATEGORIES),
        "league": list_league(12),
        "reports": reports,
        "pending_sam": [r for r in reports if r.get("status") == "pending_sam"],
        "debug_jobs": jobs,
        "candidate_confirm": [j for j in jobs if j.get("candidate_confirm")],
        "underperform": underperformers(),
        "instance_users": list_instance_users(8),
        "instance_registry": compact_instance_registry(),
        "cad_votes": list_cad_votes(8),
        "area": LOCAL_AREA,
        "cap": TRACKING_ID_CAP,
        "vision": VISION,
        "auto_fire": False,
        "ingest": "offline-jsonl+tick",
        "tick_s": 300,
        "license": "dashboard-metric",
    }
