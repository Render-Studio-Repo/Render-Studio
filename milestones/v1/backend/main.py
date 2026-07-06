"""Render3D — CAD project visualizer API."""

from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import logging
import time

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from backend.auth import create_access_token, get_current_user, get_user_by_id
from backend.config import settings
from backend.database import init_db
from backend.services import cad_service
from backend.services.ai_service import AIService
from backend.services import (
    folders_service,
    history_service,
    project_log_service,
    project_store,
    prompt_history_service,
    workspace_log_service,
)
from backend.services import kernel_bridge
from backend.services import teams_service
from backend.services.trace_log import TraceTimer, add as trace_add, list_entries, new_trace_id
from backend.ws.manager import hub
from backend.auth import decode_token

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("render3d")

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / settings.projects_dir
FRONTEND = ROOT / "frontend"
PROJECTS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Render3D", description="CAD project visualizer with AI prompting")


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    n = teams_service.migrate_orphan_projects(PROJECTS)
    if n:
        logger.info("Migrated %d orphan project(s) to default team", n)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        trace_id = new_trace_id()
        request.state.trace_id = trace_id
        t0 = time.perf_counter()
        trace_add(
            "info",
            f"{request.method} {request.url.path}",
            trace_id=trace_id,
            data={"query": str(request.query_params)},
        )
        try:
            response = await call_next(request)
            ms = (time.perf_counter() - t0) * 1000
            trace_add(
                "info" if response.status_code < 400 else "error",
                f"{request.method} {request.url.path} → {response.status_code} ({ms:.0f}ms)",
                trace_id=trace_id,
                data={"status": response.status_code, "duration_ms": ms},
            )
            response.headers["X-Trace-Id"] = trace_id
            return response
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000
            trace_add("error", f"{request.method} {request.url.path} crashed: {exc}", trace_id=trace_id)
            logger.exception("Unhandled error")
            return JSONResponse(
                status_code=500,
                content={"detail": str(exc), "trace_id": trace_id},
                headers={"X-Trace-Id": trace_id},
            )
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    trace_id = getattr(request.state, "trace_id", None)
    detail = exc.detail
    trace_add("error", f"HTTP {exc.status_code}: {detail}", trace_id=trace_id, data={"detail": detail})
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail, "trace_id": trace_id},
        headers={"X-Trace-Id": trace_id or ""},
    )


class GeoReference(BaseModel):
    id: str
    type: str = Field(..., description="vertex | edge | face | corner")
    position: list[float]
    normal: list[float] | None = None
    face_index: int | None = None
    vertex_index: int | None = None
    label: str | None = None


class PromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    base_filename: str | None = None
    references: list[GeoReference] = Field(default_factory=list)
    speed: str = Field(default="fast", description="fast (~30s) or quality (slower, gpt-5.5-pro)")


class TransformRequest(BaseModel):
    mode: str = Field(default="delta", description="delta (relative) or absolute")
    scale: float | list[float] | None = None
    translation: list[float] | None = None
    rotation_deg: list[float] | None = None


class ExtrudeRequest(BaseModel):
    face_index: int | None = None
    at_ref: str | None = None
    distance_mm: float = Field(..., gt=0, le=5000)
    inward: bool = False
    axis: list[float] | None = None


class ProjectRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TeamCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class TeamInviteRequest(BaseModel):
    email: EmailStr


class FolderCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    parent_id: str | None = None


class FolderRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class ProjectFolderRequest(BaseModel):
    folder_id: str | None = None


class FolderShareRequest(BaseModel):
    email: EmailStr
    restrict_access: bool = True


def _require_project(user: dict[str, Any], project_id: str) -> Path:
    if not teams_service.can_access_project(user["id"], project_id):
        raise HTTPException(404, "Project not found")
    path = PROJECTS / project_id
    if not path.is_dir():
        raise HTTPException(404, "Project not found")
    return path


def _record_history(
    project_path: Path,
    kind: str,
    label: str,
    filename: str,
    meta: dict | None = None,
    user: dict[str, Any] | None = None,
):
    entry = history_service.append_entry(
        project_path,
        kind=kind,
        label=label,
        filename=filename,
        meta=meta,
        user_id=user["id"] if user else None,
        user_name=user["display_name"] if user else None,
    )
    log_entry = project_log_service.log_timeline_entry(project_path, entry)
    if user:
        _notify_project_history(project_path.name, log_entry, user)
    return entry


def _notify_project(project_id: str, message: dict[str, Any]) -> None:
    hub.notify(project_id, message)


def _notify_workspace(team_id: str, message: dict[str, Any]) -> None:
    for pid in teams_service.team_project_ids(team_id):
        hub.notify(pid, message)


def _log_workspace(
    team_id: str,
    *,
    kind: str,
    label: str,
    user: dict[str, Any] | None,
    project_id: str | None = None,
    meta: dict | None = None,
) -> dict[str, Any]:
    if not user:
        return {}
    entry = workspace_log_service.append_event(
        team_id,
        kind=kind,
        label=label,
        user_id=user["id"],
        user_name=user["display_name"],
        project_id=project_id,
        meta=meta,
    )
    _notify_workspace(
        team_id,
        {
            "type": "workspace.updated",
            "entry": entry,
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    return entry


def _notify_project_history(project_id: str, entry: dict[str, Any], user: dict[str, Any] | None) -> None:
    _notify_project(
        project_id,
        {
            "type": "project.history",
            "entry": entry,
            "by": user["display_name"] if user else None,
            "by_user_id": user["id"] if user else None,
        },
    )


def _get_ai(speed: str = "fast") -> AIService:
    try:
        model = settings.openai_model_quality if speed == "quality" else settings.openai_model
        return AIService(model=model)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _slim_context(project_id: str, project_path: Path, body: PromptRequest) -> dict[str, Any]:
    files = cad_service.list_project_files(project_path)
    return {
        "project_id": project_id,
        "file_count": len(files),
        "file_names": [f["name"] for f in files][:10],
        "base": body.base_filename,
        "refs": [
            {
                "id": r.id,
                "type": r.type,
                **({"face_index": r.face_index} if r.face_index is not None else {}),
            }
            for r in body.references
        ],
    }


@app.get("/api/logs")
def get_logs(limit: int = 80):
    return {"entries": list_entries(limit=min(limit, 150))}


@app.delete("/api/logs")
def clear_logs():
    from backend.services.trace_log import clear

    clear()
    return {"cleared": True}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model": settings.openai_model,
        "model_quality": settings.openai_model_quality,
        "openai_configured": bool(settings.openai_api_key),
        "openai_key_length": len(settings.openai_api_key) if settings.openai_api_key else 0,
        "auth": True,
    }


@app.post("/api/auth/register")
def register(body: RegisterRequest):
    try:
        user = teams_service.create_user(body.email, body.password, body.display_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    token = create_access_token(user["id"])
    teams = teams_service.list_teams(user["id"])
    return {"token": token, "user": user, "teams": teams}


@app.post("/api/auth/login")
def login(body: LoginRequest):
    user = teams_service.authenticate(body.email, body.password)
    if not user:
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(user["id"])
    teams = teams_service.list_teams(user["id"])
    return {"token": token, "user": user, "teams": teams}


@app.get("/api/auth/me")
def auth_me(user: dict[str, Any] = Depends(get_current_user)):
    return {"user": user, "teams": teams_service.list_teams(user["id"])}


@app.get("/api/users")
def list_users(q: str = Query(""), user: dict[str, Any] = Depends(get_current_user)):
    del user
    return {"users": teams_service.list_users(q)}


@app.get("/api/teams")
def list_teams(user: dict[str, Any] = Depends(get_current_user)):
    return {"teams": teams_service.list_teams(user["id"])}


@app.post("/api/teams")
def create_team(body: TeamCreateRequest, user: dict[str, Any] = Depends(get_current_user)):
    team = teams_service.create_team(body.name, user["id"])
    return {"team": team}


@app.patch("/api/teams/{team_id}")
def update_team(team_id: str, body: TeamCreateRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        team = teams_service.update_team(team_id, body.name, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"team": team}


@app.get("/api/teams/{team_id}/members")
def team_members(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        members = teams_service.list_team_members(team_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"members": members}


@app.post("/api/teams/{team_id}/invite")
def invite_to_team(team_id: str, body: TeamInviteRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        result = teams_service.invite_user_to_team(team_id, body.email, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return result


@app.get("/api/teams/invites/pending")
def pending_team_invites(user: dict[str, Any] = Depends(get_current_user)):
    return {"invites": teams_service.list_pending_invites(user["email"])}


@app.post("/api/teams/invites/{invite_id}/accept")
def accept_team_invite(invite_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return teams_service.accept_team_invite(invite_id, user["id"], user["email"])
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/teams/invites/{invite_id}/decline")
def decline_team_invite(invite_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return teams_service.decline_team_invite(invite_id, user["email"])
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/teams/{team_id}/folders")
def list_workspace_folders(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        folders = folders_service.list_folders(team_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"folders": folders}


@app.post("/api/teams/{team_id}/folders")
def create_workspace_folder(
    team_id: str,
    body: FolderCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        folder = folders_service.create_folder(
            team_id, body.name, user["id"], parent_id=body.parent_id
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _log_workspace(
        team_id,
        kind="folder_created",
        label=f'Created folder "{folder["name"]}"',
        user=user,
        meta={"folder_id": folder["id"], "folder_name": folder["name"]},
    )
    return {"folder": folder}


@app.patch("/api/teams/{team_id}/folders/{folder_id}")
def rename_workspace_folder(
    team_id: str,
    folder_id: str,
    body: FolderRenameRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    del team_id
    try:
        folder = folders_service.rename_folder(folder_id, body.name, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    _log_workspace(
        folder["team_id"],
        kind="folder_renamed",
        label=f'Renamed folder to "{folder["name"]}"',
        user=user,
        meta={"folder_id": folder_id},
    )
    return {"folder": folder}


@app.delete("/api/teams/{team_id}/folders/{folder_id}")
def delete_workspace_folder(
    team_id: str,
    folder_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    del team_id
    try:
        folder = folders_service.delete_folder(folder_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    _log_workspace(
        folder["team_id"],
        kind="folder_deleted",
        label=f'Deleted folder "{folder["name"]}"',
        user=user,
        meta={"folder_id": folder_id},
    )
    return {"deleted": folder_id}


@app.get("/api/teams/{team_id}/folders/{folder_id}/shares")
def list_folder_shares(
    team_id: str,
    folder_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    del team_id
    try:
        return folders_service.list_folder_shares(folder_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/teams/{team_id}/folders/{folder_id}/share")
def share_workspace_folder(
    team_id: str,
    folder_id: str,
    body: FolderShareRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    del team_id
    try:
        result = folders_service.share_folder(
            folder_id,
            body.email,
            user["id"],
            restrict_access=body.restrict_access,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    folder = folders_service._get_folder(folder_id)
    _log_workspace(
        folder["team_id"],
        kind="folder_shared",
        label=f'Shared folder "{folder["name"]}" with {body.email}',
        user=user,
        meta={"folder_id": folder_id, "email": body.email},
    )
    _notify_workspace(
        folder["team_id"],
        {
            "type": "workspace.updated",
            "entry": {
                "kind": "folder_shared",
                "label": f'{user["display_name"]} shared folder "{folder["name"]}"',
                "user_name": user["display_name"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    return result


@app.delete("/api/teams/{team_id}/folders/{folder_id}/shares/{target_user_id}")
def remove_folder_share(
    team_id: str,
    folder_id: str,
    target_user_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    del team_id
    try:
        return folders_service.remove_folder_share(folder_id, target_user_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.patch("/api/projects/{project_id}/folder")
def move_project_to_folder(
    project_id: str,
    body: ProjectFolderRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        result = folders_service.set_project_folder(project_id, body.folder_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    path = PROJECTS / project_id
    if path.is_dir():
        log_entry = project_log_service.append_event(
            path,
            kind="project_moved",
            label=f'Moved to "{result["folder_name"]}"',
            user_id=user["id"],
            user_name=user["display_name"],
            meta={
                "folder_id": result.get("folder_id"),
                "folder_name": result.get("folder_name"),
            },
            restorable=False,
        )
        _notify_project_history(project_id, log_entry, user)
    _log_workspace(
        result["team_id"],
        kind="project_moved",
        label=f"Moved project to {result['folder_name']}",
        user=user,
        project_id=project_id,
        meta={"folder_id": result.get("folder_id"), "folder_name": result.get("folder_name")},
    )
    return result


@app.get("/api/projects")
def list_projects(
    user: dict[str, Any] = Depends(get_current_user),
    team_id: str | None = Query(None),
):
    teams_service.migrate_orphan_projects(PROJECTS)
    if team_id:
        teams = teams_service.list_teams(user["id"])
        if team_id not in {t["id"] for t in teams}:
            raise HTTPException(403, "Not a member of that workspace")
    access = teams_service.user_project_access(user["id"], team_id)
    by_project = {r["project_id"]: r for r in access}
    projects = []
    for p in project_store.list_all_projects(PROJECTS):
        if p["id"] not in by_project:
            continue
        row = by_project[p["id"]]
        fid = row.get("folder_id")
        if fid and not folders_service.user_can_access_folder(fid, user["id"]):
            continue
        p = {**p, "team_id": row["team_id"], "folder_id": fid}
        projects.append(p)
    return {"projects": projects}


@app.post("/api/projects")
def create_project(
    user: dict[str, Any] = Depends(get_current_user),
    name: str | None = Query(None),
    team_id: str | None = Query(None),
):
    teams = teams_service.list_teams(user["id"])
    if not teams:
        raise HTTPException(400, "No team available")
    tid = team_id or teams[0]["id"]
    if tid not in {t["id"] for t in teams}:
        raise HTTPException(403, "Not a member of that team")
    project_id = str(uuid.uuid4())[:8]
    path = cad_service.project_dir(PROJECTS, project_id)
    meta = project_store.touch_project(path, name=name or f"Project {project_id}")
    teams_service.register_project_access(project_id, tid, user["id"])
    return {"project_id": project_id, "team_id": tid, "meta": meta}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    return project_store.project_summary(path)


@app.patch("/api/projects/{project_id}")
def rename_project_endpoint(
    project_id: str, body: ProjectRenameRequest, user: dict[str, Any] = Depends(get_current_user)
):
    path = _require_project(user, project_id)
    try:
        old_name = project_store.load_meta(path).get("name", project_id)
        meta = project_store.rename_project(path, body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    log_entry = project_log_service.append_event(
        path,
        kind="project_renamed",
        label=f'Renamed to "{meta["name"]}"',
        user_id=user["id"],
        user_name=user["display_name"],
        meta={"old_name": old_name, "new_name": meta["name"]},
        restorable=False,
    )
    _notify_project(project_id, {"type": "project.meta", "name": meta["name"]})
    _notify_project_history(project_id, log_entry, user)
    return {"project_id": project_id, "name": meta["name"], "meta": meta}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    _require_project(user, project_id)
    shutil.rmtree(PROJECTS / project_id)
    teams_service.delete_project_access(project_id)
    return {"deleted": project_id}


@app.get("/api/projects/{project_id}/prompt-history")
def get_prompt_history(
    project_id: str,
    limit: int = Query(80, ge=1, le=200),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    return {"entries": prompt_history_service.list_entries(path, limit=limit)}


@app.get("/api/projects/{project_id}/timeline")
def get_timeline(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    return history_service.timeline_summary(path)


@app.get("/api/projects/{project_id}/object-history")
def get_object_history(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
):
    path = _require_project(user, project_id)
    return {"entries": project_log_service.list_events(path, limit=limit)}


@app.get("/api/projects/{project_id}/project-history")
def get_project_history(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    limit: int = Query(150, ge=1, le=300),
):
    path = _require_project(user, project_id)
    return {"entries": project_log_service.list_events(path, limit=limit)}


@app.get("/api/teams/{team_id}/workspace-history")
def get_workspace_history(
    team_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    limit: int = Query(80, ge=1, le=200),
):
    try:
        entries = workspace_log_service.list_events(team_id, user["id"], limit=limit)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"entries": entries}


@app.post("/api/projects/{project_id}/timeline/{index}")
def go_timeline(project_id: str, index: int, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    try:
        result = history_service.go_to_index(path, index)
    except (IndexError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": result.get("filename"),
            "url": f"/api/projects/{project_id}/files/{result.get('filename')}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "timeline",
        },
    )
    return result


@app.post("/api/projects/{project_id}/upload")
async def upload_file(
    project_id: str,
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in cad_service.SUPPORTED_IMPORT:
        raise HTTPException(400, f"Unsupported format. Use: {cad_service.SUPPORTED_IMPORT}")
    dest = path / (file.filename or f"upload{suffix}")
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    entry = _record_history(path, "upload", f"Upload {dest.name}", dest.name, user=user)
    project_store.touch_project(path, name=Path(dest.name).stem)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": dest.name,
            "url": f"/api/projects/{project_id}/files/{dest.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "upload",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": dest.name,
        "url": f"/api/projects/{project_id}/files/{dest.name}",
        "timeline_index": entry["index"],
    }


@app.get("/api/projects/{project_id}/files/{filename}")
def get_file(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    _require_project(user, project_id)
    file_path = PROJECTS / project_id / filename
    if not file_path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(file_path)


@app.delete("/api/projects/{project_id}/files/{filename}")
def delete_file(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    _require_project(user, project_id)
    file_path = PROJECTS / project_id / filename
    if file_path.is_file():
        file_path.unlink()
    _notify_project(project_id, {"type": "file.deleted", "filename": filename, "by": user["display_name"]})
    return {"deleted": filename}


def _save_prompt_history(
    project_path: Path,
    *,
    prompt: str,
    success: bool,
    body: PromptRequest,
    refs_list: list[dict[str, Any]],
    trace_id: str | None,
    user: dict[str, Any] | None = None,
    message: str | None = None,
    filename: str | None = None,
    error: str | None = None,
) -> None:
    try:
        prompt_history_service.append_entry(
            project_path,
            prompt=prompt,
            success=success,
            message=message,
            filename=filename,
            speed=body.speed,
            error=error,
            references=refs_list,
            trace_id=trace_id,
            user_id=user["id"] if user else None,
            user_name=user["display_name"] if user else None,
        )
    except Exception as exc:
        logger.debug("prompt history save failed: %s", exc)


def _prompt_via_kernel(
    project_id: str,
    body: PromptRequest,
    trace_id: str,
    ai: AIService,
    user: dict[str, Any],
    project_path: Path,
):
    """New engineering pipeline: AI -> Feature Program -> validated, exported model."""
    from backend.services import design_service

    refs_list = [r.model_dump() for r in body.references]
    context = _slim_context(project_id, project_path, body)
    timer = TraceTimer("Design pipeline", trace_id)
    try:
        out = design_service.run_design(body.prompt, project_path, context, ai, trace_id=trace_id)
        timer.done(intent=out.get("intent"), attempts=out.get("attempts"))
    except Exception as exc:
        timer.done(error=str(exc))
        _save_prompt_history(
            project_path, prompt=body.prompt, success=False, body=body,
            refs_list=refs_list, trace_id=trace_id, error=str(exc),
        )
        raise HTTPException(422, f"Design failed: {exc}") from exc

    result = out["result"]
    primary = result["primary"]
    label = "AI: " + (body.prompt[:48] + "…" if len(body.prompt) > 48 else body.prompt)
    entry = _record_history(
        project_path, "prompt", label, primary,
        meta={
            "program": result.get("program"), "files": result.get("files"),
            "intent": out.get("intent"), "prompt": body.prompt,
            "message": out.get("message"), "speed": body.speed,
            "sim": result.get("sim"), "dfm": result.get("dfm"),
        },
        user=user,
    )
    _save_prompt_history(
        project_path, prompt=body.prompt, success=True, body=body,
        refs_list=refs_list, trace_id=trace_id, message=out.get("message"), filename=primary,
    )
    project_store.touch_project(project_path, name=result.get("program", {}).get("name"))
    trace_add("info", f"Design done → {primary} ({out.get('attempts')} attempt(s))", trace_id=trace_id)
    _notify_project(
        project_id,
        {
            "type": "model.reload", "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "by": user["display_name"], "by_user_id": user["id"],
            "action": "prompt", "timeline_entry": entry,
        },
    )
    return {
        "message": out.get("message"),
        "filename": primary,
        "url": f"/api/projects/{project_id}/files/{primary}",
        "files": {k: f"/api/projects/{project_id}/files/{v}" for k, v in result.get("files", {}).items()},
        "intent": out.get("intent"),
        "specs_used": out.get("specs_used"),
        "parts": result.get("parts"),
        "sim": result.get("sim"),
        "dfm": result.get("dfm"),
        "warnings": out.get("dfm_warnings"),
        "timeline_index": entry["index"],
        "trace_id": trace_id,
        "trace": {"ai": out.get("ai_trace"), "intent": out.get("intent"), "attempts": out.get("attempts")},
    }


@app.post("/api/projects/{project_id}/prompt")
def prompt_cad(
    project_id: str,
    body: PromptRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    project_path = _require_project(user, project_id)
    ai = _get_ai(body.speed)

    trace_add(
        "info",
        "CAD prompt started",
        trace_id=trace_id,
        data={"prompt": body.prompt[:300], "speed": body.speed, "model": ai.model},
    )

    # New parametric B-rep pipeline for fresh geometry; legacy actions path for
    # edits on an existing/uploaded mesh (use_base, paint, hole-on-existing).
    if not body.base_filename:
        return _prompt_via_kernel(project_id, body, trace_id, ai, user, project_path)

    refs_list = [r.model_dump() for r in body.references]
    refs_map = cad_service.references_map(refs_list)
    context = _slim_context(project_id, project_path, body)

    try:
        plan, ai_trace = ai.generate_cad_plan(body.prompt, context, trace_id=trace_id)
    except (RuntimeError, ValueError) as exc:
        trace_add("error", f"AI plan failed: {exc}", trace_id=trace_id)
        _save_prompt_history(
            project_path,
            prompt=body.prompt,
            success=False,
            body=body,
            refs_list=refs_list,
            trace_id=trace_id,
            user=user,
            error=str(exc),
        )
        raise HTTPException(502, str(exc)) from exc

    actions = cad_service.sanitize_actions(plan.get("actions", []))
    if not actions:
        trace_add("error", "AI returned no actions", trace_id=trace_id, data={"plan": plan})
        _save_prompt_history(
            project_path,
            prompt=body.prompt,
            success=False,
            body=body,
            refs_list=refs_list,
            trace_id=trace_id,
            user=user,
            error="AI returned no CAD actions",
        )
        raise HTTPException(422, "AI returned no CAD actions")

    base_mesh = None
    if body.base_filename:
        src = project_path / body.base_filename
        if src.is_file():
            base_mesh = cad_service.load_mesh(src)
            if not any(a.get("op") == "use_base" for a in actions):
                actions.insert(0, {"op": "use_base", "id": "base", "result": False})

    cad_timer = TraceTimer("Build mesh from actions", trace_id)
    try:
        cad_service.save_actions_manifest(project_path, actions)
        mesh = cad_service.build_from_actions(actions, base_mesh=base_mesh, references=refs_map)
        cad_timer.done(action_count=len(actions), vertices=len(mesh.vertices))
    except Exception as exc:
        cad_timer.done(error=str(exc))
        trace_add("error", f"CAD build failed: {exc}", trace_id=trace_id, data={"actions": actions})
        _save_prompt_history(
            project_path,
            prompt=body.prompt,
            success=False,
            body=body,
            refs_list=refs_list,
            trace_id=trace_id,
            user=user,
            error=str(exc),
        )
        raise HTTPException(422, f"CAD build failed: {exc}") from exc

    filename = plan.get("filename", "generated.glb")
    if not filename.endswith((".glb", ".stl", ".obj")):
        filename += ".glb"
    out_path = project_path / filename
    cad_service.export_mesh(mesh, out_path)

    plan_message = plan.get("message", "Model generated.")
    label = "AI: " + (body.prompt[:48] + "…" if len(body.prompt) > 48 else body.prompt)
    entry = _record_history(
        project_path,
        "prompt",
        label,
        out_path.name,
        meta={
            "actions": actions,
            "references": refs_list,
            "prompt": body.prompt,
            "message": plan_message,
            "speed": body.speed,
        },
        user=user,
    )

    _save_prompt_history(
        project_path,
        prompt=body.prompt,
        success=True,
        body=body,
        refs_list=refs_list,
        trace_id=trace_id,
        user=user,
        message=plan_message,
        filename=out_path.name,
    )

    trace_add("info", f"CAD prompt done → {out_path.name}", trace_id=trace_id)
    project_store.touch_project(project_path, name=Path(out_path.stem).stem.replace("_", " "))
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out_path.name,
            "url": f"/api/projects/{project_id}/files/{out_path.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "prompt",
            "timeline_entry": entry,
        },
    )

    return {
        "message": plan_message,
        "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "actions": actions,
        "timeline_index": entry["index"],
        "trace_id": trace_id,
        "trace": {
            "ai": ai_trace,
            "actions": actions,
            "plan_message": plan_message,
            "model": ai.model,
            "speed": body.speed,
        },
    }


@app.post("/api/projects/{project_id}/build")
def build_program_endpoint(
    project_id: str,
    program: dict[str, Any],
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Build a parametric Feature Program with the B-rep kernel.

    Produces STEP + STL + GLB + sim.json, records a timeline step (GLB), and
    returns artifact info. This is the new engineering pipeline; the legacy
    /prompt route remains for raw actions and uploaded-mesh edits.
    """
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    project_path = _require_project(user, project_id)
    timer = TraceTimer("Kernel build", trace_id)
    try:
        result = kernel_bridge.build_and_export(program, project_path)
        timer.done(parts=len(result.get("parts", [])), primary=result.get("primary"))
    except Exception as exc:
        timer.done(error=str(exc))
        trace_add("error", f"Kernel build failed: {exc}", trace_id=trace_id)
        raise HTTPException(422, f"Kernel build failed: {exc}") from exc

    primary = result["primary"]
    label = "Build: " + result.get("program", {}).get("name", primary)
    entry = _record_history(
        project_path,
        "build",
        label,
        primary,
        meta={
            "program": result.get("program"),
            "files": result.get("files"),
            "sim": result.get("sim"),
            "dfm": result.get("dfm"),
        },
        user=user,
    )
    project_store.touch_project(project_path, name=result.get("program", {}).get("name"))
    trace_add("info", f"Kernel build done → {primary}", trace_id=trace_id)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "build",
            "timeline_entry": entry,
        },
    )
    return {
        "message": result.get("program", {}).get("description") or "Model built.",
        "filename": primary,
        "url": f"/api/projects/{project_id}/files/{primary}",
        "files": {
            k: f"/api/projects/{project_id}/files/{v}" for k, v in result.get("files", {}).items()
        },
        "parts": result.get("parts"),
        "sim": result.get("sim"),
        "dfm": result.get("dfm"),
        "warnings": result.get("warnings"),
        "timeline_index": entry["index"],
        "trace_id": trace_id,
    }


@app.post("/api/projects/{project_id}/files/{filename}/transform")
def transform_file(
    project_id: str,
    filename: str,
    body: TransformRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")
    mesh = cad_service.load_mesh(src)
    transform = body.model_dump(exclude_none=True, exclude={"mode"})
    mesh = cad_service.apply_transform(mesh, transform)
    stem = src.stem.replace("_edited", "") + "_edited"
    out = project_path / f"{stem}.glb"
    cad_service.export_mesh(mesh, out)
    entry = _record_history(project_path, "transform", "Transform", out.name, meta=transform, user=user)
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "transform",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
    }


@app.post("/api/projects/{project_id}/files/{filename}/extrude")
def extrude_file(
    project_id: str,
    filename: str,
    body: ExtrudeRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    face_index = body.face_index
    axis = body.axis
    if body.at_ref:
        refs = cad_service.references_map(
            [{"id": body.at_ref, "face_index": face_index, "normal": axis}]
        )
        ref = refs.get(body.at_ref.lstrip("@"))
        if ref and ref.get("face_index") is not None:
            face_index = int(ref["face_index"])
        if ref and ref.get("normal"):
            axis = list(ref["normal"])

    if face_index is None:
        raise HTTPException(400, "Pick a face (F) or provide face_index")

    mesh = cad_service.load_mesh(src)
    try:
        mesh = cad_service.extrude_face(
            mesh,
            face_index,
            body.distance_mm / 1000.0,
            axis=axis,
            inward=body.inward,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    stem = src.stem.replace("_extruded", "").replace("_edited", "") + "_extruded"
    out = project_path / f"{stem}.glb"
    cad_service.export_mesh(mesh, out)
    meta = {
        "face_index": face_index,
        "distance_mm": body.distance_mm,
        "inward": body.inward,
        "at_ref": body.at_ref,
    }
    entry = _record_history(
        project_path,
        "extrude",
        f"Extrude {body.distance_mm:g}mm",
        out.name,
        meta=meta,
        user=user,
    )
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "extrude",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "meta": meta,
    }


@app.websocket("/api/ws/projects/{project_id}")
async def project_ws(websocket: WebSocket, project_id: str, token: str = Query(...)):
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    user = get_user_by_id(user_id)
    if not user or not teams_service.can_access_project(user_id, project_id):
        await websocket.close(code=4403)
        return

    client = await hub.connect(project_id, websocket, user)
    try:
        while True:
            raw = await websocket.receive_text()
            await hub.handle_message(project_id, client.user_id, raw)
    except WebSocketDisconnect:
        await hub.disconnect(project_id, client.user_id)


if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
