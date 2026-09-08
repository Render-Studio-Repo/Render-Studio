"""Mac / host server performance monitor for the Management dashboard.

Stores agent heartbeats (CPU, memory, top processes, optional log snippets)
and always exposes a live snapshot of the local Studio host so the Servers tab
has data even before Mac agents are installed.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

STORE_NAME = "mac_server_monitor.json"
HISTORY_LIMIT = 90
PROCESS_LIMIT = 40
LOG_SNIPPET_LIMIT = 12_000
STALE_SECONDS = 45
LOCAL_HOST_ID = "studio-host"

_lock = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ts() -> float:
    return time.time()


def _store_path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / STORE_NAME


def _empty_store() -> dict[str, Any]:
    return {"servers": {}, "updated_at": _now_iso()}


def _load() -> dict[str, Any]:
    path = _store_path()
    if not path.is_file():
        return _empty_store()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _empty_store()
    if not isinstance(data, dict):
        return _empty_store()
    servers = data.get("servers")
    if not isinstance(servers, dict):
        data["servers"] = {}
    return data


def _save(data: dict[str, Any]) -> None:
    data["updated_at"] = _now_iso()
    path = _store_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _public_server(row: dict[str, Any], *, include_token_hint: bool = False) -> dict[str, Any]:
    latest = row.get("latest") if isinstance(row.get("latest"), dict) else {}
    seen_at = float(row.get("last_seen_ts") or 0)
    age = max(0.0, _now_ts() - seen_at) if seen_at else None
    online = bool(seen_at and age is not None and age <= STALE_SECONDS)
    out = {
        "id": row.get("id"),
        "name": row.get("name") or row.get("hostname") or "Server",
        "hostname": row.get("hostname") or "",
        "platform": row.get("platform") or latest.get("platform") or "unknown",
        "kind": row.get("kind") or "mac",
        "labels": list(row.get("labels") or []),
        "created_at": row.get("created_at"),
        "last_seen_at": row.get("last_seen_at"),
        "online": online,
        "stale_after_seconds": STALE_SECONDS,
        "age_seconds": round(age, 1) if age is not None else None,
        "latest": latest,
        "history": list(row.get("history") or [])[-HISTORY_LIMIT:],
    }
    if include_token_hint:
        out["token_hint"] = row.get("token_hint") or ""
        out["has_token"] = bool(row.get("token_hash"))
    return out


def list_servers(*, include_local: bool = True) -> list[dict[str, Any]]:
    with _lock:
        data = _load()
        rows = [_public_server(row) for row in data.get("servers", {}).values()]
    if include_local:
        rows.insert(0, local_host_snapshot())
    rows.sort(key=lambda r: (0 if r.get("online") else 1, str(r.get("name") or "").lower()))
    return rows


def get_server(server_id: str) -> dict[str, Any] | None:
    sid = str(server_id or "").strip()
    if not sid:
        return None
    if sid == LOCAL_HOST_ID:
        return local_host_snapshot()
    with _lock:
        data = _load()
        row = data.get("servers", {}).get(sid)
        if not row:
            return None
        return _public_server(row, include_token_hint=True)


def register_server(
    *,
    name: str,
    hostname: str = "",
    platform: str = "darwin",
    labels: list[str] | None = None,
) -> dict[str, Any]:
    clean_name = re.sub(r"\s+", " ", str(name or "").strip())[:80] or "Mac server"
    token = secrets.token_urlsafe(32)
    server_id = secrets.token_hex(8)
    row = {
        "id": server_id,
        "name": clean_name,
        "hostname": str(hostname or "").strip()[:120],
        "platform": str(platform or "darwin").strip().lower()[:40] or "darwin",
        "kind": "mac",
        "labels": [str(x).strip()[:40] for x in (labels or []) if str(x).strip()][:8],
        "created_at": _now_iso(),
        "token_hash": _hash_token(token),
        "token_hint": f"…{token[-6:]}",
        "last_seen_at": None,
        "last_seen_ts": None,
        "latest": {},
        "history": [],
    }
    with _lock:
        data = _load()
        data.setdefault("servers", {})[server_id] = row
        _save(data)
    public = _public_server(row, include_token_hint=True)
    public["ingest_token"] = token
    public["agent_command"] = (
        f"python3 scripts/mac-server-agent.py "
        f"--base-url https://render3d.app "
        f"--server-id {server_id} "
        f"--token {token}"
    )
    return public


def revoke_server(server_id: str) -> bool:
    sid = str(server_id or "").strip()
    if not sid or sid == LOCAL_HOST_ID:
        return False
    with _lock:
        data = _load()
        servers = data.get("servers") or {}
        if sid not in servers:
            return False
        del servers[sid]
        _save(data)
    return True


def rotate_token(server_id: str) -> dict[str, Any] | None:
    sid = str(server_id or "").strip()
    if not sid or sid == LOCAL_HOST_ID:
        return None
    token = secrets.token_urlsafe(32)
    with _lock:
        data = _load()
        row = (data.get("servers") or {}).get(sid)
        if not row:
            return None
        row["token_hash"] = _hash_token(token)
        row["token_hint"] = f"…{token[-6:]}"
        _save(data)
        public = _public_server(row, include_token_hint=True)
    public["ingest_token"] = token
    public["agent_command"] = (
        f"python3 scripts/mac-server-agent.py "
        f"--base-url https://render3d.app "
        f"--server-id {sid} "
        f"--token {token}"
    )
    return public


def _auth_server(server_id: str, token: str) -> dict[str, Any] | None:
    sid = str(server_id or "").strip()
    raw = str(token or "").strip()
    if not sid or not raw:
        return None
    with _lock:
        data = _load()
        row = (data.get("servers") or {}).get(sid)
        if not row:
            return None
        expected = str(row.get("token_hash") or "")
        if not expected or not hmac.compare_digest(expected, _hash_token(raw)):
            return None
        return row


def ingest_heartbeat(server_id: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    row = _auth_server(server_id, token)
    if not row:
        raise PermissionError("Invalid server id or ingest token")

    metrics = _normalize_metrics(payload)
    point = {
        "ts": _now_iso(),
        "cpu_percent": metrics.get("cpu_percent"),
        "mem_percent": metrics.get("mem_percent"),
        "load1": metrics.get("load1"),
    }
    with _lock:
        data = _load()
        stored = (data.get("servers") or {}).get(server_id)
        if not stored:
            raise PermissionError("Server was removed")
        if metrics.get("hostname"):
            stored["hostname"] = metrics["hostname"]
        if metrics.get("platform"):
            stored["platform"] = metrics["platform"]
        stored["last_seen_at"] = _now_iso()
        stored["last_seen_ts"] = _now_ts()
        stored["latest"] = metrics
        history = list(stored.get("history") or [])
        history.append(point)
        stored["history"] = history[-HISTORY_LIMIT:]
        _save(data)
        return _public_server(stored)


def _normalize_metrics(payload: dict[str, Any]) -> dict[str, Any]:
    processes = []
    for item in list(payload.get("processes") or [])[:PROCESS_LIMIT]:
        if not isinstance(item, dict):
            continue
        processes.append(
            {
                "pid": int(item.get("pid") or 0),
                "name": str(item.get("name") or item.get("comm") or "process")[:120],
                "cpu_percent": _clamp_pct(item.get("cpu_percent")),
                "mem_percent": _clamp_pct(item.get("mem_percent")),
                "mem_mb": _num(item.get("mem_mb")),
                "user": str(item.get("user") or "")[:60],
                "command": str(item.get("command") or item.get("cmdline") or "")[:220],
            }
        )
    processes.sort(key=lambda p: float(p.get("cpu_percent") or 0), reverse=True)

    logs = str(payload.get("logs") or payload.get("log_snippet") or "")
    if len(logs) > LOG_SNIPPET_LIMIT:
        logs = logs[-LOG_SNIPPET_LIMIT:]

    return {
        "collected_at": str(payload.get("collected_at") or _now_iso()),
        "hostname": str(payload.get("hostname") or "")[:120],
        "platform": str(payload.get("platform") or "")[:40],
        "arch": str(payload.get("arch") or "")[:40],
        "uptime_seconds": _num(payload.get("uptime_seconds")),
        "cpu_percent": _clamp_pct(payload.get("cpu_percent")),
        "cpu_count": int(payload.get("cpu_count") or 0) or None,
        "mem_percent": _clamp_pct(payload.get("mem_percent")),
        "mem_total_mb": _num(payload.get("mem_total_mb")),
        "mem_used_mb": _num(payload.get("mem_used_mb")),
        "mem_available_mb": _num(payload.get("mem_available_mb")),
        "swap_percent": _clamp_pct(payload.get("swap_percent")),
        "load1": _num(payload.get("load1")),
        "load5": _num(payload.get("load5")),
        "load15": _num(payload.get("load15")),
        "disk_percent": _clamp_pct(payload.get("disk_percent")),
        "disk_total_gb": _num(payload.get("disk_total_gb")),
        "disk_used_gb": _num(payload.get("disk_used_gb")),
        "processes": processes,
        "notes": str(payload.get("notes") or "")[:500],
        "logs": logs,
        "agent_version": str(payload.get("agent_version") or "")[:40],
    }


def _clamp_pct(value: Any) -> float | None:
    n = _num(value)
    if n is None:
        return None
    return round(max(0.0, min(100.0, n)), 1)


def _num(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def local_host_snapshot() -> dict[str, Any]:
    """Live metrics for the Studio machine (Linux production host)."""
    metrics = collect_local_metrics()
    return {
        "id": LOCAL_HOST_ID,
        "name": "Studio host",
        "hostname": metrics.get("hostname") or socket.gethostname(),
        "platform": metrics.get("platform") or "linux",
        "kind": "studio",
        "labels": ["local", "render3d"],
        "created_at": None,
        "last_seen_at": metrics.get("collected_at"),
        "online": True,
        "stale_after_seconds": STALE_SECONDS,
        "age_seconds": 0,
        "latest": metrics,
        "history": [],
        "is_local": True,
    }


def collect_local_metrics() -> dict[str, Any]:
    hostname = socket.gethostname()
    platform = os.uname().sysname.lower() if hasattr(os, "uname") else "linux"
    arch = os.uname().machine if hasattr(os, "uname") else ""
    cpus = os.cpu_count() or 1
    load1 = load5 = load15 = None
    try:
        load1, load5, load15 = os.getloadavg()
    except (AttributeError, OSError):
        pass

    mem = _linux_meminfo() if Path("/proc/meminfo").is_file() else {}
    disk = _disk_usage(Path(settings.data_dir))
    cpu_pct = _linux_cpu_percent()
    processes = _linux_top_processes(limit=PROCESS_LIMIT)

    total_mb = mem.get("total_mb")
    avail_mb = mem.get("available_mb")
    used_mb = None
    mem_pct = None
    if total_mb and avail_mb is not None:
        used_mb = max(0.0, total_mb - avail_mb)
        mem_pct = round((used_mb / total_mb) * 100.0, 1) if total_mb else None

    return {
        "collected_at": _now_iso(),
        "hostname": hostname,
        "platform": platform,
        "arch": arch,
        "uptime_seconds": _linux_uptime(),
        "cpu_percent": cpu_pct,
        "cpu_count": cpus,
        "mem_percent": mem_pct,
        "mem_total_mb": total_mb,
        "mem_used_mb": used_mb,
        "mem_available_mb": avail_mb,
        "swap_percent": mem.get("swap_percent"),
        "load1": load1,
        "load5": load5,
        "load15": load15,
        "disk_percent": disk.get("percent"),
        "disk_total_gb": disk.get("total_gb"),
        "disk_used_gb": disk.get("used_gb"),
        "processes": processes,
        "notes": "Live sample from the Render Studio host",
        "logs": "",
        "agent_version": "builtin-local",
    }


def _linux_meminfo() -> dict[str, float | None]:
    out: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if ":" not in line:
                continue
            key, rest = line.split(":", 1)
            parts = rest.strip().split()
            if not parts:
                continue
            try:
                out[key] = int(parts[0])  # kB
            except ValueError:
                continue
    except OSError:
        return {}
    total = out.get("MemTotal", 0)
    avail = out.get("MemAvailable", out.get("MemFree", 0))
    swap_total = out.get("SwapTotal", 0)
    swap_free = out.get("SwapFree", 0)
    swap_used = max(0, swap_total - swap_free)
    swap_pct = (swap_used / swap_total * 100.0) if swap_total else None
    return {
        "total_mb": round(total / 1024, 1) if total else None,
        "available_mb": round(avail / 1024, 1) if avail else None,
        "swap_percent": round(swap_pct, 1) if swap_pct is not None else None,
    }


def _linux_uptime() -> float | None:
    try:
        return float(Path("/proc/uptime").read_text(encoding="utf-8").split()[0])
    except (OSError, ValueError, IndexError):
        return None


def _disk_usage(path: Path) -> dict[str, float | None]:
    try:
        st = os.statvfs(path)
    except OSError:
        return {}
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    used = total - free
    pct = (used / total * 100.0) if total else None
    return {
        "total_gb": round(total / (1024**3), 1) if total else None,
        "used_gb": round(used / (1024**3), 1) if used else None,
        "percent": round(pct, 1) if pct is not None else None,
    }


_cpu_sample_lock = threading.Lock()
_cpu_sample: tuple[float, float, float] | None = None  # (wall, idle, total)


def _read_proc_stat() -> tuple[float, float] | None:
    try:
        line = Path("/proc/stat").read_text(encoding="utf-8").splitlines()[0]
    except OSError:
        return None
    parts = line.split()
    if len(parts) < 5 or parts[0] != "cpu":
        return None
    try:
        nums = [float(x) for x in parts[1:8]]
    except ValueError:
        return None
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0.0)
    total = sum(nums)
    return idle, total


def _linux_cpu_percent() -> float | None:
    global _cpu_sample
    sample = _read_proc_stat()
    if not sample:
        return None
    idle, total = sample
    wall = time.time()
    with _cpu_sample_lock:
        prev = _cpu_sample
        _cpu_sample = (wall, idle, total)
    if not prev:
        time.sleep(0.12)
        sample2 = _read_proc_stat()
        if not sample2:
            return None
        idle2, total2 = sample2
        didle = idle2 - idle
        dtotal = total2 - total
    else:
        _, prev_idle, prev_total = prev
        didle = idle - prev_idle
        dtotal = total - prev_total
    if dtotal <= 0:
        return None
    busy = max(0.0, 1.0 - (didle / dtotal))
    return round(busy * 100.0, 1)


def _linux_top_processes(limit: int = 40) -> list[dict[str, Any]]:
    """Best-effort top processes via `ps` (works without psutil)."""
    try:
        out = subprocess.run(
            ["ps", "-eo", "pid,pcpu,pmem,rss,user,comm,args", "--sort=-pcpu"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if out.returncode != 0:
        return []
    rows: list[dict[str, Any]] = []
    for line in out.stdout.splitlines()[1:]:
        parts = line.strip().split(None, 6)
        if len(parts) < 6:
            continue
        try:
            pid = int(parts[0])
            cpu = float(parts[1])
            mem = float(parts[2])
            rss_kb = float(parts[3])
        except ValueError:
            continue
        user = parts[4]
        comm = parts[5]
        args = parts[6] if len(parts) > 6 else comm
        rows.append(
            {
                "pid": pid,
                "name": comm[:120],
                "cpu_percent": round(cpu, 1),
                "mem_percent": round(mem, 1),
                "mem_mb": round(rss_kb / 1024.0, 1),
                "user": user[:60],
                "command": args[:220],
            }
        )
        if len(rows) >= limit:
            break
    return rows


def build_cursor_prompt_context(server: dict[str, Any], *, focus: str = "", extra: str = "") -> str:
    latest = server.get("latest") if isinstance(server.get("latest"), dict) else {}
    procs = list(latest.get("processes") or [])[:20]
    proc_lines = "\n".join(
        f"- pid={p.get('pid')} cpu={p.get('cpu_percent')}% mem={p.get('mem_percent')}% "
        f"rss={p.get('mem_mb')}MB user={p.get('user')} cmd={p.get('command') or p.get('name')}"
        for p in procs
    ) or "- (no process samples)"
    logs = str(latest.get("logs") or "").strip()
    if len(logs) > 6000:
        logs = logs[-6000:]
    focus_text = str(focus or "").strip() or "Investigate performance / hot processes and propose fixes."
    extra_text = str(extra or "").strip()
    return f"""You are helping debug a Render Studio ops host from Management → Servers.

Server: {server.get('name')} ({server.get('id')})
Hostname: {server.get('hostname') or latest.get('hostname') or '—'}
Platform: {server.get('platform') or latest.get('platform') or '—'} · arch {latest.get('arch') or '—'}
Online: {server.get('online')} · sampled {latest.get('collected_at') or server.get('last_seen_at') or '—'}

Metrics
- CPU: {latest.get('cpu_percent')}% of {latest.get('cpu_count') or '?'} cores
- Memory: {latest.get('mem_percent')}% ({latest.get('mem_used_mb')} / {latest.get('mem_total_mb')} MB)
- Load: {latest.get('load1')} / {latest.get('load5')} / {latest.get('load15')}
- Disk: {latest.get('disk_percent')}% ({latest.get('disk_used_gb')} / {latest.get('disk_total_gb')} GB)
- Swap: {latest.get('swap_percent')}%
- Notes: {latest.get('notes') or '—'}

Top processes (live)
{proc_lines}

Operator focus
{focus_text}

{('Extra context\n' + extra_text) if extra_text else ''}

Recent logs / snippets
```
{logs or '(none attached)'}
```

Please:
1. Summarize what is burning CPU/RAM right now.
2. Call out likely stuck Render Studio / CAD / uvicorn / agent processes.
3. Give concrete shell checks and safe remediation steps.
4. If code changes are needed in this repo, propose a focused patch plan.
"""


def truncate_for_deeplink(text: str, *, max_url_len: int = 7800) -> str:
    """Keep prompt short enough for Cursor prompt deeplinks (~8k URL limit)."""
    prefix = "https://cursor.com/link/prompt?text="
    budget = max(500, max_url_len - len(prefix))
    # Rough percent-encoding expansion (~1.3x for mixed text).
    soft = int(budget / 1.35)
    raw = str(text or "")
    if len(raw) <= soft:
        return raw
    return (
        raw[: soft - 120].rstrip()
        + "\n\n[Truncated for Cursor deeplink — paste the full copied prompt if needed.]"
    )


def cursor_prompt_urls(prompt_text: str) -> dict[str, str]:
    from urllib.parse import quote

    clipped = truncate_for_deeplink(prompt_text)
    encoded = quote(clipped, safe="")
    return {
        "prompt": clipped,
        "cursor_protocol_url": f"cursor://anysphere.cursor-deeplink/prompt?text={encoded}",
        "cursor_web_url": f"https://cursor.com/link/prompt?text={encoded}",
        "truncated": clipped != prompt_text,
        "char_count": len(prompt_text),
        "deeplink_char_count": len(clipped),
    }
