"""Link GitHub as an authorized app (not a second login identity)."""

from __future__ import annotations

import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from backend.config import ENV_FILE, settings
from backend.database import get_conn
from backend.services.social_oauth import create_oauth_state

AUTH_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
API = "https://api.github.com"
UA = {"Accept": "application/vnd.github+json", "User-Agent": "Render-Studio"}
ALLOWED_NEXT = {"/", "/foundry.html", "/foundry.html#prs"}
DEFAULT_PROJECT_REPO = "wprojects/Render-Studio"
HOMEPAGE_URI = "https://render3d.app"
DEFAULT_CALLBACK = "https://render3d.app/oauth/github/callback"
CALLBACK_ALIAS = "https://render3d.app/oauth/github"
LOCAL_CALLBACK = "http://127.0.0.1:8001/oauth/github/callback"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def oauth_app_credentials() -> tuple[str, str]:
    """Client ID + secret from local env (synced from Supabase Auth GitHub provider).

    The client secret is never read in the browser. Management API typically does
    not return the secret after it is stored, so local ``.env`` stays the runtime
    copy for code exchange at ``/oauth/github/callback``.
    """
    cid = (settings.github_client_id or "").strip()
    secret = (settings.github_client_secret or "").strip()
    if cid and secret:
        return cid, secret
    try:
        from backend.services import supabase_client

        cfg = supabase_client.get_auth_config()
        cid = cid or str(cfg.get("external_github_client_id") or "").strip()
    except Exception:
        pass
    return cid, secret


def configured() -> bool:
    cid, secret = oauth_app_credentials()
    return bool(cid and secret)


def redirect_uri() -> str:
    return (settings.github_redirect_uri or DEFAULT_CALLBACK).strip()


def project_repo() -> str:
    return (settings.github_bugs_repo or "").strip() or DEFAULT_PROJECT_REPO


def callback_uris() -> list[str]:
    primary = redirect_uri()
    extras = [CALLBACK_ALIAS]
    if "localhost" not in primary and "127.0.0.1" not in primary:
        extras.append(LOCAL_CALLBACK)
    out = []
    for uri in [primary, *extras]:
        if uri and uri not in out:
            out.append(uri)
    return out


def _upsert_env(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    line = f"{key}={value}"
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    if text and not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def save_oauth_app(client_id: str, client_secret: str, *, env_path: Path | None = None) -> dict[str, Any]:
    """Persist Sam's GitHub OAuth App (one host app; each Studio user links their GitHub)."""
    cid = (client_id or "").strip()
    secret = (client_secret or "").strip()
    if len(cid) < 8 or len(secret) < 8:
        raise ValueError("Paste the GitHub OAuth App client ID and client secret.")
    path = env_path or ENV_FILE
    text = path.read_text() if path.exists() else ""
    text = _upsert_env(text, "GITHUB_CLIENT_ID", cid)
    text = _upsert_env(text, "GITHUB_CLIENT_SECRET", secret)
    text = _upsert_env(text, "GITHUB_REDIRECT_URI", redirect_uri() or DEFAULT_CALLBACK)
    path.write_text(text)
    settings.github_client_id = cid
    settings.github_client_secret = secret
    supabase_ok = False
    try:
        from backend.services import supabase_client

        result = supabase_client.configure_github_auth_provider(cid, secret)
        supabase_ok = bool(result.get("ok"))
    except Exception:
        supabase_ok = False
    return {
        "configured": True,
        "needs_restart": True,
        "redirect_uri": redirect_uri(),
        "homepage_uri": HOMEPAGE_URI,
        "supabase_auth_provider": supabase_ok,
    }


def safe_next_path(path: str | None) -> str:
    raw = (path or "/foundry.html").strip() or "/foundry.html"
    return raw if raw in ALLOWED_NEXT else "/foundry.html"


def link_url(user_id: str, next_path: str | None = "/foundry.html") -> str:
    cid, secret = oauth_app_credentials()
    if not cid or not secret:
        raise RuntimeError("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.")
    dest = safe_next_path(next_path)
    state = create_oauth_state(user_id, redirect_path=dest)
    params = {
        "client_id": cid,
        "redirect_uri": redirect_uri(),
        "scope": "read:user repo",
        "state": state,
        "allow_signup": "false",
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def _looks_like_github_token(raw: str) -> bool:
    text = (raw or "").strip()
    if len(text) < 20 or len(text) > 255:
        return False
    if text.startswith(("ghp_", "github_pat_", "gho_", "ghu_", "ghs_")):
        return True
    return bool(re.fullmatch(r"[0-9a-fA-F]{40}", text))


def _github_profile(token: str) -> dict[str, Any]:
    profile = httpx.get(
        f"{API}/user",
        headers={"Authorization": f"Bearer {token}", **UA},
        timeout=15,
    )
    if profile.status_code in {401, 403}:
        raise ValueError("GitHub rejected that token. Check repo scope and try again.")
    profile.raise_for_status()
    data = profile.json()
    if not str(data.get("id") or "").strip():
        raise ValueError("GitHub did not return a user id.")
    return data


def _persist_link(user_id: str, token: str, data: dict[str, Any]) -> dict[str, Any]:
    gh_id = str(data.get("id") or "").strip()
    login = str(data.get("login") or "").strip()
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO social_accounts
               (provider, provider_user_id, user_id, email, display_name, picture_url, created_at, updated_at)
               VALUES ('github', ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(provider, provider_user_id) DO UPDATE SET
                 user_id = excluded.user_id,
                 email = excluded.email,
                 display_name = excluded.display_name,
                 picture_url = excluded.picture_url,
                 updated_at = excluded.updated_at
            """,
            (gh_id, user_id, login, data.get("name") or login, data.get("avatar_url"), now, now),
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS github_tokens (
                user_id TEXT PRIMARY KEY,
                access_token TEXT NOT NULL,
                login TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO github_tokens (user_id, access_token, login, updated_at) VALUES (?, ?, ?, ?)",
            (user_id, token, login, now),
        )
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.set_github_pat(user_id, token)
    except Exception:
        pass
    return {"github_id": gh_id, "login": login, "avatar_url": data.get("avatar_url")}


def save_personal_token(user_id: str, token: str) -> dict[str, Any]:
    raw = (token or "").strip()
    if not _looks_like_github_token(raw):
        raise ValueError("Paste a GitHub personal access token (ghp_ / github_pat_ / classic 40-character token).")
    return _persist_link(user_id, raw, _github_profile(raw))


def upsert_link(user_id: str, code: str) -> dict[str, Any]:
    cid, secret = oauth_app_credentials()
    if not cid or not secret:
        raise RuntimeError("GitHub OAuth is not configured.")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "client_id": cid,
            "client_secret": secret,
            "code": code,
            "redirect_uri": redirect_uri(),
        },
        headers={"Accept": "application/json", "User-Agent": "Render-Studio"},
        timeout=20,
    )
    resp.raise_for_status()
    token = str(resp.json().get("access_token") or "")
    if not token:
        raise RuntimeError("GitHub did not return an access token.")
    return _persist_link(user_id, token, _github_profile(token))


def upsert_supabase_github_link(user_id: str, code: str) -> dict[str, Any]:
    """Exchange a Supabase Auth PKCE code and keep the GitHub provider_token."""
    from backend.services import supabase_client

    client = supabase_client.get_auth_client()
    if client is None:
        raise RuntimeError("Supabase Auth is not configured.")
    try:
        res = client.auth.exchange_code_for_session({"auth_code": code})
    except TypeError:
        res = client.auth.exchange_code_for_session(code)
    session = getattr(res, "session", None) or (res.get("session") if isinstance(res, dict) else None)
    token = ""
    if session is not None:
        token = str(getattr(session, "provider_token", None) or "")
        if not token and isinstance(session, dict):
            token = str(session.get("provider_token") or "")
    if not token:
        raise RuntimeError("Supabase Auth did not return a GitHub provider token.")
    return _persist_link(user_id, token, _github_profile(token))


def linked_account(user_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT provider_user_id, email, display_name, picture_url, updated_at
                 FROM social_accounts
                WHERE provider = 'github' AND user_id = ?
                ORDER BY updated_at DESC LIMIT 1""",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "github_id": row["provider_user_id"],
        "login": row["email"],
        "display_name": row["display_name"],
        "avatar_url": row["picture_url"],
        "updated_at": row["updated_at"],
    }


def unlink(user_id: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM social_accounts WHERE provider = 'github' AND user_id = ?", (user_id,))
        try:
            conn.execute("DELETE FROM github_tokens WHERE user_id = ?", (user_id,))
        except Exception:
            pass
    try:
        from backend.services import supabase_users_store as sbusers

        sbusers.clear_github_pat(user_id)
    except Exception:
        pass


def _token_for(user_id: str) -> tuple[str, str]:
    login = ""
    token = ""
    with get_conn() as conn:
        try:
            row = conn.execute(
                "SELECT access_token, login FROM github_tokens WHERE user_id=?",
                (user_id,),
            ).fetchone()
            if row:
                token = str(row["access_token"] or "")
                login = str(row["login"] or "")
        except Exception:
            token = ""
    if not token:
        try:
            from backend.services import supabase_users_store as sbusers

            token = sbusers.github_pat(user_id) or ""
        except Exception:
            token = token or ""
    account = linked_account(user_id)
    if not login and account:
        login = str(account.get("login") or "")
    return token, login


def status(user: dict[str, Any]) -> dict[str, Any]:
    account = linked_account(user["id"])
    token, login = _token_for(user["id"])
    ready = configured()
    repo = project_repo()
    provider = {}
    try:
        from backend.services import supabase_client

        provider = supabase_client.github_auth_provider_status()
    except Exception:
        provider = {}
    return {
        "configured": ready,
        "connected": bool(account),
        "can_list_prs": bool(token and login),
        "can_submit": bool(token),
        "pat_available": True,
        "redirect_uri": redirect_uri(),
        "homepage_uri": HOMEPAGE_URI,
        "callback_uris": callback_uris(),
        "oauth_via": "supabase_auth_github_provider",
        "supabase_github_provider": bool(provider.get("enabled") or provider.get("client_id_set")),
        "secrets_column": "github_pat",
        "project_repo": repo,
        "project_url": f"https://github.com/{repo}",
        "account": account,
        "bugs_repo": (settings.github_bugs_repo or "").strip() or None,
        "bugs_branch": (settings.github_bugs_branch or "bugs").strip() or "bugs",
        "bugs_ready": bool((settings.github_token or "").strip() and (settings.github_bugs_repo or "").strip()),
    }


def list_user_prs(user_id: str, *, limit: int = 12) -> list[dict[str, Any]]:
    token, login = _token_for(user_id)
    if not token or not login:
        return []
    repo = project_repo()
    q = urllib.parse.quote(f"author:{login} is:pr repo:{repo}")
    resp = httpx.get(
        f"{API}/search/issues?q={q}&per_page={limit}",
        headers={"Authorization": f"Bearer {token}", **UA},
        timeout=20,
    )
    if resp.status_code >= 400 or not (resp.json().get("items") or []):
        q = urllib.parse.quote(f"author:{login} is:pr")
        resp = httpx.get(
            f"{API}/search/issues?q={q}&per_page={limit}",
            headers={"Authorization": f"Bearer {token}", **UA},
            timeout=20,
        )
    if resp.status_code >= 400:
        return []
    items = resp.json().get("items") or []
    out = []
    for it in items[:limit]:
        out.append(
            {
                "title": it.get("title"),
                "number": it.get("number"),
                "state": it.get("state"),
                "html_url": it.get("html_url"),
                "updated_at": it.get("updated_at"),
                "repo": (it.get("repository_url") or "").rsplit("/", 1)[-1],
            }
        )
    return out


def access_token_for(user_id: str) -> str:
    """Return the linked GitHub token for a server-side action."""
    try:
        token, _login = _token_for(user_id)
        return token
    except Exception:
        return ""


def submit_to_project(user_id: str, title: str, body: str) -> dict[str, Any]:
    """Open an issue on the project as the linked GitHub user (not a second Studio login)."""
    token, login = _token_for(user_id)
    if not token:
        raise ValueError("Link GitHub first, then submit to the project.")
    repo = project_repo()
    heading = (title or "Studio contribution").strip()[:200] or "Studio contribution"
    note = (body or "").strip()[:12000]
    resp = httpx.post(
        f"{API}/repos/{repo}/issues",
        headers={"Authorization": f"Bearer {token}", **UA},
        json={"title": heading, "body": note or f"Submitted from Foundry by {login or 'a linked GitHub account'}."},
        timeout=20,
    )
    if resp.status_code >= 400:
        raise ValueError(f"GitHub could not open that on {repo}. Check repo access on the linked account.")
    data = resp.json() if resp.content else {}
    return {
        "ok": True,
        "repo": repo,
        "number": data.get("number"),
        "html_url": data.get("html_url"),
        "login": login,
    }


def push_bug_note(title: str, body: str) -> dict[str, Any]:
    """Commit a miniaturized bug note to the configured bugs branch. Gap if unset."""
    token = (settings.github_token or "").strip()
    repo = (settings.github_bugs_repo or "").strip()
    branch = (settings.github_bugs_branch or "bugs").strip() or "bugs"
    if not token or not repo:
        return {"ok": False, "error": "github_bugs_not_configured"}
    path = f"bugs/{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}-{title[:32].replace(' ', '-')}.md"
    content = (f"# {title}\n\n{body}\n").encode("utf-8")
    import base64

    resp = httpx.put(
        f"{API}/repos/{repo}/contents/{path}",
        headers={"Authorization": f"Bearer {token}", **UA},
        json={
            "message": f"bug: {title[:72]}",
            "content": base64.b64encode(content).decode("ascii"),
            "branch": branch,
        },
        timeout=20,
    )
    if resp.status_code >= 400:
        return {"ok": False, "error": resp.text[:240], "branch": branch, "repo": repo}
    return {"ok": True, "path": path, "branch": branch, "repo": repo, "html_url": (resp.json().get("content") or {}).get("html_url")}
