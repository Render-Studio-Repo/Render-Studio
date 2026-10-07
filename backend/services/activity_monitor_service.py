"""Activity Monitor — host metrics, log dumps, user bug intake, Sam email alerts.

Dumps live under ``serverlogs/Activity monitor/`` (local + user-inbox).
User-facing payloads are scrubbed — no env secrets, tokens, or absolute host paths.
"""

from __future__ import annotations

import html
import json
import logging
import os
import platform
import re
import shutil
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from backend.config import ROOT_DIR, settings

logger = logging.getLogger("render3d.activity_monitor")

ACTIVITY_ROOT = ROOT_DIR / "serverlogs" / "Activity monitor"
LOCAL_DIR = ACTIVITY_ROOT / "local"
USER_INBOX = ACTIVITY_ROOT / "user-inbox"
USER_SENT = ACTIVITY_ROOT / "user-sent"
ISSUES_DIR = ACTIVITY_ROOT / "issues"
METRICS_RING = LOCAL_DIR / "metrics-ring.jsonl"
PROCESSED_MARKER = USER_INBOX / ".processed.json"

LOG_TYPES = (
    "backend",
    "networking",
    "ram",
    "cpu",
    "app",
    "generations",
    "uvicorn",
    "cloudflare",
)

SAM_EMAIL = "sam@render3d.app"
DISPLAY_TZ = ZoneInfo("America/New_York")

_SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|token|secret|password|authorization|bearer|sk-|ghp_|github_pat_)\s*[:=]\s*\S+"
)
_EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)

_watcher_started = False
_watcher_lock = threading.Lock()


def ensure_dirs() -> None:
    for path in (ACTIVITY_ROOT, LOCAL_DIR, USER_INBOX, USER_SENT, ISSUES_DIR):
        path.mkdir(parents=True, exist_ok=True)
    readme = ACTIVITY_ROOT / "README.md"
    if not readme.is_file():
        readme.write_text(
            "# Activity monitor\n\n"
            "- `local/` — server PC dumps (CPU/RAM/logs) for management Analyze\n"
            "- `user-inbox/` — incoming scrubbed user reports (watcher emails Sam)\n"
            "- `user-sent/` — archived after email\n"
            "- `issues/` — GitHub issue metadata copies\n",
            encoding="utf-8",
        )


def format_local_stamp(dt: datetime | None = None) -> str:
    when = (dt or datetime.now(timezone.utc)).astimezone(DISPLAY_TZ)
    try:
        return when.strftime("%-m-%-d-%Y %-I:%M %p")
    except ValueError:
        return when.strftime("%m-%d-%Y %I:%M %p").lstrip("0").replace(" 0", " ", 1)


def scrub_text(text: str, *, max_chars: int = 12000) -> str:
    cleaned = _SECRET_RE.sub(r"\1=[redacted]", text or "")
    cleaned = _EMAIL_RE.sub("[email]", cleaned)
    cleaned = cleaned.replace(str(ROOT_DIR), "[repo]")
    cleaned = cleaned.replace(str(Path.home()), "[home]")
    return cleaned[:max_chars]


def collect_snapshot() -> dict[str, Any]:
    ensure_dirs()
    try:
        from backend.services.capacity_alert_service import collect_snapshot as capacity_snap

        snap = capacity_snap()
        data = {
            "collected_at": getattr(snap, "collected_at", None) or getattr(snap, "collected_at", None),
            "hostname": getattr(snap, "hostname", None) or getattr(snap, "hostname", socket.gethostname()),
            "cpus": getattr(snap, "cpus", os.cpu_count() or 1),
            "mem_total_mb": getattr(snap, "mem_total_mb", None) or getattr(snap, "mem_total_mb", 0),
            "mem_available_mb": getattr(snap, "mem_available_mb", None) or getattr(snap, "mem_available_mb", 0),
            "mem_used_pct": getattr(snap, "mem_used_pct", None) or getattr(snap, "mem_used_pct", 0),
            "swap_total_mb": getattr(snap, "swap_total_mb", 0),
            "swap_used_mb": getattr(snap, "swap_used_mb", 0),
            "swap_used_pct": getattr(snap, "swap_used_pct", 0),
            "load1": getattr(snap, "load1", None) or getattr(snap, "load1", 0),
            "load5": getattr(snap, "load5", 0),
            "load15": getattr(snap, "load15", 0),
            "disk_total_gb": getattr(snap, "disk_total_gb", 0),
            "disk_used_gb": getattr(snap, "disk_used_gb", 0),
            "disk_used_pct": getattr(snap, "disk_used_pct", 0),
            "running_generations": getattr(snap, "running_generations", 0),
            "estab_connections_8001": getattr(snap, "estab_connections_8001", 0),
            "level": getattr(snap, "level", "ok"),
            "reasons": list(getattr(snap, "reasons", None) or []),
            "source": "capacity_alert_service",
        }
    except Exception:
        data = _collect_host_metrics_native()

    data["mac_health"] = _tail_mac_health(8)
    data["app"] = _app_process_hints()
    append_metrics_sample(data)
    return data


def _collect_host_metrics_native() -> dict[str, Any]:
    """macOS / generic fallback when /proc-based capacity sampler is unavailable."""
    cpus = os.cpu_count() or 1
    load1 = load5 = load15 = 0.0
    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        pass

    mem_total_mb = mem_available_mb = 0
    mem_used_pct = 0.0
    swap_total_mb = swap_used_mb = 0
    swap_used_pct = 0.0
    if platform.system() == "Darwin":
        mem_total_mb, mem_available_mb, mem_used_pct, swap_total_mb, swap_used_mb, swap_used_pct = _darwin_memory()
    else:
        # Best-effort via `free` if present
        try:
            out = subprocess.check_output(["free", "-m"], text=True, timeout=2)
            for line in out.splitlines():
                if line.lower().startswith("mem:"):
                    parts = line.split()
                    mem_total_mb = int(parts[1])
                    used = int(parts[2])
                    mem_available_mb = int(parts[6]) if len(parts) > 6 else max(0, mem_total_mb - used)
                    mem_used_pct = round(100.0 * used / mem_total_mb, 1) if mem_total_mb else 0.0
                if line.lower().startswith("swap:"):
                    parts = line.split()
                    swap_total_mb = int(parts[1])
                    swap_used_mb = int(parts[2])
                    swap_used_pct = round(100.0 * swap_used_mb / swap_total_mb, 1) if swap_total_mb else 0.0
        except Exception:
            pass

    disk_total_gb = disk_used_gb = disk_used_pct = 0.0
    try:
        usage = shutil.disk_usage(str(ROOT_DIR))
        disk_total_gb = round(usage.total / (1024**3), 1)
        disk_used_gb = round(usage.used / (1024**3), 1)
        disk_used_pct = round(100.0 * usage.used / usage.total, 1) if usage.total else 0.0
    except Exception:
        pass

    level = "ok"
    reasons: list[str] = []
    if mem_used_pct >= 88:
        level = "critical"
        reasons.append(f"RAM nearing limit ({mem_used_pct}%)")
    elif mem_used_pct >= 80:
        level = "warn"
        reasons.append(f"High RAM use ({mem_used_pct}%)")
    if load1 >= cpus * 2.0:
        level = "critical" if load1 >= cpus * 3.5 else ("warn" if level == "ok" else level)
        reasons.append(f"Load average high ({load1:.2f} on {cpus} CPUs)")

    return {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "hostname": socket.gethostname(),
        "cpus": cpus,
        "mem_total_mb": mem_total_mb,
        "mem_available_mb": mem_available_mb,
        "mem_used_pct": mem_used_pct,
        "swap_total_mb": swap_total_mb,
        "swap_used_mb": swap_used_mb,
        "swap_used_pct": swap_used_pct,
        "load1": round(load1, 2),
        "load5": round(load5, 2),
        "load15": round(load15, 2),
        "disk_total_gb": disk_total_gb,
        "disk_used_gb": disk_used_gb,
        "disk_used_pct": disk_used_pct,
        "running_generations": _running_generations(),
        "estab_connections_8001": 0,
        "level": level,
        "reasons": reasons,
        "source": "native",
    }


def _darwin_memory() -> tuple[int, int, float, int, int, float]:
    total = 0
    try:
        total = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True, timeout=2).strip())
    except Exception:
        total = 0
    page_size = 4096
    try:
        page_size = int(subprocess.check_output(["pagesize"], text=True, timeout=2).strip())
    except Exception:
        pass
    stats: dict[str, int] = {}
    try:
        raw = subprocess.check_output(["vm_stat"], text=True, timeout=2)
        for line in raw.splitlines():
            if ":" not in line:
                continue
            key, val = line.split(":", 1)
            digits = "".join(ch for ch in val if ch.isdigit())
            if digits:
                stats[key.strip()] = int(digits)
    except Exception:
        pass
    free = (stats.get("Pages free", 0) + stats.get("Pages speculative", 0)) * page_size
    # Prefer available ≈ free + inactive + purgeable
    available = free + (stats.get("Pages inactive", 0) + stats.get("Pages purgeable", 0)) * page_size
    if total <= 0:
        return 0, 0, 0.0, 0, 0, 0.0
    used_pct = round(max(0.0, (1.0 - (available / total)) * 100.0), 1)
    mem_total_mb = total // (1024 * 1024)
    mem_available_mb = available // (1024 * 1024)

    swap_total_mb = swap_used_mb = 0
    try:
        sw = subprocess.check_output(["sysctl", "-n", "vm.swapusage"], text=True, timeout=2)
        # total = 2048.00M used = 898.50M free = 1149.50M
        def _m(label: str) -> float:
            m = re.search(rf"{label}\s*=\s*([\d.]+)M", sw)
            return float(m.group(1)) if m else 0.0

        swap_total_mb = int(_m("total"))
        swap_used_mb = int(_m("used"))
    except Exception:
        pass
    swap_pct = round(100.0 * swap_used_mb / swap_total_mb, 1) if swap_total_mb else 0.0
    return mem_total_mb, mem_available_mb, used_pct, swap_total_mb, swap_used_mb, swap_pct


def _running_generations() -> int:
    projects = Path(getattr(settings, "projects_dir", ROOT_DIR / "projects"))
    n = 0
    try:
        for gen in projects.glob("*/generation.json"):
            try:
                data = json.loads(gen.read_text(encoding="utf-8"))
            except Exception:
                continue
            if str(data.get("status") or "").lower() in {"running", "queued", "pending"}:
                n += 1
    except Exception:
        return 0
    return n


def user_safe_snapshot(snap: dict[str, Any] | None = None) -> dict[str, Any]:
    raw = snap or collect_snapshot()
    return {
        "collected_at": raw.get("collected_at"),
        "cpus": raw.get("cpus"),
        "mem_used_pct": raw.get("mem_used_pct"),
        "swap_used_pct": raw.get("swap_used_pct"),
        "load1": raw.get("load1"),
        "disk_used_pct": raw.get("disk_used_pct"),
        "running_generations": raw.get("running_generations"),
        "level": raw.get("level"),
        "reasons": list(raw.get("reasons") or [])[:4],
    }


def append_metrics_sample(snap: dict[str, Any]) -> None:
    ensure_dirs()
    row = {
        "t": time.time(),
        "mem_used_pct": snap.get("mem_used_pct"),
        "swap_used_pct": snap.get("swap_used_pct"),
        "load1": snap.get("load1"),
        "disk_used_pct": snap.get("disk_used_pct"),
        "running_generations": snap.get("running_generations"),
        "estab_connections_8001": snap.get("estab_connections_8001"),
        "level": snap.get("level"),
    }
    with METRICS_RING.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    _trim_ring(METRICS_RING, keep=720)


def metrics_history(*, minutes: int = 60) -> list[dict[str, Any]]:
    ensure_dirs()
    if not METRICS_RING.is_file():
        return []
    cutoff = time.time() - max(1, int(minutes)) * 60
    out: list[dict[str, Any]] = []
    try:
        for line in METRICS_RING.read_text(encoding="utf-8", errors="ignore").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if float(row.get("t") or 0) >= cutoff:
                out.append(row)
    except OSError:
        return []
    return out[-480:]


def _trim_ring(path: Path, *, keep: int) -> None:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return
    if len(lines) <= keep:
        return
    path.write_text("\n".join(lines[-keep:]) + "\n", encoding="utf-8")


def _tail_mac_health(n: int = 8) -> list[dict[str, Any]]:
    path = Path.home() / "Library" / "Logs" / "mac-health" / "metrics.jsonl"
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()[-n:]
    except OSError:
        return []
    rows: list[dict[str, Any]] = []
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        rows.append(
            {
                "t": row.get("t") or row.get("ts") or row.get("time"),
                "mem_pct": row.get("mem_pct") or row.get("used_pct"),
                "pressure": row.get("pressure") or row.get("memory_pressure"),
                "note": scrub_text(str(row.get("note") or row.get("action") or ""))[:120],
            }
        )
    return rows


def _app_process_hints() -> dict[str, Any]:
    rss_mb = None
    try:
        import resource

        ru = resource.getrusage(resource.RUSAGE_SELF)
        if platform.system() == "Darwin":
            rss_mb = round((ru.ru_maxrss or 0) / (1024 * 1024), 1)
        else:
            rss_mb = round((ru.ru_maxrss or 0) / 1024, 1)
    except Exception:
        rss_mb = None
    return {"pid": os.getpid(), "workers_hint": "uvicorn", "self_rss_mb": rss_mb}


def _log_sources() -> dict[str, list[Path]]:
    logs = ROOT_DIR / "logs"
    return {
        "backend": [logs / "render3d-app.log", logs / "render3d-app.err.log"],
        "uvicorn": [logs / "uvicorn.log", logs / "uvicorn-restart.log"],
        "networking": [
            logs / "caddy.log",
            logs / "caddy.err.log",
            logs / "cloudflared.log",
            logs / "cloudflared.err.log",
        ],
        "cloudflare": [logs / "cloudflared.log", logs / "cloudflared.err.log"],
        "ram": [
            Path.home() / "Library" / "Logs" / "mac-health" / "actions.log",
            Path.home() / "Library" / "Logs" / "mac-health" / "panics.log",
        ],
        "cpu": [Path.home() / "Library" / "Logs" / "mac-health" / "metrics.jsonl"],
        "app": [logs / "render3d-app.log"],
        "generations": [ROOT_DIR / "ai-context" / "ops" / "Activity-monitor"],
    }


def _tail_file(path: Path, *, max_bytes: int = 24_000, since_ts: float | None = None) -> str:
    if path.is_dir():
        parts: list[str] = []
        try:
            files = sorted(
                [p for p in path.iterdir() if p.is_file() and p.suffix in {".md", ".log", ".jsonl", ".txt"}],
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )[:6]
        except OSError:
            return ""
        for f in files:
            if since_ts and f.stat().st_mtime < since_ts:
                continue
            parts.append(
                f"--- {f.name} ---\n{scrub_text(f.read_text(encoding='utf-8', errors='ignore'), max_chars=2000)}"
            )
        return "\n".join(parts)
    if not path.is_file():
        return ""
    try:
        if since_ts and path.stat().st_mtime < since_ts:
            return ""
        data = path.read_bytes()
    except OSError:
        return ""
    if len(data) > max_bytes:
        data = data[-max_bytes:]
    return scrub_text(data.decode("utf-8", errors="ignore"))


def collect_log_bundle(
    log_types: list[str] | None,
    *,
    window_minutes: int = 60,
    user_safe: bool = False,
) -> dict[str, str]:
    kinds = [k for k in (log_types or list(LOG_TYPES)) if k in LOG_TYPES]
    if not kinds:
        kinds = ["app", "ram", "cpu"]
    since = time.time() - max(1, int(window_minutes)) * 60
    sources = _log_sources()
    out: dict[str, str] = {}
    for kind in kinds:
        chunks: list[str] = []
        for path in sources.get(kind, []):
            text = _tail_file(path, max_bytes=10_000 if user_safe else 28_000, since_ts=since)
            if text.strip():
                chunks.append(f"### {path.name}\n{text}")
        out[kind] = "\n\n".join(chunks)[: (8000 if user_safe else 40000)] if chunks else "(no recent lines for this window)"
    return out


def dump_local(
    *,
    log_types: list[str] | None = None,
    window_minutes: int = 60,
    prompt: str = "",
    snap: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_dirs()
    snap = snap or collect_snapshot()
    bundle = collect_log_bundle(log_types, window_minutes=window_minutes, user_safe=False)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = LOCAL_DIR / f"dump-{stamp}.json"
    payload = {
        "kind": "local",
        "stamp_display": format_local_stamp(),
        "prompt": (prompt or "").strip()[:4000],
        "window_minutes": window_minutes,
        "log_types": list(bundle.keys()),
        "snapshot": snap,
        "logs": bundle,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    try:
        from backend.services import ops_log_service

        ops_log_service.write_note(
            "activity",
            f"dump mem={snap.get('mem_used_pct')}% load={snap.get('load1')} types={','.join(bundle.keys())}",
            f"Activity dump {stamp}",
        )
    except Exception:
        pass
    return {"ok": True, "path": str(path.relative_to(ROOT_DIR)), "stamp": stamp, "snapshot": snap}


def analyze_spike(
    *,
    prompt: str,
    log_types: list[str] | None = None,
    window_minutes: int = 60,
    dump: bool = True,
) -> dict[str, Any]:
    snap = collect_snapshot()
    dump_info = (
        dump_local(log_types=log_types, window_minutes=window_minutes, prompt=prompt, snap=snap) if dump else None
    )
    bundle = collect_log_bundle(log_types, window_minutes=window_minutes, user_safe=False)
    user_prompt = (prompt or "").strip() or (
        "What is causing the current performance spike? Identify likely root cause and a concrete fix."
    )
    analysis = _ai_analyze(
        system=(
            "You are Render Studio's Activity Monitor analyst. "
            "Given host metrics and scrubbed log excerpts, diagnose spikes. "
            "Reply JSON with keys: status, likely_cause, evidence, solution, severity (ok|warn|critical)."
        ),
        user=(
            f"Operator prompt:\n{user_prompt}\n\n"
            f"Snapshot:\n{json.dumps(snap, indent=2)[:6000]}\n\n"
            f"Logs:\n{json.dumps(bundle, indent=2)[:10000]}"
        ),
    )
    return {
        "ok": True,
        "analysis": analysis,
        "snapshot": snap,
        "dump": dump_info,
        "stamp_display": format_local_stamp(),
    }


def _ai_analyze(*, system: str, user: str) -> dict[str, Any]:
    try:
        from backend.services.ai_service import AIService

        key = (settings.openai_api_key or "").strip()
        if not key:
            return {
                "status": "needs_more_info",
                "likely_cause": "AI key not configured",
                "evidence": [],
                "solution": "Set OPENAI_API_KEY on the server to enable Analyze.",
                "severity": "warn",
            }
        ai = AIService(model="gpt-4o-mini", api_key=key, provider="openai")
        parsed, _trace = ai.chat_json(system, user, max_tokens=1200)
        return {
            "status": str(parsed.get("status") or "investigating")[:80],
            "likely_cause": str(parsed.get("likely_cause") or "")[:2000],
            "evidence": parsed.get("evidence") if isinstance(parsed.get("evidence"), list) else [],
            "solution": str(parsed.get("solution") or "")[:4000],
            "severity": str(parsed.get("severity") or "warn")[:40],
            "raw_ok": True,
        }
    except Exception as exc:
        logger.warning("activity analyze failed: %s", exc)
        return {
            "status": "needs_more_info",
            "likely_cause": "Analyzer error",
            "evidence": [str(exc)[:240]],
            "solution": "Retry Analyze or inspect the local dump under serverlogs/Activity monitor/local/.",
            "severity": "warn",
            "raw_ok": False,
        }


def submit_user_report(
    *,
    user: dict[str, Any],
    message: str,
    prompt: str = "",
    log_types: list[str] | None = None,
    window_minutes: int = 60,
    project_id: str | None = None,
    project_name: str | None = None,
    client_perf: dict[str, Any] | None = None,
    page_url: str | None = None,
    create_github_issue: bool = True,
) -> dict[str, Any]:
    ensure_dirs()
    snap = user_safe_snapshot()
    bundle = collect_log_bundle(log_types, window_minutes=window_minutes, user_safe=True)
    github_login = _github_login_for(str(user.get("id") or ""))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    display_stamp = format_local_stamp()
    payload = {
        "kind": "user",
        "stamp": stamp,
        "stamp_display": display_stamp,
        "user": {
            "id": user.get("id"),
            "email": user.get("email"),
            "display_name": user.get("display_name"),
            "github_login": github_login,
        },
        "message": (message or "").strip()[:6000],
        "prompt": (prompt or "").strip()[:4000],
        "log_types": list(bundle.keys()),
        "window_minutes": window_minutes,
        "project_id": project_id,
        "project_name": project_name,
        "page_url": page_url,
        "snapshot": snap,
        "client_perf": _scrub_client_perf(client_perf),
        "logs": bundle,
        "emailed": False,
        "github_issue": None,
    }
    inbox_path = USER_INBOX / f"report-{stamp}-{_slug(str(user.get('id') or 'anon'))}.json"
    inbox_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    analysis = _ai_analyze(
        system=(
            "You triage Render Studio user bug reports. "
            "Reply JSON: status, likely_cause, evidence, solution, severity."
        ),
        user=(
            f"User message:\n{payload['message']}\n\n"
            f"Analyze prompt:\n{payload['prompt']}\n\n"
            f"Safe metrics:\n{json.dumps(snap)}\n\n"
            f"Client perf:\n{json.dumps(payload['client_perf'])}\n\n"
            f"Log excerpts:\n{json.dumps(bundle)[:8000]}"
        ),
    )
    payload["analysis"] = analysis

    issue_info: dict[str, Any] | None = None
    if create_github_issue:
        from backend.services import github_issues_service

        issue_info = github_issues_service.create_bug_issue_with_ai_reply(
            title=_issue_title(payload["message"], project_name),
            reporter_login=github_login,
            reporter_email=str(user.get("email") or ""),
            stamp_display=display_stamp,
            message=payload["message"],
            prompt=payload["prompt"],
            project_name=project_name,
            log_types=list(bundle.keys()),
            analysis=analysis,
            snapshot=snap,
            client_perf=payload["client_perf"],
        )
        payload["github_issue"] = issue_info

    inbox_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    email_result = email_sam_about_report(payload)
    payload["emailed"] = bool(email_result.get("ok"))
    payload["email"] = email_result
    inbox_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if email_result.get("ok"):
        _archive_inbox_file(inbox_path)

    if issue_info and issue_info.get("html_url"):
        (ISSUES_DIR / f"issue-{stamp}.json").write_text(json.dumps(issue_info, indent=2) + "\n", encoding="utf-8")

    return {
        "ok": True,
        "stamp_display": display_stamp,
        "github_issue": issue_info,
        "analysis": analysis,
        "email": email_result,
        "dump": str(inbox_path.relative_to(ROOT_DIR)) if inbox_path.exists() else str((USER_SENT / inbox_path.name).relative_to(ROOT_DIR)),
    }


def email_sam_about_report(payload: dict[str, Any]) -> dict[str, Any]:
    from backend.services.email_notification_service import send_email

    user = payload.get("user") or {}
    issue = payload.get("github_issue") or {}
    analysis = payload.get("analysis") or {}
    subject = f"[Render Studio] Bug report from {user.get('display_name') or user.get('email') or 'user'}"
    issue_line = issue.get("html_url") or "(GitHub issue not created — set GITHUB_TOKEN + GITHUB_BUGS_REPO)"
    login = user.get("github_login") or ""
    text = (
        f"Someone submitted an Activity Monitor / bug report.\n\n"
        f"When: {payload.get('stamp_display')}\n"
        f"User: {user.get('display_name')} <{user.get('email')}> "
        f"{('@' + login) if login else ''}\n"
        f"Project: {payload.get('project_name') or '—'}\n"
        f"Log types: {', '.join(payload.get('log_types') or [])}\n"
        f"GitHub: {issue_line}\n\n"
        f"Message:\n{payload.get('message')}\n\n"
        f"Analyze prompt:\n{payload.get('prompt')}\n\n"
        f"AI: {analysis.get('likely_cause')}\n"
        f"Fix: {analysis.get('solution')}\n"
    )
    body = f"""
    <p><strong>Activity Monitor bug submission</strong></p>
    <ul>
      <li><strong>When:</strong> {html.escape(str(payload.get('stamp_display') or ''))}</li>
      <li><strong>User:</strong> {html.escape(str(user.get('display_name') or ''))}
        &lt;{html.escape(str(user.get('email') or ''))}&gt;
        {html.escape('@' + login if login else '')}</li>
      <li><strong>Project:</strong> {html.escape(str(payload.get('project_name') or '—'))}</li>
      <li><strong>Log types:</strong> {html.escape(', '.join(payload.get('log_types') or []))}</li>
      <li><strong>GitHub:</strong> <a href="{html.escape(str(issue_line))}">{html.escape(str(issue_line))}</a></li>
    </ul>
    <p><strong>Message</strong></p>
    <pre style="white-space:pre-wrap">{html.escape(str(payload.get('message') or ''))}</pre>
    <p><strong>Analyze prompt</strong></p>
    <pre style="white-space:pre-wrap">{html.escape(str(payload.get('prompt') or ''))}</pre>
    <p><strong>AI triage</strong></p>
    <p>{html.escape(str(analysis.get('likely_cause') or ''))}</p>
    <p>{html.escape(str(analysis.get('solution') or ''))}</p>
    """
    return send_email(
        to_email=SAM_EMAIL,
        subject=subject,
        text=text,
        html_body=body,
        category="ops",
        skip_preferences=True,
    )


def process_inbox_once() -> dict[str, Any]:
    ensure_dirs()
    processed = _load_processed()
    emailed = 0
    errors: list[str] = []
    for path in sorted(USER_INBOX.glob("report-*.json")):
        key = path.name
        if key in processed:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{key}: {exc}")
            continue
        if payload.get("emailed"):
            processed[key] = time.time()
            _archive_inbox_file(path)
            continue
        result = email_sam_about_report(payload)
        if result.get("ok"):
            payload["emailed"] = True
            payload["email"] = result
            path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            processed[key] = time.time()
            _archive_inbox_file(path)
            emailed += 1
        else:
            errors.append(f"{key}: {result.get('error')}")
    _save_processed(processed)
    return {"ok": True, "emailed": emailed, "errors": errors[:10]}


def ensure_inbox_watcher() -> None:
    global _watcher_started
    with _watcher_lock:
        if _watcher_started:
            return
        _watcher_started = True

    def _loop() -> None:
        while True:
            try:
                process_inbox_once()
            except Exception as exc:
                logger.warning("activity inbox watcher: %s", exc)
            time.sleep(45)

    threading.Thread(target=_loop, name="activity-inbox-watcher", daemon=True).start()
    logger.info("Activity Monitor inbox watcher started")


def list_local_dumps(*, limit: int = 30) -> list[dict[str, Any]]:
    ensure_dirs()
    rows: list[dict[str, Any]] = []
    for path in sorted(LOCAL_DIR.glob("dump-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        rows.append(
            {
                "name": path.name,
                "mtime": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
                "bytes": path.stat().st_size,
            }
        )
    return rows


def list_recent_issues(*, limit: int = 40) -> list[dict[str, Any]]:
    ensure_dirs()
    rows: list[dict[str, Any]] = []
    for path in sorted(ISSUES_DIR.glob("issue-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        rows.append(
            {
                "file": path.name,
                "number": data.get("number"),
                "html_url": data.get("html_url"),
                "title": data.get("title"),
                "created_at": data.get("created_at"),
                "ai_comment_url": data.get("ai_comment_url"),
            }
        )
    return rows


def _archive_inbox_file(path: Path) -> None:
    try:
        dest = USER_SENT / path.name
        path.replace(dest)
    except OSError:
        pass


def _load_processed() -> dict[str, Any]:
    if not PROCESSED_MARKER.is_file():
        return {}
    try:
        data = json.loads(PROCESSED_MARKER.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_processed(data: dict[str, Any]) -> None:
    items = sorted(data.items(), key=lambda kv: float(kv[1] or 0), reverse=True)[:500]
    PROCESSED_MARKER.write_text(json.dumps(dict(items), indent=2) + "\n", encoding="utf-8")


def _scrub_client_perf(perf: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(perf, dict):
        return {}
    allowed = {
        "fps_avg",
        "fps_min",
        "heap_used_mb",
        "heap_total_mb",
        "device_memory_gb",
        "hardware_concurrency",
        "connection_type",
        "viewport",
        "samples",
        "user_agent_short",
    }
    out = {k: perf[k] for k in allowed if k in perf}
    if "samples" in out and isinstance(out["samples"], list):
        out["samples"] = out["samples"][-60:]
    ua = str(perf.get("user_agent") or "")[:80]
    if ua:
        out["user_agent_short"] = ua
    return out


def _github_login_for(user_id: str) -> str:
    if not user_id:
        return ""
    try:
        from backend.services import github_link_service

        acct = github_link_service.linked_account(user_id)
        return str((acct or {}).get("login") or "").strip()
    except Exception:
        return ""


def _issue_title(message: str, project_name: str | None) -> str:
    base = (message or "Bug report").strip().splitlines()[0][:72]
    if project_name:
        return f"[Studio] {project_name}: {base}"
    return f"[Studio] {base}"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", (text or "x").lower())[:24].strip("-") or "x"
