"""Render Studio — CAD project visualizer API."""

from __future__ import annotations

import base64
from collections import Counter, deque
import html
import ipaddress
import json
import logging
import math
import re
import secrets
import shutil
import socket
import struct
import threading
import time
import urllib.parse
import uuid
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from backend.auth import create_access_token, get_current_user, get_current_user_optional, get_user_by_id
from backend.config import settings
from backend.database import get_conn, init_db
from backend.request_context import extract_client_ip, reset_client_ip, set_client_ip
from backend.services import cad_service
from backend.services import share_preview
from backend.services.ai_service import AIService
from backend.services import (
    agent_marketplace_service,
    model_marketplace_service,
    folders_service,
    generation_service,
    history_service,
    project_log_service,
    project_shares_service,
    project_store,
    prompt_history_service,
    feedback_service,
    new_user_alert_service,
    onboarding_email_service,
    workspace_log_service,
    ai_credit_service,
    wiring_debug_job_service,
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
# mtime-keyed cache for /files/.../bodies (trimesh split is expensive).
_bodies_info_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_BODIES_INFO_CACHE_MAX = 256
# Short-lived cache for Autodesk listing endpoints. The frontend may refresh
# several panels at once; caching keeps those external calls from saturating the
# only two API workers while preserving near-live Fusion browsing.
_autodesk_listing_cache: dict[tuple[Any, ...], tuple[float, Any]] = {}
_autodesk_listing_cache_lock = threading.Lock()
_AUTODESK_LISTING_CACHE_MAX = 256
_ai_usage_cache: dict[tuple[Any, ...], tuple[float, Any]] = {}
_ai_usage_cache_lock = threading.Lock()
_AI_USAGE_CACHE_TTL = 30.0
_AI_USAGE_CACHE_MAX = 128
_admin_dashboard_cache: dict[tuple[int, int, int], tuple[float, dict[str, Any]]] = {}
_admin_dashboard_cache_lock = threading.Lock()
_ADMIN_DASHBOARD_CACHE_TTL = 24 * 60 * 60.0
_link_preview_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}
_link_preview_cache_lock = threading.Lock()
_LINK_PREVIEW_CACHE_TTL = 3600.0
_LINK_PREVIEW_CACHE_MAX = 256

PROJECTS = ROOT / settings.projects_dir
FRONTEND = ROOT / "frontend"
AVATARS = ROOT / "data" / "avatars"
ADMIN_DASHBOARD_CACHE_DIR = ROOT / "data" / "cache"
PROJECTS.mkdir(parents=True, exist_ok=True)
AVATARS.mkdir(parents=True, exist_ok=True)
ADMIN_DASHBOARD_CACHE_DIR.mkdir(parents=True, exist_ok=True)

A1PROJECTS_ADMIN_EMAILS = {
    "a1projects@protonmail.com",
    "a1projects.usa@gmail.com",
    "sam@render3d.app",
    "sam@smartcallusa.com",
    "samwins.stead@gmail.com",
    "mtgraytech@gmail.com",
}
OTHER_USER_RENDERS_FOLDER_ID = "__other_user_renders__"
OTHER_USER_RENDERS_FOLDER_NAME = "New renders from other users"
PUBLIC_FOLDER_ID = "__public__"
PUBLIC_FOLDER_NAME = "Public"
PRIVATE_FOLDER_ID = "__private__"
PRIVATE_FOLDER_NAME = "Private"
SHARED_WORKSPACE_FOLDER_PREFIX = "__shared_ws_"
VIEWPORT_WORKSPACE_ACTIVITY_KINDS = {
    "upload",
    "delete_object",
    "transform",
    "paint",
    "texture",
    "texture_remove",
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

# Optional multipart fields on /upload — texture wraps must not show as generic "Upload".
_UPLOAD_HISTORY_KIND_ALIASES = {
    "upload": "upload",
    "texture": "texture",
    "texture_library_apply": "texture",
    "texture_wrap": "texture",
    "texture_remove": "texture_remove",
    "remove_texture": "texture_remove",
}

app = FastAPI(title="Render Studio", description="CAD project visualizer with AI prompting")


def _recover_stuck_generations() -> None:
    """Stop in-flight CAD/wiring jobs after a server restart — do NOT re-run them.

    Generations are in-process, so a deploy kills the worker mid-call. Older
    "resume" logic re-queued the same ``request_body`` from scratch, which
    re-billed Opus/Fable/Pro from the beginning while the UI claimed it was
    picking up where it left off. We no longer do that.

    Instead: mark the job stopped, keep tracked usage/cost, and let the user
    retry when ready.
    """
    import fcntl

    lock_path = PROJECTS / ".generation-recovery.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_file = lock_path.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        logger.info("Another worker is recovering stuck generations; skipping")
        lock_file.close()
        return

    try:
        stuck = generation_service.find_stuck_jobs(PROJECTS)
        if not stuck:
            return
        logger.info(
            "Found %d stuck generation(s) to stop on startup (no auto-resume)",
            len(stuck),
        )
        for job in stuck:
            project_path_ = job["project_path"]
            project_id = job["project_id"]
            original_data = job["data"] or {}
            original_trace = str(job.get("trace_id") or original_data.get("trace_id") or "")
            kind = str(original_data.get("kind") or "prompt").lower()

            cost = original_data.get("cost_usd")
            if cost is None:
                try:
                    from backend.services.ai_cost import usage_fields_for_history

                    meta = usage_fields_for_history(
                        generation_service.job_all_ai_traces(original_data)
                    )
                    cost = meta.get("cost_usd")
                except Exception:
                    cost = None
            tracked = (
                f" About ${float(cost):.2f} tracked before the restart."
                if cost is not None and float(cost) > 0
                else ""
            )
            message = (
                "Generation stopped during a server restart. "
                "It was not re-run automatically — that would bill from scratch again. "
                "Retry the prompt when ready."
                + tracked
            )

            # Record history while request_body is still on the job.
            try:
                _upsert_stopped_prompt_history_from_job(
                    project_path_,
                    {
                        **original_data,
                        "status": "failed",
                        "error": message,
                        "cost_usd": cost if cost is not None else original_data.get("cost_usd"),
                    },
                    trace_id=original_trace or None,
                    charge_credits=False,
                )
            except Exception:
                logger.debug(
                    "Could not write stopped history for restart project=%s trace=%s",
                    project_id,
                    original_trace,
                    exc_info=True,
                )

            generation_service.stop_for_server_restart(
                project_path_,
                message,
                trace_id=original_trace or None,
                extra={
                    k: original_data.get(k)
                    for k in (
                        "usage",
                        "cost_usd",
                        "ai_calls",
                        "model",
                        "provider",
                        "ai_traces",
                        "settled_ai_traces",
                        "prompt_id",
                        "speed",
                    )
                    if original_data.get(k) is not None
                },
            )
            logger.info(
                "Stopped %s job after restart (no re-kick) project=%s trace=%s",
                kind,
                project_id,
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


@app.on_event("shutdown")
def on_shutdown() -> None:
    """Graceful drain: finish in-flight gens on this worker before uvicorn exits.

    systemd TimeoutStopSec / uvicorn --timeout-graceful-shutdown must be at least
    as long as RENDER3D_SHUTDOWN_DRAIN_SEC or the process is still SIGKILL'd.
    """
    import os as _os

    drain_sec = float(_os.environ.get("RENDER3D_SHUTDOWN_DRAIN_SEC", "3600"))
    generation_service.begin_drain()
    remaining = generation_service.wait_for_worker_jobs(PROJECTS, timeout_sec=drain_sec)
    if remaining:
        logger.warning(
            "Shutdown drain ended with %s job(s) still running on pid=%s",
            remaining,
            _os.getpid(),
        )
    else:
        logger.info("Shutdown drain complete — no running generations on pid=%s", _os.getpid())


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    ip_token = set_client_ip(extract_client_ip(request))
    try:
        if request.url.path.startswith("/api/"):
            trace_id = new_trace_id()
            request.state.trace_id = trace_id
            t0 = time.perf_counter()
            trace_add(
                "info",
                f"{request.method} {request.url.path}",
                trace_id=trace_id,
                data={"query": str(request.query_params), "client_ip": extract_client_ip(request)},
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
    finally:
        reset_client_ip(ip_token)


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
    images: list[PromptImage] = Field(default_factory=list, max_length=8)
    speed: str = Field(default="fast", description="fast (~30s) or quality (slower, gpt-5.5-pro)")
    skills: list[str] = Field(default_factory=list, max_length=20)
    mode: str = Field(default="standard", description="standard (Render), v2, vibecad, mesh, fusion, or architect")
    fusion_target: str | None = Field(default=None, description="in_app or fusion360")
    convert_images_to_drawing: bool = Field(
        default=False,
        description="When true and images are attached, run vision→DXF drawing + enriched prompt before CAD.",
    )
    original_prompt: str | None = Field(
        default=None,
        max_length=8000,
        description="User's original prompt before Improve with AI, when prompt was rewritten.",
    )
    prompt_improved: bool = Field(
        default=False,
        description="True when Improve with AI rewrote the prompt before generation.",
    )
    target_mode: str = Field(
        default="new",
        description="new = create a new object; edit = edit the selected/base object.",
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
    model_electronics: bool = Field(
        default=True,
        description="When true, inject electronics/wiring solid modeling rules for 2.0/fusion when the prompt mentions them.",
    )
    use_knowledge_base: bool = Field(
        default=False,
        description="When true, inject selected knowledge bases (and skill-linked KBs) into the prompt context.",
    )
    knowledge_base_ids: list[str] = Field(
        default_factory=list,
        max_length=12,
        description="Knowledge base IDs to include when use_knowledge_base is true.",
    )
    prompt_id: str | None = Field(
        default=None,
        max_length=64,
        description="Stable prompt-history id; preserved across server-restart resumes.",
    )


class SceneRenderRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    viewport_image: str = Field(..., max_length=10_000_000)
    base_filename: str | None = Field(None, max_length=240)
    speed: str = "fast"
    ai_key_id: str | None = Field(default=None, max_length=64)
    ai_key_source: str | None = Field(default=None, description="personal or team")


class RenderRegionEditRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    source_image: str = Field(..., max_length=12_000_000)
    source_filename: str | None = Field(None, max_length=240)
    region: dict[str, Any] | None = None
    save_mode: str = Field(default="new", description="new or replace")
    ai_key_id: str | None = Field(default=None, max_length=64)
    ai_key_source: str | None = Field(default=None, description="personal or team")
    speed: str = "fast"


class ImprovePromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    mode: str = Field(default="standard", description="standard, v2, mesh, architect, draw")
    target_mode: str = Field(default="new", description="new or edit")
    speed: str = Field(default="fast")
    project_id: str | None = Field(default=None, max_length=64)
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
    body_name: str | None = Field(
        default=None,
        max_length=120,
        description="Preferred body identity when GLB node order drifts (Fusion multi-body)",
    )
    copy: bool = Field(default=False, description="Body transforms are saved in-place; copy is ignored")


class VisibleAssemblyExportRequest(BaseModel):
    filenames: list[str] = Field(default_factory=list, max_length=200)
    name: str | None = Field(default=None, max_length=120)


class CadParamsUpdateRequest(BaseModel):
    params: dict[str, float | int | str | bool] = Field(default_factory=dict, max_length=80)
    part: str | None = Field(default=None, max_length=120)
    # When True, patch the .py source only — mesh was already baked via /transform.
    sync_only: bool = False


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
    body_index: int | None = Field(default=None, ge=0, description="Body index for multi-mesh assemblies")
    body_name: str | None = Field(
        default=None,
        max_length=120,
        description="Body/node name for multi-mesh assemblies (preferred over index)",
    )
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


class RegenerateExportsRequest(BaseModel):
    visible_body_indices: list[int] | None = Field(
        default=None,
        description="When set, 3MF includes only these mesh body indices (eye-visible parts).",
    )


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
    provider: str = Field("openai", description="openai | anthropic | kimi | xai")
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


class UserAICreditSettingsRequest(BaseModel):
    use_platform_key: bool | None = None
    auto_refill_enabled: bool | None = None
    auto_refill_threshold_cents: int | None = Field(None, ge=0, le=100_000)
    auto_refill_amount_cents: int | None = Field(None, ge=500, le=100_000)
    platform_provider: str | None = Field(None, max_length=20)
    platform_model: str | None = Field(None, max_length=120)


class UserAICreditCheckoutRequest(BaseModel):
    amount_cents: int = Field(default=2000, ge=500, le=100_000)
    provider: str = Field(default="stripe", max_length=20)
    success_url: str | None = Field(default=None, max_length=500)
    cancel_url: str | None = Field(default=None, max_length=500)


class UserAICreditClaimRequest(BaseModel):
    session_id: str = Field(..., min_length=8, max_length=200)


class AutodeskCredentialsRequest(BaseModel):
    client_id: str = Field(..., min_length=10, max_length=256)
    client_secret: str = Field(..., min_length=20, max_length=512)
    redirect_uri: str = Field(default="https://render3d.app/oauth/autodesk/callback", max_length=512)


class AgentAppSubmitRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    tagline: str = Field(..., min_length=1, max_length=180)
    description: str = Field(..., min_length=1, max_length=4000)
    body_md: str = Field(default="", max_length=20000)
    category: str = Field(default="agent", max_length=80)
    app_type: str = Field(default="skill", max_length=40)
    manifest: dict[str, Any] = Field(default_factory=dict)
    source_url: str | None = Field(default=None, max_length=600)
    icon_url: str | None = Field(default=None, max_length=600)
    price_cents: int = Field(default=0, ge=0, le=1_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=8)
    premium: bool = False
    license: str = Field(default="proprietary", max_length=40)
    access_mode: str = Field(default="free", max_length=20)
    download_enabled: bool = True
    members: list[dict[str, Any]] = Field(default_factory=list)


class AgentAppReviewRequest(BaseModel):
    status: str = Field(..., description="pending | approved | rejected | archived")
    featured: bool | None = None


class MarketplaceBoostRequest(BaseModel):
    message: str = Field(default="", max_length=2000)


class MarketplaceBoostReviewRequest(BaseModel):
    status: str = Field(..., description="approved | rejected")
    days: int = Field(default=14, ge=1, le=90)


class ModelListingSubmitRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    tagline: str = Field(..., min_length=1, max_length=180)
    description: str = Field(..., min_length=1, max_length=4000)
    body_md: str = Field(default="", max_length=20000)
    category: str = Field(default="models", max_length=80)
    license: str = Field(default="proprietary", max_length=40)
    access_mode: str = Field(default="free", max_length=20)
    download_enabled: bool = True
    price_cents: int = Field(default=0, ge=0, le=1_000_000)
    currency: str = Field(default="USD", min_length=3, max_length=8)
    billing_type: str = Field(default="one_time", max_length=20)
    thumbnail: dict[str, Any] | None = None
    gallery: list[dict[str, Any]] = Field(default_factory=list)
    files: list[dict[str, Any]] = Field(default_factory=list)
    members: list[dict[str, Any]] = Field(default_factory=list)
    project_id: str | None = Field(default=None, max_length=120)
    project_filenames: list[str] = Field(default_factory=list)


class ModelListingUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    tagline: str | None = Field(default=None, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    body_md: str | None = Field(default=None, max_length=20000)
    category: str | None = Field(default=None, max_length=80)
    license: str | None = Field(default=None, max_length=40)
    access_mode: str | None = Field(default=None, max_length=20)
    download_enabled: bool | None = None
    price_cents: int | None = Field(default=None, ge=0, le=1_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    billing_type: str | None = Field(default=None, max_length=20)
    thumbnail: dict[str, Any] | None = None
    gallery: list[dict[str, Any]] | None = None
    files: list[dict[str, Any]] | None = None


class StoreSettingsRequest(BaseModel):
    store_enabled: bool = False
    store_title: str = Field(default="", max_length=80)
    store_tagline: str = Field(default="", max_length=180)
    default_license: str = Field(default="proprietary", max_length=40)
    default_access_mode: str = Field(default="paid", max_length=20)
    default_billing_type: str = Field(default="one_time", max_length=20)
    default_currency: str = Field(default="USD", min_length=3, max_length=8)
    default_price_cents: int = Field(default=0, ge=0, le=1_000_000)
    download_enabled: bool = True
    show_on_profile: bool = True


class ModelListingReviewRequest(BaseModel):
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


class ProjectShareRequest(BaseModel):
    email: EmailStr


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
    references: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
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
    use_sam: bool = True


class RenderAgentSuggestRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    thread_id: str | None = Field(None, max_length=80)


class ProjectChatThreadCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    visibility: str | None = Field(default=None, max_length=16)
    kind: str | None = Field(default=None, max_length=20)
    invite_user_ids: list[str] = Field(default_factory=list, max_length=50)


class ProjectChatThreadInviteRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=64)


class ProjectChatThreadSettingsRequest(BaseModel):
    title: str | None = Field(default=None, max_length=80)
    visibility: str | None = Field(default=None, max_length=16)


class TeamMemberRoleRequest(BaseModel):
    role: str = Field(..., min_length=1, max_length=16)


class TeamMemberPermissionsRequest(BaseModel):
    can_invite: bool | None = None
    access: str | None = Field(default=None, max_length=16)


class ProjectChatMessageRequest(BaseModel):
    body: str = Field(default="", max_length=8000)
    parent_id: str | None = Field(default=None, max_length=64)
    images: list[str] = Field(default_factory=list, max_length=6, description="Stored chat media names")


class ProjectChatMessageEditRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=8000)


class ProjectChatReactionRequest(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=8)


class ProjectChatReadRequest(BaseModel):
    thread_id: str | None = Field(default=None, max_length=64)
    message_id: str | None = Field(default=None, max_length=64)


class ProjectChatLinkPreviewRequest(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)


class ProjectChatAssistRequest(BaseModel):
    action: str = Field(..., max_length=40)
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    note: str | None = Field(default=None, max_length=300)


class GettingStartedGenerateRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=2000)
    thread_id: str | None = Field(None, max_length=80)


class AdminGuideReviewRequest(BaseModel):
    status: str = Field(..., description="approved | rejected | pending")
    note: str | None = Field(None, max_length=500)


class AdminFeedbackReviewRequest(BaseModel):
    status: str = Field(..., description="open | checked | approved | denied")
    note: str | None = Field(None, max_length=1000)


class AdminFeedbackMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)


class AdminNewUserReviewRequest(BaseModel):
    status: str = Field(..., description="new | checked | contacted | dismissed")
    note: str | None = Field(None, max_length=1000)


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


def _require_project_write(user: dict[str, Any], project_id: str) -> Path:
    """Team members or a1projects admins may mutate a project (generate, edit, etc.).

    Public folder projects are read-only for everyone except a1projects admins.
    View-only workspace members can open projects but cannot mutate them.
    Non-admin users should remix (copy) the file into their own project.
    """
    if _is_public_project(project_id) and not _is_a1projects_admin(user):
        raise HTTPException(
            403,
            "Public folder projects are read-only. Use Remix to copy this model into your own project.",
        )
    if _is_a1projects_admin(user):
        path = PROJECTS / project_id
        if path.is_dir():
            return path
    if teams_service.can_access_project(user["id"], project_id):
        if not teams_service.can_edit_project(user["id"], project_id):
            raise HTTPException(
                403,
                "This shared workspace is view-only for your account. Ask the workspace admin for edit access.",
            )
        path = PROJECTS / project_id
        if path.is_dir():
            return path
    raise HTTPException(404, "Project not found")


_FUSION_SYNC_LOCKS: dict[str, threading.Lock] = {}
_FUSION_SYNC_LOCKS_GUARD = threading.Lock()


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
        summary = project_store.project_list_summary(project_path)
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
                "generated_by": (
                    {
                        "user_id": row["created_by"],
                        "display_name": row["owner_name"],
                        "avatar_url": None,
                    }
                    if row["owner_name"]
                    else None
                ),
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


def _personal_workspace_id(user: dict[str, Any]) -> str | None:
    """Return the user's true personal workspace id.

    Prefer a solo owned workspace (or a classic \"Name's Workspace\"). Multi-member
    collab teams like \"Render Studio\" must not be treated as personal — otherwise they
    never appear as a shared-workspace folder in Projects.
    """
    user_id = str(user.get("id") or "")
    if not user_id:
        return None
    teams = teams_service.list_teams(user_id)
    owned = [
        t
        for t in teams
        if str(t.get("created_by") or "") == user_id
        and str(t.get("role") or "").lower() in {"owner", "admin"}
    ]
    owned.sort(key=lambda t: str(t.get("created_at") or ""))

    def _members(team: dict[str, Any]) -> int:
        return int(team.get("member_count") or team.get("members_count") or 1) or 1

    def _looks_personal(team: dict[str, Any]) -> bool:
        name = str(team.get("name") or "").strip().lower()
        return bool(
            name.endswith("'s workspace")
            or name.endswith("’s workspace")
            or name in {"my workspace", "personal workspace", "personal"}
        )

    solo = [t for t in owned if _members(t) <= 1]
    if solo:
        named = next((t for t in solo if _looks_personal(t)), None)
        return str((named or solo[0])["id"])
    named_owned = next((t for t in owned if _looks_personal(t)), None)
    if named_owned:
        return str(named_owned["id"])
    # No dedicated personal workspace — leave unset so multi-member teams can nest.
    return None


def _shared_workspace_folder_id(team_id: str) -> str:
    return f"{SHARED_WORKSPACE_FOLDER_PREFIX}{team_id}"


def _is_shared_workspace_folder_id(folder_id: str | None) -> bool:
    return bool(folder_id) and str(folder_id).startswith(SHARED_WORKSPACE_FOLDER_PREFIX)


def _shared_workspace_folder_name(team_name: str | None) -> str:
    name = str(team_name or "").strip() or "Shared workspace"
    lower = name.lower()
    if lower.endswith("shared workspace"):
        return name
    return f"{name} shared workspace"


def _nest_shared_workspace_root_projects(
    projects: list[dict[str, Any]],
    user: dict[str, Any],
) -> list[dict[str, Any]]:
    """Keep the user's personal/home projects at the browser root; nest other
    workspaces' root projects under a virtual "{Team} shared workspace" folder.

    Rules:
    - If the user has a true personal/solo workspace: nest every other team's
      root projects (invitee case — e.g. Vineet + Render Studio).
    - If they don't (owner of only multi-member teams, e.g. Sam W): keep teams
      they own/admin at the root, and nest teams where they are only a member.
    Real subfolders inside those workspaces are left alone.
    """
    personal_id = _personal_workspace_id(user)
    teams_by_id = {str(t["id"]): t for t in teams_service.list_teams(user["id"])}
    out: list[dict[str, Any]] = []
    for project in projects:
        tid = project.get("team_id")
        if (
            not tid
            or project.get("folder_id")
            or project.get("public")
            or project.get("private_project")
            or _is_shared_workspace_folder_id(project.get("folder_id"))
        ):
            out.append(project)
            continue
        tid_s = str(tid)
        team = teams_by_id.get(tid_s) or {}
        role = str(team.get("role") or "").lower()
        is_owner_admin = role in {"owner", "admin"}
        if personal_id:
            # Invitee with a personal workspace: only that workspace stays at root.
            if tid_s == str(personal_id):
                out.append(project)
                continue
        else:
            # No solo personal workspace: owner's own teams stay visible at root
            # so Personal/Projects isn't emptied for accounts like Sam W.
            if is_owner_admin:
                out.append(project)
                continue
            member_count = int(team.get("member_count") or team.get("members_count") or 1) or 1
            if member_count <= 1:
                out.append(project)
                continue
        folder_id = _shared_workspace_folder_id(tid_s)
        out.append(
            {
                **project,
                "original_folder_id": None,
                "folder_id": folder_id,
                "folder_name": _shared_workspace_folder_name(team.get("name")),
                "shared_workspace_folder": True,
            }
        )
    return out


def _private_folder_summary(projects: list[dict[str, Any]], team_id: str | None) -> dict[str, Any]:
    return {
        "id": PRIVATE_FOLDER_ID,
        "team_id": team_id,
        "parent_id": None,
        "name": PRIVATE_FOLDER_NAME,
        "sort_order": -300,
        "visibility": "private",
        "created_by": None,
        "created_at": None,
        "project_count": len(projects),
        "share_count": 0,
        "can_manage": False,
        "is_owner": False,
        "shared_with_me": False,
        "read_only": True,
        "virtual": True,
        "private": True,
    }


def _private_project_summaries(user: dict[str, Any], active_team_id: str | None) -> list[dict[str, Any]]:
    personal_team_id = _personal_workspace_id(user)
    if not active_team_id or not personal_team_id or personal_team_id == active_team_id:
        return []
    out: list[dict[str, Any]] = []
    for row in teams_service.user_project_access(user["id"], personal_team_id):
        project_id = row["project_id"]
        project_path = PROJECTS / project_id
        if not project_path.is_dir():
            continue
        fid = row.get("folder_id")
        if fid and not folders_service.user_can_access_folder(fid, user["id"]):
            continue
        summary = project_store.project_list_summary(project_path)
        out.append(
            {
                **summary,
                "team_id": row["team_id"],
                "original_folder_id": fid,
                "folder_id": PRIVATE_FOLDER_ID,
                "folder_name": PRIVATE_FOLDER_NAME,
                "sort_order": int(row.get("sort_order") or 0),
                "owner_user_id": row.get("created_by"),
                "owner_email": row.get("owner_email"),
                "owner_name": row.get("owner_name") or (summary.get("generation") or {}).get("by_user_name"),
                "private_project": True,
            }
        )
    out.sort(key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)
    out.sort(key=lambda p: int(p.get("sort_order") or 0))
    return out


def _is_other_user_render_project(project_id: str, user: dict[str, Any]) -> bool:
    if not _is_a1projects_admin(user):
        return False
    owner = _project_owner(project_id)
    if not owner or owner.get("created_by") == user["id"]:
        return False
    project_path = PROJECTS / project_id
    if not project_path.is_dir():
        return False
    # Include live generations even before the first mesh file exists.
    try:
        gen = generation_service.public_summary(project_path) or {}
        if str(gen.get("status") or "") in {"running", "queued", "starting", "pending"}:
            return True
    except Exception:
        pass
    return bool(cad_service.list_project_files(project_path))


def _require_project_read(user: dict[str, Any], project_id: str) -> Path:
    if (
        teams_service.can_access_project(user["id"], project_id)
        or _is_other_user_render_project(project_id, user)
        or _is_public_project(project_id)
        or _is_a1projects_admin(user)
    ):
        path = PROJECTS / project_id
        if path.is_dir():
            return path
    raise HTTPException(404, "Project not found")


def _admin_preview_assets(project_path: Path, project_id: str, latest_file: str | None = None) -> dict[str, Any]:
    """Snapshot PNG + GLB URLs for management previews."""
    stem = Path(latest_file).stem if latest_file else None
    snapshots = [p for p in project_path.glob("*_snapshot_iso_*.png") if p.is_file() and "opposite" not in p.name.lower()]
    if not snapshots:
        snapshots = [p for p in project_path.glob("*_snapshot_iso*.png") if p.is_file()]
    if not snapshots:
        snapshots = [p for p in project_path.glob("*_snapshot_*.png") if p.is_file()]
    if stem:
        preferred = [p for p in snapshots if p.name.startswith(f"{stem}_snapshot")]
        snapshots = preferred or snapshots
    preview_file = max(snapshots, key=lambda p: p.stat().st_mtime).name if snapshots else None

    model_file = None
    if latest_file and Path(latest_file).suffix.lower() in {".glb", ".gltf"} and (project_path / latest_file).is_file():
        model_file = latest_file
    elif stem and (project_path / f"{stem}.glb").is_file():
        model_file = f"{stem}.glb"
    else:
        glbs = [p for p in project_path.glob("*.glb") if p.is_file() and "_part" not in p.stem.lower()]
        if not glbs:
            glbs = [p for p in project_path.glob("*.glb") if p.is_file()]
        if glbs:
            model_file = max(glbs, key=lambda p: p.stat().st_mtime).name

    return {
        "preview_file": preview_file,
        "preview_url": (
            f"/api/projects/{project_id}/files/{urllib.parse.quote(preview_file)}"
            if preview_file
            else None
        ),
        "model_file": model_file,
        "model_url": (
            f"/api/projects/{project_id}/files/{urllib.parse.quote(model_file)}"
            if model_file
            else None
        ),
    }


def _other_user_render_summaries(user: dict[str, Any], team_id: str | None = None) -> list[dict[str, Any]]:
    """Admin folder: teammates' projects, including ones still generating (0 files yet)."""
    if not _is_a1projects_admin(user):
        return []
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT pa.project_id, pa.created_by, pa.created_at, u.email AS owner_email, u.display_name AS owner_name
            FROM project_access pa
            LEFT JOIN users u ON u.id = pa.created_by
            WHERE pa.created_by IS NOT NULL AND pa.created_by != ?
            ORDER BY pa.created_at DESC
            LIMIT 200
            """,
            (user["id"],),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        project_path = PROJECTS / row["project_id"]
        if not project_path.is_dir():
            continue
        # Fast summary includes generation.status — needed while Aaron is still generating.
        summary = project_store.project_list_summary(project_path)
        gen = summary.get("generation") or {}
        gen_status = str(gen.get("status") or "")
        has_files = bool(summary.get("file_count"))
        is_live = gen_status in {"running", "queued", "starting", "pending"}
        if not has_files and not is_live:
            # Keep brand-new empty projects briefly so they appear as soon as created.
            created = row["created_at"] or summary.get("created_at") or ""
            try:
                from datetime import datetime, timezone, timedelta
                created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                if created_dt.tzinfo is None:
                    created_dt = created_dt.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - created_dt > timedelta(hours=6):
                    continue
            except Exception:
                continue
        out.append(
            {
                **summary,
                "team_id": team_id,
                "folder_id": OTHER_USER_RENDERS_FOLDER_ID,
                "folder_name": OTHER_USER_RENDERS_FOLDER_NAME,
                "read_only_project": True,
                "owner_user_id": row["created_by"],
                "owner_email": row["owner_email"],
                "owner_name": row["owner_name"] or gen.get("by_user_name"),
                "sort_order": -1000 if is_live else int(bool(not has_files)) * -100,
            }
        )
    # Generating first, then newest.
    out.sort(key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)
    out.sort(key=lambda p: 0 if (p.get("generation") or {}).get("status") in {"running", "queued", "starting", "pending"} else 1)
    return out


def _prompt_timeline_meta(body: PromptRequest, **extra: Any) -> dict[str, Any]:
    """Shared timeline meta for AI prompt jobs — marks generative edits for collab UI."""
    target = str(getattr(body, "target_mode", "") or "").strip().lower()
    if target not in {"new", "edit"}:
        target = "edit" if getattr(body, "base_filename", None) else "new"
    meta: dict[str, Any] = {
        "prompt": body.prompt,
        "speed": body.speed,
        "prompt_mode": (getattr(body, "mode", None) or "standard").lower(),
        "base_filename": body.base_filename,
        "target_mode": target,
        "generative_edit": target == "edit",
        **extra,
    }
    return meta


def _prompt_timeline_label(body: PromptRequest, prompt: str | None = None) -> str:
    text = prompt if prompt is not None else (body.prompt or "")
    short = (text[:48] + "…") if len(text) > 48 else text
    meta = _prompt_timeline_meta(body)
    prefix = "Edit: " if meta.get("generative_edit") else "AI: "
    return prefix + short


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
    # Mark Fusion-linked projects dirty and schedule an async push so extrudes /
    # generates / mesh edits land in everyone's linked Fusion folder without blocking UI.
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
            try:
                _schedule_background_fusion_push(project_path.name, project_path, filename)
            except Exception:
                logger.debug("Could not schedule Fusion push for %s", project_path.name, exc_info=True)
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


def _notify_fusion_mirrors_updated(
    project_id: str,
    *,
    filename: str | None = None,
    files: list[str] | None = None,
    pushed_mirrors: list[dict[str, Any]] | None = None,
) -> None:
    """Tell open clients to refresh Fusion mirror file lists without a full page reload."""
    names = [Path(str(n)).name for n in (files or []) if n]
    if filename:
        names.insert(0, Path(str(filename)).name)
    # Preserve order, drop dupes.
    seen: set[str] = set()
    unique_files: list[str] = []
    for name in names:
        key = name.lower()
        if not name or key in seen:
            continue
        seen.add(key)
        unique_files.append(name)
    if pushed_mirrors:
        for entry in pushed_mirrors:
            name = Path(str(entry.get("filename") or "")).name
            key = name.lower()
            if name and key not in seen:
                seen.add(key)
                unique_files.append(name)
    if not unique_files and not pushed_mirrors:
        return
    payload = {
        "type": "fusion.mirror.updated",
        "project_id": project_id,
        "filename": unique_files[0] if unique_files else None,
        "files": unique_files,
        "pushed_count": len(pushed_mirrors or []),
        "pushed_user_ids": sorted(
            {str(m.get("user_id") or "") for m in (pushed_mirrors or []) if m.get("user_id")}
        ),
    }
    try:
        _notify_project(project_id, payload)
    except Exception:
        logger.debug("Could not notify project fusion.mirror.updated", exc_info=True)
    try:
        _notify_project_workspace(project_id, payload)
    except Exception:
        logger.debug("Could not notify workspace fusion.mirror.updated", exc_info=True)


def _broadcast_generation_update(project_path: Path, data: dict[str, Any] | None = None) -> None:
    """Push generation status to project + workspace clients.

    generation_service._emit() always calls listeners as (project_path, data).
    """
    if not project_path.is_dir():
        return
    summary = generation_service.public_summary(project_path)
    if data and isinstance(data, dict):
        # Prefer the just-written payload when public_summary is briefly stale.
        for key in (
            "status", "kind", "trace_id", "started_at", "updated_at", "finished_at",
            "prompt", "label", "message", "filename", "url", "error",
            "timeline_index", "prompt_id", "by_user_id", "by_user_name", "by_avatar_url",
            "mode", "progress", "benign_interrupt",
        ):
            if key in data and data.get(key) is not None:
                summary[key] = data.get(key)
        if not summary.get("status"):
            summary["status"] = data.get("status") or "idle"
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
    by_user_id = summary.get("by_user_id")
    if by_user_id:
        _notify_user(by_user_id, payload)
    # a1projects admins watch other users' renders across teams — push live status to them too.
    for admin_email in A1PROJECTS_ADMIN_EMAILS:
        try:
            _notify_user_by_email(admin_email, payload)
        except Exception:
            logger.debug("Could not notify admin %s of generation update", admin_email, exc_info=True)


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


def _notify_management_update(event: str, payload: dict[str, Any] | None = None) -> None:
    try:
        summary_payload = {
            "type": "management.notification.updated",
            "event": event,
            "summary": {
                "feedback": feedback_service.summary(),
                "new_users": new_user_alert_service.summary(),
            },
            **(payload or {}),
        }
        summary_payload["summary"]["unread_count"] = (
            int(summary_payload["summary"]["feedback"].get("unread_count") or 0)
            + int(summary_payload["summary"]["new_users"].get("unread_count") or 0)
        )
        for admin_email in A1PROJECTS_ADMIN_EMAILS:
            _notify_user_by_email(admin_email, summary_payload)
    except Exception:
        logger.debug("Could not notify management update event=%s", event, exc_info=True)



def _notify_ai_keys_changed(
    user_ids: list[str] | None = None,
    *,
    team_id: str | None = None,
    reason: str = "updated",
    key_id: str | None = None,
) -> None:
    """Push AI key list updates so recipients see shared keys without refreshing."""
    payload = {"type": "ai.keys.changed", "reason": reason}
    if team_id:
        payload["team_id"] = team_id
    if key_id:
        payload["key_id"] = key_id
    ids: list[str] = []
    if user_ids:
        ids.extend([uid for uid in user_ids if uid])
    elif team_id:
        try:
            ids.extend(teams_service.team_member_ids(team_id) or [])
        except Exception:
            ids = []
    seen: set[str] = set()
    for uid in ids:
        if uid in seen:
            continue
        seen.add(uid)
        _notify_user(uid, payload)

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
    return _batch_daily_ai_usage_for_users([user_id], shared_key_id=shared_key_id).get(
        str(user_id),
        {"cost_usd": 0.0, "tokens": 0},
    )


_DAILY_AI_USAGE_CACHE: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
_DAILY_AI_USAGE_TTL_SEC = 45.0
_DAILY_AI_USAGE_CACHE_LOCK = threading.Lock()


def _daily_ai_usage_cache_key(user_id: str, shared_key_id: str | None) -> tuple[str, str]:
    return (str(user_id), str(shared_key_id or ""))


def _batch_daily_ai_usage_for_users(
    user_ids: list[str],
    *,
    shared_key_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Scan each project once for today's spend across many users.

    Avoids the N-members × M-projects × heavy history-prepare path that made the
    shared-key Members panel hang.
    """
    from backend.services.ai_cost import entry_effective_cost

    wanted = [str(uid) for uid in user_ids if uid]
    if not wanted:
        return {}

    now_mono = time.monotonic()
    out: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    with _DAILY_AI_USAGE_CACHE_LOCK:
        for uid in wanted:
            cached = _DAILY_AI_USAGE_CACHE.get(_daily_ai_usage_cache_key(uid, shared_key_id))
            if cached and (now_mono - cached[0]) < _DAILY_AI_USAGE_TTL_SEC:
                out[uid] = dict(cached[1])
            else:
                missing.append(uid)

    if not missing:
        return out

    today = datetime.now(timezone.utc).date()
    cost_total = {uid: 0.0 for uid in missing}
    token_total = {uid: 0 for uid in missing}
    missing_set = set(missing)

    project_ids: set[str] = set()
    for uid in missing:
        try:
            for row in teams_service.user_project_access(uid, None):
                pid = str(row.get("project_id") or "")
                if pid:
                    project_ids.add(pid)
        except Exception:
            continue

    for project_id in project_ids:
        project_path = PROJECTS / project_id
        if not project_path.is_dir():
            continue
        try:
            entries = prompt_history_service.list_entries_lightweight(project_path)
        except Exception:
            continue
        for entry in entries:
            uid = str(entry.get("user_id") or "")
            if uid not in missing_set:
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
                entry_day = created.astimezone(timezone.utc).date()
                if entry_day < today:
                    # Newest-first listing: older than today means we're done for this project.
                    break
                if entry_day != today:
                    continue
            except Exception:
                continue
            cost_total[uid] += float(entry_effective_cost(entry) or 0)
            usage = entry.get("usage") or {}
            if isinstance(usage, dict):
                token_total[uid] += int(
                    usage.get("total_tokens")
                    or usage.get("tokens")
                    or (
                        int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
                        + int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
                    )
                    or 0
                )

    with _DAILY_AI_USAGE_CACHE_LOCK:
        for uid in missing:
            payload = {"cost_usd": round(cost_total[uid], 6), "tokens": token_total[uid]}
            _DAILY_AI_USAGE_CACHE[_daily_ai_usage_cache_key(uid, shared_key_id)] = (time.monotonic(), payload)
            out[uid] = dict(payload)
        # Bound cache growth for long-lived workers.
        if len(_DAILY_AI_USAGE_CACHE) > 4000:
            cutoff = time.monotonic() - _DAILY_AI_USAGE_TTL_SEC
            stale = [k for k, (ts, _) in _DAILY_AI_USAGE_CACHE.items() if ts < cutoff]
            for k in stale[:2000]:
                _DAILY_AI_USAGE_CACHE.pop(k, None)

    return out


def _daily_ai_spend_for_user(user_id: str) -> float:
    """Best-effort UTC daily spend for one user across all project histories."""
    return float(_daily_ai_usage_for_user(user_id).get("cost_usd") or 0)


def _ai_status_for_user(user: dict[str, Any]) -> dict[str, Any]:
    trial_grant: dict[str, Any] = {}
    try:
        trial_grant = ai_credit_service.grant_signup_trial_if_needed(user) or {}
        if trial_grant.get("just_granted") and not trial_grant.get("email_sent"):
            import threading

            threading.Thread(
                target=_send_trial_credits_email_background,
                args=(dict(user),),
                daemon=True,
            ).start()
    except Exception:
        logger.debug("signup trial grant skipped for user_id=%s", user.get("id"), exc_info=True)
        trial_grant = {}
    status = user_ai_keys_service.status_for_user(user)
    try:
        status["credits"] = ai_credit_service.status(user)
    except Exception:
        status["credits"] = {"available": False, "balance_cents": 0, "markup_percent": 15}
    credits = status.get("credits") or {}
    # Surface grant blockers on credits.trial so the client never teasers free
    # credits when the weekly allotment is out / waitlisted / IP-blocked.
    trial_info = dict(credits.get("trial") or {})
    for key in (
        "blocked_weekly_cap",
        "waitlisted",
        "blocked_ip",
        "blocked_reason",
        "just_granted",
        "from_pool",
    ):
        if key in trial_grant:
            trial_info[key] = trial_grant[key]
    if trial_grant.get("blocked_weekly_cap") or trial_grant.get("waitlisted") or trial_grant.get("blocked_ip"):
        trial_info["show_popup"] = False
        trial_info["blocked_weekly_cap"] = bool(
            trial_grant.get("blocked_weekly_cap") or trial_info.get("blocked_weekly_cap")
        )
        trial_info["waitlisted"] = bool(trial_grant.get("waitlisted") or trial_info.get("waitlisted"))
    credits["trial"] = trial_info
    status["credits"] = credits
    providers = credits.get("providers") or {}
    balance_ok = int(credits.get("balance_cents") or 0) > 0
    platform_keys: list[dict[str, Any]] = []
    if credits.get("available") and balance_ok:
        account = ai_credit_service.ensure_account(user["id"])
        preferred = str(credits.get("platform_provider") or "openai").strip().lower()
        preferred_model = str(credits.get("platform_model") or "").strip()
        for provider_id, label, configured in (
            ("openai", "Render Studio Key", bool(providers.get("openai"))),
            ("anthropic", "Render Studio Key", bool(providers.get("anthropic"))),
            ("kimi", "Render Studio Key", bool(providers.get("kimi"))),
        ):
            if not configured:
                continue
            creds = ai_credit_service.resolve_platform_credentials(
                account,
                provider=provider_id,
                model=preferred_model if preferred == provider_id else None,
            )
            if not creds:
                continue
            platform_keys.append(
                {
                    "id": provider_id,
                    "name": label,
                    "provider": creds["provider"],
                    "model": creds["model"],
                    "source": "platform",
                    "temporary": True,
                    "enabled": bool(credits.get("use_platform_key")),
                    "is_active": bool(credits.get("use_platform_key")) and preferred == provider_id,
                }
            )
    status["platform_keys"] = platform_keys
    if credits.get("use_platform_key") and credits.get("available") and balance_ok and platform_keys:
        status["ai_ready"] = True
        active = next((k for k in platform_keys if k.get("is_active")), platform_keys[0])
        if not status.get("effective"):
            status["provider"] = active["provider"]
            status["model"] = active["model"]
            status["effective"] = {
                "source": "platform",
                "provider": active["provider"],
                "model": active["model"],
                "key_id": active["id"],
                "key_name": active["name"],
            }
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
    usage_by_user = _batch_daily_ai_usage_for_users(
        [str(member.get("user_id") or "") for member in members],
        shared_key_id=key_id,
    )
    out: list[dict[str, Any]] = []
    for member in members:
        row = dict(member)
        usage = usage_by_user.get(str(member.get("user_id") or ""), {"cost_usd": 0.0, "tokens": 0})
        row["spent_today_tokens"] = int(usage.get("tokens") or 0)
        row["spent_today_usd"] = float(usage.get("cost_usd") or 0)
        limit = row.get("daily_token_limit")
        if limit is not None:
            row["remaining_today_tokens"] = max(0, int(limit) - row["spent_today_tokens"])
        out.append(row)
    return out


def _resolve_prompt_model_meta(
    user: dict[str, Any],
    body: Any,
    *,
    project_id: str | None = None,
) -> dict[str, str | None]:
    """Resolve the model/provider that will be used for a prompt, without creating an AI client."""
    speed = str(getattr(body, "speed", None) or "fast").lower()
    if speed not in {"fast", "quality"}:
        speed = "fast"
    # Keep UI Speed/Quality for model pick (do not force Pro on 2.0/Fusion/Architect).
    resolve_speed = speed
    key_id = getattr(body, "ai_key_id", None)
    key_source = getattr(body, "ai_key_source", None)
    if str(key_source or "").strip().lower() == "platform":
        credits = ai_credit_service.status(user)
        if credits.get("available") and int(credits.get("balance_cents") or 0) > 0:
            account = ai_credit_service.ensure_account(user["id"])
            creds = ai_credit_service.resolve_platform_credentials(
                account,
                speed=resolve_speed,
                provider=str(key_id or "").strip() or None,
            )
            if creds:
                return {"model": creds["model"], "provider": creds["provider"], "speed": speed}
    try:
        if key_id and str(key_source or "").strip().lower() != "platform":
            effective = user_ai_keys_service.resolve_key_for_user(
                user["id"], key_id, key_source, project_id=project_id
            )
        else:
            effective = user_ai_keys_service.get_effective_key_for_user(user["id"], project_id=project_id)
    except Exception:
        effective = {}
    if not effective and ai_credit_service.status(user).get("use_platform_key"):
        account = ai_credit_service.ensure_account(user["id"])
        creds = ai_credit_service.resolve_platform_credentials(account, speed=resolve_speed)
        if creds:
            return {"model": creds["model"], "provider": creds["provider"], "speed": speed}
        provider = "openai"
        model = settings.openai_model if resolve_speed == "fast" else settings.openai_model_quality
        return {"model": model, "provider": provider, "speed": speed}
    provider = str((effective or {}).get("provider") or "").strip().lower() or None
    model = None
    if provider == "openai":
        key_model = str((effective or {}).get("model") or "").strip()
        if resolve_speed == "fast":
            model = settings.openai_model
        elif key_model:
            model = key_model
        else:
            model = settings.openai_model_quality
    elif provider == "anthropic":
        model = str((effective or {}).get("model") or "").strip() or settings.anthropic_model
    elif effective:
        model = str((effective or {}).get("model") or "").strip() or None
        provider = provider or "openai"
    return {
        "model": model,
        "provider": provider,
        "speed": speed,
    }


def _sam_openai_key() -> dict[str, str] | None:
    """Platform OpenAI key used for Sam's cheap gpt-4o-mini agent / render fallbacks."""
    key = (settings.openai_api_key or "").strip()
    if not key:
        return None
    return {"api_key": key, "model": "gpt-4o-mini", "provider": "openai", "name": "Sam's gpt-4o-mini"}


def _sam_ai_service() -> AIService:
    sam = _sam_openai_key()
    if not sam:
        raise HTTPException(
            status_code=503,
            detail="Sam's gpt-4o-mini is unavailable (platform OPENAI_API_KEY not configured).",
        )
    return AIService(model="gpt-4o-mini", api_key=sam["api_key"], provider="openai")


def _platform_ai_for_user(
    user: dict[str, Any],
    *,
    speed: str = "fast",
    provider: str | None = None,
    model: str | None = None,
    require_enabled: bool = False,
) -> AIService:
    credits = ai_credit_service.status(user)
    if not credits.get("available"):
        raise HTTPException(
            status_code=503,
            detail="Render Studio platform AI keys are not configured. Add OpenAI, Anthropic, or Kimi keys on the server.",
        )
    if int(credits.get("balance_cents") or 0) <= 0:
        raise HTTPException(status_code=402, detail="Buy shared-key credits to use the platform AI key.")
    if require_enabled and not credits.get("use_platform_key"):
        raise HTTPException(status_code=403, detail="Enable Render Studio shared keys in AI & billing first.")
    account = ai_credit_service.ensure_account(user["id"])
    if not account.get("use_platform_key"):
        ai_credit_service.update_settings(user["id"], use_platform_key=True)
        account = ai_credit_service.ensure_account(user["id"])
    provider_id = str(provider or "").strip().lower() or None
    if provider_id in {"claude", "anthropic"}:
        provider_id = "anthropic"
    elif provider_id in {"openai", "gpt"}:
        provider_id = "openai"
    elif provider_id in {"kimi", "moonshot"}:
        provider_id = "kimi"
    elif provider_id:
        raise HTTPException(status_code=400, detail="Render Studio key must be openai, anthropic, or kimi.")
    if provider_id:
        settings_kwargs: dict[str, Any] = {
            "use_platform_key": True,
            "platform_provider": provider_id,
        }
        # Always pass a provider-compatible model so a leftover GPT-5.5 Pro pin
        # cannot survive an Anthropic/Kimi selection (and vice versa).
        if model is not None:
            settings_kwargs["platform_model"] = model
        else:
            current_model = str(account.get("platform_model") or "").strip()
            if not ai_credit_service._platform_model_matches_provider(current_model, provider_id):
                settings_kwargs["platform_model"] = ai_credit_service._default_platform_model(
                    provider_id, speed=speed
                )
        ai_credit_service.update_settings(user["id"], **settings_kwargs)
        account = ai_credit_service.ensure_account(user["id"])
    creds = ai_credit_service.resolve_platform_credentials(
        account,
        speed=speed,
        provider=provider_id,
        model=model,
    )
    if not creds:
        label = {
            "anthropic": "Claude",
            "openai": "OpenAI",
            "kimi": "Kimi",
        }.get(provider_id or "", "AI")
        raise HTTPException(
            status_code=503,
            detail=f"Render Studio {label} platform key is not configured on the server.",
        )
    ai = AIService(model=creds["model"], api_key=creds["api_key"], provider=creds["provider"])
    setattr(ai, "billing_source", "platform")
    setattr(ai, "billing_user_id", user["id"])
    setattr(ai, "platform_key_id", creds.get("key_id") or provider_id or creds["provider"])
    return ai


def _get_ai_for_user(
    user: dict[str, Any],
    speed: str = "fast",
    *,
    key_id: str | None = None,
    key_source: str | None = None,
    project_id: str | None = None,
) -> AIService:
    source = str(key_source or "").strip().lower()
    if source == "platform":
        return _platform_ai_for_user(user, speed=speed, provider=key_id)
    try:
        if key_id:
            effective = user_ai_keys_service.resolve_key_for_user(user["id"], key_id, key_source, project_id=project_id)
        else:
            effective = user_ai_keys_service.get_effective_key_for_user(user["id"], project_id=project_id)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not effective or not effective.get("api_key"):
        credits = ai_credit_service.status(user)
        if credits.get("use_platform_key") and credits.get("available"):
            return _platform_ai_for_user(user, speed=speed, require_enabled=True)
        raise HTTPException(
            status_code=403,
            detail="Add your OpenAI or Claude API key, or buy shared-key credits from the account menu before generating.",
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
            # Sam / a1projects: never run GPT-5.5 Pro (Quality pin or default).
            if _is_a1projects_admin(user) and "gpt-5.5-pro" in str(model or "").lower():
                model = settings.openai_model
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
    # Respect the UI Speed/Quality control for model selection.
    # CAD 2.0 / Fusion / Architect used to force "quality" here, which silently
    # upgraded OpenAI keys to gpt-5.5-pro (~5–8+ min, often 480s timeout).
    speed = getattr(body, "speed", None) or "fast"
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
        for ext in (".glb", ".step", ".stp", ".stl", ".obj", ".gltf", ".3mf", ".iges", ".igs", ".brep", ".brp"):
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


def _regenerate_native_step_for_cloud(project_path: Path, filename: str) -> Path | None:
    """Rebuild the source-backed STEP so Fusion/Onshape receives a real solid."""
    try:
        from backend.services import text_to_cad_params

        resolved = text_to_cad_params.resolve_source_for_model(project_path, filename)
        if resolved is None:
            return None
        _, source_name = resolved
        text_to_cad_params.regenerate_model(project_path, source_name)
        rebuilt = cad_service.resolve_native_brep_step(project_path, filename)
        if rebuilt is not None:
            return rebuilt
        source_step = project_path / f"{Path(source_name).stem}.step"
        if source_step.is_file() and cad_service.is_editable_brep_step(source_step):
            return source_step
    except Exception as exc:
        logger.warning("Could not regenerate native STEP for %s: %s", filename, exc)
    return None


def _step_for_cloud_cad(project_path: Path, filename: str, *, allow_faceted: bool = False) -> Path:
    """Return a Fusion/Onshape-editable STEP, refusing mesh-derived faceted STEP by default."""
    safe = Path(filename).name
    src = project_path / safe
    if not src.is_file():
        raise HTTPException(404, "File not found")

    suffix = src.suffix.lower()
    stem = src.stem

    # Visible-assembly bake must never resolve to a hidden sibling model.
    if safe.lower().startswith("_export_visible_assembly"):
        if suffix in cad_service.STEP_SUFFIXES:
            kind = cad_service.classify_step_file_kind(src)
            if kind == "editable_brep" or allow_faceted or "__faceted" in stem.lower():
                return src
            if allow_faceted:
                return src
        raise HTTPException(
            422,
            "Visible-assembly STEP is missing or not Fusion-ready. Re-export visible components and try again.",
        )

    # Prefer generative parent B-rep when the selection is an edited/pulled mesh.
    native = cad_service.resolve_native_brep_step(project_path, safe)
    if native is not None:
        return native
    rebuilt = _regenerate_native_step_for_cloud(project_path, safe)
    if rebuilt is not None:
        return rebuilt

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
    if body.base_filename:
        return None
    target_mode = str(getattr(body, "target_mode", "") or "").strip().lower()
    has_surface_ref = _has_surface_edit_reference(body)
    has_component_ref = any((r.type or "").lower() == "component" and (r.filename or r.viewer_filename) for r in body.references)
    if not (target_mode == "edit" or _is_reference_anchored_addition(body) or (has_surface_ref and has_component_ref)):
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
    updates: dict[str, Any] = {}
    if inferred:
        updates["base_filename"] = inferred
        trace_add(
            "info",
            "Inferred base model for reference-anchored edit",
            trace_id=trace_id,
            data={"base_filename": inferred},
        )
    # Face/length selected edits are always edit mode — older clients often sent "new".
    looks_like_selected_edit = bool(
        inferred
        or _has_surface_edit_reference(body)
        or _is_length_extend_edit(body)
    )
    if looks_like_selected_edit and str(getattr(body, "target_mode", "") or "").strip().lower() != "edit":
        updates["target_mode"] = "edit"
        trace_add(
            "info",
            "Forced target_mode=edit for selected/face viewport edit",
            trace_id=trace_id,
            data={"base_filename": updates.get("base_filename") or body.base_filename},
        )
    if not updates:
        return body
    return body.model_copy(update=updates)


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
    # Mesh mode (img2threejs) stores factories as `{stem}.mesh.mjs`.
    mesh_candidates = [
        project_path / f"{stem}.mesh.mjs",
        project_path / f"{stem.replace('.mesh', '')}.mesh.mjs" if ".mesh" in stem else None,
    ]
    for path in mesh_candidates:
        if path and path.is_file():
            return path.read_text(encoding="utf-8", errors="ignore"), path.name
    # VibeCAD stores generators as `{stem}.vibecad.py`.
    vibecad_candidates = [
        project_path / f"{stem}.vibecad.py",
        project_path / f"{stem.replace('.vibecad', '')}.vibecad.py" if ".vibecad" in stem else None,
    ]
    for path in vibecad_candidates:
        if path and path.is_file():
            return path.read_text(encoding="utf-8", errors="ignore"), path.name
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
    if (body.mode or "standard").lower() in {"v2", "fusion", "architect", "mesh", "vibecad", "vibe", "vibecade"}:
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


def _is_length_extend_edit(body: PromptRequest) -> bool:
    """True when the prompt asks to lengthen/extend the selected part (often with @face)."""
    p = f" {body.prompt or ''} ".lower()
    markers = (
        " longer",
        " lengthen",
        " extend",
        " extension",
        " twice as long",
        " 2x long",
        " 2× long",
        " double the length",
        " double its length",
        " double in length",
        " make this part",
        " increase the length",
        " stretch",
        " elongate",
        " central span",
        " longitudinal length",
    )
    if not any(m in p for m in markers):
        return False
    return bool(
        body.base_filename
        or _has_surface_edit_reference(body)
        or any((r.type or "").lower() == "component" for r in body.references)
        or str(getattr(body, "target_mode", "") or "").strip().lower() == "edit"
    )


def _reference_edit_guidance(prompt: str, refs: list[dict[str, Any]]) -> str | None:
    face_refs = [r for r in refs if str(r.get("type") or "").lower() == "face"]
    if not face_refs:
        return None
    p = f" {prompt or ''} ".lower()
    lengthen_words = (
        " longer",
        " lengthen",
        " extend",
        " extension",
        " twice as long",
        " double the length",
        " double its length",
        " double in length",
        " increase the length",
        " stretch",
        " elongate",
        " central span",
        " longitudinal",
    )
    if any(word in p for word in lengthen_words):
        return (
            "Face-anchored LENGTH edit of the CURRENT selected model: measure L_orig on the selected "
            "STEP/component along the arm/part axis (use the picked face normal/position as the extend "
            "anchor). Lengthen that existing part only — do NOT regenerate from an older assembly "
            "baseline, do NOT treat the face as contextual-only, and do NOT invent a new unrelated stem. "
            "Preserve end-interface geometry; insert extension in the central span and translate the far end."
        )
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
            "with position/local_point, outward normal, face_indices, and face_area. Preserve unrelated geometry. "
            "Edit the CURRENT selected object in the viewport — do not create a replacement model from scratch."
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


_CAD_REF_EXTS = {
    ".step",
    ".stp",
    ".stl",
    ".3mf",
    ".glb",
    ".gltf",
    ".obj",
    ".ply",
    ".off",
    ".iges",
    ".igs",
    ".brep",
    ".brp",
    ".f3z",
}


def _build_cad_reference_entries(
    project_path: Path,
    references: list[Any],
    component_specs: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Summarize attached 3D CAD files for text-to-cad prompts."""
    specs_by_stem = {
        str(spec.get("stem") or "").lower(): spec
        for spec in (component_specs or [])
        if isinstance(spec, dict) and spec.get("stem")
    }
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ref in references or []:
        filename = ""
        stem = ""
        fmt = ""
        viewer_filename = ""
        label = ""
        if hasattr(ref, "filename"):
            filename = str(getattr(ref, "filename", None) or "")
            stem = str(getattr(ref, "stem", None) or "")
            fmt = str(getattr(ref, "format", None) or "")
            viewer_filename = str(getattr(ref, "viewer_filename", None) or "")
            label = str(getattr(ref, "label", None) or "")
            ref_type = str(getattr(ref, "type", None) or "").lower()
        elif isinstance(ref, dict):
            filename = str(ref.get("filename") or "")
            stem = str(ref.get("stem") or "")
            fmt = str(ref.get("format") or "")
            viewer_filename = str(ref.get("viewer_filename") or "")
            label = str(ref.get("label") or "")
            ref_type = str(ref.get("type") or "").lower()
        else:
            continue
        if ref_type not in {"component", "cad", ""}:
            continue
        name = Path(filename).name.strip()
        if not name:
            continue
        ext = Path(name).suffix.lower()
        if ext not in _CAD_REF_EXTS and (fmt or "").lower() not in {
            "step", "stp", "stl", "3mf", "glb", "gltf", "obj", "ply", "off",
            "iges", "igs", "brep", "brp", "f3z",
        }:
            # Still allow if a matching CAD file exists on disk for this stem.
            if not any((project_path / f"{Path(name).stem}{e}").is_file() for e in _CAD_REF_EXTS):
                continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        entry: dict[str, Any] = {
            "filename": name,
            "stem": stem or Path(name).stem,
            "format": (fmt or ext.lstrip(".")).lower() or None,
            "label": label or stem or Path(name).stem,
        }
        if viewer_filename:
            entry["viewer_filename"] = Path(viewer_filename).name
        path = project_path / name
        analysis_path = path if path.is_file() else None
        if analysis_path is None and viewer_filename:
            alt = project_path / Path(viewer_filename).name
            if alt.is_file():
                analysis_path = alt
        if path.is_file():
            entry["exists"] = True
            entry["size_bytes"] = path.stat().st_size
        spec = specs_by_stem.get(str(entry["stem"]).lower())
        if spec:
            for key_name in ("size_mm", "bbox_mm", "bbox_min_mm", "bbox_max_mm", "volume_mm3", "kind"):
                if spec.get(key_name) is not None:
                    entry[key_name] = spec.get(key_name)
        # Enrich with silhouettes / guidance when possible (no view images here — those go via PromptImage).
        if analysis_path is not None:
            try:
                from backend.services.cad_reference_geometry import analyze_reference_geometry

                facts = analyze_reference_geometry(analysis_path, include_views=False)
                for key_name in (
                    "size_mm",
                    "width_mm",
                    "depth_mm",
                    "height_mm",
                    "bbox_min_mm",
                    "bbox_max_mm",
                    "center_mm",
                    "silhouette_top_mm",
                    "silhouette_front_mm",
                    "silhouette_side_mm",
                    "vertex_count",
                    "face_count",
                    "message",
                    "design_guidance",
                ):
                    if facts.get(key_name) is not None:
                        entry[key_name] = facts.get(key_name)
            except Exception:
                pass
        out.append(entry)
    return out[:20]


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
    # Only auto-pick project DXFs when the prompt clearly asks for DXF/DWG import.
    from backend.services.design_service import _prompt_mentions_dxf_import

    if _prompt_mentions_dxf_import(prompt or ""):
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


def _hydrate_prompt_url_documents(prompt: str, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fetch pasted http(s) datasheet / product URLs and attach as document refs for AI."""
    try:
        from backend.services import url_document_service
    except Exception:
        return refs
    existing_ids = {str(r.get("id") or "") for r in refs}
    existing_urls = {
        str(r.get("url") or "").strip()
        for r in refs
        if str(r.get("url") or "").strip()
    }
    docs = url_document_service.fetch_documents_from_text(prompt or "", limit=3)
    if not docs:
        return refs
    out = list(refs)
    for doc_ref in url_document_service.documents_as_reference_dicts(docs):
        rid = str(doc_ref.get("id") or "")
        url = str(doc_ref.get("url") or "").strip()
        if rid in existing_ids or (url and url in existing_urls):
            continue
        out.append(doc_ref)
        if rid:
            existing_ids.add(rid)
        if url:
            existing_urls.add(url)
    return out


def _hydrate_mcmaster_spec_refs(
    project_path: Path,
    body: PromptRequest,
    refs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """When a McMaster CAD component is @-referenced, attach its AI spec markdown too."""
    existing_ids = {str(r.get("id") or "") for r in refs}
    existing_files = {
        Path(str(r.get("filename") or "")).name.lower()
        for r in refs
        if str(r.get("filename") or "").strip()
    }
    out = list(refs)
    for r in body.references:
        if str(r.type or "").lower() != "component":
            continue
        cad_name = Path(str(r.filename or r.viewer_filename or "")).name.strip()
        if not cad_name:
            continue
        entry = cad_service.find_mcmaster_library_entry(project_path, cad_name)
        if not entry:
            continue
        markdown = cad_service.load_mcmaster_reference_markdown(project_path, entry)
        if not markdown.strip():
            continue
        ref_name = Path(str(entry.get("reference") or "")).name.strip()
        if not ref_name:
            pn = str(entry.get("part_number") or Path(cad_name).stem).strip() or "part"
            ref_name = f"mcmaster_{pn}.md"
        spec_id = f"mcmaster-spec:{ref_name}"
        if spec_id in existing_ids or ref_name.lower() in existing_files:
            continue
        pn = str(entry.get("part_number") or "").strip()
        token_stem = (pn or Path(ref_name).stem or "part").replace(" ", "-")
        out.append(
            {
                "id": spec_id,
                "type": "spec",
                "filename": ref_name,
                "stem": Path(ref_name).stem,
                "label": f"McMaster {pn or Path(cad_name).stem} specs",
                "format": "md",
                "text_content": markdown[:60000],
                "text_truncated": len(markdown) > 60000,
                "mcmaster_part_number": pn or None,
                "mcmaster_page_url": str(entry.get("page_url") or "").strip() or None,
                "linked_component": cad_name,
            }
        )
        existing_ids.add(spec_id)
        existing_files.add(ref_name.lower())
    return out


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
                # McMaster / text specs saved under references/ may arrive as filename-only chips.
                if ref_type in {"document", "text", "spec"} and not text_content.strip():
                    safe_name = Path(str(r.filename or r.label or "")).name.strip()
                    if safe_name:
                        for candidate in (
                            project_path / cad_service.REFERENCE_DIRNAME / safe_name,
                            project_path / safe_name,
                        ):
                            if candidate.is_file():
                                try:
                                    loaded = candidate.read_text(encoding="utf-8", errors="ignore")
                                    text_content = loaded
                                    text_truncated = len(text_content) > 60000
                                    break
                                except Exception:
                                    pass
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
    refs = _hydrate_mcmaster_spec_refs(project_path, body, refs)
    refs = _hydrate_prompt_url_documents(body.prompt, refs)
    is_plain_v2 = (body.mode or "standard").lower() == "v2"
    referenced_components = []
    for r in body.references:
        if r.type != "component":
            continue
        # Always honor explicit component/CAD @refs (including in 2.0).
        # Plain v2 previously skipped these so generative prompts wouldn't treat
        # every project part as a fixture — explicit attach still counts.
        if not r.filename and is_plain_v2:
            continue
        comp: dict[str, Any] = {
            "filename": r.filename,
            "stem": r.stem,
            "label": r.label,
            "format": r.format,
            "viewer_filename": r.viewer_filename,
        }
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
    cad_files = _build_cad_reference_entries(project_path, body.references, component_specs)
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
    if cad_files:
        context["cad_files"] = cad_files
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
        context["model_electronics"] = bool(getattr(body, "model_electronics", True))
    if (body.mode or "standard").lower() in {"vibecad", "vibe", "vibecade"}:
        context["vibecad_runtime"] = True
        context["pipeline"] = "vibecad_build123d"
        context["strict_upstream_text_to_cad"] = False
        context["jake_tool_agent"] = False
    if (body.mode or "standard").lower() == "mesh":
        context["mesh_img2threejs"] = True
        context["pipeline"] = "img2threejs"
    if (body.mode or "standard").lower() == "fusion":
        context["fusion_target"] = "fusion360" if (body.fusion_target or "").lower() == "fusion360" else "in_app"
    if (body.mode or "standard").lower() == "architect":
        context["architect_mode"] = True
        context["snap_grid_mm"] = 1000
        context["wall_height_mm"] = 2800
        context["module_system"] = "modular house kit with grid-snapping room, wall, window, roof, and service-core modules"
    return context


def _attach_knowledge_context(
    context: dict[str, Any],
    body: PromptRequest,
    user: dict[str, Any] | None,
    skills: list[str] | None = None,
) -> dict[str, Any]:
    if not body.use_knowledge_base or not user:
        return context
    try:
        from backend.services import knowledge_service

        kb = knowledge_service.build_prompt_context(
            user["id"],
            knowledge_base_ids=list(body.knowledge_base_ids or []),
            skill_ids=list(skills or body.skills or []),
        )
    except Exception as exc:
        logger.info("Knowledge base context skipped: %s", exc)
        return context
    if not kb or not kb.get("text"):
        return context
    context = {**context, "knowledge_base": kb}
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
    label = _prompt_timeline_label(body)
    entry = _record_history(
        project_path,
        "prompt",
        label,
        primary,
        meta=_prompt_timeline_meta(
            body,
            program=result.get("program"),
            files=result.get("files"),
            intent="toolhead_rebuild",
            message=message,
            trace_id=trace_id,
        ),
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
            FRONTEND / "client-reload.js",
            FRONTEND / "ai-key-ui.js",
            FRONTEND / "knowledge-base.js",
            FRONTEND / "render-agent.js",
            FRONTEND / "ribbon.js",
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


class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class KnowledgeBaseUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    skill_ids: list[str] | None = Field(default=None, max_length=40)


class KnowledgeFolderCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    parent_id: str | None = None


class KnowledgeShareRequest(BaseModel):
    share_type: str = Field(..., pattern="^(user|project|team)$")
    target_id: str = Field(..., min_length=1, max_length=64)


class TextureLibraryCreateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    source_data_url: str = Field(..., min_length=32)
    sphere_data_url: str | None = Field(default=None)
    source_label: str | None = Field(default=None, max_length=200)
    project_id: str | None = Field(default=None, max_length=64)
    favorite: bool = False


class TextureLibraryUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    favorite: bool | None = None
    source_label: str | None = Field(default=None, max_length=200)
    sphere_data_url: str | None = None


@app.get("/api/knowledge-bases")
def list_knowledge_bases(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    bases = knowledge_service.list_knowledge_bases(user["id"])
    shared = knowledge_service.list_shared_knowledge_bases(user["id"])
    return {
        "knowledge_bases": bases,
        "shared_with_me": shared,
        "stats": knowledge_service.user_knowledge_stats(user["id"]),
    }


@app.get("/api/knowledge-bases/share-targets")
def knowledge_share_targets(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    return knowledge_service.list_share_targets(user["id"])


@app.post("/api/knowledge-bases")
def create_knowledge_base(body: KnowledgeBaseCreateRequest, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    kb = knowledge_service.create_knowledge_base(user["id"], body.name, body.description)
    return {"knowledge_base": kb}


@app.get("/api/knowledge-bases/{kb_id}")
def get_knowledge_base_tree(kb_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    try:
        return knowledge_service.get_kb_tree(user["id"], kb_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.patch("/api/knowledge-bases/{kb_id}")
def update_knowledge_base(
    kb_id: str,
    body: KnowledgeBaseUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import knowledge_service

    try:
        kb = knowledge_service.update_knowledge_base(
            user["id"],
            kb_id,
            name=body.name,
            description=body.description,
            skill_ids=body.skill_ids,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"knowledge_base": kb}


@app.delete("/api/knowledge-bases/{kb_id}")
def delete_knowledge_base(kb_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    try:
        knowledge_service.delete_knowledge_base(user["id"], kb_id)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


@app.get("/api/knowledge-bases/{kb_id}/shares")
def list_knowledge_base_shares(kb_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    try:
        return {"shares": knowledge_service.list_knowledge_shares(user["id"], kb_id)}
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/knowledge-bases/{kb_id}/shares")
def share_knowledge_base(
    kb_id: str,
    body: KnowledgeShareRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import knowledge_service

    try:
        share = knowledge_service.share_knowledge_base(
            user["id"],
            kb_id,
            share_type=body.share_type,
            target_id=body.target_id,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"share": share}


@app.delete("/api/knowledge-bases/{kb_id}/shares/{share_id}")
def unshare_knowledge_base(kb_id: str, share_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    try:
        knowledge_service.unshare_knowledge_base(user["id"], kb_id, share_id)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


@app.post("/api/knowledge-bases/{kb_id}/folders")
def create_knowledge_folder(
    kb_id: str,
    body: KnowledgeFolderCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import knowledge_service

    try:
        folder = knowledge_service.create_folder(user["id"], kb_id, body.name, parent_id=body.parent_id)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"folder": folder}


@app.post("/api/knowledge-bases/{kb_id}/items")
async def upload_knowledge_items(
    kb_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    folder_id: str | None = Form(default=None),
    files: list[UploadFile] = File(default_factory=list),
):
    from backend.services import knowledge_service

    if not files:
        raise HTTPException(400, "No files uploaded")
    uploaded: list[dict[str, Any]] = []
    errors: list[str] = []
    for upload in files[:80]:
        raw_name = upload.filename or "file"
        name = Path(raw_name).name
        try:
            data = await upload.read()
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            continue
        try:
            item = knowledge_service.add_item_bytes(
                user["id"],
                kb_id,
                filename=name,
                data=data,
                media_type=upload.content_type or "application/octet-stream",
                folder_id=folder_id or None,
                relative_path=str(raw_name),
            )
            uploaded.append(item)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            errors.append(f"{name}: {exc}")
    return {"uploaded": uploaded, "errors": errors, "count": len(uploaded)}


@app.delete("/api/knowledge-bases/{kb_id}/items/{item_id}")
def delete_knowledge_item(kb_id: str, item_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import knowledge_service

    try:
        knowledge_service.delete_item(user["id"], kb_id, item_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


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


@app.get("/api/users/me/textures")
def list_my_textures(
    favorites: bool = Query(False),
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import texture_library_service

    return {"textures": texture_library_service.list_textures(user["id"], favorites_only=favorites)}


@app.post("/api/users/me/textures")
def create_my_texture(body: TextureLibraryCreateRequest, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import texture_library_service

    try:
        texture = texture_library_service.create_texture(
            user["id"],
            name=body.name,
            source_data_url=body.source_data_url,
            sphere_data_url=body.sphere_data_url,
            source_label=body.source_label,
            project_id=body.project_id,
            favorite=body.favorite,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"texture": texture}


@app.post("/api/users/me/textures/upload")
async def upload_my_texture(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    source_label: str | None = Form(None),
    project_id: str | None = Form(None),
    favorite: bool = Form(False),
    sphere_data_url: str | None = Form(None),
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import texture_library_service

    data = await file.read()
    try:
        texture = texture_library_service.create_texture(
            user["id"],
            name=name,
            source_bytes=data,
            source_filename=file.filename or "texture.png",
            sphere_data_url=sphere_data_url,
            source_label=source_label,
            project_id=project_id,
            favorite=favorite,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"texture": texture}


@app.get("/api/users/me/textures/{texture_id}")
def get_my_texture(texture_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import texture_library_service

    try:
        return {"texture": texture_library_service.get_texture(user["id"], texture_id)}
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.patch("/api/users/me/textures/{texture_id}")
def update_my_texture(
    texture_id: str,
    body: TextureLibraryUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import texture_library_service

    try:
        texture = texture_library_service.update_texture(
            user["id"],
            texture_id,
            name=body.name,
            favorite=body.favorite,
            source_label=body.source_label,
            sphere_data_url=body.sphere_data_url,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"texture": texture}


@app.delete("/api/users/me/textures/{texture_id}")
def delete_my_texture(texture_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import texture_library_service

    try:
        return texture_library_service.delete_texture(user["id"], texture_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/users/me/textures/{texture_id}/source")
def get_my_texture_source(texture_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import texture_library_service

    try:
        path = texture_library_service.resolve_texture_file(user["id"], texture_id, "source")
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return FileResponse(path)


@app.get("/api/users/me/textures/{texture_id}/sphere")
def get_my_texture_sphere(texture_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import texture_library_service

    try:
        path = texture_library_service.resolve_texture_file(user["id"], texture_id, "sphere")
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return FileResponse(path)


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


@app.post("/api/agent-apps/{app_id_or_slug}/boost")
def boost_agent_app(
    app_id_or_slug: str,
    body: MarketplaceBoostRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        return {"boost": agent_marketplace_service.apply_boost(user["id"], app_id_or_slug, body.message)}
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


# ── 3D Model Marketplace ─────────────────────────────────────────────────────

@app.get("/api/model-listings")
def list_model_listings(
    mine: bool = False,
    include_pending: bool = False,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    is_admin = _is_a1projects_admin(user)
    listings = model_marketplace_service.list_listings(
        user_id=(user or {}).get("id"),
        include_pending=bool(include_pending and is_admin),
        mine_only=bool(mine and user),
    )
    return {"listings": listings, "admin": is_admin}


@app.get("/api/model-listings/{listing_id_or_slug}")
def get_model_listing(
    listing_id_or_slug: str,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    listing = model_marketplace_service.get_listing(
        listing_id_or_slug,
        user_id=(user or {}).get("id"),
        include_pending=_is_a1projects_admin(user),
    )
    if not listing:
        raise HTTPException(404, "Model listing not found")
    return {"listing": listing}


@app.post("/api/model-listings")
def submit_model_listing(body: ModelListingSubmitRequest, user: dict[str, Any] = Depends(get_current_user)):
    payload = body.model_dump()
    try:
        if body.project_id and body.project_filenames:
            path = _require_project_read(user, body.project_id)
            payload["files"] = model_marketplace_service.resolve_project_files(
                path, body.project_filenames, project_id=body.project_id
            )
        listing = model_marketplace_service.create_listing(user["id"], payload)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"listing": listing, "message": "Submitted for review."}


@app.patch("/api/model-listings/{listing_id_or_slug}")
def update_model_listing(
    listing_id_or_slug: str,
    body: ModelListingUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        listing = model_marketplace_service.update_listing(user["id"], listing_id_or_slug, data)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"listing": listing, "message": "Listing updated (re-queued for review if it was public)."}


@app.patch("/api/model-listings/{listing_id_or_slug}/review")
def review_model_listing(
    listing_id_or_slug: str,
    body: ModelListingReviewRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    if not _is_a1projects_admin(user):
        raise HTTPException(403, "Only admins can review marketplace models.")
    try:
        listing = model_marketplace_service.review_listing(
            listing_id_or_slug,
            status=body.status,
            featured=body.featured,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"listing": listing}


@app.post("/api/model-listings/{listing_id_or_slug}/boost")
def boost_model_listing(
    listing_id_or_slug: str,
    body: MarketplaceBoostRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        return {"boost": model_marketplace_service.apply_boost(user["id"], listing_id_or_slug, body.message)}
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/marketplace/boosts")
def list_marketplace_boosts(
    kind: str | None = None,
    status: str = "pending",
    user: dict[str, Any] = Depends(get_current_user),
):
    if not _is_a1projects_admin(user):
        raise HTTPException(403, "Only admins can list boost applications.")
    return {"boosts": model_marketplace_service.list_boost_apps(kind=kind, status=status)}


@app.patch("/api/marketplace/boosts/{boost_id}")
def review_marketplace_boost(
    boost_id: str,
    body: MarketplaceBoostReviewRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    if not _is_a1projects_admin(user):
        raise HTTPException(403, "Only admins can review boost applications.")
    try:
        return {"boost": model_marketplace_service.review_boost(boost_id, status=body.status, days=body.days)}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class MarketplaceCheckoutRequest(BaseModel):
    kind: str = Field(..., max_length=20)
    listing_id: str = Field(..., max_length=80)
    success_url: str | None = Field(default=None, max_length=500)
    cancel_url: str | None = Field(default=None, max_length=500)


class MarketplacePaypalRequest(BaseModel):
    email: str = Field(default="", max_length=200)


class MarketplacePayoutPreferenceRequest(BaseModel):
    method: str = Field(..., max_length=40)
    details: dict[str, str] = Field(default_factory=dict)


@app.get("/api/marketplace/payments/config")
def marketplace_payments_config():
    from backend.services import marketplace_payments_service as payments

    return payments.public_config()


@app.get("/api/marketplace/seller")
def marketplace_seller_status(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import marketplace_payments_service as payments

    return {"seller": payments.refresh_connect_status(user)}


@app.post("/api/marketplace/seller/connect")
def marketplace_seller_connect(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import marketplace_payments_service as payments

    base = str(getattr(settings, "public_base_url", None) or _request_origin(request)).rstrip("/")
    return_url = f"{base}/marketplace.html?seller=connected#payments-readme"
    refresh_url = f"{base}/marketplace.html?seller=refresh#payments-readme"
    try:
        return payments.create_connect_onboarding_link(user, return_url=return_url, refresh_url=refresh_url)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/marketplace/seller/paypal")
def marketplace_seller_paypal(
    body: MarketplacePaypalRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import marketplace_payments_service as payments

    try:
        return {"seller": payments.set_paypal_email(user, body.email)}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/marketplace/seller/payout-method")
def marketplace_seller_payout_method(
    body: MarketplacePayoutPreferenceRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import marketplace_payments_service as payments

    try:
        return {"seller": payments.set_payout_preference(user, body.method, body.details)}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/marketplace/fee-preview")
def marketplace_fee_preview(price_cents: int = Query(0, ge=0, le=1_000_000)):
    from backend.services import marketplace_payments_service as payments

    return payments.fee_breakdown(price_cents)


@app.post("/api/marketplace/checkout")
def marketplace_checkout(
    body: MarketplaceCheckoutRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import marketplace_payments_service as payments

    kind = str(body.kind or "").strip().lower()
    listing = None
    if kind == "agent":
        listing = agent_marketplace_service.get_listing(body.listing_id, user_id=user["id"], include_pending=False)
    elif kind in {"model", "knowledge"}:
        listing = model_marketplace_service.get_listing(body.listing_id, user_id=user["id"], include_pending=False)
        if listing and kind == "knowledge":
            # knowledge bases are model listings with product_type/category markers
            pass
    else:
        raise HTTPException(422, "kind must be agent, model, or knowledge")
    if not listing:
        raise HTTPException(404, "Listing not found")

    origin = _request_origin(request)
    success = body.success_url or f"{origin}/marketplace.html?purchase=success"
    cancel = body.cancel_url or f"{origin}/marketplace.html?purchase=cancel"
    try:
        result = payments.create_checkout_session(
            buyer=user,
            kind="model" if kind == "knowledge" else kind,
            listing=listing,
            success_url=success,
            cancel_url=cancel,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return result


@app.post("/api/marketplace/stripe/webhook")
async def marketplace_stripe_webhook(request: Request):
    from backend.services import marketplace_payments_service as payments

    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        return payments.handle_stripe_webhook(payload, sig)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/user/ai-credits/stripe/webhook")
async def ai_credits_stripe_webhook(request: Request):
    from backend.services import marketplace_payments_service as payments

    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    try:
        return payments.handle_stripe_webhook(payload, sig)
    except Exception as exc:
        raise HTTPException(400, str(exc)) from exc


def _send_welcome_email_background(user: dict[str, Any]) -> None:
    try:
        result = onboarding_email_service.send_welcome_email(user)
        logger.info("onboarding welcome email result user_id=%s ok=%s error=%s", user.get("id"), result.get("ok"), result.get("error"))
    except Exception:
        logger.warning("Could not send onboarding welcome email for user_id=%s", user.get("id"), exc_info=True)


def _send_trial_credits_email_background(user: dict[str, Any]) -> None:
    try:
        result = onboarding_email_service.send_trial_credits_email(user)
        if result.get("ok") or result.get("error") in {"smtp_not_configured", "placeholder_social_email", "missing_email"}:
            try:
                ai_credit_service.mark_trial_email_sent(user["id"])
            except Exception:
                pass
        logger.info(
            "trial credits email result user_id=%s ok=%s error=%s",
            user.get("id"),
            result.get("ok"),
            result.get("error"),
        )
    except Exception:
        logger.warning("Could not send trial credits email for user_id=%s", user.get("id"), exc_info=True)


@app.post("/api/auth/register")
def register(body: RegisterRequest, background_tasks: BackgroundTasks):
    try:
        user = teams_service.create_user(body.email, body.password, body.display_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    try:
        new_user_alert_service.add_new_user(user, source="email")
        _notify_management_update("new_user.created")
    except Exception:
        logger.warning("Could not enqueue new user admin alert for user_id=%s", user.get("id"), exc_info=True)
    background_tasks.add_task(_send_welcome_email_background, dict(user))
    token = create_access_token(user["id"])
    teams = teams_service.list_teams(user["id"])
    return {"token": token, "user": user, "teams": teams, "ai": _ai_status_for_user(user)}


@app.post("/api/auth/login")
def login(body: LoginRequest):
    user = teams_service.authenticate(body.email, body.password)
    if not user:
        raise HTTPException(401, "Invalid email or password")
    try:
        project_shares_service.accept_pending_project_shares_for_user(
            user["id"], user.get("email") or body.email
        )
    except Exception:
        logger.warning("Could not claim pending project shares for user_id=%s", user.get("id"), exc_info=True)
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
        created_new_user = bool(user.pop("_created_new_user", False))
        accepted_invites = user.pop("_accepted_invites", [])
        if created_new_user:
            try:
                new_user_alert_service.add_new_user(user, source=provider)
                _notify_management_update("new_user.created")
            except Exception:
                logger.warning("Could not enqueue social new user alert for user_id=%s", user.get("id"), exc_info=True)
            threading.Thread(target=_send_welcome_email_background, args=(dict(user),), daemon=True).start()
        token = create_access_token(user["id"])
    except Exception as exc:
        logger.warning("Social OAuth callback failed for %s: %s", provider, exc)
        return _social_redirect_error(provider, str(exc))
    for invite in accepted_invites or []:
        team_id = invite.get("team_id")
        if team_id:
            _notify_workspace(
                team_id,
                {
                    "type": "team.invite.accepted",
                    "team_id": team_id,
                    "by": user.get("display_name"),
                    "by_user_id": user.get("id"),
                },
            )
            _notify_user(user["id"], {"type": "team.invites.changed", "team_id": team_id})
    safe_provider = urllib.parse.quote((provider or "social").strip().lower()[:40])
    new_flag = "&social_new=1" if created_new_user else ""
    return RedirectResponse(f"/?social_token={token}&social_provider={safe_provider}{new_flag}", status_code=302)


async def _handle_discord_link_callback(code: str | None, state: str | None, error: str | None = None) -> RedirectResponse:
    from backend.services.discord_link_service import upsert_link
    from backend.services.social_oauth import consume_oauth_state

    if error:
        return RedirectResponse(f"/?discord_link=error&discord_error={urllib.parse.quote(str(error)[:160])}", status_code=302)
    if not code or not state:
        return RedirectResponse("/?discord_link=error&discord_error=missing_params", status_code=302)
    user_id = consume_oauth_state(state)
    if not user_id:
        return RedirectResponse("/?discord_link=error&discord_error=invalid_state", status_code=302)
    try:
        upsert_link(str(user_id), code)
    except Exception as exc:
        logger.warning("Discord link callback failed user_id=%s: %s", user_id, exc)
        return RedirectResponse(f"/?discord_link=error&discord_error={urllib.parse.quote(str(exc)[:160])}", status_code=302)
    return RedirectResponse("/?discord_link=connected", status_code=302)


async def _handle_twitter_link_callback(
    code: str | None,
    state: str | None,
    error: str | None = None,
    oauth_token: str | None = None,
    oauth_verifier: str | None = None,
) -> RedirectResponse:
    from backend.database import get_conn
    from backend.services import twitter_link_service

    if error:
        return RedirectResponse(f"/?twitter_link=error&twitter_error={urllib.parse.quote(str(error)[:160])}", status_code=302)
    # OAuth 1.0a returns oauth_token + oauth_verifier (no code/state PKCE pair).
    if oauth_token and oauth_verifier:
        try:
            twitter_link_service.upsert_link_oauth1(oauth_token, oauth_verifier)
        except Exception as exc:
            logger.warning("Twitter OAuth1 link callback failed: %s", exc)
            return RedirectResponse(f"/?twitter_link=error&twitter_error={urllib.parse.quote(str(exc)[:160])}", status_code=302)
        return RedirectResponse("/?twitter_link=connected", status_code=302)
    if not code or not state:
        return RedirectResponse("/?twitter_link=error&twitter_error=missing_params", status_code=302)
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT user_id FROM twitter_oauth_pending WHERE state = ?",
                (state,),
            ).fetchone()
        pending_user = str((row["user_id"] if row else "") or "")
        if not pending_user:
            return RedirectResponse("/?twitter_link=error&twitter_error=invalid_state", status_code=302)
        twitter_link_service.upsert_link(pending_user, code, state)
    except Exception as exc:
        logger.warning("Twitter link callback failed: %s", exc)
        return RedirectResponse(f"/?twitter_link=error&twitter_error={urllib.parse.quote(str(exc)[:160])}", status_code=302)
    return RedirectResponse("/?twitter_link=connected", status_code=302)


@app.get("/oauth/{provider}/callback")
async def social_oauth_callback(
    request: Request,
    provider: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    oauth_token: str | None = None,
    oauth_verifier: str | None = None,
):
    provider_key = provider.strip().lower()
    if provider_key == "autodesk":
        return autodesk_oauth_callback(request, code=code, state=state, error=error, error_description=error_description)
    if provider_key == "discord":
        return await _handle_discord_link_callback(code, state, error)
    if provider_key in {"twitter", "x"}:
        return await _handle_twitter_link_callback(
            code,
            state,
            error,
            oauth_token=oauth_token,
            oauth_verifier=oauth_verifier,
        )
    return await _handle_social_callback(provider, code, state, error)


@app.post("/oauth/{provider}/callback")
async def social_oauth_callback_post(provider: str, request: Request):
    form = await request.form()
    provider_key = provider.strip().lower()
    if provider_key == "autodesk":
        return autodesk_oauth_callback(
            request,
            code=str(form.get("code") or "") or None,
            state=str(form.get("state") or "") or None,
            error=str(form.get("error") or "") or None,
            error_description=str(form.get("error_description") or "") or None,
        )
    if provider_key == "discord":
        return await _handle_discord_link_callback(
            str(form.get("code") or "") or None,
            str(form.get("state") or "") or None,
            str(form.get("error") or "") or None,
        )
    if provider_key in {"twitter", "x"}:
        return await _handle_twitter_link_callback(
            str(form.get("code") or "") or None,
            str(form.get("state") or "") or None,
            str(form.get("error") or "") or None,
            oauth_token=str(form.get("oauth_token") or "") or None,
            oauth_verifier=str(form.get("oauth_verifier") or "") or None,
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


@app.get("/api/integrations/discord/status")
def discord_link_status(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import discord_link_service

    return discord_link_service.status(user)


@app.post("/api/integrations/discord/link-url")
def discord_link_url(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import discord_link_service

    try:
        return {"url": discord_link_service.link_url(user["id"])}
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@app.delete("/api/integrations/discord/link")
def discord_unlink(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import discord_link_service

    discord_link_service.unlink(user["id"])
    return {"ok": True}


@app.get("/api/integrations/twitter/status")
def twitter_link_status(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import twitter_link_service

    return twitter_link_service.status(user)


@app.post("/api/integrations/twitter/link-url")
def twitter_link_url(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import twitter_link_service

    try:
        return twitter_link_service.link_start(user["id"])
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/integrations/twitter/link-pin")
def twitter_link_pin(
    payload: dict[str, Any],
    user: dict[str, Any] = Depends(get_current_user),
):
    """Complete Desktop/Native X OAuth using the PIN shown after authorizing."""
    from backend.services import twitter_link_service

    state = str((payload or {}).get("state") or "").strip()
    pin = str((payload or {}).get("pin") or (payload or {}).get("verifier") or "").strip()
    try:
        account = twitter_link_service.complete_oob(user["id"], state, pin)
        return {"ok": True, "account": account}
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        logger.exception("twitter link-pin failed user_id=%s", user.get("id"))
        raise HTTPException(502, str(exc) or "Could not finish X connect.") from exc


@app.delete("/api/integrations/twitter/link")
def twitter_unlink(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import twitter_link_service

    twitter_link_service.unlink(user["id"])
    return {"ok": True}


@app.post("/api/integrations/twitter/post-video")
async def twitter_post_video(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import twitter_link_service

    form = await request.form()
    upload = form.get("video")
    text = str(form.get("text") or "").strip()
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(400, "Missing video file.")
    raw = await upload.read()
    filename = str(getattr(upload, "filename", None) or "render3d-video.webm")
    mime = str(getattr(upload, "content_type", None) or "video/webm")
    try:
        return twitter_link_service.post_video(
            user["id"],
            video_bytes=raw,
            filename=filename,
            mime_type=mime,
            text=text,
        )
    except RuntimeError as exc:
        msg = str(exc)
        status = 401 if "Connect your X" in msg or "Reconnect" in msg else 400
        raise HTTPException(status, msg) from exc
    except Exception as exc:
        logger.exception("twitter post-video failed user_id=%s", user.get("id"))
        raise HTTPException(502, str(exc) or "Could not post to X.") from exc


@app.post("/api/video/convert")
async def convert_viewport_video(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Convert a recorded viewport clip to webm / mp4 / gif for download."""
    import subprocess
    import tempfile

    form = await request.form()
    upload = form.get("video")
    fmt = str(form.get("format") or "mp4").strip().lower()
    if fmt not in {"webm", "mp4", "gif"}:
        raise HTTPException(400, "format must be webm, mp4, or gif.")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(400, "Missing video file.")
    raw = await upload.read()
    if not raw:
        raise HTTPException(400, "Video file is empty.")
    if len(raw) > 180 * 1024 * 1024:
        raise HTTPException(400, "Video is too large to convert (max 180 MB).")

    filename = str(getattr(upload, "filename", None) or "clip.webm")
    mime = str(getattr(upload, "content_type", None) or "video/webm").lower()
    src_suffix = ".mp4" if filename.lower().endswith((".mp4", ".m4v")) or "mp4" in mime else ".webm"

    with tempfile.TemporaryDirectory(prefix="r3d-vid-") as tmp:
        src = Path(tmp) / f"input{src_suffix}"
        src.write_bytes(raw)
        if fmt == "webm" and src_suffix == ".webm":
            return Response(content=raw, media_type="video/webm", headers={
                "Content-Disposition": 'attachment; filename="render3d-video.webm"',
            })
        if fmt == "mp4" and src_suffix == ".mp4":
            return Response(content=raw, media_type="video/mp4", headers={
                "Content-Disposition": 'attachment; filename="render3d-video.mp4"',
            })

        out = Path(tmp) / f"output.{fmt}"
        if fmt == "mp4":
            cmd = [
                "ffmpeg", "-y", "-i", str(src),
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-movflags", "+faststart",
                str(out),
            ]
            media_type = "video/mp4"
            download_name = "render3d-video.mp4"
        elif fmt == "webm":
            cmd = [
                "ffmpeg", "-y", "-i", str(src),
                "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32",
                "-c:a", "libopus",
                str(out),
            ]
            media_type = "video/webm"
            download_name = "render3d-video.webm"
        else:
            cmd = [
                "ffmpeg", "-y", "-i", str(src),
                "-vf", "fps=12,scale='min(720,iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
                "-loop", "0",
                str(out),
            ]
            media_type = "image/gif"
            download_name = "render3d-video.gif"

        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        except FileNotFoundError as exc:
            raise HTTPException(503, "ffmpeg is required for clip conversion.") from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, "Video conversion timed out.") from exc
        if proc.returncode != 0 or not out.is_file() or out.stat().st_size <= 0:
            detail = (proc.stderr or proc.stdout or "")[-400:]
            logger.warning("video convert failed user_id=%s format=%s detail=%s", user.get("id"), fmt, detail)
            raise HTTPException(400, f"Could not convert clip to {fmt.upper()}.")
        data = out.read_bytes()
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
        )


@app.get("/api/projects/{project_id}/videos")
def list_project_videos(
    project_id: str,
    limit: int = Query(24, ge=1, le=48),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Recent viewport / studio clips saved for this project (re-edit + Share to X)."""
    from backend.services import project_video_service

    path = _require_project_read(user, project_id)
    return {"videos": project_video_service.list_videos(path, project_id, limit=limit)}


@app.post("/api/projects/{project_id}/videos")
async def save_project_video(
    project_id: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_video_service

    path = _require_project_write(user, project_id)
    form = await request.form()
    upload = form.get("video")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(400, "Missing video file.")
    raw = await upload.read()
    label = str(form.get("label") or "").strip() or None
    filename = str(getattr(upload, "filename", None) or "clip.webm")
    mime = str(getattr(upload, "content_type", None) or "video/webm")
    try:
        item = project_video_service.save_video(
            path,
            project_id,
            data=raw,
            filename=filename,
            mime=mime,
            label=label,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"video": item}


@app.get("/api/projects/{project_id}/videos/{video_id}")
def get_project_video(
    project_id: str,
    video_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_video_service

    path = _require_project_read(user, project_id)
    found = project_video_service.get_video_file(path, video_id)
    if not found:
        raise HTTPException(404, "Video not found.")
    file_path, item = found
    return FileResponse(
        file_path,
        media_type=str(item.get("mime") or "video/webm"),
        filename=str(item.get("filename") or file_path.name),
    )


@app.get("/api/projects/{project_id}/videos/{video_id}/poster")
def get_project_video_poster(
    project_id: str,
    video_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_video_service

    path = _require_project_read(user, project_id)
    poster = project_video_service.get_poster_file(path, video_id)
    if not poster:
        raise HTTPException(404, "Poster not found.")
    return FileResponse(poster, media_type="image/jpeg")


@app.delete("/api/projects/{project_id}/videos/{video_id}")
def delete_project_video(
    project_id: str,
    video_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_video_service

    path = _require_project_write(user, project_id)
    if not project_video_service.delete_video(path, video_id):
        raise HTTPException(404, "Video not found.")
    return {"ok": True}


@app.post("/api/video/capture-sessions")
def create_video_capture_session(
    body: dict[str, Any] | None = Body(default=None),
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import video_capture_service

    payload = body or {}
    project_id = str(payload.get("project_id") or "").strip() or None
    hint = str(payload.get("hint") or "").strip() or None
    try:
        meta = video_capture_service.create_session(user["id"], project_id=project_id, hint=hint)
    except Exception as exc:
        raise HTTPException(400, str(exc) or "Could not create capture session.") from exc
    base = str(getattr(settings, "public_base_url", "") or "https://render3d.app").rstrip("/")
    token = meta["token"]
    capture_url = f"{base}/capture.html?t={urllib.parse.quote(token)}"
    return {
        **meta,
        "capture_url": capture_url,
        "qr_url": f"/api/video/capture-sessions/{urllib.parse.quote(token)}/qr.png",
    }


@app.get("/api/video/capture-sessions/{token}")
def get_video_capture_session(
    token: str,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    from backend.services import video_capture_service

    try:
        meta = video_capture_service.get_session(token)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    owner = user and str(user.get("id")) == str(meta.get("user_id"))
    out = video_capture_service.public_session(meta, include_owner=bool(owner))
    base = str(getattr(settings, "public_base_url", "") or "https://render3d.app").rstrip("/")
    token_q = urllib.parse.quote(token)
    out["capture_url"] = f"{base}/capture.html?t={token_q}"
    out["qr_url"] = f"/api/video/capture-sessions/{token_q}/qr.png"
    return out


@app.get("/api/video/capture-sessions/{token}/qr.png")
def video_capture_session_qr(token: str):
    from backend.services import video_capture_service
    import io
    import qrcode

    try:
        video_capture_service.get_session(token)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    base = str(getattr(settings, "public_base_url", "") or "https://render3d.app").rstrip("/")
    capture_url = f"{base}/capture.html?t={urllib.parse.quote(token)}"
    img = qrcode.make(capture_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.post("/api/video/capture-sessions/{token}/clips")
async def upload_video_capture_clip(token: str, request: Request):
    from backend.services import video_capture_service

    form = await request.form()
    upload = form.get("video")
    label = str(form.get("label") or "").strip()
    source = str(form.get("source") or "phone").strip() or "phone"
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(400, "Missing video file.")
    raw = await upload.read()
    filename = str(getattr(upload, "filename", None) or "clip.webm")
    mime = str(getattr(upload, "content_type", None) or "video/webm")
    try:
        video_capture_service.get_session(token)
        entry = video_capture_service.add_clip(
            token,
            raw=raw,
            filename=filename,
            mime=mime,
            label=label,
            source=source,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "clip": entry}


@app.get("/api/video/capture-sessions/{token}/clips/{clip_id}")
def download_video_capture_clip(token: str, clip_id: str):
    from backend.services import video_capture_service

    try:
        path, clip = video_capture_service.clip_path(token, clip_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    media = str(clip.get("mime") or "video/webm")
    return FileResponse(
        path,
        media_type=media,
        filename=str(clip.get("original_name") or clip.get("filename") or f"{clip_id}.webm"),
    )


@app.delete("/api/video/capture-sessions/{token}/clips/{clip_id}")
def delete_video_capture_clip(
    token: str,
    clip_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import video_capture_service

    try:
        video_capture_service.delete_clip(token, clip_id, user_id=user["id"])
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"ok": True}


@app.delete("/api/video/capture-sessions/{token}")
def close_video_capture_session(
    token: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import video_capture_service

    try:
        video_capture_service.close_session(token, user_id=user["id"])
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    return {"ok": True}


@app.post("/api/video/assemble")
async def assemble_viewport_video(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Concatenate ordered clip uploads into one webm/mp4 via ffmpeg."""
    import subprocess
    import tempfile

    # Free-trial shared credits cannot use assemble-for-X (multi-clip timeline).
    try:
        credits = ai_credit_service.status(user)
        if credits.get("on_free_trial") or (credits.get("trial") or {}).get("on_free_trial"):
            raise HTTPException(
                403,
                "Assemble prompt isn’t available on free trial credits. "
                "Buy credits or add your own API key to assemble clips for X.",
            )
    except HTTPException:
        raise
    except Exception:
        logger.debug("assemble free-trial check skipped", exc_info=True)

    form = await request.form()
    fmt = str(form.get("format") or "webm").strip().lower()
    if fmt not in {"webm", "mp4"}:
        raise HTTPException(400, "format must be webm or mp4.")
    uploads = form.getlist("clips") if hasattr(form, "getlist") else []
    if not uploads:
        # Fallback: clips, clips[], video
        for key in ("clips", "clips[]", "video"):
            item = form.get(key)
            if item is not None:
                uploads = [item]
                break
    files = [u for u in uploads if u is not None and hasattr(u, "read")]
    if len(files) < 1:
        raise HTTPException(400, "Add at least one clip to assemble.")
    if len(files) > 24:
        raise HTTPException(400, "Too many clips (max 24).")

    with tempfile.TemporaryDirectory(prefix="r3d-asm-") as tmp:
        tmp_path = Path(tmp)
        list_file = tmp_path / "list.txt"
        paths: list[Path] = []
        for i, upload in enumerate(files):
            raw = await upload.read()
            if not raw:
                continue
            if len(raw) > 180 * 1024 * 1024:
                raise HTTPException(400, f"Clip {i + 1} is too large (max 180 MB).")
            name = str(getattr(upload, "filename", None) or f"clip{i}.webm")
            ext = Path(name).suffix.lower() or ".webm"
            if ext not in {".webm", ".mp4", ".mov", ".m4v", ".mkv"}:
                ext = ".webm"
            # Normalize each clip to mp4 first for reliable concat
            src = tmp_path / f"in_{i}{ext}"
            src.write_bytes(raw)
            norm = tmp_path / f"norm_{i}.mp4"
            norm_cmd = [
                "ffmpeg", "-y", "-i", str(src),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-ar", "48000", "-ac", "2",
                "-movflags", "+faststart",
                str(norm),
            ]
            try:
                proc = subprocess.run(norm_cmd, capture_output=True, text=True, timeout=180)
            except FileNotFoundError as exc:
                raise HTTPException(503, "ffmpeg is required to assemble clips.") from exc
            except subprocess.TimeoutExpired as exc:
                raise HTTPException(504, "Clip normalize timed out.") from exc
            if proc.returncode != 0 or not norm.is_file():
                raise HTTPException(400, f"Could not normalize clip {i + 1} for assembly.")
            paths.append(norm)

        if not paths:
            raise HTTPException(400, "No usable clips to assemble.")

        list_file.write_text("".join(f"file '{p.name}'\n" for p in paths), encoding="utf-8")
        out = tmp_path / f"assembled.{fmt}"
        if fmt == "mp4":
            cmd = [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
                "-c", "copy", str(out),
            ]
            media_type = "video/mp4"
            download_name = "render3d-assembled.mp4"
        else:
            cmd = [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
                "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32",
                "-c:a", "libopus",
                str(out),
            ]
            media_type = "video/webm"
            download_name = "render3d-assembled.webm"
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=240, cwd=str(tmp_path))
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, "Assemble timed out.") from exc
        if proc.returncode != 0 or not out.is_file() or out.stat().st_size <= 0:
            # Fallback re-encode concat
            cmd2 = [
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac",
                str(tmp_path / "assembled.mp4"),
            ]
            proc2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=240, cwd=str(tmp_path))
            out2 = tmp_path / "assembled.mp4"
            if proc2.returncode != 0 or not out2.is_file():
                detail = (proc.stderr or proc2.stderr or "")[-400:]
                logger.warning("video assemble failed user_id=%s detail=%s", user.get("id"), detail)
                raise HTTPException(400, "Could not assemble clips.")
            data = out2.read_bytes()
            return Response(
                content=data,
                media_type="video/mp4",
                headers={"Content-Disposition": 'attachment; filename="render3d-assembled.mp4"'},
            )
        return Response(
            content=out.read_bytes(),
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
        )


RENDER_AGENT_SYSTEM_PROMPT = """You are Render Agent, the in-app support assistant for Render Studio.
Answer practical questions about Render Studio tooling, CAD workflows, Fusion 360/Onshape sync, file uploads,
AI model generation, sketches, wiring diagrams, BOMs, project folders, permissions, and troubleshooting.
Be concise and action-oriented. If the user asks for destructive actions, explain the safe workflow first.
You can use attached images and text snippets as context. You cannot directly edit files from this chat.

When Getting Started documentation matches the question:
- Follow those official steps exactly. Do not invent buttons or menus that are not in the guide.
- Mention that a looping demo GIF is attached in chat when one is shown.
- End with a short offer: the user can click Show me for a live Studio walkthrough, or use the attached GIF.
For Wiring + 3D model questions: users drag a component from the project browser into the Wiring prompt
(or onto the wiring canvas) — there is no separate “Attach Geometry” dialog."""


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
    guide_context: str | None = None,
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
    parts = [
        f"User question:\n{message}\n\n"
        f"Render Studio context JSON:\n{json.dumps(context, separators=(',', ':'), default=str)}"
    ]
    if guide_context:
        parts.append(f"\n\n{guide_context}")
    return "".join(parts)


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
    from backend.services import getting_started_guides, render_agent_service

    thread = render_agent_service.get_thread(user["id"], body.thread_id or "") if body.thread_id else None
    if not thread:
        thread = render_agent_service.create_thread(user["id"], body.message[:70])
    # Default: Sam's gpt-4o-mini for Render Agent unless the user opts into their own key.
    if body.use_sam and not body.ai_key_id:
        ai = _sam_ai_service()
    else:
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
    matched_guides = getting_started_guides.match_guides(body.message, limit=2)
    guide_media = getting_started_guides.media_for_guides(matched_guides[:1])
    guide_context = getting_started_guides.guide_context_block(matched_guides)
    user_content = _render_agent_user_content(
        body.message,
        thread=thread,
        project_context=project_context,
        attachments=attachments,
        guide_context=guide_context or None,
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
    assistant_message = {
        "role": "assistant",
        "content": answer,
        "attachments": [],
        "media": guide_media,
        "guides": [
            {
                "id": g.get("id"),
                "title": g.get("title"),
                "summary": g.get("summary"),
                "steps": g.get("steps") or [],
                "gif": g.get("gif"),
                "show_me": g.get("id"),
            }
            for g in matched_guides
        ],
    }
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


def _public_origin(request: Request) -> str:
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc or "").split(",")[0].strip()
    if not host:
        return str(request.base_url).rstrip("/")
    return f"{proto}://{host}".rstrip("/")


@app.post("/api/render-agent/threads/{thread_id}/share")
def share_render_agent_thread(thread_id: str, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import render_agent_service

    try:
        share = render_agent_service.create_share(user["id"], thread_id)
    except PermissionError as exc:
        raise HTTPException(404, str(exc)) from exc
    origin = _public_origin(request)
    share["url"] = f"{origin}{share['url_path']}"
    return share


@app.get("/api/render-agent/share/{share_id}")
def get_shared_render_agent_thread(share_id: str):
    from backend.services import render_agent_service

    payload = render_agent_service.get_shared_thread(share_id)
    if not payload:
        raise HTTPException(404, "Shared chat not found")
    return payload


@app.post("/api/render-agent/suggest-to-developer")
def suggest_to_developer(body: RenderAgentSuggestRequest, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import gs_feedback_service, render_agent_service, sms_notify

    share_url = None
    thread_id = (body.thread_id or "").strip() or None
    if thread_id:
        try:
            share = render_agent_service.create_share(user["id"], thread_id)
            share_url = f"{_public_origin(request)}{share['url_path']}"
        except PermissionError:
            share_url = None
    who = user.get("display_name") or user.get("email") or user.get("id")
    sms_body = (
        f"Render Studio suggest from {who}:\n"
        f"{body.message.strip()[:700]}\n"
        f"Chat: {share_url or '(no chat link)'}"
    )
    sms_result = sms_notify.send_sms(sms_body, to=sms_notify.DEVELOPER_PHONE)
    item = gs_feedback_service.add_developer_suggestion(
        user=user,
        message=body.message,
        thread_id=thread_id,
        share_url=share_url,
        sms_result=sms_result,
    )
    return {
        "ok": True,
        "suggestion": item,
        "sms_sent": bool(sms_result.get("ok")),
        "share_url": share_url,
        "detail": "Thanks — sent to the developer." if sms_result.get("ok") else "Saved for management; SMS queued until Twilio is configured.",
    }


@app.post("/api/getting-started/generate-guide")
def generate_getting_started_guide(
    body: GettingStartedGenerateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Generate GIF instructions for a user question; queue novel guides for management approval."""
    from backend.services import getting_started_guides, gs_feedback_service, render_agent_service

    matched = getting_started_guides.match_guides(body.question, limit=1)
    share_url = None
    thread_id = (body.thread_id or "").strip() or None
    if thread_id:
        try:
            share = render_agent_service.create_share(user["id"], thread_id)
            share_url = f"{_public_origin(request)}{share['url_path']}"
        except PermissionError:
            share_url = None

    if matched:
        guide = matched[0]
        return {
            "ok": True,
            "matched_existing": True,
            "guide": guide,
            "media": getting_started_guides.media_for_guides([guide]),
            "pending": None,
            "share_url": share_url,
        }

    ai = _sam_ai_service()
    prompt = (
        "Create a short Getting Started guide for Render Studio CAD software.\n"
        "Return JSON only with keys: title, summary, steps (array of 3-6 short steps), "
        "keywords (array of short strings), ask (one follow-up question).\n"
        f"User question: {body.question.strip()}"
    )
    try:
        raw, _trace = ai._call_model(
            "You write concise onboarding docs for Render Studio. Output valid JSON only.",
            prompt,
            max_tokens=900,
            json_response=True,
        )
    except Exception as exc:
        raise HTTPException(502, f"Could not generate guide: {exc}") from exc
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"title": body.question[:80], "summary": raw[:300], "steps": [raw[:200]], "keywords": [], "ask": body.question}
    else:
        parsed = raw if isinstance(raw, dict) else {}
    # Attach closest GIF from catalog by keyword overlap with all guides.
    fallback = getting_started_guides.GETTING_STARTED_GUIDES[0]
    closest = getting_started_guides.match_guides(
        " ".join([parsed.get("title") or "", parsed.get("summary") or "", " ".join(parsed.get("keywords") or [])]),
        limit=1,
    )
    gif_src = (closest[0] if closest else fallback).get("gif")
    guide = {
        "id": f"user-{(parsed.get('title') or 'guide')[:24]}",
        "title": str(parsed.get("title") or body.question)[:120],
        "summary": str(parsed.get("summary") or "")[:500],
        "steps": [str(s)[:240] for s in (parsed.get("steps") or [])][:8] or [
            "Open Studio and try the related tool.",
            "Ask Render Agent if a step is unclear.",
        ],
        "gif": gif_src,
        "ask": str(parsed.get("ask") or body.question)[:500],
        "keywords": [str(k)[:40] for k in (parsed.get("keywords") or [])][:20],
        "demo": "generate",
    }
    pending = gs_feedback_service.add_pending_guide(
        user=user,
        question=body.question,
        guide=guide,
        matched_existing=False,
        thread_id=thread_id,
        share_url=share_url,
    )
    return {
        "ok": True,
        "matched_existing": False,
        "guide": guide,
        "media": [{"url": guide["gif"], "title": guide["title"], "summary": guide["summary"]}],
        "pending": pending,
        "share_url": share_url,
        "detail": "Queued for management approval to add to Getting Started.",
    }


@app.get("/api/admin/getting-started/pending")
def admin_list_pending_guides(
    user: dict[str, Any] = Depends(get_current_user),
    status: str = Query("pending"),
    limit: int = Query(80, ge=1, le=200),
):
    _require_a1projects_admin(user)
    from backend.services import gs_feedback_service

    return {
        "pending_guides": gs_feedback_service.list_pending_guides(status=status if status != "all" else None, limit=limit),
        "developer_suggestions": gs_feedback_service.list_developer_suggestions(limit=limit),
    }


@app.post("/api/admin/getting-started/pending/{item_id}")
def admin_review_pending_guide(
    item_id: str,
    body: AdminGuideReviewRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_a1projects_admin(user)
    from backend.services import gs_feedback_service

    status = (body.status or "").strip().lower()
    if status not in {"approved", "rejected", "pending"}:
        raise HTTPException(400, "status must be approved, rejected, or pending")
    item = gs_feedback_service.set_pending_guide_status(item_id, status, note=body.note)
    if not item:
        raise HTTPException(404, "Pending guide not found")
    return {"ok": True, "item": item}



@app.get("/api/admin/discord/status")
def admin_discord_status(user: dict[str, Any] = Depends(get_current_user)):
    """Check Discord updates bot connectivity."""
    _require_a1projects_admin(user)
    from backend.services import discord_updates_service as discord

    return discord.connection_status()


class DiscordAnnounceRequest(BaseModel):
    id: str | None = None
    title: str
    summary: str = ""
    kind: str = "feature"
    href: str = "/updates.html"
    visual: str = ""
    force: bool = False
    text: str | None = None


@app.post("/api/admin/discord/announce")
def admin_discord_announce(
    body: DiscordAnnounceRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Push a product update (or plain text) to the Discord updates channel."""
    _require_a1projects_admin(user)
    from backend.services import discord_updates_service as discord

    if not discord.configured():
        raise HTTPException(503, "Discord bot is not configured")
    try:
        if body.text:
            return discord.announce_text(body.text)
        return discord.announce_update(
            {
                "id": body.id or "",
                "title": body.title,
                "summary": body.summary or body.title,
                "kind": body.kind,
                "href": body.href,
                "visual": body.visual,
            },
            force=bool(body.force),
        )
    except Exception as err:
        st = discord.connection_status()
        raise HTTPException(
            502,
            detail={
                "message": str(err),
                "invite_url": st.get("invite_url"),
                "guild_count": st.get("guild_count"),
            },
        )


def _feedback_context_snapshot(
    *,
    user: dict[str, Any],
    project_id: str | None,
    prompt_id: str | None,
    trace_id: str | None,
    context_json: str | None,
) -> dict[str, Any]:
    context: dict[str, Any] = {}
    if context_json:
        try:
            parsed = json.loads(context_json)
            if isinstance(parsed, dict):
                context.update(parsed)
        except json.JSONDecodeError:
            context["context_parse_error"] = "Could not parse client context JSON."
    if project_id:
        try:
            project_path = _require_project_read(user, project_id)
            meta = project_store.load_meta(project_path)
            context["project"] = {
                "id": project_id,
                "name": meta.get("name") or project_id,
                "updated_at": meta.get("updated_at"),
                "latest_file": meta.get("latest_file"),
            }
            if prompt_id:
                entry = prompt_history_service.get_entry(project_path, prompt_id)
                if entry:
                    context["prompt_history"] = {
                        key: entry.get(key)
                        for key in (
                            "id",
                            "prompt",
                            "success",
                            "message",
                            "error",
                            "filename",
                            "base_filename",
                            "trace_id",
                            "created_at",
                            "model",
                            "provider",
                            "target_mode",
                            "prompt_mode",
                            "skills",
                        )
                        if entry.get(key) is not None
                    }
                    trace_id = trace_id or entry.get("trace_id")
            gen = generation_service.load(project_path) or {}
            matching_jobs = []
            for job in gen.get("jobs") or []:
                if trace_id and str(job.get("trace_id") or job.get("id") or "") != str(trace_id):
                    continue
                matching_jobs.append({
                    key: job.get(key)
                    for key in (
                        "id",
                        "status",
                        "kind",
                        "trace_id",
                        "prompt_id",
                        "prompt",
                        "filename",
                        "error",
                        "mode",
                        "target_mode",
                        "started_at",
                        "updated_at",
                        "finished_at",
                    )
                    if job.get(key) is not None
                })
            if matching_jobs:
                context["generation_jobs"] = matching_jobs[:5]
        except Exception as exc:
            context["project_context_error"] = str(exc)[:500]
    if trace_id:
        context["trace_id"] = trace_id
        context["trace_log"] = [entry for entry in list_entries(120) if entry.get("trace_id") == trace_id][:40]
    return context


@app.post("/api/feedback/requests")
async def submit_feedback_request(
    kind: str = Form(...),
    message: str = Form(...),
    project_id: str | None = Form(None),
    project_name: str | None = Form(None),
    prompt_id: str | None = Form(None),
    prompt_label: str | None = Form(None),
    trace_id: str | None = Form(None),
    page_url: str | None = Form(None),
    context_json: str | None = Form(None),
    screenshots: list[UploadFile] | None = File(None),
    user: dict[str, Any] = Depends(get_current_user),
):
    kind_norm = (kind or "").strip().lower()
    if kind_norm not in {"bug", "suggestion"}:
        raise HTTPException(400, "kind must be bug or suggestion")
    if not (message or "").strip():
        raise HTTPException(400, "Message is required")
    request_id = str(uuid.uuid4())[:10]
    saved_screenshots = []
    for index, upload in enumerate((screenshots or [])[: feedback_service.MAX_SCREENSHOTS], start=1):
        saved = feedback_service.save_screenshot(upload, request_id=request_id, index=index)
        if saved:
            saved_screenshots.append(saved)
    context = _feedback_context_snapshot(
        user=user,
        project_id=project_id,
        prompt_id=prompt_id,
        trace_id=trace_id,
        context_json=context_json,
    )
    item = feedback_service.add_request(
        kind=kind_norm,
        message=message,
        user=user,
        project_id=project_id,
        project_name=project_name,
        prompt_id=prompt_id,
        prompt_label=prompt_label,
        trace_id=trace_id or context.get("trace_id"),
        page_url=page_url,
        context=context,
        screenshots=saved_screenshots,
    )
    # Preserve the pre-generated id used for screenshot names.
    if item["id"] != request_id:
        item["screenshot_request_id"] = request_id
    trace_add(
        "info",
        f"User submitted {kind_norm}: {message[:120]}",
        trace_id=trace_id,
        data={"feedback_id": item["id"], "project_id": project_id, "prompt_id": prompt_id},
    )
    _notify_management_update("feedback.created", {"request": item})
    return {"ok": True, "request": item}


@app.get("/api/feedback/screenshots/{stored_name}")
def feedback_screenshot(stored_name: str, user: dict[str, Any] = Depends(get_current_user)):
    del user
    path = feedback_service.screenshot_path(stored_name)
    if not path:
        raise HTTPException(404, "Screenshot not found")
    return FileResponse(path)


@app.get("/api/admin/feedback/summary")
def admin_feedback_summary(user: dict[str, Any] = Depends(get_current_user)):
    _require_a1projects_admin(user)
    return feedback_service.summary()


@app.get("/api/admin/management/summary")
def admin_management_summary(user: dict[str, Any] = Depends(get_current_user)):
    _require_a1projects_admin(user)
    feedback = feedback_service.summary()
    new_users = new_user_alert_service.summary()
    unread_count = int(feedback.get("unread_count") or 0) + int(new_users.get("unread_count") or 0)
    return {
        "unread_count": unread_count,
        "feedback": feedback,
        "new_users": new_users,
    }


@app.get("/api/admin/changelog")
def admin_changelog(user: dict[str, Any] = Depends(get_current_user)):
    """Latest customer CHANGELOG.md from the repo (Management → Changelog tab)."""
    _require_a1projects_admin(user)
    path = ROOT / "CHANGELOG.md"
    if not path.is_file():
        raise HTTPException(404, "CHANGELOG.md not found")
    try:
        markdown = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(500, f"Could not read CHANGELOG.md: {exc}") from exc
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    return {
        "markdown": markdown,
        "path": "CHANGELOG.md",
        "bytes": len(markdown.encode("utf-8")),
        "mtime": mtime,
    }


@app.get("/api/admin/new-users")
def admin_new_user_alerts(
    user: dict[str, Any] = Depends(get_current_user),
    status: str = Query("all"),
    limit: int = Query(120, ge=1, le=300),
    mark_read: bool = Query(False),
):
    _require_a1projects_admin(user)
    items = new_user_alert_service.list_alerts(status=status, limit=limit)
    if mark_read:
        if new_user_alert_service.mark_read():
            _notify_management_update("new_user.read")
    return {"alerts": items, "summary": new_user_alert_service.summary()}


@app.post("/api/admin/new-users/{item_id}")
def admin_review_new_user_alert(
    item_id: str,
    body: AdminNewUserReviewRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_a1projects_admin(user)
    try:
        item = new_user_alert_service.set_status(item_id, body.status, reviewer=user, note=body.note)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not item:
        raise HTTPException(404, "New user alert not found")
    _notify_management_update("new_user.reviewed", {"alert": item})
    return {"ok": True, "item": item, "summary": new_user_alert_service.summary()}


@app.get("/api/admin/onboarding-email/template")
def admin_onboarding_email_template(user: dict[str, Any] = Depends(get_current_user)):
    _require_a1projects_admin(user)
    sample = {
        "display_name": "New Render Studio user",
        "email": "new-user@example.com",
    }
    return {"template": onboarding_email_service.render_welcome_email(sample)}


@app.get("/api/admin/feedback/requests")
def admin_feedback_requests(
    user: dict[str, Any] = Depends(get_current_user),
    status: str = Query("all"),
    kind: str = Query("all"),
    limit: int = Query(120, ge=1, le=300),
    mark_read: bool = Query(False),
):
    _require_a1projects_admin(user)
    items = feedback_service.list_requests(status=status, kind=kind, limit=limit)
    if mark_read:
        if feedback_service.mark_read():
            _notify_management_update("feedback.read")
    return {"requests": items, "summary": feedback_service.summary()}


@app.post("/api/admin/feedback/requests/{item_id}")
def admin_review_feedback_request(
    item_id: str,
    body: AdminFeedbackReviewRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_a1projects_admin(user)
    try:
        item = feedback_service.set_status(item_id, body.status, reviewer=user, note=body.note)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not item:
        raise HTTPException(404, "Feedback request not found")
    _notify_management_update("feedback.reviewed", {"request": item})
    return {"ok": True, "item": item, "summary": feedback_service.summary()}


@app.post("/api/admin/feedback/requests/{item_id}/message")
def admin_message_feedback_user(
    item_id: str,
    body: AdminFeedbackMessageRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_a1projects_admin(user)
    from backend.services import project_chat_service

    item = feedback_service.get_request(item_id)
    if not item:
        raise HTTPException(404, "Feedback request not found")
    target_user_id = str(item.get("user_id") or "").strip()
    text = (body.message or "").strip()
    if not target_user_id:
        raise HTTPException(400, "This feedback request is not tied to a user account.")
    target_user = get_user_by_id(target_user_id) or {}
    project_id = str(item.get("project_id") or "").strip()
    chat_message = None
    thread = None
    if project_id:
        try:
            project_path = _require_project_read(user, project_id)
            public_scope = _public_chat_scope_id(project_id)
            thread = project_chat_service.get_thread(
                project_path,
                "general",
                user=user,
                workspace_role="admin",
                workspace_id=public_scope,
            )
            if not thread:
                raise ValueError("Could not open project chat.")
            mention_name = (
                target_user.get("handle")
                or target_user.get("display_name")
                or target_user.get("email")
                or item.get("user_name")
                or "there"
            )
            body_text = (
                f"@[{mention_name}](user:{target_user_id}) "
                f"{text}\n\n"
                f"_Reply here and the Render Studio team will see it. Feedback #{item_id}._"
            )
            members = _project_chat_members(project_id)
            if not any(str(m.get("id")) == target_user_id for m in members):
                members.append(
                    {
                        "id": target_user_id,
                        "email": target_user.get("email") or item.get("user_email"),
                        "display_name": target_user.get("display_name") or item.get("user_name"),
                        "avatar_url": _avatar_url_for_user_id(target_user_id),
                        "handle": target_user.get("handle"),
                    }
                )
            candidates = project_chat_service.mention_candidates(members)
            chat_message = project_chat_service.post_message(
                project_path,
                thread_id=thread["id"],
                body=body_text,
                user=user,
                mention_candidates_list=candidates,
                workspace_role="admin",
                workspace_id=public_scope,
            )
            _notify_chat_message(project_id, thread, chat_message, user)
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Could not send feedback admin chat message item_id=%s project_id=%s", item_id, project_id, exc_info=True)
            raise HTTPException(400, f"Could not send project chat message: {exc}") from exc

    updated = feedback_service.add_admin_message(
        item_id,
        message=text,
        reviewer=user,
        channel="project_chat" if chat_message else "user_notification",
        project_id=project_id or None,
        thread_id=thread.get("id") if thread else None,
        message_id=chat_message.get("id") if chat_message else None,
    )
    notify_payload = {
        "type": "management.feedback.message",
        "feedback_id": item_id,
        "project_id": project_id or None,
        "thread_id": thread.get("id") if thread else None,
        "message": _decorate_chat_message(project_id, chat_message) if chat_message and project_id else None,
        "admin_name": user.get("display_name") or user.get("email"),
        "text": text,
    }
    _notify_user(target_user_id, notify_payload)
    _notify_management_update("feedback.message.sent", {"request": updated or item})
    return {
        "ok": True,
        "request": updated or item,
        "chat": {
            "project_id": project_id or None,
            "thread_id": thread.get("id") if thread else None,
            "message": _decorate_chat_message(project_id, chat_message) if chat_message and project_id else None,
        },
        "summary": feedback_service.summary(),
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


class UserProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=80)
    handle: str | None = Field(default=None, max_length=24)
    bio: str | None = Field(default=None, max_length=500)
    status_text: str | None = Field(default=None, max_length=80)
    status_icon: str | None = Field(default=None, max_length=8)


class MeetingRequestBody(BaseModel):
    message: str = Field(default="", max_length=1000)
    proposed_time: str = Field(default="", max_length=120)
    channel: str = Field(default="chat", max_length=20)
    project_id: str | None = Field(default=None, max_length=120)
    starts_at: str | None = Field(default=None, max_length=64)
    ends_at: str | None = Field(default=None, max_length=64)
    timezone: str | None = Field(default="UTC", max_length=64)
    send_email: bool = True


class EmailPreferencesRequest(BaseModel):
    chat_alerts: bool | None = None
    purchase_alerts: bool | None = None
    calendar_meetings: bool | None = None
    credit_refills: bool | None = None
    workspace_invites: bool | None = None


class AvailabilityWindowBody(BaseModel):
    windows: list[dict[str, Any]] = Field(default_factory=list)


class StatusUpdateBody(BaseModel):
    status_text: str | None = Field(default=None, max_length=80)
    status_icon: str | None = Field(default=None, max_length=8)


@app.get("/api/users/me/handle-availability")
def my_handle_availability(handle: str = Query(..., min_length=1, max_length=24), user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import profile_service

    try:
        result = profile_service.handle_availability(handle, exclude_user_id=user["id"])
    except ValueError as exc:
        return {
            "handle": handle.strip().lstrip("@"),
            "available": False,
            "valid": False,
            "message": str(exc),
        }
    return {
        **result,
        "valid": True,
        "message": "This handle is available." if result.get("available") else "That handle is already taken.",
    }


@app.patch("/api/users/me")
def update_my_profile(body: UserProfileUpdateRequest, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import profile_service

    try:
        updated = profile_service.update_profile(
            user["id"],
            display_name=body.display_name,
            handle=body.handle,
            bio=body.bio,
            status_text=body.status_text,
            status_icon=body.status_icon,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"user": updated}


@app.get("/api/users/me/email-preferences")
def get_my_email_preferences(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import email_notification_service

    return {"preferences": email_notification_service.get_preferences(user["id"])}


class XrCaptureReadyBody(BaseModel):
    kind: str = Field("video", max_length=32)
    filename: str = Field(..., min_length=1, max_length=255)
    url: str | None = Field(None, max_length=1024)
    mode_label: str | None = Field(None, max_length=64)
    source_client_id: str | None = Field(None, max_length=128)


@app.post("/api/projects/{project_id}/xr-capture-ready")
def publish_xr_capture_ready(
    project_id: str,
    body: XrCaptureReadyBody,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Quest posts here after saving a clip — all logged-in sessions get Share-to-X."""
    from backend.services import xr_capture_inbox

    _require_project(user, project_id)
    filename = Path(body.filename).name
    url = (body.url or "").strip() or f"/api/projects/{project_id}/files/{filename}"
    entry = xr_capture_inbox.push_capture(
        user["id"],
        project_id=project_id,
        kind=body.kind,
        filename=filename,
        url=url,
        mode_label=body.mode_label,
        source_client_id=body.source_client_id,
    )
    _notify_user(user["id"], entry)
    return {"ok": True, "capture": entry}


@app.get("/api/me/xr-captures/pending")
def list_xr_captures_pending(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import xr_capture_inbox

    return {"captures": xr_capture_inbox.list_pending(user["id"])}


@app.post("/api/me/xr-captures/{capture_id}/ack")
def ack_xr_capture(capture_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import xr_capture_inbox

    return {"ok": xr_capture_inbox.ack_capture(user["id"], capture_id)}


@app.put("/api/users/me/email-preferences")
@app.patch("/api/users/me/email-preferences")
def update_my_email_preferences(body: EmailPreferencesRequest, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import email_notification_service

    return {"preferences": email_notification_service.update_preferences(user["id"], body.model_dump(exclude_none=True))}


@app.get("/api/users/me/store-settings")
def get_my_store_settings(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import profile_service

    row = profile_service.get_user_row(user["id"]) or {}
    return {"store_settings": row.get("store_settings") or {}, "user": row}


@app.put("/api/users/me/store-settings")
@app.patch("/api/users/me/store-settings")
def update_my_store_settings(body: StoreSettingsRequest, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import profile_service

    updated = profile_service.update_store_settings(user["id"], body.model_dump())
    return {"user": updated, "store_settings": updated.get("store_settings") or {}}


@app.get("/api/users/me/profile")
def get_my_public_profile(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import profile_service

    return {"profile": profile_service.public_profile(user["id"], viewer=user)}


@app.get("/api/users/{user_id}/profile")
def get_user_public_profile(
    user_id: str,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    from backend.services import profile_service

    try:
        return {"profile": profile_service.public_profile(user_id, viewer=user)}
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/handles/{handle}/profile")
def get_handle_public_profile(
    handle: str,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    from backend.services import profile_service

    try:
        return {"profile": profile_service.public_profile(handle=handle, viewer=user)}
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/users/{user_id}/meeting-request")
def request_meeting_with_user(
    user_id: str,
    body: MeetingRequestBody,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import email_notification_service, profile_service, project_chat_service
    target_email_allowed = True
    if body.send_email:
        with get_conn() as conn:
            target_row = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        target_email_allowed = email_notification_service.user_allows_email(
            target_row["id"] if target_row else user_id,
            "calendar_meetings",
        )

    try:
        result = profile_service.create_meeting_request(
            from_user=user,
            to_user_id=user_id,
            message=body.message,
            proposed_time=body.proposed_time,
            channel=body.channel,
            starts_at=body.starts_at or "",
            ends_at=body.ends_at or "",
            timezone_name=body.timezone or "UTC",
            send_email=bool(body.send_email) and target_email_allowed,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc

    chat_posted = None
    if body.channel in {"chat", "both"} and body.project_id:
        try:
            path = _require_project_read(user, body.project_id)
            members = _project_chat_members(body.project_id)
            public_scope = _public_chat_scope_id(body.project_id)
            threads = project_chat_service.list_threads(path, user, workspace_id=public_scope)
            studio = next(
                (
                    t
                    for t in threads
                    if t.get("slug") == "general"
                    or str(t.get("title") or "").lower() in {"render studio", "general"}
                ),
                None,
            )
            if studio:
                candidates = project_chat_service.mention_candidates(members or [user, result["to_user"]])
                chat_posted = project_chat_service.post_message(
                    path,
                    thread_id=studio["id"],
                    body=result["chat_body"],
                    user=user,
                    mention_candidates_list=candidates,
                    workspace_id=public_scope,
                )
                try:
                    _notify_chat_message(body.project_id, studio, chat_posted, user)
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("meeting request chat post failed: %s", exc)

    return {"request": result, "chat_message": chat_posted}


@app.get("/api/meeting-requests/{req_id}/ics")
def download_meeting_ics(req_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import profile_service
    from fastapi.responses import Response

    try:
        row = profile_service.get_meeting_request(req_id)
        if not row:
            raise KeyError("Meeting not found")
        if user["id"] not in {row.get("from_user_id"), row.get("to_user_id")}:
            raise HTTPException(403, "Not allowed")
        ics, filename = profile_service.meeting_ics_payload(req_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/users/me/presence")
def heartbeat_presence(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    return social_service.touch_presence(user["id"])


@app.get("/api/users/me/status")
def get_my_status(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    return social_service.get_status(user["id"])


@app.put("/api/users/me/status")
@app.patch("/api/users/me/status")
def update_my_status(body: StatusUpdateBody, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    return social_service.set_status(user["id"], text=body.status_text, icon=body.status_icon)


@app.get("/api/users/me/availability")
def get_my_availability(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    return social_service.get_availability(user["id"])


@app.put("/api/users/me/availability")
def put_my_availability(body: AvailabilityWindowBody, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    try:
        return social_service.set_availability(user["id"], body.windows)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/users/{user_id}/availability")
def get_user_availability(user_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    data = social_service.get_availability(user_id)
    data["suggested_slots"] = social_service.suggested_slots(user_id)
    return data


@app.get("/api/stories")
def list_stories(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    return {"stories": social_service.list_active_stories()}


@app.post("/api/stories")
async def post_story(
    caption: str = Form(""),
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import social_service

    raw = await file.read()
    try:
        story = social_service.create_story(
            user_id=user["id"],
            media_bytes=raw,
            content_type=file.content_type or "",
            caption=caption,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"story": story}


@app.get("/api/stories/media/{user_id}/{filename}")
def get_story_media(user_id: str, filename: str):
    from backend.services import social_service
    from fastapi.responses import FileResponse

    try:
        path = social_service.story_media_path(user_id, filename)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return FileResponse(path)


@app.get("/api/projects/{project_id}/chat/members")
def project_chat_members_enriched(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    _require_project_read(user, project_id)
    members = _project_chat_members(project_id) or []
    # Ensure current user is included
    if not any(m.get("id") == user["id"] for m in members):
        members = [user, *members]
    enriched = social_service.enrich_members(members)
    online_count = sum(1 for m in enriched if m.get("online"))
    return {"members": enriched, "online_count": online_count, "member_count": len(enriched)}


@app.get("/api/users/me/calendar-connections")
def my_calendar_connections(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    return {"connections": social_service.list_calendar_connections(user["id"])}


@app.get("/api/users/me/calendar/connect/{provider}")
def calendar_connect_start(provider: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service
    import secrets

    try:
        url = social_service.calendar_oauth_start_url(provider, user_id=user["id"], state=secrets.token_urlsafe(12))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"url": url, "provider": provider}


@app.delete("/api/users/me/calendar-connections/{provider}")
def calendar_disconnect(provider: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import social_service

    social_service.disconnect_calendar(user["id"], provider)
    return {"ok": True}


@app.get("/oauth/calendar/callback")
async def calendar_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Exchange calendar OAuth code and store connection tokens."""
    from backend.services import social_service
    import httpx

    if error:
        return RedirectResponse(f"/?calendar_error={urllib.parse.quote(error)}", status_code=302)
    if not code or not state or not state.startswith("calendar:"):
        raise HTTPException(400, "Invalid calendar OAuth callback")
    parts = state.split(":")
    if len(parts) < 4:
        raise HTTPException(400, "Invalid calendar OAuth state")
    _, provider, user_id, _nonce = parts[0], parts[1], parts[2], parts[3]
    redirect_uri = "https://render3d.app/oauth/calendar/callback"
    try:
        if provider == "google":
            async with httpx.AsyncClient(timeout=30) as client:
                token_res = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": code,
                        "client_id": settings.google_client_id,
                        "client_secret": settings.google_client_secret,
                        "redirect_uri": redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
                token_res.raise_for_status()
                token = token_res.json()
                info = await client.get(
                    "https://openidconnect.googleapis.com/v1/userinfo",
                    headers={"Authorization": f"Bearer {token.get('access_token')}"},
                )
                info.raise_for_status()
                email = (info.json() or {}).get("email")
            expires_at = None
            if token.get("expires_in"):
                expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(token["expires_in"]))).isoformat()
            social_service.upsert_calendar_connection(
                user_id,
                provider="google",
                access_token=token.get("access_token") or "",
                refresh_token=token.get("refresh_token"),
                scopes=token.get("scope") or "",
                expires_at=expires_at,
                email=email,
            )
        elif provider == "microsoft":
            async with httpx.AsyncClient(timeout=30) as client:
                token_res = await client.post(
                    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                    data={
                        "code": code,
                        "client_id": settings.microsoft_client_id,
                        "client_secret": settings.microsoft_client_secret,
                        "redirect_uri": redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
                token_res.raise_for_status()
                token = token_res.json()
                info = await client.get(
                    "https://graph.microsoft.com/v1.0/me",
                    headers={"Authorization": f"Bearer {token.get('access_token')}"},
                )
                info.raise_for_status()
                me = info.json() or {}
                email = me.get("mail") or me.get("userPrincipalName")
            expires_at = None
            if token.get("expires_in"):
                expires_at = (datetime.now(timezone.utc) + timedelta(seconds=int(token["expires_in"]))).isoformat()
            social_service.upsert_calendar_connection(
                user_id,
                provider="microsoft",
                access_token=token.get("access_token") or "",
                refresh_token=token.get("refresh_token"),
                scopes=token.get("scope") or "",
                expires_at=expires_at,
                email=email,
            )
        else:
            raise HTTPException(400, "Unsupported provider")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("calendar oauth failed")
        return RedirectResponse(f"/?calendar_error={quote(str(exc)[:120])}", status_code=302)
    return RedirectResponse("/?calendar_connected=1", status_code=302)


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


@app.post("/api/onshape/oauth-url")
def onshape_oauth_url(user: dict[str, Any] = Depends(get_current_user)):
    """Create an Onshape OAuth URL for the currently signed-in user (connect flow)."""
    try:
        from backend.services.onshape_oauth import build_authorization_url

        return {"url": build_authorization_url(user_id=user["id"])}
    except Exception as exc:
        logger.warning("onshape oauth-url failed user_id=%s error=%s", user.get("id"), exc)
        raise HTTPException(400, str(exc)) from exc


@app.get("/oauth/callback")
def onshape_oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    """Onshape redirects here after the user authorizes.
    Exchange the code for tokens, upsert the local user, issue our JWT,
    then redirect to the frontend with the token in the query string.
    """
    import logging
    import urllib.parse

    from backend.services.onshape_oauth import consume_oauth_state, exchange_code_for_tokens, upsert_user_tokens
    from backend.auth import create_access_token

    log = logging.getLogger("render3d.onshape")

    if error:
        log.warning("onshape oauth callback error=%s", error)
        return RedirectResponse(f"/?onshape_error={urllib.parse.quote(str(error)[:160])}", status_code=302)

    if not code or not state:
        log.warning("onshape oauth callback missing code/state")
        return RedirectResponse("/?onshape_error=missing_params", status_code=302)

    # CSRF check — False means invalid/expired; None means login-with-Onshape (no prior user).
    stored_user_id = consume_oauth_state(state)
    if stored_user_id is False:
        log.warning("onshape oauth callback invalid_state")
        return RedirectResponse("/?onshape_error=invalid_state", status_code=302)

    try:
        token_data = exchange_code_for_tokens(code)
        result = upsert_user_tokens(token_data, link_user_id=stored_user_id)
        jwt = create_access_token(result["user_id"])
        log.info(
            "onshape oauth linked user_id=%s link_user_id=%s email=%s",
            result.get("user_id"),
            stored_user_id,
            result.get("email"),
        )
    except Exception as exc:
        log.exception("onshape oauth token exchange failed")
        return RedirectResponse(
            f"/?onshape_error={urllib.parse.quote(str(exc)[:160])}",
            status_code=302,
        )

    # Connect-after-login: keep the existing Render Studio session; only signal success.
    if stored_user_id:
        return RedirectResponse("/?onshape_linked=1", status_code=302)

    # Login-with-Onshape: issue a Render Studio session for the Onshape-backed user.
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
    """All Fusion folder mirrors linked by this Render Studio user across every project."""
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
        hubs = _cached_autodesk_listing(("hubs", user["id"]), lambda: list_hubs(token), ttl=120.0)
        return {"hubs": hubs}
    except Exception as exc:
        raise HTTPException(502, f"Autodesk library error: {exc}") from exc


@app.get("/api/autodesk/hubs/{hub_id}/projects")
def autodesk_projects(hub_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services.autodesk_oauth import get_valid_access_token, list_projects
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    try:
        projects = _cached_autodesk_listing(("projects", user["id"], hub_id), lambda: list_projects(token, hub_id), ttl=120.0)
        return {"projects": projects}
    except Exception as exc:
        raise HTTPException(502, f"Autodesk projects error: {exc}") from exc


@app.get("/api/autodesk/hubs/{hub_id}/projects/{aps_project_id}/top-folders")
def autodesk_top_folders(hub_id: str, aps_project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services.autodesk_oauth import get_valid_access_token, list_top_folders
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    try:
        folders = _cached_autodesk_listing(
            ("top-folders", user["id"], hub_id, aps_project_id),
            lambda: list_top_folders(token, hub_id, aps_project_id),
            ttl=120.0,
        )
        return {"folders": folders}
    except Exception as exc:
        raise HTTPException(502, f"Autodesk folders error: {exc}") from exc


@app.get("/api/autodesk/projects/{aps_project_id}/folders/{folder_id}/contents")
def autodesk_folder_contents(aps_project_id: str, folder_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services.autodesk_oauth import get_valid_access_token, list_folder_contents
    token = get_valid_access_token(user["id"])
    if not token:
        raise HTTPException(401, "Autodesk account not linked.")
    try:
        return _cached_autodesk_listing(
            ("contents", user["id"], aps_project_id, folder_id),
            lambda: list_folder_contents(token, aps_project_id, folder_id),
            ttl=120.0,
        )
    except Exception as exc:
        raise HTTPException(502, f"Autodesk folder contents error: {exc}") from exc


def _cached_autodesk_listing(key: tuple[Any, ...], loader: Any, ttl: float) -> Any:
    """Cache Autodesk listing responses without holding the lock during HTTP."""
    now = time.monotonic()
    with _autodesk_listing_cache_lock:
        cached = _autodesk_listing_cache.get(key)
        if cached and cached[0] > now:
            return cached[1]

    # Load outside the lock so concurrent folder/hub requests are not serialized
    # behind a single Autodesk round-trip (that left the Fusion panel stuck on
    # "Loading Fusion folders..." while another contents fetch held the lock).
    value = loader()
    now = time.monotonic()
    with _autodesk_listing_cache_lock:
        cached = _autodesk_listing_cache.get(key)
        if cached and cached[0] > now:
            return cached[1]
        _autodesk_listing_cache[key] = (now + ttl, value)
        if len(_autodesk_listing_cache) > _AUTODESK_LISTING_CACHE_MAX:
            for drop_key in list(_autodesk_listing_cache.keys())[: len(_autodesk_listing_cache) // 2]:
                _autodesk_listing_cache.pop(drop_key, None)
    return value


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

    # For native Fusion → STEP imports, also write a visible STEP immediately so a
    # killed/restarted tessellation cannot leave the project with only a hidden
    # `.autodesk_source_*` sidecar (UI filters those out → blank viewport).
    visible_step_path: Path | None = None
    if converted_from_native and suffix in cad_service.STEP_SUFFIXES:
        visible_step_path = proj_path / f"{safe_stem}{suffix}"
        if into_existing and visible_step_path.exists():
            n = 2
            while True:
                candidate = proj_path / f"{safe_stem}_{n}{suffix}"
                if not candidate.exists():
                    visible_step_path = candidate
                    break
                n += 1
        if visible_step_path.resolve() != src_path.resolve():
            visible_step_path.write_bytes(data)

    viewer_path = visible_step_path or src_path
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
            # Default on: Fusion assemblies should land as separate browser parts.
            # Accept truthy JSON values so cached clients that omit the flag still split.
            import_bodies = body.get("import_bodies", True)
            if import_bodies is not False and str(import_bodies).strip().lower() not in {"0", "false", "no", "off"}:
                try:
                    split_names = cad_service.split_scene_components_to_glbs(
                        viewer_path,
                        proj_path,
                        base_stem=viewer_path.stem,
                        step_path=src_path if suffix in cad_service.STEP_SUFFIXES else None,
                    )
                    if split_names:
                        logger.info(
                            "Autodesk import split %s into %d body GLBs",
                            viewer_path.name,
                            len(split_names),
                        )
                except Exception as split_exc:
                    logger.warning(
                        "Autodesk import body split failed for %s: %s",
                        viewer_path.name,
                        split_exc,
                    )
    except Exception as exc:
        # Keep any visible STEP we already wrote so the project is not blank.
        if visible_step_path and visible_step_path.is_file():
            logger.warning(
                "Autodesk import preview convert failed for %s; visible STEP kept at %s: %s",
                src_path.name,
                visible_step_path.name,
                exc,
            )
            viewer_path = visible_step_path
        else:
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
    """Download an Autodesk item through Render Studio so authenticated users can save it locally."""
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
        from backend.services.autodesk_oauth import get_valid_access_token, list_folder_contents

        token = get_valid_access_token(str(mirror["user_id"]))
        if not token:
            mirror["contents"]["error"] = "Autodesk account not linked."
            mirror["contents"]["needs_relink"] = True
            return mirror
        aps_project_id = str(mirror["aps_project_id"])
        folder_id = str(mirror["folder_id"])
        contents = _cached_autodesk_listing(
            ("mirror-contents", mirror["user_id"], aps_project_id, folder_id),
            lambda: list_folder_contents(token, aps_project_id, folder_id),
            ttl=12.0,
        )
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
    allow_faceted_fallback: bool = False,
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
        if allow_faceted_fallback:
            try:
                step_path = _step_for_cloud_cad(project_path, safe, allow_faceted=True)
            except Exception as faceted_exc:
                logger.info(
                    "Fusion mirror skipped for project=%s file=%s: %s",
                    project_id,
                    safe,
                    getattr(faceted_exc, "detail", faceted_exc),
                )
                return {
                    "pushed_mirrors": pushed_mirrors,
                    "push_errors": push_errors,
                    "skipped": str(getattr(faceted_exc, "detail", faceted_exc)),
                }
        else:
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
    if pushed_mirrors:
        _notify_fusion_mirrors_updated(
            project_id,
            filename=pushed_mirrors[0].get("filename") or safe,
            files=[m.get("filename") or safe for m in pushed_mirrors],
            pushed_mirrors=pushed_mirrors,
        )
    return {"pushed_mirrors": pushed_mirrors, "push_errors": push_errors, "skipped": None}


def _iter_project_fusion_push_filenames(project_path: Path) -> list[str]:
    """Local STEP files that can be mirrored to Fusion (deduped by stem)."""
    by_stem: dict[str, str] = {}
    for path in sorted(project_path.iterdir()):
        if not path.is_file() or path.name.startswith("."):
            continue
        if cad_service.is_internal_model_artifact(path):
            continue
        suffix = path.suffix.lower()
        if suffix not in cad_service.STEP_SUFFIXES:
            continue
        if "__faceted" in path.stem.lower() or "__part_" in path.stem.lower():
            continue
        stem = path.stem.lower()
        by_stem.setdefault(stem, path.name)
    return list(by_stem.values())


def _fan_out_project_files_to_mirrors(
    project_id: str,
    project_path: Path,
    *,
    skip_user_ids: set[str] | None = None,
    only_user_ids: set[str] | None = None,
    filenames: list[str] | None = None,
    missing_only: bool = True,
) -> dict[str, Any]:
    """Push project CAD files into teammate (or newly linked) Fusion mirror folders.

    When ``missing_only`` is true, skip uploads whose filename already exists in the
    destination folder so routine syncs do not thrash Autodesk.
    """
    skip_user_ids = set(skip_user_ids or set())
    only_user_ids = set(only_user_ids or set())
    candidates = filenames or _iter_project_fusion_push_filenames(project_path)
    pushed_mirrors: list[dict[str, Any]] = []
    push_errors: list[str] = []
    if not candidates:
        return {
            "pushed_mirrors": pushed_mirrors,
            "push_errors": push_errors,
            "files_considered": 0,
            "files_pushed": 0,
        }

    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT project_id, user_id, aps_project_id, folder_id, hub_label, aps_project_label, folder_label
              FROM project_fusion_mirrors
             WHERE project_id = ?
            """,
            (project_id,),
        ).fetchall()

    from backend.services.autodesk_oauth import get_valid_access_token, list_folder_contents

    files_pushed = 0
    for row in rows:
        mirror = dict(row)
        user_id = str(mirror.get("user_id") or "")
        if not user_id or user_id in skip_user_ids:
            continue
        if only_user_ids and user_id not in only_user_ids:
            continue
        aps_project_id = str(mirror.get("aps_project_id") or "")
        folder_id = str(mirror.get("folder_id") or "")
        if not aps_project_id or not folder_id:
            continue
        token = get_valid_access_token(user_id)
        if not token:
            push_errors.append(f"Autodesk token missing for user {user_id}")
            continue

        existing_names: set[str] = set()
        if missing_only:
            try:
                contents = list_folder_contents(token, aps_project_id, folder_id)
                for item in contents.get("items") or []:
                    name = str(item.get("name") or "").strip().lower()
                    if name:
                        existing_names.add(name)
                        existing_names.add(Path(name).stem.lower())
            except Exception as exc:
                push_errors.append(f"Could not list mirror for {user_id}: {exc}")
                logger.warning(
                    "Fusion teammate list failed project=%s user=%s: %s",
                    project_id,
                    user_id,
                    exc,
                )
                continue

        for filename in candidates:
            upload_stem = Path(filename).stem.lower()
            upload_step_name = f"{Path(filename).stem}.step".lower()
            if missing_only and (upload_step_name in existing_names or upload_stem in existing_names):
                continue
            try:
                step_path = _step_for_cloud_cad(project_path, filename, allow_faceted=False)
            except Exception as exc:
                push_errors.append(f"{filename}: {exc}")
                continue
            try:
                from backend.services.autodesk_oauth import upload_step_to_folder

                upload_name = f"{step_path.stem}.step"
                uploaded = upload_step_to_folder(
                    token,
                    project_id=aps_project_id,
                    folder_id=folder_id,
                    filename=upload_name,
                    data=step_path.read_bytes(),
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
                            uploaded.get("item_id"),
                            uploaded.get("version_id"),
                            now,
                            now,
                            project_id,
                            user_id,
                        ),
                    )
                files_pushed += 1
                existing_names.add(upload_name.lower())
                existing_names.add(step_path.stem.lower())
                pushed_mirrors.append(
                    {
                        "user_id": user_id,
                        "aps_project_id": aps_project_id,
                        "folder_id": folder_id,
                        "item_id": uploaded.get("item_id"),
                        "version_id": uploaded.get("version_id"),
                        "filename": upload_name,
                    }
                )
                logger.info(
                    "Fusion teammate mirror seeded project=%s file=%s user=%s",
                    project_id,
                    upload_name,
                    user_id,
                )
            except Exception as exc:
                push_errors.append(f"{filename} → {user_id}: {exc}")
                logger.warning(
                    "Fusion teammate seed failed project=%s file=%s user=%s: %s",
                    project_id,
                    filename,
                    user_id,
                    exc,
                )

    if pushed_mirrors:
        _notify_fusion_mirrors_updated(
            project_id,
            files=[m.get("filename") for m in pushed_mirrors],
            pushed_mirrors=pushed_mirrors,
        )
    return {
        "pushed_mirrors": pushed_mirrors,
        "push_errors": push_errors,
        "files_considered": len(candidates),
        "files_pushed": files_pushed,
    }


def _background_push_new_file_to_fusion(project_id: str, project_path: Path, filename: str) -> None:
    """Best-effort Fusion mirror upload for newly generated/uploaded files."""
    _background_push_render_edit_to_fusion(project_id, project_path, filename)


_FUSION_PUSH_DEBOUNCE_S = 2.5
_FUSION_PUSH_LOCK = threading.Lock()
_FUSION_PUSH_TIMERS: dict[str, threading.Timer] = {}
_FUSION_PUSH_PENDING: dict[str, str | None] = {}


def _background_push_render_edit_to_fusion(
    project_id: str,
    project_path: Path,
    filename: str | None = None,
) -> None:
    """Async push of a local edit/generated file into every linked Fusion mirror.

    Runs off the request path so extrudes / generates stay snappy. Uses a faceted
    STEP fallback when no native B-rep sibling exists (mesh edits).
    """
    project_path = Path(project_path)
    if not project_path.is_dir():
        return
    try:
        with get_conn() as conn:
            has_mirror = conn.execute(
                "SELECT 1 FROM project_fusion_mirrors WHERE project_id = ? LIMIT 1",
                (project_id,),
            ).fetchone()
        if not has_mirror:
            return
    except Exception:
        logger.debug("Fusion mirror check failed project=%s", project_id, exc_info=True)
        return

    safe = Path(str(filename or "")).name
    if not safe:
        safe = str(project_store.latest_model_file(project_path) or "")
    if not safe:
        return

    try:
        result = _push_file_to_fusion_mirrors(
            project_id,
            project_path,
            safe,
            allow_faceted_fallback=True,
        )
    except Exception:
        logger.exception("Background Fusion push failed project=%s file=%s", project_id, safe)
        return

    if result.get("pushed_mirrors"):
        try:
            meta = project_store.load_meta(project_path)
            meta["fusion_pending_push"] = False
            project_store.save_meta(project_path, meta)
        except Exception:
            logger.debug("Could not clear fusion_pending_push after background push", exc_info=True)
        logger.info(
            "Background Fusion push project=%s file=%s mirrors=%s",
            project_id,
            safe,
            len(result.get("pushed_mirrors") or []),
        )
        # Live notify is already emitted by _push_file_to_fusion_mirrors.
    elif result.get("skipped"):
        logger.info(
            "Background Fusion push skipped project=%s file=%s reason=%s",
            project_id,
            safe,
            result.get("skipped"),
        )
    elif result.get("push_errors"):
        logger.warning(
            "Background Fusion push errors project=%s file=%s: %s",
            project_id,
            safe,
            "; ".join(str(e) for e in (result.get("push_errors") or [])[:3]),
        )


def _schedule_background_fusion_push(
    project_id: str,
    project_path: Path,
    filename: str | None = None,
) -> None:
    """Debounce Fusion uploads so rapid extrudes/edits coalesce into one push."""
    project_id = str(project_id or "").strip()
    if not project_id:
        return
    path = Path(project_path)

    def _run() -> None:
        with _FUSION_PUSH_LOCK:
            _FUSION_PUSH_TIMERS.pop(project_id, None)
            pending = _FUSION_PUSH_PENDING.pop(project_id, None)
        try:
            _background_push_render_edit_to_fusion(project_id, path, pending)
        except Exception:
            logger.exception("Debounced Fusion push failed project=%s", project_id)

    with _FUSION_PUSH_LOCK:
        if filename:
            _FUSION_PUSH_PENDING[project_id] = Path(str(filename)).name
        elif project_id not in _FUSION_PUSH_PENDING:
            _FUSION_PUSH_PENDING[project_id] = None
        old = _FUSION_PUSH_TIMERS.pop(project_id, None)
        if old is not None:
            try:
                old.cancel()
            except Exception:
                pass
        timer = threading.Timer(_FUSION_PUSH_DEBOUNCE_S, _run)
        timer.daemon = True
        timer.name = f"fusion-push-{project_id}"
        _FUSION_PUSH_TIMERS[project_id] = timer
        timer.start()


def _project_needs_fusion_push(project_path: Path, mirror: dict[str, Any]) -> bool:
    """True when local Render Studio edits should be uploaded to Fusion on next access/sync."""
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
            "message": "Local Render Studio changes are already synced to Fusion.",
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
    """Download/export a Fusion item into an existing Render Studio project."""
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
                    step_path=src_path,
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
    """Per-user Fusion folder mirrors for this shared Render Studio project."""
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
    """Bind this user's personal Fusion folder as a mirror for a Render Studio project."""
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
    # Seed this newly linked Fusion folder with every CAD file already in the
    # shared Render Studio project so teammates start from the same set.
    path = PROJECTS / project_id
    seed = {"files_pushed": 0, "push_errors": [], "pushed_mirrors": []}
    if path.is_dir():
        seed = _fan_out_project_files_to_mirrors(
            project_id,
            path,
            only_user_ids={str(user["id"])},
            missing_only=True,
        )
        # Also push this project's files out to any other teammates who already linked.
        teammate_seed = _fan_out_project_files_to_mirrors(
            project_id,
            path,
            skip_user_ids={str(user["id"])},
            missing_only=True,
        )
        seed = {
            "files_pushed": int(seed.get("files_pushed") or 0) + int(teammate_seed.get("files_pushed") or 0),
            "files_considered": max(int(seed.get("files_considered") or 0), int(teammate_seed.get("files_considered") or 0)),
            "pushed_mirrors": list(seed.get("pushed_mirrors") or []) + list(teammate_seed.get("pushed_mirrors") or []),
            "push_errors": list(seed.get("push_errors") or []) + list(teammate_seed.get("push_errors") or []),
        }
    return {"ok": True, "mirror": mirror, "seed": seed}


@app.delete("/api/projects/{project_id}/fusion-mirror")
def delete_project_fusion_mirror(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Remove this user's Fusion mirror folder binding for a Render Studio project."""
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
    """Push pending local Render Studio edits to the linked Fusion mirror (used on Fusion access)."""
    path = _require_project(user, project_id)
    return _push_local_changes_to_fusion(
        project_id,
        path,
        user,
        filename=(body or {}).get("filename"),
        force=bool((body or {}).get("force", False)),
    )


@app.post("/api/projects/{project_id}/fusion-mirror/push-all-to-teammates")
def push_all_fusion_files_to_teammates(
    project_id: str,
    body: dict = Body(default={}),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Upload every project CAD file into each teammate's linked Fusion mirror folder."""
    path = _require_project(user, project_id)
    with get_conn() as conn:
        mine = conn.execute(
            "SELECT 1 FROM project_fusion_mirrors WHERE project_id = ? AND user_id = ?",
            (project_id, user["id"]),
        ).fetchone()
        others = conn.execute(
            "SELECT COUNT(*) AS c FROM project_fusion_mirrors WHERE project_id = ? AND user_id != ?",
            (project_id, user["id"]),
        ).fetchone()
    if not mine:
        raise HTTPException(422, "Link your Fusion mirror on this project before pushing to teammates.")
    if not others or int(others["c"] or 0) < 1:
        raise HTTPException(
            422,
            "No teammate Fusion mirrors on this project yet. Each teammate must open this same Render Studio project and Link mirror to their own Fusion folder.",
        )
    force = bool((body or {}).get("force", False))
    result = _fan_out_project_files_to_mirrors(
        project_id,
        path,
        skip_user_ids={str(user["id"])},
        missing_only=not force,
    )
    count = int(result.get("files_pushed") or 0)
    return {
        "ok": True,
        "message": (
            f"Mirrored {count} file{'s' if count != 1 else ''} to teammate Fusion folders."
            if count
            else "Teammate Fusion folders already have these files."
        ),
        **result,
    }


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
    # Mirror the full shared project set into teammate Fusion folders (missing files only).
    # This is what makes "everyone's Fusion folder" converge — not just the one file that changed.
    fanout = _fan_out_project_files_to_mirrors(
        project_id,
        path,
        skip_user_ids={str(user["id"])},
        missing_only=True,
    )
    pushed_mirrors.extend(fanout.get("pushed_mirrors") or [])
    push_errors.extend(fanout.get("push_errors") or [])
    fanout_count = int(fanout.get("files_pushed") or 0)

    changed = bool(imported) or bool(local_push.get("pushed")) or fanout_count > 0
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
    if fanout_count:
        parts.append(
            f"mirrored {fanout_count} file{'s' if fanout_count != 1 else ''} to teammate Fusion folder{'s' if fanout_count != 1 else ''}"
        )
    elif pushed_mirrors and (imported or local_push.get("pushed")):
        parts.append(f"updated {len(pushed_mirrors)} mirror{'s' if len(pushed_mirrors) != 1 else ''}")
    if parts:
        message = ", and ".join(parts) + "."
    else:
        message = "Fusion mirror folder is reachable. Local and Fusion copies are already in sync."
    if import_errors and not imported and not local_push.get("pushed") and not fanout_count:
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
        "teammate_files_pushed": fanout_count,
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

    filename = body.get("filename")
    if not filename:
        raise HTTPException(422, "No model filename specified for Fusion export.")
    safe = Path(filename).name
    stem = safe[: safe.rfind(".")] if "." in safe else safe
    fmt = str(body.get("format") or "").strip().lower()
    is_3mf = fmt == "3mf" or safe.lower().endswith(".3mf")

    if is_3mf:
        # Upload the 3MF mesh file as-is — Fusion can import 3MF from cloud folders.
        upload_path = path / safe
        if not upload_path.is_file():
            # Prefer an existing sibling .3mf for the selected stem.
            sibling = path / f"{stem}.3mf"
            if sibling.is_file():
                upload_path = sibling
                safe = sibling.name
            else:
                try:
                    cad_service.ensure_mesh_exports(path, safe if (path / safe).is_file() else f"{stem}.glb", missing_only=False)
                except Exception:
                    pass
                sibling = path / f"{stem}.3mf"
                if sibling.is_file():
                    upload_path = sibling
                    safe = sibling.name
        if not upload_path.is_file():
            raise HTTPException(404, f"3MF file not found: {safe}")
        upload_name = Path(str(body.get("name") or upload_path.name)).name
        if not upload_name.lower().endswith(".3mf"):
            upload_name = f"{Path(upload_name).stem}.3mf"
        conflict_mode = str(body.get("conflict_mode") or body.get("on_conflict") or "replace").strip().lower()
        if conflict_mode not in {"replace", "new"}:
            conflict_mode = "replace"
        try:
            result = upload_step_to_folder(
                token,
                project_id=aps_project_id,
                folder_id=folder_id,
                filename=upload_name,
                data=upload_path.read_bytes(),
                conflict_mode=conflict_mode,
            )
        except Exception as exc:
            raise HTTPException(502, f"Fusion 3MF push failed: {exc}") from exc
        result["format"] = "3mf"
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
        return result

    # Resolve editable STEP, then optionally flatten to Part for Extrude/Cut.
    step_path = _step_for_cloud_cad(path, safe, allow_faceted=bool(body.get("allow_faceted_step")))
    # If the UI still points at a *.part.step cache, prefer the sibling native STEP
    # first (so we can re-flatten cleanly when step_mode=part).
    stem_raw = step_path.stem
    base_stem = stem_raw
    for _suffix in (".fusionpart", ".part"):
        if base_stem.lower().endswith(_suffix):
            base_stem = base_stem[: -len(_suffix)]
            break
    if base_stem != stem_raw:
        for _ext in (".step", ".stp"):
            native_sib = path / f"{base_stem}{_ext}"
            if native_sib.is_file() and cad_service.is_editable_brep_step(native_sib):
                step_path = native_sib
                break
    try:
        kind = cad_service.classify_step_file_kind(step_path)
    except Exception:
        kind = "unknown"
    logger.info(
        "Fusion push project=%s requested=%s resolved=%s kind=%s size=%s",
        project_id,
        safe,
        step_path.name,
        kind,
        step_path.stat().st_size if step_path.is_file() else None,
    )
    # Optional allow-list from the Export UI (visible eye icons only).
    allowed = body.get("allowed_filenames") or body.get("visible_filenames") or []
    if isinstance(allowed, list) and allowed:
        allowed_stems = {Path(str(name)).stem.lower() for name in allowed if name}
        allowed_stems.update(
            Path(str(name)).stem.lower().replace(".fusionpart", "").replace(".part", "")
            for name in allowed
            if name
        )
        resolved_stem = step_path.stem.lower().replace(".fusionpart", "").replace(".part", "")
        bake = step_path.name.lower().startswith("_export_visible_assembly")
        if not bake and resolved_stem not in allowed_stems and Path(safe).stem.lower() not in allowed_stems:
            raise HTTPException(
                422,
                f"Refusing to push {step_path.name} — it is not in the visible component list. "
                "Show the component you want, then export again.",
            )

    step_mode = str(body.get("step_mode") or "part").strip().lower()
    want_part = step_mode not in {"assembly", "native", "as_is", "linked", "raw"}
    if want_part:
        try:
            step_path = cad_service.ensure_fusion_part_step(path, step_path)
        except Exception as exc:
            logger.warning("Fusion Part ensure failed for %s: %s", step_path.name, exc)
            try:
                if cad_service.step_has_assembly_links(step_path):
                    part_path = path / f"{step_path.stem}.part{step_path.suffix.lower()}"
                    step_path = cad_service.export_step_as_single_part(step_path, part_path)
            except Exception as exc2:
                logger.warning("Fusion Part flatten failed for %s: %s", step_path.name, exc2)
                raise HTTPException(422, f"Could not create Part STEP for Fusion: {exc2}") from exc2
        if cad_service.step_has_assembly_links(step_path):
            raise HTTPException(
                422,
                f"{step_path.name} is still a linked assembly — Extrude/Cut needs a Part STEP. Try Export again.",
            )
        try:
            if cad_service.classify_step_file_kind(step_path) == "faceted_mesh":
                raise HTTPException(
                    422,
                    f"{step_path.name} is a mesh STEP — Extrude/Cut needs editable B-rep. Export the solid STEP.",
                )
        except HTTPException:
            raise
        except Exception:
            pass
        logger.info(
            "Fusion push Part mode project=%s file=%s links=%s",
            project_id,
            step_path.name,
            cad_service.step_has_assembly_links(step_path),
        )
    else:
        logger.info("Fusion push keeping assembly/native STEP project=%s file=%s", project_id, step_path.name)

    upload_stem = step_path.stem
    for suffix in (".fusionpart", ".part"):
        if upload_stem.endswith(suffix):
            upload_stem = upload_stem[: -len(suffix)]
            break
    source_path = path / f"{upload_stem}.py"
    if not source_path.is_file():
        try:
            from backend.services import text_to_cad_params

            resolved_source = text_to_cad_params.resolve_source_for_model(path, step_path.name)
            if resolved_source is not None:
                source_path = resolved_source[0]
        except Exception:
            pass

    upload_name = Path(str(body.get("name") or f"{upload_stem}.step")).name
    if not upload_name.lower().endswith((".step", ".stp")):
        upload_name = f"{Path(upload_name).stem}.step"
    # Never upload *.fusionpart.step / *.part.step as the Fusion filename
    if ".fusionpart" in upload_name.lower() or ".part." in upload_name.lower() or upload_name.lower().endswith(".part.step"):
        upload_name = f"{upload_stem}.step"

    # Visible-assembly bake bytes must land in Fusion under the *visible* part
    # name — never `_export_visible_assembly.step` and never a hidden sibling
    # like arduino_uno_q when the UI sent an allow-list.
    allowed_for_name = body.get("allowed_filenames") or body.get("visible_filenames") or []
    if not isinstance(allowed_for_name, list):
        allowed_for_name = []
    allowed_name_stems = {
        Path(str(n)).stem.lower().replace(".fusionpart", "").replace(".part", "")
        for n in allowed_for_name
        if n
    }
    is_bake_upload = (
        step_path.name.lower().startswith("_export_visible_assembly")
        or upload_stem.lower().startswith("_export_visible_assembly")
        or upload_name.lower().startswith("_export_visible_assembly")
    )

    def _visible_step_name() -> str:
        preferred = Path(str(body.get("name") or "")).name
        if preferred and not preferred.lower().startswith("_export_"):
            pref_stem = Path(preferred).stem.lower().replace(".fusionpart", "").replace(".part", "")
            # Only trust body.name when it matches the visible allow-list (or
            # there is no allow-list). Otherwise arduino_uno_q slips through.
            if not allowed_name_stems or pref_stem in allowed_name_stems:
                if not preferred.lower().endswith((".step", ".stp")):
                    return f"{Path(preferred).stem}.step"
                return preferred
        if allowed_for_name:
            return f"{Path(str(allowed_for_name[0])).stem}.step"
        return upload_name

    if is_bake_upload:
        upload_name = _visible_step_name()
    elif (not want_part) and allowed_name_stems:
        name_stem = Path(upload_name).stem.lower().replace(".fusionpart", "").replace(".part", "")
        if name_stem not in allowed_name_stems:
            # Client asked for a destination name outside the visible set
            # (classic bug: latest_file / arduino). Force the visible stem.
            upload_name = _visible_step_name()

    # Part mode LAST: always land under a Part-safe cloud name (…_Part.step).
    # Never version an old "…Assembly…" Fusion item — document type sticks and
    # Cut fails with linked inserts ("No target body found to cut or intersect!").
    # Do this after allow-list rewrite so Assembly names cannot win.
    if want_part and step_path.suffix.lower() in {".step", ".stp"}:
        base_for_part = upload_stem
        if is_bake_upload or allowed_for_name:
            base_for_part = Path(_visible_step_name()).stem
        upload_name = cad_service.fusion_part_cloud_filename(base_for_part)

    conflict_mode = str(body.get("conflict_mode") or body.get("on_conflict") or "replace").strip().lower()
    if conflict_mode not in {"replace", "new"}:
        conflict_mode = "replace"

    logger.info(
        "Fusion push name project=%s upload_name=%s bake=%s allowed=%s",
        project_id,
        upload_name,
        is_bake_upload,
        [Path(str(n)).name for n in allowed_for_name[:8]],
    )

    try:
        result = upload_step_to_folder(
            token,
            project_id=aps_project_id,
            folder_id=folder_id,
            filename=upload_name,
            data=step_path.read_bytes(),
            conflict_mode=conflict_mode,
        )
        upload_name = str(result.get("name") or upload_name)
        # Never auto-upload companion .py — it doubles files in Fusion and often
        # picks the wrong sibling. Opt-in only via upload_source=true.
        if (
            body.get("upload_source") is True
            and source_path.is_file()
            and not is_bake_upload
            and (
                not allowed_name_stems
                or source_path.stem.lower().replace(".fusionpart", "").replace(".part", "") in allowed_name_stems
            )
        ):
            try:
                source_name = f"{source_path.stem}.build123d.py"
                result["source_upload"] = upload_step_to_folder(
                    token,
                    project_id=aps_project_id,
                    folder_id=folder_id,
                    filename=source_name,
                    data=source_path.read_bytes(),
                    conflict_mode=conflict_mode,
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

    # Explicit Fusion export UI uploads (hub/folder picked) should land as one file
    # in that folder. Teammate mirror fan-out is for background sync only.
    explicit_export = bool(body.get("hub_id") or body.get("folder_id"))
    if explicit_export:
        teammate = {"pushed_mirrors": [], "push_errors": []}
    else:
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
        "step_mode": step_mode if want_part else (step_mode or "assembly"),
        "fusion_document_kind": "part" if want_part else "assembly",
        "open_instructions": (
            "In Fusion Data Panel: Open this file (do not Insert into another design). "
            "Browser should show Bodies under the root — not a chain-link component. "
            "If you see a link icon: right-click → Break Link, then Extrude/Cut on a solid face."
            if want_part
            else ""
        ),
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


@app.post("/api/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Speech-to-text for Quest XR / browsers without Web Speech API."""
    import httpx

    from backend.services.user_keys_service import resolve_api_key_for_user

    api_key = (
        resolve_api_key_for_user(user)
        or getattr(settings, "openai_api_key", "")
        or ""
    ).strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No OpenAI API key configured for transcription.")

    raw = await file.read()
    if not raw or len(raw) < 64:
        raise HTTPException(status_code=400, detail="Empty audio clip.")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio clip too large (max 25MB).")

    filename = file.filename or "speech.webm"
    content_type = file.content_type or "audio/webm"
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (filename, raw, content_type)},
                data={"model": "whisper-1", "language": "en", "response_format": "json"},
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Transcription request failed: {exc}") from exc

    if resp.status_code >= 400:
        detail = resp.text[:300] if resp.text else f"OpenAI error {resp.status_code}"
        raise HTTPException(status_code=502, detail=detail)

    payload = resp.json() if resp.content else {}
    text = str(payload.get("text") or "").strip()
    return {"text": text, "ok": True}


@app.get("/api/user/ai-credits")
def get_user_ai_credits(user: dict[str, Any] = Depends(get_current_user)):
    return {"credits": ai_credit_service.status(user)}


@app.get("/api/user/ai-credits/transactions")
def get_user_ai_credit_transactions(
    limit: int = 40,
    user: dict[str, Any] = Depends(get_current_user),
):
    return {
        "credits": ai_credit_service.status(user),
        "transactions": ai_credit_service.list_transactions(user["id"], limit=limit),
    }


@app.patch("/api/user/ai-credits")
def update_user_ai_credits(body: UserAICreditSettingsRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        ai_credit_service.update_settings(
            user["id"],
            use_platform_key=body.use_platform_key,
            auto_refill_enabled=body.auto_refill_enabled,
            auto_refill_threshold_cents=body.auto_refill_threshold_cents,
            auto_refill_amount_cents=body.auto_refill_amount_cents,
            platform_provider=body.platform_provider,
            platform_model=body.platform_model,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"credits": ai_credit_service.status(user), "ai": _ai_status_for_user(user)}


@app.post("/api/user/ai-credits/checkout")
def create_user_ai_credit_checkout(
    body: UserAICreditCheckoutRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    base = str(getattr(settings, "public_base_url", None) or _request_origin(request)).rstrip("/")
    success_url = body.success_url or f"{base}/?ai_credits=success"
    cancel_url = body.cancel_url or f"{base}/?ai_credits=cancel"
    try:
        return ai_credit_service.create_checkout_session(
            user,
            amount_cents=body.amount_cents,
            provider=body.provider,
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/user/ai-credits/claim")
def claim_user_ai_credit_checkout(
    body: UserAICreditClaimRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        credits = ai_credit_service.claim_checkout_session(user, body.session_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"credits": credits, "ai": _ai_status_for_user(user)}


@app.post("/api/user/ai-credits/trial-ack")
def ack_user_ai_credit_trial(user: dict[str, Any] = Depends(get_current_user)):
    """Dismiss the $10 Render Studio Key trial welcome popup."""
    credits = ai_credit_service.ack_trial_popup(user["id"])
    return {"credits": credits, "ai": _ai_status_for_user(user)}


@app.post("/api/user/ai-credits/demo")
def demo_user_ai_credits(
    body: UserAICreditCheckoutRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Admin-only test credit mint. Regular users must use Stripe checkout."""
    _require_a1projects_admin(user)
    return {"credits": ai_credit_service.demo_add(user, body.amount_cents), "ai": _ai_status_for_user(user)}


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



@app.get("/api/admin/trial-credits")
def admin_trial_credits(
    user: dict[str, Any] = Depends(get_current_user),
    days: int = Query(30, ge=1, le=365),
):
    """Live free-trial credit usage for the management dashboard."""
    _require_a1projects_admin(user)
    from datetime import datetime, timedelta, timezone
    from backend.services import trial_credit_report_service

    now = datetime.now(timezone.utc)
    since = now - timedelta(days=int(days))
    report = trial_credit_report_service.build_report(since=since, now=now)
    # Abuse signals for ops
    with get_conn() as conn:
        demo_rows = conn.execute(
            """
            SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents), 0) AS s
            FROM ai_credit_transactions
            WHERE provider = 'demo' AND kind = 'purchase'
            """
        ).fetchone()
        ip_dupes = conn.execute(
            """
            SELECT COUNT(*) FROM (
              SELECT ip FROM ai_credit_trial_ips GROUP BY ip HAVING COUNT(*) > 1
            )
            """
        ).fetchone()[0]
        empty_ip_grants = conn.execute(
            """
            SELECT COUNT(*) FROM ai_credit_accounts
            WHERE trial_granted_at IS NOT NULL
              AND TRIM(COALESCE(trial_granted_at, '')) != ''
              AND TRIM(COALESCE(trial_grant_ip, '')) = ''
            """
        ).fetchone()[0]
    report["security"] = {
        "demo_purchase_count": int(demo_rows["c"] or 0),
        "demo_purchase_cents": int(demo_rows["s"] or 0),
        "demo_purchase_usd": round(int(demo_rows["s"] or 0) / 100, 2),
        "duplicate_trial_ip_rows": int(ip_dupes or 0),
        "trial_grants_missing_ip": int(empty_ip_grants or 0),
    }
    try:
        from backend.services import supabase_security_store as sbsec
        from backend.services import supabase_auth_service as sbauth

        report["supabase"] = {
            **sbsec.ping(),
            "auth": sbauth.status(),
        }
    except Exception as exc:
        report["supabase"] = {"ok": False, "error": str(exc)[:200]}
    return report


@app.post("/api/admin/supabase/sync")
def admin_supabase_sync(user: dict[str, Any] = Depends(get_current_user)):
    """Push local users (Auth hashes) + encrypted API keys into Supabase."""
    _require_a1projects_admin(user)
    from backend.services import supabase_auth_service as sbauth
    from backend.services import supabase_secrets_store as sbsec
    from backend.services import supabase_client

    if not supabase_client.configured():
        raise HTTPException(
            503,
            "Supabase not configured — set SUPABASE_URL in server .env "
            "(Dashboard → Project Settings → API → Project URL).",
        )
    auth_result = sbauth.sync_all_users_to_supabase()
    keys_result = sbsec.sync_all_keys()
    return {
        "ok": bool(auth_result.get("ok") and keys_result.get("ok")),
        "auth": auth_result,
        "secrets": keys_result,
        "client": supabase_client.status(),
    }


@app.get("/api/users")
def list_users(q: str = Query(""), user: dict[str, Any] = Depends(get_current_user)):
    del user
    return {"users": teams_service.list_users(q)}


def _admin_dashboard_cache_path(cache_key: tuple[int, int, int]) -> Path:
    user_limit, project_limit, prompt_limit = cache_key
    return ADMIN_DASHBOARD_CACHE_DIR / f"admin_dashboard_{user_limit}_{project_limit}_{prompt_limit}.json"


def _load_admin_dashboard_cache(cache_key: tuple[int, int, int]) -> dict[str, Any] | None:
    now = time.time()
    with _admin_dashboard_cache_lock:
        cached = _admin_dashboard_cache.get(cache_key)
        if cached and now - cached[0] < _ADMIN_DASHBOARD_CACHE_TTL:
            return cached[1]
    path = _admin_dashboard_cache_path(cache_key)
    if not path.is_file():
        return None
    try:
        wrapper = json.loads(path.read_text(encoding="utf-8"))
        cached_at = float(wrapper.get("cached_at") or 0)
        data = wrapper.get("data")
        if not isinstance(data, dict) or now - cached_at >= _ADMIN_DASHBOARD_CACHE_TTL:
            return None
        with _admin_dashboard_cache_lock:
            _admin_dashboard_cache[cache_key] = (cached_at, data)
        return data
    except Exception:
        return None


def _save_admin_dashboard_cache(cache_key: tuple[int, int, int], data: dict[str, Any]) -> None:
    cached_at = time.time()
    with _admin_dashboard_cache_lock:
        _admin_dashboard_cache.clear()
        _admin_dashboard_cache[cache_key] = (cached_at, data)
    try:
        _admin_dashboard_cache_path(cache_key).write_text(
            json.dumps({"cached_at": cached_at, "data": data}, separators=(",", ":")),
            encoding="utf-8",
        )
    except Exception as exc:
        logger.debug("Could not persist admin dashboard cache: %s", exc)


@app.get("/api/admin/dashboard")
def admin_dashboard(
    user: dict[str, Any] = Depends(get_current_user),
    user_limit: int = Query(12, ge=1, le=50),
    project_limit: int = Query(18, ge=1, le=80),
    prompt_limit: int = Query(40, ge=1, le=160),
    refresh: bool = Query(False, description="Force a fresh daily dashboard scan"),
):
    """Site-wide management overview for the a1projects account only."""
    _require_a1projects_admin(user)
    cache_key = (int(user_limit), int(project_limit), int(prompt_limit))
    if not refresh:
        cached = _load_admin_dashboard_cache(cache_key)
        if cached:
            return {**cached, "cache": {"hit": True, "ttl_seconds": int(_ADMIN_DASHBOARD_CACHE_TTL)}}
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
        team_member_rows = conn.execute(
            """
            SELECT tm.team_id, tm.user_id, tm.role, t.name AS team_name,
                   u.display_name, u.email
              FROM team_members tm
              JOIN teams t ON t.id = tm.team_id
              LEFT JOIN users u ON u.id = tm.user_id
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
            "model_count": 0,
            "training_ready_count": 0,
        }

    prompt_kind_counts: Counter[str] = Counter()
    prompt_model_counts: Counter[str] = Counter()
    project_format_counts: Counter[str] = Counter()
    daily_prompts: Counter[str] = Counter()
    daily_users_joined: Counter[str] = Counter()
    daily_projects_created: Counter[str] = Counter()
    recent_prompts: list[dict[str, Any]] = []
    recent_projects: list[dict[str, Any]] = []
    network_nodes: dict[str, dict[str, Any]] = {}
    network_edge_keys: dict[tuple[str, str, str], dict[str, Any]] = {}
    projects_scanned = 0
    files_total = 0
    prompt_total = 0
    success_total = 0
    error_total = 0
    cost_total = 0.0
    tokens_total = 0

    def _net_node(node_id: str, kind: str, label: str, **extra: Any) -> None:
        if not node_id:
            return
        existing = network_nodes.get(node_id)
        if existing:
            existing["weight"] = int(existing.get("weight") or 1) + 1
            for key, value in extra.items():
                if value is not None and existing.get(key) in (None, "", 0):
                    existing[key] = value
            return
        network_nodes[node_id] = {
            "id": node_id,
            "kind": kind,
            "label": label or node_id,
            "weight": 1,
            **extra,
        }

    def _net_edge(source: str, target: str, kind: str, weight: int = 1) -> None:
        if not source or not target or source == target:
            return
        key = (source, target, kind)
        if key in network_edge_keys:
            network_edge_keys[key]["weight"] = int(network_edge_keys[key].get("weight") or 0) + weight
        else:
            network_edge_keys[key] = {"source": source, "target": target, "kind": kind, "weight": weight}

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
        latest_file = project_store.latest_model_file(project_path)
        preview = _admin_preview_assets(project_path, pid, latest_file)
        try:
            entries = prompt_history_service.list_entries(project_path, limit=200)
        except Exception as exc:
            logger.info("Admin dashboard skipped prompt history for %s: %s", pid, exc)
            entries = []
        latest_prompt_text = None
        latest_prompt_at = None
        project_cost = 0.0
        if entries:
            newest_prompt = max(entries, key=lambda item: str(item.get("created_at") or ""))
            latest_prompt_text = _admin_prompt_preview(newest_prompt.get("prompt"), 180)
            latest_prompt_at = newest_prompt.get("created_at")
            for entry in entries:
                cost = entry_effective_cost(entry)
                if cost is not None:
                    project_cost += float(cost)
        project_item = {
            "id": pid,
            "name": meta.get("name") or pid,
            "created_at": meta.get("created_at") or access["created_at"],
            "updated_at": updated_at,
            "file_count": len(files),
            "latest_file": latest_file,
            "owner_user_id": owner_id,
            "owner_name": access["owner_name"],
            "owner_email": access["owner_email"],
            "team_id": access["team_id"],
            "team_name": access["team_name"],
            "public": bool(access["is_public"]),
            "latest_prompt": latest_prompt_text,
            "latest_prompt_at": latest_prompt_at,
            "total_cost_usd": round(project_cost, 6),
            "prompt_count": len(entries),
            "training_ready": bool(preview.get("model_file") and latest_prompt_text),
            **preview,
        }
        recent_projects.append(project_item)
        owner_node = f"user:{owner_id}" if owner_id else None
        project_node = f"project:{pid}"
        team_node = f"team:{access['team_id']}" if access["team_id"] else None
        _net_node(
            project_node,
            "project",
            str(project_item["name"]),
            project_id=pid,
            has_model=bool(project_item.get("model_file")),
        )
        if owner_id:
            owner_user = users_by_id.get(owner_id) or {}
            _net_node(
                owner_node,
                "user",
                str(access["owner_name"] or access["owner_email"] or owner_id),
                user_id=owner_id,
                avatar_url=owner_user.get("avatar_url") or _avatar_url_for_user_id(owner_id),
            )
            _net_edge(owner_node, project_node, "owns", 2)
        if team_node:
            _net_node(team_node, "team", str(access["team_name"] or access["team_id"]), team_id=access["team_id"])
            _net_edge(project_node, team_node, "workspace", 1)
        if owner_id in users_by_id:
            users_by_id[owner_id]["recent_projects"].append(project_item)
            if project_item.get("model_file"):
                users_by_id[owner_id]["model_count"] += 1
            if project_item.get("training_ready"):
                users_by_id[owner_id]["training_ready_count"] += 1
            owner_dt = _parse_admin_dt(users_by_id[owner_id].get("last_active_at"))
            project_dt = _parse_admin_dt(updated_at)
            if project_dt and (owner_dt is None or project_dt > owner_dt):
                users_by_id[owner_id]["last_active_at"] = updated_at

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
            final_prompt = str(entry.get("prompt") or "")
            original_prompt = str(entry.get("original_prompt") or "").strip() or None
            prompt_improved = bool(entry.get("prompt_improved")) or (
                bool(original_prompt) and original_prompt != final_prompt.strip()
            )
            prompt_item = {
                "id": entry.get("id"),
                "project_id": pid,
                "project_name": project_item["name"],
                "prompt": final_prompt,
                "prompt_preview": _admin_prompt_preview(final_prompt),
                "original_prompt": original_prompt,
                "prompt_improved": prompt_improved,
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
            if entry_user_id:
                collab_node = f"user:{entry_user_id}"
                collab_user = users_by_id.get(entry_user_id) or {}
                _net_node(
                    collab_node,
                    "user",
                    str(entry.get("user_name") or access["owner_name"] or entry_user_id),
                    user_id=entry_user_id,
                    avatar_url=collab_user.get("avatar_url") or _avatar_url_for_user_id(entry_user_id),
                )
                edge_kind = "owns" if entry_user_id == owner_id else "collab"
                _net_edge(collab_node, f"project:{pid}", edge_kind, 1)

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

    days = []
    today = datetime.now(timezone.utc).date()
    for offset in range(29, -1, -1):
        day = (today - timedelta(days=offset)).isoformat()
        days.append(
            {
                "date": day,
                "prompts": daily_prompts[day],
                "users_joined": daily_users_joined[day],
                "projects_created": daily_projects_created[day],
            }
        )
    daily = days

    for member in team_member_rows:
        team_node = f"team:{member['team_id']}"
        user_node = f"user:{member['user_id']}"
        _net_node(team_node, "team", str(member["team_name"] or member["team_id"]), team_id=member["team_id"])
        _net_node(
            user_node,
            "user",
            str(member["display_name"] or member["email"] or member["user_id"]),
            user_id=member["user_id"],
            avatar_url=(users_by_id.get(member["user_id"]) or {}).get("avatar_url")
            or _avatar_url_for_user_id(member["user_id"]),
        )
        _net_edge(user_node, team_node, "member", 1)

    # Keep the brain graph readable: prefer active users + recent projects + connected teams.
    active_user_ids = {
        f"user:{item['id']}"
        for item in sorted(users, key=lambda u: int(u.get("prompt_count") or 0), reverse=True)[:28]
    }
    recent_project_ids = {f"project:{item['id']}" for item in recent_projects[:40]}
    keep_nodes = set(active_user_ids) | set(recent_project_ids)
    for edge in network_edge_keys.values():
        if edge["source"] in keep_nodes or edge["target"] in keep_nodes:
            if edge["kind"] in {"member", "workspace"} or edge["source"].startswith("team:") or edge["target"].startswith("team:"):
                keep_nodes.add(edge["source"])
                keep_nodes.add(edge["target"])
            elif edge["source"] in recent_project_ids or edge["target"] in recent_project_ids:
                keep_nodes.add(edge["source"])
                keep_nodes.add(edge["target"])
    network_nodes_out = [node for node_id, node in network_nodes.items() if node_id in keep_nodes]
    # Enrich user node sizes from stats
    for node in network_nodes_out:
        if node["kind"] == "user":
            uid = node.get("user_id")
            stats_u = users_by_id.get(uid) if uid else None
            if stats_u:
                node["prompt_count"] = stats_u.get("prompt_count") or 0
                node["project_count"] = stats_u.get("project_count") or 0
                node["weight"] = max(1, int(stats_u.get("prompt_count") or 0) + int(stats_u.get("project_count") or 0))
                if stats_u.get("avatar_url"):
                    node["avatar_url"] = stats_u.get("avatar_url")
                elif not node.get("avatar_url") and uid:
                    node["avatar_url"] = _avatar_url_for_user_id(uid)
        elif node["kind"] == "project":
            node["weight"] = max(1, int(node.get("weight") or 1))
    network_edges_out = [
        edge
        for edge in network_edge_keys.values()
        if edge["source"] in keep_nodes and edge["target"] in keep_nodes
    ]

    result = {
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
            "model_count": sum(1 for item in recent_projects if item.get("model_file")),
            "training_ready_count": sum(1 for item in recent_projects if item.get("training_ready")),
        },
        "community": {
            "user_count": len(users_by_id),
            "project_count": projects_scanned,
            "prompt_count": prompt_total,
            "success_rate": round(success_total / prompt_total, 4) if prompt_total else None,
            "estimated_cost_usd": round(cost_total, 6),
            "model_count": sum(1 for item in recent_projects if item.get("model_file")),
            "training_ready_count": sum(1 for item in recent_projects if item.get("training_ready")),
            "avg_prompts_per_user": round(prompt_total / len(users_by_id), 2) if users_by_id else 0,
            "avg_projects_per_user": round(projects_scanned / len(users_by_id), 2) if users_by_id else 0,
        },
        "users": [
            {
                "id": item["id"],
                "email": item["email"],
                "display_name": item["display_name"],
                "created_at": item["created_at"],
                "last_active_at": item["last_active_at"],
                "project_count": item["project_count"],
                "prompt_count": item["prompt_count"],
                "success_count": item["success_count"],
                "error_count": item["error_count"],
                "total_cost_usd": item["total_cost_usd"],
                "total_tokens": item["total_tokens"],
                "model_count": item["model_count"],
                "training_ready_count": item["training_ready_count"],
            }
            for item in sorted(users, key=lambda u: str(u.get("last_active_at") or ""), reverse=True)
        ],
        "recent_users": recent_users,
        "active_users": active_users,
        "recent_projects": recent_projects[:project_limit],
        "recent_prompts": recent_prompts[:prompt_limit],
        "prompt_kind_counts": [{"kind": k, "count": v} for k, v in prompt_kind_counts.most_common()],
        "prompt_model_counts": [{"model": k, "count": v} for k, v in prompt_model_counts.most_common(12)],
        "project_format_counts": [{"format": k, "count": v} for k, v in project_format_counts.most_common(12)],
        "daily": daily,
        "network": {
            "nodes": network_nodes_out,
            "edges": network_edges_out,
        },
    }
    _save_admin_dashboard_cache(cache_key, result)
    return result


@app.get("/api/admin/render-agent/activity")
def admin_render_agent_activity(
    user: dict[str, Any] = Depends(get_current_user),
    limit: int = Query(80, ge=1, le=300),
):
    """Latest Render Agent questions asked by anyone on the site."""
    _require_a1projects_admin(user)
    from backend.services import render_agent_service

    return render_agent_service.list_recent_activity(limit=limit)


@app.get("/api/admin/users/{user_id}")
def admin_user_detail(user_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Individual user activity, stats, and recent models for management lookup."""
    _require_a1projects_admin(user)
    from backend.services.ai_cost import entry_effective_cost

    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT id, email, display_name, created_at, avatar_url, ai_provider, ai_model
              FROM users
             WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
        access_rows = conn.execute(
            """
            SELECT pa.project_id, pa.team_id, pa.created_by, pa.created_at, pa.is_public,
                   t.name AS team_name
              FROM project_access pa
              LEFT JOIN teams t ON t.id = pa.team_id
             WHERE pa.created_by = ?
             ORDER BY pa.created_at DESC
            """,
            (user_id,),
        ).fetchall()
    if not row:
        raise HTTPException(404, "User not found")

    projects: list[dict[str, Any]] = []
    prompts: list[dict[str, Any]] = []
    prompt_count = success_count = error_count = 0
    cost_total = 0.0
    tokens_total = 0
    model_count = training_ready = 0
    last_active = row["created_at"]

    for access in access_rows:
        pid = access["project_id"]
        project_path = PROJECTS / pid
        if not project_path.is_dir():
            continue
        try:
            meta = project_store.load_meta(project_path)
        except Exception:
            meta = {"id": pid, "name": pid}
        try:
            files = cad_service.list_project_files(project_path)
        except Exception:
            files = []
        latest_file = project_store.latest_model_file(project_path)
        preview = _admin_preview_assets(project_path, pid, latest_file)
        updated_at = meta.get("updated_at") or access["created_at"]
        project_item = {
            "id": pid,
            "name": meta.get("name") or pid,
            "created_at": meta.get("created_at") or access["created_at"],
            "updated_at": updated_at,
            "file_count": len(files),
            "latest_file": latest_file,
            "public": bool(access["is_public"]),
            "team_name": access["team_name"],
            **preview,
        }
        try:
            entries = prompt_history_service.list_entries(project_path, limit=80)
        except Exception:
            entries = []
        if entries:
            newest = max(entries, key=lambda item: str(item.get("created_at") or ""))
            project_item["latest_prompt"] = _admin_prompt_preview(newest.get("prompt"), 220)
            project_item["latest_prompt_at"] = newest.get("created_at")
        project_item["training_ready"] = bool(project_item.get("model_file") and project_item.get("latest_prompt"))
        if project_item.get("model_file"):
            model_count += 1
        if project_item.get("training_ready"):
            training_ready += 1
        projects.append(project_item)
        upd = _parse_admin_dt(updated_at)
        active = _parse_admin_dt(last_active)
        if upd and (active is None or upd > active):
            last_active = updated_at

        for entry in entries:
            prompt_count += 1
            if entry.get("success") is False:
                error_count += 1
            else:
                success_count += 1
            usage = entry.get("usage") or {}
            entry_tokens = int(usage.get("total_tokens") or usage.get("tokens") or 0) if isinstance(usage, dict) else 0
            tokens_total += entry_tokens
            cost = entry_effective_cost(entry)
            if cost is not None:
                cost_total += float(cost)
            entry_dt = _parse_admin_dt(entry.get("created_at"))
            active = _parse_admin_dt(last_active)
            if entry_dt and (active is None or entry_dt > active):
                last_active = entry.get("created_at")
            final_prompt = str(entry.get("prompt") or "")
            original_prompt = str(entry.get("original_prompt") or "").strip() or None
            prompt_improved = bool(entry.get("prompt_improved")) or (
                bool(original_prompt) and original_prompt != final_prompt.strip()
            )
            prompts.append(
                {
                    "id": entry.get("id"),
                    "project_id": pid,
                    "project_name": project_item["name"],
                    "prompt": final_prompt,
                    "prompt_preview": _admin_prompt_preview(final_prompt, 280),
                    "original_prompt": original_prompt,
                    "prompt_improved": prompt_improved,
                    "success": entry.get("success") is not False,
                    "error": entry.get("error"),
                    "kind": entry.get("kind") or "cad",
                    "created_at": entry.get("created_at"),
                    "filename": entry.get("filename"),
                    "model": entry.get("model"),
                    "prompt_mode": entry.get("prompt_mode") or entry.get("speed"),
                    "cost_usd": round(float(cost), 6) if cost is not None else None,
                }
            )

    projects.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    prompts.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return {
        "user": {
            "id": row["id"],
            "email": row["email"],
            "display_name": row["display_name"],
            "created_at": row["created_at"],
            "avatar_url": row["avatar_url"],
            "ai_provider": row["ai_provider"],
            "ai_model": row["ai_model"],
            "last_active_at": last_active,
        },
        "stats": {
            "project_count": len(projects),
            "prompt_count": prompt_count,
            "success_count": success_count,
            "error_count": error_count,
            "success_rate": round(success_count / prompt_count, 4) if prompt_count else None,
            "estimated_cost_usd": round(cost_total, 6),
            "total_tokens": tokens_total,
            "model_count": model_count,
            "training_ready_count": training_ready,
        },
        "projects": projects[:40],
        "recent_prompts": prompts[:40],
    }


@app.get("/api/admin/projects/{project_id}")
def admin_project_detail(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    """Project model preview payload: GLB/snapshot, prompts, and owner stats hooks."""
    _require_a1projects_admin(user)
    from backend.services.ai_cost import entry_effective_cost

    project_path = PROJECTS / project_id
    if not project_path.is_dir():
        raise HTTPException(404, "Project not found")
    owner = _project_owner(project_id) or {}
    try:
        meta = project_store.load_meta(project_path)
    except Exception:
        meta = {"id": project_id, "name": project_id}
    try:
        files = cad_service.list_project_files(project_path)
    except Exception:
        files = []
    latest_file = project_store.latest_model_file(project_path)
    preview = _admin_preview_assets(project_path, project_id, latest_file)
    try:
        entries = prompt_history_service.list_entries(project_path, limit=60)
    except Exception:
        entries = []
    prompts = []
    for entry in entries:
        cost = entry_effective_cost(entry)
        final_prompt = str(entry.get("prompt") or "")
        original_prompt = str(entry.get("original_prompt") or "").strip() or None
        prompt_improved = bool(entry.get("prompt_improved")) or (
            bool(original_prompt) and original_prompt != final_prompt.strip()
        )
        prompts.append(
            {
                "id": entry.get("id"),
                "prompt": final_prompt,
                "prompt_preview": _admin_prompt_preview(final_prompt, 280),
                "original_prompt": original_prompt,
                "prompt_improved": prompt_improved,
                "success": entry.get("success") is not False,
                "error": entry.get("error"),
                "kind": entry.get("kind") or "cad",
                "created_at": entry.get("created_at"),
                "filename": entry.get("filename"),
                "model": entry.get("model"),
                "provider": entry.get("provider"),
                "prompt_mode": entry.get("prompt_mode") or entry.get("speed"),
                "cost_usd": round(float(cost), 6) if cost is not None else None,
                "user_name": entry.get("user_name") or owner.get("owner_name"),
                "references": entry.get("references") or [],
            }
        )
    prompts.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    try:
        usage = prompt_history_service.project_usage_summary(project_path)
    except Exception:
        usage = {}
    total_cost = usage.get("cost_usd")
    if total_cost is None:
        total_cost = sum(float(p["cost_usd"]) for p in prompts if p.get("cost_usd") is not None)
    snapshot_files = sorted(
        [p.name for p in project_path.glob("*_snapshot_*.png") if p.is_file()],
        key=lambda name: (project_path / name).stat().st_mtime,
        reverse=True,
    )[:8]
    return {
        "project": {
            "id": project_id,
            "name": meta.get("name") or project_id,
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
            "file_count": len(files),
            "latest_file": latest_file,
            "public": bool(owner.get("is_public")),
            "owner_user_id": owner.get("created_by"),
            "owner_name": owner.get("owner_name"),
            "owner_email": owner.get("owner_email"),
            "team_id": owner.get("team_id"),
            "training_ready": bool(preview.get("model_file") and prompts),
            "total_cost_usd": round(float(total_cost or 0), 6),
            "prompt_count": int(usage.get("prompt_count") or len(prompts)),
            "total_tokens": int((usage.get("usage") or {}).get("total_tokens") or 0),
            "usage_summary": usage,
            **preview,
            "snapshot_urls": [
                f"/api/projects/{project_id}/files/{urllib.parse.quote(name)}"
                for name in snapshot_files
            ],
        },
        "files": [
            {
                "name": f.get("name"),
                "format": f.get("format"),
                "url": f"/api/projects/{project_id}/files/{urllib.parse.quote(str(f.get('name') or ''))}",
            }
            for f in files[:80]
        ],
        "prompts": prompts,
        "total_cost_usd": round(float(total_cost or 0), 6),
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
                    "renders": (summary.get("browser") or {}).get("renders") or [],
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


@app.patch("/api/teams/{team_id}/members/{target_user_id}/role")
def set_team_member_role(
    team_id: str,
    target_user_id: str,
    body: TeamMemberRoleRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        member = teams_service.set_member_role(team_id, target_user_id, body.role, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _notify_workspace(
        team_id,
        {
            "type": "workspace.member.role",
            "team_id": team_id,
            "user_id": target_user_id,
            "role": member.get("role"),
            "role_label": member.get("role_label"),
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    return {"member": member}


@app.patch("/api/teams/{team_id}/members/{target_user_id}/permissions")
def set_team_member_permissions(
    team_id: str,
    target_user_id: str,
    body: TeamMemberPermissionsRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        member = teams_service.set_member_permissions(
            team_id,
            target_user_id,
            user["id"],
            can_invite=body.can_invite,
            access=body.access,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _notify_workspace(
        team_id,
        {
            "type": "workspace.member.permissions",
            "team_id": team_id,
            "user_id": target_user_id,
            "can_invite": member.get("can_invite"),
            "access": member.get("access"),
            "access_label": member.get("access_label"),
            "by": user["display_name"],
            "by_user_id": user["id"],
        },
    )
    return {"member": member}


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
        result = teams_service.leave_team(team_id, user["id"])
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _notify_user(
        user["id"],
        {"type": "workspace.member.updated", "team_id": team_id, "status": "left"},
    )
    return result


@app.delete("/api/teams/{team_id}")
def delete_team(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        result = teams_service.delete_team(team_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    # Remove project files that belonged to this workspace.
    for project_id in result.get("project_ids") or []:
        path = PROJECTS / str(project_id)
        try:
            generation_service.cancel_project(path)
        except Exception:
            logger.debug("cancel before workspace delete failed project=%s", project_id, exc_info=True)
        try:
            if path.exists():
                shutil.rmtree(path, ignore_errors=True)
        except Exception:
            logger.warning("Could not remove project dir after workspace delete project=%s", project_id, exc_info=True)
        try:
            teams_service.delete_project_access(str(project_id))
        except Exception:
            pass
    _notify_user(
        user["id"],
        {
            "type": "workspace.updated",
            "team_id": team_id,
            "status": "deleted",
            "name": result.get("name"),
        },
    )
    return result


@app.post("/api/teams/{team_id}/invite")
def invite_to_team(team_id: str, body: TeamInviteRequest, request: Request, user: dict[str, Any] = Depends(get_current_user)):
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
    if result.get("status") == "invited" and result.get("invite_id") and result.get("invite_token"):
        try:
            from backend.services import email_notification_service

            with get_conn() as conn:
                team = conn.execute("SELECT name FROM teams WHERE id = ?", (team_id,)).fetchone()
                target_user = conn.execute(
                    "SELECT id FROM users WHERE lower(email)=lower(?)",
                    (body.email.strip().lower(),),
                ).fetchone()
            base = str(getattr(settings, "public_base_url", None) or _request_origin(request)).rstrip("/")
            # Frontend URL (not /api/.../claim): email scanners prefetch GET links and
            # used to consume the invite before the user clicked, then show raw JSON.
            invite_url = (
                f"{base}/?workspace_invite={urllib.parse.quote(str(result['invite_id']))}"
                f"&invite_token={urllib.parse.quote(str(result['invite_token']))}"
            )
            email_result = email_notification_service.send_workspace_invite_email(
                to_email=body.email.strip().lower(),
                inviter_name=user.get("display_name") or user.get("email") or "A teammate",
                team_name=(team["name"] if team else "Render Studio workspace"),
                invite_url=invite_url,
                user_id=(target_user["id"] if target_user else None),
            )
            result["email"] = email_result
            result["invite_url"] = invite_url
        except Exception:
            logger.warning("Could not send workspace invite email team_id=%s email=%s", team_id, body.email, exc_info=True)
    team_name = "Render Studio workspace"
    try:
        with get_conn() as conn:
            team_row = conn.execute("SELECT name FROM teams WHERE id = ?", (team_id,)).fetchone()
            if team_row and team_row["name"]:
                team_name = str(team_row["name"])
    except Exception:
        logger.debug("Could not resolve team name for invite notify team_id=%s", team_id, exc_info=True)
    inviter_name = user.get("display_name") or user.get("email") or "A teammate"
    _notify_user_by_email(
        body.email,
        {
            "type": "team.invite.created",
            "team_id": team_id,
            "team_name": team_name,
            "invite_id": result.get("invite_id"),
            "email": body.email.strip().lower(),
            "by": inviter_name,
            "inviter_name": inviter_name,
            "by_user_id": user["id"],
            "open_chat": True,
            "ping": True,
        },
    )
    return result


def _workspace_invite_claim_redirect(invite_id: str, result: dict[str, Any]) -> RedirectResponse:
    if result.get("status") == "accepted":
        team_id = str(result.get("team", {}).get("id") or "")
        return RedirectResponse(
            url=f"/?workspace_joined={urllib.parse.quote(team_id)}",
            status_code=303,
        )
    email = str(result.get("email") or "")
    team_id = str(result.get("team", {}).get("id") or "")
    return RedirectResponse(
        url=(
            f"/?signup=1&invite_id={urllib.parse.quote(invite_id)}"
            f"&invite_email={urllib.parse.quote(email)}"
            f"&team_id={urllib.parse.quote(team_id)}"
        ),
        status_code=303,
    )


@app.get("/api/teams/invites/{invite_id}/claim")
def claim_team_invite_link(invite_id: str, token: str = Query(..., min_length=1)):
    """Legacy email claim URL. Validates the token, then sends the user to the app
    Accept UI — does not auto-join (email scanners used to consume invites)."""
    try:
        teams_service.peek_team_invite(invite_id, token)
    except ValueError as exc:
        return RedirectResponse(
            url=f"/?invite_error={urllib.parse.quote(str(exc))}",
            status_code=303,
        )
    return RedirectResponse(
        url=(
            f"/?workspace_invite={urllib.parse.quote(invite_id)}"
            f"&invite_token={urllib.parse.quote(token)}"
        ),
        status_code=303,
    )


@app.get("/api/teams/invites/{invite_id}/preview")
def preview_team_invite(invite_id: str, token: str = Query(..., min_length=1)):
    """Safe read of invite details for the Accept modal (no side effects)."""
    try:
        return teams_service.peek_team_invite(invite_id, token)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/teams/invites/{invite_id}/claim")
def claim_team_invite_api(invite_id: str, token: str = Query(..., min_length=1)):
    """JSON claim used when the invitee clicks Accept on /?workspace_invite=…"""
    try:
        return teams_service.claim_team_invite(invite_id, token)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/teams/invites/{invite_id}/decline-token")
def decline_team_invite_by_token(invite_id: str, token: str = Query(..., min_length=1)):
    try:
        return teams_service.decline_team_invite_by_token(invite_id, token)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


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
    shared_key_id = (keys[0].get("id") if keys else None)
    _notify_ai_keys_changed(team_id=team_id, reason="shared", key_id=shared_key_id)
    return {"team_keys": keys, "ai": _ai_status_for_user(user)}


@app.delete("/api/teams/{team_id}/ai-keys/{key_id}")
def delete_team_ai_key(team_id: str, key_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        user_ai_keys_service.delete_team_shared_key(team_id, key_id, user["id"])
    except (ValueError, PermissionError) as exc:
        raise HTTPException(403, str(exc)) from exc
    _notify_ai_keys_changed(team_id=team_id, reason="removed", key_id=key_id)
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
    allowed_models_provided = "allowed_models" in body
    allowed_models = body.get("allowed_models")
    if allowed_models_provided:
        if allowed_models is None:
            allowed_models = []
        elif not isinstance(allowed_models, list):
            raise HTTPException(400, "allowed_models must be a list of model ids")
        allowed_models = [str(m).strip() for m in allowed_models if str(m).strip()]
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
            allowed_models=allowed_models if allowed_models_provided else None,
            allowed_models_provided=allowed_models_provided,
            daily_limit_usd=daily_limit_usd,
            daily_limit_provided=daily_limit_provided,
            daily_token_limit=daily_token_limit,
            daily_token_limit_provided=daily_token_limit_provided,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    reason = "updated"
    if granted is True:
        reason = "granted"
    elif granted is False:
        reason = "revoked"
    elif use_key is True:
        reason = "assigned"
    elif use_key is False:
        reason = "unassigned"
    elif allowed_models_provided:
        reason = "models"
    _notify_ai_keys_changed(
        [target_user_id, user["id"]],
        team_id=team_id,
        reason=reason,
        key_id=key_id,
    )
    return {"members": _members_with_daily_ai_usage(members, key_id)}


@app.get("/api/teams/{team_id}/folders")
def list_workspace_folders(team_id: str, user: dict[str, Any] = Depends(get_current_user)):
    try:
        folders = folders_service.list_folders(team_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    private_projects = _private_project_summaries(user, team_id)
    if private_projects:
        folders.append(_private_folder_summary(private_projects, team_id))
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


def _notify_folder_realtime(
    folder: dict[str, Any],
    *,
    event_type: str,
    user: dict[str, Any],
    target_user_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Push a dedicated folder.* event so teammates see shares/renames without a page refresh."""
    team_id = folder.get("team_id")
    if not team_id:
        return
    payload: dict[str, Any] = {
        "type": event_type,
        "team_id": team_id,
        "folder_id": folder.get("id"),
        "folder": {
            "id": folder.get("id"),
            "team_id": team_id,
            "parent_id": folder.get("parent_id"),
            "name": folder.get("name"),
            "sort_order": folder.get("sort_order", 0),
            "visibility": folder.get("visibility", "workspace"),
            "created_by": folder.get("created_by"),
            "created_at": folder.get("created_at"),
            "project_count": folder.get("project_count", 0),
            "share_count": folder.get("share_count", 0),
        },
        "by": user.get("display_name"),
        "by_user_id": user.get("id"),
    }
    if extra:
        payload.update(extra)
    _notify_workspace(team_id, payload)
    if target_user_id:
        # Recipient may be on another workspace tab; user socket still delivers it.
        _notify_user(target_user_id, payload)


@app.post("/api/teams/{team_id}/folders")
def create_workspace_folder(
    team_id: str,
    body: FolderCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    if not teams_service.member_can_edit(team_id, user["id"]):
        raise HTTPException(
            403,
            "This shared workspace is view-only for your account. Ask the workspace admin for edit access.",
        )
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
    _notify_folder_realtime(folder, event_type="folder.created", user=user)
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
        meta={"folder_id": folder_id, "folder_name": folder["name"]},
    )
    _notify_folder_realtime(folder, event_type="folder.renamed", user=user)
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
        meta={"folder_id": folder_id, "folder_name": folder.get("name")},
    )
    _notify_folder_realtime(folder, event_type="folder.deleted", user=user)
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
    target_user = result.get("user") or {}
    target_user_id = target_user.get("id")
    _log_workspace(
        folder["team_id"],
        kind="folder_shared",
        label=f'Shared folder "{folder["name"]}" with {body.email}',
        user=user,
        meta={
            "folder_id": folder_id,
            "folder_name": folder.get("name"),
            "email": body.email,
            "shared_with_user_id": target_user_id,
        },
    )
    _notify_folder_realtime(
        folder,
        event_type="folder.shared",
        user=user,
        target_user_id=target_user_id,
        extra={
            "shared_with_user_id": target_user_id,
            "shared_with_email": (body.email or "").strip().lower(),
            "shared_with_name": target_user.get("display_name"),
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
        result = folders_service.remove_folder_share(folder_id, target_user_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    folder = folders_service._get_folder(folder_id)
    _log_workspace(
        folder["team_id"],
        kind="folder_unshared",
        label=f'Removed folder share on "{folder["name"]}"',
        user=user,
        meta={
            "folder_id": folder_id,
            "folder_name": folder.get("name"),
            "target_user_id": target_user_id,
        },
    )
    _notify_folder_realtime(
        folder,
        event_type="folder.unshared",
        user=user,
        target_user_id=target_user_id,
        extra={"target_user_id": target_user_id},
    )
    return result


def _notify_project_share_realtime(
    *,
    project_id: str,
    team_id: str,
    event_type: str,
    user: dict[str, Any],
    target_user_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": event_type,
        "team_id": team_id,
        "project_id": project_id,
        "by": user.get("display_name"),
        "by_user_id": user.get("id"),
    }
    if extra:
        payload.update(extra)
    _notify_workspace(team_id, payload)
    if target_user_id:
        _notify_user(target_user_id, payload)


@app.get("/api/projects/{project_id}/shares")
def list_project_shares_route(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        return project_shares_service.list_project_shares(project_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/projects/{project_id}/shares")
def share_project_route(
    project_id: str,
    body: ProjectShareRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        result = project_shares_service.share_project(project_id, str(body.email), user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    target_user = result.get("user") or {}
    target_user_id = result.get("target_user_id") or target_user.get("id")
    team_id = result.get("team_id")
    if result.get("status") == "invited" and result.get("invite_token"):
        try:
            from backend.services import email_notification_service

            project_name = project_id
            try:
                summary = project_store.project_list_summary(PROJECTS / project_id)
                project_name = summary.get("name") or project_id
            except Exception:
                pass
            invite_url = (
                f"https://render3d.app/?project_share={urllib.parse.quote(str(result['invite_token']))}"
            )
            email_notification_service.send_project_share_invite_email(
                to_email=str(body.email),
                inviter_name=user.get("display_name") or user.get("email") or "A teammate",
                project_name=project_name,
                invite_url=invite_url,
                user_id=target_user_id,
            )
        except Exception:
            logger.warning(
                "Could not send project share invite email project_id=%s email=%s",
                project_id,
                body.email,
                exc_info=True,
            )
        if target_user_id:
            _notify_user(
                target_user_id,
                {
                    "type": "project.share.invite",
                    "project_id": project_id,
                    "invite_token": result.get("invite_token"),
                    "by": user.get("display_name") or user.get("email"),
                    "by_user_id": user.get("id"),
                },
            )
    if team_id:
        _log_workspace(
            team_id,
            kind="project_shared",
            label=f'Shared project with {body.email}',
            user=user,
            project_id=project_id,
            meta={
                "email": str(body.email),
                "shared_with_user_id": target_user_id,
                "status": result.get("status"),
            },
        )
        if result.get("status") == "shared":
            _notify_project_share_realtime(
                project_id=project_id,
                team_id=team_id,
                event_type="project.shared",
                user=user,
                target_user_id=target_user_id,
                extra={
                    "shared_with_user_id": target_user_id,
                    "shared_with_email": str(body.email).strip().lower(),
                    "shared_with_name": target_user.get("display_name"),
                },
            )
    return result


@app.post("/api/projects/share-invites/{token}/accept")
def accept_project_share_invite_route(
    token: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        result = project_shares_service.accept_project_share_invite(token, user)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    team_id = result.get("team_id")
    project_id = result.get("project_id")
    if team_id and project_id:
        _notify_project_share_realtime(
            project_id=project_id,
            team_id=team_id,
            event_type="project.shared",
            user=user,
            target_user_id=user["id"],
            extra={"shared_with_user_id": user["id"], "accepted": True},
        )
        _notify_user(user["id"], {"type": "project.share.accepted", "project_id": project_id})
    return result


@app.get("/api/me/project-share-invites")
def list_my_project_share_invites(user: dict[str, Any] = Depends(get_current_user)):
    return {
        "invites": project_shares_service.pending_project_shares_for_user(
            user["id"], user.get("email") or ""
        )
    }


@app.delete("/api/projects/{project_id}/share-invites/{invite_id}")
def cancel_project_share_invite_route(
    project_id: str,
    invite_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        return project_shares_service.cancel_project_share_invite(project_id, invite_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.delete("/api/projects/{project_id}/shares/me")
def leave_project_share_route(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        result = project_shares_service.leave_project_share(project_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    team_id = result.get("team_id")
    if team_id:
        _notify_project_share_realtime(
            project_id=project_id,
            team_id=team_id,
            event_type="project.unshared",
            user=user,
            target_user_id=user["id"],
            extra={"target_user_id": user["id"], "left": True},
        )
    return result


@app.delete("/api/projects/{project_id}/shares/{target_user_id}")
def remove_project_share_route(
    project_id: str,
    target_user_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    try:
        result = project_shares_service.remove_project_share(project_id, target_user_id, user["id"])
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    team_id = result.get("team_id")
    if team_id:
        _log_workspace(
            team_id,
            kind="project_unshared",
            label="Removed project share",
            user=user,
            project_id=project_id,
            meta={"target_user_id": target_user_id},
        )
        _notify_project_share_realtime(
            project_id=project_id,
            team_id=team_id,
            event_type="project.unshared",
            user=user,
            target_user_id=target_user_id,
            extra={"target_user_id": target_user_id},
        )
    return result


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
    shared_ids = project_shares_service.shared_project_ids_for_user(user["id"])
    hidden_ids = project_shares_service.hidden_project_ids_for_user(user["id"])
    projects = []
    for project_id, row in by_project.items():
        if project_id in hidden_ids and project_id not in shared_ids:
            continue
        project_path = PROJECTS / project_id
        if not project_path.is_dir():
            continue
        fid = row.get("folder_id")
        # Shared-with-me bypasses restricted-folder ACL so the project still shows up.
        if fid and project_id not in shared_ids and not folders_service.user_can_access_folder(fid, user["id"]):
            continue
        p = project_store.project_list_summary(project_path)
        p = {
            **p,
            "team_id": row["team_id"],
            "folder_id": None if project_id in shared_ids else fid,
            "folder_name": None if project_id in shared_ids else folders_service.folder_name(fid),
            "sort_order": int(row.get("sort_order") or 0),
            "owner_user_id": row.get("created_by"),
            "owner_email": row.get("owner_email"),
            "owner_name": row.get("owner_name") or (p.get("generation") or {}).get("by_user_name"),
            "shared_with_me": project_id in shared_ids,
            "read_only_project": not teams_service.can_edit_project(user["id"], project_id),
        }
        projects.append(p)
    # Inject shares that aren't already present (e.g. personal-team projects, or
    # projects the user couldn't see due to folder ACL / hide+reshare).
    listed_ids = {p["id"] for p in projects}
    for row in project_shares_service.shared_access_rows_for_user(user["id"], team_id):
        project_id = row["project_id"]
        if project_id in listed_ids:
            continue
        project_path = PROJECTS / project_id
        if not project_path.is_dir():
            continue
        p = project_store.project_list_summary(project_path)
        projects.append(
            {
                **p,
                "team_id": row["team_id"],
                "folder_id": None,
                "folder_name": None,
                "sort_order": int(row.get("sort_order") or 0),
                "owner_user_id": row.get("created_by"),
                "owner_email": row.get("owner_email"),
                "owner_name": row.get("owner_name") or (p.get("generation") or {}).get("by_user_name"),
                "shared_with_me": True,
            }
        )
        listed_ids.add(project_id)
    # Stable sort: newest first within the same sort_order, then ascending sort_order.
    projects.sort(key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)
    projects.sort(key=lambda p: int(p.get("sort_order") or 0))
    private_projects = _private_project_summaries(user, team_id)
    private_ids = {p["id"] for p in private_projects}
    if private_ids:
        projects = [p for p in projects if p.get("id") not in private_ids]
        projects.extend(private_projects)
    projects.extend(_other_user_render_summaries(user, team_id))
    # Public is a virtual folder. Always attach public projects with folder_id=__public__,
    # and remove any earlier copies so they don't also appear under root / other folders.
    public_projects = _public_project_summaries(viewer_user=user)
    public_ids = {p["id"] for p in public_projects}
    if public_ids:
        projects = [p for p in projects if p.get("id") not in public_ids]
        projects.extend(public_projects)
    # Invitees (and multi-workspace views): keep personal root clean by nesting
    # other workspaces' root projects under "{Team} shared workspace".
    projects = _nest_shared_workspace_root_projects(projects, user)
    return {"projects": projects}


@app.get("/api/public/projects")
def list_public_projects():
    return {"folder": _public_folder_summary(), "projects": _public_project_summaries()}


def _public_prompt_entry(entry: dict[str, Any]) -> dict[str, Any] | None:
    prompt = entry.get("prompt") or entry.get("original_prompt")
    if not prompt:
        return None
    return {
        "id": entry.get("id"),
        "prompt": entry.get("prompt") or "",
        "original_prompt": entry.get("original_prompt"),
        "prompt_improved": bool(entry.get("prompt_improved")),
        "success": entry.get("success") is not False,
        "error": entry.get("error"),
        "kind": entry.get("kind") or "cad",
        "filename": entry.get("filename"),
        "base_filename": entry.get("base_filename"),
        "target_mode": entry.get("target_mode"),
        "model": entry.get("model"),
        "provider": entry.get("provider"),
        "prompt_mode": entry.get("prompt_mode") or entry.get("speed"),
        "speed": entry.get("speed"),
        "created_at": entry.get("created_at"),
        "user_id": entry.get("user_id"),
        "user_name": entry.get("user_name"),
        "user_avatar_url": entry.get("user_avatar_url"),
    }


def _public_prompt_history(
    project_path: Path,
    *,
    limit: int = 80,
    base_filename: str | None = None,
    kind: str | None = "cad",
) -> list[dict[str, Any]]:
    try:
        entries = prompt_history_service.list_entries(
            project_path, limit=limit, base_filename=base_filename, kind=kind
        )
    except Exception:
        entries = []
    # Filename filters can miss renamed / sidecar viewers — fall back to project prompts.
    if base_filename and not entries:
        try:
            entries = prompt_history_service.list_entries(project_path, limit=limit, kind=kind)
        except Exception:
            entries = []
    out: list[dict[str, Any]] = []
    for entry in entries:
        row = _public_prompt_entry(entry)
        if row:
            out.append(row)
    return out


def _public_generated_by(project_path: Path, owner: dict[str, Any] | None = None) -> dict[str, Any] | None:
    prompts = _public_prompt_history(project_path, limit=20, kind="cad")
    latest = next((e for e in prompts if e.get("success")), prompts[0] if prompts else None)
    if latest and latest.get("user_name"):
        return {
            "user_id": latest.get("user_id"),
            "display_name": latest.get("user_name"),
            "avatar_url": latest.get("user_avatar_url"),
            "prompt_id": latest.get("id"),
            "created_at": latest.get("created_at"),
            "filename": latest.get("filename"),
        }
    if owner and owner.get("owner_name"):
        return {
            "user_id": owner.get("created_by") or owner.get("owner_user_id"),
            "display_name": owner.get("owner_name"),
            "avatar_url": None,
            "prompt_id": None,
            "created_at": None,
            "filename": None,
        }
    return None


def _absolute_public_url(path: str, request: Request | None = None) -> str:
    base = str(getattr(settings, "public_base_url", None) or (_public_origin(request) if request else "https://render3d.app")).rstrip("/")
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{base}/{path.lstrip('/')}"


def _public_project_latest_prompt(project_path: Path) -> dict[str, Any] | None:
    prompts = _public_prompt_history(project_path, limit=20, kind="cad")
    return next((e for e in prompts if e.get("success")), prompts[0] if prompts else None)


def _public_project_preview_url(project_id: str, project_path: Path, latest_file: str | None, request: Request | None = None) -> str | None:
    if not latest_file:
        return None
    try:
        meta = share_preview.share_preview_image_meta(
            project_path,
            latest_file,
            resolve_viewport=cad_service.resolve_viewport_filename,
        )
        preview_file = meta.get("preview_file")
    except Exception:
        logger.debug("Could not build public Discord preview project_id=%s", project_id, exc_info=True)
        preview_file = None
    if not preview_file:
        preview_file = share_preview.share_snapshot_filename(
            project_path,
            latest_file,
            resolve_viewport=cad_service.resolve_viewport_filename,
        )
    if not preview_file:
        return None
    return _absolute_public_url(
        f"/api/public/projects/{project_id}/files/{urllib.parse.quote(Path(preview_file).name)}",
        request,
    )


def _announce_public_project_to_discord(project_id: str, request_origin: str | None = None) -> None:
    channel_id = str(getattr(settings, "discord_public_models_channel_id", "") or "").strip()
    if not channel_id:
        return
    try:
        from backend.services import discord_updates_service as discord

        project_path = PROJECTS / project_id
        if not project_path.is_dir() or not _is_public_project(project_id):
            return
        owner = _project_owner(project_id) or {}
        summary = project_store.project_summary(project_path)
        latest_file = summary.get("latest_file") or project_store.latest_model_file(project_path)
        prompt = _public_project_latest_prompt(project_path)
        generated_by = _public_generated_by(project_path, owner) or {}
        username = (
            generated_by.get("display_name")
            or owner.get("owner_name")
            or (prompt or {}).get("user_name")
            or "Render Studio user"
        )
        description = _admin_prompt_preview(
            (prompt or {}).get("prompt")
            or (prompt or {}).get("original_prompt")
            or f"Public Render Studio model with {summary.get('file_count') or 0} project file(s).",
            700,
        )
        base = str(request_origin or getattr(settings, "public_base_url", None) or "https://render3d.app").rstrip("/")
        view_url = f"{base}/?project={urllib.parse.quote(project_id)}"
        preview_url = _public_project_preview_url(project_id, project_path, latest_file)
        embed: dict[str, Any] = {
            "title": str(summary.get("name") or project_id)[:256],
            "url": view_url,
            "description": description[:4000],
            "color": 0xF97316,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "author": {"name": str(username)[:256]},
            "fields": [
                {"name": "Creator", "value": str(username)[:1024], "inline": True},
                {"name": "View", "value": f"[Open public model]({view_url})", "inline": True},
            ],
            "footer": {"text": "Render Studio public model"},
        }
        if latest_file:
            embed["fields"].append({"name": "File", "value": str(latest_file)[:1024], "inline": True})
        if preview_url:
            embed["image"] = {"url": preview_url}
        payload = {
            "content": f"New public Render Studio model from **{str(username)[:80]}**",
            "embeds": [embed],
            "allowed_mentions": {"parse": []},
        }
        discord.send_channel_message(payload, channel_id=channel_id)
    except Exception:
        logger.warning("Could not announce public project to Discord project_id=%s", project_id, exc_info=True)


@app.get("/api/public/projects/{project_id}")
def get_public_project(project_id: str):
    if not _is_public_project(project_id):
        raise HTTPException(404, "Project not found")
    project_path = PROJECTS / project_id
    owner = _project_owner(project_id) or {}
    summary = project_store.project_summary(project_path)
    prompts = _public_prompt_history(project_path, limit=80, kind="cad")
    generated_by = _public_generated_by(project_path, owner)
    summary.update(
        {
            "folder_id": PUBLIC_FOLDER_ID,
            "read_only_project": True,
            "public": True,
            "owner_user_id": owner.get("created_by"),
            "owner_email": owner.get("owner_email"),
            "owner_name": owner.get("owner_name"),
            "generated_by": generated_by,
            "prompt_history": prompts,
            "prompt_count": len(prompts),
        }
    )
    return summary


@app.get("/api/public/projects/{project_id}/prompt-history")
def get_public_prompt_history(
    project_id: str,
    limit: int = Query(80, ge=1, le=200),
    base_filename: str | None = Query(None),
    kind: str | None = Query("cad", description="Filter by prompt kind: cad or wiring"),
):
    if not _is_public_project(project_id):
        raise HTTPException(404, "Project not found")
    project_path = PROJECTS / project_id
    entries = _public_prompt_history(
        project_path, limit=limit, base_filename=base_filename, kind=kind
    )
    owner = _project_owner(project_id) or {}
    return {
        "entries": entries,
        "generated_by": _public_generated_by(project_path, owner),
        "usage_summary": None,
        "filtered_usage_summary": None,
    }


@app.get("/api/public/projects/{project_id}/project-history")
def get_public_project_history(
    project_id: str,
    limit: int = Query(150, ge=1, le=300),
):
    if not _is_public_project(project_id):
        raise HTTPException(404, "Project not found")
    project_path = PROJECTS / project_id
    entries = []
    for entry in project_log_service.list_events(project_path, limit=limit):
        row = dict(entry)
        # Public viewers can inspect history but not restore timeline snapshots.
        row["restorable"] = False
        meta = dict(row.get("meta") or {})
        # Keep generator identity; drop internal-only noise if present.
        row["meta"] = {
            k: meta.get(k)
            for k in ("prompt", "prompt_id", "model", "provider", "prompt_mode", "speed", "success", "source")
            if meta.get(k) is not None
        }
        entries.append(row)
    return {"entries": entries, "generated_by": _public_generated_by(project_path, _project_owner(project_id) or {})}


@app.post("/api/projects/{project_id}/public")
def set_project_public(
    project_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    body: dict = Body({}),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    make_public = bool(body.get("public", True))
    was_public = False
    with get_conn() as conn:
        row = conn.execute(
            "SELECT is_public FROM project_access WHERE project_id = ?",
            (project_id,),
        ).fetchone()
        was_public = bool(row["is_public"]) if row else False
        conn.execute(
            "UPDATE project_access SET is_public = ? WHERE project_id = ?",
            (1 if make_public else 0, project_id),
        )
        conn.commit()
    if make_public and not was_public:
        background_tasks.add_task(_announce_public_project_to_discord, project_id, _public_origin(request))
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
    if not teams_service.member_can_edit(tid, user["id"]):
        raise HTTPException(
            403,
            "This shared workspace is view-only for your account. Ask the workspace admin for edit access.",
        )
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
            "by_user_name": user["display_name"],
            "owner_user_id": user["id"],
            "owner_name": user["display_name"],
            "owner_email": user.get("email"),
            "folder_id": None,
            "sort_order": 0,
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at") or meta.get("created_at"),
            "generation": {"status": "idle"},
        },
    )
    return {"project_id": project_id, "team_id": tid, "meta": meta}


@app.post("/api/demo/robot-arm")
def seed_robot_arm_demo_project(
    user: dict[str, Any] = Depends(get_current_user),
    team_id: str | None = Query(None),
    force_new: bool = Query(False),
):
    """Spin up a private Robot Arm project (from template 505279e3) for demos / Show Me tours."""
    from backend.services import demo_template_service

    try:
        result = demo_template_service.seed_robot_arm_project(
            PROJECTS,
            user,
            team_id=team_id,
            force_new=force_new,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(400, str(exc)) from exc

    if result.get("created"):
        meta = result.get("meta") or {}
        tid = result.get("team_id")
        project_id = result["project_id"]
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
                "by_user_name": user["display_name"],
                "owner_user_id": user["id"],
                "owner_name": user["display_name"],
                "owner_email": user.get("email"),
                "folder_id": None,
                "sort_order": 0,
                "created_at": meta.get("created_at"),
                "updated_at": meta.get("updated_at") or meta.get("created_at"),
                "generation": {"status": "idle"},
                "demo_template": "robot-arm",
            },
        )
        _record_history(
            cad_service.project_dir(PROJECTS, project_id),
            "demo_seed",
            "Seeded Robot Arm demo from template",
            result.get("filename"),
            meta={
                "demo_template": "robot-arm",
                "source_project_id": result.get("source_project_id") or "505279e3",
                "copied_files": result.get("copied_files") or [],
            },
            user=user,
        )
    return result


@app.get("/api/projects/{project_id}")
def get_project(
    project_id: str,
    view: str | None = Query(None, max_length=40),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project_read(user, project_id)
    summary = (
        project_store.project_wiring_summary(path)
        if str(view or "").lower() == "wiring"
        else project_store.project_summary(path)
    )
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
    else:
        summary["read_only_project"] = not teams_service.can_edit_project(user["id"], project_id)
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
    cache_key = (user["id"], team_id or "", kind or "", year, mon)
    now = time.monotonic()
    with _ai_usage_cache_lock:
        cached = _ai_usage_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

    access = teams_service.user_project_access(user["id"], team_id)
    paths = [PROJECTS / row["project_id"] for row in access if (PROJECTS / row["project_id"]).is_dir()]
    summary = prompt_history_service.workspace_usage_summary(
        paths, kind=kind, year=year, month=mon, user_id=user["id"]
    )
    with _ai_usage_cache_lock:
        _ai_usage_cache[cache_key] = (time.monotonic() + _AI_USAGE_CACHE_TTL, summary)
        if len(_ai_usage_cache) > _AI_USAGE_CACHE_MAX:
            for drop_key in list(_ai_usage_cache.keys())[: len(_ai_usage_cache) // 2]:
                _ai_usage_cache.pop(drop_key, None)
    return summary


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
                 AND (k.shared_by = tm.user_id OR COALESCE(g.granted, 0) = 1)
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
    summary = history_service.timeline_summary(path)
    for entry in summary.get("entries") or []:
        if entry.get("user_id") and not entry.get("user_avatar_url"):
            entry["user_avatar_url"] = _avatar_url_for_user_id(entry.get("user_id"))
    return summary


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


def _project_chat_members(project_id: str) -> list[dict[str, Any]]:
    team_id = teams_service.project_team_id(project_id)
    members: list[dict[str, Any]] = []
    if team_id:
        try:
            with get_conn() as conn:
                try:
                    rows = conn.execute(
                        """
                        SELECT u.id, u.email, u.display_name, u.avatar_url, u.handle
                          FROM team_members tm
                          JOIN users u ON u.id = tm.user_id
                         WHERE tm.team_id = ?
                         ORDER BY lower(u.display_name), lower(u.email)
                        """,
                        (team_id,),
                    ).fetchall()
                except Exception:
                    rows = conn.execute(
                        """
                        SELECT u.id, u.email, u.display_name, u.avatar_url
                          FROM team_members tm
                          JOIN users u ON u.id = tm.user_id
                         WHERE tm.team_id = ?
                         ORDER BY lower(u.display_name), lower(u.email)
                        """,
                        (team_id,),
                    ).fetchall()
            members = [dict(row) for row in rows]
        except Exception:
            members = []
    if not members:
        owner = _project_owner(project_id) or {}
        if owner.get("created_by"):
            members = [
                {
                    "id": owner.get("created_by"),
                    "email": owner.get("owner_email"),
                    "display_name": owner.get("owner_name"),
                    "avatar_url": _avatar_url_for_user_id(owner.get("created_by")),
                }
            ]
    return members


def _project_workspace_role(project_id: str, user_id: str | None) -> str | None:
    if not user_id:
        return None
    team_id = teams_service.project_team_id(project_id)
    if not team_id:
        return None
    return teams_service.get_member_role(team_id, user_id)


PUBLIC_CHAT_SCOPE_ID = "render3d-public"


def _public_chat_scope_id(project_id: str | None = None) -> str:
    """Stable storage scope for the public Render Studio room.

    Project/private threads remain project-scoped, but the general public chat
    must survive project and workspace switches.
    """
    return PUBLIC_CHAT_SCOPE_ID


def _chat_image_public_url(project_id: str, image: dict[str, Any]) -> dict[str, Any]:
    stored = Path(str(image.get("stored_name") or image.get("url") or "")).name
    return {
        **image,
        "url": f"/api/projects/{project_id}/chat/media/{urllib.parse.quote(stored)}",
    }


def _decorate_chat_message(project_id: str, message: dict[str, Any]) -> dict[str, Any]:
    row = dict(message)
    row["images"] = [_chat_image_public_url(project_id, img) for img in (row.get("images") or [])]
    return row


def _is_blocked_preview_host(hostname: str | None) -> bool:
    host = (hostname or "").strip().strip("[]").lower()
    if not host:
        return True
    if host in {"localhost", "metadata.google.internal"} or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except Exception:
        return True
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except Exception:
            return True
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return True
    return False


def _clean_link_preview_value(value: Any, limit: int = 240) -> str:
    text = html.unescape(str(value or "")).strip()
    text = re.sub(r"\s+", " ", text)
    return text[:limit]


def _html_meta_value(source: str, key: str) -> str:
    pattern = re.compile(
        r"<meta\b(?=[^>]*(?:property|name)\s*=\s*['\"]"
        + re.escape(key)
        + r"['\"])(?=[^>]*content\s*=\s*(['\"])(.*?)\1)[^>]*>",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(source)
    return _clean_link_preview_value(match.group(2), 500) if match else ""


def _html_title_value(source: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", source, re.IGNORECASE | re.DOTALL)
    return _clean_link_preview_value(match.group(1), 180) if match else ""


async def _fetch_link_preview(url: str) -> dict[str, Any] | None:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or _is_blocked_preview_host(parsed.hostname):
        return None
    normalized = urllib.parse.urlunparse(parsed._replace(fragment=""))
    now = time.time()
    with _link_preview_cache_lock:
        cached = _link_preview_cache.get(normalized)
        if cached and now - cached[0] < _LINK_PREVIEW_CACHE_TTL:
            return cached[1]

    import httpx

    headers = {
        "User-Agent": "Render3D-LinkPreview/1.0 (+https://render3d.app)",
        "Accept": "text/html,application/xhtml+xml",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0), follow_redirects=True, max_redirects=3) as client:
            async with client.stream("GET", normalized, headers=headers) as resp:
                final = urllib.parse.urlparse(str(resp.url))
                if final.scheme not in {"http", "https"} or _is_blocked_preview_host(final.hostname):
                    return None
                content_type = (resp.headers.get("content-type") or "").lower()
                if resp.status_code >= 400 or ("text/html" not in content_type and "application/xhtml" not in content_type):
                    return None
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    if not chunk:
                        continue
                    chunks.append(chunk)
                    total += len(chunk)
                    if total >= 256_000:
                        break
        raw = b"".join(chunks)
        source = raw.decode("utf-8", errors="ignore")
    except Exception:
        return None

    title = _html_meta_value(source, "og:title") or _html_meta_value(source, "twitter:title") or _html_title_value(source)
    description = _html_meta_value(source, "og:description") or _html_meta_value(source, "twitter:description") or _html_meta_value(source, "description")
    image = _html_meta_value(source, "og:image") or _html_meta_value(source, "twitter:image")
    if image:
        image = urllib.parse.urljoin(str(final.geturl()), image)
        image_parsed = urllib.parse.urlparse(image)
        if image_parsed.scheme not in {"http", "https"} or _is_blocked_preview_host(image_parsed.hostname):
            image = ""
    if not title and not description and not image:
        preview = None
    else:
        preview = {
            "url": normalized,
            "final_url": str(final.geturl()),
            "site": final.netloc,
            "title": title,
            "description": description,
            "image": image,
        }
    with _link_preview_cache_lock:
        _link_preview_cache[normalized] = (now, preview)
        if len(_link_preview_cache) > _LINK_PREVIEW_CACHE_MAX:
            for key in list(_link_preview_cache.keys())[: len(_link_preview_cache) - _LINK_PREVIEW_CACHE_MAX]:
                _link_preview_cache.pop(key, None)
    return preview


def _notify_chat_message(project_id: str, thread: dict[str, Any], message: dict[str, Any], user: dict[str, Any]) -> None:
    payload = {
        "type": "project.chat.message",
        "project_id": project_id,
        "thread_id": thread.get("id"),
        "thread_title": thread.get("title"),
        "message": _decorate_chat_message(project_id, message),
        "by_user_id": user.get("id"),
        "by_user_name": user.get("display_name"),
    }
    hub.notify(project_id, payload)
    _notify_project_workspace(project_id, payload)
    mentioned_ids = {
        str(m.get("id"))
        for m in (message.get("mentions") or [])
        if m.get("type") == "user" and m.get("id")
    }
    for uid in mentioned_ids:
        if uid == user.get("id"):
            continue
        _notify_discord_chat_mention(uid, project_id, thread, message, user)
        _notify_user(
            uid,
            {
                **payload,
                "type": "project.chat.mention",
                "mention": True,
            },
        )


def _notify_discord_chat_mention(
    user_id: str,
    project_id: str,
    thread: dict[str, Any],
    message: dict[str, Any],
    sender: dict[str, Any],
) -> None:
    def _run() -> None:
        try:
            from backend.services import discord_link_service

            account = discord_link_service.linked_account(user_id)
            discord_user_id = account.get("discord_user_id") if account else None
            if not discord_user_id:
                return
            project_name = project_id
            try:
                project_path = PROJECTS / project_id
                if project_path.is_dir():
                    project_name = project_store.project_list_summary(project_path).get("name") or project_id
            except Exception:
                project_name = project_id
            body = str(message.get("body") or "").strip()
            if len(body) > 240:
                body = body[:237] + "..."
            thread_title = thread.get("title") or "Project chat"
            sender_name = sender.get("display_name") or sender.get("email") or "A teammate"
            url = f"{(settings.public_base_url or 'https://render3d.app').rstrip('/')}/?project={urllib.parse.quote(project_id)}"
            discord_link_service.send_dm(
                str(discord_user_id),
                (
                    f"{sender_name} tagged you in Render Studio on **{project_name}** ({thread_title}).\n"
                    f"> {body or 'Open Render Studio to view the message.'}\n"
                    f"Open it here: {url}\n\n"
                    "Reply support through Discord requires the Render bot Gateway listener to be running."
                ),
            )
        except Exception:
            logger.debug("Could not send Discord mention DM user_id=%s project_id=%s", user_id, project_id, exc_info=True)

    threading.Thread(target=_run, daemon=True).start()


def _maybe_reply_as_render_agent(
    project_path: Path,
    project_id: str,
    thread: dict[str, Any],
    message: dict[str, Any],
    user: dict[str, Any],
    background_tasks: BackgroundTasks,
    workspace_id: str | None = None,
) -> None:
    mentions = message.get("mentions") or []
    if not any(m.get("type") == "agent" for m in mentions):
        return

    def _run() -> None:
        from backend.services import project_chat_service

        who = user.get("display_name") or "there"
        raw_body = str(message.get("body") or "")
        # Strip rich mention tokens so the model answers the actual question.
        clean_body = re.sub(
            r"@\[[^\]]+\]\((?:user|agent):[^)]+\)",
            "",
            raw_body,
        ).strip() or raw_body
        reply_text = (
            f"Thanks for the ping, {who}. "
            "I'm here — ask me about modeling steps, prompts, or how to use Render Studio."
        )
        try:
            ai = _sam_ai_service()
            system = (
                "You are the Render Agent inside a Render Studio project collaboration chat. "
                "Reply helpfully and concisely (2-6 short sentences). "
                "Focus on CAD, prompts, modeling steps, and Render Studio product guidance. "
                "Do not invent file names or claim you already edited the model."
            )
            user_content = (
                f"Project: {project_id}\n"
                f"User ({who}): {clean_body}"
            )
            answer, _trace = ai._call_model(
                system,
                user_content,
                trace_id=new_trace_id(),
                images=None,
                max_tokens=900,
                json_response=False,
            )
            reply_text = str(answer or "").strip() or reply_text
        except Exception as exc:
            logger.warning("Render Agent chat LLM failed for %s: %s", project_id, exc)
            reply_text = (
                f"I saw your ping, {who}. "
                "I couldn't complete a full answer just now. "
                "Open the Render Agent panel for a deeper help thread, or ask again in a moment."
            )
        try:
            agent_msg = project_chat_service.post_message(
                project_path,
                thread_id=thread["id"],
                body=reply_text[:4000],
                user=user,
                parent_id=message.get("id"),
                as_agent=True,
                workspace_id=workspace_id,
            )
            _notify_chat_message(
                project_id,
                thread,
                agent_msg,
                {"id": "render-agent", "display_name": "Render Agent"},
            )
        except Exception as exc:
            logger.warning("Render Agent chat reply post failed for %s: %s", project_id, exc)

    background_tasks.add_task(_run)


@app.get("/api/projects/{project_id}/chat/threads")
def list_project_chat_threads(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    public_scope = _public_chat_scope_id(project_id)
    threads = project_chat_service.list_threads(path, user, workspace_role=role, workspace_id=public_scope)
    unread = project_chat_service.unread_summary(path, user["id"], workspace_id=public_scope)
    return {"threads": threads, "unread": unread, "workspace_role": role}


@app.post("/api/projects/{project_id}/chat/threads")
def create_project_chat_thread(
    project_id: str,
    body: ProjectChatThreadCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    allowed_ids = {str(m.get("id")) for m in _project_chat_members(project_id) if m.get("id")}
    invite_ids = [str(uid) for uid in (body.invite_user_ids or []) if str(uid) in allowed_ids]
    thread = project_chat_service.create_thread(
        path,
        title=body.title,
        user=user,
        visibility=body.visibility,
        workspace_role=role,
        kind=body.kind,
        invite_user_ids=invite_ids,
        workspace_id=_public_chat_scope_id(project_id),
    )
    return {"thread": thread}


@app.get("/api/projects/{project_id}/chat/threads/{thread_id}")
def get_project_chat_thread(
    project_id: str,
    thread_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    public_scope = _public_chat_scope_id(project_id)
    thread = project_chat_service.get_thread(path, thread_id, user=user, workspace_role=role, workspace_id=public_scope)
    if not thread:
        raise HTTPException(404, "Thread not found")
    thread["messages"] = [_decorate_chat_message(project_id, m) for m in thread.get("messages") or []]
    return {"thread": thread, "unread": project_chat_service.unread_summary(path, user["id"], workspace_id=public_scope)}


@app.post("/api/projects/{project_id}/chat/threads/{thread_id}/members")
def invite_project_chat_thread_member(
    project_id: str,
    thread_id: str,
    body: ProjectChatThreadInviteRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    # Invitee must already be on the project team.
    allowed_ids = {str(m.get("id")) for m in _project_chat_members(project_id) if m.get("id")}
    if str(body.user_id) not in allowed_ids:
        raise HTTPException(400, "Invitee must be a workspace teammate on this project")
    try:
        thread = project_chat_service.add_thread_member(
            path,
            thread_id=thread_id,
            target_user_id=body.user_id,
            requester=user,
            workspace_role=role,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"thread": thread}


@app.patch("/api/projects/{project_id}/chat/threads/{thread_id}")
def update_project_chat_thread_settings(
    project_id: str,
    thread_id: str,
    body: ProjectChatThreadSettingsRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    try:
        thread = project_chat_service.update_thread_settings(
            path,
            thread_id=thread_id,
            requester=user,
            workspace_role=role,
            title=body.title,
            visibility=body.visibility,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"thread": thread}


@app.delete("/api/projects/{project_id}/chat/threads/{thread_id}/members/{user_id}")
def remove_project_chat_thread_member(
    project_id: str,
    thread_id: str,
    user_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    try:
        thread = project_chat_service.remove_thread_member(
            path,
            thread_id=thread_id,
            target_user_id=user_id,
            requester=user,
            workspace_role=role,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"thread": thread}


@app.get("/api/projects/{project_id}/chat/mention-candidates")
def list_chat_mention_candidates(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import project_chat_service

    _require_project_read(user, project_id)
    members = _project_chat_members(project_id)
    return {"candidates": project_chat_service.mention_candidates(members)}


@app.get("/api/projects/{project_id}/chat/unread")
def get_project_chat_unread(project_id: str, user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    return project_chat_service.unread_summary(path, user["id"], workspace_id=_public_chat_scope_id(project_id))


@app.post("/api/projects/{project_id}/chat/link-preview")
async def get_project_chat_link_preview(
    project_id: str,
    body: ProjectChatLinkPreviewRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_project_read(user, project_id)
    return {"preview": await _fetch_link_preview(body.url)}


@app.post("/api/projects/{project_id}/chat/threads/{thread_id}/messages")
async def post_project_chat_message(
    project_id: str,
    thread_id: str,
    background_tasks: BackgroundTasks,
    body: str = Form(""),
    parent_id: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    public_scope = _public_chat_scope_id(project_id)
    thread = project_chat_service.get_thread(path, thread_id, user=user, workspace_role=role, workspace_id=public_scope)
    if not thread:
        raise HTTPException(404, "Thread not found")
    saved_images: list[dict[str, Any]] = []
    message_id = str(uuid.uuid4())[:10]
    image_root = path
    if thread.get("slug") == "general" or thread.get("scope") == "workspace":
        image_root = project_chat_service.workspace_chat_root(public_scope) or path
    for index, upload in enumerate((images or [])[:6]):
        try:
            saved = project_chat_service.save_chat_image(image_root, upload, message_id=message_id, index=index)
        except Exception:
            saved = None
        if saved:
            saved_images.append(saved)
    members = _project_chat_members(project_id)
    candidates = project_chat_service.mention_candidates(members)
    try:
        message = project_chat_service.post_message(
            path,
            thread_id=thread["id"],
            body=body or "",
            user=user,
            parent_id=parent_id or None,
            images=saved_images,
            mention_candidates_list=candidates,
            message_id=message_id,
            workspace_role=role,
            workspace_id=public_scope,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    # Preserve pre-allocated id when possible by rewriting file if empty images used random id —
    # post_message assigns its own id; that's fine.
    decorated = _decorate_chat_message(project_id, message)
    _notify_chat_message(project_id, thread, message, user)
    _maybe_reply_as_render_agent(path, project_id, thread, message, user, background_tasks, workspace_id=public_scope)
    return {"message": decorated, "unread": project_chat_service.unread_summary(path, user["id"], workspace_id=public_scope)}


@app.patch("/api/projects/{project_id}/chat/threads/{thread_id}/messages/{message_id}")
def edit_project_chat_message(
    project_id: str,
    thread_id: str,
    message_id: str,
    body: ProjectChatMessageEditRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    public_scope = _public_chat_scope_id(project_id)
    thread = project_chat_service.get_thread(
        path, thread_id, user=user, workspace_role=role, workspace_id=public_scope
    )
    if not thread:
        raise HTTPException(404, "Thread not found")
    members = _project_chat_members(project_id)
    candidates = project_chat_service.mention_candidates(members)
    try:
        message = project_chat_service.edit_message(
            path,
            thread_id=thread["id"],
            message_id=message_id,
            body=body.body,
            user=user,
            mention_candidates_list=candidates,
            workspace_role=role,
            workspace_id=public_scope,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    decorated = _decorate_chat_message(project_id, message)
    payload = {
        "type": "project.chat.message.edited",
        "project_id": project_id,
        "thread_id": thread.get("id"),
        "thread_title": thread.get("title"),
        "message": decorated,
        "by_user_id": user.get("id"),
        "by_user_name": user.get("display_name"),
    }
    hub.notify(project_id, payload)
    _notify_project_workspace(project_id, payload)
    return {"message": decorated}


@app.post("/api/projects/{project_id}/chat/threads/{thread_id}/messages/{message_id}/reactions")
def react_project_chat_message(
    project_id: str,
    thread_id: str,
    message_id: str,
    body: ProjectChatReactionRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    public_scope = _public_chat_scope_id(project_id)
    try:
        message = project_chat_service.toggle_reaction(
            path, thread_id=thread_id, message_id=message_id, emoji=body.emoji, user=user, workspace_id=public_scope
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    payload = {
        "type": "project.chat.reaction",
        "project_id": project_id,
        "thread_id": thread_id,
        "message": _decorate_chat_message(project_id, message),
    }
    hub.notify(project_id, payload)
    return {"message": _decorate_chat_message(project_id, message)}


@app.post("/api/projects/{project_id}/chat/read")
def mark_project_chat_read(
    project_id: str,
    body: ProjectChatReadRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    public_scope = _public_chat_scope_id(project_id)
    cursor = project_chat_service.mark_read(
        path, user_id=user["id"], thread_id=body.thread_id, message_id=body.message_id, workspace_id=public_scope
    )
    return {"ok": True, "read_cursor": cursor, "unread": project_chat_service.unread_summary(path, user["id"], workspace_id=public_scope)}


@app.post("/api/projects/{project_id}/chat/threads/{thread_id}/assist")
def project_chat_assist_event(
    project_id: str,
    thread_id: str,
    body: ProjectChatAssistRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    role = _project_workspace_role(project_id, user.get("id"))
    public_scope = _public_chat_scope_id(project_id)
    thread = project_chat_service.get_thread(path, thread_id, user=user, workspace_role=role, workspace_id=public_scope)
    if not thread:
        raise HTTPException(404, "Thread not found")
    action = str(body.action or "").strip().lower().replace("-", "_")
    allowed = {
        "facetime",
        "screen_share",
        "remote_assist",
        "remote_control_request",
        "remote_control_grant",
        "remote_control_end",
        "click_ripple",
        "assist_end",
    }
    if action not in allowed:
        raise HTTPException(400, "Unsupported assist action")
    payload = {
        "type": "project.chat.assist",
        "project_id": project_id,
        "thread_id": thread_id,
        "thread_title": thread.get("title"),
        "action": action,
        "x": body.x,
        "y": body.y,
        "note": body.note,
        "by_user_id": user.get("id"),
        "by_user_name": user.get("display_name") or user.get("email") or "User",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    hub.notify(project_id, payload)
    _notify_project_workspace(project_id, payload)
    return {"ok": True, "event": payload}


@app.get("/api/projects/{project_id}/chat/media/{filename}")
def get_project_chat_media(
    project_id: str,
    filename: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import project_chat_service

    path = _require_project_read(user, project_id)
    media = project_chat_service.resolve_media_path(path, filename, workspace_id=_public_chat_scope_id(project_id))
    if not media:
        raise HTTPException(404, "Media not found")
    return FileResponse(media)


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
    history_kind: str | None = Form(None),
    history_label: str | None = Form(None),
    reference_folder: str | None = Form(None),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    suffix = Path(file.filename or "").suffix.lower()
    is_reference = cad_service.is_reference_suffix(suffix)
    if suffix not in cad_service.SUPPORTED_IMPORT and not is_reference and suffix not in cad_service.SUPPORTED_ROBOT:
        raise HTTPException(
            400,
            f"Unsupported format. Use: {sorted(cad_service.SUPPORTED_IMPORT | cad_service.SUPPORTED_REFERENCE | cad_service.SUPPORTED_ROBOT)}",
        )

    if suffix in cad_service.SUPPORTED_ROBOT:
        dest = path / (file.filename or f"robot{suffix}")
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
        project_store.touch_project(path)
        _notify_project(
            project_id,
            {
                "type": "robot.artifact_added",
                "filename": dest.name,
                "url": f"/api/projects/{project_id}/files/{dest.name}",
                "uploaded_filename": dest.name,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "action": "upload_robot",
            },
        )
        return {
            "filename": dest.name,
            "viewer_filename": dest.name,
            "url": f"/api/projects/{project_id}/files/{dest.name}",
            "timeline_index": None,
            "robot": True,
            "kind": "robot",
        }

    if is_reference:
        folder = (reference_folder or "").strip() or None
        try:
            dest = cad_service.unique_reference_path(
                path,
                file.filename or f"reference{suffix}",
                folder=folder,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        project_store.touch_project(path)
        folder_name = dest.parent.name if dest.parent.name in cad_service.REFERENCE_SUBFOLDERS else None
        from urllib.parse import quote

        file_key = f"{folder_name}/{dest.name}" if folder_name else dest.name
        file_url = f"/api/projects/{project_id}/files/{quote(file_key, safe='')}"
        _notify_project(
            project_id,
            {
                "type": "reference.added",
                "filename": dest.name,
                "kind": cad_service.reference_kind(dest.name),
                "folder": folder_name,
                "url": file_url,
                "uploaded_filename": dest.name,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "action": "upload_reference",
            },
        )
        return {
            "filename": dest.name,
            "viewer_filename": dest.name,
            "url": file_url,
            "timeline_index": None,
            "reference": True,
            "folder": folder_name,
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

    # Fusion .f3z / zip: extract embedded STEP/mesh when present.
    extracted_note = None
    if suffix in cad_service.ARCHIVE_CAD_SUFFIXES:
        from backend.services.cad_reference_geometry import extract_cad_from_archive

        extracted = extract_cad_from_archive(dest, path)
        if extracted is not None:
            dest = extracted
            suffix = dest.suffix.lower()
            extracted_note = f"Extracted {dest.name} from archive for geometry preview."
        else:
            raise HTTPException(
                422,
                f"Uploaded {dest.name}, but no STEP/STL/GLB was found inside. "
                "From Fusion/SolidWorks export STEP or STL and upload that so the AI can read geometry.",
            )

    if suffix in cad_service.PROPRIETARY_CAD_SUFFIXES:
        raise HTTPException(
            422,
            f"{suffix} is a proprietary CAD format this server cannot tessellate directly. "
            "Export STEP (.step/.stp) or a mesh (.stl/.glb/.3mf) from Fusion/SolidWorks and upload that.",
        )

    # Browser can load STL/OBJ/GLB/GLTF natively. Everything else needs a GLB sidecar.
    viewer_filename = dest.name
    preview_pending = False
    needs_viewer_glb = (
        suffix in {".3mf", ".ply", ".off"}
        | cad_service.STEP_SUFFIXES
        | cad_service.IGES_SUFFIXES
        | cad_service.BREP_SUFFIXES
    )
    if needs_viewer_glb:
        glb_dest = dest.with_suffix(".glb")
        try:
            if suffix in cad_service.STEP_SUFFIXES:
                # Large McMaster STEPs take minutes — never block the upload worker.
                # Cache reuse / background build; client polls GLB (503 → retry).
                viewer_filename = glb_dest.name
                if glb_dest.is_file() and glb_dest.stat().st_size > 0:
                    preview_pending = False
                else:
                    reused = cad_service._try_reuse_cached_preview_glb(dest, glb_dest)
                    if reused is not None and glb_dest.is_file():
                        preview_pending = False
                    else:
                        preview_pending = True

                        def _on_preview_ready(out: Path | None, err: BaseException | None, *,
                                              _pid: str = project_id, _dest_name: str = dest.name,
                                              _glb_name: str = glb_dest.name,
                                              _by: str = user["display_name"],
                                              _uid: str = user["id"]) -> None:
                            if err is not None or out is None or not Path(out).is_file():
                                _notify_project(
                                    _pid,
                                    {
                                        "type": "model.preview_failed",
                                        "filename": _glb_name,
                                        "uploaded_filename": _dest_name,
                                        "error": str(err) if err else "preview build failed",
                                    },
                                )
                                return
                            _notify_project(
                                _pid,
                                {
                                    "type": "model.reload",
                                    "filename": _glb_name,
                                    "uploaded_filename": _dest_name,
                                    "url": f"/api/projects/{_pid}/files/{_glb_name}",
                                    "by": _by,
                                    "by_user_id": _uid,
                                    "action": "preview_ready",
                                },
                            )

                        cad_service.schedule_tessellate_step_to_glb(
                            dest, glb_dest, on_done=_on_preview_ready
                        )
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

    kind_key = str(history_kind or "upload").strip().lower()
    record_kind = _UPLOAD_HISTORY_KIND_ALIASES.get(kind_key, "upload")
    label_override = str(history_label or "").strip()
    if record_kind == "texture":
        record_label = label_override or f"Applied texture · {dest.name}"
    elif record_kind == "texture_remove":
        record_label = label_override or "Removed texturing"
    else:
        record_label = label_override or f"Upload {dest.name}"
    entry = _record_history(path, record_kind, record_label, dest.name, user=user)
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
            "action": record_kind,
            "timeline_entry": entry,
            "preview_pending": preview_pending,
        },
    )
    payload = {
        "filename": dest.name,
        "viewer_filename": viewer_filename,
        "url": f"/api/projects/{project_id}/files/{viewer_filename}",
        "timeline_index": entry.get("index") if isinstance(entry, dict) else None,
        "timeline_entry": entry,
        "drawing": False,
        "preview_pending": preview_pending,
        "action": record_kind,
    }
    if extracted_note:
        payload["note"] = extracted_note
    if preview_pending:
        payload["note"] = (
            (payload.get("note") + " " if payload.get("note") else "")
            + "3D preview is building in the background — the model will appear when ready."
        ).strip()
    return payload


@app.post("/api/projects/{project_id}/files/{filename}/geometry-brief")
def cad_file_geometry_brief(
    project_id: str,
    filename: str,
    include_views: bool = Query(True),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Measure a CAD/mesh reference and return silhouette + preview images for the AI prompt."""
    project_path = _require_project(user, project_id)
    safe = Path(filename).name
    file_path = project_path / safe
    if not file_path.is_file():
        # Prefer viewer sidecar when the catalog file is STEP and GLB exists.
        glb = file_path.with_suffix(".glb")
        if glb.is_file():
            file_path = glb
        else:
            raise HTTPException(404, "File not found")
    try:
        from backend.services.cad_reference_geometry import analyze_reference_geometry

        facts = analyze_reference_geometry(file_path, include_views=include_views)
        return {"ok": True, "filename": safe, "geometry": facts, "views": facts.get("views") or []}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("geometry-brief failed for %s: %s", safe, exc)
        raise HTTPException(422, f"Could not analyze geometry for {safe}: {exc}") from exc


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
    if file_path is None or not cad_service.is_markup_path(project_path, file_path):
        raise HTTPException(404, "Reference file not found")
    if not cad_service.is_reference_suffix(file_path.suffix):
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


def _annotate_export_download_urls(project_id: str, exports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach download URLs; STEP served native (no Part rewrite)."""
    out: list[dict[str, Any]] = []
    for item in exports or []:
        row = dict(item)
        name = str(row.get("name") or "")
        if not name:
            out.append(row)
            continue
        url = f"/api/projects/{project_id}/files/{name}"
        if str(row.get("format") or "").lower() == "step":
            stem = Path(name).name
            for suffix in (".part.step", ".fusionpart.step", ".step", ".stp"):
                if stem.lower().endswith(suffix):
                    stem = stem[: -len(suffix)]
                    break
            else:
                stem = Path(stem).stem
            row["download_name"] = row.get("download_name") or f"{stem}.step"
            row["label"] = row.get("label") or "STEP"
            row["step_structure"] = "part"
            row["fusion_editable"] = True
        row["url"] = url
        out.append(row)
    return out


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
        step_src = cad_service.find_step_source(project_path, file_path.stem)
        if step_src is not None:
            # Prefer instant cache reuse; otherwise build in background and ask client to retry.
            reused = cad_service._try_reuse_cached_preview_glb(step_src, file_path)
            if reused is None or not file_path.is_file():
                building = cad_service.is_preview_glb_building(file_path)
                if not building:
                    def _on_lazy_preview(out: Path | None, err: BaseException | None, *,
                                         _pid: str = project_id,
                                         _glb_name: str = file_path.name,
                                         _step_name: str = step_src.name) -> None:
                        if err is not None or out is None or not Path(out).is_file():
                            _notify_project(
                                _pid,
                                {
                                    "type": "model.preview_failed",
                                    "filename": _glb_name,
                                    "uploaded_filename": _step_name,
                                    "error": str(err) if err else "preview build failed",
                                },
                            )
                            return
                        _notify_project(
                            _pid,
                            {
                                "type": "model.reload",
                                "filename": _glb_name,
                                "uploaded_filename": _step_name,
                                "url": f"/api/projects/{_pid}/files/{_glb_name}",
                                "action": "preview_ready",
                            },
                        )

                    cad_service.schedule_tessellate_step_to_glb(
                        step_src, file_path, on_done=_on_lazy_preview
                    )
                if not file_path.is_file():
                    return JSONResponse(
                        status_code=503,
                        content={
                            "detail": "3D preview is still building — retry in a few seconds.",
                            "preview_pending": True,
                            "filename": safe,
                        },
                        headers={
                            "Retry-After": "3",
                            "Cache-Control": "no-store",
                        },
                    )
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
    # Explicit Part export (chooser / admin / ?step_mode=part|regular): flatten linked
    # assemblies so Fusion opens a single Part. Assembly / native / empty = as-is.
    if (
        file_path.suffix.lower() in {".step", ".stp"}
        and step_mode_normalized in {"regular", "part", "single", "fusion"}
    ):
        try:
            part_path = cad_service.ensure_fusion_part_step(project_path, file_path)
            if part_path.is_file():
                file_path = part_path
                stem = file_path.stem
                for suffix in (".fusionpart", ".part"):
                    if stem.lower().endswith(suffix):
                        stem = stem[: -len(suffix)]
                        break
                safe = f"{stem}.step"
        except Exception as exc:
            logger.warning("Part STEP export failed for %s: %s", safe, exc)
            raise HTTPException(422, f"Could not create part STEP: {exc}") from exc
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
        download_name = f"{file_path.stem}.3mf"
        return FileResponse(
            file_path,
            filename=download_name,
            media_type="model/3mf",
            headers={
                "Content-Disposition": f'attachment; filename="{download_name}"',
                "Cache-Control": "public, max-age=120",
                "Access-Control-Allow-Origin": "*",
                "X-Content-Type-Options": "nosniff",
            },
        )
    # ES module imports require a JavaScript MIME type (hidden .*.step.js sidecars).
    if file_path.suffix.lower() in {".js", ".mjs"} or file_path.name.endswith(".step.js"):
        return FileResponse(
            file_path,
            filename=download_name,
            media_type="text/javascript",
            headers={"Cache-Control": "no-cache"},
        )
    # Mesh previews are large; allow same-origin browser cache. Clients bust via ?_=epoch
    # after edits / generation so reopening a project does not re-download unchanged GLBs.
    if file_path.suffix.lower() in {".glb", ".gltf", ".stl", ".obj", ".ply", ".off"}:
        try:
            etag = f'W/"{file_path.stat().st_mtime_ns}"'
        except OSError:
            etag = 'W/"0"'
        return FileResponse(
            file_path,
            filename=download_name,
            headers={
                "Cache-Control": "private, max-age=86400",
                "ETag": etag,
            },
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


def _resolve_shared_filename(project_path: Path, share: dict[str, Any]) -> str | None:
    """Resolve legacy shares whose stored preview filename was later regenerated away."""
    safe = Path(str(share.get("filename") or "")).name
    if safe and (project_path / safe).is_file():
        return safe
    stem = Path(safe).stem if safe else ""
    if not stem:
        return None
    # Prefer editable CAD source, then already-generated viewer meshes/print exports.
    for ext in (".step", ".stp", ".glb", ".gltf", ".3mf", ".stl", ".obj", ".ply", ".off"):
        candidate = project_path / f"{stem}{ext}"
        if candidate.is_file():
            return candidate.name
    # Some pipelines leave only faceted STEP with the original stem.
    for candidate in sorted(project_path.glob(f"{stem}*")):
        if candidate.is_file() and candidate.suffix.lower() in {".step", ".stp", ".glb", ".gltf", ".3mf", ".stl"}:
            return candidate.name
    return None


def _share_snapshot_filename(project_path: Path, filename: str) -> str | None:
    return share_preview.share_snapshot_filename(
        project_path,
        filename,
        resolve_viewport=cad_service.resolve_viewport_filename,
    )


def _make_share_preview_transparent(project_path: Path, snapshot_name: str) -> str | None:
    return share_preview.make_share_preview_transparent(project_path, snapshot_name)


def _make_share_og_jpeg(project_path: Path, snapshot_name: str) -> tuple[str, int, int] | None:
    return share_preview.make_share_og_jpeg(project_path, snapshot_name)


def _share_basename(raw: Any) -> str:
    """Filename for share visibility keys (strips optional #body:… suffixes)."""
    text = str(raw or "").strip()
    if not text:
        return ""
    if "#" in text:
        text = text.split("#", 1)[0]
    return Path(text).name


def _share_name_list(raw: Any, *, limit: int = 200) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        name = _share_basename(item)
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
        if len(out) >= limit:
            break
    return out


def _share_visible_basenames(share: dict[str, Any] | None) -> list[str] | None:
    if not isinstance(share, dict):
        return None
    names = _share_name_list(share.get("visible_filenames"))
    return names or None


def _share_preview_filename(project_path: Path, filename: str) -> str | None:
    return share_preview.share_preview_filename(
        project_path,
        filename,
        resolve_viewport=cad_service.resolve_viewport_filename,
    )


def _share_preview_image_meta(project_path: Path, filename: str) -> dict[str, Any]:
    return share_preview.share_preview_image_meta(
        project_path,
        filename,
        resolve_viewport=cad_service.resolve_viewport_filename,
    )


def _share_allowed_filenames(
    project_path: Path,
    filename: str,
    share: dict[str, Any] | None = None,
) -> set[str]:
    safe = Path(filename).name
    allowed = {safe}
    visible = _share_visible_basenames(share)

    def _add_model_and_artifacts(model_name: str) -> None:
        model = Path(model_name).name
        if not model:
            return
        allowed.add(model)
        try:
            viewer = cad_service.resolve_viewport_filename(project_path, model)
            if viewer:
                allowed.add(Path(viewer).name)
        except Exception:
            pass
        try:
            for item in cad_service.list_exports_for_model(project_path, model):
                name = item.get("name")
                if name:
                    allowed.add(Path(name).name)
        except Exception:
            pass

    _add_model_and_artifacts(safe)

    if isinstance(share, dict):
        for key in ("viewer_filename", "assembly_filename", "preview_file"):
            extra = Path(str(share.get(key) or "")).name
            if extra:
                allowed.add(extra)

    if visible is not None:
        # Visibility-aware shares: only unhidden models (+ their viewers/exports).
        for name in visible:
            _add_model_and_artifacts(name)
        model_stems = {Path(name).stem for name in allowed}
        for stem in list(model_stems):
            for preview_path in project_path.glob(f"{stem}*_share_og*.png"):
                if preview_path.is_file():
                    allowed.add(preview_path.name)
            for preview_path in project_path.glob(f"{stem}*_share_transparent.png"):
                if preview_path.is_file():
                    allowed.add(preview_path.name)
            for preview_path in project_path.glob(f"{stem}*_share_view*.png"):
                if preview_path.is_file():
                    allowed.add(preview_path.name)
        snapshot = _share_snapshot_filename(project_path, safe)
        if snapshot:
            allowed.add(snapshot)
        return allowed

    # Legacy shares (no visibility snapshot): keep prior broad allow-list.
    try:
        browser = cad_service.list_browser_tree(project_path)
        for entry in browser.get("components") or []:
            for key in ("name", "viewer_filename", "source_filename", "filename"):
                name = Path(str(entry.get(key) or "")).name
                if name and (project_path / name).is_file():
                    allowed.add(name)
    except Exception:
        pass
    for path_ in project_path.iterdir():
        if path_.is_file() and path_.suffix.lower() in {".urdf", ".srdf", ".sdf", ".mjcf", ".stl", ".glb", ".gltf", ".3mf"}:
            allowed.add(path_.name)
    model_stems = {Path(safe).stem}
    try:
        viewer = cad_service.resolve_viewport_filename(project_path, safe)
        if viewer:
            model_stems.add(Path(viewer).stem)
    except Exception:
        pass
    for stem in list(model_stems):
        for preview_path in project_path.glob(f"{stem}*_share_og*.png"):
            if preview_path.is_file():
                allowed.add(preview_path.name)
        for preview_path in project_path.glob(f"{stem}*_share_transparent.png"):
            if preview_path.is_file():
                allowed.add(preview_path.name)
        for preview_path in project_path.glob(f"{stem}*_share_view*.png"):
            if preview_path.is_file():
                allowed.add(preview_path.name)
    for preview_path in project_path.glob("*_share_og*.png"):
        if preview_path.is_file():
            allowed.add(preview_path.name)
    for preview_path in project_path.glob("*_share_transparent.png"):
        if preview_path.is_file():
            allowed.add(preview_path.name)
    for preview_path in project_path.glob("*_share_view*.png"):
        if preview_path.is_file():
            allowed.add(preview_path.name)
    snapshot = _share_snapshot_filename(project_path, safe)
    if snapshot:
        allowed.add(snapshot)
    return allowed


def _share_prompt_history(project_path: Path, filename: str, *, limit: int = 40) -> list[dict[str, Any]]:
    return _public_prompt_history(project_path, limit=limit, base_filename=filename, kind="cad")


def _share_metadata(token: str, request: Request | None = None) -> dict[str, Any]:
    project_id, project_path, share = _resolve_share_token(token)
    filename = _resolve_shared_filename(project_path, share) or ""
    if not filename:
        raise HTTPException(404, "Shared file not found")
    allowed = _share_allowed_filenames(project_path, filename, share)
    viewer_override = Path(str(share.get("viewer_filename") or share.get("assembly_filename") or "")).name
    visible_filenames = _share_visible_basenames(share)
    # Older shares stored visibility lists but never baked a visible-only GLB.
    # Repair once on read so the public viewer matches unhidden models.
    if visible_filenames and not viewer_override:
        try:
            exportable = [
                name
                for name in visible_filenames
                if (project_path / name).is_file()
                and (project_path / name).suffix.lower()
                in cad_service.SUPPORTED_IMPORT | cad_service.SUPPORTED_EXPORT
            ]
            if exportable:
                stem = f"_share_visible_{token[:8]}"
                glb_path = project_path / f"{stem}.glb"
                if not glb_path.is_file():
                    cad_service.build_visible_assembly_exports(
                        project_path,
                        exportable,
                        stem=stem,
                        include_companions=False,
                    )
                if glb_path.is_file():
                    share["viewer_filename"] = glb_path.name
                    share["assembly_filename"] = glb_path.name
                    viewer_override = glb_path.name
                    try:
                        meta_tmp = project_store.load_meta(project_path)
                        shares_tmp = meta_tmp.setdefault("file_shares", {})
                        if token in shares_tmp and isinstance(shares_tmp[token], dict):
                            shares_tmp[token]["viewer_filename"] = glb_path.name
                            shares_tmp[token]["assembly_filename"] = glb_path.name
                            project_store.save_meta(project_path, meta_tmp)
                    except Exception:
                        logger.debug("Could not persist repaired share viewer for %s", token, exc_info=True)
        except Exception as exc:
            logger.warning("Could not repair visible share GLB for token %s: %s", token, exc)
    viewer_filename = viewer_override or cad_service.resolve_viewport_filename(project_path, filename) or filename
    if viewer_filename and (project_path / viewer_filename).is_file():
        allowed.add(Path(viewer_filename).name)
    exports = []
    for item in cad_service.list_exports_for_model(project_path, filename):
        name = Path(str(item.get("name") or "")).name
        if not name or name not in allowed:
            continue
        url = f"/api/share/{token}/files/{urllib.parse.quote(name)}"
        exports.append({**item, "name": name, "url": url})
    # Also expose exports for the visibility-baked assembly viewer when present.
    if viewer_override and viewer_override != Path(filename).name:
        for item in cad_service.list_exports_for_model(project_path, viewer_override):
            name = Path(str(item.get("name") or "")).name
            if not name or name not in allowed:
                continue
            if any(row.get("name") == name for row in exports):
                continue
            url = f"/api/share/{token}/files/{urllib.parse.quote(name)}"
            exports.append({**item, "name": name, "url": url})
    # One STEP only in the share download menu.
    collapsed: list[dict[str, Any]] = []
    best_step: dict[str, Any] | None = None
    for row in exports:
        if str(row.get("format") or "").lower() == "step":
            if "__faceted" in str(row.get("name") or "").lower():
                continue
            best_step = row
            continue
        collapsed.append(row)
    if best_step is not None:
        collapsed.append(best_step)
    exports = collapsed
    if viewer_filename not in allowed and (project_path / viewer_filename).is_file():
        allowed.add(viewer_filename)
    meta = project_store.load_meta(project_path)
    project_name = str(meta.get("name") or project_id)
    preview_meta: dict[str, Any] = {}
    share_preview_file = Path(str(share.get("preview_file") or "")).name
    if share_preview_file and (project_path / share_preview_file).is_file():
        share_preview_path = project_path / share_preview_file
        if "_share_view_" in share_preview_file and "_brand" not in Path(share_preview_file).stem:
            branded_name = f"{Path(share_preview_file).stem}_brand.png"
            branded = share_preview.make_branded_viewport_share_preview(
                project_path,
                share_preview_path.read_bytes(),
                branded_name,
            )
            if branded:
                share_preview_file = branded[0]
                share_preview_path = project_path / share_preview_file
                share["preview_file"] = share_preview_file
                share["preview_width"] = branded[1]
                share["preview_height"] = branded[2]
                try:
                    project_store.save_meta(project_path, meta)
                except Exception:
                    logger.debug("Could not persist branded viewport preview for share %s", token, exc_info=True)
        # Explicit viewport captures represent the live hidden/unhidden state, so
        # they must win over regenerated model cards even when the generated file
        # is newer.
        allowed.add(share_preview_file)
        preview_meta = {
            "preview_file": share_preview_file,
            "preview_type": "image/png" if share_preview_file.lower().endswith(".png") else "image/jpeg",
            "preview_width": share.get("preview_width"),
            "preview_height": share.get("preview_height"),
        }
    if not preview_meta:
        preview_meta = _share_preview_image_meta(project_path, filename)
    generated_preview_file = Path(str(preview_meta.get("preview_file") or "")).name
    if generated_preview_file:
        allowed.add(generated_preview_file)
    if not preview_meta:
        snapshot = _share_snapshot_filename(project_path, filename)
        if snapshot:
            preview_meta = {
                "preview_file": snapshot,
                "preview_type": "image/png",
            }
    preview_file = preview_meta.get("preview_file")
    preview_url = None
    if preview_file:
        preview_url = f"/api/share/{token}/files/{urllib.parse.quote(str(preview_file))}"
        try:
            mtime_ns = (project_path / str(preview_file)).stat().st_mtime_ns
            preview_url = f"{preview_url}?v={mtime_ns}"
        except OSError:
            pass
    origin = _request_origin(request) if request is not None else ""
    absolute_preview = f"{origin}{preview_url}" if origin and preview_url else preview_url
    absolute_icon = f"{origin}/favicon-180.png?v=20260715-new-logo" if origin else "/favicon-180.png?v=20260715-new-logo"
    try:
        browser = cad_service.list_browser_tree(project_path)
    except Exception:
        browser = {"components": [], "sketches": [], "wiring": [], "drawings": [], "references": [], "renders": []}
    visible_filenames = _share_visible_basenames(share)
    hidden_filenames = _share_name_list(share.get("hidden_filenames") if isinstance(share, dict) else None)
    if visible_filenames is not None:
        visible_set = set(visible_filenames)
        filtered_components = []
        for entry in browser.get("components") or []:
            names = {
                _share_basename(entry.get(key))
                for key in ("name", "viewer_filename", "source_filename", "filename", "stem")
            }
            names.discard("")
            if names & visible_set:
                filtered_components.append(entry)
        browser = {**browser, "components": filtered_components}
    robot = _robot_artifact_summary(project_path)
    robot_artifacts = [
        {
            "name": name,
            "format": Path(name).suffix.lower().lstrip("."),
            "url": f"/api/share/{token}/files/{urllib.parse.quote(name)}",
        }
        for name in robot.get("artifacts") or []
        if Path(name).name in allowed
    ]
    prompt_history = _share_prompt_history(project_path, filename)
    latest_prompt = next((entry for entry in prompt_history if entry.get("success")), prompt_history[0] if prompt_history else None)
    created_by = str(share.get("created_by") or "")
    sharer = get_user_by_id(created_by) if created_by else None
    shared_by = (
        {
            "id": sharer.get("id"),
            "display_name": sharer.get("display_name"),
            "email": sharer.get("email"),
            "avatar_url": sharer.get("avatar_url"),
        }
        if sharer
        else None
    )
    generated_by = None
    if latest_prompt and latest_prompt.get("user_name"):
        generated_by = {
            "user_id": latest_prompt.get("user_id"),
            "display_name": latest_prompt.get("user_name"),
            "avatar_url": latest_prompt.get("user_avatar_url"),
            "prompt_id": latest_prompt.get("id"),
            "created_at": latest_prompt.get("created_at"),
            "filename": latest_prompt.get("filename"),
        }
    elif shared_by:
        generated_by = {
            "user_id": shared_by.get("id"),
            "display_name": shared_by.get("display_name"),
            "avatar_url": shared_by.get("avatar_url"),
            "prompt_id": None,
            "created_at": None,
            "filename": filename,
        }
    return {
        "token": token,
        "project_id": project_id,
        "project_name": project_name,
        "filename": filename,
        "viewer_filename": viewer_filename,
        "viewer_url": f"/api/share/{token}/files/{urllib.parse.quote(viewer_filename)}",
        "visible_filenames": visible_filenames or [],
        "hidden_filenames": hidden_filenames,
        "source_model": {
            "filename": filename,
            "viewer_filename": viewer_filename,
            "ai_model": latest_prompt.get("model") if latest_prompt else None,
            "provider": latest_prompt.get("provider") if latest_prompt else None,
            "speed": latest_prompt.get("speed") if latest_prompt else None,
            "generated_by": generated_by,
        },
        "prompt_history": prompt_history,
        "generated_by": generated_by,
        "shared_by": shared_by,
        "exports": exports,
        "preview_file": preview_file,
        "preview_url": preview_url,
        "preview_image_url": absolute_preview or absolute_icon,
        "preview_width": preview_meta.get("preview_width"),
        "preview_height": preview_meta.get("preview_height"),
        "preview_type": preview_meta.get("preview_type") or ("image/jpeg" if str(preview_file or "").lower().endswith(".jpg") else "image/png"),
        "browser": browser,
        "robot": {**robot, "artifacts": robot_artifacts},
        "share_title": f"{project_name} · with Render Studio",
        "share_description": f"3D model preview of {filename} — shared with Render Studio",
    }


def _share_page_html(token: str, request: Request) -> str:
    meta = _share_metadata(token, request)
    page = FRONTEND / "share.html"
    if not page.is_file():
        raise HTTPException(500, "Share viewer is missing")
    raw = page.read_text(encoding="utf-8")
    origin = _request_origin(request)
    title = html.escape(meta["share_title"], quote=True)
    description = html.escape(meta["share_description"], quote=True)
    image = html.escape(str(meta.get("preview_image_url") or f"{origin}/render3d-og-banner.jpg?v=20260721-official-banner"), quote=True)
    url = html.escape(f"{origin}/share/{token}", quote=True)
    icon = html.escape(f"{origin}/favicon-180.png?v=20260715-new-logo", quote=True)
    favicon = html.escape(f"{origin}/favicon.ico?v=20260715-new-logo", quote=True)
    logo = html.escape(f"{origin}/render3d-logo.png?v=20260715-new-logo", quote=True)
    project_name = html.escape(str(meta.get("project_name") or "Shared model"))
    filename = html.escape(str(meta.get("filename") or ""))
    image_type = html.escape(str(meta.get("preview_type") or "image/jpeg"), quote=True)
    image_width = meta.get("preview_width")
    image_height = meta.get("preview_height")
    image_size_tags = ""
    if image_width and image_height:
        image_size_tags = (
            f'\n  <meta property="og:image:width" content="{int(image_width)}" />'
            f'\n  <meta property="og:image:height" content="{int(image_height)}" />'
        )
    og_block = f"""<!-- SHARE_META_START -->
  <title>{title}</title>
  <meta name="description" content="{description}" />
  <link rel="icon" type="image/png" href="{logo}" sizes="any" />
  <link rel="shortcut icon" href="{favicon}" />
  <link rel="icon" type="image/png" href="{html.escape(f'{origin}/favicon-32.png?v=20260715-new-logo', quote=True)}" sizes="32x32" />
  <link rel="apple-touch-icon" href="{icon}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Render Studio" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="{image}" />
  <meta property="og:image:secure_url" content="{image}" />
  <meta property="og:image:type" content="{image_type}" />
  <meta property="og:image:alt" content="{title}" />{image_size_tags}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{image}" />
  <meta name="render3d:project" content="{html.escape(str(meta.get('project_name') or ''), quote=True)}" />
  <!-- SHARE_META_END -->"""
    start = "<!-- SHARE_META_START -->"
    end = "<!-- SHARE_META_END -->"
    if start in raw and end in raw:
        before, rest = raw.split(start, 1)
        _, after = rest.split(end, 1)
        raw = before + og_block + after
    elif "<!-- SHARE_META -->" in raw:
        raw = raw.replace("<!-- SHARE_META -->", og_block, 1)
    else:
        raw = raw.replace("</head>", og_block + "\n</head>", 1)
    # Prefill visible title for non-JS crawlers / first paint
    raw = raw.replace(">Loading shared model…<", f">{project_name}<", 1)
    if filename:
        raw = raw.replace(
            'id="share-subtitle">with Render Studio</p>',
            f'id="share-subtitle">with Render Studio · {filename}</p>',
            1,
        )
        raw = raw.replace(">Rotate · section · download<", f">with Render Studio · {filename}<", 1)
    else:
        raw = raw.replace(">Rotate · section · download<", ">with Render Studio<", 1)
    return raw


@app.post("/api/projects/{project_id}/files/{filename}/share")
def create_file_share(
    project_id: str,
    filename: str,
    request: Request,
    body: dict[str, Any] = Body(default={}),
    user: dict[str, Any] = Depends(get_current_user),
):
    project_path = _require_project_read(user, project_id)
    safe = cad_service.resolve_existing_project_file(project_path, filename)
    if not safe:
        raise HTTPException(404, "File not found")
    meta = project_store.load_meta(project_path)
    shares = meta.setdefault("file_shares", {})
    has_live_share_context = bool(
        isinstance(body, dict)
        and (
            body.get("force_new")
            or str(body.get("viewport_image") or "").startswith("data:image/")
            or body.get("visible_filenames")
            or body.get("hidden_filenames")
        )
    )
    token = None if has_live_share_context else next((tok for tok, share in shares.items() if isinstance(share, dict) and share.get("filename") == safe), None)
    if not token:
        token = secrets.token_urlsafe(18)
        while token in shares:
            token = secrets.token_urlsafe(18)
        shares[token] = {
            "filename": safe,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": user["id"],
        }
    share = shares[token]
    # Public viewer is GLB-only. If the shared file is STEP/3MF/STL, prefer a sibling
    # viewport GLB so /share/{token} actually renders (unless a bake overrides below).
    if not share.get("viewer_filename") and not share.get("assembly_filename"):
        try:
            resolved_viewer = cad_service.resolve_viewport_filename(project_path, safe)
            if resolved_viewer and (project_path / resolved_viewer).is_file():
                if Path(resolved_viewer).suffix.lower() in {".glb", ".gltf"}:
                    share["viewer_filename"] = resolved_viewer
        except Exception:
            logger.debug("Could not resolve share viewer for %s", safe, exc_info=True)
    if isinstance(body, dict):
        viewport_image = str(body.get("viewport_image") or "")
        if viewport_image.startswith("data:image/"):
            try:
                image_bytes, ext = _decode_data_url_image(viewport_image)
                if len(image_bytes) <= 8_000_000:
                    preview_name = f"{Path(safe).stem}_share_view_{token[:8]}_brand.png"
                    branded = share_preview.make_branded_viewport_share_preview(project_path, image_bytes, preview_name)
                    if branded:
                        share["preview_file"] = branded[0]
                        share["preview_width"] = branded[1]
                        share["preview_height"] = branded[2]
                    else:
                        fallback_name = f"{Path(safe).stem}_share_view_{token[:8]}.{ext if ext != 'jpg' else 'jpg'}"
                        (project_path / fallback_name).write_bytes(image_bytes)
                        share["preview_file"] = fallback_name
                    share["preview_captured_at"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:
                logger.warning("Could not save viewport share preview for %s/%s: %s", project_id, safe, exc)
        visible = _share_name_list(body.get("visible_filenames"))
        hidden = _share_name_list(body.get("hidden_filenames"))
        if visible:
            share["visible_filenames"] = visible[:200]
            # Drop any previous bake so we never keep an old Arduino/ball viewer GLB.
            share.pop("viewer_filename", None)
            share.pop("assembly_filename", None)
            # Bake a GLB of the requested models so the public 3D viewer matches.
            try:
                exportable = [
                    name
                    for name in visible
                    if (project_path / name).is_file()
                    and (project_path / name).suffix.lower()
                    in cad_service.SUPPORTED_IMPORT | cad_service.SUPPORTED_EXPORT
                ]
                if exportable:
                    stem = f"_share_visible_{token[:8]}"
                    # Share mint only needs a viewer GLB. Companion STL/STEP/3MF
                    # exports are for the Export menu and can take many seconds.
                    built = cad_service.build_visible_assembly_exports(
                        project_path,
                        exportable,
                        stem=stem,
                        include_companions=False,
                    )
                    glb = next(
                        (
                            str(item.get("name") or "")
                            for item in built
                            if str(item.get("format") or "").lower() == "glb"
                        ),
                        "",
                    )
                    if glb and (project_path / glb).is_file():
                        share["viewer_filename"] = glb
                        share["assembly_filename"] = glb
            except Exception as exc:
                logger.warning(
                    "Could not bake visible-only share GLB for %s/%s: %s",
                    project_id,
                    safe,
                    exc,
                )
        if "hidden_filenames" in body:
            share["hidden_filenames"] = hidden[:200]
        share["updated_at"] = datetime.now(timezone.utc).isoformat()
    project_store.save_meta(project_path, meta)
    base = _request_origin(request)
    return {"token": token, "share_url": f"{base}/share/{token}"}


@app.get("/api/share/{token}")
def get_share_metadata(token: str, request: Request):
    return _share_metadata(token, request)


@app.post("/api/share/{token}/open-in-project")
def open_share_in_project(
    token: str,
    body: dict[str, Any] = Body(default={}),
    user: dict[str, Any] = Depends(get_current_user),
):
    source_project_id, source_path, share = _resolve_share_token(token)
    shared_filename = Path(str(share.get("filename") or "")).name
    if not shared_filename or not (source_path / shared_filename).is_file():
        raise HTTPException(404, "Shared file not found")
    teams = teams_service.list_teams(user["id"])
    if not teams:
        raise HTTPException(400, "No workspace available")
    sharer_user = get_user_by_id(str(share.get("created_by") or "")) if share.get("created_by") else None
    wants_share_back = bool(body.get("share_with_sharer")) and sharer_user and sharer_user.get("id") != user["id"]
    target_project_id = re.sub(r"[^A-Za-z0-9_\-]", "", str(body.get("target_project_id") or ""))[:80]
    team_id = teams[0]["id"]
    collaboration_team = None
    if target_project_id:
        dest_path = _require_project(user, target_project_id)
        project_id = target_project_id
        access = teams_service.user_project_access(user["id"])
        team_id = next((row["team_id"] for row in access if row.get("project_id") == project_id), team_id)
        meta = project_store.load_meta(dest_path)
        project_name = meta.get("name") or project_id
        # Sharing an existing project back can expose unrelated user work, so
        # collaboration sharing only applies to new remix projects.
        wants_share_back = False
    else:
        if wants_share_back:
            try:
                label = Path(shared_filename).stem.replace("_", " ").strip() or "Shared Remix"
                collaboration_team = teams_service.create_team(user["id"], f"{label} Remix")
                team_id = collaboration_team["id"]
            except Exception as exc:
                wants_share_back = False
                logger.warning("Could not create collaboration workspace for share remix: %s", exc)
        project_id = str(uuid.uuid4())[:8]
        dest_path = cad_service.project_dir(PROJECTS, project_id)
        source_meta = project_store.load_meta(source_path)
        project_name = f"{source_meta.get('name') or Path(shared_filename).stem} (shared copy)"
        meta = project_store.touch_project(dest_path, name=project_name, name_source="user")
        teams_service.register_project_access(project_id, team_id, user["id"])

    copied: list[str] = []
    for name in sorted(_share_allowed_filenames(source_path, shared_filename, share)):
        safe = Path(name).name
        src = source_path / safe
        if not src.is_file():
            continue
        dst = dest_path / safe
        try:
            shutil.copy2(src, dst)
            copied.append(safe)
        except Exception as exc:
            logger.warning("Could not copy shared file %s into %s: %s", safe, project_id, exc)
    if not copied:
        raise HTTPException(500, "Could not copy shared files")
    shared_with_sharer = False
    share_back_error = None
    if wants_share_back and sharer_user:
        try:
            teams_service.add_registered_user_to_team(team_id, str(sharer_user.get("email") or ""), user["id"])
            shared_with_sharer = True
        except Exception as exc:
            share_back_error = str(exc)
            logger.warning("Could not share remix %s back with %s: %s", project_id, sharer_user.get("id"), exc)
    _record_history(
        dest_path,
        "share_import",
        f"Open shared preview {shared_filename}",
        shared_filename,
        meta={
            "source_project_id": source_project_id,
            "share_token": token,
            "copied_files": copied,
            "imported_into_existing_project": bool(target_project_id),
            "shared_with_original_sharer": shared_with_sharer,
            "collaboration_team_id": collaboration_team.get("id") if collaboration_team else None,
            **({"share_back_error": share_back_error} if share_back_error else {}),
        },
        user=user,
    )
    project_store.touch_project(dest_path, name=project_name, name_source="user")
    if target_project_id:
        _notify_project(
            project_id,
            {
                "type": "project.updated",
                "project_id": project_id,
                "filename": shared_filename,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "by_user_name": user["display_name"],
            },
        )
    else:
        _notify_workspace(
            team_id,
            {
                "type": "project.created",
                "project_id": project_id,
                "team_id": team_id,
                "name": meta.get("name"),
                "meta": meta,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "by_user_name": user["display_name"],
                "owner_user_id": user["id"],
            },
        )
    return {
        "project_id": project_id,
        "team_id": team_id,
        "filename": shared_filename,
        "copied_files": copied,
        "imported_into_existing_project": bool(target_project_id),
        "shared_with_sharer": shared_with_sharer,
        "share_back_error": share_back_error,
        "shared_by": (
            {
                "id": sharer_user.get("id"),
                "display_name": sharer_user.get("display_name"),
                "email": sharer_user.get("email"),
                "avatar_url": sharer_user.get("avatar_url"),
            }
            if sharer_user
            else None
        ),
        "url": f"/?project={project_id}",
    }


@app.post("/api/public/projects/{project_id}/remix")
def remix_public_project(
    project_id: str,
    body: dict[str, Any] = Body(default={}),
    user: dict[str, Any] = Depends(get_current_user),
):
    """Copy a public project's files into a new local project (remix).

    Non-a1projects users cannot edit public folder projects directly,
    but they can remix files into their own workspace.
    """
    if not _is_public_project(project_id):
        raise HTTPException(404, "Public project not found")
    source_path = PROJECTS / project_id
    if not source_path.is_dir():
        raise HTTPException(404, "Public project not found")

    teams = teams_service.list_teams(user["id"])
    if not teams:
        raise HTTPException(400, "No workspace available")
    team_id = teams[0]["id"]

    target_project_id = re.sub(r"[^A-Za-z0-9_\-]", "", str(body.get("target_project_id") or ""))[:80]
    if target_project_id:
        dest_path = _require_project(user, target_project_id)
        new_project_id = target_project_id
    else:
        new_project_id = str(uuid.uuid4())[:8]
        dest_path = cad_service.project_dir(PROJECTS, new_project_id)
        source_meta = project_store.load_meta(source_path)
        project_name = f"{source_meta.get('name') or project_id} (remix)"
        project_store.touch_project(dest_path, name=project_name, name_source="user")
        teams_service.register_project_access(new_project_id, team_id, user["id"])

    copied: list[str] = []
    for entry in cad_service.list_project_files(source_path):
        name = entry.get("name")
        if not name:
            continue
        src = source_path / name
        dst = dest_path / name
        if not src.is_file():
            continue
        try:
            shutil.copy2(src, dst)
            copied.append(name)
        except Exception as exc:
            logger.warning("Could not copy public file %s into %s: %s", name, new_project_id, exc)
    if not copied:
        raise HTTPException(500, "Could not copy any files from the public project")

    primary_file = copied[0] if copied else ""
    _record_history(
        dest_path,
        "remix_import",
        f"Remixed from public project {project_id}",
        primary_file,
        meta={
            "source_project_id": project_id,
            "copied_files": copied,
            "imported_into_existing_project": bool(target_project_id),
        },
        user=user,
    )
    project_store.touch_project(dest_path)

    if not target_project_id:
        _notify_workspace(
            team_id,
            {
                "type": "project.created",
                "project_id": new_project_id,
                "team_id": team_id,
                "name": project_store.load_meta(dest_path).get("name"),
                "by": user["display_name"],
                "by_user_id": user["id"],
                "by_user_name": user["display_name"],
                "owner_user_id": user["id"],
            },
        )

    return {
        "project_id": new_project_id,
        "team_id": team_id,
        "filename": primary_file,
        "copied_files": copied,
        "url": f"/?project={new_project_id}",
    }


@app.api_route("/api/share/{token}/files/{filename}", methods=["GET", "HEAD"])
def get_share_file(token: str, filename: str, step_mode: str | None = Query(None)):
    project_id, project_path, share = _resolve_share_token(token)
    shared_filename = _resolve_shared_filename(project_path, share) or ""
    if not shared_filename:
        raise HTTPException(404, "Shared file not found")
    safe = Path(filename).name
    allowed = _share_allowed_filenames(project_path, shared_filename, share)
    preview_file = Path(str(share.get("preview_file") or "")).name
    if preview_file:
        allowed.add(preview_file)
    for key in ("viewer_filename", "assembly_filename"):
        extra = Path(str(share.get(key) or "")).name
        if extra:
            allowed.add(extra)
    if safe not in allowed:
        raise HTTPException(404, "File not found")
    response = _file_response(project_path, project_id, safe, step_mode=step_mode)
    # Link-preview crawlers (iMessage especially) probe with HEAD first.
    if hasattr(response, "headers"):
        response.headers.setdefault("Cache-Control", "public, max-age=3600")
        response.headers.setdefault("Access-Control-Allow-Origin", "*")
        # Inline disposition so Messages/Slack render the thumbnail instead of treating it as a download.
        if Path(safe).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            response.headers["Content-Disposition"] = f'inline; filename="{safe}"'
    return response


@app.api_route("/share/{token}", methods=["GET", "HEAD"], include_in_schema=False)
def share_preview_page(token: str, request: Request):
    """Public share viewer — validates the token, then serves the mobile-friendly preview page."""
    return HTMLResponse(
        _share_page_html(token, request),
        media_type="text/html",
        headers={"Cache-Control": "public, max-age=60"},
    )

@app.get("/api/projects/{project_id}/files/{filename}/exports")
def list_file_exports(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _require_project_read(user, project_id)
    safe = cad_service.resolve_existing_project_file(path, filename)
    if not safe:
        raise HTTPException(404, "File not found")
    exports = cad_service.list_exports_for_model(path, safe)
    # Do not block the export menu if usable downloads already exist. Some mesh
    # export regeneration paths can be slow for large edited GLBs; returning the
    # existing GLB/STL/3MF immediately is better than leaving the UI spinning.
    if not exports:
        try:
            cad_service.ensure_mesh_exports(path, safe, missing_only=True)
        except Exception as exc:
            logger.warning("Could not refresh exports for %s: %s", safe, exc)
        exports = cad_service.list_exports_for_model(path, safe)
    exports = _annotate_export_download_urls(project_id, exports)
    return {
        "filename": safe,
        "exports": exports,
        "file_url": f"/api/projects/{project_id}/files/{safe}",
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
    # Idempotent: values already match source — treat as success (Jake-style bake
    # may have already applied the same numbers, or a retry posts identical params).
    if patched == source:
        return {
            "ok": True,
            "unchanged": True,
            "filename": safe,
            "source": source_name,
            "params": text_to_cad_params.list_parameters(source, part_filter=body.part),
            "artifacts": {"source": source_name, "glb": safe if safe.lower().endswith(".glb") else None},
        }
    source_path.write_text(patched, encoding="utf-8")
    # Mesh already baked via /transform — keep .py in sync without a full rebuild.
    if body.sync_only:
        project_store.touch_project(path)
        return {
            "ok": True,
            "synced": True,
            "filename": safe,
            "source": source_name,
            "params": text_to_cad_params.list_parameters(patched, part_filter=body.part),
            "artifacts": {"source": source_name, "glb": safe if safe.lower().endswith(".glb") else None},
        }
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
    exports = _annotate_export_download_urls(project_id, exports)
    primary = next((item["name"] for item in exports if item.get("format") == "glb"), exports[0]["name"] if exports else "")
    return {
        "filename": primary,
        "exports": exports,
        "file_url": f"/api/projects/{project_id}/files/{primary}" if primary else None,
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
def regenerate_file_exports(
    project_id: str,
    filename: str,
    body: RegenerateExportsRequest | None = Body(default=None),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    safe = Path(filename).name
    if not (path / safe).is_file():
        raise HTTPException(404, "File not found")
    visible_indices = None
    if body is not None and body.visible_body_indices is not None:
        visible_indices = [int(i) for i in body.visible_body_indices if int(i) >= 0]
        if not visible_indices:
            raise HTTPException(400, "No visible bodies to export. Unhide at least one part.")
    cad_service.ensure_mesh_exports(path, safe, visible_body_indices=visible_indices)
    exports = cad_service.list_exports_for_model(path, safe)
    return {
        "filename": safe,
        "exports": exports,
        "file_url": f"/api/projects/{project_id}/files/{safe}",
        "visible_body_indices": visible_indices,
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
        if resolved is not None and resolved.parent.name in cad_service.MARKUP_FOLDER_NAMES:
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

    if resolved.parent.name in cad_service.MARKUP_FOLDER_NAMES:
        try:
            deleted_files = cad_service.delete_reference_file(project_path, safe)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        project_store.touch_project(project_path)
        is_render = resolved.parent.name == cad_service.RENDERS_DIRNAME
        _notify_project(
            project_id,
            {
                "type": "file.deleted",
                "filename": safe,
                "deleted_files": deleted_files,
                "by": user["display_name"],
                "by_user_id": user["id"],
                "reference": not is_render,
                "render": is_render,
            },
        )
        return {
            "deleted": safe,
            "deleted_files": deleted_files,
            "reference": not is_render,
            "render": is_render,
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
    from backend.services import wiring_service

    path = _require_project_read(user, project_id)
    wiring_path = path / "wiring.json"
    if not wiring_path.is_file():
        return {"components": [], "wires": []}
    try:
        schematic = json.loads(wiring_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid wiring.json: {exc}") from exc
    repaired, _repairs = wiring_service.validate_and_repair_schematic(schematic)
    return repaired


@app.put("/api/projects/{project_id}/wiring")
def save_wiring(
    project_id: str,
    body: WiringSaveRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import wiring_service

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
    payload, _repairs = wiring_service.validate_and_repair_schematic(payload)
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


def _prefer_urdf_root_link(link_names: list[str]) -> str:
    """Pick a sensible assembly root when gen_urdf() left multiple disconnected roots."""
    if not link_names:
        raise ValueError("no URDF links")
    preferred = (
        "base_link",
        "base_plate",
        "base",
        "world",
        "root",
        "chassis",
        "frame",
    )
    lower_map = {str(name).lower(): str(name) for name in link_names}
    for key in preferred:
        if key in lower_map:
            return lower_map[key]
    # Prefer a link whose name starts with base_
    for name in link_names:
        if str(name).lower().startswith("base"):
            return str(name)
    return str(link_names[0])


def _urdf_root_candidates(urdf_path: Path) -> list[str]:
    import xml.etree.ElementTree as ET

    root = ET.parse(urdf_path).getroot()
    links = [str(el.attrib.get("name") or "").strip() for el in root.findall("link")]
    links = [name for name in links if name]
    children: set[str] = set()
    for joint in root.findall("joint"):
        child_el = joint.find("child")
        child = str(child_el.attrib.get("link") or "").strip() if child_el is not None else ""
        if child:
            children.add(child)
    return [name for name in links if name not in children]


def _repair_urdf_multi_root_xml(urdf_path: Path) -> list[tuple[str, str, str]]:
    """Attach orphan roots to a preferred root with fixed joints. Returns added joints."""
    import xml.etree.ElementTree as ET

    if not urdf_path.is_file():
        return []
    tree = ET.parse(urdf_path)
    root = tree.getroot()
    links = [str(el.attrib.get("name") or "").strip() for el in root.findall("link")]
    links = [name for name in links if name]
    children: set[str] = set()
    existing_names = {
        str(j.attrib.get("name") or "").strip()
        for j in root.findall("joint")
        if str(j.attrib.get("name") or "").strip()
    }
    for joint in root.findall("joint"):
        child_el = joint.find("child")
        child = str(child_el.attrib.get("link") or "").strip() if child_el is not None else ""
        if child:
            children.add(child)
    orphans = [name for name in links if name not in children]
    if len(orphans) <= 1:
        return []
    preferred = _prefer_urdf_root_link(orphans)
    added: list[tuple[str, str, str]] = []
    for orphan in orphans:
        if orphan == preferred:
            continue
        joint_name = f"{preferred}_to_{orphan}_auto"
        n = 1
        while joint_name in existing_names:
            n += 1
            joint_name = f"{preferred}_to_{orphan}_auto_{n}"
        joint = ET.SubElement(root, "joint", name=joint_name, type="fixed")
        ET.SubElement(joint, "parent", link=preferred)
        ET.SubElement(joint, "child", link=orphan)
        ET.SubElement(joint, "origin", xyz="0 0 0", rpy="0 0 0")
        existing_names.add(joint_name)
        added.append((joint_name, preferred, orphan))
    if added:
        tree.write(urdf_path, encoding="utf-8", xml_declaration=True)
    return added


def _urdf_part_mesh_map(project_path: Path, stem: str) -> dict[str, str]:
    """Map link-ish labels → sibling ``{stem}__part_NN_label.glb`` filenames."""
    import re as _re

    mapping: dict[str, str] = {}
    for part in sorted(Path(project_path).glob(f"{stem}__part_*.glb")):
        m = _re.search(r"__part_\d+_(.+)$", part.stem, flags=_re.I)
        if not m:
            continue
        label = str(m.group(1) or "").strip().lower()
        if not label:
            continue
        mapping[label] = part.name
        # Common Jake / URDF aliases
        if label.endswith("_link"):
            mapping[label[: -len("_link")]] = part.name
        else:
            mapping[f"{label}_link"] = part.name
        if label.startswith("base"):
            mapping.setdefault("base", part.name)
            mapping.setdefault("base_link", part.name)
            mapping.setdefault("base_plate", part.name)
    return mapping


def _match_urdf_part_mesh(link_name: str, part_map: dict[str, str]) -> str | None:
    key = str(link_name or "").strip().lower()
    if not key:
        return None
    if key in part_map:
        return part_map[key]
    # fuzzy: jaw_left ↔ left_jaw, etc.
    compact = key.replace("_", "")
    for label, filename in part_map.items():
        if label.replace("_", "") == compact:
            return filename
        if key in label or label in key:
            return filename
    return None


def _rewrite_urdf_visuals_to_part_meshes(urdf_path: Path, project_path: Path, stem: str) -> int:
    """Replace box/cylinder placeholders with real ``__part_*.glb`` meshes.

    Sibling part GLBs are assembled/world mm. When a link gets a part mesh, zero
    its parent joint origin so Rigging moves the real CAD instead of white boxes.
    """
    import xml.etree.ElementTree as ET

    urdf_path = Path(urdf_path)
    if not urdf_path.is_file():
        return 0
    part_map = _urdf_part_mesh_map(project_path, stem)
    if not part_map:
        return 0

    tree = ET.parse(urdf_path)
    root = tree.getroot()
    replaced = 0
    meshed_links: set[str] = set()
    mesh_scale = "0.001 0.001 0.001"

    for link in root.findall("link"):
        link_name = str(link.attrib.get("name") or "").strip()
        filename = _match_urdf_part_mesh(link_name, part_map)
        if not filename:
            continue
        # Skip if this link already has the matching mesh visual.
        already = False
        for visual in link.findall("visual"):
            geom = visual.find("geometry")
            mesh = geom.find("mesh") if geom is not None else None
            if mesh is not None and Path(str(mesh.attrib.get("filename") or "")).name == filename:
                already = True
                break
        if already:
            meshed_links.add(link_name)
            continue

        for tag in ("visual", "collision"):
            for old in list(link.findall(tag)):
                link.remove(old)
            node = ET.SubElement(link, tag)
            geom = ET.SubElement(node, "geometry")
            ET.SubElement(geom, "mesh", filename=filename, scale=mesh_scale)
        meshed_links.add(link_name)
        replaced += 1

    if not meshed_links:
        return 0

    # World-frame part meshes already include assembled pose → identity joint origin.
    for joint in root.findall("joint"):
        child_el = joint.find("child")
        child = str(child_el.attrib.get("link") or "").strip() if child_el is not None else ""
        if child not in meshed_links:
            continue
        origin = joint.find("origin")
        if origin is None:
            ET.SubElement(joint, "origin", xyz="0 0 0", rpy="0 0 0")
        else:
            origin.set("xyz", "0 0 0")
            if not str(origin.attrib.get("rpy") or "").strip():
                origin.set("rpy", "0 0 0")

    tree.write(urdf_path, encoding="utf-8", xml_declaration=True)
    return replaced


def _inject_fixed_joints_into_gen_urdf(source_text: str, joints: list[tuple[str, str, str]]) -> str | None:
    """Best-effort: append missing fixed joints into a gen_urdf() `joints = { ... }` dict."""
    import re as _re

    if not joints or "def gen_urdf" not in (source_text or ""):
        return None
    # Locate joints = { ... } after gen_urdf definition.
    fn_match = _re.search(r"\ndef gen_urdf\s*\(", source_text)
    if not fn_match:
        return None
    after = source_text[fn_match.start() :]
    dict_match = _re.search(r"\n(?P<indent>[ \t]*)joints\s*=\s*\{", after)
    if not dict_match:
        return None
    abs_start = fn_match.start() + dict_match.end()
    # Find matching closing brace for the joints dict.
    depth = 1
    i = abs_start
    while i < len(source_text) and depth > 0:
        ch = source_text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    if depth != 0:
        return None
    close_idx = i - 1
    block = source_text[abs_start:close_idx]
    missing = [(n, p, c) for n, p, c in joints if f'"{n}"' not in block and f"'{n}'" not in block]
    if not missing:
        return source_text
    indent = dict_match.group("indent") + "    "
    lines = []
    for name, parent, child in missing:
        lines.append(f'{indent}"{name}": ("{parent}", "{child}"),')
    insertion = "\n".join(lines)
    # Insert before closing brace; keep a trailing newline if the block had one.
    prefix = block.rstrip()
    if prefix and not prefix.endswith(","):
        # last entry may lack trailing comma — add one via newline entries only
        pass
    if prefix:
        new_block = prefix + ",\n" + insertion + "\n"
    else:
        new_block = "\n" + insertion + "\n"
    return source_text[:abs_start] + new_block + source_text[close_idx:]


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
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Run Jake-style gen_urdf()/gen_srdf() from a project Python source."""
    path = _require_project(user, project_id)
    source = Path(body.source).name
    source_path = path / source
    if not source_path.is_file() or source_path.suffix.lower() != ".py":
        raise HTTPException(404, "Python source file not found")
    kind = (body.kind or "both").strip().lower()
    if kind not in {"urdf", "srdf", "both"}:
        raise HTTPException(422, "kind must be urdf, srdf, or both")

    trace_id = getattr(request.state, "trace_id", new_trace_id())
    source_text = source_path.read_text(encoding="utf-8", errors="ignore")
    needs_authoring = (
        (kind in {"urdf", "both"} and "def gen_urdf" not in source_text)
        or (kind in {"srdf", "both"} and "def gen_srdf" not in source_text)
    )
    request_body = {
        "operation": "robot-artifacts:generate",
        "source": source,
        "kind": kind,
        # Never auto-author here — authoring can rewrite CAD sources. Use
        # /rigging/author-robot when generators are intentionally missing.
        "author": False,
        "needs_authoring": needs_authoring,
    }
    try:
        generation_service.start(
            path,
            kind="rigging",
            trace_id=trace_id,
            user=user,
            prompt=f"Generate {kind.upper()} robot artifacts from {source}",
            label="Generating robot artifacts",
            mode="rigging",
            request_body=request_body,
            allow_parallel=True,
        )
        generation_service.update_progress(
            path,
            {
                "stage": "rigging-artifacts",
                "pct": 6,
                "label": "Preparing robot artifact generation…",
                "thinking": "Loading the Python robot source and checking URDF/SRDF generators.",
            },
            trace_id=trace_id,
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
    background_tasks.add_task(_background_rigging_artifacts, project_id, request_body, trace_id, dict(user))
    return JSONResponse(
        status_code=202,
        content={
            "accepted": True,
            "status": "running",
            "trace_id": trace_id,
            "generation": generation_service.public_summary(path),
            "message": "Generating robot artifacts in the background.",
        },
    )


@app.post("/api/projects/{project_id}/rigging/author-robot")
def author_robot_description(
    project_id: str,
    body: RiggingArtifactGenerateRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Author Jake-style gen_urdf()/gen_srdf() into the CAD Python source, then generate artifacts."""
    path = _require_project(user, project_id)
    source = Path(body.source).name
    source_path = path / source
    if not source_path.is_file() or source_path.suffix.lower() != ".py":
        raise HTTPException(404, "Python source file not found")
    kind = (body.kind or "both").strip().lower()
    if kind not in {"urdf", "srdf", "both"}:
        raise HTTPException(422, "kind must be urdf, srdf, or both")
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    request_body = {
        "operation": "robot-artifacts:author",
        "source": source,
        "kind": kind,
        "author": True,
    }
    try:
        generation_service.start(
            path,
            kind="rigging",
            trace_id=trace_id,
            user=user,
            prompt=f"Author and generate {kind.upper()} robot artifacts for {source}",
            label="Authoring robot artifacts",
            mode="rigging",
            request_body=request_body,
            allow_parallel=True,
        )
        generation_service.update_progress(
            path,
            {
                "stage": "author-robot",
                "pct": 8,
                "label": "Authoring URDF/SRDF generators…",
                "thinking": "Asking AI to add Jake-compatible robot description functions.",
            },
            trace_id=trace_id,
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
    background_tasks.add_task(_background_rigging_artifacts, project_id, request_body, trace_id, dict(user))
    return JSONResponse(
        status_code=202,
        content={
            "accepted": True,
            "status": "running",
            "trace_id": trace_id,
            "generation": generation_service.public_summary(path),
            "message": "Authoring robot artifacts in the background.",
        },
    )


def _module_scope_numeric_constants(source: str) -> dict[str, float]:
    """Collect module-scope numeric assignments used by gen_step CAD params."""
    import ast

    out: dict[str, float] = {}
    try:
        tree = ast.parse(source or "")
    except SyntaxError:
        return out
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        try:
            value = ast.literal_eval(node.value)
        except Exception:
            continue
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            out[target.id] = float(value)
    return out


def _cad_constants_scaled_to_meters(before: dict[str, float], after: dict[str, float]) -> list[str]:
    """Detect URDF authoring that rewrote mm CAD constants into meters."""
    scaled: list[str] = []
    for name, old in before.items():
        if abs(old) < 1.0:
            continue
        new = after.get(name)
        if new is None:
            continue
        # Typical mm→m rewrite: 600.0 → 0.6, 48.0 → 0.048
        if abs(old) >= 5.0 and abs(new) > 0 and 800.0 <= abs(old / new) <= 1200.0:
            scaled.append(f"{name}: {old:g} → {new:g}")
    return scaled


def _run_rigging_artifact_pipeline(
    project_id: str,
    body_data: dict[str, Any],
    trace_id: str,
    user: dict[str, Any],
) -> dict[str, Any]:
    import re as _re

    from backend.services import skill_runner

    path = _require_project(user, project_id)
    source = Path(str(body_data.get("source") or "")).name
    source_path = path / source
    if not source_path.is_file() or source_path.suffix.lower() != ".py":
        raise FileNotFoundError("Python source file not found")
    kind = str(body_data.get("kind") or "both").strip().lower()
    if kind not in {"urdf", "srdf", "both"}:
        raise ValueError("kind must be urdf, srdf, or both")

    text = source_path.read_text(encoding="utf-8")
    needs_urdf = kind in {"urdf", "both"} and "def gen_urdf" not in text
    needs_srdf = kind in {"srdf", "both"} and "def gen_srdf" not in text
    # Only author when explicitly requested via /rigging/author-robot.
    # Auto-author on generate was rewriting CAD mm constants into meters.
    explicit_author = bool(body_data.get("author"))
    force_author = bool(body_data.get("force_author"))
    should_author = explicit_author and (needs_urdf or needs_srdf or force_author)
    authored = False
    if should_author:
        generation_service.update_progress(
            path,
            {
                "stage": "author-robot",
                "pct": 18,
                "label": "Authoring robot motion generators…",
                "thinking": "Adding Jake-compatible gen_urdf() and gen_srdf() functions to the CAD source.",
            },
            trace_id=trace_id,
        )
        ai = _sam_ai_service()
        prompt = (
            "You are editing a build123d / Jake text-to-cad Python CAD source.\n"
            "APPEND Jake-compatible top-level zero-arg robot generators. Do NOT redesign the CAD.\n"
            "HARD RULES (must obey):\n"
            "- Keep `gen_step()` and ALL existing CAD code byte-for-byte identical in behavior.\n"
            "- Do NOT change module-scope numeric constants. CAD units stay millimeters.\n"
            "- Do NOT divide/scale CAD parameters by 1000. Do NOT rewrite values like 600.0 → 0.6.\n"
            "- Only ADD `def gen_urdf():` and `def gen_srdf():` (plus imports they need, e.g. xml.etree.ElementTree).\n"
            "- Inside gen_urdf ONLY, convert mm→meters locally (value / 1000.0) for link sizes/origins.\n"
            "- gen_urdf returns the robot root Element (preferred: `return robot`), OR an ElementTree "
            "(also accepted — getroot is unwrapped), OR a URDF XML string. Do NOT return a dict.\n"
            "- Every physical <link> with <inertial> MUST include <mass value=\"...\"/> and a full "
            "<inertia ixx=... ixy=... ixz=... iyy=... iyz=... izz=.../>. Or omit <inertial> entirely "
            "for frame-only links. Never emit empty <inertial/>.\n"
            "- If you add <visual> or <collision>, each must include <geometry> (box/cylinder/sphere/mesh). "
            "Otherwise omit visual/collision.\n"
            "- Primitive geometry MUST use XML attributes (never child text nodes):\n"
            "  * <box size=\"0.1 0.2 0.03\"/>\n"
            "  * <cylinder radius=\"0.01\" length=\"0.05\"/>\n"
            "  * <sphere radius=\"0.02\"/>\n"
            "  Wrong: <box><size>0.1 0.2 0.03</size></box>\n"
            "- Joint parent/child names must reference existing links. The first child of each chain "
            "parents to the real base/root link (never invent missing seg0 links).\n"
            "- Form a connected tree: exactly (links - 1) joints, single root.\n"
            "- CRITICAL: every link except ONE root must appear as a joint child. If you create "
            "cover/lid/motor/pinion/tooling links, parent them with fixed (or actuated) joints to "
            "the base — never leave a second disconnected root.\n"
            "- Prefer root name base_link / base_plate / base when those links exist.\n"
            "- gen_srdf MUST return a dict with EXACTLY two keys: `xml` and `urdf`.\n"
            "  * `xml`: SRDF root Element or XML string. Root MUST be "
            "`<robot name=\"SAME_AS_URDF_ROBOT_NAME\">` (name attribute required).\n"
            "  * Inside groups use `<link name=\"...\"/>` or `<joint name=\"...\"/>` or "
            "`<chain base_link=\"...\" tip_link=\"...\"/>` — never `<link_group>`.\n"
            "  * `urdf`: relative path string to the sibling .urdf file ONLY "
            f"(e.g. \"{Path(source).stem}.urdf\"). NEVER put URDF XML or gen_urdf() output in `urdf`.\n"
            "  * Do NOT add keys like planning_group, group, states, etc.\n"
            "- If this model is a static assembly/fixture (no arm joints), use fixed joints only — "
            "do not invent revolute joints on structural pillars/frames.\n"
            "- Grippers / end-effectors / robot arms MUST expose movable joints so Rigging can animate them:\n"
            "  * parallel-jaw / rack grippers → prismatic joints on each rack/jaw travel axis (meters);\n"
            "  * finger / servo grippers → revolute joints on finger pivots (radians);\n"
            "  * pinion/motor shafts that actuate the mechanism → revolute about the shaft axis;\n"
            "  * covers, mounts, and housings stay fixed under the single root.\n"
            "- Only prefer all-fixed joints for true static fixtures with no actuated motion.\n"
            "- CRITICAL visuals: when sibling `{stem}__part_NN_<label>.glb` files exist, each matching "
            "link MUST use `<mesh filename=\"{stem}__part_NN_<label>.glb\" scale=\"0.001 0.001 0.001\"/>` "
            "(CAD is millimeters; URDF is meters). Do NOT use white box/cylinder placeholders for those links "
            "— Rigging only moves the real model when mesh visuals are present.\n"
            "- Those `__part_*.glb` sidecars are assembled/world-frame: set that link's joint "
            "`<origin xyz=\"0 0 0\" rpy=\"0 0 0\"/>` so motion is applied from the closed/assembled pose.\n"
            "- If no matching `__part_*.glb` / `.stl` exists for a link, primitive geometry is OK for that link only.\n"
            "- Return ONLY the full updated Python source file contents.\n\n"
            f"SOURCE FILE NAME: {source}\n"
            f"AVAILABLE PART MESHES (prefer these for visuals): "
            f"{', '.join(p.name for p in sorted(path.glob(f'{Path(source).stem}__part_*.glb'))[:40]) or '(none)'}\n\n"
            f"CURRENT SOURCE:\n{text[:120000]}"
        )
        before_consts = _module_scope_numeric_constants(text)
        patched, _trace = ai._call_model(
            "You author Jake text-to-cad robot generators. Never rescale CAD millimeters. Output only valid Python source.",
            prompt,
            max_tokens=12000,
            json_response=False,
        )
        patched_text = str(patched or "").strip()
        if patched_text.startswith("```"):
            patched_text = _re.sub(r"^```(?:python)?\s*", "", patched_text)
            patched_text = _re.sub(r"\s*```$", "", patched_text)
        if "def gen_urdf" not in patched_text:
            raise RuntimeError("AI patch did not include gen_urdf(); refused to overwrite source.")
        if kind in {"srdf", "both"} and "def gen_srdf" not in patched_text:
            raise RuntimeError("AI patch did not include gen_srdf(); refused to overwrite source.")
        if "def gen_step" in text and "def gen_step" not in patched_text:
            raise RuntimeError("AI patch removed gen_step(); refused to overwrite source.")
        after_consts = _module_scope_numeric_constants(patched_text)
        scaled = _cad_constants_scaled_to_meters(before_consts, after_consts)
        if scaled:
            raise RuntimeError(
                "AI URDF authoring tried to convert CAD millimeters to meters "
                f"({', '.join(scaled[:8])}). Refused to overwrite source — "
                "gen_step must stay in mm; convert only inside gen_urdf."
            )
        backup = source_path.with_suffix(source_path.suffix + ".bak-before-urdf")
        if not backup.is_file():
            backup.write_text(text, encoding="utf-8")
        source_path.write_text(patched_text.rstrip() + "\n", encoding="utf-8")
        authored = True

    outputs: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    stem = source_path.stem

    def run_one(tool: str, output_name: str, pct: int, timeout: float = 120.0) -> None:
        generation_service.update_progress(
            path,
            {
                "stage": f"generate-{tool}",
                "pct": pct,
                "label": f"Generating {tool.upper()} artifact…",
                "thinking": f"Running Jake scripts/{tool} for {source}.",
            },
            trace_id=trace_id,
        )
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
        run_one("urdf", f"{stem}.urdf", 52)
        # AI-authored gen_urdf() often leaves floating covers/pinions as extra roots.
        # Repair once: attach orphans under a preferred root, patch source, regenerate.
        urdf_errs = [e for e in errors if e.get("tool") == "urdf"]
        multi_root = any(
            "single rooted tree" in str(e.get("stderr") or "") or "found roots" in str(e.get("stderr") or "")
            for e in urdf_errs
        )
        urdf_out = path / f"{stem}.urdf"
        if multi_root and urdf_out.is_file():
            generation_service.update_progress(
                path,
                {
                    "stage": "repair-urdf-tree",
                    "pct": 58,
                    "label": "Repairing URDF joint tree…",
                    "thinking": "Connecting orphan links under a single root with fixed joints.",
                },
                trace_id=trace_id,
            )
            added = _repair_urdf_multi_root_xml(urdf_out)
            if added:
                patched_src = _inject_fixed_joints_into_gen_urdf(
                    source_path.read_text(encoding="utf-8"),
                    added,
                )
                if patched_src:
                    source_path.write_text(patched_src.rstrip() + "\n", encoding="utf-8")
                # Drop prior urdf failure and regenerate from the patched source.
                errors[:] = [e for e in errors if e.get("tool") != "urdf"]
                outputs[:] = [o for o in outputs if o.get("tool") != "urdf"]
                run_one("urdf", f"{stem}.urdf", 62)
        # Prefer real CAD part meshes over white box/cylinder placeholders.
        if urdf_out.is_file() and not any(e.get("tool") == "urdf" for e in errors):
            n_mesh = _rewrite_urdf_visuals_to_part_meshes(urdf_out, path, stem)
            if n_mesh:
                generation_service.update_progress(
                    path,
                    {
                        "stage": "attach-part-meshes",
                        "pct": 68,
                        "label": "Attaching CAD part meshes to URDF…",
                        "thinking": f"Replaced placeholder visuals with {n_mesh} __part_*.glb mesh(es).",
                    },
                    trace_id=trace_id,
                )
    if kind in {"srdf", "both"}:
        run_one("srdf", f"{stem}.srdf", 74)

    project_store.touch_project(path)
    summary = _robot_artifact_summary(path)
    if errors:
        stderr_text = "\n".join(str(err.get("stderr") or "") for err in errors)
        missing_generators: list[str] = []
        if "does not define callable gen_urdf()" in stderr_text:
            missing_generators.append("gen_urdf()")
        if "does not define callable gen_srdf()" in stderr_text:
            missing_generators.append("gen_srdf()")
        if missing_generators:
            message = (
                f"Python source is missing {', '.join(missing_generators)}. "
                "Author URDF/SRDF with AI first, then generate robot artifacts."
            )
        else:
            snippets: list[str] = []
            for err in errors:
                se = str(err.get("stderr") or "").strip()
                if not se:
                    continue
                lines = [ln.strip() for ln in se.splitlines() if ln.strip()]
                if not lines:
                    continue
                pick = next((ln for ln in reversed(lines) if "Error" in ln or "error" in ln), lines[-1])
                tool = str(err.get("tool") or "tool")
                snippets.append(f"{tool}: {pick[:220]}")
            message = (
                "Robot artifact generation failed — " + " | ".join(snippets[:2])
                if snippets
                else "Robot artifact generation failed."
            )
        raise RuntimeError(message)
    msg = (
        "Authored and generated robot artifacts."
        if authored
        else ("Generated robot artifacts." if outputs else "No robot artifacts generated.")
    )
    return {
        "message": msg,
        "authored": authored,
        "outputs": outputs,
        "errors": errors,
        **summary,
    }


def _background_rigging_artifacts(
    project_id: str,
    body_data: dict[str, Any],
    trace_id: str,
    user: dict[str, Any],
) -> None:
    path = PROJECTS / project_id
    try:
        result = _run_rigging_artifact_pipeline(project_id, body_data, trace_id, user)
        output_names = [str(out.get("filename")) for out in result.get("outputs") or [] if out.get("filename")]
        generation_service.update_progress(
            path,
            {
                "stage": "finalize",
                "pct": 96,
                "label": "Finalizing robot artifacts…",
                "thinking": "Refreshing project files and motion artifact list.",
            },
            trace_id=trace_id,
        )
        generation_service.complete(
            path,
            {
                "kind": "rigging",
                "mode": "rigging",
                "message": result.get("message") or "Robot artifacts ready.",
                "trace_id": trace_id,
                "robot_artifacts": output_names,
                "outputs": result.get("outputs"),
                "errors": result.get("errors"),
            },
            trace_id=trace_id,
        )
        trace_add("info", f"Robot artifacts done → {', '.join(output_names) or 'none'}", trace_id=trace_id)
    except Exception as exc:
        logger.exception("Robot artifact generation crashed project=%s trace=%s", project_id, trace_id)
        trace_add("error", f"Robot artifact generation failed: {exc}", trace_id=trace_id)
        generation_service.fail(path, str(exc), trace_id=trace_id)


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
            label="Rigging robot motion",
            mode="rigging",
            request_body={
                "prompt": body.prompt,
                "speed": body.speed,
                "image_count": len(body.images),
            },
            allow_parallel=True,
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
        generation_service.fail(path, str(exc), trace_id=trace_id)
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        trace_add("error", f"Rigging prompt crashed: {exc}", trace_id=trace_id)
        generation_service.fail(path, str(exc), trace_id=trace_id)
        raise

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
    generation_service.complete(
        path,
        {
            "kind": "rigging",
            "mode": "rigging",
            "message": message,
            "trace_id": trace_id,
            "prompt_id": hist_entry.get("id") if isinstance(hist_entry, dict) else None,
        },
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


def _wiring_prompt_with_references(prompt: str, references: list[dict[str, Any]] | None) -> str:
    refs = [r for r in (references or []) if isinstance(r, dict)][:20]
    if not refs:
        return prompt
    lines: list[str] = []
    for ref in refs:
        rtype = str(ref.get("type") or "").strip().lower()
        token = str(ref.get("token") or ref.get("id") or "").strip()
        label = str(ref.get("label") or ref.get("stem") or ref.get("filename") or ref.get("id") or "").strip()
        if rtype == "wire":
            endpoints = ref.get("endpoints") if isinstance(ref.get("endpoints"), dict) else {}
            from_label = str(endpoints.get("from") or ref.get("from_label") or "").strip()
            to_label = str(endpoints.get("to") or ref.get("to_label") or "").strip()
            detail = f"{from_label} -> {to_label}".strip(" ->")
            lines.append(f"- {token or '@wire'}: selected wire \"{label}\"{f' ({detail})' if detail else ''}.")
        elif rtype == "component":
            filename = str(ref.get("filename") or "").strip()
            kind = str(ref.get("kind") or "").strip()
            lines.append(
                f"- {token or '@component'}: component \"{label}\""
                f"{f' ({kind})' if kind else ''}{f' from file {filename}' if filename else ''}."
            )
        else:
            lines.append(f"- {token or '@ref'}: {label or rtype or 'reference'}.")
    if not lines:
        return prompt
    return f"{prompt}\n\nReferenced wiring context:\n" + "\n".join(lines)


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

    ai_prompt = _wiring_prompt_with_references(body.prompt, body.references)

    trace_add(
        "info",
        "Wiring prompt started",
        trace_id=trace_id,
        data={
            "prompt": body.prompt[:300],
            "image_count": len(body.images),
            "driver_link_count": len(body.driver_links),
            "reference_count": len(body.references),
        },
    )
    try:
        schematic, ai_trace, message = wiring_service.generate_wiring_schematic(
            ai,
            ai_prompt,
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
            references=body.references,
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
            references=body.references,
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
        references=body.references,
        trace_id=trace_id,
        user=user,
        message=message,
        ai_traces=ai_trace,
    )
    schematic, _repairs = wiring_service.validate_and_repair_schematic(schematic)
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


def _run_wiring_photo_diagnosis(
    project_id: str,
    body_data: dict[str, Any],
    trace_id: str,
    user: dict[str, Any],
) -> None:
    from backend.services import wiring_service

    path = PROJECTS / project_id
    try:
        if not path.is_dir():
            raise FileNotFoundError("Project not found.")
        body = WiringDiagnoseRequest.model_validate(body_data)
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
        diagnosis, ai_trace = wiring_service.diagnose_circuit_photo(
            ai,
            [img.model_dump() for img in body.images],
            description=body.description,
            current_schematic=current_schematic,
            trace_id=trace_id,
        )
        trace_add(
            "info",
            f"Circuit diagnosis done -> {len(diagnosis.get('issues') or [])} issues",
            trace_id=trace_id,
        )
        wiring_debug_job_service.complete(
            path,
            {
                "diagnosis": diagnosis,
                "trace_id": trace_id,
                "trace": {"ai": ai_trace},
            },
        )
    except (RuntimeError, ValueError) as exc:
        detail = str(exc) or "Diagnosis failed."
        trace_add("error", f"Circuit diagnosis failed: {detail}", trace_id=trace_id)
        wiring_debug_job_service.fail(path, detail, trace_id=trace_id)
    except Exception as exc:
        logger.exception("Circuit diagnosis crashed project=%s trace=%s", project_id, trace_id)
        detail = str(exc) or "Diagnosis failed - please try again."
        wiring_debug_job_service.fail(path, detail, trace_id=trace_id)


@app.post("/api/projects/{project_id}/wiring/diagnose-photo")
def wiring_diagnose_photo(
    project_id: str,
    body: WiringDiagnoseRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(get_current_user),
):
    """Start a background photo diagnosis and let clients poll for the result."""
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    path = _require_project(user, project_id)
    try:
        wiring_debug_job_service.start(path, trace_id=trace_id, user=user)
    except wiring_debug_job_service.DebugJobInProgress as exc:
        return JSONResponse(
            status_code=202,
            content={
                "accepted": True,
                "status": "running",
                "trace_id": exc.current.get("trace_id"),
                "job": wiring_debug_job_service.public_summary(path),
            },
        )
    background_tasks.add_task(
        _run_wiring_photo_diagnosis,
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
            "job": wiring_debug_job_service.public_summary(path),
        },
    )


@app.get("/api/projects/{project_id}/wiring/diagnose-photo/status")
def wiring_diagnose_photo_status(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project_read(user, project_id)
    return wiring_debug_job_service.public_summary(path)


@app.post("/api/projects/{project_id}/wiring/diagnose-photo/cancel")
def wiring_diagnose_photo_cancel(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project_read(user, project_id)
    return wiring_debug_job_service.request_cancel(path)


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
    normalized_example = str(example or "").strip().lower()
    schematic: dict[str, Any] | None = None
    if normalized_example in {"stepper", "arduino-stepper", "stepper-motor"}:
        stepper_bench_path = PROJECTS / "20069e9d" / "wiring.json"
        if stepper_bench_path.is_file():
            schematic = json.loads(stepper_bench_path.read_text(encoding="utf-8"))
            schematic.setdefault("name", "Arduino Stepper Test Bench")
            schematic.setdefault(
                "description",
                "Arduino-compatible board, DRV8825 driver, breadboard rails, and NEMA 17 stepper wiring from the Arduino Stepper Test Bench project.",
            )
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
    }.get(normalized_example, "raspberry-pi-button-motor.json")
    if schematic is None:
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


# ── McMaster-Carr insert library (project/mcmaster_library/) ───────────────────


class McMasterLibraryRecordRequest(BaseModel):
    filenames: list[str] = Field(default_factory=list)
    source: str = "mcmaster"
    page_urls: dict[str, str] = Field(default_factory=dict)
    part_numbers: dict[str, str] = Field(default_factory=dict)
    references: dict[str, str] = Field(default_factory=dict)
    titles: dict[str, str] = Field(default_factory=dict)


@app.get("/api/projects/{project_id}/mcmaster-library")
def get_mcmaster_library(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    return {"entries": cad_service.list_mcmaster_library(path)}


@app.post("/api/projects/{project_id}/mcmaster-library")
def record_mcmaster_library(
    project_id: str,
    body: McMasterLibraryRecordRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    names = [Path(n).name for n in (body.filenames or []) if str(n or "").strip()]
    if not names:
        raise HTTPException(400, "filenames required")
    added = cad_service.record_mcmaster_library_entries(
        path,
        names,
        source=(body.source or "mcmaster").strip() or "mcmaster",
        page_urls=body.page_urls or {},
        part_numbers=body.part_numbers or {},
        references=body.references or {},
        titles=body.titles or {},
    )
    project_store.touch_project(path)
    return {
        "added": added,
        "entries": cad_service.list_mcmaster_library(path),
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
        path, stem, patch.model_dump(exclude_unset=True)
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
        glb_dest = dest.with_suffix(".glb")
        reused = cad_service._try_reuse_cached_preview_glb(dest, glb_dest)
        if reused is not None and glb_dest.is_file():
            viewer_filename = glb_dest.name
        else:
            # Don't block the request on large catalog STEPs — client retries GLB.
            cad_service.schedule_tessellate_step_to_glb(dest, glb_dest)
            viewer_filename = glb_dest.name


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


def _usage_token_count(usage: Any) -> int:
    if not isinstance(usage, dict):
        return 0
    total = int(usage.get("total_tokens") or 0)
    if total:
        return total
    return int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0)


def _usage_meta_for_prompt(
    project_path: Path | None,
    trace_id: str | None,
    ai_traces: list[dict[str, Any]] | dict[str, Any] | None = None,
    job: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Merge usage/cost from AI traces and the generation job (fail/stop often only have job data)."""
    traces: list[dict[str, Any]] = []
    if isinstance(ai_traces, list):
        traces = [t for t in ai_traces if isinstance(t, dict)]
    elif isinstance(ai_traces, dict):
        traces = [ai_traces]

    resolved_job = job
    if resolved_job is None and project_path is not None and trace_id:
        try:
            resolved_job = generation_service.get_job_by_trace(project_path, trace_id)
        except Exception:
            resolved_job = None

    if resolved_job:
        job_traces = generation_service.job_all_ai_traces(resolved_job)
        if job_traces:
            if len(job_traces) >= len(traces):
                traces = job_traces
            elif not traces:
                traces = job_traces

    meta = _usage_history_fields(traces) if traces else {}
    if resolved_job:
        job_usage = resolved_job.get("usage")
        job_tokens = _usage_token_count(job_usage)
        meta_tokens = _usage_token_count(meta.get("usage"))
        if job_usage and job_tokens >= meta_tokens:
            meta["usage"] = job_usage
            if resolved_job.get("cost_usd") is not None:
                meta["cost_usd"] = resolved_job.get("cost_usd")
            if resolved_job.get("ai_calls") is not None:
                meta["ai_calls"] = resolved_job.get("ai_calls")
        elif resolved_job.get("cost_usd") is not None and meta.get("cost_usd") is None:
            meta["cost_usd"] = resolved_job.get("cost_usd")
            if job_usage:
                meta["usage"] = job_usage
        for key in ("model", "provider", "ai_calls"):
            if meta.get(key) is None and resolved_job.get(key) is not None:
                meta[key] = resolved_job.get(key)
    return meta


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
    references: list[dict[str, Any]] | None = None,
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
            references=references or [],
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
    status: str | None = None,
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
        usage_meta = _usage_meta_for_prompt(project_path, trace_id, ai_traces)
        platform_credit_charge = None
        used_platform = str(getattr(body, "ai_key_source", None) or "").strip().lower() == "platform"
        if user and (used_platform or not effective):
            try:
                credits = ai_credit_service.status(user)
                # Charge whenever this prompt used the platform key, or when no
                # personal/team key was selected and platform credits are active.
                should_charge = used_platform or bool(credits.get("use_platform_key"))
                if should_charge and (used_platform or not effective):
                    if int(credits.get("balance_cents") or 0) <= 0 and used_platform:
                        raise ValueError("Not enough shared-key credits. Buy more credits to continue.")
                    if used_platform or credits.get("use_platform_key"):
                        key_meta = {
                            "key_source": "platform",
                            "shared_key_name": "Render Studio shared AI key",
                        }
                        platform_trace = {
                            "cost_usd": usage_meta.get("cost_usd"),
                            "model": usage_meta.get("model"),
                            "provider": usage_meta.get("provider") or "openai",
                        }
                        if platform_trace.get("cost_usd") is not None:
                            platform_credit_charge = ai_credit_service.spend_for_trace(
                                user["id"],
                                platform_trace,
                                project_id=project_path.name,
                            )
                            if platform_credit_charge:
                                key_meta["platform_credit_charge"] = platform_credit_charge
            except ValueError:
                raise
            except Exception as exc:
                logger.warning("platform credit charge failed user_id=%s: %s", user.get("id"), exc)
                raise HTTPException(
                    status_code=402,
                    detail="Could not bill shared-key credits for this generation. Try again or buy more credits.",
                ) from exc
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
        entry = prompt_history_service.append_entry(
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
            original_prompt=getattr(body, "original_prompt", None),
            prompt_improved=bool(getattr(body, "prompt_improved", False)),
            target_mode=(getattr(body, "target_mode", None) or ("edit" if body.base_filename else "new")),
            codex_agent=bool(
                getattr(body, "codex_agent", False) or getattr(body, "jake_codex_agent", False)
            ),
            skills=list(getattr(body, "skills", None) or []),
            entry_id=str(getattr(body, "prompt_id", None) or "").strip() or None,
            status=status,
            **usage_meta,
            **key_meta,
        )
        if success and user and filename:
            try:
                from backend.services.sam_alert_email_service import maybe_notify_first_model_async

                maybe_notify_first_model_async(
                    user,
                    project_id=project_path.name,
                    project_path=project_path,
                    filename=filename,
                    prompt=prompt,
                )
            except Exception:
                logger.debug("Sam first-model notify skipped", exc_info=True)
        return entry
    except ValueError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
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


def _looks_like_scene_render_intent(text: str) -> bool:
    """Detect photoreal scene-render requests even when UI mode is CAD (e.g. Mode 2.0)."""
    t = " ".join(str(text or "").lower().split())
    if not t:
        return False
    if "render3d" in t and "render" not in t.replace("render3d", ""):
        return False
    if any(k in t for k in ("photoreal", "photo-real", "photo real", "product shot", "lifestyle shot")):
        return True
    if re.search(r"\b(create|make|generate|do|give me|i want)\s+(a\s+|an\s+)?(photoreal(?:istic)?\s+)?render\b", t):
        return True
    if re.search(r"\brender\s+(of|this|the|my|it|from)\b", t):
        return True
    if re.search(r"\brender\b", t) and re.search(
        r"\b(table|desk|counter|outside|outdoors|kitchen|studio|environment|scene|living room|on a)\b",
        t,
    ):
        return True
    return False


def _scene_render_prompt(user_prompt: str, project_name: str | None, base_filename: str | None) -> str:
    context = f"Model/project: {project_name or 'Render Studio model'}"
    if base_filename:
        context += f" ({base_filename})"
    return (
        "IMAGE-TO-IMAGE EDIT: photorealize the exact CAD model shown in the attached viewport image. "
        "The viewport is a faithful capture of linked STEP/GLB geometry — it is the geometry source of truth.\n"
        "HARD CONSTRAINTS (do not violate):\n"
        "- Preserve the exact silhouette, part count, topology, proportions, hole locations, fastener positions, "
        "cable/rope routing, crank/handle side, plate orientation, and camera-relative pose from the viewport.\n"
        "- Do NOT invent a different product layout, swap left/right, flatten a vertical plate into a base, "
        "or restyle the product into a generic catalog lookalike.\n"
        "- Do NOT add, remove, merge, or reshape structural parts. Environment/materials only.\n"
        "- Keep the same viewing angle and object orientation; only change lighting, materials, and surroundings.\n"
        "Allowed changes: realistic materials/colors/finish, environment and lighting from the user brief, "
        "contact shadows, depth of field, and natural scale cues.\n\n"
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
    usage_callback=None,
):
    """New engineering pipeline: AI -> Feature Program -> validated, exported model."""
    from backend.services import design_service
    from backend.services.design_service import DesignBuildError, DesignCanceled

    refs_list = [r.model_dump() for r in body.references]
    context = _attach_knowledge_context(
        _slim_context(project_id, project_path, body),
        body,
        user,
        skills=body.skills,
    )
    previous_source, previous_source_name = (None, None)
    if (getattr(body, "mode", "standard") or "standard").lower() in {"v2", "fusion", "architect", "mesh"} and body.base_filename:
        previous_source, previous_source_name = _source_for_base_model(project_path, body.base_filename)
        if previous_source_name:
            trace_add(
                "info",
                "Using current model Python source for CAD quality edit",
                trace_id=trace_id,
                data={"base_filename": body.base_filename, "source": previous_source_name},
            )
        elif str(getattr(body, "target_mode", "") or "").strip().lower() == "edit":
            trace_add(
                "warning",
                "Edit requested but no Python source found for base model",
                trace_id=trace_id,
                data={"base_filename": body.base_filename},
            )
    # Carry edit intent into the design context so CREATE cannot silently win.
    if isinstance(context, dict):
        context = {
            **context,
            "target_mode": str(getattr(body, "target_mode", "") or "").strip().lower() or ("edit" if body.base_filename else "new"),
            "base_filename": body.base_filename,
        }
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
            usage_callback=usage_callback,
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
        meta=_prompt_timeline_meta(
            body,
            program=result.get("program"),
            files=result.get("files"),
            intent=out.get("intent"),
            message=out.get("message"),
            placed_parts=placed_parts,
            design_plan=out.get("design_plan"),
            sim=result.get("sim"),
            dfm=result.get("dfm"),
            trace_id=trace_id,
            **usage_meta,
        ),
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
    # Admins viewing other users' renders need status too (stop + live overlay).
    path = _require_project_read(user, project_id)
    return generation_service.public_summary(path)


class CancelGenerationRequest(BaseModel):
    trace_id: str | None = Field(
        default=None,
        max_length=128,
        description="Cancel only this generation job. Omit to cancel every running job.",
    )


class StoppedPromptHistoryRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    trace_id: str | None = Field(default=None, max_length=128)
    prompt_mode: str = "render"
    kind: str = "render"
    base_filename: str | None = None
    speed: str | None = None
    message: str | None = None


def _stopped_prompt_message(
    ai_traces: list[dict[str, Any]] | dict[str, Any] | None = None,
    *,
    fallback: str = "Stopped before completion.",
    usage_meta: dict[str, Any] | None = None,
) -> str:
    meta = usage_meta if usage_meta is not None else _usage_history_fields(ai_traces)
    usage = meta.get("usage") or {}
    tokens = _usage_token_count(usage)
    cost = meta.get("cost_usd")
    extras: list[str] = []
    if tokens > 0:
        extras.append(f"{tokens:,} tokens")
    if cost is not None:
        extras.append(f"${float(cost):.4f} est.")
    if not extras:
        return fallback
    return f"{fallback.rstrip('.')}. Used {' · '.join(extras)} before stopping."


def _upsert_stopped_prompt_history_from_job(
    project_path: Path,
    job: dict[str, Any],
    *,
    trace_id: str | None = None,
    charge_credits: bool = True,
) -> dict[str, Any] | None:
    job_trace_id = str(job.get("trace_id") or job.get("id") or trace_id or "").strip()
    if not job_trace_id:
        return None
    body_data = job.get("request_body")
    if not isinstance(body_data, dict):
        return None
    try:
        body = PromptRequest.model_validate(body_data)
    except Exception:
        return None
    ai_traces = job.get("ai_traces")
    try:
        from backend.services.generation_service import job_all_ai_traces

        combined = job_all_ai_traces(job)
        if combined:
            ai_traces = combined
    except Exception:
        pass
    usage_meta = _usage_meta_for_prompt(project_path, job_trace_id, ai_traces, job=job)
    message = _stopped_prompt_message(ai_traces, usage_meta=usage_meta)
    existing = prompt_history_service.list_entries(project_path, limit=500)
    prior = next((e for e in existing if str(e.get("trace_id") or "") == job_trace_id), None)
    if prior and prior.get("status") == "stopped":
        charge_credits = False
        prior_tokens = _usage_token_count(prior.get("usage"))
        new_tokens = _usage_token_count(usage_meta.get("usage"))
        if prior_tokens >= new_tokens and prior.get("cost_usd") is not None:
            return prior
    job_user = get_user_by_id(str(job.get("by_user_id") or "")) if job.get("by_user_id") else None
    if charge_credits and not prior:
        return _save_prompt_history(
            project_path,
            prompt=body.prompt,
            success=False,
            body=body,
            refs_list=[r.model_dump() for r in body.references],
            trace_id=job_trace_id,
            user=job_user,
            message=message,
            error="Stopped by user.",
            status="stopped",
            ai_traces=ai_traces,
        )
    try:
        return prompt_history_service.append_entry(
            project_path,
            prompt=body.prompt,
            success=False,
            message=message,
            speed=body.speed,
            error="Stopped by user.",
            references=[r.model_dump() for r in body.references],
            trace_id=job_trace_id,
            user_id=job_user["id"] if job_user else None,
            user_name=job_user["display_name"] if job_user else None,
            user_avatar_url=_avatar_url_for_user_id(job_user["id"]) if job_user else None,
            prompt_mode=(body.mode or "standard").lower(),
            kind="prompt",
            status="stopped",
            target_mode=str(getattr(body, "target_mode", "") or "").strip().lower() or None,
            **usage_meta,
        )
    except Exception as exc:
        logger.debug("Could not upsert stopped prompt history for %s trace=%s: %s", project_path.name, job_trace_id, exc)
    return None


def _refresh_stopped_prompt_history_usage(
    project_path: Path,
    trace_id: str,
    body_data: dict[str, Any] | None = None,
    user: dict[str, Any] | None = None,
) -> None:
    job = generation_service.get_job_by_trace(project_path, trace_id)
    if not job:
        if body_data and user:
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
                    message="Stopped before completion.",
                    error="Stopped by user.",
                    status="stopped",
                )
            except Exception:
                pass
        return
    _upsert_stopped_prompt_history_from_job(project_path, job, trace_id=trace_id, charge_credits=False)


def _save_stopped_prompt_history_for_jobs(
    project_path: Path,
    jobs: list[dict[str, Any]],
    *,
    trace_id: str | None = None,
) -> None:
    for job in jobs:
        if str(job.get("kind") or "prompt").lower() != "prompt":
            continue
        job_trace_id = str(job.get("trace_id") or job.get("id") or "").strip()
        if trace_id and job_trace_id != trace_id:
            continue
        _upsert_stopped_prompt_history_from_job(project_path, job, trace_id=trace_id)


@app.post("/api/projects/{project_id}/generation/cancel")
def cancel_generation(
    project_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    body: CancelGenerationRequest = Body(default=CancelGenerationRequest()),
):
    # Allow workspace members and a1projects admins to stop a runaway generation.
    path = _require_project_read(user, project_id)
    if not generation_service.is_running(path):
        return generation_service.public_summary(path)
    trace_id = str(body.trace_id or "").strip() or None
    _save_stopped_prompt_history_for_jobs(path, generation_service.list_running_jobs(path), trace_id=trace_id)
    result = generation_service.request_cancel(path, trace_id=trace_id)
    if trace_id:
        job = generation_service.get_job_by_trace(path, trace_id)
        if job:
            _upsert_stopped_prompt_history_from_job(path, job, trace_id=trace_id, charge_credits=False)
    else:
        for canceled_tid in result.get("canceled_trace_ids") or []:
            job = generation_service.get_job_by_trace(path, canceled_tid)
            if job:
                _upsert_stopped_prompt_history_from_job(path, job, trace_id=canceled_tid, charge_credits=False)
    return result


@app.post("/api/projects/{project_id}/prompt-history/stopped")
def record_stopped_prompt_history(
    project_id: str,
    body: StoppedPromptHistoryRequest,
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _require_project(user, project_id)
    trace_id = str(body.trace_id or new_trace_id()).strip()
    message = str(body.message or "Stopped before completion.").strip()
    try:
        entry = prompt_history_service.append_entry(
            path,
            prompt=body.prompt,
            success=False,
            message=message,
            speed=body.speed or "fast",
            error="Stopped by user.",
            base_filename=body.base_filename,
            trace_id=trace_id,
            user_id=user["id"],
            user_name=user["display_name"],
            user_avatar_url=_avatar_url_for_user_id(user["id"]),
            prompt_mode=str(body.prompt_mode or "render").lower(),
            kind=str(body.kind or "render").lower(),
            status="stopped",
        )
        return {"ok": True, "entry": entry}
    except Exception as exc:
        logger.debug("stopped prompt history save failed project=%s: %s", project_id, exc)
        raise HTTPException(500, "Could not save stopped prompt history.") from exc


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
        ai = _get_ai_for_user(
            user,
            speed,
            key_id=body.ai_key_id,
            key_source=body.ai_key_source,
            project_id=project_id,
        )
        def progress_callback(progress: dict[str, Any]) -> None:
            generation_service.update_progress(project_path, progress, trace_id=trace_id)

        def usage_callback(traces: list[dict[str, Any]]) -> None:
            generation_service.record_ai_traces(project_path, traces, trace_id=trace_id)

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
            usage_callback=usage_callback,
        )
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            _refresh_stopped_prompt_history_usage(project_path, trace_id, body_data, user)
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
        generation_service.complete(project_path, complete_payload, trace_id=trace_id)
        filename = result.get("filename")
        if filename:
            import threading

            threading.Thread(
                target=_background_push_new_file_to_fusion,
                args=(project_id, project_path, filename),
                daemon=True,
                name=f"fusion-new-file-{project_id}-{Path(str(filename)).stem[:24]}",
            ).start()
            try:
                from backend.services.sam_alert_email_service import maybe_notify_first_model_async

                prompt_text = ""
                try:
                    prompt_text = str(PromptRequest.model_validate(body_data).prompt or "")
                except Exception:
                    prompt_text = str((body_data or {}).get("prompt") or "")
                maybe_notify_first_model_async(
                    user,
                    project_id=project_id,
                    project_path=project_path,
                    filename=str(filename),
                    prompt=prompt_text,
                )
            except Exception:
                logger.debug("Sam first-model notify skipped (background)", exc_info=True)
    except HTTPException as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            # Always refresh stopped history with latest usage/cost (Mesh used to
            # raise 422 on cancel and skip this — history showed $0 / no cost).
            _refresh_stopped_prompt_history_usage(project_path, trace_id, body_data, user)
            return
        detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
        fail_payload: dict[str, Any] = {"error": detail}
        if exc.status_code not in (499,):
            try:
                body = PromptRequest.model_validate(body_data)
                existing = prompt_history_service.list_entries(project_path, limit=500)
                already_saved = any(str(e.get("trace_id") or "") == str(trace_id) for e in existing)
                ai_traces = getattr(exc, "ai_traces", None)
                usage_meta = _usage_meta_for_prompt(project_path, trace_id, ai_traces)
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
                        ai_traces=ai_traces,
                    )
                    if saved:
                        for key in ("usage", "cost_usd", "model", "provider", "ai_calls"):
                            if saved.get(key) is not None:
                                fail_payload[key] = saved.get(key)
                else:
                    for key in ("usage", "cost_usd", "model", "provider", "ai_calls"):
                        if usage_meta.get(key) is not None:
                            fail_payload[key] = usage_meta.get(key)
            except Exception:
                pass
        generation_service.fail(project_path, detail, trace_id=trace_id, extra=fail_payload)
    except Exception as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            _refresh_stopped_prompt_history_usage(project_path, trace_id, body_data, user)
            return
        logger.exception("Background prompt failed project=%s trace=%s", project_id, trace_id)
        fail_payload = {"error": str(exc)}
        ai_traces = getattr(exc, "ai_traces", None)
        usage_meta = _usage_meta_for_prompt(project_path, trace_id, ai_traces)
        fail_payload.update({k: v for k, v in usage_meta.items() if v is not None})
        try:
            body = PromptRequest.model_validate(body_data)
            existing = prompt_history_service.list_entries(project_path, limit=500)
            already_saved = any(str(e.get("trace_id") or "") == str(trace_id) for e in existing)
            if not already_saved:
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
            trace_id=trace_id,
        )
    except Exception as exc:
        if generation_service.is_canceled(project_path, trace_id) or not project_path.is_dir():
            timer.done(canceled=True)
            return
        timer.done(error=str(exc))
        trace_add("error", f"Kernel build failed: {exc}", trace_id=trace_id)
        generation_service.fail(project_path, f"Kernel build failed: {exc}", trace_id=trace_id)


IMPROVE_CAD_PROMPT_SYSTEM = """You rewrite user prompts into stronger text-to-CAD generation prompts for Render Studio Mode 2.0 / parametric CAD.

Return JSON only:
{"improved_prompt":"..."}

Rules for improved_prompt:
- Start with the short product/part name (2–5 words), then a colon, then the CAD details.
  Example: "Parallel gripper: dual-finger FDM-printable gripper, 80 mm stroke, named bodies base/jaw_left/jaw_right."
- Do NOT open with CAD boilerplate like "Create a parametric fully assembled CAD/STEP/multi-body assembly…".
  Put process words (parametric, STEP, mm, named bodies) after the colon, not before the part name.
- Keep the user's intent, product, and constraints. Do not invent a totally different part.
- Make it concrete for parametric CAD: units (mm preferred), overall size envelope, key dimensions, wall thickness, fillets/chamfers when relevant.
- Prefer named features (base, boss, pocket, rib, hole pattern) and clear solids over vague styling words.
- State manufacturing intent when useful (FDM print, CNC, sheet metal, snap-fit, assembly of named bodies).
- Prefer one clear primary solid/job; list secondary features as short clauses in one paragraph.
- Name mating/fit relationships if the part must fit something else.
- For edits, phrase as a revision of the existing selected object (what to change, what to keep).
- Put the entire rewrite inside the improved_prompt string. Escape newlines as \\n inside the JSON string.
- Do not mention that you are an AI or that you rewrote the prompt.
- Keep under 1200 characters when possible; hard max 4000.
"""

IMPROVE_RENDER_PROMPT_SYSTEM = """You rewrite user prompts into stronger Render-mode prompts for Render Studio.

Render mode generates a photoreal image from the current viewport/model reference. It should describe scene, environment, lighting, camera, materials, and mood, not Mode 2.0 CAD geometry or a parametric feature tree.

Return JSON only:
{"improved_prompt":"..."}

Rules for improved_prompt:
- Keep the user's intent and subject. Do not invent a totally different object.
- Optimize for the image render: environment, lighting, camera angle, surface finish, color/material, shadows, reflections, and grounding/contact with the scene.
- Preserve the current model geometry as the subject. Do not ask to add, remove, redesign, or reshape parts unless the user explicitly asks.
- Include scale cues only when they help the scene (for example tabletop, kitchen counter, outdoor pavement, hand-scale product shot).
- Prefer concrete visual nouns over CAD jargon (avoid “extrude, loft, pocket, pad, feature tree”).
- State orientation and placement clearly so the current model appears naturally in the scene.
- For edits, describe the visible render change only (material, lighting, background, camera), not CAD feature edits.
- Put the entire rewrite inside the improved_prompt string. Escape newlines as \\n inside the JSON string.
- Do not mention that you are an AI or that you rewrote the prompt.
- Keep under 1200 characters when possible; hard max 4000.
"""


IMPROVE_MESH_PROMPT_SYSTEM = """You rewrite user prompts into stronger Mesh-mode prompts for Render Studio (img2threejs).

Follow the img2threejs GitHub look-dev rules used for rendering there
(grimoire/feedback/shading_realism.md + grimoire/build/threejs_texture_reference.md):
Mesh mode rebuilds the object as a CODE-ONLY procedural Three.js model
(primitives + MeshPhysicalMaterial/MeshStandardMaterial + hierarchy), then exports GLB.
Your rewrite must make EVERYTHING look REALISTIC in the viewport — the same bar as img2threejs
material-pass look-dev — not flat toy colors, and NOT CAD/STEP/Mode 2.0.

Return JSON only:
{"improved_prompt":"..."}

Rules for improved_prompt:
- Start with the short object name (2–5 words), then a colon, then mesh + realistic material details.
  Example: "Desk lamp: cylindrical base, tapered stem, conical shade; brushed black metal stem (metalness 0.85, roughness 0.32, anisotropy streaks, slight edge wear), warm cream fabric shade (roughness 0.82, soft weave bump), soft plastic switch (roughness 0.55, fingerprint mottling)."
- Make EVERY surface read as realistic (img2threejs material-pass bar):
  * Independent PBR channels — albedo/color, roughness, metalness, and when useful normal/bump/AO
    (never reuse color as roughness or as a height/normal map).
  * Name each distinct finish as its own mesh part (metal / plastic / glass / rubber / painted / fabric / wood).
  * Give numeric material cues: metalness, roughness, clearcoat, clearcoatRoughness, transmission/opacity, ior, emissive.
  * Add locality: edge wear, dirt in cavities, scratches, fingerprints, faded zones, mottling — not one flat color per part.
  * Call out tactile response (micro bumps, brushed grain, fabric weave, casting texture, scale hierarchy).
- Prefer hard-surface primitives + clear hierarchy; silhouette and proportions must match the subject.
- If a reference image is implied: match silhouette, sample real colors from the photo, separate materials per part,
  and prefer reference-derived PBR evidence over invented flat colors.
- Finish recipes from threejs_texture_reference (use when they fit):
  * painted-metal: metalness ~0, mid roughness, clearcoat 1
  * brushed-steel: metalness 1, roughness ~0.35, anisotropy
  * worn-composite / rubber: metalness 0, roughness ~0.9, mottled albedo + bump
  * gemstone/glass: transmission + clearcoat; gem-metal / candy/anodized: moderate metalness + clearcoat (no transmission)
- FORBIDDEN: CAD/STEP wording (extrude, loft, pocket, pad, B-rep, feature tree, wall thickness, CNC, FDM);
  photoreal camera/HDRI scene briefs (that is Render mode).
- For edits: which mesh parts or materials to change, what to keep.
- Put the entire rewrite inside the improved_prompt string. Escape newlines as \\n inside the JSON string.
- Do not mention that you are an AI or that you rewrote the prompt.
- Keep under 1400 characters when possible; hard max 4000.
"""


@app.post("/api/prompt/improve")
def improve_cad_prompt(body: ImprovePromptRequest, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    """Rewrite a freeform prompt into a stronger Render Studio prompt using the user's AI key."""
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    original = (body.prompt or "").strip()
    if not original:
        raise HTTPException(400, "Prompt is required")
    # Prompt improvement is only a rewrite/preflight step. Keep it on the fast
    # model path so Quality CAD generation does not appear to cancel while
    # waiting on a slow pro-model rewrite.
    improve_speed = "fast"
    ai = _get_ai_for_user(
        user,
        improve_speed,
        key_id=body.ai_key_id,
        key_source=body.ai_key_source,
        project_id=body.project_id,
    )
    mode = (body.mode or "standard").strip().lower()
    if mode in {"fusion", "fusion360", "fusion-360"}:
        mode = "mesh"
    target = (body.target_mode or "new").strip().lower()
    # Honor the explicit mode from the client. Photoreal scene-render submits
    # send mode="render"; Mode 2.0 / Architect keep CAD improve; Mesh uses mesh improve.
    use_render_improve = mode in {"render", "standard", ""}
    use_mesh_improve = mode in {"mesh", "img2threejs", "threejs"}
    mode_hint = {
        "v2": "Parametric CAD 2.0 (build123d / STEP). Prefer precise dimensions and named features.",
        "vibecad": (
            "VibeCAD engine (10-X-eng build123d sidecar): principal mechanical design, named single-solid "
            "outputs in a result dict, millimetres, defensible engineering defaults."
        ),
        "mesh": (
            "Mesh mode (img2threejs GitHub look-dev): rewrite so EVERY surface looks realistic in the viewport — "
            "named mesh parts, independent PBR (albedo/roughness/metalness/clearcoat), wear/dirt locality, "
            "and tactile detail. Do NOT convert into Mode 2.0 CAD / STEP instructions or a photoreal camera brief."
        ),
        "architect": "Modular architecture / room kit parts with separate named bodies and snap interfaces.",
        "draw": "Direct modeling edit of selected faces/edges. Be specific about which features change.",
        "render": (
            "Render mode: improve for a photoreal image render using the current viewport/model as the subject "
            "(environment, lighting, camera, material finish). Do not convert it into Mode 2.0 CAD instructions. "
            "Preserve existing CAD geometry; only describe scene/materials."
        ),
        "standard": (
            "Render / standard generation: improve for a clear photoreal image render, "
            "not Mode 2.0 feature-tree wording."
        ),
    }.get(mode, "General generation. Include shape, size, and how it should look when rendered.")
    target_hint = (
        "This is an EDIT of an existing selected object — preserve overall identity and only change what the user asked."
        if target == "edit"
        else "This is a NEW object generation."
    )
    if use_mesh_improve:
        system_prompt = IMPROVE_MESH_PROMPT_SYSTEM
    elif use_render_improve:
        system_prompt = IMPROVE_RENDER_PROMPT_SYSTEM
    else:
        system_prompt = IMPROVE_CAD_PROMPT_SYSTEM
    plain_retry = (
        "Rewrite this into a stronger Mesh-mode prompt for realistic Three.js materials "
        "(named parts, independent PBR, wear/locality — img2threejs shading_realism). "
        "Forbidden: CAD/STEP wording and photoreal camera briefs. Return only the improved prompt text."
        if use_mesh_improve
        else (
            "Rewrite this into a stronger Render-mode prompt focused on how the object should look when rendered. "
            "Return only the improved prompt text."
            if use_render_improve
            else "Rewrite this into a stronger parametric CAD / Mode 2.0 prompt. Return only the improved prompt text."
        )
    )
    user_content = (
        f"Mode: {mode}\n{mode_hint}\n{target_hint}\n\n"
        + (
            "IMPORTANT: Follow img2threejs realistic material look-dev. Make every surface believable "
            "(independent roughness/metalness, local wear, no flat toy colors). Not CAD.\n\n"
            if use_mesh_improve
            else ""
        )
        + f"User prompt to improve:\n{original}"
    )
    # Prefer fast, non-reasoning improve; the generated model still honors the
    # user's selected quality/speed when /api/projects/{id}/prompt starts.
    improve_effort = "none"
    call_trace: dict[str, Any] = {}
    improved = ""
    try:
        raw, call_trace = ai._call_model(
            system_prompt,
            user_content,
            trace_id=trace_id,
            max_tokens=4096,
            json_response=True,
            allow_truncated=True,
            reasoning_effort=improve_effort,
        )
        improved = AIService.extract_improved_prompt(raw)
        if not improved:
            # One plain-text retry without JSON constraints.
            raw2, call_trace2 = ai._call_model(
                plain_retry,
                user_content,
                trace_id=trace_id,
                max_tokens=2048,
                json_response=False,
                allow_truncated=True,
                reasoning_effort=improve_effort,
            )
            call_trace = {**call_trace, "plain_retry": call_trace2}
            improved = AIService.extract_improved_prompt(raw2) or str(raw2 or "").strip()
    except Exception as exc:
        logger.warning("prompt improve failed: %s", exc, exc_info=True)
        trace_add("error", f"Could not improve prompt: {exc}", trace_id=trace_id)
        raise HTTPException(502, f"Could not improve prompt: {exc}") from exc
    if not improved:
        raise HTTPException(502, "AI returned an empty improved prompt")
    if len(improved) > 8000:
        improved = improved[:8000]
    return {
        "prompt": original,
        "improved_prompt": improved,
        "mode": mode,
        "improve_style": "render" if use_render_improve else "cad",
        "trace": {
            "model": call_trace.get("model"),
            "provider": call_trace.get("provider"),
            "usage": call_trace.get("usage"),
            "cost_usd": call_trace.get("cost_usd"),
            "truncated": bool(call_trace.get("truncated")),
        },
    }


@app.post("/api/projects/{project_id}/prompt")
def prompt_cad(
    project_id: str,
    body: PromptRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(get_current_user),
):
    trace_id = getattr(request.state, "trace_id", new_trace_id())
    project_path = _require_project_write(user, project_id)
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
                "Drop the DXF into the AI prompt or upload it to Reference Files, then retry. "
                f"Missing DXF content for: {', '.join(missing_dxf_content[:3])}",
            )
        resolved_skills = [*resolved_skills, "dxf"] if "dxf" not in {s.lower() for s in resolved_skills} else resolved_skills
    body = body.model_copy(update={"skills": resolved_skills})

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
            # NEVER clear base_filename on edits — that forces CREATE and regenerates
            # from scratch instead of extending the selected viewport object / face.
            v2_skills = ["cad"]
            if "dxf" in {str(s).lower() for s in resolved_skills}:
                v2_skills.append("dxf")
            updates.update({
                "fusion_target": "in_app",
                "skills": v2_skills,
            })
            target_mode = str(getattr(body, "target_mode", "") or "").strip().lower()
            is_edit_intent = (
                target_mode == "edit"
                or _has_surface_edit_reference(body)
                or _is_reference_anchored_addition(body)
                or _is_length_extend_edit(body)
            )
            if is_edit_intent:
                base = body.base_filename or _infer_surface_edit_base(project_path, body) or _reference_base_filename(body)
                if base:
                    updates["base_filename"] = base
                    updates["target_mode"] = "edit"
                    trace_add(
                        "info",
                        "Preserved/recovered base model for Mode 2.0 edit",
                        trace_id=trace_id,
                        data={"base_filename": base, "target_mode": "edit"},
                    )
            else:
                # Fresh generative 2.0 only — do not inherit an unrelated prior base.
                updates["base_filename"] = None
        design_body = body.model_copy(update=updates)
        model_meta = _resolve_prompt_model_meta(user, design_body, project_id=project_id)
        request_payload = design_body.model_dump(mode="json")
        if model_meta.get("model"):
            request_payload["model"] = model_meta["model"]
        if model_meta.get("provider"):
            request_payload["provider"] = model_meta["provider"]
        try:
            generation_service.start(
                project_path,
                kind="prompt",
                trace_id=trace_id,
                user=user,
                prompt=body.prompt,
                mode=body.mode,
                request_body=request_payload,
                model=model_meta.get("model"),
                provider=model_meta.get("provider"),
                speed=model_meta.get("speed") or design_body.speed,
            )
        except generation_service.GenerationCanceled as exc:
            raise HTTPException(499, exc.message) from exc
        except generation_service.GenerationInProgress as exc:
            raise HTTPException(409, "Generation already in progress for this project") from exc
        started_doc = generation_service.load(project_path) or {}
        started = None
        for job in started_doc.get("jobs") or []:
            if str(job.get("trace_id") or job.get("id") or "") == str(trace_id):
                started = job
                break
        if started is None and str(started_doc.get("trace_id") or "") == str(trace_id):
            started = started_doc
        prompt_id = (started or {}).get("prompt_id") or ((started or {}).get("request_body") or {}).get("prompt_id")
        bg_body = design_body.model_dump(mode="json")
        if prompt_id:
            bg_body["prompt_id"] = prompt_id
        background_tasks.add_task(
            _background_prompt_kernel,
            project_id,
            bg_body,
            trace_id,
            dict(user),
        )
        return JSONResponse(
            status_code=202,
            content={
                "accepted": True,
                "status": "running",
                "trace_id": trace_id,
                "prompt_id": prompt_id,
                "generation": generation_service.public_summary(project_path),
            },
        )

    refs_list = [r.model_dump() for r in body.references]
    refs_map = cad_service.references_map(refs_list)
    context = _attach_knowledge_context(
        _slim_context(project_id, project_path, body),
        body,
        user,
        skills=resolved_skills,
    )

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
        # Keep base on edit / face-extend jobs so kernel revises the viewport object.
        keep_base = (
            str(getattr(body, "target_mode", "") or "").strip().lower() == "edit"
            or _has_surface_edit_reference(body)
            or _is_length_extend_edit(body)
            or _is_reference_anchored_addition(body)
        )
        if body.base_filename and not keep_base:
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
        meta=_prompt_timeline_meta(
            body,
            actions=actions,
            references=refs_list,
            message=plan_message,
        ),
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
        # High input fidelity keeps STEP/viewport silhouette locked; quality follows speed.
        render_quality = "high" if str(body.speed or "").lower() == "quality" else "medium"
        edit_kwargs: dict[str, Any] = {
            "model": "gpt-image-1",
            "image": image_file,
            "prompt": prompt,
            "size": "1024x1024",
            "input_fidelity": "high",
            "quality": render_quality,
            "output_format": "png",
        }
        try:
            response = ai.client.images.edit(**edit_kwargs)
        except TypeError:
            # Older SDK / model combo without fidelity knobs — fall back.
            response = ai.client.images.edit(
                model="gpt-image-1",
                image=image_file,
                prompt=prompt,
                size="1024x1024",
            )
        except Exception as fidelity_exc:
            # Some accounts reject quality/fidelity; retry with the classic call.
            if "input_fidelity" in str(fidelity_exc).lower() or "quality" in str(fidelity_exc).lower():
                image_file.seek(0)
                response = ai.client.images.edit(
                    model="gpt-image-1",
                    image=image_file,
                    prompt=prompt,
                    size="1024x1024",
                )
            else:
                raise
        from backend.services.ai_cost import usage_from_openai_response

        render_usage = usage_from_openai_response(response)
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
        usage=render_usage or None,
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
        "cost_usd": hist_entry.get("cost_usd") if hist_entry else None,
        "usage": hist_entry.get("usage") if hist_entry else None,
        "file_kind": "image",
        "section": "renders",
        "base_filename": body.base_filename,
    }


@app.post("/api/projects/{project_id}/render-region-edit")
def render_region_edit(project_id: str, body: RenderRegionEditRequest, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    """Edit a rectangular region of a render/reference image via OpenAI images.edit, then composite back."""
    import io
    from PIL import Image

    trace_id = getattr(request.state, "trace_id", new_trace_id())
    project_path = _require_project(user, project_id)
    try:
        full_bytes, _ext = _decode_data_url_image(body.source_image)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    ai = _render_ai_for_user(user, body, project_id)
    if ai.provider != "openai":
        raise HTTPException(400, "Region image edit needs an OpenAI key.")

    try:
        full_img = Image.open(io.BytesIO(full_bytes)).convert("RGBA")
    except Exception as exc:
        raise HTTPException(400, f"Could not read source image: {exc}") from exc

    region = body.region or {}
    try:
        rx = max(0, int(region.get("x", 0)))
        ry = max(0, int(region.get("y", 0)))
        rw = max(1, int(region.get("w", full_img.width)))
        rh = max(1, int(region.get("h", full_img.height)))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid region") from None
    rw = min(rw, full_img.width - rx)
    rh = min(rh, full_img.height - ry)
    if rw < 8 or rh < 8:
        raise HTTPException(400, "Selected region is too small")

    crop = full_img.crop((rx, ry, rx + rw, ry + rh)).convert("RGBA")
    crop_rgb = Image.new("RGB", crop.size, (255, 255, 255))
    crop_rgb.paste(crop, mask=crop.split()[-1] if crop.mode == "RGBA" else None)
    crop_buf = io.BytesIO()
    crop_rgb.save(crop_buf, format="PNG")
    crop_buf.seek(0)
    crop_buf.name = "region.png"

    edit_prompt = (
        "Edit only this cropped image region according to the user instruction. "
        "Preserve subject identity, perspective, and lighting continuity so it can be pasted back into the full photo. "
        "Do not add borders, frames, or captions.\n\n"
        f"User instruction: {body.prompt}"
    )
    try:
        response = ai.client.images.edit(
            model="gpt-image-1",
            image=crop_buf,
            prompt=edit_prompt,
            size="1024x1024",
        )
        from backend.services.ai_cost import usage_from_openai_response

        render_usage = usage_from_openai_response(response)
        b64 = _extract_openai_image_b64(response)
        if not b64:
            raise RuntimeError("Image API returned no image data")
        edited_bytes = base64.b64decode(b64)
        edited = Image.open(io.BytesIO(edited_bytes)).convert("RGBA")
        edited = edited.resize((rw, rh), Image.Resampling.LANCZOS)
    except Exception as exc:
        raise HTTPException(502, f"Region edit failed: {exc}") from exc

    composed = full_img.copy()
    composed.paste(edited, (rx, ry), edited)
    out_buf = io.BytesIO()
    composed.convert("RGB").save(out_buf, format="PNG")
    render_bytes = out_buf.getvalue()

    save_mode = str(body.save_mode or "new").lower()
    source_name = Path(body.source_filename or "").name if body.source_filename else ""
    renders_dir = project_path / "renders"
    renders_dir.mkdir(parents=True, exist_ok=True)
    if save_mode == "replace" and source_name:
        dest = renders_dir / source_name
        if not dest.is_file():
            alt = project_path / "references" / source_name
            if alt.is_file():
                dest = alt
        if not cad_service.is_markup_path(project_path, dest):
            raise HTTPException(400, "Can only replace files under renders/ or references/")
        dest.write_bytes(render_bytes)
        filename = dest.name
        url = (
            f"/api/projects/{project_id}/files/{filename}"
            if dest.parent.name == "references" or dest.parent.name in cad_service.REFERENCE_SUBFOLDERS
            else f"/api/projects/{project_id}/renders/{filename}"
        )
    else:
        filename = _write_scene_render(project_path, render_bytes)
        url = f"/api/projects/{project_id}/renders/{filename}"

    message = f"Region edit: {body.prompt}"
    hist_entry = prompt_history_service.append_entry(
        project_path,
        prompt=body.prompt,
        success=True,
        message=message,
        filename=filename,
        base_filename=body.source_filename,
        speed=body.speed,
        references=[],
        images=[{"id": "region", "name": "region.png", "media_type": "image/png"}],
        trace_id=trace_id,
        user_id=user["id"],
        user_name=user["display_name"],
        user_avatar_url=_avatar_url_for_user_id(user["id"]),
        prompt_mode="render",
        kind="render_region_edit",
        model="gpt-image-1",
        provider="openai",
        usage=render_usage or None,
    )
    return {
        "kind": "render_region_edit",
        "filename": filename,
        "url": url,
        "message": message,
        "trace_id": trace_id,
        "prompt_id": hist_entry.get("id") if hist_entry else None,
        "model": "gpt-image-1",
        "provider": "openai",
        "prompt_mode": "render",
        "cost_usd": hist_entry.get("cost_usd") if hist_entry else None,
        "usage": hist_entry.get("usage") if hist_entry else None,
        "file_kind": "image",
        "section": "renders",
        "save_mode": save_mode,
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
    # Transform the mesh the viewport is actually showing. After paint/texture,
    # a STEP-backed catalog can be represented by a painted sibling GLB; using
    # the original STEP here would reload an untextured, differently scaled twin.
    viewer_name = cad_service.viewer_filename_for_model(safe, project_path)
    viewer_path = project_path / viewer_name
    transform_src = viewer_path if viewer_path.is_file() else src
    transform = body.model_dump(exclude_none=True, exclude={"mode", "copy"})
    if body.copy:
        base = transform_src.stem.replace("_edited", "")
        stem = f"{base}_copy"
        i = 2
        while (project_path / f"{stem}.glb").exists():
            stem = f"{base}_copy{i}"
            i += 1
    else:
        stem = transform_src.stem.replace("_edited", "") + "_edited"
    out = project_path / f"{stem}.glb"
    # Preserve multi-mesh Fusion assemblies — load_mesh+export_mesh collapses them.
    cad_service.apply_transform_preserving_parts(transform_src, transform, out_path=out)
    entry = _record_history(
        project_path,
        "transform",
        "Resize" if (transform.get("scale") is not None and transform.get("translation") is None and transform.get("rotation_deg") is None) else "Transform",
        out.name,
        meta=transform,
        user=user,
    )
    _append_mesh_edit(project_path, filename, {"op": "transform", "parent": filename, "source_mesh": transform_src.name, "child": out.name, **transform, "copy": body.copy})
    _append_mesh_edit(project_path, safe, {"op": "transform", "parent": safe, "source_mesh": transform_src.name, "child": out.name, **transform, "copy": body.copy})
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
    transform = body.model_dump(exclude_none=True, exclude={"mode", "copy", "body_index", "body_name"})
    try:
        # Keep multi-mesh assemblies intact; only fall back to concatenated-body
        # edits when the GLB is already a single mesh with disconnected shells.
        cad_service.transform_scene_body(
            src,
            body.body_index,
            transform,
            out_path=src,
            body_name=body.body_name,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    meta = {
        **transform,
        "body_index": body.body_index,
        "body_name": body.body_name,
        "parent": safe,
    }
    body_label = (
        f"Resize body {body.body_index + 1}"
        if (transform.get("scale") is not None and transform.get("translation") is None and transform.get("rotation_deg") is None)
        else f"Transform body {body.body_index + 1}"
    )
    entry = _record_history(project_path, "transform", body_label, safe, meta=meta, user=user)
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
    safe = Path(filename).name
    src = project_path / safe
    if not src.is_file():
        resolved = cad_service.resolve_project_file(project_path, safe)
        if resolved is None or not resolved.is_file():
            raise HTTPException(404, "File not found")
        src = resolved

    scope = (body.scope or "object").lower()
    # Color the mesh the viewport actually shows (Jake/product GLB), not a fresh
    # STEP tessellation that would land as a second overlapping body.
    viewer_name = cad_service.viewer_filename_for_model(src.name, project_path)
    viewer_path = project_path / viewer_name
    paint_src = viewer_path if viewer_path.is_file() else src
    mesh = cad_service.load_mesh(paint_src)
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

    if paint_src.suffix.lower() in {".glb", ".gltf"}:
        out = paint_src
    else:
        out = project_path / f"{src.stem}.glb"
    cad_service.export_mesh(mesh, out)
    # Keep product stem.glb in sync when the painted viewer was a jake sidecar.
    product_glb = project_path / f"{Path(src.stem).name}.glb"
    # src.stem for "foo.step" is "foo"; for ".foo.step.glb" is ".foo.step"
    solid_stem = src.stem
    if solid_stem.startswith(".") and solid_stem.endswith(".step"):
        solid_stem = solid_stem[1 : -len(".step")]
    product_glb = project_path / f"{solid_stem}.glb"
    if out.resolve() != product_glb.resolve() and solid_stem:
        try:
            cad_service.export_mesh(mesh, product_glb)
        except Exception:
            pass
    entry = _record_history(project_path, "transform", label, out.name, meta=meta, user=user)
    _append_mesh_edit(project_path, safe, {"op": "paint", "parent": safe, "child": out.name, **meta})
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
            "replace_catalog": safe,
            "timeline_entry": entry,
        },
    )
    return {
        "filename": out.name,
        "url": f"/api/projects/{project_id}/files/{out.name}",
        "timeline_index": entry["index"],
        "action": "paint",
        "scope": scope,
        "replace_catalog": safe,
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

    operation_src = src
    viewer_name = cad_service.viewer_filename_for_model(src.name, project_path)
    viewer_src = project_path / viewer_name
    pull_kwargs = dict(
        distance=body.distance,
        op=body.op,
        direction=body.direction,
        distance2=body.distance2,
        taper_deg=body.taper_deg,
        through=body.through_all,
        normal=body.normal,
        body_index=body.body_index,
        body_name=body.body_name,
    )
    suffix = "_body" if body.op == "new_body" else "_pulled"
    out = _edited_output(project_path, operation_src, suffix)
    try:
        cad_service.face_pull_scene_body(src, face_indices, out_path=out, **pull_kwargs)
    except ValueError as exc:
        message = str(exc)
        if "face_index out of range" not in message or viewer_src == src or not viewer_src.is_file():
            raise HTTPException(422, message) from exc
        try:
            out = _edited_output(project_path, viewer_src, suffix)
            cad_service.face_pull_scene_body(viewer_src, face_indices, out_path=out, **pull_kwargs)
            operation_src = viewer_src
        except ValueError as retry_exc:
            raise HTTPException(422, str(retry_exc)) from retry_exc
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
    project_path = _require_project_read(user, project_id)
    src = project_path / filename
    if not src.is_file():
        raise HTTPException(404, "File not found")
    # Mesh factories (.mesh.mjs / .js) are source code, not geometry — no body split.
    if src.suffix.lower() in {".mjs", ".js", ".ts"}:
        return {"count": 0, "body_names": [], "face_offsets": [], "can_split": False, "faces": 0, "unsupported": True}
    # Prefer the viewport GLB when the client asks about a STEP assembly: dense
    # Compounds (stairs, etc.) report 50–100+ solids from STEP while the viewer
    # mesh is already a single assembly shell.
    mesh_src = src
    suffix = src.suffix.lower()
    step_src: Path | None = None
    if suffix in {".step", ".stp"}:
        step_src = src
        viewer = cad_service.viewer_filename_for_model(src.name, project_path)
        viewer_path = project_path / viewer if viewer else None
        if viewer_path is not None and viewer_path.is_file() and viewer_path.suffix.lower() in {".glb", ".gltf"}:
            mesh_src = viewer_path
    elif suffix in {".glb", ".gltf"}:
        step_src = cad_service.find_step_source(project_path, src.stem)
    try:
        mtime = mesh_src.stat().st_mtime
    except OSError:
        mtime = 0.0
    cache_key = str(mesh_src.resolve())
    cached = _bodies_info_cache.get(cache_key)
    if cached and cached[0] == mtime:
        return cached[1]

    info: dict[str, Any] = {"count": 0, "body_names": [], "face_offsets": [], "can_split": False, "faces": 0}
    # GLB/GLTF: prefer named scene meshes. Avoid load_mesh first — large multi-mesh
    # assemblies can hang workers for minutes before scene_body_info would have won.
    if mesh_src.suffix.lower() in {".glb", ".gltf"}:
        try:
            info = cad_service.scene_body_info(mesh_src)
        except Exception:
            info = {"count": 0, "body_names": [], "face_offsets": [], "can_split": False, "faces": 0}
        if int(info.get("count") or 0) <= 1:
            try:
                mesh = cad_service.load_mesh(mesh_src)
                info = cad_service.mesh_body_info(mesh)
            except Exception:
                pass
    else:
        mesh = cad_service.load_mesh(mesh_src)
        info = cad_service.mesh_body_info(mesh)

    # If GLB only shows 1 body but a STEP source exists with multiple solids,
    # use the STEP body info so users can see/toggle individual parts.
    if info.get("count", 0) <= 1 and step_src and step_src.is_file():
        try:
            step_info = cad_service.step_body_info(step_src)
            if step_info.get("count", 0) > 1:
                info = step_info
        except Exception:
            pass
    _bodies_info_cache[cache_key] = (mtime, info)
    if len(_bodies_info_cache) > _BODIES_INFO_CACHE_MAX:
        # Drop oldest half (insertion order).
        for drop_key in list(_bodies_info_cache.keys())[: len(_bodies_info_cache) // 2]:
            _bodies_info_cache.pop(drop_key, None)
    return info


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
    if not user:
        await websocket.close(code=4403)
        return
    # Members, public projects, and a1projects admins (other-user renders) can subscribe.
    can_join = (
        teams_service.can_access_project(user_id, project_id)
        or _is_public_project(project_id)
        or _is_a1projects_admin(user)
        or _is_other_user_render_project(project_id, user)
    )
    if not can_join:
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
