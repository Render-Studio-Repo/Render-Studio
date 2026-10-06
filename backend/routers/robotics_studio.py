"""Robotics studio: Viser LAN proxy + hand-cam snapshots + per-user prefs."""

from __future__ import annotations

import asyncio
import json
import secrets
import time
import zipfile
from typing import Any, Optional
from urllib.parse import quote, urljoin, urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from backend.auth import get_current_user
from backend.services.dimos_teleop_proxy import studio_can_proxy_lan
from backend.services.hand_cam_stream import (
    HAND_CAM_MJPEG_BOUNDARY,
    capture_status,
    ensure_hand_cam_streaming,
    frame_age_ms,
    get_camera_label_map,
    is_placeholder_jpeg,
    is_publish_on,
    is_self_camera_target,
    last_stream_reason,
    latest_live_jpeg,
    peek_live_jpeg,
    request_camera_permission,
    set_camera_label_map,
    set_publish,
    snapshot_headers,
    snapshot_reason,
)
from backend.services import cloud_compute_interest_service, robot_camera_wall
from backend.services.zed_cam_stream import (
    capture_status as zed_capture_status,
    is_publish_on as zed_is_publish_on,
    peek_live_jpeg as zed_peek_live_jpeg,
    request_camera_permission as zed_request_camera_permission,
    set_publish as zed_set_publish,
)
from backend.services.robotics_prefs import get_prefs, put_prefs
from backend.services.robotics_proxy_ticket import issue_robotics_proxy_ticket, robotics_proxy_ticket_ok
from backend.services import robotics_dataset_service, robotics_demo_service
from backend.services.pty_proxy import (
    PTY_TICKET_TTL_SEC,
    allow_pty_target,
    log_proxy_connect,
    probe_pty,
)
from backend.services.teleop_proxy import (
    TELEOP_TICKET_TTL_SEC,
    allow_teleop_target,
    probe_teleop,
    rewrite_teleop_html,
)
from backend.services.viser_proxy import (
    VISER_TICKET_TTL_SEC,
    allow_viser_target,
    is_private_lan_host,
    probe_viser,
    rewrite_viser_html,
)

router = APIRouter()


def _project_access(user, project_id: str, *, write: bool = False):
    from backend import main
    return (main._require_project_write if write else main._require_project_read)(user, project_id)


@router.get("/api/projects/{project_id}/robotics/datasets")
def robotics_datasets(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    return robotics_dataset_service.summary(_project_access(user, project_id))


@router.post("/api/projects/{project_id}/robotics/datasets/upload")
def upload_robotics_dataset(project_id: str, uploads: list[UploadFile] = File(...), paths: str = Form("[]"), name: str = Form("dataset"), user: dict[str, Any] = Depends(get_current_user)):
    try:
        relative = json.loads(paths)
        if not isinstance(relative, list):
            raise ValueError("Invalid dataset paths.")
        return robotics_dataset_service.import_dataset(_project_access(user, project_id, write=True), uploads, relative, name)
    except (ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/projects/{project_id}/robotics/demo/openarm/status")
def openarm_demo_status(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    return robotics_demo_service.status(_project_access(user, project_id))


@router.post("/api/projects/{project_id}/robotics/demo/openarm/install")
def install_openarm_demo(project_id: str, background: BackgroundTasks, user: dict[str, Any] = Depends(get_current_user)):
    project = _project_access(user, project_id, write=True)
    current = robotics_demo_service.status(project)["demo"]
    if current.get("state") == "installing":
        return {"ok": True, "demo": current, "started": False}
    background.add_task(robotics_demo_service.install, project)
    return {"ok": True, "started": True, "demo": {"name": robotics_demo_service.DEMO_NAME, "root": robotics_demo_service.DEMO_ROOT.as_posix(), "state": "installing", "message": "Demo install queued."}}


@router.get("/api/projects/{project_id}/robotics/profiles")
def project_robotics_profiles(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    return robotics_demo_service.list_profiles(_project_access(user, project_id))


class ActivateProjectRoboticsProfileBody(BaseModel):
    root: str = Field(min_length=1, max_length=800)


class SaveProjectRoboticsProfileBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_root: str = Field(default="", max_length=800)
    settings: dict[str, Any] = Field(default_factory=dict)


@router.post("/api/projects/{project_id}/robotics/profiles")
def save_project_robotics_profile(project_id: str, body: SaveProjectRoboticsProfileBody, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return robotics_demo_service.save_profile(
            _project_access(user, project_id, write=True),
            name=body.name,
            base_root=body.base_root,
            settings=body.settings,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/projects/{project_id}/robotics/profiles/activate")
def activate_project_robotics_profile(project_id: str, body: ActivateProjectRoboticsProfileBody, user: dict[str, Any] = Depends(get_current_user)):
    profiles = robotics_demo_service.list_profiles(_project_access(user, project_id))["profiles"]
    selected = next((row for row in profiles if row["root"] == body.root), None)
    if not selected:
        raise HTTPException(404, "Robotics profile folder was not found in this project.")
    dataset_root = str(selected["profile"].get("dataset", {}).get("root") or "")
    prefs = put_prefs(user, {"activeDatasetRoot": dataset_root})
    return {"ok": True, "selected": selected, "prefs": prefs, "hardware_armed": False}

_tickets: dict[str, dict[str, Any]] = {}
_pty_tickets: dict[str, dict[str, Any]] = {}


class ViserOpenBody(BaseModel):
    url: str = Field(min_length=1)


class TeleopOpenBody(BaseModel):
    url: str = Field(min_length=1)


class PtyOpenBody(BaseModel):
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=8765)
    token: str = Field(min_length=8)


class RoboticsPrefsBody(BaseModel):
    roboticsProfile: Optional[dict[str, Any]] = None
    cameraHost: Optional[str] = None
    zedCameraUrl: Optional[str] = None
    camMode: Optional[str] = None
    viserUrls: Optional[list[str]] = None
    viserActive: Optional[str] = None
    teleopUrls: Optional[list[str]] = None
    teleopActive: Optional[str] = None
    cameraLabels: Optional[dict[str, Any]] = None
    cameraTitles: Optional[dict[str, Any]] = None
    cameraPermissionGranted: Optional[bool] = None
    activeDatasetRoot: Optional[str] = None
    activeProjectProfileRoot: Optional[str] = None


class CloudComputeInterestBody(BaseModel):
    email: Optional[str] = None


class HandCamPublishBody(BaseModel):
    on: bool = False
    restart: bool = False


class HandCamLabelsBody(BaseModel):
    devices: Optional[dict[str, Any]] = None
    titles: Optional[dict[str, Any]] = None


def _purge_tickets() -> None:
    now = time.time()
    dead = [k for k, v in _tickets.items() if now - float(v.get("at") or 0) > VISER_TICKET_TTL_SEC]
    for key in dead:
        _tickets.pop(key, None)


def _issue_ticket(user_id: str, url: str, host: str, port: int) -> str:
    _purge_tickets()
    token = secrets.token_urlsafe(18)
    _tickets[token] = {"user_id": user_id, "url": url, "host": host, "port": port, "at": time.time()}
    return token


def _ticket_ok(request: Request, host: str, port: int) -> bool:
    _purge_tickets()
    token = request.cookies.get("viser_ticket") or request.query_params.get("ticket") or ""
    row = _tickets.get(str(token))
    if not row:
        return False
    return str(row.get("host")) == str(host) and int(row.get("port")) == int(port)


def _require_lan_studio(request: Request) -> None:
    """Refuse only a real remote cloud worker. Self-hosted render3d.app is this Mac."""
    host = request.headers.get("host") or ""
    if not studio_can_proxy_lan(host):
        raise HTTPException(403, "Cloud Studio cannot reach LAN robotics hosts")


class RoboticsDiscoveryBody(BaseModel):
    url: str = Field(max_length=2048)


@router.post("/api/robotics/config/discover")
async def robotics_config_discover(body: RoboticsDiscoveryBody, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    from backend.services.robotics_profile import discover_profile
    try:
        return await discover_profile(body.url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, "Could not read the LAN robotics profile. Check its URL and that the Pi is online.") from exc


@router.get("/api/users/me/robotics-prefs")
def robotics_prefs_get(user: dict[str, Any] = Depends(get_current_user)):
    return {"prefs": get_prefs(user)}


@router.put("/api/users/me/robotics-prefs")
@router.patch("/api/users/me/robotics-prefs")
def robotics_prefs_put(body: RoboticsPrefsBody, user: dict[str, Any] = Depends(get_current_user)):
    try:
        prefs = put_prefs(user, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if body.cameraLabels is not None or body.cameraTitles is not None:
        set_camera_label_map(
            {"devices": prefs.get("cameraLabels") or {}, "titles": prefs.get("cameraTitles") or {}},
            persist=True,
        )
    return {"prefs": prefs}


@router.get("/api/users/me/cloud-compute-interest")
def cloud_compute_interest_get(user: dict[str, Any] = Depends(get_current_user)):
    return {
        "interested": cloud_compute_interest_service.is_interested(str(user.get("id") or "")),
        "email": user.get("email") or "",
    }


@router.post("/api/users/me/cloud-compute-interest")
def cloud_compute_interest_post(
    body: CloudComputeInterestBody | None = None,
    user: dict[str, Any] = Depends(get_current_user),
):
    payload = body.model_dump() if body else {}
    return cloud_compute_interest_service.signup(user, payload.get("email"))


@router.post("/api/viser/open")
def viser_open(body: ViserOpenBody, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    try:
        url, host, port, path = allow_viser_target(body.url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    ticket = _issue_ticket(str(user.get("id") or ""), url, host, port)
    iframe = f"/api/viser/p/{quote(host, safe='')}/{port}{path if path.startswith('/') else '/' + path}"
    ok, error = probe_viser(url)
    out = JSONResponse({"iframe": iframe, "url": url, "ok": ok, "error": error or None})
    out.set_cookie(
        "viser_ticket",
        ticket,
        max_age=VISER_TICKET_TTL_SEC,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/api/viser",
    )
    return out


def _issue_teleop_ticket(user_id: str, url: str, host: str, port: int) -> str:
    return issue_robotics_proxy_ticket(
        kind="teleop", user_id=user_id, host=host, port=port, ttl_sec=TELEOP_TICKET_TTL_SEC,
    )


def _teleop_ticket_ok(request: Request, host: str, port: int) -> bool:
    token = request.cookies.get("teleop_ticket") or request.query_params.get("ticket") or ""
    return robotics_proxy_ticket_ok(str(token), kind="teleop", host=host, port=port)


def _purge_pty_tickets() -> None:
    now = time.time()
    dead = [k for k, v in _pty_tickets.items() if now - float(v.get("at") or 0) > PTY_TICKET_TTL_SEC]
    for key in dead:
        _pty_tickets.pop(key, None)


def _issue_pty_ticket(user_id: str, host: str, port: int, sidecar_token: str) -> str:
    _purge_pty_tickets()
    token = secrets.token_urlsafe(18)
    _pty_tickets[token] = {
        "user_id": user_id,
        "host": host,
        "port": port,
        "sidecar_token": sidecar_token,
        "at": time.time(),
    }
    return token


def _pty_ticket_row(request: Request, host: str, port: int) -> dict[str, Any] | None:
    _purge_pty_tickets()
    token = request.cookies.get("pty_ticket") or request.query_params.get("ticket") or ""
    row = _pty_tickets.get(str(token))
    if not row:
        return None
    if str(row.get("host")) != str(host) or int(row.get("port")) != int(port):
        return None
    return row


@router.post("/api/pty/open")
def pty_open(body: PtyOpenBody, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    sidecar_token = str(body.token or "").strip()
    if len(sidecar_token) < 8:
        raise HTTPException(400, "Sidecar token required")
    try:
        _url, host, port = allow_pty_target(body.host, int(body.port))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    ticket = _issue_pty_ticket(str(user.get("id") or ""), host, port, sidecar_token)
    ws_path = f"/api/pty/p/{quote(host, safe='')}/{port}/"
    ok, error = probe_pty(host, port)
    log_proxy_connect(str(user.get("id") or ""), host, port)
    out = JSONResponse({"ws": ws_path, "ok": ok, "error": error or None, "host": host, "port": port})
    out.set_cookie(
        "pty_ticket",
        ticket,
        max_age=PTY_TICKET_TTL_SEC,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/api/pty",
    )
    return out


@router.get("/api/pty/p/{host}/{port}")
@router.get("/api/pty/p/{host}/{port}/{path:path}")
def pty_proxy_http(host: str, port: int, request: Request, path: str = "", user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    if not _pty_ticket_row(request, host, int(port)):
        raise HTTPException(401, "Open Local PTY from Robotics first")
    try:
        allow_pty_target(host, int(port))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return JSONResponse({"ok": True, "ws": f"/api/pty/p/{quote(host, safe='')}/{int(port)}/"})


@router.websocket("/api/pty/p/{host}/{port}")
@router.websocket("/api/pty/p/{host}/{port}/{path:path}")
async def pty_proxy_ws(websocket: WebSocket, host: str, port: int, path: str = ""):
    studio_host = websocket.headers.get("host") or ""
    if not studio_can_proxy_lan(studio_host):
        await websocket.close(code=1008)
        return
    token = websocket.cookies.get("pty_ticket") or websocket.query_params.get("ticket") or ""
    row = _pty_tickets.get(str(token))
    if not row or str(row.get("host")) != str(host) or int(row.get("port")) != int(port):
        await websocket.close(code=1008)
        return
    sidecar_token = str(row.get("sidecar_token") or "")
    try:
        url, _, _ = allow_pty_target(host, int(port))
    except ValueError:
        await websocket.close(code=1008)
        return
    import asyncio
    import websockets

    sep = "&" if "?" in url else "?"
    ws_url = f"{url.rstrip('/')}{sep}token={sidecar_token}"
    log_proxy_connect(str(row.get("user_id") or ""), host, int(port))
    try:
        async with websockets.connect(ws_url, max_size=None) as upstream:
            await websocket.accept()

            async def down() -> None:
                while True:
                    msg = await websocket.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if "text" in msg:
                        await upstream.send(msg["text"])
                    elif "bytes" in msg:
                        await upstream.send(msg["bytes"])

            async def up() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(str(message))

            await asyncio.gather(down(), up())
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass


@router.post("/api/teleop/open")
def teleop_open(body: TeleopOpenBody, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    try:
        url, host, port, path = allow_teleop_target(body.url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    ticket = _issue_teleop_ticket(str(user.get("id") or ""), url, host, port)
    iframe = f"/api/teleop/p/{quote(host, safe='')}/{port}{path if path.startswith('/') else '/' + path}"
    ok, error = probe_teleop(url)
    out = JSONResponse({"iframe": iframe, "url": url, "ok": ok, "error": error or None})
    out.set_cookie(
        "teleop_ticket",
        ticket,
        max_age=TELEOP_TICKET_TTL_SEC,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/api/teleop",
    )
    return out


HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _rewrite_html(html: str, prefix: str, upstream_host: str = "") -> str:
    return rewrite_viser_html(html, prefix, upstream_host)


VISER_HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


def _join_query(url: str, query: str) -> str:
    q = str(query or "").lstrip("?")
    if not q:
        return url
    return f"{url}{'&' if '?' in url else '?'}{q}"


@router.api_route("/api/viser/p/{host}/{port}", methods=VISER_HTTP_METHODS)
@router.api_route("/api/viser/p/{host}/{port}/{path:path}", methods=VISER_HTTP_METHODS)
async def viser_proxy_http(host: str, port: int, request: Request, path: str = ""):
    _require_lan_studio(request)
    if not _ticket_ok(request, host, int(port)):
        raise HTTPException(401, "Open Viser from Robotics first")
    try:
        url, _, _, _ = allow_viser_target(f"http://{host}:{int(port)}/{path}")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    import httpx

    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in HOP_BY_HOP and k.lower() not in {"host", "cookie", "authorization"}
    }
    target = _join_query(url, request.url.query)
    body = None if request.method in {"GET", "HEAD"} else await request.body()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=4.0),
            follow_redirects=False,
            verify=False,
        ) as client:
            upstream = await client.request(request.method, target, headers=headers, content=body)
    except httpx.RequestError as exc:
        raise HTTPException(
            502,
            f"Can't reach Viser at {url}. Start Viser locally or enter a LAN address.",
        ) from exc
    prefix = f"/api/viser/p/{quote(host, safe='')}/{int(port)}/"
    location = upstream.headers.get("location")
    rewritten_location = ""
    if location:
        joined = urljoin(url, location)
        try:
            allow_viser_target(joined)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        loc_path = urlparse(joined).path or "/"
        loc_query = urlparse(joined).query
        rewritten_location = f"{prefix.rstrip('/')}{loc_path if loc_path.startswith('/') else '/' + loc_path}"
        if loc_query:
            rewritten_location = f"{rewritten_location}?{loc_query}"
    content_type = upstream.headers.get("content-type", "")
    body = upstream.content
    if "text/html" in content_type.lower():
        try:
            text = body.decode(upstream.encoding or "utf-8", errors="replace")
        except Exception:
            text = body.decode("utf-8", errors="replace")
        body = _rewrite_html(text, prefix, str(host)).encode("utf-8")
    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in HOP_BY_HOP
        and k.lower() not in {"content-security-policy", "x-frame-options", "content-length", "location"}
    }
    if rewritten_location:
        out_headers["Location"] = rewritten_location
    out_headers["Cache-Control"] = "no-store"
    return Response(content=body, status_code=upstream.status_code, headers=out_headers, media_type=content_type or None)


@router.websocket("/api/viser/p/{host}/{port}")
@router.websocket("/api/viser/p/{host}/{port}/{path:path}")
async def viser_proxy_ws(websocket: WebSocket, host: str, port: int, path: str = ""):
    studio_host = websocket.headers.get("host") or ""
    if not studio_can_proxy_lan(studio_host):
        await websocket.close(code=1008)
        return
    ticket = websocket.cookies.get("viser_ticket") or websocket.query_params.get("ticket") or ""
    row = _tickets.get(str(ticket))
    if not row or str(row.get("host")) != str(host) or int(row.get("port")) != int(port):
        await websocket.close(code=1008)
        return
    try:
        url, _, _, _ = allow_viser_target(f"http://{host}:{int(port)}/{path}")
    except ValueError:
        await websocket.close(code=1008)
        return
    import asyncio
    import websockets

    ws_url = _join_query(
        url.replace("http://", "ws://", 1).replace("https://", "wss://", 1),
        websocket.url.query,
    )
    proto = websocket.headers.get("sec-websocket-protocol")
    connect_kwargs: dict[str, Any] = {"max_size": None}
    if proto:
        connect_kwargs["subprotocols"] = [p.strip() for p in proto.split(",") if p.strip()]
    try:
        connect_kwargs["additional_headers"] = [("Origin", f"http://{host}:{int(port)}")]
    except Exception:
        pass
    try:
        upstream_ctx = websockets.connect(ws_url, **connect_kwargs)
    except TypeError:
        connect_kwargs.pop("additional_headers", None)
        upstream_ctx = websockets.connect(ws_url, **connect_kwargs)
    try:
        async with upstream_ctx as upstream:
            if proto:
                await websocket.accept(subprotocol=proto.split(",")[0].strip())
            else:
                await websocket.accept()
            async def down() -> None:
                while True:
                    msg = await websocket.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if "text" in msg:
                        await upstream.send(msg["text"])
                    elif "bytes" in msg:
                        await upstream.send(msg["bytes"])

            async def up() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(str(message))

            await asyncio.gather(down(), up())
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass


TELEOP_HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


@router.api_route("/api/teleop/p/{host}/{port}", methods=TELEOP_HTTP_METHODS)
@router.api_route("/api/teleop/p/{host}/{port}/{path:path}", methods=TELEOP_HTTP_METHODS)
async def teleop_proxy_http(host: str, port: int, request: Request, path: str = ""):
    _require_lan_studio(request)
    if not _teleop_ticket_ok(request, host, int(port)):
        raise HTTPException(401, "Open Teleop from Robotics first")
    try:
        url, _, _, _ = allow_teleop_target(f"https://{host}:{int(port)}/{path}", keep_path=True)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    import httpx

    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in HOP_BY_HOP and k.lower() not in {"host", "cookie", "authorization"}
    }
    target = _join_query(url, request.url.query)
    body = None if request.method in {"GET", "HEAD"} else await request.body()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=4.0),
            follow_redirects=False,
            verify=False,
        ) as client:
            upstream = await client.request(request.method, target, headers=headers, content=body)
    except httpx.RequestError as exc:
        raise HTTPException(
            502,
            f"Can't reach Teleop at {url}. Start DIMOS teleop-quest-openarm on 0.0.0.0:8443.",
        ) from exc
    prefix = f"/api/teleop/p/{quote(host, safe='')}/{int(port)}/"
    location = upstream.headers.get("location")
    rewritten_location = ""
    if location:
        joined = urljoin(url, location)
        try:
            allow_teleop_target(joined, keep_path=True)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        loc_path = urlparse(joined).path or "/"
        loc_query = urlparse(joined).query
        rewritten_location = f"{prefix.rstrip('/')}{loc_path if loc_path.startswith('/') else '/' + loc_path}"
        if loc_query:
            rewritten_location = f"{rewritten_location}?{loc_query}"
    content_type = upstream.headers.get("content-type", "")
    body = upstream.content
    if "text/html" in content_type.lower():
        try:
            text = body.decode(upstream.encoding or "utf-8", errors="replace")
        except Exception:
            text = body.decode("utf-8", errors="replace")
        body = rewrite_teleop_html(text, prefix, str(host)).encode("utf-8")
    out_headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in HOP_BY_HOP
        and k.lower() not in {"content-security-policy", "x-frame-options", "content-length", "location"}
    }
    if rewritten_location:
        out_headers["Location"] = rewritten_location
    out_headers["Cache-Control"] = "no-store"
    return Response(content=body, status_code=upstream.status_code, headers=out_headers, media_type=content_type or None)


@router.websocket("/api/teleop/p/{host}/{port}")
@router.websocket("/api/teleop/p/{host}/{port}/{path:path}")
async def teleop_proxy_ws(websocket: WebSocket, host: str, port: int, path: str = ""):
    import ssl

    studio_host = websocket.headers.get("host") or ""
    if not studio_can_proxy_lan(studio_host):
        await websocket.close(code=1008)
        return
    ticket = websocket.cookies.get("teleop_ticket") or websocket.query_params.get("ticket") or ""
    if not robotics_proxy_ticket_ok(str(ticket), kind="teleop", host=host, port=int(port)):
        await websocket.close(code=1008)
        return
    try:
        url, _, _, _ = allow_teleop_target(f"https://{host}:{int(port)}/{path}", keep_path=True)
    except ValueError:
        await websocket.close(code=1008)
        return
    import asyncio
    import websockets

    ws_url = _join_query(
        url.replace("http://", "ws://", 1).replace("https://", "wss://", 1),
        websocket.url.query,
    )
    proto = websocket.headers.get("sec-websocket-protocol")
    connect_kwargs: dict[str, Any] = {"max_size": None}
    if proto:
        connect_kwargs["subprotocols"] = [p.strip() for p in proto.split(",") if p.strip()]
    if ws_url.startswith("wss://"):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        connect_kwargs["ssl"] = ctx
    try:
        connect_kwargs["additional_headers"] = [("Origin", f"https://{host}:{int(port)}")]
    except Exception:
        pass
    try:
        upstream_ctx = websockets.connect(ws_url, **connect_kwargs)
    except TypeError:
        connect_kwargs.pop("additional_headers", None)
        upstream_ctx = websockets.connect(ws_url, **connect_kwargs)
    try:
        async with upstream_ctx as upstream:
            if proto:
                await websocket.accept(subprotocol=proto.split(",")[0].strip())
            else:
                await websocket.accept()

            async def down() -> None:
                while True:
                    msg = await websocket.receive()
                    if msg.get("type") == "websocket.disconnect":
                        break
                    if "text" in msg:
                        await upstream.send(msg["text"])
                    elif "bytes" in msg:
                        await upstream.send(msg["bytes"])

            async def up() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(str(message))

            await asyncio.gather(down(), up())
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass


@router.get("/api/robotics/hand-cam/{side}.jpg")
async def hand_cam_jpeg(side: str, request: Request, host: Optional[str] = Query(default=None), strict_remote: bool = False):
    _require_lan_studio(request)
    which = "right" if str(side).lower() == "right" else "left"
    if host:
        try:
            url, cam_host, cam_port, _ = allow_viser_target(
                host if "://" in host else f"http://{host}:8001/"
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if not is_self_camera_target(cam_host, cam_port):
            import httpx

            target = f"http://{cam_host}:{cam_port}/api/robotics/hand-cam/{which}.jpg"
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0)) as client:
                    resp = await client.get(target)
                if resp.status_code == 200 and resp.content and not is_placeholder_jpeg(resp.content):
                    return Response(
                        content=resp.content,
                        media_type="image/jpeg",
                        headers=snapshot_headers(True),
                    )
            except Exception:
                pass

    if host and strict_remote and not is_self_camera_target(cam_host, cam_port):
        return Response(status_code=503,headers=snapshot_headers(False,'Owner camera stream unavailable'))

    def _local_frame() -> tuple[bytes | None, str, int | None]:
        # ffmpeg/cv2 grabs must not run on the uvicorn event loop — they stall
        # accept() and take the whole Studio site down under JPEG polling.
        set_publish(True)
        frame = latest_live_jpeg(which)
        age = frame_age_ms(which)
        if frame:
            return frame, "", age
        why = snapshot_reason(which) or last_stream_reason(which)
        if not why:
            why = "waiting for wrist camera"
        return None, why, age

    live, reason, age_ms = await asyncio.to_thread(_local_frame)
    if not live:
        try:
            remote, media = await robot_camera_wall.frame(which)
            return Response(
                content=remote,
                media_type=media,
                headers=snapshot_headers(True),
            )
        except Exception:
            pass
    if not live:
        return Response(status_code=503, headers=snapshot_headers(False, reason, age_ms))
    return Response(
        content=live,
        media_type="image/jpeg",
        headers=snapshot_headers(True, age_ms=age_ms),
    )


@router.get("/api/robotics/robot-camera.jpg")
async def robot_camera_jpeg(request: Request, url: str = Query(min_length=1, max_length=2048)):
    """Bounded private-LAN snapshot proxy for ZED/top/robot POV JPEG endpoints."""
    _require_lan_studio(request)
    from backend.services.robotics_prefs import normalize_robot_camera_url
    try:
        target = normalize_robot_camera_url(url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    import httpx
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(5.0, connect=2.0),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            async with client.stream("GET", target, headers={"Accept": "image/jpeg,image/png,image/webp"}) as response:
                response.raise_for_status()
                media = str(response.headers.get("content-type") or "").split(";", 1)[0].lower()
                if media not in {"image/jpeg", "image/png", "image/webp"}:
                    raise HTTPException(415, "Robot camera endpoint must return JPEG, PNG, or WebP")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 8 * 1024 * 1024:
                        raise HTTPException(413, "Robot camera frame exceeds 8 MB")
        return Response(content=bytes(body), media_type=media, headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, "Robot camera is unreachable") from exc


@router.get("/api/robotics/hand-cam/{side}.mjpeg")
async def hand_cam_mjpeg(side: str, request: Request):
    """Multipart MJPEG of the newest wrist frame. Does not start extra ffmpeg."""
    _require_lan_studio(request)
    which = "right" if str(side).lower() == "right" else "left"
    await asyncio.to_thread(ensure_hand_cam_streaming)
    boundary = HAND_CAM_MJPEG_BOUNDARY

    async def _frames():
        last_payload: bytes | None = None
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            frame, age_ms = peek_live_jpeg(which)
            remote_frame = False
            if not frame:
                try:
                    frame, _ = await robot_camera_wall.frame(which)
                    age_ms = 0
                    remote_frame = True
                except Exception:
                    frame = None
            if frame and frame is not last_payload:
                last_payload = frame
                idle = 0
                header = (
                    f"--{boundary}\r\n"
                    "Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(frame)}\r\n"
                    "X-Hand-Cam-Live: 1\r\n"
                    f"X-Hand-Cam-Age-Ms: {max(0, age_ms)}\r\n"
                    "\r\n"
                ).encode("ascii")
                yield header + frame + b"\r\n"
                if remote_frame:
                    await asyncio.sleep(0.075)
            else:
                idle += 1
                if idle > 400:
                    idle = 0
                await asyncio.sleep(0.015)

    return StreamingResponse(
        _frames(),
        media_type=f"multipart/x-mixed-replace; boundary={boundary}",
        headers={
            "Cache-Control": "no-store, no-cache",
            "Pragma": "no-cache",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/robotics/hand-cam/publish")
def hand_cam_publish(body: HandCamPublishBody, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    publish = set_publish(body.on, restart=bool(body.restart))
    status = capture_status(refresh=True) if publish else {"devices": [], "wristCount": 0}
    return {"publish": publish, "user_id": user.get("id"), **status}


@router.post("/api/robotics/hand-cam/request-permission")
def hand_cam_request_permission(request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    payload = request_camera_permission()
    payload["user_id"] = user.get("id")
    return payload


@router.get("/api/robotics/hand-cam/publish")
def hand_cam_publish_get(request: Request):
    _require_lan_studio(request)
    return {"publish": is_publish_on()}


@router.get("/api/robotics/hand-cam/status")
async def hand_cam_status(request: Request):
    _require_lan_studio(request)
    local = capture_status()
    if local.get("leftLive") or local.get("rightLive"):
        return local
    try:
        remote = await robot_camera_wall.status()
    except Exception:
        return local
    cameras = remote.get("cameras") if isinstance(remote.get("cameras"), dict) else {}
    left = cameras.get("left") if isinstance(cameras.get("left"), dict) else {}
    right = cameras.get("right") if isinstance(cameras.get("right"), dict) else {}
    left_live = bool(left.get("live"))
    right_live = bool(right.get("live"))
    if not left_live and not right_live:
        return local
    devices = []
    for index, (side, row) in enumerate((("left", left), ("right", right)), start=1):
        if not row.get("live"):
            continue
        devices.append({
            "index": -index,
            "name": f"{row.get('label') or side.title()} via Raspberry Pi",
            "uniqueId": f"raspberry-pi:{side}",
            "usb": "private-lan",
            "skipped": False,
            "keys": [f"source:raspberry-pi:{side}"],
            "side": side,
            "displayName": str(row.get("label") or f"{side.title()} wrist"),
            "pluggedIn": True,
        })
    return {
        **local,
        "source": "raspberry-pi",
        "publish": True,
        "devices": devices,
        "wristCount": int(left_live) + int(right_live),
        "leftIndex": -1 if left_live else None,
        "rightIndex": -2 if right_live else None,
        "leftLive": left_live,
        "rightLive": right_live,
        "leftWorker": left_live,
        "rightWorker": right_live,
        "leftReason": "" if left_live else str(left.get("reason") or "Pi left wrist camera unavailable"),
        "rightReason": "" if right_live else str(right.get("reason") or "Pi right wrist camera unavailable"),
        "captureApp": "Raspberry Pi camera gateway",
        "helper": "Live wrist-camera feeds are proxied from the Raspberry Pi.",
    }


@router.get("/api/robotics/hand-cam/labels")
def hand_cam_labels_get(request: Request):
    _require_lan_studio(request)
    labels = get_camera_label_map()
    return {"labels": labels, **capture_status()}


@router.put("/api/robotics/hand-cam/labels")
def hand_cam_labels_put(
    body: HandCamLabelsBody,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_lan_studio(request)
    labels = set_camera_label_map(
        {"devices": body.devices or {}, "titles": body.titles or {}},
        persist=True,
    )
    put_prefs(
        user,
        {"cameraLabels": labels.get("devices") or {}, "cameraTitles": labels.get("titles") or {}},
    )
    return {"labels": labels, **capture_status()}




@router.get("/api/robotics/zed/status")
def zed_cam_status(request: Request):
    _require_lan_studio(request)
    return zed_capture_status()


@router.get("/api/robotics/zed.jpg")
async def zed_cam_jpeg(request: Request):
    _require_lan_studio(request)
    try:
        remote, media = await robot_camera_wall.frame("zed")
        return Response(
            content=remote,
            media_type=media,
            headers={"Cache-Control": "no-store", "X-Camera-Source": "raspberry-pi"},
        )
    except Exception:
        pass
    if not zed_is_publish_on():
        await asyncio.to_thread(zed_set_publish, True)
    frame, age_ms, reason = await asyncio.to_thread(zed_peek_live_jpeg)
    if not frame:
        await asyncio.sleep(0.65)
        frame, age_ms, reason = await asyncio.to_thread(zed_peek_live_jpeg)
    if not frame:
        why = reason or "waiting for ZED frame"
        return Response(status_code=503, headers=snapshot_headers(False, why, 0))
    return Response(
        content=frame,
        media_type="image/jpeg",
        headers=snapshot_headers(True, age_ms=age_ms),
    )


@router.post("/api/robotics/zed/publish")
def zed_cam_publish(body: HandCamPublishBody, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    publish = zed_set_publish(body.on)
    status = zed_capture_status() if publish else zed_capture_status()
    return {"publish": publish, "user_id": user.get("id"), **status}


@router.post("/api/robotics/zed/request-permission")
def zed_cam_request_permission(request: Request, user: dict[str, Any] = Depends(get_current_user)):
    _require_lan_studio(request)
    payload = zed_request_camera_permission()
    payload["user_id"] = user.get("id")
    return payload

@router.get("/api/cam/p/{host}/{port}/{side}.jpg")
@router.get("/api/cam/p/{host}/{port}/{path:path}")
async def cam_proxy_jpeg(host: str, port: int, request: Request, side: str = "", path: str = ""):
    """Same-origin JPEG hop. Self-host (this Mac) captures locally — no proxy loop."""
    which = str(side or path or "left")
    stream = ".mjpeg" in which.lower() or which.lower().endswith(".mjpg")
    which = which.rsplit("/", 1)[-1]
    which = (
        which.replace(".mjpeg", "")
        .replace(".mjpg", "")
        .replace(".jpg", "")
        .replace(".jpeg", "")
    )
    if stream:
        return await hand_cam_mjpeg(which, request)
    if is_self_camera_target(host, port):
        return await hand_cam_jpeg(which, request, host=None)
    hop = f"{host}:{int(port)}"
    return await hand_cam_jpeg(which, request, host=hop)
