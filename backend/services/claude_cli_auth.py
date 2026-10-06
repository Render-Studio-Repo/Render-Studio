"""Per-user Claude Pro/Max login via Claude Code CLI (ChatGPT/Codex-style)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.database import get_conn
from backend.services.cli_binaries import resolve_claude_bin
from backend.services.user_ai_keys_service import _decrypt, _encrypt

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07")
_LOGIN_URL_RE = re.compile(
    r"https://(?:claude\.(?:ai|com)|console\.anthropic\.com)/[^\s)\]>\"']+(?=[\s)\]>\"'])",
    re.I,
)
_PASTE_RE = re.compile(r"paste (?:the )?(?:code|authorization code|login code)", re.I)

_lock = threading.Lock()
_sessions: dict[str, dict[str, Any]] = {}
_AUTH_TTL_SECONDS = 30.0
_AUTH_TIMEOUT_SECONDS = 8.0
_AUTH_CACHE_LIMIT = 256
_auth_condition = threading.Condition()
_auth_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
_auth_inflight: dict[str, object] = {}


def _signed_out() -> dict[str, Any]:
    return {"signed_in": False, "account_email": "", "plan_label": ""}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_token_table(conn: Any) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS claude_subscription_tokens (
            user_id TEXT PRIMARY KEY,
            token_enc TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def _validate_subscription_token(token: str) -> str:
    value = str(token or "").strip()
    if not value.startswith("sk-ant-oat") or len(value) < 40 or any(char.isspace() for char in value):
        raise ValueError("Paste the complete token created by `claude setup-token`.")
    return value


def save_subscription_token(user_id: str, token: str) -> None:
    value = _validate_subscription_token(token)
    now = _now()
    with get_conn() as conn:
        _ensure_token_table(conn)
        conn.execute(
            """
            INSERT INTO claude_subscription_tokens (user_id, token_enc, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                token_enc = excluded.token_enc,
                updated_at = excluded.updated_at
            """,
            (str(user_id), _encrypt(value), now, now),
        )
        conn.commit()
    _invalidate_auth(user_id)


def read_subscription_token(user_id: str) -> str:
    with get_conn() as conn:
        _ensure_token_table(conn)
        row = conn.execute(
            "SELECT token_enc FROM claude_subscription_tokens WHERE user_id = ?",
            (str(user_id),),
        ).fetchone()
    return str(_decrypt(row["token_enc"]) or "") if row else ""


def clear_subscription_token(user_id: str) -> None:
    with get_conn() as conn:
        _ensure_token_table(conn)
        conn.execute("DELETE FROM claude_subscription_tokens WHERE user_id = ?", (str(user_id),))
        conn.commit()
    _invalidate_auth(user_id)


def user_claude_home(user_id: str) -> Path:
    root = Path(settings.data_dir).resolve() / "claude-homes" / str(user_id)
    root.mkdir(parents=True, exist_ok=True)
    (root / ".claude").mkdir(parents=True, exist_ok=True)
    return root


def _config_dir(home: Path) -> Path:
    path = home / ".claude"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _invalidate_auth(user_id: str) -> None:
    key = str(user_claude_home(user_id))
    with _auth_condition:
        _auth_cache.pop(key, None)
        _auth_inflight.pop(key, None)
        _auth_condition.notify_all()


def _probe_claude_auth(home: Path, user_id: str) -> dict[str, Any]:
    binary = resolve_claude_bin()
    if not binary:
        return _signed_out()
    try:
        result = subprocess.run(
            [str(binary), "auth", "status", "--json"],
            cwd=str(home), env=_claude_env(home, user_id=user_id), stdin=subprocess.DEVNULL,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=_AUTH_TIMEOUT_SECONDS,
        )
        if result.returncode != 0:
            return _signed_out()
        data = json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return _signed_out()
    if not isinstance(data, dict):
        return _signed_out()
    method = str(data.get("authMethod") or "")
    plan = data.get("subscriptionType")
    token_auth = method == "oauth_token" and bool(read_subscription_token(user_id))
    account_auth = method == "claude.ai" and isinstance(plan, str) and bool(plan.strip())
    if data.get("loggedIn") is not True or data.get("apiProvider") != "firstParty" or not (token_auth or account_auth):
        return _signed_out()
    email = data.get("email")
    return {"signed_in": True, "account_email": email[:160] if isinstance(email, str) else "",
            "plan_label": plan.strip()[:80] if account_auth else "Claude subscription token"}


def read_claude_auth(user_id: str) -> dict[str, Any]:
    """Ask Claude Code, which owns both file and Keychain credentials."""
    home = user_claude_home(user_id)
    key = str(home)
    deadline = time.monotonic() + _AUTH_TIMEOUT_SECONDS + 1
    with _auth_condition:
        while key in _auth_inflight:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return _signed_out()
            _auth_condition.wait(remaining)
        cached = _auth_cache.get(key)
        if cached and cached[0] > time.monotonic():
            _auth_cache.move_to_end(key)
            return dict(cached[1])
        flight = object()
        _auth_inflight[key] = flight
    result = _signed_out()
    try:
        result = _probe_claude_auth(home, user_id)
    finally:
        with _auth_condition:
            if _auth_inflight.get(key) is flight:
                _auth_inflight.pop(key, None)
                _auth_cache[key] = (time.monotonic() + _AUTH_TTL_SECONDS, dict(result))
                _auth_cache.move_to_end(key)
                while len(_auth_cache) > _AUTH_CACHE_LIMIT:
                    _auth_cache.popitem(last=False)
            else:
                result = _signed_out()
            _auth_condition.notify_all()
    return result


def _claude_env(home: Path, *, user_id: str | None = None) -> dict[str, str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["CLAUDE_CONFIG_DIR"] = str(_config_dir(home))
    env["TERM"] = "dumb"
    env["CI"] = "1"
    # The CLI launches BROWSER (or macOS open); remote users open the returned URL.
    env["BROWSER"] = "/usr/bin/true"
    for name in (
        "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
        "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_CUSTOM_HEADERS",
        "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_SCOPES",
        "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
    ):
        env.pop(name, None)
    if user_id:
        token = read_subscription_token(user_id)
        if token:
            env["CLAUDE_CODE_OAUTH_TOKEN"] = token
    path = env.get("PATH") or ""
    extra = [
        str(Path.home() / ".local" / "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
    ]
    env["PATH"] = os.pathsep.join([*extra, path] if path else extra)
    return env


def _parse_login_output(blob: str) -> tuple[str, bool]:
    text = _ANSI_RE.sub("", str(blob or "").replace("\r", "\n"))
    url = ""
    match = _LOGIN_URL_RE.search(text)
    if match:
        url = match.group(0).rstrip(").,;")
    needs_code = bool(_PASTE_RE.search(text))
    return url, needs_code


def _reader(user_id: str, proc: subprocess.Popen[str]) -> None:
    chunks: list[str] = []
    try:
        assert proc.stdout is not None
        while True:
            # Login prompts have no newline and may be shorter than 64 chars.
            # Read incrementally; the parser waits for a complete URL delimiter.
            piece = proc.stdout.read(1)
            if not piece:
                break
            chunks.append(piece)
            blob = "".join(chunks)
            url, needs_code = _parse_login_output(blob)
            with _lock:
                session = _sessions.get(user_id)
                if not session or session.get("proc") is not proc:
                    break
                if url:
                    session["login_url"] = url
                if needs_code:
                    session["needs_code"] = True
                if url or needs_code:
                    session["status"] = "awaiting_browser"
                session["log_tail"] = blob[-4000:]
    except Exception:
        with _lock:
            session = _sessions.get(user_id)
            if session and session.get("proc") is proc:
                session["error"] = "Could not read the Claude sign-in response. Start Sign in with Claude again."
                session["status"] = "error"
    finally:
        _complete_login(user_id, proc)


def _complete_login(user_id: str, proc: subprocess.Popen[str]) -> None:
    code = proc.poll()
    if code is None:
        return
    with _lock:
        session = _sessions.get(user_id)
        if not session or session.get("proc") is not proc or session.get("status") in {"checking", "signed_in", "error"}:
            return
        session["status"] = "checking"
    _invalidate_auth(user_id)
    auth = read_claude_auth(user_id) if code == 0 else _signed_out()
    with _lock:
        session = _sessions.get(user_id)
        if session and session.get("proc") is proc:
            session["status"] = "signed_in" if auth.get("signed_in") else "error"
            session["needs_code"] = False
            session["login_url"] = ""
            session["log_tail"] = ""
            session["error"] = "" if auth.get("signed_in") else "Claude sign-in could not be verified. Start Sign in with Claude again."


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
    binary = resolve_claude_bin()
    if not binary:
        raise RuntimeError(
            "Claude Code CLI is not installed on this host, so Claude subscription sign-in is unavailable."
        )
    home = user_claude_home(user_id)
    with _lock:
        _kill_session(user_id)
    _invalidate_auth(user_id)
    proc = subprocess.Popen(
        [str(binary), "auth", "login", "--claudeai"],
        cwd=str(home),
        env=_claude_env(home),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.PIPE,
        text=True,
        bufsize=0,
    )
    session = {
        "proc": proc,
        "status": "starting",
        "login_url": "",
        "needs_code": False,
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
        if current.get("login_url") or current.get("needs_code") or current.get("status") in {
            "awaiting_browser",
            "signed_in",
            "error",
        }:
            break
        if proc.poll() is not None:
            break
        time.sleep(0.2)
    return login_status(user_id)


def submit_login_code(user_id: str, code: str) -> dict[str, Any]:
    value = str(code or "").strip()
    if not value:
        raise ValueError("Paste the login code Claude showed in the browser.")
    if len(value) > 4096 or any(char.isspace() for char in value):
        raise ValueError("Paste the complete Claude authentication code as a single line.")
    with _lock:
        session = _sessions.get(user_id) or {}
        proc = session.get("proc")
    if not proc or proc.poll() is not None:
        raise RuntimeError("Start Sign in with Claude first, then paste the code.")
    try:
        assert proc.stdin is not None
        proc.stdin.write(value + "\n")
        proc.stdin.flush()
    except Exception as exc:
        raise RuntimeError("Could not send the Claude login code. Start Sign in with Claude again.") from exc
    _invalidate_auth(user_id)
    with _lock:
        if (_sessions.get(user_id) or {}).get("proc") is proc:
            _sessions[user_id]["needs_code"] = False
            _sessions[user_id]["status"] = "awaiting_browser"
    deadline = time.time() + 8
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        time.sleep(0.3)
    return login_status(user_id)


def login_status(user_id: str) -> dict[str, Any]:
    with _lock:
        proc = (_sessions.get(user_id) or {}).get("proc")
    if proc:
        _complete_login(user_id, proc)
    with _lock:
        session = dict(_sessions.get(user_id) or {})
        proc = session.get("proc")
    running = bool(proc) and proc.poll() is None
    auth = _signed_out()
    if session.get("status") == "error":
        status = "error"
    elif running:
        status = "awaiting_browser" if (session.get("login_url") or session.get("needs_code")) else "starting"
    elif session.get("status") == "checking":
        status = "awaiting_browser"
    else:
        auth = read_claude_auth(user_id)
        status = "signed_in" if auth.get("signed_in") else "not_signed_in"
    return {
        "available": resolve_claude_bin() is not None,
        "status": status,
        "signed_in": status == "signed_in",
        "account_email": auth.get("account_email") or "",
        "plan_label": auth.get("plan_label") or ("Claude" if status == "signed_in" else ""),
        "login_url": session.get("login_url") or "",
        "needs_code": bool(session.get("needs_code")),
        "error": session.get("error") or "",
    }


def logout_claude(user_id: str) -> dict[str, Any]:
    home = user_claude_home(user_id)
    with _lock:
        _kill_session(user_id)
    clear_subscription_token(user_id)
    _invalidate_auth(user_id)
    binary = resolve_claude_bin()
    failed = not binary
    if binary:
        try:
            result = subprocess.run(
                [str(binary), "auth", "logout"], cwd=str(home), env=_claude_env(home),
                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15,
            )
            failed = result.returncode != 0
        except (OSError, subprocess.SubprocessError):
            failed = True
    _invalidate_auth(user_id)
    status = login_status(user_id)
    if failed or status.get("signed_in"):
        status["error"] = "Claude sign-out could not be confirmed. Try signing out again."
        with _lock:
            _sessions[user_id] = {"status": status["status"], "error": status["error"]}
    return status
