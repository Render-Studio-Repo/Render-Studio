"""CAD mesh operations: load, export, and build primitives from AI actions."""

from __future__ import annotations

import json
import logging
import math
import re
import struct
import uuid
import zipfile
from pathlib import Path
from typing import Any, Sequence
from xml.etree import ElementTree as ET

import numpy as np
import trimesh

logger = logging.getLogger(__name__)

THREEMF_CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
THREEMF_PRODUCTION_NS = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
THREEMF_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
THREEMF_CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
THREEMF_MODEL_REL_TYPE = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"
THREEMF_IDENTITY_TRANSFORM = "1 0 0 0 1 0 0 0 1 0 0 0"
ET.register_namespace("", THREEMF_CORE_NS)
ET.register_namespace("p", THREEMF_PRODUCTION_NS)

_3MF_CONTENT_TYPES_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
"""

_3MF_RELS_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" Id="rel0"/>
</Relationships>
"""

SUPPORTED_IMPORT = {
    ".stl",
    ".obj",
    ".glb",
    ".gltf",
    ".ply",
    ".off",
    ".3mf",
    ".step",
    ".stp",
    ".dxf",
    ".iges",
    ".igs",
    ".brep",
    ".brp",
    ".f3z",  # Fusion archive — extract embedded STEP/mesh when possible
    ".zip",
    # Accepted for upload; proprietary natives need STEP/STL export for geometry read
    ".f3d",
    ".sldprt",
    ".sldasm",
    ".x_t",
    ".x_b",
    ".sat",
    ".sab",
}
STEP_SUFFIXES = {".step", ".stp"}
IGES_SUFFIXES = {".iges", ".igs"}
BREP_SUFFIXES = {".brep", ".brp"}
MESH_VIEW_SUFFIXES = {".stl", ".obj", ".glb", ".gltf", ".ply", ".off", ".3mf"}
PROPRIETARY_CAD_SUFFIXES = {".f3d", ".sldprt", ".sldasm", ".x_t", ".x_b", ".sat", ".sab"}
ARCHIVE_CAD_SUFFIXES = {".f3z", ".zip"}
SUPPORTED_EXPORT = {".stl", ".glb", ".obj", ".3mf", ".step"}
# Robot description artifacts (listed in the project browser / file list, not timeline meshes).
SUPPORTED_ROBOT = {".urdf", ".srdf"}
MESH_DERIVED_EXPORTS = ("stl", "3mf", "step")
# Specs, notes, and images dropped into the workspace (not CAD geometry).
SUPPORTED_REFERENCE = {
    ".pdf",
    ".txt",
    ".md",
    ".csv",
    ".tsv",
    ".log",
    ".json",
    ".yaml",
    ".yml",
    ".html",
    ".htm",
    ".rtf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".svg",
    ".tif",
    ".tiff",
}
REFERENCE_TEXT_SUFFIXES = {".txt", ".md", ".csv", ".tsv", ".log", ".json", ".yaml", ".yml", ".html", ".htm", ".rtf"}
REFERENCE_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".tif", ".tiff"}
REFERENCE_DIRNAME = "references"
RENDERS_DIRNAME = "renders"
MARKUP_FOLDER_NAMES = frozenset({REFERENCE_DIRNAME, RENDERS_DIRNAME})

DEFAULT_APPEARANCE_PALETTE = np.array(
    [
        [120, 174, 232, 255],  # Onshape-like blue
        [143, 209, 127, 255],
        [240, 193, 90, 255],
        [232, 137, 116, 255],
        [183, 155, 232, 255],
        [107, 199, 198, 255],
        [215, 160, 107, 255],
        [199, 208, 217, 255],
    ],
    dtype=np.uint8,
)


def project_dir(base: Path, project_id: str) -> Path:
    path = base / project_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def references_dir(project_path: Path) -> Path:
    path = Path(project_path) / REFERENCE_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def renders_dir(project_path: Path) -> Path:
    path = Path(project_path) / RENDERS_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def is_reference_suffix(suffix: str) -> bool:
    return str(suffix or "").lower() in SUPPORTED_REFERENCE


def reference_kind(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in REFERENCE_IMAGE_SUFFIXES:
        return "image"
    if suffix == ".pdf":
        return "pdf"
    if suffix in REFERENCE_TEXT_SUFFIXES:
        return "text"
    return "file"


def resolve_project_file(project_path: Path, filename: str) -> Path | None:
    """Resolve a basename in the project root, references/, or renders/ folder."""
    safe = Path(filename).name
    if not safe or safe in {".", ".."}:
        return None
    root = Path(project_path) / safe
    if root.is_file():
        return root
    ref = Path(project_path) / REFERENCE_DIRNAME / safe
    if ref.is_file():
        return ref
    render = Path(project_path) / RENDERS_DIRNAME / safe
    if render.is_file():
        return render
    return None


def markup_sidecar_path(file_path: Path) -> Path:
    return file_path.with_name(f"{file_path.name}.markup.json")


def load_reference_markup(file_path: Path) -> dict[str, Any]:
    side = markup_sidecar_path(file_path)
    if not side.is_file():
        return {"notes": "", "strokes": [], "updated_at": None}
    try:
        data = json.loads(side.read_text(encoding="utf-8"))
    except Exception:
        return {"notes": "", "strokes": [], "updated_at": None}
    if not isinstance(data, dict):
        return {"notes": "", "strokes": [], "updated_at": None}
    strokes = data.get("strokes") if isinstance(data.get("strokes"), list) else []
    return {
        "notes": str(data.get("notes") or ""),
        "strokes": strokes,
        "updated_at": data.get("updated_at"),
    }


def save_reference_markup(file_path: Path, payload: dict[str, Any]) -> dict[str, Any]:
    from datetime import datetime, timezone

    notes = str((payload or {}).get("notes") or "")
    strokes = (payload or {}).get("strokes")
    if not isinstance(strokes, list):
        strokes = []
    cleaned: list[dict[str, Any]] = []
    for stroke in strokes[:500]:
        if not isinstance(stroke, dict):
            continue
        stroke_type = str(stroke.get("type") or "pen").lower()[:24]
        color = str(stroke.get("color") or "#f0883e")[:32]
        try:
            width = max(1.0, min(24.0, float(stroke.get("width") or 2)))
        except (TypeError, ValueError):
            width = 2.0
        try:
            page = int(stroke.get("page") or 0)
        except (TypeError, ValueError):
            page = 0
        if stroke_type == "text":
            text = str(stroke.get("text") or "")[:240].strip()
            if not text:
                continue
            try:
                x = float(stroke.get("x") if stroke.get("x") is not None else (stroke.get("points") or [[0, 0]])[0][0])
                y = float(stroke.get("y") if stroke.get("y") is not None else (stroke.get("points") or [[0, 0]])[0][1])
            except (TypeError, ValueError, IndexError):
                continue
            try:
                font_size = max(8.0, min(128.0, float(stroke.get("fontSize") or width * 6)))
            except (TypeError, ValueError):
                font_size = max(14.0, width * 6)
            cleaned.append({
                "type": "text",
                "text": text,
                "x": x,
                "y": y,
                "points": [[x, y], [x, y]],
                "color": color,
                "width": width,
                "fontSize": font_size,
                "page": page,
            })
            continue
        points = stroke.get("points")
        if not isinstance(points, list) or len(points) < 2:
            continue
        pts: list[list[float]] = []
        for pt in points[:2000]:
            if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                continue
            try:
                pts.append([float(pt[0]), float(pt[1])])
            except (TypeError, ValueError):
                continue
        if len(pts) < 2:
            continue
        cleaned.append({
            "type": stroke_type if stroke_type in {"pen", "highlight", "rect", "arrow"} else "pen",
            "points": pts,
            "color": color,
            "width": width,
            "page": page,
        })
    out = {
        "notes": notes[:100_000],
        "strokes": cleaned,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    side = markup_sidecar_path(file_path)
    side.write_text(json.dumps(out, indent=2), encoding="utf-8")
    return out


def list_reference_files(project_path: Path) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    ref_root = Path(project_path) / REFERENCE_DIRNAME
    if not ref_root.is_dir():
        return refs
    for f in sorted(ref_root.iterdir(), key=lambda p: p.name.lower()):
        if not f.is_file():
            continue
        if f.name.endswith(".markup.json"):
            continue
        if f.suffix.lower() not in SUPPORTED_REFERENCE:
            continue
        refs.append(
            {
                "id": f.stem,
                "name": f.name,
                "stem": f.stem,
                "format": f.suffix.lower().lstrip("."),
                "kind": reference_kind(f.name),
                "size": f.stat().st_size,
                "url": f"references/{f.name}",
            }
        )
    return refs


def list_render_files(project_path: Path) -> list[dict[str, Any]]:
    """Photoreal scene renders saved under project/renders/."""
    items: list[dict[str, Any]] = []
    root = Path(project_path) / RENDERS_DIRNAME
    if not root.is_dir():
        return items
    image_suffixes = REFERENCE_IMAGE_SUFFIXES | {".png", ".jpg", ".jpeg", ".webp"}
    for f in sorted(root.iterdir(), key=lambda p: p.name.lower(), reverse=True):
        if not f.is_file():
            continue
        if f.name.endswith(".markup.json"):
            continue
        if f.suffix.lower() not in image_suffixes:
            continue
        items.append(
            {
                "id": f.stem,
                "name": f.name,
                "stem": f.stem,
                "format": f.suffix.lower().lstrip("."),
                "kind": "image",
                "size": f.stat().st_size,
                "url": f"renders/{f.name}",
                "section": "renders",
            }
        )
    return items


def unique_reference_path(project_path: Path, filename: str) -> Path:
    dest_dir = references_dir(project_path)
    safe = Path(filename).name or "reference.bin"
    dest = dest_dir / safe
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    n = 2
    while True:
        candidate = dest_dir / f"{stem}_{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def rename_reference_file(project_path: Path, old_filename: str, new_filename: str) -> list[str]:
    old = Path(old_filename).name
    new = Path(new_filename).name
    if not old or not new or "/" in new or "\\" in new or ".." in new:
        raise ValueError("Invalid filename")
    if Path(new).suffix.lower() not in SUPPORTED_REFERENCE:
        raise ValueError(f"Unsupported reference type. Use: {sorted(SUPPORTED_REFERENCE)}")
    src = resolve_project_file(project_path, old)
    if src is None or src.parent.name not in MARKUP_FOLDER_NAMES:
        raise ValueError("Reference file not found")
    dest = src.with_name(new)
    if dest.exists() and dest.resolve() != src.resolve():
        raise ValueError(f"{new} already exists")
    src.rename(dest)
    renamed = [new]
    old_markup = markup_sidecar_path(src)
    if old_markup.is_file():
        new_markup = markup_sidecar_path(dest)
        if new_markup.exists() and new_markup.resolve() != old_markup.resolve():
            old_markup.unlink()
        else:
            old_markup.rename(new_markup)
            renamed.append(new_markup.name)
    return renamed


def delete_reference_file(project_path: Path, filename: str) -> list[str]:
    src = resolve_project_file(project_path, filename)
    if src is None or src.parent.name not in MARKUP_FOLDER_NAMES:
        raise FileNotFoundError(f"Cannot delete missing reference: {filename}")
    deleted = [src.name]
    markup = markup_sidecar_path(src)
    src.unlink()
    if markup.is_file():
        markup.unlink()
        deleted.append(markup.name)
    return deleted


def _is_internal_dxf_sidecar(name: str) -> bool:
    return name.lower().endswith(".ezdxf.dxf")


def is_internal_model_artifact(path: Path | str) -> bool:
    """Files used by previews/sidecars should not become timeline model snapshots."""
    name = Path(path).name
    lower = name.lower()
    if name.startswith("_active_") or name.startswith("_export_"):
        return True
    if _is_internal_dxf_sidecar(name):
        return True
    if lower.endswith((".program.json", ".sketch.json", ".sim.json", ".mjcf.xml", ".urdf", ".srdf")):
        return True
    if "_snapshot" in lower:
        return True
    return False


def list_project_files(project_path: Path) -> list[dict[str, Any]]:
    files = []
    listed = SUPPORTED_IMPORT | SUPPORTED_EXPORT | SUPPORTED_ROBOT
    for f in sorted(project_path.iterdir()):
        if f.is_file() and f.suffix.lower() in listed:
            if f.name.startswith("_active_") or f.name.startswith("_export_") or _is_internal_dxf_sidecar(f.name):
                continue
            files.append(
                {
                    "id": f.stem,
                    "name": f.name,
                    "format": f.suffix.lower().lstrip("."),
                    "size": f.stat().st_size,
                }
            )
    return files


def _export_format(filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".program.json"):
        return "program"
    if lower.endswith(".sim.json"):
        return "sim"
    if lower.endswith(".mjcf.xml"):
        return "mjcf"
    return Path(filename).suffix.lower().lstrip(".")


def faceted_step_name(stem: str) -> str:
    """Sibling name for mesh-derived STEP that must never clobber native B-rep."""
    clean = Path(str(stem or "model")).name
    if clean.lower().endswith("__faceted"):
        return f"{clean}.step"
    return f"{clean}__faceted.step"


def classify_step_file_kind(path: Path | str, *, max_bytes: int = 8_000_000) -> str:
    """Classify a STEP file for Fusion/Onshape push.

    Returns:
      - editable_brep: has closed solid B-rep (Fusion solid cuts/booleans work)
      - faceted_mesh: mesh-derived open shells / surface models only
      - unknown: empty/unreadable
    """
    p = Path(path)
    if not p.is_file() or p.stat().st_size < 32:
        return "unknown"
    try:
        # Read enough of the ISO-10303 text to count solid vs shell entities.
        raw = p.read_bytes()[:max_bytes]
        text = raw.decode("utf-8", errors="ignore").upper()
    except OSError:
        return "unknown"
    if "__FACETED" in p.stem.upper():
        return "faceted_mesh"
    manifold = text.count("MANIFOLD_SOLID_BREP")
    advanced = text.count("ADVANCED_BREP_SHAPE_REPRESENTATION")
    closed = text.count("CLOSED_SHELL")
    shell_based = text.count("SHELL_BASED_SURFACE_MODEL")
    open_shell = text.count("OPEN_SHELL")
    # Native Jake/build123d solids always have MANIFOLD_SOLID_BREP (+ usually CLOSED_SHELL).
    if manifold > 0 or (advanced > 0 and closed > 0 and shell_based == 0):
        # Mixed files with a few shells but real solids still count as editable.
        if manifold == 0 and shell_based > 0 and closed == 0:
            return "faceted_mesh"
        return "editable_brep"
    if shell_based > 0 or (open_shell > 0 and closed == 0 and manifold == 0):
        return "faceted_mesh"
    # Heuristic: STL→STEP writers often leave "Open CASCADE Shape Model" with only faces.
    if "FACETED_BREP" in text or "TRIANGULATED_FACE" in text:
        return "faceted_mesh"
    return "unknown"


def is_editable_brep_step(path: Path | str) -> bool:
    return classify_step_file_kind(path) == "editable_brep"


def _native_brep_parent_stems(stem: str) -> list[str]:
    """Candidate source stems for edited/timestamped mesh variants."""
    raw = str(stem or "").strip()
    if not raw:
        return []
    variants: list[str] = []

    def add(value: str) -> None:
        value = value.strip("_-.")
        if value and value not in variants:
            variants.append(value)

    add(raw)
    current = raw
    changed = True
    while changed:
        changed = False
        before = current
        current = re.sub(r"__faceted$", "", current, flags=re.I)
        current = re.sub(r"_(edited|pulled|clean|mirrored|extruded|body)(?:_\d{8,}(?:_\d+)?)?$", "", current, flags=re.I)
        current = re.sub(r"_(?:\d{8,})(?:_\d+)?$", "", current, flags=re.I)
        current = re.sub(r"_v\d+$", "", current, flags=re.I)
        if current != before:
            add(current)
            changed = True

    # Also handle variants with an edit marker in the middle:
    # foo_202607..._2_edited_202607... -> foo_202607..._2 -> foo
    for marker in ("_edited_", "_pulled_", "_mirrored_", "_extruded_", "_body_"):
        idx = raw.lower().rfind(marker)
        if idx > 0:
            prefix = raw[:idx]
            add(prefix)
            stripped = re.sub(r"_(?:\d{8,})(?:_\d+)?$", "", prefix, flags=re.I)
            add(stripped)
    return variants


def _has_native_step_provenance(project_path: Path, stem: str) -> bool:
    """True when a generative source likely owns `{stem}.step` as real B-rep."""
    project_path = Path(project_path)
    if (project_path / f"{stem}.py").is_file():
        return True
    if (project_path / f"{stem}.program.json").is_file():
        return True
    if (project_path / f".{stem}.step.js").is_file():
        return True
    # Edited/pulled meshes still point back to the generative base.
    for base in _native_brep_parent_stems(stem):
        if base and base != stem:
            if (project_path / f"{base}.py").is_file():
                return True
            if (project_path / f"{base}.step").is_file() and is_editable_brep_step(project_path / f"{base}.step"):
                return True
    return False


def resolve_native_brep_step(project_path: Path, filename: str) -> Path | None:
    """Prefer a Fusion-editable B-rep STEP for this model (or its generative parent)."""
    project_path = Path(project_path)
    safe = Path(filename).name
    stem = Path(safe).stem
    candidates: list[Path] = []
    if Path(safe).suffix.lower() in STEP_SUFFIXES:
        candidates.append(project_path / safe)
    for suffix in (".step", ".stp"):
        candidates.append(project_path / f"{stem}{suffix}")
    base_variants = _native_brep_parent_stems(stem)
    for base in list(base_variants):
        if base.startswith("."):
            base_variants.append(base[1:])
    for variant in list(base_variants):
        if variant.lower().endswith((".step", ".stp")):
            base_variants.append(Path(variant).stem)
    for variant in dict.fromkeys(v for v in base_variants if v and v != stem):
        for suffix in (".step", ".stp"):
            candidates.append(project_path / f"{variant}{suffix}")
    seen: set[str] = set()
    for path in candidates:
        key = str(path.resolve()) if path.exists() else path.name
        if key in seen:
            continue
        seen.add(key)
        if path.is_file() and is_editable_brep_step(path):
            return path
    return None


def list_exports_for_model(project_path: Path, filename: str) -> list[dict[str, Any]]:
    """List downloadable artifacts that share a model basename."""
    stem = Path(filename).stem
    exports: list[dict[str, Any]] = []
    faceted_name = faceted_step_name(stem)
    for f in sorted(project_path.iterdir()):
        if not f.is_file() or f.name.startswith("_active_"):
            continue
        name = f.name
        if name != filename and not name.startswith(f"{stem}.") and name != faceted_name:
            continue
        item: dict[str, Any] = {
            "name": name,
            "format": _export_format(name),
            "size": f.stat().st_size,
        }
        if item["format"] == "step":
            item["step_kind"] = classify_step_file_kind(f)
        exports.append(item)
    return exports


def resolve_step_module_sidecar(project_path: Path, filename: str) -> Path | None:
    """Resolve Jake-style `.<stem>.step.js` parameter/animation module for a model file.

    Motion is not inferred from geometry. A sidecar module (or URDF) is the contract
    that declares joints/features and viewer-time kinematics — see parameters.md.
    """
    safe = Path(filename).name
    if not safe:
        return None
    project_path = Path(project_path)
    candidates: list[Path] = []

    # generation.json may record jake_params from a prior text-to-cad run.
    gen_path = project_path / "generation.json"
    if gen_path.is_file():
        try:
            gen = json.loads(gen_path.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            gen = None
        if isinstance(gen, dict):
            for key in ("jake_params", "step_module", "params_module"):
                name = gen.get(key)
                if isinstance(name, str) and name.strip():
                    candidates.append(project_path / Path(name).name)
            files = gen.get("files") if isinstance(gen.get("files"), dict) else {}
            for key in ("jake_params", "step_module", "params"):
                name = files.get(key) if isinstance(files, dict) else None
                if isinstance(name, str) and name.strip():
                    candidates.append(project_path / Path(name).name)

    lower = safe.lower()
    if lower.endswith(".step.js"):
        candidates.append(project_path / (safe if safe.startswith(".") else f".{safe}"))
    elif lower.endswith(".step") or lower.endswith(".stp"):
        candidates.append(project_path / f".{safe}.js")
        stem = Path(safe).stem
        candidates.append(project_path / f".{stem}.step.js")
    else:
        stem = Path(safe).stem
        # foo_edited.glb → prefer sibling STEP stem module
        for suffix in (".step", ".stp"):
            step = project_path / f"{stem}{suffix}"
            if step.is_file():
                candidates.append(project_path / f".{step.name}.js")
                candidates.append(project_path / f".{stem}.step.js")
        # Strip common edit suffixes to find the generative STEP module.
        base_stem = re.sub(r"(_edited|_clean|_v\d+)$", "", stem, flags=re.I)
        if base_stem != stem:
            for suffix in (".step", ".stp"):
                step = project_path / f"{base_stem}{suffix}"
                if step.is_file():
                    candidates.append(project_path / f".{step.name}.js")
            candidates.append(project_path / f".{base_stem}.step.js")
        candidates.append(project_path / f".{stem}.step.js")

    seen: set[str] = set()
    for path in candidates:
        key = path.name
        if key in seen:
            continue
        seen.add(key)
        if path.is_file() and path.name.endswith(".js"):
            return path
    return None


def build_visible_assembly_exports(project_path: Path, filenames: list[str], *, stem: str = "_export_visible_assembly") -> list[dict[str, Any]]:
    """Build downloadable artifacts for the currently visible browser components."""
    safe_names: list[str] = []
    seen: set[str] = set()
    for raw in filenames:
        safe = Path(str(raw or "")).name
        if not safe or safe in seen:
            continue
        src = project_path / safe
        if not src.is_file() or src.suffix.lower() not in SUPPORTED_IMPORT | SUPPORTED_EXPORT:
            continue
        seen.add(safe)
        safe_names.append(safe)

    if not safe_names:
        raise ValueError("No visible exportable components.")

    for old in project_path.glob(f"{stem}.*"):
        if old.is_file():
            old.unlink(missing_ok=True)

    meshes: list[trimesh.Trimesh] = []
    scene = trimesh.Scene()
    for safe in safe_names:
        src = project_path / safe
        mesh = load_mesh(src)
        if mesh.is_empty:
            continue
        mesh.metadata["name"] = Path(safe).stem
        meshes.append(mesh)
        scene.add_geometry(mesh.copy(), geom_name=Path(safe).stem, node_name=Path(safe).stem)

    if not meshes:
        raise ValueError("Visible components did not contain exportable geometry.")

    combined = repair_mesh(trimesh.util.concatenate(meshes)) if len(meshes) > 1 else repair_mesh(meshes[0])
    # Mesh-derived STEP must use __faceted so it never pretends to be Jake/native B-rep.
    outputs = [
        project_path / f"{stem}.glb",
        project_path / f"{stem}.stl",
        project_path / faceted_step_name(stem),
        project_path / f"{stem}.3mf",
    ]
    export_scene(scene, outputs[0])
    export_mesh(combined, outputs[1])
    export_mesh_step(combined, outputs[2])
    export_scene(scene, outputs[3])
    result: list[dict[str, Any]] = []
    for out in outputs:
        if not out.is_file():
            continue
        item: dict[str, Any] = {
            "name": out.name,
            "format": _export_format(out.name),
            "size": out.stat().st_size,
        }
        if item["format"] == "step":
            item["step_kind"] = classify_step_file_kind(out)
        result.append(item)
    return result


def rename_model_file(project_path: Path, old_filename: str, new_filename: str) -> list[str]:
    """Rename a model and every exported artifact that shares its basename."""
    old = Path(old_filename).name
    new = Path(new_filename).name
    if not old or not new or old == "." or new == ".":
        raise ValueError("Invalid filename")
    if "/" in new or "\\" in new or ".." in new:
        raise ValueError("Invalid filename")
    if Path(new).suffix.lower() not in SUPPORTED_IMPORT | SUPPORTED_EXPORT | SUPPORTED_ROBOT:
        raise ValueError(f"Unsupported extension. Use: {sorted(SUPPORTED_IMPORT | SUPPORTED_EXPORT | SUPPORTED_ROBOT)}")

    old_path = project_path / old
    if not old_path.is_file():
        raise ValueError("File not found")

    old_stem = Path(old).stem
    new_stem = Path(new).stem
    renamed: list[str] = []
    for src in sorted(project_path.iterdir(), key=lambda p: p.name):
        if not src.is_file():
            continue
        name = src.name
        if name == old:
            target_name = new
        elif name.startswith(f"{old_stem}."):
            target_name = new_stem + name[len(old_stem) :]
        else:
            continue
        dest = project_path / target_name
        if dest.exists() and dest.resolve() != src.resolve():
            raise ValueError(f"{target_name} already exists")
        if dest.resolve() != src.resolve():
            src.rename(dest)
        renamed.append(target_name)
    if not (project_path / new).is_file():
        raise ValueError("Rename failed")
    return renamed


def delete_model_artifacts(project_path: Path, filename: str) -> list[str]:
    """Delete a browser component and every project file in its logical family."""
    safe = Path(filename).name
    src = project_path / safe
    if not src.is_file():
        raise FileNotFoundError(f"Cannot delete missing file: {filename}")

    stem = Path(safe).stem
    root = _logical_component_root(stem)
    deleted: list[str] = []
    for path in sorted(project_path.iterdir(), key=lambda p: p.name):
        if not path.is_file() or path.name.startswith("_active_"):
            continue
        name = path.name
        artifact_stem = _artifact_stem(name)
        if name == safe or artifact_stem == stem or _logical_component_root(artifact_stem) == root:
            path.unlink()
            deleted.append(name)
    if safe not in deleted:
        raise FileNotFoundError(f"Delete failed for: {filename}")
    return deleted


def import_iges_mesh(path: Path, linear_deflection: float = 0.5) -> trimesh.Trimesh:
    """Tessellate an IGES file to a triangle mesh."""
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.IGESControl import IGESControl_Reader
    from OCP.StlAPI import StlAPI_Writer
    import tempfile

    reader = IGESControl_Reader()
    status = reader.ReadFile(str(path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ValueError(f"Could not read IGES file: {path.name}")
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        raise ValueError(f"IGES file has no geometry: {path.name}")
    BRepMesh_IncrementalMesh(shape, linear_deflection, False, linear_deflection, True)
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        writer = StlAPI_Writer()
        if not writer.Write(shape, str(tmp_path)):
            raise ValueError(f"Could not tessellate IGES file: {path.name}")
        return load_mesh(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)


def import_brep_mesh(path: Path, linear_deflection: float = 0.5) -> trimesh.Trimesh:
    """Tessellate an OpenCascade BREP file to a triangle mesh."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRepTools import BRepTools
    from OCP.TopoDS import TopoDS_Shape
    from OCP.StlAPI import StlAPI_Writer
    import tempfile

    shape = TopoDS_Shape()
    builder = BRep_Builder()
    if not BRepTools.Read_s(shape, str(path), builder):
        raise ValueError(f"Could not read BREP file: {path.name}")
    if shape.IsNull():
        raise ValueError(f"BREP file has no geometry: {path.name}")
    BRepMesh_IncrementalMesh(shape, linear_deflection, False, linear_deflection, True)
    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        writer = StlAPI_Writer()
        if not writer.Write(shape, str(tmp_path)):
            raise ValueError(f"Could not tessellate BREP file: {path.name}")
        return load_mesh(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)


def import_step_mesh(path: Path, linear_deflection: float = 0.5) -> trimesh.Trimesh:
    """Tessellate a STEP file to a single triangle mesh (no colour, legacy path)."""
    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.STEPControl import STEPControl_Reader
    from OCP.StlAPI import StlAPI_Writer

    reader = STEPControl_Reader()
    status = reader.ReadFile(str(path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ValueError(f"Could not read STEP file: {path.name}")
    reader.TransferRoots()
    shape = reader.OneShape()
    if shape.IsNull():
        raise ValueError(f"STEP file has no geometry: {path.name}")

    BRepMesh_IncrementalMesh(shape, linear_deflection, False, linear_deflection, True)

    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        writer = StlAPI_Writer()
        if not writer.Write(shape, str(tmp_path)):
            raise ValueError(f"Could not tessellate STEP file: {path.name}")
        return load_mesh(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)


def tessellate_step_to_glb(step_path: Path, glb_path: Path | None = None) -> Path:
    """Convert a STEP file to GLB, preserving per-body colours and smooth normals.

    Uses OCC's XCAF (colour-aware) STEP reader and the RWGltf_CafWriter to write
    a GLTF/GLB that carries original material colours from Onshape appearances.
    Falls back to the legacy STL-route if XCAF writing fails.
    """
    dest = glb_path or step_path.with_suffix(".glb")
    try:
        _step_to_glb_xcaf(step_path, dest)
        _match_glb_scale_to_step(step_path, dest)
        return dest
    except Exception as exc:
        logger.warning("XCAF GLTF export failed (%s), falling back to STL route", exc)
        mesh = import_step_mesh(step_path)
        return export_mesh(mesh, dest)


def _step_to_glb_xcaf(step_path: Path, glb_path: Path) -> None:
    """Read STEP with full XCAF colour support and write GLB directly via OCC."""
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.TDocStd import TDocStd_Document
    from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
    from OCP.XCAFApp import XCAFApp_Application
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound
    from OCP.TDF import TDF_LabelSequence
    from OCP.RWGltf import RWGltf_CafWriter
    from OCP.TColStd import TColStd_IndexedDataMapOfStringString
    from OCP.Message import Message_ProgressRange
    from OCP.IFSelect import IFSelect_ReturnStatus

    # ── 1. Read STEP into an XCAF document ──────────────────────────────────
    app = XCAFApp_Application.GetApplication_s()
    fmt = TCollection_ExtendedString("BinXCAF")
    doc = TDocStd_Document(fmt)
    app.NewDocument(fmt, doc)

    reader = STEPCAFControl_Reader()
    reader.SetColorMode(True)
    reader.SetLayerMode(True)
    reader.SetNameMode(True)
    status = reader.ReadFile(str(step_path))
    if status != IFSelect_ReturnStatus.IFSelect_RetDone:
        raise ValueError(f"STEPCAFControl_Reader failed on {step_path.name}")
    reader.Transfer(doc)

    # ── 2. Tessellate all shapes in the document ─────────────────────────────
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    labels = TDF_LabelSequence()
    shape_tool.GetFreeShapes(labels)
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for i in range(1, labels.Size() + 1):
        shape = XCAFDoc_ShapeTool.GetShape_s(labels.Value(i))
        if not shape.IsNull():
            builder.Add(compound, shape)

    # Fine linear deflection for smooth curved surfaces; 0.5 rad angular
    # deflection preserves sharp feature edges so flat faces stay flat.
    BRepMesh_IncrementalMesh(compound, 0.1, False, 0.5, True)

    # ── 3. Write GLB via RWGltf_CafWriter ────────────────────────────────────
    meta = TColStd_IndexedDataMapOfStringString()
    writer = RWGltf_CafWriter(TCollection_AsciiString(str(glb_path)), True)
    ok = writer.Perform(doc, meta, Message_ProgressRange())
    if not ok:
        raise ValueError(f"RWGltf_CafWriter failed for {step_path.name}")


def _scene_extent(scene: trimesh.Scene) -> float:
    bounds = scene.bounds
    if bounds is None:
        return 0.0
    return float(np.max(np.asarray(bounds[1], dtype=float) - np.asarray(bounds[0], dtype=float)))


def _match_glb_scale_to_step(step_path: Path, glb_path: Path) -> None:
    """Keep OCC-written GLB previews in the same units as the source STEP.

    Some STEP→GLB writers follow glTF's metre convention even when the source
    STEP is millimetres. The app's CAD workspace uses millimetres, so compare
    the GLB bounds to the STEP tessellation and bake a scale correction when the
    ratio is clearly unit-related.
    """
    try:
        scene = load_scene(glb_path)
        glb_extent = _scene_extent(scene)
        if glb_extent <= 0 or glb_extent >= 1.0:
            return
        step_mesh = import_step_mesh(step_path)
        step_extent = float(np.max(step_mesh.extents))
        if step_extent <= 0:
            return
        ratio = step_extent / glb_extent
        if 100.0 <= ratio <= 10000.0:
            scene.apply_scale(ratio)
            export_scene(scene, glb_path)
            logger.info("Scaled STEP preview GLB %s by %.6g to match source units", glb_path.name, ratio)
    except Exception as exc:  # pragma: no cover - preview scale fix is best-effort
        logger.debug("Could not verify STEP preview scale for %s: %s", glb_path.name, exc)


def _read_glb_json_chunk(path: Path) -> dict[str, Any] | None:
    """Best-effort glTF JSON chunk from a GLB (no full mesh decode)."""
    try:
        data = path.read_bytes()
        if len(data) < 20 or data[:4] != b"glTF":
            return None
        json_len = struct.unpack_from("<I", data, 12)[0]
        start = 20
        end = start + json_len
        if json_len <= 0 or end > len(data):
            return None
        return json.loads(data[start:end])
    except Exception:
        return None


def _glb_preview_stats(path: Path) -> tuple[int, int, int]:
    """Return ``(mesh_count, material_count, color0_primitive_count)``."""
    gltf = _read_glb_json_chunk(path)
    if not gltf:
        return (0, 0, 0)
    meshes = gltf.get("meshes") or []
    materials = gltf.get("materials") or []
    color0 = 0
    for mesh in meshes:
        for prim in mesh.get("primitives") or []:
            attrs = prim.get("attributes") or {}
            if "COLOR_0" in attrs:
                color0 += 1
    return (len(meshes), len(materials), color0)


def jake_viewport_glb_for_stem(project_path: Path, stem: str) -> Path | None:
    """Return Jake CADJS ``.{stem}.step.glb`` when present."""
    jake = project_path / f".{stem}.step.glb"
    return jake if jake.is_file() else None


def prefer_jake_viewport_glb(solid_glb: Path, jake_glb: Path) -> bool:
    """True when the Jake sidecar keeps multi-part materials the shell GLB flattened away.

    Share/preview often points at ``.Model.step.glb`` (per-body STEP materials). The
    product-shell ``Model.glb`` is frequently a single merged mesh with washed vertex
    tints — which makes assemblies look one colour in the main viewport.
    """
    if not jake_glb.is_file():
        return False
    if not solid_glb.is_file():
        return True
    j_meshes, j_mats, _j_c0 = _glb_preview_stats(jake_glb)
    s_meshes, s_mats, _s_c0 = _glb_preview_stats(solid_glb)
    if j_mats >= 2 and s_mats <= 1 and s_meshes <= 2:
        return True
    if j_meshes >= 3 and j_mats >= 2 and s_meshes == 1:
        return True
    return False


def latest_edited_viewer_variant(project_path: Path, stem: str, *, newer_than: Path | None = None) -> Path | None:
    """Return the newest baked paint/texture/edit GLB for a model stem."""
    try:
        timeline = json.loads((project_path / "timeline.json").read_text(encoding="utf-8"))
        entries = timeline.get("entries") or []
        current_index = int(timeline.get("current_index") or 0)
        current = next((e for e in entries if int(e.get("index") or -1) == current_index), None)
        current_filename = Path(str((current or {}).get("filename") or "")).name
        current_path = project_path / current_filename
        if current_path.is_file() and current_path.suffix.lower() == ".glb":
            current_root, current_depth = _edit_variant_depth(current_path.stem)
            if current_depth > 0 and current_root == stem:
                return current_path
    except Exception:
        pass
    candidates = [
        p
        for p in project_path.glob(f"{stem}_edited*.glb")
        if p.is_file() and not p.name.startswith(".")
    ]
    if not candidates:
        return None
    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    if newer_than is not None and newer_than.is_file() and latest.stat().st_mtime < newer_than.stat().st_mtime:
        return None
    return latest


def viewer_filename_for_model(filename: str, project_path: Path) -> str:
    """Pick the file the Three.js viewer should load for a browser tree entry."""
    safe = Path(filename).name
    suffix = Path(safe).suffix.lower()
    stem = Path(safe).stem

    if suffix in STEP_SUFFIXES:
        # Prefer Jake multi-body materials, then solid preview, then face-dumped OCC mesh.
        solid_glb = project_path / f"{stem}.glb"
        faceted_glb = project_path / f"{stem}__faceted.glb"
        edited_glb = latest_edited_viewer_variant(project_path, stem, newer_than=solid_glb)
        if edited_glb is not None:
            return edited_glb.name
        jake_glb = jake_viewport_glb_for_stem(project_path, stem)
        if jake_glb is not None and prefer_jake_viewport_glb(solid_glb, jake_glb):
            return jake_glb.name
        if solid_glb.is_file():
            return solid_glb.name
        if faceted_glb.is_file():
            return faceted_glb.name
        if jake_glb is not None:
            return jake_glb.name
    if suffix in MESH_VIEW_SUFFIXES | {".glb", ".gltf"}:
        # If someone points at *__faceted.glb, prefer the solid sibling when present.
        if "__faceted" in stem.lower():
            solid_stem = re.sub(r"__faceted$", "", stem, flags=re.I)
            solid = project_path / f"{solid_stem}{suffix}"
            if solid.is_file():
                return solid.name
            return safe
        solid = project_path / safe
        edited_glb = latest_edited_viewer_variant(project_path, stem, newer_than=solid)
        if edited_glb is not None:
            return edited_glb.name
        jake_glb = jake_viewport_glb_for_stem(project_path, stem)
        if jake_glb is not None and prefer_jake_viewport_glb(solid, jake_glb):
            return jake_glb.name
        return safe
    return safe


def _load_sim_assembly_parts(project_path: Path) -> dict[str, set[str]]:
    """Map assembly basename → part ids exported as per-link STLs for sim."""
    out: dict[str, set[str]] = {}
    for f in project_path.glob("*.sim.json"):
        if f.name.startswith("_active_"):
            continue
        base = f.name[: -len(".sim.json")]
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        part_ids = {str(p["id"]) for p in (data.get("parts") or []) if p.get("id")}
        if part_ids:
            out[base] = part_ids
    return out


def _cleaned_variant_depth(stem: str) -> tuple[str, int]:
    """Return (root stem, count of trailing ``_cleaned`` suffixes)."""
    base, depth = stem, 0
    suffix = "_cleaned"
    while base.endswith(suffix):
        base = base[: -len(suffix)]
        depth += 1
    return base, depth


def _edit_variant_depth(stem: str) -> tuple[str, int]:
    """Return (root stem, edit depth) for baked mesh edits like ``part_edited``."""
    base = stem
    depth = 0
    while True:
        low = base.lower()
        if low.endswith("_edited"):
            base = base[: -len("_edited")]
            depth += 1
            continue
        marker = "_edited_"
        idx = low.rfind(marker)
        if idx >= 0 and low[idx + len(marker) :].isdigit():
            base = base[:idx]
            depth += 1
            continue
        break
    return base, depth


def _artifact_stem(name: str) -> str:
    """Return the component stem for mesh files and known sidecar artifacts."""
    for suffix in (".program.json", ".sketch.json", ".sim.json", ".mjcf.xml"):
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return Path(name).stem


def _humanize_component_stem(stem: str) -> str:
    value = str(stem or "").strip()
    if not value:
        return "Component"
    value = re.sub(r"^(improved_)?text[-_]?to[-_]?cad[_-]?prompt_", "", value, flags=re.I)
    value = re.sub(r"^generated_", "", value, flags=re.I)
    value = re.sub(r"__part_\d+_", "", value, flags=re.I)
    value = re.sub(r"_part\d+_", "", value, flags=re.I)
    value = value.strip("_-")
    if not value:
        value = str(stem or "component")
    return value[:96]


def _extract_source_model_label(project_path: Path, stem: str) -> str | None:
    source_path = project_path / f"{stem}.py"
    if not source_path.is_file():
        return None
    try:
        source = source_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None
    match = re.search(r'^\s*model_label\s*=\s*["\']([^"\']+)["\']', source, re.M)
    if match:
        return match.group(1).strip()[:120] or None
    return None


def _component_display_label(project_path: Path, stem: str) -> str:
    source_label = _extract_source_model_label(project_path, stem)
    if source_label:
        return source_label
    part_label = re.search(r"__part_\d+_([a-zA-Z0-9_]+)$", stem)
    if part_label:
        return part_label.group(1)[:96]
    compact_part = re.search(r"_part\d+_([a-zA-Z0-9_]+)$", stem)
    if compact_part:
        return compact_part.group(1)[:96]
    return _humanize_component_stem(stem)


def _logical_component_root(stem: str) -> str:
    """Collapse generated component variants to the source component stem.

    Deleting ``foo_edited.glb`` should also remove ``foo.step``,
    ``foo_cleaned.glb``, and ``foo_loops.glb`` so the component cannot reappear
    after the browser tree is rebuilt.
    """
    base = stem
    route_suffixes = ("_loops", "_duct", "_hole", "_extruded", "_pulled", "_mirrored")
    changed = True
    while changed:
        changed = False
        cleaned, clean_depth = _cleaned_variant_depth(base)
        if clean_depth:
            base = cleaned
            changed = True
        edited, edit_depth = _edit_variant_depth(base)
        if edit_depth:
            base = edited
            changed = True
        low = base.lower()
        for suffix in route_suffixes:
            if low.endswith(suffix):
                base = base[: -len(suffix)]
                changed = True
                break
    return base


def _is_sim_part_stem(stem: str, sim_bases: dict[str, set[str]]) -> bool:
    """True when ``stem`` is a per-part sim export (including ``_cleaned`` variants)."""
    for base, part_ids in sim_bases.items():
        if stem == base:
            return False
        prefix = f"{base}_"
        if not stem.startswith(prefix):
            continue
        rest = stem[len(prefix) :]
        while rest.endswith("_cleaned"):
            rest = rest[: -len("_cleaned")]
        if rest in part_ids:
            return True
    return False


def _is_prompt_artifact_stem(stem: str) -> bool:
    """Mesh-edit outputs that should not appear in the browser or drive the viewport."""
    low = stem.lower()
    return any(marker in low for marker in ("_whisk_end", "_whisk", "_generated"))


def _architect_text_to_cad_bases(project_path: Path) -> set[str]:
    """Base stems for Architect text-to-CAD assemblies.

    Older Architect runs could export every build123d child as
    ``<base>__part_...`` or ``<base>_partNN...`` browser files. Those are detail
    artifacts; the main STEP/GLB remains the upstream text-to-cad assembly.
    """
    bases: set[str] = set()
    for path in project_path.glob("*.py"):
        if path.name.startswith("_active_"):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")[:12000].lower()
        except Exception:
            continue
        if (
            "architect_text_to_cad" in text
            or "modular_robot_house" in text
            or "assembled_modular_robot_house" in text
            or ("room_floor" in text and "wall_north" in text)
            or ("architect" in text and "snap" in text and "wall" in text)
        ):
            bases.add(path.stem)
    for brief in project_path.glob("*.brief.md"):
        try:
            text = brief.read_text(encoding="utf-8", errors="ignore")[:12000].lower()
        except Exception:
            continue
        if "architect mode workflow" in text or "modular house" in text:
            bases.add(brief.name[: -len(".brief.md")])
    return bases


def _is_architect_promoted_part_stem(stem: str, architect_bases: set[str]) -> bool:
    for base in architect_bases:
        if stem.startswith(f"{base}__part_"):
            return True
        if re.match(rf"^{re.escape(base)}_part\d+", stem):
            return True
    return False


def _parent_assembly_exists(project_path: Path, base: str) -> bool:
    return any(
        (project_path / f"{base}{ext}").is_file()
        for ext in (".glb", ".gltf", ".step", ".stp", ".stl", ".3mf")
    )


def _is_promoted_detail_part_stem(stem: str, project_path: Path) -> bool:
    """Hide exploded body sidecars when the parent assembly file still exists.

    Covers both naming schemes:
    - ``<base>__part_01_baluster`` (Fusion / scene split)
    - ``<base>_part01`` / ``<base>_part01_2`` (disconnected-body promote)
    """
    match = re.match(r"^(.+)__part_\d+_", stem, re.I)
    if match and _parent_assembly_exists(project_path, match.group(1)):
        return True
    match = re.match(r"^(.+)_part\d+(?:_\d+)?$", stem, re.I)
    if match and _parent_assembly_exists(project_path, match.group(1)):
        return True
    return False


def _body_children_from_part_sidecars(
    project_path: Path,
    *,
    parent_stem: str,
    parent_name: str,
    parent_viewer: str,
) -> list[dict[str, Any]]:
    """Nest ``_partNN`` / ``__part_NN_`` sidecars as Bodies under the parent component."""
    compact = re.compile(rf"^{re.escape(parent_stem)}_part(\d+)(?:_(\d+))?$", re.I)
    detailed = re.compile(rf"^{re.escape(parent_stem)}__part_(\d+)_(.+)$", re.I)
    best: dict[int, tuple[int, Path, str]] = {}
    for path in project_path.glob("*.glb"):
        stem = path.stem
        match = compact.match(stem)
        if match:
            num = int(match.group(1))
            rev = int(match.group(2) or 0)
            label = f"Body {num}"
            prev = best.get(num)
            if prev is None or rev >= prev[0]:
                best[num] = (rev, path, label)
            continue
        match = detailed.match(stem)
        if match:
            num = int(match.group(1))
            label = re.sub(r"_+", " ", match.group(2)).strip() or f"Body {num}"
            prev = best.get(num)
            if prev is None or 0 >= prev[0]:
                best[num] = (0, path, label[:96])
    if len(best) <= 1:
        return []
    children: list[dict[str, Any]] = []
    for idx, num in enumerate(sorted(best)):
        _rev, _path, label = best[num]
        children.append(
            {
                "id": f"{parent_stem}#body:{idx + 1}",
                "name": f"{parent_name}#body:{idx + 1}",
                "filename": parent_name,
                "stem": f"{parent_stem}_body_{idx + 1:02d}",
                "label": label,
                "format": "body",
                "viewer_filename": parent_viewer,
                "source_filename": parent_name,
                "parent_filename": parent_name,
                "body_index": idx,
                "body_name": label,
                "virtual_body": True,
            }
        )
    return children


def _is_jake_topology_sidecar_stem(stem: str) -> bool:
    """Jake cadpy topology sidecar: ``.part.step.glb`` → stem ``.part.step``."""
    return stem.startswith(".") and (stem.endswith(".step") or stem.endswith(".stp"))


def _is_faceted_export_stem(stem: str) -> bool:
    """Mesh-derived ``*__faceted`` STEP/GLB siblings must not appear as components."""
    return "__faceted" in str(stem or "").lower()


def _canonical_assembly_stem(project_path: Path) -> str | None:
    """Newest kernel export that has both program + sim metadata."""
    best: tuple[float, str] | None = None
    for prog in project_path.glob("*.program.json"):
        if prog.name.startswith("_active_"):
            continue
        base = prog.name[: -len(".program.json")]
        if not (project_path / f"{base}.sim.json").is_file():
            continue
        mtime = prog.stat().st_mtime
        if best is None or mtime > best[0]:
            best = (mtime, base)
    return best[1] if best else None


def _viewport_component_stems(project_path: Path, stems: set[str]) -> set[str]:
    """Stems eligible for the design browser — hide sim exports and duplicate cleaned variants."""
    visible = set(stems)
    sim_bases = _load_sim_assembly_parts(project_path)
    architect_bases = _architect_text_to_cad_bases(project_path)

    for stem in list(visible):
        if _is_sim_part_stem(stem, sim_bases):
            visible.discard(stem)

    for stem in list(visible):
        if _is_prompt_artifact_stem(stem):
            visible.discard(stem)

    for stem in list(visible):
        if _is_architect_promoted_part_stem(stem, architect_bases):
            visible.discard(stem)

    for stem in list(visible):
        if _is_promoted_detail_part_stem(stem, project_path):
            visible.discard(stem)

    for stem in list(visible):
        if _is_jake_topology_sidecar_stem(stem):
            visible.discard(stem)

    for stem in list(visible):
        if _is_faceted_export_stem(stem):
            visible.discard(stem)

    canonical = _canonical_assembly_stem(project_path)
    if canonical:
        for stem in list(visible):
            if stem != canonical and stem.endswith("_clean_parametric"):
                visible.discard(stem)

    by_edit_root: dict[str, list[tuple[int, float, str]]] = {}
    for stem in stems:
        root, depth = _edit_variant_depth(stem)
        if depth <= 0:
            continue
        path = next(
            (project_path / f"{stem}{ext}" for ext in (".glb", ".gltf", ".stl", ".obj", ".ply", ".off", ".3mf", ".step", ".stp") if (project_path / f"{stem}{ext}").is_file()),
            None,
        )
        by_edit_root.setdefault(root, []).append((depth, path.stat().st_mtime if path else 0.0, stem))

    for root, variants in by_edit_root.items():
        keep = max(variants, key=lambda item: (item[0], item[1], item[2]))[2]
        visible.discard(root)
        for _, _, stem in variants:
            if stem != keep:
                visible.discard(stem)

    by_root: dict[str, list[tuple[int, str]]] = {}
    for stem in stems:
        root, depth = _cleaned_variant_depth(stem)
        by_root.setdefault(root, []).append((depth, stem))

    for root, variants in by_root.items():
        if len(variants) <= 1:
            continue
        stems_in_group = {s for _, s in variants}
        if root in stems_in_group and (project_path / f"{root}.program.json").is_file():
            keep = root
        elif canonical and canonical in stems_in_group:
            keep = canonical
        else:
            keep = max(variants, key=lambda item: item[0])[1]
        for _, stem in variants:
            if stem != keep:
                visible.discard(stem)

    return visible


def primary_assembly_component(project_path: Path) -> dict[str, Any] | None:
    """Return the main assembly browser entry, if any."""
    canonical = _canonical_assembly_stem(project_path)
    for comp in list_browser_tree(project_path).get("components") or []:
        if canonical and comp.get("stem") == canonical:
            return comp
        if comp.get("primary"):
            return comp
    comps = list_browser_tree(project_path).get("components") or []
    return comps[0] if comps else None


def resolve_mesh_edit_base(project_path: Path, filename: str | None) -> str | None:
    """Prefer the full assembly when a broken prompt derivative is selected as the edit base."""
    if not filename:
        return filename
    stem = Path(filename).stem.lower()
    if "whisk_end" in stem or stem.endswith("_whisk"):
        primary = project_path / "automated_cooking_appliance.glb"
        if primary.is_file():
            return primary.name
    return filename


def is_cooking_appliance_project(project_path: Path) -> bool:
    return (project_path / "automated_cooking_appliance.glb").is_file() or (
        project_path / "automated_cooking_appliance.program.json"
    ).is_file()


def resolve_viewport_filename(project_path: Path, filename: str | None) -> str | None:
    """Map a timeline/file name to the model the viewport should load."""
    if not filename:
        primary = primary_assembly_component(project_path)
        return primary["viewer_filename"] if primary else None

    stem = Path(filename).stem
    sim_bases = _load_sim_assembly_parts(project_path)
    if _is_sim_part_stem(stem, sim_bases):
        primary = primary_assembly_component(project_path)
        return primary["viewer_filename"] if primary else filename

    canonical = _canonical_assembly_stem(project_path)
    if canonical and (
        _is_prompt_artifact_stem(stem)
        or stem.endswith("_clean_parametric")
        or _cleaned_variant_depth(stem)[1] > 0
    ):
        glb = project_path / f"{canonical}.glb"
        if glb.is_file():
            return glb.name

    if (project_path / filename).is_file():
        resolved = viewer_filename_for_model(filename, project_path)
        if canonical and _is_prompt_artifact_stem(stem):
            glb = project_path / f"{canonical}.glb"
            if glb.is_file():
                return glb.name
        return resolved

    primary = primary_assembly_component(project_path)
    return primary["viewer_filename"] if primary else None


def list_browser_tree(project_path: Path) -> dict[str, Any]:
    """Fusion-style browser sections for components, sketches, and wiring."""
    components: list[dict[str, Any]] = []
    sketches: list[dict[str, Any]] = []
    wiring_items: list[dict[str, Any]] = []
    rigging_items: list[dict[str, Any]] = []

    preferred_suffixes = (
        ".step",
        ".stp",
        ".glb",
        ".gltf",
        ".3mf",
        ".stl",
        ".obj",
        ".ply",
        ".off",
    )
    mesh_files = [
        f
        for f in project_path.iterdir()
        if f.is_file()
        and not f.name.startswith("_active_")
        and not f.name.startswith("_export_")
        and f.suffix.lower() != ".dxf"
        and f.suffix.lower() in SUPPORTED_IMPORT | SUPPORTED_EXPORT
    ]
    by_stem: dict[str, list[Path]] = {}
    for f in mesh_files:
        by_stem.setdefault(f.stem, []).append(f)

    viewport_stems = _viewport_component_stems(project_path, set(by_stem))
    sim_bases = _load_sim_assembly_parts(project_path)
    canonical = _canonical_assembly_stem(project_path)

    for stem in sorted(by_stem):
        if stem not in viewport_stems:
            continue
        group = by_stem[stem]
        canonical_file = group[0]
        for ext in preferred_suffixes:
            match = next((f for f in group if f.suffix.lower() == ext), None)
            if match is not None:
                canonical_file = match
                break
        viewer = viewer_filename_for_model(canonical_file.name, project_path)
        is_primary = canonical is not None and stem == canonical
        components.append(
            {
                "id": stem,
                "name": canonical_file.name,
                "stem": stem,
                "label": _component_display_label(project_path, stem),
                "format": canonical_file.suffix.lower().lstrip("."),
                "viewer_filename": viewer,
                "size": canonical_file.stat().st_size,
                "primary": is_primary,
                "auto_load": is_primary,
            }
        )

    # Uploads / demo meshes without a program+sim kernel export still need a primary
    # so the viewport and browser load something instead of looking empty.
    if components and not any(c.get("primary") for c in components):
        def _mtime(entry: dict[str, Any]) -> float:
            path = project_path / str(entry.get("name") or "")
            try:
                return path.stat().st_mtime if path.is_file() else 0.0
            except OSError:
                return 0.0

        newest = max(components, key=_mtime)
        newest["primary"] = True
        newest["auto_load"] = True

    # Nest exploded body sidecars under their parent component as Bodies.
    for comp in components:
        children = _body_children_from_part_sidecars(
            project_path,
            parent_stem=str(comp.get("stem") or ""),
            parent_name=str(comp.get("name") or ""),
            parent_viewer=str(comp.get("viewer_filename") or comp.get("name") or ""),
        )
        if children:
            comp["children_label"] = "Bodies"
            comp["children"] = children

    for f in sorted(project_path.glob("*.program.json")):
        if not f.is_file() or f.name.startswith("_active_"):
            continue
        base = f.name[: -len(".program.json")]
        sketches.append(
            {
                "id": f.stem,
                "name": f.name,
                "stem": base,
                "format": "program",
                "size": f.stat().st_size,
            }
        )

    for f in sorted(project_path.glob("*.sketch.json")):
        if not f.is_file() or f.name.startswith("_active_"):
            continue
        base = f.name[: -len(".sketch.json")]
        label = base.replace("_", " ")
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            label = data.get("name") or label
        except Exception:
            pass
        sketches.append(
            {
                "id": base,
                "name": label,
                "stem": base,
                "format": "sketch",
                "filename": f.name,
                "size": f.stat().st_size,
            }
        )

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

    drawings: list[dict[str, Any]] = []
    for f in sorted(project_path.glob("*.dxf")):
        if not f.is_file() or f.name.startswith("_active_") or f.name.startswith("_export_") or _is_internal_dxf_sidecar(f.name):
            continue
        drawings.append(
            {
                "id": f.stem,
                "name": f.name,
                "stem": f.stem,
                "format": "dxf",
                "size": f.stat().st_size,
            }
        )

    rigging_path = project_path / "rigging.json"
    if rigging_path.is_file():
        count = 0
        name = "Rig"
        try:
            data = json.loads(rigging_path.read_text(encoding="utf-8"))
            count = len(data.get("bones") or [])
            name = data.get("name", "Rig")
        except Exception:
            pass
        rigging_items.append(
            {
                "id": "rigging",
                "name": name,
                "format": "rigging",
                "bone_count": count,
                "size": rigging_path.stat().st_size,
            }
        )

    robots: list[dict[str, Any]] = []
    for f in sorted(project_path.iterdir()):
        if not f.is_file() or f.suffix.lower() not in SUPPORTED_ROBOT:
            continue
        robots.append(
            {
                "id": f.stem,
                "name": f.name,
                "stem": f.stem,
                "format": f.suffix.lower().lstrip("."),
                "size": f.stat().st_size,
            }
        )

    return {
        "components": components,
        "sketches": sketches,
        "wiring": wiring_items,
        "drawings": drawings,
        "references": list_reference_files(project_path),
        "renders": list_render_files(project_path),
        "rigging": rigging_items,
        "robots": robots,
    }


def load_mesh(path: Path) -> trimesh.Trimesh:
    suffix = path.suffix.lower()
    if suffix in STEP_SUFFIXES:
        return repair_mesh(import_step_mesh(path))
    if suffix in IGES_SUFFIXES:
        return repair_mesh(import_iges_mesh(path))
    if suffix in BREP_SUFFIXES:
        return repair_mesh(import_brep_mesh(path))
    loaded = trimesh.load(path, force="mesh")
    if isinstance(loaded, trimesh.Scene):
        loaded = loaded.dump(concatenate=True)
    if not isinstance(loaded, trimesh.Trimesh):
        raise ValueError(f"Could not load mesh from {path}")
    return repair_mesh(loaded)


def load_scene(path: Path) -> trimesh.Scene:
    """Load a mesh/GLB/3MF as a scene, preserving separate named objects."""
    loaded = trimesh.load(path, force="scene")
    if isinstance(loaded, trimesh.Trimesh):
        scene = trimesh.Scene()
        scene.add_geometry(loaded, geom_name=path.stem, node_name=path.stem)
        return scene
    if not isinstance(loaded, trimesh.Scene):
        raise ValueError(f"Could not load scene from {path}")
    return loaded


def export_scene(scene: trimesh.Scene, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".3mf":
        return export_scene_3mf(scene, path)
    scene.export(str(path), file_type=path.suffix.lower().lstrip("."))
    return path


def _xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _fmt_float(value: float) -> str:
    v = float(value)
    if not math.isfinite(v):
        raise ValueError(f"3MF coordinate must be finite, got {value!r}")
    return f"{v:.9g}"


def _safe_object_name(value: Any, fallback: str) -> str:
    text = " ".join(str(value or "").split())
    return text[:120] or fallback


def _prepare_mesh_for_3mf(raw_mesh: trimesh.Trimesh) -> trimesh.Trimesh | None:
    """Repair, scale to millimeters, weld, and seat on the Z=0 build plate."""
    if not isinstance(raw_mesh, trimesh.Trimesh) or raw_mesh.is_empty:
        return None
    mesh = repair_mesh(raw_mesh.copy())
    if not mesh_uses_millimeters(mesh):
        mesh.apply_scale(1000.0)
    try:
        mesh.update_faces(mesh.nondegenerate_faces())
    except AttributeError:
        mesh.remove_degenerate_faces()
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()
    mesh.fix_normals()
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        return None
    return mesh


def _seat_meshes_on_build_plate(items: list[tuple[str, trimesh.Trimesh]]) -> list[tuple[str, trimesh.Trimesh]]:
    """Center XY and drop the combined assembly onto Z=0 so slicers place it on the bed."""
    if not items:
        return items
    mins = []
    maxs = []
    for _, mesh in items:
        bounds = np.asarray(mesh.bounds, dtype=float)
        mins.append(bounds[0])
        maxs.append(bounds[1])
    lo = np.min(np.vstack(mins), axis=0)
    hi = np.max(np.vstack(maxs), axis=0)
    shift = np.array(
        [
            -0.5 * (lo[0] + hi[0]),
            -0.5 * (lo[1] + hi[1]),
            -float(lo[2]),
        ],
        dtype=float,
    )
    if not np.any(np.abs(shift) > 1e-9):
        return items
    seated: list[tuple[str, trimesh.Trimesh]] = []
    for name, mesh in items:
        copy = mesh.copy()
        copy.apply_translation(shift)
        seated.append((name, copy))
    return seated


def _meshes_from_scene(scene: trimesh.Scene) -> list[tuple[str, trimesh.Trimesh]]:
    """Extract world-space meshes from a scene graph (preserves assembly transforms)."""
    items: list[tuple[str, trimesh.Trimesh]] = []
    try:
        for node_name in scene.graph.nodes_geometry:
            transform, geom_name = scene.graph.get(node_name)
            geom = scene.geometry.get(geom_name)
            if not isinstance(geom, trimesh.Trimesh):
                continue
            mesh = geom.copy()
            if transform is not None:
                mesh.apply_transform(np.asarray(transform, dtype=float))
            label = _safe_object_name(node_name or geom_name, f"part_{len(items) + 1}")
            mesh.metadata["node"] = label
            mesh.metadata["name"] = label
            items.append((label, mesh))
    except Exception as exc:
        logger.debug("scene graph 3MF extraction failed, falling back to dump: %s", exc)
    if items:
        return items
    for idx, raw in enumerate(scene.dump(concatenate=False)):
        if isinstance(raw, trimesh.Trimesh):
            label = _safe_object_name(
                raw.metadata.get("node") or raw.metadata.get("name"),
                f"part_{idx + 1}",
            )
            items.append((label, raw))
    return items


def _append_3mf_mesh_object(
    resources: ET.Element,
    build: ET.Element,
    *,
    object_id: int,
    name: str,
    mesh: trimesh.Trimesh,
) -> None:
    obj_attrs = {
        "id": str(object_id),
        "type": "model",
        "name": name,
        f"{{{THREEMF_PRODUCTION_NS}}}UUID": str(uuid.uuid4()),
    }
    obj = ET.SubElement(resources, f"{{{THREEMF_CORE_NS}}}object", obj_attrs)
    mesh_el = ET.SubElement(obj, f"{{{THREEMF_CORE_NS}}}mesh")
    verts_el = ET.SubElement(mesh_el, f"{{{THREEMF_CORE_NS}}}vertices")
    for vertex in np.asarray(mesh.vertices, dtype=float):
        ET.SubElement(
            verts_el,
            f"{{{THREEMF_CORE_NS}}}vertex",
            {
                "x": _fmt_float(vertex[0]),
                "y": _fmt_float(vertex[1]),
                "z": _fmt_float(vertex[2]),
            },
        )
    tris_el = ET.SubElement(mesh_el, f"{{{THREEMF_CORE_NS}}}triangles")
    for face in np.asarray(mesh.faces, dtype=int):
        ET.SubElement(
            tris_el,
            f"{{{THREEMF_CORE_NS}}}triangle",
            {
                "v1": str(int(face[0])),
                "v2": str(int(face[1])),
                "v3": str(int(face[2])),
            },
        )
    ET.SubElement(
        build,
        f"{{{THREEMF_CORE_NS}}}item",
        {
            "objectid": str(object_id),
            "transform": THREEMF_IDENTITY_TRANSFORM,
            "partnumber": name,
            f"{{{THREEMF_PRODUCTION_NS}}}UUID": str(uuid.uuid4()),
        },
    )


def export_scene_3mf(scene: trimesh.Scene, path: Path) -> Path:
    """Write a mesh 3MF (mm units) compatible with Bambu Studio and other slicers."""
    scene_items = _meshes_from_scene(scene)
    if not scene_items:
        raise ValueError("no geometry to export to 3MF")

    path.parent.mkdir(parents=True, exist_ok=True)
    model = ET.Element(
        f"{{{THREEMF_CORE_NS}}}model",
        {
            "unit": "millimeter",
            "{http://www.w3.org/XML/1998/namespace}lang": "en-US",
        },
    )
    ET.SubElement(model, f"{{{THREEMF_CORE_NS}}}metadata", {"name": "Application"}).text = "Render3D"
    resources = ET.SubElement(model, f"{{{THREEMF_CORE_NS}}}resources")
    build = ET.SubElement(
        model,
        f"{{{THREEMF_CORE_NS}}}build",
        {f"{{{THREEMF_PRODUCTION_NS}}}UUID": str(uuid.uuid4())},
    )

    object_id = 1
    exported = 0
    prepared: list[tuple[str, trimesh.Trimesh]] = []
    for name, raw_mesh in scene_items:
        mesh = _prepare_mesh_for_3mf(raw_mesh)
        if mesh is None:
            continue
        prepared.append((name, mesh))
    prepared = _seat_meshes_on_build_plate(prepared)
    for name, mesh in prepared:
        _append_3mf_mesh_object(
            resources,
            build,
            object_id=object_id,
            name=name,
            mesh=mesh,
        )
        object_id += 1
        exported += 1

    if exported == 0:
        raise ValueError("no exportable geometry for 3MF")

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", _3MF_CONTENT_TYPES_XML)
        zf.writestr("_rels/.rels", _3MF_RELS_XML)
        zf.writestr("3D/3dmodel.model", _xml_bytes(model))
    return path


def _bake_face_colors_to_vertices(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Assign vertex colors from face_colors without scipy (needed for GLB export)."""
    fc = _snapshot_face_colors(mesh)
    if fc is None:
        return mesh
    m = mesh_copy(mesh)
    n = len(m.vertices)
    accum = np.zeros((n, 4), dtype=np.float64)
    counts = np.zeros(n, dtype=np.float64)
    for fi, face in enumerate(m.faces):
        for vi in face:
            accum[vi] += fc[fi]
            counts[vi] += 1.0
    mask = counts > 0
    vertex_rgba = np.tile(np.array([196, 196, 196, 255], dtype=np.uint8), (n, 1))
    if np.any(mask):
        blended = (accum[mask] / counts[mask, None]).astype(np.uint8)
        vertex_rgba[mask] = blended
    m.visual.vertex_colors = vertex_rgba
    return m


def _palette_color_for_name(name: str | None) -> np.ndarray:
    text = str(name or "part")
    idx = sum(ord(c) for c in text) % len(DEFAULT_APPEARANCE_PALETTE)
    return DEFAULT_APPEARANCE_PALETTE[idx].copy()


def _ensure_default_appearance(mesh: trimesh.Trimesh, *, seed: str | None = None) -> trimesh.Trimesh:
    """Give otherwise grey/uncoloured generated meshes a stable Onshape-like colour."""
    colors = _snapshot_face_colors(mesh)
    if colors is not None and not _colors_are_default_grey(colors):
        return mesh
    m = mesh_copy(mesh)
    if len(m.faces):
        m.visual.face_colors = np.tile(_palette_color_for_name(seed), (len(m.faces), 1))
    return m


def _prompt_appearance_palette(prompt: str, seed: str | None = None) -> list[np.ndarray]:
    p = (prompt or "").lower()
    if any(word in p for word in ("coke", "cola", "soda", "pepsi", "sprite", "fanta", "pet bottle", "plastic bottle")):
        return [
            np.array([212, 232, 240, 235], dtype=np.uint8),  # clear PET body
            np.array([196, 30, 58, 255], dtype=np.uint8),    # red cap/label
            np.array([255, 255, 255, 220], dtype=np.uint8),  # label band
            np.array([28, 28, 32, 255], dtype=np.uint8),     # dark base ring
        ]
    if any(word in p for word in ("sunglass", "glasses", "eyewear", "lens", "wayfarer")):
        return [
            np.array([18, 20, 24, 255], dtype=np.uint8),
            np.array([44, 86, 118, 190], dtype=np.uint8),
            np.array([204, 216, 224, 255], dtype=np.uint8),
            np.array([232, 226, 210, 235], dtype=np.uint8),
        ]
    if any(word in p for word in ("circuit", "pcb", "arduino", "electronics", "sensor", "wiring", "driver")):
        return [
            np.array([18, 112, 72, 255], dtype=np.uint8),
            np.array([30, 34, 42, 255], dtype=np.uint8),
            np.array([196, 196, 184, 255], dtype=np.uint8),
            np.array([218, 70, 54, 255], dtype=np.uint8),
            np.array([54, 132, 218, 255], dtype=np.uint8),
        ]
    if any(word in p for word in ("robot", "mechanical", "bracket", "clamp", "mount", "arm", "gear")):
        return [
            np.array([78, 92, 108, 255], dtype=np.uint8),
            np.array([36, 42, 50, 255], dtype=np.uint8),
            np.array([176, 184, 192, 255], dtype=np.uint8),
            np.array([88, 166, 255, 255], dtype=np.uint8),
        ]
    if any(word in p for word in ("dxf", "drawing", "blueprint", "laser", "cut", "flat pattern")):
        return [
            np.array([88, 166, 255, 255], dtype=np.uint8),
            np.array([48, 54, 61, 255], dtype=np.uint8),
            np.array([196, 196, 196, 255], dtype=np.uint8),
        ]
    base = _palette_color_for_name(seed)
    accent = np.array(
        [max(0, int(base[0]) - 42), max(0, int(base[1]) - 42), max(0, int(base[2]) - 42), 255],
        dtype=np.uint8,
    )
    highlight = np.array(
        [min(255, int(base[0]) + 48), min(255, int(base[1]) + 48), min(255, int(base[2]) + 48), 255],
        dtype=np.uint8,
    )
    return [base, accent, highlight]


def apply_prompt_appearance(mesh: trimesh.Trimesh, prompt: str, *, seed: str | None = None) -> trimesh.Trimesh:
    """Best-effort multi-color fallback for uncoloured generated preview meshes."""
    colors = _snapshot_face_colors(mesh)
    if colors is not None and not _colors_are_default_grey(colors):
        return mesh
    m = mesh_copy(mesh)
    if not len(m.faces):
        return m
    palette = _prompt_appearance_palette(prompt, seed=seed)
    face_colors = np.tile(palette[0], (len(m.faces), 1))
    try:
        normals = np.asarray(m.face_normals, dtype=float)
        centers = np.asarray(m.triangles_center, dtype=float)
        extents = np.asarray(m.extents, dtype=float)
        bounds = np.asarray(m.bounds, dtype=float)
        dominant_axis = int(np.argmax(np.maximum(extents, 1e-9)))
        if len(palette) > 1:
            side_mask = np.abs(normals[:, dominant_axis]) > 0.72
            face_colors[side_mask] = palette[1 % len(palette)]
        if len(palette) > 2:
            z = centers[:, 2]
            top_cut = bounds[0, 2] + extents[2] * 0.62 if extents.shape[0] >= 3 else np.inf
            top_mask = (z >= top_cut) & (np.abs(normals[:, 2]) > 0.35)
            face_colors[top_mask] = palette[2 % len(palette)]
        if len(palette) > 3 and centers.shape[1] >= 2:
            y = centers[:, 1]
            band = y >= (bounds[0, 1] + extents[1] * 0.55)
            face_colors[band & (np.abs(normals[:, 1]) > 0.35)] = palette[3 % len(palette)]
    except Exception:
        pass
    m.visual.face_colors = face_colors
    return m


def apply_prompt_appearance_to_file(path: Path, prompt: str, *, seed: str | None = None) -> bool:
    """Apply fallback prompt-aware colors to an uncolored GLB/STL/mesh preview."""
    if not path.is_file() or path.suffix.lower() not in {".glb", ".gltf", ".stl", ".obj", ".ply", ".off"}:
        return False
    try:
        # Prefer Jake-style per-part colours on hierarchical assembly GLBs.
        if path.suffix.lower() in {".glb", ".gltf"} and colorize_assembly_glb_parts(path):
            return True
        mesh = load_mesh(path)
        styled = apply_prompt_appearance(mesh, prompt, seed=seed or path.stem)
        colors = _snapshot_face_colors(styled)
        original = _snapshot_face_colors(mesh)
        if colors is None or (original is not None and not _colors_are_default_grey(original)):
            return False
        export_mesh(styled, path)
        return True
    except Exception as exc:
        logger.warning("Could not apply generated appearance to %s: %s", path.name, exc)
        return False


# Jake CAD Viewer / hero assembly palette (distinct per occurrence).
JAKE_ASSEMBLY_PART_PALETTE: list[tuple[float, float, float, float]] = [
    (0.47, 0.68, 0.91, 1.0),  # blue
    (0.56, 0.82, 0.50, 1.0),  # green
    (0.94, 0.76, 0.35, 1.0),  # yellow
    (0.91, 0.54, 0.45, 1.0),  # coral
    (0.72, 0.61, 0.91, 1.0),  # purple
    (0.42, 0.78, 0.78, 1.0),  # teal
    (0.84, 0.63, 0.42, 1.0),  # tan
    (0.78, 0.82, 0.85, 1.0),  # light steel
    (0.22, 0.25, 0.29, 1.0),  # dark
    (0.12, 0.66, 0.92, 1.0),  # bright blue
]


def _rgba_is_neutral_grey(rgba: Sequence[float] | None, *, tol: float = 0.045) -> bool:
    if not rgba or len(rgba) < 3:
        return True
    r, g, b = float(rgba[0]), float(rgba[1]), float(rgba[2])
    # cadpy DEFAULT_MATERIAL ≈ (0.47, 0.55, 0.62) or flat 184/255 greys
    chroma = max(r, g, b) - min(r, g, b)
    avg = (r + g + b) / 3.0
    if chroma < tol and 0.35 <= avg <= 0.85:
        return True
    # Explicit cadpy default-ish steel blue-grey
    if abs(r - 0.468) < 0.08 and abs(g - 0.552) < 0.08 and abs(b - 0.617) < 0.08:
        return True
    return False


def colorize_assembly_glb_parts(path: Path) -> bool:
    """Assign distinct Jake-like part colours to hierarchical GLB nodes when monochrome.

    Jake's hero planetary GLB stores a different ``baseColorFactor`` per occurrence.
    Generated assemblies often export every node as cadpy DEFAULT_MATERIAL grey;
    this restores multi-part colouring without flattening the scene.
    """
    if not path.is_file() or path.suffix.lower() not in {".glb", ".gltf"}:
        return False
    try:
        scene = trimesh.load(path, force="scene")
    except Exception as exc:
        logger.warning("Could not open GLB for part colouring (%s): %s", path.name, exc)
        return False
    if not isinstance(scene, trimesh.Scene) or len(scene.geometry) < 2:
        return False

    def geom_rgba(geom) -> tuple[float, float, float, float] | None:
        mat = getattr(getattr(geom, "visual", None), "material", None)
        factor = getattr(mat, "baseColorFactor", None) if mat is not None else None
        if factor is None:
            main = getattr(getattr(geom, "visual", None), "main_color", None)
            if main is None:
                return None
            arr = np.asarray(main, dtype=float).reshape(-1)
            if arr.size < 3:
                return None
            scale = 255.0 if arr.max() > 1.5 else 1.0
            return (float(arr[0] / scale), float(arr[1] / scale), float(arr[2] / scale), float(arr[3] / scale) if arr.size > 3 else 1.0)
        arr = np.asarray(factor, dtype=float).reshape(-1)
        if arr.size < 3:
            return None
        scale = 255.0 if arr.max() > 1.5 else 1.0
        return (float(arr[0] / scale), float(arr[1] / scale), float(arr[2] / scale), float(arr[3] / scale) if arr.size > 3 else 1.0)

    colors = [geom_rgba(g) for g in scene.geometry.values()]
    meaningful = [c for c in colors if c is not None and not _rgba_is_neutral_grey(c)]
    if len(meaningful) >= 2:
        return False  # already Jake/Onshape-coloured

    try:
        from trimesh.visual.material import PBRMaterial, SimpleMaterial
    except Exception:
        PBRMaterial = None  # type: ignore
        SimpleMaterial = None  # type: ignore

    for idx, (name, geom) in enumerate(scene.geometry.items()):
        rgba = JAKE_ASSEMBLY_PART_PALETTE[idx % len(JAKE_ASSEMBLY_PART_PALETTE)]
        rgba_u8 = np.array([int(round(c * 255)) for c in rgba], dtype=np.uint8)
        visual = getattr(geom, "visual", None)
        if visual is None:
            continue
        mat = getattr(visual, "material", None)
        if PBRMaterial is not None and (mat is None or mat.__class__.__name__ in {"PBRMaterial", "SimpleMaterial"}):
            try:
                visual.material = PBRMaterial(baseColorFactor=np.array(rgba, dtype=np.float64))
            except Exception:
                if SimpleMaterial is not None:
                    visual.material = SimpleMaterial(diffuse=rgba_u8)
        elif hasattr(visual, "face_colors") and getattr(geom, "faces", None) is not None and len(geom.faces):
            visual.face_colors = np.tile(rgba_u8, (len(geom.faces), 1))
        else:
            try:
                visual.material = PBRMaterial(baseColorFactor=np.array(rgba, dtype=np.float64)) if PBRMaterial else mat
            except Exception:
                continue

    try:
        scene.export(path, file_type="glb")
        return True
    except Exception as exc:
        logger.warning("Could not save colourized GLB (%s): %s", path.name, exc)
        return False


def export_mesh(mesh: trimesh.Trimesh, path: Path) -> Path:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXPORT:
        path = path.with_suffix(".glb")
        suffix = ".glb"
    out = _ensure_default_appearance(mesh, seed=path.stem) if suffix in {".glb", ".gltf", ".3mf"} else mesh
    if suffix == ".3mf":
        scene = trimesh.Scene()
        scene.add_geometry(out, geom_name=path.stem, node_name=path.stem)
        return export_scene_3mf(scene, path)
    if suffix in {".glb", ".gltf"} and _snapshot_face_colors(out) is not None:
        out = _bake_face_colors_to_vertices(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.export(path)
    return path


def split_scene_components_to_glbs(
    viewer_path: Path,
    project_path: Path,
    *,
    base_stem: str | None = None,
    max_parts: int = 64,
) -> list[str]:
    """Export each named GLB scene component as ``{base}__part_NN_slug.glb``.

    Used by Fusion / Autodesk import when ``import_bodies`` is requested. Returns
    an empty list when the viewer has only one body (nothing useful to split).
    """
    viewer_path = Path(viewer_path)
    project_path = Path(project_path)
    raw_base = str(base_stem or viewer_path.stem or "component")
    base = re.sub(r"[^\w\-]+", "_", raw_base).strip("_") or "component"
    base = base[:80]
    if not viewer_path.is_file():
        raise FileNotFoundError(f"Viewer GLB missing: {viewer_path.name}")

    scene = load_scene(viewer_path)
    parts = _meshes_from_scene(scene)
    if len(parts) <= 1:
        return []

    for old in project_path.glob(f"{base}__part_*.glb"):
        try:
            old.unlink(missing_ok=True)
        except OSError:
            pass

    outputs: list[str] = []
    used: set[str] = set()
    for idx, (label, mesh) in enumerate(parts[: max(1, int(max_parts))], start=1):
        slug = re.sub(r"[^\w\-]+", "_", str(label or "").lower()).strip("_")[:48] or f"part_{idx:02d}"
        if slug in used:
            slug = f"{slug}_{idx:02d}"
        used.add(slug)
        out_name = f"{base}__part_{idx:02d}_{slug}.glb"
        export_mesh(mesh, project_path / out_name)
        outputs.append(out_name)
    return outputs


def export_mesh_step(mesh: trimesh.Trimesh, path: Path) -> Path:
    """Write a faceted (mesh-derived) STEP — Fusion solid cuts will NOT work reliably.

    Callers must use a `__faceted.step` filename so this never overwrites native
    B-rep STEP from text-to-cad / build123d (`scripts/step`).
    """
    path = Path(path)
    if path.suffix.lower() in STEP_SUFFIXES and "__faceted" not in path.stem.lower():
        # Safety: redirect accidental clobber of native model.step → model__faceted.step
        path = path.with_name(faceted_step_name(path.stem))
        logger.warning("Redirecting mesh STEP export to %s to protect native B-rep", path.name)

    import tempfile

    from OCP.IFSelect import IFSelect_ReturnStatus
    from OCP.STEPControl import STEPControl_StepModelType, STEPControl_Writer
    from OCP.StlAPI import StlAPI_Reader
    from OCP.TopoDS import TopoDS_Shape

    with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        export_mesh(mesh, tmp_path)
        reader = StlAPI_Reader()
        shape = TopoDS_Shape()
        if not reader.Read(shape, str(tmp_path)):
            raise ValueError("Could not tessellate mesh for STEP export")
        status = None
        try:
            from OCP.STEPCAFControl import STEPCAFControl_Writer
            from OCP.TCollection import TCollection_ExtendedString
            from OCP.TDocStd import TDocStd_Document
            from OCP.XCAFDoc import XCAFDoc_ColorType, XCAFDoc_DocumentTool
            from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB

            color = _dominant_rgba(mesh) or _palette_color_for_name(path.stem)
            doc = TDocStd_Document(TCollection_ExtendedString("Render3D"))
            shape_tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
            color_tool = XCAFDoc_DocumentTool.ColorTool(doc.Main())
            label = shape_tool.AddShape(shape, False)
            color_tool.SetColor(
                label,
                Quantity_Color(float(color[0]) / 255.0, float(color[1]) / 255.0, float(color[2]) / 255.0, Quantity_TOC_RGB),
                XCAFDoc_ColorType.XCAFDoc_ColorSurf,
            )
            writer = STEPCAFControl_Writer()
            writer.Transfer(doc, STEPControl_StepModelType.STEPControl_AsIs)
            status = writer.Write(str(path))
        except Exception as exc:
            logger.debug("Colored STEP export fallback for %s: %s", path.name, exc)
            writer = STEPControl_Writer()
            writer.Transfer(shape, STEPControl_StepModelType.STEPControl_AsIs)
            status = writer.Write(str(path))
        if status != IFSelect_ReturnStatus.IFSelect_RetDone:
            raise ValueError(f"STEP export failed ({status})")
    finally:
        tmp_path.unlink(missing_ok=True)
    return path


def _legacy_3mf_needs_regeneration(path: Path) -> bool:
    """True when an on-disk 3MF predates the Bambu-compatible mesh writer."""
    try:
        with zipfile.ZipFile(path) as zf:
            if "3D/3dmodel.model" not in zf.namelist():
                return True
            rels = zf.read("_rels/.rels").decode("utf-8", errors="replace")
            if "ns0:" in rels or "xmlns:ns0" in rels:
                return True
            root = ET.fromstring(zf.read("3D/3dmodel.model"))
        items = root.findall(f".//{{{THREEMF_CORE_NS}}}item")
        if not items:
            return True
        if not any(item.get("transform") for item in items):
            return True
        tris = root.findall(f".//{{{THREEMF_CORE_NS}}}triangle")
        if not tris:
            return True
        first = tris[0]
        if first.get("p2") is not None or first.get("p3") is not None:
            return True
        objs = root.findall(f".//{{{THREEMF_CORE_NS}}}object[@type='model']")
        if objs and objs[0].get("type") != "model":
            return True
    except Exception:
        return True
    return False


def _export_is_stale(src_mtime: float, dest: Path, fmt: str) -> bool:
    if not dest.is_file():
        return True
    if fmt == "3mf" and _legacy_3mf_needs_regeneration(dest):
        return True
    return dest.stat().st_mtime < src_mtime


def ensure_mesh_exports(project_path: Path, filename: str, *, missing_only: bool = False) -> None:
    """Generate STL / 3MF / faceted-STEP siblings for a mesh model when missing or stale.

    Native B-rep `{stem}.step` from text-to-cad is never overwritten. Mesh→STEP
    always lands in `{stem}__faceted.step` so Fusion push can keep using solid STEP.
    """
    safe = Path(filename).name
    src = project_path / safe
    if not src.is_file():
        return
    if src.suffix.lower() not in SUPPORTED_IMPORT:
        return

    stem = src.stem
    src_mtime = src.stat().st_mtime
    mesh: trimesh.Trimesh | None = None
    src_is_step = src.suffix.lower() in STEP_SUFFIXES

    for fmt in MESH_DERIVED_EXPORTS:
        if fmt == "step" and src_is_step:
            continue
        if fmt == "step":
            dest = project_path / faceted_step_name(stem)
            native = project_path / f"{stem}.step"
            # Never regenerate mesh STEP on top of a real B-rep solid.
            if native.is_file() and (
                _has_native_step_provenance(project_path, stem) or is_editable_brep_step(native)
            ):
                # Optionally still refresh the explicit faceted sibling below.
                pass
            elif native.is_file() and classify_step_file_kind(native) == "faceted_mesh":
                # Legacy clobber: move faceted content out of the way once.
                try:
                    if not dest.is_file() or dest.stat().st_mtime < native.stat().st_mtime:
                        native.replace(dest)
                        logger.info("Moved mesh-derived %s → %s to protect Fusion B-rep path", native.name, dest.name)
                except OSError as exc:
                    logger.warning("Could not relocate faceted STEP %s: %s", native.name, exc)
        else:
            dest = project_path / f"{stem}.{fmt}"

        if missing_only and dest.is_file() and not _export_is_stale(src_mtime, dest, fmt):
            continue
        if not missing_only and dest.is_file() and not _export_is_stale(src_mtime, dest, fmt):
            continue
        try:
            if mesh is None:
                mesh = load_mesh(src)
            if fmt == "step":
                export_mesh_step(mesh, dest)
            else:
                export_mesh(mesh, dest)
            logger.info("Generated %s export for %s", fmt.upper(), safe)
        except Exception as exc:
            logger.warning("Could not generate %s for %s: %s", fmt, safe, exc)


def _snapshot_face_colors(mesh: trimesh.Trimesh) -> np.ndarray | None:
    try:
        fc = getattr(mesh.visual, "face_colors", None)
        if fc is not None and len(fc) == len(mesh.faces):
            return np.asarray(fc, dtype=np.uint8).copy()
    except Exception:
        pass
    try:
        vc = getattr(mesh.visual, "vertex_colors", None)
        if vc is not None and len(vc) == len(mesh.vertices) and len(mesh.faces):
            vc = np.asarray(vc, dtype=np.uint8)
            return vc[np.asarray(mesh.faces, dtype=int)].mean(axis=1).astype(np.uint8)
    except Exception:
        pass
    try:
        material = getattr(mesh.visual, "material", None)
        color = getattr(material, "main_color", None)
        if color is None:
            color = getattr(material, "diffuse", None)
        if color is not None and len(mesh.faces):
            rgba = np.asarray(color, dtype=np.uint8)
            if rgba.shape[0] >= 3:
                if rgba.shape[0] == 3:
                    rgba = np.asarray([rgba[0], rgba[1], rgba[2], 255], dtype=np.uint8)
                return np.tile(rgba[:4], (len(mesh.faces), 1))
    except Exception:
        pass
    return None


def _colors_are_default_grey(colors: np.ndarray) -> bool:
    try:
        arr = np.asarray(colors, dtype=np.float64)
        if arr.size == 0:
            return True
        rgb = arr[:, :3] if arr.ndim == 2 else arr[:3][None, :]
        mean = rgb.mean(axis=0)
        spread = float(np.abs(rgb - mean).max())
        greyish = float(np.max(mean) - np.min(mean)) < 8.0
        defaultish = 90.0 <= float(mean.mean()) <= 220.0
        return greyish and defaultish and spread < 4.0
    except Exception:
        return False


def _dominant_rgba(mesh: trimesh.Trimesh) -> np.ndarray | None:
    colors = _snapshot_face_colors(mesh)
    if colors is None or len(colors) == 0:
        return None
    rgb = np.asarray(colors[:, :4], dtype=np.float64).mean(axis=0)
    rgb[3] = 255
    return rgb.astype(np.uint8)


def mesh_copy(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Copy geometry without pulling scipy via ColorVisual.vertex_colors."""
    colors = _snapshot_face_colors(mesh)
    m = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices, dtype=float),
        faces=np.asarray(mesh.faces, dtype=int),
        process=False,
    )
    if colors is not None:
        m.visual.face_colors = colors
    return m


def mesh_uses_millimeters(mesh: trimesh.Trimesh) -> bool:
    """Heuristic: kernel/exported parts are mm; legacy trimesh primitives are meters."""
    try:
        return float(max(mesh.extents)) >= 1.0
    except Exception:
        return False


def length_from_mm(mesh: trimesh.Trimesh, mm: float) -> float:
    """Convert a millimeter dimension to the mesh's native length units."""
    return float(mm) if mesh_uses_millimeters(mesh) else float(mm) / 1000.0


def repair_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Best-effort cleanup so booleans are less likely to fail."""
    m = mesh_copy(mesh)
    try:
        m.remove_duplicate_faces()
        m.remove_unreferenced_vertices()
        if hasattr(m, "fill_holes"):
            m.fill_holes()
        m.fix_normals()
        m.process(validate=True)
    except Exception as exc:
        logger.debug("mesh repair partial: %s", exc)
    return m


def place_absolute(
    mesh: trimesh.Trimesh,
    translation_mm: list[float] | None = None,
    rotation_deg: list[float] | None = None,
) -> trimesh.Trimesh:
    """Seat a part at an absolute world pose (mm, Z-up): normalize to mm, recenter
    the bbox to the origin, rotate, then translate to the target. Deterministic
    regardless of the file's original baked position/units."""
    m = mesh_copy(mesh)
    if not mesh_uses_millimeters(m):
        m.apply_scale(1000.0)
    center = (m.bounds[0] + m.bounds[1]) / 2.0
    m.apply_translation(-center)
    if rotation_deg:
        r = np.radians([rotation_deg[0], rotation_deg[1], rotation_deg[2]])
        m.apply_transform(trimesh.transformations.euler_matrix(r[0], r[1], r[2], axes="sxyz"))
    if translation_mm:
        m.apply_translation([float(translation_mm[0]), float(translation_mm[1]), float(translation_mm[2])])
    return m


def seat_component_mesh(
    mesh: trimesh.Trimesh,
    *,
    mount: str,
    cx: float,
    cy: float,
    surface_z: float,
) -> trimesh.Trimesh:
    """Seat a real component into a generated mount by inspecting its geometry.

    - ``motor_flange``: orient shaft +Z, then drop the part so its widest
      cross-section (the mounting flange) rests at ``surface_z`` and the body
      axis is centered at (cx, cy).
    - ``board_pocket``: lay the thinnest axis flat (Z), center it at (cx, cy)
      and rest its bottom face on ``surface_z``.
    """
    m = mesh_copy(mesh)
    if not mesh_uses_millimeters(m):
        m.apply_scale(1000.0)

    def bounds():
        v = m.vertices
        return v, v.min(axis=0), v.max(axis=0)

    if mount == "motor_flange":
        v, b0, b1 = bounds()
        zr = max(float(b1[2] - b0[2]), 1e-6)
        top = v[v[:, 2] > b1[2] - zr * 0.12]
        bot = v[v[:, 2] < b0[2] + zr * 0.12]
        fp = lambda p: 0.0 if len(p) < 3 else float(np.ptp(p[:, 0]) * np.ptp(p[:, 1]))
        # Shaft is the smaller end — make sure it points +Z.
        if fp(top) > fp(bot):
            m.apply_transform(trimesh.transformations.euler_matrix(np.pi, 0, 0))
            v, b0, b1 = bounds()
            zr = max(float(b1[2] - b0[2]), 1e-6)
        # Flange = z slab with the largest footprint.
        best_z, best = float(b1[2]), -1.0
        for t in np.linspace(0.0, 1.0, 25):
            z = float(b0[2] + zr * t)
            sl = v[np.abs(v[:, 2] - z) < zr * 0.05]
            if len(sl) < 3:
                continue
            f = float(np.ptp(sl[:, 0]) * np.ptp(sl[:, 1]))
            if f > best:
                best, best_z = f, z
        # Body axis XY = centroid of the lower (round body) region.
        low = v[v[:, 2] < b0[2] + zr * 0.3]
        axc = low[:, :2].mean(axis=0) if len(low) > 2 else (b0[:2] + b1[:2]) / 2.0
        m.apply_translation([cx - float(axc[0]), cy - float(axc[1]), surface_z - best_z])
        return repair_mesh(m)

    if mount == "board_pocket":
        v, b0, b1 = bounds()
        ext = b1 - b0
        thin = int(np.argmin(ext))
        if thin == 0:
            m.apply_transform(trimesh.transformations.euler_matrix(0, np.pi / 2, 0))
        elif thin == 1:
            m.apply_transform(trimesh.transformations.euler_matrix(np.pi / 2, 0, 0))
        v, b0, b1 = bounds()
        ctr = (b0 + b1) / 2.0
        m.apply_translation([cx - float(ctr[0]), cy - float(ctr[1]), surface_z - float(b0[2])])
        return repair_mesh(m)

    # Generic: rest bbox bottom on the surface, centered.
    v, b0, b1 = bounds()
    ctr = (b0 + b1) / 2.0
    m.apply_translation([cx - float(ctr[0]), cy - float(ctr[1]), surface_z - float(b0[2])])
    return repair_mesh(m)


def apply_transform(mesh: trimesh.Trimesh, transform: dict[str, Any]) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    center = np.asarray(m.bounds, dtype=float).mean(axis=0)
    pivoted = False
    if "scale" in transform:
        m.apply_translation(-center)
        pivoted = True
        m.apply_scale(transform["scale"])
    if "rotation_deg" in transform:
        if not pivoted:
            m.apply_translation(-center)
            pivoted = True
        r = np.radians(transform["rotation_deg"])
        matrix = trimesh.transformations.euler_matrix(r[0], r[1], r[2], axes="sxyz")
        m.apply_transform(matrix)
    if pivoted:
        m.apply_translation(center)
    if "translation" in transform:
        m.apply_translation(transform["translation"])
    return repair_mesh(m)


def extrude_face(
    mesh: trimesh.Trimesh,
    face_index: int,
    distance: float,
    *,
    axis: list[float] | None = None,
    inward: bool = False,
) -> trimesh.Trimesh:
    """Extrude a mesh face along its normal (or custom axis).

    Outward extrudes union with the body; inward extrudes cut (boolean difference)
    across the connected planar face region (same as Press-Pull cut).
    """
    dist = float(distance)
    if dist <= 0:
        raise ValueError("extrude distance must be > 0")
    if inward:
        return face_pull(
            mesh,
            int(face_index),
            distance=-dist,
            op="cut",
            normal=list(axis) if axis is not None else None,
        )

    m = repair_mesh(mesh_copy(mesh))
    fi = int(face_index)
    if fi < 0 or fi >= len(m.faces):
        raise ValueError(f"face_index out of range: {fi}")

    normal = np.asarray(axis if axis is not None else m.face_normals[fi], dtype=float)
    nlen = float(np.linalg.norm(normal))
    if nlen < 1e-9:
        raise ValueError("extrude direction is zero")
    normal = normal / nlen

    ring = m.vertices[m.faces[fi]]
    n = len(ring)
    if n < 3:
        raise ValueError("face must have at least 3 vertices")

    top = ring + normal * dist
    vertices = np.vstack([ring, top])
    faces: list[list[int]] = []

    for i in range(1, n - 1):
        faces.append([0, i, i + 1])
        faces.append([n, n + i + 1, n + i])

    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, j + n])
        faces.append([i, j + n, i + n])

    solid = _ensure_positive_volume(
        repair_mesh(trimesh.Trimesh(vertices=vertices, faces=faces, process=True))
    )
    return _boolean(m, solid, "union")


def _boolean_engines() -> list[str | None]:
    engines: list[str | None] = []
    try:
        import manifold3d  # noqa: F401

        engines.append("manifold")
    except Exception:
        pass
    engines.append(None)
    return engines


def _empty_mesh() -> trimesh.Trimesh:
    return trimesh.Trimesh(
        vertices=np.zeros((0, 3), dtype=float),
        faces=np.zeros((0, 3), dtype=int),
        process=False,
    )


def _ensure_positive_volume(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Flip winding when a solid reports negative volume (common for cutters)."""
    m = repair_mesh(mesh_copy(mesh))
    try:
        if float(m.volume) < 0:
            m.invert()
    except Exception:
        pass
    return m


def _difference_result_quality(base: trimesh.Trimesh, result: trimesh.Trimesh) -> float:
    """Higher is better. Negative means reject (no material removed / volume grew)."""
    if result is None or len(getattr(result, "vertices", [])) == 0:
        return 0.0  # empty = fully cut away (valid)
    try:
        base_vol = float(base.volume)
        out_vol = float(result.volume)
    except Exception:
        return 0.5
    if not np.isfinite(base_vol) or not np.isfinite(out_vol):
        return -1.0
    if base_vol > 0 and out_vol > base_vol * 1.001:
        return -1.0  # difference must not grow the solid
    removed = base_vol - out_vol if base_vol > 0 else 0.0
    if base_vol > 0 and removed <= max(base_vol * 1e-10, 1e-12):
        return -1.0
    score = removed
    try:
        if base.is_watertight and not bool(result.is_watertight):
            score *= 0.25  # prefer watertight results when the input was solid
    except Exception:
        pass
    return float(score)


def _bounds_contain(outer: np.ndarray, inner: np.ndarray, *, margin: float = 1e-6) -> bool:
    """True when ``inner`` AABB is inside ``outer`` AABB (with margin)."""
    try:
        o0 = np.asarray(outer[0], dtype=float) - margin
        o1 = np.asarray(outer[1], dtype=float) + margin
        i0 = np.asarray(inner[0], dtype=float)
        i1 = np.asarray(inner[1], dtype=float)
        return bool(np.all(i0 >= o0) and np.all(i1 <= o1))
    except Exception:
        return False


def _boolean(mesh_a: trimesh.Trimesh, mesh_b: trimesh.Trimesh, op: str) -> trimesh.Trimesh:
    """Boolean CSG with repair. Difference never falls back to deleting triangles."""
    a = repair_mesh(mesh_a)
    b = _ensure_positive_volume(mesh_b)
    fn = {
        "union": trimesh.boolean.union,
        "difference": trimesh.boolean.difference,
        "intersection": trimesh.boolean.intersection,
    }.get(op)
    if fn is None:
        raise ValueError(f"Unknown boolean op: {op}")

    last_err: Exception | None = None
    saw_empty = False
    best: trimesh.Trimesh | None = None
    best_score = -1.0

    cutters = [b]
    if op == "difference":
        flipped = mesh_copy(b)
        try:
            flipped.invert()
            cutters.append(repair_mesh(flipped))
        except Exception:
            pass

    for cutter in cutters:
        for engine in _boolean_engines():
            try:
                result = fn([a, cutter], engine=engine, check_volume=False)
            except Exception as exc:
                last_err = exc
                logger.info("Boolean %s engine=%s failed: %s", op, engine, exc)
                continue
            if result is None:
                continue
            if len(getattr(result, "vertices", [])) == 0:
                # Only treat empty as "fully cut away" when the cutter truly
                # swallows a solid body. Open/non-watertight meshes often yield
                # empty results from manifold on failure — that is NOT success.
                try:
                    solid_ok = bool(getattr(a, "is_watertight", False))
                except Exception:
                    solid_ok = False
                if solid_ok and _bounds_contain(cutter.bounds, a.bounds):
                    saw_empty = True
                continue
            repaired = repair_mesh(result)
            if op != "difference":
                return repaired
            score = _difference_result_quality(a, repaired)
            if score > best_score:
                best_score = score
                best = repaired

    if op == "difference":
        if best is not None and best_score >= 0:
            return best
        if saw_empty:
            return _empty_mesh()
        raise ValueError(
            f"Boolean cut failed{f': {last_err}' if last_err else ''}. "
            "Try a shallower depth, re-pick the face, or repair the mesh."
        )

    if op == "union":
        logger.warning("Boolean union fallback to concatenate")
        return repair_mesh(trimesh.util.concatenate([a, b]))
    if op == "intersection":
        logger.warning("Boolean intersection fallback — keeping mesh A")
        return a
    raise ValueError(f"Boolean {op} failed: {last_err}")


def _align_cylinder_to_axis(cylinder: trimesh.Trimesh, axis: np.ndarray, center: np.ndarray) -> trimesh.Trimesh:
    axis = np.asarray(axis, dtype=float)
    axis = axis / (np.linalg.norm(axis) + 1e-12)
    z = np.array([0.0, 0.0, 1.0])
    rot = trimesh.geometry.align_vectors(z, axis)
    if isinstance(rot, tuple):
        rot = rot[0]
    cylinder.apply_transform(rot)
    cylinder.apply_translation(center)
    return cylinder


def _cylinder_between_points(a: np.ndarray, b: np.ndarray, radius: float, sections: int = 24) -> trimesh.Trimesh | None:
    delta = np.asarray(b, dtype=float) - np.asarray(a, dtype=float)
    length = float(np.linalg.norm(delta))
    if length <= 1e-9:
        return None
    cyl = trimesh.creation.cylinder(radius=float(radius), height=length, sections=sections)
    return _align_cylinder_to_axis(cyl, delta / length, (np.asarray(a, dtype=float) + np.asarray(b, dtype=float)) / 2.0)


def add_route_geometry(
    base: trimesh.Trimesh,
    points: list[list[float]],
    *,
    style: str = "duct",
    radius: float | None = None,
    loop_width: float | None = None,
    loop_height: float | None = None,
    loop_spacing: float | None = None,
    loop_count: int | None = None,
    include_base: bool = True,
    surface_normals: list[list[float] | None] | None = None,
    surface_locked: bool = True,
) -> trimesh.Trimesh:
    """Add a visual wire duct or repeated wire-loop hoops along a model-space path."""
    pts = [np.asarray(p, dtype=float) for p in points if isinstance(p, (list, tuple)) and len(p) == 3]
    if len(pts) < 2:
        raise ValueError("Draw route needs at least two line-tool points.")
    model_scale = float(max(base.extents)) if np.all(np.isfinite(base.extents)) and max(base.extents) > 0 else 1.0
    route_radius = float(radius or (2.0 if mesh_uses_millimeters(base) else 0.002))
    route_radius = max(route_radius, model_scale * 0.0005)
    normals: list[np.ndarray | None] = []
    if surface_normals and len(surface_normals) == len(pts):
        for raw in surface_normals:
            if not isinstance(raw, (list, tuple)) or len(raw) != 3:
                normals.append(None)
                continue
            n = np.asarray(raw, dtype=float)
            if not np.all(np.isfinite(n)) or np.linalg.norm(n) < 1e-9:
                normals.append(None)
            else:
                normals.append(n / (np.linalg.norm(n) + 1e-12))
    if len(normals) != len(pts):
        normals = [None for _ in pts]
    locked = bool(surface_locked and any(n is not None for n in normals))
    if locked:
        # Keep the tube itself outside the picked face. Loop endpoints used to
        # start too close to the surface, so half the hoop could sink into it.
        lift = route_radius * (1.15 if style == "duct" else 1.35)
        pts = [p + (n if n is not None else np.array([0.0, 0.0, 1.0])) * lift for p, n in zip(pts, normals)]

    def segment_normal(i: int) -> np.ndarray:
        n0 = normals[i] if i < len(normals) else None
        n1 = normals[i + 1] if i + 1 < len(normals) else None
        if n0 is not None and n1 is not None and np.dot(n0, n1) > 0.25:
            n = n0 + n1
        else:
            n = n0 if n0 is not None else n1
        if n is None or np.linalg.norm(n) < 1e-9:
            n = np.array([0.0, 0.0, 1.0])
        return n / (np.linalg.norm(n) + 1e-12)

    meshes: list[trimesh.Trimesh] = []
    if include_base:
        meshes.append(mesh_copy(base))

    if style == "loops":
        width = float(loop_width or route_radius * 8.0)
        height = float(loop_height or route_radius * 6.0)
        spacing = float(loop_spacing or max(width * 1.75, route_radius * 12.0))

        def add_loop(center: np.ndarray, tangent: np.ndarray, up: np.ndarray) -> None:
            t = tangent / (np.linalg.norm(tangent) + 1e-12)
            side = np.cross(up, t)
            if np.linalg.norm(side) < 1e-8:
                side = np.array([1.0, 0.0, 0.0])
            side = side / (np.linalg.norm(side) + 1e-12)
            arch: list[np.ndarray] = []
            for i in range(13):
                theta = math.pi * i / 12.0
                arch.append(center + side * (math.cos(theta) * width / 2.0) + up * (math.sin(theta) * height))
            for a, b in zip(arch, arch[1:]):
                seg = _cylinder_between_points(a, b, route_radius, sections=16)
                if seg is not None:
                    meshes.append(seg)

        if loop_count == 1:
            total_len = sum(float(np.linalg.norm(b - a)) for a, b in zip(pts, pts[1:]))
            walked = 0.0
            placed = False
            for seg_idx, (a, b) in enumerate(zip(pts, pts[1:])):
                vec = b - a
                seg_len = float(np.linalg.norm(vec))
                if seg_len <= 1e-9:
                    continue
                target_dist = total_len * 0.5 if total_len > 1e-9 else 0.0
                if walked + seg_len >= target_dist:
                    frac = (target_dist - walked) / seg_len if seg_len > 1e-9 else 0.5
                    add_loop(a + vec * frac, vec, segment_normal(seg_idx))
                    placed = True
                    break
                walked += seg_len
            if not placed and len(pts) >= 2:
                mid = (np.asarray(pts[0], dtype=float) + np.asarray(pts[-1], dtype=float)) / 2.0
                vec = np.asarray(pts[-1], dtype=float) - np.asarray(pts[0], dtype=float)
                add_loop(mid, vec, segment_normal(0))
        else:
            for seg_idx, (a, b) in enumerate(zip(pts, pts[1:])):
                vec = b - a
                seg_len = float(np.linalg.norm(vec))
                if seg_len <= 1e-9:
                    continue
                steps = max(1, int(seg_len // spacing) + 1)
                up = segment_normal(seg_idx)
                for i in range(steps):
                    frac = (i + 0.5) / steps
                    add_loop(a + vec * frac, vec, up)
    else:
        for a, b in zip(pts, pts[1:]):
            seg = _cylinder_between_points(a, b, route_radius, sections=32)
            if seg is not None:
                meshes.append(seg)
        for p in pts:
            joint = trimesh.creation.icosphere(subdivisions=2, radius=route_radius * 1.05)
            joint.apply_translation(p)
            meshes.append(joint)

    if not meshes:
        raise ValueError("Draw route produced no geometry.")
    return repair_mesh(trimesh.util.concatenate(meshes))


def _through_hole_cutter(
    base: trimesh.Trimesh,
    position: np.ndarray,
    axis: np.ndarray,
    radius: float,
    *,
    through: bool,
    depth: float | None,
) -> trimesh.Trimesh:
    """Cylinder sized and placed for reliable hole booleans.

    Reference normals from the viewer point outward from the picked face. A blind
    hole should therefore start just outside the face and cut inward, opposite
    the normal. Through holes are centered across the model extent along the
    axis so they span the whole part.
    """
    ax = np.asarray(axis, dtype=float)
    ax = ax / (np.linalg.norm(ax) + 1e-12)
    pos = np.asarray(position, dtype=float)
    verts = base.vertices - pos
    proj = verts @ ax
    t0, t1 = float(proj.min()), float(proj.max())
    margin = max(float(max(base.extents)), radius * 4) * 0.15
    if through:
        length = (t1 - t0) + 2.0 * margin
        center = pos + ax * ((t0 + t1) * 0.5)
    else:
        requested_depth = float(depth or max(base.extents) * 0.5)
        face_margin = max(radius * 0.35, requested_depth * 0.05, 1e-6)
        length = requested_depth + 2.0 * face_margin
        # Span from just outside the face (pos + normal*margin) into the part.
        center = pos - ax * (requested_depth * 0.5)
    cutter = repair_mesh(
        trimesh.creation.cylinder(radius=radius, height=length, sections=48)
    )
    return _align_cylinder_to_axis(cutter, ax, center)


def hole_at_point(
    base: trimesh.Trimesh,
    position: list[float],
    *,
    axis: list[float] | None = None,
    diameter: float | None = None,
    depth: float | None = None,
    through: bool = False,
) -> trimesh.Trimesh:
    pos = np.asarray(position, dtype=float)
    ax = np.asarray(axis or [0, 0, 1], dtype=float)
    if diameter is None:
        diameter = 3.0 if mesh_uses_millimeters(base) else 0.003
    radius = float(diameter) / 2.0
    base_vol = float(base.volume) if base.volume > 0 else 0.0

    expected_depth = float(depth or max(base.extents))
    expected_removed = math.pi * radius * radius * max(expected_depth, radius)
    min_removed = max(expected_removed * 0.02, base_vol * 1e-8, 1e-9) if base_vol > 0 else 0.0

    def _candidate_points() -> list[np.ndarray]:
        pts = [pos]
        try:
            if base.bounds is not None:
                bounds = np.asarray(base.bounds, dtype=float)
                clipped = np.minimum(np.maximum(pos, bounds[0]), bounds[1])
                if np.linalg.norm(clipped - pos) > 1e-9:
                    pts.append(clipped)
        except Exception:
            pass
        # If a mm model receives metre-scale coordinates from the viewer, try
        # the unit-scaled equivalent before giving up.
        try:
            if mesh_uses_millimeters(base) and max(np.abs(pos)) < max(base.extents) * 0.05:
                pts.append(pos * 1000.0)
        except Exception:
            pass
        out: list[np.ndarray] = []
        for p in pts:
            if not any(np.linalg.norm(p - q) <= 1e-9 for q in out):
                out.append(p)
        return out

    axes = [ax]
    if not through:
        axes.append(-ax)

    missed: list[str] = []
    last_error: Exception | None = None
    best_out: trimesh.Trimesh | None = None
    best_removed = -1.0
    for candidate_pos in _candidate_points():
        for candidate_axis in axes:
            cutter = _through_hole_cutter(
                base, candidate_pos, candidate_axis, radius, through=through, depth=depth
            )
            if not _cutter_intersects_mesh(base, cutter):
                missed.append(
                    f"pos={candidate_pos.round(4).tolist()} axis={candidate_axis.round(4).tolist()}"
                )
                continue
            try:
                out = _boolean(repair_mesh(base), cutter, "difference")
            except Exception as exc:
                last_error = exc
                continue
            if base_vol <= 0:
                return out
            removed = base_vol - float(out.volume)
            if removed > best_removed:
                best_removed = removed
                best_out = out

    if best_out is not None and best_removed > min_removed:
        return best_out

    if missed and best_out is None:
        units = "mm" if mesh_uses_millimeters(base) else "m"
        raise ValueError(
            f"Hole cutter does not intersect the model (diameter={diameter:g} {units}). "
            "Pick a point on the part or increase diameter_mm."
        )
    if last_error is not None:
        raise ValueError(f"Boolean cut failed: {last_error}") from last_error

    out = mesh_copy(base)
    if base_vol > 0:
        removed = base_vol - float(out.volume)
    else:
        removed = 0.0
        min_removed = 0.0
    if base_vol > 0 and removed <= min_removed:
        has_manifold = "manifold" in _boolean_engines()
        units = "mm" if mesh_uses_millimeters(base) else "m"
        hint = (
            f"Boolean cut failed (diameter={diameter:g} {units}). "
            "Try a larger diameter_mm, ensure the mesh is a solid, or re-pick the face."
        )
        if not has_manifold:
            hint += " Also install manifold3d in the server venv: .venv/bin/python -m pip install manifold3d && restart."
        raise ValueError(hint)
    return out


def _coplanar_region_faces(
    mesh: trimesh.Trimesh, face_index: int, normal_tol: float = 0.9986
) -> tuple[list[int], np.ndarray]:
    """Edge-connected faces whose normals match the picked face (a planar region)."""
    from collections import defaultdict

    fi = int(face_index)
    if fi < 0 or fi >= len(mesh.faces):
        raise ValueError(f"face_index out of range: {fi}")
    normals = mesh.face_normals
    ref_n = np.asarray(normals[fi], dtype=float)
    adj: dict[int, list[int]] = defaultdict(list)
    for a, b in mesh.face_adjacency:
        adj[int(a)].append(int(b))
        adj[int(b)].append(int(a))
    seen = {fi}
    stack = [fi]
    while stack:
        cur = stack.pop()
        for nb in adj[cur]:
            if nb not in seen and float(np.dot(normals[nb], ref_n)) >= normal_tol:
                seen.add(nb)
                stack.append(nb)
    return sorted(seen), ref_n


def face_region_center_and_normal(mesh: trimesh.Trimesh, face_index: int) -> tuple[list[float], list[float]]:
    """Return centroid + normal for the connected planar region around a face."""
    region, normal = _coplanar_region_faces(mesh, face_index)
    faces = mesh.faces[np.asarray(region, dtype=int)]
    used = np.unique(faces)
    verts = np.asarray(mesh.vertices[used], dtype=float)
    center = verts.mean(axis=0)
    return center.tolist(), np.asarray(normal, dtype=float).tolist()


def _region_prism(
    mesh: trimesh.Trimesh,
    region: list[int],
    normal: np.ndarray,
    t0: float,
    t1: float,
    taper_deg: float = 0.0,
) -> trimesh.Trimesh:
    """Closed prism swept from a planar face region between offsets t0..t1 along its normal."""
    n = np.asarray(normal, dtype=float)
    n = n / (np.linalg.norm(n) + 1e-12)
    faces = mesh.faces[np.asarray(region, dtype=int)]
    used = np.unique(faces)
    remap = {int(v): i for i, v in enumerate(used)}
    base = np.asarray(mesh.vertices[used], dtype=float)
    nv = len(used)

    bottom = base + n * float(t0)
    top = base + n * float(t1)
    if abs(float(taper_deg)) > 1e-9:
        span = abs(float(t1) - float(t0))
        centroid = base.mean(axis=0)
        in_plane = top - (centroid + n * float(t1))
        in_plane = in_plane - np.outer(in_plane @ n, n)
        r_max = float(np.linalg.norm(in_plane, axis=1).max()) or 1.0
        s = float(np.clip(1.0 - math.tan(math.radians(float(taper_deg))) * span / r_max, 0.05, 10.0))
        top = (centroid + n * float(t1)) + in_plane * s

    f_local = np.array([[remap[int(a)], remap[int(b)], remap[int(c)]] for a, b, c in faces], dtype=int)
    tris: list[list[int]] = []
    tris.extend(f_local[:, ::-1].tolist())  # bottom cap, flipped
    tris.extend((f_local + nv).tolist())  # top cap

    directed: set[tuple[int, int]] = set()
    for a, b, c in f_local:
        directed.update(((int(a), int(b)), (int(b), int(c)), (int(c), int(a))))
    for a, b in directed:
        if (b, a) in directed:
            continue  # interior edge
        tris.append([a, b, b + nv])
        tris.append([a, b + nv, a + nv])

    verts = np.vstack([bottom, top])
    prism = trimesh.Trimesh(vertices=verts, faces=np.asarray(tris, dtype=int), process=True)
    return _ensure_positive_volume(prism)


def _mesh_bodies(mesh: trimesh.Trimesh) -> list[trimesh.Trimesh]:
    """Split concatenated multi-body meshes into separate shells when possible."""
    try:
        parts = mesh.split(only_watertight=False)
        if len(parts) > 1:
            return [repair_mesh(p) for p in parts]
    except Exception:
        pass
    return [mesh]


def _body_for_face(bodies: list[trimesh.Trimesh], face_index: int) -> tuple[int, int]:
    """Map a global face index to ``(body_index, local_face_index)``."""
    offset = 0
    for i, body in enumerate(bodies):
        nf = len(body.faces)
        if face_index < offset + nf:
            return i, face_index - offset
        offset += nf
    raise ValueError(f"face_index out of range: {face_index}")


def _reassemble_bodies(bodies: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    kept = [b for b in bodies if b is not None and len(getattr(b, "vertices", [])) > 0]
    if not kept:
        raise ValueError("Cut removed the entire model — use a shallower depth or a smaller face region")
    if len(kept) == 1:
        return kept[0]
    return repair_mesh(trimesh.util.concatenate(kept))


def _face_pull_cut(
    body: trimesh.Trimesh,
    region: list[int],
    normal: np.ndarray,
    t0: float,
    t1: float,
    taper_deg: float,
) -> trimesh.Trimesh:
    """Boolean cut on one body, trying both normal directions when needed."""
    base_vol = float(body.volume) if body.volume > 0 else 0.0
    min_removed = max(base_vol * 1e-8, 1e-9) if base_vol > 0 else 0.0
    best_out: trimesh.Trimesh | None = None
    best_removed = -1.0
    n = np.asarray(normal, dtype=float)
    last_err: Exception | None = None
    for candidate in (n, -n):
        prism = _region_prism(body, region, candidate, t0, t1, taper_deg)
        if not _cutter_intersects_mesh(body, prism):
            continue
        try:
            out = _boolean(body, prism, "difference")
        except ValueError as exc:
            last_err = exc
            continue
        if len(getattr(out, "vertices", [])) == 0:
            # Entire body consumed by the cutter.
            return out
        if base_vol <= 0:
            if len(getattr(out, "vertices", [])) > 0:
                return out
            continue
        removed = base_vol - float(out.volume)
        if removed > best_removed:
            best_removed = removed
            best_out = out
        if removed > min_removed:
            return out
    if best_out is not None and best_removed > min_removed:
        return best_out
    hint = f" ({last_err})" if last_err else ""
    raise ValueError(
        f"Cut removed no material — re-pick the face or increase depth{hint}"
    )


def face_pull(
    mesh: trimesh.Trimesh,
    face_index: int,
    *,
    distance: float,
    op: str = "auto",
    direction: str = "one",
    distance2: float = 0.0,
    taper_deg: float = 0.0,
    through: bool = False,
    normal: list[float] | None = None,
) -> trimesh.Trimesh:
    """Fusion-style press-pull on a planar face region.

    ``distance`` is signed and in the mesh's native units. ``op=auto`` joins on
    positive drags and cuts on negative drags. ``direction`` is one of
    ``one | symmetric | two`` (two-sided uses ``distance2`` for the back side).
    """
    m = repair_mesh(mesh_copy(mesh))
    bodies = _mesh_bodies(m)
    body_i, local_fi = _body_for_face(bodies, int(face_index))
    target = bodies[body_i]
    region, n = _coplanar_region_faces(target, local_fi)
    if normal is not None and len(normal) >= 3:
        hint = np.asarray(normal[:3], dtype=float)
        hn = float(np.linalg.norm(hint))
        if hn > 1e-12 and float(np.dot(n, hint / hn)) < 0:
            n = -n
    d = float(distance)
    eps = max(float(max(m.extents)) * 1e-3, 1e-9)

    mode = (op or "auto").lower()
    if mode == "auto":
        mode = "cut" if d < 0 else "join"
    mag = abs(d)

    if mode == "cut":
        # Cap blind depth so a deep push does not silently consume a thin shell
        # when Through-all is off. Through-all still spans the body extent.
        body_span = float(np.linalg.norm(target.extents)) + 2.0 * eps
        if through:
            depth = body_span
        else:
            depth = mag
            # Keep a tiny remnant if the cut would wipe a thin body entirely.
            try:
                thickness = abs(float(np.dot(target.extents, np.abs(n))))
            except Exception:
                thickness = body_span
            if thickness > 4.0 * eps and depth >= thickness - eps:
                depth = max(eps * 2.0, thickness - 2.0 * eps)
        if depth <= 0:
            raise ValueError("Cut depth must be > 0")
        if direction == "symmetric":
            t0, t1 = -depth, depth
        else:
            t0, t1 = -depth, eps
        bodies[body_i] = _face_pull_cut(target, region, n, t0, t1, taper_deg)
        return _reassemble_bodies(bodies)

    if mag <= 0:
        raise ValueError("Distance must be non-zero")
    if direction == "symmetric":
        t0, t1 = -mag, mag
    elif direction == "two":
        t0, t1 = -abs(float(distance2)), mag
    else:
        t0, t1 = -eps, mag
    prism = _region_prism(target, region, n, t0, t1, taper_deg)
    if mode == "new_body":
        bodies.append(repair_mesh(prism))
        return _reassemble_bodies(bodies)
    if mode == "intersect":
        bodies[body_i] = _boolean(target, prism, "intersection")
    else:
        bodies[body_i] = _boolean(target, prism, "union")
    return _reassemble_bodies(bodies)


def face_pull_many(
    mesh: trimesh.Trimesh,
    face_indices: list[int],
    *,
    distance: float,
    op: str = "auto",
    direction: str = "one",
    distance2: float = 0.0,
    taper_deg: float = 0.0,
    through: bool = False,
    normal: list[float] | None = None,
) -> trimesh.Trimesh:
    """Compatibility wrapper for Press-Pull on one or more picked faces."""
    indices = sorted({int(i) for i in face_indices if int(i) >= 0})
    if not indices:
        raise ValueError("Pick one or more faces before applying Press-Pull.")

    result = face_pull(
        mesh,
        indices[0],
        distance=distance,
        op=op,
        direction=direction,
        distance2=distance2,
        taper_deg=taper_deg,
        through=through,
        normal=normal,
    )
    for face_index in indices[1:]:
        try:
            result = face_pull(
                result,
                face_index,
                distance=distance,
                op=op,
                direction=direction,
                distance2=distance2,
                taper_deg=taper_deg,
                through=through,
                normal=normal,
            )
        except ValueError as exc:
            # A first face often expands to the full coplanar region, and
            # boolean topology can renumber later face indices. Keep the
            # successful pull rather than failing the whole tool.
            logger.info("Skipping additional Press-Pull face %s after topology changed: %s", face_index, exc)
    return result


_PLANE_NORMALS = {"YZ": [1.0, 0.0, 0.0], "XZ": [0.0, 1.0, 0.0], "XY": [0.0, 0.0, 1.0]}


def mirror_mesh(
    mesh: trimesh.Trimesh,
    *,
    plane: str = "YZ",
    normal: list[float] | None = None,
    origin: list[float] | None = None,
    offset: float = 0.0,
    mode: str = "join",
) -> trimesh.Trimesh:
    """Mirror a mesh across an origin plane (or custom plane), keep/join/replace."""
    m = repair_mesh(mesh_copy(mesh))
    n = np.asarray(
        normal if normal is not None else _PLANE_NORMALS.get(str(plane).upper(), [1.0, 0.0, 0.0]),
        dtype=float,
    )
    n = n / (np.linalg.norm(n) + 1e-12)
    p0 = np.asarray(origin if origin is not None else [0.0, 0.0, 0.0], dtype=float) + n * float(offset)

    reflect = np.eye(4)
    reflect[:3, :3] = np.eye(3) - 2.0 * np.outer(n, n)
    reflect[:3, 3] = 2.0 * float(np.dot(p0, n)) * n

    # trimesh flips face winding automatically for negative-determinant transforms
    mirrored = mesh_copy(m)
    mirrored.apply_transform(reflect)
    mirrored = repair_mesh(mirrored)

    mode = (mode or "join").lower()
    if mode == "replace":
        return mirrored
    if mode == "keep":
        return repair_mesh(trimesh.util.concatenate([m, mirrored]))
    return _boolean(m, mirrored, "union")


def _aabb_intersect(a: np.ndarray, b: np.ndarray) -> bool:
    return bool(np.all(a[0] <= b[1]) and np.all(b[0] <= a[1]))


def _cutter_intersects_mesh(base: trimesh.Trimesh, cutter: trimesh.Trimesh) -> bool:
    """Fast reject when the cutter bounding box misses the part entirely."""
    try:
        if base.bounds is not None and cutter.bounds is not None:
            return _aabb_intersect(np.asarray(base.bounds), np.asarray(cutter.bounds))
    except Exception:
        pass
    return True


def _hole_spec_for_ref(ref_id: str, refs: dict[str, dict[str, Any]]) -> tuple[list[float], list[float]]:
    ref = _lookup_ref(ref_id, refs)
    if not ref or ref.get("position") is None:
        raise ValueError(f"Unknown or invalid reference: {ref_id}")
    pos = list(ref["position"])
    axis = list(ref.get("normal") or [0, 0, 1])
    return pos, axis


def _hole_specs_from_action(
    action: dict[str, Any], refs: dict[str, dict[str, Any]]
) -> list[tuple[list[float], list[float]]]:
    """Multiple @refs → one through-hole at their centroid (unless one_per_ref set)."""
    ref_ids = _normalize_ref_ids(action)
    if not ref_ids and "position" in action:
        return [(list(action["position"]), list(action.get("axis", [0, 0, 1])))]

    if action.get("one_per_ref") or action.get("holes_per_ref"):
        return [_hole_spec_for_ref(rid, refs) for rid in ref_ids]

    if len(ref_ids) > 1:
        positions: list[np.ndarray] = []
        normals: list[np.ndarray] = []
        for rid in ref_ids:
            ref = _lookup_ref(rid, refs)
            if ref and ref.get("position") is not None:
                positions.append(np.asarray(ref["position"], dtype=float))
                if ref.get("normal"):
                    normals.append(np.asarray(ref["normal"], dtype=float))
        if len(positions) < 2:
            raise ValueError("hole_at_point: could not resolve multiple references")
        centroid = np.mean(positions, axis=0).tolist()
        if normals:
            axis = np.mean(normals, axis=0)
            axis = (axis / (np.linalg.norm(axis) + 1e-12)).tolist()
        else:
            axis = [0.0, 0.0, 1.0]
        return [(centroid, axis)]

    if len(ref_ids) == 1:
        return [_hole_spec_for_ref(ref_ids[0], refs)]

    raise ValueError("hole_at_point needs at_ref, at_refs, or position")


def _lasso_hole_candidates(ref: dict[str, Any]) -> list[tuple[list[float], list[float]]]:
    axis = list(ref.get("normal") or [0, 0, 1])
    candidates: list[list[float]] = []

    def add_point(raw: Any) -> None:
        if isinstance(raw, list) and len(raw) == 3 and all(isinstance(v, (int, float)) for v in raw):
            p = [float(raw[0]), float(raw[1]), float(raw[2])]
            if not any(np.linalg.norm(np.asarray(p) - np.asarray(q)) <= 1e-9 for q in candidates):
                candidates.append(p)

    add_point(ref.get("position"))

    for key in ("loop_points", "selected_vertices"):
        pts = [p for p in (ref.get(key) or []) if isinstance(p, list) and len(p) == 3]
        if pts:
            arr = np.asarray(pts, dtype=float)
            add_point(np.mean(arr, axis=0).tolist())

    loop = [p for p in (ref.get("loop_points") or []) if isinstance(p, list) and len(p) == 3]
    if loop:
        step = max(1, len(loop) // 8)
        for p in loop[::step][:8]:
            add_point(p)

    return [(p, axis) for p in candidates]


def _best_hole_at_ref(
    base: trimesh.Trimesh,
    ref: dict[str, Any],
    *,
    diameter: float | None,
    depth: float | None,
    through: bool,
) -> trimesh.Trimesh:
    if ref.get("type") != "lasso":
        pos, axis = _hole_spec_for_ref(str(ref.get("id", "")), references_map([ref]))
        return hole_at_point(base, pos, axis=axis, diameter=diameter, depth=depth, through=through)

    base_vol = float(base.volume) if base.volume > 0 else 0.0
    best: trimesh.Trimesh | None = None
    best_removed = -1.0
    last_error: Exception | None = None
    for pos, axis in _lasso_hole_candidates(ref):
        try:
            out = hole_at_point(base, pos, axis=axis, diameter=diameter, depth=depth, through=through)
        except Exception as exc:
            last_error = exc
            continue
        removed = base_vol - float(out.volume) if base_vol > 0 else 1.0
        if removed > best_removed:
            best = out
            best_removed = removed
    if best is not None:
        return best
    if last_error is not None:
        raise last_error
    raise ValueError(f"Invalid lasso reference: {ref.get('id')}")


def _box(extents: list[float]) -> trimesh.Trimesh:
    return repair_mesh(trimesh.creation.box(extents=extents))


def _cylinder(radius: float, height: float, sections: int = 32) -> trimesh.Trimesh:
    return repair_mesh(trimesh.creation.cylinder(radius=radius, height=height, sections=sections))


def _radial_whisk(
    *,
    wire_radius: float,
    wire_height: float,
    count: int,
    hub_radius: float = 6.0,
    hub_height: float = 12.0,
    tilt_deg: float = 18.0,
) -> trimesh.Trimesh:
    """Bundle of thin cylinders arranged as a balloon whisk."""
    parts: list[trimesh.Trimesh] = [_cylinder(hub_radius, hub_height)]
    for i in range(max(2, count)):
        azimuth = 360.0 * i / count
        wire = _cylinder(wire_radius, wire_height)
        matrix = trimesh.transformations.euler_matrix(
            np.radians(tilt_deg), 0, np.radians(azimuth), axes="sxyz"
        )
        wire.apply_transform(matrix)
        wire.apply_translation([0, 0, -hub_height * 0.35])
        parts.append(wire)
    return repair_mesh(trimesh.util.concatenate(parts))


def _position_mesh_at(action: dict[str, Any], mesh: trimesh.Trimesh, refs: dict[str, dict[str, Any]]) -> trimesh.Trimesh:
    """Move mesh so its bounds center sits on the first resolved @ref position."""
    if not _normalize_ref_ids(action) and "position" not in action:
        return mesh
    pos = np.asarray(_resolve_ref_position(action, refs), dtype=float)
    center = mesh.bounds.mean(axis=0)
    out = mesh_copy(mesh)
    out.apply_translation(pos - center)
    return out


def _sphere(radius: float) -> trimesh.Trimesh:
    return repair_mesh(trimesh.creation.icosphere(subdivisions=3, radius=radius))


def _vase(
    height: float = 0.25,
    outer_radius: float = 0.08,
    wall: float = 0.004,
    taper: float = 0.82,
    foot_scale: float = 1.08,
) -> trimesh.Trimesh:
    """Single revolved hollow plant vase (closed wall profile, no boolean stack)."""
    h = float(height)
    r0 = float(outer_radius)
    r1 = max(r0 * float(taper), r0 * 0.55)
    lip = r1 * 1.04
    foot = r0 * float(foot_scale)
    w = float(wall)
    sections = 64

    ri_foot = max(foot - w * 1.2, 0.005)
    ri_body = max(r0 - w, 0.005)
    ri_shoulder = max(r1 - w, 0.005)
    ri_lip = max(lip - w * 2, 0.005)
    z_floor = w * 1.5

    wall_prof = np.array(
        [
            [0.0, 0.0],
            [foot, 0.0],
            [r0, h * 0.06],
            [r0 * 0.97, h * 0.28],
            [r1, h * 0.78],
            [lip, h],
            [r1 * 0.94, h * 0.995],
            [ri_lip, h - w],
            [ri_shoulder, h * 0.72],
            [ri_body, h * 0.1],
            [ri_foot, z_floor],
            [0.0, z_floor],
            [0.0, 0.0],
        ],
        dtype=float,
    )

    mesh = repair_mesh(trimesh.creation.revolve(wall_prof, sections=sections))
    if len(mesh.vertices) > 0 and mesh.is_watertight:
        return mesh

    # Fallback: tapered solid cylinder
    body = _cylinder(r0, h, sections=sections)
    verts = body.vertices.copy()
    z0, z1 = verts[:, 2].min(), verts[:, 2].max()
    span = max(z1 - z0, 1e-9)
    for i in range(len(verts)):
        t = (verts[i, 2] - z0) / span
        s = 1.0 - t * (1.0 - taper)
        verts[i, 0] *= s
        verts[i, 1] *= s
    body.vertices = verts
    return repair_mesh(body)


def _parse_color(color: Any) -> np.ndarray:
    """RGBA uint8 for trimesh face_colors."""
    named = {
        "white": [255, 255, 255, 255],
        "black": [20, 20, 20, 255],
        "red": [220, 60, 60, 255],
        "green": [60, 180, 80, 255],
        "blue": [70, 130, 220, 255],
        "gray": [140, 145, 150, 255],
        "grey": [140, 145, 150, 255],
    }
    if isinstance(color, str):
        c = color.strip().lower()
        if c in named:
            return np.array(named[c], dtype=np.uint8)
        if c.startswith("#") and len(c) in (4, 7):
            if len(c) == 4:
                r, g, b = int(c[1] * 2, 16), int(c[2] * 2, 16), int(c[3] * 2, 16)
            else:
                r, g, b = int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)
            return np.array([r, g, b, 255], dtype=np.uint8)
    if isinstance(color, (list, tuple)):
        vals = list(color)
        if len(vals) >= 3 and all(0 <= v <= 1 for v in vals[:3]):
            rgba = [int(v * 255) for v in vals[:3]] + [255]
            if len(vals) >= 4:
                rgba[3] = int(vals[3] * 255) if vals[3] <= 1 else int(vals[3])
            return np.array(rgba, dtype=np.uint8)
        if len(vals) >= 3:
            return np.array([int(vals[0]), int(vals[1]), int(vals[2]), 255], dtype=np.uint8)
    return np.array([196, 196, 196, 255], dtype=np.uint8)


def _ensure_face_colors(mesh: trimesh.Trimesh, default: np.ndarray | None = None) -> np.ndarray:
    n = len(mesh.faces)
    if mesh.visual.face_colors is None or len(mesh.visual.face_colors) != n:
        base = default if default is not None else np.array([196, 196, 196, 255], dtype=np.uint8)
        mesh.visual.face_colors = np.tile(base, (n, 1))
    return mesh.visual.face_colors


def paint_faces(mesh: trimesh.Trimesh, face_indices: list[int], color: Any) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    rgba = _parse_color(color)
    colors = _ensure_face_colors(m)
    for fi in face_indices:
        if 0 <= fi < len(m.faces):
            colors[fi] = rgba
    m.visual.face_colors = colors
    return m


def set_mesh_material(mesh: trimesh.Trimesh, color: Any) -> trimesh.Trimesh:
    m = mesh_copy(mesh)
    rgba = _parse_color(color)
    n = len(m.faces)
    m.visual.face_colors = np.tile(rgba, (n, 1))
    return m


def _strip_ref_token(ref_id: str) -> str:
    return ref_id.strip().lstrip("@")


def _first_str(val: Any) -> str | None:
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, list) and val:
        first = val[0]
        if isinstance(first, str):
            return first.strip()
    return None


def _first_number(val: Any) -> int | float | None:
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, list) and val:
        first = val[0]
        if isinstance(first, (int, float)):
            return first
    return None


def sanitize_action(action: dict[str, Any]) -> dict[str, Any]:
    """Normalize AI quirks (e.g. at_ref as a list) before CAD build."""
    a = dict(action)
    op = a.get("op")

    at_ref = a.get("at_ref")
    if isinstance(at_ref, list):
        ids = [_strip_ref_token(x) for x in at_ref if isinstance(x, str)]
        a.pop("at_ref", None)
        merged = ids + [
            _strip_ref_token(x)
            for x in (a.get("at_refs") or a.get("refs") or [])
            if isinstance(x, str)
        ]
        if merged:
            a["at_refs"] = merged
    elif isinstance(at_ref, str):
        a["at_ref"] = _strip_ref_token(at_ref)

    for key in ("at_refs", "refs"):
        if key in a and isinstance(a[key], list):
            a[key] = [_strip_ref_token(x) for x in a[key] if isinstance(x, str)]

    for key in ("face_index_from", "face_index_to"):
        n = _first_number(a.get(key))
        if n is not None:
            a[key] = int(n)

    if op == "boolean":
        for key in ("a", "b"):
            sid = _first_str(a.get(key))
            if sid is not None:
                a[key] = sid

    if op == "transform" and "source" in a:
        sid = _first_str(a.get("source"))
        if sid is not None:
            a["source"] = sid

    return a


def _wire_loop_route_action(actions: list[dict[str, Any]]) -> dict[str, Any] | None:
    routes = [a for a in actions if a.get("op") == "route_geometry"]
    if len(routes) != 1:
        return None
    real = [a for a in actions if a.get("op") not in {"use_base", "import_existing"}]
    if len(real) != 1 or real[0] is not routes[0]:
        return None
    return routes[0]


def is_standalone_wire_loop_actions(actions: list[dict[str, Any]]) -> bool:
    route = _wire_loop_route_action(actions)
    if not route:
        return False
    route_type = str(route.get("route_type", route.get("style", "loops"))).lower()
    return route_type in {"loop", "loops", "wire_loop", "wire_loops", "clip", "clips"}


def _prompt_implies_single_wire_loop(prompt: str) -> bool:
    low = str(prompt or "").lower()
    if re.search(r"\b(wire\s+)?loops\b", low):
        return False
    if any(w in low for w in ("multiple", "several", "repeat", "spacing", "along the path", "every ")):
        return False
    return "loop" in low


def prepare_wire_loop_actions(actions: list[dict[str, Any]], *, prompt: str = "") -> list[dict[str, Any]]:
    """Wire-loop prompts add a new accessory part — never merge into the assembly base mesh."""
    route = _wire_loop_route_action(actions)
    if not route:
        return actions
    route_type = str(route.get("route_type", route.get("style", "loops"))).lower()
    if route_type not in {"loop", "loops", "wire_loop", "wire_loops", "clip", "clips"}:
        return actions

    prepared = [dict(a) for a in actions if a.get("op") != "use_base"]
    route = next(a for a in prepared if a.get("op") == "route_geometry")
    route["standalone"] = True
    if _prompt_implies_single_wire_loop(prompt):
        route["loop_count"] = 1
        route.pop("loop_spacing_mm", None)
        route.pop("loop_spacing", None)
    return prepared


def allocate_wire_loop_filename(project_path: Path) -> str:
    if not (project_path / "wire_loop.glb").is_file():
        return "wire_loop.glb"
    idx = 2
    while (project_path / f"wire_loop_{idx}.glb").is_file():
        idx += 1
    return f"wire_loop_{idx}.glb"


def resolve_legacy_prompt_output_filename(
    project_path: Path,
    plan: dict[str, Any],
    actions: list[dict[str, Any]],
    *,
    prompt: str = "",
    base_filename: str | None = None,
) -> str:
    if is_standalone_wire_loop_actions(actions):
        return allocate_wire_loop_filename(project_path)

    raw = str(plan.get("filename") or "generated.glb")
    if not raw.endswith((".glb", ".stl", ".obj")):
        raw += ".glb"

    canonical = _canonical_assembly_stem(project_path)
    stem = Path(raw).stem.lower()
    if canonical and stem == canonical.lower():
        # Accessory geometry must not overwrite the primary assembly export.
        if _wire_loop_route_action(actions) or "loop" in prompt.lower():
            return allocate_wire_loop_filename(project_path)

    if base_filename:
        base_stem = Path(base_filename).stem.lower().replace("_edited", "")
        if stem == base_stem and _wire_loop_route_action(actions):
            return allocate_wire_loop_filename(project_path)

    return raw


def _reference_mesh_for_route(points: list[list[float]]) -> trimesh.Trimesh:
    pts = [np.asarray(p, dtype=float) for p in points if isinstance(p, (list, tuple)) and len(p) == 3]
    if len(pts) >= 2:
        arr = np.vstack(pts)
        size = np.maximum(arr.max(axis=0) - arr.min(axis=0), 1.0)
        return trimesh.creation.box(extents=size.tolist())
    return trimesh.creation.box(extents=[100.0, 100.0, 100.0])


def sanitize_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [sanitize_action(a) for a in actions if isinstance(a, dict)]


def _lookup_ref(ref_id: str, references: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    key = _strip_ref_token(ref_id)
    return references.get(key) or references.get(f"@{key}")


def _normalize_ref_ids(action: dict[str, Any]) -> list[str]:
    """Collect string reference ids from at_ref / at_refs / refs (AI may send lists)."""
    ids: list[str] = []
    at_ref = action.get("at_ref")
    if isinstance(at_ref, str):
        ids.append(_strip_ref_token(at_ref))
    elif isinstance(at_ref, list):
        for item in at_ref:
            if isinstance(item, str):
                ids.append(_strip_ref_token(item))

    for key in ("at_refs", "refs"):
        raw = action.get(key)
        if isinstance(raw, list):
            for item in raw:
                if isinstance(item, str):
                    ids.append(_strip_ref_token(item))

    ref_one = action.get("reference_id")
    if isinstance(ref_one, str):
        ids.append(_strip_ref_token(ref_one))

    seen: set[str] = set()
    out: list[str] = []
    for rid in ids:
        if rid and rid not in seen:
            seen.add(rid)
            out.append(rid)
    return out


def _coerce_int_list(raw: Any) -> list[int]:
    if raw is None:
        return []
    if isinstance(raw, (int, float)):
        return [int(raw)]
    if not isinstance(raw, list):
        return []
    out: list[int] = []
    for item in raw:
        if isinstance(item, (int, float)):
            out.append(int(item))
        elif isinstance(item, list):
            out.extend(_coerce_int_list(item))
    return out


def _remap_face_index(mesh: trimesh.Trimesh, ref: dict[str, Any]) -> int | None:
    """Map a viewer @face ref to the closest triangle on the loaded edit mesh.

    GLB/STEP re-tessellation changes triangle order, so raw face_index from the
    picker often points at the wrong face on the server-side mesh.
    """
    pos = ref.get("position")
    if pos is None:
        fi = ref.get("face_index")
        return int(fi) if fi is not None else None

    p = np.asarray(pos, dtype=float)
    centers = mesh.triangles_center
    dists = np.linalg.norm(centers - p, axis=1)
    max_dist = max(float(np.max(mesh.extents)) * 0.08, 8.0)
    candidates = np.where(dists <= max_dist)[0]
    if len(candidates) == 0:
        candidates = np.array([int(np.argmin(dists))])

    normal = ref.get("normal")
    if normal is not None:
        n = np.asarray(normal, dtype=float)
        nn = float(np.linalg.norm(n))
        if nn > 1e-9:
            n = n / nn
            dots = np.abs(mesh.face_normals[candidates] @ n)
            best = int(candidates[int(np.argmax(dots))])
            return best

    return int(candidates[int(np.argmin(dists[candidates]))])


def _resolve_face_indices(
    action: dict[str, Any],
    references: dict[str, dict[str, Any]],
    mesh: trimesh.Trimesh | None = None,
) -> list[int]:
    indices: list[int] = []
    if "face_indices" in action:
        indices.extend(_coerce_int_list(action["face_indices"]))
    for ref_id in _normalize_ref_ids(action):
        ref = _lookup_ref(ref_id, references)
        if not ref:
            continue
        if mesh is not None:
            fi = _remap_face_index(mesh, ref)
            if fi is not None:
                indices.append(fi)
        elif ref.get("face_index") is not None:
            indices.append(int(ref["face_index"]))
    lo = action.get("face_index_from")
    hi = action.get("face_index_to")
    if lo is not None and hi is not None:
        indices.extend(range(int(lo), int(hi) + 1))
    return sorted(set(indices))


def _resolve_ref_position(action: dict[str, Any], references: dict[str, dict[str, Any]]) -> list[float]:
    for ref_id in _normalize_ref_ids(action):
        ref = _lookup_ref(ref_id, references)
        if ref and ref.get("position") is not None:
            return list(ref["position"])
    if "position" in action:
        return list(action["position"])
    raise ValueError(f"No position for action {action.get('op')}")


def _resolve_ref_axis(action: dict[str, Any], references: dict[str, dict[str, Any]]) -> list[float]:
    for ref_id in _normalize_ref_ids(action):
        ref = _lookup_ref(ref_id, references)
        if ref and ref.get("normal"):
            return list(ref["normal"])
    return list(action.get("axis", [0, 0, 1]))


def _route_points_from_action(
    action: dict[str, Any],
    references: dict[str, dict[str, Any]],
) -> tuple[list[list[float]], list[list[float] | None] | None, bool]:
    points = [p for p in (action.get("points") or []) if isinstance(p, list) and len(p) == 3]
    normals: list[list[float] | None] | None = None
    locked = bool(action.get("surface_locked", True))
    if points:
        raw_normals = action.get("surface_normals")
        if isinstance(raw_normals, list) and len(raw_normals) == len(points):
            normals = [n if isinstance(n, list) and len(n) == 3 else None for n in raw_normals]
        return points, normals, locked

    for ref_id in _normalize_ref_ids(action):
        ref = _lookup_ref(ref_id, references)
        if not ref:
            continue
        points = [p for p in (ref.get("loop_points") or []) if isinstance(p, list) and len(p) == 3]
        if not points:
            points = [p for p in (ref.get("endpoints") or []) if isinstance(p, list) and len(p) == 3]
        if len(points) < 2 and ref.get("position") is not None:
            points = [list(ref["position"])]
        if len(points) >= 2:
            raw_normals = ref.get("surface_normals")
            if isinstance(raw_normals, list) and len(raw_normals) == len(points):
                normals = [n if isinstance(n, list) and len(n) == 3 else None for n in raw_normals]
            elif isinstance(ref.get("normal"), list) and len(ref["normal"]) == 3:
                normals = [list(ref["normal"]) for _ in points]
            locked = bool(ref.get("surface_locked", locked))
            return points, normals, locked

    raise ValueError("route_geometry needs points or a drawn @path reference")


def build_from_actions(
    actions: list[dict[str, Any]],
    *,
    base_mesh: trimesh.Trimesh | None = None,
    references: dict[str, dict[str, Any]] | None = None,
) -> trimesh.Trimesh:
    actions = sanitize_actions(actions)
    meshes: dict[str, trimesh.Trimesh] = {}
    refs = references or {}
    result_id: str | None = None
    working = repair_mesh(mesh_copy(base_mesh)) if base_mesh is not None else None
    assembly_ids: set[str] = set()
    warnings: list[str] = []

    for action in actions:
        op = action.get("op")
        aid = action.get("id", str(uuid.uuid4())[:8])

        if op == "use_base":
            if working is None:
                raise ValueError("use_base requires base_filename / loaded mesh")
            working = mesh_copy(working)
            meshes[aid] = working
            assembly_ids.add(aid)
        elif op == "box":
            meshes[aid] = _position_mesh_at(action, _box(action.get("extents", [1, 1, 1])), refs)
        elif op == "cylinder":
            arrangement = str(action.get("arrangement", ""))
            count = int(action.get("count", 1))
            if arrangement == "radial_whisk" and count > 1:
                mesh = _radial_whisk(
                    wire_radius=float(action.get("radius", 1.2)),
                    wire_height=float(action.get("height", 55)),
                    count=count,
                    hub_radius=float(action.get("hub_radius", 6)),
                    hub_height=float(action.get("hub_height", 12)),
                )
                meshes[aid] = _position_mesh_at(action, mesh, refs)
            else:
                mesh = _cylinder(
                    radius=float(action.get("radius", 0.5)),
                    height=float(action.get("height", 1)),
                    sections=int(action.get("sections", 32)),
                )
                meshes[aid] = _position_mesh_at(action, mesh, refs)
        elif op == "sphere":
            meshes[aid] = _position_mesh_at(action, _sphere(float(action.get("radius", 0.5))), refs)
        elif op == "vase":
            mesh = _vase(
                height=float(action.get("height", 0.25)),
                outer_radius=float(action.get("outer_radius", action.get("radius", 0.08))),
                wall=float(action.get("wall", action.get("wall_mm", 4) / 1000)),
                taper=float(action.get("taper", 0.82)),
            )
            meshes[aid] = mesh
            working = mesh
        elif op == "paint_faces":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("paint_faces requires a base mesh (use use_base first)")
            indices = _resolve_face_indices(action, refs, target)
            if not indices:
                raise ValueError("paint_faces: no face indices or @face refs resolved")
            working = paint_faces(target, indices, action.get("color", "white"))
            meshes[aid] = working
        elif op == "set_material":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("set_material requires a mesh")
            working = set_mesh_material(target, action.get("color", [0.77, 0.77, 0.77]))
            meshes[aid] = working
        elif op == "route_geometry":
            standalone = bool(action.get("standalone"))
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None and not standalone:
                raise ValueError("route_geometry requires a base mesh")
            route_type = str(action.get("route_type", action.get("style", "loops"))).lower()
            style = "loops" if route_type in {"loop", "loops", "wire_loop", "wire_loops", "clip", "clips"} else "duct"
            points, surface_normals, surface_locked = _route_points_from_action(action, refs)
            ref_mesh = target if target is not None else _reference_mesh_for_route(points)

            def route_length(key: str, key_mm: str) -> float | None:
                if key in action and action.get(key) is not None:
                    return float(action[key])
                if key_mm in action and action.get(key_mm) is not None:
                    return length_from_mm(ref_mesh, float(action[key_mm]))
                return None

            loop_count_raw = action.get("loop_count")
            loop_count = int(loop_count_raw) if loop_count_raw is not None else None

            working = add_route_geometry(
                ref_mesh,
                points,
                style=style,
                radius=route_length("radius", "radius_mm"),
                loop_width=route_length("loop_width", "loop_width_mm"),
                loop_height=route_length("loop_height", "loop_height_mm"),
                loop_spacing=route_length("loop_spacing", "loop_spacing_mm"),
                loop_count=loop_count,
                include_base=not standalone,
                surface_normals=surface_normals,
                surface_locked=surface_locked,
            )
            meshes[aid] = working
            if not standalone:
                assembly_ids.add(aid)
        elif op == "transform":
            source = action.get("source")
            if source not in meshes:
                raise ValueError(f"Unknown source mesh: {source}")
            positioned = _position_mesh_at(action, meshes[source], refs)
            meshes[aid] = apply_transform(positioned, action.get("transform", {}))
        elif op == "boolean":
            a, b = action.get("a"), action.get("b")
            if a not in meshes or b not in meshes:
                raise ValueError(f"Boolean references unknown meshes: {a}, {b}")
            meshes[aid] = _boolean(meshes[a], meshes[b], action.get("operation", "union"))
            if a in assembly_ids or b in assembly_ids:
                assembly_ids.add(aid)
                working = meshes[aid]
        elif op == "hole_at_point":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("hole_at_point requires a base mesh")
            if "diameter" in action:
                diameter = float(action["diameter"])
            elif "diameter_mm" in action:
                diameter = length_from_mm(target, float(action["diameter_mm"]))
            else:
                diameter = None
            if "depth_mm" in action and "depth" not in action:
                depth = length_from_mm(target, float(action["depth_mm"]))
            elif action.get("depth") is not None:
                depth = float(action["depth"])
            else:
                depth = None
            ref_ids = _normalize_ref_ids(action)
            if len(ref_ids) == 1:
                ref = _lookup_ref(ref_ids[0], refs)
                if ref and ref.get("type") == "lasso":
                    target = _best_hole_at_ref(
                        target,
                        ref,
                        diameter=diameter,
                        depth=depth,
                        through=bool(action.get("through", False)),
                    )
                else:
                    for pos, axis in _hole_specs_from_action(action, refs):
                        target = hole_at_point(
                            target,
                            pos,
                            axis=axis,
                            diameter=diameter,
                            depth=depth,
                            through=bool(action.get("through", False)),
                        )
            else:
                for pos, axis in _hole_specs_from_action(action, refs):
                    target = hole_at_point(
                        target,
                        pos,
                        axis=axis,
                        diameter=diameter,
                        depth=depth,
                        through=bool(action.get("through", False)),
                    )
            working = target
            meshes[aid] = working
        elif op == "extrude_face":
            target = working if working is not None else meshes.get(action.get("source", ""))
            if target is None and meshes:
                target = list(meshes.values())[-1]
            if target is None:
                raise ValueError("extrude_face requires a base mesh")
            indices = _resolve_face_indices(action, refs, target)
            if not indices:
                raise ValueError("extrude_face: pick a face or set face_index")
            if "distance" in action:
                distance = float(action["distance"])
            elif "distance_mm" in action:
                distance = length_from_mm(target, float(action["distance_mm"]))
            else:
                distance = length_from_mm(target, 10.0)
            axis = _resolve_ref_axis(action, refs) if _normalize_ref_ids(action) else action.get("axis")
            for fi in indices:
                target = extrude_face(
                    target,
                    fi,
                    distance,
                    axis=axis,
                    inward=bool(action.get("inward", False)),
                )
            working = target
            meshes[aid] = working
        elif op == "import_existing":
            continue
        else:
            raise ValueError(f"Unsupported CAD op: {op}")

        if action.get("result", False):
            result_id = aid

    if result_id and result_id in meshes and result_id in assembly_ids:
        out = meshes[result_id]
    elif working is not None:
        out = working
        if result_id and result_id in meshes and result_id not in assembly_ids:
            out = _boolean(out, meshes[result_id], "union")
    elif result_id and result_id in meshes:
        out = meshes[result_id]
    elif meshes:
        out = trimesh.util.concatenate(list(meshes.values()))
    else:
        raise ValueError("No meshes produced from actions")

    if len(out.vertices) == 0:
        raise ValueError("Result mesh is empty — try a simpler prompt (e.g. 'vase' or '20cm cube')")

    return repair_mesh(out)


def references_map(refs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for r in refs:
        if "id" not in r:
            continue
        rid = str(r["id"])
        bare = _strip_ref_token(rid)
        out[rid] = r
        out[bare] = r
        out[f"@{bare}"] = r
    return out


def save_actions_manifest(project_path: Path, actions: list[dict[str, Any]]) -> Path:
    manifest = project_path / "last_actions.json"
    manifest.write_text(json.dumps(actions, indent=2))
    return manifest


def face_indices_from_refs(refs: list[dict[str, Any]] | None) -> list[int]:
    """Collect triangle indices from face/lasso geometric references."""
    indices: set[int] = set()
    for ref in refs or []:
        raw = ref.get("face_indices") or []
        for item in raw:
            try:
                indices.add(int(item))
            except (TypeError, ValueError):
                continue
        fi = ref.get("face_index")
        if fi is not None:
            try:
                indices.add(int(fi))
            except (TypeError, ValueError):
                continue
    return sorted(indices)


def _edge_use_counts(mesh: trimesh.Trimesh) -> dict[tuple[int, int], int]:
    counts: dict[tuple[int, int], int] = {}
    for face in mesh.faces:
        for i in range(3):
            a = int(face[i])
            b = int(face[(i + 1) % 3])
            key = (a, b) if a < b else (b, a)
            counts[key] = counts.get(key, 0) + 1
    return counts


def _degenerate_face_indices(mesh: trimesh.Trimesh) -> list[int]:
    out: list[int] = []
    try:
        areas = mesh.area_faces
        for i, area in enumerate(areas):
            if float(area) <= 1e-12:
                out.append(int(i))
    except Exception:
        pass
    return out


def analyze_mesh_topology(
    mesh: trimesh.Trimesh,
    *,
    face_indices: list[int] | None = None,
) -> dict[str, Any]:
    """Return mesh health diagnostics, optionally scoped to a triangle selection."""
    m = mesh
    tri_count = int(len(m.faces))
    vert_count = int(len(m.vertices))
    edge_counts = _edge_use_counts(m)
    boundary_edges = sum(1 for c in edge_counts.values() if c == 1)
    nonmanifold_edges = sum(1 for c in edge_counts.values() if c > 2)
    degenerate_faces = _degenerate_face_indices(m)
    duplicate_faces = 0
    try:
        unique = m.unique_faces()
        duplicate_faces = max(0, tri_count - int(len(unique)))
    except Exception:
        pass

    bodies = 1
    try:
        bodies = max(1, len(m.split(only_watertight=False)))
    except Exception:
        pass

    selected = sorted({int(i) for i in (face_indices or []) if 0 <= int(i) < tri_count})
    selected_set = set(selected)
    selected_degenerate = [i for i in degenerate_faces if i in selected_set]

    selected_boundary = 0
    selected_nonmanifold = 0
    if selected_set:
        for fi in selected:
            face = m.faces[fi]
            for i in range(3):
                a = int(face[i])
                b = int(face[(i + 1) % 3])
                key = (a, b) if a < b else (b, a)
                count = edge_counts.get(key, 0)
                if count == 1:
                    selected_boundary += 1
                elif count > 2:
                    selected_nonmanifold += 1

    report: dict[str, Any] = {
        "faces": tri_count,
        "vertices": vert_count,
        "edges": len(edge_counts),
        "bodies": bodies,
        "watertight": bool(getattr(m, "is_watertight", False)),
        "winding_consistent": bool(getattr(m, "is_winding_consistent", True)),
        "euler_number": int(getattr(m, "euler_number", 0)),
        "boundary_edges": boundary_edges,
        "nonmanifold_edges": nonmanifold_edges,
        "degenerate_faces": len(degenerate_faces),
        "duplicate_faces": duplicate_faces,
        "issues": [],
        "scope": "selection" if selected else "whole",
        "selected_faces": len(selected),
    }

    if not report["watertight"]:
        report["issues"].append("Mesh is not watertight (open boundaries or holes).")
    if nonmanifold_edges:
        report["issues"].append(f"{nonmanifold_edges} non-manifold edge(s) detected.")
    if boundary_edges:
        report["issues"].append(f"{boundary_edges} boundary edge(s) on open surfaces.")
    if degenerate_faces:
        report["issues"].append(f"{len(degenerate_faces)} degenerate triangle(s) with near-zero area.")
    if duplicate_faces:
        report["issues"].append(f"{duplicate_faces} duplicate triangle(s) detected.")
    if not report["winding_consistent"]:
        report["issues"].append("Face winding is inconsistent ( flipped normals ).")

    if selected:
        report["selection"] = {
            "face_indices": selected[:500],
            "face_count": len(selected),
            "degenerate_faces": len(selected_degenerate),
            "boundary_edges": selected_boundary,
            "nonmanifold_edges": selected_nonmanifold,
            "issues": [],
        }
        if selected_degenerate:
            report["selection"]["issues"].append(
                f"{len(selected_degenerate)} degenerate triangle(s) inside the selection."
            )
        if selected_boundary:
            report["selection"]["issues"].append(
                f"{selected_boundary} open boundary edge(s) touch the selection."
            )
        if selected_nonmanifold:
            report["selection"]["issues"].append(
                f"{selected_nonmanifold} non-manifold edge(s) touch the selection."
            )

    report["healthy"] = len(report["issues"]) == 0
    return report


def smooth_mesh(
    mesh: trimesh.Trimesh,
    *,
    face_indices: list[int] | None = None,
    method: str = "taubin",
    iterations: int = 8,
) -> trimesh.Trimesh:
    """Smooth whole mesh or only vertices belonging to selected triangles."""
    from trimesh.smoothing import filter_laplacian, filter_taubin

    m = mesh_copy(mesh)
    iters = max(1, min(int(iterations), 50))
    fn = filter_taubin if method == "taubin" else filter_laplacian
    smoothed = fn(m, iterations=iters)
    if not face_indices:
        return repair_mesh(smoothed)

    tri_count = len(m.faces)
    verts: set[int] = set()
    for fi in face_indices:
        idx = int(fi)
        if 0 <= idx < tri_count:
            verts.update(int(v) for v in m.faces[idx])
    if not verts:
        return repair_mesh(m)
    vert_ids = np.array(sorted(verts), dtype=int)
    m.vertices[vert_ids] = smoothed.vertices[vert_ids]
    return repair_mesh(m)


def cleanup_mesh(
    mesh: trimesh.Trimesh,
    *,
    face_indices: list[int] | None = None,
    repair: bool = True,
    smooth: bool = False,
    smooth_method: str = "taubin",
    smooth_iterations: int = 8,
) -> tuple[trimesh.Trimesh, dict[str, Any]]:
    """Run topology cleanup and return the updated mesh plus before/after reports."""
    before = analyze_mesh_topology(mesh, face_indices=face_indices)
    m = mesh_copy(mesh)
    changes: list[str] = []

    if repair:
        try:
            m.remove_duplicate_faces()
            changes.append("remove_duplicate_faces")
        except Exception:
            pass
        try:
            m.remove_unreferenced_vertices()
            changes.append("remove_unreferenced_vertices")
        except Exception:
            pass
        if hasattr(m, "remove_degenerate_faces"):
            try:
                m.remove_degenerate_faces()
                changes.append("remove_degenerate_faces")
            except Exception:
                pass
        try:
            m.merge_vertices(merge_tex=True)
            changes.append("merge_vertices")
        except Exception:
            pass
        if hasattr(m, "fill_holes"):
            try:
                m.fill_holes()
                changes.append("fill_holes")
            except Exception:
                pass
        try:
            m.fix_normals()
            changes.append("fix_normals")
        except Exception:
            pass
        try:
            m.process(validate=True)
            changes.append("process")
        except Exception:
            pass
        m = repair_mesh(m)

    if smooth:
        m = smooth_mesh(
            m,
            face_indices=face_indices,
            method=smooth_method,
            iterations=smooth_iterations,
        )
        changes.append(f"smooth_{smooth_method}")

    after = analyze_mesh_topology(m, face_indices=face_indices)
    return m, {"before": before, "after": after, "changes": changes}


def mesh_body_info(mesh: trimesh.Trimesh) -> dict[str, Any]:
    """Return disconnected body count and global face index offsets."""
    bodies = _mesh_bodies(mesh)
    offsets: list[int] = []
    off = 0
    names: list[str] = []
    for i, body in enumerate(bodies):
        offsets.append(off)
        names.append(f"Body {i + 1}")
        off += len(body.faces)
    return {
        "count": len(bodies),
        "face_offsets": offsets,
        "body_names": names,
        "can_split": len(bodies) > 1,
        "faces": int(len(mesh.faces)),
    }


def split_mesh_bodies(mesh: trimesh.Trimesh) -> list[trimesh.Trimesh]:
    """Split a mesh into separate disconnected bodies."""
    bodies = _mesh_bodies(mesh)
    if len(bodies) <= 1:
        raise ValueError("Mesh has only one body — nothing to split.")
    return bodies


def remove_mesh_body(mesh: trimesh.Trimesh, body_index: int) -> trimesh.Trimesh:
    """Remove one disconnected body shell from a multi-body mesh."""
    bodies = _mesh_bodies(mesh)
    idx = int(body_index)
    if len(bodies) <= 1:
        raise ValueError("Cannot remove a body from a single-body mesh.")
    if idx < 0 or idx >= len(bodies):
        raise ValueError(f"body_index out of range: {idx}")
    remaining = [b for i, b in enumerate(bodies) if i != idx]
    if not remaining:
        raise ValueError("Cannot remove the last remaining body.")
    return _reassemble_bodies(remaining) if len(remaining) > 1 else repair_mesh(remaining[0])


def transform_mesh_body(mesh: trimesh.Trimesh, body_index: int, transform: dict[str, Any]) -> trimesh.Trimesh:
    """Apply a transform to one disconnected body shell inside a multi-body mesh."""
    bodies = _mesh_bodies(mesh)
    idx = int(body_index)
    if len(bodies) <= 1:
        raise ValueError("Cannot transform a separate body in a single-body mesh.")
    if idx < 0 or idx >= len(bodies):
        raise ValueError(f"body_index out of range: {idx}")

    body = mesh_copy(bodies[idx])
    center = body.bounds.mean(axis=0) if body.bounds is not None else body.centroid
    if "scale" in transform:
        body.apply_translation(-center)
        body.apply_scale(float(transform["scale"]))
        body.apply_translation(center)
    if "rotation_deg" in transform:
        r = np.radians(transform["rotation_deg"])
        matrix = trimesh.transformations.euler_matrix(r[0], r[1], r[2], axes="sxyz")
        to_origin = trimesh.transformations.translation_matrix(-center)
        back = trimesh.transformations.translation_matrix(center)
        body.apply_transform(back @ matrix @ to_origin)
    if "translation" in transform:
        body.apply_translation(transform["translation"])

    bodies[idx] = body
    return _reassemble_bodies(bodies)


def body_index_for_face(face_index: int, face_offsets: list[int]) -> int:
    idx = int(face_index)
    for i in range(len(face_offsets) - 1, -1, -1):
        if idx >= face_offsets[i]:
            return i
    return 0
