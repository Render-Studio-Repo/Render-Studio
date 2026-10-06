"""Project metadata and listing from the projects/ folder."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import cad_service, generation_service, history_service, prompt_history_service

META_FILE = "project.json"

_PROJECT_COPY_RUNTIME_NAMES = frozenset(
    {
        "generation.json",
        ".generation.lock",
        ".generation_flags",
        ".generation_jobs",
    }
)


def _project_copy_ignored_names(_directory: str, names: list[str]) -> set[str]:
    ignored: set[str] = set()
    for name in names:
        lower = name.lower()
        if (
            name in _PROJECT_COPY_RUNTIME_NAMES
            or name in {".DS_Store", ".git", "__pycache__"}
            or name.endswith(".lock")
            or lower.endswith(".pyc")
            or ".generation-live." in lower
        ):
            ignored.add(name)
    return ignored


def copy_project_snapshot(source_path: Path, destination_path: Path) -> None:
    """Copy durable project state without cloning a running worker's ownership."""
    destination_path.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        source_path,
        destination_path,
        dirs_exist_ok=True,
        ignore=_project_copy_ignored_names,
    )


def meta_path(project_path: Path) -> Path:
    return project_path / META_FILE


def load_meta(project_path: Path) -> dict[str, Any]:
    path = meta_path(project_path)
    if path.is_file():
        try:
            raw = path.read_text(encoding="utf-8")
            if raw.strip():
                data = json.loads(raw)
                if isinstance(data, dict):
                    return data
        except (json.JSONDecodeError, OSError, UnicodeError, TypeError, ValueError):
            # Empty/corrupt project.json must not break share/export — recover below.
            pass
    return {
        "id": project_path.name,
        "name": project_path.name,
        "created_at": None,
        "updated_at": None,
    }


def save_meta(project_path: Path, meta: dict[str, Any]) -> None:
    """Atomically write project.json so a crash never leaves an empty file."""
    try:
        from backend.services.project_lifecycle import is_project_deleted

        if is_project_deleted(project_path.name):
            return
    except Exception:
        pass
    path = meta_path(project_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(meta, indent=2)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(path)


def is_default_project_name(project_path: Path, meta: dict[str, Any] | None = None) -> bool:
    """True when the project still has its auto-generated display name."""
    meta = meta if meta is not None else load_meta(project_path)
    pid = project_path.name
    current = (meta.get("name") or "").strip()
    if not current:
        return True
    if current == pid:
        return True
    if current == f"Project {pid}":
        return True
    # Hex-ish bare ids (8–12 chars) that slipped in as the display name.
    if re.fullmatch(r"[0-9a-fA-F]{6,12}", current) and current.lower() == pid.lower():
        return True
    return False


def _is_automatic_copy_name(meta: dict[str, Any]) -> bool:
    """True for the exact placeholder assigned when a default project is copied."""
    source_id = str(meta.get("copied_from_project_id") or "").strip()
    current = str(meta.get("name") or "").strip()
    if not source_id or not current:
        return False
    return current.casefold() in {
        f"{source_id} (copy)".casefold(),
        f"Project {source_id} (copy)".casefold(),
    }


# Words that are CAD/process boilerplate, not the product name.
_CAD_TITLE_NOISE = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "of",
        "for",
        "to",
        "in",
        "on",
        "with",
        "using",
        "via",
        "from",
        "into",
        "as",
        "please",
        "make",
        "create",
        "generating",
        "generate",
        "design",
        "designing",
        "build",
        "building",
        "model",
        "models",
        "draw",
        "drawing",
        "new",
        "revised",
        "revise",
        "update",
        "updated",
        "parametric",
        "fully",
        "assembled",
        "assembly",
        "assemblies",
        "cad",
        "step",
        "stp",
        "brep",
        "multi",
        "body",
        "bodies",
        "multibody",
        "multi-body",
        "solid",
        "solids",
        "part",
        "parts",
        "component",
        "components",
        "printable",
        "3d",
        "3d-printable",
        "fdm",
        "fdm-printable",
        "cnc",
        "mm",
        "millimeter",
        "millimeters",
        "millimetre",
        "millimetres",
        "geometry",
        "prismatic",
        "feature",
        "features",
        "tree",
        "export",
        "exports",
        "ready",
        "quality",
        "precise",
        "clean",
        "complete",
        "single",
        "one",
    }
)

_CAD_BOILERPLATE_CHUNK = re.compile(
    r"(?:"
    r"(?:(?:new|revised?|update[sd]?)\s+)?"
    r"(?:fully\s+assembled\s+)?"
    r"(?:parametric\s+)?"
    r"(?:multi[-\s]?body\s+)?"
    r"(?:(?:3d|fdm)[-\s]?printable\s+)?"
    r"(?:step\s+|stp\s+|brep\s+)?"
    r"(?:cad\s+)?"
    r"(?:assembly|assemblies|model|models|solid|solids|part|parts|component|components)\s+"
    r"(?:in\s+(?:mm|millimeters?|millimetres?)\s+)?"
    r"(?:using\s+(?:prismatic\s+)?geometry\s+)?"
    r"(?:of\s+(?:a|an|the)\s+|for\s+(?:a|an|the)\s+|for\s+|of\s+)?"
    r")+",
    re.I,
)

_PROJECT_HARNESS_NAME = r"(?:vibecad|jake|codex|multi[-\s]?agent[-\s]?cad|mac)"
_PROJECT_HARNESS_PREFIX = re.compile(
    rf"^(?:(?:new|compact|production|parametric)\s+)*"
    rf"{_PROJECT_HARNESS_NAME}"
    rf"(?:\s+(?:cad|text[-\s]?to[-\s]?cad|harness|engine|workflow|agent|prototype|model)){{0,4}}"
    rf"\s*(?:(?:[:—–-]|\bof\b)\s*)?(?:of\s+)?(?:(?:a|an|the)\b\s*)?",
    re.I,
)
_PROJECT_HARNESS_USAGE = re.compile(
    rf"\s+(?:using|with|via|in)\s+{_PROJECT_HARNESS_NAME}"
    rf"(?:\s+(?:cad|text[-\s]?to[-\s]?cad|harness|engine|workflow|agent))?\b.*$",
    re.I,
)


def _title_case_word(word: str) -> str:
    if word.casefold() == "openarm":
        return "OpenArm"
    if word.isupper() and 2 <= len(word) <= 8:
        return word
    if re.fullmatch(r"[A-Za-z]+-\d+[A-Za-z0-9-]*", word):  # e.g. HC-SR04
        return word.upper() if word.lower().startswith("hc-") else word
    if any(ch.isdigit() for ch in word) and re.search(r"[A-Za-z]", word):
        return word.upper() if len(word) <= 8 else word
    return word[:1].upper() + word[1:].lower() if word else word


def _strip_cad_title_boilerplate(text: str) -> tuple[str, str | None]:
    """Pull the real product noun out of spice/CAD-jargon prompts.

    Returns (cleaned_text, preferred_name_hint). preferred_name_hint is set when
    the prompt opens with ``Name: details`` so the title can keep that product name.
    """
    text = (text or "").strip()
    if not text:
        return "", None
    text = re.sub(r"[*_`#]+", " ", text)
    text = re.sub(r"^\s*[-•]\s*", "", text)
    text = _PROJECT_HARNESS_PREFIX.sub("", text, count=1).strip()
    text = _PROJECT_HARNESS_USAGE.sub("", text, count=1).strip()
    preferred_name: str | None = None
    # Prefer "Name: details" / "Name — details" openings from improved prompts.
    lead = re.match(r"^(.{2,48}?)\s*[:—–]\s+(.+)$", text)
    if lead:
        head, tail = lead.group(1).strip(), lead.group(2).strip()
        head_words = [w for w in re.split(r"\s+", head) if w]
        if 1 <= len(head_words) <= 6 and not all(
            re.sub(r"[^a-z0-9-]", "", w.lower()) in _CAD_TITLE_NOISE for w in head_words
        ):
            preferred_name = " ".join(head_words)
            text = tail
    text = re.split(r"[.!?\n]", text, maxsplit=1)[0]
    text = re.split(
        r",\s+(?:it|and|because|with|that|which|so|then|where|when)\b",
        text,
        maxsplit=1,
        flags=re.I,
    )[0]
    text = re.sub(
        r"^(?:i\s+(?:need|want|would like)\s+to\s+)?"
        r"(?:please\s+)?"
        r"(?:make|create|generate|design|build|model|draw)\s+"
        r"(?:me\s+)?"
        r"(?:an|a|the)?\s*",
        "",
        text,
        flags=re.I,
    ).strip()
    text = _PROJECT_HARNESS_PREFIX.sub("", text, count=1).strip()
    text = _PROJECT_HARNESS_USAGE.sub("", text, count=1).strip()
    # Peel CAD boilerplate repeatedly ("parametric fully assembled CAD model of …").
    for _ in range(4):
        nxt = _CAD_BOILERPLATE_CHUNK.sub("", text, count=1).strip()
        if nxt == text:
            break
        text = nxt
    # Slash noise left by "CAD / multi-body …"
    text = re.sub(r"^\s*/\s*", "", text)
    text = re.sub(
        r"^(?:multi[-\s]?body|parametric|step|stp|cad|assembly|model)\b[\s/,-]*",
        "",
        text,
        flags=re.I,
    ).strip()
    # If still noise-heavy, take the object after of/for a|an|the.
    of_match = re.search(
        r"\b(?:of|for)\s+(?:a|an|the)\s+(.+)$",
        text,
        flags=re.I,
    )
    if of_match:
        before = text[: of_match.start()]
        before_tokens = [
            re.sub(r"[^a-z0-9-]", "", w.lower())
            for w in before.split()
            if re.sub(r"[^a-z0-9-]", "", w.lower())
        ]
        if before_tokens and sum(1 for t in before_tokens if t in _CAD_TITLE_NOISE) >= max(
            1, len(before_tokens) - 1
        ):
            text = of_match.group(1).strip()
    text = re.sub(r"^(?:an|a|the)\s+", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" -_")
    return text, preferred_name


def title_from_prompt(prompt: str, *, max_len: int = 64) -> str:
    """Human project/file title: product name (+ short description), not CAD boilerplate."""
    text, preferred_name = _strip_cad_title_boilerplate(prompt)
    if preferred_name and not text:
        return " ".join(_title_case_word(w) for w in preferred_name.split())[:max_len] or "New Model"
    if not text and not preferred_name:
        return "New Model"
    raw_words = [w for w in text.split() if w]
    words: list[str] = []
    for word in raw_words:
        token = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9)-]+$", "", word)
        if not token:
            continue
        key = re.sub(r"[^a-z0-9-]", "", token.lower())
        # Keep leading noise off; keep later "for"/"with" as description separators.
        if not words and key in _CAD_TITLE_NOISE:
            continue
        words.append(token)
    if preferred_name:
        name = " ".join(_title_case_word(w) for w in preferred_name.split()).strip(" -_")
        # Short descriptor from the details clause (skip manufacturing noise).
        desc_words: list[str] = []
        for word in words:
            key = re.sub(r"[^a-z0-9-]", "", word.lower())
            if key in _CAD_TITLE_NOISE or key in {"for", "with", "using", "and", "named", "bodies"}:
                continue
            # Skip repeats of the name itself.
            if key and key in {re.sub(r"[^a-z0-9-]", "", w.lower()) for w in preferred_name.split()}:
                continue
            desc_words.append(word)
            if len(desc_words) >= 4:
                break
        if desc_words:
            desc = " ".join(_title_case_word(w) for w in desc_words).strip(" -_")
            titled = f"{name} - {desc}" if desc else name
        else:
            titled = name
        if len(titled) > max_len:
            titled = titled[:max_len].rsplit(" ", 1)[0].strip().rstrip(" -") or name[:max_len]
        return titled or "New Model"
    if not words:
        return "New Model"
    # Drop trailing filler like "than is on the ground..."
    stop_at = None
    for i, word in enumerate(words):
        lower = re.sub(r"[^a-z0-9-]", "", word.lower())
        if lower in {"than", "that", "which", "because"} and i >= 1:
            stop_at = i
            break
        if lower == "with" and i >= 2:
            stop_at = i
            break
    if stop_at is not None:
        words = words[:stop_at]
    # Name (first content words) + optional short description.
    content = [w for w in words if re.sub(r"[^a-z0-9-]", "", w.lower()) not in {"a", "an", "the"}]
    if not content:
        content = words
    # Take words until a connector, or up to 5 (so "Arduino stepper test bench" stays together).
    name_words: list[str] = []
    for word in content:
        key = re.sub(r"[^a-z0-9-]", "", word.lower())
        if key in {"for", "with", "using"} and name_words:
            break
        if key in _CAD_TITLE_NOISE and name_words:
            break
        name_words.append(word)
        if len(name_words) >= 5:
            break
    if not name_words:
        name_words = content[:3]
    rest_start = len(name_words)
    desc_words: list[str] = []
    i = rest_start
    if i < len(content):
        conn = re.sub(r"[^a-z0-9-]", "", content[i].lower())
        if conn in {"for", "with", "using", "and", "-"}:
            i += 1
        while i < len(content) and len(desc_words) < 4:
            key = re.sub(r"[^a-z0-9-]", "", content[i].lower())
            if key in _CAD_TITLE_NOISE or key in {"for", "with", "using", "and"}:
                i += 1
                continue
            desc_words.append(content[i])
            i += 1
    name = " ".join(_title_case_word(w) for w in name_words).strip(" -_")
    # Only add " - desc" when the remainder is a real phrase (2+ words), not a lone leftover.
    if len(desc_words) >= 2:
        desc = " ".join(_title_case_word(w) for w in desc_words).strip(" -_")
        titled = f"{name} - {desc}" if desc and desc.lower() != name.lower() else name
    elif len(desc_words) == 1 and len(name_words) <= 3:
        # "Gripper - Robot Arm" style: short name + short for-clause
        titled = f"{name} - {_title_case_word(desc_words[0])}"
    else:
        # Fold a single leftover into the name when it was truncated at 5 ("… Test Bench").
        if len(desc_words) == 1 and len(name_words) >= 4:
            titled = f"{name} {_title_case_word(desc_words[0])}".strip()
        else:
            titled = name
    if not titled:
        return "New Model"
    if len(titled) > max_len:
        titled = titled[:max_len].rsplit(" ", 1)[0].strip() or titled[:max_len].strip()
        titled = titled.rstrip(" -")
    return titled or "New Model"


def file_stem_from_prompt(prompt: str, *, max_len: int = 80) -> str:
    """Filesystem stem with spaces + capitalization (illegal path chars stripped)."""
    title = title_from_prompt(prompt, max_len=max_len)
    stem = re.sub(r'[\\/:*?"<>|]+', "", title).strip(" .")
    return (stem or "New Model")[:max_len]


def _existing_project_display_names(projects_root: Path, *, exclude_id: str) -> set[str]:
    names: set[str] = set()
    if not projects_root.is_dir():
        return names
    for d in projects_root.iterdir():
        if not d.is_dir() or d.name.startswith(".") or d.name == exclude_id:
            continue
        try:
            other = load_meta(d)
        except Exception:
            continue
        n = (other.get("name") or "").strip()
        if n:
            names.add(n.casefold())
    return names


def unique_project_display_name(
    title: str,
    projects_root: Path | None,
    *,
    exclude_id: str,
) -> str:
    """Keep display names unique: Title, Title Alt, Title V2, Title 2, Title 3, …"""
    base = (title or "New Model").strip() or "New Model"
    if projects_root is None:
        return base
    taken = _existing_project_display_names(projects_root, exclude_id=exclude_id)
    if base.casefold() not in taken:
        return base
    for suffix in ("Alt", "V2"):
        candidate = f"{base} {suffix}"
        if candidate.casefold() not in taken:
            return candidate
    n = 2
    while n < 1000:
        candidate = f"{base} {n}"
        if candidate.casefold() not in taken:
            return candidate
        n += 1
    return f"{base} {exclude_id[:6]}"


def apply_prompt_project_name(
    project_path: Path,
    prompt: str,
    *,
    fallback: str | None = None,
    projects_root: Path | None = None,
) -> dict[str, Any]:
    """Rename a default-id project from the prompt (Capitalization And Spaces).

    When ``projects_root`` is set, append Alt / V2 / 2 / 3 / … if the title is
    already used. Returned meta may include ephemeral ``_renamed`` /
    ``_renamed_from`` for workspace broadcasts (not persisted).
    """
    meta = load_meta(project_path)
    if not _ai_may_set_project_name(project_path, meta):
        return meta
    old_name = (meta.get("name") or "").strip()
    title = title_from_prompt(prompt)
    if (not title or title == "New Model") and fallback:
        fb = str(fallback).strip()
        if " " in fb and not fb.islower():
            title = fb
        else:
            pretty = re.sub(r"_+", " ", fb).strip()
            title = " ".join(
                (p.upper() if p.isupper() and 2 <= len(p) <= 6 else p[:1].upper() + p[1:].lower())
                for p in pretty.split()
                if p
            ) or "New Model"
    title = unique_project_display_name(
        title or "New Model",
        projects_root,
        exclude_id=project_path.name,
    )
    updated = touch_project(project_path, name=title)
    if title != old_name:
        updated = dict(updated)
        updated["_renamed"] = True
        updated["_renamed_from"] = old_name
    return updated


def _ai_may_set_project_name(project_path: Path, meta: dict[str, Any]) -> bool:
    if _is_automatic_copy_name(meta):
        return True
    if meta.get("name_user_set"):
        return False
    return is_default_project_name(project_path, meta)


def rename_project(project_path: Path, name: str) -> dict[str, Any]:
    """Set display name in project.json (folder id unchanged)."""
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("Project name cannot be empty")
    if len(cleaned) > 120:
        raise ValueError("Project name must be 120 characters or fewer")
    now = datetime.now(timezone.utc).isoformat()
    meta = load_meta(project_path)
    if not meta.get("created_at"):
        meta["created_at"] = now
    meta["updated_at"] = now
    meta["id"] = project_path.name
    meta["name"] = cleaned
    meta["name_user_set"] = True
    save_meta(project_path, meta)
    return meta


def touch_project(
    project_path: Path,
    *,
    name: str | None = None,
    name_source: str | None = None,
) -> dict[str, Any]:
    """Update project metadata on disk."""
    now = datetime.now(timezone.utc).isoformat()
    meta = load_meta(project_path)
    if not meta.get("created_at"):
        meta["created_at"] = now
    meta["updated_at"] = now
    meta["id"] = project_path.name
    files = cad_service.list_project_files(project_path)
    meta["file_count"] = len(files)
    if name:
        if name_source == "user":
            meta["name"] = name
            meta["name_user_set"] = True
        elif _ai_may_set_project_name(project_path, meta):
            meta["name"] = name
    elif not meta.get("name") or meta["name"] == meta["id"]:
        if files:
            meta["name"] = files[-1]["name"].rsplit(".", 1)[0].replace("_", " ")
    save_meta(project_path, meta)
    return meta


def mark_project_opened(project_path: Path) -> dict[str, Any]:
    """Record a user open without treating it as a content edit."""
    now = datetime.now(timezone.utc).isoformat()
    meta = load_meta(project_path)
    if not meta.get("created_at"):
        meta["created_at"] = now
    meta["opened_at"] = now
    meta["id"] = project_path.name
    save_meta(project_path, meta)
    return meta


def project_recency_stamp(project: dict[str, Any] | None) -> str:
    """Newest open/edit/create stamp. Folder mtime only when those are empty."""
    row = project or {}
    stamps = [row.get("opened_at"), row.get("updated_at"), row.get("created_at")]
    present = [str(s) for s in stamps if s]
    if present:
        return max(present)
    mtime = row.get("mtime")
    return str(mtime) if mtime else ""


def latest_model_file(project_path: Path) -> str | None:
    """Best file to open when restoring a project."""
    from backend.services.engine_layout import resolve_in_layout

    timeline = history_service.load_timeline(project_path)
    entries = timeline.get("entries", [])
    idx = timeline.get("current_index", -1)

    def _path_for(fn: str | None) -> Path | None:
        if not fn:
            return None
        located = resolve_in_layout(project_path, fn)
        if located is not None and located.is_file():
            if cad_service.looks_like_drive_id_stub(located):
                located = None
            else:
                return located
        direct = project_path / str(fn)
        if direct.is_file() and not cad_service.looks_like_drive_id_stub(direct):
            return direct
        return None

    def _usable(entry: dict[str, Any] | None) -> str | None:
        if not entry:
            return None
        meta = entry.get("meta") or {}
        status = str(meta.get("status") or entry.get("status") or "").lower()
        kind = str(entry.get("kind") or "").lower()
        label = str(entry.get("label") or "").lower()
        # Skip deleted/canceled/failed timeline rows — they often point at missing files.
        if kind in {"delete_object", "delete", "deleted"}:
            return None
        if status in {"stopped", "canceled", "cancelled", "failed"} or label.startswith("stopped") or label.startswith("delete "):
            if meta.get("success") is not True:
                return None
        if meta.get("success") is False:
            return None
        fn = entry.get("filename")
        if not fn:
            return None
        if Path(str(fn)).suffix.lower() == ".dxf":
            return None
        if ".generation-live." in str(fn).lower():
            return None
        path = _path_for(str(fn))
        if path is None:
            restored = history_service.restore_missing_live_file(project_path, str(fn))
            if restored is not None:
                return str(fn)
            return None
        if cad_service.looks_like_mcmaster_part_stem(path.stem):
            return None
        if cad_service._is_exploded_assembly_sidecar_stem(path.stem, project_path):
            return None
        return str(fn)

    candidate: str | None = None
    if 0 <= idx < len(entries):
        candidate = _usable(entries[idx])
    if not candidate:
        # Walk backward for the newest successful model artifact.
        for entry in reversed(entries):
            candidate = _usable(entry)
            if candidate:
                break

    published = cad_service.newest_published_model(project_path)
    pub_path = _path_for(published)
    cand_path = _path_for(candidate)
    # A later Mesh/Jake/VibeCAD publish must beat a stale transform of an older generate.
    if pub_path is not None and (
        cand_path is None or pub_path.stat().st_mtime > cand_path.stat().st_mtime + 0.5
    ):
        return cad_service.resolve_viewport_filename(project_path, published)
    if candidate:
        return cad_service.resolve_viewport_filename(project_path, candidate)
    files = [
        f for f in cad_service.list_project_files(project_path)
        if Path(str(f.get("name") or "")).suffix.lower() != ".dxf"
        and not cad_service.looks_like_mcmaster_part_stem(Path(str(f.get("name") or "")).stem)
        and Path(str(f.get("name") or "")).suffix.lower() in {".glb", ".gltf", ".step", ".stp", ".stl", ".obj", ".ply", ".off", ".3mf"}
        and not cad_service._is_exploded_assembly_sidecar_stem(Path(str(f.get("name") or "")).stem, project_path)
    ]
    if not files:
        return None
    newest = max(files, key=lambda f: (project_path / f["name"]).stat().st_mtime)["name"]
    return cad_service.resolve_viewport_filename(project_path, newest)


_OPEN_MESH_SUFFIXES = {".glb", ".gltf", ".stl", ".obj", ".ply", ".off"}
_OPEN_SKIP_MARKERS = (".generation-live.", "__faceted", "_exploded", "_active_", "_export_", "_share_")
_OPEN_PREFER_GLB = {".stl", ".obj", ".ply", ".off", ".step", ".stp"}
_OPEN_MESH_RANK = {".glb": 4, ".gltf": 3, ".stl": 2, ".obj": 1, ".ply": 1, ".off": 1}


def _jake_open_public_name(name: str) -> str:
    """Map CADJS ``.{stem}.step.glb`` to a public catalog identity for the client."""
    base = Path(str(name or "").replace("\\", "/")).name
    lower = base.lower()
    if base.startswith(".") and lower.endswith(".step.glb"):
        return f"{base[1 : -len('.step.glb')]}.glb"
    if base.startswith(".") and lower.endswith(".stp.glb"):
        return f"{base[1 : -len('.stp.glb')]}.glb"
    return str(name or "")


def _append_jake_open_recovery(project_path: Path, files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the hidden assembled viewer in lite view=open after a catalog tombstone.

    ``view=full`` is aliased to this payload, so hydrate cannot CAD-walk the
    recovered sidecar. Without this, projects like 77ec39a4 look empty.
    """
    existing = {str(entry.get("name") or "") for entry in files}
    existing_stems = {Path(name).stem.lower() for name in existing if name}
    extra: list[dict[str, Any]] = []
    for stem, path in cad_service._jake_hidden_assembly_previews(project_path):
        viewer = path.name
        if viewer in existing or stem.lower() in existing_stems:
            continue
        if cad_service.looks_like_mcmaster_part_stem(stem):
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        public_name = _jake_open_public_name(viewer)
        if public_name in existing:
            continue
        extra.append(
            {
                "id": Path(public_name).with_suffix("").as_posix(),
                "name": public_name,
                "format": "glb",
                "size": size,
                "engine": None,
                "viewer_filename": viewer,
            }
        )
    return extra + files if extra else files


def _open_viewer_from_names(filename: str, names: set[str]) -> str:
    """Map a catalog/STEP/OBJ/STL name to a sibling mesh already in the file list."""
    raw = str(filename or "").replace("\\", "/").strip()
    if not raw:
        return raw
    suffix = Path(raw).suffix.lower()
    stem_path = raw[: -len(suffix)] if suffix else raw
    if suffix in _OPEN_PREFER_GLB or suffix not in _OPEN_MESH_SUFFIXES:
        for ext in (".glb", ".gltf"):
            sibling = f"{stem_path}{ext}"
            if sibling in names:
                return sibling
        base = Path(raw).stem
        for name in names:
            if Path(name).suffix.lower() in {".glb", ".gltf"} and Path(name).stem == base:
                return name
    if suffix in _OPEN_MESH_SUFFIXES:
        return raw
    return raw


def _newest_open_mesh(project_path: Path, files: list[dict[str, Any]]) -> str | None:
    mesh: list[tuple[float, str]] = []
    for entry in files:
        name = str(entry.get("name") or "")
        if not name:
            continue
        lower = name.lower()
        if any(marker in lower for marker in _OPEN_SKIP_MARKERS):
            continue
        if cad_service.is_lite_hidden_design_sidecar(Path(name).stem, project_path):
            continue
        if Path(name).suffix.lower() not in _OPEN_MESH_SUFFIXES:
            continue
        public_stem = Path(_jake_open_public_name(name)).stem
        if cad_service.looks_like_mcmaster_part_stem(Path(name).stem) or cad_service.looks_like_mcmaster_part_stem(
            public_stem
        ):
            continue
        path = project_path / name
        try:
            mtime = path.stat().st_mtime if path.is_file() else 0.0
        except OSError:
            mtime = 0.0
        mesh.append((mtime, name))
    if not mesh:
        return None
    glb_stems = {
        Path(name).with_suffix("").as_posix()
        for _mtime, name in mesh
        if Path(name).suffix.lower() in {".glb", ".gltf"}
    }
    preferred = [
        item
        for item in mesh
        if Path(item[1]).suffix.lower() in {".glb", ".gltf"}
        or Path(item[1]).with_suffix("").as_posix() not in glb_stems
    ]
    ranked = preferred or mesh
    return max(
        ranked,
        key=lambda item: (
            item[0],
            _OPEN_MESH_RANK.get(Path(item[1]).suffix.lower(), 0),
            item[1],
        ),
    )[1]


def _lite_open_components(
    files: list[dict[str, Any]],
    latest: str | None,
    project_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Filename-only Components for view=open. No GLB/STEP parse."""
    names = {str(entry.get("name") or "") for entry in files}
    latest_name = str(latest or "")
    latest_viewer = _open_viewer_from_names(latest_name, names) if latest_name else ""
    components: list[dict[str, Any]] = []
    seen: set[str] = set()
    root = Path(project_path) if project_path is not None else None
    for entry in files:
        name = str(entry.get("name") or "")
        if not name:
            continue
        lower = name.lower()
        if any(marker in lower for marker in _OPEN_SKIP_MARKERS):
            continue
        suffix = Path(name).suffix.lower()
        if suffix not in _OPEN_MESH_SUFFIXES and suffix not in {".step", ".stp"}:
            continue
        public_name = _jake_open_public_name(name)
        stem = Path(public_name).stem
        if cad_service.looks_like_mcmaster_part_stem(Path(name).stem) or cad_service.looks_like_mcmaster_part_stem(
            stem
        ):
            continue
        if root is not None and cad_service.is_lite_hidden_design_sidecar(stem, root):
            continue
        if root is not None and cad_service.is_lite_hidden_design_sidecar(Path(name).stem, root):
            continue
        viewer = str(entry.get("viewer_filename") or "") or _open_viewer_from_names(name, names)
        if Path(viewer).suffix.lower() not in _OPEN_MESH_SUFFIXES:
            continue
        if viewer in seen:
            continue
        seen.add(viewer)
        catalog = public_name if public_name.endswith(".glb") else viewer
        engine = catalog.split("/", 1)[0] if "/" in catalog else None
        components.append(
            {
                "id": Path(catalog).stem,
                "name": catalog,
                "stem": Path(catalog).stem,
                "engine": engine,
                "format": Path(viewer).suffix.lstrip(".").lower(),
                "viewer_filename": viewer,
                "size": entry.get("size"),
                "auto_load": True,
                "primary": viewer == latest_viewer
                or name == latest_name
                or catalog == latest_name
                or catalog == _jake_open_public_name(latest_name),
            }
        )
    components = cad_service.collapse_duplicate_folder_stems(components)
    if not any(item.get("primary") for item in components) and components:
        components[0]["primary"] = True
    return components


def project_summary(project_path: Path) -> dict[str, Any]:
    try:
        history_service.schedule_missing_live_restore(project_path)
    except Exception:
        import logging

        logging.getLogger(__name__).exception(
            "Drive auto-restore failed during project open for %s", project_path.name
        )
    files = cad_service.list_project_files(project_path)
    if not meta_path(project_path).is_file() and files:
        touch_project(project_path)
    meta = load_meta(project_path)
    generation = generation_service.public_summary(project_path)
    timeline = history_service.timeline_summary(project_path, sync_prompts=False)
    touch = meta.get("updated_at")
    if not touch and files:
        touch = datetime.fromtimestamp(
            (project_path / files[0]["name"]).stat().st_mtime, tz=timezone.utc
        ).isoformat()
    names = {str(f.get("name") or "") for f in files}
    gen_file = str((generation or {}).get("filename") or "")
    if gen_file and gen_file in names:
        latest = cad_service.resolve_viewport_filename(project_path, gen_file) or gen_file
    else:
        latest = latest_model_file(project_path)
    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "opened_at": meta.get("opened_at"),
        "file_count": len(files),
        "files": files,
        "browser": cad_service.list_browser_tree(project_path),
        "timeline": timeline,
        "latest_file": latest,
        "usage_summary": {},
        "generation": generation,
        "fusion_source": meta.get("autodesk_source"),
    }


def project_open_summary(project_path: Path) -> dict[str, Any]:
    """Fast first-paint payload for project open — no CAD browser / GLB scene walk."""
    files = _append_jake_open_recovery(project_path, cad_service.list_project_files(project_path))
    if not meta_path(project_path).is_file() and files:
        touch_project(project_path)
    meta = load_meta(project_path)
    # Lock-free: public_summary() flocks generation.json and can stall open while a CAD job writes.
    generation = generation_service.list_public_summary(project_path)
    # Timeline JSON can be huge; parsing it on every open made swaps take seconds.
    timeline = {"entries": [], "current_index": -1}
    touch = meta.get("updated_at")
    if not touch and files:
        try:
            touch = datetime.fromtimestamp(
                (project_path / files[0]["name"]).stat().st_mtime, tz=timezone.utc
            ).isoformat()
        except OSError:
            touch = meta.get("updated_at")
    names = {str(f.get("name") or "") for f in files}
    gen_file = str((generation or {}).get("filename") or "")
    if gen_file and gen_file in names:
        latest = _open_viewer_from_names(gen_file, names)
    else:
        latest = _newest_open_mesh(project_path, files)
    if latest:
        latest = _jake_open_public_name(latest)
    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "opened_at": meta.get("opened_at"),
        "file_count": len(files),
        "files": files,
        "browser": {
            "components": _lite_open_components(files, latest, project_path),
            "sketches": [],
            "wiring": [],
            "drawings": [],
            # Cheap dir listing only — not the CAD browser walk. Recordings
            # and screenshots must be visible in Reference Files on view=open reload.
            "references": cad_service.list_reference_files(project_path),
            "renders": cad_service.list_render_files(project_path),
            "rigging": [],
            "robots": [],
        },
        "timeline": timeline,
        "latest_file": latest,
        "usage_summary": {},
        "generation": generation,
        "fusion_source": meta.get("autodesk_source"),
        "open_lite": True,
    }


def project_wiring_summary(project_path: Path) -> dict[str, Any]:
    """Fast project payload for Wiring mode without heavy CAD browser hydration."""
    try:
        history_service.schedule_missing_live_restore(project_path)
    except Exception:
        pass
    files = cad_service.list_project_files(project_path)
    if not meta_path(project_path).is_file() and files:
        touch_project(project_path)
    meta = load_meta(project_path)
    timeline = history_service.timeline_summary(project_path, sync_prompts=False)
    touch = meta.get("updated_at")
    if not touch and files:
        touch = datetime.fromtimestamp(
            (project_path / files[0]["name"]).stat().st_mtime, tz=timezone.utc
        ).isoformat()

    wiring_items: list[dict[str, Any]] = []
    wiring_path = project_path / "wiring.json"
    if wiring_path.is_file():
        try:
            data = json.loads(wiring_path.read_text(encoding="utf-8"))
            count = len(data.get("components") or [])
        except Exception:
            count = 0
        wiring_items.append(
            {
                "id": "wiring",
                "name": "Circuit layout",
                "format": "wiring",
                "component_count": count,
                "size": wiring_path.stat().st_size,
            }
        )

    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "file_count": len(files),
        "files": files,
        "browser": {
            "components": [],
            "sketches": [],
            "wiring": wiring_items,
            "drawings": [],
            "references": [],
            "renders": [],
            "rigging": [],
            "robots": [],
        },
        "timeline": timeline,
        "latest_file": latest_model_file(project_path),
        "usage_summary": {},
        "generation": generation_service.public_summary(project_path),
    }


def project_list_summary(project_path: Path) -> dict[str, Any]:
    """Fast sidebar summary; full browser/timeline data loads when opening a project.

    Do not walk design files, take the generation flock, or parse timeline JSON
    here — that made Projects hang on Loading while listing ~100+ folders.
    """
    meta = load_meta(project_path)
    touch = meta.get("updated_at") or meta.get("opened_at")
    mtime_iso = None
    try:
        mtime_iso = datetime.fromtimestamp(project_path.stat().st_mtime, tz=timezone.utc).isoformat()
    except OSError:
        mtime_iso = None
    if not touch:
        touch = mtime_iso or meta.get("created_at")
    file_count = int(meta.get("file_count") or 0)
    from backend.services.project_thumb import preview_url_for, thumb_path as project_thumb_path

    dest = project_thumb_path(project_path)
    preview_url = preview_url_for(project_path.name, project_path) if dest.is_file() else None
    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "opened_at": meta.get("opened_at"),
        "mtime": mtime_iso,
        "file_count": file_count,
        "generation": generation_service.list_public_summary(project_path),
        "preview_url": preview_url,
    }


def list_all_projects(projects_root: Path) -> list[dict[str, Any]]:
    items = []
    for d in projects_root.iterdir():
        if not d.is_dir() or d.name.startswith("."):
            continue
        items.append(project_summary(d))

    def sort_key(p: dict[str, Any]) -> str:
        return p.get("updated_at") or p.get("created_at") or ""

    items.sort(key=sort_key, reverse=True)
    return items
