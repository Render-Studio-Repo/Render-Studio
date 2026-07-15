"""Render3D — CAD project visualizer API."""

from __future__ import annotations

import base64
from collections import Counter
import json
import logging
import math
import re
import secrets
import shutil
import threading
import time
import urllib.parse
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from fastapi import BackgroundTasks, Body, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from backend.auth import create_access_token, get_current_user, get_current_user_optional, get_user_by_id
from backend.config import settings
from backend.database import get_conn, init_db
from backend.services import cad_service
from backend.services.ai_service import AIService
from backend.services import (
    agent_marketplace_service,
    folders_service,
    generation_service,
    history_service,
    project_log_service,
    project_store,
    prompt_history_service,
    workspace_log_service,
)
from backend.services import kernel_bridge
from backend.services.design_service import is_custom_sketch_structural_request
from backend.services.design_service import is_custom_sketch_structural_request
from backend.services import teams_service
from backend.services import skills_service, user_ai_keys_service
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
AVATARS = ROOT / "data" / "avatars"
PROJECTS.mkdir(parents=True, exist_ok=True)
AVATARS.mkdir(parents=True, exist_ok=True)

A1PROJECTS_ADMIN_EMAILS = {
    "a1projects@protonmail.com",
    "a1projects.usa@gmail.com",
    "mtgraytech@gmail.com",
}
OTHER_USER_RENDERS_FOLDER_ID = "__other_user_renders__"
OTHER_USER_RENDERS_FOLDER_NAME = "New renders from other users"
PUBLIC_FOLDER_ID = "__public__"
PUBLIC_FOLDER_NAME = "Public"
VIEWPORT_WORKSPACE_ACTIVITY_KINDS = {
    "upload",
    "delete_object",
    "transform",
    "paint",
    "extrude",
    "hole",
    "draw_route",
    "face_pull",
    "fillet",
    "chamfer",
    "mirror",
    "mesh_cleanup",
    "split_bodies",
    "remove_body",
}

app = FastAPI(title="Render3D", description="CAD project visualizer with AI prompting")


def _recover_stuck_generations() -> None:
    """Mark in-flight jobs as failed after a server stop — do not auto re-run them.

    Re-queuing prompt jobs burns API credits on duplicate AI calls. Users can
    retry manually once the server is back up.
    """
    import fcntl

    lock_path = PROJECTS / ".generation-recovery.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_file = lock_path.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        logger.info("Another worker is clearing stuck generations; skipping")
        lock_file.close()
        return

    try:
        stuck = generation_service.find_stuck_jobs(PROJECTS)
        if not stuck:
            return
        logger.info("Found %d stuck generation(s) to mark failed on startup", len(stuck))
        for job in stuck:
            project_path_ = job["project_path"]
            original_trace = job.get("trace_id") or ""
            original_data = job["data"] or {}
            original_mode = str(original_data.get("mode") or (original_data.get("request_body") or {}).get("mode") or "").lower()
            message = (
                "Generation was interrupted by server restart. Please retry the prompt."
                if original_mode in {"v2", "fusion", "architect"}
                else "Generation interrupted by server restart. Please retry."
            )
            generation_service.fail(project_path_, message, trace_id=original_trace)
            logger.info(
                "Marked interrupted %s job failed project=%s trace=%s",
                original_mode or "prompt",
                job["project_id"],
                original_trace,
            )
    finally:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        lock_file.close()


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
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response


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
    type: str = Field(..., description="vertex | edge | face | corner | lasso | path | component | dxf | document")
    position: list[float] | None = None
    normal: list[float] | None = None
    local_point: list[float] | None = None
    face_index: int | None = None
    face_indices: list[int] | None = None
    face_area: float | None = None
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
    text_content: str | None = Field(default=None, max_length=100_000)
    text_truncated: bool | None = None
    body_index: int | None = None
    body_name: str | None = None
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
    mode: str = Field(default="standard", description="standard (Render), v2, fusion, or architect")
    fusion_target: str | None = Field(default=None, description="in_app or fusion360")
    convert_images_to_drawing: bool = Field(
        default=False,
        description="When true and images are attached, run vision→DXF drawing + enriched prompt before CAD.",
    )
    ai_key_id: str | None = Field(default=None, max_length=64)
    ai_key_source: str | None = Field(default=None, description="personal or team")
    jake_codex_agent: bool = Field(
        default=False,
        description="Deprecated alias for codex_agent.",
    )
    codex_agent: bool = Field(
        default=False,
        description="Opt-in: run CAD 2.0 with host Codex + cad@text-to-cad plugin (uses server ChatGPT login).",
    )


class SceneRenderRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    viewport_image: str = Field(..., max_length=10_000_000)
    base_filename: str | None = Field(None, max_length=240)
    speed: str = "fast"
    ai_key_id: str | None = Field(default=None, max_length=64)
    ai_key_source: str | None = Field(default=None, description="personal or team")


class SkillPlanRequest(BaseModel):
    prompt: str = Field(default="", max_length=8000)
    skills: list[str] = Field(default_factory=list, max_length=20)
    has_images: bool = False


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


class CadParamsUpdateRequest(BaseModel):
    params: dict[str, float | int | str | bool] = Field(default_factory=dict, max_length=80)
    part: str | None = Field(default=None, max_length=120)


class ExtrudeRequest(BaseModel):
    face_index: int | None = None
    at_ref: str | None = None
    distance_mm: float = Field(..., gt=0, le=5000)
    inward: bool = False
    axis: list[float] | None = None


class FacePullRequest(BaseModel):
    """Fusion-style press-pull. Distance is signed, in model units (viewer units)."""

    face_index: int | None = Field(default=None, ge=0)
    face_indices: list[int] | None = None
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


class CreatePrimitiveRequest(BaseModel):
    op: str = Field(..., description="box | cylinder | sphere | cone | torus")
    combine: str = Field(default="new", description="new | add | cut | intersect")
    base_filename: str | None = Field(default=None, description="Existing model to boolean with when combine != new")
    at: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0], min_length=3, max_length=3)
    length: float | None = Field(default=None, gt=0, le=10000)
    width: float | None = Field(default=None, gt=0, le=10000)
    height: float | None = Field(default=None, gt=0, le=10000)
    radius: float | None = Field(default=None, gt=0, le=5000)
    bottom_radius: float | None = Field(default=None, gt=0, le=5000)
    top_radius: float | None = Field(default=None, ge=0, le=5000)
    major_radius: float | None = Field(default=None, gt=0, le=5000)
    minor_radius: float | None = Field(default=None, gt=0, le=5000)


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
    preview: bool = Field(default=False, description="When true, return a temporary preview without timeline history")


class ChamferRequest(BaseModel):
    length_mm: float = Field(..., gt=0, description="Chamfer distance in mm")
    edges: str = Field(default="top", description="top | vertical | bottom | all")
    preview: bool = Field(default=False, description="When true, return a temporary preview without timeline history")


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


class ReferenceMarkupRequest(BaseModel):
    notes: str = ""
    strokes: list[Any] = Field(default_factory=list)


class ReferenceTextRequest(BaseModel):
    content: str = ""


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
    scope_type: str | None = Field("all", max_length=20)
    scope_project_id: str | None = Field(None, max_length=64)
    scope_label: str | None = Field(None, max_length=160)


class UserAIKeyRenameRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    model: str | None = Field(None, min_length=1, max_length=120)


class AutodeskCredentialsRequest(BaseModel):
    client_id: str = Field(..., min_length=10, max_length=256)
    client_secret: str = Field(..., min_length=20, max_length=512)
    redirect_uri: str = Field(default="https://render3d.app/oauth/autodesk/callback", max_length=512)


class AgentAppSubmitRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    tagline: str = Field(..., min_length=1, max_length=180)
    description: str = Field(..., min_length=1, max_length=4000)
    category: str = Field(default="agent", max_length=80)
    app_type: str = Field(default="skill", max_length=40)
    manifest: dict[str, Any] = Field(default_factory=dict)
    source_url: str | None = Field(default=None, max_length=600)
    icon_url: str | None = Field(default=None, max_length=600)
    price_cents: int = Field(default=0, ge=0, le=1_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=8)
    premium: bool = False


class AgentAppReviewRequest(BaseModel):
    status: str = Field(..., description="pending | approved | rejected | archived")
    featured: bool | None = None


class TeamCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class TeamRenderFolderRequest(BaseModel):
    provider: str = Field("render3d", max_length=40)
    folder_ref: str | None = Field(None, max_length=600)
    label: str | None = Field(None, max_length=180)


class TeamInviteRequest(BaseModel):
    email: EmailStr


class FolderCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    parent_id: str | None = None


class FolderRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class ProjectFolderRequest(BaseModel):
    folder_id: str | None = None
    before_project_id: str | None = None
    at_end: bool = False


class WiringSaveRequest(BaseModel):
    components: list[dict[str, Any]] = []
    wires: list[dict[str, Any]] = []


class FolderShareRequest(BaseModel):
    email: EmailStr
    restrict_access: bool = True


class FolderCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    parent_id: str | None = None


class FolderRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


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
    driver_links: list[str] = Field(default_factory=list, max_length=3)
    speed: str = "fast"
    ai_key_id: str | None = None
    ai_key_source: str | None = None


class RenderAgentAttachment(BaseModel):
    id: str | None = None
    name: str = Field(..., max_length=180)
    media_type: str | None = Field(None, max_length=120)
    text: str | None = Field(None, max_length=20000)
    data_url: str | None = Field(None, max_length=10_000_000)


class RenderAgentThreadCreateRequest(BaseModel):
    title: str | None = Field(None, max_length=80)


class RenderAgentMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    thread_id: str | None = Field(None, max_length=80)
    project_id: str | None = Field(None, max_length=80)
    attachments: list[RenderAgentAttachment] = Field(default_factory=list, max_length=6)
    speed: str = "fast"
    ai_key_id: str | None = Field(default=None, max_length=64)
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


class RiggingArtifactGenerateRequest(BaseModel):
    source: str = Field(..., min_length=1, max_length=240)
    kind: str = Field(default="both", description="urdf | srdf | both")


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


def _require_project_delete(user: dict[str, Any], project_id: str) -> Path:
    path = PROJECTS / project_id
    if not path.is_dir():
        raise HTTPException(404, "Project not found")
    if teams_service.can_access_project(user["id"], project_id):
        return path
    if _is_a1projects_admin(user) and _is_public_project(project_id):
        return path
    raise HTTPException(404, "Project not found")


def _is_a1projects_admin(user: dict[str, Any] | None) -> bool:
    return (user or {}).get("email", "").strip().lower() in A1PROJECTS_ADMIN_EMAILS


def _require_a1projects_admin(user: dict[str, Any]) -> None:
    if not _is_a1projects_admin(user):
        raise HTTPException(403, "Admin dashboard is only available to the a1projects user.")


def _parse_admin_dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _admin_day(raw: Any) -> str | None:
    dt = _parse_admin_dt(raw)
    return dt.date().isoformat() if dt else None


def _admin_prompt_preview(prompt: Any, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(prompt or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _project_owner(project_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT pa.project_id, pa.team_id, pa.folder_id, pa.created_by, pa.is_public,
                   u.email AS owner_email, u.display_name AS owner_name
            FROM project_access pa
            LEFT JOIN users u ON u.id = pa.created_by
            WHERE pa.project_id = ?
            """,
            (project_id,),
        ).fetchone()
    return dict(row) if row else None


def _is_public_project(project_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT is_public FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
    if not row or not bool(row["is_public"]):
        return False
    project_path = PROJECTS / project_id
    return project_path.is_dir() and bool(cad_service.list_project_files(project_path))


def _public_project_summaries(
    *,
    exclude_ids: set[str] | None = None,
    viewer_user: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    exclude_ids = exclude_ids or set()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT pa.project_id, pa.created_by, u.email AS owner_email, u.display_name AS owner_name
            FROM project_access pa
            LEFT JOIN users u ON u.id = pa.created_by
            WHERE pa.is_public = 1
            ORDER BY pa.created_at DESC
            """
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        project_id = row["project_id"]
        if project_id in exclude_ids:
            continue
        project_path = PROJECTS / project_id
        if not project_path.is_dir():
            continue
        summary = project_store.project_summary(project_path)
        if not summary.get("file_count"):
            continue
        can_manage = bool(viewer_user and teams_service.can_access_project(viewer_user["id"], project_id))
        out.append(
            {
                **summary,
                "team_id": None,
                "folder_id": PUBLIC_FOLDER_ID,
                "read_only_project": not can_manage,
                "public": True,
                "owner_user_id": row["created_by"],
                "owner_email": row["owner_email"],
                "owner_name": row["owner_name"],
            }
        )
    return out


def _public_folder_summary(projects: list[dict[str, Any]] | None = None, team_id: str | None = None) -> dict[str, Any]:
    return {
        "id": PUBLIC_FOLDER_ID,
        "team_id": team_id,
        "parent_id": None,
        "name": PUBLIC_FOLDER_NAME,
        "sort_order": -200,
        "visibility": "public",
        "created_by": None,
        "created_at": None,
        "project_count": len(projects) if projects is not None else len(_public_project_summaries()),
        "share_count": 0,
        "can_manage": False,
        "is_owner": False,
        "shared_with_me": False,
        "read_only": True,
        "virtual": True,
        "public": True,
    }


def _is_other_user_render_project(project_id: str, user: dict[str, Any]) -> bool:
    if not _is_a1projects_admin(user):
        return False
    owner = _project_owner(project_id)
    if not owner or owner.get("created_by") == user["id"]:
        return False
    project_path = PROJECTS / project_id
    if not project_path.is_dir():
        return False
    return bool(cad_service.list_project_files(project_path))


def _require_project_read(user: dict[str, Any], project_id: str) -> Path:
    if teams_service.can_access_project(user["id"], project_id) or _is_other_user_render_project(project_id, user) or _is_public_project(project_id):
        path = PROJECTS / project_id
        if path.is_dir():
            return path
    raise HTTPException(404, "Project not found")


def _other_user_render_summaries(user: dict[str, Any], team_id: str | None = None) -> list[dict[str, Any]]:
    if not _is_a1projects_admin(user):
        return []
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT pa.project_id, pa.created_by, u.email AS owner_email, u.display_name AS owner_name
            FROM project_access pa
            LEFT JOIN users u ON u.id = pa.created_by
            WHERE pa.created_by IS NOT NULL AND pa.created_by != ?
            ORDER BY pa.created_at DESC
            """,
            (user["id"],),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        project_path = PROJECTS / row["project_id"]
        if not project_path.is_dir():
            continue
        summary = project_store.project_summary(project_path)
        if not summary.get("file_count"):
            continue
        out.append(
            {
                **summary,
                "team_id": team_id,
                "folder_id": OTHER_USER_RENDERS_FOLDER_ID,
                "read_only_project": True,
                "owner_user_id": row["created_by"],
                "owner_email": row["owner_email"],
                "owner_name": row["owner_name"],
            }
        )
    return out


def _record_history(
    project_path: Path,
    kind: str,
    label: str,
    filename: str,
    meta: dict | None = None,
    user: dict[str, Any] | None = None,
):
    # Fusion sync / Autodesk bulk pulls must not snapshot every project file —
    # that blocked the single API worker and made viewport model loads hang.
    snapshot_mode = "primary" if kind in {"fusion_sync", "autodesk_import"} else "all"
    entry = history_service.append_entry(
        project_path,
        kind=kind,
        label=label,
        filename=filename,
        meta=meta,
        user_id=user["id"] if user else None,
        user_name=user["display_name"] if user else None,
        user_avatar_url=_avatar_url_for_user_id(user["id"]) if user else None,
        snapshot_mode=snapshot_mode,
    )
    # Mark Fusion-linked projects dirty so accessing Fusion pushes local edits back.
    if kind not in {"autodesk_import", "fusion_sync", "fusion_push"} and filename:
        suffix = Path(str(filename)).suffix.lower()
        if suffix in {".step", ".stp", ".stl", ".3mf", ".obj", ".glb", ".gltf", ".py"} or not suffix:
            try:
                project_meta = project_store.load_meta(project_path)
                if not project_meta.get("fusion_pending_push"):
                    project_meta["fusion_pending_push"] = True
                    project_store.save_meta(project_path, project_meta)
            except Exception:
                logger.debug("Could not mark fusion_pending_push for %s", project_path.name, exc_info=True)
    log_entry = project_log_service.log_timeline_entry(project_path, entry)
    if user:
        _notify_project_history(project_path.name, log_entry, user)
        if kind in VIEWPORT_WORKSPACE_ACTIVITY_KINDS:
            owner = _project_owner(project_path.name) or {}
            team_id = owner.get("team_id")
            if team_id:
                _log_workspace(
                    team_id,
                    kind=f"viewport_{kind}",
                    label=label,
                    user=user,
                    project_id=project_path.name,
                    meta={
                        "timeline_index": entry.get("index"),
                        "timeline_kind": kind,
                        "filename": filename,
                        **(meta or {}),
                    },
                )
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
    hub.notify(project_id, {**message, "project_id": message.get("project_id") or project_id})


def _broadcast_generation_update(project_path: Path) -> None:
    if not project_path.is_dir():
        return
    summary = generation_service.public_summary(project_path)
    project_id = project_path.name
    payload = {
        "type": "generation.updated",
        "project_id": project_id,
        "generation": summary,
    }
    _notify_project(project_id, payload)
    team_id = None
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT team_id FROM project_access WHERE project_id = ? LIMIT 1",
                (project_id,),
            ).fetchone()
            team_id = row["team_id"] if row else None
    except Exception:
        team_id = None
    if team_id:
        _notify_workspace(team_id, payload)


generation_service.register_listener(_broadcast_generation_update)


def _notify_workspace(team_id: str, message: dict[str, Any]) -> None:
    payload = {**message, "team_id": message.get("team_id") or team_id}
    hub.notify_workspace(team_id, payload)
    for pid in teams_service.team_project_ids(team_id):
        hub.notify(pid, payload)
    for user_id in teams_service.team_member_ids(team_id):
        _notify_user(user_id, payload)


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
            "team_id": team_id,
            "project_id": project_id,
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
            "by_avatar_url": _avatar_url_for_user_id(user["id"]) if user else None,
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
                token_total += int(
                    usage.get("total_tokens")
                    or usage.get("tokens")
                    or (int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
                        + int(usage.get("output_tokens") or usage.get("completion_tokens") or 0))
                    or 0
                )
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
    project_id: str | None = None,
) -> AIService:
    try:
        if key_id:
            effective = user_ai_keys_service.resolve_key_for_user(user["id"], key_id, key_source, project_id=project_id)
        else:
            effective = user_ai_keys_service.get_effective_key_for_user(user["id"], project_id=project_id)
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
        provider = effective.get("provider") or "openai"
        if provider == "openai":
            key_model = (effective.get("model") or "").strip()
            if speed == "fast":
                # Speed mode always uses the fast model — ignore key's pinned model.
                # gpt-5.5-pro is too slow for speed mode (~5-8 min vs ~30s for gpt-5.5).
                model = settings.openai_model
            elif key_model:
                # Quality mode respects the key's pinned model (e.g. gpt-5.5-pro).
                model = key_model
            else:
                model = settings.openai_model_quality
        else:
            model = (effective.get("model") or "").strip() or settings.anthropic_model
        return AIService(model=model, api_key=effective["api_key"], provider=provider)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _ai_from_request_body(
    user: dict[str, Any],
    body: Any,
    *,
    project_id: str | None = None,
) -> AIService:
    speed = getattr(body, "speed", None) or "fast"
    mode = (getattr(body, "mode", None) or "standard").lower()
    # Jake authoring (CAD 2.0 / Fusion / Architect) needs the quality model.
    # UI "fast" only affects repair-budget heuristics, not the CAD skill contract.
    if mode in {"v2", "fusion", "architect"} and speed == "fast":
        speed = "quality"
    return _get_ai_for_user(
        user,
        speed,
        key_id=getattr(body, "ai_key_id", None),
        key_source=getattr(body, "ai_key_source", None),
        project_id=project_id,
    )


def _get_ai_for_prompt(user: dict[str, Any], body: Any, project_id: str | None = None) -> AIService:
    return _ai_from_request_body(user, body, project_id=project_id)


def _get_ai_for_wiring(user: dict[str, Any], body: Any, project_id: str | None = None) -> AIService:
    return _ai_from_request_body(user, body, project_id=project_id)


def _get_ai_for_diagnose(user: dict[str, Any], body: Any, project_id: str | None = None) -> AIService:
    return _ai_from_request_body(user, body, project_id=project_id)


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


def _step_for_cloud_cad(project_path: Path, filename: str, *, allow_faceted: bool = False) -> Path:
    """Return a Fusion/Onshape-editable STEP, refusing mesh-derived faceted STEP by default."""
    safe = Path(filename).name
    src = project_path / safe
    if not src.is_file():
        raise HTTPException(404, "File not found")

    suffix = src.suffix.lower()
    stem = src.stem

    # Prefer generative parent B-rep when the selection is an edited/pulled mesh.
    native = cad_service.resolve_native_brep_step(project_path, safe)
    if native is not None:
        return native

    if suffix in cad_service.STEP_SUFFIXES:
        kind = cad_service.classify_step_file_kind(src)
        if kind == "faceted_mesh" and not allow_faceted:
            raise HTTPException(
                422,
                "This STEP is mesh-derived/faceted (open shells), so Fusion cannot do reliable solid cuts. "
                "Push the original text-to-cad .step (B-rep) instead, regenerate from Python source, "
                "or explicitly allow a faceted STEP export.",
            )
        if kind == "editable_brep" or allow_faceted:
            return src
        if "__faceted" in stem.lower() and not allow_faceted:
            raise HTTPException(
                422,
                "This STEP is mesh-derived/faceted, so Fusion may not allow reliable solid cuts. "
                "Use the original generated STEP/B-rep model, regenerate from source, or explicitly allow a faceted STEP export.",
            )
        # Unknown STEP content — only allow if caller opts into faceted risk.
        if not allow_faceted:
            raise HTTPException(
                422,
                "Could not verify this STEP as a solid B-rep. Fusion solid cuts need MANIFOLD_SOLID_BREP. "
                "Use the original text-to-cad .step, or allow a faceted STEP export.",
            )
        return src

    step_path = project_path / f"{stem}.step"
    if step_path.is_file():
        kind = cad_service.classify_step_file_kind(step_path)
        if kind == "editable_brep":
            return step_path
        if kind == "faceted_mesh" and not allow_faceted:
            raise HTTPException(
                422,
                "The selected file is mesh-based and its STEP sibling is faceted, not a native B-rep solid. "
                "Fusion can import it for viewing, but solid cuts/booleans may fail. Select the original .step model "
                "or regenerate the edit as build123d/text-to-CAD source before pushing to Fusion.",
            )
        if allow_faceted:
            return step_path

    faceted_path = project_path / cad_service.faceted_step_name(stem)
    if allow_faceted:
        if faceted_path.is_file():
            return faceted_path
        cad_service.ensure_mesh_exports(project_path, safe)
        if faceted_path.is_file():
            return faceted_path
        if step_path.is_file():
            return step_path

    raise HTTPException(
        422,
        "No native editable STEP/B-rep file exists for this model. The current object is mesh-only, so Fusion cannot "
        "use it reliably as a cut tool. Regenerate it through the CAD/text-to-CAD pipeline or push the original .step file.",
    )


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
    "case", "casing", "enclosure", "holder", "hold the", "bracket",
    "cradle", "fixture", "tray", "housing", "chassis", "base plate",
    "baseplate", "breadboard", "slab", "test plate", "testing plate",
    "testing slab", "mount plate", "plate for", "mounting plate",
    "raspberry pi", " rpi", " pi ", "sbc", "pcb", "board pocket",
    "motor mount", "stepper mount", "nema", "standoff", "standoffs",
    "box", "open top", "no lid", "lidless", "test bench", "test fixture",
    "test stand", "stand for the", "stand for my", "stand for pi", "stand for rpi",
)


def _looks_like_fixture_prompt(
    prompt: str | None,
    images: list[Any] | None = None,
) -> bool:
    if is_custom_sketch_structural_request(prompt or "", images):
        return False
    p = f" {prompt or ''} ".lower()
    return any(word in p for word in _FIXTURE_PROMPT_WORDS)


_SURFACE_REF_TYPES = {"face", "edge", "corner", "lasso", "path"}


def _has_surface_edit_reference(body: PromptRequest) -> bool:
    return any((r.type or "").lower() in _SURFACE_REF_TYPES for r in body.references)


def _is_reference_anchored_addition(body: PromptRequest) -> bool:
    """Existing-model edit: add/put/mount geometry on a picked face/edge/object."""
    if not _has_surface_edit_reference(body):
        return False
    p = f" {body.prompt or ''} ".lower()
    fresh_markers = (
        "from scratch",
        "start over",
        "new model",
        "new object",
        "replace the model",
        "replace this model",
        "full regen",
        "regenerate",
        "rebuild",
    )
    if any(marker in p for marker in fresh_markers):
        return False
    anchored_markers = (
        " add ",
        " put ",
        " place ",
        " attach ",
        " mount ",
        " on this",
        " onto this",
        " to this",
        " center of this",
        " middle of this",
        " at this",
        " this face",
        " selected face",
    )
    return any(marker in p for marker in anchored_markers)


def _reference_base_filename(body: PromptRequest) -> str | None:
    for r in body.references:
        name = r.filename or r.viewer_filename
        if name:
            return name
    return None


def _infer_surface_edit_base(project_path: Path, body: PromptRequest) -> str | None:
    """Best-effort recovery for older clients that sent face refs without a base file."""
    if body.base_filename or not _is_reference_anchored_addition(body):
        return None
    ref_base = _reference_base_filename(body)
    if ref_base:
        return ref_base
    candidates = [
        comp for comp in cad_service.list_browser_tree(project_path).get("components") or []
        if not _is_existing_fixture_artifact(project_path, comp)
    ]
    if len(candidates) == 1:
        comp = candidates[0]
        for key in ("filename", "name", "viewer_filename"):
            name = comp.get(key)
            if name and (project_path / name).is_file():
                return name
        return comp.get("name") or comp.get("viewer_filename")
    return None


def _with_reference_edit_base(project_path: Path, body: PromptRequest, trace_id: str | None) -> PromptRequest:
    inferred = _infer_surface_edit_base(project_path, body)
    if not inferred:
        return body
    trace_add(
        "info",
        "Inferred base model for reference-anchored edit",
        trace_id=trace_id,
        data={"base_filename": inferred},
    )
    return body.model_copy(update={"base_filename": inferred})


_PROMPT_REF_ONLY_RE = re.compile(
    r"^\s*@prompt:([A-Za-z0-9_-]+)"
    r"(?:\s*[·|]\s*project:([A-Za-z0-9_-]+))?"
    r"(?:\s*[·|]\s*mode:[^·|]+)?"
    r"(?:\s*[·|]\s*trace:[A-Za-z0-9_-]+)?\s*$",
    re.IGNORECASE,
)


def _resolve_prompt_reference_body(
    current_project_id: str,
    current_project_path: Path,
    body: PromptRequest,
    user: dict[str, Any],
    trace_id: str | None,
) -> PromptRequest:
    """If the prompt box contains only a copied @prompt reference, use that prompt's text."""
    match = _PROMPT_REF_ONLY_RE.match(body.prompt or "")
    if not match:
        return body
    prompt_id, ref_project_id = match.groups()
    ref_project_id = ref_project_id or current_project_id
    ref_path = current_project_path if ref_project_id == current_project_id else PROJECTS / ref_project_id
    if ref_project_id != current_project_id:
        _require_project_read(user, ref_project_id)
    entry = prompt_history_service.get_entry(ref_path, prompt_id)
    original = (entry or {}).get("prompt") or ""
    if not original:
        return body
    trace_add(
        "info",
        "Resolved prompt reference to original prompt text",
        trace_id=trace_id,
        data={"prompt_id": prompt_id, "source_project_id": ref_project_id},
    )
    return body.model_copy(update={"prompt": original})


def _with_image_generated_dxf_reference(body: PromptRequest, ai: AIService, trace_id: str | None) -> PromptRequest:
    """Optionally convert attached images into a DXF drawing + enriched CAD prompt.

    Only runs when the client sets ``convert_images_to_drawing=True`` (user opted in
    after the frontend confirm). Skips if a DXF reference is already attached.
    """
    if not body.images:
        return body
    if not bool(getattr(body, "convert_images_to_drawing", False)):
        return body
    if any(str(ref.type or "").lower() == "dxf" for ref in body.references):
        return body
    try:
        dxf_text, drawing_prompt, call_trace = ai.generate_drawing_package_from_images(
            body.prompt,
            images=[img.model_dump() for img in body.images[:4]],
            trace_id=trace_id,
        )
    except Exception as exc:
        trace_add(
            "warning",
            f"Image-to-drawing conversion failed; continuing with image references only: {exc}",
            trace_id=trace_id,
        )
        return body
    if not (dxf_text or "").strip() and not (drawing_prompt or "").strip():
        return body
    image_names = ", ".join(img.name for img in body.images[:4])
    refs = list(body.references)
    if (dxf_text or "").strip():
        refs.append(
            GeoReference(
                id="vision-reference",
                type="dxf",
                label=f"Vision DXF from image{'s' if len(body.images) != 1 else ''}",
                filename="vision-reference.dxf",
                stem="vision-reference",
                format="dxf",
                text_content=dxf_text[:90000],
                text_truncated=len(dxf_text) > 90000,
            )
        )
    enriched_parts = [body.prompt.strip()]
    if (drawing_prompt or "").strip():
        enriched_parts.append(
            "Vision drawing brief (derived from the uploaded image"
            f"{'s' if len(body.images) != 1 else ''} — use this together with the user prompt):\n"
            f"{drawing_prompt.strip()}"
        )
    if (dxf_text or "").strip():
        enriched_parts.append(
            "Use the attached generated DXF reference `@vision-reference` as the primary 2D drawing extracted "
            f"from the uploaded image{'s' if len(body.images) != 1 else ''} ({image_names}). Follow the DXF geometry, "
            "layers, proportions, notes, and inferred dimensions when creating the 3D model. Use the original image(s) "
            "only to resolve ambiguity, color/material/style, and 3D depth."
        )
    enriched = "\n\n".join(p for p in enriched_parts if p)[:8000]
    trace_add(
        "info",
        "Generated drawing package from prompt image(s)",
        trace_id=trace_id,
        data={
            "image_count": len(body.images),
            "dxf_chars": len(dxf_text or ""),
            "drawing_prompt_chars": len(drawing_prompt or ""),
            "model": call_trace.get("model"),
            "provider": call_trace.get("provider"),
        },
    )
    skills = body.skills
    if (dxf_text or "").strip() and "dxf" not in {str(s).lower() for s in skills}:
        skills = [*skills, "dxf"]
    return body.model_copy(update={
        "prompt": enriched,
        "references": refs,
        "skills": skills,
    })


def _source_for_base_model(project_path: Path, base_filename: str | None) -> tuple[str | None, str | None]:
    if not base_filename:
        return None, None
    stem = Path(base_filename).stem
    candidates = [project_path / f"{stem}.py"]
    for suffix in ("_edited", "_pulled", "_mirrored", "_extruded", "_body"):
        if stem.endswith(suffix):
            candidates.append(project_path / f"{stem[:-len(suffix)]}.py")
    for path in candidates:
        if path.is_file():
            return path.read_text(encoding="utf-8", errors="ignore"), path.name
    return None, None


_IMPLICIT_MODEL_EDIT_RE = re.compile(
    r"\b(change|edit|modify|update|adjust|resize|scale|offset|move|make it|turn it|set it)\b",
    re.IGNORECASE,
)


def _infer_implicit_edit_base(project_path: Path, body: PromptRequest) -> str | None:
    """Recover target model for terse 2.0 prompts like 'change it...' when clients omit base_filename."""
    if body.base_filename or body.references or not _IMPLICIT_MODEL_EDIT_RE.search(body.prompt or ""):
        return None
    latest = project_store.latest_model_file(project_path)
    if latest and _source_for_base_model(project_path, latest)[1]:
        return latest
    # Prefer the newest Python generator with a matching exported model.
    for source in sorted(project_path.glob("*.py"), key=lambda p: p.stat().st_mtime, reverse=True):
        stem = source.stem
        for suffix in (".glb", ".step", ".stp", ".3mf", ".stl"):
            candidate = project_path / f"{stem}{suffix}"
            if candidate.is_file():
                return candidate.name
    return latest


def _should_use_kernel_pipeline(body: PromptRequest, project_path: Path | None = None) -> bool:
    """Route to the parametric kernel instead of legacy mesh-edit actions."""
    if (body.mode or "standard").lower() in {"v2", "fusion", "architect"}:
        return True
    if _is_reference_anchored_addition(body) and (body.base_filename or _reference_base_filename(body)):
        return False
    if _looks_like_fixture_prompt(body.prompt, body.images):
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


def _reference_edit_guidance(prompt: str, refs: list[dict[str, Any]]) -> str | None:
    face_refs = [r for r in refs if str(r.get("type") or "").lower() == "face"]
    if not face_refs:
        return None
    p = f" {prompt or ''} ".lower()
    remove_words = (
        " remove ",
        " delete ",
        " cut out ",
        " cut away ",
        " open ",
        " opening ",
        " no wall",
        " wall",
        " walls",
        " vertical",
        " section",
    )
    if not any(word in p for word in remove_words):
        return (
            "Use the face reference data as exact edit anchors. Each face ref gives a picked planar face "
            "with position/local_point, outward normal, face_indices, and face_area. Preserve unrelated geometry."
        )
    return (
        "Face-anchored removal edit: the selected face is the wall/section reference, not a generic point. "
        "Use its position/local_point to identify the matching wall feature in the existing source and its normal "
        "to determine wall thickness direction. For prompts like 'remove the walls in the same vertical' or "
        "'remove that section', cut/delete only the vertical wall segment aligned with the picked face, projecting "
        "the selected face region through the wall thickness and along the relevant Z span. Do not remove the entire "
        "part, do not create a new replacement model, and do not affect unrelated parallel walls unless the prompt "
        "explicitly asks for all matching walls."
    )


def _build_dxf_context_entries(project_path: Path, prompt: str, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Summarize project DXF files for text-to-cad prompts."""
    from backend.skills.dxf.scripts.dxf.render_payload import build_dxf_render_payload

    try:
        from backend.skills.dxf.scripts.dxf.repair import ensure_ezdxf_readable_dxf
    except ImportError:
        def ensure_ezdxf_readable_dxf(source_path: Path) -> Path:  # type: ignore[misc]
            return Path(source_path)

    candidates: list[str] = []
    seen: set[str] = set()
    for ref in refs:
        if str(ref.get("type") or "").lower() != "dxf":
            continue
        name = Path(str(ref.get("filename") or ref.get("label") or "")).name.strip()
        if name and not name.lower().endswith(".dxf"):
            name = f"{Path(name).stem or 'reference'}.dxf"
        text_content = ref.get("text_content")
        if name and isinstance(text_content, str) and text_content.strip():
            target = project_path / name
            if not target.is_file():
                target.write_text(text_content, encoding="utf-8", errors="ignore")
                project_store.touch_project(project_path)
        if name and name not in seen:
            seen.add(name)
            candidates.append(name)
    if re.search(r"\b(dxf|vxf|dwg|drawing|blueprint)\b", prompt or "", re.I) or re.search(
        r"\bfrom\s+this\s+\w+\s+file\b",
        prompt or "",
        re.I,
    ):
        for path in sorted(project_path.glob("*.dxf")):
            if path.name.endswith(".ezdxf.dxf") or path.name in seen:
                continue
            seen.add(path.name)
            candidates.append(path.name)

    if not candidates:
        return []

    entries: list[dict[str, Any]] = []
    for name in candidates[:4]:
        source_path = project_path / name
        if not source_path.is_file():
            continue
        try:
            readable_path = ensure_ezdxf_readable_dxf(source_path)
            payload = build_dxf_render_payload(source_path, file_ref=name)
            bounds = payload.get("bounds") or {}
            layers = payload.get("layers") or []
            entries.append(
                {
                    "filename": name,
                    "readable_filename": readable_path.name,
                    "bounds_mm": bounds,
                    "layer_count": len(layers),
                    "layers": [layer.get("name") for layer in layers[:12] if isinstance(layer, dict)],
                    "import_hint": (
                        f"Define module-level constants before gen_step(), for example "
                        f'dxf_filename = "{readable_path.name}" and mold_thickness = 25.0.'
                    ),
                }
            )
        except Exception as exc:
            entries.append({"filename": name, "error": str(exc)[:240]})
    return entries


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
        if r.local_point is not None:
            ref["local_point"] = r.local_point
        if r.face_area is not None:
            ref["face_area"] = r.face_area
        if r.type == "component" or r.filename:
            ref["filename"] = r.filename
            ref["stem"] = r.stem
            if r.format:
                ref["format"] = r.format
            if r.label:
                ref["label"] = r.label
            ref_type = str(r.type or "").lower()
            if ref_type in {"dxf", "document", "text", "spec"}:
                text_content = r.text_content or ""
                text_truncated = bool(r.text_truncated or len(text_content) > 60000)
                # If DXF reference text was not inlined (e.g. restored from history),
                # hydrate it from the saved project file so text-to-cad keeps rich DXF context.
                if ref_type == "dxf" and not text_content.strip():
                    raw_name = r.filename or r.label or ""
                    safe_name = Path(str(raw_name)).name.strip()
                    if safe_name and not safe_name.lower().endswith(".dxf"):
                        safe_name = f"{Path(safe_name).stem or 'reference'}.dxf"
                    dxf_path = (project_path / safe_name) if safe_name else None
                    if dxf_path and dxf_path.is_file():
                        try:
                            loaded = dxf_path.read_text(encoding="utf-8", errors="ignore")
                            text_content = loaded
                            text_truncated = len(text_content) > 60000
                        except Exception:
                            text_content = ""
                if text_content:
                    ref["text_content"] = text_content[:60000]
                    ref["text_truncated"] = text_truncated
            if r.body_index is not None:
                ref["body_index"] = r.body_index
            if r.body_name:
                ref["body_name"] = r.body_name
        elif r.label:
            ref["label"] = r.label
        refs.append(ref)
    is_plain_v2 = (body.mode or "standard").lower() == "v2"
    referenced_components = []
    for r in body.references:
        if is_plain_v2 or r.type != "component":
            continue
        comp: dict[str, Any] = {"filename": r.filename, "stem": r.stem, "label": r.label}
        if r.projectId and r.projectId != project_id:
            comp["source_project_id"] = r.projectId
        referenced_components.append(comp)
    sketch_structural = is_custom_sketch_structural_request(body.prompt, body.images)
    if sketch_structural:
        referenced_components = []
    elif (
        not referenced_components
        and not _is_reference_anchored_addition(body)
        and (body.mode or "standard").lower() != "v2"
        and _looks_like_fixture_prompt(body.prompt, body.images)
    ):
        referenced_components = _project_component_refs_for_fixture(project_path)
        if referenced_components:
            trace_add(
                "info",
                f"Using {len(referenced_components)} project component(s) as fixture references",
                trace_id=getattr(body, "trace_id", None),
            )
    component_specs = [] if sketch_structural else _component_specs(project_path, referenced_components)
    context = {
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
        "reference_edit_guidance": _reference_edit_guidance(body.prompt, refs),
    }
    dxf_files = _build_dxf_context_entries(project_path, body.prompt, refs)
    if dxf_files:
        context["dxf_files"] = dxf_files
    # CAD 2.0: per-user OpenAI/Claude keys by default.
    # Codex is opt-in via PromptRequest.codex_agent (host ChatGPT login).
    if (body.mode or "standard").lower() in {"v2", "fusion", "architect"}:
        context["jake_identical_runtime"] = True
        context["strict_upstream_text_to_cad"] = True
        context["mirror_upstream_modeling"] = True
        use_codex = bool(getattr(body, "codex_agent", False) or getattr(body, "jake_codex_agent", False))
        context["codex_agent"] = use_codex
        context["jake_codex_agent"] = use_codex  # back-compat for older clients
        # Keep BYOK tool-agent as primary (or soft fallback when Codex is on).
        context["jake_tool_agent"] = True
    if (body.mode or "standard").lower() == "fusion":
        context["fusion_target"] = "fusion360" if (body.fusion_target or "").lower() == "fusion360" else "in_app"
    if (body.mode or "standard").lower() == "architect":
        context["architect_mode"] = True
        context["snap_grid_mm"] = 1000
        context["wall_height_mm"] = 2800
        context["module_system"] = "modular house kit with grid-snapping room, wall, window, roof, and service-core modules"
    return context


def _is_fresh_design_request(body: PromptRequest) -> bool:
    """Route to the parametric kernel (full rebuild) instead of legacy mesh-edit actions."""
    if body.references:
        # Allow vision-generated DXF-only references to still use the parametric pipeline
        non_vision = [r for r in body.references if r.id != "vision-reference"]
        if non_vision:
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


def _is_fresh_design_request(body: PromptRequest) -> bool:
    if body.references:
        return False
    prompt = body.prompt.strip().lower()
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
    image_based = bool(body.images) and any(word in prompt for word in ("image", "photo", "picture", "reference"))
    object_request = any(prompt.startswith(word) or f" {word}" in prompt for word in generative)
    return image_based and object_request


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
    client_version = "dev"
    try:
        asset_paths = [
            FRONTEND / "index.html",
            FRONTEND / "app.js",
            FRONTEND / "styles.css",
        ]
        mtimes = [path.stat().st_mtime for path in asset_paths if path.is_file()]
        if mtimes:
            client_version = str(int(max(mtimes)))
    except OSError:
        client_version = "dev"
    return {
        "status": "ok",
        "client_version": client_version,
        "model": settings.openai_model,
        "model_quality": settings.openai_model_quality,
        "openai_configured": bool(settings.openai_api_key),
        "openai_key_length": len(settings.openai_api_key) if settings.openai_api_key else 0,
        "per_user_keys": True,
        "auth": True,
    }


@app.get("/api/skills")
def list_skills(user: dict[str, Any] | None = Depends(get_current_user_optional)):
    return skills_service.skills_manifest(user_id=(user or {}).get("id"))


@app.post("/api/skills/plan")
def plan_prompt_skills(body: SkillPlanRequest, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    catalog = skills_service.list_skills(user_id=(user or {}).get("id"))
    by_id = {str(item.get("id") or "").lower(): item for item in catalog}
    requested = [str(skill or "").strip().lower() for skill in (body.skills or []) if str(skill or "").strip()]
    resolved = skills_service.resolve_prompt_skills(
        requested,
        has_images=bool(body.has_images),
        prompt=body.prompt or "",
        user_id=(user or {}).get("id"),
    )
    planned = []
    for skill_id in resolved:
        item = by_id.get(skill_id) or {}
        planned.append(
            {
                "id": skill_id,
                "name": item.get("name") or skill_id,
                "description": item.get("description") or "",
                "references": item.get("references") or [],
                "tools": item.get("tools") or [],
            }
        )
    available = [
        {
            "id": item.get("id"),
            "name": item.get("name") or item.get("id"),
            "description": item.get("description") or "",
            "installed": item.get("installed", True),
            "install_required": item.get("install_required", False),
        }
        for item in catalog
        if item.get("id") and (not item.get("install_required") or item.get("installed"))
    ]
    return {"skills": planned, "requested": requested, "available": available}


@app.get("/api/skills/{skill_id}")
def get_skill(skill_id: str, full: bool = False):
    skill = skills_service.get_skill(skill_id, include_references=full)
    if not skill:
        raise HTTPException(404, f"Skill '{skill_id}' not found")
    return skill


@app.post("/api/skills/{skill_id}/install")
def install_skill(skill_id: str, user: dict[str, Any] = Depends(get_current_user)):
    slug = skills_service.INSTALL_REQUIRED_SKILLS.get(skill_id.strip().lower())
    if not slug:
        raise HTTPException(400, "This skill does not require a download.")
    try:
        app_listing = agent_marketplace_service.install_listing(user["id"], slug)
    except PermissionError as exc:
        raise HTTPException(402, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"skill_id": skill_id, "app": app_listing}


@app.get("/api/skills/{skill_id}/assets")
def list_skill_assets(skill_id: str, user: dict[str, Any] = Depends(get_current_user)):
    return {"skill_id": skill_id, "assets": skills_service.list_skill_assets(user["id"], skill_id)}


@app.post("/api/skills/{skill_id}/assets")
async def upload_skill_assets(
    skill_id: str,
    files: list[UploadFile] = File(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    if skill_id.strip().lower() in skills_service.INSTALL_REQUIRED_SKILLS:
        installed = {item["id"] for item in skills_service.list_skills(user_id=user["id"]) if item.get("installed")}
        if skill_id.strip().lower() not in installed:
            raise HTTPException(403, "Download this skill before uploading assets.")
    assets = []
    for item in files[:8]:
        data = await item.read()
        try:
            assets.append(skills_service.save_skill_asset(user["id"], skill_id, item.filename or "asset", data))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"skill_id": skill_id, "assets": skills_service.list_skill_assets(user["id"], skill_id), "uploaded": assets}


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


# ── Agent App Store / marketplace ────────────────────────────────────────────

@app.get("/api/agent-apps")
def list_agent_apps(
    mine: bool = False,
    include_pending: bool = False,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    is_admin = _is_a1projects_admin(user)
    apps = agent_marketplace_service.list_listings(
        user_id=(user or {}).get("id"),
        include_pending=bool(include_pending and is_admin),
        mine_only=bool(mine and user),
    )
    return {"apps": apps, "admin": is_admin}


@app.get("/api/agent-apps/{app_id_or_slug}")
def get_agent_app(
    app_id_or_slug: str,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    app_listing = agent_marketplace_service.get_listing(
        app_id_or_slug,
        user_id=(user or {}).get("id"),
        include_pending=_is_a1projects_admin(user),
    )
    if not app_listing:
        raise HTTPException(404, "Agent app not found")
    return {"app": app_listing}


@app.post("/api/agent-apps")
def submit_agent_app(body: AgentAppSubmitRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        app_listing = agent_marketplace_service.create_listing(user["id"], body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"app": app_listing, "message": "Submitted for review."}


@app.post("/api/agent-apps/{app_id_or_slug}/install")
def install_agent_app(app_id_or_slug: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        app_listing = agent_marketplace_service.install_listing(user["id"], app_id_or_slug)
    except PermissionError as exc:
        raise HTTPException(402, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"app": app_listing}


@app.delete("/api/agent-apps/{app_id_or_slug}/install")
def uninstall_agent_app(app_id_or_slug: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        agent_marketplace_service.uninstall_listing(user["id"], app_id_or_slug)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


@app.patch("/api/agent-apps/{app_id_or_slug}/review")
def review_agent_app(
    app_id_or_slug: str,
    body: AgentAppReviewRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    if not _is_a1projects_admin(user):
        raise HTTPException(403, "Only admins can review marketplace apps.")
    try:
        app_listing = agent_marketplace_service.review_listing(
            app_id_or_slug,
            status=body.status,
            featured=body.featured,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"app": app_listing}


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


@app.get("/api/auth/social/providers")
def social_auth_providers():
    from backend.services.social_oauth import configured_providers

    return {"providers": configured_providers()}


@app.get("/oauth/{provider}/start")
def social_oauth_start(provider: str):
    from backend.services.social_oauth import build_authorization_url

    try:
        url = build_authorization_url(provider)
    except Exception as exc:
        return _social_redirect_error(provider, str(exc))
    return RedirectResponse(url, status_code=302)


def _social_redirect_error(provider: str, message: str) -> RedirectResponse:
    safe_provider = urllib.parse.quote((provider or "social").strip().lower()[:40])
    safe_message = urllib.parse.quote((message or "login_failed")[:240])
    return RedirectResponse(f"/?social_error={safe_message}&social_provider={safe_provider}", status_code=302)


async def _handle_social_callback(provider: str, code: str | None, state: str | None, error: str | None = None) -> RedirectResponse:
    from backend.services.social_oauth import consume_oauth_state, exchange_code_for_profile, upsert_social_user

    if error:
        return _social_redirect_error(provider, error)
    if not code or not state:
        return _social_redirect_error(provider, "missing_params")
    state_ok = consume_oauth_state(state)
    if state_ok is False:
        return _social_redirect_error(provider, "invalid_state")
    try:
        profile = exchange_code_for_profile(provider, code)
        user = upsert_social_user(profile)
        token = create_access_token(user["id"])
    except Exception as exc:
        logger.warning("Social OAuth callback failed for %s: %s", provider, exc)
        return _social_redirect_error(provider, str(exc))
    safe_provider = urllib.parse.quote((provider or "social").strip().lower()[:40])
    return RedirectResponse(f"/?social_token={token}&social_provider={safe_provider}", status_code=302)


@app.get("/oauth/{provider}/callback")
async def social_oauth_callback(
    request: Request,
    provider: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    if provider.strip().lower() == "autodesk":
        return autodesk_oauth_callback(request, code=code, state=state, error=error, error_description=error_description)
    return await _handle_social_callback(provider, code, state, error)


@app.post("/oauth/{provider}/callback")
async def social_oauth_callback_post(provider: str, request: Request):
    form = await request.form()
    if provider.strip().lower() == "autodesk":
        return autodesk_oauth_callback(
            request,
            code=str(form.get("code") or "") or None,
            state=str(form.get("state") or "") or None,
            error=str(form.get("error") or "") or None,
            error_description=str(form.get("error_description") or "") or None,
        )
    return await _handle_social_callback(
        provider,
        str(form.get("code") or "") or None,
        str(form.get("state") or "") or None,
        str(form.get("error") or "") or None,
    )


@app.get("/api/auth/me")
def auth_me(user: dict[str, Any] = Depends(get_current_user)):
    return {"user": user, "teams": teams_service.list_teams(user["id"]), "ai": _ai_status_for_user(user)}


RENDER_AGENT_SYSTEM_PROMPT = """You are Render Agent, the in-app support assistant for Render3D.
Answer practical questions about Render3D tooling, CAD workflows, Fusion 360/Onshape sync, file uploads,
AI model generation, sketches, wiring diagrams, BOMs, project folders, permissions, and troubleshooting.
Be concise and action-oriented. If the user asks for destructive actions, explain the safe workflow first.
You can use attached images and text snippets as context. You cannot directly edit files from this chat."""


def _render_agent_project_context(project_id: str | None, user: dict[str, Any]) -> dict[str, Any] | None:
    if not project_id:
        return None
    try:
        path = _require_project_read(user, project_id)
    except Exception:
        return {"project_id": project_id, "error": "Project not accessible to this user."}
    summary = project_store.project_summary(path)
    files = summary.get("files") or []
    return {
        "project_id": project_id,
        "project_name": summary.get("name"),
        "latest_file": summary.get("latest_file"),
        "file_count": len(files),
        "files": [
            {
                "name": item.get("name"),
                "format": item.get("format"),
                "size": item.get("size"),
            }
            for item in files[:40]
        ],
        "fusion_source": project_store.load_meta(path).get("autodesk_source"),
    }


def _render_agent_user_content(
    message: str,
    *,
    thread: dict[str, Any],
    project_context: dict[str, Any] | None,
    attachments: list[RenderAgentAttachment],
) -> str:
    history = [
        {"role": item.get("role"), "content": str(item.get("content") or "")[:1400]}
        for item in (thread.get("messages") or [])[-8:]
        if item.get("content")
    ]
    text_attachments = [
        {
            "name": item.name,
            "media_type": item.media_type,
            "text": (item.text or "")[:6000],
        }
        for item in attachments
        if item.text
    ]
    context = {
        "recent_thread_messages": history,
        "current_project": project_context,
        "text_attachments": text_attachments,
    }
    return (
        f"User question:\n{message}\n\n"
        f"Render3D context JSON:\n{json.dumps(context, separators=(',', ':'), default=str)}"
    )


@app.get("/api/render-agent/threads")
def list_render_agent_threads(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import render_agent_service

    return {"threads": render_agent_service.list_threads(user["id"])}


@app.post("/api/render-agent/threads")
def create_render_agent_thread(body: RenderAgentThreadCreateRequest, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import render_agent_service

    thread = render_agent_service.create_thread(user["id"], body.title)
    return {"thread": thread}


@app.get("/api/render-agent/threads/{thread_id}")
def get_render_agent_thread(thread_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import render_agent_service

    thread = render_agent_service.get_thread(user["id"], thread_id)
    if not thread:
        raise HTTPException(404, "Thread not found")
    return {"thread": thread}


@app.post("/api/render-agent/messages")
def render_agent_message(body: RenderAgentMessageRequest, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import render_agent_service

    thread = render_agent_service.get_thread(user["id"], body.thread_id or "") if body.thread_id else None
    if not thread:
        thread = render_agent_service.create_thread(user["id"], body.message[:70])
    ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
        project_id=body.project_id,
    )
    attachments = body.attachments[:6]
    project_context = _render_agent_project_context(body.project_id, user)
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    user_content = _render_agent_user_content(
        body.message,
        thread=thread,
        project_context=project_context,
        attachments=attachments,
    )
    images = [
        item.model_dump()
        for item in attachments
        if (item.media_type or "").lower() in {"image/png", "image/jpeg", "image/jpg", "image/webp"} and item.data_url
    ]
    try:
        answer, call_trace = ai._call_model(
            RENDER_AGENT_SYSTEM_PROMPT,
            user_content,
            trace_id=trace_id,
            images=images,
            max_tokens=2500,
            retry_on_truncation=False,
            pro_floor=None,
            json_response=False,
        )
    except Exception as exc:
        raise HTTPException(502, f"Render Agent failed: {exc}") from exc
    user_message = {
        "role": "user",
        "content": body.message,
        "attachments": [
            {
                "id": item.id,
                "name": item.name,
                "media_type": item.media_type,
                "has_text": bool(item.text),
                "has_image": bool(item.data_url and (item.media_type or "").startswith("image/")),
            }
            for item in attachments
        ],
    }
    assistant_message = {"role": "assistant", "content": answer, "attachments": []}
    updated = render_agent_service.append_messages(user["id"], thread["id"], [user_message, assistant_message])
    return {
        "thread": updated,
        "message": assistant_message,
        "trace": {
            "model": call_trace.get("model"),
            "provider": call_trace.get("provider"),
            "usage": call_trace.get("usage"),
            "cost_usd": call_trace.get("cost_usd"),
        },
    }


def _avatar_path_for_user(user_id: str, ext: str) -> Path:
    safe_id = "".join(ch for ch in str(user_id) if ch.isalnum() or ch in {"-", "_"})[:80]
    return AVATARS / f"{safe_id}.{ext}"


def _avatar_url_for_user_id(user_id: str | None) -> str | None:
    if not user_id:
        return None
    safe_id = "".join(ch for ch in str(user_id) if ch.isalnum() or ch in {"-", "_"})[:80]
    if not safe_id:
        return None
    return f"/api/users/{safe_id}/avatar"


@app.get("/api/users/me/avatar")
def get_my_avatar(user: dict[str, Any] = Depends(get_current_user)):
    for ext, media in (("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg")):
        path = _avatar_path_for_user(user["id"], ext)
        if path.is_file():
            return FileResponse(path, media_type=media)
    raise HTTPException(404, "Avatar not found")


@app.get("/api/users/{user_id}/avatar")
def get_user_avatar(user_id: str):
    for ext, media in (("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg")):
        path = _avatar_path_for_user(user_id, ext)
        if path.is_file():
            return FileResponse(path, media_type=media)
    raise HTTPException(404, "Avatar not found")


@app.post("/api/users/me/avatar")
@app.put("/api/users/me/avatar")
async def upload_my_avatar(file: UploadFile = File(...), user: dict[str, Any] = Depends(get_current_user)):
    media = (file.content_type or "").lower()
    ext = "png" if media == "image/png" else "jpg" if media in {"image/jpeg", "image/jpg"} else ""
    if not ext:
        raise HTTPException(400, "Upload a PNG or JPEG image.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Uploaded image is empty.")
    if len(data) > 1_500_000:
        raise HTTPException(400, "Profile picture must be under 1.5 MB.")
    if ext == "png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(400, "Invalid PNG image.")
    if ext == "jpg" and not data.startswith(b"\xff\xd8"):
        raise HTTPException(400, "Invalid JPEG image.")

    # Remove older avatar variants for this user.
    for old_ext in ("png", "jpg", "jpeg"):
        old = _avatar_path_for_user(user["id"], old_ext)
        if old.is_file():
            old.unlink()
    path = _avatar_path_for_user(user["id"], ext)
    path.write_bytes(data)
    avatar_url = f"{_avatar_url_for_user_id(user['id'])}?v={int(time.time())}"
    with get_conn() as conn:
        conn.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (avatar_url, user["id"]))
    updated = get_user_by_id(user["id"])
    return {"user": updated, "avatar_url": avatar_url}


@app.delete("/api/users/me/avatar")
def delete_my_avatar(user: dict[str, Any] = Depends(get_current_user)):
    for ext in ("png", "jpg", "jpeg"):
        path = _avatar_path_for_user(user["id"], ext)
        if path.is_file():
            path.unlink()
    with get_conn() as conn:
        conn.execute("UPDATE users SET avatar_url = NULL WHERE id = ?", (user["id"],))
    updated = get_user_by_id(user["id"])
    return {"user": updated, "avatar_url": None}


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


# ── Autodesk / Fusion 360 OAuth ──────────────────────────────────────────────


def _request_origin(request: Request) -> str:
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",", 1)[0].strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc).split(",", 1)[0].strip()
    return f"{proto}://{host}".rstrip("/")


def _autodesk_redirect_uri_for_request(request: Request) -> str:
    configured = (settings.autodesk_redirect_uri or "").strip()
    origin = _request_origin(request)
    if configured:
        try:
            configured_url = urllib.parse.urlparse(configured)
            request_url = urllib.parse.urlparse(origin)
            if configured_url.hostname == request_url.hostname:
                return configured
        except Exception:
            pass
    return f"{origin}/oauth/autodesk/callback"


def _autodesk_return_origin() -> str:
    """Canonical app host to return to after Autodesk OAuth."""
    configured = (settings.autodesk_redirect_uri or "").strip()
    if configured:
        parsed = urllib.parse.urlparse(configured)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return "https://render3d.app"


@app.post("/api/autodesk/oauth-url")
def autodesk_oauth_url(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Create an Autodesk OAuth URL for the currently signed-in user."""
    try:
        from backend.services.autodesk_oauth import build_authorization_url
        origin = _request_origin(request)
        logger.info("autodesk oauth-url start user_id=%s email=%s origin=%s", user.get("id"), user.get("email"), origin)
        return {"url": build_authorization_url(user_id=user["id"], return_url=origin)}
    except Exception as exc:
        logger.warning("autodesk oauth-url failed user_id=%s error=%s", user.get("id"), exc)
        raise HTTPException(400, str(exc)) from exc


@app.get("/oauth/autodesk/start")
def autodesk_oauth_start(
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    """Redirect the browser to Autodesk authorization for Fusion 360 linking."""
    if not user:
        logger.info("autodesk oauth start rejected login_required origin=%s", _request_origin(request))
        return RedirectResponse("/?autodesk_error=login_required", status_code=302)
    try:
        from backend.services.autodesk_oauth import build_authorization_url
        origin = _request_origin(request)
        logger.info("autodesk oauth start user_id=%s email=%s origin=%s", user.get("id"), user.get("email"), origin)
        url = build_authorization_url(user_id=user["id"], return_url=origin)
    except Exception as exc:
        logger.warning("autodesk oauth start failed user_id=%s error=%s", user.get("id"), exc)
        return RedirectResponse(f"/?autodesk_error={str(exc)[:80]}", status_code=302)
    return RedirectResponse(url, status_code=302)


def _autodesk_redirect_error(message: str) -> RedirectResponse:
    return RedirectResponse(f"/?autodesk_error={urllib.parse.quote(message[:240])}", status_code=302)


@app.get("/oauth/autodesk/callback")
@app.get("/oauth/autodesk/callback/")
def autodesk_oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    """Autodesk redirects here after account authorization."""
    logger.info(
        "autodesk callback received has_code=%s has_state=%s error=%s origin=%s",
        bool(code),
        bool(state),
        error or "",
        _request_origin(request),
    )
    if error:
        detail = error_description or error
        logger.warning("autodesk callback provider_error=%s", detail)
        return _autodesk_redirect_error(detail)
    if not code or not state:
        seen = ", ".join(sorted(request.query_params.keys())) or "none"
        return _autodesk_redirect_error(
            "Autodesk did not return an authorization code. "
            f"Check that the APS app callback URL exactly matches {settings.autodesk_redirect_uri}. "
            f"Callback query params seen: {seen}."
        )

    try:
        from backend.services.autodesk_oauth import consume_oauth_state, exchange_code_for_tokens, upsert_user_tokens
        oauth_state = consume_oauth_state(state)
        if oauth_state is False:
            logger.warning("autodesk callback invalid_state")
            return _autodesk_redirect_error("invalid_state")
        stored_user_id = oauth_state.get("user_id")
        if not stored_user_id:
            logger.warning("autodesk callback login_required missing_user_id")
            return _autodesk_redirect_error("login_required")
        token_data = exchange_code_for_tokens(code)
        upsert_user_tokens(token_data, stored_user_id)
        app_token = create_access_token(stored_user_id)
        logger.info("autodesk callback linked user_id=%s return_url=%s", stored_user_id, oauth_state.get("return_url") or "")
    except Exception as exc:
        logger.exception("autodesk callback failed error=%s", exc)
        return _autodesk_redirect_error(str(exc))

    params = urllib.parse.urlencode(
        {
            "autodesk_linked": "1",
            "render3d_token": app_token,
            # Older cached frontends only restore OAuth redirects from onshape_token.
            "onshape_token": app_token,
        }
    )
    return_url = str(oauth_state.get("return_url") or "").rstrip("/")
    if return_url.startswith(("https://", "http://localhost", "http://127.0.0.1")):
        return RedirectResponse(f"{return_url}/?{params}", status_code=302)
    return RedirectResponse(f"/?{params}", status_code=302)


@app.get("/api/autodesk/status")
def autodesk_status(request: Request, user: dict[str, Any] = Depends(get_current_user)):
    """Return whether this user has linked Autodesk/Fusion 360."""
    from backend.database import get_conn
    from backend.services.autodesk_oauth import configured_scopes
    configured = bool(settings.autodesk_client_id and settings.autodesk_client_secret)
    setup = {
        "portal_url": "https://aps.autodesk.com/myapps/",
        "redirect_uri": settings.autodesk_redirect_uri,
        "required_env": ["AUTODESK_CLIENT_ID", "AUTODESK_CLIENT_SECRET", "AUTODESK_REDIRECT_URI", "AUTODESK_SCOPES"],
        "apis": ["Authentication API", "Data Management API"],
        "scopes": configured_scopes(),
        "client_id_tail": settings.autodesk_client_id[-6:] if settings.autodesk_client_id else "",
    }
    with get_conn() as conn:
        row = conn.execute(
            "SELECT autodesk_email, autodesk_name, expires_at FROM autodesk_tokens WHERE user_id = ?",
            (user["id"],),
        ).fetchone()
    if not row:
        return {"linked": False, "configured": configured, "setup": setup}
    return {
        "linked": True,
        "configured": configured,
        "setup": setup,
        "autodesk_email": row["autodesk_email"],
        "autodesk_name": row["autodesk_name"],
        "expires_at": row["expires_at"],
    }


@app.post("/api/autodesk/config")
def autodesk_save_config(body: AutodeskCredentialsRequest, user: dict[str, Any] = Depends(get_current_user)):
    """Save APS app credentials used for Autodesk/Fusion OAuth."""
    client_id = body.client_id.strip()
    client_secret = body.client_secret.strip()
    redirect_uri = (body.redirect_uri or settings.autodesk_redirect_uri).strip()
    if not redirect_uri.startswith(("https://", "http://localhost", "http://127.0.0.1")):
        raise HTTPException(422, "Use an HTTPS redirect URL, or localhost for local development.")

    updates = {
        "AUTODESK_CLIENT_ID": client_id,
        "AUTODESK_CLIENT_SECRET": client_secret,
        "AUTODESK_REDIRECT_URI": redirect_uri,
        "AUTODESK_SCOPES": settings.autodesk_scopes,
    }
    env_path = ROOT / ".env"
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.is_file() else []
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
        if key in updates:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    env_path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")

    # Keep this process usable immediately; .env keeps the values across restarts.
    settings.autodesk_client_id = client_id
    settings.autodesk_client_secret = client_secret
    settings.autodesk_redirect_uri = redirect_uri
    return {
        "configured": True,
        "redirect_uri": redirect_uri,
        "client_id_tail": client_id[-6:],
    }


@app.delete("/api/autodesk/unlink")
def autodesk_unlink(user: dict[str, Any] = Depends(get_current_user)):
    """Remove stored Autodesk/Fusion 360 tokens for this user."""
    from backend.database import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM autodesk_tokens WHERE user_id = ?", (user["id"],))
    return {"ok": True}


@app.get("/api/autodesk/fusion-mirrors")
def list_user_fusion_mirrors(
    include_access: bool = Query(True),
    user: dict[str, Any] = Depends(get_current_user),
):
    """All Fusion folder mirrors linked by this Render3D user across every project."""
    from backend.database import get_conn
    from backend.services import project_store
    from backend.services.autodesk_oauth import fusion_mirror_access_issue, get_valid_access_token

    token = get_valid_access_token(user["id"]) if include_access else None
    with get_conn() as conn:
        autodesk_row = conn.execute(
            "SELECT autodesk_email, autodesk_name FROM autodesk_tokens WHERE user_id = ?",
            (user["id"],),
        ).fetchone()
        rows = conn.execute(
            """
            SELECT m.*,
                   (
                     SELECT t.name
                       FROM project_access pa
                       JOIN teams t ON t.id = pa.team_id
                      WHERE pa.project_id = m.project_id
                      LIMIT 1
                   ) AS team_name
              FROM project_fusion_mirrors m
             WHERE m.user_id = ?
             ORDER BY m.updated_at DESC
            """,
            (user["id"],),
        ).fetchall()

    mirrors: list[dict[str, Any]] = []
    for row in rows:
        mirror = dict(row)
        path = PROJECTS / str(mirror["project_id"])
        summary = project_store.project_summary(path) if path.is_dir() else {}
        mirror["render3d_project_name"] = summary.get("name") or mirror["project_id"]
        mirror["project_exists"] = path.is_dir()
        mirror["file_count"] = summary.get("file_count") or 0
        if include_access:
            if not token:
                mirror["access"] = {
                    "ok": False,
                    "error": "Autodesk account not linked.",
                    "needs_relink": True,
                }
            else:
                issue = fusion_mirror_access_issue(token, mirror)
                mirror["access"] = {
                    "ok": not issue,
                    "error": issue,
                    "needs_relink": bool(issue),
                }
        else:
            mirror["access"] = {"ok": None, "error": None, "needs_relink": False}
        mirrors.append(mirror)

    return {
        "account_email": user.get("email"),
        "autodesk_email": (dict(autodesk_row).get("autodesk_email") if autodesk_row else None),
        "autodesk_name": (dict(autodesk_row).get("autodesk_name") if autodesk_row else None),
        "mirrors": mirrors,
        "count": len(mirrors),
    }


@app.post("/api/autodesk/fusion-mirrors/cleanup-stale")
def cleanup_stale_fusion_mirrors(user: dict[str, Any] = Depends(get_current_user)):
    """Remove this user's Fusion mirror links that no longer match Autodesk access."""
    from backend.database import get_conn
    from backend.services import project_store
    from backend.services.autodesk_oauth import fusion_mirror_access_issue, get_valid_access_token

    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    removed: list[dict[str, Any]] = []
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM project_fusion_mirrors WHERE user_id = ?",
            (user["id"],),
        ).fetchall()
        for row in rows:
            mirror = dict(row)
            issue = fusion_mirror_access_issue(token, mirror)
            if not issue:
                continue
            conn.execute(
                "DELETE FROM project_fusion_mirrors WHERE project_id = ? AND user_id = ?",
                (mirror["project_id"], user["id"]),
            )
            path = PROJECTS / str(mirror["project_id"])
            summary = project_store.project_summary(path) if path.is_dir() else {}
            removed.append({
                "project_id": mirror["project_id"],
                "render3d_project_name": summary.get("name") or mirror["project_id"],
                "hub_label": mirror.get("hub_label"),
                "aps_project_label": mirror.get("aps_project_label"),
                "folder_label": mirror.get("folder_label"),
                "error": issue,
            })
    return {"ok": True, "removed": removed, "count": len(removed)}


@app.get("/api/autodesk/hubs")
def autodesk_hubs(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services.autodesk_oauth import get_valid_access_token, list_hubs
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    try:
        return {"hubs": list_hubs(token)}
    except Exception as exc:
        raise HTTPException(502, f"Autodesk library error: {exc}") from exc


@app.get("/api/autodesk/hubs/{hub_id}/projects")
def autodesk_projects(hub_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services.autodesk_oauth import get_valid_access_token, list_projects
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    try:
        return {"projects": list_projects(token, hub_id)}
    except Exception as exc:
        raise HTTPException(502, f"Autodesk projects error: {exc}") from exc


@app.get("/api/autodesk/hubs/{hub_id}/projects/{aps_project_id}/top-folders")
def autodesk_top_folders(hub_id: str, aps_project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services.autodesk_oauth import get_valid_access_token, list_top_folders
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    try:
        return {"folders": list_top_folders(token, hub_id, aps_project_id)}
    except Exception as exc:
        raise HTTPException(502, f"Autodesk folders error: {exc}") from exc


@app.get("/api/autodesk/projects/{aps_project_id}/folders/{folder_id}/contents")
def autodesk_folder_contents(aps_project_id: str, folder_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services.autodesk_oauth import get_valid_access_token, list_folder_contents
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    try:
        return list_folder_contents(token, aps_project_id, folder_id)
    except Exception as exc:
        raise HTTPException(502, f"Autodesk folder contents error: {exc}") from exc


def _safe_model_stem(name: str, fallback: str) -> str:
    stem = Path(name or fallback).stem or fallback
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in stem).strip().replace(" ", "_").lower()
    return safe or fallback


@app.post("/api/autodesk/import")
def autodesk_import_item(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    """Download a supported Autodesk file, convert a preview if needed, and create/update a local project."""
    import uuid
    from backend.services.autodesk_oauth import download_item_file, export_fusion_item_as_step, get_folder_item, get_valid_access_token
    from backend.services import cad_service

    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")

    aps_project_id = str(body.get("aps_project_id") or body.get("autodesk_project_id") or "")
    hub_id = str(body.get("hub_id") or "")
    folder_id = str(body.get("folder_id") or "")
    item_id = str(body.get("item_id") or "")
    if not aps_project_id or not folder_id or not item_id:
        raise HTTPException(422, "aps_project_id, folder_id and item_id are required.")

    try:
        item = get_folder_item(token, aps_project_id, folder_id, item_id)
    except Exception as exc:
        raise HTTPException(502, f"Could not find Autodesk item: {exc}") from exc

    name = str(item.get("name") or body.get("name") or "autodesk_import").strip() or "autodesk_import"
    suffix = Path(name).suffix.lower()
    converted_from_native = False
    if suffix in cad_service.SUPPORTED_IMPORT:
        try:
            data = download_item_file(token, item)
        except Exception as exc:
            raise HTTPException(502, f"Could not download from Autodesk: {exc}") from exc
    else:
        if not hub_id:
            raise HTTPException(422, "This Fusion design needs cloud STEP conversion, but hub_id was not provided.")
        try:
            data = export_fusion_item_as_step(token, hub_id=hub_id, project_id=aps_project_id, item_id=item_id)
        except Exception as exc:
            raise HTTPException(
                502,
                "Could not auto-convert this Fusion design to STEP. "
                "Enable Manufacturing Data Model API for the APS app, reconnect Autodesk, then try again. "
                f"Autodesk said: {exc}",
            ) from exc
        suffix = ".step"
        converted_from_native = True

    teams = teams_service.list_teams(user["id"])
    if not teams:
        raise HTTPException(400, "No workspace available — create one first.")
    requested_team_id = str(body.get("team_id") or "").strip()
    team_ids = {team["id"] for team in teams}
    if requested_team_id and requested_team_id not in team_ids:
        raise HTTPException(403, "Not a member of that workspace.")
    tid = requested_team_id or teams[0]["id"]

    target_project_id = str(body.get("target_project_id") or body.get("project_id") or "").strip()
    workspace_folder_id = str(body.get("workspace_folder_id") or body.get("render_folder_id") or "").strip() or None
    into_existing = False
    if target_project_id:
        proj_path = _require_project(user, target_project_id)
        project_id = target_project_id
        into_existing = True
    else:
        project_id = str(uuid.uuid4())[:8]
        proj_path = cad_service.project_dir(PROJECTS, project_id)
        project_store.touch_project(proj_path, name=name, name_source="user")
        teams_service.register_project_access(project_id, tid, user["id"])
        if workspace_folder_id:
            try:
                folders_service.set_project_folder(project_id, workspace_folder_id, user["id"])
            except Exception as exc:
                logger.warning("Could not place Autodesk import in folder %s: %s", workspace_folder_id, exc)

    safe_stem = _safe_model_stem(name, "autodesk_import")
    safe_name = f"{'.autodesk_source_' if converted_from_native else ''}{safe_stem}{suffix}"
    src_path = proj_path / safe_name
    if into_existing and src_path.exists():
        n = 2
        while True:
            candidate = proj_path / f"{Path(safe_name).stem}_{n}{suffix if not converted_from_native else Path(safe_name).suffix}"
            if converted_from_native:
                candidate = proj_path / f".autodesk_source_{safe_stem}_{n}{suffix}"
            if not candidate.exists():
                src_path = candidate
                safe_name = candidate.name
                break
            n += 1
    src_path.write_bytes(data)

    viewer_path = src_path
    try:
        if suffix == ".3mf":
            mesh = cad_service.load_mesh(src_path)
            viewer_path = src_path.with_suffix(".glb")
            cad_service.export_mesh(mesh, viewer_path)
        elif suffix in cad_service.STEP_SUFFIXES:
            viewer_path = cad_service.tessellate_step_to_glb(src_path)
            if converted_from_native:
                assembled_viewer_path = proj_path / f"{safe_stem}.glb"
                if into_existing and assembled_viewer_path.exists():
                    assembled_viewer_path = proj_path / f"{safe_stem}_{src_path.stem.split('_')[-1] if '_' in src_path.stem else '2'}.glb"
                    # Prefer a unique assembled name next to the source when colliding.
                    n = 2
                    while assembled_viewer_path.exists():
                        assembled_viewer_path = proj_path / f"{safe_stem}_{n}.glb"
                        n += 1
                if viewer_path.name != assembled_viewer_path.name:
                    assembled_viewer_path.write_bytes(viewer_path.read_bytes())
                viewer_path = assembled_viewer_path
                if body.get("import_bodies", False) is True:
                    try:
                        cad_service.split_scene_components_to_glbs(
                            viewer_path,
                            proj_path,
                            base_stem=viewer_path.stem,
                        )
                    except Exception as split_exc:
                        logger.warning(
                            "Autodesk import body split failed for %s: %s",
                            viewer_path.name,
                            split_exc,
                        )
    except Exception as exc:
        raise HTTPException(422, f"Could not convert Autodesk file for preview: {exc}") from exc

    meta = project_store.load_meta(proj_path)
    meta["autodesk_source"] = {
        "aps_project_id": aps_project_id,
        "folder_id": folder_id,
        "item_id": item_id,
        "version_id": item.get("version_id") or body.get("version_id") or "",
        "item_name": name,
        "web_url": item.get("web_url") or "",
        "converted_from_native": converted_from_native,
    }
    if not into_existing:
        project_store.save_meta(proj_path, meta)
    else:
        # Keep prior project name; still record latest Autodesk provenance.
        project_store.save_meta(proj_path, meta)
        project_store.touch_project(proj_path)
    entry = _record_history(
        proj_path,
        "autodesk_import",
        f"Import {name} from Autodesk",
        viewer_path.name,
        meta={"source_file": src_path.name, "autodesk_item_id": item_id, "into_existing": into_existing},
        user=user,
    )
    _log_workspace(
        tid,
        kind="autodesk_import",
        label=f"Imported {name} from Autodesk{' into existing project' if into_existing else ''}",
        user=user,
        project_id=project_id,
    )

    return {
        "project_id": project_id,
        "filename": viewer_path.name,
        "source_file": src_path.name,
        "name": name,
        "autodesk_source": meta["autodesk_source"],
        "timeline_entry": entry,
        "into_existing": into_existing,
        "workspace_folder_id": workspace_folder_id,
    }


@app.post("/api/autodesk/download")
def autodesk_download_item(body: dict = Body(...), user: dict[str, Any] = Depends(get_current_user)):
    """Download an Autodesk item through Render3D so authenticated users can save it locally."""
    from backend.services.autodesk_oauth import download_item_file, get_folder_item, get_valid_access_token

    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")

    aps_project_id = str(body.get("aps_project_id") or body.get("autodesk_project_id") or "")
    folder_id = str(body.get("folder_id") or "")
    item_id = str(body.get("item_id") or "")
    if not aps_project_id or not folder_id or not item_id:
        raise HTTPException(422, "aps_project_id, folder_id and item_id are required.")

    try:
        item = get_folder_item(token, aps_project_id, folder_id, item_id)
        data = download_item_file(token, item)
    except Exception as exc:
        raise HTTPException(502, f"Could not download from Autodesk: {exc}") from exc

    filename = Path(str(item.get("name") or body.get("name") or "autodesk-download")).name
    quoted = urllib.parse.quote(filename)
    return Response(
        content=data,
        media_type=item.get("mime_type") or "application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quoted}"},
    )


@app.get("/api/projects/{project_id}/autodesk-source")
def get_project_autodesk_source(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Return Autodesk/Fusion source metadata for a project, if it was imported from Fusion."""
    path = _require_project(user, project_id)
    meta = project_store.load_meta(path)
    return {"autodesk_source": meta.get("autodesk_source")}


def _upsert_project_fusion_mirror(
    *,
    project_id: str,
    user_id: str,
    team_id: str | None,
    body: dict[str, Any],
    result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    hub_id = str(body.get("hub_id") or body.get("autodesk_hub_id") or "").strip()
    aps_project_id = str(body.get("aps_project_id") or body.get("autodesk_project_id") or "").strip()
    folder_id = str(body.get("folder_id") or "").strip()
    if not aps_project_id or not folder_id:
        raise HTTPException(422, "aps_project_id and folder_id are required.")
    result = result or {}
    # Optional: pin a specific Fusion item when linking a model (not just the folder).
    item_id = str(body.get("item_id") or body.get("last_item_id") or "").strip() or None
    version_id = str(body.get("version_id") or body.get("last_version_id") or "").strip() or None
    if item_id and not result.get("item_id"):
        result = {**result, "item_id": item_id, "version_id": version_id}
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO project_fusion_mirrors
              (project_id, user_id, team_id, hub_id, hub_label, aps_project_id, aps_project_label,
               folder_id, folder_label, last_item_id, last_version_id, last_pushed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, user_id) DO UPDATE SET
              team_id = excluded.team_id,
              hub_id = excluded.hub_id,
              hub_label = excluded.hub_label,
              aps_project_id = excluded.aps_project_id,
              aps_project_label = excluded.aps_project_label,
              folder_id = excluded.folder_id,
              folder_label = excluded.folder_label,
              last_item_id = COALESCE(excluded.last_item_id, project_fusion_mirrors.last_item_id),
              last_version_id = COALESCE(excluded.last_version_id, project_fusion_mirrors.last_version_id),
              last_pushed_at = COALESCE(excluded.last_pushed_at, project_fusion_mirrors.last_pushed_at),
              updated_at = excluded.updated_at
            """,
            (
                project_id,
                user_id,
                team_id,
                hub_id,
                str(body.get("hub_label") or body.get("hub_name") or "").strip() or None,
                aps_project_id,
                str(body.get("aps_project_label") or body.get("project_label") or body.get("project_name") or "").strip() or None,
                folder_id,
                str(body.get("folder_label") or body.get("folder_name") or "").strip() or None,
                result.get("item_id"),
                result.get("version_id"),
                now if result.get("item_id") or result.get("version_id") else None,
                now,
            ),
        )
        row = conn.execute(
            """
            SELECT m.*, u.email, u.display_name
              FROM project_fusion_mirrors m
              JOIN users u ON u.id = m.user_id
             WHERE m.project_id = ? AND m.user_id = ?
            """,
            (project_id, user_id),
        ).fetchone()
    return dict(row)


def _fusion_mirror_summary(row: dict[str, Any], *, include_contents: bool = False) -> dict[str, Any]:
    mirror = dict(row)
    if not include_contents:
        return mirror
    mirror["contents"] = {"folders": [], "items": [], "error": None, "needs_relink": False}
    try:
        from backend.services.autodesk_oauth import fusion_mirror_access_issue, get_valid_access_token, list_folder_contents

        token = get_valid_access_token(str(mirror["user_id"]))
        if not token:
            mirror["contents"]["error"] = "Autodesk account not linked."
            mirror["contents"]["needs_relink"] = True
            return mirror
        access_issue = fusion_mirror_access_issue(token, mirror)
        if access_issue:
            mirror["contents"]["error"] = access_issue
            mirror["contents"]["needs_relink"] = True
            return mirror
        contents = list_folder_contents(token, str(mirror["aps_project_id"]), str(mirror["folder_id"]))
        mirror["contents"] = {
            "folders": (contents.get("folders") or [])[:30],
            "items": (contents.get("items") or [])[:50],
            "error": None,
            "needs_relink": False,
        }
    except Exception as exc:
        mirror["contents"]["error"] = str(exc)
        mirror["contents"]["needs_relink"] = "403" in str(exc) or "no longer accessible" in str(exc).lower()
    return mirror


def _delete_fusion_mirror_items(
    *,
    project_id: str,
    project_path: Path,
    filename: str | None = None,
    delete_mirror_rows: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Best-effort deletion for Autodesk items created by project Fusion mirrors."""
    del project_path, filename  # Reserved for future per-file mirror tracking.
    deleted: list[dict[str, Any]] = []
    errors: list[str] = []
    mirrors: list[dict[str, Any]] = []

    try:
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT project_id, user_id, aps_project_id, folder_id, last_item_id
                  FROM project_fusion_mirrors
                 WHERE project_id = ?
                """,
                (project_id,),
            ).fetchall()
            mirrors = [dict(row) for row in rows]
    except Exception as exc:
        return deleted, [f"Could not load Fusion mirror records: {exc}"]

    seen: set[tuple[str, str, str]] = set()
    deleted_keys: set[tuple[str, str, str]] = set()
    try:
        from backend.services.autodesk_oauth import delete_item, get_valid_access_token
    except Exception as exc:
        errors.append(f"Fusion cleanup unavailable: {exc}")
        delete_item = None
        get_valid_access_token = None

    for mirror in mirrors:
        user_id = str(mirror.get("user_id") or "")
        aps_project_id = str(mirror.get("aps_project_id") or "")
        item_id = str(mirror.get("last_item_id") or "")
        if not user_id or not aps_project_id or not item_id:
            continue
        key = (user_id, aps_project_id, item_id)
        if key in seen:
            continue
        seen.add(key)
        if not delete_item or not get_valid_access_token:
            continue
        try:
            token = get_valid_access_token(user_id)
            if not token:
                errors.append(f"Autodesk account not linked for user {user_id}; skipped {item_id}.")
                continue
            result = delete_item(token, aps_project_id, item_id)
            deleted.append({"user_id": user_id, "aps_project_id": aps_project_id, **result})
            deleted_keys.add(key)
        except Exception as exc:
            errors.append(f"Could not delete Autodesk item {item_id}: {exc}")

    try:
        with get_conn() as conn:
            if delete_mirror_rows:
                conn.execute("DELETE FROM project_fusion_mirrors WHERE project_id = ?", (project_id,))
            elif deleted_keys:
                for user_id, aps_project_id, item_id in deleted_keys:
                    conn.execute(
                        """
                        UPDATE project_fusion_mirrors
                           SET last_item_id = NULL,
                               last_version_id = NULL,
                               last_pushed_at = NULL,
                               updated_at = ?
                         WHERE project_id = ?
                           AND user_id = ?
                           AND aps_project_id = ?
                           AND last_item_id = ?
                        """,
                        (datetime.now(timezone.utc).isoformat(), project_id, user_id, aps_project_id, item_id),
                    )
    except Exception as exc:
        errors.append(f"Could not update Fusion mirror records: {exc}")

    return deleted, errors


def _push_file_to_fusion_mirrors(
    project_id: str,
    project_path: Path,
    filename: str,
    *,
    skip_user_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Upload a local STEP to every linked Fusion mirror folder.

    Returns ``pushed_mirrors`` / ``push_errors`` so sync endpoints can report
    teammate fan-out. Failures are non-fatal for local generation.
    """
    pushed_mirrors: list[dict[str, Any]] = []
    push_errors: list[str] = []
    safe = Path(str(filename or "")).name
    if not safe:
        return {"pushed_mirrors": pushed_mirrors, "push_errors": push_errors, "skipped": "missing filename"}
    skip_user_ids = skip_user_ids or set()
    try:
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT project_id, user_id, aps_project_id, folder_id, last_item_id
                  FROM project_fusion_mirrors
                 WHERE project_id = ?
                """,
                (project_id,),
            ).fetchall()
    except Exception as exc:
        logger.warning("Fusion mirror lookup failed for project=%s file=%s: %s", project_id, safe, exc)
        return {"pushed_mirrors": pushed_mirrors, "push_errors": [f"Mirror lookup failed: {exc}"], "skipped": None}
    if not rows:
        return {"pushed_mirrors": pushed_mirrors, "push_errors": push_errors, "skipped": "no mirrors"}

    try:
        step_path = _step_for_cloud_cad(project_path, safe, allow_faceted=False)
    except HTTPException as exc:
        logger.info("Fusion mirror skipped for project=%s file=%s: %s", project_id, safe, exc.detail)
        return {"pushed_mirrors": pushed_mirrors, "push_errors": push_errors, "skipped": str(exc.detail)}
    except Exception as exc:
        logger.warning("Fusion mirror STEP resolution failed for project=%s file=%s: %s", project_id, safe, exc)
        return {"pushed_mirrors": pushed_mirrors, "push_errors": [f"STEP resolution failed: {exc}"], "skipped": None}

    try:
        from backend.services.autodesk_oauth import get_valid_access_token, upload_step_to_folder
    except Exception as exc:
        logger.warning("Fusion mirror unavailable for project=%s file=%s: %s", project_id, safe, exc)
        return {"pushed_mirrors": pushed_mirrors, "push_errors": [f"Fusion upload unavailable: {exc}"], "skipped": None}

    upload_name = f"{step_path.stem}.step"
    data = step_path.read_bytes()
    for row in rows:
        mirror = dict(row)
        user_id = str(mirror.get("user_id") or "")
        aps_project_id = str(mirror.get("aps_project_id") or "")
        folder_id = str(mirror.get("folder_id") or "")
        if not user_id or not aps_project_id or not folder_id:
            continue
        if user_id in skip_user_ids:
            continue
        try:
            token = get_valid_access_token(user_id)
            if not token:
                push_errors.append(f"Autodesk token missing for user {user_id}")
                logger.info("Fusion mirror skipped, Autodesk token missing user=%s project=%s", user_id, project_id)
                continue
            result = upload_step_to_folder(
                token,
                project_id=aps_project_id,
                folder_id=folder_id,
                filename=upload_name,
                data=data,
            )
            now = datetime.now(timezone.utc).isoformat()
            with get_conn() as conn:
                conn.execute(
                    """
                    UPDATE project_fusion_mirrors
                       SET last_item_id = COALESCE(?, last_item_id),
                           last_version_id = COALESCE(?, last_version_id),
                           last_pushed_at = ?,
                           updated_at = ?
                     WHERE project_id = ? AND user_id = ?
                    """,
                    (
                        result.get("item_id"),
                        result.get("version_id"),
                        now,
                        now,
                        project_id,
                        user_id,
                    ),
                )
            pushed_mirrors.append(
                {
                    "user_id": user_id,
                    "aps_project_id": aps_project_id,
                    "folder_id": folder_id,
                    "item_id": result.get("item_id"),
                    "version_id": result.get("version_id"),
                    "filename": upload_name,
                }
            )
            logger.info("Fusion mirror pushed project=%s file=%s user=%s", project_id, upload_name, user_id)
        except Exception as exc:
            push_errors.append(f"Push to {user_id} failed: {exc}")
            logger.warning("Fusion mirror push failed project=%s file=%s user=%s: %s", project_id, upload_name, user_id, exc)
    return {"pushed_mirrors": pushed_mirrors, "push_errors": push_errors, "skipped": None}


def _background_push_new_file_to_fusion(project_id: str, project_path: Path, filename: str) -> None:
    """Best-effort Fusion mirror upload for newly generated/uploaded files."""
    result = _push_file_to_fusion_mirrors(project_id, project_path, filename)
    if result.get("pushed_mirrors"):
        try:
            meta = project_store.load_meta(project_path)
            meta["fusion_pending_push"] = False
            project_store.save_meta(project_path, meta)
        except Exception:
            logger.debug("Could not clear fusion_pending_push after background push", exc_info=True)


def _project_needs_fusion_push(project_path: Path, mirror: dict[str, Any]) -> bool:
    """True when local Render3D edits should be uploaded to Fusion on next access/sync."""
    meta = project_store.load_meta(project_path)
    if meta.get("fusion_pending_push"):
        return True
    filename = project_store.latest_model_file(project_path)
    if not filename:
        return False
    last_pushed = str(mirror.get("last_pushed_at") or "").strip()
    if not last_pushed:
        return True
    updated = str(meta.get("updated_at") or "").strip()
    return bool(updated and updated > last_pushed)


def _seed_fusion_sync_tracking(
    project_path: Path,
    *,
    item_id: str | None,
    version_id: str | None,
    filename: str,
    item_name: str | None = None,
    user_id: str | None = None,
) -> None:
    """Keep Fusion pull tracking aligned after a local push so we don't re-import our own upload."""
    if not item_id:
        return
    meta = project_store.load_meta(project_path)
    sync_state = meta.get("fusion_mirror_sync") if isinstance(meta.get("fusion_mirror_sync"), dict) else {}
    tracked = sync_state.get("items") if isinstance(sync_state.get("items"), dict) else {}
    tracked[str(item_id)] = {
        **(tracked.get(str(item_id)) if isinstance(tracked.get(str(item_id)), dict) else {}),
        "item_id": str(item_id),
        "version_id": str(version_id or ""),
        "filename": filename,
        "viewer_filename": filename,
        "item_name": item_name or Path(filename).stem,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "seeded_from_local_push": True,
    }
    meta["fusion_mirror_sync"] = {
        "items": tracked,
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
        "last_sync_user_id": user_id,
    }
    meta["fusion_pending_push"] = False
    project_store.save_meta(project_path, meta)


def _push_local_changes_to_fusion(
    project_id: str,
    project_path: Path,
    user: dict[str, Any],
    *,
    filename: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Upload pending local edits to the caller's Fusion mirror, then fan out to teammates."""
    from backend.services.autodesk_oauth import get_valid_access_token, upload_step_to_folder

    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM project_fusion_mirrors WHERE project_id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
    if not row:
        return {
            "pushed": False,
            "skipped": "no_mirror",
            "message": "No Fusion mirror linked for this project.",
            "pushed_mirrors": [],
            "push_errors": [],
        }
    mirror = dict(row)
    if not force and not _project_needs_fusion_push(project_path, mirror):
        return {
            "pushed": False,
            "skipped": "up_to_date",
            "message": "Local Render3D changes are already synced to Fusion.",
            "pushed_mirrors": [],
            "push_errors": [],
        }

    aps_project_id = str(mirror.get("aps_project_id") or "")
    folder_id = str(mirror.get("folder_id") or "")
    if not aps_project_id or not folder_id:
        return {
            "pushed": False,
            "skipped": "incomplete_mirror",
            "message": "Fusion mirror is missing project/folder ids.",
            "pushed_mirrors": [],
            "push_errors": [],
        }

    safe = Path(str(filename or project_store.latest_model_file(project_path) or "")).name
    if not safe:
        return {
            "pushed": False,
            "skipped": "no_model",
            "message": "No local model file to push.",
            "pushed_mirrors": [],
            "push_errors": [],
        }

    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")

    try:
        step_path = _step_for_cloud_cad(project_path, safe, allow_faceted=False)
    except HTTPException as exc:
        return {
            "pushed": False,
            "skipped": "no_step",
            "message": str(exc.detail),
            "pushed_mirrors": [],
            "push_errors": [],
        }

    upload_name = f"{step_path.stem}.step"
    try:
        own_result = upload_step_to_folder(
            token,
            project_id=aps_project_id,
            folder_id=folder_id,
            filename=upload_name,
            data=step_path.read_bytes(),
        )
    except Exception as exc:
        raise HTTPException(502, f"Could not sync local changes to Fusion: {exc}") from exc

    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE project_fusion_mirrors
               SET last_item_id = COALESCE(?, last_item_id),
                   last_version_id = COALESCE(?, last_version_id),
                   last_pushed_at = ?,
                   updated_at = ?
             WHERE project_id = ? AND user_id = ?
            """,
            (
                own_result.get("item_id"),
                own_result.get("version_id"),
                now,
                now,
                project_id,
                user["id"],
            ),
        )

    _seed_fusion_sync_tracking(
        project_path,
        item_id=own_result.get("item_id"),
        version_id=own_result.get("version_id"),
        filename=safe,
        item_name=upload_name,
        user_id=user["id"],
    )

    teammate = _push_file_to_fusion_mirrors(
        project_id,
        project_path,
        safe,
        skip_user_ids={str(user["id"])},
    )
    pushed_mirrors = [
        {
            "user_id": user["id"],
            "aps_project_id": aps_project_id,
            "folder_id": folder_id,
            "item_id": own_result.get("item_id"),
            "version_id": own_result.get("version_id"),
            "filename": upload_name,
            "own_mirror": True,
        },
        *(teammate.get("pushed_mirrors") or []),
    ]
    push_errors = list(teammate.get("push_errors") or [])
    return {
        "pushed": True,
        "skipped": None,
        "message": f"Synced {upload_name} to Fusion.",
        "name": upload_name,
        "filename": safe,
        "item_id": own_result.get("item_id"),
        "version_id": own_result.get("version_id"),
        "pushed_mirrors": pushed_mirrors,
        "push_errors": push_errors,
    }


def _collect_fusion_mirror_items(
    token: str,
    aps_project_id: str,
    folder_id: str,
    *,
    depth: int = 0,
    max_depth: int = 4,
) -> list[dict[str, Any]]:
    """Recursively list Fusion items under a mirror folder (with owning folder_id)."""
    from backend.services.autodesk_oauth import list_folder_contents

    contents = list_folder_contents(token, aps_project_id, folder_id)
    collected: list[dict[str, Any]] = []
    for item in contents.get("items") or []:
        collected.append({**item, "folder_id": folder_id})
    if depth >= max_depth:
        return collected
    for child in contents.get("folders") or []:
        child_id = str(child.get("id") or "")
        if not child_id:
            continue
        try:
            collected.extend(
                _collect_fusion_mirror_items(
                    token,
                    aps_project_id,
                    child_id,
                    depth=depth + 1,
                    max_depth=max_depth,
                )
            )
        except Exception as exc:
            logger.warning("Fusion mirror subfolder list failed folder=%s: %s", child_id, exc)
    return collected


def _import_fusion_item_into_existing_project(
    *,
    project_path: Path,
    token: str,
    hub_id: str,
    aps_project_id: str,
    folder_id: str,
    item: dict[str, Any],
    import_bodies: bool,
    user: dict[str, Any],
) -> dict[str, Any]:
    """Download/export a Fusion item into an existing Render3D project."""
    from backend.services.autodesk_oauth import download_item_file, export_fusion_item_as_step
    from backend.services import cad_service

    name = str(item.get("name") or "autodesk_import").strip() or "autodesk_import"
    suffix = Path(name).suffix.lower()
    converted_from_native = False
    if suffix in cad_service.SUPPORTED_IMPORT:
        data = download_item_file(token, item)
    else:
        if not hub_id:
            raise RuntimeError("hub_id is required to convert a native Fusion design to STEP.")
        data = export_fusion_item_as_step(
            token,
            hub_id=hub_id,
            project_id=aps_project_id,
            item_id=str(item.get("id") or ""),
        )
        suffix = ".step"
        converted_from_native = True

    safe_stem = _safe_model_stem(name, "fusion_sync")
    safe_name = f"{safe_stem}{suffix}"
    src_path = project_path / safe_name
    src_path.write_bytes(data)

    viewer_path = src_path
    if suffix == ".3mf":
        mesh = cad_service.load_mesh(src_path)
        viewer_path = src_path.with_suffix(".glb")
        cad_service.export_mesh(mesh, viewer_path)
    elif suffix in cad_service.STEP_SUFFIXES:
        viewer_path = cad_service.tessellate_step_to_glb(src_path)
        if import_bodies:
            try:
                cad_service.split_scene_components_to_glbs(
                    viewer_path,
                    project_path,
                    base_stem=safe_stem,
                )
            except Exception as exc:
                logger.warning("Fusion sync body split failed for %s: %s", safe_name, exc)

    entry = _record_history(
        project_path,
        "fusion_sync",
        f"Sync {name} from Fusion mirror",
        viewer_path.name,
        meta={
            "source_file": src_path.name,
            "autodesk_item_id": item.get("id"),
            "autodesk_version_id": item.get("version_id"),
            "converted_from_native": converted_from_native,
            "folder_id": folder_id,
        },
        user=user,
    )
    project_store.touch_project(project_path)
    return {
        "item_id": item.get("id"),
        "version_id": item.get("version_id") or "",
        "item_name": name,
        "filename": src_path.name,
        "viewer_filename": viewer_path.name,
        "timeline_entry": entry,
    }


@app.get("/api/projects/{project_id}/fusion-mirrors")
def get_project_fusion_mirrors(
    project_id: str,
    include_contents: bool = Query(False),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Per-user Fusion folder mirrors for this shared Render3D project."""
    _require_project_read(user, project_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT m.*, u.email, u.display_name
              FROM project_fusion_mirrors m
              JOIN users u ON u.id = m.user_id
             WHERE m.project_id = ?
             ORDER BY lower(u.display_name), lower(u.email)
            """,
            (project_id,),
        ).fetchall()
    mirrors = [_fusion_mirror_summary(dict(r), include_contents=include_contents) for r in rows]
    return {
        "project_id": project_id,
        "mine": next((m for m in mirrors if m.get("user_id") == user["id"]), None),
        "mirrors": mirrors,
    }


@app.post("/api/projects/{project_id}/fusion-mirror")
def save_project_fusion_mirror(
    project_id: str,
    body: dict = Body(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Bind this user's personal Fusion folder as a mirror for a Render3D project."""
    _require_project_read(user, project_id)
    from backend.services.autodesk_oauth import fusion_mirror_access_issue, get_valid_access_token

    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    hub_id = str(body.get("hub_id") or body.get("autodesk_hub_id") or "").strip()
    aps_project_id = str(body.get("aps_project_id") or body.get("autodesk_project_id") or "").strip()
    folder_id = str(body.get("folder_id") or "").strip()
    access_issue = fusion_mirror_access_issue(token, {
        "hub_id": hub_id,
        "aps_project_id": aps_project_id,
        "folder_id": folder_id,
        "hub_label": body.get("hub_label") or body.get("hub_name"),
        "aps_project_label": body.get("aps_project_label") or body.get("project_label") or body.get("project_name"),
    })
    if access_issue:
        raise HTTPException(422, access_issue)
    team_id = body.get("team_id")
    if not team_id:
        with get_conn() as conn:
            row = conn.execute("SELECT team_id FROM project_access WHERE project_id = ?", (project_id,)).fetchone()
            team_id = row["team_id"] if row else None
    mirror = _upsert_project_fusion_mirror(
        project_id=project_id,
        user_id=user["id"],
        team_id=str(team_id) if team_id else None,
        body=body,
    )
    return {"ok": True, "mirror": mirror}


@app.delete("/api/projects/{project_id}/fusion-mirror")
def delete_project_fusion_mirror(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Remove this user's Fusion mirror folder binding for a Render3D project."""
    _require_project_read(user, project_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM project_fusion_mirrors WHERE project_id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "No Fusion mirror linked for this project.")
        conn.execute(
            "DELETE FROM project_fusion_mirrors WHERE project_id = ? AND user_id = ?",
            (project_id, user["id"]),
        )
    return {"ok": True, "project_id": project_id}


@app.post("/api/projects/{project_id}/fusion-mirror/push-local")
def push_local_changes_to_fusion_mirror(
    project_id: str,
    body: dict = Body(default={}),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Push pending local Render3D edits to the linked Fusion mirror (used on Fusion access)."""
    path = _require_project(user, project_id)
    return _push_local_changes_to_fusion(
        project_id,
        path,
        user,
        filename=(body or {}).get("filename"),
        force=bool((body or {}).get("force", False)),
    )


@app.post("/api/projects/{project_id}/fusion-mirror/sync-from-fusion")
def sync_project_fusion_mirror_from_fusion(
    project_id: str,
    body: dict = Body(default={}),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Push pending local edits to Fusion, pull newer Fusion items, then fan out to teammate mirrors."""
    path = _require_project(user, project_id)
    with _FUSION_SYNC_LOCKS_GUARD:
        sync_lock = _FUSION_SYNC_LOCKS.setdefault(project_id, threading.Lock())
    if not sync_lock.acquire(blocking=False):
        return {
            "changed": False,
            "busy": True,
            "message": "Fusion sync already in progress for this project.",
            "local_push": {"pushed": False},
            "imported": [],
            "pushed_mirrors": [],
            "push_errors": [],
        }
    try:
        return _sync_project_fusion_mirror_from_fusion_locked(project_id, path, body or {}, user)
    finally:
        sync_lock.release()


def _sync_project_fusion_mirror_from_fusion_locked(
    project_id: str,
    path: Path,
    body: dict,
    user: dict[str, Any],
):
    import_bodies = bool(body.get("import_bodies", True))
    from backend.services.autodesk_oauth import fusion_mirror_access_issue, get_valid_access_token

    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM project_fusion_mirrors WHERE project_id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
    if not row:
        raise HTTPException(
            422,
            "No Fusion mirror linked for this project. Open Fusion Library and link a folder first.",
        )
    mirror = dict(row)
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    access_issue = fusion_mirror_access_issue(token, mirror)
    if access_issue:
        raise HTTPException(409, access_issue)

    local_push = _push_local_changes_to_fusion(
        project_id,
        path,
        user,
        filename=body.get("filename"),
        force=bool(body.get("force_push", False)),
    )

    hub_id = str(mirror.get("hub_id") or "")
    aps_project_id = str(mirror.get("aps_project_id") or "")
    folder_id = str(mirror.get("folder_id") or "")
    try:
        items = _collect_fusion_mirror_items(token, aps_project_id, folder_id)
    except Exception as exc:
        raise HTTPException(502, f"Could not list Fusion mirror folder: {exc}") from exc

    meta = project_store.load_meta(path)
    sync_state = meta.get("fusion_mirror_sync") if isinstance(meta.get("fusion_mirror_sync"), dict) else {}
    tracked = sync_state.get("items") if isinstance(sync_state.get("items"), dict) else {}
    imported: list[dict[str, Any]] = []
    import_errors: list[str] = []

    for item in items:
        item_id = str(item.get("id") or "")
        version_id = str(item.get("version_id") or "")
        if not item_id:
            continue
        prev = tracked.get(item_id) if isinstance(tracked.get(item_id), dict) else {}
        prev_version = str(prev.get("version_id") or "")
        if version_id and prev_version and version_id == prev_version:
            continue
        item_name = str(item.get("name") or "autodesk_import").strip() or "autodesk_import"
        safe_stem = _safe_model_stem(item_name, "fusion_sync")
        existing_local = next(
            (
                p
                for p in path.iterdir()
                if p.is_file()
                and not p.name.startswith(".")
                and (p.stem == safe_stem or p.stem.lower() == safe_stem.lower())
            ),
            None,
        )
        if not version_id and prev.get("filename"):
            local = path / str(prev["filename"])
            if local.is_file():
                continue
        # File already in the shared project (e.g. generated here then pushed to Fusion).
        # Seed tracking from the current Fusion version instead of importing a duplicate.
        if existing_local is not None and not prev_version:
            tracked[item_id] = {
                "item_id": item_id,
                "version_id": version_id,
                "filename": existing_local.name,
                "viewer_filename": existing_local.with_suffix(".glb").name
                if existing_local.with_suffix(".glb").is_file()
                else existing_local.name,
                "item_name": item_name,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "seeded_from_local": True,
            }
            continue
        try:
            result = _import_fusion_item_into_existing_project(
                project_path=path,
                token=token,
                hub_id=hub_id,
                aps_project_id=aps_project_id,
                folder_id=str(item.get("folder_id") or folder_id),
                item=item,
                import_bodies=import_bodies,
                user=user,
            )
            tracked[item_id] = {
                "item_id": item_id,
                "version_id": version_id or result.get("version_id") or "",
                "filename": result.get("filename"),
                "viewer_filename": result.get("viewer_filename"),
                "item_name": result.get("item_name"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            imported.append(result)
        except Exception as exc:
            label = item.get("name") or item_id
            import_errors.append(f"{label}: {exc}")
            logger.warning("Fusion mirror import failed project=%s item=%s: %s", project_id, item_id, exc)
            # Seed tracking when the file already landed (or history raced) so auto-sync
            # does not re-download / re-tessellate the same STEP forever.
            glb_path = path / f"{safe_stem}.glb"
            step_path = next(
                (
                    path / f"{safe_stem}{suf}"
                    for suf in (".step", ".stp", ".STEP", ".STP")
                    if (path / f"{safe_stem}{suf}").is_file()
                ),
                None,
            )
            landed = existing_local or (glb_path if glb_path.is_file() else None) or step_path
            if landed is not None and version_id:
                tracked[item_id] = {
                    "item_id": item_id,
                    "version_id": version_id,
                    "filename": landed.name,
                    "viewer_filename": glb_path.name if glb_path.is_file() else landed.name,
                    "item_name": item_name,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "seeded_after_error": True,
                    "last_error": str(exc)[:240],
                }

    # Keep tracking in sync for unchanged items still present in the folder.
    present_ids = {str(i.get("id") or "") for i in items if i.get("id")}
    for item in items:
        item_id = str(item.get("id") or "")
        version_id = str(item.get("version_id") or "")
        if not item_id or item_id not in tracked:
            continue
        if any(r.get("item_id") == item_id for r in imported):
            continue
        entry = dict(tracked[item_id]) if isinstance(tracked[item_id], dict) else {}
        if version_id:
            entry["version_id"] = version_id
        entry["item_name"] = item.get("name") or entry.get("item_name")
        tracked[item_id] = entry
    tracked = {k: v for k, v in tracked.items() if k in present_ids}

    meta["fusion_mirror_sync"] = {
        "items": tracked,
        "last_sync_at": datetime.now(timezone.utc).isoformat(),
        "last_sync_user_id": user["id"],
    }
    project_store.save_meta(path, meta)

    pushed_mirrors: list[dict[str, Any]] = list(local_push.get("pushed_mirrors") or [])
    push_errors: list[str] = list(import_errors)
    push_errors.extend(local_push.get("push_errors") or [])
    # Fan-out imported Fusion updates to teammate mirrors only — skip the syncing user's
    # folder to avoid creating a new Fusion version that would re-trigger the next pull.
    for result in imported:
        filename = result.get("filename") or result.get("viewer_filename")
        if not filename:
            continue
        push = _push_file_to_fusion_mirrors(
            project_id,
            path,
            str(filename),
            skip_user_ids={str(user["id"])},
        )
        pushed_mirrors.extend(push.get("pushed_mirrors") or [])
        push_errors.extend(push.get("push_errors") or [])

    changed = bool(imported) or bool(local_push.get("pushed"))
    if imported:
        latest = imported[-1]
        viewer = latest.get("viewer_filename") or latest.get("filename")
        _notify_project(
            project_id,
            {
                "type": "model.reload",
                "filename": viewer,
                "url": f"/api/projects/{project_id}/files/{viewer}" if viewer else None,
                "by": user.get("display_name"),
                "by_user_id": user["id"],
                "action": "fusion_sync",
                "imported_count": len(imported),
            },
        )
        now = datetime.now(timezone.utc).isoformat()
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE project_fusion_mirrors
                   SET last_item_id = COALESCE(?, last_item_id),
                       last_version_id = COALESCE(?, last_version_id),
                       updated_at = ?
                 WHERE project_id = ? AND user_id = ?
                """,
                (
                    latest.get("item_id"),
                    latest.get("version_id"),
                    now,
                    project_id,
                    user["id"],
                ),
            )

    parts = []
    if local_push.get("pushed"):
        parts.append(local_push.get("message") or "Synced local changes to Fusion")
    if imported:
        parts.append(
            f"Imported {len(imported)} update{'s' if len(imported) != 1 else ''} from Fusion"
        )
    if pushed_mirrors and (imported or local_push.get("pushed")):
        parts.append(f"updated {len(pushed_mirrors)} mirror{'s' if len(pushed_mirrors) != 1 else ''}")
    if parts:
        message = ", and ".join(parts) + "."
    else:
        message = "Fusion mirror folder is reachable. Local and Fusion copies are already in sync."
    if import_errors and not imported and not local_push.get("pushed"):
        message = f"Could not import Fusion updates: {import_errors[0]}"

    return {
        "changed": changed,
        "message": message,
        "local_push": local_push,
        "imported": [
            {
                "item_id": r.get("item_id"),
                "version_id": r.get("version_id"),
                "filename": r.get("filename"),
                "viewer_filename": r.get("viewer_filename"),
                "item_name": r.get("item_name"),
            }
            for r in imported
        ],
        "pushed_mirrors": pushed_mirrors,
        "push_errors": push_errors,
    }


@app.post("/api/projects/{project_id}/push-to-autodesk")
def push_project_to_autodesk(project_id: str, body: dict = Body(default={}), user: dict[str, Any] = Depends(get_current_user)):
    """Upload the current model STEP into a selected Fusion/Autodesk folder."""
    from backend.services.autodesk_oauth import get_valid_access_token, upload_step_as_new_version, upload_step_to_folder
    from backend.services import cad_service

    path = _require_project(user, project_id)
    meta = project_store.load_meta(path)
    source = meta.get("autodesk_source") or {}
    with get_conn() as conn:
        mirror_row = conn.execute(
            "SELECT * FROM project_fusion_mirrors WHERE project_id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
    mirror = dict(mirror_row) if mirror_row else {}
    aps_project_id = str(
        body.get("aps_project_id")
        or body.get("autodesk_project_id")
        or source.get("aps_project_id")
        or mirror.get("aps_project_id")
        or ""
    )
    folder_id = str(body.get("folder_id") or source.get("folder_id") or mirror.get("folder_id") or "")
    item_id = str(body.get("item_id") or source.get("item_id") or "")
    if (
        not item_id
        and mirror.get("last_item_id")
        and aps_project_id == mirror.get("aps_project_id")
        and folder_id == mirror.get("folder_id")
    ):
        item_id = str(mirror["last_item_id"])
    if not aps_project_id or not folder_id:
        raise HTTPException(422, "Link a Fusion mirror folder or provide aps_project_id and folder_id.")

    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")

    filename = body.get("filename") or project_store.latest_model_file(path)
    if not filename:
        raise HTTPException(422, "No model file found in this project.")
    safe = Path(filename).name
    stem = safe[: safe.rfind(".")] if "." in safe else safe
    step_path = _step_for_cloud_cad(path, safe, allow_faceted=bool(body.get("allow_faceted_step")))
    source_path = path / f"{stem}.py"

    upload_name = Path(str(body.get("name") or f"{stem}.step")).name
    if not upload_name.lower().endswith((".step", ".stp")):
        upload_name = f"{Path(upload_name).stem}.step"

    try:
        result = upload_step_to_folder(
            token,
            project_id=aps_project_id,
            folder_id=folder_id,
            filename=upload_name,
                data=step_path.read_bytes(),
            )
        if body.get("upload_source", True) and source_path.is_file():
            try:
                source_name = f"{stem}.build123d.py"
                result["source_upload"] = upload_step_to_folder(
                    token,
                    project_id=aps_project_id,
                    folder_id=folder_id,
                    filename=source_name,
                    data=source_path.read_bytes(),
                )
            except Exception as exc:
                logger.warning("Fusion companion source upload failed for %s: %s", source_path.name, exc)
                result["source_upload_error"] = str(exc)
    except Exception as exc:
        raise HTTPException(502, f"Fusion push failed: {exc}") from exc

    now = datetime.now(timezone.utc).isoformat()
    if mirror:
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE project_fusion_mirrors
                   SET last_item_id = COALESCE(?, last_item_id),
                       last_version_id = COALESCE(?, last_version_id),
                       last_pushed_at = ?,
                       updated_at = ?
                 WHERE project_id = ? AND user_id = ?
                """,
                (
                    result.get("item_id"),
                    result.get("version_id"),
                    now,
                    now,
                    project_id,
                    user["id"],
                ),
            )
        _seed_fusion_sync_tracking(
            path,
            item_id=result.get("item_id"),
            version_id=result.get("version_id"),
            filename=safe,
            item_name=upload_name,
            user_id=user["id"],
        )
    else:
        try:
            meta = project_store.load_meta(path)
            meta["fusion_pending_push"] = False
            project_store.save_meta(path, meta)
        except Exception:
            pass

    teammate = _push_file_to_fusion_mirrors(
        project_id,
        path,
        safe,
        skip_user_ids={str(user["id"])} if mirror else set(),
    )
    result = {
        **result,
        "name": upload_name,
        "filename": safe,
        "pushed_mirrors": [
            *([{
                "user_id": user["id"],
                "aps_project_id": aps_project_id,
                "folder_id": folder_id,
                "item_id": result.get("item_id"),
                "version_id": result.get("version_id"),
                "filename": upload_name,
                "own_mirror": True,
            }] if mirror else []),
            *(teammate.get("pushed_mirrors") or []),
        ],
        "push_errors": list(teammate.get("push_errors") or []),
    }
    return result


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
    project_store.touch_project(proj_path, name=name)
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

    _log_workspace(tid, kind="onshape_import", label=f"Imported {name} from Onshape", user=user, project_id=project_id)

    return {
        "project_id":    project_id,
        "filename":      glb_path.name,
        "step_file":     step_path.name,
        "name":          name,
        "onshape_source": meta["onshape_source"],
    }


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


@app.get("/api/admin/dashboard")
def admin_dashboard(
    user: dict[str, Any] = Depends(get_current_user),
    user_limit: int = Query(12, ge=1, le=50),
    project_limit: int = Query(18, ge=1, le=80),
    prompt_limit: int = Query(40, ge=1, le=160),
):
    """Site-wide management overview for the a1projects account only."""
    _require_a1projects_admin(user)
    from backend.services.ai_cost import entry_effective_cost

    with get_conn() as conn:
        user_rows = conn.execute(
            """
            SELECT id, email, display_name, created_at, avatar_url,
                   ai_provider, ai_model
              FROM users
             ORDER BY created_at DESC
            """
        ).fetchall()
        access_rows = conn.execute(
            """
            SELECT pa.project_id, pa.team_id, pa.folder_id, pa.created_by, pa.created_at,
                   pa.is_public, u.email AS owner_email, u.display_name AS owner_name,
                   t.name AS team_name
              FROM project_access pa
              LEFT JOIN users u ON u.id = pa.created_by
              LEFT JOIN teams t ON t.id = pa.team_id
             ORDER BY pa.created_at DESC
            """
        ).fetchall()

    users_by_id: dict[str, dict[str, Any]] = {}
    for row in user_rows:
        users_by_id[row["id"]] = {
            "id": row["id"],
            "email": row["email"],
            "display_name": row["display_name"],
            "created_at": row["created_at"],
            "avatar_url": row["avatar_url"],
            "ai_provider": row["ai_provider"],
            "ai_model": row["ai_model"],
            "project_count": 0,
            "prompt_count": 0,
            "success_count": 0,
            "error_count": 0,
            "total_cost_usd": 0.0,
            "total_tokens": 0,
            "last_active_at": row["created_at"],
            "recent_projects": [],
            "recent_prompts": [],
        }

    prompt_kind_counts: Counter[str] = Counter()
    prompt_model_counts: Counter[str] = Counter()
    project_format_counts: Counter[str] = Counter()
    daily_prompts: Counter[str] = Counter()
    daily_users_joined: Counter[str] = Counter()
    daily_projects_created: Counter[str] = Counter()
    recent_prompts: list[dict[str, Any]] = []
    recent_projects: list[dict[str, Any]] = []
    projects_scanned = 0
    files_total = 0
    prompt_total = 0
    success_total = 0
    error_total = 0
    cost_total = 0.0
    tokens_total = 0

    for row in user_rows:
        day = _admin_day(row["created_at"])
        if day:
            daily_users_joined[day] += 1

    for access in access_rows:
        pid = access["project_id"]
        project_path = PROJECTS / pid
        if not project_path.is_dir():
            continue
        projects_scanned += 1
        owner_id = access["created_by"]
        if owner_id in users_by_id:
            users_by_id[owner_id]["project_count"] += 1
        day = _admin_day(access["created_at"])
        if day:
            daily_projects_created[day] += 1
        try:
            meta = project_store.load_meta(project_path)
        except Exception:
            meta = {"id": pid, "name": pid}
        try:
            files = cad_service.list_project_files(project_path)
        except Exception:
            files = []
        files_total += len(files)
        for file_info in files:
            fmt = str(file_info.get("format") or Path(file_info.get("name") or "").suffix.lstrip(".") or "file").lower()
            project_format_counts[fmt] += 1
        updated_at = meta.get("updated_at") or access["created_at"]
        project_item = {
            "id": pid,
            "name": meta.get("name") or pid,
            "created_at": meta.get("created_at") or access["created_at"],
            "updated_at": updated_at,
            "file_count": len(files),
            "latest_file": project_store.latest_model_file(project_path),
            "owner_user_id": owner_id,
            "owner_name": access["owner_name"],
            "owner_email": access["owner_email"],
            "team_id": access["team_id"],
            "team_name": access["team_name"],
            "public": bool(access["is_public"]),
        }
        recent_projects.append(project_item)
        if owner_id in users_by_id:
            users_by_id[owner_id]["recent_projects"].append(project_item)
            owner_dt = _parse_admin_dt(users_by_id[owner_id].get("last_active_at"))
            project_dt = _parse_admin_dt(updated_at)
            if project_dt and (owner_dt is None or project_dt > owner_dt):
                users_by_id[owner_id]["last_active_at"] = updated_at

        try:
            entries = prompt_history_service.list_entries(project_path, limit=200)
        except Exception as exc:
            logger.info("Admin dashboard skipped prompt history for %s: %s", pid, exc)
            entries = []
        for entry in entries:
            prompt_total += 1
            kind = str(entry.get("kind") or "cad")
            model = str(entry.get("model") or "unknown")
            prompt_kind_counts[kind] += 1
            prompt_model_counts[model] += 1
            if entry.get("success") is False:
                error_total += 1
            else:
                success_total += 1
            day = _admin_day(entry.get("created_at"))
            if day:
                daily_prompts[day] += 1
            usage = entry.get("usage") or {}
            entry_tokens = int(usage.get("total_tokens") or usage.get("tokens") or 0) if isinstance(usage, dict) else 0
            tokens_total += entry_tokens
            cost = entry_effective_cost(entry)
            if cost is not None:
                cost_total += float(cost)
            entry_user_id = entry.get("user_id") or owner_id
            if entry_user_id in users_by_id:
                user_item = users_by_id[entry_user_id]
                user_item["prompt_count"] += 1
                if entry.get("success") is False:
                    user_item["error_count"] += 1
                else:
                    user_item["success_count"] += 1
                user_item["total_tokens"] += entry_tokens
                if cost is not None:
                    user_item["total_cost_usd"] += float(cost)
                entry_dt = _parse_admin_dt(entry.get("created_at"))
                active_dt = _parse_admin_dt(user_item.get("last_active_at"))
                if entry_dt and (active_dt is None or entry_dt > active_dt):
                    user_item["last_active_at"] = entry.get("created_at")
            prompt_item = {
                "id": entry.get("id"),
                "project_id": pid,
                "project_name": project_item["name"],
                "prompt": _admin_prompt_preview(entry.get("prompt")),
                "success": entry.get("success") is not False,
                "error": entry.get("error"),
                "kind": kind,
                "created_at": entry.get("created_at"),
                "filename": entry.get("filename"),
                "model": entry.get("model"),
                "provider": entry.get("provider"),
                "prompt_mode": entry.get("prompt_mode") or entry.get("speed"),
                "cost_usd": round(float(cost), 6) if cost is not None else None,
                "total_tokens": entry_tokens,
                "user_id": entry_user_id,
                "user_name": entry.get("user_name") or access["owner_name"],
                "owner_name": access["owner_name"],
                "owner_email": access["owner_email"],
            }
            recent_prompts.append(prompt_item)
            if entry_user_id in users_by_id:
                users_by_id[entry_user_id]["recent_prompts"].append(prompt_item)

    def _sort_dt_key(item: dict[str, Any], field: str) -> str:
        return str(item.get(field) or "")

    recent_projects.sort(key=lambda item: _sort_dt_key(item, "updated_at"), reverse=True)
    recent_prompts.sort(key=lambda item: _sort_dt_key(item, "created_at"), reverse=True)
    for user_item in users_by_id.values():
        user_item["recent_projects"].sort(key=lambda item: _sort_dt_key(item, "updated_at"), reverse=True)
        user_item["recent_projects"] = user_item["recent_projects"][:5]
        user_item["recent_prompts"].sort(key=lambda item: _sort_dt_key(item, "created_at"), reverse=True)
        user_item["recent_prompts"] = user_item["recent_prompts"][:5]
        user_item["total_cost_usd"] = round(float(user_item["total_cost_usd"]), 6)

    users = list(users_by_id.values())
    recent_users = sorted(users, key=lambda item: str(item.get("created_at") or ""), reverse=True)[:user_limit]
    active_users = sorted(
        users,
        key=lambda item: (int(item.get("prompt_count") or 0), str(item.get("last_active_at") or "")),
        reverse=True,
    )[:user_limit]

    days = sorted(set(daily_prompts) | set(daily_users_joined) | set(daily_projects_created))[-30:]
    daily = [
        {
            "date": day,
            "prompts": daily_prompts[day],
            "users_joined": daily_users_joined[day],
            "projects_created": daily_projects_created[day],
        }
        for day in days
    ]

    return {
        "admin": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "user_count": len(users_by_id),
            "project_count": projects_scanned,
            "file_count": files_total,
            "prompt_count": prompt_total,
            "success_count": success_total,
            "error_count": error_total,
            "success_rate": round(success_total / prompt_total, 4) if prompt_total else None,
            "estimated_cost_usd": round(cost_total, 6),
            "total_tokens": tokens_total,
        },
        "recent_users": recent_users,
        "active_users": active_users,
        "recent_projects": recent_projects[:project_limit],
        "recent_prompts": recent_prompts[:prompt_limit],
        "prompt_kind_counts": [{"kind": k, "count": v} for k, v in prompt_kind_counts.most_common()],
        "prompt_model_counts": [{"model": k, "count": v} for k, v in prompt_model_counts.most_common(12)],
        "project_format_counts": [{"format": k, "count": v} for k, v in project_format_counts.most_common(12)],
        "daily": daily,
    }


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


@app.get("/api/teams/{team_id}/render-folder")
def get_team_render_folder(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    team = teams_service.get_team_for_user(team_id, user["id"])
    if not team:
        raise HTTPException(403, "Not a member of that workspace")
    return {
        "team_id": team_id,
        "render_folder": {
            "provider": team.get("render_folder_provider") or "render3d",
            "folder_ref": team.get("render_folder_ref"),
            "label": team.get("render_folder_label"),
            "connected_at": team.get("render_folder_connected_at"),
        },
    }


@app.put("/api/teams/{team_id}/render-folder")
def set_team_render_folder(team_id: str, body: TeamRenderFolderRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        team = teams_service.update_render_folder(
            team_id,
            user["id"],
            provider=body.provider,
            folder_ref=body.folder_ref,
            label=body.label,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    entry = _log_workspace(
        team_id,
        kind="render_folder_connected",
        label=f"Connected Render folder: {team.get('render_folder_label') or team.get('render_folder_provider')}",
        user=user,
        meta={
            "provider": team.get("render_folder_provider"),
            "folder_ref": team.get("render_folder_ref"),
            "label": team.get("render_folder_label"),
        },
    )
    _notify_workspace(
        team_id,
        {
            "type": "workspace.render_folder.updated",
            "team": team,
            "entry": entry,
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    return {"team": team, "entry": entry}


@app.get("/api/teams/{team_id}/realtime-editor")
def get_workspace_realtime_editor(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    team = teams_service.get_team_for_user(team_id, user["id"])
    if not team:
        raise HTTPException(403, "Not a member of that workspace")
    projects = []
    for row in teams_service.user_project_access(user["id"], team_id):
        path = PROJECTS / row["project_id"]
        if not path.is_dir():
            continue
        summary = project_store.project_summary(path)
        meta = project_store.load_meta(path)
        with get_conn() as conn:
            mirror_rows = conn.execute(
                """
                SELECT m.*, u.email, u.display_name
                  FROM project_fusion_mirrors m
                  JOIN users u ON u.id = m.user_id
                 WHERE m.project_id = ?
                 ORDER BY lower(u.display_name), lower(u.email)
                """,
                (row["project_id"],),
            ).fetchall()
        projects.append(
            {
                "id": row["project_id"],
                "name": summary.get("name"),
                "latest_file": summary.get("latest_file"),
                "file_count": summary.get("file_count"),
                "updated_at": summary.get("updated_at"),
                "browser": {
                    "components": (summary.get("browser") or {}).get("components") or [],
                    "fusion_components": (summary.get("browser") or {}).get("fusion_components") or [],
                    "fusion_bodies": (summary.get("browser") or {}).get("fusion_bodies") or [],
                    "sketches": (summary.get("browser") or {}).get("sketches") or [],
                    "wiring": (summary.get("browser") or {}).get("wiring") or [],
                    "drawings": (summary.get("browser") or {}).get("drawings") or [],
                    "references": (summary.get("browser") or {}).get("references") or [],
                },
                "fusion_source": meta.get("autodesk_source"),
                "fusion_mirrors": [
                    _fusion_mirror_summary(dict(mirror_row), include_contents=True)
                    for mirror_row in mirror_rows
                ],
                "generation": summary.get("generation"),
            }
        )
    return {
        "team": team,
        "projects": projects,
        "render_folder": {
            "provider": team.get("render_folder_provider") or "render3d",
            "folder_ref": team.get("render_folder_ref"),
            "label": team.get("render_folder_label"),
            "connected_at": team.get("render_folder_connected_at"),
        },
    }


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


@app.get("/api/teams/invite-candidates")
def team_invite_candidates(
    team_id: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
):
    """People you've worked with in other workspaces (for invite dropdowns)."""
    try:
        return {
            "candidates": teams_service.list_workspace_invite_candidates(user["id"], team_id or None),
        }
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc


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
                team_id, user["id"], body.source_key_id, model=body.model, name=body.name,
                scope_type=body.scope_type,
                scope_project_id=body.scope_project_id,
                scope_label=body.scope_label,
            )
        else:
            if not body.api_key:
                raise ValueError("API key is required")
            keys = user_ai_keys_service.add_team_shared_key(
                team_id, user["id"], body.provider, body.api_key,
                model=body.model, name=body.name,
                scope_type=body.scope_type,
                scope_project_id=body.scope_project_id,
                scope_label=body.scope_label,
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
    return {"members": members}


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
    if daily_limit_usd in ("", None):
        daily_limit_usd = None
    elif daily_limit_provided:
        try:
            daily_limit_usd = float(daily_limit_usd)
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "Daily limit must be a number") from exc
        if daily_limit_usd < 0:
            raise HTTPException(400, "Daily limit cannot be negative")
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
        )
    except (ValueError, PermissionError) as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"members": members}


@app.get("/api/teams/{team_id}/folders")
def list_workspace_folders(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        folders = folders_service.list_folders(team_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    public_projects = _public_project_summaries(viewer_user=user)
    folders.append(_public_folder_summary(public_projects, team_id))
    if _is_a1projects_admin(user):
        count = len(_other_user_render_summaries(user, team_id))
        folders.append(
            {
                "id": OTHER_USER_RENDERS_FOLDER_ID,
                "team_id": team_id,
                "parent_id": None,
                "name": OTHER_USER_RENDERS_FOLDER_NAME,
                "sort_order": -100,
                "visibility": "virtual",
                "created_by": None,
                "created_at": None,
                "project_count": count,
                "share_count": 0,
                "can_manage": False,
                "is_owner": False,
                "shared_with_me": False,
                "read_only": True,
                "virtual": True,
            }
        )
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
    prev_folder_id = None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT folder_id FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        if row:
            prev_folder_id = row["folder_id"]
    try:
        result = folders_service.set_project_folder(
            project_id,
            body.folder_id,
            user["id"],
            before_project_id=body.before_project_id,
            at_end=bool(body.at_end),
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    path = PROJECTS / project_id
    folder_changed = (prev_folder_id or None) != (result.get("folder_id") or None)
    # Skip noisy history for pure same-folder reorders.
    if path.is_dir() and folder_changed:
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
    if folder_changed:
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
    if team_id:
        teams = teams_service.list_teams(user["id"])
        if team_id not in {t["id"] for t in teams}:
            raise HTTPException(403, "Not a member of that workspace")
    access = teams_service.user_project_access(user["id"], team_id)
    by_project = {r["project_id"]: r for r in access}
    projects = []
    for project_id, row in by_project.items():
        project_path = PROJECTS / project_id
        if not project_path.is_dir():
            continue
        fid = row.get("folder_id")
        if fid and not folders_service.user_can_access_folder(fid, user["id"]):
            continue
        p = project_store.project_list_summary(project_path)
        p = {
            **p,
            "team_id": row["team_id"],
            "folder_id": fid,
            "folder_name": folders_service.folder_name(fid),
            "sort_order": int(row.get("sort_order") or 0),
        }
        projects.append(p)
    # Stable sort: newest first within the same sort_order, then ascending sort_order.
    projects.sort(key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)
    projects.sort(key=lambda p: int(p.get("sort_order") or 0))
    projects.extend(_other_user_render_summaries(user, team_id))
    # Public is a virtual folder. Always attach public projects with folder_id=__public__,
    # and remove any earlier copies so they don't also appear under root / other folders.
    public_projects = _public_project_summaries(viewer_user=user)
    public_ids = {p["id"] for p in public_projects}
    if public_ids:
        projects = [p for p in projects if p.get("id") not in public_ids]
        projects.extend(public_projects)
    return {"projects": projects}


@app.get("/api/public/projects")
def list_public_projects():
    return {"folder": _public_folder_summary(), "projects": _public_project_summaries()}


@app.get("/api/public/projects/{project_id}")
def get_public_project(project_id: str):
    if not _is_public_project(project_id):
        raise HTTPException(404, "Project not found")
    project_path = PROJECTS / project_id
    owner = _project_owner(project_id) or {}
    summary = project_store.project_summary(project_path)
    summary.update(
        {
            "folder_id": PUBLIC_FOLDER_ID,
            "read_only_project": True,
            "public": True,
            "owner_user_id": owner.get("created_by"),
            "owner_email": owner.get("owner_email"),
            "owner_name": owner.get("owner_name"),
        }
    )
    return summary


@app.post("/api/projects/{project_id}/public")
def set_project_public(
    project_id: str,
    body: dict = Body({}),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    make_public = bool(body.get("public", True))
    with get_conn() as conn:
        conn.execute(
            "UPDATE project_access SET is_public = ? WHERE project_id = ?",
            (1 if make_public else 0, project_id),
        )
        conn.commit()
    return {
        "project_id": project_id,
        "public": make_public,
        "folder_id": PUBLIC_FOLDER_ID if make_public else None,
        "project": {
            **project_store.project_summary(path),
            "folder_id": PUBLIC_FOLDER_ID if make_public else None,
            "read_only_project": make_public,
            "public": make_public,
        },
    }


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
    path = _require_project_read(user, project_id)
    summary = project_store.project_summary(path)
    if _is_other_user_render_project(project_id, user) or _is_public_project(project_id):
        owner = _project_owner(project_id) or {}
        can_manage = teams_service.can_access_project(user["id"], project_id)
        summary.update(
            {
                "folder_id": PUBLIC_FOLDER_ID if _is_public_project(project_id) else OTHER_USER_RENDERS_FOLDER_ID,
                "read_only_project": not can_manage,
                "public": _is_public_project(project_id),
                "owner_user_id": owner.get("created_by"),
                "owner_email": owner.get("owner_email"),
                "owner_name": owner.get("owner_name"),
            }
        )
    return summary


@app.patch("/api/projects/{project_id}")
def rename_project_endpoint(
    project_id: str, body: ProjectRenameRequest, user: dict[str, Any] = Depends(get_current_user)
):
    path = _require_project_read(user, project_id)
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
    path = _require_project_delete(user, project_id)
    team_id = teams_service.project_team_id(project_id)
    generation_service.cancel_project(path)
    fusion_deleted, fusion_delete_errors = _delete_fusion_mirror_items(
        project_id=project_id,
        project_path=path,
        delete_mirror_rows=True,
    )
    shutil.rmtree(path)
    teams_service.delete_project_access(project_id)
    _notify_project(
        project_id,
        {
            "type": "project.deleted",
            "project_id": project_id,
            "fusion_deleted": fusion_deleted,
            "fusion_delete_errors": fusion_delete_errors,
        },
    )
    if team_id:
        _notify_workspace(
            team_id,
            {
                "type": "project.deleted",
                "project_id": project_id,
                "team_id": team_id,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "fusion_deleted": fusion_deleted,
                "fusion_delete_errors": fusion_delete_errors,
            },
        )
    return {"deleted": project_id, "fusion_deleted": fusion_deleted, "fusion_delete_errors": fusion_delete_errors}


@app.get("/api/projects/{project_id}/prompt-history")
def get_prompt_history(
    project_id: str,
    limit: int = Query(80, ge=1, le=200),
    base_filename: str | None = Query(None),
    kind: str | None = Query(None, description="Filter by prompt kind: cad or wiring"),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project_read(user, project_id)
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
        paths, kind=kind, year=year, month=mon, user_id=user["id"]
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

    accessible_projects = teams_service.user_project_access(user["id"], None)
    project_ids = {row["project_id"] for row in accessible_projects}
    for project_id in project_ids:
        project_path = PROJECTS / project_id
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
                "model_breakdown": {},
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
            model = str(entry.get("model") or "unknown")
            provider = str(entry.get("provider") or "openai").lower()
            model_key = f"{provider}:{model}"
            model_item = project_item["model_breakdown"].setdefault(
                model_key,
                {
                    "provider": provider,
                    "model": None if model == "unknown" else model,
                    "prompt_count": 0,
                    "tracked_count": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                    "ai_calls": 0,
                    "total_cost_usd": 0.0,
                    "window_cost_usd": 0.0,
                },
            )
            model_item["prompt_count"] += 1
            model_item["input_tokens"] += tokens["input_tokens"]
            model_item["output_tokens"] += tokens["output_tokens"]
            model_item["total_tokens"] += tokens["total_tokens"]
            model_item["ai_calls"] += int(entry.get("ai_calls") or 0)
            if cost is None:
                continue
            tracked_count += 1
            project_item["tracked_count"] += 1
            model_item["tracked_count"] += 1
            cost = float(cost)
            model_item["total_cost_usd"] += cost
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
                    model_item["window_cost_usd"] += cost
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
                    model_item["window_cost_usd"] += cost
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
        project["model_breakdown"] = sorted(
            [
                {
                    **item,
                    "total_cost_usd": round(float(item["total_cost_usd"]), 6),
                    "window_cost_usd": round(float(item["window_cost_usd"]), 6),
                }
                for item in project["model_breakdown"].values()
            ],
            key=lambda item: float(item.get("window_cost_usd") or item.get("total_cost_usd") or 0),
            reverse=True,
        )
        projects.append(project)
    projects.sort(key=lambda p: p["window_cost_usd"], reverse=True)
    recent_prompts.sort(key=lambda p: p.get("created_at") or "", reverse=True)
    total_input_tokens = sum(int(p.get("input_tokens") or 0) for p in projects)
    total_output_tokens = sum(int(p.get("output_tokens") or 0) for p in projects)
    total_tokens = sum(int(p.get("total_tokens") or 0) for p in projects)

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
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "total_tokens": total_tokens,
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
    path = _require_project_read(user, project_id)
    return history_service.timeline_summary(path)


@app.get("/api/projects/{project_id}/object-history")
def get_object_history(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=200),
):
    path = _require_project_read(user, project_id)
    return {"entries": project_log_service.list_events(path, limit=limit)}


@app.get("/api/projects/{project_id}/project-history")
def get_project_history(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    limit: int = Query(150, ge=1, le=300),
):
    path = _require_project_read(user, project_id)
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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    suffix = Path(file.filename or "").suffix.lower()
    is_reference = cad_service.is_reference_suffix(suffix)
    if suffix not in cad_service.SUPPORTED_IMPORT and not is_reference:
        raise HTTPException(
            400,
            f"Unsupported format. Use: {sorted(cad_service.SUPPORTED_IMPORT | cad_service.SUPPORTED_REFERENCE)}",
        )

    if is_reference:
        dest = cad_service.unique_reference_path(path, file.filename or f"reference{suffix}")
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        project_store.touch_project(path)
        _notify_project(
            project_id,
            {
                "type": "reference.added",
                "filename": dest.name,
                "kind": cad_service.reference_kind(dest.name),
                "url": f"/api/projects/{project_id}/files/{dest.name}",
                "uploaded_filename": dest.name,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "action": "upload_reference",
            },
        )
        return {
            "filename": dest.name,
            "viewer_filename": dest.name,
            "url": f"/api/projects/{project_id}/files/{dest.name}",
            "timeline_index": None,
            "reference": True,
            "kind": cad_service.reference_kind(dest.name),
        }

    dest = path / (file.filename or f"upload{suffix}")
    # Avoid silent overwrites when dropping the same name repeatedly.
    if dest.exists():
        stem = dest.stem
        n = 2
        while True:
            candidate = path / f"{stem}_{n}{suffix}"
            if not candidate.exists():
                dest = candidate
                break
            n += 1
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    if suffix == ".dxf":
        project_store.touch_project(path)
        _notify_project(
            project_id,
            {
                "type": "drawing.added",
                "filename": dest.name,
                "url": f"/api/projects/{project_id}/files/{dest.name}",
                "uploaded_filename": dest.name,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "action": "upload_dxf",
            },
        )
        return {
            "filename": dest.name,
            "viewer_filename": dest.name,
            "url": f"/api/projects/{project_id}/files/{dest.name}",
            "timeline_index": None,
            "drawing": True,
        }

    # Browser can load STL/OBJ/GLB/GLTF natively. Everything else needs a GLB sidecar.
    viewer_filename = dest.name
    needs_viewer_glb = suffix in {".3mf", ".ply", ".off"} | cad_service.STEP_SUFFIXES
    if needs_viewer_glb:
        glb_dest = dest.with_suffix(".glb")
        try:
            if suffix in cad_service.STEP_SUFFIXES:
                cad_service.tessellate_step_to_glb(dest, glb_dest)
            else:
                mesh = cad_service.load_mesh(dest)
                cad_service.export_mesh(mesh, glb_dest)
            viewer_filename = glb_dest.name
        except Exception as exc:
            logger.warning("Viewer GLB conversion failed for %s: %s", dest.name, exc)
            raise HTTPException(
                422,
                f"Uploaded {dest.name}, but could not build a 3D preview ({exc}). "
                "Try exporting as STL or GLB, or repair the file.",
            ) from exc

    entry = _record_history(path, "upload", f"Upload {dest.name}", dest.name, user=user)
    project_store.touch_project(path)
    background_tasks.add_task(_background_push_new_file_to_fusion, project_id, path, dest.name)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": viewer_filename,
            "uploaded_filename": dest.name,
            "url": f"/api/projects/{project_id}/files/{viewer_filename}",
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
        "timeline_index": entry.get("index"),
        "drawing": False,
    }


@app.get("/api/projects/{project_id}/files/{filename}")
def get_file(
    project_id: str,
    filename: str,
    step_mode: str | None = Query(None, description="regular | assembly for STEP downloads"),
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project_read(user, project_id)
    return _file_response(project_path, project_id, filename, step_mode=step_mode)


@app.get("/api/projects/{project_id}/files/{filename}/dxf-preview")
def get_dxf_preview(
    project_id: str,
    filename: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project_read(user, project_id)
    safe = Path(filename).name
    file_path = project_path / safe
    if not file_path.is_file() or file_path.suffix.lower() != ".dxf":
        raise HTTPException(404, "DXF file not found")
    try:
        from backend.skills.dxf.scripts.dxf.render_payload import build_dxf_render_payload

        return build_dxf_render_payload(file_path, file_ref=safe)
    except Exception as exc:
        raise HTTPException(422, f"Could not render DXF: {exc}") from exc


@app.get("/api/projects/{project_id}/files/{filename}/markup")
def get_reference_markup(
    project_id: str,
    filename: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project_read(user, project_id)
    safe = Path(filename).name
    file_path = cad_service.resolve_project_file(project_path, safe)
    if file_path is None or not cad_service.is_reference_suffix(file_path.suffix):
        raise HTTPException(404, "Reference file not found")
    markup = cad_service.load_reference_markup(file_path)
    return {
        "filename": safe,
        "kind": cad_service.reference_kind(safe),
        **markup,
    }


@app.put("/api/projects/{project_id}/files/{filename}/markup")
def put_reference_markup(
    project_id: str,
    filename: str,
    body: ReferenceMarkupRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    safe = Path(filename).name
    file_path = cad_service.resolve_project_file(project_path, safe)
    if file_path is None or file_path.parent.name != cad_service.REFERENCE_DIRNAME:
        raise HTTPException(404, "Reference file not found")
    saved = cad_service.save_reference_markup(
        file_path,
        {"notes": body.notes or "", "strokes": body.strokes or []},
    )
    project_store.touch_project(project_path)
    return {"filename": safe, "kind": cad_service.reference_kind(safe), **saved}


@app.put("/api/projects/{project_id}/files/{filename}/text")
async def put_reference_text(
    project_id: str,
    filename: str,
    body: ReferenceTextRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project(user, project_id)
    safe = Path(filename).name
    file_path = cad_service.resolve_project_file(project_path, safe)
    if file_path is None or file_path.parent.name != cad_service.REFERENCE_DIRNAME:
        raise HTTPException(404, "Reference file not found")
    if file_path.suffix.lower() not in cad_service.REFERENCE_TEXT_SUFFIXES:
        raise HTTPException(400, "Only text reference files can be edited as text")
    content = body.content if body.content is not None else ""
    if len(content) > 2_000_000:
        raise HTTPException(400, "Text content too large")
    file_path.write_text(content, encoding="utf-8")
    project_store.touch_project(project_path)
    return {"filename": safe, "bytes": file_path.stat().st_size}


@app.get("/api/public/projects/{project_id}/files/{filename}")
def get_public_file(project_id: str, filename: str, step_mode: str | None = Query(None)):
    if not _is_public_project(project_id):
        raise HTTPException(404, "Project not found")
    project_path = PROJECTS / project_id
    return _file_response(project_path, project_id, filename, step_mode=step_mode)


def _file_response(project_path: Path, project_id: str, filename: str, *, step_mode: str | None = None):
    safe = Path(filename).name
    file_path = project_path / safe
    if not file_path.is_file():
        resolved = cad_service.resolve_project_file(project_path, safe)
        if resolved is not None:
            file_path = resolved
    if not file_path.is_file() and file_path.suffix.lower() in {".step", ".stp", ".stl", ".3mf", ".obj"}:
        stem = file_path.stem
        for suffix in (".glb", ".gltf", ".step", ".stp", ".stl", ".obj", ".ply", ".off", ".3mf"):
            src = project_path / f"{stem}{suffix}"
            if src.is_file() and src.name != safe:
                try:
                    cad_service.ensure_mesh_exports(project_path, src.name, missing_only=True)
                except Exception as exc:
                    logger.warning("Lazy export generation failed for %s from %s: %s", safe, src.name, exc)
                break
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
    step_mode_normalized = (step_mode or "").lower()
    if file_path.suffix.lower() in {".step", ".stp"} and step_mode_normalized in {"faceted", "mesh"}:
        flat_path = project_path / f"{file_path.stem}__faceted.step"
        try:
            cad_service.export_mesh_step(cad_service.load_mesh(file_path), flat_path)
            file_path = flat_path
            safe = flat_path.name
        except Exception as exc:
            logger.warning("Faceted STEP export failed for %s: %s", safe, exc)
            raise HTTPException(422, f"Could not create faceted STEP: {exc}") from exc
    if file_path.suffix.lower() == ".3mf":
        stem = file_path.stem
        for suffix in (".step", ".stp", ".glb", ".gltf", ".stl", ".obj", ".ply", ".off"):
            src = project_path / f"{stem}{suffix}"
            if src.is_file():
                if cad_service._export_is_stale(src.stat().st_mtime, file_path, "3mf"):
                    try:
                        cad_service.ensure_mesh_exports(project_path, src.name, missing_only=True)
                    except Exception as exc:
                        logger.warning("3MF refresh failed for %s: %s", src.name, exc)
                break
    download_name = safe
    if file_path.suffix.lower() == ".3mf":
        download_name = f"{file_path.stem}.3MF"
    # ES module imports require a JavaScript MIME type (hidden .*.step.js sidecars).
    if file_path.suffix.lower() in {".js", ".mjs"} or file_path.name.endswith(".step.js"):
        return FileResponse(
            file_path,
            filename=download_name,
            media_type="text/javascript",
            headers={"Cache-Control": "no-cache"},
        )
    return FileResponse(file_path, filename=download_name)


def _resolve_share_token(token: str) -> tuple[str, Path, dict[str, Any]]:
    clean = re.sub(r"[^A-Za-z0-9_\-]", "", token or "")
    if not clean:
        raise HTTPException(404, "Share link not found")
    for project_path in PROJECTS.iterdir():
        if not project_path.is_dir():
            continue
        try:
            meta = project_store.load_meta(project_path)
        except Exception:
            continue
        shares = meta.get("file_shares") or {}
        share = shares.get(clean) if isinstance(shares, dict) else None
        if isinstance(share, dict):
            return project_path.name, project_path, share
    raise HTTPException(404, "Share link not found")


def _share_allowed_filenames(project_path: Path, filename: str) -> set[str]:
    safe = Path(filename).name
    allowed = {safe}
    try:
        viewer = cad_service.resolve_viewport_filename(project_path, safe)
        if viewer:
            allowed.add(Path(viewer).name)
    except Exception:
        pass
    try:
        cad_service.ensure_mesh_exports(project_path, safe, missing_only=True)
    except Exception as exc:
        logger.warning("Could not refresh share exports for %s: %s", safe, exc)
    for item in cad_service.list_exports_for_model(project_path, safe):
        name = item.get("name")
        if name:
            allowed.add(Path(name).name)
    return allowed


def _share_metadata(token: str) -> dict[str, Any]:
    project_id, project_path, share = _resolve_share_token(token)
    filename = Path(str(share.get("filename") or "")).name
    if not filename:
        raise HTTPException(404, "Shared file not found")
    if not (project_path / filename).is_file():
        raise HTTPException(404, "Shared file not found")
    allowed = _share_allowed_filenames(project_path, filename)
    viewer_filename = cad_service.resolve_viewport_filename(project_path, filename) or filename
    exports = []
    for item in cad_service.list_exports_for_model(project_path, filename):
        name = Path(str(item.get("name") or "")).name
        if not name or name not in allowed:
            continue
        exports.append({**item, "name": name, "url": f"/api/share/{token}/files/{urllib.parse.quote(name)}"})
    if viewer_filename not in allowed and (project_path / viewer_filename).is_file():
        allowed.add(viewer_filename)
    meta = project_store.load_meta(project_path)
    return {
        "token": token,
        "project_id": project_id,
        "project_name": meta.get("name") or project_id,
        "filename": filename,
        "viewer_filename": viewer_filename,
        "viewer_url": f"/api/share/{token}/files/{urllib.parse.quote(viewer_filename)}",
        "exports": exports,
    }


@app.post("/api/projects/{project_id}/files/{filename}/share")
def create_file_share(project_id: str, filename: str, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    project_path = _require_project_read(user, project_id)
    safe = Path(filename).name
    if not (project_path / safe).is_file():
        raise HTTPException(404, "File not found")
    meta = project_store.load_meta(project_path)
    shares = meta.setdefault("file_shares", {})
    token = next((tok for tok, share in shares.items() if isinstance(share, dict) and share.get("filename") == safe), None)
    if not token:
        token = secrets.token_urlsafe(18)
        while token in shares:
            token = secrets.token_urlsafe(18)
        shares[token] = {
            "filename": safe,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": user["id"],
        }
        project_store.save_meta(project_path, meta)
    base = str(request.base_url).rstrip("/")
    return {"token": token, "share_url": f"{base}/share/{token}"}


@app.get("/api/share/{token}")
def get_share_metadata(token: str):
    return _share_metadata(token)


@app.get("/api/share/{token}/files/{filename}")
def get_share_file(token: str, filename: str, step_mode: str | None = Query(None)):
    project_id, project_path, share = _resolve_share_token(token)
    shared_filename = Path(str(share.get("filename") or "")).name
    if not shared_filename:
        raise HTTPException(404, "Shared file not found")
    safe = Path(filename).name
    if safe not in _share_allowed_filenames(project_path, shared_filename):
        raise HTTPException(404, "File not found")
    return _file_response(project_path, project_id, safe, step_mode=step_mode)


@app.get("/share/{token}", include_in_schema=False)
def share_preview_page(token: str):
    _share_metadata(token)
    token_json = json.dumps(token)
    return Response(
        media_type="text/html",
        content=f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Render3D Share Preview</title>
  <script type="importmap">{{"imports":{{"three":"https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/"}}}}</script>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ margin:0; min-height:100vh; display:grid; grid-template-rows:auto 1fr; background:#070b12; color:#e6edf3; }}
    header {{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px; border-bottom:1px solid #21262d; background:rgba(13,17,23,.92); }}
    h1 {{ margin:0; font-size:1rem; }} p {{ margin:.25rem 0 0; color:#8b949e; font-size:.82rem; }}
    #viewer {{ position:relative; min-height:0; }} canvas {{ display:block; width:100%; height:100%; }}
    .downloads {{ display:flex; flex-wrap:wrap; gap:8px; }}
    .downloads a, .downloads button {{ border:1px solid #30363d; border-radius:999px; background:#161b22; color:#c9d1d9; padding:8px 12px; text-decoration:none; font-weight:700; cursor:pointer; }}
    .downloads a:hover, .downloads button:hover {{ border-color:#58a6ff; color:#79c0ff; }}
    .status {{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); color:#8b949e; }}
    .brand {{ color:#79c0ff; font-weight:900; letter-spacing:.02em; }}
  </style>
</head>
<body>
  <header>
    <div><div class="brand">Render3D</div><h1 id="title">Loading shared model...</h1><p id="subtitle">Rotate preview loads automatically. Pick a format to download.</p></div>
    <div class="downloads" id="downloads"></div>
  </header>
  <main id="viewer"><div class="status" id="status">Loading preview...</div></main>
  <script type="module">
    import * as THREE from "three";
    import {{ GLTFLoader }} from "three/addons/loaders/GLTFLoader.js";
    import {{ OrbitControls }} from "three/addons/controls/OrbitControls.js";
    const token = {token_json};
    const fmtLabel = {{ glb:"GLB", stl:"STL", step:"STEP", "3mf":"3MF", obj:"OBJ" }};
    const meta = await fetch(`/api/share/${{encodeURIComponent(token)}}`).then(r => r.ok ? r.json() : Promise.reject(new Error("Share link not found")));
    document.title = `${{meta.project_name || "Render3D"}} · Share`;
    document.getElementById("title").textContent = meta.project_name || meta.filename;
    document.getElementById("subtitle").textContent = meta.filename;
    const dl = document.getElementById("downloads");
    for (const item of meta.exports || []) {{
      const a = document.createElement("a");
      a.href = item.url;
      a.textContent = fmtLabel[item.format] || String(item.format || "Download").toUpperCase();
      a.download = item.name;
      dl.appendChild(a);
    }}
    const viewer = document.getElementById("viewer");
    const status = document.getElementById("status");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b12);
    const camera = new THREE.PerspectiveCamera(45, viewer.clientWidth / viewer.clientHeight, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({{ antialias:true }});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(viewer.clientWidth, viewer.clientHeight);
    viewer.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    camera.up.set(0, 0, 1);
    controls.object.up.copy(camera.up);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7890a8, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, -4, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(-3, 4, -2); scene.add(fill);
    const root = new THREE.Group(); scene.add(root);
    if (!/\\.glb$/i.test(meta.viewer_filename || "")) {{
      status.textContent = "Preview unavailable for this format. Downloads are ready.";
    }} else {{
      new GLTFLoader().load(meta.viewer_url, (gltf) => {{
        root.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        const sizeVec = box.getSize(new THREE.Vector3());
        const size = sizeVec.length() || 1;
        root.position.set(-center.x, -center.y, -box.min.z);
        const targetZ = Math.max(sizeVec.z * 0.5, size * 0.08);
        camera.position.set(size * 0.95, -size * 1.35, targetZ + size * 0.55);
        camera.near = Math.max(size / 1000, 0.001); camera.far = size * 20; camera.updateProjectionMatrix();
        controls.target.set(0, 0, targetZ);
        controls.update();
        status.remove();
      }}, undefined, () => {{ status.textContent = "Could not load preview. Downloads are ready."; }});
    }}
    function resize() {{
      const w = viewer.clientWidth || innerWidth; const h = viewer.clientHeight || innerHeight - 80;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    }}
    addEventListener("resize", resize); resize();
    function tick() {{ requestAnimationFrame(tick); root.rotation.z += 0.0025; controls.update(); renderer.render(scene, camera); }}
    tick();
  </script>
</body>
</html>""",
    )


@app.get("/api/projects/{project_id}/files/{filename}/exports")
def list_file_exports(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project_read(user, project_id)
    safe = Path(filename).name
    if not (path / safe).is_file():
        stem = Path(safe).stem
        root = stem
        for suffix in ("_edited", "_pulled", "_mirrored", "_extruded", "_body"):
            if root.endswith(suffix):
                root = root[: -len(suffix)]
                break
        fallback = next(
            (
                path / f"{root}{ext}"
                for ext in (".step", ".stp", ".glb", ".gltf", ".stl", ".3mf", ".obj", ".ply", ".off")
                if (path / f"{root}{ext}").is_file()
            ),
            None,
        )
        if fallback is not None:
            safe = fallback.name
        else:
            raise HTTPException(404, "File not found")
    try:
        cad_service.ensure_mesh_exports(path, safe, missing_only=True)
    except Exception as exc:
        logger.warning("Could not refresh exports for %s: %s", safe, exc)
    if not (path / safe).is_file():
        raise HTTPException(404, "File not found")
    # Refresh lightweight sibling exports before listing so edited variants still expose STEP/STL/3MF.
    exports = cad_service.list_exports_for_model(path, safe)
    return {
        "filename": safe,
        "exports": exports,
        "share_url": f"/api/projects/{project_id}/files/{safe}",
    }


@app.get("/api/projects/{project_id}/files/{filename}/step-module")
def get_step_module(
    project_id: str,
    filename: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Locate Jake-style `.<stem>.step.js` motion/parameter sidecar for a model."""
    project_path = _require_project_read(user, project_id)
    safe = Path(filename).name
    module_path = cad_service.resolve_step_module_sidecar(project_path, safe)
    if module_path is None:
        raise HTTPException(404, "No STEP parameter module (.step.js) found for this model")
    return {
        "filename": safe,
        "module": module_path.name,
        "url": f"/api/projects/{project_id}/files/{module_path.name}",
        "mtime": int(module_path.stat().st_mtime),
        "size": module_path.stat().st_size,
    }


@app.get("/api/projects/{project_id}/files/{filename}/cad-params")
def get_cad_params(
    project_id: str,
    filename: str,
    part: str | None = Query(None, description="Optional part/body name to filter parameters"),
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import text_to_cad_params

    path = _require_project_read(user, project_id)
    safe = Path(filename).name
    resolved = text_to_cad_params.resolve_source_for_model(path, safe)
    if resolved is None:
        raise HTTPException(404, "No text-to-cad Python source found for this model")
    source_path, source_name = resolved
    source = source_path.read_text(encoding="utf-8", errors="ignore")
    params = text_to_cad_params.list_parameters(source, part_filter=part)
    return {
        "filename": safe,
        "source": source_name,
        "part": part,
        "params": params,
    }


@app.post("/api/projects/{project_id}/files/{filename}/cad-params")
def update_cad_params(
    project_id: str,
    filename: str,
    body: CadParamsUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import text_to_cad_params

    path = _require_project(user, project_id)
    safe = Path(filename).name
    resolved = text_to_cad_params.resolve_source_for_model(path, safe)
    if resolved is None:
        raise HTTPException(404, "No text-to-cad Python source found for this model")
    source_path, source_name = resolved
    if not body.params:
        raise HTTPException(422, "No parameter updates provided")
    source = source_path.read_text(encoding="utf-8", errors="ignore")
    patched = text_to_cad_params.patch_parameters(source, body.params)
    if patched == source:
        raise HTTPException(422, "Could not apply parameter updates to source")
    source_path.write_text(patched, encoding="utf-8")
    try:
        artifacts = text_to_cad_params.regenerate_model(path, source_name)
    except Exception as exc:
        raise HTTPException(422, f"Regeneration failed: {exc}") from exc
    return {
        "ok": True,
        "filename": safe,
        "source": source_name,
        "params": text_to_cad_params.list_parameters(patched, part_filter=body.part),
        "artifacts": artifacts,
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
    step_path = _step_for_cloud_cad(path, safe, allow_faceted=bool(body.get("allow_faceted_step")))

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
def export_file_to_onshape(
    project_id: str,
    filename: str,
    body: dict = Body(default={}),
    user: dict[str, Any] = Depends(get_current_user),
):
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

    # Find the editable STEP file; do not silently upload mesh-derived fallback STEP.
    stem = safe[: safe.rfind(".")] if "." in safe else safe
    step_path = _step_for_cloud_cad(path, safe, allow_faceted=bool(body.get("allow_faceted_step")))

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
    new_primary = Path(body.name).name
    resolved = cad_service.resolve_project_file(path, safe)
    try:
        if resolved is not None and resolved.parent.name == cad_service.REFERENCE_DIRNAME:
            renamed = cad_service.rename_reference_file(path, safe, new_primary)
        else:
            renamed = cad_service.rename_model_file(path, safe, new_primary)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
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
    resolved = cad_service.resolve_project_file(project_path, safe)
    if resolved is None:
        raise HTTPException(404, "File not found")

    if resolved.parent.name == cad_service.REFERENCE_DIRNAME:
        try:
            deleted_files = cad_service.delete_reference_file(project_path, safe)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        project_store.touch_project(project_path)
        _notify_project(
            project_id,
            {
                "type": "file.deleted",
                "filename": safe,
                "deleted_files": deleted_files,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "reference": True,
            },
        )
        return {
            "deleted": safe,
            "deleted_files": deleted_files,
            "reference": True,
        }

    entry = _record_history(
        project_path,
        "delete_object",
        f"Delete {safe}",
        safe,
        meta={"deleted_file": safe},
        user=user,
    )
    fusion_deleted, fusion_delete_errors = _delete_fusion_mirror_items(
        project_id=project_id,
        project_path=project_path,
        filename=safe,
    )

    try:
        deleted_files = cad_service.delete_model_artifacts(project_path, safe)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc

    entry_meta = entry.get("meta") or {}
    entry_meta["deleted_files"] = deleted_files
    entry_meta["fusion_deleted"] = fusion_deleted
    entry_meta["fusion_delete_errors"] = fusion_delete_errors
    entry["meta"] = entry_meta

    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "file.deleted",
            "filename": safe,
            "deleted_files": deleted_files,
            "fusion_deleted": fusion_deleted,
            "fusion_delete_errors": fusion_delete_errors,
            "by": user["display_name"],
            "by_user_id": user["id"],
            "timeline_entry": entry,
        },
    )
    return {
        "deleted": safe,
        "deleted_files": deleted_files,
        "fusion_deleted": fusion_deleted,
        "fusion_delete_errors": fusion_delete_errors,
        "timeline_index": entry["index"],
        "timeline": history_service.timeline_summary(project_path),
    }


@app.get("/api/projects/{project_id}/architect/building")
def get_architect_building(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Architect Mode building.json — additive; does not touch Design timeline."""
    path = _require_project(user, project_id)
    building_path = path / "architect" / "building.json"
    if not building_path.is_file():
        return {
            "units": "ft",
            "grid": {"segmentFt": 3},
            "levels": [{"id": "level_0", "name": "Ground Floor", "elevationFt": 0, "heightFt": 9}],
            "activeLevelId": "level_0",
            "segments": [],
        }
    try:
        return json.loads(building_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid architect/building.json: {exc}") from exc


@app.put("/api/projects/{project_id}/architect/building")
async def save_architect_building(
    project_id: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Persist Architect building model under projects/<id>/architect/building.json."""
    path = _require_project(user, project_id)
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(400, f"Invalid JSON body: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(400, "Body must be a JSON object")
    arch_dir = path / "architect"
    arch_dir.mkdir(parents=True, exist_ok=True)
    building_path = arch_dir / "building.json"
    building_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    project_store.touch_project(path)
    return {"ok": True, "path": "architect/building.json", "segment_count": len(payload.get("segments") or [])}


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


def _robot_float(value: str | None, fallback: float) -> float:
    try:
        return float(value) if value not in (None, "") else fallback
    except (TypeError, ValueError):
        return fallback


def _parse_robot_urdf_joints(path: Path) -> list[dict[str, Any]]:
    try:
        import xml.etree.ElementTree as ET

        root = ET.fromstring(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return []
    joints: list[dict[str, Any]] = []
    for joint in root.findall(".//joint"):
        name = joint.get("name") or f"joint_{len(joints) + 1}"
        jtype = joint.get("type") or "fixed"
        limit = joint.find("limit")
        axis = joint.find("axis")
        parent = joint.find("parent")
        child = joint.find("child")
        joints.append({
            "name": name,
            "type": jtype,
            "axis": axis.get("xyz") if axis is not None else "0 0 1",
            "parent": parent.get("link") if parent is not None else "",
            "child": child.get("link") if child is not None else "",
            "lower": _robot_float(limit.get("lower") if limit is not None else None, -3.14159),
            "upper": _robot_float(limit.get("upper") if limit is not None else None, 3.14159),
            "file": path.name,
        })
    return joints


def _parse_robot_urdf_links(path: Path) -> list[dict[str, Any]]:
    try:
        import xml.etree.ElementTree as ET

        root = ET.fromstring(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return []
    return [
        {"name": link.get("name") or f"link_{i + 1}", "file": path.name}
        for i, link in enumerate(root.findall(".//link"))
    ]


def _parse_robot_srdf_groups(path: Path) -> dict[str, list[dict[str, Any]]]:
    try:
        import xml.etree.ElementTree as ET

        root = ET.fromstring(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return {"groups": [], "states": [], "end_effectors": []}
    groups = []
    for i, group in enumerate(root.findall(".//group")):
        joint_names = [
            (item.get("name") or "").strip()
            for item in group.findall("joint")
            if (item.get("name") or "").strip()
        ]
        link_names = [
            (item.get("name") or "").strip()
            for item in group.findall("link")
            if (item.get("name") or "").strip()
        ]
        groups.append({
            "name": group.get("name") or f"group_{i + 1}",
            "file": path.name,
            "joints": joint_names,
            "links": link_names,
        })
    states = []
    for i, state in enumerate(root.findall(".//group_state")):
        joint_values: dict[str, float] = {}
        for item in state.findall("joint"):
            jname = (item.get("name") or "").strip()
            if not jname:
                continue
            joint_values[jname] = _robot_float(item.get("value"), 0.0)
        states.append({
            "name": state.get("name") or f"state_{i + 1}",
            "group": state.get("group") or "",
            "file": path.name,
            "joint_values": joint_values,
        })
    end_effectors = []
    for i, ee in enumerate(root.findall(".//end_effector")):
        name = (ee.get("name") or "").strip() or f"ee_{i + 1}"
        end_effectors.append({
            "name": name,
            "group": (ee.get("group") or "").strip(),
            "parent_link": (ee.get("parent_link") or "").strip(),
            "parent_group": (ee.get("parent_group") or "").strip(),
            "file": path.name,
        })
    return {"groups": groups, "states": states, "end_effectors": end_effectors}


def _robot_artifact_summary(project_path: Path) -> dict[str, Any]:
    sources = sorted(path.name for path in project_path.glob("*.py") if path.is_file())
    artifacts = sorted(
        path.name
        for path in project_path.iterdir()
        if path.is_file() and path.suffix.lower() in {".urdf", ".srdf", ".sdf", ".mjcf"}
    )
    joints: list[dict[str, Any]] = []
    links: list[dict[str, Any]] = []
    srdf = {"groups": [], "states": [], "end_effectors": []}
    for name in artifacts:
        path = project_path / name
        suffix = path.suffix.lower()
        if suffix == ".urdf":
            joints.extend(_parse_robot_urdf_joints(path))
            links.extend(_parse_robot_urdf_links(path))
        elif suffix == ".srdf":
            parsed = _parse_robot_srdf_groups(path)
            srdf["groups"].extend(parsed["groups"])
            srdf["states"].extend(parsed["states"])
            srdf["end_effectors"].extend(parsed.get("end_effectors") or [])
    return {
        "sources": sources,
        "artifacts": artifacts,
        "joints": joints,
        "links": links,
        "srdf": srdf,
    }


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


@app.get("/api/projects/{project_id}/rigging/artifacts")
def get_rigging_artifacts(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project(user, project_id)
    return _robot_artifact_summary(path)


@app.get("/api/projects/{project_id}/rigging/moveit2-context")
def get_moveit2_context(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Paths Jake's MoveIt2 server needs: --repo-root = repoRoot, payload.file = srdfFile."""
    path = _require_project(user, project_id)
    summary = _robot_artifact_summary(path)
    artifacts = summary.get("artifacts") or []
    urdf_file = next((name for name in artifacts if str(name).lower().endswith(".urdf")), None)
    stem = Path(urdf_file).stem if urdf_file else ""
    srdf_file = None
    if stem:
        srdf_file = next(
            (name for name in artifacts if str(name).lower() == f"{stem.lower()}.srdf"),
            None,
        )
    if not srdf_file:
        srdf_file = next((name for name in artifacts if str(name).lower().endswith(".srdf")), None)
    return {
        "repoRoot": str(path.resolve()),
        "dir": "",
        "file": srdf_file,
        "urdfFile": urdf_file,
        "wsDefault": "ws://127.0.0.1:8765/ws",
        "hint": (
            f"Start Jake MoveIt2 with --repo-root {path.resolve()} "
            "then Connect / Solve IK / Plan path from the URDF panel."
            if srdf_file
            else "Generate an SRDF artifact before using MoveIt2."
        ),
        **summary,
    }


@app.post("/api/projects/{project_id}/rigging/generate-artifacts")
def generate_rigging_artifacts(
    project_id: str,
    body: RiggingArtifactGenerateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Run Jake-style gen_urdf()/gen_srdf() from a project Python source."""
    from backend.services import skill_runner

    path = _require_project(user, project_id)
    source = Path(body.source).name
    source_path = path / source
    if not source_path.is_file() or source_path.suffix.lower() != ".py":
        raise HTTPException(404, "Python source file not found")
    kind = (body.kind or "both").strip().lower()
    if kind not in {"urdf", "srdf", "both"}:
        raise HTTPException(422, "kind must be urdf, srdf, or both")

    outputs: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    stem = source_path.stem

    def run_one(tool: str, output_name: str, timeout: float = 90.0) -> None:
        result = skill_runner.run_skill_tool(
            tool,
            tool,
            [f"{source}={output_name}"],
            cwd=path,
            timeout_sec=timeout,
        )
        payload = {
            "tool": tool,
            "filename": output_name,
            "stdout": (result.get("stdout") or "")[-4000:],
            "stderr": (result.get("stderr") or "")[-4000:],
            "exit_code": result.get("exit_code"),
        }
        if result.get("ok") and (path / output_name).is_file():
            outputs.append(payload)
        else:
            errors.append(payload)

    if kind in {"urdf", "both"}:
        run_one("urdf", f"{stem}.urdf")
    if kind in {"srdf", "both"}:
        run_one("srdf", f"{stem}.srdf")

    project_store.touch_project(path)
    summary = _robot_artifact_summary(path)
    if errors and not outputs:
        raise HTTPException(422, {
            "message": "Robot artifact generation failed.",
            "outputs": outputs,
            "errors": errors,
            "summary": summary,
        })
    return {
        "message": "Generated robot artifacts." if outputs else "No robot artifacts generated.",
        "outputs": outputs,
        "errors": errors,
        **summary,
    }


@app.put("/api/projects/{project_id}/rigging")
@app.post("/api/projects/{project_id}/rigging")
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
    ai = _get_ai_for_prompt(user, body, project_id=project_id)
    try:
        generation_service.start(
            path,
            kind="rigging",
            trace_id=trace_id,
            user=user,
            prompt=body.prompt,
            label="Rigging animation",
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
    animation_filename = None
    if body.animations:
        animation_filename = "robot.animation.json"
        (path / animation_filename).write_text(
            json.dumps(
                {
                    "name": rig["name"],
                    "animations": body.animations,
                    "activeAnimationId": body.activeAnimationId,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    project_store.touch_project(path)
    _notify_project(
        project_id,
        {
            "type": "rigging.updated",
            "bone_count": len(body.bones),
            "by": user["display_name"],
        },
    )
    suffix = f" + {animation_filename}" if animation_filename else ""
    return {
        "message": f"Exported {urdf_path.name}{suffix} ({len(body.bones)} links)",
        "filename": "robot.urdf",
        "animation_filename": animation_filename,
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
    ai = _get_ai_for_prompt(user, body, project_id=project_id)
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


def _background_wiring_prompt(
    project_id: str,
    body_data: dict[str, Any],
    trace_id: str,
    user: dict[str, Any],
):
    from backend.services import wiring_service

    path = PROJECTS / project_id
    try:
        body = WiringPromptRequest.model_validate(body_data)
        ai = _get_ai_for_wiring(user, body, project_id=project_id)
    except Exception as exc:
        trace_add("error", f"Wiring prompt setup failed: {exc}", trace_id=trace_id)
        generation_service.fail(path, str(exc), trace_id=trace_id)
        return
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
        data={
            "prompt": body.prompt[:300],
            "image_count": len(body.images),
            "driver_link_count": len(body.driver_links),
        },
    )
    try:
        schematic, ai_trace, message = wiring_service.generate_wiring_schematic(
            ai,
            body.prompt,
            current=current,
            images=[img.model_dump() for img in body.images],
            driver_links=body.driver_links,
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
        return
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
        return

    if generation_service.is_canceled(path, trace_id):
        trace_add("info", "Wiring prompt canceled before save", trace_id=trace_id)
        return

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


@app.post("/api/projects/{project_id}/wiring/prompt")
def wiring_prompt(
    project_id: str,
    body: WiringPromptRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Generate or edit a breadboard wiring schematic from a natural-language prompt."""
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
            request_body=body.model_dump(mode="json"),
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
    background_tasks.add_task(
        _background_wiring_prompt,
        project_id,
        body.model_dump(mode="json"),
        trace_id,
        dict(user),
    )
    return JSONResponse(
        status_code=202,
        content={
            "accepted": True,
            "status": "running",
            "trace_id": trace_id,
            "generation": generation_service.public_summary(path),
        },
    )


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

    ai = _get_ai_for_diagnose(user, body, project_id=project_id)

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
        )
    except Exception as exc:
        logger.debug("sketch prompt history save failed: %s", exc)
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
                        user["id"],
                        body.ai_key_id,
                        body.ai_key_source,
                        project_id=project_path.name,
                    ) or {}
                else:
                    effective = user_ai_keys_service.get_effective_key_for_user(user["id"], project_id=project_path.name) or {}
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
            user_avatar_url=_avatar_url_for_user_id(user["id"]) if user else None,
            prompt_mode=(getattr(body, "mode", None) or "standard").lower(),
            **usage_meta,
            **key_meta,
        )
    except Exception as exc:
        logger.debug("prompt history save failed: %s", exc)
    return None


def _decode_data_url_image(data_url: str) -> tuple[bytes, str]:
    match = re.match(r"^data:image/(png|jpeg|jpg|webp);base64,(.+)$", data_url or "", re.DOTALL)
    if not match:
        raise ValueError("Expected a PNG/JPEG/WebP data URL")
    ext = "jpg" if match.group(1) in {"jpeg", "jpg"} else match.group(1)
    try:
        return base64.b64decode(match.group(2), validate=True), ext
    except Exception as exc:
        raise ValueError("Could not decode viewport image") from exc


def _render_ai_for_user(user: dict[str, Any], body: SceneRenderRequest, project_id: str) -> AIService:
    if not body.ai_key_id:
        sam_key = _sam_openai_key()
        if sam_key:
            return AIService(model="gpt-4o-mini", api_key=sam_key["api_key"], provider="openai")
    ai = _get_ai_for_user(
        user,
        body.speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
        project_id=project_id,
    )
    if ai.provider == "openai":
        return ai
    sam_key = _sam_openai_key()
    if sam_key:
        return AIService(model="gpt-4o-mini", api_key=sam_key["api_key"], provider="openai")
    raise HTTPException(400, "Photoreal Render mode needs an OpenAI key.")


def _extract_openai_image_b64(response: Any) -> str | None:
    data = getattr(response, "data", None) or []
    if not data:
        return None
    first = data[0]
    return getattr(first, "b64_json", None) or (first.get("b64_json") if isinstance(first, dict) else None)


def _write_scene_render(project_path: Path, image_bytes: bytes) -> str:
    renders = project_path / "renders"
    renders.mkdir(parents=True, exist_ok=True)
    filename = f"render_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.png"
    (renders / filename).write_bytes(image_bytes)
    return filename


def _scene_render_prompt(user_prompt: str, project_name: str | None, base_filename: str | None) -> str:
    context = f"Model/project: {project_name or 'Render3D model'}"
    if base_filename:
        context += f" ({base_filename})"
    return (
        "Create a photorealistic product/environment render using the provided viewport image as the exact 3D model reference. "
        "Preserve the model's geometry, proportions, color/material intent, and visible orientation. "
        "Do not redesign the model. Place it naturally in the requested real-life environment with realistic lighting, shadows, "
        "camera perspective, contact with surfaces, and plausible scale.\n\n"
        f"{context}\n"
        f"User environment/render direction: {user_prompt}"
    )


def _prompt_via_kernel(
    project_id: str,
    body: PromptRequest,
    trace_id: str,
    ai: AIService,
    user: dict[str, Any],
    project_path: Path,
    progress_callback=None,
):
    """New engineering pipeline: AI -> Feature Program -> validated, exported model."""
    from backend.services import design_service
    from backend.services.design_service import DesignBuildError, DesignCanceled

    refs_list = [r.model_dump() for r in body.references]
    context = _slim_context(project_id, project_path, body)
    previous_source, previous_source_name = (None, None)
    if (getattr(body, "mode", "standard") or "standard").lower() in {"v2", "fusion", "architect"} and body.base_filename:
        previous_source, previous_source_name = _source_for_base_model(project_path, body.base_filename)
        if previous_source_name:
            trace_add(
                "info",
                "Using current model Python source for CAD quality edit",
                trace_id=trace_id,
                data={"base_filename": body.base_filename, "source": previous_source_name},
            )
    timer = TraceTimer("Design pipeline", trace_id)
    cancel_check = lambda: generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir()
    try:
        if hasattr(ai, "set_cancel_check"):
            ai.set_cancel_check(cancel_check)
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
            previous_source=previous_source,
            previous_source_name=previous_source_name,
            cancel_check=cancel_check,
            progress_callback=progress_callback,
        )
        if cancel_check():
            raise DesignCanceled("Generation canceled.")
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
    is_plain_v2 = (body.mode or "standard").lower() == "v2"
    referenced_components = []
    for r in body.references:
        if is_plain_v2 or r.type != "component":
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
    if cancel_check():
        raise DesignCanceled("Generation canceled.")
    program_name = (result.get("program") or {}).get("name")
    meta = project_store.apply_prompt_project_name(
        project_path,
        body.prompt,
        fallback=program_name,
    )
    trace_add("info", f"Design done → {primary} ({out.get('attempts')} attempt(s))", trace_id=trace_id)
    _notify_project(
        project_id,
        {
            "type": "model.reload", "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "placed_parts": placed_parts,
            "by": user["display_name"], "by_user_id": user["id"],
            "action": "prompt", "timeline_entry": entry,
            "project_name": meta.get("name"),
        },
    )
    _notify_project_workspace(
        project_id,
        {
            "type": "project.updated",
            "project_id": project_id,
            "name": meta.get("name"),
            "meta": meta,
        },
    )
    usage_meta = _usage_history_fields(out.get("ai_trace"))
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
        **usage_meta,
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
        speed = body.speed or "fast"
        mode = (body.mode or "standard").lower()
        if mode in {"v2", "fusion", "architect"} and speed == "fast":
            speed = "quality"
        ai = _get_ai_for_user(
            user,
            speed,
            key_id=body.ai_key_id,
            key_source=body.ai_key_source,
            project_id=project_id,
        )
        def progress_callback(progress: dict[str, Any]) -> None:
            generation_service.update_progress(project_path, progress, trace_id=trace_id)

        if hasattr(ai, "set_cancel_check"):
            ai.set_cancel_check(
                lambda: generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir()
            )
        result = _prompt_via_kernel(
            project_id,
            body,
            trace_id,
            ai,
            user,
            project_path,
            progress_callback=progress_callback,
        )
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            return
        complete_payload: dict[str, Any] = {
            "message": result.get("message"),
            "filename": result.get("filename"),
            "url": result.get("url"),
            "timeline_index": result.get("timeline_index"),
            "prompt_id": result.get("prompt_id"),
            "design_plan": result.get("design_plan"),
        }
        for key in ("usage", "cost_usd", "model", "provider", "ai_calls"):
            if result.get(key) is not None:
                complete_payload[key] = result.get(key)
        generation_service.complete(project_path, complete_payload)
        filename = result.get("filename")
        if filename:
            import threading

            threading.Thread(
                target=_background_push_new_file_to_fusion,
                args=(project_id, project_path, filename),
                daemon=True,
                name=f"fusion-new-file-{project_id}-{Path(str(filename)).stem[:24]}",
            ).start()
    except HTTPException as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            return
        detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
        fail_payload: dict[str, Any] = {"error": detail}
        if exc.status_code not in (499,):
            try:
                body = PromptRequest.model_validate(body_data)
                existing = prompt_history_service.list_entries(project_path, limit=500)
                already_saved = any(str(e.get("trace_id") or "") == str(trace_id) for e in existing)
                if not already_saved:
                    saved = _save_prompt_history(
                        project_path,
                        prompt=body.prompt,
                        success=False,
                        body=body,
                        refs_list=[r.model_dump() for r in body.references],
                        trace_id=trace_id,
                        user=user,
                        error=detail,
                        ai_traces=getattr(exc, "ai_traces", None),
                    )
                    if saved:
                        for key in ("usage", "cost_usd", "model", "provider", "ai_calls"):
                            if saved.get(key) is not None:
                                fail_payload[key] = saved.get(key)
            except Exception:
                pass
        generation_service.fail(project_path, detail, trace_id=trace_id, extra=fail_payload)
    except Exception as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            return
        logger.exception("Background prompt failed project=%s trace=%s", project_id, trace_id)
        fail_payload = {"error": str(exc)}
        ai_traces = getattr(exc, "ai_traces", None)
        if ai_traces:
            usage_meta = _usage_history_fields(ai_traces)
            fail_payload.update({k: v for k, v in usage_meta.items() if v is not None})
            try:
                body = PromptRequest.model_validate(body_data)
                _save_prompt_history(
                    project_path,
                    prompt=body.prompt,
                    success=False,
                    body=body,
                    refs_list=[r.model_dump() for r in body.references],
                    trace_id=trace_id,
                    user=user,
                    error=str(exc),
                    ai_traces=ai_traces,
                )
            except Exception:
                pass
        generation_service.fail(project_path, str(exc), trace_id=trace_id, extra=fail_payload)


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


def _with_image_generated_dxf_reference(body: PromptRequest, ai: "AIService", trace_id: str | None) -> PromptRequest:
    """Convert attached image references into a hidden DXF reference for CAD prompts."""
    if not body.images:
        return body
    if any(str(ref.type or "").lower() == "dxf" for ref in body.references):
        return body
    try:
        dxf_text, call_trace = ai.generate_dxf_from_images(
            body.prompt,
            images=[img.model_dump() for img in body.images[:4]],
            trace_id=trace_id,
        )
    except Exception as exc:
        trace_add(
            "warning",
            f"Image-to-DXF conversion failed; continuing with image references only: {exc}",
            trace_id=trace_id,
        )
        return body
    if not dxf_text.strip():
        return body
    image_names = ", ".join(img.name for img in body.images[:4])
    ref = GeoReference(
        id="vision-reference",
        type="dxf",
        label=f"Vision DXF from image{'s' if len(body.images) != 1 else ''}",
        filename="vision-reference.dxf",
        stem="vision-reference",
        format="dxf",
        text_content=dxf_text[:90000],
        text_truncated=len(dxf_text) > 90000,
    )
    instruction = (
        "\n\nUse the attached generated DXF reference `@vision-reference` as the primary 2D drawing extracted "
        f"from the uploaded image{'s' if len(body.images) != 1 else ''} ({image_names}). Follow the DXF geometry, "
        "layers, proportions, notes, and inferred dimensions when creating the 3D model. Use the original image(s) "
        "only to resolve ambiguity, color/material/style, and 3D depth."
    )
    trace_add(
        "info",
        "Generated hidden DXF reference from prompt image(s)",
        trace_id=trace_id,
        data={
            "image_count": len(body.images),
            "dxf_chars": len(dxf_text),
            "model": call_trace.get("model"),
            "provider": call_trace.get("provider"),
        },
    )
    skills = body.skills
    if "dxf" not in {str(s).lower() for s in skills}:
        skills = [*skills, "dxf"]
    return body.model_copy(update={
        "prompt": f"{body.prompt}{instruction}"[:8000],
        "references": [*body.references, ref],
        "skills": skills,
    })


def _with_image_generated_dxf_reference(body: PromptRequest, ai: "AIService", trace_id: str | None) -> PromptRequest:
    """Convert attached image references into a hidden DXF reference for CAD prompts."""
    if not body.images:
        return body
    if any(str(ref.type or "").lower() == "dxf" for ref in body.references):
        return body
    try:
        dxf_text, call_trace = ai.generate_dxf_from_images(
            body.prompt,
            images=[img.model_dump() for img in body.images[:4]],
            trace_id=trace_id,
        )
    except Exception as exc:
        trace_add(
            "warning",
            f"Image-to-DXF conversion failed; continuing with image references only: {exc}",
            trace_id=trace_id,
        )
        return body
    if not dxf_text.strip():
        return body
    image_names = ", ".join(img.name for img in body.images[:4])
    ref = GeoReference(
        id="vision-reference",
        type="dxf",
        label=f"Vision DXF from image{'s' if len(body.images) != 1 else ''}",
        filename="vision-reference.dxf",
        stem="vision-reference",
        format="dxf",
        text_content=dxf_text[:90000],
        text_truncated=len(dxf_text) > 90000,
    )
    instruction = (
        "\n\nUse the attached generated DXF reference `@vision-reference` as the primary 2D drawing extracted "
        f"from the uploaded image{'s' if len(body.images) != 1 else ''} ({image_names}). Follow the DXF geometry, "
        "layers, proportions, notes, and inferred dimensions when creating the 3D model. Use the original image(s) "
        "only to resolve ambiguity, color/material/style, and 3D depth."
    )
    trace_add(
        "info",
        "Generated hidden DXF reference from prompt image(s)",
        trace_id=trace_id,
        data={
            "image_count": len(body.images),
            "dxf_chars": len(dxf_text),
            "model": call_trace.get("model"),
            "provider": call_trace.get("provider"),
        },
    )
    skills = body.skills
    if "dxf" not in {str(s).lower() for s in skills}:
        skills = [*skills, "dxf"]
    return body.model_copy(update={
        "prompt": f"{body.prompt}{instruction}"[:8000],
        "references": [*body.references, ref],
        "skills": skills,
    })


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
    body = _resolve_prompt_reference_body(project_id, project_path, body, user, trace_id)
    body = _with_reference_edit_base(project_path, body, trace_id)
    inferred_edit_base = _infer_implicit_edit_base(project_path, body)
    if inferred_edit_base:
        trace_add(
            "info",
            "Inferred base model for implicit CAD edit",
            trace_id=trace_id,
            data={"base_filename": inferred_edit_base},
        )
        body = body.model_copy(update={"base_filename": inferred_edit_base})
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
    speed = body.speed or "fast"
    mode = (body.mode or "standard").lower()
    if mode in {"v2", "fusion", "architect"} and speed == "fast":
        speed = "quality"
    ai = _get_ai_for_user(
        user,
        speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
        project_id=project_id,
    )
    body = _with_image_generated_dxf_reference(body, ai, trace_id)
    resolved_skills = skills_service.resolve_prompt_skills(
        body.skills,
        has_images=bool(body.images),
        prompt=body.prompt,
        user_id=user["id"],
    )
    if any(str(ref.type or "").lower() == "dxf" for ref in body.references):
        missing_dxf_content: list[str] = []
        for ref in body.references:
            if str(ref.type or "").lower() != "dxf":
                continue
            if (ref.text_content or "").strip():
                continue
            raw_name = ref.filename or ref.label or ""
            safe_name = Path(str(raw_name)).name.strip()
            if safe_name and not safe_name.lower().endswith(".dxf"):
                safe_name = f"{Path(safe_name).stem or 'reference'}.dxf"
            if safe_name and (project_path / safe_name).is_file():
                continue
            missing_dxf_content.append(ref.filename or ref.label or ref.id)
        if missing_dxf_content:
            raise HTTPException(
                422,
                "DXF reference content was not attached and the DXF file is not saved in this project. "
                "Drop the DXF into the AI prompt or upload it to DXF Drawings, then retry. "
                f"Missing DXF content for: {', '.join(missing_dxf_content[:3])}",
            )
        resolved_skills = [*resolved_skills, "dxf"] if "dxf" not in {s.lower() for s in resolved_skills} else resolved_skills

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
    # 2.0/Fusion modes intentionally follow text-to-cad source generation instead of legacy
    # project-specific deterministic rebuilds.
    if (body.mode or "standard").lower() not in {"v2", "fusion"} and _is_appliance_toolhead_swap(body, project_path):
        trace_add(
            "info",
            "Routing appliance toolhead swap to parametric rebuild",
            trace_id=trace_id,
            data={"base_filename": body.base_filename},
        )
        return _rebuild_cooking_appliance_toolhead(project_id, body, trace_id, user, project_path)

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
            "fixture_prompt": _looks_like_fixture_prompt(body.prompt, body.images),
        },
    )
    if use_kernel:
        updates: dict[str, Any] = {"skills": resolved_skills}
        normalized_mode = (body.mode or "standard").lower()
        if normalized_mode == "v2":
            # Keep user-provided refs (especially DXF attachments/context) in 2.0 mode.
            # Only force pipeline knobs that are specific to v2 routing.
            v2_skills = ["cad"]
            if "dxf" in {str(s).lower() for s in resolved_skills}:
                v2_skills.append("dxf")
            updates.update({
                "base_filename": None,
                "fusion_target": "in_app",
                "skills": v2_skills,
            })
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


@app.get("/api/projects/{project_id}/renders/{filename}")
def get_scene_render(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    project_path = _require_project_read(user, project_id)
    safe = Path(filename).name
    path = project_path / "renders" / safe
    if not path.is_file():
        raise HTTPException(404, "Render not found")
    return FileResponse(path, media_type="image/png")


@app.post("/api/projects/{project_id}/scene-render")
def render_scene_image(project_id: str, body: SceneRenderRequest, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    project_path = _require_project(user, project_id)
    try:
        viewport_bytes, _ext = _decode_data_url_image(body.viewport_image)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    ai = _render_ai_for_user(user, body, project_id)
    if ai.provider != "openai":
        raise HTTPException(400, "Photoreal Render mode needs an OpenAI key.")
    project_meta = project_store.load_meta(project_path)
    prompt = _scene_render_prompt(body.prompt, project_meta.get("name"), body.base_filename)
    trace_add(
        "info",
        "Scene render started",
        trace_id=trace_id,
        data={"prompt": body.prompt[:300], "model": "gpt-image-1", "base_filename": body.base_filename},
    )
    try:
        import io

        image_file = io.BytesIO(viewport_bytes)
        image_file.name = "viewport.png"
        response = ai.client.images.edit(
            model="gpt-image-1",
            image=image_file,
            prompt=prompt,
            size="1024x1024",
        )
        b64 = _extract_openai_image_b64(response)
        if not b64:
            raise RuntimeError("Image API returned no image data")
        render_bytes = base64.b64decode(b64)
    except Exception as exc:
        trace_add("error", f"Scene render failed: {exc}", trace_id=trace_id)
        prompt_history_service.append_entry(
            project_path,
            prompt=body.prompt,
            success=False,
            message=None,
            filename=body.base_filename,
            base_filename=body.base_filename,
            speed=body.speed,
            error=str(exc),
            references=[],
            images=[{"id": "viewport", "name": "viewport.png", "media_type": "image/png"}],
            trace_id=trace_id,
            user_id=user["id"],
            user_name=user["display_name"],
            user_avatar_url=_avatar_url_for_user_id(user["id"]),
            prompt_mode="render",
            kind="render",
            model="gpt-image-1",
            provider="openai",
        )
        raise HTTPException(502, f"Scene render failed: {exc}") from exc

    filename = _write_scene_render(project_path, render_bytes)
    url = f"/api/projects/{project_id}/renders/{filename}"
    message = f"Rendered scene: {body.prompt}"
    hist_entry = prompt_history_service.append_entry(
        project_path,
        prompt=body.prompt,
        success=True,
        message=message,
        filename=filename,
        base_filename=body.base_filename,
        speed=body.speed,
        references=[],
        images=[{"id": "viewport", "name": "viewport.png", "media_type": "image/png"}],
        trace_id=trace_id,
        user_id=user["id"],
        user_name=user["display_name"],
        user_avatar_url=_avatar_url_for_user_id(user["id"]),
        prompt_mode="render",
        kind="render",
        model="gpt-image-1",
        provider="openai",
    )
    owner = _project_owner(project_id) or {}
    if owner.get("team_id"):
        _log_workspace(
            owner["team_id"],
            kind="scene_render",
            label=message,
            user=user,
            project_id=project_id,
            meta={"render_filename": filename, "base_filename": body.base_filename},
        )
    return {
        "kind": "scene_render",
        "filename": filename,
        "url": url,
        "message": message,
        "trace_id": trace_id,
        "prompt_id": hist_entry.get("id") if hist_entry else None,
        "model": "gpt-image-1",
        "provider": "openai",
        "prompt_mode": "render",
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
    background_tasks: BackgroundTasks,
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
    _append_mesh_edit(project_path, filename, {"op": "transform", "parent": filename, "child": out.name, **transform, "copy": body.copy})
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
        "timeline_entry": entry,
        "timeline": history_service.timeline_summary(project_path),
        "parent": safe,
        "replace_catalog": safe,
        "action": "transform",
    }


@app.post("/api/projects/{project_id}/files/{filename}/transform-body")
def transform_body_file(
    project_id: str,
    filename: str,
    body: BodyTransformRequest,
    background_tasks: BackgroundTasks,
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
    background_tasks.add_task(_background_push_render_edit_to_fusion, project_id, project_path, safe)
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
        "timeline_entry": entry,
        "timeline": history_service.timeline_summary(project_path),
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


def _program_file_for(project_path: Path, glb_filename: str) -> Path | None:
    """Resolve the .program.json that corresponds to a .glb filename."""
    stem = Path(glb_filename).stem
    # Strip common suffixes added by edits
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
        raise HTTPException(422, "No program file found for this model. Fillet/chamfer require a parametric (.program.json) source.")
    try:
        out_path = cad_service.apply_program_fillet(
            project_path, prog.name, body.radius_mm, edges=body.edges
        )
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    meta = body.model_dump()
    entry = _record_history(
        project_path,
        "fillet",
        f"Fillet r={body.radius_mm}mm {body.edges} edges",
        out_path.name,
        meta=meta,
        user=user,
    )
    project_store.touch_project(project_path)
    _notify_project(project_id, {
        "type": "model.reload",
        "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "by": user["display_name"],
        "by_user_id": user["id"],
        "action": "fillet",
        "timeline_entry": entry,
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
        raise HTTPException(422, "No program file found for this model. Fillet/chamfer require a parametric (.program.json) source.")
    try:
        out_path = cad_service.apply_program_chamfer(
            project_path, prog.name, body.length_mm, edges=body.edges
        )
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc
    meta = body.model_dump()
    entry = _record_history(
        project_path,
        "chamfer",
        f"Chamfer d={body.length_mm}mm {body.edges} edges",
        out_path.name,
        meta=meta,
        user=user,
    )
    project_store.touch_project(project_path)
    _notify_project(project_id, {
        "type": "model.reload",
        "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "by": user["display_name"],
        "by_user_id": user["id"],
        "action": "chamfer",
        "timeline_entry": entry,
    })
    return {
        "filename": out_path.name,
        "url": f"/api/projects/{project_id}/files/{out_path.name}",
        "timeline_index": entry["index"],
        "meta": meta,
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


def _primitive_feature(body: CreatePrimitiveRequest) -> dict[str, Any]:
    op = str(body.op or "").strip().lower()
    if op not in {"box", "cylinder", "sphere", "cone", "torus"}:
        raise ValueError(f"Unsupported primitive '{body.op}'")
    combine = str(body.combine or "new").strip().lower()
    if combine not in {"new", "add", "cut", "intersect"}:
        raise ValueError(f"Unknown combine mode '{body.combine}'")
    feat: dict[str, Any] = {"op": op, "combine": combine, "at": [float(v) for v in body.at[:3]]}
    if op == "box":
        if not all(v and v > 0 for v in (body.length, body.width, body.height)):
            raise ValueError("Box needs positive length, width, and height")
        feat.update(length=float(body.length), width=float(body.width), height=float(body.height))
    elif op == "cylinder":
        if not body.radius or body.radius <= 0 or not body.height or body.height <= 0:
            raise ValueError("Cylinder needs positive radius and height")
        feat.update(radius=float(body.radius), height=float(body.height))
    elif op == "sphere":
        if not body.radius or body.radius <= 0:
            raise ValueError("Sphere needs a positive radius")
        feat.update(radius=float(body.radius))
    elif op == "cone":
        br = body.bottom_radius if body.bottom_radius is not None else body.radius
        if not br or br <= 0 or not body.height or body.height <= 0:
            raise ValueError("Cone needs positive bottom radius and height")
        feat.update(bottom_radius=float(br), top_radius=float(body.top_radius or 0.0), height=float(body.height))
    else:  # torus
        if not body.major_radius or body.major_radius <= 0 or not body.minor_radius or body.minor_radius <= 0:
            raise ValueError("Torus needs positive major and minor radii")
        feat.update(major_radius=float(body.major_radius), minor_radius=float(body.minor_radius))
    return feat


def _next_primitive_basename(project_path: Path, op: str) -> str:
    if not (project_path / f"{op}.glb").is_file():
        return op
    i = 2
    while (project_path / f"{op}{i}.glb").is_file():
        i += 1
    return f"{op}{i}"


@app.post("/api/projects/{project_id}/create-primitive")
def create_primitive(
    project_id: str,
    body: CreatePrimitiveRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Place a parametric primitive synchronously — no AI, no background build job."""
    project_path = _require_project(user, project_id)
    try:
        feat = _primitive_feature(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    op = feat["op"]
    combine = feat["combine"]
    label_map = {"box": "Box", "cylinder": "Cylinder", "sphere": "Sphere", "cone": "Cone", "torus": "Torus"}

    if combine != "new" and body.base_filename:
        src = project_path / body.base_filename
        if not src.is_file():
            raise HTTPException(404, "Base file not found")
        import uuid

        from backend.services import kernel_bridge

        tmp_base = f"_prim_{uuid.uuid4().hex[:8]}"
        tmp_program = {
            "name": tmp_base,
            "units": "mm",
            "parts": [{"id": "solid", "features": [{**feat, "combine": "new"}]}],
        }
        try:
            tmp_result = kernel_bridge.build_and_export(tmp_program, project_path, basename=tmp_base)
            prim_mesh = cad_service.load_mesh(project_path / tmp_result["primary"])
            base_mesh = cad_service.load_mesh(src)
            op_map = {"add": "union", "cut": "difference", "intersect": "intersection"}
            result = cad_service.boolean_meshes(base_mesh, prim_mesh, op_map[combine])
        finally:
            for pattern in (f"{tmp_base}.*", f"{tmp_base}_*.*"):
                for path in project_path.glob(pattern):
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        pass
        out = _edited_output(project_path, src, f"_{op}")
        cad_service.export_mesh(result, out)
        meta = body.model_dump()
        entry = _record_history(
            project_path,
            "primitive",
            f"{label_map.get(op, op)} ({combine})",
            out.name,
            meta=meta,
            user=user,
        )
        _append_mesh_edit(
            project_path,
            body.base_filename,
            {"op": "create_primitive", "parent": body.base_filename, "child": out.name, **meta},
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
                "action": "create_primitive",
                "timeline_entry": entry,
            },
        )
        return {
            "filename": out.name,
            "url": f"/api/projects/{project_id}/files/{out.name}",
            "timeline_index": entry["index"],
            "meta": meta,
            "parent": body.base_filename,
            "action": "create_primitive",
            "replace_catalog": body.base_filename,
            "message": f"Added {label_map.get(op, op).lower()} ({combine}).",
        }

    from backend.services import kernel_bridge

    program = {
        "name": op,
        "units": "mm",
        "parts": [{"id": "solid", "features": [feat]}],
    }
    basename = _next_primitive_basename(project_path, op)
    try:
        result = kernel_bridge.build_and_export(program, project_path, basename=basename)
    except Exception as exc:
        raise HTTPException(422, str(exc)) from exc

    primary = result["primary"]
    meta = body.model_dump()
    entry = _record_history(
        project_path,
        "primitive",
        label_map.get(op, op),
        primary,
        meta=meta,
        user=user,
    )
    project_store.touch_project(project_path)
    _notify_project(
        project_id,
        {
            "type": "model.reload",
            "filename": primary,
            "url": f"/api/projects/{project_id}/files/{primary}",
            "by": user["display_name"],
            "by_user_id": user["id"],
            "action": "create_primitive",
            "timeline_entry": entry,
        },
    )
    return {
        "filename": primary,
        "url": f"/api/projects/{project_id}/files/{primary}",
        "timeline_index": entry["index"],
        "meta": meta,
        "program": result.get("program"),
        "action": "create_primitive",
        "message": f"Created {label_map.get(op, op).lower()}.",
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
        result = cad_service.hole_at_point(
            mesh,
            position,
            axis=axis,
            diameter=diameter,
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
        "placement": body.placement,
        "through_all": body.through_all,
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
        "message": f"Added a {body.diameter_mm:g} mm through-hole.",
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

    face_indices = sorted({int(i) for i in (body.face_indices or ([] if body.face_index is None else [body.face_index])) if int(i) >= 0})
    if not face_indices:
        raise HTTPException(400, "Pick one or more faces before applying Press-Pull.")

    mesh = cad_service.load_mesh(src)
    operation_src = src
    try:
        result = cad_service.face_pull_many(
            mesh,
            face_indices,
            distance=body.distance,
            op=body.op,
            direction=body.direction,
            distance2=body.distance2,
            taper_deg=body.taper_deg,
            through=body.through_all,
            normal=body.normal,
        )
    except ValueError as exc:
        message = str(exc)
        viewer_name = cad_service.viewer_filename_for_model(src.name, project_path)
        viewer_src = project_path / viewer_name
        if "face_index out of range" not in message or viewer_src == src or not viewer_src.is_file():
            raise HTTPException(422, message) from exc
        try:
            mesh = cad_service.load_mesh(viewer_src)
            result = cad_service.face_pull_many(
                mesh,
                face_indices,
                distance=body.distance,
                op=body.op,
                direction=body.direction,
                distance2=body.distance2,
                taper_deg=body.taper_deg,
                through=body.through_all,
                normal=body.normal,
            )
            operation_src = viewer_src
        except ValueError as retry_exc:
            raise HTTPException(422, str(retry_exc)) from retry_exc

    suffix = "_body" if body.op == "new_body" else "_pulled"
    out = _edited_output(project_path, operation_src, suffix)
    cad_service.export_mesh(result, out)
    op_label = body.op if body.op != "auto" else ("cut" if body.distance < 0 else "join")
    meta = body.model_dump()
    meta["face_indices"] = face_indices
    entry = _record_history(
        project_path,
        "face_pull",
        f"Press-pull {len(face_indices)} face{'s' if len(face_indices) != 1 else ''} {op_label} {abs(body.distance):g}",
        out.name,
        meta=meta,
        user=user,
    )
    _append_mesh_edit(project_path, operation_src.name, {"op": "face_pull", "parent": operation_src.name, "child": out.name, **meta})
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
    if body.preview:
        return {
            "filename": out_path.name,
            "url": f"/api/projects/{project_id}/files/{out_path.name}",
            "meta": meta,
            "preview": True,
            "action": "fillet_preview",
            "replaceCatalog": filename,
        }
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
        "parent": filename,
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
    if body.preview:
        return {
            "filename": out_path.name,
            "url": f"/api/projects/{project_id}/files/{out_path.name}",
            "meta": meta,
            "preview": True,
            "action": "chamfer_preview",
            "replaceCatalog": filename,
        }
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
    # Prefer the viewport GLB when the client asks about a STEP assembly: dense
    # Compounds (stairs, etc.) report 50–100+ solids from STEP while the viewer
    # mesh is already a single assembly shell.
    mesh_src = src
    suffix = src.suffix.lower()
    if suffix in {".step", ".stp"}:
        viewer = cad_service.viewer_filename_for_model(src.name, project_path)
        viewer_path = project_path / viewer if viewer else None
        if viewer_path is not None and viewer_path.is_file() and viewer_path.suffix.lower() in {".glb", ".gltf"}:
            mesh_src = viewer_path
    mesh = cad_service.load_mesh(mesh_src)
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
    user = {**user, "avatar_url": _avatar_url_for_user_id(user["id"])}

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


@app.websocket("/api/ws/workspaces/{team_id}")
async def workspace_ws(websocket: WebSocket, team_id: str, token: str = Query(...)):
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return
    user = get_user_by_id(user_id)
    if not user or not teams_service.get_team_for_user(team_id, user_id):
        await websocket.close(code=4403)
        return
    user = {**user, "avatar_url": _avatar_url_for_user_id(user["id"])}
    client = await hub.connect_workspace(team_id, websocket, user)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect_workspace(team_id, client.user_id)


ADMIN_EMAIL = "a1projects.usa@gmail.com"


def _require_admin(user: dict[str, Any]) -> None:
    _require_a1projects_admin(user)


@app.get("/api/admin/dashboard")
def admin_dashboard(
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_admin(user)
    conn = get_conn()
    try:
        # Users stats
        total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        recent_users = conn.execute(
            "SELECT id, email, display_name, created_at FROM users ORDER BY created_at DESC LIMIT 20"
        ).fetchall()
        recent_users_list = [
            {"id": r[0], "email": r[1], "display_name": r[2], "created_at": r[3]}
            for r in recent_users
        ]

        # Project stats
        total_projects = 0
        recent_projects: list[dict[str, Any]] = []
        data_root = Path(settings.data_root)
        if data_root.is_dir():
            for user_dir in sorted(data_root.iterdir(), reverse=True):
                if not user_dir.is_dir():
                    continue
                for proj_dir in sorted(user_dir.iterdir(), reverse=True):
                    if not proj_dir.is_dir():
                        continue
                    total_projects += 1
                    meta_path = proj_dir / "project.json"
                    meta: dict[str, Any] = {}
                    if meta_path.exists():
                        try:
                            meta = json.loads(meta_path.read_text())
                        except Exception:
                            pass
                    if len(recent_projects) < 20:
                        recent_projects.append({
                            "id": proj_dir.name,
                            "owner": user_dir.name,
                            "name": meta.get("name", proj_dir.name),
                            "created_at": meta.get("created_at"),
                            "updated_at": meta.get("updated_at"),
                        })

        # Prompt history stats
        total_prompts = 0
        recent_prompts: list[dict[str, Any]] = []
        if data_root.is_dir():
            for user_dir in data_root.iterdir():
                if not user_dir.is_dir():
                    continue
                for proj_dir in user_dir.iterdir():
                    if not proj_dir.is_dir():
                        continue
                    hist_path = proj_dir / "prompt_history.json"
                    if not hist_path.exists():
                        continue
                    try:
                        entries = json.loads(hist_path.read_text())
                        if not isinstance(entries, list):
                            entries = []
                    except Exception:
                        entries = []
                    total_prompts += len(entries)
                    for entry in entries[-5:]:
                        if len(recent_prompts) < 50:
                            recent_prompts.append({
                                "project_id": proj_dir.name,
                                "owner": user_dir.name,
                                **{k: entry.get(k) for k in ("id", "prompt", "success", "created_at", "model", "cost_usd")},
                            })

        recent_prompts.sort(key=lambda x: x.get("created_at") or "", reverse=True)

        return {
            "total_users": total_users,
            "total_projects": total_projects,
            "total_prompts": total_prompts,
            "recent_users": recent_users_list,
            "recent_projects": recent_projects[:20],
            "recent_prompts": recent_prompts[:20],
        }
    finally:
        conn.close()


ADMIN_EMAIL = "a1projects.usa@gmail.com"


def _require_admin(user: dict[str, Any]) -> None:
    _require_a1projects_admin(user)


@app.get("/api/admin/dashboard")
def admin_dashboard(
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_admin(user)
    conn = get_conn()
    try:
        # Users stats
        total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        recent_users = conn.execute(
            "SELECT id, email, display_name, created_at FROM users ORDER BY created_at DESC LIMIT 20"
        ).fetchall()
        recent_users_list = [
            {"id": r[0], "email": r[1], "display_name": r[2], "created_at": r[3]}
            for r in recent_users
        ]

        # Project stats
        total_projects = 0
        recent_projects: list[dict[str, Any]] = []
        data_root = Path(settings.data_root)
        if data_root.is_dir():
            for user_dir in sorted(data_root.iterdir(), reverse=True):
                if not user_dir.is_dir():
                    continue
                for proj_dir in sorted(user_dir.iterdir(), reverse=True):
                    if not proj_dir.is_dir():
                        continue
                    total_projects += 1
                    meta_path = proj_dir / "project.json"
                    meta: dict[str, Any] = {}
                    if meta_path.exists():
                        try:
                            meta = json.loads(meta_path.read_text())
                        except Exception:
                            pass
                    if len(recent_projects) < 20:
                        recent_projects.append({
                            "id": proj_dir.name,
                            "owner": user_dir.name,
                            "name": meta.get("name", proj_dir.name),
                            "created_at": meta.get("created_at"),
                            "updated_at": meta.get("updated_at"),
                        })

        # Prompt history stats
        total_prompts = 0
        recent_prompts: list[dict[str, Any]] = []
        if data_root.is_dir():
            for user_dir in data_root.iterdir():
                if not user_dir.is_dir():
                    continue
                for proj_dir in user_dir.iterdir():
                    if not proj_dir.is_dir():
                        continue
                    hist_path = proj_dir / "prompt_history.json"
                    if not hist_path.exists():
                        continue
                    try:
                        entries = json.loads(hist_path.read_text())
                        if not isinstance(entries, list):
                            entries = []
                    except Exception:
                        entries = []
                    total_prompts += len(entries)
                    for entry in entries[-5:]:
                        if len(recent_prompts) < 50:
                            recent_prompts.append({
                                "project_id": proj_dir.name,
                                "owner": user_dir.name,
                                **{k: entry.get(k) for k in ("id", "prompt", "success", "created_at", "model", "cost_usd")},
                            })

        recent_prompts.sort(key=lambda x: x.get("created_at") or "", reverse=True)

        return {
            "total_users": total_users,
            "total_projects": total_projects,
            "total_prompts": total_prompts,
            "recent_users": recent_users_list,
            "recent_projects": recent_projects[:20],
            "recent_prompts": recent_prompts[:20],
        }
    finally:
        conn.close()


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
