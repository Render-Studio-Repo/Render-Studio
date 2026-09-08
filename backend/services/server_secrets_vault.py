"""
Local secrets vault for Render Studio server settings.

Live secrets (gitignored under data/):
  data/server-config/secrets/
    README.md
    manifest.json
    <app-id>/
      README.md
      secret.env
      updated_at.txt

Public templates (tracked, no real secrets):
  server-configurations/secrets-templates/
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
LOCAL_SECRETS = ROOT / "data" / "server-config" / "secrets"
PUBLIC_TEMPLATES = ROOT / "server-configurations" / "secrets-templates"
MANIFEST_PATH = LOCAL_SECRETS / "manifest.json"

SECRET_APPS: Dict[str, Dict[str, Any]] = {
    "openai": {
        "label": "OpenAI",
        "description": "Chat / CAD agent models (GPT).",
        "keys": ["OPENAI_API_KEY"],
        "env_aliases": ["OPENAI_API_KEY"],
    },
    "anthropic": {
        "label": "Anthropic",
        "description": "Claude models for Render Agent and CAD assist.",
        "keys": ["ANTHROPIC_API_KEY"],
        "env_aliases": ["ANTHROPIC_API_KEY"],
    },
    "stripe": {
        "label": "Stripe",
        "description": "Billing, Connect, marketplace payouts.",
        "keys": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY"],
        "env_aliases": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY"],
    },
    "slack": {
        "label": "Slack",
        "description": "Update publishing webhook / bot.",
        "keys": ["SLACK_UPDATES_WEBHOOK_URL", "SLACK_BOT_TOKEN"],
        "env_aliases": ["SLACK_UPDATES_WEBHOOK_URL", "SLACK_BOT_TOKEN", "SLACK_TOKEN"],
    },
    "discord": {
        "label": "Discord",
        "description": "Community updates + OAuth linking.",
        "keys": ["DISCORD_BOT_TOKEN", "DISCORD_UPDATES_WEBHOOK_URL", "DISCORD_UPDATES_CHANNEL_ID"],
        "env_aliases": [
            "DISCORD_BOT_TOKEN",
            "DISCORD_UPDATES_WEBHOOK_URL",
            "DISCORD_UPDATES_CHANNEL_ID",
            "DISCORD_WEBHOOK_URL",
        ],
    },
    "linkedin": {
        "label": "LinkedIn",
        "description": "Product update posts.",
        "keys": ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN"],
        "env_aliases": ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN"],
    },
    "google-drive": {
        "label": "Google Drive",
        "description": "Model / project storage + backups.",
        "keys": ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"],
        "env_aliases": [
            "GOOGLE_DRIVE_CLIENT_ID",
            "GOOGLE_DRIVE_CLIENT_SECRET",
            "GOOGLE_DRIVE_REFRESH_TOKEN",
            "GOOGLE_CLIENT_ID",
            "GOOGLE_CLIENT_SECRET",
        ],
    },
    "mysql": {
        "label": "MySQL / MariaDB",
        "description": "External username/password database (optional).",
        "keys": ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"],
        "env_aliases": ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"],
    },
    "supabase": {
        "label": "Supabase",
        "description": "Auth / secrets store when used as the org backend.",
        "keys": ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
        "env_aliases": ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    },
    "jwt": {
        "label": "JWT / session",
        "description": "Server session signing secret.",
        "keys": ["JWT_SECRET"],
        "env_aliases": ["JWT_SECRET", "SECRET_KEY"],
    },
    "owner": {
        "label": "Owner identity",
        "description": "Backup + admin identity gate (email / GitHub / token).",
        "keys": ["OWNER_EMAIL", "OWNER_GITHUB", "BACKUP_OWNER_TOKEN"],
        "env_aliases": ["OWNER_EMAIL", "OWNER_GITHUB", "BACKUP_OWNER_TOKEN"],
    },
    "github": {
        "label": "GitHub OAuth / backups",
        "description": "OAuth App credentials + linked token for Server Setup Connect and source-code backups.",
        "keys": [
            "GITHUB_OAUTH_CLIENT_ID",
            "GITHUB_OAUTH_CLIENT_SECRET",
            "GITHUB_OAUTH_REDIRECT_URI",
            "GITHUB_ACCESS_TOKEN",
            "GITHUB_LOGIN",
        ],
        "env_aliases": [
            "GITHUB_OAUTH_CLIENT_ID",
            "GITHUB_OAUTH_CLIENT_SECRET",
            "GITHUB_OAUTH_REDIRECT_URI",
            "GITHUB_CLIENT_ID",
            "GITHUB_CLIENT_SECRET",
            "GITHUB_ACCESS_TOKEN",
            "GITHUB_LOGIN",
        ],
    },
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_app_id(app_id: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\-]+", "-", str(app_id or "").strip().lower()).strip("-")
    if not cleaned or cleaned.startswith("."):
        raise ValueError("Invalid app id")
    return cleaned


def _app_dir(app_id: str) -> Path:
    return LOCAL_SECRETS / _safe_app_id(app_id)


def _readme_for_app(app_id: str, meta: Dict[str, Any]) -> str:
    keys = "\n".join(f"- `{k}`" for k in meta.get("keys") or [])
    first_key = (meta.get("keys") or ["EXAMPLE_KEY"])[0]
    return f"""# {meta.get('label') or app_id}

{meta.get('description') or ''}

## Keys in this folder

{keys}

## How to update

1. Edit `secret.env` in this folder (one `KEY=value` per line), **or**
2. Upload a bulk settings `.txt` from Management → Server Setup → Secrets, **or**
3. Ask Render Agent (server-setup skill) to walk you through connecting this app.

Never commit real values. This folder lives under `data/` and is gitignored.

## Example `secret.env`

```env
{first_key}=your-value-here
```
"""


def _write_manifest(data: Dict[str, Any]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _load_manifest() -> Dict[str, Any]:
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("apps", {})
            return data
    except Exception:
        pass
    return {"version": 1, "apps": {}, "updated_at": _now_iso()}


def _parse_env_text(text: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            out[key] = val
    return out


def _read_app_secrets(app_id: str) -> Dict[str, str]:
    path = _app_dir(app_id) / "secret.env"
    if not path.is_file():
        return {}
    return _parse_env_text(path.read_text(encoding="utf-8"))


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 6:
        return "*" * len(value)
    return value[:3] + "…" + value[-2:]


def seed_public_templates() -> None:
    PUBLIC_TEMPLATES.mkdir(parents=True, exist_ok=True)
    (PUBLIC_TEMPLATES / "README.md").write_text(
        """# Secrets templates (public)

These are **documentation stubs only** — never put real keys here.

Live secrets for each install live in gitignored:

`data/server-config/secrets/<app-id>/secret.env`

Use `EXAMPLE-bulk-settings.txt` as the upload format in the setup wizard.
""",
        encoding="utf-8",
    )
    example = PUBLIC_TEMPLATES / "EXAMPLE-bulk-settings.txt"
    example.write_text(
        """# Render Studio — bulk secrets upload example
# Upload this (with your real values) from Server Setup → Secrets.
# Safe forms:
#   KEY=value
#   app-id.KEY=value
#   app-id.api_key=value   (for openai / anthropic)

# AI providers
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key

# Owner identity (required for backups / premium sync)
OWNER_EMAIL=you@company.com
OWNER_GITHUB=your-github-username
BACKUP_OWNER_TOKEN=generate-a-long-random-token

# Billing (optional)
STRIPE_SECRET_KEY=sk_live_or_test
STRIPE_PUBLISHABLE_KEY=pk_live_or_test
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Update publishing
SLACK_UPDATES_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
DISCORD_BOT_TOKEN=
DISCORD_UPDATES_CHANNEL_ID=
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_AUTHOR_URN=

# Storage / DB (optional)
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=render_studio
MYSQL_USER=render
MYSQL_PASSWORD=

# GitHub OAuth (Server Setup Connect + source backups)
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
GITHUB_OAUTH_REDIRECT_URI=https://render3d.app/oauth/github/callback

# Auth platform (optional)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=change-me-to-a-long-random-string
""",
        encoding="utf-8",
    )
    for app_id, meta in SECRET_APPS.items():
        folder = PUBLIC_TEMPLATES / app_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "README.md").write_text(_readme_for_app(app_id, meta), encoding="utf-8")


def ensure_vault_files() -> None:
    LOCAL_SECRETS.mkdir(parents=True, exist_ok=True)
    readme = LOCAL_SECRETS / "README.md"
    if not readme.is_file():
        readme.write_text(
            """# Server secrets vault (local only)

This directory stores API keys, passwords, and authorized-app credentials for
**this Render Studio install**. It is gitignored under `data/server-config/`.

Each authorized app has its own folder with a README and `secret.env`.

Public templates (no secrets): `server-configurations/secrets-templates/`
Bulk upload example: `server-configurations/secrets-templates/EXAMPLE-bulk-settings.txt`
""",
            encoding="utf-8",
        )
    for app_id, meta in SECRET_APPS.items():
        folder = _app_dir(app_id)
        folder.mkdir(parents=True, exist_ok=True)
        app_readme = folder / "README.md"
        if not app_readme.is_file():
            app_readme.write_text(_readme_for_app(app_id, meta), encoding="utf-8")
        secret_env = folder / "secret.env"
        if not secret_env.is_file():
            lines = [f"# {meta.get('label') or app_id} — local secrets (never commit)"]
            for key in meta.get("keys") or []:
                lines.append(f"{key}=")
            secret_env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if not MANIFEST_PATH.is_file():
        _write_manifest({"version": 1, "apps": {}, "updated_at": _now_iso()})
    seed_public_templates()


def status_view() -> Dict[str, Any]:
    ensure_vault_files()
    manifest = _load_manifest()
    apps: List[Dict[str, Any]] = []
    for app_id, meta in SECRET_APPS.items():
        values = _read_app_secrets(app_id)
        configured_keys = [k for k in (meta.get("keys") or []) if str(values.get(k) or "").strip()]
        env_hits = [k for k in (meta.get("env_aliases") or []) if str(os.environ.get(k) or "").strip()]
        apps.append(
            {
                "id": app_id,
                "label": meta.get("label") or app_id,
                "description": meta.get("description") or "",
                "keys": meta.get("keys") or [],
                "configured_keys": configured_keys,
                "configured": bool(configured_keys) or bool(env_hits),
                "from_env": bool(env_hits) and not configured_keys,
                "path": f"data/server-config/secrets/{app_id}/",
                "updated_at": (manifest.get("apps") or {}).get(app_id, {}).get("updated_at"),
            }
        )
    return {
        "ok": True,
        "vault_path": "data/server-config/secrets/",
        "templates_path": "server-configurations/secrets-templates/",
        "bulk_example": "server-configurations/secrets-templates/EXAMPLE-bulk-settings.txt",
        "apps": apps,
        "configured_count": sum(1 for a in apps if a["configured"]),
        "total_apps": len(apps),
    }


def ensure_vault() -> Dict[str, Any]:
    ensure_vault_files()
    return status_view()


def get_app_detail(app_id: str, *, reveal: bool = False) -> Dict[str, Any]:
    app_id = _safe_app_id(app_id)
    meta = SECRET_APPS.get(app_id)
    if not meta:
        raise FileNotFoundError(f"Unknown secret app: {app_id}")
    ensure_vault_files()
    values = _read_app_secrets(app_id)
    keys_out = []
    for key in meta.get("keys") or []:
        raw = str(values.get(key) or "")
        keys_out.append(
            {
                "key": key,
                "set": bool(raw.strip()),
                "value": raw if reveal else _mask(raw),
            }
        )
    readme = (_app_dir(app_id) / "README.md").read_text(encoding="utf-8")
    return {
        "id": app_id,
        "label": meta.get("label"),
        "description": meta.get("description"),
        "keys": keys_out,
        "readme": readme,
        "path": f"data/server-config/secrets/{app_id}/secret.env",
    }


def save_app_secrets(app_id: str, values: Dict[str, str]) -> Dict[str, Any]:
    app_id = _safe_app_id(app_id)
    meta = SECRET_APPS.get(app_id)
    if not meta:
        raise FileNotFoundError(f"Unknown secret app: {app_id}")
    ensure_vault_files()
    current = _read_app_secrets(app_id)
    allowed = set(meta.get("keys") or [])
    for key, val in (values or {}).items():
        if key not in allowed or val is None:
            continue
        text = str(val)
        if "…" in text or text == _mask(current.get(key, "")):
            continue
        current[key] = text.strip()

    lines = [f"# {meta.get('label') or app_id} — updated {_now_iso()}"]
    for key in meta.get("keys") or []:
        lines.append(f"{key}={current.get(key, '')}")
    (_app_dir(app_id) / "secret.env").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (_app_dir(app_id) / "updated_at.txt").write_text(_now_iso() + "\n", encoding="utf-8")

    manifest = _load_manifest()
    manifest.setdefault("apps", {})[app_id] = {
        "updated_at": _now_iso(),
        "configured_keys": [k for k in (meta.get("keys") or []) if str(current.get(k) or "").strip()],
    }
    manifest["updated_at"] = _now_iso()
    _write_manifest(manifest)

    for key in meta.get("keys") or []:
        val = str(current.get(key) or "").strip()
        if val:
            os.environ[key] = val

    return get_app_detail(app_id, reveal=False)


def apply_bulk_upload(text: str) -> Dict[str, Any]:
    ensure_vault_files()
    parsed = _parse_env_text(text)
    dotted: Dict[str, Dict[str, str]] = {}
    flat: Dict[str, str] = {}
    for key, val in parsed.items():
        if "." in key:
            app, _, rest = key.partition(".")
            dotted.setdefault(app.strip().lower(), {})[rest.strip()] = val
        else:
            flat[key] = val

    key_to_app: Dict[str, Tuple[str, str]] = {}
    for app_id, meta in SECRET_APPS.items():
        for k in meta.get("keys") or []:
            key_to_app[k] = (app_id, k)
            key_to_app[k.lower()] = (app_id, k)

    updates: Dict[str, Dict[str, str]] = {}
    for key, val in flat.items():
        hit = key_to_app.get(key) or key_to_app.get(key.upper()) or key_to_app.get(key.lower())
        if not hit:
            continue
        app_id, canon = hit
        updates.setdefault(app_id, {})[canon] = val

    alias_map = {
        "api_key": {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"},
        "webhook_url": {
            "slack": "SLACK_UPDATES_WEBHOOK_URL",
            "discord": "DISCORD_UPDATES_WEBHOOK_URL",
        },
    }
    for app_id, mapping in dotted.items():
        if app_id not in SECRET_APPS:
            continue
        allowed = set(SECRET_APPS[app_id].get("keys") or [])
        for k, v in mapping.items():
            if k in allowed:
                updates.setdefault(app_id, {})[k] = v
            elif k.upper() in allowed:
                updates.setdefault(app_id, {})[k.upper()] = v
            else:
                for alias, app_map in alias_map.items():
                    if k.lower() == alias and app_id in app_map and app_map[app_id] in allowed:
                        updates.setdefault(app_id, {})[app_map[app_id]] = v

    applied = []
    for app_id, values in updates.items():
        save_app_secrets(app_id, values)
        applied.append({"app": app_id, "keys": list(values.keys())})

    return {
        "ok": True,
        "applied": applied,
        "applied_count": len(applied),
        "status": status_view(),
    }


def load_vault_into_environ() -> Dict[str, Any]:
    ensure_vault_files()
    loaded = []
    for app_id in SECRET_APPS:
        values = _read_app_secrets(app_id)
        for key, val in values.items():
            if str(val or "").strip():
                os.environ[key] = str(val).strip()
                loaded.append(key)
    return {"ok": True, "loaded_keys": loaded, "count": len(loaded)}


def owner_identity() -> Dict[str, Any]:
    ensure_vault_files()
    values = _read_app_secrets("owner")
    email = (values.get("OWNER_EMAIL") or os.environ.get("OWNER_EMAIL") or "").strip().lower()
    github = (values.get("OWNER_GITHUB") or os.environ.get("OWNER_GITHUB") or "").strip().lstrip("@").lower()
    token = (values.get("BACKUP_OWNER_TOKEN") or os.environ.get("BACKUP_OWNER_TOKEN") or "").strip()
    return {
        "email": email,
        "github": github,
        "has_token": bool(token),
        "configured": bool(email or github or token),
    }


def verify_owner(
    *,
    email: Optional[str] = None,
    github: Optional[str] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    identity = owner_identity()
    if not identity["configured"]:
        return {
            "ok": False,
            "allowed": False,
            "reason": "owner_not_configured",
            "detail": "Set OWNER_EMAIL / OWNER_GITHUB / BACKUP_OWNER_TOKEN in data/server-config/secrets/owner/",
        }
    email_n = (email or "").strip().lower()
    github_n = (github or "").strip().lstrip("@").lower()
    token_n = (token or "").strip()
    vault = _read_app_secrets("owner")
    expected_token = (vault.get("BACKUP_OWNER_TOKEN") or os.environ.get("BACKUP_OWNER_TOKEN") or "").strip()

    if identity["email"] and email_n and email_n == identity["email"]:
        return {"ok": True, "allowed": True, "matched": "email"}
    if identity["github"] and github_n and github_n == identity["github"]:
        return {"ok": True, "allowed": True, "matched": "github"}
    if expected_token and token_n and token_n == expected_token:
        return {"ok": True, "allowed": True, "matched": "token"}
    return {
        "ok": False,
        "allowed": False,
        "reason": "owner_mismatch",
        "detail": "Backup/sync identity did not match the configured server owner.",
    }
