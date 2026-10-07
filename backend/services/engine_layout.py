"""Per-harness design folders inside a Render Studio project.

Jake, VibeCAD, and Mesh keep generators and published STEP/GLB in
``jake/``, ``vibecad/``, and ``mesh/`` so one harness cannot overwrite another.

The viewport still lists every folder. Cross-harness edit is allowed by
importing the other engine's published STEP/GLB — never by executing its source.
Legacy files in the project root stay valid and keep their paths on same-engine edit.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote

ENGINE_JAKE = "jake"
ENGINE_VIBECAD = "vibecad"
ENGINE_MESH = "mesh"

ENGINE_FOLDERS: tuple[str, ...] = (ENGINE_JAKE, ENGINE_VIBECAD, ENGINE_MESH)
ENGINE_FOLDER_SET = frozenset(ENGINE_FOLDERS)

_JAKE_KINDS = frozenset({"jake", "v2", "architect", "fusion", "other"})
_VIBE_KINDS = frozenset({"vibecad", "vibe", "vibecade"})
_MESH_KINDS = frozenset({"mesh", "mesh_beta", "img2threejs", "threejs"})

_EXTRA_SAFE_FOLDERS = frozenset({"mcmaster_library", "references", "renders"})

ENGINE_LABELS = {
    ENGINE_JAKE: "Jake",
    ENGINE_VIBECAD: "VibeCAD",
    ENGINE_MESH: "Mesh",
}


def looks_like_drive_id_stub(path: Path) -> bool:
    """True when *path* is a Google Drive ``{"id": "..."}`` pointer saved as .glb."""
    try:
        size = Path(path).stat().st_size
        if size < 8 or size > 256:
            return False
        head = Path(path).read_bytes()[:120].lstrip()
    except OSError:
        return False
    return head.startswith(b"{") and b'"id"' in head


def _layout_file(path: Path) -> Path | None:
    if not path.is_file():
        return None
    if path.suffix.lower() in {".glb", ".gltf"} and looks_like_drive_id_stub(path):
        return None
    return path


def folder_for_kind(kind: str | None) -> str | None:
    k = str(kind or "").strip().lower().replace("-", "_")
    if k in _MESH_KINDS or k.replace("_", "-") in {"mesh-beta"}:
        return ENGINE_MESH
    if k in _VIBE_KINDS:
        return ENGINE_VIBECAD
    if k in _JAKE_KINDS:
        return ENGINE_JAKE
    return None


def engine_folder_of(filename: str | None) -> str | None:
    parts = _parts(filename)
    if len(parts) >= 2 and parts[0] in ENGINE_FOLDER_SET:
        return parts[0]
    return None


def model_stem(filename: str | None) -> str:
    name = Path(str(filename or "").replace("\\", "/")).name
    stem = Path(name).stem
    for suffix in (".vibecad", ".mesh", ".freecad"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)] or stem
    return stem


def _decode_rel(filename: str | None) -> str:
    """Turn ``vibecad%2Fpart.glb`` into ``vibecad/part.glb`` without treating ``+`` as space."""
    raw = str(filename or "").replace("\\", "/").strip()
    if not raw:
        return ""
    for _ in range(2):
        if "%" not in raw:
            break
        nxt = unquote(raw)
        if nxt == raw:
            break
        raw = nxt
    return raw.strip()


def _parts(filename: str | None) -> list[str]:
    raw = _decode_rel(filename).lstrip("/")
    if not raw or ".." in raw.split("/"):
        return []
    return [p for p in Path(raw).parts if p not in {".", ""}]


def normalize_rel(filename: str | None) -> str | None:
    """Allow a basename or one safe folder/basename. Reject path escape."""
    parts = _parts(filename)
    if not parts:
        return None
    if len(parts) == 1:
        name = parts[0]
        if name in {".", ".."}:
            return None
        return name
    if len(parts) == 2 and parts[0] in ENGINE_FOLDER_SET | _EXTRA_SAFE_FOLDERS:
        if parts[1] in {".", ".."}:
            return None
        return f"{parts[0]}/{parts[1]}"
    return None


def project_rel(project_path: Path, path: Path) -> str:
    root = Path(project_path).resolve()
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        parent = path.parent.name
        if parent in ENGINE_FOLDER_SET:
            return f"{parent}/{path.name}"
        return path.name


def preview_rel(path: Path) -> str:
    parent = path.parent.name
    if parent in ENGINE_FOLDER_SET:
        return f"{parent}/{path.name}"
    return path.name


def safe_project_path(project_path: Path, rel: str | None) -> Path:
    cleaned = normalize_rel(rel)
    if not cleaned:
        raise ValueError(f"Invalid path: {rel}")
    root = Path(project_path).resolve()
    path = (root / cleaned).resolve()
    if path != root and root not in path.parents:
        raise ValueError(f"Invalid path: {rel}")
    return path


def ensure_engine_dir(project_path: Path, kind: str | None) -> Path:
    folder = folder_for_kind(kind) or ENGINE_JAKE
    path = Path(project_path) / folder
    path.mkdir(parents=True, exist_ok=True)
    return path


def _source_belongs_to_kind(name: str, kind: str | None) -> bool:
    folder = folder_for_kind(kind)
    lower = name.lower()
    if folder == ENGINE_MESH:
        return lower.endswith(".mesh.mjs") or lower.endswith(".mesh.js")
    if folder == ENGINE_VIBECAD:
        return lower.endswith(".vibecad.py") or lower.endswith(".freecad.py")
    if folder == ENGINE_JAKE:
        return lower.endswith(".py") and not lower.endswith(".vibecad.py") and not lower.endswith(".freecad.py")
    return False


def _layout_hint(
    previous_source_name: str | None,
    base_filename: str | None,
) -> str | None:
    """Prefer the selected file's engine folder over a root sidecar name."""
    for name in (base_filename, previous_source_name):
        if engine_folder_of(name):
            return name
    return previous_source_name or base_filename


def output_dir(
    project_path: Path,
    kind: str | None,
    *,
    previous_source_name: str | None = None,
    base_filename: str | None = None,
) -> Path:
    """Directory for this generate. Same-engine edit keeps its folder (including legacy root)."""
    root = Path(project_path)
    folder = folder_for_kind(kind)
    if not folder:
        return root

    hint = _layout_hint(previous_source_name, base_filename)
    hinted_folder = engine_folder_of(hint)
    if hinted_folder:
        if hinted_folder == folder:
            dest = root / hinted_folder
            dest.mkdir(parents=True, exist_ok=True)
            return dest
        return ensure_engine_dir(root, kind)

    base = Path(str(hint or "")).name
    stem = model_stem(base) if base else ""
    # A live model already in jake/vibecad/mesh beats a Codex source dumped at root.
    if folder and stem:
        engine_dir = root / folder
        for suffix in (".glb", ".gltf", ".step", ".stp", ".vibecad.py", ".freecad.py", ".py", ".mesh.mjs", ".mesh.js"):
            if folder == ENGINE_JAKE and suffix in {".vibecad.py", ".freecad.py"}:
                continue
            if folder == ENGINE_VIBECAD and suffix in {".py", ".mesh.mjs", ".mesh.js"}:
                continue
            if folder == ENGINE_MESH and suffix not in {".mesh.mjs", ".mesh.js", ".glb", ".gltf"}:
                continue
            if (engine_dir / f"{stem}{suffix}").is_file():
                dest = engine_dir
                dest.mkdir(parents=True, exist_ok=True)
                return dest
    if base and (root / base).is_file() and _source_belongs_to_kind(base, kind):
        return root
    # Same-engine legacy: foo.glb selected, foo.py still at root.
    if base:
        if folder == ENGINE_JAKE and (root / f"{stem}.py").is_file() and not str(base).lower().endswith(".vibecad.py"):
            return root
        if folder == ENGINE_VIBECAD and (
            (root / f"{stem}.vibecad.py").is_file() or (root / f"{stem}.freecad.py").is_file()
        ):
            return root
        if folder == ENGINE_MESH and (
            (root / f"{stem}.mesh.mjs").is_file() or (root / f"{stem}.mesh.js").is_file()
        ):
            return root
    return ensure_engine_dir(root, kind)


@dataclass
class EngineArtifacts:
    kind: str
    folder: str | None
    stem: str
    directory: Path
    source_name: str
    step_name: str
    glb_name: str
    stl_name: str
    three_mf_name: str
    source_path: Path
    step_path: Path
    glb_path: Path
    stl_path: Path
    three_mf_path: Path

    def rel(self, path: Path, project_path: Path) -> str:
        return project_rel(project_path, path)


def artifacts_for(
    project_path: Path,
    kind: str | None,
    stem: str,
    *,
    previous_source_name: str | None = None,
    base_filename: str | None = None,
) -> EngineArtifacts:
    root = Path(project_path)
    clean = model_stem(stem) or "model"
    directory = output_dir(
        root,
        kind,
        previous_source_name=previous_source_name,
        base_filename=base_filename,
    )
    folder = directory.name if directory != root and directory.name in ENGINE_FOLDER_SET else None
    k = folder_for_kind(kind) or ENGINE_JAKE
    if k == ENGINE_MESH:
        source = directory / f"{clean}.mesh.mjs"
    elif k == ENGINE_VIBECAD:
        prev = Path(str(previous_source_name or "")).name.lower()
        if prev.endswith(".freecad.py"):
            source = directory / f"{clean}.freecad.py"
        else:
            source = directory / f"{clean}.vibecad.py"
    else:
        source = directory / f"{clean}.py"
    step = directory / f"{clean}.step"
    glb = directory / f"{clean}.glb"
    stl = directory / f"{clean}.stl"
    three = directory / f"{clean}.3mf"
    return EngineArtifacts(
        kind=k,
        folder=folder,
        stem=clean,
        directory=directory,
        source_name=project_rel(root, source),
        step_name=project_rel(root, step),
        glb_name=project_rel(root, glb),
        stl_name=project_rel(root, stl),
        three_mf_name=project_rel(root, three),
        source_path=source,
        step_path=step,
        glb_path=glb,
        stl_path=stl,
        three_mf_path=three,
    )


def resolve_in_layout(project_path: Path, filename: str | None) -> Path | None:
    """Resolve a project-relative or bare filename across root + engine folders."""
    root = Path(project_path)
    cleaned = normalize_rel(filename)
    if cleaned:
        direct = _layout_file(root / cleaned)
        if direct is not None:
            return direct
        if "/" in cleaned:
            return None
    name = Path(str(filename or "")).name
    if not name or name in {".", ".."}:
        return None
    hit = _layout_file(root / name)
    if hit is not None:
        return hit
    lib = _layout_file(root / "mcmaster_library" / name)
    if lib is not None:
        return lib
    matches = [
        hit
        for folder in ENGINE_FOLDERS
        if (hit := _layout_file(root / folder / name)) is not None
    ]
    if len(matches) == 1:
        return matches[0]
    if matches:
        return max(matches, key=lambda p: p.stat().st_mtime)
    stem = model_stem(name)
    suffix = Path(name).suffix
    if suffix:
        extra = []
        for folder in (root, root / "mcmaster_library", *(root / f for f in ENGINE_FOLDERS)):
            candidate = _layout_file(folder / f"{stem}{suffix}")
            if candidate is not None:
                extra.append(candidate)
        if len(extra) == 1:
            return extra[0]
        if extra:
            return max(extra, key=lambda p: p.stat().st_mtime)
    return None


def iter_design_files(project_path: Path) -> list[Path]:
    root = Path(project_path)
    if not root.is_dir():
        return []
    files: list[Path] = []
    for folder in (root, *(root / name for name in ENGINE_FOLDERS)):
        if not folder.is_dir():
            continue
        try:
            children = list(folder.iterdir())
        except OSError:
            continue
        for path in children:
            if path.is_file() and not path.name.startswith("."):
                files.append(path)
    return files


def sibling_with_suffix(project_path: Path, filename: str | None, suffixes: Iterable[str]) -> Path | None:
    resolved = resolve_in_layout(project_path, filename)
    stem = model_stem(filename if resolved is None else resolved.name)
    if not stem:
        return None
    dirs: list[Path] = []
    if resolved is not None:
        dirs.append(resolved.parent)
    dirs.append(Path(project_path))
    dirs.append(Path(project_path) / "mcmaster_library")
    dirs.extend(Path(project_path) / f for f in ENGINE_FOLDERS)
    seen: set[str] = set()
    for folder in dirs:
        key = str(folder)
        if key in seen or not folder.is_dir():
            continue
        seen.add(key)
        for suffix in suffixes:
            candidate = folder / f"{stem}{suffix}"
            if candidate.is_file():
                return candidate
    return None


def detect_file_engine(project_path: Path, filename: str | None) -> str | None:
    hinted = engine_folder_of(filename)
    if hinted:
        return hinted
    name = Path(str(filename or "")).name.lower()
    if name.endswith(".mesh.mjs") or name.endswith(".mesh.js"):
        return ENGINE_MESH
    if name.endswith(".vibecad.py") or name.endswith(".freecad.py"):
        return ENGINE_VIBECAD
    stem = model_stem(filename)
    if not stem:
        return None
    root = Path(project_path)
    if (root / ENGINE_MESH / f"{stem}.mesh.mjs").is_file() or (root / f"{stem}.mesh.mjs").is_file():
        if name.endswith(".glb") and (
            (root / ENGINE_JAKE / f"{stem}.py").is_file() or (root / f"{stem}.py").is_file()
        ):
            # Ambiguous GLB at root: prefer the folder the file actually lives in.
            resolved = resolve_in_layout(project_path, filename)
            if resolved is not None and resolved.parent.name in ENGINE_FOLDER_SET:
                return resolved.parent.name
        if name.endswith(".mesh.mjs") or name.endswith(".mesh.js"):
            return ENGINE_MESH
    if (root / ENGINE_VIBECAD / f"{stem}.vibecad.py").is_file() or (root / f"{stem}.vibecad.py").is_file():
        return ENGINE_VIBECAD
    py_root = root / f"{stem}.py"
    py_jake = root / ENGINE_JAKE / f"{stem}.py"
    if py_jake.is_file() or (py_root.is_file() and not str(py_root).lower().endswith(".vibecad.py")):
        return ENGINE_JAKE
    resolved = resolve_in_layout(project_path, filename)
    if resolved is not None and resolved.parent.name in ENGINE_FOLDER_SET:
        return resolved.parent.name
    return None


def cross_engine_geometry(
    project_path: Path,
    filename: str | None,
    kind: str | None,
) -> dict[str, Any] | None:
    """Published STEP/GLB from another harness to import — not its generator source."""
    if not filename:
        return None
    current = folder_for_kind(kind)
    source_engine = detect_file_engine(project_path, filename)
    if not current or not source_engine or source_engine == current:
        return None
    step = sibling_with_suffix(project_path, filename, (".step", ".stp"))
    glb = sibling_with_suffix(project_path, filename, (".glb", ".gltf"))
    resolved = resolve_in_layout(project_path, filename)
    return {
        "filename": project_rel(project_path, resolved) if resolved else filename,
        "source_engine": source_engine,
        "source_label": ENGINE_LABELS.get(source_engine, source_engine),
        "target_engine": current,
        "target_label": ENGINE_LABELS.get(current, current),
        "step": project_rel(project_path, step) if step else None,
        "glb": project_rel(project_path, glb) if glb else None,
    }


def generator_candidates(
    project_path: Path,
    filename: str | None,
    kind: str | None,
) -> list[Path]:
    """Same-engine generator files only (never the other harness's source)."""
    root = Path(project_path)
    stem = model_stem(filename)
    if not stem:
        return []
    hinted = engine_folder_of(filename)
    folder = folder_for_kind(kind)
    dirs: list[Path] = []
    if hinted:
        dirs.append(root / hinted)
    if folder:
        dirs.append(root / folder)
    dirs.append(root)
    names: list[str] = []
    if folder == ENGINE_MESH:
        mesh_stem = stem
        names = [f"{stem}.mesh.mjs", f"{stem}.mesh.js", f"{mesh_stem}.mesh.mjs"]
    elif folder == ENGINE_VIBECAD:
        names = [f"{stem}.vibecad.py", f"{stem}.freecad.py"]
    else:
        names = [f"{stem}.py"]
        for suffix in ("_edited", "_pulled", "_mirrored", "_extruded", "_body"):
            if stem.endswith(suffix):
                names.append(f"{stem[: -len(suffix)]}.py")
    out: list[Path] = []
    seen: set[str] = set()
    for directory in dirs:
        for name in names:
            path = directory / name
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            lower = path.name.lower()
            if folder == ENGINE_JAKE and (lower.endswith(".vibecad.py") or lower.endswith(".freecad.py")):
                continue
            out.append(path)
    return out
