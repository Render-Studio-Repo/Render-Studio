"""Host capacity checks + Gmail SMTP alerts when the box is near collapse.

Registered user count is cheap; crashes come from RAM / swap / load /
concurrent CAD generations. This module measures those and emails ops.
"""

from __future__ import annotations

import json
import logging
import os
import smtplib
import socket
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.capacity")

STATE_PATH = Path(settings.data_dir) / "capacity_alert_state.json"
PROJECTS = Path(settings.projects_dir)


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


def _count_users() -> int:
    db = Path(settings.data_dir) / "render3d.db"
    if not db.is_file():
        return 0
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            return int(con.execute("SELECT COUNT(*) FROM users").fetchone()[0])
        finally:
            con.close()
    except Exception:
        return 0


def _count_projects() -> int:
    if not PROJECTS.is_dir():
        return 0
    return sum(1 for p in PROJECTS.iterdir() if p.is_dir() and not p.name.startswith("."))


def _count_running_generations() -> int:
    if not PROJECTS.is_dir():
        return 0
    n = 0
    for path in PROJECTS.glob("*/generation.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        jobs = data.get("jobs")
        if isinstance(jobs, list) and jobs:
            for job in jobs:
                if str((job or {}).get("status") or "").lower() == "running":
                    n += 1
            continue
        if str(data.get("status") or "").lower() == "running":
            n += 1
    return n


def _estab_8001() -> int:
    try:
        import subprocess

        out = subprocess.check_output(
            ["ss", "-tn", "state", "established", "( sport = :8001 or dport = :8001 )"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        # header + lines
        return max(0, len([ln for ln in out.splitlines() if ln.strip()]) - 1)
    except Exception:
        return 0


def _instance_hint() -> str:
    # Best-effort; fails quietly off AWS / without IMDS.
    try:
        import urllib.request

        req = urllib.request.Request(
            "http://169.254.169.254/latest/api/token",
            method="PUT",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            token = resp.read().decode()
        req2 = urllib.request.Request(
            "http://169.254.169.254/latest/meta-data/instance-type",
            headers={"X-aws-ec2-metadata-token": token},
        )
        with urllib.request.urlopen(req2, timeout=1.5) as resp:
            return resp.read().decode().strip() or "unknown"
    except Exception:
        return "unknown"


def capacity_guidance(cpus: int, mem_total_mb: int) -> dict[str, Any]:
    """Rough safe operating envelopes. Not hard caps — crash risk curves."""
    # Memory dominates CAD; CPU caps parallel builds.
    if mem_total_mb <= 4500:  # ~t3.medium 4GB
        return {
            "instance_class": "t3.medium-like (4GB)",
            "registered_users_comfortable": "1,000–5,000 (accounts are cheap)",
            "concurrent_browsing": "15–30",
            "concurrent_cad_generations": "2–3",
            "collapse_risk": "4+ heavy gens or mem>88% / swap thrash",
            "t3_large_delta": {
                "ram": "8GB (2×)",
                "cpu": "same 2 vCPU",
                "concurrent_browsing": "35–60",
                "concurrent_cad_generations": "4–6",
                "approx_headroom": "~1.8–2.2× before OOM; generations not much faster (same CPU)",
            },
        }
    if mem_total_mb <= 9000:  # ~t3.large 8GB
        return {
            "instance_class": "t3.large-like (8GB)",
            "registered_users_comfortable": "5,000–20,000",
            "concurrent_browsing": "35–60",
            "concurrent_cad_generations": "4–6",
            "collapse_risk": "7+ heavy gens or mem>88% / load>>CPUs",
            "next_step": "t3.xlarge (4 vCPU / 16GB) if gens queue on CPU",
        }
    return {
        "instance_class": f"custom (~{mem_total_mb}MB RAM / {cpus} CPU)",
        "registered_users_comfortable": "tens of thousands until SQLite/disk hurt",
        "concurrent_browsing": str(max(40, cpus * 25)),
        "concurrent_cad_generations": str(max(4, cpus + 2)),
        "collapse_risk": "mem>88%, disk>92%, or load >> CPUs for sustained periods",
    }


def collect_snapshot() -> CapacitySnapshot:
    mem = _meminfo()
    total_kb = mem.get("MemTotal", 1)
    avail_kb = mem.get("MemAvailable", mem.get("MemFree", 0))
    used_pct = max(0.0, min(100.0, (1.0 - (avail_kb / total_kb)) * 100.0))
    swap_total = mem.get("SwapTotal", 0)
    swap_free = mem.get("SwapFree", 0)
    swap_used = max(0, swap_total - swap_free)
    swap_pct = (swap_used / swap_total * 100.0) if swap_total else 0.0
    load1, load5, load15 = _loadavg()
    cpus = os.cpu_count() or 1
    disk_total, disk_used, disk_pct = _disk_usage(Path("/"))
    users = _count_users()
    projects = _count_projects()
    running = _count_running_generations()
    conns = _estab_8001()

    snap = CapacitySnapshot(
        collected_at=datetime.now(timezone.utc).isoformat(),
        hostname=socket.gethostname(),
        instance_hint=_instance_hint(),
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
        registered_users=users,
        project_count=projects,
        running_generations=running,
        estab_connections_8001=conns,
        guidance=capacity_guidance(cpus, total_kb // 1024),
    )
    _classify(snap)
    return snap


def _classify(snap: CapacitySnapshot) -> None:
    reasons: list[str] = []
    level = "ok"

    def bump(new_level: str, reason: str) -> None:
        nonlocal level
        reasons.append(reason)
        order = {"ok": 0, "warn": 1, "critical": 2}
        if order[new_level] > order[level]:
            level = new_level

    # Memory — primary crash driver on this host
    if snap.mem_used_pct >= 92 or snap.mem_available_mb < 250:
        bump("critical", f"RAM critically low ({snap.mem_used_pct}% used, {snap.mem_available_mb}MB available)")
    elif snap.mem_used_pct >= 85 or snap.mem_available_mb < 450:
        bump("warn", f"RAM nearing limit ({snap.mem_used_pct}% used, {snap.mem_available_mb}MB available)")

    if snap.swap_total_mb > 0:
        if snap.swap_used_pct >= 55:
            bump("critical", f"Heavy swap use ({snap.swap_used_pct}% — thrashing risk)")
        elif snap.swap_used_pct >= 35:
            bump("warn", f"Elevated swap use ({snap.swap_used_pct}%)")

    if snap.load1 >= snap.cpus * 3.0:
        bump("critical", f"Load average critical ({snap.load1:.2f} on {snap.cpus} CPUs)")
    elif snap.load1 >= snap.cpus * 1.8:
        bump("warn", f"Load average high ({snap.load1:.2f} on {snap.cpus} CPUs)")

    if snap.disk_used_pct >= 94:
        bump("critical", f"Disk almost full ({snap.disk_used_pct}%)")
    elif snap.disk_used_pct >= 85:
        bump("warn", f"Disk filling up ({snap.disk_used_pct}%)")

    # Concurrent CAD — calibrated for current 4GB box; still useful on larger
    if snap.mem_total_mb <= 4500:
        if snap.running_generations >= 4:
            bump("critical", f"{snap.running_generations} concurrent CAD generations (safe ~2–3 on 4GB)")
        elif snap.running_generations >= 3:
            bump("warn", f"{snap.running_generations} concurrent CAD generations (nearing 4GB safe max)")
    else:
        if snap.running_generations >= 7:
            bump("critical", f"{snap.running_generations} concurrent CAD generations")
        elif snap.running_generations >= 5:
            bump("warn", f"{snap.running_generations} concurrent CAD generations")

    if snap.estab_connections_8001 >= 80:
        bump("warn", f"High live TCP to :8001 ({snap.estab_connections_8001})")

    snap.level = level
    snap.reasons = reasons


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def should_send_alert(snap: CapacitySnapshot, *, cooldown_hours: float = 6.0) -> bool:
    if snap.level == "ok":
        return False
    state = _load_state()
    last_level = state.get("last_level") or "ok"
    last_sent = float(state.get("last_sent_ts") or 0)
    order = {"ok": 0, "warn": 1, "critical": 2}
    # Always send on severity increase
    if order[snap.level] > order.get(last_level, 0):
        return True
    if time.time() - last_sent >= cooldown_hours * 3600:
        return True
    return False


def mark_alert_sent(snap: CapacitySnapshot) -> None:
    _save_state(
        {
            "last_level": snap.level,
            "last_sent_ts": time.time(),
            "last_reasons": snap.reasons,
            "last_snapshot": asdict(snap),
        }
    )


def smtp_configured() -> bool:
    user = (settings.capacity_alert_smtp_user or "").strip()
    password = (settings.capacity_alert_smtp_password or "").strip()
    to_addr = (settings.capacity_alert_to or "").strip()
    return bool(user and password and to_addr)


def send_capacity_email(snap: CapacitySnapshot) -> None:
    if not smtp_configured():
        raise RuntimeError(
            "Capacity email not configured. Set CAPACITY_ALERT_SMTP_USER, "
            "CAPACITY_ALERT_SMTP_PASSWORD, and CAPACITY_ALERT_TO in .env"
        )

    from_addr = (settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    to_addr = settings.capacity_alert_to.strip()
    subject = (
        f"[Render3D {snap.level.upper()}] capacity risk on {snap.hostname} "
        f"({snap.instance_hint})"
    )
    g = snap.guidance or {}
    reason_lines = [f"  - {r}" for r in snap.reasons] or ["  - (no reasons)"]
    body = "\n".join(
        [
            f"Render3D is nearing a collapse threshold ({snap.level}).",
            "",
            "Why:",
            *reason_lines,
            "",
            "Live metrics:",
            f"  Time (UTC):        {snap.collected_at}",
            f"  Instance:          {snap.instance_hint}",
            f"  RAM:               {snap.mem_used_pct}% used "
            f"({snap.mem_available_mb}MB available of {snap.mem_total_mb}MB)",
            f"  Swap:              {snap.swap_used_pct}% "
            f"({snap.swap_used_mb}MB / {snap.swap_total_mb}MB)",
            f"  Load:              {snap.load1:.2f} / {snap.load5:.2f} / {snap.load15:.2f} "
            f"(CPUs={snap.cpus})",
            f"  Disk:              {snap.disk_used_pct}% "
            f"({snap.disk_used_gb}G / {snap.disk_total_gb}G)",
            f"  Running CAD gens:  {snap.running_generations}",
            f"  TCP :8001:         {snap.estab_connections_8001}",
            f"  Registered users:  {snap.registered_users}",
            f"  Projects:          {snap.project_count}",
            "",
            "Safe envelope (approx):",
            f"  Class:             {g.get('instance_class')}",
            f"  Concurrent browse: {g.get('concurrent_browsing')}",
            f"  Concurrent CAD:    {g.get('concurrent_cad_generations')}",
            f"  Collapse risk:     {g.get('collapse_risk')}",
            "",
            "Action: stop extra generations, restart only if needed, or upgrade "
            "(t3.large doubles RAM on the current shape; t3.xlarge also doubles CPU).",
            "",
            "— Render3D capacity monitor",
        ]
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.set_content(body)

    host = (settings.capacity_alert_smtp_host or "smtp.gmail.com").strip()
    port = int(settings.capacity_alert_smtp_port or 587)
    user = settings.capacity_alert_smtp_user.strip()
    password = settings.capacity_alert_smtp_password.strip()

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(user, password)
        smtp.send_message(msg)

    logger.info("Capacity alert emailed to %s (%s)", to_addr, snap.level)


def check_and_alert(*, force: bool = False, dry_run: bool = False) -> dict[str, Any]:
    snap = collect_snapshot()
    result: dict[str, Any] = {
        "snapshot": asdict(snap),
        "smtp_configured": smtp_configured(),
        "would_alert": snap.level != "ok" and (force or should_send_alert(snap)),
        "sent": False,
    }
    if dry_run or not result["would_alert"]:
        return result
    if not smtp_configured():
        result["error"] = "smtp_not_configured"
        return result
    send_capacity_email(snap)
    mark_alert_sent(snap)
    result["sent"] = True
    return result
