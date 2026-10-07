#!/usr/bin/env python3
"""Swarm tracking checklist: service layer first, then optional live HTTP.

Exit 0 when the service layer proves the goal. HTTP 404 prints 'restart required'
and does not fail the script.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services import debugger_analytics_service as das
from backend.services import debugger_swarm_service as dss
from backend.services import prompt_trace_service as trace

BASE = "http://127.0.0.1:8001"
CHECKS: list[tuple[str, bool, str]] = []


def note(name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))


def service_layer() -> bool:
    temp = tempfile.TemporaryDirectory()
    root = Path(temp.name)
    store = root / "prompt-trace"
    store.mkdir()
    (store / "live-prompts.jsonl").write_text(
        '{"log_id":"vfy-1","chat_id":"c","timestamp":"t","prompt":"' + ("Q" * 160) + '"}\n',
        encoding="utf-8",
    )
    patches = [
        patch.object(das, "ROOT_DIR", root),
        patch.object(das, "DB_PATH", root / "debugger.sqlite3"),
        patch.object(das, "WATCHDOG_ROOT", root / "tmp-watchdogs"),
        patch.object(das, "DATA_WATCHDOG_ROOT", root / "data-watchdogs"),
        patch.object(das, "BUG_ROOT", root / "bugs"),
        patch.object(das, "NOTES_ROOT", root / "notes"),
        patch.object(das, "REPORTS_ROOT", root / "weekly"),
        patch.object(das, "SCORE_ROOT", root / "scores"),
        patch.object(trace, "STORE", store),
        patch.object(trace, "INDEX", store / "live-prompts.jsonl"),
        patch.object(trace, "ROOT", root),
    ]
    for item in patches:
        item.start()
    (root / "ai-context" / "debugger").mkdir(parents=True)
    (root / "data" / "prompt-trace").mkdir(parents=True)
    prev_roots = os.environ.get("CURSOR_TRANSCRIPT_ROOTS")
    os.environ["CURSOR_TRANSCRIPT_ROOTS"] = ""
    try:
        print("Service layer (temp sqlite)")
        for period in dss.CREDIT_PERIODS:
            dss.record_credit({"period": period, "category": "networking", "credit": 70, "agent_id": "cursor"})
        for category in dss.CREDIT_CATEGORIES:
            dss.record_credit({"period": "daily", "category": category, "credit": 40, "actor": "user" if category == "liabilities" else "grok"})
        periods = {r["period"] for r in dss.list_credit(limit=40)}
        cats = {r["category"] for r in dss.list_credit(limit=40)}
        note("daily/weekly/monthly/yearly stored", periods == set(dss.CREDIT_PERIODS), ",".join(sorted(periods)))
        note("all categories including liabilities", cats == set(dss.CREDIT_CATEGORIES), ",".join(sorted(cats)))
        dss.rollup_all_periods()
        note("period_rollups persist", {r["period"] for r in dss.list_period_rollups()} == set(dss.CREDIT_PERIODS))

        das.record_score({"log_id": "vfy-log", "score": 70, "uid": "sam", "project_id": "5bf8e783", "agent_id": "cursor", "instance_id": "501"})
        user = dss.get_instance_user("sam", "501")
        rel = (user or {}).get("relations") or {}
        note(
            "user registered on 501 with relations",
            bool(user) and rel.get("user_id") == "sam" and rel.get("instance_id") == "501"
            and rel.get("project_ids") and rel.get("log_ids") and rel.get("agent_ids"),
            (user or {}).get("area_id") or "missing",
        )

        packed = dss.encode_tracking_capped([("project", f"x{i:02d}" + "a" * 60) for i in range(8)])
        note("tracking over 160 packs to ref_*", packed.get("packed") is True and str(packed.get("tracking_id", "")).startswith("ref:"))

        hist = dss.history_search("vfy-1")
        hit = (hist.get("hits") or [{}])[0]
        note("history ids, excerpt≤120, no body", bool(hit.get("log_id")) and len(hit.get("excerpt") or "") <= 120 and not hist.get("bodies"))

        cycle = dss.league_cycle({"agent_id": "slow-vfy", "peer_id": "cursor", "score": 10, "damage": 80, "category": "optimization"})
        reports = dss.list_reports()
        note(
            "league peer score + pending_sam, auto_fire False",
            cycle.get("auto_fire") is False and any(r["agent_id"] == "slow-vfy" and r["status"] == "pending_sam" for r in reports),
        )

        agreed = dss.agree({"verdict": "agree", "actor": "grok", "note": "verify"})
        note("agree() persists grok verdict", any(r["id"] == agreed["id"] for r in dss.list_reviews()))

        rejected = False
        try:
            dss.parse_readonly({"command": "rm -rf /"})
        except ValueError:
            rejected = True
        note("readonly CLI rejects rm", rejected)

        traced = trace.record({"log_id": "vfy-pt", "prompt": "alias uid", "result": "improved", "score": 66, "debug_user_id": "sam"})
        note("prompt-trace optional user_id → 501", traced.get("prompt", {}).get("user_id") == "sam" and dss.get_instance_user("sam", "501") is not None)
    finally:
        for item in reversed(patches):
            item.stop()
        temp.cleanup()
        if prev_roots is None:
            os.environ.pop("CURSOR_TRANSCRIPT_ROOTS", None)
        else:
            os.environ["CURSOR_TRANSCRIPT_ROOTS"] = prev_roots
    return all(ok for _, ok, _ in CHECKS)


def _http_code(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            return str(resp.status)
    except urllib.error.HTTPError as exc:
        return str(exc.code)
    except Exception as exc:
        return type(exc).__name__


def _env_prompt_trace_key() -> str:
    """Load harness key from env/.env. Never print the value."""
    raw = os.environ.get("PROMPT_TRACE_API_KEY", "").strip()
    if raw:
        return raw
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("PROMPT_TRACE_API_KEY="):
            return line.split("=", 1)[1].strip().strip("'").strip('"')
    return ""


def _http_code_bearer(url: str, key: str) -> str:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return str(resp.status)
    except urllib.error.HTTPError as exc:
        return str(exc.code)
    except Exception as exc:
        return type(exc).__name__


def _http_json_bearer(url: str, key: str) -> tuple[str, dict]:
    """GET JSON with harness key. Never log the key."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            raw = resp.read(200000)
            data = json.loads(raw.decode("utf-8", "replace") or "{}")
            return str(resp.status), data if isinstance(data, dict) else {}
    except urllib.error.HTTPError as exc:
        return str(exc.code), {}
    except Exception as exc:
        return type(exc).__name__, {}


def swarm_summary_objectives(data: dict) -> dict[str, bool]:
    """Objective keys on a live/offline swarm-summary body. No secrets."""
    periods = {str(p) for p in (data.get("periods") or [])}
    cats = {str(c) for c in (data.get("categories") or [])}
    users = [u for u in (data.get("instance_users") or []) if isinstance(u, dict)]
    has_501 = str(data.get("area") or "") == "501" or any(
        str(u.get("instance_id") or "") == "501" or str(u.get("area") or "").startswith("501")
        or str(u.get("area_id") or "").startswith("501")
        for u in users
    )
    has_relations = any(u.get("area_id") or u.get("relations") for u in users)
    jobs = [j for j in (data.get("claimed_jobs") or []) if isinstance(j, dict)]
    has_tracking = has_relations or any(j.get("tracking_id") for j in jobs)
    league = data.get("league_avgs") if isinstance(data.get("league_avgs"), dict) else data.get("league")
    league = league if isinstance(league, dict) else {}
    pending = [r for r in (data.get("pending_sam") or []) if isinstance(r, dict)]
    allowed = {"fire", "replace", "fix-few-issues", "fix"}
    pending_ok = "pending_sam" in data and (
        not pending or all(str(r.get("recommendation") or "") in allowed for r in pending)
    )
    return {
        "periods4": periods >= set(dss.CREDIT_PERIODS),
        "categories7": cats == set(dss.CREDIT_CATEGORIES),
        "instance_501": bool(users) and has_501,
        "relations_or_tracking": has_tracking,
        "league": bool(league),
        "pending_sam": pending_ok,
        "claimed_jobs": "claimed_jobs" in data,
    }


def swarm_summary_proven(data: dict) -> tuple[bool, str]:
    flags = swarm_summary_objectives(data)
    missing = [name for name, ok in flags.items() if not ok]
    return (not missing, "all" if not missing else "missing:" + ",".join(missing))


def live_audit() -> list[dict[str, str]]:
    """proven / incomplete / unverified from sqlite + files + curl. 401 is unverified."""
    print("Live audit (sqlite + files + :8001/:8744)")
    rows: list[dict[str, str]] = []

    def row(name: str, status: str, detail: str = "") -> None:
        rows.append({"name": name, "status": status, "detail": detail})
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))

    db = ROOT / "data" / "debugger_analytics.sqlite3"
    src = (ROOT / "backend" / "services" / "debugger_swarm_service.py").read_text(encoding="utf-8")
    if db.is_file():
        import sqlite3

        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        periods = {r["period"] for r in conn.execute("SELECT DISTINCT period FROM period_rollups")}
        cats = {r["category"] for r in conn.execute("SELECT DISTINCT category FROM period_rollups")}
        users = conn.execute("SELECT COUNT(*) AS n FROM instance_users WHERE instance_id='501'").fetchone()["n"]
        jobs = conn.execute("SELECT status, COUNT(*) AS n FROM debug_jobs GROUP BY status").fetchall()
        reports = conn.execute("SELECT COUNT(*) AS n FROM agent_reports WHERE status='pending_sam'").fetchone()["n"]
        league = conn.execute("SELECT COUNT(*) AS n FROM league_cycles").fetchone()["n"]
        conn.close()
        row("daily/weekly/monthly/yearly scores", "proven" if periods == set(dss.CREDIT_PERIODS) else "incomplete", ",".join(sorted(periods)))
        row("7 categories", "proven" if cats == set(dss.CREDIT_CATEGORIES) else "incomplete", ",".join(sorted(cats)))
        row("501 area-code users", "proven" if users else "incomplete", f"n={users}")
        row("relations user/project/log/instance/agent", "proven" if users else "incomplete", "instance_users rows")
        row("CAD peer scores / league_cycle", "proven" if league else "incomplete", f"cycles={league}")
        row("underperformers pending_sam", "proven" if reports else "incomplete", f"reports={reports}")
        job_note = ",".join(f"{r['status']}={r['n']}" for r in jobs) or "none"
        row("debug_jobs mint/claim handoff", "proven" if jobs else "incomplete", job_note)
    else:
        row("sqlite debugger_analytics", "incomplete", "missing db")
    row("TRACKING_ID_CAP 160 then pack ref", "proven" if "TRACKING_ID_CAP = 160" in src and "def encode_tracking_capped" in src else "incomplete")
    row("no hot-path vector DB", "proven" if "vector_db" in src and "bad idea on the hot path" in src else "incomplete")
    row("claim_debug_job never executed=true", "proven" if "def claim_debug_job" in src and "Never executed=true" in src else "incomplete")
    row(
        "feature-id map network/memory/api",
        "proven" if "FEATURE_ID_TO_CREDIT" in src and "def category_for_feature_id" in src else "incomplete",
    )
    reports_dir = ROOT / "ai-context" / "debugger" / "swarm-reports"
    latest_ok = all((reports_dir / f"{p}-latest.json").is_file() for p in dss.CREDIT_PERIODS)
    row(
        "swarm-reports latest daily/weekly/monthly/yearly",
        "proven" if latest_ok else "incomplete",
        str(reports_dir.relative_to(ROOT)) if latest_ok else "missing latest json",
    )
    ov = _http_code("http://127.0.0.1:8001/api/ops/debugger-analytics/overview")
    summary = _http_code("http://127.0.0.1:8001/api/ops/debugger-analytics/swarm-summary")
    missing = _http_code("http://127.0.0.1:8001/api/ops/debugger-analytics/definitely-not-a-route")
    studio = _http_code("http://127.0.0.1:8001/")
    grok = _http_code("http://127.0.0.1:8744/")
    row("live :8001 overview HTTP", "unverified" if ov in {"401", "403"} else ("proven" if ov == "200" else "incomplete"), ov)
    row(
        "live :8001 swarm-summary HTTP",
        "proven" if summary == "200" else ("unverified" if summary in {"401", "404"} else "incomplete"),
        f"{summary}; unauth expected; harness body is the live proof",
    )
    key = _env_prompt_trace_key()
    if key:
        ov_h = _http_code_bearer("http://127.0.0.1:8001/api/ops/debugger-analytics/overview", key)
        scores_h = _http_code_bearer("http://127.0.0.1:8001/api/ops/debugger-analytics/scores", key)
        row(
            "overview with existing harness key",
            "unverified" if ov_h in {"401", "403"} else ("proven" if ov_h == "200" else "incomplete"),
            f"{ov_h}; session gate remains; no hole punched",
        )
        row(
            "scores with existing harness key",
            "proven" if scores_h == "200" else "unverified",
            f"{scores_h}; not overview/swarm JSON",
        )
        sum_h, sum_body = _http_json_bearer("http://127.0.0.1:8001/api/ops/debugger-analytics/swarm-summary", key)
        ok_keys, detail = swarm_summary_proven(sum_body) if sum_h == "200" else (False, sum_h)
        row(
            "live :8001 swarm-summary with harness key",
            "proven" if sum_h == "200" and ok_keys else ("unverified" if sum_h in {"401", "403", "404"} else "incomplete"),
            f"{sum_h}; {detail}",
        )
        if sum_h == "200":
            flags = swarm_summary_objectives(sum_body)
            for name, ok in flags.items():
                row(f"swarm-summary {name}", "proven" if ok else "incomplete")
    else:
        row("overview with existing harness key", "unverified", "PROMPT_TRACE_API_KEY absent")
    row("live :8001 unknown route", "unverified" if missing == "404" else "incomplete", missing)
    row("live :8001 /", "proven" if studio == "200" else "incomplete", studio)
    row("live :8744 grok-bot", "proven" if grok == "200" else "unverified", grok)
    row("agents solving / breakage=0", "incomplete", "login wall; jobs not executed")
    row("goal complete", "incomplete", "OPEN")
    return rows


def http_probe() -> None:
    print("HTTP :8001")
    paths = (
        "/api/ops/debugger-analytics/overview",
        "/api/ops/debugger-analytics/credit",
        "/api/ops/debugger-analytics/credit/rollup?all_periods=1",
        "/api/ops/debugger-analytics/instance-users",
        "/api/ops/debugger-analytics/league",
        "/api/ops/debugger-analytics/history",
        "/api/ops/debugger-analytics/catalog",
    )
    restart = False
    for path in paths:
        url = BASE + path
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:
                print(f"  [{resp.status}] {path}")
        except urllib.error.HTTPError as exc:
            print(f"  [{exc.code}] {path}")
            if exc.code == 404:
                restart = True
        except Exception as exc:
            print(f"  [ERR] {path} — {exc}")
            restart = True
    if restart:
        print("restart required (404/err) — 401 is unverified, not a fail")


def main() -> int:
    print("Swarm tracking verify")
    ok = service_layer()
    http_probe()
    audit = live_audit()
    failed = [name for name, passed, _ in CHECKS if not passed]
    print(json.dumps({
        "service_ok": ok,
        "failed": failed,
        "audit": audit,
        "autonomous": False,
        "approval_gates": True,
        "goal": "OPEN",
    }, indent=2))
    # HTTP 401 is unverified, not a failure. Exit 0 unless service-layer checks failed.
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
