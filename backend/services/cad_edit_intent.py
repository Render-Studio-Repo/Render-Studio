"""Resolve selected-model edit intent and build bounded prior-design context."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from backend.services import prompt_history_service


IntentKind = Literal["edit", "new", "clarify"]


@dataclass(frozen=True)
class EditIntentDecision:
    kind: IntentKind
    reason: str


_NEW_PATTERNS = (
    # A CAD instruction often starts with "Create a ..." even when the user is
    # explicitly revising the selected model. Treat only an explicit new-object
    # qualifier as authority to leave Edit selected; the bare article a/an is
    # not enough to override selected-model edit language later in the prompt.
    re.compile(r"\b(?:create|build|design|generate|make)\s+(?:me\s+)?(?:(?:a|an)\s+)?(?:another|new|separate)\b", re.I),
    re.compile(r"\b(?:new|another|separate|additional|second)\s+(?:part|piece|object|model|component|assembly)\b", re.I),
    re.compile(r"\b(?:from scratch|start over|new model|new object|separate from|do not change|don't change|leave .* unchanged)\b", re.I),
)

# A leading declaration of a new design is authoritative even when the rest of
# the brief compares it with an existing concept ("simplify", "retain",
# "eliminate", etc.). Those comparison verbs describe design context, not an
# instruction to overwrite the selected file.
_STRONG_NEW_PATTERNS = (
    re.compile(r"^(?:using\s+[a-z0-9_.-]{1,40},\s*)?(?:please\s+)?(?:create|build|design|generate|make)\s+(?:me\s+)?(?:a|an)\s+(?:brand[- ]new\s+|new\s+)", re.I),
    re.compile(r"^(?:using\s+[a-z0-9_.-]{1,40},\s*)?(?:please\s+)?(?:create|build|design|generate|make)\s+(?:me\s+)?(?:another|a\s+separate|an\s+additional)\b", re.I),
)

_EDIT_PATTERNS = (
    re.compile(r"\b(?:edit|change|modify|update|adjust|resize|scale|stretch|shorten|lengthen|extend|remove|delete|replace|add|put|place|attach|mount|cut|drill)\b", re.I),
    re.compile(r"\b(?:make|turn|set)\s+(?:it|this|that|the selected|the current|the same)\b", re.I),
    re.compile(r"\b(?:this|that|selected|current|same)\s+(?:part|piece|object|model|component|assembly|face|edge|body)\b", re.I),
    re.compile(r"\b(?:its|it|this|that)\s+(?:width|height|length|diameter|radius|thickness|color|material|hole|holes|fillet|chamfer)\b", re.I),
)


def resolve_selected_edit_intent(prompt: str) -> EditIntentDecision:
    """Classify a prompt submitted through Edit Selected.

    Conflicting or absent signals are deliberately returned as ``clarify``. The
    request boundary can then ask the user instead of overwriting the selected
    model or silently creating an unrelated replacement.
    """
    text = " ".join(str(prompt or "").split())
    if any(pattern.search(text) for pattern in _STRONG_NEW_PATTERNS):
        return EditIntentDecision("new", "request opens with an explicit new-object instruction")
    has_new = any(pattern.search(text) for pattern in _NEW_PATTERNS)
    has_edit = any(pattern.search(text) for pattern in _EDIT_PATTERNS)
    if has_new and has_edit:
        return EditIntentDecision("clarify", "request contains both edit and new-object signals")
    if has_new:
        return EditIntentDecision("new", "request explicitly asks for a new or separate object")
    if has_edit:
        return EditIntentDecision("edit", "request refers to changing the selected/current object")
    return EditIntentDecision("clarify", "request does not identify whether to edit or create")


def recent_design_context(
    project_path: Path,
    *,
    base_filename: str | None,
    current_prompt_id: str | None = None,
    limit: int = 4,
) -> list[dict[str, Any]]:
    """Return bounded recent CAD turns relevant to the current selected model."""
    entries = prompt_history_service.list_entries_lightweight(project_path, limit=40)
    canonical_stem = lambda value: re.sub(r"_edited(?:_\d+)?$", "", Path(str(value or "")).stem.lower())
    wanted = canonical_stem(base_filename)
    rows: list[dict[str, Any]] = []
    for entry in entries:
        if str(entry.get("id") or "") == str(current_prompt_id or ""):
            continue
        if str(entry.get("kind") or "cad").lower() != "cad":
            continue
        if str(entry.get("status") or "").lower() == "running":
            continue
        entry_base = canonical_stem(entry.get("base_filename") or entry.get("filename"))
        if wanted and entry_base != wanted:
            continue
        prompt = " ".join(str(entry.get("original_prompt") or entry.get("prompt") or "").split())[:1200]
        if not prompt:
            continue
        rows.append({
            "prompt": prompt,
            "target_mode": str(entry.get("target_mode") or ""),
            "base_filename": entry.get("base_filename"),
            "result_filename": entry.get("filename"),
            "success": bool(entry.get("success")),
        })
        if len(rows) >= max(0, min(int(limit), 8)):
            break
    return rows
