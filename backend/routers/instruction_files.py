"""Super-admin instruction / runbook file listing."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.services import instruction_files_service, platform_roles_service

router = APIRouter()


def _require_super(user: dict[str, Any]) -> None:
    if not platform_roles_service.is_super_admin(user):
        raise HTTPException(403, "Only the super admin can view instruction files.")


@router.get("/api/admin/instruction-files")
def admin_instruction_files(user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return {"files": instruction_files_service.list_files()}


@router.get("/api/admin/instruction-files/{file_id}")
def admin_instruction_file(file_id: str, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    data = instruction_files_service.read_file(file_id)
    if not data:
        raise HTTPException(404, "Instruction file not found.")
    return {"file": data}
