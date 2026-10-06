"""Local swarm-tracking fallback when Studio /debugger-analytics 404s.

Reads hit sqlite + prompt-trace. Writes that run CLI / watchdogs / fire stay
fail-closed or pending_sam. Never starts a shell.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

EXECUTE_WRITES = {
    "approve",
    "ban",
    "archive_watchdog",
    "issue",
    "rollback",
    "fork",
}


def studio_unavailable(exc: BaseException) -> bool:
    text = str(exc)
    if "HTTP 404" in text or "HTTP 405" in text or "HTTP 401" in text:
        return True
    if "RENDER_STUDIO_TOKEN" in text:
        return True
    if "Connection refused" in text or "timed out" in text or "connection error" in text.lower():
        return True
    return isinstance(exc, (TimeoutError, ConnectionError, OSError))


def _dss():
    from backend.services import debugger_swarm_service as dss

    return dss


def _das():
    from backend.services import debugger_analytics_service as das

    return das


def _dms():
    from backend.services import debugger_metrics_service as dms

    return dms


def _excerpt(text: Any, cap: int = 120) -> str:
    value = " ".join(str(text or "").split())
    return value if len(value) <= cap else value[: cap - 1] + "…"


def _lite_rows(sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    import sqlite3

    db = REPO / "data" / "debugger_analytics.sqlite3"
    if not db.is_file():
        return []
    conn = sqlite3.connect(str(db), timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


def _lite_prompts() -> list[dict[str, Any]]:
    import json

    rows: list[dict[str, Any]] = []
    store = REPO / "data" / "prompt-trace"
    prompts = store / "prompts.json"
    if prompts.is_file():
        try:
            data = json.loads(prompts.read_text(encoding="utf-8"))
            if isinstance(data, list):
                rows.extend(item for item in data if isinstance(item, dict))
        except (OSError, ValueError):
            pass
    live = store / "live-prompts.jsonl"
    if live.is_file():
        for line in live.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                item = json.loads(line)
            except ValueError:
                continue
            if isinstance(item, dict):
                rows.append(item)
    try:
        from backend.services import cursor_transcript_index as cti

        rows = cti.merge_missing(rows)
    except Exception:
        pass
    return rows


def _lite_history(query: str, *, limit: int = 20, log_id: str = "") -> dict[str, Any]:
    needle = (query or "").strip().lower()
    ident = (log_id or "").strip()
    hits = []
    for item in reversed(_lite_prompts()):
        lid = str(item.get("log_id") or item.get("id") or "")
        if ident and lid != ident:
            continue
        blob = " ".join(str(item.get(k) or "") for k in ("log_id", "chat_id", "prompt", "project", "result"))
        if needle and needle not in blob.lower():
            continue
        hits.append({
            "log_id": lid,
            "chat_id": item.get("chat_id") or "",
            "timestamp": item.get("timestamp") or item.get("ts") or "",
            "excerpt": _excerpt(item.get("prompt") or item.get("excerpt") or item.get("notes"), 120),
        })
        if ident:
            break
    page = hits[: max(1, min(int(limit or 20), 40))]
    return {"ok": True, "q": query, "limit": limit, "count": len(page), "total": len(hits), "hits": page, "bodies": False, "lite": True}


def _lite_read(action: str, args: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    q = str(args.get("q") or args.get("feature") or data.get("q") or "")
    limit = int(args.get("limit") or data.get("limit") or 20)
    if action in {"history", "history_ids"}:
        return mark(_lite_history(q, limit=limit))
    if action == "history_get":
        row = _lite_history("", log_id=str(args.get("id") or args.get("log_id") or data.get("log_id") or ""))
        hit = (row.get("hits") or [None])[0]
        if not hit:
            raise ValueError("log_id not found")
        return mark({**hit, "ok": True, "lite": True})
    if action == "catalog":
        return mark(_lite_catalog())
    if action in {"readonly_cli", "cli_readonly"}:
        return mark(_lite_readonly(args, data))
    if action == "credit":
        rows = _lite_rows("SELECT period, category, credit, damage, actor FROM credit_scores ORDER BY ts DESC LIMIT 40")
        return mark({"credits": rows, "periods": ["daily", "weekly", "monthly", "yearly"], "lite": True})
    if action == "league":
        return mark({
            "league": _lite_rows("SELECT agent_id, category, credit_score, damage FROM agent_league ORDER BY ts DESC LIMIT 20"),
            "reports": _lite_rows("SELECT agent_id, recommendation, status FROM agent_reports ORDER BY ts DESC LIMIT 12"),
            "auto_fire": False,
            "lite": True,
        })
    if action == "search_ids":
        return mark(_lite_history(q, limit=limit))
    if action == "agree":
        return mark({"reviews": _lite_rows("SELECT actor, verdict, delta FROM catalog_reviews ORDER BY ts DESC LIMIT 12"), "lite": True})
    if action == "debug_jobs":
        jobs = _lite_debug_jobs(20)
        return mark({
            "jobs": jobs,
            "candidate_confirm": [j for j in jobs if j.get("candidate_confirm")],
            "auto_fire": False,
            "executed": False,
            "lite": True,
        })
    if action == "cad_snapshots":
        return mark(_lite_cad_snapshots(limit))
    if action == "swarm_summary":
        return mark(_lite_swarm_summary())  # sam_queue first inside helper
    if action in {"instance_registry", "lookup_area", "resolve_instance"}:
        return mark(_lite_instance_registry(args, data))
    if action in {"cad_votes", "list_cad_votes"}:
        return mark({"cad_votes": [], "lite": True, "penalty": False})
    raise ValueError(f"no local read for {action}")


def _lite_instance_registry(args: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    q = str(args.get("q") or data.get("q") or data.get("instance_id") or data.get("area_code") or "501")
    area = (q.split(".", 1)[0] if "." in q else q) or "501"
    area = "".join(ch for ch in area if ch.isdigit())[:3] or "501"
    instances = _lite_rows("SELECT instance_id, area_code, label FROM swarm_instances ORDER BY instance_id LIMIT 20")
    members = _lite_rows(
        "SELECT kind, member_id, area_id, tracking_id FROM swarm_instance_members WHERE instance_id = ? ORDER BY kind, member_id",
        (area,),
    )
    grouped = {"user": [], "project": [], "log": [], "agent": []}
    for row in members:
        kind = str(row.get("kind") or "")
        if kind in grouped:
            grouped[kind].append({"id": row.get("member_id"), "area_id": row.get("area_id"), "tracking_id": row.get("tracking_id")})
    if not instances:
        users = _lite_rows("SELECT user_id, instance_id, area_id FROM instance_users WHERE instance_id = ? LIMIT 20", (area,))
        grouped["user"] = [{"id": u.get("user_id"), "area_id": u.get("area_id")} for u in users]
    return {
        "ok": True,
        "lite": True,
        "instance_id": area,
        "area_code": area,
        "label": "Little Rock Mini" if area == "501" else "",
        "users": grouped["user"],
        "projects": grouped["project"],
        "logs": grouped["log"],
        "agents": grouped["agent"],
        "counts": {k: len(v) for k, v in grouped.items()},
        "instances": instances,
        "how": "grok_debugger action=instance_registry q=501. sqlite only. No vector DB.",
        "vector_db": False,
        "auto_fire": False,
        "goal": "OPEN",
    }


def _lite_liabilities() -> dict[str, Any]:
    rows = _lite_rows("SELECT credit FROM credit_scores WHERE category='liabilities' ORDER BY ts DESC LIMIT 40")
    credits = [float(r.get("credit") or 0) for r in rows]
    return {
        "n": len(rows),
        "credit_avg": round(sum(credits) / len(credits), 2) if credits else 0.0,
        "populated": bool(rows),
        "source": "prompt-result-scores",
        "auto_fire": False,
    }


def _lite_sam_queue() -> dict[str, Any]:
    jobs = _lite_debug_jobs(40)
    candidates = []
    reloads = []
    kernels = []
    kernel_feats = {"prompt.run", "cad.gen_step", "cad.generate"}
    for job in jobs:
        extra = job.get("extra") or {}
        if extra.get("sam_confirmed") or job.get("status") == "sam_confirmed":
            continue
        rec = str(job.get("recommendation") or extra.get("recommendation") or "")
        feat = str(job.get("feature_id") or job.get("feature") or "")
        row = {
            "id": job.get("id"),
            "feature": feat,
            "status": job.get("status"),
            "recommendation": rec,
            "candidate_confirm": bool(job.get("candidate_confirm")),
            "agent_id": job.get("agent_id") or extra.get("claimed_by") or "",
        }
        if job.get("candidate_confirm"):
            row["gate"] = "candidate_confirm"
            candidates.append(row)
            continue
        if rec in {"pending_reload", "reload", "pending-reload"}:
            row["gate"] = "pending_reload"
            reloads.append(row)
            continue
        if rec == "replace-approach" or feat in kernel_feats:
            row["gate"] = "replace-approach"
            kernels.append(row)
    reports = _lite_rows("SELECT id, agent_id, recommendation, status FROM agent_reports WHERE status='pending_sam' LIMIT 30")
    payload = {
        "ok": True,
        "title": "SAM-QUEUE",
        "goal": "OPEN",
        "auto_fire": False,
        "breakage_zero": False,
        "confirm_none": True,
        "lite": True,
        "how": "Read ai-context/debugger/swarm-reports/sam-queue-latest.md. Confirm candidate in Debugger or scripts/confirm-candidate.py {job_id}. Do not confirm_fixed.",
        "candidate_confirm": candidates,
        "pending_reload": reloads,
        "replace_approach": kernels,
        "pending_sam": reports,
        "liabilities": _lite_liabilities(),
        "counts": {
            "candidate_confirm": len(candidates),
            "pending_reload": len(reloads),
            "replace_approach": len(kernels),
            "pending_sam": len(reports),
        },
        "files": [
            "ai-context/debugger/swarm-reports/sam-queue-latest.md",
            "ai-context/debugger/swarm-reports/sam-queue-latest.json",
        ],
    }
    root = REPO / "ai-context" / "debugger" / "swarm-reports"
    try:
        root.mkdir(parents=True, exist_ok=True)
        (root / "sam-queue-latest.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        lines = ["# SAM-QUEUE", "", "Goal **OPEN**. `auto_fire=false`. `breakage_zero=false`.", ""]
        for title, rows in (
            ("candidate_confirm", candidates),
            ("pending_reload", reloads),
            ("replace-approach", kernels),
            ("pending_sam", reports),
        ):
            lines.append(f"## {title}")
            if not rows:
                lines.append("- none")
            for row in rows:
                lines.append(f"- `{row.get('id')}` `{row.get('feature') or row.get('recommendation') or ''}`")
            lines.append("")
        (root / "sam-queue-latest.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError:
        pass
    return payload


def _lite_swarm_summary() -> dict[str, Any]:
    periods = ["daily", "weekly", "monthly", "yearly"]
    categories = [
        "networking", "controllers", "memory_leaks", "time_to_complete",
        "optimization", "network_troubleshooting", "liabilities",
    ]
    rollups = _lite_rows("SELECT period, category, credit FROM period_rollups")
    by_period: dict[str, list[float]] = {p: [] for p in periods}
    by_cat: dict[str, list[float]] = {c: [] for c in categories}
    for row in rollups:
        period = str(row.get("period") or "")
        cat = str(row.get("category") or "")
        credit = float(row.get("credit") or 0)
        if period in by_period:
            by_period[period].append(credit)
        if cat in by_cat:
            by_cat[cat].append(credit)

    def _avg(vals: list[float]) -> float:
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    league_avgs: dict[str, list[float]] = {}
    for row in _lite_rows("SELECT agent_id, credit_score FROM agent_league ORDER BY ts DESC LIMIT 40"):
        aid = str(row.get("agent_id") or "")
        if aid:
            league_avgs.setdefault(aid, []).append(float(row.get("credit_score") or 0))
    return {
        "sam_queue": _lite_sam_queue(),
        "ok": True,
        "read_only": True,
        "auto_fire": False,
        "license": "dashboard-metric",
        "lite": True,
        "periods": periods,
        "categories": categories,
        "rollup_avgs": {p: _avg(by_period[p]) for p in periods},
        "category_avgs": {c: _avg(by_cat[c]) for c in categories},
        "instance_users": _lite_rows("SELECT user_id, instance_id, area_id FROM instance_users WHERE instance_id='501' LIMIT 8"),
        "area": "501",
        "league_avgs": {aid: _avg(vals) for aid, vals in league_avgs.items()},
        "pending_sam": _lite_rows("SELECT id, agent_id, recommendation, status FROM agent_reports WHERE status='pending_sam' LIMIT 12"),
        "claimed_jobs": [_lite_job_flag(r) for r in _lite_rows("SELECT id, tracking_id, feature_id AS feature, status, category, extra_json FROM debug_jobs WHERE status='claimed' LIMIT 12")],
        "candidate_confirm": [j for j in _lite_debug_jobs(24) if j.get("candidate_confirm")],
        "liabilities": _lite_liabilities(),
    }


def _lite_job_flag(row: dict[str, Any]) -> dict[str, Any]:
    extra = row.get("extra_json") or row.get("extra") or {}
    if isinstance(extra, str):
        try:
            extra = json.loads(extra or "{}")
        except ValueError:
            extra = {}
    extra = extra if isinstance(extra, dict) else {}
    out = {k: v for k, v in row.items() if k != "extra_json"}
    out["candidate_confirm"] = bool(row.get("candidate_confirm") or extra.get("candidate_confirm"))
    out["test_verified"] = bool(row.get("test_verified") or extra.get("test_verified"))
    out["test_path"] = extra.get("test_path") or row.get("test_path") or ""
    out["executed"] = False
    return out


def _lite_debug_jobs(limit: int = 20) -> list[dict[str, Any]]:
    return [_lite_job_flag(r) for r in _lite_rows(
        "SELECT id, feature_id, category, agent_id, status, recommendation, tracking_id, log_path, extra_json FROM debug_jobs ORDER BY ts DESC LIMIT ?",
        (max(1, min(int(limit or 20), 40)),),
    )]


def _lite_cad_snapshots(limit: int = 20) -> dict[str, Any]:
    import json

    root = REPO / "ai-context" / "debugger" / "cad-snapshots"
    items: list[dict[str, Any]] = []
    if root.is_dir():
        for path in sorted(root.glob("*-latest.json"), reverse=True):
            try:
                row = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(row, dict):
                items.append(row)
            if len(items) >= max(1, min(int(limit or 20), 40)):
                break
    return {
        "ok": True,
        "read_only": True,
        "lite": True,
        "snapshots": items,
        "n": len(items),
        "dir": "ai-context/debugger/cad-snapshots",
        "auto_fire": False,
        "executed": False,
        "goal": "OPEN",
    }


def _lite_catalog() -> dict[str, Any]:
    return {
        "read_once": True,
        "lite": True,
        "area": "501",
        "cap": 160,
        "vector_db": "bad idea on the hot path; sqlite + Jaccard now; FTS5 later; Drive cold",
        "ids": {
            "log_id": "{chat8}-{n}",
            "tracking_id": "kind:id+kind:id cap 160 then ref:{id}",
            "area_id": "501.u{user}.p{project}.l{log}.a{agent}",
            "agent_id": "grok | cursor | harness | render-agent",
            "job_id": "job_{hex10} claimed never executed",
            "rpt_id": "rpt_{hex10} pending_sam",
            "recommendation": "fire | replace-approach | fix-few-issues | pending_reload",
            "cad_snapshots": "ai-context/debugger/cad-snapshots/{job_id}-latest",
            "stamp_feature": "offline allowlist stamp → incident + ingest, log_id stamp:{feature}:{day}:{status}, never kernel",
            "readonly_cli": "ls|pwd|date|wc|head|cat in-process jail; no shell",
            "candidate_confirm": "claimed/pending + later ok stamp; pending_sam; never confirm_fixed",
            "sam_confirmed": "Sam confirm-candidate status; executed=false; breakage_zero=false",
            "confirm_candidate": "grok_debugger action=confirm_candidate job_id required; sam-confirm:{job_id} score 55 daily; not breakage=0",
            "reject_candidate": "grok_debugger action=reject_candidate job_id required; no credit",
            "ingest_existing_incident_stamps": "credit existing seed-bucket incidents; never invents",
            "ingest_thumb_down_liability": "vote_export(down) → user.damage; never invents thumb",
            "ingest_prompt_result_liabilities": "PROMPT_RESULT scores → liabilities; low=user.damage high=credit; never invents",
            "ingest_job_clock_time_to_complete": "verified job clocks → time_to_complete; Sam-wait not a grok penalty; never invents clocks",
            "instance_registry": "swarm_instances + members; q=501 → users/projects/logs/agents; no vector DB",
            "ingest_shipped_hook_optimization": "SHIPPED_THIN_HOOKS → optimization; per-token leakfixN; skip kernel; not breakage=0",
            "ingest_http_network_troubleshooting": "real fetch/HTTP classes → network_troubleshooting; never invents",
            "write_league_underperform_report": "sqlite fire/replace/fix recs; never auto-fire; generate source is kernel-only",
            "stamp_design_build_error_if_missing": "router/main DesignBuildError → prompt.run if history missed; never kernel",
            "ingest_controller_stamps": "existing vr.controllers* stamps → controllers; never invents headset events",
            "ingest_networking_stamps": "existing network.latency/fetch stamps → networking; never invents events",
            "hours_open": "SAM-QUEUE wait age from claimed_at else mint ts; display only; Sam-wait is not a grok penalty",
            "cad_votes": "sqlite cad_votes; voter/subject/loop/verdict/reason/tracking_id; not a grok penalty",
            "cache_bust": "leakfix1 | leakfix4 | leakfix5 | leakfix6 | leakfix7 | leakfix8 | leakfix9 | leakfix10 | leakfix11 | modelsfix1 | candact1 | replguard1 | reloadguard1 | samqueue1 | samqueue2 | samqueue3 | testver1 | area5011 query tokens (not new id schemes)",
            "replace_approach_guard": "kernel/replace-approach jobs are not CURSOR_FIX claims; replacement_brief only",
            "pending_reload_guard": "Failed to fetch / connection-drop is PENDING_RELOAD, not CURSOR_FIX",
            "stamp_shipped_thin_hooks": "later-ok for SHIPPED_THIN_HOOKS → candidate_confirm; not breakage=0; never kernel",
            "sam_queue": "persistent SAM-QUEUE md+json; candidate_confirm + pending_reload + replace-approach + pending_sam first; never auto-confirm",
            "test_verified": "candidate_confirm + mapped focused test pass; not sam_confirmed; not breakage=0",
        },
        "skills": [
            {"name": "prompt-trace", "mints": "log_id"},
            {"name": "desired-result-score", "mints": "score tracking_id ref_*"},
            {"name": "incident-research", "mints": "events traceback_id"},
            {"name": "debugger-analytics", "mints": "search_ids bug_* swarm-summary claim cad_snapshots"},
            {"name": "debug-id-catalog", "mints": "agree"},
        ],
        "periods": ["daily", "weekly", "monthly", "yearly"],
        "categories": [
            "networking", "controllers", "memory_leaks", "time_to_complete",
            "optimization", "network_troubleshooting", "liabilities",
        ],
        "vision": {
            "sam": {"technical": 78, "desired_swarm": 52},
            "cursor": {"technical": 86, "desired_swarm": 70},
        },
        "approval": "skill_proposal still needs Sam. Full autonomy is not safe.",
        "auto_fire": False,
        "license": "dashboard-metric",
    }


def _lite_readonly(args: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    cmd = str((data or {}).get("command") or args.get("q") or "pwd").split()[:1]
    key = cmd[0] if cmd else "pwd"
    if key not in {"ls", "pwd", "date", "wc", "head", "cat"}:
        raise ValueError("readonly allowlist violated")
    try:
        return _dss().exec_readonly_cli(data or {"command": args.get("q") or "pwd"})
    except Exception:
        return {
            "id": "ro_lite",
            "status": "denied",
            "command_key": f"ro_{key}",
            "readonly": True,
            "ran": False,
            "lite": True,
            "shell": False,
            "auto_fire": False,
            "note": "venv required for jailed in-process read",
        }


def mark(payload: Any) -> dict[str, Any]:
    row = payload if isinstance(payload, dict) else {"data": payload}
    row = dict(row)
    row.setdefault("via", "local")
    row.setdefault("studio_down", True)
    row.setdefault("note", "Studio debugger-analytics 404 or unreachable; local sqlite/indexer. Restart render3d for HTTP.")
    return row


def fail_closed(action: str) -> None:
    raise RuntimeError(
        f"Studio down — {action} would run code, CLI, watchdog, or fire. Fail-closed. Queue stays pending_sam. Never auto-run."
    )


def local_read(action: str, args: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    try:
        dss = _dss()
        das = _das()
    except Exception:
        return _lite_read(action, args, data)
    q = str(args.get("q") or args.get("feature") or data.get("q") or "")
    limit = int(args.get("limit") or data.get("limit") or 20)
    if action in {"history", "history_ids"}:
        return mark(dss.history_search(q, limit=limit))
    if action == "history_get":
        return mark(dss.history_get(str(args.get("id") or args.get("log_id") or data.get("log_id") or "")))
    if action == "catalog":
        return mark(dss.catalog())
    if action == "search_ids":
        return mark(das.search_ids(q, limit=max(1, min(limit, 40))))
    if action == "credit":
        if data.get("rollup"):
            return mark(dss.rollup_all_periods())
        period = data.get("period") or args.get("q")
        return mark({"credits": dss.list_credit(period if period in dss.CREDIT_PERIODS else None), "periods": list(dss.CREDIT_PERIODS), "categories": list(dss.CREDIT_CATEGORIES)})
    if action == "league":
        return mark({"league": dss.list_league(), "underperform": dss.underperformers(), "reports": dss.list_reports(), "auto_fire": False})
    if action == "agree" and str(data.get("verdict") or args.get("q") or "") not in {"agree", "disagree"}:
        return mark({"reviews": dss.list_reviews(), "catalog": dss.catalog()})
    if action in {"metrics", "taxonomy"}:
        dms = _dms()
        return mark(dms.overview_addon() if action == "metrics" else dms.taxonomy())
    if action == "debug_jobs":
        jobs = dss.list_debug_jobs(int(args.get("limit") or data.get("limit") or 20))
        return mark({
            "jobs": jobs,
            "candidate_confirm": [j for j in jobs if j.get("candidate_confirm")],
            "auto_fire": False,
            "executed": False,
        })
    if action == "cad_snapshots":
        return mark(dss.list_cad_snapshots(int(args.get("limit") or data.get("limit") or 20)))
    if action == "swarm_summary":
        return mark(dss.swarm_summary())
    if action in {"instance_registry", "lookup_area", "resolve_instance"}:
        q = str(args.get("q") or data.get("q") or data.get("instance_id") or data.get("area_code") or data.get("area") or "")
        if data.get("list") or q in {"list", "*"}:
            return mark({"instances": dss.list_instances(), "how": dss.INSTANCE_REGISTRY_HOW, "vector_db": False})
        return mark(dss.resolve_instance({**data, "q": q or dss.LOCAL_AREA}))
    if action in {"cad_votes", "list_cad_votes"}:
        return mark({"cad_votes": dss.list_cad_votes(limit), "how": dss.CAD_VOTES_HOW, "penalty": False})
    raise ValueError(f"no local read for {action}")


def local_write(action: str, args: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    if action in EXECUTE_WRITES or (action == "blacklist" and data.get("action") == "restore"):
        fail_closed(action)
    try:
        dss = _dss()
        das = _das()
    except Exception:
        if action in {"readonly_cli", "cli_readonly"}:
            return mark(_lite_readonly(args, data or {}))
        if action == "catalog":
            return mark(_lite_catalog())
        if action in {"ingest_jsonl", "rollup_live"}:
            return mark({"ok": False, "reason": "venv python required for offline ingest", "lite": True, "auto_fire": False})
        if action == "stamp_feature":
            return mark({"ok": False, "reason": "venv python required for offline stamp", "lite": True, "auto_fire": False})
        if action in {"confirm_candidate", "reject_candidate"}:
            return mark({"ok": False, "reason": "venv python required for offline confirm/reject", "lite": True, "auto_fire": False, "breakage_zero": False})
        fail_closed(action)
    if action == "agree":
        body = dict(data or {})
        if not body.get("verdict"):
            body["verdict"] = args.get("q") or "agree"
        return mark(dss.agree(body))
    if action == "credit" and data:
        return mark(dss.record_credit(data))
    if action == "agent_report":
        return mark(dss.report_agent(data or {"agent_id": args.get("q") or "grok", "recommendation": "fix-few-issues"}))
    if action == "league_cycle":
        return mark(dss.league_cycle(data or {"agent_id": "grok", "peer_id": "cursor"}))
    if action in {"readonly_cli", "cli_readonly"}:
        return mark(dss.queue_readonly_cli(data or {"command": args.get("q") or "pwd"}))
    if action == "cli_request":
        body = data or {"command_key": args.get("q") or "journalctl_render3d"}
        key = str(body.get("command_key") or body.get("command") or "")
        if body.get("readonly") or key.startswith("ro_") or key.split()[:1] == ["ls"]:
            return mark(dss.queue_readonly_cli(body))
        return mark(das.request_cli(body))
    if action == "watchdog_draft":
        return mark(das.draft_watchdog(data or {"title": args.get("q") or "tmp watchdog"}))
    if action == "score" and data:
        return mark(das.record_score(data))
    if action in {"ingest_jsonl", "rollup_live"}:
        return mark(dss.ingest_offline_jsonl(data or {}))
    if action in {"credit_tick", "swarm_tick"}:
        return mark(dss.swarm_credit_tick(data or {}))
    if action == "claim_debug_job":
        return mark(dss.claim_debug_job(data or args or {}))
    if action == "stamp_feature":
        body = dict(data or {})
        if args.get("feature") and not body.get("feature"):
            body["feature"] = args.get("feature")
        if args.get("q") and not body.get("feature"):
            body["feature"] = args.get("q")
        return mark(dss.stamp_offline_feature(body))
    if action in {"confirm_candidate", "reject_candidate"}:
        job_id = str(args.get("job_id") or args.get("id") or (data or {}).get("job_id") or (data or {}).get("id") or "").strip()
        if not job_id:
            raise ValueError("job_id required")
        payload = {"job_id": job_id}
        if action == "reject_candidate":
            return mark(dss.reject_candidate(payload))
        return mark(dss.confirm_candidate(payload))
    if action in {"record_cad_vote", "cad_vote"}:
        body = dict(data or {})
        if args.get("q") and not body.get("verdict"):
            body["verdict"] = args.get("q")
        return mark(dss.record_cad_vote(body))
    fail_closed(action)
    raise RuntimeError("unreachable")
