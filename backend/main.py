"""Render3D — CAD project visualizer API."""

from __future__ import annotations

import json
import logging
import math
import shutil
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Body, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from backend.auth import create_access_token, get_current_user, get_current_user_optional, get_user_by_id
from backend.config import settings
from backend.database import get_conn, init_db
from backend.services import cad_service
from backend.services.ai_service import AIService
from backend.services import (
    folders_service,
    generation_service,
    history_service,
    project_log_service,
    project_store,
    prompt_history_service,
    workspace_log_service,
)
from backend.services import kernel_bridge
from backend.services import teams_service
from backend.services import skills_service, user_ai_keys_service
from backend.services import part_profiles_service
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


def _recover_stuck_generations() -> None:
    """Re-queue prompt jobs that were in-flight when the server last stopped.

    Called once at startup. Only recovers jobs whose full request_body was
    persisted — those without it are left for _normalize_stale to expire.
    """
    import uuid as _uuid
    stuck = generation_service.find_stuck_jobs(PROJECTS)
    if not stuck:
        return
    logger.info("Found %d stuck generation(s) to recover on startup", len(stuck))
    for job in stuck:
        project_id_ = job["project_id"]
        project_path_ = job["project_path"]
        original_data = job["data"]
        request_body = original_data.get("request_body") or {}
        original_trace = job.get("trace_id") or ""
        new_trace = str(_uuid.uuid4())[:8]
        restart_count = original_data.get("restart_count", 0) + 1
        user_ = {
            "id": original_data.get("by_user_id") or "",
            "display_name": original_data.get("by_user_name") or "System",
        }
        try:
            body_ = PromptRequest.model_validate(request_body)
        except Exception as exc:
            logger.warning("Cannot recover stuck job %s/%s: bad request_body: %s", project_id_, original_trace, exc)
            generation_service.fail(project_path_, f"Recovery failed: {exc}", trace_id=original_trace)
            continue
        try:
            ai_ = _get_ai_for_user(user_, body_.speed)
        except HTTPException as exc:
            logger.warning("Cannot recover stuck job %s: no AI key available: %s", project_id_, exc.detail)
            generation_service.fail(
                project_path_,
                "Recovered after restart — original AI key unavailable. Please re-run.",
                trace_id=original_trace,
            )
            continue
        logger.info("Recovering stuck job project=%s old_trace=%s new_trace=%s (restart #%d)",
                    project_id_, original_trace, new_trace, restart_count)
        try:
            generation_service.start(
                project_path_,
                kind="prompt",
                trace_id=new_trace,
                user=user_,
                prompt=body_.prompt,
                mode=getattr(body_, "mode", "standard") or "standard",
                request_body=request_body,
                restart_count=restart_count,
            )
        except Exception as exc:
            logger.warning("Could not restart stuck job %s: %s", project_id_, exc)
            continue
        import threading
        t = threading.Thread(
            target=_background_prompt_kernel,
            args=(project_id_, body_.model_dump(mode="json"), new_trace, dict(user_)),
            daemon=True,
            name=f"recover-{project_id_}-{new_trace}",
        )
        t.start()
        logger.info("Recovery thread started for project=%s trace=%s", project_id_, new_trace)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    n = teams_service.migrate_orphan_projects(PROJECTS)
    if n:
        logger.info("Migrated %d orphan project(s) to default team", n)
    try:
        _recover_stuck_generations()
    except Exception as exc:
        logger.warning("Startup generation recovery failed: %s", exc)


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


@app.middleware("http")
async def disable_frontend_cache(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


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
    type: str = Field(..., description="vertex | edge | face | corner | lasso | path | component")
    position: list[float] | None = None
    normal: list[float] | None = None
    face_index: int | None = None
    face_indices: list[int] | None = None
    vertex_index: int | None = None
    selected_vertices: list[list[float]] | None = None
    loop_points: list[list[float]] | None = None
    surface_normals: list[list[float] | None] | None = None
    surface_locked: bool | None = None
    endpoints: list[list[float]] | None = None
    label: str | None = None
    # component references (dragged from the project browser)
    filename: str | None = None
    stem: str | None = None
    format: str | None = None
    viewer_filename: str | None = None
    # source project when the component lives in a different project
    projectId: str | None = None


class PromptImage(BaseModel):
    id: str
    name: str = Field(..., max_length=160)
    media_type: str = Field(..., pattern=r"^image/(png|jpeg|jpg|webp)$")
    data_url: str = Field(..., max_length=10_000_000)


class PromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    base_filename: str | None = None
    references: list[GeoReference] = Field(default_factory=list)
    images: list[PromptImage] = Field(default_factory=list, max_length=4)
    speed: str = Field(default="fast", description="fast (~30s) or quality (slower, gpt-5.5-pro)")
    skills: list[str] = Field(default_factory=list, max_length=20)
    mode: str = Field(default="standard", description="standard (Render) or v2 (quality pipeline with brief+inspect+repair)")
    ai_key_id: str | None = Field(default=None, max_length=64)
    ai_key_source: str | None = Field(default=None, description="personal or team")


class TransformRequest(BaseModel):
    mode: str = Field(default="delta", description="delta (relative) or absolute")
    scale: float | list[float] | None = None
    translation: list[float] | None = None
    rotation_deg: list[float] | None = None
    copy: bool = Field(default=False, description="Apply to a duplicate, keep the original file")


class BodyTransformRequest(TransformRequest):
    body_index: int = Field(..., ge=0)
    copy: bool = Field(default=False, description="Body transforms are saved in-place; copy is ignored")


class VisibleAssemblyExportRequest(BaseModel):
    filenames: list[str] = Field(default_factory=list, max_length=200)
    name: str | None = Field(default=None, max_length=120)


class ExtrudeRequest(BaseModel):
    face_index: int | None = None
    at_ref: str | None = None
    distance_mm: float = Field(..., gt=0, le=5000)
    inward: bool = False
    axis: list[float] | None = None


class FacePullRequest(BaseModel):
    """Fusion-style press-pull. Distance is signed, in model units (viewer units)."""

    face_index: int = Field(..., ge=0)
    distance: float = Field(..., description="Signed pull distance in model units")
    normal: list[float] | None = Field(
        default=None,
        description="Optional outward pull direction in mesh-local coords (aligns server normal with the arrow)",
    )
    op: str = Field(default="auto", description="auto | join | cut | intersect | new_body")
    direction: str = Field(default="one", description="one | symmetric | two")
    distance2: float = Field(default=0.0, description="Back-side distance for two-sided pulls")
    taper_deg: float = Field(default=0.0, ge=-60, le=60)
    through_all: bool = False


class DrawHoleRequest(BaseModel):
    face_index: int | None = Field(default=None, ge=0)
    position: list[float] | None = None
    normal: list[float] | None = None
    diameter_mm: float = Field(..., gt=0, le=500)
    depth_mm: float | None = Field(default=None, gt=0, le=500)
    placement: str = Field(default="picked", description="picked | center")
    through_all: bool = True
    pattern_count: int | None = Field(default=None, ge=1, le=100)
    pattern_radius_mm: float | None = Field(default=None, gt=0, le=1000)


class DrawRouteRequest(BaseModel):
    points: list[list[float]] = Field(..., min_length=2)
    surface_normals: list[list[float] | None] | None = None
    surface_locked: bool = True
    route_type: str = Field(default="duct", description="duct | loops")
    diameter_mm: float = Field(default=4.0, gt=0, le=100)
    loop_width_mm: float | None = Field(default=None, gt=0, le=500)
    loop_height_mm: float | None = Field(default=None, gt=0, le=500)
    loop_spacing_mm: float | None = Field(default=None, gt=0, le=1000)


class MirrorMeshRequest(BaseModel):
    plane: str = Field(default="YZ", description="YZ | XZ | XY (origin planes)")
    normal: list[float] | None = None
    origin: list[float] | None = None
    offset: float = Field(default=0.0, description="Plane offset along its normal, model units")
    mode: str = Field(default="join", description="join | keep | replace")


class FilletRequest(BaseModel):
    radius_mm: float = Field(..., gt=0, description="Fillet radius in mm")
    edges: str = Field(default="top", description="top | vertical | bottom | all")


class ChamferRequest(BaseModel):
    length_mm: float = Field(..., gt=0, description="Chamfer distance in mm")
    edges: str = Field(default="top", description="top | vertical | bottom | all")


class MeshCleanupRequest(BaseModel):
    """Topology checkup / cleanup for uploaded mesh files."""

    scope: str = Field(default="auto", description="auto | whole | selection")
    face_indices: list[int] | None = None
    references: list[GeoReference] = Field(default_factory=list)
    apply: bool = Field(default=False, description="When false, report only; when true, write cleaned mesh")
    repair: bool = Field(default=True, description="Remove duplicates/degenerates, merge verts, fill holes, fix normals")
    smooth: bool = Field(default=False, description="Taubin/Laplacian smoothing")
    smooth_method: str = Field(default="taubin", description="taubin | laplacian")
    smooth_iterations: int = Field(default=8, ge=1, le=50)


class RemoveBodyRequest(BaseModel):
    body_index: int = Field(..., ge=0)


class PaintRequest(BaseModel):
    color: str | list[float] = Field(..., description="#RRGGBB, named color, RGB/RGBA 0-1 or 0-255")
    scope: str = Field(default="object", description="object | faces")
    face_indices: list[int] | None = None
    references: list[GeoReference] = Field(default_factory=list)


class SplitBodiesRequest(BaseModel):
    keep_original: bool = Field(default=True, description="Keep source file after splitting into separate body files")


class ProjectRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class FileRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=80)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserAIKeyRequest(BaseModel):
    provider: str = Field("openai", description="openai | anthropic")
    api_key: str | None = Field(None, min_length=20, max_length=512)
    model: str | None = Field(None, max_length=120)
    name: str | None = Field(None, max_length=80)
    source_key_id: str | None = Field(None, max_length=80)


class UserAIKeyRenameRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    model: str | None = Field(None, min_length=1, max_length=120)


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


class WiringSaveRequest(BaseModel):
    components: list[dict[str, Any]] = []
    wires: list[dict[str, Any]] = []
    notes: list[str] = Field(default_factory=list)
    name: str | None = None
    description: str | None = None
    reference_image: str | None = None


class WiringPromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    images: list[PromptImage] = Field(default_factory=list, max_length=4)
    speed: str = "fast"
    ai_key_id: str | None = None
    ai_key_source: str | None = None


class WiringDiagnoseRequest(BaseModel):
    images: list[PromptImage] = Field(..., min_length=1, max_length=4)
    description: str | None = Field(None, max_length=2000)
    include_schematic: bool = True
    speed: str = "fast"
    ai_key_id: str | None = None
    ai_key_source: str | None = None


class RiggingSaveRequest(BaseModel):
    bones: list[dict[str, Any]] = Field(default_factory=list)
    animations: list[dict[str, Any]] = Field(default_factory=list)
    activeAnimationId: str | None = None
    name: str | None = None


class RiggingPromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    images: list[PromptImage] = Field(default_factory=list, max_length=4)
    speed: str = "fast"


class SketchSaveRequest(BaseModel):
    name: str | None = None
    plane: str = "XY"
    plane_ref: dict[str, Any] | None = None
    profile: list[list[float]] = Field(default_factory=list)
    entities: list[dict[str, Any]] = Field(default_factory=list)
    constraints: list[dict[str, Any]] = Field(default_factory=list)


class SketchPromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    images: list[PromptImage] = Field(default_factory=list, max_length=4)
    speed: str = "fast"


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


def _append_mesh_edit(project_path: Path, source_filename: str, edit: dict[str, Any]) -> None:
    """Append a viewport mesh edit to the sidecar program for editable history."""
    import json

    base = Path(source_filename).stem
    for token in ("_edited", "_pulled", "_mirrored", "_extruded", "_body"):
        if base.endswith(token):
            base = base[: -len(token)]
            break
    prog_path = project_path / f"{base}.program.json"
    data: dict[str, Any] = {}
    if prog_path.is_file():
        try:
            data = json.loads(prog_path.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data.setdefault("name", base)
    data.setdefault("units", "mm")
    data.setdefault("parts", data.get("parts") or [])
    data.setdefault("meta", {}).setdefault("mesh_edits", []).append(
        {**edit, "at": datetime.now(timezone.utc).isoformat()}
    )
    prog_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _notify_project(project_id: str, message: dict[str, Any]) -> None:
    hub.notify(project_id, message)


def _notify_workspace(team_id: str, message: dict[str, Any]) -> None:
    for pid in teams_service.team_project_ids(team_id):
        hub.notify(pid, message)


def _notify_user(user_id: str | None, message: dict[str, Any]) -> None:
    if user_id:
        hub.notify_user(user_id, message)


def _notify_user_by_email(email: str, message: dict[str, Any]) -> None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE lower(email)=lower(?)",
            ((email or "").strip(),),
        ).fetchone()
    if row:
        _notify_user(row["id"], message)


def _notify_project_workspace(project_id: str, message: dict[str, Any]) -> None:
    team_id = teams_service.project_team_id(project_id)
    if team_id:
        _notify_workspace(team_id, message)


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


def _daily_ai_usage_for_user(user_id: str, *, shared_key_id: str | None = None) -> dict[str, Any]:
    """Best-effort UTC daily token/cost totals for one user across accessible projects."""
    from backend.services.ai_cost import entry_effective_cost

    today = datetime.now(timezone.utc).date()
    cost_total = 0.0
    token_total = 0
    accessible_projects = teams_service.user_project_access(user_id, None)
    project_ids = {row["project_id"] for row in accessible_projects}
    for project_id in project_ids:
        project_path = PROJECTS / project_id
        if not project_path.is_dir():
            continue
        try:
            entries = prompt_history_service.list_entries(project_path, limit=500)
        except Exception:
            continue
        for entry in entries:
            if entry.get("user_id") != user_id:
                continue
            if shared_key_id:
                if entry.get("shared_key_id") != shared_key_id and not (
                    entry.get("key_source") == "team" and not entry.get("shared_key_id")
                ):
                    continue
            try:
                created = datetime.fromisoformat(str(entry.get("created_at")).replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                if created.astimezone(timezone.utc).date() != today:
                    continue
            except Exception:
                continue
            cost_total += float(entry_effective_cost(entry) or 0)
            usage = entry.get("usage") or {}
            if isinstance(usage, dict):
                token_total += int(usage.get("total_tokens") or usage.get("tokens") or 0)
    return {"cost_usd": round(cost_total, 6), "tokens": token_total}


def _daily_ai_spend_for_user(user_id: str) -> float:
    """Best-effort UTC daily spend for one user across all project histories."""
    return float(_daily_ai_usage_for_user(user_id).get("cost_usd") or 0)


def _ai_status_for_user(user: dict[str, Any]) -> dict[str, Any]:
    status = user_ai_keys_service.status_for_user(user)
    daily_usage = _daily_ai_usage_for_user(user["id"])
    spent_today = float(daily_usage.get("cost_usd") or 0)
    tokens_today = int(daily_usage.get("tokens") or 0)

    effective = status.get("effective")
    if effective:
        effective["spent_today_usd"] = spent_today
        effective["spent_today_tokens"] = tokens_today
        limit = effective.get("daily_limit_usd")
        if limit is not None:
            effective["remaining_today_usd"] = max(0.0, round(float(limit) - spent_today, 6))
        token_limit = effective.get("daily_token_limit")
        if token_limit is not None:
            effective["remaining_today_tokens"] = max(0, int(token_limit) - tokens_today)

    for key in status.get("team_keys") or []:
        key_usage = _daily_ai_usage_for_user(user["id"], shared_key_id=key.get("id"))
        key_spent = float(key_usage.get("cost_usd") or 0)
        key_tokens = int(key_usage.get("tokens") or 0)
        key["spent_today_usd"] = key_spent
        key["spent_today_tokens"] = key_tokens
        limit = key.get("daily_limit_usd")
        if limit is not None:
            key["remaining_today_usd"] = max(0.0, round(float(limit) - key_spent, 6))
        token_limit = key.get("daily_token_limit")
        if token_limit is not None:
            key["remaining_today_tokens"] = max(0, int(token_limit) - key_tokens)

    return status


def _members_with_daily_ai_usage(members: list[dict[str, Any]], key_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for member in members:
        row = dict(member)
        usage = _daily_ai_usage_for_user(str(member.get("user_id") or ""), shared_key_id=key_id)
        row["spent_today_tokens"] = int(usage.get("tokens") or 0)
        row["spent_today_usd"] = float(usage.get("cost_usd") or 0)
        limit = row.get("daily_token_limit")
        if limit is not None:
            row["remaining_today_tokens"] = max(0, int(limit) - row["spent_today_tokens"])
        out.append(row)
    return out


def _get_ai_for_user(
    user: dict[str, Any],
    speed: str = "fast",
    *,
    key_id: str | None = None,
    key_source: str | None = None,
) -> AIService:
    try:
        if key_id:
            effective = user_ai_keys_service.resolve_key_for_user(user["id"], key_id, key_source)
        else:
            effective = user_ai_keys_service.get_effective_key_for_user(user["id"])
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not effective or not effective.get("api_key"):
        raise HTTPException(
            status_code=403,
            detail="Add your OpenAI or Claude API key from the account menu before generating.",
        )
    if effective.get("source") == "team":
        usage_today = _daily_ai_usage_for_user(user["id"], shared_key_id=effective.get("key_id"))
        token_limit = effective.get("daily_token_limit")
        if token_limit is not None and int(usage_today.get("tokens") or 0) >= int(token_limit):
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Daily AI limit reached for shared key \"{effective.get('key_name') or 'Shared key'}\" "
                    f"({int(usage_today.get('tokens') or 0):,} of {int(token_limit):,} tokens)."
                ),
            )
        limit = effective.get("daily_limit_usd")
        if limit is not None and float(usage_today.get("cost_usd") or 0) >= float(limit):
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Daily AI spend limit reached for shared key \"{effective.get('key_name') or 'Shared key'}\" "
                    f"(${float(usage_today.get('cost_usd') or 0):.2f} of ${float(limit):.2f})."
                ),
            )
    try:
        model = (effective.get("model") or "").strip()
        if not model and effective["provider"] == "openai":
            model = settings.openai_model_quality if speed == "quality" else settings.openai_model
        elif not model:
            model = settings.anthropic_model
        return AIService(model=model, api_key=effective["api_key"], provider=effective["provider"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# Standard mounting/footprint data for common off-the-shelf parts. Keyed by
# substrings matched against the component stem/label (lower-cased). Used as a
# hint so the AI sizes pockets/holes/standoffs to real hardware; the measured
# bounding box always takes priority for the body envelope.
_PART_MOUNT_PRESETS: list[dict[str, Any]] = [
    {
        "match": ["28byj", "adafruit_858", "858_stepper", "5vdc_stepper", "5v_stepper"],
        "name": "28BYJ-48 5V geared stepper (Adafruit 858)",
        "body": {"diameter_mm": 28.0, "height_mm": 19.0},
        "shaft": {"diameter_mm": 5.0, "offset_from_center_mm": 8.0, "length_mm": 10.0},
        "mount": {
            "type": "two_tab_bracket",
            "hole_diameter_mm": 4.2,
            "hole_spacing_mm": 35.0,
            "note": "Two M4 holes on a flat tab bracket straddling the round body, 35mm apart, centered on the body axis.",
        },
        "fit": "Cradle the 28mm body in a half-pipe channel or ring clamp; bolt the two bracket tabs to the plate 35mm apart.",
    },
    {
        "match": ["nano", "arduino_nano"],
        "name": "Arduino Nano (incl. R4 / Every form factor)",
        "body": {"length_mm": 45.0, "width_mm": 18.0, "height_mm": 7.0},
        "mount": {
            "type": "four_corner_holes",
            "hole_diameter_mm": 1.8,
            "hole_spacing_mm": [15.24, 43.18],
            "note": "Four corner holes on a 15.24 x 43.18mm rectangular pattern. If using a slot cradle instead, leave a 0.4mm clearance pocket 18.4 x 45.4mm and cut a USB notch on one short end.",
        },
        "fit": "Drop the PCB into a shallow 18.4 x 45.4mm pocket (0.3-0.5mm clearance) with 4 corner standoffs, or 4 corner bosses on the 15.24 x 43.18mm pattern. Leave a USB-C cutout on one short edge.",
    },
    {
        "match": ["nema17", "nema_17", "nema-17"],
        "name": "NEMA 17 stepper",
        "body": {"width_mm": 42.3, "height_mm": 42.3},
        "shaft": {"diameter_mm": 5.0},
        "mount": {
            "type": "four_corner_holes",
            "hole_diameter_mm": 3.0,
            "hole_spacing_mm": 31.0,
            "center_bore_mm": 22.0,
            "note": "Four M3 holes on a 31x31mm square pattern around a 22mm pilot boss.",
        },
        "fit": "Bolt the faceplate to a 31x31mm M3 pattern with a 22mm clearance bore for the shaft collar.",
    },
    {
        "match": ["raspberry", "raspberry_pi", "rpi"],
        "name": "Raspberry Pi single-board computer",
        "body": {"length_mm": 85.0, "width_mm": 56.0, "height_mm": 18.0},
        "mount": {
            "type": "four_corner_holes",
            "hole_diameter_mm": 2.75,
            "hole_spacing_mm": [58.0, 49.0],
            "note": "Four M2.5 holes on a 58 x 49mm pattern. Make a shallow 85.6 x 56.6mm pocket or four standoffs, leaving connector clearance.",
        },
        "fit": "Seat the Pi in a shallow rectangular pocket with 0.4-0.8mm clearance, four M2.5 standoffs on the 58 x 49mm pattern, and open edges for USB/Ethernet/power connectors.",
    },
]


def _mount_preset_for(stem: str, label: str | None) -> dict[str, Any] | None:
    hay = f"{stem} {label or ''}".lower()
    for preset in _PART_MOUNT_PRESETS:
        if any(token in hay for token in preset["match"]):
            return {k: v for k, v in preset.items() if k != "match"}
    return None


def _measure_component_mm(project_path: Path, filename: str | None, stem: str | None) -> dict[str, Any] | None:
    """Best-effort bounding-box (mm) of a referenced component file."""
    candidates: list[Path] = []
    if filename:
        candidates.append(project_path / filename)
    if stem:
        for ext in (".glb", ".step", ".stp", ".stl", ".obj", ".gltf"):
            candidates.append(project_path / f"{stem}{ext}")
    seen: set[Path] = set()
    for path in candidates:
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        try:
            mesh = cad_service.load_mesh(path)
            extents = mesh.extents  # native units
            scale = 1.0 if cad_service.mesh_uses_millimeters(mesh) else 1000.0
            dims = [round(float(e) * scale, 2) for e in extents]
            return {
                "source_file": path.name,
                "size_mm": dims,
                "bbox_min_mm": [round(float(v) * scale, 2) for v in mesh.bounds[0]],
                "bbox_max_mm": [round(float(v) * scale, 2) for v in mesh.bounds[1]],
            }
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("could not measure component %s: %s", path.name, exc)
            continue
    return None


def _measurement_target_file(project_path: Path, filename: str | None) -> str | None:
    if filename:
        safe = Path(filename).name
        if (project_path / safe).is_file():
            return cad_service.resolve_viewport_filename(project_path, safe)
    return project_store.latest_model_file(project_path)


def _measure_model_dimensions(project_path: Path, filename: str | None = None) -> dict[str, Any]:
    target = _measurement_target_file(project_path, filename)
    if not target:
        raise FileNotFoundError("No model file found to measure.")
    path = project_path / target
    if not path.is_file():
        raise FileNotFoundError(f"Model file not found: {target}")
    mesh = cad_service.load_mesh(path)
    scale = 1.0 if cad_service.mesh_uses_millimeters(mesh) else 1000.0
    extents = [float(v) * scale for v in mesh.extents]
    bounds_min = [float(v) * scale for v in mesh.bounds[0]]
    bounds_max = [float(v) * scale for v in mesh.bounds[1]]
    center = [float(v) * scale for v in mesh.bounds.mean(axis=0)]
    dims = {
        "width_mm": round(extents[0], 2),
        "depth_mm": round(extents[1], 2),
        "height_mm": round(extents[2], 2),
    }
    return {
        "filename": target,
        "unit": "mm",
        "dimensions": dims,
        "size_mm": [dims["width_mm"], dims["depth_mm"], dims["height_mm"]],
        "bbox_min_mm": [round(v, 2) for v in bounds_min],
        "bbox_max_mm": [round(v, 2) for v in bounds_max],
        "center_mm": [round(v, 2) for v in center],
        "message": (
            f"{target} measures {dims['width_mm']} mm wide x "
            f"{dims['depth_mm']} mm deep x {dims['height_mm']} mm tall."
        ),
    }


def _is_dimension_question(prompt: str) -> bool:
    text = (prompt or "").strip().lower()
    if not text or len(text) > 240:
        return False
    dimension_terms = (
        "dimension",
        "dimensions",
        "how big",
        "what size",
        "size of",
        "measure",
        "measurements",
        "width",
        "height",
        "depth",
        "length",
        "bounding box",
        "bbox",
    )
    question_terms = ("what", "how", "show", "tell", "give", "list", "?")
    return any(term in text for term in dimension_terms) and any(term in text for term in question_terms)


def _resolve_cross_project_path(comp: dict[str, Any]) -> Path | None:
    """If the component ref carries a source_project_id, return the path to the file there."""
    src_pid = comp.get("source_project_id")
    if not src_pid:
        return None
    src_project = PROJECTS / src_pid
    if not src_project.is_dir():
        return None
    stem = comp.get("stem")
    filename = comp.get("filename")
    if filename:
        p = src_project / Path(filename).name
        if p.is_file():
            return p
    if stem:
        for ext in (".glb", ".step", ".stp", ".stl", ".obj"):
            p = src_project / f"{stem}{ext}"
            if p.is_file():
                return p
    return None


def _import_cross_project_component(
    project_path: Path, comp: dict[str, Any]
) -> bool:
    """Copy a cross-project component file into the current project so the kernel can use it.

    Returns True if a file was copied (or already present), False otherwise.
    No-op when the file already exists in project_path.
    """
    src_file = _resolve_cross_project_path(comp)
    if not src_file:
        return False
    dest = project_path / src_file.name
    if dest.exists():
        return True
    try:
        import shutil
        shutil.copy2(src_file, dest)
        logger.info("Imported cross-project component %s → %s", src_file, dest)
        return True
    except Exception as exc:
        logger.warning("Could not copy cross-project component %s: %s", src_file, exc)
        return False


def _component_specs(project_path: Path, referenced_components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Real, measured geometry + standard mount data for referenced components,
    so the design AI can size cases/mounts to fit and align holes."""
    specs: list[dict[str, Any]] = []
    for comp in referenced_components:
        stem = comp.get("stem") or (Path(comp["filename"]).stem if comp.get("filename") else None)
        if not stem:
            continue
        spec: dict[str, Any] = {"stem": stem, "label": comp.get("label") or stem}
        # Copy cross-project files in so the kernel can access them.
        if comp.get("source_project_id"):
            _import_cross_project_component(project_path, comp)
        measured = _measure_component_mm(project_path, comp.get("filename"), stem)
        if not measured and comp.get("source_project_id"):
            # Try measuring from the source project directly.
            src_file = _resolve_cross_project_path(comp)
            if src_file:
                measured = _measure_component_mm(src_file.parent, src_file.name, stem)
        if measured:
            spec.update(measured)
        try:
            profile = part_profiles_service.get_or_seed(project_path, stem, comp.get("filename"))
            if profile.get("kind"):
                spec["kind"] = profile["kind"]
            if profile.get("stats"):
                spec["catalog_stats"] = profile["stats"]
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("profile lookup failed for %s: %s", stem, exc)
        preset = _mount_preset_for(stem, comp.get("label"))
        if preset:
            spec["standard_mount"] = preset
        if not spec.get("size_mm") and preset:
            body = preset.get("body") or {}

            def _dim(key: str) -> float:
                try:
                    return float(body.get(key) or 0)
                except (TypeError, ValueError):
                    return 0.0

            dims = [
                _dim("length_mm") or _dim("width_mm") or _dim("diameter_mm"),
                _dim("width_mm") or _dim("height_mm") or _dim("diameter_mm"),
                _dim("height_mm") or _dim("length_mm"),
            ]
            dims = [d for d in dims if d > 0]
            if len(dims) >= 2:
                dims.sort(reverse=True)
                while len(dims) < 3:
                    dims.append(dims[-1])
                spec["size_mm"] = [round(d, 2) for d in dims[:3]]
        specs.append(spec)
    return specs


def _resolve_component_file(project_path: Path, stem: str) -> Path | None:
    for ext in (".glb", ".gltf", ".step", ".stp", ".stl", ".obj"):
        p = project_path / f"{stem}{ext}"
        if p.is_file():
            return p
    return None


def _match_placement_stem(raw_stem: str | None, referenced_components: list[dict[str, Any]]) -> str | None:
    if not raw_stem:
        return None
    raw = str(raw_stem).lower().replace("-", "_").replace(" ", "_")
    known: list[tuple[str, str]] = []
    for comp in referenced_components:
        stem = comp.get("stem") or (Path(comp["filename"]).stem if comp.get("filename") else None)
        if not stem:
            continue
        label = str(comp.get("label") or "")
        hay = f"{stem} {label}".lower().replace("-", "_").replace(" ", "_")
        known.append((stem, hay))
    for stem, hay in known:
        if raw == stem.lower() or raw in hay or stem.lower() in raw:
            return stem
    if "nema" in raw and "17" in raw:
        for stem, hay in known:
            if "nema" in hay and "17" in hay:
                return stem
    if "raspberry" in raw or raw in {"pi", "rpi"}:
        for stem, hay in known:
            if "raspberry" in hay or "rpi" in hay:
                return stem
    if "arduino" in raw or "nano" in raw:
        for stem, hay in known:
            if "arduino" in hay or "nano" in hay:
                return stem
    return None


_FIXTURE_PROMPT_WORDS = (
    "case", "casing", "enclosure", "mount", "holder", "hold the", "bracket",
    "cradle", "fixture", "tray", "stand", "housing", "chassis", "base plate",
    "baseplate", "breadboard", "slab", "test plate", "testing plate",
    "testing slab", "mount plate", "plate for", "mounting plate",
    "raspberry pi", " rpi", " pi ", "sbc", "pcb", "board pocket",
    "motor mount", "stepper mount", "nema", "standoff", "standoffs",
    "box", "open top", "no lid", "lidless", "test bench", "test fixture",
)


def _looks_like_fixture_prompt(prompt: str | None) -> bool:
    p = f" {prompt or ''} ".lower()
    return any(word in p for word in _FIXTURE_PROMPT_WORDS)


def _should_use_kernel_pipeline(body: PromptRequest, project_path: Path | None = None) -> bool:
    """Route to the parametric kernel instead of legacy mesh-edit actions."""
    if (body.mode or "standard").lower() == "v2":
        return True
    if _looks_like_fixture_prompt(body.prompt):
        return True
    if not body.base_filename:
        return True
    return _is_fresh_design_request(body)


def _is_existing_fixture_artifact(project_path: Path, comp: dict[str, Any]) -> bool:
    stem = comp.get("stem") or Path(comp.get("name") or "").stem
    if not stem:
        return False
    lowered = str(stem).lower()
    generated_tokens = (
        "component_mounting_fixture",
        "fixture_base",
        "mount_plate",
        "mounting_plate",
        "base_plate",
        "test_fixture",
        "testing_slab",
        "testing_plate",
    )
    if lowered in {"component_mounting_fixture", "fixture_base"} or any(token in lowered for token in generated_tokens):
        return True
    prog = project_path / f"{stem}.program.json"
    if not prog.is_file():
        return False
    try:
        data = json.loads(prog.read_text(encoding="utf-8"))
    except Exception:
        return False
    if data.get("name") == "component_mounting_fixture":
        return True
    text = json.dumps(data.get("meta") or {}) + json.dumps(data.get("parts") or [])[:4000]
    return "component_fixture" in text


def _project_component_refs_for_fixture(project_path: Path) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for comp in cad_service.list_browser_tree(project_path).get("components") or []:
        if _is_existing_fixture_artifact(project_path, comp):
            continue
        name = comp.get("name")
        if not name:
            continue
        refs.append({
            "filename": name,
            "stem": comp.get("stem") or Path(name).stem,
            "label": comp.get("label") or comp.get("stem") or Path(name).stem,
        })
    return refs


def _apply_part_placements(
    project_path: Path,
    project_id: str,
    placements: list[dict[str, Any]],
    referenced_components: list[dict[str, Any]],
    user: dict[str, Any],
) -> list[dict[str, Any]]:
    """Move referenced component files into the mounts of the just-built case.
    Best-effort and non-fatal: a bad placement never blocks the generated model."""
    if not placements:
        return []
    applied: list[dict[str, Any]] = []
    for pl in placements:
        try:
            stem = _match_placement_stem(pl.get("stem"), referenced_components)
            if not stem:
                continue
            src = _resolve_component_file(project_path, stem)
            if not src:
                continue
            mesh = cad_service.load_mesh(src)
            mount = pl.get("mount")
            if mount in ("motor_flange", "board_pocket") and pl.get("surface_z") is not None:
                placed = cad_service.seat_component_mesh(
                    mesh,
                    mount=mount,
                    cx=float(pl.get("cx", 0.0)),
                    cy=float(pl.get("cy", 0.0)),
                    surface_z=float(pl["surface_z"]),
                )
            else:
                placed = cad_service.place_absolute(
                    mesh,
                    translation_mm=pl.get("translation_mm"),
                    rotation_deg=pl.get("rotation_deg"),
                )
            out = src.with_suffix(".glb")
            cad_service.export_mesh(placed, out)
            meta = {
                "op": "placement",
                "translation_mm": pl.get("translation_mm"),
                "rotation_deg": pl.get("rotation_deg"),
                "mount": pl.get("mount"),
            }
            entry = _record_history(
                project_path, "transform", f"Placed {stem} in mount", out.name, meta=meta, user=user
            )
            applied.append({"stem": stem, "filename": out.name, "timeline_index": entry["index"], **meta})
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("part placement failed for %s: %s", pl.get("stem"), exc)
            continue
    return applied


def _slim_context(project_id: str, project_path: Path, body: PromptRequest) -> dict[str, Any]:
    files = cad_service.list_project_files(project_path)
    refs = []
    for r in body.references:
        ref: dict[str, Any] = {"id": r.id, "type": r.type}
        if r.face_index is not None:
            ref["face_index"] = r.face_index
        if r.face_indices:
            ref["face_indices"] = r.face_indices[:400]
        if r.selected_vertices:
            ref["selected_vertices"] = r.selected_vertices[:400]
        if r.loop_points:
            ref["loop_points"] = r.loop_points[:120]
        if r.surface_normals:
            ref["surface_normals"] = r.surface_normals[:120]
        if r.surface_locked is not None:
            ref["surface_locked"] = r.surface_locked
        if r.endpoints:
            ref["endpoints"] = r.endpoints[:2]
        if r.position is not None:
            ref["position"] = r.position
        if r.normal is not None:
            ref["normal"] = r.normal
        if r.type == "component" or r.filename:
            ref["filename"] = r.filename
            ref["stem"] = r.stem
            if r.label:
                ref["label"] = r.label
        elif r.label:
            ref["label"] = r.label
        refs.append(ref)
    referenced_components = []
    for r in body.references:
        if not (r.type == "component" or r.filename):
            continue
        comp: dict[str, Any] = {"filename": r.filename, "stem": r.stem, "label": r.label}
        if r.projectId and r.projectId != project_id:
            comp["source_project_id"] = r.projectId
        referenced_components.append(comp)
    if not referenced_components and _looks_like_fixture_prompt(body.prompt):
        referenced_components = _project_component_refs_for_fixture(project_path)
        if referenced_components:
            trace_add(
                "info",
                f"Using {len(referenced_components)} project component(s) as fixture references",
                trace_id=getattr(body, "trace_id", None),
            )
    component_specs = _component_specs(project_path, referenced_components)
    return {
        "project_id": project_id,
        "file_count": len(files),
        "file_names": [f["name"] for f in files][:10],
        "base": body.base_filename,
        "refs": refs,
        "referenced_components": referenced_components,
        "component_specs": component_specs,
        "image_refs": [
            {"id": img.id, "name": img.name, "media_type": img.media_type}
            for img in body.images[:4]
        ],
    }


def _is_fresh_design_request(body: PromptRequest) -> bool:
    """Route to the parametric kernel (full rebuild) instead of legacy mesh-edit actions."""
    if body.references:
        return False
    prompt = body.prompt.strip().lower()

    # Localized edits on the loaded mesh — stay on legacy actions path.
    edit_signals = (
        "@face",
        "@lasso",
        "@corner",
        "@edge",
        "use_base",
        "paint ",
        "this face",
        "this @",
        "at @",
        "on @",
        "in @",
        "existing mesh",
        "existing part",
        "current mesh",
    )
    if any(s in prompt for s in edit_signals):
        return False

    regen_keywords = (
        "regenerate",
        "rebuild",
        "from scratch",
        "start over",
        "clean parametric",
        "full regen",
        "replace the model",
        "replace this model",
        "new l-bracket",
        "new bracket",
    )
    if any(k in prompt for k in regen_keywords):
        return True

    # CAD skill + parametric deliverables implies kernel rebuild, not mesh patch.
    if ("cad skill" in prompt or "@skill:cad" in prompt) and any(
        w in prompt for w in ("step", "parametric", "watertight", "build123d", "b-rep", "brep", "regenerat", "rebuild")
    ):
        return True

    generative = (
        "make ",
        "create ",
        "generate ",
        "design ",
        "build ",
        "turn ",
        "convert ",
        "model ",
    )
    object_request = any(prompt.startswith(word) or f" {word}" in prompt for word in generative)
    image_based = bool(body.images) and any(
        word in prompt for word in ("image", "photo", "picture", "reference", "schematic", "sketch")
    )
    if image_based and object_request:
        return True

    # Fresh part spec with no localized edit refs (e.g. "create an L-bracket 80x40x5").
    if object_request and any(w in prompt for w in ("step", "stl", " watertight", "single solid")):
        return True

    return False


def _is_appliance_toolhead_swap(body: PromptRequest, project_path: Path) -> bool:
    """Whisk/paddle swaps on the cooking appliance should use parametric rebuild, not mesh booleans."""
    if not cad_service.is_cooking_appliance_project(project_path):
        return False
    p = body.prompt.strip().lower()
    tool = any(
        w in p
        for w in (
            "whisk",
            "paddle",
            "beater",
            "balloon whisk",
            "mixing paddle",
            "agitator",
            "toolhead",
            "tool head",
        )
    )
    change = any(
        w in p
        for w in (
            "change",
            "replace",
            "swap",
            "convert",
            "make this",
            "turn this",
            "to a",
            "into a",
        )
    )
    return tool and change


def _rebuild_cooking_appliance_toolhead(
    project_id: str,
    body: PromptRequest,
    trace_id: str,
    user: dict[str, Any],
    project_path: Path,
) -> dict[str, Any]:
    """Deterministic parametric rebuild — reliable whisk/paddle geometry."""
    from backend.engineering.appliances import automated_cooking_appliance_program
    from backend.services import kernel_bridge

    refs_list = [r.model_dump() for r in body.references]
    timer = TraceTimer("Appliance toolhead rebuild", trace_id)
    try:
        program = automated_cooking_appliance_program()
        result = kernel_bridge.build_and_export(program, project_path, basename="automated_cooking_appliance")
        timer.done(parts=len(result.get("parts") or []))
    except Exception as exc:
        timer.done(error=str(exc))
        trace_add("error", f"Appliance rebuild failed: {exc}", trace_id=trace_id)
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
        raise HTTPException(422, f"Appliance rebuild failed: {exc}") from exc

    primary = result["primary"]
    whisk_swap = _is_appliance_toolhead_swap(body, project_path)
    message = (
        "Rebuilt the cooking appliance with a parametric balloon-whisk toolhead on the mixing shaft. "
        "Mesh boolean edits on the full assembly are unreliable, so the model was regenerated instead."
        if whisk_swap
        else result.get("program", {}).get("description") or "Model rebuilt."
    )
    label = "AI: " + (body.prompt[:48] + "…" if len(body.prompt) > 48 else body.prompt)
    entry = _record_history(
        project_path,
        "prompt",
        label,
        primary,
        meta={
            "program": result.get("program"),
            "files": result.get("files"),
            "intent": "toolhead_rebuild",
            "prompt": body.prompt,
            "message": message,
            "speed": body.speed,
            "base_filename": body.base_filename,
            "references": refs_list,
            "trace_id": trace_id,
        },
        user=user,
    )
    hist_entry = _save_prompt_history(
        project_path,
        prompt=body.prompt,
        success=True,
        body=body,
        refs_list=refs_list,
        trace_id=trace_id,
        user=user,
        message=message,
        filename=primary,
    )
    project_store.touch_project(project_path, name=result.get("program", {}).get("name"))
    trace_add("info", f"Appliance toolhead rebuild → {primary}", trace_id=trace_id)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "prompt",
            "timeline_entry": entry,
        },
    )
    return {
        "message": message,
        "filename": primary,
        "url": f"/api/projects/{project_id}/files/{primary}",
        "files": {k: f"/api/projects/{project_id}/files/{v}" for k, v in result.get("files", {}).items()},
        "intent": "toolhead_rebuild",
        "timeline_index": entry["index"],
        "trace_id": trace_id,
        "prompt_id": hist_entry.get("id") if hist_entry else None,
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


@app.get("/api/skills")
def list_skills():
    return skills_service.skills_manifest()


@app.get("/api/skills/{skill_id}")
def get_skill(skill_id: str, full: bool = False):
    skill = skills_service.get_skill(skill_id, include_references=full)
    if not skill:
        raise HTTPException(404, f"Skill '{skill_id}' not found")
    return skill


@app.get("/api/skills/{skill_id}/references/{ref_name}")
def get_skill_reference(skill_id: str, ref_name: str):
    ref = skills_service.get_reference(skill_id, ref_name)
    if not ref:
        raise HTTPException(404, f"Reference '{ref_name}' not found for skill '{skill_id}'")
    return ref


@app.get("/api/skills/{skill_id}/tools")
def list_skill_tools(skill_id: str):
    from backend.services import skill_runner

    if not skills_service.get_skill_dir(skill_id):
        raise HTTPException(404, f"Skill '{skill_id}' not found")
    return {"skill_id": skill_id, "tools": skill_runner.list_skill_tools(skill_id)}


@app.post("/api/auth/register")
def register(body: RegisterRequest):
    try:
        user = teams_service.create_user(body.email, body.password, body.display_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    token = create_access_token(user["id"])
    teams = teams_service.list_teams(user["id"])
    return {"token": token, "user": user, "teams": teams, "ai": _ai_status_for_user(user)}


@app.post("/api/auth/login")
def login(body: LoginRequest):
    user = teams_service.authenticate(body.email, body.password)
    if not user:
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(user["id"])
    teams = teams_service.list_teams(user["id"])
    return {"token": token, "user": user, "teams": teams, "ai": _ai_status_for_user(user)}


@app.get("/api/auth/me")
def auth_me(user: dict[str, Any] = Depends(get_current_user)):
    return {"user": user, "teams": teams_service.list_teams(user["id"]), "ai": _ai_status_for_user(user)}


# ── Onshape OAuth ─────────────────────────────────────────────────────────────

@app.get("/oauth/start")
def onshape_oauth_start(
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    """Redirect the browser to Onshape's authorization page."""
    from backend.services.onshape_oauth import build_authorization_url
    url = build_authorization_url(user_id=user["id"] if user else None)
    return RedirectResponse(url, status_code=302)


@app.get("/oauth/callback")
def onshape_oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    """Onshape redirects here after the user authorizes.
    Exchange the code for tokens, upsert the local user, issue our JWT,
    then redirect to the frontend with the token in the query string.
    """
    from backend.services.onshape_oauth import consume_oauth_state, exchange_code_for_tokens, upsert_user_tokens
    from backend.auth import create_access_token

    if error:
        return RedirectResponse(f"/?onshape_error={error}", status_code=302)

    if not code or not state:
        return RedirectResponse("/?onshape_error=missing_params", status_code=302)

    # CSRF check
    stored_user_id = consume_oauth_state(state)
    if stored_user_id is False:  # unknown / expired state
        return RedirectResponse("/?onshape_error=invalid_state", status_code=302)

    try:
        token_data = exchange_code_for_tokens(code)
        result     = upsert_user_tokens(token_data)
        jwt        = create_access_token(result["user_id"])
    except Exception as exc:
        return RedirectResponse(f"/?onshape_error={str(exc)[:80]}", status_code=302)

    # Redirect to the app; the frontend picks up ?token= and stores it
    return RedirectResponse(f"/?onshape_token={jwt}", status_code=302)


@app.get("/api/onshape/status")
def onshape_status(user: dict[str, Any] = Depends(get_current_user)):
    """Return whether this user has linked their Onshape account."""
    from backend.database import get_conn
    with get_conn() as conn:
        row = conn.execute(
            "SELECT onshape_email, expires_at FROM onshape_tokens WHERE user_id = ?",
            (user["id"],),
        ).fetchone()
    if not row:
        return {"linked": False}
    return {"linked": True, "onshape_email": row["onshape_email"], "expires_at": row["expires_at"]}


@app.delete("/api/onshape/unlink")
def onshape_unlink(user: dict[str, Any] = Depends(get_current_user)):
    """Remove stored Onshape tokens for this user."""
    from backend.database import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM onshape_tokens WHERE user_id = ?", (user["id"],))
    return {"ok": True}


@app.get("/api/onshape/documents")
def onshape_list_documents(
    limit: int = 20,
    offset: int = 0,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services.onshape_oauth import get_valid_access_token, list_documents
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Onshape account not linked.")
    try:
        docs = list_documents(token, limit=min(limit, 20), offset=offset)
    except Exception as exc:
        raise HTTPException(502, f"Onshape error: {exc}") from exc
    return {"documents": docs}


@app.get("/api/onshape/documents/{did}/elements")
def onshape_list_elements(
    did: str,
    wid: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services.onshape_oauth import get_valid_access_token, list_elements
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Onshape account not linked.")
    try:
        elements = list_elements(token, did, wid)
    except Exception as exc:
        raise HTTPException(502, f"Onshape error: {exc}") from exc
    return {"elements": elements}


@app.post("/api/onshape/import")
def onshape_import_element(
    body: dict = Body(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Download an Onshape element as STEP, convert to GLB, create a local project."""
    import uuid
    from backend.services.onshape_oauth import (
        get_valid_access_token, download_element_as_step
    )
    from backend.services import cad_service

    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Onshape account not linked.")

    did  = body.get("document_id", "")
    wid  = body.get("workspace_id", "")
    eid  = body.get("element_id", "")
    etype = body.get("element_type", "PARTSTUDIO")
    name = (body.get("name") or "onshape_import").strip()
    # Sanitise to a safe filename stem
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name).strip().replace(" ", "_").lower()
    if not safe_name:
        safe_name = "onshape_import"

    if not (did and wid and eid):
        raise HTTPException(422, "document_id, workspace_id and element_id are required.")

    # Download STEP
    try:
        step_bytes = download_element_as_step(token, did, wid, eid, etype)
    except Exception as exc:
        raise HTTPException(502, f"Could not download from Onshape: {exc}") from exc

    # Create project (same logic as /api/projects)
    teams = teams_service.list_teams(user["id"])
    if not teams:
        raise HTTPException(400, "No workspace available — create one first.")
    tid = teams[0]["id"]
    project_id = str(uuid.uuid4())[:8]
    proj_path = cad_service.project_dir(PROJECTS, project_id)
    project_store.touch_project(proj_path, name=name, name_source="user")
    teams_service.register_project_access(project_id, tid, user["id"])

    # Tag project with Onshape source so we can push edits back later
    meta = project_store.load_meta(proj_path)
    meta["onshape_source"] = {
        "document_id":   did,
        "workspace_id":  wid,
        "element_id":    eid,
        "element_type":  etype,
        "document_name": body.get("document_name", ""),
        "element_name":  name,
    }
    project_store.save_meta(proj_path, meta)

    step_path = proj_path / f"{safe_name}.step"
    step_path.write_bytes(step_bytes)

    # Convert STEP → GLB using existing pipeline
    try:
        glb_path = cad_service.tessellate_step_to_glb(step_path)
    except Exception as exc:
        raise HTTPException(422, f"Could not convert STEP to GLB: {exc}") from exc

    # Record import in activity log
    try:
        from backend.services.workspace_log_service import append_event
        append_event(tid, user["id"], "onshape_import", {"name": name, "project_id": project_id})
    except Exception:
        pass

    return {
        "project_id":    project_id,
        "filename":      glb_path.name,
        "step_file":     step_path.name,
        "name":          name,
        "onshape_source": meta["onshape_source"],
    }


@app.get("/api/user/ai-key/status")
def get_user_ai_key_status(user: dict[str, Any] = Depends(get_current_user)):
    return {"ai": _ai_status_for_user(user)}


@app.post("/api/user/ai-key")
@app.put("/api/user/ai-key")
def set_user_ai_key(body: UserAIKeyRequest, user: dict[str, Any] = Depends(get_current_user)):
    if not body.api_key:
        raise HTTPException(400, "API key is required")
    try:
        status = user_ai_keys_service.add_key(
            user["id"], body.provider, body.api_key,
            model=body.model, name=body.name, activate=True,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ai": _ai_status_for_user(user)}


@app.delete("/api/user/ai-key")
def clear_user_ai_key(user: dict[str, Any] = Depends(get_current_user)):
    user_ai_keys_service.clear_user_key(user["id"])
    return {"ai": _ai_status_for_user(user)}


# ── Multi-key library endpoints ───────────────────────────────────────────────

@app.get("/api/user/ai-keys")
def list_user_ai_keys(user: dict[str, Any] = Depends(get_current_user)):
    return {"keys": user_ai_keys_service.list_keys(user["id"]), "ai": _ai_status_for_user(user)}


@app.post("/api/user/ai-keys")
def add_user_ai_key(body: UserAIKeyRequest, user: dict[str, Any] = Depends(get_current_user)):
    if not body.api_key:
        raise HTTPException(400, "API key is required")
    try:
        status = user_ai_keys_service.add_key(
            user["id"], body.provider, body.api_key,
            model=body.model, name=body.name, activate=True,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ai": _ai_status_for_user(user)}


@app.delete("/api/user/ai-keys/{key_id}")
def delete_user_ai_key(key_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        status = user_ai_keys_service.delete_key(user["id"], key_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ai": _ai_status_for_user(user)}


@app.put("/api/user/ai-keys/{key_id}/activate")
def activate_user_ai_key(key_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        status = user_ai_keys_service.activate_key(user["id"], key_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ai": _ai_status_for_user(user)}


@app.patch("/api/user/ai-keys/{key_id}")
def update_user_ai_key(key_id: str, body: UserAIKeyRenameRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        status = user_ai_keys_service.update_key(user["id"], key_id, name=body.name, model=body.model)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ai": _ai_status_for_user(user)}


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


@app.get("/api/teams/{team_id}/management")
def team_management(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return teams_service.team_management_summary(team_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc


@app.post("/api/teams/{team_id}/members")
def add_team_member(team_id: str, body: TeamInviteRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return teams_service.add_registered_user_to_team(team_id, body.email, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/teams/{team_id}/members/{target_user_id}")
def remove_team_member(team_id: str, target_user_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return teams_service.remove_team_member(team_id, target_user_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.delete("/api/teams/{team_id}/leave")
def leave_team(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        return teams_service.leave_team(team_id, user["id"])
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/teams/{team_id}/invite")
def invite_to_team(team_id: str, body: TeamInviteRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        result = teams_service.invite_user_to_team(team_id, body.email, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    _notify_workspace(
        team_id,
        {
            "type": "workspace.invite.updated",
            "team_id": team_id,
            "email": body.email.strip().lower(),
            "status": result.get("status"),
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    _notify_user_by_email(
        body.email,
        {
            "type": "team.invite.created",
            "team_id": team_id,
            "invite_id": result.get("invite_id"),
            "email": body.email.strip().lower(),
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    return result


@app.get("/api/teams/invites/pending")
def pending_team_invites(user: dict[str, Any] = Depends(get_current_user)):
    return {"invites": teams_service.list_pending_invites(user["email"])}


@app.post("/api/teams/invites/{invite_id}/accept")
def accept_team_invite(invite_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        result = teams_service.accept_team_invite(invite_id, user["id"], user["email"])
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    team = result.get("team") or {}
    team_id = team.get("id")
    if team_id:
        _notify_workspace(
            team_id,
            {
                "type": "workspace.member.updated",
                "team_id": team_id,
                "action": "invite.accepted",
                "by": user["display_name"],
                "by_user_id": user["id"],
            },
        )
    _notify_user(user["id"], {"type": "team.invites.changed"})
    return result


@app.post("/api/teams/invites/{invite_id}/decline")
def decline_team_invite(invite_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        result = teams_service.decline_team_invite(invite_id, user["email"])
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    _notify_user(user["id"], {"type": "team.invites.changed"})
    return result


@app.get("/api/teams/{team_id}/ai-keys")
def list_team_ai_keys(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        keys = user_ai_keys_service.list_team_shared_keys(team_id, user["id"])
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"team_keys": keys}


@app.post("/api/teams/{team_id}/ai-keys")
def add_team_ai_key(team_id: str, body: UserAIKeyRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        if body.source_key_id:
            keys = user_ai_keys_service.add_team_shared_key_from_user_key(
                team_id, user["id"], body.source_key_id, model=body.model, name=body.name
            )
        else:
            if not body.api_key:
                raise ValueError("API key is required")
            keys = user_ai_keys_service.add_team_shared_key(
                team_id, user["id"], body.provider, body.api_key,
                model=body.model, name=body.name,
            )
    except (ValueError, PermissionError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"team_keys": keys, "ai": _ai_status_for_user(user)}


@app.delete("/api/teams/{team_id}/ai-keys/{key_id}")
def delete_team_ai_key(team_id: str, key_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        user_ai_keys_service.delete_team_shared_key(team_id, key_id, user["id"])
    except (ValueError, PermissionError) as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"ok": True}


@app.put("/api/teams/{team_id}/ai-keys/{key_id}/toggle")
def toggle_team_ai_key(team_id: str, key_id: str, body: dict = Body({}), user: dict[str, Any] = Depends(get_current_user)):
    use = bool(body.get("use_key", True))
    user_ai_keys_service.toggle_team_key(user["id"], key_id, use, model=body.get("model"))
    return {"ai": _ai_status_for_user(user)}


@app.get("/api/teams/{team_id}/ai-keys/{key_id}/members")
def list_team_key_members(team_id: str, key_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        members = user_ai_keys_service.list_team_key_members(team_id, key_id, user["id"])
    except (ValueError, PermissionError) as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"members": _members_with_daily_ai_usage(members, key_id)}


@app.put("/api/teams/{team_id}/ai-keys/{key_id}/members/{target_user_id}")
def set_team_key_member_access(
    team_id: str, key_id: str, target_user_id: str,
    body: dict = Body({}),
    user: dict[str, Any] = Depends(get_current_user),
):
    granted = bool(body["granted"]) if "granted" in body else None
    use_key = bool(body["use_key"]) if "use_key" in body else None
    model = body.get("model")
    daily_limit_provided = "daily_limit_usd" in body
    daily_limit_usd = body.get("daily_limit_usd")
    daily_token_limit_provided = "daily_token_limit" in body
    daily_token_limit = body.get("daily_token_limit")
    if daily_limit_usd in ("", None):
        daily_limit_usd = None
    elif daily_limit_provided:
        try:
            daily_limit_usd = float(daily_limit_usd)
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "Daily limit must be a number") from exc
        if daily_limit_usd < 0:
            raise HTTPException(400, "Daily limit cannot be negative")
    if daily_token_limit in ("", None):
        daily_token_limit = None
    elif daily_token_limit_provided:
        try:
            daily_token_limit = int(daily_token_limit)
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "Daily token limit must be a whole number") from exc
        if daily_token_limit < 0:
            raise HTTPException(400, "Daily token limit cannot be negative")
    try:
        members = user_ai_keys_service.set_team_key_member_access(
            team_id,
            key_id,
            target_user_id,
            granted,
            user["id"],
            use_key=use_key,
            model=model,
            daily_limit_usd=daily_limit_usd,
            daily_limit_provided=daily_limit_provided,
            daily_token_limit=daily_token_limit,
            daily_token_limit_provided=daily_token_limit_provided,
        )
    except (ValueError, PermissionError) as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"members": _members_with_daily_ai_usage(members, key_id)}


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
    if name:
        meta = project_store.touch_project(path, name=name, name_source="user")
    else:
        meta = project_store.touch_project(path, name=f"Project {project_id}")
    teams_service.register_project_access(project_id, tid, user["id"])
    _notify_workspace(
        tid,
        {
            "type": "project.created",
            "project_id": project_id,
            "team_id": tid,
            "name": meta.get("name"),
            "meta": meta,
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
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
    _notify_project(project_id, {"type": "project.meta", "project_id": project_id, "name": meta["name"], "meta": meta})
    _notify_project_workspace(
        project_id,
        {
            "type": "project.renamed",
            "project_id": project_id,
            "name": meta["name"],
            "old_name": old_name,
            "meta": meta,
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    _notify_project_history(project_id, log_entry, user)
    return {"project_id": project_id, "name": meta["name"], "meta": meta}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    team_id = teams_service.project_team_id(project_id)
    generation_service.cancel_project(path)
    shutil.rmtree(path)
    teams_service.delete_project_access(project_id)
    _notify_project(project_id, {"type": "project.deleted", "project_id": project_id})
    if team_id:
        _notify_workspace(
            team_id,
            {
                "type": "project.deleted",
                "project_id": project_id,
                "team_id": team_id,
                "by": user["display_name"],
                "by_user_id": user["id"],
            },
        )
    return {"deleted": project_id}


@app.get("/api/projects/{project_id}/prompt-history")
def get_prompt_history(
    project_id: str,
    limit: int = Query(80, ge=1, le=200),
    base_filename: str | None = Query(None),
    kind: str | None = Query(None, description="Filter by prompt kind: cad or wiring"),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    entries = prompt_history_service.list_entries(
        path, limit=limit, base_filename=base_filename, kind=kind
    )
    return {
        "entries": entries,
        "usage_summary": prompt_history_service.project_usage_summary(path),
        "filtered_usage_summary": (
            prompt_history_service.project_usage_summary(path, kind=kind) if kind else None
        ),
    }


@app.get("/api/user/ai-usage")
def get_workspace_ai_usage(
    user: dict[str, Any] = Depends(get_current_user),
    team_id: str | None = Query(None),
    kind: str | None = Query(None, description="Filter by prompt kind: cad, wiring, rigging, sketch"),
    month: str | None = Query(None, description="Calendar month YYYY-MM (default: current UTC month)"),
):
    """Estimated API spend across projects for the signed-in user (monthly by default)."""
    from backend.services.ai_cost import parse_month_param

    try:
        year, mon = parse_month_param(month)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    teams_service.migrate_orphan_projects(PROJECTS)
    if team_id:
        teams = teams_service.list_teams(user["id"])
        if team_id not in {t["id"] for t in teams}:
            raise HTTPException(403, "Not a member of that workspace")
    access = teams_service.user_project_access(user["id"], team_id)
    paths = [PROJECTS / row["project_id"] for row in access if (PROJECTS / row["project_id"]).is_dir()]
    return prompt_history_service.workspace_usage_summary(
        paths, kind=kind, year=year, month=mon
    )


@app.get("/api/user/ai-costs")
def get_user_ai_costs(
    user: dict[str, Any] = Depends(get_current_user),
    days: int = Query(30, ge=7, le=365),
):
    """Personal and shared-key AI spend over time.

    Historical prompt rows do not store the exact shared key id, so shared spend is
    attributed to users who are currently granted and using a key owned by this user.
    """
    from backend.services.ai_cost import entry_effective_cost

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).date()
    series_days = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    mine_by_day = {day: 0.0 for day in series_days}
    shared_by_day = {day: 0.0 for day in series_days}
    total_by_day = {day: 0.0 for day in series_days}

    with get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT tm.user_id, u.display_name, u.email,
                      k.id AS key_id, k.name AS key_name, k.provider,
                      opt.daily_limit_usd AS daily_limit_usd
               FROM team_shared_ai_keys k
               JOIN team_members tm ON tm.team_id = k.team_id
               JOIN users u ON u.id = tm.user_id
               LEFT JOIN team_key_grants g ON g.key_id = k.id AND g.user_id = tm.user_id
               LEFT JOIN user_team_key_opts opt ON opt.key_id = k.id AND opt.user_id = tm.user_id
               WHERE k.shared_by = ?
                 AND k.enabled = 1
                 AND tm.user_id != ?
                 AND COALESCE(g.granted, 1) = 1
               ORDER BY u.display_name, u.email, k.created_at""",
            (user["id"], user["id"]),
        ).fetchall()

    shared_users: dict[str, dict[str, Any]] = {}
    for row in rows:
        uid = row["user_id"]
        item = shared_users.setdefault(
            uid,
            {
                "user_id": uid,
                "display_name": row["display_name"] or row["email"] or "Team member",
                "email": row["email"],
                "total_cost_usd": 0.0,
                "window_cost_usd": 0.0,
                "prompt_count": 0,
                "tracked_count": 0,
                "keys": [],
                "daily": {day: 0.0 for day in series_days},
            },
        )
        item["keys"].append(
            {
                "key_id": row["key_id"],
                "name": row["key_name"],
                "provider": row["provider"],
                "daily_limit_usd": row["daily_limit_usd"],
            }
        )

    shared_user_ids = set(shared_users.keys())
    mine_total = 0.0
    mine_window = 0.0
    shared_total = 0.0
    shared_window = 0.0
    prompt_count = 0
    tracked_count = 0
    projects_scanned = 0
    project_breakdown: dict[str, dict[str, Any]] = {}
    recent_prompts: list[dict[str, Any]] = []

    def _entry_usage_tokens(entry: dict[str, Any]) -> dict[str, int]:
        usage = entry.get("usage") or {}
        if not isinstance(usage, dict):
            return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or usage.get("tokens") or (input_tokens + output_tokens) or 0)
        return {"input_tokens": input_tokens, "output_tokens": output_tokens, "total_tokens": total_tokens}

    for project_path in PROJECTS.iterdir() if PROJECTS.is_dir() else []:
        if not project_path.is_dir():
            continue
        projects_scanned += 1
        try:
            project_name = project_store.load_meta(project_path).get("name") or project_path.name
        except Exception:
            project_name = project_path.name
        project_item = project_breakdown.setdefault(
            project_path.name,
            {
                "project_id": project_path.name,
                "name": project_name,
                "total_cost_usd": 0.0,
                "window_cost_usd": 0.0,
                "mine_window_usd": 0.0,
                "shared_window_usd": 0.0,
                "prompt_count": 0,
                "tracked_count": 0,
                "ai_calls": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "users": {},
            },
        )
        try:
            entries = prompt_history_service.list_entries(project_path, limit=200)
        except Exception:
            continue
        for entry in entries:
            entry_user_id = entry.get("user_id")
            is_shared_entry = (
                entry_user_id in shared_user_ids
                and (
                    entry.get("key_source") == "team"
                    or entry.get("shared_key_id")
                    or entry_user_id != user["id"]
                )
            )
            if entry_user_id != user["id"] and not is_shared_entry:
                continue
            prompt_count += 1
            project_item["prompt_count"] += 1
            cost = entry_effective_cost(entry)
            tokens = _entry_usage_tokens(entry)
            project_item["input_tokens"] += tokens["input_tokens"]
            project_item["output_tokens"] += tokens["output_tokens"]
            project_item["total_tokens"] += tokens["total_tokens"]
            project_item["ai_calls"] += int(entry.get("ai_calls") or 0)
            if cost is None:
                continue
            tracked_count += 1
            project_item["tracked_count"] += 1
            cost = float(cost)
            try:
                created = datetime.fromisoformat(str(entry.get("created_at")).replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                day = created.astimezone(timezone.utc).date().isoformat()
            except Exception:
                day = None

            if entry_user_id == user["id"] and not is_shared_entry:
                mine_total += cost
                project_item["total_cost_usd"] += cost
                if day in mine_by_day:
                    mine_window += cost
                    mine_by_day[day] += cost
                    total_by_day[day] += cost
                    project_item["window_cost_usd"] += cost
                    project_item["mine_window_usd"] += cost
            else:
                shared_total += cost
                project_item["total_cost_usd"] += cost
                member = shared_users.get(entry_user_id)
                if member is None:
                    continue
                member["total_cost_usd"] += cost
                member["prompt_count"] += 1
                member["tracked_count"] += 1
                project_user = project_item["users"].setdefault(
                    entry_user_id,
                    {
                        "user_id": entry_user_id,
                        "display_name": member.get("display_name") or entry.get("user_name") or "Team member",
                        "email": member.get("email"),
                        "window_cost_usd": 0.0,
                        "tracked_count": 0,
                    },
                )
                project_user["tracked_count"] += 1
                if day in shared_by_day:
                    shared_window += cost
                    shared_by_day[day] += cost
                    total_by_day[day] += cost
                    project_item["window_cost_usd"] += cost
                    project_item["shared_window_usd"] += cost
                    member["window_cost_usd"] += cost
                    member["daily"][day] += cost
                    project_user["window_cost_usd"] += cost

            if day in total_by_day:
                recent_prompts.append(
                    {
                        "id": entry.get("id"),
                        "project_id": project_path.name,
                        "project_name": project_name,
                        "created_at": entry.get("created_at"),
                        "prompt": (entry.get("prompt") or "")[:240],
                        "success": bool(entry.get("success", True)),
                        "kind": entry.get("kind") or "cad",
                        "filename": entry.get("filename"),
                        "trace_id": entry.get("trace_id"),
                        "user_id": entry_user_id,
                        "user_name": entry.get("user_name") or (user.get("display_name") if entry_user_id == user["id"] else None),
                        "model": entry.get("model"),
                        "provider": entry.get("provider"),
                        "key_source": entry.get("key_source"),
                        "cost_usd": round(cost, 6),
                        "ai_calls": int(entry.get("ai_calls") or 0),
                        **tokens,
                    }
                )

    shared_breakdown = []
    for member in shared_users.values():
        member["total_cost_usd"] = round(member["total_cost_usd"], 6)
        member["window_cost_usd"] = round(member["window_cost_usd"], 6)
        member["daily"] = [
            {"date": day, "cost_usd": round(member["daily"][day], 6)}
            for day in series_days
        ]
        shared_breakdown.append(member)
    shared_breakdown.sort(key=lambda m: m["window_cost_usd"], reverse=True)
    projects = []
    for project in project_breakdown.values():
        project["total_cost_usd"] = round(project["total_cost_usd"], 6)
        project["window_cost_usd"] = round(project["window_cost_usd"], 6)
        project["mine_window_usd"] = round(project["mine_window_usd"], 6)
        project["shared_window_usd"] = round(project["shared_window_usd"], 6)
        project["users"] = [
            {
                **member,
                "window_cost_usd": round(member["window_cost_usd"], 6),
            }
            for member in project["users"].values()
        ]
        projects.append(project)
    projects.sort(key=lambda p: p["window_cost_usd"], reverse=True)
    recent_prompts.sort(key=lambda p: p.get("created_at") or "", reverse=True)

    return {
        "currency": "USD",
        "current_user_id": user["id"],
        "days": days,
        "range": {"start": series_days[0], "end": series_days[-1]},
        "projects_scanned": projects_scanned,
        "prompt_count": prompt_count,
        "tracked_count": tracked_count,
        "untracked_count": max(0, prompt_count - tracked_count),
        "totals": {
            "mine_total_usd": round(mine_total, 6),
            "shared_total_usd": round(shared_total, 6),
            "all_total_usd": round(mine_total + shared_total, 6),
            "mine_window_usd": round(mine_window, 6),
            "shared_window_usd": round(shared_window, 6),
            "all_window_usd": round(mine_window + shared_window, 6),
        },
        "daily": [
            {
                "date": day,
                "mine_usd": round(mine_by_day[day], 6),
                "shared_usd": round(shared_by_day[day], 6),
                "total_usd": round(total_by_day[day], 6),
            }
            for day in series_days
        ],
        "shared_users": shared_breakdown,
        "projects": projects,
        "recent_prompts": recent_prompts[:40],
    }


@app.get("/api/projects/{project_id}/prompt-history/{prompt_id}")
def get_prompt_history_entry(
    project_id: str,
    prompt_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    entry = prompt_history_service.get_entry(path, prompt_id)
    if not entry:
        raise HTTPException(404, f"Prompt {prompt_id} not found")
    return {"entry": entry, "project_id": project_id}


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


@app.post("/api/projects/{project_id}/timeline/{index}/restore-latest")
def restore_timeline_latest(
    project_id: str,
    index: int,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    try:
        result = history_service.restore_as_latest(
            path,
            index,
            user_id=user["id"],
            user_name=user["display_name"],
        )
        project_store.touch_project(path)
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
            "action": "timeline.restore",
            "timeline_entry": result.get("entry"),
        },
    )
    return {
        **result,
        "timeline": history_service.timeline_summary(path),
    }


@app.post("/api/projects/{project_id}/timeline/{index}")
def go_timeline(
    project_id: str,
    index: int,
    as_latest: bool = Query(False),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    try:
        if as_latest:
            result = history_service.restore_as_latest(
                path,
                index,
                user_id=user["id"],
                user_name=user["display_name"],
            )
            project_store.touch_project(path)
        else:
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
            "action": "timeline.restore" if as_latest else "timeline",
            "timeline_entry": result.get("entry") if as_latest else None,
        },
    )
    return {
        **result,
        "timeline": history_service.timeline_summary(path),
    }


@app.delete("/api/projects/{project_id}/timeline/{index}")
def delete_timeline_entry(project_id: str, index: int, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    try:
        result = history_service.remove_entry(path, index)
    except (IndexError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc
    project_store.touch_project(path)
    filename = result.get("filename")
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": filename,
            "url": f"/api/projects/{project_id}/files/{filename}" if filename else None,
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "timeline.remove",
        },
    )
    return {
        **result,
        "timeline": history_service.timeline_summary(path),
    }


@app.get("/api/projects/{project_id}/dimensions")
def get_project_dimensions(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    filename: str | None = Query(None),
):
    project_path = _require_project(user, project_id)
    try:
        return _measure_model_dimensions(project_path, filename)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, f"Could not measure model dimensions: {exc}") from exc


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
    # 3MF / STEP have no browser loader — tessellate to GLB for the viewer.
    viewer_filename = dest.name
    if suffix == ".3mf":
        try:
            mesh = cad_service.load_mesh(dest)
            glb_dest = dest.with_suffix(".glb")
            cad_service.export_mesh(mesh, glb_dest)
            viewer_filename = glb_dest.name
        except Exception as exc:
            logger.warning("3MF preview GLB failed for %s: %s", dest.name, exc)
    elif suffix in cad_service.STEP_SUFFIXES:
        try:
            glb_dest = dest.with_suffix(".glb")
            cad_service.tessellate_step_to_glb(dest, glb_dest)
            viewer_filename = glb_dest.name
        except Exception as exc:
            logger.warning("STEP preview GLB failed for %s: %s", dest.name, exc)
    entry = _record_history(path, "upload", f"Upload {dest.name}", dest.name, user=user)
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": viewer_filename,
            "url": f"/api/projects/{project_id}/files/{viewer_filename}",
            "uploaded_filename": dest.name,
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "upload",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": dest.name,
        "viewer_filename": viewer_filename,
        "url": f"/api/projects/{project_id}/files/{viewer_filename}",
        "timeline_index": entry["index"],
    }


@app.get("/api/projects/{project_id}/files/{filename}")
def get_file(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    project_path = _require_project(user, project_id)
    safe = Path(filename).name
    file_path = project_path / safe
    if not file_path.is_file() and file_path.suffix.lower() == ".glb":
        stem = file_path.stem
        step_src = next(
            (
                project_path / f"{stem}{suffix}"
                for suffix in (".step", ".stp")
                if (project_path / f"{stem}{suffix}").is_file()
            ),
            None,
        )
        if step_src is not None:
            try:
                cad_service.tessellate_step_to_glb(step_src, file_path)
            except Exception as exc:
                logger.warning("Lazy STEP preview GLB failed for %s: %s", step_src.name, exc)
    if not file_path.is_file():
        raise HTTPException(404, "File not found")
    if file_path.suffix.lower() == ".3mf":
        stem = file_path.stem
        for suffix in (".step", ".stp", ".glb", ".gltf", ".stl", ".obj", ".ply", ".off"):
            src = project_path / f"{stem}{suffix}"
            if src.is_file():
                try:
                    cad_service.ensure_mesh_exports(project_path, src.name, missing_only=True)
                except Exception as exc:
                    logger.warning("3MF refresh failed for %s: %s", src.name, exc)
                break
    download_name = safe
    if file_path.suffix.lower() == ".3mf":
        download_name = f"{file_path.stem}.3MF"
    return FileResponse(file_path, filename=download_name)


@app.get("/api/projects/{project_id}/files/{filename}/exports")
def list_file_exports(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    safe = Path(filename).name
    if not (path / safe).is_file():
        raise HTTPException(404, "File not found")
    # List existing artifacts immediately — avoid blocking on STEP regen (can take 15s+).
    exports = cad_service.list_exports_for_model(path, safe)
    return {
        "filename": safe,
        "exports": exports,
        "share_url": f"/api/projects/{project_id}/files/{safe}",
    }


@app.post("/api/projects/{project_id}/assembly/exports")
def build_visible_assembly_exports(
    project_id: str,
    body: VisibleAssemblyExportRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    try:
        exports = cad_service.build_visible_assembly_exports(path, body.filenames)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    primary = next((item["name"] for item in exports if item.get("format") == "glb"), exports[0]["name"] if exports else "")
    return {
        "filename": primary,
        "exports": exports,
        "share_url": f"/api/projects/{project_id}/files/{primary}" if primary else None,
        "component_count": len({Path(name).name for name in body.filenames if name}),
    }


@app.post("/api/projects/{project_id}/push-to-onshape")
def push_project_to_onshape(project_id: str, body: dict = Body(default={}),
                             user: dict[str, Any] = Depends(get_current_user)):
    """Create a new Onshape document from the current (edited) model STEP.
    Onshape auto-translates it to native geometry on open.
    """
    from backend.services.onshape_oauth import get_valid_access_token, export_step_to_onshape
    from backend.services import cad_service

    path = _require_project(user, project_id)
    meta = project_store.load_meta(path)
    source = meta.get("onshape_source", {})
    element_name = source.get("element_name") or meta.get("name", "model")

    access_token = get_valid_access_token(user["id"])
    if not access_token:
        raise HTTPException(401, "Onshape account not linked.")

    # Find or regenerate the STEP file
    filename = body.get("filename") or project_store.latest_model_file(path)
    if not filename:
        raise HTTPException(422, "No model file found in this project.")

    safe = Path(filename).name
    stem = safe[: safe.rfind(".")] if "." in safe else safe
    step_path = path / f"{stem}.step"
    if not step_path.is_file():
        cad_service.ensure_mesh_exports(path, safe)
    if not step_path.is_file():
        raise HTTPException(422, "Could not generate STEP file for this model.")

    step_bytes = step_path.read_bytes()
    from datetime import date
    doc_name = f"{element_name} — edited {date.today().strftime('%b %d')}"

    try:
        result = export_step_to_onshape(access_token, step_bytes, doc_name)
    except Exception as exc:
        msg = str(exc)
        if hasattr(exc, "response"):
            try:
                msg = exc.response.json().get("message") or msg
            except Exception:
                pass
        raise HTTPException(502, f"Onshape push failed: {msg}") from exc

    return {"url": result["url"], "document_name": doc_name}


@app.get("/api/projects/{project_id}/onshape-source")
def get_project_onshape_source(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Return Onshape source metadata for a project (if it was imported from Onshape)."""
    path = _require_project(user, project_id)
    meta = project_store.load_meta(path)
    source = meta.get("onshape_source")
    return {"onshape_source": source}


@app.post("/api/projects/{project_id}/files/{filename}/export-to-onshape")
def export_file_to_onshape(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    """Export a model's STEP file into a new Onshape document."""
    from backend.services.onshape_oauth import get_valid_access_token, export_step_to_onshape

    # Verify project access
    path = _require_project(user, project_id)
    safe = Path(filename).name
    if not (path / safe).is_file():
        raise HTTPException(404, "File not found")

    # Ensure Onshape is linked
    access_token = get_valid_access_token(user["id"])
    if not access_token:
        raise HTTPException(401, "Onshape account not linked. Sign in with Onshape first.")

    # Find or generate the STEP file
    from backend.services import cad_service
    stem = safe[: safe.rfind(".")] if "." in safe else safe
    step_path = path / f"{stem}.step"
    if not step_path.is_file():
        cad_service.ensure_mesh_exports(path, safe)
        if not step_path.is_file():
            raise HTTPException(422, "Could not generate STEP file for this model.")

    step_bytes = step_path.read_bytes()
    model_name = stem.replace("_", " ").replace("-", " ")

    try:
        result = export_step_to_onshape(access_token, step_bytes, model_name)
    except Exception as exc:
        msg = str(exc)
        # Surface the Onshape JSON body if available
        if hasattr(exc, "response"):
            try:
                body = exc.response.json()
                msg = body.get("message") or body.get("error") or msg
            except Exception:
                pass
        raise HTTPException(502, f"Onshape export failed: {msg}") from exc

    return result


@app.post("/api/projects/{project_id}/files/{filename}/exports/regenerate")
def regenerate_file_exports(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    safe = Path(filename).name
    if not (path / safe).is_file():
        raise HTTPException(404, "File not found")
    cad_service.ensure_mesh_exports(path, safe)
    exports = cad_service.list_exports_for_model(path, safe)
    return {
        "filename": safe,
        "exports": exports,
        "share_url": f"/api/projects/{project_id}/files/{safe}",
    }


@app.patch("/api/projects/{project_id}/files/{filename}")
def rename_file_endpoint(
    project_id: str,
    filename: str,
    body: FileRenameRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    safe = Path(filename).name
    try:
        renamed = cad_service.rename_model_file(path, safe, Path(body.name).name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    new_primary = Path(body.name).name
    _notify_project(
        project_id,
        {
            "type": "file.renamed",
            "old_filename": safe,
            "filename": new_primary,
            "by": user["display_name"],
        },
    )
    return {"old_filename": safe, "filename": new_primary, "renamed": renamed}


@app.delete("/api/projects/{project_id}/files/{filename}")
def delete_file(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    project_path = _require_project(user, project_id)
    safe = Path(filename).name
    file_path = project_path / safe
    if not file_path.is_file():
        raise HTTPException(404, "File not found")

    entry = _record_history(
        project_path,
        "delete_object",
        f"Delete {safe}",
        safe,
        meta={"deleted_file": safe},
        user=user,
    )

    try:
        deleted_files = cad_service.delete_model_artifacts(project_path, safe)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc

    entry_meta = entry.get("meta") or {}
    entry_meta["deleted_files"] = deleted_files
    entry["meta"] = entry_meta

    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "file.deleted",
            "filename": safe,
            "deleted_files": deleted_files,
            "by": user["display_name"],
            "by_user_id": user["id"],
            "timeline_entry": entry,
        },
    )
    return {
        "deleted": safe,
        "deleted_files": deleted_files,
        "timeline_index": entry["index"],
        "timeline": history_service.timeline_summary(project_path),
    }


@app.get("/api/projects/{project_id}/wiring")
def get_wiring(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    wiring_path = path / "wiring.json"
    if not wiring_path.is_file():
        return {"components": [], "wires": []}
    try:
        return json.loads(wiring_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid wiring.json: {exc}") from exc


@app.put("/api/projects/{project_id}/wiring")
def save_wiring(
    project_id: str,
    body: WiringSaveRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    wiring_path = path / "wiring.json"
    payload = {"components": body.components, "wires": body.wires}
    if body.notes:
        payload["notes"] = body.notes
    if body.name:
        payload["name"] = body.name
    if body.description:
        payload["description"] = body.description
    if body.reference_image:
        payload["reference_image"] = body.reference_image
    wiring_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    _notify_project(
        project_id,
        {
            "type": "wiring.updated",
            "component_count": len(body.components),
            "by": user["display_name"],
        },
    )
    return payload


@app.get("/api/projects/{project_id}/rigging")
def get_rigging(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    rigging_path = path / "rigging.json"
    if not rigging_path.is_file():
        return {"bones": [], "name": "Rig"}
    try:
        return json.loads(rigging_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid rigging.json: {exc}") from exc


@app.put("/api/projects/{project_id}/rigging")
def save_rigging(
    project_id: str,
    body: RiggingSaveRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    rigging_path = path / "rigging.json"
    payload: dict[str, Any] = {"bones": body.bones}
    if body.animations:
        payload["animations"] = body.animations
    if body.activeAnimationId:
        payload["activeAnimationId"] = body.activeAnimationId
    if body.name:
        payload["name"] = body.name
    rigging_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {
            "type": "rigging.updated",
            "bone_count": len(body.bones),
            "by": user["display_name"],
        },
    )
    return payload


@app.post("/api/projects/{project_id}/rigging/prompt")
def rigging_prompt(
    project_id: str,
    body: RiggingPromptRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Generate or edit a robot rig / URDF skeleton from a natural-language prompt."""
    from backend.services import rigging_service

    trace_id = getattr(request.state, "trace_id", new_trace_id())
    path = _require_project(user, project_id)
    ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
    )
    try:
        generation_service.start(
            path,
            kind="wiring",
            trace_id=trace_id,
            user=user,
            prompt=body.prompt,
            label="Wiring schematic",
        )
    except generation_service.GenerationInProgress as exc:
        return JSONResponse(
            status_code=202,
            content={
                "accepted": True,
                "status": "running",
                "trace_id": exc.current.get("trace_id"),
                "generation": generation_service.public_summary(path),
            },
        )
    except generation_service.GenerationCanceled as exc:
        raise HTTPException(409, exc.message) from exc
    current = None
    rigging_path = path / "rigging.json"
    if rigging_path.is_file():
        try:
            current = json.loads(rigging_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current = None

    trace_add(
        "info",
        "Rigging prompt started",
        trace_id=trace_id,
        data={"prompt": body.prompt[:300], "image_count": len(body.images)},
    )
    try:
        rig, ai_trace, message = rigging_service.generate_rigging(
            ai,
            body.prompt,
            current=current,
            images=[img.model_dump() for img in body.images],
            trace_id=trace_id,
        )
    except (RuntimeError, ValueError) as exc:
        trace_add("error", f"Rigging prompt failed: {exc}", trace_id=trace_id)
        _save_rigging_prompt_history(
            path,
            prompt=body.prompt,
            success=False,
            speed=body.speed,
            images=body.images,
            trace_id=trace_id,
            user=user,
            error=str(exc),
        )
        raise HTTPException(502, str(exc)) from exc

    sim_files = sorted(path.glob("*.sim.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if sim_files:
        try:
            sim = json.loads(sim_files[0].read_text(encoding="utf-8"))
            part_ids = {str(p.get("id", "")) for p in sim.get("parts") or []}
            if part_ids & {"gear_input", "gear_output"}:
                rig = rigging_service.align_rig_from_sim(rig, sim)
                message += " Aligned joint frames to gear sim."
        except (json.JSONDecodeError, OSError, KeyError):
            pass

    hist_entry = _save_rigging_prompt_history(
        path,
        prompt=body.prompt,
        success=True,
        speed=body.speed,
        images=body.images,
        trace_id=trace_id,
        user=user,
        message=message,
        ai_traces=ai_trace,
    )
    rigging_path.write_text(json.dumps(rig, indent=2), encoding="utf-8")
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {
            "type": "rigging.updated",
            "bone_count": len(rig.get("bones") or []),
            "by": user["display_name"],
        },
    )
    trace_add(
        "info",
        f"Rigging prompt done → {len(rig.get('bones') or [])} bones",
        trace_id=trace_id,
    )
    return {
        "message": message,
        "rigging": rig,
        "trace_id": trace_id,
        "trace": {"ai": ai_trace},
        "prompt_history": hist_entry,
    }


@app.post("/api/projects/{project_id}/rigging/export-urdf")
def export_rigging_urdf(
    project_id: str,
    body: RiggingSaveRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Write robot.urdf from current rig bones."""
    from backend.services import rigging_service

    path = _require_project(user, project_id)
    rig = {
        "name": body.name or "render3d_rig",
        "bones": body.bones,
        "animations": body.animations,
        "activeAnimationId": body.activeAnimationId,
    }
    urdf_text = rigging_service.rig_to_urdf(rig)
    urdf_path = path / "robot.urdf"
    urdf_path.write_text(urdf_text, encoding="utf-8")
    rigging_path = path / "rigging.json"
    rigging_path.write_text(json.dumps(rig, indent=2), encoding="utf-8")
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {
            "type": "rigging.updated",
            "bone_count": len(body.bones),
            "by": user["display_name"],
        },
    )
    return {
        "message": f"Exported {urdf_path.name} ({len(body.bones)} links)",
        "filename": "robot.urdf",
        "urdf": urdf_text,
    }


@app.post("/api/projects/{project_id}/sketches")
def save_sketch(
    project_id: str,
    body: SketchSaveRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Save a finished 2D sketch to the project."""
    from backend.services import sketch_service

    path = _require_project(user, project_id)
    payload = sketch_service._normalize_sketch(body.model_dump())
    if not payload.get("profile"):
        raise HTTPException(400, "Sketch must include a closed profile")
    slug = (body.name or "sketch").strip().lower().replace(" ", "_")[:40] or "sketch"
    sketch_id = f"{slug}_{int(time.time())}"
    sketch_path = path / f"{sketch_id}.sketch.json"
    payload["id"] = sketch_id
    sketch_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    active_path = path / "_active_sketch.json"
    active_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {"type": "sketch.updated", "sketch_id": sketch_id, "by": user["display_name"]},
    )
    return {"message": f"Saved sketch {payload.get('name', sketch_id)}", "sketch": payload}


@app.get("/api/projects/{project_id}/sketches/{sketch_id}")
def get_sketch(project_id: str, sketch_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    sketch_path = path / f"{sketch_id}.sketch.json"
    if not sketch_path.is_file():
        active = path / "_active_sketch.json"
        if sketch_id == "active" and active.is_file():
            sketch_path = active
        else:
            raise HTTPException(404, "Sketch not found")
    try:
        return json.loads(sketch_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid sketch file: {exc}") from exc


@app.post("/api/projects/{project_id}/sketch/prompt")
def sketch_prompt(
    project_id: str,
    body: SketchPromptRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Generate or edit a 2D sketch from a natural-language prompt."""
    from backend.services import sketch_service

    trace_id = getattr(request.state, "trace_id", new_trace_id())
    path = _require_project(user, project_id)
    try:
        generation_service.start(
            path,
            kind="wiring",
            trace_id=trace_id,
            user=user,
            prompt=body.prompt,
            label="Wiring schematic",
        )
    except generation_service.GenerationInProgress as exc:
        return JSONResponse(
            status_code=202,
            content={
                "accepted": True,
                "status": "running",
                "trace_id": exc.current.get("trace_id"),
                "generation": generation_service.public_summary(path),
            },
        )
    except generation_service.GenerationCanceled as exc:
        raise HTTPException(409, exc.message) from exc
    ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
    )
    current = None
    active_path = path / "_active_sketch.json"
    if active_path.is_file():
        try:
            current = json.loads(active_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current = None

    trace_add(
        "info",
        "Sketch prompt started",
        trace_id=trace_id,
        data={"prompt": body.prompt[:300], "image_count": len(body.images)},
    )
    try:
        sketch, ai_trace, message = sketch_service.generate_sketch(
            ai,
            body.prompt,
            current=current,
            images=[img.model_dump() for img in body.images],
            trace_id=trace_id,
        )
    except (RuntimeError, ValueError) as exc:
        trace_add("error", f"Sketch prompt failed: {exc}", trace_id=trace_id)
        _save_sketch_prompt_history(
            path,
            prompt=body.prompt,
            success=False,
            speed=body.speed,
            images=body.images,
            trace_id=trace_id,
            user=user,
            error=str(exc),
        )
        raise HTTPException(502, str(exc)) from exc

    hist_entry = _save_sketch_prompt_history(
        path,
        prompt=body.prompt,
        success=True,
        speed=body.speed,
        images=body.images,
        trace_id=trace_id,
        user=user,
        message=message,
        ai_traces=ai_trace,
    )
    active_path.write_text(json.dumps(sketch, indent=2), encoding="utf-8")
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {"type": "sketch.updated", "sketch_id": sketch.get("id"), "by": user["display_name"]},
    )
    return {
        "message": message,
        "sketch": sketch,
        "trace_id": trace_id,
        "trace": {"ai": ai_trace},
        "prompt_history": hist_entry,
    }


@app.post("/api/projects/{project_id}/wiring/prompt")
def wiring_prompt(
    project_id: str,
    body: WiringPromptRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Generate or edit a breadboard wiring schematic from a natural-language prompt."""
    from backend.services import wiring_service

    trace_id = getattr(request.state, "trace_id", new_trace_id())
    path = _require_project(user, project_id)
    try:
        generation_service.start(
            path,
            kind="wiring",
            trace_id=trace_id,
            user=user,
            prompt=body.prompt,
            label="Wiring schematic",
        )
    except generation_service.GenerationInProgress as exc:
        return JSONResponse(
            status_code=202,
            content={
                "accepted": True,
                "status": "running",
                "trace_id": exc.current.get("trace_id"),
                "generation": generation_service.public_summary(path),
            },
        )
    except generation_service.GenerationCanceled as exc:
        raise HTTPException(409, exc.message) from exc
    ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
    )
    current = None
    wiring_path = path / "wiring.json"
    if wiring_path.is_file():
        try:
            current = json.loads(wiring_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current = None

    trace_add(
        "info",
        "Wiring prompt started",
        trace_id=trace_id,
        data={"prompt": body.prompt[:300], "image_count": len(body.images)},
    )
    try:
        schematic, ai_trace, message = wiring_service.generate_wiring_schematic(
            ai,
            body.prompt,
            current=current,
            images=[img.model_dump() for img in body.images],
            trace_id=trace_id,
        )
    except (RuntimeError, ValueError) as exc:
        trace_add("error", f"Wiring prompt failed: {exc}", trace_id=trace_id)
        generation_service.fail(path, str(exc), trace_id=trace_id)
        _save_wiring_prompt_history(
            path,
            prompt=body.prompt,
            success=False,
            speed=body.speed,
            images=body.images,
            trace_id=trace_id,
            user=user,
            error=str(exc),
        )
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        logger.exception("Wiring prompt crashed project=%s trace=%s", project_id, trace_id)
        trace_add("error", f"Wiring prompt crashed: {exc}", trace_id=trace_id)
        generation_service.fail(path, str(exc), trace_id=trace_id)
        _save_wiring_prompt_history(
            path,
            prompt=body.prompt,
            success=False,
            speed=body.speed,
            images=body.images,
            trace_id=trace_id,
            user=user,
            error=str(exc),
        )
        raise HTTPException(502, str(exc)) from exc

    if generation_service.is_canceled(path, trace_id):
        trace_add("info", "Wiring prompt canceled before save", trace_id=trace_id)
        raise HTTPException(409, "Wiring generation canceled.")

    hist_entry = _save_wiring_prompt_history(
        path,
        prompt=body.prompt,
        success=True,
        speed=body.speed,
        images=body.images,
        trace_id=trace_id,
        user=user,
        message=message,
        ai_traces=ai_trace,
    )
    wiring_path.write_text(json.dumps(schematic, indent=2), encoding="utf-8")
    generation_service.complete(
        path,
        {
            "kind": "wiring",
            "trace_id": trace_id,
            "prompt": body.prompt[:500],
            "label": "Wiring schematic",
            "message": message,
            "prompt_id": hist_entry.get("id") if hist_entry else None,
            "filename": None,
            "url": None,
        },
    )
    _notify_project(
        project_id,
        {
            "type": "wiring.updated",
            "component_count": len(schematic.get("components") or []),
            "by": user["display_name"],
        },
    )
    trace_add(
        "info",
        f"Wiring prompt done → {len(schematic.get('components') or [])} parts",
        trace_id=trace_id,
    )
    return {
        "message": message,
        "schematic": schematic,
        "trace_id": trace_id,
        "trace": {"ai": ai_trace},
        "prompt_history": hist_entry,
    }


@app.post("/api/projects/{project_id}/wiring/diagnose-photo")
def wiring_diagnose_photo(
    project_id: str,
    body: WiringDiagnoseRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Analyse a photo of a physical circuit and return a structured fault diagnosis."""
    from backend.services import wiring_service

    trace_id = getattr(request.state, "trace_id", new_trace_id())
    path = _require_project(user, project_id)

    ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
    )

    current_schematic: dict[str, Any] | None = None
    if body.include_schematic:
        wiring_path = path / "wiring.json"
        if wiring_path.is_file():
            try:
                current_schematic = json.loads(wiring_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                current_schematic = None

    trace_add(
        "info",
        "Circuit photo diagnosis started",
        trace_id=trace_id,
        data={"image_count": len(body.images), "has_description": bool(body.description)},
    )
    try:
        diagnosis, ai_trace = wiring_service.diagnose_circuit_photo(
            ai,
            [img.model_dump() for img in body.images],
            description=body.description,
            current_schematic=current_schematic,
            trace_id=trace_id,
        )
    except (RuntimeError, ValueError) as exc:
        trace_add("error", f"Circuit diagnosis failed: {exc}", trace_id=trace_id)
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        logger.exception("Circuit diagnosis crashed project=%s trace=%s", project_id, trace_id)
        raise HTTPException(502, "Diagnosis failed — please try again.") from exc

    trace_add(
        "info",
        f"Circuit diagnosis done → {len(diagnosis.get('issues') or [])} issues",
        trace_id=trace_id,
    )
    return {
        "diagnosis": diagnosis,
        "trace_id": trace_id,
        "trace": {"ai": ai_trace},
    }


@app.post("/api/projects/{project_id}/design/demo/gear-train")
def design_gear_train_demo(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    teeth1: int = Query(20, ge=5, le=120),
    teeth2: int = Query(20, ge=5, le=120),
):
    """Build a mounted 2-gear spur train (real CAD geometry) and seed matching rigging."""
    from backend.engineering.gears import gear_train_program
    from backend.services import kernel_bridge, rigging_service

    project_path = _require_project(user, project_id)
    teeth = [teeth1, teeth2]
    program = gear_train_program(
        teeth,
        module=2.0,
        thickness=8.0,
        bore=4.0,
        base_plate=True,
    )
    try:
        result = kernel_bridge.build_and_export(program, project_path, basename=program.name)
    except Exception as exc:
        raise HTTPException(422, f"Gear train build failed: {exc}") from exc

    primary = result["primary"]
    label = f"Demo: mounted {teeth1}:{teeth2} gear train"
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
            "demo": "gear-train",
        },
        user=user,
    )
    rig = rigging_service.demo_gear_train_rigging(teeth)
    rigging_path = project_path / "rigging.json"
    rigging_path.write_text(json.dumps(rig, indent=2), encoding="utf-8")
    project_store.touch_project(project_path, name=program.name)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "demo",
            "timeline_entry": entry,
        },
    )
    _notify_project(
        project_id,
        {
            "type": "rigging.updated",
            "bone_count": len(rig.get("bones") or []),
            "by": user["display_name"],
        },
    )
    return {
        "message": (
            f"Built mounted {teeth1}-tooth and {teeth2}-tooth spur gears on a base plate. "
            "Switch to SOLID to view the model; RIGGING tab shows shaft joints (orange spheres) and spin animation."
        ),
        "filename": primary,
        "url": f"/api/projects/{project_id}/files/{primary}",
        "files": {k: f"/api/projects/{project_id}/files/{v}" for k, v in result.get("files", {}).items()},
        "parts": result.get("parts"),
        "sim": result.get("sim"),
        "dfm": result.get("dfm"),
        "rigging": rig,
        "timeline_index": entry["index"],
    }


@app.post("/api/projects/{project_id}/wiring/demo")
def wiring_demo(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    example: str = Query("pi-button-motor"),
):
    """Seed a demo wiring schematic (Pi button→motor, Pi servo, or Arduino blink LED)."""
    path = _require_project(user, project_id)
    filename = {
        "pi-button-motor": "raspberry-pi-button-motor.json",
        "button-motor": "raspberry-pi-button-motor.json",
        "raspberry-pi-button-motor": "raspberry-pi-button-motor.json",
        "pi-servo": "raspberry-pi-servo.json",
        "raspberry-pi-servo": "raspberry-pi-servo.json",
        "servo": "raspberry-pi-servo.json",
        "blink-led": "blink-led-breadboard.json",
        "blink": "blink-led-breadboard.json",
        "stepper": "arduino-stepper.json",
        "arduino-stepper": "arduino-stepper.json",
        "stepper-motor": "arduino-stepper.json",
    }.get(example, "raspberry-pi-button-motor.json")
    example_path = FRONTEND / "wiring-examples" / filename
    if not example_path.is_file():
        raise HTTPException(404, "Demo schematic not found")
    schematic = json.loads(example_path.read_text(encoding="utf-8"))
    wiring_path = path / "wiring.json"
    wiring_path.write_text(json.dumps(schematic, indent=2), encoding="utf-8")
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {
            "type": "wiring.updated",
            "component_count": len(schematic.get("components") or []),
            "by": user["display_name"],
        },
    )
    return {
        "message": f"Loaded demo: {schematic.get('name', 'Blink LED')}",
        "schematic": schematic,
    }


# ── Component part profiles (identity, stats, online STEP source) ──────────────


class PartProfilePatch(BaseModel):
    label: str | None = None
    wiring_type: str | None = None
    kind: str | None = None
    datasheet: str | None = None
    confidence: str | None = None
    stats: dict[str, Any] | None = None
    source: dict[str, Any] | None = None
    notes: str | None = None
    filename: str | None = None


class PartSourceLink(BaseModel):
    candidate: dict[str, Any]


class CatalogImportRequest(BaseModel):
    name: str | None = None
    step_url: str
    glb_url: str | None = None
    png_url: str | None = None
    page_url: str | None = None
    product_page_url: str | None = None
    source_id: str | None = None
    wiring_type: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/projects/{project_id}/parts")
def list_part_profiles(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """All saved part profiles for the project, keyed by component stem."""
    path = _require_project(user, project_id)
    return {"profiles": part_profiles_service.load_all(path)}


@app.get("/api/projects/{project_id}/parts/{stem}")
def get_part_profile(project_id: str, stem: str, user: dict[str, Any] = Depends(get_current_user)):
    """One profile; auto-seeded from filename recognition if it does not exist yet."""
    path = _require_project(user, project_id)
    return part_profiles_service.get_or_seed(path, stem)


@app.put("/api/projects/{project_id}/parts/{stem}")
def save_part_profile(
    project_id: str,
    stem: str,
    patch: PartProfilePatch,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    profile = part_profiles_service.save_profile(
        path, stem, patch.model_dump(exclude_none=True)
    )
    _notify_project(project_id, {"type": "parts.updated", "stem": stem, "by": user["display_name"]})
    return profile


@app.get("/api/projects/{project_id}/parts/{stem}/sources")
def search_part_sources(
    project_id: str,
    stem: str,
    user: dict[str, Any] = Depends(get_current_user),
    q: str = Query("", max_length=200),
):
    """Search the online parts catalog (step.parts) for matching components."""
    _require_project(user, project_id)
    query = (q or stem.replace("_", " ").replace("-", " ")).strip()
    try:
        candidates = part_profiles_service.search_sources(query)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"query": query, "candidates": candidates}


@app.get("/api/catalog/search")
def search_catalog(
    q: str = Query("", max_length=200),
    sources: str | None = Query(None, max_length=500),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Search sourceable CAD/catalog parts plus lightweight price/spec links."""
    query = (q or "").strip()
    if not query:
        return {
            "query": query,
            "sources": part_profiles_service.catalog_source_options(),
            "selected_sources": [],
            "candidates": [],
            "price_links": [],
        }
    selected_sources = [s.strip() for s in (sources or "").split(",") if s.strip()] if sources else None
    return part_profiles_service.search_catalog(query, sources=selected_sources, limit=24)


@app.post("/api/projects/{project_id}/parts/import")
def import_catalog_part(
    project_id: str,
    body: CatalogImportRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Import a catalog STEP asset into the current project."""
    path = _require_project(user, project_id)
    raw_name = body.name or body.source_id or "catalog_part"
    safe_stem = "".join(c if c.isalnum() or c in "-_ " else "_" for c in raw_name).strip().replace(" ", "_").lower()
    safe_stem = safe_stem[:80] or "catalog_part"
    dest = path / f"{safe_stem}.step"
    n = 2
    while dest.exists():
        dest = path / f"{safe_stem}_{n}.step"
        n += 1
    try:
        part_profiles_service.download_asset(body.step_url, dest)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc

    viewer_filename = dest.name
    glb_dest = dest.with_suffix(".glb")
    if body.glb_url:
        try:
            part_profiles_service.download_asset(body.glb_url, glb_dest)
            viewer_filename = glb_dest.name
        except RuntimeError as exc:
            logger.warning("Catalog GLB preview download failed for %s: %s", dest.name, exc)
    if viewer_filename == dest.name:
        try:
            cad_service.tessellate_step_to_glb(dest, glb_dest)
            viewer_filename = glb_dest.name
        except Exception as exc:
            logger.warning("Catalog STEP preview GLB failed for %s: %s", dest.name, exc)

    stem = dest.stem
    profile = part_profiles_service.save_profile(
        path,
        stem,
        {
            "label": body.name or stem,
            "filename": dest.name,
            "wiring_type": body.wiring_type,
            "confidence": "catalog",
            "stats": body.attributes or {},
            "source": {
                "provider": "step.parts",
                "id": body.source_id,
                "name": body.name,
                "page_url": body.page_url,
                "product_page_url": body.product_page_url,
                "step_url": body.step_url,
                "glb_url": body.glb_url,
                "png_url": body.png_url,
                "attributes": body.attributes or {},
            },
        },
    )
    entry = _record_history(path, "upload", f"Import catalog part {dest.name}", dest.name, meta={"source_id": body.source_id}, user=user)
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": viewer_filename,
            "url": f"/api/projects/{project_id}/files/{viewer_filename}",
            "uploaded_filename": dest.name,
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "catalog_import",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": dest.name,
        "viewer_filename": viewer_filename,
        "url": f"/api/projects/{project_id}/files/{viewer_filename}",
        "profile": profile,
        "timeline_index": entry["index"],
    }


@app.post("/api/projects/{project_id}/parts/{stem}/link")
def link_part_source(
    project_id: str,
    stem: str,
    body: PartSourceLink,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Attach an online catalog record to the component profile (STEP/GLB/stats)."""
    path = _require_project(user, project_id)
    profile = part_profiles_service.link_source(path, stem, body.candidate)
    _notify_project(project_id, {"type": "parts.updated", "stem": stem, "by": user["display_name"]})
    return profile


def _usage_history_fields(ai_traces: list[dict[str, Any]] | dict[str, Any] | None) -> dict[str, Any]:
    from backend.services.ai_cost import usage_fields_for_history

    return usage_fields_for_history(ai_traces)


def _save_rigging_prompt_history(
    project_path: Path,
    *,
    prompt: str,
    success: bool,
    speed: str = "fast",
    images: list[Any] | None = None,
    trace_id: str | None,
    user: dict[str, Any] | None = None,
    message: str | None = None,
    error: str | None = None,
    ai_traces: list[dict[str, Any]] | dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    try:
        img_list = images or []
        return prompt_history_service.append_entry(
            project_path,
            prompt=prompt,
            success=success,
            message=message,
            speed=speed,
            error=error,
            images=[
                img.model_dump(exclude={"data_url"}) if hasattr(img, "model_dump") else img
                for img in img_list[:4]
            ],
            trace_id=trace_id,
            user_id=user["id"] if user else None,
            user_name=user["display_name"] if user else None,
            kind="rigging",
            **_usage_history_fields(ai_traces),
        )
    except Exception as exc:
        logger.debug("rigging prompt history save failed: %s", exc)
    return None


def _save_wiring_prompt_history(
    project_path: Path,
    *,
    prompt: str,
    success: bool,
    speed: str = "fast",
    images: list[Any] | None = None,
    trace_id: str | None,
    user: dict[str, Any] | None = None,
    message: str | None = None,
    error: str | None = None,
    ai_traces: list[dict[str, Any]] | dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    try:
        img_list = images or []
        return prompt_history_service.append_entry(
            project_path,
            prompt=prompt,
            success=success,
            message=message,
            speed=speed,
            error=error,
            images=[
                img.model_dump(exclude={"data_url"}) if hasattr(img, "model_dump") else img
                for img in img_list[:4]
            ],
            trace_id=trace_id,
            user_id=user["id"] if user else None,
            user_name=user["display_name"] if user else None,
            kind="wiring",
            **_usage_history_fields(ai_traces),
        )
    except Exception as exc:
        logger.debug("wiring prompt history save failed: %s", exc)
    return None


def _save_sketch_prompt_history(
    project_path: Path,
    *,
    prompt: str,
    success: bool,
    speed: str = "fast",
    images: list[Any] | None = None,
    trace_id: str | None,
    user: dict[str, Any] | None = None,
    message: str | None = None,
    error: str | None = None,
    ai_traces: list[dict[str, Any]] | dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    try:
        img_list = images or []
        return prompt_history_service.append_entry(
            project_path,
            prompt=prompt,
            success=success,
            message=message,
            speed=speed,
            error=error,
            images=[
                img.model_dump(exclude={"data_url"}) if hasattr(img, "model_dump") else img
                for img in img_list[:4]
            ],
            trace_id=trace_id,
            user_id=user["id"] if user else None,
            user_name=user["display_name"] if user else None,
            kind="sketch",
            **_usage_history_fields(ai_traces),
        )
    except Exception as exc:
        logger.debug("sketch prompt history save failed: %s", exc)
    return None


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
    ai_traces: list[dict[str, Any]] | dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    try:
        key_meta: dict[str, Any] = {}
        effective: dict[str, Any] = {}
        if user:
            try:
                if body.ai_key_id:
                    effective = user_ai_keys_service.resolve_key_for_user(
                        user["id"], body.ai_key_id, body.ai_key_source
                    ) or {}
                else:
                    effective = user_ai_keys_service.get_effective_key_for_user(user["id"]) or {}
                if effective.get("source") == "team":
                    key_meta = {
                        "key_source": "team",
                        "shared_key_id": effective.get("key_id"),
                        "shared_key_name": effective.get("key_name"),
                        "shared_by_name": effective.get("shared_by_name"),
                    }
                elif effective.get("source"):
                    key_meta = {"key_source": effective.get("source")}
            except Exception:
                key_meta = {}
                effective = {}
        usage_meta = _usage_history_fields(ai_traces)
        if not usage_meta.get("model") and effective:
            model = (effective.get("model") or "").strip()
            if not model and effective.get("provider") == "openai":
                model = settings.openai_model_quality if body.speed == "quality" else settings.openai_model
            elif not model:
                model = settings.anthropic_model
            if model:
                usage_meta["model"] = model
            if effective.get("provider"):
                usage_meta["provider"] = effective.get("provider")
        return prompt_history_service.append_entry(
            project_path,
            prompt=prompt,
            success=success,
            message=message,
            filename=filename,
            base_filename=body.base_filename,
            speed=body.speed,
            error=error,
            references=refs_list,
            images=[img.model_dump(exclude={"data_url"}) for img in body.images],
            trace_id=trace_id,
            user_id=user["id"] if user else None,
            user_name=user["display_name"] if user else None,
            prompt_mode=(getattr(body, "mode", None) or "standard").lower(),
            **usage_meta,
            **key_meta,
        )
    except Exception as exc:
        logger.debug("prompt history save failed: %s", exc)
    return None


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
    from backend.services.design_service import DesignBuildError, DesignCanceled

    refs_list = [r.model_dump() for r in body.references]
    context = _slim_context(project_id, project_path, body)
    timer = TraceTimer("Design pipeline", trace_id)
    cancel_check = lambda: generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir()
    try:
        if cancel_check():
            raise DesignCanceled("Generation canceled.")
        out = design_service.run_design(
            body.prompt,
            project_path,
            context,
            ai,
            trace_id=trace_id,
            images=[img.model_dump() for img in body.images],
            skills=body.skills,
            speed=body.speed,
            mode=getattr(body, "mode", "standard") or "standard",
            cancel_check=cancel_check,
        )
        timer.done(intent=out.get("intent"), attempts=out.get("attempts"))
    except DesignCanceled as exc:
        timer.done(canceled=True)
        trace_add("warning", f"Design canceled: {exc}", trace_id=trace_id)
        raise HTTPException(499, str(exc) or "Generation canceled.") from exc
    except DesignBuildError as exc:
        timer.done(error=str(exc))
        _save_prompt_history(
            project_path,
            prompt=body.prompt,
            success=False,
            body=body,
            refs_list=refs_list,
            trace_id=trace_id,
            user=user,
            error=str(exc),
            ai_traces=exc.ai_traces,
        )
        raise HTTPException(422, f"Design failed: {exc}") from exc
    except Exception as exc:
        timer.done(error=str(exc))
        _save_prompt_history(
            project_path, prompt=body.prompt, success=False, body=body,
            refs_list=refs_list, trace_id=trace_id, user=user, error=str(exc),
        )
        raise HTTPException(422, f"Design failed: {exc}") from exc

    result = out["result"]
    primary = result["primary"]
    referenced_components = []
    for r in body.references:
        if not (r.type == "component" or r.filename):
            continue
        comp_ref: dict[str, Any] = {"filename": r.filename, "stem": r.stem, "label": r.label}
        if r.projectId and r.projectId != project_id:
            comp_ref["source_project_id"] = r.projectId
        referenced_components.append(comp_ref)
    if not referenced_components and _looks_like_fixture_prompt(body.prompt):
        referenced_components = _project_component_refs_for_fixture(project_path)
    placed_parts = _apply_part_placements(
        project_path, project_id, out.get("part_placements") or [], referenced_components, user
    )
    if placed_parts:
        trace_add("info", f"Seated {len(placed_parts)} component(s) into generated mounts", trace_id=trace_id)
    label = "AI: " + (body.prompt[:48] + "…" if len(body.prompt) > 48 else body.prompt)
    usage_meta = _usage_history_fields(out.get("ai_trace"))
    entry = _record_history(
        project_path, "prompt", label, primary,
        meta={
            "program": result.get("program"), "files": result.get("files"),
            "intent": out.get("intent"), "prompt": body.prompt,
            "message": out.get("message"), "speed": body.speed,
            "placed_parts": placed_parts,
            "design_plan": out.get("design_plan"),
            "base_filename": body.base_filename,
            "sim": result.get("sim"), "dfm": result.get("dfm"),
            "trace_id": trace_id,
            **usage_meta,
        },
        user=user,
    )
    hist_entry = _save_prompt_history(
        project_path, prompt=body.prompt, success=True, body=body,
        refs_list=refs_list, trace_id=trace_id, user=user,
        message=out.get("message"), filename=primary,
        ai_traces=out.get("ai_trace"),
    )
    project_store.touch_project(project_path, name=result.get("program", {}).get("name"))
    trace_add("info", f"Design done → {primary} ({out.get('attempts')} attempt(s))", trace_id=trace_id)
    _notify_project(
        project_id,
        {
            "type": "model.reload", "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "placed_parts": placed_parts,
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
        "design_plan": out.get("design_plan"),
        "specs_used": out.get("specs_used"),
        "placed_parts": placed_parts,
        "parts": result.get("parts"),
        "sim": result.get("sim"),
        "dfm": result.get("dfm"),
        "warnings": out.get("dfm_warnings"),
        "timeline_index": entry["index"],
        "trace_id": trace_id,
        "prompt_id": hist_entry.get("id") if hist_entry else None,
        "trace": {"ai": out.get("ai_trace"), "intent": out.get("intent"), "attempts": out.get("attempts")},
    }


@app.get("/api/projects/{project_id}/generation")
def get_generation_status(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    return generation_service.public_summary(path)


@app.post("/api/projects/{project_id}/generation/cancel")
def cancel_generation(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    if not generation_service.is_running(path):
        return generation_service.public_summary(path)
    return generation_service.request_cancel(path)


def _background_prompt_kernel(
    project_id: str,
    body_data: dict[str, Any],
    trace_id: str,
    user: dict[str, Any],
) -> None:
    project_path = PROJECTS / project_id
    try:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            return
        body = PromptRequest.model_validate(body_data)
        ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
    )
        result = _prompt_via_kernel(project_id, body, trace_id, ai, user, project_path)
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            return
        generation_service.complete(
            project_path,
            {
                "message": result.get("message"),
                "filename": result.get("filename"),
                "url": result.get("url"),
                "timeline_index": result.get("timeline_index"),
                "prompt_id": result.get("prompt_id"),
                "design_plan": result.get("design_plan"),
            },
        )
    except HTTPException as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            return
        detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
        generation_service.fail(project_path, detail, trace_id=trace_id)
    except Exception as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            return
        logger.exception("Background prompt failed project=%s trace=%s", project_id, trace_id)
        generation_service.fail(project_path, str(exc), trace_id=trace_id)


def _background_kernel_build(
    project_id: str,
    program: dict[str, Any],
    trace_id: str,
    user: dict[str, Any],
) -> None:
    project_path = PROJECTS / project_id
    timer = TraceTimer("Kernel build", trace_id)
    try:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            timer.done(canceled=True)
            return
        result = kernel_bridge.build_and_export(program, project_path)
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            timer.done(canceled=True)
            return
        timer.done(parts=len(result.get("parts", [])), primary=result.get("primary"))
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
        generation_service.complete(
            project_path,
            {
                "message": result.get("program", {}).get("description") or "Model built.",
                "filename": primary,
                "url": f"/api/projects/{project_id}/files/{primary}",
                "timeline_index": entry["index"],
            },
        )
    except Exception as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            timer.done(canceled=True)
            return
        timer.done(error=str(exc))
        trace_add("error", f"Kernel build failed: {exc}", trace_id=trace_id)
        generation_service.fail(project_path, f"Kernel build failed: {exc}", trace_id=trace_id)


@app.post("/api/projects/{project_id}/prompt")
def prompt_cad(
    project_id: str,
    body: PromptRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(get_current_user),
):
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    project_path = _require_project(user, project_id)
    if _is_dimension_question(body.prompt):
        try:
            measurement = _measure_model_dimensions(project_path, body.base_filename)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(422, f"Could not measure model dimensions: {exc}") from exc
        refs_list = [r.model_dump() for r in body.references]
        hist_entry = _save_prompt_history(
            project_path,
            prompt=body.prompt,
            success=True,
            body=body,
            refs_list=refs_list,
            trace_id=trace_id,
            user=user,
            message=measurement["message"],
        )
        return {
            "answered": True,
            "kind": "dimensions",
            "message": measurement["message"],
            "dimensions": measurement,
            "filename": measurement["filename"],
            "trace_id": trace_id,
            "prompt_id": hist_entry.get("id") if hist_entry else None,
        }
    ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
    )
    resolved_skills = skills_service.resolve_prompt_skills(body.skills, has_images=bool(body.images))

    trace_add(
        "info",
        "CAD prompt started",
        trace_id=trace_id,
        data={
            "prompt": body.prompt[:300],
            "speed": body.speed,
            "provider": ai.provider,
            "model": ai.model,
            "skills": resolved_skills,
            "skills_requested": body.skills,
            "image_count": len(body.images),
        },
    )

    # Whisk/paddle tool swaps on the cooking appliance — parametric rebuild (mesh booleans fail).
    if _is_appliance_toolhead_swap(body, project_path):
        trace_add(
            "info",
            "Routing appliance toolhead swap to parametric rebuild",
            trace_id=trace_id,
            data={"base_filename": body.base_filename},
        )
        return _rebuild_cooking_appliance_toolhead(project_id, body, trace_id, user, project_path)

    # New parametric B-rep pipeline for fresh geometry; legacy actions path for
    # edits on an existing/uploaded mesh (use_base, paint, hole-on-existing).
    use_kernel = _should_use_kernel_pipeline(body, project_path)
    trace_add(
        "info",
        "Prompt routing",
        trace_id=trace_id,
        data={
            "pipeline": "kernel" if use_kernel else "legacy_mesh_edit",
            "base_filename": body.base_filename,
            "fresh_design": _is_fresh_design_request(body) if body.base_filename else True,
            "fixture_prompt": _looks_like_fixture_prompt(body.prompt),
        },
    )
    if use_kernel:
        updates: dict[str, Any] = {"skills": resolved_skills}
        if body.base_filename:
            updates["base_filename"] = None
        design_body = body.model_copy(update=updates)
        try:
            generation_service.start(
                project_path,
                kind="prompt",
                trace_id=trace_id,
                user=user,
                prompt=body.prompt,
                mode=body.mode,
                request_body=design_body.model_dump(mode="json"),
            )
        except generation_service.GenerationCanceled as exc:
            raise HTTPException(499, exc.message) from exc
        except generation_service.GenerationInProgress as exc:
            raise HTTPException(409, "Generation already in progress for this project") from exc
        background_tasks.add_task(
            _background_prompt_kernel,
            project_id,
            design_body.model_dump(mode="json"),
            trace_id,
            dict(user),
        )
        return JSONResponse(
            status_code=202,
            content={
                "accepted": True,
                "status": "running",
                "trace_id": trace_id,
                "generation": generation_service.public_summary(project_path),
            },
        )

    refs_list = [r.model_dump() for r in body.references]
    refs_map = cad_service.references_map(refs_list)
    context = _slim_context(project_id, project_path, body)

    try:
        plan, ai_trace = ai.generate_cad_plan(
            body.prompt,
            context,
            trace_id=trace_id,
            images=[img.model_dump() for img in body.images],
        )
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
            ai_traces=ai_trace,
        )
        raise HTTPException(422, "AI returned no CAD actions")

    actions = cad_service.prepare_wire_loop_actions(actions, prompt=body.prompt)
    wire_loop_only = cad_service.is_standalone_wire_loop_actions(actions)

    # Safety net: regen-style prompts must not silently re-export the base mesh.
    real_ops = [a for a in actions if a.get("op") != "use_base"]
    if not real_ops and _is_fresh_design_request(body):
        trace_add(
            "warning",
            "Legacy mesh-edit returned use_base only; retrying via kernel",
            trace_id=trace_id,
        )
        updates: dict[str, Any] = {"skills": resolved_skills}
        if body.base_filename:
            updates["base_filename"] = None
        design_body = body.model_copy(update=updates)
        return _prompt_via_kernel(project_id, design_body, trace_id, ai, user, project_path)

    base_mesh = None
    edit_base = None if wire_loop_only else cad_service.resolve_mesh_edit_base(project_path, body.base_filename)
    if edit_base and edit_base != body.base_filename:
        trace_add(
            "info",
            "Resolved mesh-edit base to primary assembly",
            trace_id=trace_id,
            data={"requested": body.base_filename, "resolved": edit_base},
        )
    if edit_base and not wire_loop_only:
        src = project_path / edit_base
        if src.suffix.lower() in cad_service.STEP_SUFFIXES:
            glb = src.with_suffix(".glb")
            if glb.is_file():
                src = glb
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
            ai_traces=ai_trace,
        )
        raise HTTPException(422, f"CAD build failed: {exc}") from exc

    filename = cad_service.resolve_legacy_prompt_output_filename(
        project_path,
        plan,
        actions,
        prompt=body.prompt,
        base_filename=body.base_filename,
    )
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
            "base_filename": body.base_filename,
        },
        user=user,
    )

    hist_entry = _save_prompt_history(
        project_path,
        prompt=body.prompt,
        success=True,
        body=body,
        refs_list=refs_list,
        trace_id=trace_id,
        user=user,
        message=plan_message,
        filename=out_path.name,
        ai_traces=ai_trace,
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
        "prompt_id": hist_entry.get("id") if hist_entry else None,
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
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Build a parametric Feature Program with the B-rep kernel (background job).

    Returns 202 immediately; poll GET /generation for completion.
    """
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    project_path = _require_project(user, project_id)
    label = program.get("name") or program.get("description") or "Ribbon build"
    try:
        generation_service.start(
            project_path,
            kind="build",
            trace_id=trace_id,
            user=user,
            label=str(label)[:120],
        )
    except generation_service.GenerationCanceled as exc:
        raise HTTPException(499, exc.message) from exc
    except generation_service.GenerationInProgress as exc:
        raise HTTPException(409, "Generation already in progress for this project") from exc
    background_tasks.add_task(_background_kernel_build, project_id, program, trace_id, dict(user))
    return JSONResponse(
        status_code=202,
        content={
            "accepted": True,
            "status": "running",
            "trace_id": trace_id,
            "generation": generation_service.public_summary(project_path),
        },
    )


@app.post("/api/projects/{project_id}/files/{filename}/transform")
def transform_file(
    project_id: str,
    filename: str,
    body: TransformRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    safe = Path(filename).name
    src = project_path / safe
    if not src.is_file():
        raise HTTPException(404, "File not found")
    mesh = cad_service.load_mesh(src)
    transform = body.model_dump(exclude_none=True, exclude={"mode", "copy"})
    mesh = cad_service.apply_transform(mesh, transform)
    if body.copy:
        base = src.stem.replace("_edited", "")
        stem = f"{base}_copy"
        i = 2
        while (project_path / f"{stem}.glb").exists():
            stem = f"{base}_copy{i}"
            i += 1
    else:
        stem = src.stem.replace("_edited", "") + "_edited"
    out = project_path / f"{stem}.glb"
    cad_service.export_mesh(mesh, out)
    entry = _record_history(project_path, "transform", "Transform", out.name, meta=transform, user=user)
    _append_mesh_edit(project_path, safe, {"op": "transform", "parent": safe, "child": out.name, **transform, "copy": body.copy})
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "replace_catalog": safe,
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
        "parent": safe,
        "replace_catalog": safe,
        "action": "transform",
    }


@app.post("/api/projects/{project_id}/files/{filename}/transform-body")
def transform_body_file(
    project_id: str,
    filename: str,
    body: BodyTransformRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    safe = Path(filename).name
    src = project_path / safe
    if not src.is_file():
        raise HTTPException(404, "File not found")
    mesh = cad_service.load_mesh(src)
    transform = body.model_dump(exclude_none=True, exclude={"mode", "copy", "body_index"})
    try:
        mesh = cad_service.transform_mesh_body(mesh, body.body_index, transform)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    cad_service.export_mesh(mesh, src)
    meta = {**transform, "body_index": body.body_index, "parent": safe}
    entry = _record_history(project_path, "transform", f"Transform body {body.body_index + 1}", safe, meta=meta, user=user)
    _append_mesh_edit(project_path, safe, {"op": "transform_body", "parent": safe, "child": safe, **meta})
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": safe,
            "url": f"/api/projects/{project_id}/files/{safe}",
            "replace_catalog": safe,
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "body_transform",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": safe,
        "url": f"/api/projects/{project_id}/files/{safe}",
        "timeline_index": entry["index"],
        "parent": safe,
        "replace_catalog": safe,
        "action": "body_transform",
    }


@app.post("/api/projects/{project_id}/files/{filename}/paint")
def paint_file(
    project_id: str,
    filename: str,
    body: PaintRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    scope = (body.scope or "object").lower()
    mesh = cad_service.load_mesh(src)
    if scope == "faces":
        indices: list[int] = []
        if body.face_indices:
            indices.extend(int(i) for i in body.face_indices)
        for ref in body.references:
            if ref.type != "face" and ref.face_index is None:
                continue
            if ref.face_indices:
                indices.extend(int(i) for i in ref.face_indices)
            elif ref.face_index is not None:
                indices.append(int(ref.face_index))
        indices = sorted({i for i in indices if i >= 0})
        if not indices:
            raise HTTPException(400, "Pick one or more faces before coloring faces.")
        mesh = cad_service.paint_faces(mesh, indices, body.color)
        label = f"Paint {len(indices)} face{'s' if len(indices) != 1 else ''}"
        meta = {"scope": "faces", "face_indices": indices, "color": body.color}
    elif scope == "object":
        mesh = cad_service.set_mesh_material(mesh, body.color)
        label = "Paint object"
        meta = {"scope": "object", "color": body.color}
    else:
        raise HTTPException(400, "scope must be 'object' or 'faces'")

    # Replace the edited file so assemblies keep their component filenames stable.
    out = src.with_suffix(".glb")
    cad_service.export_mesh(mesh, out)
    entry = _record_history(project_path, "transform", label, out.name, meta=meta, user=user)
    _append_mesh_edit(project_path, filename, {"op": "paint", "parent": filename, "child": out.name, **meta})
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "paint",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "action": "paint",
        "scope": scope,
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
        distance = cad_service.length_from_mm(mesh, body.distance_mm)
        mesh = cad_service.extrude_face(
            mesh,
            face_index,
            distance,
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
    _append_mesh_edit(project_path, filename, {"op": "extrude", "parent": filename, "child": out.name, **meta})
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
        "parent": filename,
    }


@app.post("/api/projects/{project_id}/files/{filename}/draw-hole")
def draw_hole_file(
    project_id: str,
    filename: str,
    body: DrawHoleRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    mesh = cad_service.load_mesh(src)
    try:
        if body.placement == "center":
            if body.face_index is None:
                raise ValueError("Pick a face first so Draw can find the face center.")
            position, axis = cad_service.face_region_center_and_normal(mesh, body.face_index)
        else:
            if not body.position:
                raise ValueError("Pick a face or point first so Draw knows where to place the hole.")
            position = body.position
            axis = body.normal or [0, 0, 1]
        diameter = cad_service.length_from_mm(mesh, body.diameter_mm)
        depth = cad_service.length_from_mm(mesh, body.depth_mm) if body.depth_mm is not None else None
        count = int(body.pattern_count or 1)
        if count > 1:
            center = position
            ax = [float(v) for v in (axis or [0, 0, 1])]
            norm = math.sqrt(sum(v * v for v in ax)) or 1.0
            n = [v / norm for v in ax]
            helper = [0.0, 0.0, 1.0] if abs(n[2]) < 0.9 else [1.0, 0.0, 0.0]
            u = [
                n[1] * helper[2] - n[2] * helper[1],
                n[2] * helper[0] - n[0] * helper[2],
                n[0] * helper[1] - n[1] * helper[0],
            ]
            u_norm = math.sqrt(sum(v * v for v in u)) or 1.0
            u = [v / u_norm for v in u]
            v = [
                n[1] * u[2] - n[2] * u[1],
                n[2] * u[0] - n[0] * u[2],
                n[0] * u[1] - n[1] * u[0],
            ]
            radius_mm = body.pattern_radius_mm or max(body.diameter_mm * 2.5, body.diameter_mm + 2.0)
            radius = cad_service.length_from_mm(mesh, radius_mm)
            result = mesh
            for i in range(count):
                t = (math.tau * i) / count
                pt = [
                    center[j] + radius * (math.cos(t) * u[j] + math.sin(t) * v[j])
                    for j in range(3)
                ]
                result = cad_service.hole_at_point(
                    result,
                    pt,
                    axis=axis,
                    diameter=diameter,
                    depth=depth,
                    through=body.through_all,
                )
        else:
            result = cad_service.hole_at_point(
                mesh,
                position,
                axis=axis,
                diameter=diameter,
                depth=depth,
                through=body.through_all,
            )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    stem = src.stem.replace("_edited", "").replace("_hole", "") + "_hole"
    out = project_path / f"{stem}.glb"
    cad_service.export_mesh(result, out)
    meta = {
        "face_index": body.face_index,
        "position": position,
        "normal": axis,
        "diameter_mm": body.diameter_mm,
        "depth_mm": body.depth_mm,
        "placement": body.placement,
        "through_all": body.through_all,
        "pattern_count": body.pattern_count,
        "pattern_radius_mm": body.pattern_radius_mm,
    }
    entry = _record_history(
        project_path,
        "hole",
        f"Hole {body.diameter_mm:g}mm",
        out.name,
        meta=meta,
        user=user,
    )
    _append_mesh_edit(project_path, filename, {"op": "draw_hole", "parent": filename, "child": out.name, **meta})
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "draw_hole",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "meta": meta,
        "parent": filename,
        "action": "draw_hole",
        "message": (
            f"Added {count} holes, {body.diameter_mm:g} mm diameter"
            if count > 1
            else f"Added a {body.diameter_mm:g} mm {'through-' if body.through_all else 'blind '}hole."
        ),
    }


@app.post("/api/projects/{project_id}/files/{filename}/draw-route")
def draw_route_file(
    project_id: str,
    filename: str,
    body: DrawRouteRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")
    mesh = cad_service.load_mesh(src)
    try:
        route_type = "loops" if body.route_type in {"loop", "loops", "wire_loops", "clips"} else "duct"
        result = cad_service.add_route_geometry(
            mesh,
            body.points,
            style=route_type,
            radius=cad_service.length_from_mm(mesh, body.diameter_mm / 2.0),
            loop_width=cad_service.length_from_mm(mesh, body.loop_width_mm) if body.loop_width_mm else None,
            loop_height=cad_service.length_from_mm(mesh, body.loop_height_mm) if body.loop_height_mm else None,
            loop_spacing=cad_service.length_from_mm(mesh, body.loop_spacing_mm) if body.loop_spacing_mm else None,
            surface_normals=body.surface_normals,
            surface_locked=body.surface_locked,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    suffix = "_loops" if route_type == "loops" else "_duct"
    stem = src.stem.replace("_edited", "").replace("_hole", "").replace("_duct", "").replace("_loops", "") + suffix
    out = project_path / f"{stem}.glb"
    cad_service.export_mesh(result, out)
    meta = {
        "route_type": route_type,
        "point_count": len(body.points),
        "points": body.points[:80],
        "surface_locked": body.surface_locked,
        "surface_normals": body.surface_normals[:80] if body.surface_normals else None,
        "diameter_mm": body.diameter_mm,
        "loop_width_mm": body.loop_width_mm,
        "loop_height_mm": body.loop_height_mm,
        "loop_spacing_mm": body.loop_spacing_mm,
    }
    label = "Wire loops" if route_type == "loops" else "Wire duct"
    entry = _record_history(
        project_path,
        "draw_route",
        f"{label} along path",
        out.name,
        meta=meta,
        user=user,
    )
    _append_mesh_edit(project_path, filename, {"op": "draw_route", "parent": filename, "child": out.name, **meta})
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "draw_route",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "meta": meta,
        "parent": filename,
        "action": "draw_route",
        "message": f"Added {label.lower()} along {len(body.points)} path points.",
    }


def _edited_output(project_path: Path, src: Path, suffix: str) -> Path:
    base = src.stem
    for tag in ("_edited", "_pulled", "_mirrored", "_body"):
        base = base.replace(tag, "")
    stem = f"{base}{suffix}"
    if (project_path / f"{stem}.glb").exists() and suffix == "_body":
        i = 2
        while (project_path / f"{base}_body{i}.glb").exists():
            i += 1
        stem = f"{base}_body{i}"
    return project_path / f"{stem}.glb"


@app.post("/api/projects/{project_id}/files/{filename}/face-pull")
def face_pull_file(
    project_id: str,
    filename: str,
    body: FacePullRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Fusion-style press-pull: drag a planar face region to join/cut material."""
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    mesh = cad_service.load_mesh(src)
    try:
        result = cad_service.face_pull(
            mesh,
            body.face_index,
            distance=body.distance,
            op=body.op,
            direction=body.direction,
            distance2=body.distance2,
            taper_deg=body.taper_deg,
            through=body.through_all,
            normal=body.normal,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    suffix = "_body" if body.op == "new_body" else "_pulled"
    out = _edited_output(project_path, src, suffix)
    cad_service.export_mesh(result, out)
    op_label = body.op if body.op != "auto" else ("cut" if body.distance < 0 else "join")
    meta = body.model_dump()
    entry = _record_history(
        project_path,
        "face_pull",
        f"Press-pull {op_label} {abs(body.distance):g}",
        out.name,
        meta=meta,
        user=user,
    )
    _append_mesh_edit(project_path, filename, {"op": "face_pull", "parent": filename, "child": out.name, **meta})
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "face_pull",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "meta": meta,
        "parent": filename,
    }


def _program_file_for(project_path: Path, glb_filename: str) -> "Path | None":
    """Resolve the .program.json that corresponds to a .glb filename."""
    stem = Path(glb_filename).stem
    for suffix in ("_filleted", "_chamfered", "_pulled", "_mirrored", "_body"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
    candidate = project_path / f"{stem}.program.json"
    return candidate if candidate.is_file() else None


@app.post("/api/projects/{project_id}/files/{filename}/fillet-edges")
def fillet_edges_file(
    project_id: str,
    filename: str,
    body: FilletRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Apply a global fillet to all edges of a parametric model via its program."""
    project_path = _require_project(user, project_id)
    prog = _program_file_for(project_path, filename)
    if not prog:
        raise HTTPException(422, "No program file found. Fillet requires a parametric model generated by AI prompt.")
    try:
        out_path = cad_service.apply_program_fillet(
            project_path, prog.name, body.radius_mm, edges=body.edges
        )
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    meta = body.model_dump()
    entry = _record_history(
        project_path, "fillet", f"Fillet r={body.radius_mm}mm {body.edges} edges",
        out_path.name, meta=meta, user=user,
    )
    project_store.touch_project(project_path)
    _notify_project(project_id, {
        "type": "model.reload", "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "by": user["display_name"], "by_user_id": user["id"],
        "action": "fillet", "timeline_entry": entry,
    })
    return {
        "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "timeline_index": entry["index"],
        "meta": meta,
    }


@app.post("/api/projects/{project_id}/files/{filename}/chamfer-edges")
def chamfer_edges_file(
    project_id: str,
    filename: str,
    body: ChamferRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Apply a global chamfer to edges of a parametric model via its program."""
    project_path = _require_project(user, project_id)
    prog = _program_file_for(project_path, filename)
    if not prog:
        raise HTTPException(422, "No program file found. Chamfer requires a parametric model generated by AI prompt.")
    try:
        out_path = cad_service.apply_program_chamfer(
            project_path, prog.name, body.length_mm, edges=body.edges
        )
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    meta = body.model_dump()
    entry = _record_history(
        project_path, "chamfer", f"Chamfer d={body.length_mm}mm {body.edges} edges",
        out_path.name, meta=meta, user=user,
    )
    project_store.touch_project(project_path)
    _notify_project(project_id, {
        "type": "model.reload", "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "by": user["display_name"], "by_user_id": user["id"],
        "action": "chamfer", "timeline_entry": entry,
    })
    return {
        "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "timeline_index": entry["index"],
        "meta": meta,
    }


@app.post("/api/projects/{project_id}/files/{filename}/mirror")
def mirror_file(
    project_id: str,
    filename: str,
    body: MirrorMeshRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Mirror a model across an origin/custom plane with keep/join/replace."""
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    mesh = cad_service.load_mesh(src)
    try:
        result = cad_service.mirror_mesh(
            mesh,
            plane=body.plane,
            normal=body.normal,
            origin=body.origin,
            offset=body.offset,
            mode=body.mode,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    out = _edited_output(project_path, src, "_mirrored")
    cad_service.export_mesh(result, out)
    meta = body.model_dump()
    entry = _record_history(
        project_path,
        "mirror",
        f"Mirror {body.plane} ({body.mode})",
        out.name,
        meta=meta,
        user=user,
    )
    _append_mesh_edit(project_path, filename, {"op": "mirror", "parent": filename, "child": out.name, **meta})
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "mirror",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "meta": meta,
        "parent": filename,
    }


def _mesh_cleanup_face_indices(body: MeshCleanupRequest) -> tuple[list[int], str]:
    """Resolve triangle selection from explicit indices or geometric references."""
    refs = [r.model_dump() for r in body.references]
    from_refs = cad_service.face_indices_from_refs(refs)
    explicit = sorted({int(i) for i in (body.face_indices or [])})
    face_indices = sorted(set(from_refs) | set(explicit))
    scope = (body.scope or "auto").strip().lower()
    if scope == "auto":
        scope = "selection" if face_indices else "whole"
    if scope == "selection" and not face_indices:
        raise HTTPException(422, "Selection scope requires a face or lasso pick (@face / @lasso).")
    if scope == "whole":
        face_indices = []
    return face_indices, scope


@app.post("/api/projects/{project_id}/files/{filename}/mesh-cleanup")
def mesh_cleanup_file(
    project_id: str,
    filename: str,
    body: MeshCleanupRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Topology checkup and optional repair/smoothing for mesh files."""
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    try:
        face_indices, scope = _mesh_cleanup_face_indices(body)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    mesh = cad_service.load_mesh(src)
    smooth_method = body.smooth_method if body.smooth_method in {"taubin", "laplacian"} else "taubin"

    if not body.apply:
        report = cad_service.analyze_mesh_topology(mesh, face_indices=face_indices or None)
        return {
            "filename": filename,
            "scope": scope,
            "report": report,
            "applied": False,
        }

    try:
        result, details = cad_service.cleanup_mesh(
            mesh,
            face_indices=face_indices or None,
            repair=body.repair,
            smooth=body.smooth,
            smooth_method=smooth_method,
            smooth_iterations=body.smooth_iterations,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    out = _edited_output(project_path, src, "_cleaned")
    cad_service.export_mesh(result, out)
    meta = {
        "scope": scope,
        "repair": body.repair,
        "smooth": body.smooth,
        "smooth_method": smooth_method,
        "smooth_iterations": body.smooth_iterations,
        "face_indices": face_indices[:200],
        "changes": details.get("changes", []),
        "before": details.get("before"),
        "after": details.get("after"),
    }
    label_bits = []
    if body.repair:
        label_bits.append("repair")
    if body.smooth:
        label_bits.append(f"smooth {smooth_method}")
    entry = _record_history(
        project_path,
        "mesh_cleanup",
        f"Mesh checkup ({scope}): {', '.join(label_bits) or 'check'}",
        out.name,
        meta=meta,
        user=user,
    )
    _append_mesh_edit(
        project_path,
        filename,
        {"op": "mesh_cleanup", "parent": filename, "child": out.name, **meta},
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
            "action": "mesh_cleanup",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "scope": scope,
        "report": details.get("after"),
        "before": details.get("before"),
        "changes": details.get("changes", []),
        "applied": True,
        "parent": filename,
    }


@app.get("/api/projects/{project_id}/files/{filename}/bodies")
def mesh_bodies_info(
    project_id: str,
    filename: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Report disconnected body count for split/delete object tools."""
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")
    mesh = cad_service.load_mesh(src)
    return cad_service.mesh_body_info(mesh)


@app.post("/api/projects/{project_id}/files/{filename}/split-bodies")
def split_bodies_file(
    project_id: str,
    filename: str,
    body: SplitBodiesRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Split disconnected bodies into separate files (Fusion-style Separate)."""
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    mesh = cad_service.load_mesh(src)
    try:
        bodies = cad_service.split_mesh_bodies(mesh)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    stem = src.stem
    suffix = src.suffix.lower() or ".glb"
    if suffix not in {".stl", ".glb", ".obj", ".ply", ".off", ".3mf"}:
        suffix = ".glb"
    outputs: list[str] = []
    for i, part in enumerate(bodies, start=1):
        out = project_path / f"{stem}_body{i}{suffix}"
        n = 2
        while out.exists() and out.name != filename:
            out = project_path / f"{stem}_body{i}_{n}{suffix}"
            n += 1
        cad_service.export_mesh(part, out)
        outputs.append(out.name)

    entry = _record_history(
        project_path,
        "split_bodies",
        f"Split {len(outputs)} bodies",
        outputs[0],
        meta={"parent": filename, "outputs": outputs, "keep_original": body.keep_original},
        user=user,
    )
    _append_mesh_edit(
        project_path,
        filename,
        {"op": "split_bodies", "parent": filename, "outputs": outputs},
    )
    project_store.touch_project(project_path)
    primary = outputs[0]
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "split_bodies",
            "timeline_entry": entry,
        },
    )
    return {
        "files": outputs,
        "count": len(outputs),
        "parent": filename,
        "filename": primary,
        "url": f"/api/projects/{project_id}/files/{primary}",
        "timeline_index": entry["index"],
        "keep_original": body.keep_original,
    }


@app.post("/api/projects/{project_id}/files/{filename}/remove-body")
def remove_body_file(
    project_id: str,
    filename: str,
    body: RemoveBodyRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Remove one disconnected body from a multi-body mesh file."""
    project_path = _require_project(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")

    mesh = cad_service.load_mesh(src)
    try:
        result = cad_service.remove_mesh_body(mesh, body.body_index)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    meta = {**body.model_dump(), "parent": filename, "snapshot_after_op": True}
    cad_service.export_mesh(result, src)
    entry = _record_history(
        project_path,
        "remove_body",
        f"Remove body {body.body_index + 1}",
        src.name,
        meta=meta,
        user=user,
    )
    _append_mesh_edit(
        project_path,
        filename,
        {"op": "remove_body", "parent": filename, "child": src.name, **body.model_dump()},
    )
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": src.name,
            "url": f"/api/projects/{project_id}/files/{src.name}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "remove_body",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": src.name,
        "url": f"/api/projects/{project_id}/files/{src.name}",
        "timeline_index": entry["index"],
        "timeline": history_service.timeline_summary(project_path),
        "parent": filename,
        "body_index": body.body_index,
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


@app.websocket("/api/ws/user")
async def user_ws(websocket: WebSocket, token: str = Query(...)):
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    user = get_user_by_id(user_id)
    if not user:
        await websocket.close(code=4403)
        return
    try:
        await hub.connect_user(websocket, user)
    except WebSocketDisconnect:
        return


if FRONTEND.is_dir():
    @app.get("/", include_in_schema=False)
    def frontend_index():
        return FileResponse(FRONTEND / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend_spa_fallback(full_path: str):
        # Let normal API/websocket routes match above. For the SPA, support
        # refreshes/deep links like /projects/<id> by returning index.html.
        target = (FRONTEND / full_path).resolve()
        try:
            target.relative_to(FRONTEND.resolve())
        except ValueError:
            raise HTTPException(404, "Not found")
        if target.is_file():
            return FileResponse(target)
        if "." not in Path(full_path).name:
            return FileResponse(FRONTEND / "index.html")
        raise HTTPException(404, "Not found")
