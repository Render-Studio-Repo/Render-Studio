"""Authenticated notes: workstation Sam's Notes (super-admin) and per-user notes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.auth import get_current_user
from backend.services import platform_roles_service, studio_notes_service

router = APIRouter()


class NotesBody(BaseModel):
    text: str = Field(default="", max_length=studio_notes_service.MAX_CHARS)


class NoteWrite(BaseModel):
    title: str = Field(default="Untitled", max_length=studio_notes_service.MAX_TITLE)
    html: str = Field(default="", max_length=studio_notes_service.MAX_CHARS)
    text: str | None = Field(default=None, max_length=studio_notes_service.MAX_CHARS)


class NotePatch(BaseModel):
    title: str | None = Field(default=None, max_length=studio_notes_service.MAX_TITLE)
    html: str | None = Field(default=None, max_length=studio_notes_service.MAX_CHARS)
    text: str | None = Field(default=None, max_length=studio_notes_service.MAX_CHARS)


class ImageDataUrl(BaseModel):
    data_url: str = Field(default="", max_length=12_000_000)


def _require_super(user: dict[str, Any]) -> None:
    if not platform_roles_service.is_super_admin(user):
        raise HTTPException(403, "Only the workstation owner can read or write Sam's Notes.")


def _uid(user: dict[str, Any]) -> str:
    return str(user.get("id") or "")


def _note_or_404(kind: str, note_id: str, user_id: str = "") -> dict[str, Any]:
    note = studio_notes_service.get_note(kind, note_id, user_id)
    if not note:
        raise HTTPException(404, "Note not found.")
    return note


@router.get("/api/notes/workstation")
def get_workstation_notes(user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return studio_notes_service.read_workstation()


@router.put("/api/notes/workstation")
def put_workstation_notes(body: NotesBody, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return studio_notes_service.write_workstation(body.text)


@router.get("/api/notes/workstation/items")
def list_workstation_notes(user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return studio_notes_service.list_notes("workstation")


@router.post("/api/notes/workstation/items")
def create_workstation_note(body: NoteWrite, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return studio_notes_service.create_note(
        "workstation",
        title=body.title,
        html_body=body.html,
        text=body.text,
    )


@router.get("/api/notes/workstation/items/{note_id}")
def get_workstation_note(note_id: str, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return _note_or_404("workstation", note_id)


@router.put("/api/notes/workstation/items/{note_id}")
def put_workstation_note(note_id: str, body: NotePatch, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    note = studio_notes_service.update_note(
        "workstation",
        note_id,
        title=body.title,
        html_body=body.html,
        text=body.text,
    )
    if not note:
        raise HTTPException(404, "Note not found.")
    return note


@router.delete("/api/notes/workstation/items/{note_id}")
def delete_workstation_note(note_id: str, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    if not studio_notes_service.delete_note("workstation", note_id):
        raise HTTPException(404, "Note not found.")
    return {"ok": True}


@router.post("/api/notes/workstation/images")
async def upload_workstation_image(
    file: UploadFile | None = File(default=None),
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_super(user)
    data = await file.read() if file is not None else b""
    try:
        return studio_notes_service.save_image("workstation", data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/notes/workstation/images/data")
def upload_workstation_image_data(body: ImageDataUrl, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    try:
        blob = studio_notes_service.parse_data_url_image(body.data_url)
        return studio_notes_service.save_image("workstation", blob)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/notes/workstation/images/{image_id}")
def get_workstation_image(image_id: str, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    found = studio_notes_service.get_image("workstation", image_id)
    if not found:
        raise HTTPException(404, "Image not found.")
    path, media = found
    return FileResponse(path, media_type=media)


@router.get("/api/users/me/notes")
def get_my_notes(user: dict[str, Any] = Depends(get_current_user)):
    return studio_notes_service.read_user_notes(_uid(user))


@router.put("/api/users/me/notes")
def put_my_notes(body: NotesBody, user: dict[str, Any] = Depends(get_current_user)):
    return studio_notes_service.write_user_notes(_uid(user), body.text)


@router.get("/api/users/me/notes/items")
def list_my_notes(user: dict[str, Any] = Depends(get_current_user)):
    return studio_notes_service.list_notes("user", _uid(user))


@router.post("/api/users/me/notes/items")
def create_my_note(body: NoteWrite, user: dict[str, Any] = Depends(get_current_user)):
    return studio_notes_service.create_note(
        "user",
        user_id=_uid(user),
        title=body.title,
        html_body=body.html,
        text=body.text,
    )


@router.get("/api/users/me/notes/items/{note_id}")
def get_my_note(note_id: str, user: dict[str, Any] = Depends(get_current_user)):
    return _note_or_404("user", note_id, _uid(user))


@router.put("/api/users/me/notes/items/{note_id}")
def put_my_note(note_id: str, body: NotePatch, user: dict[str, Any] = Depends(get_current_user)):
    note = studio_notes_service.update_note(
        "user",
        note_id,
        user_id=_uid(user),
        title=body.title,
        html_body=body.html,
        text=body.text,
    )
    if not note:
        raise HTTPException(404, "Note not found.")
    return note


@router.delete("/api/users/me/notes/items/{note_id}")
def delete_my_note(note_id: str, user: dict[str, Any] = Depends(get_current_user)):
    if not studio_notes_service.delete_note("user", note_id, _uid(user)):
        raise HTTPException(404, "Note not found.")
    return {"ok": True}


@router.post("/api/users/me/notes/images")
async def upload_my_image(
    file: UploadFile | None = File(default=None),
    user: dict[str, Any] = Depends(get_current_user),
):
    data = await file.read() if file is not None else b""
    try:
        return studio_notes_service.save_image("user", data, _uid(user))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/users/me/notes/images/data")
def upload_my_image_data(body: ImageDataUrl, user: dict[str, Any] = Depends(get_current_user)):
    try:
        blob = studio_notes_service.parse_data_url_image(body.data_url)
        return studio_notes_service.save_image("user", blob, _uid(user))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/api/users/me/notes/images/{image_id}")
def get_my_image(image_id: str, user: dict[str, Any] = Depends(get_current_user)):
    found = studio_notes_service.get_image("user", image_id, _uid(user))
    if not found:
        raise HTTPException(404, "Image not found.")
    path, media = found
    return FileResponse(path, media_type=media)
