"""Private-LAN camera wall backed by the Raspberry Pi gateway."""

from __future__ import annotations

import ipaddress

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from backend.auth import get_current_user_optional
from backend.services import robot_camera_wall

router = APIRouter()


def _is_private_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.is_private and not address.is_unspecified


def camera_wall_access(
    request: Request,
    user=Depends(get_current_user_optional),
):
    """Allow direct private-LAN viewing; retain auth on every other hostname."""
    host = request.url.hostname or ""
    peer = request.client.host if request.client else ""
    if _is_private_ip(host) and _is_private_ip(peer):
        return {"access": "private-lan"}
    if user:
        return user
    raise HTTPException(status_code=401, detail="Not authenticated")


@router.get("/api/robotics/camera-wall/status")
async def camera_wall_status(user=Depends(camera_wall_access)):
    return await robot_camera_wall.status()


@router.get("/api/robotics/camera-wall/{name}.jpg")
async def camera_wall_frame(name: str, user=Depends(camera_wall_access)):
    try:
        body, media = await robot_camera_wall.frame(name)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(body, media_type=media, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
