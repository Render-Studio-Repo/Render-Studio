"""
EXAMPLE COPY — Onshape push / export API routes
SOURCE: backend/main.py
  POST /api/projects/{project_id}/push-to-onshape
  POST /api/projects/{project_id}/files/{filename}/export-to-onshape
PURPOSE: Server side of Export → Onshape (create new doc from current STEP).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

# from backend.services.onshape_oauth import get_valid_access_token, export_step_to_onshape


def push_project_to_onshape_pattern(
    project_id: str,
    body: dict[str, Any],
    user: dict[str, Any],
    *,
    project_path: Path,
    meta: dict[str, Any],
    step_path: Path,
) -> dict[str, Any]:
    """Create a new Onshape document from the current (edited) model STEP.
    Onshape auto-translates it to native geometry on open.
    """
    source = meta.get("onshape_source", {})
    element_name = source.get("element_name") or meta.get("name", "model")

    access_token = get_valid_access_token(user["id"])  # noqa: F821
    if not access_token:
        raise PermissionError("Onshape account not linked.")

    # Real code resolves STEP via _step_for_cloud_cad / ensure_mesh_exports
    if not step_path.is_file():
        raise FileNotFoundError("Could not generate STEP file for this model.")

    step_bytes = step_path.read_bytes()
    doc_name = f"{element_name} — edited {date.today().strftime('%b %d')}"

    result = export_step_to_onshape(access_token, step_bytes, doc_name)  # noqa: F821
    return {"url": result["url"], "document_name": doc_name}


def export_file_to_onshape_pattern(
    project_id: str,
    filename: str,
    body: dict[str, Any],
    user: dict[str, Any],
    *,
    step_path: Path,
) -> dict[str, Any]:
    """Export a model's STEP file into a new Onshape document."""
    access_token = get_valid_access_token(user["id"])  # noqa: F821
    if not access_token:
        raise PermissionError("Onshape account not linked.")

    model_name = Path(filename).stem or "model"
    result = export_step_to_onshape(  # noqa: F821
        access_token,
        step_path.read_bytes(),
        model_name,
    )
    return {"url": result["url"], "document_name": model_name}


# Typical request bodies from Export UI:
PUSH_BODY = {
    "filename": "bracket.step",
    "allow_faceted_step": False,
}

EXPORT_FILE_BODY = {
    "allow_faceted_step": False,
}
