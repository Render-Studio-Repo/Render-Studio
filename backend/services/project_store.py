"""Project metadata and listing from the projects/ folder."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import cad_service, generation_service, history_service, prompt_history_service

META_FILE = "project.json"


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


def _title_case_word(word: str) -> str:
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


def apply_prompt_project_name(project_path: Path, prompt: str, *, fallback: str | None = None) -> dict[str, Any]:
    """Rename a default-id project from the prompt (Capitalization And Spaces)."""
    meta = load_meta(project_path)
    if not _ai_may_set_project_name(project_path, meta):
        return meta
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
    return touch_project(project_path, name=title or "New Model")


def _ai_may_set_project_name(project_path: Path, meta: dict[str, Any]) -> bool:
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


def latest_model_file(project_path: Path) -> str | None:
    """Best file to open when restoring a project."""
    timeline = history_service.load_timeline(project_path)
    entries = timeline.get("entries", [])
    idx = timeline.get("current_index", -1)

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
        if fn and Path(str(fn)).suffix.lower() != ".dxf" and (project_path / fn).is_file():
            return str(fn)
        return None

    candidate: str | None = None
    if 0 <= idx < len(entries):
        candidate = _usable(entries[idx])
    if not candidate:
        # Walk backward for the newest successful model artifact.
        for entry in reversed(entries):
            candidate = _usable(entry)
            if candidate:
                break
    if candidate:
        return cad_service.resolve_viewport_filename(project_path, candidate)
    files = [
        f for f in cad_service.list_project_files(project_path)
        if Path(str(f.get("name") or "")).suffix.lower() != ".dxf"
    ]
    if not files:
        return None
    newest = max(files, key=lambda f: (project_path / f["name"]).stat().st_mtime)["name"]
    return cad_service.resolve_viewport_filename(project_path, newest)


def project_summary(project_path: Path) -> dict[str, Any]:
    files = cad_service.list_project_files(project_path)
    if not meta_path(project_path).is_file() and files:
        touch_project(project_path)
    meta = load_meta(project_path)
    timeline = history_service.timeline_summary(project_path)
    touch = meta.get("updated_at")
    if not touch and files:
        touch = datetime.fromtimestamp(
            (project_path / files[0]["name"]).stat().st_mtime, tz=timezone.utc
        ).isoformat()
    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "file_count": len(files),
        "files": files,
        "browser": cad_service.list_browser_tree(project_path),
        "timeline": timeline,
        "latest_file": latest_model_file(project_path),
        "usage_summary": prompt_history_service.project_usage_summary(project_path),
        "generation": generation_service.public_summary(project_path),
    }


def project_wiring_summary(project_path: Path) -> dict[str, Any]:
    """Fast project payload for Wiring mode without heavy CAD browser hydration."""
    files = cad_service.list_project_files(project_path)
    if not meta_path(project_path).is_file() and files:
        touch_project(project_path)
    meta = load_meta(project_path)
    timeline = history_service.timeline_summary(project_path)
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
        "usage_summary": prompt_history_service.project_usage_summary(project_path),
        "generation": generation_service.public_summary(project_path),
    }


def project_list_summary(project_path: Path) -> dict[str, Any]:
    """Fast sidebar summary; full browser/timeline data loads when opening a project."""
    meta = load_meta(project_path)
    touch = meta.get("updated_at")
    if not touch:
        try:
            touch = datetime.fromtimestamp(project_path.stat().st_mtime, tz=timezone.utc).isoformat()
        except OSError:
            touch = meta.get("created_at")
    try:
        file_count = len(cad_service.list_project_files(project_path))
    except OSError:
        file_count = int(meta.get("file_count") or 0)
    # Keep meta cache in sync so future reads stay cheap/accurate.
    if meta.get("file_count") != file_count:
        meta["file_count"] = file_count
        try:
            save_meta(project_path, meta)
        except OSError:
            pass
    timeline_entries = 0
    try:
        timeline_entries = len((history_service.load_timeline(project_path) or {}).get("entries") or [])
    except Exception:
        timeline_entries = 0
    return {
        "id": project_path.name,
        "name": meta.get("name") or project_path.name,
        "created_at": meta.get("created_at"),
        "updated_at": touch or meta.get("updated_at"),
        "file_count": file_count,
        "files": [],
        "browser": {"components": [], "sketches": [], "wiring": [], "drawings": [], "references": [], "renders": []},
        "timeline": {"entries": [{} for _ in range(timeline_entries)]},
        "latest_file": None,
        "usage_summary": None,
        "generation": generation_service.public_summary(project_path),
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
