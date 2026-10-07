"""Local setup endpoints for the opt-in Render instance network client."""

from __future__ import annotations

import subprocess
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.auth import get_current_user_optional
from backend.services import instance_network_client as network
from backend.services import instance_network_registry as registry
from backend.services import platform_roles_service

router = APIRouter()


def _allowed(request: Request, user: dict[str, Any] | None) -> bool:
    host = ((request.client.host if request.client else "") or "").strip().lower()
    return host in {"127.0.0.1", "::1", "localhost"} or bool(user and platform_roles_service.is_super_admin(user))


class NetworkConfigBody(BaseModel):
    instance_name: str = Field(default="Render Studio instance", min_length=1, max_length=80)
    reporting_opt_in: bool = False
    public_network: bool = False
    ecosystem_opt_in: bool = False


class SupportBody(BaseModel):
    kind: str = Field(default="support", max_length=20)
    subject: str = Field(..., min_length=3, max_length=160)
    message: str = Field(..., min_length=5, max_length=8000)
    severity: str = Field(default="normal", max_length=20)
    diagnostic: str = Field(default="", max_length=12000)


class UpdateConfigBody(BaseModel):
    enabled: bool = False


class ApplyUpdateBody(BaseModel):
    commit_sha: str = Field(..., min_length=40, max_length=40)


class InstanceReportBody(BaseModel):
    instance_id: str = Field(..., min_length=6, max_length=128)
    instance_secret: str = Field(..., min_length=24, max_length=512)
    instance_name: str = Field(default="Render Studio instance", max_length=80)
    public_network: bool = False
    debug_opt_in: bool = False
    user_count: int = Field(default=0, ge=0)
    project_count: int = Field(default=0, ge=0)
    storage_bytes: int = Field(default=0, ge=0)
    users_backend: str = Field(default="", max_length=40)
    git_sha: str = Field(default="", max_length=40)
    runtime: str = Field(default="", max_length=40)
    platform: str = Field(default="", max_length=20)


class InstanceSubmissionBody(InstanceReportBody):
    kind: str = Field(default="support", max_length=20)
    subject: str = Field(..., min_length=3, max_length=160)
    message: str = Field(..., min_length=5, max_length=8000)
    severity: str = Field(default="normal", max_length=20)
    diagnostic: str = Field(default="", max_length=12000)
    client_token: str = Field(default="", max_length=80)


class MarkReadBody(BaseModel):
    submission_ids: list[str] = Field(default_factory=list, max_length=200)


def _admin_only(user: dict[str, Any] | None) -> None:
    if not user or not platform_roles_service.is_platform_admin(user):
        raise HTTPException(403, "Instance updates are available only to this instance's admins.")


def _registry_call(operation, payload: dict[str, Any]):
    try:
        return operation(payload)
    except registry.UnknownInstanceError as exc:
        raise HTTPException(404, str(exc)) from exc
    except registry.InstanceAuthError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/instance-network/v1/register")
def register_instance(body: InstanceReportBody):
    return _registry_call(registry.register, body.model_dump())


@router.post("/api/instance-network/v1/heartbeat")
def instance_heartbeat(body: InstanceReportBody):
    return _registry_call(registry.heartbeat, body.model_dump())


@router.post("/api/instance-network/v1/submissions")
def instance_submission(body: InstanceSubmissionBody):
    return _registry_call(registry.submit, body.model_dump())


@router.get("/api/admin/instance-network/overview")
def instance_overview(q: str = "", user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _admin_only(user)
    return registry.overview(q)


@router.post("/api/admin/instance-network/read")
def mark_instance_submissions_read(
    body: MarkReadBody | None = None,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _admin_only(user)
    return registry.mark_read(body.submission_ids if body else None)


@router.get("/api/setup/instance-network")
def status():
    return {"ok": True, **network.public_status(), "metrics": network.metrics()}


@router.post("/api/setup/instance-network")
def configure(
    body: NetworkConfigBody,
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    if not _allowed(request, user):
        raise HTTPException(403, "Instance network setup is available only on this machine or to a super admin.")
    return {"ok": True, **network.configure(
        instance_name=body.instance_name,
        reporting_opt_in=body.reporting_opt_in,
        public_network=body.public_network,
        ecosystem_opt_in=body.ecosystem_opt_in,
    )}


@router.post("/api/setup/instance-updates")
def configure_updates(body: UpdateConfigBody, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _admin_only(user)
    return network.configure_updates(body.enabled)


@router.get("/api/setup/instance-updates/check")
def check_updates(user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _admin_only(user)
    return network.check_for_update()


@router.post("/api/setup/instance-updates/apply")
def apply_update(body: ApplyUpdateBody, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    _admin_only(user)
    try:
        return network.apply_update(body.commit_sha)
    except (ValueError, subprocess.SubprocessError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/api/setup/instance-support")
def support(
    body: SupportBody,
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    if not _allowed(request, user):
        raise HTTPException(403, "Support submission is available only on this machine or to a super admin.")
    try:
        return network.submit(**body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
