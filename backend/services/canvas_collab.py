"""OG Canvas collaboration: share modes, author stamps, remix, invite search."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.services import cad_service, canvas_board_revision, project_shares_service, share_mode, teams_service

CANVAS_SHARE_MODES = ("view", "remix", "edit")

CANVAS_SHARE_MODE_LABELS = {
    "view": {"title": "View", "hint": "See the canvas. Cannot edit or remix."},
    "remix": {"title": "View and remix", "hint": "Copy into your own canvas. Cannot edit the original."},
    "edit": {"title": "View, edit, remix", "hint": "Live-edit this canvas and remix a copy."},
}

CANVAS_COLLAB_TYPES = ("canvas.cursor", "canvas.preview", "canvas.patch", "canvas.delete")
CANVAS_MUTATION_TYPES = frozenset({"canvas.preview", "canvas.patch", "canvas.delete"})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_canvas_share_mode(value: str | None) -> str:
    raw = str(value or "view").strip().lower().replace(" ", "_").replace("-", "_").replace(",", "_")
    raw = "_".join(part for part in raw.split("_") if part)
    if raw in {
        "edit",
        "editor",
        "remix_and_edit",
        "remixandedit",
        "view_edit_remix",
        "view_and_edit_remix",
        "view_and_remix_and_edit",
        "view_edit_and_remix",
    }:
        return "edit"
    if raw in {
        "remix",
        "remixer",
        "remix_only",
        "remixonly",
        "view_and_remix",
        "viewandremix",
        "download",
    }:
        return "remix"
    if raw in share_mode.SHARE_MODES:
        return raw
    return share_mode.normalize_share_mode(value)


def canvas_share_mode_allows_edit(mode: str | None) -> bool:
    return normalize_canvas_share_mode(mode) == "edit"


def canvas_share_mode_allows_remix(mode: str | None) -> bool:
    return normalize_canvas_share_mode(mode) in {"remix", "edit"}


def join_role_for_canvas_mode(mode: str | None) -> str:
    return share_mode.join_role_for_mode(normalize_canvas_share_mode(mode))


def canvas_object_author_id(el: dict[str, Any] | None) -> str:
    if not isinstance(el, dict):
        return ""
    return str(el.get("authorUserId") or el.get("author_user_id") or el.get("authorId") or "").strip()


def stamp_canvas_author(el: dict[str, Any], user: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(el, dict):
        return el
    uid = str((user or {}).get("id") or "").strip()
    if not uid or canvas_object_author_id(el):
        return el
    el["authorUserId"] = uid
    name = str((user or {}).get("display_name") or "").strip()
    if name:
        el["authorName"] = name
    avatar = str((user or {}).get("avatar_url") or "").strip()
    if avatar:
        el["authorAvatar"] = avatar
    return el


def canvas_element_authors(elements: list[Any] | None) -> set[str]:
    out: set[str] = set()
    for el in elements or []:
        uid = canvas_object_author_id(el if isinstance(el, dict) else None)
        if uid:
            out.add(uid)
    return out


def should_show_canvas_edit_timeline(
    *,
    elements: list[Any] | None = None,
    timeline: list[Any] | None = None,
    presence_user_ids: list[str] | None = None,
    local_user_id: str = "",
) -> bool:
    authors = canvas_element_authors(elements)
    for event in timeline or []:
        if not isinstance(event, dict):
            continue
        uid = str(event.get("userId") or event.get("user_id") or "").strip()
        if uid:
            authors.add(uid)
    present = {str(uid).strip() for uid in (presence_user_ids or []) if str(uid).strip()}
    me = str(local_user_id or "").strip()
    if me:
        present.add(me)
    return len(present) > 1 or len(authors) > 1


def canvas_permission_for_user(user_id: str, project_id: str) -> str:
    if teams_service.can_edit_project(user_id, project_id):
        return "edit"
    role = project_shares_service.share_role_for_user(project_id, user_id)
    if project_shares_service.share_role_can_edit(role):
        return "edit"
    if project_shares_service.share_role_can_remix(role):
        return "remix"
    return "view"


def remix_canvas_board(
    source_path,
    name: str,
    dest_path,
    dest_name: str | None = None,
) -> dict[str, Any]:
    data = canvas_board_revision.read_canvas_board(source_path, name)
    if not data:
        raise ValueError("Canvas board not found")
    state = data.get("state") if isinstance(data.get("state"), dict) else {}
    source_label = cad_service.sanitize_canvas_store_name(data.get("name") or name)
    label = cad_service.sanitize_canvas_store_name(dest_name or f"{source_label} remix")
    existing = {row.get("name") for row in cad_service.list_canvas_boards(dest_path)}
    unique = label
    n = 2
    while unique in existing:
        unique = cad_service.sanitize_canvas_store_name(f"{label} {n}")
        n += 1
    dest, revision = canvas_board_revision.write_canvas_board(dest_path, unique, state)
    return {
        "name": unique,
        "source_name": source_label,
        "storage_revision": revision,
        "filename": dest.name,
        "folder": cad_service.reference_rel_folder(dest_path, dest),
    }


def search_canvas_invite_targets(user_id: str, query: str, *, team_id: str | None = None) -> dict[str, Any]:
    q = str(query or "").strip()
    people: list[dict[str, Any]] = []
    if q:
        looked = teams_service.lookup_invite_person(user_id, q, team_id or None)
        people = list(looked.get("matches") or [])
    personal = str(teams_service.personal_team_id(user_id) or "")
    teams: list[dict[str, Any]] = []
    for row in teams_service.list_teams(user_id):
        name = str(row.get("name") or "")
        tid = str(row.get("id") or "")
        if q and q.lower() not in name.lower() and q.lower() not in tid.lower():
            continue
        is_personal = tid == personal
        teams.append({
            "id": tid,
            "name": name,
            "kind": "workspace" if is_personal else "team",
            "personal": is_personal,
        })
    return {
        "users": people[:12],
        "teams": [row for row in teams if not row.get("personal")][:12],
        "workspaces": teams[:12],
    }
