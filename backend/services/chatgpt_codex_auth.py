"""Per-user ChatGPT subscription login via Codex CLI device-auth (VibeCAD-style)."""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import threading
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.services.codex_agent import resolve_codex_bin

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07")
_DEVICE_URL_RE = re.compile(r"https://auth\.openai\.com/[^\s]+", re.I)
# Codex prints ABCD-EFGHI (9 chars + hyphen). Ignore English words after "one-time code".
_HYPHEN_CODE_RE = re.compile(r"\b([A-Z0-9]{4,5}-[A-Z0-9]{4,6})\b")
_BARE_CODE_RE = re.compile(
    r"(?:device code|one-time code|enter this code)[^\nA-Z0-9]{0,40}\n?[^\nA-Z0-9]*\b([A-Z0-9]{8,10})\b",
    re.I,
)

_lock = threading.Lock()
_sessions: dict[str, dict[str, Any]] = {}
_user_operations: dict[str, threading.RLock] = {}


def _user_operation(user_id: str):
    with _lock:
        return _user_operations.setdefault(user_id, threading.RLock())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _link_shared_codex_assets(home: Path) -> None:
    """Reuse host Codex plugins/skills so a per-user CODEX_HOME still finds $cad."""
    host = Path.home() / ".codex"
    for name in ("plugins", "skills"):
        src = host / name
        dest = home / name
        if dest.exists() or dest.is_symlink() or not src.exists():
            continue
        try:
            dest.symlink_to(src, target_is_directory=src.is_dir())
        except OSError:
            pass


def user_codex_home(user_id: str) -> Path:
    root = Path(settings.data_dir).resolve() / "codex-homes" / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    _link_shared_codex_assets(root)
    return root


def _ensure_file_store(home: Path) -> None:
    cfg = home / "config.toml"
    text = cfg.read_text(encoding="utf-8") if cfg.is_file() else ""
    if "cli_auth_credentials_store" not in text:
        cfg.write_text(
            (text.rstrip() + "\n" if text.strip() else "")
            + 'cli_auth_credentials_store = "file"\n',
            encoding="utf-8",
        )


def _auth_path(home: Path) -> Path:
    return home / "auth.json"


def _email_from_id_token(token: str | None) -> str:
    raw = str(token or "").strip()
    parts = raw.split(".")
    if len(parts) < 2:
        return ""
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return ""
    for key in ("email", "preferred_username", "upn"):
        value = str(payload.get(key) or "").strip()
        if "@" in value:
            return value[:160]
    return ""


def read_chatgpt_auth(user_id: str) -> dict[str, Any]:
    home = user_codex_home(user_id)
    path = _auth_path(home)
    if not path.is_file():
        return {"signed_in": False, "auth_mode": "", "account_email": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"signed_in": False, "auth_mode": "", "account_email": ""}
    mode = str(data.get("auth_mode") or "").strip().lower()
    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    email = _email_from_id_token(str(tokens.get("id_token") or ""))
    return {
        "signed_in": mode in {"chatgpt", "chat_gpt"} or bool(tokens.get("access_token")),
        "auth_mode": mode or "chatgpt",
        "account_email": email,
        "account_id": str(tokens.get("account_id") or ""),
        "last_refresh": str(data.get("last_refresh") or ""),
    }


def _codex_env(home: Path) -> dict[str, str]:
    from backend.services.codex_launch_env import codex_launch_env

    return codex_launch_env({"CODEX_HOME": str(home), "TERM": "dumb"})


def _parse_device_output(blob: str) -> tuple[str, str]:
    text = _ANSI_RE.sub("", str(blob or "").replace("\r", "\n"))
    url = ""
    match = _DEVICE_URL_RE.search(text)
    if match:
        url = match.group(0).rstrip(").,;")
    code = ""
    for hit in _HYPHEN_CODE_RE.finditer(text.upper()):
        value = hit.group(1)
        if "HTTP" in value or "OPENAI" in value:
            continue
        code = value
        break
    if not code:
        match = _BARE_CODE_RE.search(text)
        if match:
            value = match.group(1).upper()
            if "HTTP" not in value and value not in {"EXPIRES", "MINUTES", "TERMINAL", "DISPLAYED"}:
                code = value
    return url, code


def _reader(user_id: str, proc: subprocess.Popen[str]) -> None:
    chunks: list[str] = []
    try:
        assert proc.stdout is not None
        while True:
            piece = proc.stdout.read(64)
            if not piece:
                break
            chunks.append(piece)
            blob = "".join(chunks)
            url, code = _parse_device_output(blob)
            with _lock:
                session = _sessions.get(user_id)
                if not session or session.get("proc") is not proc or session.get("finished"):
                    break
                if url:
                    session["login_url"] = url
                if code:
                    session["device_code"] = code
                session["log_tail"] = blob[-4000:]
                if url and code:
                    session["status"] = "awaiting_browser"
    except Exception:
        with _lock:
            session = _sessions.get(user_id)
            if session and session.get("proc") is proc and not session.get("finished"):
                session["error"] = "Could not read the ChatGPT sign-in response. Try signing in again."
                session["status"] = "error"
    finally:
        try:
            proc.wait(timeout=3)
        except (OSError, subprocess.SubprocessError):
            pass
        _finish_device_auth(user_id, proc)
        if proc.stdout:
            proc.stdout.close()


def _remove_login_stage(session: dict[str, Any]) -> None:
    stage = session.pop("staging_home", None)
    if stage:
        shutil.rmtree(stage, ignore_errors=True)


def _promote_login(stage: Path, home: Path) -> bool:
    source = _auth_path(stage)
    try:
        if source.is_symlink() or not source.is_file():
            return False
        data = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        mode = data.get("auth_mode")
        if not isinstance(mode, str) or mode.lower() not in {"chatgpt", "chat_gpt"}:
            return False
        tokens = data.get("tokens")
        if not isinstance(tokens, dict) or not all(
            isinstance(tokens.get(name), str) and tokens[name].strip()
            for name in ("access_token", "refresh_token", "id_token")
        ):
            return False
        source.chmod(0o600)
        os.replace(source, _auth_path(home))
        return True
    except (OSError, ValueError):
        return False


def _finish_device_auth(user_id: str, proc: subprocess.Popen[str]) -> None:
    code = proc.poll()
    if code is None:
        return
    with _user_operation(user_id), _lock:
        session = _sessions.get(user_id)
        if not session or session.get("proc") is not proc or session.get("finished"):
            return
        stage = session.get("staging_home")
        connected = bool(code == 0 and session.get("status") != "error" and stage
                         and _promote_login(Path(stage), user_codex_home(user_id)))
        session["finished"] = True
        session["status"] = "signed_in" if connected else "error"
        session["error"] = "" if connected else "ChatGPT sign-in did not finish. Your saved connection, if any, was not changed."
        session["device_code"] = ""
        session["log_tail"] = ""
        _remove_login_stage(session)


def _kill_session(user_id: str) -> None:
    session = _sessions.pop(user_id, None)
    proc = session.get("proc") if session else None
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
                proc.wait(timeout=3)
            except Exception:
                pass
    if session:
        _remove_login_stage(session)


def start_device_auth(user_id: str) -> dict[str, Any]:
    binary = resolve_codex_bin()
    if not binary:
        raise RuntimeError("Codex CLI is not installed on this host, so ChatGPT subscription sign-in is unavailable.")
    home = user_codex_home(user_id)
    _ensure_file_store(home)
    # Native device login clears auth.json before approval. Isolate reconnect until success.
    stage = Path(tempfile.mkdtemp(prefix=".chatgpt-login-", dir=str(home)))
    try:
        _ensure_file_store(stage)
        with _user_operation(user_id), _lock:
            _kill_session(user_id)
            proc = subprocess.Popen(
                [str(binary), "login", "--device-auth", "-c", 'cli_auth_credentials_store="file"'],
                cwd=str(stage), env=_codex_env(stage), stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=0,
            )
            _sessions[user_id] = {
                "proc": proc, "staging_home": stage, "status": "starting",
                "login_url": "https://auth.openai.com/codex/device", "device_code": "",
                "started_at": _now(), "error": "", "log_tail": "",
            }
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    threading.Thread(target=_reader, args=(user_id, proc), daemon=True).start()
    deadline = time.time() + 12
    while time.time() < deadline:
        with _lock:
            current = dict(_sessions.get(user_id) or {})
        if current.get("device_code") or current.get("status") in {"awaiting_browser", "signed_in", "error"}:
            break
        if proc.poll() is not None:
            break
        time.sleep(0.2)
    return device_auth_status(user_id)


def device_auth_status(user_id: str) -> dict[str, Any]:
    with _user_operation(user_id):
        with _lock:
            proc = (_sessions.get(user_id) or {}).get("proc")
        if proc:
            _finish_device_auth(user_id, proc)
        auth = read_chatgpt_auth(user_id)
        with _lock:
            session = dict(_sessions.get(user_id) or {})
            proc = (_sessions.get(user_id) or {}).get("proc")
        if session.get("status") == "error":
            status = "error"
        elif proc and not session.get("finished"):
            status = "awaiting_browser" if session.get("device_code") else "starting"
        elif proc and not auth.get("signed_in"):
            status = "error"
            session["error"] = session.get("error") or "ChatGPT sign-in did not finish."
        elif auth.get("signed_in"):
            status = "signed_in"
        else:
            status = "not_signed_in"
        return {
            "available": resolve_codex_bin() is not None,
            "status": status,
            "signed_in": status == "signed_in",
            "auth_mode": auth.get("auth_mode") or "",
            "account_email": auth.get("account_email") or "",
            "login_url": session.get("login_url") or "https://auth.openai.com/codex/device",
            "device_code": session.get("device_code") or "",
            "error": session.get("error") or "",
            "cli_status": "",
        }


def logout_chatgpt(user_id: str) -> dict[str, Any]:
    with _user_operation(user_id):
        home = user_codex_home(user_id)
        with _lock:
            _kill_session(user_id)
        binary = resolve_codex_bin()
        if binary:
            try:
                subprocess.run(
                    [str(binary), "logout", "-c", 'cli_auth_credentials_store="file"'],
                    cwd=str(home),
                    env=_codex_env(home),
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
            except Exception:
                pass
        path = _auth_path(home)
        try:
            if path.is_file():
                path.unlink()
        except Exception:
            pass
        return device_auth_status(user_id)
