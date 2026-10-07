"""Public debug-training ingest + super-admin cluster/retros. Thin setup telemetry hook."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_current_user_optional
from backend.services import debug_training_service as dts
from backend.services import platform_roles_service

router = APIRouter()


def _require_super(user: dict[str, Any] | None) -> None:
    if not user or not platform_roles_service.is_super_admin(user):
        raise HTTPException(403, "Debug training overview is super-admin only.")


class InstanceAuth(BaseModel):
    instance_id: str = Field(default="", max_length=80)
    instance_secret: str = Field(default="", max_length=200)
    public_base_url: str = Field(default="", max_length=200)
    git_sha: str = Field(default="", max_length=16)
    active_users: int = Field(default=0, ge=0, le=1_000_000)
    users_backend: str = Field(default="", max_length=40)
    telemetry_opt_in: bool = False


class IngestBody(InstanceAuth):
    title: str = Field(default="", max_length=200)
    traceback_text: str = Field(default="", max_length=12000)
    traceback_id: str = Field(default="", max_length=40)
    source: str = Field(default="", max_length=80)
    feature_check: dict[str, Any] = Field(default_factory=dict)


class SolveBody(BaseModel):
    traceback_id: str = Field(..., max_length=40)
    prompts_used: int = Field(default=1, ge=1, le=500)
    hours_elapsed: float | None = Field(default=None, ge=0, le=240)
    verdict: str = Field(..., max_length=40)
    root_cause: str = Field(default="", max_length=800)
    why: str = Field(default="", max_length=1200)
    lesson: str = Field(default="", max_length=1200)
    related_paths: list[str] = Field(default_factory=list, max_length=24)
    confirmed: bool = False


class TelemetryBody(BaseModel):
    opt_in: bool


@router.post("/api/debug-training/instances/register")
def register_instance(body: InstanceAuth):
    try:
        return {
            "ok": True,
            "instance": dts.register_instance(
                instance_id=body.instance_id,
                instance_secret=body.instance_secret,
                public_base_url=body.public_base_url,
                git_sha_value=body.git_sha,
                active_users=body.active_users,
                users_backend=body.users_backend,
                telemetry_opt_in=body.telemetry_opt_in,
            ),
        }
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/debug-training/instances/heartbeat")
def heartbeat_instance(body: InstanceAuth):
    try:
        return {
            "ok": True,
            "instance": dts.heartbeat_instance(
                instance_id=body.instance_id,
                instance_secret=body.instance_secret,
                active_users=body.active_users,
                git_sha_value=body.git_sha,
                users_backend=body.users_backend,
                public_base_url=body.public_base_url,
            ),
        }
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from exc


@router.post("/api/debug-training/ingest")
def ingest_packet(body: IngestBody):
    if not dts.verify_instance(body.instance_id, body.instance_secret):
        raise HTTPException(403, "Unknown instance. Register this install first.")
    try:
        return dts.ingest_report(
            title=body.title,
            traceback_text=body.traceback_text,
            feature_check=body.feature_check,
            source=body.source or "hub-ingest",
            instance_id=body.instance_id,
            traceback_id=body.traceback_id,
            forward=False,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/debug-training/overview")
def training_overview(user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return dts.overview()


@router.get("/api/debug-training/similar")
def training_similar(
    q: str = "",
    limit: int = 40,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_super(user)
    return dts.similar_reports(q, limit=limit)


@router.get("/api/debug-training/instances")
def training_instances(user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return {"instances": dts.list_instances()}


@router.post("/api/debug-training/reports")
def training_solve(body: SolveBody, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    try:
        return dts.record_solve_report(body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/setup/telemetry")
def setup_telemetry(
    body: TelemetryBody,
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    from backend.services import instance_setup_service as setup

    ip = (request.client.host if request.client else "") or ""
    admin = bool(user and platform_roles_service.is_super_admin(user))
    if not setup.setup_unlocked(ip=ip, is_admin=admin):
        raise HTTPException(403, "Instance setup is only available on this machine or to a super admin.")
    return setup.set_telemetry_opt_in(body.opt_in)
