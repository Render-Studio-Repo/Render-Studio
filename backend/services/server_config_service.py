"""
Public server-configuration templates vs local runtime settings.

Public (tracked):
  server-configurations/

Local (gitignored under data/):
  data/server-config/local-settings.json
  data/server-config/updates/UPDATE-LOG.md
  data/server-config/publication-ledger.json
"""

from __future__ import annotations

import json
import os
import re
import shutil
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_ROOT = ROOT / "server-configurations"
LOCAL_ROOT = ROOT / "data" / "server-config"
LOCAL_SETTINGS = LOCAL_ROOT / "local-settings.json"
LOCAL_UPDATE_LOG = LOCAL_ROOT / "updates" / "UPDATE-LOG.md"
LOCAL_LEDGER = LOCAL_ROOT / "publication-ledger.json"
PUBLIC_DEFAULTS = PUBLIC_ROOT / "public-defaults.json"
PUBLIC_CATALOG = PUBLIC_ROOT / "catalog.json"

DEFAULT_TARGETS = {
    "docs": True,
    "slack": False,
    "discord": False,
    "linkedin": False,
}

DEFAULT_INSTRUCTIONS = {
    "docs": "Writes to frontend/docs/updates/shipped.json and syncs milestones. Always safe for the public repo.",
    "slack": "Set SLACK_UPDATES_WEBHOOK_URL in the environment (Incoming Webhook). Enable the Slack toggle here. Secrets stay out of git.",
    "discord": "Configure DISCORD_BOT_TOKEN + DISCORD_UPDATES_CHANNEL_ID or DISCORD_UPDATES_WEBHOOK_URL, then enable Discord here.",
    "linkedin": "Configure LINKEDIN_ACCESS_TOKEN + LINKEDIN_AUTHOR_URN, then enable LinkedIn here.",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_json(path: Path, default: Any) -> Any:
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return deepcopy(default)


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = deepcopy(base)
    for key, val in (patch or {}).items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = deepcopy(val)
    return out


def public_defaults() -> Dict[str, Any]:
    return _read_json(PUBLIC_DEFAULTS, {})


def profile_path(profile_id: str) -> Path:
    return PUBLIC_ROOT / "profiles" / str(profile_id).strip()


def profile_config(profile_id: str) -> Dict[str, Any]:
    path = profile_path(profile_id) / "profile.json"
    if not path.is_file():
        raise FileNotFoundError(f"Unknown profile: {profile_id}")
    return _read_json(path, {})


def profile_readme(profile_id: str) -> str:
    path = profile_path(profile_id) / "README.md"
    if not path.is_file():
        raise FileNotFoundError(f"No README for profile: {profile_id}")
    return path.read_text(encoding="utf-8")


def profile_asset_path(profile_id: str, filename: str) -> Optional[Path]:
    safe = Path(str(filename or "")).name
    if not safe or safe.startswith("."):
        return None
    path = profile_path(profile_id) / "assets" / safe
    return path if path.is_file() else None


def public_catalog() -> Dict[str, Any]:
    catalog = _read_json(PUBLIC_CATALOG, {"profiles": []})
    profiles: List[Dict[str, Any]] = []
    for item in catalog.get("profiles") or []:
        pid = str(item.get("id") or "").strip()
        if not pid:
            continue
        try:
            cfg = profile_config(pid)
        except FileNotFoundError:
            cfg = {}
        assets_dir = profile_path(pid) / "assets"
        assets: List[str] = []
        if assets_dir.is_dir():
            for p in sorted(assets_dir.iterdir()):
                if p.is_file() and not p.name.startswith("."):
                    assets.append(f"/api/admin/server-config/profiles/{pid}/assets/{p.name}")
        up = cfg.get("update_publishing") or {}
        branding = cfg.get("branding") or {}
        profiles.append(
            {
                **item,
                "popular": int(item.get("popularity") or 0) >= 70,
                "config_summary": {
                    "name": cfg.get("name") or item.get("name"),
                    "product_name": branding.get("product_name"),
                    "auto_publish": up.get("auto_publish"),
                    "enabled": up.get("enabled"),
                    "targets": list((up.get("targets") or {}).keys()),
                },
                "has_readme": (profile_path(pid) / "README.md").is_file(),
                "assets": assets,
                "path": f"server-configurations/profiles/{pid}",
            }
        )
    return {
        "source": "server-configurations/",
        "github_branch": catalog.get("catalog_branch") or "Server-Configurations",
        "github_url": catalog.get("catalog_url")
        or "https://github.com/wprojects/Render-Studio/tree/Server-Configurations",
        "popular": [p for p in profiles if p.get("popular")],
        "profiles": profiles,
    }


def _normalize_publishing(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    defaults = public_defaults().get("update_publishing") or {}
    base: Dict[str, Any] = {
        "enabled": True,
        "auto_publish": True,
        "trusted_release_branch": "master",
        "workflow_doc": "docs/UPDATE-PUBLISHING.md",
        "update_log_path": "data/server-config/updates/UPDATE-LOG.md",
        "ledger_path": "data/server-config/publication-ledger.json",
        "targets": deepcopy(DEFAULT_TARGETS),
        "instructions": deepcopy(DEFAULT_INSTRUCTIONS),
    }
    merged = _deep_merge(base, defaults if isinstance(defaults, dict) else {})
    if isinstance(raw, dict):
        merged = _deep_merge(merged, raw)

    targets = merged.get("targets")
    if not isinstance(targets, dict):
        targets = deepcopy(DEFAULT_TARGETS)
    channels = merged.get("channels")
    if isinstance(channels, dict):
        for name, cfg in channels.items():
            if isinstance(cfg, dict) and "enabled" in cfg:
                targets[name] = bool(cfg.get("enabled"))
            elif isinstance(cfg, bool):
                targets[name] = cfg
    for key, default in DEFAULT_TARGETS.items():
        targets.setdefault(key, default)
        targets[key] = bool(targets.get(key))
    merged["targets"] = targets
    merged["enabled"] = bool(merged.get("enabled", True))
    merged["auto_publish"] = bool(merged.get("auto_publish", True))
    instr = merged.get("instructions") if isinstance(merged.get("instructions"), dict) else {}
    merged["instructions"] = {**DEFAULT_INSTRUCTIONS, **instr}
    merged.pop("channels", None)
    return merged


def _settings_from_profile(
    cfg: Dict[str, Any],
    *,
    source_profile_id: Optional[str] = None,
) -> Dict[str, Any]:
    branding = cfg.get("branding") if isinstance(cfg.get("branding"), dict) else {}
    product_name = branding.get("product_name") or cfg.get("product_name") or "Render Studio"
    return {
        "schema_version": int(cfg.get("schema_version") or 1),
        "source_profile_id": source_profile_id or cfg.get("profile_id"),
        "seeded_from": None,
        "seeded_at": None,
        "product_name": product_name,
        "branding": deepcopy(branding) if branding else {"product_name": product_name},
        "permissions": deepcopy(cfg.get("permissions") or {}),
        "marketplace": deepcopy(cfg.get("marketplace") or {}),
        "authorized_apps": deepcopy(cfg.get("authorized_apps") or {}),
        "tools": deepcopy(cfg.get("tools") or {}),
        "security": deepcopy(cfg.get("security") or {}),
        "storage": deepcopy(cfg.get("storage") or {}),
        "backups": deepcopy(cfg.get("backups") or {}),
        "mcp": deepcopy(cfg.get("mcp") or {}),
        "update_publishing": _normalize_publishing(cfg.get("update_publishing")),
        "secrets_refs": deepcopy(
            cfg.get("secrets_refs") or public_defaults().get("secrets_refs") or {}
        ),
        "notes": cfg.get("notes") or cfg.get("description") or "",
        "updated_at": _now_iso(),
    }


def ensure_local_settings() -> Dict[str, Any]:
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    (LOCAL_ROOT / "updates").mkdir(parents=True, exist_ok=True)

    legacy = LOCAL_ROOT / "settings.json"
    if legacy.is_file() and not LOCAL_SETTINGS.is_file():
        try:
            shutil.move(str(legacy), str(LOCAL_SETTINGS))
        except Exception:
            pass

    if not LOCAL_SETTINGS.is_file():
        defaults = public_defaults()
        seeded = _settings_from_profile(defaults, source_profile_id="public-defaults")
        seeded["seeded_from"] = "server-configurations/public-defaults.json"
        seeded["seeded_at"] = _now_iso()
        seeded["notes"] = (
            "Seeded from server-configurations/public-defaults.json. "
            "Local-only; not overwritten by git pull."
        )
        _write_json(LOCAL_SETTINGS, seeded)

    if not LOCAL_UPDATE_LOG.is_file():
        sample = PUBLIC_ROOT / "profiles" / "render-studio-cloud" / "updates" / "UPDATE-LOG.md"
        if sample.is_file():
            shutil.copy2(sample, LOCAL_UPDATE_LOG)
        else:
            LOCAL_UPDATE_LOG.write_text(
                "# Server Update Log\n\nLocal-only update log. Git pull will not overwrite this file.\n",
                encoding="utf-8",
            )

    if not LOCAL_LEDGER.is_file():
        _write_json(LOCAL_LEDGER, {"entries": {}})

    return load_local_settings()


def load_local_settings() -> Dict[str, Any]:
    if not LOCAL_SETTINGS.is_file():
        return ensure_local_settings()
    data = _read_json(LOCAL_SETTINGS, {})
    if not isinstance(data, dict):
        data = {}
    defaults = public_defaults()
    if "product_name" not in data:
        data["product_name"] = (
            ((data.get("branding") or {}).get("product_name"))
            or (defaults.get("branding") or {}).get("product_name")
            or "Render Studio"
        )
    data["update_publishing"] = _normalize_publishing(data.get("update_publishing"))
    data.setdefault("permissions", deepcopy(defaults.get("permissions") or {}))
    data.setdefault("marketplace", deepcopy(defaults.get("marketplace") or {}))
    data.setdefault("secrets_refs", deepcopy(defaults.get("secrets_refs") or {}))
    return data


def save_local_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    current = ensure_local_settings()
    if not isinstance(patch, dict):
        raise ValueError("settings patch must be an object")

    if "product_name" in patch and patch["product_name"] is not None:
        name = str(patch["product_name"]).strip() or "Render Studio"
        current["product_name"] = name
        branding = dict(current.get("branding") or {})
        branding["product_name"] = name
        current["branding"] = branding

    for key in (
        "permissions",
        "marketplace",
        "authorized_apps",
        "tools",
        "security",
        "storage",
        "backups",
        "mcp",
        "secrets_refs",
        "branding",
    ):
        if key in patch and isinstance(patch[key], dict):
            current[key] = _deep_merge(current.get(key) or {}, patch[key])

    if "update_publishing" in patch and isinstance(patch["update_publishing"], dict):
        current["update_publishing"] = _normalize_publishing(
            _deep_merge(current.get("update_publishing") or {}, patch["update_publishing"])
        )

    if "source_profile_id" in patch:
        current["source_profile_id"] = patch.get("source_profile_id")
    if "notes" in patch:
        current["notes"] = str(patch.get("notes") or "")

    current["updated_at"] = _now_iso()
    _write_json(LOCAL_SETTINGS, current)
    return current


def import_profile(profile_id: str, *, overwrite_update_log: bool = False) -> Dict[str, Any]:
    cfg = profile_config(profile_id)
    seeded = _settings_from_profile(cfg, source_profile_id=profile_id)
    seeded["seeded_from"] = f"server-configurations/profiles/{profile_id}/profile.json"
    seeded["seeded_at"] = _now_iso()

    if LOCAL_SETTINGS.is_file():
        existing = load_local_settings()
        existing_up = existing.get("update_publishing") or {}
        for keep in ("instructions", "update_log_path", "ledger_path", "workflow_doc"):
            if existing_up.get(keep):
                seeded["update_publishing"][keep] = existing_up[keep]

    _write_json(LOCAL_SETTINGS, seeded)

    sample_log = profile_path(profile_id) / "updates" / "UPDATE-LOG.md"
    if sample_log.is_file() and (overwrite_update_log or not LOCAL_UPDATE_LOG.is_file()):
        LOCAL_UPDATE_LOG.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(sample_log, LOCAL_UPDATE_LOG)

    return admin_view()


def load_ledger() -> Dict[str, Any]:
    ensure_local_settings()
    data = _read_json(LOCAL_LEDGER, {"entries": {}})
    if not isinstance(data, dict):
        data = {"entries": {}}
    data.setdefault("entries", {})
    return data


def save_ledger(data: Dict[str, Any]) -> None:
    _write_json(LOCAL_LEDGER, data)


def mark_ledger(
    update_id: str,
    channel: str,
    *,
    status: str = "published",
    detail: Any = None,
) -> None:
    ledger = load_ledger()
    entries = ledger.setdefault("entries", {})
    item = entries.setdefault(str(update_id), {})
    item[str(channel)] = {
        "status": status,
        "at": _now_iso(),
        "detail": detail,
    }
    save_ledger(ledger)


def already_published(update_id: str, channel: str) -> bool:
    ledger = load_ledger()
    entry = (ledger.get("entries") or {}).get(str(update_id)) or {}
    channel_state = entry.get(str(channel)) or {}
    return str(channel_state.get("status") or "") == "published"


# Require a colon after the field name so "- date: 2026-09-08" parses as
# key=date, value=2026-09-08 (a non-greedy key + optional colon matched only "d").
_FIELD_RE = re.compile(r"^-\s+\*?\*?([A-Za-z][A-Za-z0-9_ /-]*)\*?\*?:\s*(.*)$")


def parse_update_log(text: Optional[str] = None) -> List[Dict[str, Any]]:
    raw = text if text is not None else (
        LOCAL_UPDATE_LOG.read_text(encoding="utf-8") if LOCAL_UPDATE_LOG.is_file() else ""
    )
    updates: List[Dict[str, Any]] = []
    blocks = re.split(r"(?m)^##\s+", raw)
    for block in blocks[1:]:
        lines = block.strip().splitlines()
        if not lines:
            continue
        heading = lines[0].strip()
        fields: Dict[str, str] = {}
        body_lines: List[str] = []
        in_body = False
        for line in lines[1:]:
            stripped = line.strip()
            if stripped.lower() in ("### notes", "### body"):
                in_body = True
                continue
            if in_body:
                body_lines.append(line)
                continue
            match = _FIELD_RE.match(stripped)
            if match:
                key = match.group(1).strip().lower().replace(" ", "_")
                fields[key] = match.group(2).strip()

        update_id = fields.get("id") or ""
        if heading.lower().startswith("update:"):
            update_id = update_id or heading.split(":", 1)[1].strip()
        if not update_id:
            update_id = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")

        channels_raw = fields.get("channels") or "docs"
        channels = [part.strip() for part in re.split(r"[,|]", channels_raw) if part.strip()]

        updates.append(
            {
                "id": update_id,
                "title": fields.get("title") or heading,
                "status": (fields.get("status") or "draft").lower(),
                "date": fields.get("date") or "",
                "summary": fields.get("summary") or "",
                "kind": fields.get("kind") or fields.get("type") or "improve",
                "href": fields.get("href") or fields.get("url") or "/updates.html",
                "visual": fields.get("visual") or fields.get("gif") or fields.get("image") or "",
                "branch": fields.get("branch") or "",
                "pr": fields.get("pr") or "",
                "verify_url": fields.get("verify_url") or fields.get("verify") or "/",
                "channels": channels or ["docs"],
                "gif_required": (fields.get("gif_required") or "").lower() in ("yes", "true", "1"),
                "notes": "\n".join(body_lines).strip(),
                "raw_title": heading,
            }
        )
    return updates


def eligible_updates(
    *,
    force: bool = False,
    only_id: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    settings = settings or ensure_local_settings()
    publishing = _normalize_publishing(settings.get("update_publishing"))
    if not publishing.get("enabled") and not force:
        return []
    if not publishing.get("auto_publish") and not force and not only_id:
        return []

    targets = publishing.get("targets") or {}
    enabled_channels = {name for name, on in targets.items() if on}

    out: List[Dict[str, Any]] = []
    for update in parse_update_log():
        if only_id and update.get("id") != only_id:
            continue
        if update.get("status") != "published" and not (force and only_id):
            continue
        pending: List[str] = []
        for channel in update.get("channels") or []:
            if channel not in enabled_channels:
                continue
            if already_published(update["id"], channel) and not force:
                continue
            pending.append(channel)
        if pending:
            out.append({**update, "pending_channels": pending})
    return out


def env_secret_status() -> Dict[str, bool]:
    try:
        from backend.services import discord_updates_service as discord
        from backend.services import linkedin_updates_service as linkedin

        discord_ok = bool(discord.configured())
        linkedin_ok = bool(linkedin.configured())
    except Exception:
        discord_ok = bool(
            os.environ.get("DISCORD_UPDATES_WEBHOOK_URL")
            or (
                os.environ.get("DISCORD_BOT_TOKEN")
                and os.environ.get("DISCORD_UPDATES_CHANNEL_ID")
            )
        )
        linkedin_ok = bool(
            os.environ.get("LINKEDIN_ACCESS_TOKEN")
            and os.environ.get("LINKEDIN_AUTHOR_URN")
        )
    return {
        "slack": bool(os.environ.get("SLACK_UPDATES_WEBHOOK_URL")),
        "discord": discord_ok,
        "linkedin": linkedin_ok,
        "docs": True,
        "SLACK_BOT_TOKEN": bool(os.environ.get("SLACK_BOT_TOKEN") or os.environ.get("SLACK_TOKEN")),
        "SLACK_UPDATES_WEBHOOK_URL": bool(os.environ.get("SLACK_UPDATES_WEBHOOK_URL")),
        "DISCORD_WEBHOOK_URL": bool(
            os.environ.get("DISCORD_UPDATES_WEBHOOK_URL") or os.environ.get("DISCORD_WEBHOOK_URL")
        ),
        "LINKEDIN_ACCESS_TOKEN": bool(os.environ.get("LINKEDIN_ACCESS_TOKEN")),
        "LINKEDIN_AUTHOR_URN": bool(os.environ.get("LINKEDIN_AUTHOR_URN")),
    }


def admin_view() -> Dict[str, Any]:
    settings = ensure_local_settings()
    ledger = load_ledger()
    updates = parse_update_log()
    publishing = _normalize_publishing(settings.get("update_publishing"))
    env = env_secret_status()
    publishing_view = {
        **publishing,
        "env_configured": {
            "docs": True,
            "slack": bool(env.get("slack")),
            "discord": bool(env.get("discord")),
            "linkedin": bool(env.get("linkedin")),
        },
        "ledger_count": len(ledger.get("entries") or {}),
        "eligible_count": len(eligible_updates(settings=settings)),
    }
    return {
        "ok": True,
        "note": (
            "Public templates live in server-configurations/. Runtime settings live in "
            "data/server-config/ and are gitignored so push/pull will not clobber your private server."
        ),
        "paths": {
            "public_templates": "server-configurations/",
            "local_settings": "data/server-config/local-settings.json",
            "update_log": "data/server-config/updates/UPDATE-LOG.md",
            "ledger": "data/server-config/publication-ledger.json",
            "workflow_doc": publishing.get("workflow_doc") or "docs/UPDATE-PUBLISHING.md",
            "agent_instructions": "instructions/server/UPDATE-DOCS.md",
        },
        "local": settings,
        "update_publishing": publishing_view,
        "public_defaults": public_defaults(),
        "catalog": public_catalog(),
        "update_log": {
            "count": len(updates),
            "entries": updates[:20],
            "eligible": eligible_updates(settings=settings),
        },
        "ledger_count": len(ledger.get("entries") or {}),
        "env_configured": env,
        "instructions": publishing.get("instructions") or DEFAULT_INSTRUCTIONS,
    }
