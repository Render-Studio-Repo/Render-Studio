#!/usr/bin/env python3
"""Keep this 16GB Mini from kernel-panicking.

History
-------
Activity Monitor left on All Processes leaked ~84 GB (Jetsam 2026-08-30) and
29 GB (watchdog panic 2026-09-05 03:09). The previous guard only watched `ps`
RSS, so the leak sat in swapped phys_footprint and was never killed. Swap
climbed past 12 GB, the data volume could not grow more swapfiles, watchdogd
missed check-ins for 93s, and the hardware watchdog rebooted the Mac.

This process:
  * samples memory/swap/disk/load into ~/Library/Logs/mac-health/
  * uses mach phys_footprint (not just RSS) for kill decisions
  * quits Activity Monitor before it can fill swap
  * reaps extra Selenium/Firefox marionette browsers
  * records kernel panics into panics.log
"""
from __future__ import annotations

import ctypes
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
LOG_DIR = Path(os.environ.get("MAC_HEALTH_LOG_DIR", str(HOME / "Library/Logs/mac-health")))
LEGACY_LOG = Path(
    os.environ.get("RENDER3D_MEMORY_GUARD_LOG", str(HOME / "Library/Logs/render3d-memory-guard.log"))
)
ACTIONS_LOG = LOG_DIR / "actions.log"
METRICS_LOG = LOG_DIR / "metrics.jsonl"
PANICS_LOG = LOG_DIR / "panics.log"
STATE_PATH = LOG_DIR / "state.json"

INTERVAL = float(os.environ.get("RENDER3D_MEMORY_GUARD_INTERVAL", "15"))
HOT_INTERVAL = float(os.environ.get("RENDER3D_MEMORY_GUARD_HOT_INTERVAL", "5"))
METRICS_EVERY_SEC = float(os.environ.get("MAC_HEALTH_METRICS_SEC", "30"))
METRICS_ROTATE_BYTES = int(os.environ.get("MAC_HEALTH_METRICS_ROTATE_BYTES", str(40 * 1024 * 1024)))
LOG_ROTATE_BYTES = int(os.environ.get("MAC_HEALTH_LOG_ROTATE_BYTES", str(8 * 1024 * 1024)))

RG_LIMIT_KB = int(os.environ.get("RENDER3D_RG_RSS_KB", str(200 * 1024)))
SEARCH_LIMIT_KB = int(os.environ.get("RENDER3D_SEARCH_RSS_KB", str(800 * 1024)))
AM_FOOTPRINT_MB = int(os.environ.get("RENDER3D_AM_FOOTPRINT_MB", "1024"))
AM_RSS_MB = int(os.environ.get("RENDER3D_AM_RSS_MB", "512"))
AM_MAX_AGE_SEC = int(os.environ.get("RENDER3D_AM_MAX_AGE_SEC", str(2 * 3600)))
AM_SWAP_KILL_MB = int(os.environ.get("RENDER3D_AM_SWAP_KILL_MB", "512"))
SWAP_WARN_MB = int(os.environ.get("RENDER3D_SWAP_WARN_MB", "1024"))
SWAP_CRITICAL_MB = int(os.environ.get("RENDER3D_SWAP_CRITICAL_MB", "4096"))
SWAP_EMERGENCY_MB = int(os.environ.get("RENDER3D_SWAP_EMERGENCY_MB", "8192"))
DISK_WARN_GB = float(os.environ.get("MAC_HEALTH_DISK_WARN_GB", "25"))
DISK_CRITICAL_GB = float(os.environ.get("MAC_HEALTH_DISK_CRITICAL_GB", "12"))
MAX_MARIONETTE_FIREFOX = int(os.environ.get("RENDER3D_MAX_MARIONETTE_FIREFOX", "2"))

PROTECTED_COMM = {
    "Cursor",
    "WindowServer",
    "kernel_task",
    "loginwindow",
    "caddy",
    "cloudflared",
    "Python",
    "python3",
    "python3.9",
    "python3.12",
    "mds",
    "mds_stores",
}

PANIC_DIRS = [
    Path("/Library/Logs/DiagnosticReports"),
    HOME / "Library/Logs/DiagnosticReports",
]

_libproc = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
_libproc.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
_libproc.proc_pid_rusage.restype = ctypes.c_int


class RUsageV0(ctypes.Structure):
    _fields_ = [
        ("ri_uuid", ctypes.c_uint8 * 16),
        ("ri_user_time", ctypes.c_uint64),
        ("ri_system_time", ctypes.c_uint64),
        ("ri_pkg_idle_wkups", ctypes.c_uint64),
        ("ri_interrupt_wkups", ctypes.c_uint64),
        ("ri_pageins", ctypes.c_uint64),
        ("ri_wired_size", ctypes.c_uint64),
        ("ri_resident_size", ctypes.c_uint64),
        ("ri_phys_footprint", ctypes.c_uint64),
        ("ri_proc_start_abstime", ctypes.c_uint64),
        ("ri_proc_exit_abstime", ctypes.c_uint64),
    ]


_last_swap_warn_at = 0.0
_swap_was_high = False
_last_metrics_at = 0.0
_last_disk_warn_at = 0.0
_am_warned = False
_last_panic_check_at = 0.0


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def rotate_file_if_needed(path: Path, max_bytes: int) -> None:
    try:
        if path.is_file() and path.stat().st_size >= max_bytes:
            rotated = path.with_name(path.name + ".1")
            if rotated.exists():
                rotated.unlink()
            path.replace(rotated)
    except OSError:
        pass


def _append(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rotate_file_if_needed(path, LOG_ROTATE_BYTES)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line if line.endswith("\n") else line + "\n")


def log(msg: str) -> None:
    line = f"{utc_now()} {msg}"
    _append(ACTIONS_LOG, line)
    _append(LEGACY_LOG, line)


def load_state() -> dict:
    try:
        raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(STATE_PATH)


def phys_footprint_bytes(pid: int) -> int:
    info = RUsageV0()
    rc = _libproc.proc_pid_rusage(int(pid), 0, ctypes.byref(info))
    if rc != 0:
        return 0
    return int(info.ri_phys_footprint)


def swap_used_mb() -> int:
    try:
        raw = subprocess.check_output(["sysctl", "-n", "vm.swapusage"], text=True)
    except (OSError, subprocess.CalledProcessError):
        return 0
    m = re.search(r"used\s*=\s*([0-9.]+)M", raw)
    if not m:
        return 0
    try:
        return int(float(m.group(1)))
    except ValueError:
        return 0


def disk_avail_gb(path: str = "/System/Volumes/Data") -> float:
    try:
        st = os.statvfs(path)
    except OSError:
        return 0.0
    return (st.f_bavail * st.f_frsize) / (1024 ** 3)


def vm_pages() -> dict:
    out = {"pages_free": 0, "compressor_pages": 0, "swapins": 0, "swapouts": 0}
    try:
        raw = subprocess.check_output(["vm_stat"], text=True)
    except (OSError, subprocess.CalledProcessError):
        return out
    mapping = {
        "Pages free": "pages_free",
        "Pages occupied by compressor": "compressor_pages",
        "Swapins": "swapins",
        "Swapouts": "swapouts",
    }
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        dest = mapping.get(key.strip())
        if not dest:
            continue
        digits = re.sub(r"[^0-9]", "", val)
        if digits:
            out[dest] = int(digits)
    return out


def boot_uuid() -> str:
    try:
        return subprocess.check_output(["sysctl", "-n", "kern.bootsessionuuid"], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def uptime_seconds() -> int:
    try:
        raw = subprocess.check_output(["sysctl", "-n", "kern.boottime"], text=True)
    except (OSError, subprocess.CalledProcessError):
        return 0
    m = re.search(r"sec\s*=\s*(\d+)", raw)
    if not m:
        return 0
    return max(0, int(time.time()) - int(m.group(1)))


def parse_etime(raw: str) -> int:
    """Parse BSD `ps` etime: [[dd-]hh:]mm:ss."""
    text = raw.strip()
    days = 0
    if "-" in text:
        day_s, text = text.split("-", 1)
        try:
            days = int(day_s)
        except ValueError:
            return 0
    parts = text.split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return 0
    if len(nums) == 3:
        hours, minutes, secs = nums
    elif len(nums) == 2:
        hours, minutes, secs = 0, nums[0], nums[1]
    elif len(nums) == 1:
        hours, minutes, secs = 0, 0, nums[0]
    else:
        return 0
    return days * 86400 + hours * 3600 + minutes * 60 + secs


class Proc:
    __slots__ = ("pid", "rss_kb", "uid", "etime", "command", "comm")

    def __init__(self, pid: int, rss_kb: int, uid: int, etime: int, command: str):
        self.pid = pid
        self.rss_kb = rss_kb
        self.uid = uid
        self.etime = etime
        self.command = command
        self.comm = command.split(None, 1)[0] if command else ""

    @property
    def rss_mb(self) -> int:
        return self.rss_kb // 1024

    @property
    def base(self) -> str:
        return Path(self.comm).name

    @property
    def short(self) -> str:
        blob = self.command
        if "Activity Monitor" in blob:
            return "Activity Monitor"
        if "plugin-container" in blob:
            return "Firefox plugin-container"
        if "Firefox GPU Helper" in blob:
            return "Firefox GPU Helper"
        if "/firefox" in blob or blob.endswith("firefox"):
            return "firefox"
        if "geckodriver" in blob:
            return "geckodriver"
        if "Cursor Helper (Renderer)" in blob:
            return "Cursor Helper (Renderer)"
        if "Cursor Helper (Plugin)" in blob:
            return "Cursor Helper (Plugin)"
        if "uvicorn backend.main:app" in blob:
            return "render3d-uvicorn"
        if "memory-guard" in blob:
            return "memory-guard"
        return self.base[:40]


def processes() -> list[Proc]:
    try:
        out = subprocess.check_output(
            ["ps", "-axww", "-o", "pid=", "-o", "rss=", "-o", "uid=", "-o", "etime=", "-o", "command="],
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        log(f"ps failed: {exc}")
        return []
    rows: list[Proc] = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        try:
            pid = int(parts[0])
            rss = int(parts[1])
            uid = int(parts[2])
            etime = parse_etime(parts[3])
        except ValueError:
            continue
        rows.append(Proc(pid, rss, uid, etime, parts[4]))
    return rows


def is_protected(proc: Proc) -> bool:
    if proc.pid == os.getpid():
        return True
    if proc.base in PROTECTED_COMM or proc.comm in PROTECTED_COMM:
        return True
    args = proc.command
    if "uvicorn backend.main:app" in args or "backend.main:app" in args:
        return True
    if "Caddyfile" in args or "cloudflared" in args:
        return True
    if "memory-guard" in args:
        return True
    return False


def is_activity_monitor(proc: Proc) -> bool:
    return "Activity Monitor.app" in proc.command or proc.command.rstrip().endswith("Activity Monitor")


def is_search(proc: Proc) -> bool:
    base = proc.base
    if base in {"rg", "ripgrep"}:
        return True
    if "--type=fileSearcher" in proc.command or "fileSearcher" in proc.command:
        return True
    return False


def is_marionette_firefox(proc: Proc) -> bool:
    cmd = proc.command
    if "/MacOS/firefox" not in cmd and not cmd.endswith("firefox"):
        return False
    if "plugin-container" in cmd or "GPU Helper" in cmd or "crashhelper" in cmd:
        return False
    return "--marionette" in cmd or "rust_mozprofile" in cmd or "-no-remote" in cmd


def notify(title: str, message: str) -> None:
    script = (
        f'display notification {json.dumps(message)} with title {json.dumps(title)}'
    )
    try:
        subprocess.Popen(
            ["osascript", "-e", script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        pass


def reap(proc: Proc, why: str, *, term_first: bool = False) -> bool:
    try:
        if term_first:
            os.kill(proc.pid, signal.SIGTERM)
            time.sleep(1.5)
            try:
                os.kill(proc.pid, 0)
            except OSError:
                log(
                    f"killed pid={proc.pid} rss_mb={proc.rss_mb} comm={proc.short} reason={why} sig=TERM"
                )
                return True
        os.kill(proc.pid, signal.SIGKILL)
    except OSError:
        return False
    log(f"killed pid={proc.pid} rss_mb={proc.rss_mb} comm={proc.short} reason={why}")
    return True


def top_summary(rows: list[Proc], n: int = 6) -> str:
    ranked = sorted(rows, key=lambda r: r.rss_kb, reverse=True)[:n]
    return ", ".join(f"{p.short}:{p.rss_mb}MB(pid={p.pid})" for p in ranked) or "none"


def rotate_metrics_if_needed() -> None:
    rotate_file_if_needed(METRICS_LOG, METRICS_ROTATE_BYTES)


def write_metrics(sample: dict) -> None:
    rotate_metrics_if_needed()
    _append(METRICS_LOG, json.dumps(sample, separators=(",", ":")))


def ingest_panics(state: dict) -> dict:
    seen = set(state.get("seen_panics") or [])
    found = []
    for folder in PANIC_DIRS:
        if not folder.is_dir():
            continue
        try:
            candidates = [p for p in folder.glob("*.panic") if p.is_file() and not p.name.startswith(".")]
        except OSError:
            continue
        for path in candidates:
            key = f"{path}:{path.stat().st_mtime_ns if path.exists() else 0}"
            if key in seen:
                continue
            summary = summarize_panic(path)
            if summary:
                _append(PANICS_LOG, json.dumps(summary, separators=(",", ":")))
                log(
                    f"recorded panic file={path.name} when={summary.get('panic_time')} "
                    f"cause={summary.get('cause_short')}"
                )
                seen.add(key)
                found.append(summary)
    state["seen_panics"] = sorted(seen)[-40:]
    state["last_panic_ingest"] = utc_now()
    return {"state": state, "new": found}


def summarize_panic(path: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    cause = ""
    for line in text.splitlines()[:40]:
        if "panic(" in line or "watchdog timeout" in line.lower() or line.startswith('"panicString"'):
            cause = line.strip()[:500]
            break
    if not cause:
        m = re.search(r"panic\([^)]+\): ([^\n]+)", text)
        cause = (m.group(0) if m else "unknown")[:500]
    boot = re.search(r"Boot session UUID:\s*([A-F0-9-]+)", text)
    cal = re.search(r"Calendar:\s*0x([0-9a-f]+)", text, re.I)
    panic_time = ""
    if cal:
        try:
            panic_time = datetime.fromtimestamp(int(cal.group(1), 16), tz=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        except (ValueError, OSError):
            panic_time = ""
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cause_short = cause
    if "watchdog timeout" in cause.lower():
        cause_short = "watchdog timeout (watchdogd missed check-ins)"
    return {
        "ts": utc_now(),
        "file": str(path),
        "file_mtime": mtime,
        "panic_time": panic_time,
        "boot_session": boot.group(1) if boot else "",
        "cause": cause,
        "cause_short": cause_short,
        "low_swap": "LOW swap" in text,
    }


def maybe_reclaim_disk(avail_gb: float) -> None:
    if avail_gb >= DISK_CRITICAL_GB:
        return
    caches = [
        HOME / "Library/Caches/com.todesktop.230313mzl4w4u92.ShipIt",
        HOME / "Library/Caches/com.apple.python",
    ]
    freed = 0
    for path in caches:
        if not path.exists():
            continue
        size = 0
        try:
            for root, _dirs, files in os.walk(path):
                for name in files:
                    fp = Path(root) / name
                    try:
                        size += fp.stat().st_size
                    except OSError:
                        pass
            subprocess.call(["rm", "-rf", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            freed += size
            log(f"disk reclaim removed {path} bytes={size}")
        except OSError as exc:
            log(f"disk reclaim failed path={path} err={exc}")
    if freed:
        notify("Mac Health Guard", f"Freed {freed // (1024**2)} MB of caches; disk was {avail_gb:.1f} GB free.")


def collect_sample(rows: list[Proc], swap_mb: int, avail_gb: float) -> dict:
    pages = vm_pages()
    am = next((p for p in rows if is_activity_monitor(p)), None)
    am_fp = phys_footprint_bytes(am.pid) if am else 0
    marionette = [p for p in rows if is_marionette_firefox(p)]
    plugins = [p for p in rows if "plugin-container" in p.command]
    top = sorted(rows, key=lambda r: r.rss_kb, reverse=True)[:8]
    top_out = []
    for p in top:
        fp = phys_footprint_bytes(p.pid)
        top_out.append(
            {
                "pid": p.pid,
                "name": p.short,
                "rss_mb": p.rss_mb,
                "fp_mb": round(fp / (1024 ** 2), 1),
                "age_s": p.etime,
            }
        )
    load1, load5, load15 = os.getloadavg()
    return {
        "ts": utc_now(),
        "boot": boot_uuid(),
        "uptime_s": uptime_seconds(),
        "load1": round(load1, 2),
        "load5": round(load5, 2),
        "load15": round(load15, 2),
        "swap_mb": swap_mb,
        "disk_avail_gb": round(avail_gb, 2),
        "pages_free": pages["pages_free"],
        "compressor_pages": pages["compressor_pages"],
        "swapins": pages["swapins"],
        "swapouts": pages["swapouts"],
        "firefox_marionette": len(marionette),
        "plugin_containers": len(plugins),
        "activity_monitor": None
        if not am
        else {
            "pid": am.pid,
            "rss_mb": am.rss_mb,
            "fp_mb": round(am_fp / (1024 ** 2), 1),
            "age_s": am.etime,
        },
        "top": top_out,
    }


def warn_swap_if_needed(swap_mb: int, rows: list[Proc]) -> None:
    global _last_swap_warn_at, _swap_was_high
    high = swap_mb >= SWAP_WARN_MB
    now = time.time()
    if high:
        if not _swap_was_high or (now - _last_swap_warn_at) >= 300:
            log(f"swap warning used={swap_mb}MB threshold={SWAP_WARN_MB}MB top={top_summary(rows)}")
            _last_swap_warn_at = now
        _swap_was_high = True
        return
    if _swap_was_high:
        log(f"swap recovered used={swap_mb}MB (was above {SWAP_WARN_MB}MB)")
        _swap_was_high = False
        _last_swap_warn_at = 0.0


def reap_activity_monitor(proc: Proc, swap_mb: int) -> bool:
    global _am_warned
    fp = phys_footprint_bytes(proc.pid)
    fp_mb = fp // (1024 ** 2)
    reasons = []
    if fp_mb >= AM_FOOTPRINT_MB:
        reasons.append(f"footprint={fp_mb}MB>={AM_FOOTPRINT_MB}MB")
    if proc.rss_mb >= AM_RSS_MB:
        reasons.append(f"rss={proc.rss_mb}MB>={AM_RSS_MB}MB")
    if proc.etime >= AM_MAX_AGE_SEC:
        reasons.append(f"age={proc.etime}s>={AM_MAX_AGE_SEC}s")
    if swap_mb >= AM_SWAP_KILL_MB:
        reasons.append(f"swap={swap_mb}MB>={AM_SWAP_KILL_MB}MB")
    if not reasons:
        if not _am_warned:
            log(
                f"Activity Monitor open pid={proc.pid} rss_mb={proc.rss_mb} "
                f"fp_mb={fp_mb} age_s={proc.etime} (will quit at "
                f"{AM_FOOTPRINT_MB}MB footprint, {AM_RSS_MB}MB rss, "
                f"{AM_MAX_AGE_SEC}s, or swap {AM_SWAP_KILL_MB}MB)"
            )
            notify(
                "Mac Health Guard",
                "Activity Monitor is open. It leaked 29GB and panicked this Mini last night. "
                "It will be quit after 2 hours or 1GB to prevent another restart.",
            )
            _am_warned = True
        return False
    why = "Activity Monitor " + ",".join(reasons)
    ok = reap(proc, why, term_first=True)
    if ok:
        notify("Mac Health Guard", f"Quit Activity Monitor ({why}) to prevent a kernel panic.")
    return ok


def reap_extra_marionette(rows: list[Proc], swap_mb: int) -> int:
    browsers = [p for p in rows if is_marionette_firefox(p)]
    cap = 1 if swap_mb >= SWAP_CRITICAL_MB else MAX_MARIONETTE_FIREFOX
    if len(browsers) <= cap:
        return 0
    browsers.sort(key=lambda p: p.etime, reverse=True)  # oldest first
    killed = 0
    for proc in browsers[:-cap]:
        if reap(proc, f"extra marionette firefox n={len(browsers)} cap={cap} swap={swap_mb}MB"):
            killed += 1
    return killed


def scan_once(*, write_metrics_now: bool = False) -> dict:
    global _last_metrics_at, _last_disk_warn_at, _last_panic_check_at
    rows = processes()
    swap_mb = swap_used_mb()
    avail_gb = disk_avail_gb()
    warn_swap_if_needed(swap_mb, rows)

    now = time.time()
    if now - _last_panic_check_at >= 120:
        state = load_state()
        result = ingest_panics(state)
        save_state(result["state"])
        _last_panic_check_at = now

    if avail_gb < DISK_WARN_GB and (now - _last_disk_warn_at) >= 600:
        log(f"disk warning avail={avail_gb:.1f}GB warn={DISK_WARN_GB}GB critical={DISK_CRITICAL_GB}GB")
        _last_disk_warn_at = now
        maybe_reclaim_disk(avail_gb)

    for proc in rows:
        if proc.pid == os.getpid():
            continue
        if is_activity_monitor(proc):
            reap_activity_monitor(proc, swap_mb)
            continue
        if is_search(proc) and (swap_mb >= 1400 or proc.rss_kb >= RG_LIMIT_KB):
            reap(proc, f"rg/search rss={proc.rss_kb}kb swap={swap_mb}MB")
            continue
        if is_protected(proc):
            continue
        if "fileWatcher" in proc.command or "file-watcher" in proc.command:
            if proc.rss_kb >= SEARCH_LIMIT_KB:
                reap(proc, f"fileWatcher rss={proc.rss_kb}kb")

    reap_extra_marionette(rows, swap_mb)

    sample = collect_sample(processes(), swap_mb, avail_gb)
    if write_metrics_now or (now - _last_metrics_at) >= METRICS_EVERY_SEC or swap_mb >= SWAP_WARN_MB:
        write_metrics(sample)
        _last_metrics_at = now
    return sample


def snapshot() -> dict:
    rows = processes()
    return collect_sample(rows, swap_used_mb(), disk_avail_gb())


def print_status(sample: dict | None = None) -> int:
    sample = sample or snapshot()
    am = sample.get("activity_monitor")
    print(f"uptime        {sample['uptime_s'] // 3600}h {(sample['uptime_s'] % 3600) // 60}m")
    print(f"load          {sample['load1']} {sample['load5']} {sample['load15']}")
    print(f"swap          {sample['swap_mb']} MB")
    print(f"disk free     {sample['disk_avail_gb']} GB")
    print(f"pages free    {sample['pages_free']}")
    print(f"compressor    {sample['compressor_pages']} pages")
    print(f"marionette FF {sample['firefox_marionette']}   plugin-containers={sample['plugin_containers']}")
    if am:
        print(
            f"Activity Mon  pid={am['pid']} rss={am['rss_mb']}MB "
            f"footprint={am['fp_mb']}MB age={am['age_s']}s"
        )
    else:
        print("Activity Mon  not running")
    print("top:")
    for row in sample.get("top") or []:
        print(f"  {row['rss_mb']:6}MB rss  {row['fp_mb']:7}MB fp  {row['name']} pid={row['pid']}")
    print(f"logs          {LOG_DIR}")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    if args[:1] in (["-h"], ["--help"]):
        print("Usage: memory-guard.py [--once|--status]")
        return 0
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.nice(-5)
    except OSError:
        pass

    if args[:1] == ["--status"]:
        return print_status()
    if args[:1] == ["--once"]:
        sample = scan_once(write_metrics_now=True)
        return print_status(sample)

    state = load_state()
    result = ingest_panics(state)
    save_state(result["state"])
    log(
        f"memory-guard start interval={INTERVAL}s am_fp={AM_FOOTPRINT_MB}MB "
        f"am_rss={AM_RSS_MB}MB am_age={AM_MAX_AGE_SEC}s swap_warn={SWAP_WARN_MB}MB "
        f"boot={boot_uuid()} uptime_s={uptime_seconds()} disk_gb={disk_avail_gb():.1f}"
    )
    if result["new"]:
        notify(
            "Mac Health Guard",
            f"Recorded {len(result['new'])} kernel panic(s). See {PANICS_LOG}.",
        )
    while True:
        try:
            sample = scan_once()
            swap_mb = int(sample.get("swap_mb") or 0)
            delay = HOT_INTERVAL if swap_mb >= SWAP_WARN_MB else INTERVAL
        except Exception as exc:
            log(f"scan error: {exc}")
            delay = INTERVAL
        time.sleep(delay)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
