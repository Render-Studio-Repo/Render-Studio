"""
GitHub OAuth link + automated source-code backup config for Server Setup.

Local state (gitignored):
  data/server-config/github-backup.json
  data/server-config/secrets/github/secret.env
"""

from __future__ import annotations

import json
import os
import re
import secrets
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from backend.services import server_secrets_vault as secrets_vault

ROOT = Path(__file__).resolve().parents[2]
LOCAL_ROOT = ROOT / "data" / "server-config"
CONFIG_PATH = LOCAL_ROOT / "github-backup.json"
OAUTH_STATE_PATH = LOCAL_ROOT / "github-oauth-state.json"

AUTH_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
API_BASE = "https://api.github.com"

INTERVALS = {
    "hourly": {
        "label": "Hourly",
        "systemd_on_calendar": "hourly",
        "summary": "Push a source-code snapshot every hour.",
    },
    "daily": {
        "label": "Daily",
        "systemd_on_calendar": "daily",
        "summary": "Push a source-code snapshot once per day.",
    },
    "monthly": {
        "label": "Monthly",
        "systemd_on_calendar": "monthly",
        "summary": "Push a source-code snapshot once per month.",
    },
}

DEFAULT_EXCLUDES = [
    "projects/",
    "backups/",
    "milestones/",
    "data/",
    ".venv/",
    "myenv/",
    "node_modules/",
    "__pycache__/",
    ".git/",
    "*.glb",
    "*.gltf",
    "*.stl",
    "*.step",
    "*.stp",
    "*.obj",
    "*.3mf",
    "*.ply",
    "*.fbx",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _default_config() -> Dict[str, Any]:
    return {
        "schema_version": 1,
        "github_skipped": False,
        "github_linked": False,
        "github_login": "",
        "backup_enabled": False,
        "repo_full_name": "",
        "branch": "main",
        "interval": "daily",
        "scope": "source-code",
        "excludes": list(DEFAULT_EXCLUDES),
        "drive_models_opt_in": False,
        "timer_install_hint": "bash integrations/github/install-backup-timer.sh",
        "updated_at": None,
    }


def load_config() -> Dict[str, Any]:
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    secrets_vault.ensure_vault_files()
    if not CONFIG_PATH.is_file():
        cfg = _default_config()
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
        return cfg
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    base = _default_config()
    for key in base:
        if key in data:
            base[key] = data[key]
    if base.get("interval") not in INTERVALS:
        base["interval"] = "daily"
    if not isinstance(base.get("excludes"), list):
        base["excludes"] = list(DEFAULT_EXCLUDES)
    login = (secrets_vault._read_app_secrets("github").get("GITHUB_LOGIN") or "").strip()
    token = (secrets_vault._read_app_secrets("github").get("GITHUB_ACCESS_TOKEN") or "").strip()
    if login:
        base["github_login"] = login
    base["github_linked"] = bool(token and (login or base.get("github_login")))
    return base


def save_config(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = load_config()
    if not isinstance(patch, dict):
        raise ValueError("github backup patch must be an object")
    for key in (
        "github_skipped",
        "github_linked",
        "github_login",
        "backup_enabled",
        "repo_full_name",
        "branch",
        "interval",
        "scope",
        "drive_models_opt_in",
        "timer_install_hint",
    ):
        if key in patch:
            current[key] = patch[key]
    if "excludes" in patch and isinstance(patch["excludes"], list):
        current["excludes"] = [str(x) for x in patch["excludes"][:80]]
    if current.get("interval") not in INTERVALS:
        current["interval"] = "daily"
    repo = str(current.get("repo_full_name") or "").strip()
    if repo and not re.match(r"^[\w.\-]+/[\w.\-]+$", repo):
        raise ValueError("repo_full_name must look like owner/name")
    current["repo_full_name"] = repo
    current["branch"] = (str(current.get("branch") or "main").strip() or "main")[:120]
    current["updated_at"] = _now_iso()
    CONFIG_PATH.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def _cred(key: str) -> str:
    secrets_vault.ensure_vault_files()
    vault = secrets_vault._read_app_secrets("github")
    return (vault.get(key) or os.environ.get(key) or "").strip()


def oauth_configured() -> bool:
    return bool(_cred("GITHUB_OAUTH_CLIENT_ID") and _cred("GITHUB_OAUTH_CLIENT_SECRET"))


def redirect_uri() -> str:
    return (
        _cred("GITHUB_OAUTH_REDIRECT_URI")
        or os.environ.get("GITHUB_OAUTH_REDIRECT_URI")
        or "https://render3d.app/oauth/github/callback"
    ).strip()


def _save_oauth_state(state: str, user_id: str) -> None:
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    payload = {"state": state, "user_id": str(user_id), "created_at": _now_iso()}
    OAUTH_STATE_PATH.write_text(json.dumps(payload) + "\n", encoding="utf-8")


def _consume_oauth_state(state: str) -> Optional[str]:
    if not OAUTH_STATE_PATH.is_file():
        return None
    try:
        data = json.loads(OAUTH_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    try:
        OAUTH_STATE_PATH.unlink(missing_ok=True)
    except Exception:
        pass
    if not isinstance(data, dict) or data.get("state") != state:
        return None
    return str(data.get("user_id") or "")


def build_authorize_url(*, user_id: str) -> str:
    if not oauth_configured():
        raise RuntimeError(
            "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and "
            "GITHUB_OAUTH_CLIENT_SECRET in data/server-config/secrets/github/secret.env"
        )
    state = secrets.token_urlsafe(24)
    _save_oauth_state(state, user_id)
    params = {
        "client_id": _cred("GITHUB_OAUTH_CLIENT_ID"),
        "redirect_uri": redirect_uri(),
        "scope": "repo read:user",
        "state": state,
        "allow_signup": "false",
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def exchange_code(code: str) -> Dict[str, Any]:
    if not oauth_configured():
        raise RuntimeError("GitHub OAuth is not configured.")
    resp = httpx.post(
        TOKEN_URL,
        data={
            "client_id": _cred("GITHUB_OAUTH_CLIENT_ID"),
            "client_secret": _cred("GITHUB_OAUTH_CLIENT_SECRET"),
            "code": code,
            "redirect_uri": redirect_uri(),
        },
        headers={"Accept": "application/json"},
        timeout=25,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise RuntimeError(str(data.get("error_description") or data.get("error")))
    token = str(data.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("GitHub did not return an access token.")
    return data


def _gh_headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "RenderStudio-ServerSetup",
    }


def fetch_user(token: str) -> Dict[str, Any]:
    resp = httpx.get(f"{API_BASE}/user", headers=_gh_headers(token), timeout=20)
    resp.raise_for_status()
    return resp.json()


def complete_oauth(*, code: str, state: str) -> Dict[str, Any]:
    user_id = _consume_oauth_state(state)
    if not user_id:
        raise RuntimeError("invalid_state")
    token_payload = exchange_code(code)
    access_token = str(token_payload.get("access_token") or "").strip()
    profile = fetch_user(access_token)
    login = str(profile.get("login") or "").strip()
    if not login:
        raise RuntimeError("GitHub did not return a login.")
    secrets_vault.save_app_secrets(
        "github",
        {
            "GITHUB_ACCESS_TOKEN": access_token,
            "GITHUB_LOGIN": login,
        },
    )
    cfg = save_config(
        {
            "github_linked": True,
            "github_skipped": False,
            "github_login": login,
        }
    )
    return {"ok": True, "login": login, "user_id": user_id, "config": cfg}


def access_token() -> str:
    return _cred("GITHUB_ACCESS_TOKEN")


def list_repos(*, limit: int = 40) -> List[Dict[str, Any]]:
    token = access_token()
    if not token:
        raise RuntimeError("GitHub is not linked. Connect GitHub first.")
    limit = max(1, min(int(limit or 40), 100))
    resp = httpx.get(
        f"{API_BASE}/user/repos",
        headers=_gh_headers(token),
        params={
            "per_page": limit,
            "sort": "updated",
            "affiliation": "owner,collaborator,organization_member",
        },
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json() if isinstance(resp.json(), list) else []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            {
                "full_name": row.get("full_name"),
                "private": bool(row.get("private")),
                "default_branch": row.get("default_branch") or "main",
                "html_url": row.get("html_url"),
            }
        )
    return out


def list_branches(repo_full_name: str) -> List[str]:
    token = access_token()
    if not token:
        raise RuntimeError("GitHub is not linked.")
    repo = (repo_full_name or "").strip()
    if not re.match(r"^[\w.\-]+/[\w.\-]+$", repo):
        raise ValueError("Invalid repo_full_name")
    owner, _, name = repo.partition("/")
    resp = httpx.get(
        f"{API_BASE}/repos/{owner}/{name}/branches",
        headers=_gh_headers(token),
        params={"per_page": 100},
        timeout=30,
    )
    resp.raise_for_status()
    rows = resp.json() if isinstance(resp.json(), list) else []
    return [str(r.get("name")) for r in rows if isinstance(r, dict) and r.get("name")]


def public_status() -> Dict[str, Any]:
    cfg = load_config()
    return {
        "ok": True,
        "oauth_configured": oauth_configured(),
        "has_client_secret": bool(_cred("GITHUB_OAUTH_CLIENT_SECRET")),
        "has_client_id": bool(_cred("GITHUB_OAUTH_CLIENT_ID")),
        "redirect_uri": redirect_uri(),
        "linked": bool(cfg.get("github_linked")),
        "login": cfg.get("github_login") or "",
        "skipped": bool(cfg.get("github_skipped")),
        "backup": {
            "enabled": bool(cfg.get("backup_enabled")),
            "repo_full_name": cfg.get("repo_full_name") or "",
            "branch": cfg.get("branch") or "main",
            "interval": cfg.get("interval") or "daily",
            "scope": cfg.get("scope") or "source-code",
            "excludes": cfg.get("excludes") or list(DEFAULT_EXCLUDES),
        },
        "intervals": [{"id": key, **val} for key, val in INTERVALS.items()],
        "drive_models_opt_in": bool(cfg.get("drive_models_opt_in")),
        "paths": {
            "config": "data/server-config/github-backup.json",
            "secrets": "data/server-config/secrets/github/",
            "backup_script": "scripts/backup-to-github.sh",
            "timer_install": "integrations/github/install-backup-timer.sh",
            "drive_install": "integrations/github/install-drive-model-backup.sh",
            "units": "integrations/github/systemd/",
        },
        "config": cfg,
    }


def install_instructions() -> Dict[str, Any]:
    cfg = load_config()
    interval = cfg.get("interval") or "daily"
    cal = INTERVALS.get(interval, INTERVALS["daily"])["systemd_on_calendar"]
    return {
        "ok": True,
        "interval": interval,
        "on_calendar": cal,
        "commands": [
            "export RENDER_STUDIO_ROOT=\"$(pwd)\"",
            "bash integrations/github/install-backup-timer.sh",
            "# optional models → Drive:",
            "bash integrations/github/install-drive-model-backup.sh",
        ],
        "notes": [
            "Unit templates use RENDER_STUDIO_ROOT — no hard-coded /home paths.",
            "Default GitHub backup scope is source code only (excludes 3D models, venv, node_modules).",
            "Drive model backup is opt-in and reuses scripts/backup-to-drive.py.",
        ],
    }
