#!/usr/bin/env python3
"""Lightweight Mac (or Linux) host agent for Render Studio Management → Servers.

Collects CPU / memory / top processes and POSTs heartbeats to the Studio API.

Example:
  python3 scripts/mac-server-agent.py \\
    --base-url https://render3d.app \\
    --server-id <id> \\
    --token <ingest_token>

Optional log tails:
  --log /var/log/system.log --log ~/Library/Logs/render3d-agent.log
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

AGENT_VERSION = "20260908-1"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run(cmd: list[str], timeout: float = 4.0) -> str:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return out.stdout if out.returncode == 0 else ""


def _num(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def collect_processes(limit: int = 40) -> list[dict[str, Any]]:
    # BSD/macOS ps supports -Ao; Linux also accepts it on recent util-linux.
    text = _run(["ps", "-Ao", "pid=,pcpu=,pmem=,rss=,user=,comm=,args=", "-r"])
    if not text.strip():
        text = _run(["ps", "-eo", "pid,pcpu,pmem,rss,user,comm,args", "--sort=-pcpu"])
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
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
        rows.append(
            {
                "pid": pid,
                "cpu_percent": round(cpu, 1),
                "mem_percent": round(mem, 1),
                "mem_mb": round(rss_kb / 1024.0, 1),
                "user": parts[4][:60],
                "name": parts[5][:120],
                "command": (parts[6] if len(parts) > 6 else parts[5])[:220],
            }
        )
        if len(rows) >= limit:
            break
    rows.sort(key=lambda r: float(r.get("cpu_percent") or 0), reverse=True)
    return rows


def collect_cpu_mem_macos() -> dict[str, Any]:
    # Sample CPU via top header.
    top = _run(["top", "-l", "2", "-n", "0", "-s", "1"], timeout=6.0)
    cpu_pct = None
    for line in reversed(top.splitlines()):
        if "CPU usage" in line or "CPU usage:" in line:
            # CPU usage: 12.34% user, 5.67% sys, 81.99% idle
            idle = None
            for part in line.replace(",", " ").split():
                if part.endswith("%") and "idle" in line[line.find(part) : line.find(part) + 20]:
                    idle = _num(part.rstrip("%"))
            # fallback parse
            tokens = line.replace(",", " ").split()
            for i, tok in enumerate(tokens):
                if tok.endswith("%") and i + 1 < len(tokens) and tokens[i + 1].startswith("idle"):
                    idle = _num(tok.rstrip("%"))
            if idle is not None:
                cpu_pct = round(max(0.0, min(100.0, 100.0 - idle)), 1)
            break

    vm = _run(["vm_stat"])
    page_size = 4096
    for line in vm.splitlines():
        if "page size of" in line:
            try:
                page_size = int(line.strip().split()[-2])
            except ValueError:
                pass
    pages: dict[str, int] = {}
    for line in vm.splitlines():
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        digits = "".join(ch for ch in rest if ch.isdigit())
        if digits:
            pages[key.strip()] = int(digits)
    free = pages.get("Pages free", 0) + pages.get("Pages speculative", 0)
    active = pages.get("Pages active", 0)
    inactive = pages.get("Pages inactive", 0)
    wired = pages.get("Pages wired down", 0) or pages.get("Pages wired", 0)
    compressed = pages.get("Pages occupied by compressor", 0)
    used_pages = active + inactive + wired + compressed
    total_pages = used_pages + free
    total_mb = round((total_pages * page_size) / (1024 * 1024), 1) if total_pages else None
    used_mb = round((used_pages * page_size) / (1024 * 1024), 1) if total_pages else None
    avail_mb = round((free * page_size) / (1024 * 1024), 1) if total_pages else None
    mem_pct = round((used_pages / total_pages) * 100.0, 1) if total_pages else None

    load1 = load5 = load15 = None
    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        pass

    return {
        "cpu_percent": cpu_pct,
        "mem_percent": mem_pct,
        "mem_total_mb": total_mb,
        "mem_used_mb": used_mb,
        "mem_available_mb": avail_mb,
        "load1": load1,
        "load5": load5,
        "load15": load15,
    }


def collect_cpu_mem_linux() -> dict[str, Any]:
    mem_total = mem_avail = None
    try:
        info = {}
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if ":" not in line:
                continue
            k, rest = line.split(":", 1)
            parts = rest.strip().split()
            if parts:
                info[k] = int(parts[0])
        mem_total = round(info.get("MemTotal", 0) / 1024, 1)
        mem_avail = round(info.get("MemAvailable", info.get("MemFree", 0)) / 1024, 1)
    except OSError:
        pass
    used = (mem_total - mem_avail) if mem_total and mem_avail is not None else None
    mem_pct = round((used / mem_total) * 100.0, 1) if mem_total and used is not None else None
    load1 = load5 = load15 = None
    try:
        load1, load5, load15 = os.getloadavg()
    except OSError:
        pass
    # Rough CPU from load when we lack a delta sample.
    cpus = os.cpu_count() or 1
    cpu_pct = round(min(100.0, (load1 / cpus) * 100.0), 1) if load1 is not None else None
    return {
        "cpu_percent": cpu_pct,
        "mem_percent": mem_pct,
        "mem_total_mb": mem_total,
        "mem_used_mb": used,
        "mem_available_mb": mem_avail,
        "load1": load1,
        "load5": load5,
        "load15": load15,
    }


def collect_disk() -> dict[str, Any]:
    try:
        st = os.statvfs(str(Path.home()))
    except OSError:
        return {}
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    used = total - free
    return {
        "disk_total_gb": round(total / (1024**3), 1) if total else None,
        "disk_used_gb": round(used / (1024**3), 1) if total else None,
        "disk_percent": round((used / total) * 100.0, 1) if total else None,
    }


def collect_logs(paths: list[str], limit: int = 8000) -> str:
    chunks: list[str] = []
    for raw in paths:
        path = Path(raw).expanduser()
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        tail = text[-limit:]
        chunks.append(f"===== {path} =====\n{tail}")
    joined = "\n\n".join(chunks)
    return joined[-12000:]


def collect_payload(*, log_paths: list[str], notes: str) -> dict[str, Any]:
    system = platform.system().lower()
    metrics = collect_cpu_mem_macos() if system == "darwin" else collect_cpu_mem_linux()
    disk = collect_disk()
    payload = {
        "collected_at": _now_iso(),
        "hostname": socket.gethostname(),
        "platform": system,
        "arch": platform.machine(),
        "cpu_count": os.cpu_count() or 1,
        "uptime_seconds": None,
        "processes": collect_processes(),
        "logs": collect_logs(log_paths),
        "notes": notes,
        "agent_version": AGENT_VERSION,
        **metrics,
        **disk,
    }
    try:
        if Path("/proc/uptime").is_file():
            payload["uptime_seconds"] = float(Path("/proc/uptime").read_text().split()[0])
        elif system == "darwin":
            boot = _run(["sysctl", "-n", "kern.boottime"])
            # { sec = 1710000000, usec = 0 } ...
            if "sec" in boot:
                for part in boot.replace(",", " ").split():
                    if part.isdigit():
                        payload["uptime_seconds"] = max(0.0, time.time() - float(part))
                        break
    except Exception:
        pass
    return payload


def post_heartbeat(base_url: str, server_id: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = base_url.rstrip("/") + f"/api/admin/mac-servers/{server_id}/ingest"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Mac-Server-Token": token,
            "User-Agent": f"render3d-mac-server-agent/{AGENT_VERSION}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {"ok": True}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise SystemExit(f"Ingest failed HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Ingest failed: {exc}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Studio Mac/host metrics agent")
    parser.add_argument("--base-url", required=True, help="Studio base URL, e.g. https://render3d.app")
    parser.add_argument("--server-id", required=True)
    parser.add_argument("--token", required=True, help="Ingest token from Management → Servers")
    parser.add_argument("--interval", type=float, default=5.0, help="Seconds between heartbeats")
    parser.add_argument("--once", action="store_true", help="Send one heartbeat and exit")
    parser.add_argument("--log", action="append", default=[], help="Log file to tail (repeatable)")
    parser.add_argument("--notes", default="", help="Optional note included with each sample")
    args = parser.parse_args()

    interval = max(2.0, float(args.interval or 5.0))
    while True:
        payload = collect_payload(log_paths=list(args.log or []), notes=args.notes or "")
        result = post_heartbeat(args.base_url, args.server_id, args.token, payload)
        cpu = (result.get("latest") or {}).get("cpu_percent")
        print(f"[{_now_iso()}] heartbeat ok cpu={cpu}% processes={len(payload.get('processes') or [])}", flush=True)
        if args.once:
            return 0
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
