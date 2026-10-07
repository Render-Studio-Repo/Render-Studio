"""Local interactive PTY for the desktop Studio viewport.

Same-machine loopback only. Not a capture of Terminal.app, not a cloud
shell, and not a privileged helper — spawn as the Studio process user.
"""

from __future__ import annotations

import ipaddress
import os
import sys
from pathlib import Path
from typing import Any

from backend.config import settings

REMOTE_UNAVAILABLE = (
    "Studio Mini PTY is loopback-only. Use Terminal · local → Connect at 127.0.0.1:8765."
)
CLOUD_HOST_SUFFIX = "render3d.app"


def projects_root() -> Path:
    return Path(settings.projects_dir)


def normalize_ip(value: str | None) -> str:
    raw = str(value or "").strip().strip("[]")
    if not raw:
        return ""
    if raw.lower() in {"localhost"}:
        return "127.0.0.1"
    if raw.count(":") == 1 and "." in raw:
        raw = raw.split(":", 1)[0]
    if raw.lower().startswith("::ffff:"):
        raw = raw[7:]
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return raw[:80]


def is_loopback_ip(value: str | None) -> bool:
    raw = str(value or "").strip().strip("[]").lower()
    if raw in {"localhost", "::1", "0:0:0:0:0:0:0:1", "127.0.0.1"}:
        return True
    try:
        return ipaddress.ip_address(normalize_ip(raw) or raw).is_loopback
    except ValueError:
        return False


def host_header_name(host: str | None) -> str:
    raw = str(host or "").strip().lower()
    if raw.startswith("[") and "]" in raw:
        return raw[1 : raw.index("]")]
    if raw.count(":") == 1 and "." in raw.split(":")[0]:
        return raw.split(":", 1)[0]
    return raw.split(":")[0] if raw else ""


def host_is_cloud(host: str | None) -> bool:
    name = host_header_name(host)
    return name == CLOUD_HOST_SUFFIX or name.endswith(f".{CLOUD_HOST_SUFFIX}")


def host_is_loopback(host: str | None) -> bool:
    return is_loopback_ip(host_header_name(host))


def peer_ip(connection: Any) -> str:
    """TCP peer only — never X-Forwarded-For (spoofable on local uvicorn)."""
    client = getattr(connection, "client", None)
    host = getattr(client, "host", None) if client is not None else None
    return normalize_ip(str(host or ""))


def local_terminal_gate(connection: Any, host_header: str | None = None) -> tuple[bool, str]:
    """Allow a PTY only for loopback clients talking to a local Studio host."""
    host = host_header
    if host is None:
        headers = getattr(connection, "headers", None) or {}
        try:
            host = headers.get("host")
        except Exception:
            host = ""
        if not host:
            host = getattr(getattr(connection, "url", None), "hostname", None) or ""
    if host_is_cloud(host):
        return False, REMOTE_UNAVAILABLE
    if not host_is_loopback(host):
        return False, REMOTE_UNAVAILABLE
    ip = peer_ip(connection)
    if not is_loopback_ip(ip):
        return False, REMOTE_UNAVAILABLE
    return True, ""


def resolve_shell() -> str:
    env = str(os.environ.get("SHELL") or "").strip()
    candidates = []
    if env:
        candidates.append(env)
    if sys.platform == "darwin":
        candidates.extend(["/bin/zsh", "/bin/bash"])
    else:
        candidates.extend(["/bin/bash", "/bin/zsh"])
    candidates.append("/bin/sh")
    seen: set[str] = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        p = Path(path)
        if p.is_file() and os.access(p, os.X_OK):
            return str(p)
    return "/bin/sh"


def resolve_pty_cwd(project_id: str | None = None, *, root: Path | None = None) -> Path:
    home = Path.home()
    base = (root or projects_root()).resolve()
    raw = str(project_id or "").strip()
    if not raw:
        return home
    pid = Path(raw).name
    if not pid or pid in {".", ".."} or pid != raw:
        return home
    path = (base / pid).resolve()
    try:
        path.relative_to(base)
    except ValueError:
        return home
    return path if path.is_dir() else home


def pty_env() -> dict[str, str]:
    env = {str(k): str(v) for k, v in os.environ.items() if v is not None}
    env.setdefault("TERM", "xterm-256color")
    env.setdefault("COLORTERM", "truecolor")
    return env


def spawn_local_pty(cwd: Path, cols: int = 80, rows: int = 24):
    """Spawn a login shell as the current OS user (not a root helper)."""
    from ptyprocess import PtyProcessUnicode

    cols = max(10, min(int(cols or 80), 400))
    rows = max(4, min(int(rows or 24), 200))
    shell = resolve_shell()
    return PtyProcessUnicode.spawn(
        [shell, "-l"],
        cwd=str(cwd),
        env=pty_env(),
        dimensions=(rows, cols),
        echo=True,
    )


def kill_pty(proc: Any) -> None:
    if proc is None:
        return
    try:
        if getattr(proc, "isalive", lambda: False)():
            proc.terminate(force=True)
    except Exception:
        try:
            proc.kill(9)
        except Exception:
            pass
