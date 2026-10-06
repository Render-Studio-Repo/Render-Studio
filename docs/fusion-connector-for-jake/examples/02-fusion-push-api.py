"""
EXAMPLE COPY — Fusion push API route pattern
SOURCE: backend/main.py → POST /api/projects/{project_id}/push-to-autodesk
PURPOSE: Show how Export wires project STEP → Part flatten → upload_step_to_folder.

This is a condensed pattern, not a runnable FastAPI app.
Full route is large (3MF path, mirrors, naming rules). Key sequence below.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# from backend.services.autodesk_oauth import get_valid_access_token, upload_step_to_folder
# from backend.services import cad_service


def push_project_to_autodesk_pattern(
    project_id: str,
    body: dict[str, Any],
    user: dict[str, Any],
    *,
    project_path: Path,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Pattern for: UI Export → Fusion."""

    source = meta.get("autodesk_source") or {}
    aps_project_id = str(
        body.get("aps_project_id")
        or body.get("autodesk_project_id")
        or source.get("aps_project_id")
        or ""
    )
    folder_id = str(body.get("folder_id") or source.get("folder_id") or "")
    item_id = str(body.get("item_id") or source.get("item_id") or "")

    if not aps_project_id or not folder_id:
        raise ValueError("Provide aps_project_id and folder_id (or link a Fusion mirror folder).")

    token = get_valid_access_token(user["id"])  # noqa: F821 — from autodesk_oauth
    if not token:
        raise PermissionError("Autodesk account not linked.")

    filename = body.get("filename")
    if not filename:
        raise ValueError("No model filename specified for Fusion export.")
    safe = Path(filename).name
    fmt = str(body.get("format") or "").strip().lower()
    is_3mf = fmt == "3mf" or safe.lower().endswith(".3mf")

    # --- 3MF path (mesh upload as-is) ---
    if is_3mf:
        upload_path = project_path / safe
        conflict_mode = str(body.get("conflict_mode") or "replace").strip().lower()
        return upload_step_to_folder(  # noqa: F821
            token,
            project_id=aps_project_id,
            folder_id=folder_id,
            filename=upload_path.name,
            data=upload_path.read_bytes(),
            conflict_mode=conflict_mode,
        )

    # --- STEP path (solid B-rep; optional Part flatten for Extrude/Cut) ---
    # Real code: step_path = _step_for_cloud_cad(project_path, safe, allow_faceted=...)
    step_path = project_path / safe  # placeholder — use editable STEP resolver in production

    step_mode = str(body.get("step_mode") or "part").strip().lower()
    want_part = step_mode not in {"assembly", "native", "as_is", "linked", "raw"}
    if want_part:
        # Real code: cad_service.ensure_fusion_part_step(project_path, step_path)
        # Rejects linked assemblies and faceted mesh STEP.
        pass

    upload_stem = step_path.stem
    for suffix in (".fusionpart", ".part"):
        if upload_stem.endswith(suffix):
            upload_stem = upload_stem[: -len(suffix)]
            break

    upload_name = Path(str(body.get("name") or f"{upload_stem}.step")).name
    if not upload_name.lower().endswith((".step", ".stp")):
        upload_name = f"{Path(upload_name).stem}.step"

    conflict_mode = str(body.get("conflict_mode") or body.get("on_conflict") or "replace").strip().lower()
    if conflict_mode not in {"replace", "new"}:
        conflict_mode = "replace"

    # Prefer new version on existing item when item_id known and replace mode
    if item_id and conflict_mode == "replace":
        # Real code may call upload_step_as_new_version(...)
        pass

    result = upload_step_to_folder(  # noqa: F821
        token,
        project_id=aps_project_id,
        folder_id=folder_id,
        filename=upload_name,
        data=step_path.read_bytes(),
        conflict_mode=conflict_mode,
    )
    result["open_instructions"] = (
        "In Fusion Data Panel: Open this file (do not Insert into another design). "
        "If you see a chain-link component, Break Link first — then Extrude/Cut."
    )
    return result


# Typical request body from Export UI (file-actions.js):
EXAMPLE_REQUEST_BODY = {
    "hub_id": "b.xxxx",
    "aps_project_id": "b.yyyy",
    "folder_id": "urn:adsk.wipprod:fs.folder:co.zzzz",
    "filename": "bracket.step",
    "name": "bracket.step",
    "conflict_mode": "replace",  # or "new"
    "step_mode": "part",  # Part flatten for Extrude/Cut
    "upload_source": False,  # do not also upload companion .py
    "allow_faceted_step": False,
    # optional: "allowed_filenames": ["bracket.glb"],  # visible eye icons only
}
