"""Marketplace instance configuration.

Stored in ``data/marketplace_settings.json`` (gitignored). API keys stay in env.

Modes
-----
- ``public``: pull Render's public hub catalog; optionally publish this instance's
  listings so they appear on the public marketplace.
- ``private``: instance-local catalog only. No hub pull or publish.
- ``hybrid``: local catalog now; connect to the public hub later (or pull/publish
  independently via flags).

Install question
----------------
New self-hosted instances (``install_answered=false``) should pick a mode during
setup (``scripts/setup-marketplace.py`` or ``/setup-marketplace.html``).
The official ``render3d.app`` host defaults to public mode already answered so the
live site is not blocked by a first-run wizard.

Chrome / colors
---------------
Marketplace UI colors come from Studio CSS tokens (``frontend/studio/styles.css``
``:root`` plus ``frontend/marketplace/marketplace-theme.css``). Do not invent a
palette from Supabase users/credits tables or ``marketplace_settings.json``.
This file is install mode + catalog flags only.
"""

from __future__ import annotations

import json
import secrets
import uuid
from pathlib import Path
from typing import Any

from backend.config import settings

MODES = ("public", "private", "hybrid")

DEFAULT_HUB_URL = "https://render3d.app"

HUB_CATEGORY_CHOICES = (
    "robots",
    "fixtures",
    "toolheads",
    "parts",
    "electronics",
    "architecture",
    "knowledge",
    "agents",
    "other",
)

SORT_CHOICES = ("rank", "new", "price")

PUBLIC_KEYS = (
    "enabled",
    "mode",
    "install_answered",
    "hub_url",
    "hub_pull_enabled",
    "hub_publish_enabled",
    "premium_posts_enabled",
    "paid_boost_enabled",
    "sponsorship_requests_enabled",
    "paid_boost_price_cents",
    "paid_boost_days",
    "sponsorship_boost_days",
    "refunds_allowed_default",
    "refund_window_days_default",
    "shipping_enabled",
    "tickets_enabled",
    "instance_id",
    "instance_name",
    "instance_handle",
    "is_official_hub",
    "payouts_enabled",
    "stripe_connect_enabled",
    "paypal_payouts_enabled",
    "platform_fee_percent",
    "guest_browse_enabled",
    "require_login_to_purchase",
    "show_models",
    "show_agents",
    "show_knowledge",
    "show_featured_rail",
    "show_boost_badges",
    "show_prices",
    "listings_need_review",
    "featured_limit",
    "default_sort",
    "hub_categories",
)

SECRET_KEYS = ("instance_secret", "hub_token")

BOOL_KEYS = {
    "enabled",
    "install_answered",
    "hub_pull_enabled",
    "hub_publish_enabled",
    "premium_posts_enabled",
    "paid_boost_enabled",
    "sponsorship_requests_enabled",
    "refunds_allowed_default",
    "shipping_enabled",
    "tickets_enabled",
    "payouts_enabled",
    "stripe_connect_enabled",
    "paypal_payouts_enabled",
    "guest_browse_enabled",
    "require_login_to_purchase",
    "show_models",
    "show_agents",
    "show_knowledge",
    "show_featured_rail",
    "show_boost_badges",
    "show_prices",
    "listings_need_review",
}

INT_KEYS = {
    "paid_boost_price_cents",
    "paid_boost_days",
    "sponsorship_boost_days",
    "refund_window_days_default",
    "platform_fee_percent",
    "featured_limit",
}

STR_KEYS = {
    "hub_url",
    "hub_token",
    "instance_name",
    "instance_handle",
    "default_sort",
    "hub_categories",
}


def _is_official_host() -> bool:
    base = (getattr(settings, "public_base_url", None) or "").strip().lower()
    return "render3d.app" in base


def _defaults() -> dict[str, Any]:
    official = _is_official_host()
    return {
        "enabled": True if official else False,
        "mode": "public" if official else "hybrid",
        "install_answered": bool(official),
        "hub_url": DEFAULT_HUB_URL,
        "hub_pull_enabled": bool(official),
        "hub_publish_enabled": bool(official),
        "premium_posts_enabled": True,
        "paid_boost_enabled": True,
        "sponsorship_requests_enabled": True,
        "paid_boost_price_cents": 1500,
        "paid_boost_days": 14,
        "sponsorship_boost_days": 14,
        "refunds_allowed_default": True,
        "refund_window_days_default": 14,
        "shipping_enabled": True,
        "tickets_enabled": True,
        "payouts_enabled": True,
        "stripe_connect_enabled": True,
        "paypal_payouts_enabled": True,
        "platform_fee_percent": 10,
        "guest_browse_enabled": True,
        "require_login_to_purchase": True,
        "show_models": True,
        "show_agents": True,
        "show_knowledge": True,
        "show_featured_rail": True,
        "show_boost_badges": True,
        "show_prices": True,
        "listings_need_review": True,
        "featured_limit": 8,
        "default_sort": "rank",
        "hub_categories": "",
        "instance_id": "",
        "instance_secret": "",
        "hub_token": "",
        "instance_name": "Render Studio" if official else "Render Studio instance",
        "instance_handle": "render-official" if official else "",
        "is_official_hub": official,
    }


def _path() -> Path:
    root = Path(settings.data_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root / "marketplace_settings.json"


def ensure_instance_identity(data: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = dict(data or load())
    changed = False
    if not str(cfg.get("instance_id") or "").strip():
        cfg["instance_id"] = str(uuid.uuid4())
        changed = True
    if not str(cfg.get("instance_secret") or "").strip():
        cfg["instance_secret"] = secrets.token_urlsafe(32)
        changed = True
    if changed:
        _write(cfg)
    return cfg


def _write(data: dict[str, Any]) -> None:
    _path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def load() -> dict[str, Any]:
    path = _path()
    data = _defaults()
    if path.is_file():
        try:
            stored = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                data.update({k: stored[k] for k in data if k in stored})
        except Exception:
            pass
    data["mode"] = str(data.get("mode") or "hybrid").strip().lower()
    if data["mode"] not in MODES:
        data["mode"] = "hybrid"
    for key in BOOL_KEYS:
        data[key] = bool(data.get(key))
    for key in INT_KEYS:
        try:
            data[key] = int(data.get(key) or 0)
        except (TypeError, ValueError):
            data[key] = _defaults()[key]
    data["paid_boost_price_cents"] = max(100, min(1_000_000, data["paid_boost_price_cents"]))
    data["paid_boost_days"] = max(1, min(90, data["paid_boost_days"]))
    data["sponsorship_boost_days"] = max(1, min(90, data["sponsorship_boost_days"]))
    data["refund_window_days_default"] = max(0, min(365, data["refund_window_days_default"]))
    data["platform_fee_percent"] = max(0, min(30, data["platform_fee_percent"]))
    data["featured_limit"] = max(0, min(24, data["featured_limit"]))
    data["default_sort"] = _clean_sort(data.get("default_sort"))
    data["hub_categories"] = _clean_categories(data.get("hub_categories"))
    data["hub_url"] = str(data.get("hub_url") or DEFAULT_HUB_URL).strip().rstrip("/")
    data["hub_token"] = str(data.get("hub_token") or getattr(settings, "marketplace_hub_token", "") or "").strip()
    data["is_official_hub"] = bool(data.get("is_official_hub")) or _hub_is_self(data)
    if data["mode"] == "private":
        data["hub_pull_enabled"] = False
        data["hub_publish_enabled"] = False
    elif data["mode"] == "public":
        data["hub_pull_enabled"] = True
    return data


def _hub_is_self(cfg: dict[str, Any]) -> bool:
    hub = str(cfg.get("hub_url") or "").rstrip("/").lower()
    base = (getattr(settings, "public_base_url", None) or "").strip().rstrip("/").lower()
    if _is_official_host() and "render3d.app" in (hub or "https://render3d.app"):
        return True
    return bool(hub and base and hub == base)


def _clean_sort(value: Any) -> str:
    sort = str(value or "rank").strip().lower()
    return sort if sort in SORT_CHOICES else "rank"


def _clean_categories(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        parts = [str(item).strip().lower() for item in value]
    else:
        parts = [item.strip().lower() for item in str(value or "").split(",")]
    allowed = set(HUB_CATEGORY_CHOICES)
    cleaned = [item for item in parts if item in allowed]
    if not cleaned or set(cleaned) == allowed:
        return ""
    return ",".join(dict.fromkeys(cleaned))


def public_config() -> dict[str, Any]:
    cfg = ensure_instance_identity()
    out = {key: cfg[key] for key in PUBLIC_KEYS if key in cfg}
    out["needs_setup"] = (not cfg["install_answered"]) and not _is_official_host()
    out["hub_connected"] = bool(cfg.get("hub_url")) and cfg["mode"] != "private"
    out["stripe_configured"] = bool((getattr(settings, "stripe_secret_key", None) or "").strip())
    return out


def admin_config() -> dict[str, Any]:
    cfg = ensure_instance_identity()
    out = public_config()
    out["hub_token_set"] = bool(cfg.get("hub_token"))
    out["instance_secret_set"] = bool(cfg.get("instance_secret"))
    out["hub_is_self"] = _hub_is_self(cfg)
    return out


def save(patch: dict[str, Any]) -> dict[str, Any]:
    cfg = ensure_instance_identity()
    defaults = _defaults()
    for key, default in defaults.items():
        if key not in patch:
            continue
        if key in SECRET_KEYS and key != "hub_token":
            continue
        value = patch[key]
        if key in BOOL_KEYS:
            cfg[key] = bool(value)
        elif key in INT_KEYS:
            try:
                cfg[key] = int(value)
            except (TypeError, ValueError):
                continue
        elif key == "mode":
            mode = str(value or "").strip().lower()
            if mode in MODES:
                cfg["mode"] = mode
        elif key == "hub_url":
            cfg["hub_url"] = str(value or DEFAULT_HUB_URL).strip().rstrip("/") or DEFAULT_HUB_URL
        elif key == "hub_token":
            token = str(value or "").strip()
            if token:
                cfg["hub_token"] = token
        elif key == "instance_name":
            cfg["instance_name"] = str(value or "Render Studio instance").strip()[:80]
        elif key == "instance_handle":
            cfg["instance_handle"] = str(value or "").strip().lower()[:32]
        elif key == "default_sort":
            cfg["default_sort"] = _clean_sort(value)
        elif key == "hub_categories":
            cfg["hub_categories"] = _clean_categories(value)
    if cfg["mode"] == "private":
        cfg["hub_pull_enabled"] = False
        cfg["hub_publish_enabled"] = False
    if patch.get("install_answered") or patch.get("mode"):
        cfg["install_answered"] = True
        if "enabled" not in patch:
            cfg["enabled"] = True
    _write(cfg)
    return admin_config()


def answer_install(*, include: bool, mode: str) -> dict[str, Any]:
    mode = str(mode or "hybrid").strip().lower()
    if mode not in MODES:
        mode = "hybrid"
    patch: dict[str, Any] = {
        "enabled": bool(include),
        "mode": mode,
        "install_answered": True,
    }
    if not include:
        patch["enabled"] = False
        patch["mode"] = "private"
        patch["hub_pull_enabled"] = False
        patch["hub_publish_enabled"] = False
    elif mode == "public":
        patch["hub_pull_enabled"] = True
        # Enrollment proves ownership of the stable instance identity. Individual
        # listings still need explicit local approval before they can publish.
        patch["hub_publish_enabled"] = bool(_is_official_host())
    elif mode == "hybrid":
        patch["hub_pull_enabled"] = False
        patch["hub_publish_enabled"] = False
    return save(patch)


def marketplace_enabled() -> bool:
    return bool(load().get("enabled", True))


def new_listing_status() -> str:
    return "pending" if load().get("listings_need_review", True) else "approved"


def allowed_kinds(cfg: dict[str, Any] | None = None) -> set[str]:
    data = cfg or load()
    kinds: set[str] = set()
    if data.get("show_models", True):
        kinds.add("model")
    if data.get("show_knowledge", True):
        kinds.add("knowledge")
    if data.get("show_agents", True):
        kinds.add("agent")
    return kinds or {"model", "knowledge", "agent"}


def hub_auth_headers() -> dict[str, str]:
    cfg = ensure_instance_identity()
    token = str(cfg.get("hub_token") or cfg.get("instance_secret") or "").strip()
    headers = {
        "X-Render-Instance-Id": str(cfg.get("instance_id") or ""),
        "X-Render-Instance-Name": str(cfg.get("instance_name") or "Render Studio")[:80],
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers
