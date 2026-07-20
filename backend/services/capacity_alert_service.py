"""Host capacity checks — email alerts permanently disabled.

Collects metrics for ops/debug only. Never sends SMTP mail.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.capacity")

STATE_PATH = Path(settings.data_dir) / "capacity_alert_state.json"
PROJECTS = Path(settings.projects_dir)

# Permanent kill-switch — do not re-enable without an explicit product decision.
CAPACITY_EMAILS_DISABLED = True


@dataclass
class CapacitySnapshot:
    collected_at: str
    hostname: str
    instance_hint: str
    cpus: int
    mem_total_mb: int
    mem_available_mb: int
    mem_used_pct: float
    swap_total_mb: int
    swap_used_mb: int
    swap_used_pct: float
    load1: float
    load5: float
    load15: float
    disk_total_gb: float
    disk_used_gb: float
    disk_used_pct: float
    registered_users: int
    project_count: int
    running_generations: int
    estab_connections_8001: int
    level: str = "ok"  # ok | warn | critical
    reasons: list[str] = field(default_factory=list)
    guidance: dict[str, Any] = field(default_factory=dict)


def _meminfo() -> dict[str, int]:
    out: dict[str, int] = {}
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
    return out


def _loadavg() -> tuple[float, float, float]:
    a, b, c, *_ = Path("/proc/loadavg").read_text(encoding="utf-8").split()
    return float(a), float(b), float(c)


def _disk_usage(path: Path) -> tuple[float, float, float]:
    st = os.statvfs(path)
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    used = total - free
    pct = (used / total * 100.0) if total else 0.0
    return total / (1024**3), used / (1024**3), pct


def _count_registered_users() -> int:
    db = Path(settings.data_dir) / "app.db"
    if not db.is_file():
        db = Path(settings.data_dir) / "render3d.db"
    if not db.is_file():
        return 0
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            row = con.execute("SELECT COUNT(*) FROM users").fetchone()
            return int(row[0] or 0) if row else 0
        finally:
            con.close()
    except Exception:
        return 0


def _count_projects() -> int:
    try:
        return sum(1 for p in PROJECTS.iterdir() if p.is_dir()) if PROJECTS.is_dir() else 0
    except Exception:
        return 0


def _running_generations() -> int:
    n = 0
    try:
        for gen in PROJECTS.glob("*/generation.json"):
            try:
                data = json.loads(gen.read_text(encoding="utf-8"))
            except Exception:
                continue
            if str(data.get("status") or "").lower() in {"running", "queued", "pending"}:
                n += 1
    except Exception:
        return n
    return n


def _estab_8001() -> int:
    try:
        text = Path("/proc/net/tcp").read_text(encoding="utf-8")
    except Exception:
        return 0
    # port 8001 = 0x1F41 little-endian in /proc/net/tcp → 411F
    count = 0
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[1]
        state = parts[3]
        if local.endswith(":1F41") and state == "01":
            count += 1
    return count


def _instance_hint(mem_total_mb: int, cpus: int) -> str:
    if mem_total_mb <= 4200 and cpus <= 2:
        return "t3.medium"
    if mem_total_mb <= 8500 and cpus <= 2:
        return "t3.large"
    if mem_total_mb <= 17000 and cpus <= 4:
        return "t3.xlarge"
    return f"{cpus}vcpu/{mem_total_mb}MB"


def capacity_guidance(cpus: int, mem_total_mb: int) -> dict[str, Any]:
    return {
        "instance_class": f"{cpus} vCPU / {mem_total_mb}MB",
        "registered_users_comfortable": "1,000–5,000 (accounts are cheap)",
        "concurrent_browsing": "15–30",
        "concurrent_cad_generations": "2–3",
        "collapse_risk": "4+ heavy gens or mem>88% / swap thrash",
    }


def collect_snapshot() -> CapacitySnapshot:
    mem = _meminfo()
    total_kb = mem.get("MemTotal", 1)
    avail_kb = mem.get("MemAvailable", mem.get("MemFree", 0))
    used_pct = max(0.0, (1.0 - (avail_kb / total_kb)) * 100.0) if total_kb else 0.0
    swap_total = mem.get("SwapTotal", 0)
    swap_free = mem.get("SwapFree", 0)
    swap_used = max(0, swap_total - swap_free)
    swap_pct = (swap_used / swap_total * 100.0) if swap_total else 0.0
    load1, load5, load15 = _loadavg()
    cpus = os.cpu_count() or 1
    disk_total, disk_used, disk_pct = _disk_usage(Path(settings.data_dir))
    snap = CapacitySnapshot(
        collected_at=datetime.now(timezone.utc).isoformat(),
        hostname=socket.gethostname(),
        instance_hint=_instance_hint(total_kb // 1024, cpus),
        cpus=cpus,
        mem_total_mb=total_kb // 1024,
        mem_available_mb=avail_kb // 1024,
        mem_used_pct=round(used_pct, 1),
        swap_total_mb=swap_total // 1024,
        swap_used_mb=swap_used // 1024,
        swap_used_pct=round(swap_pct, 1),
        load1=load1,
        load5=load5,
        load15=load15,
        disk_total_gb=round(disk_total, 1),
        disk_used_gb=round(disk_used, 1),
        disk_used_pct=round(disk_pct, 1),
        registered_users=_count_registered_users(),
        project_count=_count_projects(),
        running_generations=_running_generations(),
        estab_connections_8001=_estab_8001(),
        guidance=capacity_guidance(cpus, total_kb // 1024),
    )
    _classify(snap)
    return snap


def _classify(snap: CapacitySnapshot) -> None:
    reasons: list[str] = []
    level = "ok"

    def bump(next_level: str, reason: str) -> None:
        nonlocal level
        reasons.append(reason)
        order = {"ok": 0, "warn": 1, "critical": 2}
        if order[next_level] > order[level]:
            level = next_level

    if snap.mem_used_pct >= 88:
        bump("critical", f"RAM nearing limit ({snap.mem_used_pct}% used, {snap.mem_available_mb}MB available)")
    elif snap.mem_used_pct >= 80:
        bump("warn", f"High RAM use ({snap.mem_used_pct}%)")

    if snap.swap_used_pct >= 55:
        bump("critical", f"Heavy swap use ({snap.swap_used_pct}% — thrashing risk)")
    elif snap.swap_used_pct >= 35:
        bump("warn", f"Elevated swap use ({snap.swap_used_pct}%)")

    if snap.load1 >= snap.cpus * 3.5:
        bump("critical", f"Load average critical ({snap.load1:.2f} on {snap.cpus} CPUs)")
    elif snap.load1 >= snap.cpus * 2.0:
        bump("warn", f"Load average high ({snap.load1:.2f} on {snap.cpus} CPUs)")

    if snap.disk_used_pct >= 95:
        bump("critical", f"Disk almost full ({snap.disk_used_pct}%)")
    elif snap.disk_used_pct >= 88:
        bump("warn", f"Disk filling up ({snap.disk_used_pct}%)")

    if snap.estab_connections_8001 >= 80:
        bump("warn", f"High live TCP to :8001 ({snap.estab_connections_8001})")

    snap.level = level
    snap.reasons = reasons


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(data: dict[str, Any]) -> None:
    try:
        STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        STATE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        logger.warning("Could not save capacity alert state", exc_info=True)


def should_send_alert(snap: CapacitySnapshot) -> bool:
    return False


def mark_alert_sent(snap: CapacitySnapshot) -> None:
    _save_state(
        {
            "last_level": snap.level,
            "last_sent_ts": time.time(),
            "last_reasons": snap.reasons,
            "last_snapshot": asdict(snap),
            "emails_disabled": True,
        }
    )


def smtp_configured() -> bool:
    return False


def send_capacity_email(snap: CapacitySnapshot) -> None:
    """No-op: capacity / near-collapse emails are permanently disabled."""
    logger.info(
        "Capacity email blocked (disabled). level=%s reasons=%s",
        snap.level,
        snap.reasons,
    )
    return


def check_and_alert(*, force: bool = False, dry_run: bool = False) -> dict[str, Any]:
    snap = collect_snapshot()
    result: dict[str, Any] = {
        "snapshot": asdict(snap),
        "enabled": False,
        "smtp_configured": False,
        "would_alert": False,
        "sent": False,
        "skipped": "capacity_emails_permanently_disabled",
    }
    if dry_run:
        return result
    # Never email — even with force=True.
    return result
