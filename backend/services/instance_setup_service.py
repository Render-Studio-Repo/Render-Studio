"""First-run instance setup: connect YOUR Supabase or keep sqlite local users.

Writes gitignored `.env` and `data/instance_setup.json`. Never logs or returns
secret values. Service role / PAT stay on the origin.
"""

from __future__ import annotations

import json
import logging
import os
import re
import stat
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, ENV_FILE, settings
from backend.services import supabase_client

logger = logging.getLogger("render3d.instance_setup")

SETUP_PATH = Path(settings.data_dir) / "instance_setup.json"
SQL_INSTALL = ROOT_DIR / "integrations" / "supabase" / "install_users.sql"
HARNESS_PATH = ROOT_DIR / "integrations" / "supabase" / "HARNESS_PROMPT.md"

ENV_KEYS = (
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "USERS_BACKEND",
    "DATABASE_URL",
)

_URL_OK = re.compile(r"^https://[a-z0-9-]+\.supabase\.co/?$", re.I)
_ENV_LINE = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")


def _load_state() -> dict[str, Any]:
    try:
        if SETUP_PATH.is_file():
            data = json.loads(SETUP_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        logger.warning("instance_setup.json unreadable", exc_info=True)
    return {}


def _save_state(patch: dict[str, Any]) -> dict[str, Any]:
    SETUP_PATH.parent.mkdir(parents=True, exist_ok=True)
    state = _load_state()
    state.update(patch)
    SETUP_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(SETUP_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return state


def answered() -> bool:
    return bool(_load_state().get("answered"))


def chosen_backend() -> str:
    raw = str(_load_state().get("users_backend") or getattr(settings, "users_backend", "") or "").strip().lower()
    if raw in {"local", "sqlite"}:
        return "sqlite"
    if raw in {"supabase", "remote"}:
        return "supabase"
    if supabase_client.configured():
        return "supabase"
    return "unset"


def mark_answered(backend: str) -> None:
    _save_state({"answered": True, "users_backend": backend})


def _official_hub() -> bool:
    try:
        from backend.services.marketplace_config_service import _is_official_host

        return bool(_is_official_host())
    except Exception:
        return False


def _public_instance_id() -> str:
    try:
        from backend.services import marketplace_config_service as market

        return str((market.ensure_instance_identity() or {}).get("instance_id") or "").strip()
    except Exception:
        return ""


def telemetry_answered() -> bool:
    state = _load_state()
    if state.get("telemetry_answered") or "telemetry_opt_in" in state:
        return True
    return _official_hub()


def telemetry_opt_in() -> bool:
    state = _load_state()
    if "telemetry_opt_in" in state:
        return bool(state.get("telemetry_opt_in"))
    return _official_hub()


def set_telemetry_opt_in(enabled: bool) -> dict[str, Any]:
    _save_state({"telemetry_opt_in": bool(enabled), "telemetry_answered": True})
    hub: dict[str, Any] | None = None
    if enabled:
        try:
            from backend.services import debug_training_service as dts

            hub = dts.ensure_local_instance(register_hub=True)
        except Exception:
            logger.warning("debug training register after opt-in failed", exc_info=True)
            hub = {"ok": False}
    return {
        "ok": True,
        "telemetry_opt_in": bool(enabled),
        "telemetry_answered": True,
        "is_official_hub": _official_hub(),
        "instance_id": _public_instance_id(),
        "hub": hub,
    }


def install_sql() -> str:
    if SQL_INSTALL.is_file():
        return SQL_INSTALL.read_text(encoding="utf-8")
    return "-- install_users.sql missing from this checkout\n"


def harness_prompt() -> str:
    if HARNESS_PATH.is_file():
        return HARNESS_PATH.read_text(encoding="utf-8")
    return ""


def copy_command() -> str:
    return 'psql "$DATABASE_URL" -f integrations/supabase/install_users.sql'


def is_loopback(ip: str) -> bool:
    raw = (ip or "").strip().lower()
    return raw in {"127.0.0.1", "::1", "localhost", "0:0:0:0:0:0:0:1"}


def setup_unlocked(*, ip: str, is_admin: bool) -> bool:
    if is_admin:
        return True
    if is_loopback(ip):
        return True
    return False


def public_status(*, ip: str = "", is_admin: bool = False) -> dict[str, Any]:
    from backend.services import supabase_users_store as sbusers
    from backend.services import instance_network_client as instance_network

    backend = sbusers.cached_users_backend()
    probe = sbusers.cached_probe()
    return {
        "answered": answered(),
        "users_backend": backend,
        "supabase_configured": supabase_client.configured(),
        "url_set": bool((getattr(settings, "supabase_url", None) or "").strip()),
        "publishable_set": bool((getattr(settings, "supabase_publishable_key", None) or "").strip()),
        "service_role_set": bool((getattr(settings, "supabase_service_role_key", None) or "").strip()),
        "secret_set": bool(supabase_client.rest_key()),
        "access_token_set": bool(supabase_client.management_token()),
        "users_count": probe.get("count"),
        "users_reachable": bool(probe.get("ok")),
        "setup_unlocked": setup_unlocked(ip=ip, is_admin=is_admin),
        "create_project_url": "https://supabase.com/dashboard/new",
        "sql_path": "integrations/supabase/install_users.sql",
        "harness_path": "integrations/supabase/HARNESS_PROMPT.md",
        "copy_command": copy_command(),
        "other_db_note": (
            "User rows live in sqlite (backend/database.py → data/render3d.db) or Supabase "
            "public.\"Users\". Optional DATABASE_URL is for your own Postgres tooling; this app "
            "does not auto-switch the user table to a generic SQLAlchemy URL."
        ),
        "env_fields": [
            "SUPABASE_URL",
            "SUPABASE_PUBLISHABLE_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_SECRET_KEY",
            "SUPABASE_ACCESS_TOKEN",
            "USERS_BACKEND",
            "DATABASE_URL",
        ],
        "telemetry_opt_in": telemetry_opt_in(),
        "telemetry_answered": telemetry_answered(),
        "is_official_hub": _official_hub(),
        "instance_id": _public_instance_id(),
        "instance_network": instance_network.public_status(),
    }


def _upsert_dotenv(updates: dict[str, str]) -> None:
    path = Path(ENV_FILE)
    existing = ""
    if path.is_file():
        existing = path.read_text(encoding="utf-8")
    lines = existing.splitlines()
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        match = _ENV_LINE.match(line)
        if match and match.group(1) in updates:
            out.append(f"{match.group(1)}={updates[match.group(1)]}")
            seen.add(match.group(1))
        else:
            out.append(line)
    if updates and out and out[-1].strip():
        # keep a blank line before newly appended keys
        pass
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


def _apply_settings(updates: dict[str, str]) -> None:
    mapping = {
        "SUPABASE_URL": "supabase_url",
        "SUPABASE_PUBLISHABLE_KEY": "supabase_publishable_key",
        "SUPABASE_SECRET_KEY": "supabase_secret_key",
        "SUPABASE_SERVICE_ROLE_KEY": "supabase_service_role_key",
        "SUPABASE_KEY": "supabase_key",
        "SUPABASE_ACCESS_TOKEN": "supabase_access_token",
        "USERS_BACKEND": "users_backend",
        "DATABASE_URL": "database_url",
    }
    for env_name, attr in mapping.items():
        if env_name in updates and hasattr(settings, attr):
            setattr(settings, attr, updates[env_name])
    supabase_client.clear_client_cache()
    from backend.services import supabase_users_store as sbusers

    sbusers.clear_probe_cache()


def _clean_url(url: str) -> str:
    raw = (url or "").strip().rstrip("/")
    if not raw:
        return ""
    if not _URL_OK.match(raw):
        raise ValueError("SUPABASE_URL must look like https://YOUR_PROJECT_REF.supabase.co")
    return raw


def save_supabase(
    *,
    url: str,
    publishable_key: str = "",
    service_role_key: str = "",
    secret_key: str = "",
    access_token: str = "",
    apply_schema: bool = True,
) -> dict[str, Any]:
    cleaned = _clean_url(url)
    service = (service_role_key or secret_key or "").strip()
    if not service:
        raise ValueError("Paste the service_role / secret key (server only).")
    updates = {
        "SUPABASE_URL": cleaned,
        "USERS_BACKEND": "supabase",
    }
    pub = (publishable_key or "").strip()
    if pub:
        updates["SUPABASE_PUBLISHABLE_KEY"] = pub
    secret = (secret_key or service).strip()
    updates["SUPABASE_SECRET_KEY"] = secret
    updates["SUPABASE_SERVICE_ROLE_KEY"] = service
    updates["SUPABASE_KEY"] = service
    pat = (access_token or "").strip()
    if pat:
        updates["SUPABASE_ACCESS_TOKEN"] = pat
    _upsert_dotenv(updates)
    _apply_settings(updates)
    schema: dict[str, Any] = {"ok": None, "skipped": True}
    if apply_schema and supabase_client.management_configured():
        from backend.services import supabase_users_store as sbusers

        schema = sbusers.ensure_remote_schema()
        schema["skipped"] = False
    from backend.services import supabase_users_store as sbusers

    probe = sbusers.refresh_probe(force=True)
    if probe.get("ok"):
        mark_answered("supabase")
    logger.info("auth_backend=supabase setup_saved reachable=%s", bool(probe.get("ok")))
    return {
        "ok": bool(probe.get("ok")),
        "users_backend": "supabase" if probe.get("ok") else "supabase_unreachable",
        "users_count": probe.get("count"),
        "schema": {"ok": schema.get("ok"), "skipped": schema.get("skipped"), "error": schema.get("error")},
        "hint": None
        if probe.get("ok")
        else "Saved. Apply install SQL in the Dashboard, then Connect again. Origin uses service_role only.",
    }


def save_local() -> dict[str, Any]:
    updates = {"USERS_BACKEND": "local"}
    _upsert_dotenv(updates)
    _apply_settings(updates)
    mark_answered("sqlite")
    logger.info("auth_backend=sqlite setup_saved")
    return {
        "ok": True,
        "users_backend": "sqlite",
        "users_count": None,
        "hint": "Local sqlite users/passwords/AI keys stay on this machine (data/render3d.db).",
    }
