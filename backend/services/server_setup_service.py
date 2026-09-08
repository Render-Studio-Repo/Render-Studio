"""
First-run / server setup orchestration.

Local state (gitignored):
  data/server-config/setup-state.json
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from backend.services import server_secrets_vault as secrets_vault

ROOT = Path(__file__).resolve().parents[2]
LOCAL_ROOT = ROOT / "data" / "server-config"
SETUP_STATE_PATH = LOCAL_ROOT / "setup-state.json"

ECOSYSTEM_MODES = {
    "private": {
        "label": "Completely private",
        "summary": "Nothing is shared with Render’s public marketplace or sync APIs.",
    },
    "curated": {
        "label": "Only specifically published items",
        "summary": "You choose which models/products are pushed to the public ecosystem.",
    },
    "public": {
        "label": "Everything public",
        "summary": "Eligible marketplace listings and public settings sync to Render’s public site.",
    },
}

STORAGE_BACKENDS = {
    "local": {
        "label": "Local disk",
        "summary": "Store projects/models under this server’s projects/ + data/ folders.",
        "instructions": "Default for self-hosted installs. Ensure disk backups are configured.",
    },
    "google-drive": {
        "label": "Google Drive",
        "summary": "Sync 3D models and project archives to a Drive folder.",
        "instructions": "Add Google Drive OAuth credentials in Secrets → google-drive, then connect the account.",
    },
    "mysql": {
        "label": "MySQL users + local/Drive models",
        "summary": "Keep usernames/passwords in MySQL while models stay on disk or Drive.",
        "instructions": "Fill MYSQL_* secrets, then export a harness prompt to wire auth.",
    },
    "supabase": {
        "label": "Supabase",
        "summary": "Use Supabase Auth + storage for multi-tenant orgs.",
        "instructions": "Add SUPABASE_* secrets, then export a harness prompt to finish wiring.",
    },
}

AUTHORIZED_APPS = {
    "openai": "OpenAI models",
    "anthropic": "Anthropic Claude",
    "stripe": "Stripe billing",
    "slack": "Slack updates",
    "discord": "Discord updates",
    "linkedin": "LinkedIn updates",
    "github": "GitHub OAuth / backups",
    "google-drive": "Google Drive storage",
    "mysql": "MySQL users DB",
    "supabase": "Supabase auth/storage",
}

STEPS = [
    {"id": "welcome", "title": "Welcome"},
    {"id": "identity", "title": "Identity"},
    {"id": "github", "title": "GitHub"},
    {"id": "keys", "title": "API keys"},
    {"id": "ecosystem", "title": "Ecosystem"},
    {"id": "apps", "title": "Apps"},
    {"id": "storage", "title": "Storage"},
    {"id": "dashboard", "title": "Dashboard"},
    {"id": "harness", "title": "Harness"},
    {"id": "done", "title": "Done"},
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _default_state() -> Dict[str, Any]:
    return {
        "schema_version": 1,
        "setup_complete": False,
        "current_step": "welcome",
        "server_name": "Render Studio",
        "ecosystem_mode": "private",
        "authorized_apps": {key: key in {"openai", "anthropic"} for key in AUTHORIZED_APPS},
        "storage_backend": "local",
        "dashboard_ready": False,
        "notes": "",
        "updated_at": None,
        "completed_at": None,
    }


def load_state() -> Dict[str, Any]:
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    secrets_vault.ensure_vault_files()
    if not SETUP_STATE_PATH.is_file():
        state = _default_state()
        SETUP_STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        return state
    try:
        data = json.loads(SETUP_STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    base = _default_state()
    for key in base:
        if key in data:
            base[key] = data[key]
    if isinstance(data.get("authorized_apps"), dict):
        apps = deepcopy(base["authorized_apps"])
        for key, val in data["authorized_apps"].items():
            if key in apps:
                apps[key] = bool(val)
        base["authorized_apps"] = apps
    return base


def save_state(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = load_state()
    if not isinstance(patch, dict):
        raise ValueError("setup patch must be an object")

    for key in (
        "setup_complete",
        "current_step",
        "server_name",
        "ecosystem_mode",
        "storage_backend",
        "dashboard_ready",
        "notes",
        "completed_at",
    ):
        if key in patch:
            current[key] = patch[key]

    if isinstance(patch.get("authorized_apps"), dict):
        apps = deepcopy(current.get("authorized_apps") or {})
        for key, val in patch["authorized_apps"].items():
            if key in AUTHORIZED_APPS:
                apps[key] = bool(val)
        current["authorized_apps"] = apps

    if current.get("ecosystem_mode") not in ECOSYSTEM_MODES:
        current["ecosystem_mode"] = "private"
    if current.get("storage_backend") not in STORAGE_BACKENDS:
        current["storage_backend"] = "local"
    current["server_name"] = (str(current.get("server_name") or "").strip() or "Render Studio")[:80]
    step_ids = {s["id"] for s in STEPS}
    if current.get("current_step") not in step_ids:
        current["current_step"] = "welcome"
    current["updated_at"] = _now_iso()
    SETUP_STATE_PATH.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def mark_complete() -> Dict[str, Any]:
    return save_state(
        {
            "setup_complete": True,
            "current_step": "done",
            "dashboard_ready": True,
            "completed_at": _now_iso(),
        }
    )


def needs_setup() -> bool:
    return not bool(load_state().get("setup_complete"))


def catalog() -> Dict[str, Any]:
    return {
        "steps": STEPS,
        "ecosystem_modes": [{"id": key, **val} for key, val in ECOSYSTEM_MODES.items()],
        "storage_backends": [{"id": key, **val} for key, val in STORAGE_BACKENDS.items()],
        "authorized_apps": [{"id": key, "label": label} for key, label in AUTHORIZED_APPS.items()],
    }


def public_ecosystem_policy() -> Dict[str, Any]:
    state = load_state()
    mode = state.get("ecosystem_mode") or "private"
    return {
        "mode": mode,
        "label": ECOSYSTEM_MODES.get(mode, {}).get("label"),
        "summary": ECOSYSTEM_MODES.get(mode, {}).get("summary"),
        "sync_enabled": mode in {"curated", "public"},
        "auto_publish_all": mode == "public",
        "requires_explicit_publish": mode == "curated",
        "blocked": mode == "private",
        "server_name": state.get("server_name"),
    }


def build_harness_prompt(*, intent: str = "", include_paths: bool = True) -> Dict[str, Any]:
    state = load_state()
    secrets = secrets_vault.status_view()
    intent_text = (intent or "").strip() or "Help configure this Render Studio server."
    paths = [
        "data/server-config/local-settings.json",
        "data/server-config/setup-state.json",
        "data/server-config/github-backup.json",
        "data/server-config/secrets/",
        "backend/services/server_secrets_vault.py",
        "backend/services/server_setup_service.py",
        "backend/services/github_backup_service.py",
        "backend/services/server_config_service.py",
        "frontend/server-setup-wizard.js",
        "backend/skills/server-setup/SKILL.md",
        "integrations/github/README.md",
        "server-configurations/secrets-templates/EXAMPLE-bulk-settings.txt",
    ]
    configured = [a["id"] for a in secrets.get("apps") or [] if a.get("configured")]
    missing = [a["id"] for a in secrets.get("apps") or [] if not a.get("configured")]
    mode = state.get("ecosystem_mode")
    prompt = f"""# Render Studio — server harness request

Paste this into Cursor, VS Code, Claude Code, or your preferred coding harness.

You are editing a self-hosted Render Studio install.

## Goal
{intent_text}

## Current setup
- Server name: {state.get('server_name')}
- Setup complete: {state.get('setup_complete')}
- Ecosystem mode: {mode} ({ECOSYSTEM_MODES.get(mode, {}).get('summary')})
- Storage backend: {state.get('storage_backend')}
- Authorized apps: {json.dumps(state.get('authorized_apps') or {}, indent=2)}
- Secrets configured: {', '.join(configured) or '(none)'}
- Secrets missing: {', '.join(missing) or '(none)'}

## Hard rules
1. Do **not** commit secrets. Write them only under `data/server-config/secrets/<app>/secret.env`.
2. Prefer new modules + thin hooks over growing `backend/main.py` / `frontend/app.js`.
3. Ask follow-up questions before changing auth, billing, or database wiring:
   - Do env values already exist in the secrets vault?
   - Should you create missing env placeholders or use existing ones?
   - Is this org private, curated, or public ecosystem mode?
4. After frontend changes, cache-bust assets and verify in the browser.

## Suggested follow-ups to ask me
- Do you already have MySQL / Drive / Supabase credentials stored in the vault?
- Should I create `.env` placeholders or only vault `secret.env` files?
- For marketplace sync, which listings should be public vs private?
- Do you want 2FA for all users or admins only?
"""
    if include_paths:
        prompt += "\n## Important paths\n" + "\n".join(f"- `{p}`" for p in paths) + "\n"
    prompt += """
## Deliverables
- Minimal code/config changes
- Updated vault README if a new authorized app was added
- Short summary of what to restart / verify
"""
    return {
        "ok": True,
        "intent": intent_text,
        "prompt": prompt,
        "paths": paths,
        "state": state,
        "secrets_summary": {"configured": configured, "missing": missing},
    }


def admin_view() -> Dict[str, Any]:
    from backend.services import github_backup_service

    state = load_state()
    return {
        "ok": True,
        "needs_setup": needs_setup(),
        "state": state,
        "catalog": catalog(),
        "secrets": secrets_vault.status_view(),
        "ecosystem": public_ecosystem_policy(),
        "owner": secrets_vault.owner_identity(),
        "github": github_backup_service.public_status(),
        "paths": {
            "setup_state": "data/server-config/setup-state.json",
            "secrets_vault": "data/server-config/secrets/",
            "github_backup": "data/server-config/github-backup.json",
            "bulk_example": "server-configurations/secrets-templates/EXAMPLE-bulk-settings.txt",
            "skill": "backend/skills/server-setup/SKILL.md",
            "github_integration": "integrations/github/README.md",
        },
    }
