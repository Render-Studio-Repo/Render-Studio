"""Start a DIMOS teleop coordinator when Studio Robotics is enabled.

Safe spawn: never kill an existing `dimos run teleop-*` (including the user's
manual `teleop-quest-openarm`). If :8443 is already listening, or a teleop
process is already running, return without starting a second coordinator.
The HTTP handler must not wait for the child — Popen + return.
"""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from backend.services.dimos_headset import (
    DEFAULT_BLUEPRINT,
    headset_map_payload,
    resolve_headset_blueprint,
)

logger = logging.getLogger("render3d.dimos")

DIMOS_PORT = 8443
PROBE_HOSTS = ("127.0.0.1", "192.168.1.83")
PROBE_TIMEOUT_S = 0.2
PS_TIMEOUT_S = 0.8
OPENARM_ROBOT_NAME = "Open Arm"
OPENARM_HARDWARE_ID = "openarm"
_STATUS_TTL_S = 20.0

_lock = threading.Lock()
_spawned: dict[str, Any] = {"pid": None, "blueprint": None}
_status_cache: dict[str, Any] = {"at": 0.0, "payload": None}
_ps_cache: dict[str, Any] = {"at": 0.0, "text": ""}


def peek_coordinator_status(*, allow_stale: bool = False) -> dict[str, Any] | None:
    """Loop-safe: return the last probe without ps/socket or a threadpool slot."""
    cached = _status_cache.get("payload")
    if not cached:
        return None
    age = time.monotonic() - float(_status_cache.get("at") or 0)
    if age < _STATUS_TTL_S or allow_stale:
        return cached
    return None


def seed_idle_coordinator_cache() -> dict[str, Any]:
    """Leftover Control Center polls should hit cache on the first request."""
    hit = peek_coordinator_status(allow_stale=True)
    if hit is not None:
        return hit
    out = {
        "up": False,
        "port": DIMOS_PORT,
        "process": False,
        "pids": [],
        "spawned_pid": None,
        "blueprint": DEFAULT_BLUEPRINT,
        **live_robot_payload(up=False, process=False),
        **headset_map_payload(),
    }
    _status_cache["at"] = time.monotonic()
    _status_cache["payload"] = out
    return out


def resolve_dimos_bin() -> Path | None:
    env = (os.environ.get("DIMOS_BIN") or "").strip()
    if env:
        p = Path(env).expanduser()
        if p.is_file():
            return p
    which = _which("dimos")
    if which:
        return Path(which)
    for cand in (
        Path.home() / ".local/bin/dimos",
        Path.home() / "dimos/.venv/bin/dimos",
        Path(__file__).resolve().parents[2] / "integrations/dimos/.venv/bin/dimos",
    ):
        if cand.is_file():
            return cand
    return None


def resolve_dimos_cwd() -> Path | None:
    env = (os.environ.get("DIMOS_ROOT") or "").strip()
    if env:
        p = Path(env).expanduser()
        if p.is_dir():
            return p
    home = Path.home() / "dimos"
    if (home / "pyproject.toml").is_file():
        return home
    integ = Path(__file__).resolve().parents[2] / "integrations/dimos"
    if (integ / "pyproject.toml").is_file():
        return integ
    return None


def _dimos_python(bin_path: Path, cwd: Path | None) -> Path | None:
    """Use the interpreter that installed DimOS, which also has Zenoh."""
    try:
        with bin_path.open("rb") as script:
            first = script.readline(256).decode("utf-8", "replace").strip()
        if first.startswith("#!"):
            executable = Path(first[2:].split()[0])
            if executable.is_file() and executable.name.startswith("python"):
                return executable
    except OSError:
        pass
    if cwd:
        for name in ("python", "python3"):
            executable = cwd / ".venv" / "bin" / name
            if executable.is_file():
                return executable
    return None


def _which(name: str) -> str | None:
    import shutil

    return shutil.which(name)


def dimos_port_open(host: str, port: int = DIMOS_PORT, timeout_s: float = PROBE_TIMEOUT_S) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except OSError:
        return False


def dimos_pipe_up(hosts: tuple[str, ...] = PROBE_HOSTS) -> bool:
    """True when something is already listening on the DIMOS teleop port."""
    for host in hosts:
        if dimos_port_open(host):
            return True
    return False


def _ps_text() -> str:
    now = time.monotonic()
    cached = _ps_cache.get("text")
    if cached and now - float(_ps_cache.get("at") or 0) < _STATUS_TTL_S:
        return str(cached)
    try:
        proc = subprocess.run(
            ["ps", "-ax", "-o", "pid=,command="],
            capture_output=True,
            text=True,
            timeout=PS_TIMEOUT_S,
        )
        text = proc.stdout or ""
    except (OSError, subprocess.TimeoutExpired):
        text = ""
    _ps_cache["at"] = now
    _ps_cache["text"] = text
    return text


def existing_teleop_pids(ps_output: str | None = None) -> list[int]:
    """Read-only scan for `dimos run teleop-*`. Never signals those PIDs.

    Match the real CLI only — Cursor/zsh wrappers that quote the same text
    in comments must not block Ensure.
    """
    text = _ps_text() if ps_output is None else ps_output
    pids: list[int] = []
    for line in text.splitlines():
        raw = line.strip()
        if not raw:
            continue
        lower = raw.lower()
        if "/bin/zsh" in lower or "/bin/bash" in lower or "builtin eval" in lower:
            continue
        if "pgrep" in lower or "rg " in lower:
            continue
        # Contiguous CLI: …/dimos run teleop-…  or  python …/dimos run teleop-…
        if "dimos run teleop-" not in lower:
            continue
        parts = raw.split(None, 1)
        try:
            pids.append(int(parts[0]))
        except ValueError:
            continue
    return pids


def infer_hardware_mode(ps_output: str | None = None) -> str:
    """Mock unless both OpenArm CAN ports are on the live teleop command.

    Mac has no CAN — `teleop-quest-openarm` defaults to mock_whole_body.
    That is a recognized robot, not 'no arm'.
    """
    text = (_ps_text() if ps_output is None else ps_output).lower()
    if "--left-can-port" in text and "--right-can-port" in text:
        return "can"
    return "mock"


def live_robot_payload(
    *,
    up: bool,
    process: bool,
    blueprint: str | None = None,
    hardware_mode: str | None = None,
) -> dict[str, Any]:
    """Studio robot picker identity for the live DIMOS session."""
    bp = str(blueprint or DEFAULT_BLUEPRINT)
    is_openarm = "openarm" in bp.lower()
    mode = hardware_mode or "mock"
    recognized = bool(is_openarm and (up or process))
    return {
        "robot": OPENARM_ROBOT_NAME if is_openarm else "Unknown",
        "robot_id": OPENARM_HARDWARE_ID if is_openarm else "",
        "hardware_id": OPENARM_HARDWARE_ID if is_openarm else "",
        "hardware_mode": mode if is_openarm else "unknown",
        "recognized": recognized,
        "selected": recognized,
    }


def pid_alive(pid: int | None) -> bool:
    """Existence probe via signal 0 — does not terminate the process."""
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except OSError:
        return False
    return True


def spawn_dimos_coordinator(
    blueprint: str,
    *,
    popen: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    hid_blueprint = blueprint if blueprint else DEFAULT_BLUEPRINT
    bin_path = resolve_dimos_bin()
    if not bin_path:
        return {
            "ok": False,
            "status": "error",
            "started": False,
            "blueprint": hid_blueprint,
            "command": f"dimos run {hid_blueprint}",
            "error": "dimos binary not found (set DIMOS_BIN or install dimos on PATH)",
        }
    cwd = resolve_dimos_cwd()
    argv = [str(bin_path), "run", hid_blueprint]
    # macOS loopback multicast has failed to link the separate DimOS workers,
    # leaving ArmTeleopModule/set_transport waiting 120 seconds. A local router
    # gives each worker an explicit connection. Keep an existing user-supplied
    # Zenoh endpoint or non-Zenoh transport unchanged.
    local_router = False
    if (hid_blueprint == "teleop-quest-openarm"
            and os.environ.get("DIMOS_TRANSPORT", "zenoh").strip().lower() == "zenoh"
            and not os.environ.get("ZENOH_CONNECT", "").strip()):
        python_bin = _dimos_python(bin_path, cwd)
        launcher = Path(__file__).resolve().parents[2] / "integrations" / "dimos" / "openarm_router_launcher.py"
        if python_bin and launcher.is_file():
            argv = [str(python_bin), str(launcher), str(bin_path), hid_blueprint]
            local_router = True
    log_path = Path(os.environ.get("DIMOS_SPAWN_LOG") or "/tmp/render3d-dimos-teleop.log")
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_f = open(log_path, "ab")
    except OSError:
        log_f = subprocess.DEVNULL
    runner = popen or subprocess.Popen
    try:
        proc = runner(
            argv,
            cwd=str(cwd) if cwd else None,
            stdin=subprocess.DEVNULL,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            close_fds=True,
        )
    except Exception as exc:
        if log_f is not subprocess.DEVNULL:
            try:
                log_f.close()
            except Exception:
                pass
        logger.info("DIMOS coordinator spawn failed: %s", exc)
        return {
            "ok": False,
            "status": "error",
            "started": False,
            "blueprint": hid_blueprint,
            "command": f"dimos run {hid_blueprint}",
            "error": str(exc),
        }
    if log_f is not subprocess.DEVNULL:
        try:
            log_f.close()
        except Exception:
            pass
    pid = int(getattr(proc, "pid", 0) or 0)
    _spawned["pid"] = pid or None
    _spawned["blueprint"] = hid_blueprint
    logger.info("DIMOS coordinator spawned pid=%s blueprint=%s (not waiting)", pid, hid_blueprint)
    return {
        "ok": True,
        "status": "starting",
        "started": True,
        "pid": pid or None,
        "blueprint": hid_blueprint,
        "command": f"dimos run {hid_blueprint}",
        "local_router": local_router,
    }


def coordinator_status(
    *,
    pipe_up: Callable[[], bool] | None = None,
    teleop_pids: Callable[[], list[int]] | None = None,
) -> dict[str, Any]:
    if pipe_up is None and teleop_pids is None:
        now = time.monotonic()
        cached = _status_cache.get("payload")
        if cached and now - float(_status_cache.get("at") or 0) < _STATUS_TTL_S:
            return cached
    ps_text = _ps_text()
    up = (pipe_up or dimos_pipe_up)()
    pids = (teleop_pids or (lambda: existing_teleop_pids(ps_text)))()
    ours = _spawned.get("pid")
    if ours and pid_alive(ours) and ours not in pids:
        pids = [*pids, int(ours)]
    payload = headset_map_payload()
    blueprint = _spawned.get("blueprint") or DEFAULT_BLUEPRINT
    robot = live_robot_payload(
        up=bool(up),
        process=bool(pids),
        blueprint=blueprint,
        hardware_mode=infer_hardware_mode(ps_text),
    )
    out = {
        "up": bool(up),
        "port": DIMOS_PORT,
        "process": bool(pids),
        "pids": pids,
        "spawned_pid": ours if ours and pid_alive(ours) else None,
        "blueprint": blueprint,
        **robot,
        **payload,
    }
    if pipe_up is None and teleop_pids is None:
        _status_cache["at"] = time.monotonic()
        _status_cache["payload"] = out
    return out


def ensure_dimos_coordinator(
    headset: str | None = "quest",
    blueprint: str | None = None,
    *,
    pipe_up: Callable[[], bool] | None = None,
    teleop_pids: Callable[[], list[int]] | None = None,
    spawn: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """If the pipe is down and no teleop process exists, spawn in the background."""
    hid, bp, note = resolve_headset_blueprint(headset, blueprint)
    base = {
        "headset": hid,
        "blueprint": bp,
        "command": f"dimos run {bp}",
        "fallback_note": note,
        **headset_map_payload(),
    }
    with _lock:
        if (pipe_up or dimos_pipe_up)():
            robot = live_robot_payload(
                up=True,
                process=True,
                blueprint=bp,
                hardware_mode=infer_hardware_mode(),
            )
            return {**base, **robot, "ok": True, "status": "already_up", "started": False, "up": True}
        pids = list((teleop_pids or existing_teleop_pids)())
        ours = _spawned.get("pid")
        if ours and pid_alive(ours) and ours not in pids:
            pids.append(int(ours))
        if pids:
            robot = live_robot_payload(
                up=False,
                process=True,
                blueprint=bp,
                hardware_mode=infer_hardware_mode(),
            )
            return {
                **base,
                **robot,
                "ok": True,
                "status": "already_running",
                "started": False,
                "up": False,
                "pids": pids,
            }
        result = (spawn or spawn_dimos_coordinator)(bp)
        robot = live_robot_payload(
            up=False,
            process=bool(result.get("started") or result.get("pid")),
            blueprint=bp,
            hardware_mode=infer_hardware_mode(),
        )
        return {**base, **robot, **result, "up": False}
