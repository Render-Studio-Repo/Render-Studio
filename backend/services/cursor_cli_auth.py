"""Per-user Cursor Pro login via the Cursor Agent CLI (ChatGPT/Codex-style)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.services.cli_binaries import resolve_cursor_agent_bin

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07")
_LOGIN_URL_RE = re.compile(
    r"https://(?:www\.)?(?:cursor\.com/loginDeepControl|authenticator\.cursor\.sh)/[^\s)\]>\"']+",
    re.I,
)

_lock = threading.Lock()
_sessions: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def user_cursor_home(user_id: str) -> Path:
    root = Path(settings.data_dir).resolve() / "cursor-homes" / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    (root / ".cursor").mkdir(parents=True, exist_ok=True)
    return root


def _auth_path(home: Path) -> Path:
    return home / ".cursor" / "cli-config.json"


def _auth_json_candidates(home: Path) -> list[Path]:
    return [
        home / ".cursor" / "auth.json",
        home / ".cursor" / "cli-config.json",
        home / ".config" / "cursor" / "auth.json",
    ]


def _email_from_blob(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    for key in ("email", "userEmail", "account_email", "user_email"):
        value = str(data.get(key) or "").strip()
        if "@" in value:
            return value[:160]
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    for key in ("email", "userEmail"):
        value = str(user.get(key) or "").strip()
        if "@" in value:
            return value[:160]
    auth = data.get("auth") if isinstance(data.get("auth"), dict) else {}
    value = str(auth.get("email") or "").strip()
    if "@" in value:
        return value[:160]
    return ""


def _token_present(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    for key in ("accessToken", "access_token", "token", "refreshToken", "refresh_token"):
        if str(data.get(key) or "").strip():
            return True
    auth = data.get("auth") if isinstance(data.get("auth"), dict) else {}
    for key in ("accessToken", "access_token", "token"):
        if str(auth.get(key) or "").strip():
            return True
    tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
    return bool(str(tokens.get("access_token") or tokens.get("accessToken") or "").strip())


def read_cursor_auth(user_id: str) -> dict[str, Any]:
    home = user_cursor_home(user_id)
    for path in _auth_json_candidates(home):
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        email = _email_from_blob(data)
        signed = _token_present(data) or bool(email)
        if signed:
            plan = str(
                data.get("subscriptionTier")
                or data.get("subscription_tier")
                or data.get("plan")
                or "Cursor"
            ).strip()
            return {
                "signed_in": True,
                "account_email": email,
                "plan_label": plan[:80] or "Cursor",
                "auth_path": str(path),
            }
    who = _whoami(user_id)
    if who.get("signed_in"):
        return who
    return {"signed_in": False, "account_email": "", "plan_label": ""}


def _cursor_env(home: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["AGENT_CLI_CREDENTIAL_STORE"] = "file"
    env["CURSOR_CONFIG_DIR"] = str(home / ".cursor")
    env["TERM"] = "dumb"
    env["CI"] = "1"
    env["NO_OPEN_BROWSER"] = "1"
    env.pop("BROWSER", None)
    env.pop("CURSOR_API_KEY", None)
    env.pop("CURSOR_API_KEY_ID", None)
    path = env.get("PATH") or ""
    extra = [
        str(Path.home() / ".local" / "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    env["PATH"] = os.pathsep.join([*extra, path] if path else extra)
    return env


def _whoami(user_id: str) -> dict[str, Any]:
    binary = resolve_cursor_agent_bin()
    if not binary:
        return {"signed_in": False, "account_email": ""}
    home = user_cursor_home(user_id)
    try:
        proc = subprocess.run(
            [str(binary), "status", "--format", "json"],
            cwd=str(home),
            env=_cursor_env(home),
            capture_output=True,
            text=True,
            timeout=20,
        )
    except Exception:
        return {"signed_in": False, "account_email": ""}
    blob = (proc.stdout or "") + "\n" + (proc.stderr or "")
    data: Any = None
    for line in blob.splitlines():
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                data = json.loads(line)
                break
            except Exception:
                continue
    if data is None:
        try:
            data = json.loads(proc.stdout or "")
        except Exception:
            data = {}
    email = _email_from_blob(data)
    logged_in = False
    if isinstance(data, dict):
        for key in ("loggedIn", "logged_in", "authenticated", "signedIn", "signed_in", "isAuthenticated"):
            if data.get(key) in (True, "true", "yes", 1, "1"):
                logged_in = True
        if data.get("hasAccessToken") in (True, "true", "yes", 1, "1"):
            logged_in = True
        status = str(data.get("status") or data.get("auth") or "").strip().lower()
        if status in {"logged_in", "authenticated", "signed_in", "ok"}:
            logged_in = True
    if not logged_in and email:
        logged_in = True
    if not logged_in and proc.returncode == 0 and email:
        logged_in = True
    plan = ""
    if isinstance(data, dict):
        plan = str(
            data.get("subscriptionTier")
            or data.get("subscription_tier")
            or data.get("plan")
            or ""
        ).strip()
    return {
        "signed_in": bool(logged_in),
        "account_email": email,
        "plan_label": plan[:80] or ("Cursor" if logged_in else ""),
    }


def _parse_login_output(blob: str) -> str:
    text = _ANSI_RE.sub("", str(blob or "").replace("\r", "\n"))
    match = _LOGIN_URL_RE.search(text)
    if match:
        return match.group(0).rstrip(").,;")
    generic = re.search(r"https://[^\s)\]>\"']+", text)
    if generic and "cursor" in generic.group(0).lower():
        return generic.group(0).rstrip(").,;")
    return ""


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
            url = _parse_login_output(blob)
            with _lock:
                session = _sessions.get(user_id)
                if not session or session.get("proc") is not proc:
                    break
                if url:
                    session["login_url"] = url
                    session["status"] = "awaiting_browser"
                session["log_tail"] = blob[-4000:]
                if read_cursor_auth(user_id).get("signed_in"):
                    session["status"] = "signed_in"
                    break
    except Exception as exc:
        with _lock:
            session = _sessions.get(user_id)
            if session and session.get("proc") is proc:
                session["error"] = str(exc)
                session["status"] = "error"
    finally:
        code = proc.poll()
        with _lock:
            session = _sessions.get(user_id)
            if not session or session.get("proc") is not proc:
                return
            if read_cursor_auth(user_id).get("signed_in"):
                session["status"] = "signed_in"
            elif code not in (None, 0):
                session["status"] = "error"
                session["error"] = session.get("error") or "Cursor sign-in did not finish."


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
            except Exception:
                pass


def start_login(user_id: str) -> dict[str, Any]:
    binary = resolve_cursor_agent_bin()
    if not binary:
        raise RuntimeError(
            "Cursor Agent CLI is not installed on this host, so Cursor subscription sign-in is unavailable."
        )
    home = user_cursor_home(user_id)
    with _lock:
        _kill_session(user_id)
    proc = subprocess.Popen(
        [str(binary), "login"],
        cwd=str(home),
        env=_cursor_env(home),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.PIPE,
        text=True,
        bufsize=0,
    )
    session = {
        "proc": proc,
        "status": "starting",
        "login_url": "https://cursor.com/loginDeepControl",
        "started_at": _now(),
        "error": "",
        "log_tail": "",
    }
    with _lock:
        _sessions[user_id] = session
    threading.Thread(target=_reader, args=(user_id, proc), daemon=True).start()
    deadline = time.time() + 12
    while time.time() < deadline:
        with _lock:
            current = dict(_sessions.get(user_id) or {})
        if current.get("login_url") and current.get("status") in {"awaiting_browser", "signed_in", "error"}:
            break
        if current.get("status") in {"signed_in", "error"}:
            break
        if proc.poll() is not None:
            break
        time.sleep(0.2)
    return login_status(user_id)


def login_status(user_id: str) -> dict[str, Any]:
    auth = read_cursor_auth(user_id)
    with _lock:
        session = dict(_sessions.get(user_id) or {})
        proc = (_sessions.get(user_id) or {}).get("proc")
    running = bool(proc) and proc.poll() is None
    if auth.get("signed_in"):
        status = "signed_in"
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
    elif session.get("status") == "error":
        status = "error"
    elif running or session.get("status") in {"starting", "awaiting_browser"}:
        status = "awaiting_browser" if session.get("login_url") else "starting"
    else:
        status = "not_signed_in"
    return {
        "available": resolve_cursor_agent_bin() is not None,
        "status": status,
        "signed_in": status == "signed_in",
        "account_email": auth.get("account_email") or "",
        "plan_label": auth.get("plan_label") or ("Cursor" if status == "signed_in" else ""),
        "login_url": session.get("login_url") or "https://cursor.com/loginDeepControl",
        "error": session.get("error") or "",
    }


def logout_cursor(user_id: str) -> dict[str, Any]:
    home = user_cursor_home(user_id)
    with _lock:
        _kill_session(user_id)
    binary = resolve_cursor_agent_bin()
    if binary:
        try:
            subprocess.run(
                [str(binary), "logout"],
                cwd=str(home),
                env=_cursor_env(home),
                capture_output=True,
                text=True,
                timeout=15,
            )
        except Exception:
            pass
    for path in _auth_json_candidates(home):
        try:
            if path.is_file():
                path.unlink()
        except Exception:
            pass
    return login_status(user_id)
