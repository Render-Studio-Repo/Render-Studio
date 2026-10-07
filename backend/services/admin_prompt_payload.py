"""Serialize prompt-history rows for the Management dashboard Prompts tab."""

from __future__ import annotations

import re
import urllib.parse
from pathlib import Path
from typing import Any

from backend.services.ai_cost import entry_effective_cost


def prompt_preview_text(prompt: Any, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(prompt or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def entry_token_counts(entry: dict[str, Any] | None) -> dict[str, int]:
    usage = (entry or {}).get("usage") or {}
    if not isinstance(usage, dict):
        usage = {}
    input_tokens = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or usage.get("tokens") or 0)
    if not total_tokens:
        total_tokens = input_tokens + output_tokens
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def _filename_stems(filename: str | None) -> list[str]:
    raw = str(filename or "").strip()
    if not raw:
        return []
    path = Path(raw)
    stems = [path.name, path.stem]
    current = path.stem
    while "." in current:
        current = current.rsplit(".", 1)[0]
        stems.append(current)
    out: list[str] = []
    seen: set[str] = set()
    for stem in stems:
        key = stem.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def snapshot_index(project_path: Path) -> dict[str, str]:
    """Map model stems → newest snapshot PNG filename in the project folder."""
    best: dict[str, tuple[float, str]] = {}
    try:
        files = list(project_path.glob("*_snapshot_*.png"))
    except Exception:
        files = []
    for path in files:
        if not path.is_file():
            continue
        if "opposite" in path.name.lower():
            continue
        stem = path.name.split("_snapshot", 1)[0]
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        prev = best.get(stem)
        if prev is None or mtime >= prev[0]:
            best[stem] = (mtime, path.name)
    return {stem: name for stem, (_mtime, name) in best.items()}


def prompt_preview_url(
    *,
    project_id: str,
    entry: dict[str, Any] | None = None,
    snapshot_map: dict[str, str] | None = None,
    fallback_preview_url: str | None = None,
) -> str | None:
    stored = str((entry or {}).get("preview_url") or "").strip()
    if stored.startswith("/"):
        return stored
    filename = str((entry or {}).get("filename") or (entry or {}).get("base_filename") or "")
    mapping = snapshot_map or {}
    for stem in _filename_stems(filename):
        name = mapping.get(stem)
        if name:
            return f"/api/projects/{project_id}/files/{urllib.parse.quote(name)}"
    fallback = str(fallback_preview_url or "").strip()
    return fallback or None


def serialize_admin_prompt_entry(
    entry: dict[str, Any],
    *,
    project_id: str,
    project_name: str | None = None,
    snapshot_map: dict[str, str] | None = None,
    fallback_preview_url: str | None = None,
    owner_name: str | None = None,
    owner_email: str | None = None,
    user_profile: dict[str, Any] | None = None,
    avatar_url_for_user_id=None,
    preview_limit: int = 220,
) -> dict[str, Any]:
    final_prompt = str(entry.get("prompt") or "")
    original_prompt = str(entry.get("original_prompt") or "").strip() or None
    prompt_improved = bool(entry.get("prompt_improved")) or (
        bool(original_prompt) and original_prompt != final_prompt.strip()
    )
    tokens = entry_token_counts(entry)
    cost = entry_effective_cost(entry)
    user_id = entry.get("user_id") or (user_profile or {}).get("id")
    avatar = (
        entry.get("user_avatar_url")
        or (avatar_url_for_user_id(user_id) if callable(avatar_url_for_user_id) and user_id else None)
        or (user_profile or {}).get("avatar_url")
    )
    preview_url = prompt_preview_url(
        project_id=project_id,
        entry=entry,
        snapshot_map=snapshot_map,
        fallback_preview_url=fallback_preview_url,
    )
    return {
        "id": entry.get("id"),
        "project_id": project_id,
        "project_name": project_name,
        "prompt": final_prompt,
        "prompt_preview": prompt_preview_text(final_prompt, preview_limit),
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
        "input_tokens": tokens["input_tokens"],
        "output_tokens": tokens["output_tokens"],
        "total_tokens": tokens["total_tokens"],
        "preview_url": preview_url,
        "user_id": user_id,
        "user_name": entry.get("user_name")
        or (user_profile or {}).get("display_name")
        or owner_name,
        "user_email": (user_profile or {}).get("email") or owner_email,
        "user_avatar_url": avatar,
        "owner_name": owner_name,
        "owner_email": owner_email,
        "references": entry.get("references") or [],
    }
