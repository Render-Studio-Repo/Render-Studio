"""Authenticated, bounded proxy for the three-camera OpenArm wall."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlsplit

import httpx

from backend.services.viser_proxy import is_private_lan_host

CAMERAS = {"left", "right", "zed"}
MAX_FRAME = 8 * 1024 * 1024


def gateway_base() -> str:
    raw = os.environ.get("RENDER3D_ROBOT_CAMERA_BASE", "http://192.168.1.77:8001").strip().rstrip("/")
    parsed = urlsplit(raw)
    if parsed.scheme != "http" or not parsed.hostname or not is_private_lan_host(parsed.hostname) or parsed.username or parsed.password:
        raise ValueError("RENDER3D_ROBOT_CAMERA_BASE must be a private-LAN HTTP origin")
    port = parsed.port or 80
    return f"http://{parsed.hostname}:{port}"


async def status() -> dict[str, Any]:
    base = gateway_base()
    wrist: dict[str, Any] = {}
    zed: dict[str, Any] = {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0), follow_redirects=False, trust_env=False) as client:
        try:
            response = await client.get(f"{base}/api/robotics/hand-cam/status")
            if response.status_code == 200:
                wrist = response.json()
        except Exception:
            wrist = {}
        try:
            response = await client.get(f"{base}/api/robotics/zed/status")
            if response.status_code == 200:
                zed = response.json()
        except Exception:
            zed = {}
    cameras = {}
    for side in ("left", "right"):
        row = wrist.get(side) if isinstance(wrist.get(side), dict) else {}
        cameras[side] = {
            "label": f"{side.title()} wrist",
            "live": bool(row.get("live")),
            "age_ms": max(0, int(row.get("age_ms") or 0)),
            "reason": str(row.get("reason") or ("camera gateway unavailable" if not wrist else "waiting for frame"))[:180],
        }
    cameras["zed"] = {
        "label": str(zed.get("model") or "Top camera"),
        "live": bool(zed.get("live")),
        "age_ms": max(0, int(zed.get("age_ms") or 0)),
        "reason": str(zed.get("reason") or "Top-camera source unavailable")[:180],
        "source": "raspberry-pi",
    }
    return {"ok": True, "cameras": cameras, "live_count": sum(1 for row in cameras.values() if row["live"]), "privacy": "Frames are proxied by Render Studio; the Pi address is not sent to viewers."}


async def frame(name: str) -> tuple[bytes, str]:
    camera = str(name or "").strip().lower()
    if camera not in CAMERAS:
        raise ValueError("unknown camera")
    path = f"/api/robotics/zed.jpg" if camera == "zed" else f"/api/robotics/hand-cam/{camera}.jpg"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=1.0), follow_redirects=False, trust_env=False) as client:
            response = await client.get(f"{gateway_base()}{path}", headers={"Accept": "image/jpeg,image/png,image/webp"})
    except httpx.HTTPError as exc:
        raise RuntimeError("camera gateway unavailable") from exc
    media = str(response.headers.get("content-type") or "").split(";", 1)[0].lower()
    if response.status_code != 200 or media not in {"image/jpeg", "image/png", "image/webp"} or not response.content:
        reason = response.headers.get("x-camera-reason") or "camera unavailable"
        try:
            reason = str(response.json().get("reason") or reason)
        except Exception:
            pass
        raise RuntimeError(reason[:180])
    if len(response.content) > MAX_FRAME:
        raise RuntimeError("camera frame exceeds 8 MB")
    return response.content, media
