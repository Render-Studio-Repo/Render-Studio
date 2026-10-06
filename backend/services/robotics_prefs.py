"""Per-user robotics prefs: camera host, wrist/detach, Viser URLs."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit

from backend.database import get_conn
from backend.services.teleop_proxy import SAM_TELEOP_EXAMPLE, normalize_teleop_url
from backend.services.viser_proxy import normalize_camera_host, normalize_viser_url
from backend.services.viser_proxy import is_private_lan_host

SAM_CAMERA_EMAILS = frozenset()
SAM_CAMERA_HOST_DEFAULT = "192.168.1.83"
VISER_DEFAULT_URL = "http://127.0.0.1:8095/"
SAM_VISER_EXAMPLE = VISER_DEFAULT_URL
LEGACY_SAM_VISER_URL = "http://192.168.1.77:8095/"
TELEOP_DEFAULT_URL = "https://127.0.0.1:8443/teleop"


def normalize_robot_camera_url(raw: Any) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
        raise ValueError("Robot camera URL must be HTTP(S) without embedded credentials")
    if not parsed.hostname or not is_private_lan_host(parsed.hostname):
        raise ValueError("Robot camera must use a private LAN address")
    return value[:2048]


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_robotics_prefs (
              user_id TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )
            """
        )
        conn.commit()


def is_sam_camera_account(user: dict[str, Any] | None) -> bool:
    return False


def defaults_for(user: dict[str, Any] | None) -> dict[str, Any]:
    sam = is_sam_camera_account(user)
    if sam:
        urls = [SAM_VISER_EXAMPLE]
        active = SAM_VISER_EXAMPLE
        teleop_urls = [SAM_TELEOP_EXAMPLE, TELEOP_DEFAULT_URL]
        teleop_active = SAM_TELEOP_EXAMPLE
    else:
        urls = [VISER_DEFAULT_URL]
        active = VISER_DEFAULT_URL
        teleop_urls = [TELEOP_DEFAULT_URL]
        teleop_active = TELEOP_DEFAULT_URL
    return {
        "cameraHost": SAM_CAMERA_HOST_DEFAULT if sam else "",
        "zedCameraUrl": "",
        "camMode": "wrist",
        "viserUrls": urls,
        "viserActive": active,
        "teleopUrls": teleop_urls,
        "teleopActive": teleop_active,
        "cameraLabels": {},
        "cameraTitles": {"left": "Left", "right": "Right"},
        "cameraPermissionGranted": False,
        "activeDatasetRoot": "",
        "activeProjectProfileRoot": "",
    }


def _sanitize_camera_labels(raw: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for key, entry in raw.items():
        token = str(key or "").strip()[:180]
        if not token or not isinstance(entry, dict):
            continue
        side = "right" if str(entry.get("side") or "").lower() == "right" else "left"
        display = str(entry.get("displayName") or "").strip()[:80]
        keys = []
        for item in [token, *list(entry.get("keys") or [])]:
            low = str(item or "").strip()[:180].lower()
            if low and low not in keys:
                keys.append(low)
        out[token] = {"side": side, "displayName": display, "keys": keys[:16]}
    return out


def _sanitize_camera_titles(raw: Any) -> dict[str, str]:
    titles = {"left": "Left", "right": "Right"}
    if not isinstance(raw, dict):
        return titles
    for side in ("left", "right"):
        label = str(raw.get(side) or "").strip()[:80]
        if label:
            titles[side] = label
    return titles


def _sanitize(payload: dict[str, Any], user: dict[str, Any] | None) -> dict[str, Any]:
    base = defaults_for(user)
    camera = normalize_camera_host(payload.get("cameraHost") or base["cameraHost"])
    zed_camera = normalize_robot_camera_url(payload.get("zedCameraUrl") or base.get("zedCameraUrl") or "")
    mode = payload.get("camMode") if payload.get("camMode") in {"wrist", "detach"} else "wrist"
    urls = []
    for item in payload.get("viserUrls") or base["viserUrls"]:
        url = normalize_viser_url(item)
        if url == LEGACY_SAM_VISER_URL:
            url = VISER_DEFAULT_URL
        if url and url not in urls:
            urls.append(url)
    active = normalize_viser_url(payload.get("viserActive") or "") or (urls[0] if urls else "")
    if active == LEGACY_SAM_VISER_URL:
        active = VISER_DEFAULT_URL
    teleop_urls = []
    for item in payload.get("teleopUrls") or base["teleopUrls"]:
        url = normalize_teleop_url(item)
        if url and url not in teleop_urls:
            teleop_urls.append(url)
    teleop_active = normalize_teleop_url(payload.get("teleopActive") or "") or (
        teleop_urls[0] if teleop_urls else ""
    )
    profile = payload.get("roboticsProfile")
    if profile is not None:
        from backend.services.robotics_profile import validate_profile_selection
        profile = validate_profile_selection(profile)
    return {
        "roboticsProfile": profile,
        "cameraHost": camera or base["cameraHost"],
        "zedCameraUrl": zed_camera,
        "camMode": mode,
        "viserUrls": urls,
        "viserActive": active,
        "teleopUrls": teleop_urls,
        "teleopActive": teleop_active,
        "cameraLabels": _sanitize_camera_labels(payload.get("cameraLabels") or {}),
        "cameraTitles": _sanitize_camera_titles(payload.get("cameraTitles") or {}),
        "cameraPermissionGranted": bool(
            payload.get("cameraPermissionGranted")
            if payload.get("cameraPermissionGranted") is not None
            else base.get("cameraPermissionGranted")
        ),
        "activeDatasetRoot": str(payload.get("activeDatasetRoot") or "")[:800],
        "activeProjectProfileRoot": str(payload.get("activeProjectProfileRoot") or "")[:800],
    }


def get_prefs(user: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    uid = str(user.get("id") or "")
    with get_conn() as conn:
        row = conn.execute(
            "SELECT payload FROM user_robotics_prefs WHERE user_id = ?",
            (uid,),
        ).fetchone()
    if not row:
        return defaults_for(user)
    try:
        payload = json.loads(row["payload"] or "{}")
    except Exception:
        payload = {}
    return _sanitize(payload, user)


def put_prefs(user: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    current = get_prefs(user)
    current.update({k: v for k, v in (values or {}).items() if v is not None})
    next_values = _sanitize(current, user)
    uid = str(user.get("id") or "")
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_robotics_prefs (user_id, payload, updated_at)
            VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            ON CONFLICT(user_id) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """,
            (uid, json.dumps(next_values)),
        )
        conn.commit()
    return next_values
