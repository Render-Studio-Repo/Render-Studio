"""Robot dataset discovery and user-confirmed retrieval."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_current_user_optional
from backend.services import robotics_dataset_catalog_service as datasets

router = APIRouter(tags=["robotics-data-explorer"])


class DatasetRetrieveRequest(BaseModel):
    repo_id: str = Field(min_length=3, max_length=180)
    filename: str = Field(min_length=1, max_length=600)
    confirmed: bool = False
    destination_folder: str = Field(default="Training Data", min_length=1, max_length=80)


ROBOT_ASSET_FOLDERS = frozenset({
    "Scenes", "Robot Models", "Meshes", "Config", "Calibration",
    "Recordings", "Training Data", "Policies", "Simulation", "Viser",
})


@router.get("/api/robotics/data-explorer/search")
def search_robot_datasets(
    q: str = Query(default="", max_length=300),
    robot: str = Query(default="", max_length=120),
    simulator: str = Query(default="", max_length=80),
    limit: int = Query(default=8, ge=1, le=12),
    _user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    try:
        return datasets.search_datasets(q, robot=robot, simulator=simulator, limit=limit)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/api/robotics/data-explorer/retrieve")
def retrieve_robot_dataset_file(
    body: DatasetRetrieveRequest,
    _user: dict[str, Any] = Depends(get_current_user),
):
    if not body.confirmed:
        raise HTTPException(409, "Review the source, file, size, license, and destination, then confirm the download.")
    try:
        return datasets.retrieve_dataset_file(body.repo_id, body.filename)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "The dataset host could not provide this file.") from exc


def create_project_robotics_data_explorer_router(require_write):
    project_router = APIRouter(tags=["robotics-data-explorer"])

    @project_router.post("/api/projects/{project_id}/robotics/data-explorer/retrieve")
    def retrieve_robot_project_file(
        project_id: str,
        body: DatasetRetrieveRequest,
        user: dict[str, Any] = Depends(get_current_user),
    ):
        if not body.confirmed:
            raise HTTPException(409, "Review the source, file, size, license, and destination, then confirm the download.")
        folder = str(body.destination_folder or "").strip()
        if folder not in ROBOT_ASSET_FOLDERS:
            raise HTTPException(422, "Choose a supported robot asset folder.")
        project = Path(require_write(user, project_id)).resolve()
        destination_root = project / "references" / "Robots" / "OpenArm 2.0" / folder
        try:
            result = datasets.retrieve_dataset_file(body.repo_id, body.filename, destination_root=destination_root)
            return {**result, "project_id": project_id, "destination_folder": folder,
                    "project_path": f"references/Robots/OpenArm 2.0/{folder}/{result['destination']}"}
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(502, "The dataset host could not provide this file.") from exc

    return project_router
