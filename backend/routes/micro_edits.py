from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.auth import get_current_user
from backend.routes.design_assistance import project
from backend.services import micro_edits as service

router = APIRouter(prefix="/api/micro-edits")


class InspectRequest(BaseModel):
    project_id: str
    base_filename: str = Field(max_length=500)
    body_ids: list[str] = Field(default_factory=list, max_length=8)


class Trial(BaseModel):
    model: str = Field(min_length=1, max_length=100)
    count: int = Field(default=1, ge=1, le=5)


class RunRequest(InspectRequest):
    prompt: str = Field(min_length=1, max_length=12000)
    revision: str = Field(min_length=24, max_length=24)
    face_ids: list[str] = Field(default_factory=list, max_length=30)
    models: list[Trial] = Field(min_length=1, max_length=5)
    variants: list[str] = Field(default_factory=lambda: ["minimal"], min_length=1, max_length=3)
    references: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    images: list[dict[str, Any]] = Field(default_factory=list, max_length=4)
    debug: bool = False
    repair_passes: int = Field(default=0, ge=0, le=1)
    harness: str = Field(default="CAD", max_length=60)
    ai_key_id: str | None = None
    ai_key_source: str | None = None


@router.post("/inspect")
def inspect(body: InspectRequest, user=Depends(get_current_user)):
    try:
        return service.inspect(project(user, body.project_id, read=True), body.base_filename, body.body_ids)
    except (ValueError, OSError) as exc: raise HTTPException(422, str(exc)) from exc


@router.post("/runs")
def start(body: RunRequest, user=Depends(get_current_user)):
    root = project(user, body.project_id)
    from backend import main
    from backend.services import parts_workspace
    request = body.model_dump()
    request["parts_changes"] = parts_workspace.get_workspace(root).get("changes", [])[-5:]
    if len(json.dumps(request["references"])) > 60_000 or len(json.dumps(body.images)) > 16_000_000:
        raise HTTPException(422, "Narrow the references for this micro edit")
    factory = lambda model: main._get_ai_for_user(user, "fast", key_id=body.ai_key_id, key_source=body.ai_key_source,
        project_id=body.project_id, requested_model=model, allow_chatgpt_subscription=True)
    try: return service.start(root, user, request, factory)
    except (ValueError, OSError) as exc: raise HTTPException(422, str(exc)) from exc


@router.get("/projects/{project_id}/runs")
def recent(project_id: str, user=Depends(get_current_user)):
    return {"runs": service.recent(project(user, project_id, read=True))}


@router.get("/projects/{project_id}/runs/{run_id}")
def status(project_id: str, run_id: str, user=Depends(get_current_user)):
    try: return service.load(project(user, project_id, read=True), run_id)
    except ValueError as exc: raise HTTPException(404, str(exc)) from exc


@router.post("/projects/{project_id}/runs/{run_id}/cancel")
def cancel(project_id: str, run_id: str, user=Depends(get_current_user)):
    try: return service.cancel(project(user, project_id), run_id)
    except ValueError as exc: raise HTTPException(404, str(exc)) from exc


@router.get("/projects/{project_id}/runs/{run_id}/log")
def export_log(project_id: str, run_id: str, user=Depends(get_current_user)):
    run = status(project_id, run_id, user)
    return Response(json.dumps(run, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="micro-edit-{run_id}.json"'})


class Rating(BaseModel):
    filename: str = Field(max_length=500)
    ratings: dict[str, int]
    comment: str = Field(default="", max_length=2000)


@router.post("/projects/{project_id}/ratings")
def rate(project_id: str, body: Rating, user=Depends(get_current_user)):
    try: return service.rate(project(user, project_id), user["id"], body.filename, body.ratings, body.comment)
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
