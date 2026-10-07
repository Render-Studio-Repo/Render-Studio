"""Opt-in, low-overhead reporting for independently hosted Render instances.

The public client sends a stable instance id, operator-chosen name, coarse
health/capacity metrics, and explicit support submissions. It never sends an
IP address, hostname, prompt, project file, credential, or user identity.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import platform
import random
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings
from backend.services import log_redact

logger = logging.getLogger("render3d.instance_network")

DEFAULT_HUB = "https://render3d.app"
REGISTER_PATH = "/api/instance-network/v1/register"
HEARTBEAT_PATH = "/api/instance-network/v1/heartbeat"
SUBMISSION_PATH = "/api/instance-network/v1/submissions"
UPDATE_PATH = "/api/instance-network/v1/releases/latest"
HEARTBEAT_SECONDS = 300
METRIC_CACHE_SECONDS = 900
MAX_DIAGNOSTIC = 12_000

_metrics_lock = threading.Lock()
_metrics_cache: tuple[float, dict[str, Any]] | None = None
_loop_started = False
_loop_lock = threading.Lock()
_leader_handle: Any = None


def _setup_state() -> dict[str, Any]:
    from backend.services import instance_setup_service as setup

    return setup._load_state()


def _market() -> dict[str, Any]:
    from backend.services import marketplace_config_service as market

    return market.ensure_instance_identity()


def hub_base() -> str:
    raw = os.environ.get("RENDER3D_INSTANCE_HUB_URL", DEFAULT_HUB).strip().rstrip("/")
    return raw if raw.startswith("https://") else DEFAULT_HUB


def reporting_enabled() -> bool:
    state = _setup_state()
    return bool(state.get("instance_reporting_opt_in")) or is_official_hub()


def update_notifications_enabled() -> bool:
    state = _setup_state()
    if bool(state.get("instance_update_notifications_answered")):
        return bool(state.get("instance_update_notifications"))
    cfg = _market()
    return bool(cfg.get("enabled")) and cfg.get("mode") == "public" and bool(cfg.get("hub_pull_enabled"))


def is_official_hub() -> bool:
    base = str(getattr(settings, "public_base_url", "") or "").lower()
    return "render3d.app" in base


def public_status() -> dict[str, Any]:
    cfg = _market()
    state = _setup_state()
    marketplace_connected = bool(cfg.get("enabled")) and cfg.get("mode") == "public" and bool(cfg.get("hub_pull_enabled"))
    return {
        "instance_id": str(cfg.get("instance_id") or ""),
        "instance_name": str(cfg.get("instance_name") or "Render Studio instance"),
        "reporting_opt_in": reporting_enabled(),
        "reporting_answered": bool(state.get("instance_reporting_answered")) or is_official_hub(),
        "public_network": bool(state.get("instance_public_network")),
        "ecosystem_opt_in": marketplace_connected,
        "update_notifications": update_notifications_enabled(),
        "debug_opt_in": bool(state.get("telemetry_opt_in")) or is_official_hub(),
        "hub": hub_base(),
        "privacy": {
            "sends": ["instance id", "instance name", "online status", "aggregate user/project counts", "coarse storage size", "version"],
            "never_sends": ["IP address", "hostname", "user identity", "prompts", "project files", "API keys"],
            "marketplace_sends": ["metadata and public URLs from explicitly approved marketplace listings"],
        },
    }


def render_login_status() -> dict[str, Any]:
    """Check the public Render account service without sending local identity."""
    base = hub_base()
    result = {
        "reachable": False,
        "hub": base,
        "login_url": f"{base}/?login=1&source=desktop-setup",
        "signup_url": f"{base}/?signup=1&source=desktop-setup",
        "providers": [],
    }
    try:
        import httpx

        health = httpx.get(f"{base}/api/health", timeout=5.0)
        health.raise_for_status()
        providers = httpx.get(f"{base}/api/auth/social/providers", timeout=5.0)
        providers.raise_for_status()
        payload = providers.json()
        result["reachable"] = True
        result["providers"] = list(payload.get("providers") or []) if isinstance(payload, dict) else []
    except Exception as exc:
        logger.info("Render login check unavailable type=%s", type(exc).__name__)
    return result


def configure(*, instance_name: str, reporting_opt_in: bool, public_network: bool, ecosystem_opt_in: bool) -> dict[str, Any]:
    from backend.services import instance_setup_service as setup
    from backend.services import marketplace_config_service as market

    name = " ".join(str(instance_name or "").split()).strip()[:80] or "Render Studio instance"
    market.save({"instance_name": name})
    setup._save_state({
        "instance_reporting_opt_in": bool(reporting_opt_in),
        "instance_reporting_answered": True,
        "instance_public_network": bool(public_network),
        "instance_update_notifications": bool(ecosystem_opt_in),
        "instance_update_notifications_answered": True,
    })
    market.answer_install(include=bool(ecosystem_opt_in), mode="public" if ecosystem_opt_in else "private")
    result = public_status()
    if result["ecosystem_opt_in"]:
        from backend.services import marketplace_hub_client

        enrollment = marketplace_hub_client.enroll_instance(
            public_network=bool(public_network)
        )
        result["ecosystem_registration"] = enrollment
        if enrollment.get("ok"):
            market.save({"hub_publish_enabled": True})
            result = public_status() | {
                "ecosystem_registration": enrollment,
                "publishing_enabled": True,
            }
    if result["reporting_opt_in"]:
        result["registration"] = send_registration()
    return result


def configure_updates(enabled: bool) -> dict[str, Any]:
    from backend.services import instance_setup_service as setup

    setup._save_state({
        "instance_update_notifications": bool(enabled),
        "instance_update_notifications_answered": True,
    })
    return {"ok": True, "update_notifications": bool(enabled)}


def _git(*args: str, timeout: float = 20.0) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=str(ROOT_DIR), stderr=subprocess.STDOUT, timeout=timeout,
    ).decode("utf-8", "replace").strip()


def _full_git_sha() -> str:
    try:
        return _git("rev-parse", "HEAD", timeout=2.0)
    except Exception:
        return ""


def check_for_update() -> dict[str, Any]:
    """Read the official release pointer without sending project or user data."""
    if is_official_hub() or not update_notifications_enabled():
        return {"ok": True, "enabled": False, "available": False}
    try:
        import httpx

        response = httpx.get(
            f"{hub_base()}{UPDATE_PATH}",
            params={"current": _git_sha(), "channel": "stable"},
            timeout=5.0,
        )
        response.raise_for_status()
        release = response.json()
    except Exception as exc:
        logger.info("update check unavailable type=%s", type(exc).__name__)
        return {"ok": False, "enabled": True, "available": False, "offline": True}
    commit = str((release or {}).get("commit_sha") or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        return {"ok": False, "enabled": True, "available": False, "detail": "The release pointer was invalid."}
    current = _full_git_sha()
    return {
        "ok": True,
        "enabled": True,
        "available": bool(current and commit != current),
        "current_sha": current,
        "release": {
            "version": str(release.get("version") or commit[:12])[:80],
            "commit_sha": commit,
            "notes": str(release.get("notes") or "")[:1000],
        },
    }


def apply_update(commit_sha: str) -> dict[str, Any]:
    """Fast-forward official source only. Runtime data and local edits are hard stops."""
    target = str(commit_sha or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", target):
        raise ValueError("Invalid update commit.")
    remote = _git("remote", "get-url", "origin", timeout=3.0).lower()
    if "github.com/wprojects/render-studio" not in remote:
        raise ValueError("Origin is not the official Render Studio repository.")
    current = _full_git_sha()
    if current == target:
        return {"ok": True, "already_current": True, "current_sha": current, "restart_required": False}
    if _git("status", "--porcelain", "--untracked-files=all", timeout=5.0):
        raise ValueError("Application source has local changes. Update refused so nothing is overwritten.")
    _git("fetch", "--quiet", "origin", timeout=90.0)
    _git("cat-file", "-e", f"{target}^{{commit}}", timeout=3.0)
    stable = _git("rev-parse", "refs/remotes/origin/master", timeout=3.0).lower()
    if target != stable:
        raise ValueError("The requested commit is not the current official stable release.")
    _git("merge-base", "--is-ancestor", "HEAD", target, timeout=3.0)
    changed = _git("diff", "--name-only", "HEAD", target, timeout=10.0).splitlines()
    protected = (
        "projects/", "data/", "backups/", "inbox/", "logs/", "output/",
        "backend/local_private/", "frontend/admin/", "server-configurations/profiles/enterprise-private/",
    )
    protected_files = {".env", "backend/render3d.db", "frontend/super-admin.html"}
    if any(path in protected_files or path.startswith(protected) for path in changed):
        raise ValueError("Release touches protected instance data. Update refused.")
    previous = current
    _git("merge", "--ff-only", target, timeout=90.0)
    return {
        "ok": True,
        "previous_sha": previous,
        "current_sha": _full_git_sha(),
        "restart_required": True,
        "protected": ["projects/", "data/", "backups/", "logs/", ".env", "backend/local_private/", "private admin surfaces"],
    }


def _user_count() -> int:
    try:
        from backend.services import supabase_users_store as users

        remote = users.remote_user_count()
        return max(0, int(remote if remote is not None else users.sqlite_user_count()))
    except Exception:
        return 0


def _project_count() -> int:
    root = Path(getattr(settings, "projects_dir", "projects"))
    if not root.is_absolute():
        root = ROOT_DIR / root
    try:
        return sum(1 for entry in os.scandir(root) if entry.is_dir(follow_symlinks=False))
    except OSError:
        return 0


def _coarse_storage_bytes() -> int:
    """Cheap upper-level runtime size; avoids walking CAD project trees."""
    total = 0
    for root in (Path(settings.data_dir),):
        try:
            for entry in os.scandir(root):
                if entry.is_file(follow_symlinks=False):
                    total += max(0, int(entry.stat(follow_symlinks=False).st_size))
        except OSError:
            continue
    return total


def _git_sha() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=str(ROOT_DIR),
            stderr=subprocess.DEVNULL, timeout=2,
        )
        return out.decode("utf-8", "ignore").strip()[:12]
    except Exception:
        return ""


def metrics(*, force: bool = False) -> dict[str, Any]:
    global _metrics_cache
    now = time.monotonic()
    with _metrics_lock:
        if not force and _metrics_cache and now - _metrics_cache[0] < METRIC_CACHE_SECONDS:
            return dict(_metrics_cache[1])
        try:
            from backend.services import supabase_users_store as users
            backend = users.cached_users_backend()
        except Exception:
            backend = "unknown"
        value = {
            "user_count": _user_count(),
            "project_count": _project_count(),
            "storage_bytes": _coarse_storage_bytes(),
            "users_backend": backend,
            "git_sha": _git_sha(),
            "runtime": f"python-{sys.version_info.major}.{sys.version_info.minor}",
            "platform": platform.system().lower()[:20],
        }
        _metrics_cache = (now, value)
        return dict(value)


def _identity_payload() -> dict[str, Any]:
    cfg = _market()
    state = _setup_state()
    return {
        "instance_id": str(cfg.get("instance_id") or ""),
        "instance_secret": str(cfg.get("instance_secret") or ""),
        "instance_name": str(cfg.get("instance_name") or "Render Studio instance")[:80],
        "public_network": bool(state.get("instance_public_network")),
        "debug_opt_in": bool(state.get("telemetry_opt_in")) or is_official_hub(),
        **metrics(),
    }


def _post(path: str, body: dict[str, Any], *, timeout: float = 5.0) -> dict[str, Any]:
    try:
        import httpx

        response = httpx.post(f"{hub_base()}{path}", json=body, timeout=timeout)
        data = response.json() if response.content else {}
        if response.status_code >= 400:
            return {"ok": False, "status": response.status_code, "detail": str(data.get("detail") or "hub rejected request")[:200]}
        return data if isinstance(data, dict) else {"ok": True}
    except Exception as exc:
        logger.info("instance hub unavailable path=%s type=%s", path, type(exc).__name__)
        return {"ok": False, "offline": True}


def send_registration() -> dict[str, Any]:
    if not reporting_enabled():
        return {"ok": False, "disabled": True}
    return _post(REGISTER_PATH, _identity_payload())


def send_heartbeat() -> dict[str, Any]:
    if not reporting_enabled():
        return {"ok": False, "disabled": True}
    body = _identity_payload()
    result = _post(HEARTBEAT_PATH, body)
    if result.get("status") in {403, 404}:
        result = _post(REGISTER_PATH, body)
    return result


def submit(*, kind: str, subject: str, message: str, severity: str = "normal", diagnostic: str = "") -> dict[str, Any]:
    allowed = {"support", "issue", "diagnostic", "bug", "suggestion"}
    clean_kind = str(kind or "support").strip().lower()
    if clean_kind not in allowed:
        raise ValueError("kind must be support, issue, diagnostic, bug, or suggestion")
    clean_subject = " ".join(str(subject or "").split()).strip()[:160]
    clean_message = log_redact.redact_text(str(message or "")).strip()[:8000]
    clean_diagnostic = log_redact.redact_text(str(diagnostic or "")).strip()[:MAX_DIAGNOSTIC]
    if len(clean_subject) < 3 or len(clean_message) < 5:
        raise ValueError("subject and message are required")
    body = {
        **_identity_payload(),
        "kind": clean_kind,
        "subject": clean_subject,
        "message": clean_message,
        "severity": str(severity or "normal").strip().lower()[:20],
        "diagnostic": clean_diagnostic,
        "client_token": hashlib.sha256(f"{clean_subject}:{clean_message}".encode()).hexdigest()[:20],
    }
    registered = _post(REGISTER_PATH, _identity_payload())
    if not registered.get("ok"):
        return registered
    return _post(SUBMISSION_PATH, body, timeout=8.0)


def forward_management_feedback(*, kind: str, message: str) -> dict[str, Any]:
    """Copy an explicit self-hosted report to the central inbox without user or project data."""
    clean_kind = str(kind or "").strip().lower()
    if is_official_hub() or clean_kind not in {"bug", "suggestion"}:
        return {"ok": True, "local_only": True}
    return submit(
        kind=clean_kind,
        subject="Studio bug report" if clean_kind == "bug" else "Studio suggestion",
        message=message,
        severity="normal",
    )


def _take_leader_lock() -> bool:
    global _leader_handle
    try:
        import fcntl

        path = Path(settings.data_dir) / "instance_network_heartbeat.lock"
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("a+")
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        _leader_handle = handle
        return True
    except Exception:
        return _leader_handle is None


def _heartbeat_loop() -> None:
    if not _take_leader_lock():
        return
    time.sleep(8 + random.random() * 7)
    while True:
        if reporting_enabled():
            send_heartbeat()
        time.sleep(HEARTBEAT_SECONDS + random.random() * 30)


def start_background_loop() -> bool:
    global _loop_started
    with _loop_lock:
        if _loop_started:
            return False
        _loop_started = True
    threading.Thread(target=_heartbeat_loop, name="instance-network-heartbeat", daemon=True).start()
    return True
