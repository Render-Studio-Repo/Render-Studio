"""Shared XR policy: who gets permission pushes, which WS types relay."""

from __future__ import annotations

import json
import os
from typing import Any

XR_RELAY_TYPES = frozenset({
    "xr.stroke",
    "xr.file",
    "xr.prompt.bridge",
    "xr.fit",
    "xr.draw",
    "xr.video",
    "xr.window",
    "rtc.signal",
    "xr.drop",
    "xr.object",
    "xr.printer",
    "xr.board",
    "xr.table",
    "xr.seat",
})


def _float_list(value, n: int) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < n:
        return None
    out: list[float] = []
    for i in range(n):
        try:
            out.append(float(value[i]))
        except (TypeError, ValueError):
            return None
    return out


def sanitize_xr_device(raw: Any | None) -> str:
    text = str(raw or "").strip()[:24]
    out = []
    for ch in text:
        if ch.isalnum() or ch in " .+_-":
            out.append(ch)
    return "".join(out).strip()[:24]


def sanitize_xr_mode(raw: Any | None) -> str:
    mode = str(raw or "").strip().lower()
    return mode if mode in {"vr", "ar"} else ""


def sanitize_public_pose(raw: dict | None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    p = _float_list(raw.get("p") or raw.get("position"), 3)
    if not p:
        return None
    out: dict = {"p": p}
    q = _float_list(raw.get("q") or raw.get("quaternion"), 4)
    if q:
        out["q"] = q
    s = _float_list(raw.get("s") or raw.get("scale"), 3)
    if s:
        out["s"] = s
    return out


def sanitize_public_drop(msg: dict | None, user_id: str = "") -> dict | None:
    row = msg if isinstance(msg, dict) else {}
    object_id = str(row.get("object_id") or "").strip()[:80]
    if not object_id:
        return None
    pose = sanitize_public_pose(row.get("pose") if isinstance(row.get("pose"), dict) else None)
    out = {
        "type": "xr.drop",
        "object_id": object_id,
        "project_id": str(row.get("project_id") or "")[:80],
        "project_name": str(row.get("project_name") or "")[:80],
        "share_url": str(row.get("share_url") or "")[:400],
        "glb_url": str(row.get("glb_url") or row.get("viewer_url") or "")[:400],
        "filename": str(row.get("filename") or "")[:180],
        "user_id": str(user_id or row.get("user_id") or ""),
    }
    kind = str(row.get("kind") or "").strip().lower()[:16]
    if kind in {"drop", "import", "scene"}:
        out["kind"] = kind
    fit = str(row.get("fit") or "").strip().lower()[:16]
    if fit in {"world", "handheld"}:
        out["fit"] = fit
    share_mode = str(row.get("share_mode") or "").strip().lower()[:16]
    if share_mode in {"view", "remix", "edit"}:
        out["share_mode"] = share_mode
    if pose:
        out["pose"] = pose
    return out


def sanitize_printer_box(msg: dict | None, user_id: str = "") -> dict | None:
    row = msg if isinstance(msg, dict) else {}
    size = _float_list(row.get("size") or (row.get("pose") or {}).get("s"), 3)
    pos = _float_list(row.get("position") or (row.get("pose") or {}).get("p") or row.get("p"), 3)
    if not size or not pos:
        return None
    if any(s < 0.05 or s > 4 for s in size):
        return None
    if any(abs(v) > 40 for v in (pos[0], pos[2])) or abs(pos[1]) > 8:
        return None
    return {
        "type": "xr.printer",
        "object_id": "printer-box",
        "kind": "printer",
        "size": size,
        "position": pos,
        "visible": bool(row.get("visible", True)),
        "user_id": str(user_id or row.get("user_id") or ""),
        "pose": {"p": pos, "s": size},
    }


def sanitize_public_object(msg: dict | None, user_id: str = "") -> dict | None:
    row = msg if isinstance(msg, dict) else {}
    object_id = str(row.get("object_id") or "").strip()[:80]
    if not object_id:
        return None
    out = {
        "type": "xr.object",
        "object_id": object_id,
        "grabbing": bool(row.get("grabbing")),
        "user_id": str(user_id or row.get("user_id") or ""),
    }
    pose = sanitize_public_pose(row.get("pose") if isinstance(row.get("pose"), dict) else None)
    if pose:
        out["pose"] = pose
    return out


def upsert_public_drop(store: dict, row: dict) -> dict:
    oid = str(row.get("object_id") or "")
    if not oid:
        return store
    prev = store.get(oid) or {}
    merged = {**prev, **row, "object_id": oid}
    if oid in store:
        store.pop(oid, None)
    store[oid] = merged
    # Keep the full live room inventory, including assemblies with more than 8 parts.
    return store


GRANT_WS_TYPE = "ai.keys.changed"
GRANT_WS_REASONS = frozenset({"chatgpt_granted", "chatgpt_connected"})
GRANT_REFRESH_SURFACES = ("connect-vr-permissions", "studio-keys")


def grant_notify_user_ids(actor_id: str | None, target_id: str | None) -> list[str]:
    out: list[str] = []
    for uid in (target_id, actor_id):
        ident = str(uid or "").strip()
        if ident and ident not in out:
            out.append(ident)
    return out


def grant_ws_payload(reason: str = "chatgpt_granted") -> dict[str, str]:
    return {"type": GRANT_WS_TYPE, "reason": reason}


def should_refresh_permission_surfaces(msg: dict | None) -> bool:
    row = msg or {}
    return str(row.get("type") or "") == GRANT_WS_TYPE and str(row.get("reason") or "") in GRANT_WS_REASONS


def relay_recipient_ids(
    peer_ids: list[str] | None,
    sender_id: str | None,
    target_user_id: str | None = None,
) -> list[str]:
    sender = str(sender_id or "").strip()
    others = [str(pid or "").strip() for pid in (peer_ids or []) if str(pid or "").strip() and str(pid).strip() != sender]
    target = str(target_user_id or "").strip()
    if target:
        return [target] if target in others else []
    return others


def presence_sync_pose_messages(users: list[dict] | None) -> list[dict]:
    out: list[dict] = []
    for row in users or []:
        ident = str(row.get("id") or row.get("user_id") or "").strip()
        pose = row.get("xrPose") or row.get("xr_pose") or row.get("pose")
        if ident and pose:
            out.append({"type": "xr.pose", "user_id": ident, "pose": pose})
    return out


GOOGLE_STUN_SERVERS = (
    {"urls": "stun:stun.l.google.com:19302"},
    {"urls": "stun:stun1.l.google.com:19302"},
)


def _ice_url_ok(url: str) -> bool:
    raw = str(url or "").strip().lower()
    return raw.startswith(("stun:", "turn:", "turns:"))


def _normalize_ice_server(row: dict | None) -> dict | None:
    if not isinstance(row, dict):
        return None
    urls = row.get("urls") or row.get("url")
    if isinstance(urls, (list, tuple)):
        clean = [str(u).strip() for u in urls if _ice_url_ok(str(u))]
        if not clean:
            return None
        urls_out: str | list[str] = clean if len(clean) > 1 else clean[0]
    else:
        one = str(urls or "").strip()
        if not _ice_url_ok(one):
            return None
        urls_out = one
    out: dict = {"urls": urls_out}
    user = str(row.get("username") or "").strip()
    cred = str(row.get("credential") or row.get("password") or "")
    if user:
        out["username"] = user
    if cred:
        out["credential"] = cred
    return out


def _settings_ice_env() -> dict:
    """Load empty-safe ICE fields from Settings (.env) when process env is bare."""
    try:
        from backend.config import settings
    except Exception:
        return {}
    out: dict[str, str] = {}
    json_blob = str(getattr(settings, "xr_ice_servers_json", "") or "").strip()
    if json_blob:
        out["XR_ICE_SERVERS_JSON"] = json_blob
    urls = str(getattr(settings, "xr_turn_urls", "") or "").strip()
    if urls:
        out["XR_TURN_URLS"] = urls
    user = str(getattr(settings, "xr_turn_username", "") or "").strip()
    if user:
        out["XR_TURN_USERNAME"] = user
    cred = str(getattr(settings, "xr_turn_credential", "") or "")
    if cred:
        out["XR_TURN_CREDENTIAL"] = cred
    return out


def _urls_have_turn(urls) -> bool:
    parts = urls if isinstance(urls, (list, tuple)) else [urls]
    blob = " ".join(str(u).lower() for u in parts)
    return "turns:" in blob or "turn:" in blob


def xr_ice_servers(environ: dict | None = None) -> list[dict]:
    """Google STUN plus any process-configured servers. No invented vendor."""
    if environ is not None:
        env = environ
    else:
        env = {**_settings_ice_env(), **os.environ}
    out: list[dict] = [dict(s) for s in GOOGLE_STUN_SERVERS]
    seen = {str(s["urls"]) for s in out}

    def add(row: dict | None) -> None:
        norm = _normalize_ice_server(row)
        if not norm:
            return
        key = f"{norm.get('urls')}|{norm.get('username') or ''}"
        if key in seen:
            return
        seen.add(key)
        out.append(norm)

    raw_json = str(env.get("XR_ICE_SERVERS_JSON") or env.get("RENDER3D_ICE_SERVERS_JSON") or "").strip()
    if raw_json:
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            for row in parsed:
                if isinstance(row, dict):
                    add(row)
                elif isinstance(row, str):
                    add({"urls": row})

    turn_urls = str(env.get("XR_TURN_URLS") or env.get("RENDER3D_TURN_URLS") or "").strip()
    if turn_urls:
        user = str(env.get("XR_TURN_USERNAME") or env.get("RENDER3D_TURN_USERNAME") or "").strip()
        cred = str(env.get("XR_TURN_CREDENTIAL") or env.get("RENDER3D_TURN_CREDENTIAL") or "")
        for part in turn_urls.split(","):
            row = {"urls": part.strip()}
            if user:
                row["username"] = user
            if cred:
                row["credential"] = cred
            add(row)
    return out


def rtc_ice_payload(environ: dict | None = None) -> dict:
    servers = xr_ice_servers(environ)
    has_turn = any(_urls_have_turn(s.get("urls")) for s in servers)
    return {"iceServers": servers, "has_turn": has_turn}


def rtc_ice_payload_for_client(*, authenticated: bool, environ: dict | None = None) -> dict:
    """STUN is public. TURN credentials from env only go to signed-in clients."""
    payload = rtc_ice_payload(environ)
    if authenticated:
        return payload
    servers = [s for s in payload["iceServers"] if not _urls_have_turn(s.get("urls"))]
    return {"iceServers": servers, "has_turn": False}
